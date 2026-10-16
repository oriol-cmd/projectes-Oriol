/**
 * Secretari: assistent personal per WhatsApp.
 *
 * Li escrius (o li envies una nota de veu, una foto o un PDF) i:
 *  - t'apunta les cites i les tasques al Google Calendar,
 *  - les mou, les esborra o les marca com a fetes,
 *  - et respon què tens avui, demà o la setmana que ve,
 *  - t'avisa per WhatsApp abans de cada cita i a l'hora que li demanis,
 *  - et fa un resum de l'agenda cada matí i un repàs cada vespre.
 *
 * Instal·lació: segueix secretari/README.md. Les claus NO van en aquest fitxer sinó a
 * Configuració del projecte > Propietats de l'script (així, en actualitzar el codi no es perden):
 *   GEMINI_KEY   Clau de Gemini (AIza…)
 *   WA_TOKEN     Token permanent de WhatsApp (usuari del sistema de Meta)
 *   WA_PHONE_ID  «Phone number ID» del número del secretari
 *   WA_VERIFY    Una paraula inventada per verificar el webhook
 *   MY_NUMBER    El teu mòbil amb prefix i sense «+» (p. ex. 34600111222)
 *   CALENDAR_ID  (opcional) Calendari on apuntar-ho. Si no hi és, el principal.
 *   WEBHOOK_KEY  (opcional) Clau que ha de portar l'URL del webhook: …/exec?k=CLAU
 *
 * Diverses persones (p. ex. l'equip): executa «configura» i es crea el full «Secretari – Usuaris»
 * (l'adreça surt al registre). Cada fila és una persona: nom, mòbil i calendari. El secretari
 * reconeix qui li escriu pel número i fa servir el calendari d'aquella persona.
 */

// ── Ajustos que pots canviar ────────────────────────────────────────────────
const TZ = 'Europe/Madrid';
const AVIS_PER_DEFECTE = 30;      // Minuts abans de cada cita que t'avisa (-1 = mai)
const HORA_RESUM_MATI = 8;        // Resum de l'agenda del dia (null = cap)
const HORA_RESUM_VESPRE = 21;     // Tasques pendents i agenda de demà (null = cap)
const DIES_AGENDA = 30;           // Quants dies endavant de l'agenda veu el secretari
const PLANTILLA = 'recordatori';  // Plantilla de WhatsApp per escriure't fora de la finestra de 24 h
const PLANTILLA_IDIOMA = 'ca';
const NOM = 'Secretari';

// ── Constants ───────────────────────────────────────────────────────────────
const GRAPH = 'https://graph.facebook.com/v23.0/';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Si un model no té quota, passa al següent.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const TASCA = '☐ ';  // Les tasques són esdeveniments de tot el dia que comencen així
const FETA = '✅ ';
const DIES = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];
const DIES_CURTS = ['dg', 'dl', 'dt', 'dc', 'dj', 'dv', 'ds'];
const MESOS = ['de gener', 'de febrer', 'de març', "d'abril", 'de maig', 'de juny', 'de juliol', "d'agost", 'de setembre', "d'octubre", 'de novembre', 'de desembre'];
const MAX_HISTORIAL = 6;
const FULL_USUARIS = 'Secretari – Usuaris';
const REGISTRE = [];  // Línies de diagnòstic de l'execució (provaPersona les envia per correu)

function registre_(text) {
  console.log(text);
  REGISTRE.push(text);
}

// ── Webhook de WhatsApp ─────────────────────────────────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === prop_('WA_VERIFY')) {
    return text_(p['hub.challenge']);
  }
  return text_(NOM + ' actiu');
}

function doPost(e) {
  try {
    const clau = prop_('WEBHOOK_KEY', true);
    if (clau && ((e && e.parameter) || {}).k !== clau) {
      console.warn('Missatge ignorat: la clau ?k= de l\'URL del webhook no coincideix amb WEBHOOK_KEY');
      return text_('ok');
    }
    const body = JSON.parse(e.postData.contents);
    (body.entry || []).forEach(function (entry) {
      (entry.changes || []).forEach(function (change) {
        ((change.value || {}).messages || []).forEach(processa_);
      });
    });
  } catch (err) {
    console.error(err);
  }
  return text_('ok');
}

function processa_(msg) {
  // WhatsApp torna a enviar el missatge si no rep resposta prou ràpid: només el tractem un cop.
  if (!primerCop_(msg.id)) return;
  const u = usuari_(msg.from);
  if (!u) {
    console.warn('Missatge d\'un número no donat d\'alta: ' + msg.from);
    try {
      wa_({ type: 'text', text: { body: "Hola! Aquest número no està donat d'alta al secretari. Demana a qui el gestiona que t'hi afegeixi." } }, msg.from);
    } catch (err) { console.warn(err); }
    return;
  }
  desaEstat_(u, 'DARRER_MISSATGE', String(Date.now()));
  marcaLlegit_(msg.id);

  const parts = [];
  try {
    if (msg.type === 'text') {
      parts.push({ text: msg.text.body });
    } else if (msg.type === 'audio') {
      parts.push({ text: '(Nota de veu adjunta: escolta-la i fes el que hi demana.)' }, media_(msg.audio.id));
    } else if (msg.type === 'image') {
      parts.push({ text: (msg.image.caption || '') + '\n(Imatge adjunta: si hi ha dates, cites o coses per fer, apunta-les.)' }, media_(msg.image.id));
    } else if (msg.type === 'document' && /pdf/.test(msg.document.mime_type || '')) {
      parts.push({ text: (msg.document.caption || '') + '\n(PDF adjunt: si hi ha dates, cites o coses per fer, apunta-les.)' }, media_(msg.document.id));
    } else if (msg.type === 'button') {
      parts.push({ text: msg.button.text });
    } else {
      envia_('De moment entenc missatges de text, notes de veu, fotos i PDF.', u);
      return;
    }
    envia_(aten_(parts, u), u);
  } catch (err) {
    console.error(err);
    envia_('⚠️ No ho he pogut fer: ' + (err && err.message ? err.message : err), u);
  }
}

function primerCop_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('m' + id)) return false;
    cache.put('m' + id, '1', 21600);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ── El cervell: Gemini interpreta el missatge i decideix què cal fer ────────

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    peticio: { type: 'STRING', description: "Resum curt del que ha demanat l'usuari" },
    accions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipus: { type: 'STRING', enum: ['crear_cita', 'crear_tasca', 'modificar', 'esborrar', 'fet'] },
          ref: { type: 'STRING', description: 'E1, T2… per a modificar, esborrar o fet' },
          titol: { type: 'STRING' },
          inici: { type: 'STRING', description: 'AAAA-MM-DDTHH:MM, o AAAA-MM-DD si és de tot el dia' },
          fi: { type: 'STRING' },
          tot_el_dia: { type: 'BOOLEAN' },
          lloc: { type: 'STRING' },
          notes: { type: 'STRING' },
          avis_minuts: { type: 'INTEGER' },
          recorda_a: { type: 'STRING', description: 'Per a tasques: AAAA-MM-DDTHH:MM' },
          repeticio: { type: 'STRING', enum: ['cap', 'diaria', 'setmanal', 'mensual', 'anual'] },
          repeteix_fins: { type: 'STRING', description: 'AAAA-MM-DD' },
          tota_la_serie: { type: 'BOOLEAN' }
        },
        // Gemini de vegades s'oblida dels camps opcionals (p. ex. el dia): aquests sempre hi han de ser.
        required: ['tipus', 'ref', 'titol', 'inici', 'fi'],
        propertyOrdering: ['tipus', 'ref', 'titol', 'inici', 'fi', 'tot_el_dia', 'lloc', 'notes', 'avis_minuts', 'recorda_a', 'repeticio', 'repeteix_fins', 'tota_la_serie']
      }
    },
    resposta: { type: 'STRING', description: "Missatge de WhatsApp per a l'usuari" }
  },
  required: ['peticio', 'accions', 'resposta']
};

function aten_(parts, u) {
  const cal = calendari_(u);
  const ara = new Date();
  const ctx = context_(cal, ara);
  const historial = JSON.parse(estat_(u, 'HISTORIAL') || '[]');

  const sistema = [
    'Ets el secretari personal ' + (u.nom ? 'de ' + u.nom : "de l'usuari") + ' i hi parles per WhatsApp. Respon en la seva llengua (normalment català), amb missatges curts i clars. Pots fer servir *negreta* i emojis amb mesura.',
    'Ara és ' + diaLlarg_(ara) + ' a les ' + fmt_(ara, 'HH:mm') + ' (' + TZ + ').',
    '',
    'Gestiones el seu Google Calendar amb aquestes accions:',
    '- crear_cita: tot el que passa un dia concret (reunions, metge, viatges, sopars…). Si no diu hora, és de tot el dia.',
    "- crear_tasca: coses per fer sense hora fixa («he de trucar a…», «comprar…»). «inici» = el dia que toca (si no ho diu, avui). Si vol que l'hi recordis a una hora («recorda'm a les 5 que…»), posa recorda_a.",
    '- modificar, esborrar, fet (tasca acabada): indica la ref (E1, T2…) de les llistes de sota.',
    '- A cada acció omple SEMPRE tipus, ref, titol, inici i fi (cadena buida "" si no cal). Per a crear_cita, «inici» amb el dia (i l\'hora) és obligatori.',
    '',
    'Regles:',
    '- Calcula les dates relatives («demà», «dijous que ve», «d\'aquí a 15 dies») a partir d\'avui. Hores ambigües: «a les 5» de la tarda si és més lògic (17:00).',
    '- Si no diu quant dura una cita, no posis «fi» (serà 1 hora).',
    '- avis_minuts només si demana un avís diferent del normal (' + AVIS_PER_DEFECTE + ' min abans). -1 = sense avís. Per a «avisa\'m el dia abans», 1440.',
    '- Repeticions («cada dilluns», «cada mes») amb repeticio i, si ho diu, repeteix_fins.',
    "- Si falta una dada imprescindible (p. ex. el dia d'una cita), no creïs res i pregunta-ho.",
    '- Esborra només si ho demana clarament. Si no és clar a quina cita es refereix, pregunta-ho.',
    "- Les preguntes («què tinc demà?», «quan és el dentista?») les respons amb l'agenda de sota, sense accions. Només veus els propers " + DIES_AGENDA + ' dies.',
    '- Si una cita nova se solapa amb una altra, apunta-la igualment però avisa-ho.',
    "- A «resposta», confirma el que has fet amb el dia i l'hora (p. ex. «✅ Apuntat: *Dentista*, dv 17/10 a les 10:00. T'avisaré 30 min abans.»). No diguis que has fet res que no sigui a «accions».",
    "- Si la conversa recent és buida, és la primera vegada que t'escriu: saluda'l pel nom i explica en dues línies què pots fer (apuntar cites i tasques al seu calendari, recordar-les-hi i fer-li un resum cada matí).",
    '',
    'AGENDA (propers ' + DIES_AGENDA + ' dies):',
    ctx.agenda.length ? ctx.agenda.join('\n') : '(buida)',
    '',
    'TASQUES PENDENTS:',
    ctx.tasques.length ? ctx.tasques.join('\n') : '(cap)',
    '',
    'CONVERSA RECENT:',
    historial.length ? historial.map(function (h) { return 'Usuari: ' + h.u + '\nTu: ' + h.r; }).join('\n') : '(cap)'
  ].join('\n');

  const diuQueHoHaFet = function (r) {
    return !(r.accions || []).length && /apunt|anotat|afegit|creat|agendat|canviat|mogut|passat|esborrat|anul·lat|✅/i.test(r.resposta || '');
  };
  let res = gemini_(sistema, [{ role: 'user', parts: parts }]);
  // De vegades Gemini diu «Apuntat» però no posa cap acció: l'hi tornem a demanar.
  if (diuQueHoHaFet(res)) {
    registre_('Resposta sense accions, ho torno a demanar: ' + res.resposta);
    res = gemini_(sistema, [
      { role: 'user', parts: parts },
      { role: 'model', parts: [{ text: JSON.stringify(res) }] },
      { role: 'user', parts: [{ text: "(Avís del sistema: has respost que ho has fet, però «accions» és buit i, per tant, no s'ha apuntat res al calendari. Torna a respondre posant a «accions» tot el que cal fer. Si de debò no cal fer res, no diguis que ho has fet.)" }] }
    ]);
  }
  // Si a alguna acció li falta una dada (p. ex. el dia), li demanem a Gemini que la corregeixi.
  const problemes = problemesAccions_(res.accions, ctx.refs);
  if (problemes.length) {
    registre_('Accions incompletes, ho torno a demanar: ' + JSON.stringify(res.accions) + ' → ' + problemes.join('; '));
    res = gemini_(sistema, [
      { role: 'user', parts: parts },
      { role: 'model', parts: [{ text: JSON.stringify(res) }] },
      { role: 'user', parts: [{ text: '(Avís del sistema: no s\'ha pogut fer cap acció perquè ' + problemes.join('; ') + '. Torna a respondre amb les accions completes. Si et falta informació, pregunta-la a «resposta» i deixa «accions» buit.)' }] }
    ]);
  }
  registre_((u.nom || u.numero) + ' → ' + (res.peticio || '') + ' | accions: ' + JSON.stringify(res.accions || []));
  const errors = [];
  (res.accions || []).forEach(function (a) {
    try {
      executa_(a, cal, ctx.refs);
    } catch (err) {
      errors.push('⚠️ No he pogut fer «' + (a.titol || a.ref || a.tipus) + '»: ' + (err && err.message ? err.message : err));
    }
  });
  if (diuQueHoHaFet(res)) errors.push("⚠️ Compte: no he pogut apuntar res al calendari. Torna-m'ho a dir, si us plau.");
  // Si alguna cosa ha fallat, no comencem dient «Apuntat».
  const fet = (res.accions || []).length > errors.length;
  const resposta = (errors.length && !fet ? errors : [res.resposta || 'Fet.'].concat(errors)).join('\n\n');

  historial.push({ u: String(res.peticio || '').slice(0, 300), r: resposta.slice(0, 500) });
  desaEstat_(u, 'HISTORIAL', JSON.stringify(historial.slice(-MAX_HISTORIAL)));
  return resposta;
}

/** Comprova que les accions tenen les dades necessàries abans de fer-les. */
function problemesAccions_(accions, refs) {
  const problemes = [];
  (accions || []).forEach(function (a, i) {
    const nom = 'l\'acció ' + (i + 1) + ' (' + a.tipus + ')';
    if (a.tipus === 'crear_cita') {
      if (!a.titol) problemes.push(nom + ' no té «titol»');
      if (!a.inici) problemes.push(nom + ' no té «inici» (el dia i l\'hora)');
      else { try { data_(a.inici); } catch (err) { problemes.push(nom + ' té un «inici» no vàlid: ' + a.inici + ' (format AAAA-MM-DDTHH:MM)'); } }
    } else if (a.tipus === 'crear_tasca') {
      if (!a.titol) problemes.push(nom + ' no té «titol»');
    } else if (!refs[a.ref]) {
      problemes.push(nom + ' té una «ref» que no és a les llistes: «' + (a.ref || '') + '»');
    }
  });
  return problemes;
}

function context_(cal, ara) {
  const refs = {};
  const agenda = [];
  const tasques = [];
  const avui = iniciDia_(ara);
  const events = cal.getEvents(new Date(avui.getTime() - 60 * 864e5), new Date(avui.getTime() + (DIES_AGENDA + 1) * 864e5));
  events.forEach(function (ev) {
    const titol = ev.getTitle();
    if (titol.indexOf(FETA) === 0) return;
    if (titol.indexOf(TASCA) === 0) {
      const r = 'T' + (tasques.length + 1);
      refs[r] = ev;
      const recorda = ev.getTag('recorda_a');
      tasques.push(r + ' | ' + titol.slice(TASCA.length) + ' | per al ' + diaCurt_(ev.getAllDayStartDate()) + (recorda ? ' | recordatori ' + recorda.replace('T', ' ') : ''));
      return;
    }
    if (ev.getEndTime() <= avui) return;
    const r = 'E' + (agenda.length + 1);
    refs[r] = ev;
    agenda.push(r + ' | ' + quan_(ev) + ' | ' + titol + (ev.getLocation() ? ' | ' + ev.getLocation() : '') + (ev.isRecurringEvent() ? ' | (es repeteix)' : ''));
  });
  return { refs: refs, agenda: agenda, tasques: tasques };
}

function executa_(a, cal, refs) {
  const opcions = {};
  if (a.lloc) opcions.location = a.lloc;
  if (a.notes) opcions.description = a.notes;

  if (a.tipus === 'crear_cita') {
    if (!a.titol || !a.inici) throw new Error('falta el títol o el dia');
    const rec = recurrencia_(a);
    let ev;
    if (a.tot_el_dia || esDia_(a.inici)) {
      const dia = data_(a.inici.slice(0, 10));
      if (rec) ev = cal.createAllDayEventSeries(a.titol, dia, rec, opcions);
      else if (a.fi && a.fi.slice(0, 10) > a.inici.slice(0, 10)) ev = cal.createAllDayEvent(a.titol, dia, new Date(data_(a.fi.slice(0, 10)).getTime() + 864e5), opcions);
      else ev = cal.createAllDayEvent(a.titol, dia, opcions);
    } else {
      const ini = data_(a.inici);
      const fi = a.fi && !esDia_(a.fi) ? data_(a.fi) : new Date(ini.getTime() + 3600e3);
      ev = rec ? cal.createEventSeries(a.titol, ini, fi, rec, opcions) : cal.createEvent(a.titol, ini, fi, opcions);
    }
    if (a.avis_minuts != null && a.avis_minuts !== AVIS_PER_DEFECTE) ev.setTag('avis', String(a.avis_minuts));
    return;
  }

  if (a.tipus === 'crear_tasca') {
    if (!a.titol) throw new Error('falta què has de fer');
    const dia = a.inici ? data_(a.inici.slice(0, 10)) : iniciDia_(new Date());
    const ev = cal.createAllDayEvent(TASCA + a.titol, dia, opcions);
    if (a.recorda_a) ev.setTag('recorda_a', data_(a.recorda_a) && a.recorda_a.slice(0, 16));
    return;
  }

  const ev = refs[a.ref];
  if (!ev) throw new Error("no trobo aquesta cita o tasca a l'agenda");

  if (a.tipus === 'esborrar') {
    if (a.tota_la_serie && ev.isRecurringEvent()) ev.getEventSeries().deleteEventSeries();
    else ev.deleteEvent();
  } else if (a.tipus === 'fet') {
    ev.setTitle(FETA + ev.getTitle().replace(TASCA, ''));
  } else if (a.tipus === 'modificar') {
    const esTasca = ev.getTitle().indexOf(TASCA) === 0;
    if (a.titol) ev.setTitle((esTasca ? TASCA : '') + a.titol);
    if (a.inici) {
      if (ev.isAllDayEvent()) {
        ev.setAllDayDate(data_(a.inici.slice(0, 10)));
      } else {
        // Si només diu el dia, mantenim l'hora.
        const ini = data_(esDia_(a.inici) ? a.inici + 'T' + fmt_(ev.getStartTime(), 'HH:mm') : a.inici);
        const fi = a.fi && !esDia_(a.fi) ? data_(a.fi) : new Date(ini.getTime() + (ev.getEndTime() - ev.getStartTime()));
        ev.setTime(ini, fi);
      }
    } else if (a.fi && !ev.isAllDayEvent() && !esDia_(a.fi)) {
      ev.setTime(ev.getStartTime(), data_(a.fi));
    }
    if (a.lloc) ev.setLocation(a.lloc);
    if (a.notes) ev.setDescription(a.notes);
    if (a.avis_minuts != null) ev.setTag('avis', String(a.avis_minuts));
    if (a.recorda_a) ev.setTag('recorda_a', data_(a.recorda_a) && a.recorda_a.slice(0, 16));
  }
}

function recurrencia_(a) {
  if (!a.repeticio || a.repeticio === 'cap') return null;
  const rec = CalendarApp.newRecurrence();
  let r;
  if (a.repeticio === 'diaria') r = rec.addDailyRule();
  else if (a.repeticio === 'setmanal') r = rec.addWeeklyRule();
  else if (a.repeticio === 'mensual') r = rec.addMonthlyRule();
  else r = rec.addYearlyRule();
  if (a.repeteix_fins) r.until(new Date(data_(a.repeteix_fins.slice(0, 10)).getTime() + 864e5 - 1));
  return rec;
}

function gemini_(sistema, contents) {
  const clau = prop_('GEMINI_KEY');
  let darrer = '';
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const r = UrlFetchApp.fetch(GEMINI_URL + GEMINI_MODELS[i] + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': clau },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: contents,
        generationConfig: { responseMimeType: 'application/json', responseSchema: ESQUEMA, temperature: 0.2 }
      })
    });
    const codi = r.getResponseCode();
    if (codi === 200) {
      const cand = (JSON.parse(r.getContentText()).candidates || [])[0];
      const text = ((cand && cand.content && cand.content.parts) || [])
        .filter(function (p) { return p.text && !p.thought; })
        .map(function (p) { return p.text; })
        .join('');
      if (text) return JSON.parse(text);
      darrer = 'resposta buida';
      continue;
    }
    darrer = codi + ' ' + r.getContentText().slice(0, 200);
    if (codi === 400 || codi === 401 || codi === 403) break; // Clau o petició incorrecta: no cal provar més models
  }
  throw new Error('Gemini no respon (' + darrer + ')');
}

// ── Recordatoris i resums (activadors de temps) ─────────────────────────────

/** Fa una feina per a cada persona del full, sense que l'error d'una aturi les altres. */
function perACadaUsuari_(feina) {
  usuaris_().forEach(function (u) {
    try { feina(u); } catch (err) { console.error((u.nom || u.numero) + ': ' + (err && err.message ? err.message : err)); }
  });
}

/** S'executa cada 5 minuts: avisos de cites i recordatoris de tasques. */
function revisaRecordatoris() {
  perACadaUsuari_(revisaRecordatorisDe_);
}

function revisaRecordatorisDe_(u) {
  const cal = calendari_(u);
  const ara = new Date();
  const enviats = JSON.parse(estat_(u, 'ENVIATS') || '{}');
  const avisos = [];

  cal.getEvents(ara, new Date(ara.getTime() + 2 * 864e5)).forEach(function (ev) {
    if (ev.isAllDayEvent() || ev.getTitle().indexOf(FETA) === 0) return;
    const tag = ev.getTag('avis');
    const minuts = tag == null || tag === '' ? AVIS_PER_DEFECTE : Number(tag);
    if (!(minuts >= 0)) return;
    const ini = ev.getStartTime();
    if (ini.getTime() - minuts * 60000 > ara.getTime() || ini.getTime() < ara.getTime() - 5 * 60000) return;
    const clau = ev.getId() + '@' + ini.getTime();
    if (enviats[clau]) return;
    enviats[clau] = ara.getTime();
    const falta = Math.max(0, Math.round((ini - ara) / 60000));
    avisos.push('⏰ *' + ev.getTitle() + '* ' + (falta === 0 ? 'ara' : "d'aquí a " + durada_(falta)) + ' (' + quan_(ev) + ')' + (ev.getLocation() ? '\n📍 ' + ev.getLocation() : ''));
  });

  const avui = iniciDia_(ara);
  cal.getEvents(new Date(avui.getTime() - 60 * 864e5), new Date(avui.getTime() + 2 * 864e5)).forEach(function (ev) {
    if (ev.getTitle().indexOf(TASCA) !== 0) return;
    const recorda = ev.getTag('recorda_a');
    if (!recorda || data_(recorda) > ara) return;
    const clau = ev.getId() + '@' + recorda;
    if (enviats[clau]) return;
    enviats[clau] = ara.getTime();
    avisos.push('🔔 Recorda: *' + ev.getTitle().slice(TASCA.length) + '*');
  });

  // Oblida els avisos de fa més de 3 dies.
  Object.keys(enviats).forEach(function (k) { if (ara.getTime() - enviats[k] > 3 * 864e5) delete enviats[k]; });
  desaEstat_(u, 'ENVIATS', JSON.stringify(enviats));
  if (avisos.length) envia_(avisos.join('\n\n'), u);
}

/** Cada matí: l'agenda del dia i les tasques pendents. */
function resumDelMati() {
  perACadaUsuari_(function (u) {
    const cal = calendari_(u);
    const ara = new Date();
    const avui = iniciDia_(ara);
    const cites = llistaCites_(cal, avui);
    const tasques = tasquesPendents_(cal, avui);
    const linies = ['☀️ Bon dia' + (u.nom ? ', ' + u.nom : '') + '! Avui és ' + diaLlarg_(ara) + '.'];
    linies.push(cites.length ? '\n📅 *Agenda*\n' + cites.join('\n') : '\n📅 Avui no tens cap cita.');
    if (tasques.length) linies.push('\n☐ *Per fer*\n' + tasques.join('\n'));
    envia_(linies.join('\n'), u);
  });
}

/** Cada vespre: què ha quedat pendent i què hi ha demà. */
function resumDelVespre() {
  perACadaUsuari_(function (u) {
    const cal = calendari_(u);
    const dema = new Date(iniciDia_(new Date()).getTime() + 864e5 + 3600e3);
    const cites = llistaCites_(cal, iniciDia_(dema));
    const tasques = tasquesPendents_(cal, iniciDia_(new Date()));
    if (!cites.length && !tasques.length) return;
    const linies = ['🌙 Repàs del dia'];
    if (tasques.length) linies.push('\n☐ *Encara pendent*\n' + tasques.join('\n') + "\n(Digue'm «fet» quan acabis alguna cosa, o a quin dia la passo.)");
    if (cites.length) linies.push('\n📅 *Demà, ' + diaLlarg_(dema) + '*\n' + cites.join('\n'));
    envia_(linies.join('\n'), u);
  });
}

function llistaCites_(cal, dia) {
  return cal.getEventsForDay(dia)
    .filter(function (ev) { return ev.getTitle().indexOf(TASCA) !== 0 && ev.getTitle().indexOf(FETA) !== 0; })
    .map(function (ev) {
      return '• ' + (ev.isAllDayEvent() ? 'Tot el dia' : fmt_(ev.getStartTime(), 'HH:mm')) + ' — ' + ev.getTitle() + (ev.getLocation() ? ' (' + ev.getLocation() + ')' : '');
    });
}

function tasquesPendents_(cal, finsA) {
  return cal.getEvents(new Date(finsA.getTime() - 60 * 864e5), new Date(finsA.getTime() + 864e5))
    .filter(function (ev) { return ev.getTitle().indexOf(TASCA) === 0; })
    .map(function (ev) {
      const dia = ev.getAllDayStartDate();
      return '• ' + ev.getTitle().slice(TASCA.length) + (dia < finsA ? ' _(des del ' + diaCurt_(dia) + ')_' : '');
    });
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

/**
 * Envia un missatge. WhatsApp només deixa escriure lliurement fins a 24 h després del teu
 * darrer missatge; fora d'aquesta finestra cal una plantilla aprovada. Si tot falla, per correu.
 */
function envia_(text, u) {
  const obert = Date.now() - Number(estat_(u, 'DARRER_MISSATGE') || 0) < 23.5 * 3600e3;
  let error = '';
  if (obert) {
    try { return wa_({ type: 'text', text: { body: text.slice(0, 4000), preview_url: false } }, u.numero); } catch (err) { error = err.message; }
  }
  if (PLANTILLA) {
    try {
      // Els paràmetres de les plantilles no poden tenir salts de línia.
      const pla = text.replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').slice(0, 900);
      return wa_({ type: 'template', template: { name: PLANTILLA, language: { code: PLANTILLA_IDIOMA }, components: [{ type: 'body', parameters: [{ type: 'text', text: pla }] }] } }, u.numero);
    } catch (err) { error = err.message; }
  }
  console.error('No s\'ha pogut enviar per WhatsApp: ' + error);
  try {
    MailApp.sendEmail(u.correu || Session.getEffectiveUser().getEmail(), NOM + (u.nom ? ' (' + u.nom + ')' : '') + ': ' + text.split('\n')[0].replace(/\*/g, '').slice(0, 80),
      text.replace(/\*/g, '') + "\n\n(T'ho envio per correu perquè WhatsApp ha fallat: " + error + ')');
  } catch (err) { console.error(err); }
}

function wa_(missatge, numero) {
  const r = UrlFetchApp.fetch(GRAPH + prop_('WA_PHONE_ID') + '/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('WA_TOKEN') },
    muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ messaging_product: 'whatsapp', to: digits_(numero) }, missatge))
  });
  if (r.getResponseCode() >= 300) {
    let detall = r.getContentText();
    try { const e = JSON.parse(detall).error; detall = e.message + ' (codi ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ')'; } catch (err) { /* deixem el text tal qual */ }
    throw new Error('WhatsApp ' + r.getResponseCode() + ': ' + String(detall).slice(0, 400));
  }
}

function marcaLlegit_(id) {
  try {
    UrlFetchApp.fetch(GRAPH + prop_('WA_PHONE_ID') + '/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + prop_('WA_TOKEN') },
      muteHttpExceptions: true,
      payload: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: id })
    });
  } catch (err) { /* no és important */ }
}

/** Baixa una nota de veu, foto o PDF de WhatsApp i la prepara per a Gemini. */
function media_(id) {
  const auth = { Authorization: 'Bearer ' + prop_('WA_TOKEN') };
  const info = JSON.parse(UrlFetchApp.fetch(GRAPH + id, { headers: auth }).getContentText());
  const blob = UrlFetchApp.fetch(info.url, { headers: auth }).getBlob();
  return { inlineData: { mimeType: String(info.mime_type || blob.getContentType()).split(';')[0].trim(), data: Utilities.base64Encode(blob.getBytes()) } };
}

// ── Instal·lació i proves ───────────────────────────────────────────────────

/** Executa-ho un cop després d'omplir les propietats: crea els activadors i t'envia un missatge de prova. */
function configura() {
  ['GEMINI_KEY', 'WA_TOKEN', 'WA_PHONE_ID', 'WA_VERIFY', 'MY_NUMBER'].forEach(function (k) { prop_(k); });
  const full = fullUsuaris_();
  console.log('Full de persones: ' + full.getUrl());
  comprovaUsuaris();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['revisaRecordatoris', 'resumDelMati', 'resumDelVespre'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('revisaRecordatoris').timeBased().everyMinutes(5).create();
  if (HORA_RESUM_MATI != null) ScriptApp.newTrigger('resumDelMati').timeBased().atHour(HORA_RESUM_MATI).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  if (HORA_RESUM_VESPRE != null) ScriptApp.newTrigger('resumDelVespre').timeBased().atHour(HORA_RESUM_VESPRE).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  envia_("👋 Hola! Soc el teu secretari. Escriu-me o envia'm una nota de veu amb el que t'he d'apuntar, per exemple:\n" +
    '• «Dentista dijous a les 10»\n• «Recorda\'m a les 6 que truqui a la gestoria»\n• «Què tinc demà?»\n• «Passa el dentista a divendres»', propietari_());
  console.log('Fet. Si no t\'ha arribat el WhatsApp, mira el correu i el registre d\'execucions.');
}

/**
 * Si l'script no rep els teus missatges (a Execucions no surt cap doPost), executa-ho:
 * connecta el compte de WhatsApp amb l'app perquè Meta li enviï els missatges.
 */
function connectaWhatsApp() {
  const token = prop_('WA_TOKEN');
  const llegeix = function (cami) {
    return JSON.parse(UrlFetchApp.fetch(GRAPH + cami, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getContentText());
  };
  const comptes = [];
  const info = llegeix('debug_token?input_token=' + encodeURIComponent(token));
  ((info.data && info.data.granular_scopes) || []).forEach(function (s) {
    if (s.scope === 'whatsapp_business_management') (s.target_ids || []).forEach(function (id) { comptes.push(id); });
  });
  // WA_ACCOUNT_ID pot ser l'identificador del compte de WhatsApp o el del portfoli empresarial.
  const id = digits_(prop_('WA_ACCOUNT_ID', true));
  if (!comptes.length && id) {
    ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'].forEach(function (llista) {
      (llegeix(id + '/' + llista).data || []).forEach(function (w) { comptes.push(w.id); });
    });
    if (!comptes.length) comptes.push(id);
  }
  if (!comptes.length) throw new Error("Afegeix la propietat WA_ACCOUNT_ID amb l'identificador del compte de WhatsApp Business o del portfoli");
  comptes.forEach(function (compte) {
    const r = UrlFetchApp.fetch(GRAPH + compte + '/subscribed_apps', { method: 'post', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    console.log('Compte de WhatsApp ' + compte + ': ' + r.getResponseCode() + ' ' + r.getContentText());
  });
}

/** Busca el número del secretari al compte WA_ACCOUNT_ID i en desa l'identificador a WA_PHONE_ID. */
function trobaNumero() {
  const r = UrlFetchApp.fetch(GRAPH + digits_(prop_('WA_ACCOUNT_ID')) + '/phone_numbers', { headers: { Authorization: 'Bearer ' + prop_('WA_TOKEN') }, muteHttpExceptions: true });
  const numeros = JSON.parse(r.getContentText()).data || [];
  if (!numeros.length) throw new Error('No trobo cap número: ' + r.getContentText().slice(0, 300));
  numeros.forEach(function (n) { console.log(n.display_phone_number + ' (' + (n.verified_name || '') + ') → identificador ' + n.id); });
  // Si hi ha un número real a més del de prova, fem servir el real.
  const tria = numeros.filter(function (n) { return !/^\+?1 ?555/.test(n.display_phone_number || ''); })[0] || numeros[0];
  PropertiesService.getScriptProperties().setProperty('WA_PHONE_ID', tria.id);
  console.log('Desat a WA_PHONE_ID: ' + tria.id + ' (' + tria.display_phone_number + ')');
}

/** Per a un número de telèfon real (no el de prova): l'activa a l'API de WhatsApp. */
function registraNumero() {
  const props = PropertiesService.getScriptProperties();
  const pin = prop_('WA_PIN', true) || String(Math.floor(100000 + Math.random() * 900000));
  const r = UrlFetchApp.fetch(GRAPH + prop_('WA_PHONE_ID') + '/register', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('WA_TOKEN') },
    muteHttpExceptions: true,
    payload: JSON.stringify({ messaging_product: 'whatsapp', pin: pin })
  });
  console.log(r.getResponseCode() + ' ' + r.getContentText());
  if (r.getResponseCode() < 300) {
    props.setProperty('WA_PIN', pin);
    console.log('Número activat. PIN de verificació en dos passos (desat a WA_PIN): ' + pin);
  }
}

/** Prova el cervell sense WhatsApp: mira la resposta al registre. */
function provaSecretari() {
  console.log(aten_([{ text: 'Què tinc aquesta setmana?' }], propietari_()));
}

/**
 * Diagnòstic d'una persona del full (canvia el nom a NOM_PROVA): crea una cita de prova directament
 * al seu calendari i després li demana una cita al secretari, sense WhatsApp. Mira el registre.
 */
function provaPersona() {
  const NOM_PROVA = 'Maria';
  try {
    const u = usuaris_().filter(function (x) { return x.nom.toLowerCase().indexOf(NOM_PROVA.toLowerCase()) >= 0; })[0];
    if (!u) throw new Error('No trobo ' + NOM_PROVA + ' al full');
    registre_('Persona: ' + JSON.stringify(u));
    const cal = calendari_(u);
    registre_('Calendari: «' + cal.getName() + '» (' + cal.getId() + ')');
    registre_('Context que veu el secretari:\n' + JSON.stringify(context_(cal, new Date()), null, 1).slice(0, 3000));
    registre_('Resposta del secretari: ' + aten_([{ text: 'Apunta una prova del secretari demà a les 12' }], u));
  } catch (err) {
    registre_('ERROR: ' + (err && err.stack ? err.stack : err));
  }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Diagnòstic del secretari', REGISTRE.join('\n\n'));
  console.log("Diagnòstic enviat per correu.");
}

// ── Persones ────────────────────────────────────────────────────────────────

/** Obre (o crea el primer cop) el full on es donen d'alta les persones que poden fer servir el secretari. */
function fullUsuaris_() {
  const props = PropertiesService.getScriptProperties();
  const id = prop_('USERS_SHEET_ID', true);
  if (id) return SpreadsheetApp.openById(id);
  const full = SpreadsheetApp.create(FULL_USUARIS);
  const pestanya = full.getSheets()[0];
  pestanya.setName('Persones');
  pestanya.getRange(1, 1, 1, 5).setValues([['Nom', 'Mòbil', 'Calendari', 'Correu', 'Actiu']]).setFontWeight('bold');
  pestanya.getRange(2, 1, 1, 5).setValues([['Jo', '+' + digits_(prop_('MY_NUMBER')), prop_('CALENDAR_ID', true) || Session.getEffectiveUser().getEmail(), Session.getEffectiveUser().getEmail(), 'Sí']]);
  pestanya.getRange('B1').setNote('Amb el prefix del país: +34 600 11 12 22');
  pestanya.getRange('C1').setNote("El correu de Google de la persona (ha de compartir-te el seu calendari amb permís per «Fer canvis als esdeveniments»). Si ho deixes buit, se li crea un calendari nou al teu compte.");
  pestanya.getRange('D1').setNote('(Opcional) On li arriben els avisos si WhatsApp falla.');
  pestanya.getRange('E1').setNote('«No» per donar-la de baixa sense esborrar la fila.');
  pestanya.setFrozenRows(1);
  pestanya.autoResizeColumns(1, 5);
  props.setProperty('USERS_SHEET_ID', full.getId());
  return full;
}

/** Les persones donades d'alta. Sense full, només tu (MY_NUMBER). */
function usuaris_() {
  const cache = CacheService.getScriptCache();
  const desat = cache.get('usuaris');
  if (desat) return JSON.parse(desat);
  let llista = [];
  if (prop_('USERS_SHEET_ID', true)) {
    const files = fullUsuaris_().getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < files.length; i++) {
      const f = files[i];
      const numero = numeroMobil_(f[1]);
      if (!numero || /^no$/i.test(String(f[4]).trim())) continue;
      llista.push({ nom: String(f[0]).trim(), numero: numero, calId: String(f[2]).trim(), correu: String(f[3]).trim(), fila: i + 1 });
    }
  }
  if (!llista.length) llista = [{ nom: '', numero: digits_(prop_('MY_NUMBER')), calId: prop_('CALENDAR_ID', true) || '', correu: '' }];
  cache.put('usuaris', JSON.stringify(llista), 300);
  return llista;
}

function usuari_(numero) {
  return usuaris_().filter(function (u) { return u.numero === digits_(numero); })[0] || null;
}

/** Tu: la persona de MY_NUMBER (per al missatge de benvinguda i les proves). */
function propietari_() {
  return usuari_(prop_('MY_NUMBER')) || { nom: '', numero: digits_(prop_('MY_NUMBER')), calId: prop_('CALENDAR_ID', true) || '', correu: '' };
}

/** Comprova que el secretari pot obrir el calendari de cada persona del full. Mira el registre. */
function comprovaUsuaris() {
  CacheService.getScriptCache().remove('usuaris');
  usuaris_().forEach(function (u) {
    try {
      console.log('✅ ' + (u.nom || u.numero) + ' (+' + u.numero + '): calendari «' + calendari_(u).getName() + '»');
    } catch (err) {
      console.error('❌ ' + (u.nom || u.numero) + ' (+' + u.numero + '): ' + err.message);
    }
  });
}

/** Mòbil sense «+» ni espais. Si no porta prefix (9 xifres), hi posa el d'Espanya. */
function numeroMobil_(v) {
  let n = digits_(v);
  if (n.indexOf('00') === 0) n = n.slice(2);
  if (n.length === 9) n = '34' + n;
  return n.length >= 10 ? n : '';
}

/** Dades de cada persona (historial, darrer missatge, avisos enviats). */
function estat_(u, clau) {
  const props = PropertiesService.getScriptProperties();
  const v = props.getProperty(clau + '_' + u.numero);
  // Abans només hi havia una persona i les dades no portaven número.
  if (v == null && u.numero === digits_(prop_('MY_NUMBER', true))) return props.getProperty(clau);
  return v;
}

function desaEstat_(u, clau, valor) {
  PropertiesService.getScriptProperties().setProperty(clau + '_' + u.numero, valor);
}

// ── Utilitats ───────────────────────────────────────────────────────────────

function prop_(clau, opcional) {
  const v = PropertiesService.getScriptProperties().getProperty(clau);
  if (!v && !opcional) throw new Error('Falta la propietat de l\'script ' + clau + ' (Configuració del projecte > Propietats de l\'script)');
  return v;
}

function calendari_(u) {
  u = u || propietari_();
  if (!u.calId) {
    if (u.numero === digits_(prop_('MY_NUMBER'))) return CalendarApp.getDefaultCalendar();
    // Persona sense calendari al full: li'n creem un i l'apuntem al full.
    const nou = CalendarApp.createCalendar(NOM + ' · ' + (u.nom || '+' + u.numero), { timeZone: TZ });
    u.calId = nou.getId();
    if (u.fila) fullUsuaris_().getSheets()[0].getRange(u.fila, 3).setValue(u.calId);
    CacheService.getScriptCache().remove('usuaris');
    return nou;
  }
  const cal = CalendarApp.getCalendarById(u.calId);
  if (!cal) throw new Error("no puc obrir el calendari «" + u.calId + "». Cal que te'l comparteixi amb permís per «Fer canvis als esdeveniments».");
  return cal;
}

function text_(s) { return ContentService.createTextOutput(String(s || '')); }
function digits_(s) { return String(s || '').replace(/\D/g, ''); }
function fmt_(d, patro) { return Utilities.formatDate(d, TZ, patro); }
function esDia_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }

function data_(s) {
  s = String(s || '').trim();
  const d = esDia_(s) ? Utilities.parseDate(s, TZ, 'yyyy-MM-dd')
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? Utilities.parseDate(s.slice(0, 16), TZ, "yyyy-MM-dd'T'HH:mm") : null;
  if (!d || isNaN(d)) throw new Error('data no vàlida: ' + s);
  return d;
}

function iniciDia_(d) { return data_(fmt_(d, 'yyyy-MM-dd')); }
function diaSetmana_(d) { return Number(fmt_(d, 'u')) % 7; } // 1 = dilluns … 7 = diumenge
function diaCurt_(d) { return DIES_CURTS[diaSetmana_(d)] + ' ' + fmt_(d, 'd/M'); }
function diaLlarg_(d) { return DIES[diaSetmana_(d)] + ' ' + fmt_(d, 'd') + ' ' + MESOS[Number(fmt_(d, 'M')) - 1] + ' de ' + fmt_(d, 'yyyy'); }

function quan_(ev) {
  if (ev.isAllDayEvent()) return diaCurt_(ev.getAllDayStartDate()) + ' (tot el dia)';
  return diaCurt_(ev.getStartTime()) + ' ' + fmt_(ev.getStartTime(), 'HH:mm') + '–' + fmt_(ev.getEndTime(), 'HH:mm');
}

function durada_(minuts) {
  if (minuts < 60) return minuts + ' min';
  if (minuts < 1440) return Math.floor(minuts / 60) + ' h' + (minuts % 60 ? ' ' + (minuts % 60) + ' min' : '');
  const dies = Math.round(minuts / 1440);
  return dies === 1 ? '1 dia' : dies + ' dies';
}
