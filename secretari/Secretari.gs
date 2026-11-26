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
// Valors inicials de cada persona: cadascú els pot canviar per WhatsApp («envia'm el resum a les 7»).
const AVIS_PER_DEFECTE = 30;      // Minuts abans de cada cita que t'avisa (-1 = mai)
const HORA_RESUM_MATI = 8;        // Resum de l'agenda del dia (null = cap)
const HORA_RESUM_VESPRE = 21;     // Tasques pendents i agenda de demà (null = cap)
const DIES_AGENDA = 30;           // Quants dies endavant de l'agenda veu el secretari
const PLANTILLA = 'recordatori';  // Plantilla de WhatsApp per escriure't fora de la finestra de 24 h
const PLANTILLA_IDIOMA = 'ca';
const NOM = 'Secretari';
// Els 11 colors de Google Calendar (nom → codi de Google). Cada persona pot tenir fins a 11 grups, un per color.
const COLORS = { vermell: '11', rosa: '4', taronja: '6', groc: '5', 'verd clar': '2', verd: '10', turquesa: '7', blau: '9', lavanda: '1', lila: '3', gris: '8' };
// Grups amb què comença cada persona. Cadascú en pot crear més o canviar-ne el color per WhatsApp.
const GRUPS_PER_DEFECTE = { esportec: 'blau', personal: 'verd' };

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
    avisaAdmin_('Error rebent un missatge de WhatsApp', err);
  }
  return text_('ok');
}

function processa_(msg) {
  // WhatsApp torna a enviar el missatge si no rep resposta prou ràpid: només el tractem un cop.
  if (!primerCop_(msg.id)) return;
  const u = usuari_(msg.from);
  if (!u) {
    console.warn('Missatge d\'un número no donat d\'alta: ' + msg.from);
    avisaAdmin_('Un número que no és al full ha escrit al secretari: +' + msg.from,
      "Si és algú de l'equip, afegeix-lo al full «Secretari – Usuaris».");
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
      parts.push({ text: (msg.image.caption || '') + '\n(Imatge adjunta: si hi ha dates, cites o coses per fer, apunta-les. Si demana posar-la de foto del secretari, és foto_perfil.)' }, media_(msg.image.id));
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
    avisaAdmin_('Error atenent un missatge de ' + nomDe_(u), err);
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
          tipus: { type: 'STRING', enum: ['crear_cita', 'crear_tasca', 'modificar', 'esborrar', 'fet', 'definir_grup', 'esborrar_grup', 'canviar_ajustos', 'foto_perfil'] },
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
          tota_la_serie: { type: 'BOOLEAN' },
          categoria: { type: 'STRING', description: 'Grup de la cita o tasca (li dona color), o «cap»' },
          color: { type: 'STRING', enum: Object.keys(COLORS), description: 'Per a definir_grup' },
          hora_mati: { type: 'STRING', description: 'Per a canviar_ajustos: "HH:MM" o "no"' },
          hora_vespre: { type: 'STRING', description: 'Per a canviar_ajustos: "HH:MM" o "no"' },
          nom_secretari: { type: 'STRING', description: 'Per a canviar_ajustos: com es diu el secretari' },
          genere_secretari: { type: 'STRING', enum: ['noi', 'noia'], description: 'Per a canviar_ajustos: si el secretari és un noi o una noia' },
          amb: { type: 'ARRAY', items: { type: 'STRING' }, description: "Noms de persones de l'equip amb qui es comparteix la cita" }
        },
        // Gemini de vegades s'oblida dels camps opcionals (p. ex. el dia): aquests sempre hi han de ser.
        required: ['tipus', 'ref', 'titol', 'inici', 'fi', 'recorda_a', 'categoria'],
        propertyOrdering: ['tipus', 'ref', 'titol', 'inici', 'fi', 'recorda_a', 'categoria', 'color', 'tot_el_dia', 'lloc', 'notes', 'avis_minuts', 'repeticio', 'repeteix_fins', 'tota_la_serie']
      }
    },
    resposta: { type: 'STRING', description: "Missatge de WhatsApp per a l'usuari" }
  },
  required: ['peticio', 'accions', 'resposta']
};

function aten_(parts, u) {
  const cal = calendari_(u);
  const ara = new Date();
  const ctx = context_(cal, ara, grups_(u));
  const historial = JSON.parse(estat_(u, 'HISTORIAL') || '[]');
  const imatge = (parts.filter(function (p) { return p.inlineData && /^image\//.test(p.inlineData.mimeType); })[0] || {}).inlineData;
  const grups = grups_(u);
  const aj = ajustos_(u);
  const esAdmin = esPropietari_(u);

  const sistema = [
    persona_(aj) + ' ' + de_(u.nom || 'usuari') + ' i hi parles per WhatsApp. Respon en la seva llengua (normalment català), amb missatges curts i clars. Pots fer servir *negreta* i emojis amb mesura.' + personaGenere_(aj),
    'Ara és ' + diaLlarg_(ara) + ' a les ' + fmt_(ara, 'HH:mm') + ' (' + TZ + ').',
    '',
    'Gestiones el seu Google Calendar amb aquestes accions:',
    '- crear_cita: tot el que passa un dia concret (reunions, metge, viatges, sopars…). Si no diu hora, és de tot el dia.',
    "- crear_tasca: coses per fer sense hora fixa («he de trucar a…», «comprar…»). «inici» = el dia que toca (si no ho diu, avui). Si vol que l'hi recordis a una hora («recorda'm a les 5 que…»), posa recorda_a.",
    '- modificar, esborrar, fet (tasca acabada): indica la ref (E1, T2…) de les llistes de sota.',
    '- Grups: cada cita o tasca pot tenir un grup, que li dona color al calendari. Grups d\'aquesta persona (nom → color): ' + llistaGrups_(grups) + '. Posa «categoria» = nom del grup quan l\'usuari ho digui («és d\'Esportec», «és personal») o quan sigui evident (p. ex. feina, clients, reunions d\'equip → esportec; metge, família, amics → personal). Si no és clar, «cap». Per canviar el grup d\'una cita existent, modificar amb la nova categoria.',
    "- Equip (persones amb qui pot compartir cites): " + (equip_(u).map(nomEquip_).join(', ') || '(ningú)') + ". Compartir una CITA amb algú de l'equip (posar el seu nom a «amb») NOMÉS quan l'usuari l'anomena expressament com a participant de la cita («reunió amb l'Ignasi», «apunta-ho també a l'Ignasi»): s'apuntarà també al seu calendari i se li enviarà un avís. No ho dedueixis mai pel context, i les tasques («trucar a l'Ignasi», «parlar amb la Maria») no es comparteixen mai: «amb» buit. Si no és clar si la vol compartir, pregunta-ho. Només noms d'aquesta llista. Per afegir algú a una cita que ja existeix: modificar amb «amb». Si la modifiques o l'esborres, també canvia per a les altres persones.",
    '- Per crear un grup o canviar-ne el color («crea el grup Mar Aventura en taronja», «posa Esportec en vermell»): definir_grup amb titol = nom del grup i color. Per esborrar-lo: esborrar_grup amb titol. Colors possibles: ' + Object.keys(COLORS).join(', ') + '. Cada grup té un color diferent, així que com a màxim hi pot haver ' + Object.keys(COLORS).length + ' grups. Si demana un color que ja és d\'un altre grup, o ja no en queden de lliures, digues-li quins colors queden lliures. Si demana els grups que té, digues-los amb el color.',
    '- A cada acció omple SEMPRE tipus, ref, titol, inici, fi, recorda_a i categoria (cadena buida "" si no cal, «cap» a categoria). Per a crear_cita, «inici» amb el dia (i l\'hora) és obligatori.',
    "- Recordatoris: «recorda'm X a les 17h», «avisa'm demà a les 9 que…», «el dia 20 recorda'm que el 25 he de pagar» → crear_tasca amb recorda_a = el dia i l'hora exactes de l'avís (AAAA-MM-DDTHH:MM) i inici = el dia de la tasca. Per a una cita amb hora, l'avís previ va a avis_minuts (p. ex. «avisa'm una hora abans» → 60).",
    '',
    'Regles:',
    '- Calcula les dates relatives («demà», «dijous que ve», «d\'aquí a 15 dies») a partir d\'avui. Hores ambigües: «a les 5» de la tarda si és més lògic (17:00).',
    '- Si no diu quant dura una cita, no posis «fi» (serà 1 hora).',
    '- avis_minuts només si demana un avís diferent del normal (' + aj.avis + ' min abans). -1 = sense avís. Per a «avisa\'m el dia abans», 1440.',
    '- Ajustos d\'aquesta persona: resum del matí ' + (aj.mati === 'no' ? 'desactivat' : 'a les ' + aj.mati) + '; repàs del vespre ' + (aj.vespre === 'no' ? 'desactivat' : 'a les ' + aj.vespre) + '; avís de les cites ' + (aj.avis < 0 ? 'desactivat' : aj.avis + ' min abans') + '; el teu nom: ' + (aj.nom || '(cap)') + '; ets ' + (aj.genere === 'noia' ? 'una noia' : aj.genere === 'noi' ? 'un noi' : 'el secretari, sense gènere definit') + '. Si els vol canviar («envia\'m el resum a les 7», «no vull el repàs del vespre», «avisa\'m sempre 1 hora abans», «a partir d\'ara et dius Marta», «vull que siguis un noi»): canviar_ajustos amb NOMÉS els camps que canvien: hora_mati i hora_vespre ("HH:MM" o "no"), avis_minuts (minuts, -1 = cap), nom_secretari, genere_secretari (noi o noia). Si pregunta els seus ajustos, digues-los.',
    esAdmin
      ? '- Foto del secretari: si envia una imatge i demana posar-la de foto del secretari (o de perfil), foto_perfil. Recorda-li que la foto la veu tothom.'
      : '- Foto del secretari: és la mateixa per a tothom i només la pot canviar l\'administrador. Si la vol canviar, digues-li que ho demani a qui gestiona el secretari.',
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
  const problemes = problemesAccions_(res.accions, ctx.refs, grups, { esAdmin: esAdmin, teImatge: !!imatge, u: u });
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
  // Primer els canvis de grups, perquè una cita nova ja pugui fer servir un grup creat en el mateix missatge.
  const ordre = function (a) { return /_grup$/.test(a.tipus) ? 0 : 1; };
  const infos = [];
  (res.accions || []).slice().sort(function (a, b) { return ordre(a) - ordre(b); }).forEach(function (a) {
    try {
      const info = executa_(a, cal, ctx.refs, u, grups, imatge);
      if (info) infos.push(info);
    } catch (err) {
      errors.push('⚠️ No he pogut fer «' + (a.titol || a.ref || a.tipus) + '»: ' + (err && err.message ? err.message : err));
    }
  });
  if (diuQueHoHaFet(res)) errors.push("⚠️ Compte: no he pogut apuntar res al calendari. Torna-m'ho a dir, si us plau.");
  // Si alguna cosa ha fallat, no comencem dient «Apuntat».
  if (errors.length) avisaAdmin_('No s\'ha pogut fer el que demanava ' + nomDe_(u), errors.join('\n') + '\n\nMissatge: ' + (res.peticio || ''));
  const fet = (res.accions || []).length > errors.length;
  const resposta = (errors.length && !fet ? errors : [res.resposta || 'Fet.'].concat(infos, errors)).join('\n\n');

  historial.push({ u: String(res.peticio || '').slice(0, 300), r: resposta.slice(0, 500) });
  desaEstat_(u, 'HISTORIAL', JSON.stringify(historial.slice(-MAX_HISTORIAL)));
  return resposta;
}

/** Comprova que les accions tenen les dades necessàries abans de fer-les. */
function problemesAccions_(accions, refs, grups, opcions) {
  opcions = opcions || {};
  const problemes = [];
  const nousGrups = (accions || []).filter(function (a) { return a.tipus === 'definir_grup'; }).map(function (a) { return nomGrup_(a.titol); });
  (accions || []).forEach(function (a, i) {
    const nom = 'l\'acció ' + (i + 1) + ' (' + a.tipus + ')';
    const cat = nomGrup_(a.categoria);
    if (cat && cat !== 'cap' && !(grups || {})[cat] && nousGrups.indexOf(cat) < 0) {
      problemes.push(nom + ' fa servir el grup «' + a.categoria + '», que no existeix (grups: ' + Object.keys(grups || {}).join(', ') + '). Fes servir un d\'aquests, «cap», o crea\'l amb definir_grup si l\'usuari ho demana');
    }
    if ((a.amb || []).length && a.tipus !== 'crear_cita' && a.tipus !== 'modificar') problemes.push(nom + ': només les cites es poden compartir; deixa «amb» buit');
    (a.amb || []).forEach(function (n) {
      if (!membre_(n, opcions.u)) problemes.push(nom + ': «' + n + '» no és de l\'equip (equip: ' + equip_(opcions.u).map(nomEquip_).join(', ') + ')');
    });
    if (a.tipus === 'canviar_ajustos') {
      ['hora_mati', 'hora_vespre'].forEach(function (k) {
        if (a[k] && !/^(no|\d{1,2}(:\d{2})?)$/i.test(String(a[k]).trim())) problemes.push(nom + ' té «' + k + '» no vàlid: ' + a[k] + ' (cal "HH:MM" o "no")');
      });
    } else if (a.tipus === 'foto_perfil') {
      if (!opcions.esAdmin) problemes.push(nom + ': només l\'administrador pot canviar la foto del secretari. No facis l\'acció i explica-l\'hi');
      else if (!opcions.teImatge) problemes.push(nom + ': no hi ha cap imatge en aquest missatge. Demana-li que enviï la foto amb el text «posa-la de foto»');
    } else if (a.tipus === 'definir_grup') {
      if (!nomGrup_(a.titol)) problemes.push(nom + ' no té el nom del grup a «titol»');
      if (!COLORS[String(a.color || '').toLowerCase()]) problemes.push(nom + ' no té un «color» vàlid (' + Object.keys(COLORS).join(', ') + ')');
    } else if (a.tipus === 'esborrar_grup') {
      if (!(grups || {})[nomGrup_(a.titol)]) problemes.push(nom + ': no hi ha cap grup «' + (a.titol || '') + '»');
    } else if (a.tipus === 'crear_cita') {
      if (!a.titol) problemes.push(nom + ' no té «titol»');
      if (!a.inici) problemes.push(nom + ' no té «inici» (el dia i l\'hora)');
      else { try { data_(a.inici); } catch (err) { problemes.push(nom + ' té un «inici» no vàlid: ' + a.inici + ' (format AAAA-MM-DDTHH:MM)'); } }
    } else if (a.tipus === 'crear_tasca') {
      if (!a.titol) problemes.push(nom + ' no té «titol»');
      if (a.recorda_a && esDia_(a.recorda_a)) problemes.push(nom + ' té «recorda_a» sense hora: ' + a.recorda_a + ' (cal AAAA-MM-DDTHH:MM)');
      else if (a.recorda_a) { try { data_(a.recorda_a); } catch (err) { problemes.push(nom + ' té un «recorda_a» no vàlid: ' + a.recorda_a + ' (format AAAA-MM-DDTHH:MM)'); } }
    } else if (!refs[a.ref]) {
      problemes.push(nom + ' té una «ref» que no és a les llistes: «' + (a.ref || '') + '»');
    }
  });
  return problemes;
}

function context_(cal, ara, grups) {
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
    const cat = categoria_(ev, grups);
    const amb = ev.getTag('amb');
    agenda.push(r + ' | ' + quan_(ev) + ' | ' + titol + (ev.getLocation() ? ' | ' + ev.getLocation() : '') + (cat ? ' | ' + cat : '') + (amb ? ' | compartida amb ' + amb : '') + (ev.isRecurringEvent() ? ' | (es repeteix)' : ''));
  });
  return { refs: refs, agenda: agenda, tasques: tasques };
}

function executa_(a, cal, refs, u, grups, imatge) {
  grups = grups || grups_(u);
  if (a.tipus === 'canviar_ajustos') {
    const aj = ajustos_(u);
    if (a.hora_mati) aj.mati = hora_(a.hora_mati);
    if (a.hora_vespre) aj.vespre = hora_(a.hora_vespre);
    if (a.avis_minuts != null && a.avis_minuts !== '') aj.avis = Number(a.avis_minuts);
    if (a.nom_secretari) aj.nom = String(a.nom_secretari).trim().slice(0, 40);
    if (a.genere_secretari) aj.genere = genere_(a.genere_secretari);
    desaEstat_(u, 'AJUSTOS', JSON.stringify(aj));
    return;
  }
  if (a.tipus === 'foto_perfil') {
    if (!esPropietari_(u)) throw new Error("només l'administrador pot canviar la foto del secretari");
    if (!imatge) throw new Error('no hi ha cap imatge en aquest missatge');
    canviaFotoPerfil_(imatge.data, imatge.mimeType);
    return;
  }
  if (a.tipus === 'definir_grup') {
    const nom = nomGrup_(a.titol);
    const color = String(a.color || '').toLowerCase();
    if (!nom || !COLORS[color]) throw new Error('falta el nom del grup o el color');
    const altre = Object.keys(grups).filter(function (k) { return k !== nom && grups[k] === color; })[0];
    if (altre) throw new Error('el color ' + color + ' ja és del grup «' + altre + '». Colors lliures: ' + (colorsLliures_(grups).join(', ') || 'cap'));
    const abans = grups[nom];
    grups[nom] = color;
    desaEstat_(u, 'GRUPS', JSON.stringify(grups));
    // Si el grup canvia de color, també les cites i tasques que ja en són.
    if (abans && abans !== color) {
      Object.keys(refs).forEach(function (r) {
        if (String(refs[r].getColor()) === COLORS[abans]) refs[r].setColor(COLORS[color]);
      });
    }
    return;
  }
  if (a.tipus === 'esborrar_grup') {
    const nom = nomGrup_(a.titol);
    if (!grups[nom]) throw new Error('no hi ha cap grup «' + a.titol + '»');
    delete grups[nom];
    desaEstat_(u, 'GRUPS', JSON.stringify(grups));
    return;
  }

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
    if (a.avis_minuts != null && a.avis_minuts !== ajustos_(u).avis) ev.setTag('avis', String(a.avis_minuts));
    posaColor_(ev, a.categoria, grups);
    return (a.amb || []).length ? compartir_(ev, a.amb, u) : '';
  }

  if (a.tipus === 'crear_tasca') {
    if (!a.titol) throw new Error('falta què has de fer');
    const dia = a.inici ? data_(a.inici.slice(0, 10)) : iniciDia_(new Date());
    const ev = cal.createAllDayEvent(TASCA + a.titol, dia, opcions);
    if (a.recorda_a) ev.setTag('recorda_a', data_(a.recorda_a) && a.recorda_a.slice(0, 16));
    posaColor_(ev, a.categoria, grups);
    return;
  }

  const ev = refs[a.ref];
  if (!ev) throw new Error("no trobo aquesta cita o tasca a l'agenda");

  if (a.tipus === 'esborrar') {
    const copies = trobaCopies_(ev, u);
    const titol = ev.getTitle(), quan = quan_(ev);
    const creador = ev.getTag('creador');
    if (a.tota_la_serie && ev.isRecurringEvent()) ev.getEventSeries().deleteEventSeries();
    else ev.deleteEvent();
    if (!copies.length) return '';
    if (creador && creador !== u.numero) {
      // No l'ha creada ella: només la treu de la seva agenda i n'avisa qui la va crear.
      copies.filter(function (c) { return c.m.numero === creador; }).forEach(function (c) {
        envia_('ℹ️ *' + nomEquip_(u) + "* ha tret de la seva agenda la cita compartida *" + titol + '* (' + quan + ').', c.m);
      });
      return '';
    }
    copies.forEach(function (c) {
      c.ev.deleteEvent();
      envia_('❌ *' + nomEquip_(u) + '* ha anul·lat la cita compartida *' + titol + '* (' + quan + ").", c.m);
    });
    return "👥 També l'he treta de l'agenda " + de_(llistaNoms_(copies.map(function (c) { return nomEquip_(c.m); }))) + ' i ' + (copies.length > 1 ? 'els' : 'li') + ' he enviat un avís.';
  } else if (a.tipus === 'fet') {
    ev.setTitle(FETA + ev.getTitle().replace(TASCA, ''));
  } else if (a.tipus === 'modificar') {
    const copies = trobaCopies_(ev, u);
    modificaComu_(ev, a);
    posaColor_(ev, a.categoria, grups);
    if (a.avis_minuts != null) ev.setTag('avis', String(a.avis_minuts));
    if (a.recorda_a) ev.setTag('recorda_a', data_(a.recorda_a) && a.recorda_a.slice(0, 16));
    const infos = [];
    // Si és compartida i canvia el títol, l'hora, el lloc o les notes, també per a les altres persones.
    if (copies.length && (a.titol || a.inici || a.fi || a.lloc || a.notes)) {
      copies.forEach(function (c) {
        modificaComu_(c.ev, a);
        envia_('✏️ *' + nomEquip_(u) + '* ha canviat la cita compartida: *' + c.ev.getTitle() + '*, ara ' + quan_(c.ev) + (c.ev.getLocation() ? ' 📍 ' + c.ev.getLocation() : '') + '.', c.m);
      });
      infos.push("👥 També l'he canviada a l'agenda " + de_(llistaNoms_(copies.map(function (c) { return nomEquip_(c.m); }))) + ' i ' + (copies.length > 1 ? 'els' : 'li') + ' he enviat un avís.');
    }
    if ((a.amb || []).length) infos.push(compartir_(ev, a.amb, u));
    return infos.filter(Boolean).join('\n');
  }
}

/** Canvis d'una cita que també s'apliquen a les còpies compartides: títol, dia i hora, lloc i notes. */
function modificaComu_(ev, a) {
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
}

// ── Cites compartides amb l'equip ───────────────────────────────────────────

/** Les altres persones del full. */
function equip_(u) {
  return usuaris_().filter(function (m) { return !u || m.numero !== u.numero; });
}

/** El nom d'una persona per a l'equip (si al full posa «Jo», el treu del correu: oriol@… → Oriol). */
function nomEquip_(m) {
  if (m.nom && !/^jo$/i.test(m.nom.trim())) return m.nom;
  const c = String(m.correu || '').split('@')[0];
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : '+' + m.numero;
}

function membre_(nom, u) {
  const n = String(nom || '').trim().toLowerCase().replace(/^(l'|la |el |en |na )/, '');
  return equip_(u).filter(function (m) {
    const nm = nomEquip_(m).toLowerCase();
    return nm === n || nm.split(' ')[0] === n.split(' ')[0];
  })[0] || null;
}

function llistaNoms_(noms) {
  return noms.length > 1 ? noms.slice(0, -1).join(', ') + ' i ' + noms[noms.length - 1] : noms[0];
}

/** Copia una cita al calendari d'altres persones de l'equip i les avisa. Totes les còpies porten la mateixa marca. */
function compartir_(ev, noms, u) {
  const id = ev.getTag('compartida') || Utilities.getUuid();
  ev.setTag('compartida', id);
  if (!ev.getTag('creador')) ev.setTag('creador', u.numero);
  const ja = String(ev.getTag('amb') || '').split(',').filter(Boolean);
  const nous = [];
  noms.forEach(function (n) {
    const m = membre_(n, u);
    if (!m) throw new Error('no trobo «' + n + "» a l'equip");
    if (ja.indexOf(nomEquip_(m)) >= 0 || nous.indexOf(nomEquip_(m)) >= 0) return;
    const op = { location: ev.getLocation(), description: [ev.getDescription(), 'Apuntada per ' + nomEquip_(u) + ' (' + NOM + ')'].filter(Boolean).join('\n') };
    const cal = calendari_(m);
    const copia = ev.isAllDayEvent()
      ? cal.createAllDayEvent(ev.getTitle(), ev.getAllDayStartDate(), ev.getAllDayEndDate(), op)
      : cal.createEvent(ev.getTitle(), ev.getStartTime(), ev.getEndTime(), op);
    copia.setTag('compartida', id);
    copia.setTag('creador', ev.getTag('creador'));
    copia.setTag('amb', nomEquip_(u));
    envia_('📅 *' + nomEquip_(u) + "* t'ha apuntat a l'agenda: *" + ev.getTitle() + '*, ' + quan_(copia) + (ev.getLocation() ? ' 📍 ' + ev.getLocation() : '') + '.', m);
    nous.push(nomEquip_(m));
  });
  ev.setTag('amb', ja.concat(nous).join(','));
  return nous.length ? "👥 També ho he apuntat a l'agenda " + de_(llistaNoms_(nous)) + ' i ' + (nous.length > 1 ? 'els' : 'li') + ' he enviat un avís.' : '';
}

/** Les còpies d'una cita compartida que hi ha als calendaris de les altres persones. */
function trobaCopies_(ev, u) {
  const id = ev.getTag('compartida');
  if (!id) return [];
  const ini = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
  const copies = [];
  equip_(u).forEach(function (m) {
    try {
      calendari_(m).getEvents(new Date(ini.getTime() - 864e5), new Date(ini.getTime() + 2 * 864e5)).forEach(function (e) {
        if (e.getTag('compartida') === id) copies.push({ m: m, ev: e });
      });
    } catch (err) { console.warn('No puc mirar el calendari de ' + nomDe_(m) + ': ' + err); }
  });
  return copies;
}

/** Els grups d'una persona (nom → color). Al principi, els de GRUPS_PER_DEFECTE. */
function grups_(u) {
  const desat = u && estat_(u, 'GRUPS');
  return desat ? JSON.parse(desat) : JSON.parse(JSON.stringify(GRUPS_PER_DEFECTE));
}

function nomGrup_(s) { return String(s || '').trim().toLowerCase(); }

function colorsLliures_(grups) {
  const usats = Object.keys(grups).map(function (k) { return grups[k]; });
  return Object.keys(COLORS).filter(function (c) { return usats.indexOf(c) < 0; });
}

function llistaGrups_(grups) {
  const noms = Object.keys(grups);
  return (noms.length ? noms.map(function (k) { return k + ' → ' + grups[k]; }).join(', ') : '(cap)') +
    ' (colors lliures: ' + (colorsLliures_(grups).join(', ') || 'cap') + ')';
}

/** Pinta la cita del color del seu grup (esportec, personal…). */
function posaColor_(ev, categoria, grups) {
  const color = COLORS[(grups || {})[nomGrup_(categoria)]];
  if (color) ev.setColor(color);
}

/** El grup d'una cita segons el seu color, per mostrar-lo a l'agenda. */
function categoria_(ev, grups) {
  const color = String(ev.getColor());
  return Object.keys(grups || {}).filter(function (k) { return COLORS[grups[k]] === color; })[0] || '';
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
    try { feina(u); } catch (err) {
      console.error(nomDe_(u) + ': ' + (err && err.message ? err.message : err));
      avisaAdmin_('Error en els avisos automàtics de ' + nomDe_(u), err);
    }
  });
}

/** S'executa cada 5 minuts: avisos de cites, recordatoris de tasques i resums del matí i del vespre. */
function revisaRecordatoris() {
  perACadaUsuari_(revisaRecordatorisDe_);
  perACadaUsuari_(revisaResumsDe_);
}

/** Envia el resum del matí i el repàs del vespre a l'hora que ha triat cada persona (un cop al dia). */
function revisaResumsDe_(u) {
  const aj = ajustos_(u);
  const ara = new Date();
  const avui = fmt_(ara, 'yyyy-MM-dd');
  [['mati', resumMatiDe_], ['vespre', resumVespreDe_]].forEach(function (r) {
    if (!aj[r[0]] || aj[r[0]] === 'no') return;
    const moment = data_(avui + 'T' + aj[r[0]]).getTime();
    if (ara.getTime() < moment - 150000 || ara.getTime() > moment + 3600e3) return;
    if (estat_(u, 'RESUM_' + r[0]) === avui) return;
    desaEstat_(u, 'RESUM_' + r[0], avui);
    r[1](u);
  });
}

function revisaRecordatorisDe_(u) {
  const cal = calendari_(u);
  const ara = new Date();
  const enviats = JSON.parse(estat_(u, 'ENVIATS') || '{}');
  const avisos = [];

  // Els avisos es revisen cada 5 minuts: enviem els que toquen d'aquí a 2,5 min com a molt,
  // perquè arribin a l'hora (±2,5 min) i no fins a 5 minuts tard.
  const llindar = ara.getTime() + 150000;
  cal.getEvents(ara, new Date(ara.getTime() + 8 * 864e5)).forEach(function (ev) {
    if (ev.isAllDayEvent() || ev.getTitle().indexOf(FETA) === 0) return;
    const tag = ev.getTag('avis');
    const minuts = tag == null || tag === '' ? ajustos_(u).avis : Number(tag);
    if (!(minuts >= 0)) return;
    const ini = ev.getStartTime();
    if (ini.getTime() - minuts * 60000 > llindar || ini.getTime() < ara.getTime() - 5 * 60000) return;
    const clau = ev.getId() + '@' + ini.getTime();
    if (enviats[clau]) return;
    enviats[clau] = ara.getTime();
    const falta = Math.max(0, Math.round((ini - ara) / 60000));
    avisos.push('⏰ *' + ev.getTitle() + '* ' + (falta === 0 ? 'ara' : "d'aquí a " + durada_(falta)) + ' (' + quan_(ev) + ')' + (ev.getLocation() ? '\n📍 ' + ev.getLocation() : ''));
  });

  const avui = iniciDia_(ara);
  // Tasques amb recordatori: també les dels propers dies (el recordatori pot ser abans del dia de la tasca).
  cal.getEvents(new Date(avui.getTime() - 60 * 864e5), new Date(avui.getTime() + 60 * 864e5)).forEach(function (ev) {
    if (ev.getTitle().indexOf(TASCA) !== 0) return;
    const recorda = ev.getTag('recorda_a');
    if (!recorda || data_(recorda).getTime() > llindar) return;
    const clau = ev.getId() + '@' + recorda;
    if (enviats[clau]) return;
    enviats[clau] = ara.getTime();
    const dia = ev.getAllDayStartDate();
    avisos.push('🔔 Recorda: *' + ev.getTitle().slice(TASCA.length) + '*' + (dia > avui ? ' (per al ' + diaCurt_(dia) + ')' : ''));
  });

  // Oblida els avisos de fa més de 3 dies.
  Object.keys(enviats).forEach(function (k) { if (ara.getTime() - enviats[k] > 3 * 864e5) delete enviats[k]; });
  desaEstat_(u, 'ENVIATS', JSON.stringify(enviats));
  if (avisos.length) envia_(avisos.join('\n\n'), u);
}

/** Ho criden els activadors antics de les 8 i les 21 h: ara cada persona té la seva hora. */
function resumDelMati() { perACadaUsuari_(revisaResumsDe_); }
function resumDelVespre() { perACadaUsuari_(revisaResumsDe_); }

/** El resum del matí: l'agenda del dia i les tasques pendents. */
function resumMatiDe_(u) {
  const cal = calendari_(u);
  const ara = new Date();
  const avui = iniciDia_(ara);
  const cites = llistaCites_(cal, avui);
  const tasques = tasquesPendents_(cal, avui);
  const linies = ['☀️ Bon dia' + (u.nom ? ', ' + u.nom : '') + '! Avui és ' + diaLlarg_(ara) + '.'];
  linies.push(cites.length ? '\n📅 *Agenda*\n' + cites.join('\n') : '\n📅 Avui no tens cap cita.');
  if (tasques.length) linies.push('\n☐ *Per fer*\n' + tasques.join('\n'));
  envia_(linies.join('\n'), u);
}

/** El repàs del vespre: què ha quedat pendent i què hi ha demà. */
function resumVespreDe_(u) {
  const cal = calendari_(u);
  const dema = new Date(iniciDia_(new Date()).getTime() + 864e5 + 3600e3);
  const cites = llistaCites_(cal, iniciDia_(dema));
  const tasques = tasquesPendents_(cal, iniciDia_(new Date()));
  if (!cites.length && !tasques.length) return;
  const linies = ['🌙 Repàs del dia'];
  if (tasques.length) linies.push('\n☐ *Encara pendent*\n' + tasques.join('\n') + "\n(Digue'm «fet» quan acabis alguna cosa, o a quin dia la passo.)");
  if (cites.length) linies.push('\n📅 *Demà, ' + diaLlarg_(dema) + '*\n' + cites.join('\n'));
  envia_(linies.join('\n'), u);
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
function envia_(text, u, silenciós) {
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
  if (silenciós) return;
  avisaAdmin_("No s'ha pogut enviar un WhatsApp a " + nomDe_(u) + " (li ha arribat per correu)", error);
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
  // Un sol activador cada 5 minuts: avisos i també els resums, a l'hora que ha triat cada persona.
  ScriptApp.newTrigger('revisaRecordatoris').timeBased().everyMinutes(5).create();
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
    registre_('Context que veu el secretari:\n' + JSON.stringify(context_(cal, new Date(), grups_(u)), null, 1).slice(0, 3000));
    registre_('Resposta del secretari: ' + aten_([{ text: 'Apunta una prova del secretari demà a les 12' }], u));
  } catch (err) {
    registre_('ERROR: ' + (err && err.stack ? err.stack : err));
  }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Diagnòstic del secretari', REGISTRE.join('\n\n'));
  console.log("Diagnòstic enviat per correu.");
}

/** Prova l'avís d'errors: t'ha d'arribar un correu i un WhatsApp. */
function provaAvisErrors() {
  avisaAdmin_('Prova de l\'avís d\'errors', "Això és una prova: si t'arriba, els avisos funcionen. (" + fmt_(new Date(), 'HH:mm:ss') + ')');
}

/** Envia ara mateix el resum del matí a tu, per veure com queda. */
function provaResum() {
  resumMatiDe_(propietari_());
}

// ── Avisos a l'administrador ────────────────────────────────────────────────

/**
 * Quan alguna cosa falla, t'avisa per correu i per WhatsApp. El mateix error només s'avisa un cop
 * cada 6 hores, perquè no t'omplin de missatges.
 */
function avisaAdmin_(titol, detall) {
  try {
    const text = String(detall && detall.message ? detall.message : detall || '');
    const clau = 'alerta_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, titol + '|' + text.slice(0, 120))).slice(0, 22);
    const cache = CacheService.getScriptCache();
    if (cache.get(clau)) return;
    cache.put(clau, '1', 6 * 3600);
    const pista = pista_(titol + ' ' + text);
    const cos = titol + '\n\n' + text + (pista ? '\n\n💡 ' + pista : '') + '\n\n(' + fmt_(new Date(), 'dd/MM HH:mm') + ')';
    MailApp.sendEmail(prop_('ADMIN_EMAIL', true) || Session.getEffectiveUser().getEmail(), '⚠️ ' + NOM + ': ' + titol.slice(0, 100), cos);
    envia_('⚠️ *Avís del secretari*\n' + cos, propietari_(), true);
  } catch (err) {
    console.error("No s'ha pogut avisar l'administrador: " + err);
  }
}

/** Una pista de com arreglar els errors més habituals. */
function pista_(text) {
  if (/131030|allowed list|not in allowed/i.test(text)) return "Amb el número de prova, aquest mòbil ha d'estar a la llista de destinataris de Meta (Paso 1. Pruébalo > Destinatario > Administrar lista).";
  if (/132001|template name does not exist|plantilla/i.test(text)) return "La plantilla «recordatori» no existeix o encara no està aprovada (WhatsApp Manager > Plantillas).";
  if (/131047|re-engagement|24 hours/i.test(text)) return "Fa més de 24 h que aquesta persona no escriu al secretari i la plantilla no ha funcionat.";
  if (/\b190\b|\b401\b|access token|OAuthException/i.test(text)) return 'El token de WhatsApp (WA_TOKEN) no és vàlid o ha caducat: genera\'n un de nou a l\'usuari del sistema de Meta.';
  if (/Gemini/i.test(text) && /429|quota|RESOURCE_EXHAUSTED/i.test(text)) return "S'ha acabat la quota gratuïta de Gemini d'avui. Torna a funcionar demà, o activa la facturació a AI Studio.";
  if (/Gemini/i.test(text)) return 'Gemini no respon. Sol ser temporal; si es repeteix, comprova la clau GEMINI_KEY.';
  if (/calendari|calendar/i.test(text)) return "Comprova que aquesta persona t'hagi compartit el calendari amb permís «Fer canvis als esdeveniments» i executa comprovaUsuaris.";
  return '';
}

// ── Ajustos de cada persona i foto ──────────────────────────────────────────

function hora_(s) {
  s = String(s || '').trim().toLowerCase();
  if (s === 'no') return 'no';
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) throw new Error('hora no vàlida: ' + s);
  return ('0' + m[1]).slice(-2) + ':' + (m[2] || '00');
}

/** Els ajustos d'una persona: hora del resum del matí i del vespre ("HH:MM" o "no"), avís per defecte i nom del secretari. */
function ajustos_(u) {
  const inicials = {
    mati: HORA_RESUM_MATI == null ? 'no' : hora_(HORA_RESUM_MATI),
    vespre: HORA_RESUM_VESPRE == null ? 'no' : hora_(HORA_RESUM_VESPRE),
    avis: AVIS_PER_DEFECTE,
    // El nom i si és noi o noia es poden posar al full (columnes F i G) i la persona els pot canviar per WhatsApp.
    nom: (u && u.secretari) || '',
    genere: genere_(u && u.genereSecretari)
  };
  const desat = u && estat_(u, 'AJUSTOS');
  return Object.assign(inicials, desat ? JSON.parse(desat) : {});
}

/** «noi», «noia» o '' a partir del que hi hagi escrit (noi/home/masculí, noia/dona/femení…). */
function genere_(s) {
  s = String(s || '').trim().toLowerCase();
  if (/^(noia|dona|femen|f$|ella|secretària)/.test(s)) return 'noia';
  if (/^(noi|home|mascul|m$|ell|secretari)/.test(s)) return 'noi';
  return '';
}

/** Com es presenta el secretari: el seu nom i si és noi o noia. */
function persona_(aj) {
  return (aj.nom ? 'Et dius ' + aj.nom + ' i ets ' : 'Ets ') + (aj.genere === 'noia' ? 'la secretària personal' : 'el secretari personal');
}

/** «de Maria» / «d'Ignasi». */
function de_(nom) { return (/^[aeiouàèéíïòóúüh]/i.test(nom) ? "d'" : 'de ') + nom; }

function personaGenere_(aj) {
  if (aj.genere === 'noia') return ' Ets una noia: parla de tu mateixa en femení («estic contenta», «soc la teva secretària»).';
  if (aj.genere === 'noi') return ' Ets un noi: parla de tu mateix en masculí («estic content», «soc el teu secretari»).';
  return '';
}

function esPropietari_(u) { return !!u && u.numero === digits_(prop_('MY_NUMBER')); }
function nomDe_(u) { return u ? (u.nom || '+' + u.numero) : '?'; }

/** Canvia la foto de perfil del número del secretari (la veu tothom). */
function canviaFotoPerfil_(dades, tipus) {
  const token = prop_('WA_TOKEN');
  const bytes = Utilities.base64Decode(dades);
  const app = JSON.parse(UrlFetchApp.fetch(GRAPH + 'debug_token?input_token=' + encodeURIComponent(token), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getContentText());
  const appId = app.data && app.data.app_id;
  if (!appId) throw new Error("no trobo l'app de Meta del token");
  // 1) Pujada en dos passos que demana Meta, 2) foto nova al perfil.
  let r = UrlFetchApp.fetch(GRAPH + appId + '/uploads?file_length=' + bytes.length + '&file_type=' + encodeURIComponent(tipus), { method: 'post', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  const sessio = JSON.parse(r.getContentText()).id;
  if (!sessio) throw new Error('Meta no deixa pujar la foto: ' + r.getContentText().slice(0, 200));
  r = UrlFetchApp.fetch(GRAPH + sessio, { method: 'post', headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, payload: Utilities.newBlob(bytes, tipus), muteHttpExceptions: true });
  const handle = JSON.parse(r.getContentText()).h;
  if (!handle) throw new Error('Meta no ha acceptat la foto: ' + r.getContentText().slice(0, 200));
  r = UrlFetchApp.fetch(GRAPH + prop_('WA_PHONE_ID') + '/whatsapp_business_profile', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle })
  });
  if (r.getResponseCode() >= 300) throw new Error('Meta no ha canviat la foto: ' + r.getContentText().slice(0, 200));
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
  columnesSecretari_(pestanya);
  pestanya.getRange('B1').setNote('Amb el prefix del país: +34 600 11 12 22');
  pestanya.getRange('C1').setNote("El correu de Google de la persona (ha de compartir-te el seu calendari amb permís per «Fer canvis als esdeveniments»). Si ho deixes buit, se li crea un calendari nou al teu compte.");
  pestanya.getRange('D1').setNote('(Opcional) On li arriben els avisos si WhatsApp falla.');
  pestanya.getRange('E1').setNote('«No» per donar-la de baixa sense esborrar la fila.');
  pestanya.setFrozenRows(1);
  pestanya.autoResizeColumns(1, 7);
  props.setProperty('USERS_SHEET_ID', full.getId());
  return full;
}

/** Afegeix al full les columnes F i G (nom del secretari i si és noi o noia), si encara no hi són. */
function columnesSecretari_(pestanya) {
  const cap = pestanya.getRange(1, 6, 1, 2);
  if (String(cap.getValues()[0][0]).trim()) return;
  cap.setValues([['Nom del secretari', 'Noi/Noia']]).setFontWeight('bold');
  pestanya.getRange('F1').setNote("(Opcional) Com es diu el secretari per a aquesta persona, p. ex. «Marta». La persona el pot canviar per WhatsApp.");
  pestanya.getRange('G1').setNote("(Opcional) «noi» o «noia»: si el secretari li parla com un noi o com una noia. La persona ho pot canviar per WhatsApp.");
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
      llista.push({ nom: String(f[0]).trim(), numero: numero, calId: String(f[2]).trim(), correu: String(f[3]).trim(), secretari: String(f[5] || '').trim(), genereSecretari: String(f[6] || '').trim(), fila: i + 1 });
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
  if (prop_('USERS_SHEET_ID', true)) columnesSecretari_(fullUsuaris_().getSheets()[0]);
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
