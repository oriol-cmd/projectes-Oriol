/**
 * Amic invisible: tauler de temes de regal.
 *
 * 1a fase, fins a la data límit: cada persona escriu els seus temes de regal. Els dels
 *    altres encara no es veuen.
 * 2a fase, després de la data límit: els temes queden tancats i tothom veu els de tothom
 *    alhora. Cadascú tria una persona, que serà a qui regala. Ningú sap qui l'ha triat.
 *
 * Com instal·lar-lo (un sol cop, uns 5 minuts):
 * 1. Crea un full de càlcul nou a Google Sheets (p. ex. «Amic invisible»).
 * 2. Extensions > Apps Script. Esborra el que hi hagi a Code.gs i enganxa-hi aquest codi.
 * 3. Fitxer «+» > HTML, posa-li de nom «Index» i enganxa-hi el contingut d'Index.html. Desa.
 * 4. Implementa > Nova implementació > ⚙️ Aplicació web
 *      Executa com a: Jo
 *      Qui hi té accés: Qualsevol
 *    Accepta els permisos.
 * 5. Tria la funció «prepara» i prem Executa. Al full hi apareixen les pestanyes:
 *      Configuració: enllaç de l'aplicació (el que acaba en /exec), títol, família, avís,
 *                    data límit, temes per persona, colors i exemples.
 *      Participants: noms (columna A) i, si vols, telèfons (columna D).
 * 6. Torna a carregar el full i, al menú «Amic invisible», prem «Genera codis i enllaços».
 *    A Participants surt l'enllaç de cadascú i un botó per enviar-li per WhatsApp.
 *
 * Tot el que hi ha a la pestanya Configuració es pot canviar quan vulguis: la pàgina ho
 * agafa al moment, sense tornar a implementar res. (Si canvies la data límit, torna a
 * prémer «Genera codis i enllaços» perquè els missatges de WhatsApp la portin bé.)
 *
 * Si tu també hi participes: no obris la pestanya «Tries» (està amagada).
 */

// Valors inicials. Només s'usen la primera vegada, per omplir les pestanyes del full.
const INICIAL = {
  url: '',
  titol: 'Amic invisible',
  familia: 'Bové Palau',
  avis: 'Pressupost: uns 20 €. Intercanvi el dia de Nadal, a casa dels avis.',
  dataLimit: '07/12/2026 22:00',
  numTemes: 2,
  estil: 'avet',
  exemples: 'Cuina, Japó, Alguna cosa petita',
  participants: ['Anna', 'Bernat', 'Carla', 'David', 'Elena', 'Ferran', 'Gemma', 'Oriol'],
};

const ESTILS = ['avet', 'nit', 'gerd', 'neu'];
const SHEET_CONFIG = 'Configuració';
const SHEET_PARTICIPANTS = 'Participants';
const SHEET_THEMES = 'Temes';
const SHEET_PICKS = 'Tries';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sense 0/O ni 1/I, que es confonen

// Files de la pestanya Configuració: [etiqueta, clau, explicació].
const CONFIG_ROWS = [
  ['Enllaç de l\'aplicació', 'url', 'L\'adreça que acaba en /exec (Implementa > Gestiona les implementacions). Amb ella es fan els enllaços personals.'],
  ['Títol', 'titol', 'Surt a dalt de tot.'],
  ['Família', 'familia', 'Surt sota el títol, amb les inicials. Deixa-ho buit si no en vols.'],
  ['Avís', 'avis', 'Text per a tothom: pressupost, data de l\'intercanvi, lloc… Si és buit, no surt.'],
  ['Data límit', 'dataLimit', 'Fins quan es poden escriure i canviar els temes (dia/mes/any hora:minuts). Després ja es pot triar. Si és buit, es pot triar des del principi.'],
  ['Temes per persona', 'numTemes', '1, 2 o 3.'],
  ['Estil', 'estil', 'avet (verd i vermell), nit (blau i daurat), gerd (granat i taronja) o neu (blau gris i vermell).'],
  ['Exemples', 'exemples', 'Exemples que surten dins dels requadres buits, separats per comes.'],
];

// ---------- Pàgina ----------

function doGet() {
  const cfg = config_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.config = JSON.stringify(publicConfig_(cfg)).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(cfg.titol + (cfg.familia ? ' · ' + cfg.familia : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Amic invisible')
    .addItem('Genera codis i enllaços', 'prepara')
    .addToUi();
}

// ---------- Preparació ----------

// Crea les pestanyes que faltin, dona un codi i un enllaç a cada participant i prepara
// el missatge de WhatsApp de cadascú. Es pot tornar a executar sempre que vulguis:
// qui ja tenia codi el conserva.
function prepara() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cs = sheet_(ss, SHEET_CONFIG, ['Opció', 'Valor', 'Explicació']);
  // Text pla a la columna Valor: així «07/12/2026» és sempre dia/mes/any, sigui quin sigui l'idioma del full.
  cs.getRange(2, 2, 30, 1).setNumberFormat('@');
  const have = rows_(cs).map((r) => String(r[0]).trim().toLowerCase());
  const missing = CONFIG_ROWS.filter((r) => have.indexOf(r[0].toLowerCase()) < 0);
  if (missing.length) {
    const start = cs.getLastRow() + 1;
    cs.getRange(start, 1, missing.length, 3).setValues(missing.map((r) => [r[0], INICIAL[r[1]], r[2]]));
  }

  sheet_(ss, SHEET_THEMES, ['id', 'Nom', 'Tema 1', 'Tema 2', 'Tema 3', 'Actualitzat']);
  sheet_(ss, SHEET_PICKS, ['Per a (xifrat)', 'Triat per (xifrat)', 'Data']).hideSheet();
  return refreshPeople_();
}

const PEOPLE_HEADER = ['Nom', 'Codi', 'Enllaç personal', 'Telèfon (opcional)', 'Envia-li per WhatsApp', 'Pot configurar (Sí/No)'];

// Torna a escriure la pestanya Participants: codis nous per a qui no en té, enllaços i
// botons de WhatsApp. Conserva codis, telèfons i permisos. `edit` permet canviar la llista.
function refreshPeople_(edit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ps = sheet_(ss, SHEET_PARTICIPANTS, PEOPLE_HEADER);
  if (String(ps.getDataRange().getValues()[0][5] || '') === '') ps.getRange(1, 1, 1, 6).setValues([PEOPLE_HEADER]);

  const rows = rows_(ps).filter((r) => String(r[0]).trim());
  let source = rows.length ? rows : INICIAL.participants.map((n) => [n, '', '', '', '', '']);
  if (edit) source = edit(source.map((r) => r.slice(0, 6)));
  const names = source.map((r) => String(r[0]).trim());
  const seen = new Set();
  names.forEach((n) => {
    if (seen.has(n.toLowerCase())) throw new Error('El nom «' + n + '» surt dues vegades a Participants.');
    seen.add(n.toLowerCase());
  });

  const used = new Set(source.map((r) => String(r[1] || '')).filter(Boolean));
  const cfg = config_();
  const url = appUrl_(cfg);

  const out = source.map((r, i) => {
    let code = String(r[1] || '').trim().toUpperCase();
    if (!code) { do { code = newCode_(); } while (used.has(code)); used.add(code); }
    const link = url ? url + '?codi=' + code : '';
    const phone = String(r[3] || '').trim();
    const wa = link ? '=HYPERLINK("' + waUrl_(names[i], phone, link, cfg) + '", "Envia-li ➜")' : '';
    const admin = isYes_(r[5]) ? 'Sí' : '';
    return [names[i], code, link || '(enganxa l\'enllaç de l\'aplicació a Configuració i torna a generar els enllaços)', phone, wa, admin];
  });

  const last = ps.getLastRow();
  if (last > 1) ps.getRange(2, 1, last - 1, 6).setValues(Array.from({ length: last - 1 }, () => ['', '', '', '', '', '']));
  // Text pla, perquè Sheets no converteixi cap codi ni cap telèfon en número o fórmula.
  ps.getRange(2, 2, 60, 1).setNumberFormat('@');
  ps.getRange(2, 4, 60, 1).setNumberFormat('@');
  if (out.length) ps.getRange(2, 1, out.length, 6).setValues(out);
  return out;
}

function appUrl_(cfg) {
  if (cfg.url) return cfg.url;
  try { const u = ScriptApp.getService().getUrl() || ''; if (/\/exec$/.test(u)) return u; } catch (e) { /* sense enllaç */ }
  return '';
}

function waUrl_(name, phone, link, cfg) {
  const digits = String(phone || '').replace(/\D/g, '');
  const to = digits.length === 9 ? '34' + digits : digits; // mòbils d'aquí sense prefix
  return 'https://wa.me/' + to + '?text=' + encodeURIComponent(message_(name, link, cfg));
}

function isYes_(v) {
  return /^(s[ií]|x|yes|1|true|vertader)$/i.test(String(v || '').trim());
}

// Missatge personal de WhatsApp amb l'enllaç de cadascú.
function message_(name, link, cfg) {
  const who = cfg.familia ? 'de la família ' + cfg.familia : '';
  const temes = cfg.numTemes === 1 ? 'el teu tema' : 'els teus ' + cfg.numTemes + ' temes';
  return 'Hola, ' + name + '! 🐌🎁\n\n' +
    'Aquest és el teu enllaç per a l\'amic invisible ' + who + ':\n' + link + '\n\n' +
    'És només teu: no el passis a ningú, que t\'hi podrien fer trampes.' +
    (cfg.dataLimitText ? '\n\nTens fins al ' + cfg.dataLimitText + ' per posar ' + temes + '. Després podràs triar a qui regales.' : '');
}

// Configuració actual, llegida de la pestanya Configuració (o els valors inicials).
function config_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const raw = {};
  rows_(sh).forEach((r) => {
    const row = CONFIG_ROWS.find((c) => c[0].toLowerCase() === String(r[0]).trim().toLowerCase());
    if (row) raw[row[1]] = r[1];
  });
  const get = (k) => (raw[k] === undefined ? INICIAL[k] : raw[k]);
  const n = parseInt(get('numTemes'), 10);
  const estil = String(get('estil') || '').trim().toLowerCase();
  const limit = parseDate_(get('dataLimit'));
  const url = String(get('url') || '').trim().replace(/[?#].*$/, '');
  return {
    url: /^https:\/\/script\.google\.com\/.+\/exec$/.test(url) ? url : '',
    titol: String(get('titol') || '').trim() || 'Amic invisible',
    familia: String(get('familia') || '').trim(),
    avis: String(get('avis') || '').trim(),
    numTemes: n >= 1 && n <= 3 ? n : 2,
    estil: ESTILS.indexOf(estil) >= 0 ? estil : 'avet',
    exemples: String(get('exemples') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3),
    dataLimit: limit ? limit.getTime() : 0,
    dataLimitText: limit ? formatDate_(limit) : '',
  };
}

// El que pot veure tothom (sense l'enllaç de configuració).
function publicConfig_(cfg) {
  const c = Object.assign({}, cfg);
  delete c.url;
  c.appUrl = appUrl_(cfg);
  return c;
}

// Accepta una data de Sheets o un text com «07/12/2026 22:00» (l'hora és opcional: 23:59).
function parseDate_(v) {
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  const m = String(v || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2})[:.h](\d{2}))?/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = m[4] ? new Date(y, m[2] - 1, m[1], m[4], m[5]) : new Date(y, m[2] - 1, m[1], 23, 59);
  return isNaN(d.getTime()) ? null : d;
}

// «dilluns 7 de desembre a les 22:00»
function formatDate_(d) {
  const tz = Session.getScriptTimeZone();
  const p = Utilities.formatDate(d, tz, 'u|d|M|HH:mm').split('|');
  const days = ['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'];
  const months = ['de gener', 'de febrer', 'de març', 'd\'abril', 'de maig', 'de juny', 'de juliol', 'd\'agost', 'de setembre', 'd\'octubre', 'de novembre', 'de desembre'];
  return days[Number(p[0]) - 1] + ' ' + Number(p[1]) + ' ' + months[Number(p[2]) - 1] + ' a les ' + p[3];
}

function now_() {
  return new Date();
}

// Abans de la data límit s'escriuen temes; després es tria.
function phase_(cfg) {
  return !cfg.dataLimit || now_().getTime() >= cfg.dataLimit ? 'tria' : 'temes';
}

// ---------- Funcions que crida la pàgina ----------

function entra(code) {
  return state_(who_(code));
}

// Desa els temes de la persona (els crea o els canvia). Només fins a la data límit.
function desa(code, theme) {
  return withLock_(() => {
    const me = who_(code);
    const cfg = config_();
    if (phase_(cfg) !== 'temes') return state_(me, 'Ja ha passat la data límit: els temes ja no es poden canviar.');
    const t = cleanTheme_(theme, cfg.numTemes);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_THEMES);
    const i = rows_(sh).findIndex((r) => r[1] === me.name);
    if (i >= 0) sh.getRange(i + 2, 3, 1, 4).setValues([t.concat([new Date()])]);
    else sh.appendRow(['t' + Utilities.getUuid().slice(0, 8), me.name].concat(t, [new Date()]));
    return state_(me);
  });
}

// Tria la persona a qui regalaràs. Si ja n'havies triat una altra, la canvia.
function tria(code, name) {
  return withLock_(() => {
    const me = who_(code);
    if (phase_(config_()) !== 'tria') return state_(me, 'Encara no es pot triar: espera que passi la data límit.');
    const people = participants_();
    const target = people.find((p) => p.name === name);
    if (!target) return state_(me, 'No trobo aquesta persona.');
    if (target.name === me.name) return state_(me, 'No et pots triar a tu.');
    const ps = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PICKS);
    const picks = rows_(ps).filter((r) => r[0]);
    const holder = picks.find((r) => r[0] === target.key);
    if (holder && holder[1] === me.hash) return state_(me);
    if (holder) return state_(me, 'Algú se t\'ha avançat: aquesta persona ja està triada.');

    // Que l'última persona no es quedi sense ningú a qui regalar (només quedaria ella mateixa).
    const others = picks.filter((r) => r[1] !== me.hash);
    const pickers = new Set(others.map((r) => r[1]));
    const taken = new Set(others.map((r) => r[0]).concat([target.key]));
    const left = people.filter((p) => p.name !== me.name && !pickers.has(p.hash));
    const free = people.filter((p) => !taken.has(p.key));
    if (left.length === 1 && free.length === 1 && left[0].name === free[0].name) {
      return state_(me, 'Tria una altra persona: si no, l\'última es quedaria sense ningú a qui regalar.');
    }

    deleteRows_(ps, (r) => r[1] === me.hash);
    ps.appendRow([target.key, me.hash, new Date()]);
    return state_(me);
  });
}

function desfes(code) {
  return withLock_(() => {
    const me = who_(code);
    if (phase_(config_()) !== 'tria') return state_(me);
    deleteRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PICKS), (r) => r[1] === me.hash);
    return state_(me);
  });
}

// ---------- Ajustos (només per a qui té «Sí» a «Pot configurar») ----------

function adminOnly_(code, fn) {
  return withLock_(() => {
    const me = who_(code);
    if (!me.admin) return state_(me, 'No tens accés als ajustos. Demana-ho a qui organitza.');
    const err = fn(me);
    return state_(who_(code), err || '');
  });
}

function desaAjustos(code, v) {
  return adminOnly_(code, () => {
    v = v || {};
    const text = (x, max) => {
      const t = String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, max);
      return /^[=+\-@]/.test(t) ? "'" + t : t;
    };
    const limit = v.date ? limitText_(v.date, v.time) : '';
    if (limit === null) return 'La data límit no és vàlida.';
    const n = parseInt(v.numTemes, 10);
    if (!(n >= 1 && n <= 3)) return 'Els temes per persona han de ser 1, 2 o 3.';
    if (ESTILS.indexOf(String(v.estil)) < 0) return 'Aquest estil no existeix.';
    setConfig_({
      titol: text(v.titol, 60) || 'Amic invisible',
      familia: text(v.familia, 60),
      avis: text(v.avis, 300),
      dataLimit: limit,
      numTemes: String(n),
      estil: String(v.estil),
      exemples: text(v.exemples, 200),
    });
    refreshPeople_(); // els missatges de WhatsApp porten la data nova
  });
}

function afegeixPersona(code, name, phone) {
  return adminOnly_(code, () => {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!n) return 'Escriu el nom.';
    if (/^[=+\-@]/.test(n)) return 'El nom no pot començar amb aquest símbol.';
    if (participants_().some((p) => p.name.toLowerCase() === n.toLowerCase())) return 'Ja hi ha algú que es diu ' + n + '. Afegeix-hi una inicial.';
    refreshPeople_((rows) => rows.concat([[n, '', '', String(phone || '').trim().slice(0, 20), '', '']]));
  });
}

function canviaTelefon(code, name, phone) {
  return adminOnly_(code, () => {
    refreshPeople_((rows) => rows.map((r) => (String(r[0]).trim() === name ? [r[0], r[1], r[2], String(phone || '').trim().slice(0, 20), r[4], r[5]] : r)));
  });
}

function treuPersona(code, name) {
  return adminOnly_(code, (me) => {
    if (name === me.name) return 'No et pots treure a tu mateix.';
    const p = participants_().find((x) => x.name === name);
    if (!p) return '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    deleteRows_(ss.getSheetByName(SHEET_THEMES), (r) => r[1] === name);
    deleteRows_(ss.getSheetByName(SHEET_PICKS), (r) => r[0] === p.key || r[1] === p.hash);
    refreshPeople_((rows) => rows.filter((r) => String(r[0]).trim() !== name));
  });
}

function canviaAcces(code, name, on) {
  return adminOnly_(code, (me) => {
    if (name === me.name && !on) return 'No et pots treure l\'accés a tu mateix: demana-ho a un altre administrador.';
    refreshPeople_((rows) => rows.map((r) => (String(r[0]).trim() === name ? [r[0], r[1], r[2], r[3], r[4], on ? 'Sí' : ''] : r)));
  });
}

// «2026-12-07» + «22:00» (dels camps de la pàgina) → «07/12/2026 22:00». null si no és vàlida.
function limitText_(date, time) {
  const d = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(time || '23:59').match(/^(\d{2}):(\d{2})$/);
  return d && t ? d[3] + '/' + d[2] + '/' + d[1] + ' ' + t[1] + ':' + t[2] : null;
}

// Per a l'any que ve: guarda els temes en una pestanya d'arxiu, deixa el tauler net i posa
// la data límit nova. La família i els enllaços es mantenen.
function novaEdicio(code, date, time) {
  return adminOnly_(code, () => {
    const limit = limitText_(date, time);
    if (!limit || !(parseDate_(limit) > now_())) return 'Posa la data límit de la nova edició (ha de ser més endavant d\'avui).';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ts = ss.getSheetByName(SHEET_THEMES);
    const rows = rows_(ts).filter((r) => r[0]);
    if (rows.length) {
      const year = Utilities.formatDate(now_(), Session.getScriptTimeZone(), 'yyyy');
      let name = 'Arxiu ' + year;
      for (let i = 2; ss.getSheetByName(name); i++) name = 'Arxiu ' + year + ' (' + i + ')';
      const arch = ss.insertSheet(name);
      arch.appendRow(['Nom', 'Tema 1', 'Tema 2', 'Tema 3']);
      arch.getRange(2, 1, rows.length, 4).setValues(rows.map((r) => [r[1], r[2], r[3], r[4]]));
    }
    deleteRows_(ts, () => true);
    deleteRows_(ss.getSheetByName(SHEET_PICKS), () => true);
    setConfig_({ dataLimit: limit });
    refreshPeople_();
  });
}

function setConfig_(values) {
  const cs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  const rows = rows_(cs);
  Object.keys(values).forEach((key) => {
    const def = CONFIG_ROWS.find((c) => c[1] === key);
    const i = rows.findIndex((r) => String(r[0]).trim().toLowerCase() === def[0].toLowerCase());
    if (i >= 0) cs.getRange(i + 2, 2, 1, 1).setValues([[values[key]]]);
    else { cs.appendRow([def[0], values[key], def[2]]); rows.push([def[0], values[key]]); }
  });
}

function adminData_(cfg, themes) {
  const tz = Session.getScriptTimeZone();
  const limit = cfg.dataLimit ? new Date(cfg.dataLimit) : null;
  const url = appUrl_(cfg);
  const written = new Set(themes.map((r) => r[1]));
  return {
    titol: cfg.titol, familia: cfg.familia, avis: cfg.avis, numTemes: cfg.numTemes, estil: cfg.estil,
    exemples: cfg.exemples.join(', '),
    date: limit ? Utilities.formatDate(limit, tz, 'yyyy-MM-dd') : '',
    time: limit ? Utilities.formatDate(limit, tz, 'HH:mm') : '',
    hasUrl: !!url,
    people: participants_().map((p) => ({
      name: p.name,
      admin: p.admin,
      phone: p.phone,
      written: written.has(p.name),
      link: url ? url + '?codi=' + p.code : '',
      wa: url ? waUrl_(p.name, p.phone, url + '?codi=' + p.code, cfg) : '',
    })),
  };
}

// ---------- Intern ----------

function state_(me, error) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = config_();
  const phase = phase_(cfg);
  const themes = rows_(ss.getSheetByName(SHEET_THEMES)).filter((r) => r[0]);
  const picks = {};
  rows_(ss.getSheetByName(SHEET_PICKS)).forEach((r) => { if (r[0]) picks[r[0]] = r[1]; });
  const n = cfg.numTemes;
  const themesOf = (name) => {
    const r = themes.find((x) => x[1] === name);
    const list = r ? [r[2], r[3], r[4]].slice(0, n).map((x) => String(x || '')).filter(Boolean) : [];
    return list.length ? list : null;
  };

  let myPick = null;
  const others = participants_().filter((p) => p.name !== me.name).map((p) => {
    const t = themesOf(p.name);
    // Abans de la data límit, dels altres només es diu si ja han escrit els temes.
    if (phase === 'temes') return { name: p.name, written: !!t };
    const status = !picks[p.key] ? 'free' : picks[p.key] === me.hash ? 'mine' : 'taken';
    if (status === 'mine') myPick = { name: p.name, themes: t };
    return { name: p.name, themes: t, status: status };
  });

  return {
    name: me.name,
    error: error || '',
    phase: phase,
    msLeft: phase === 'temes' ? cfg.dataLimit - now_().getTime() : 0,
    dataLimitText: cfg.dataLimitText,
    mine: themesOf(me.name), // sense cap informació de si l'han triat
    myPick: myPick,
    others: others,
    config: publicConfig_(cfg),
    admin: me.admin ? adminData_(cfg, themes) : null,
  };
}

function participants_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PARTICIPANTS);
  return rows_(sh).filter((r) => r[0] && r[1]).map((r) => {
    const code = String(r[1]).toUpperCase();
    const name = String(r[0]).trim();
    return { name: name, code: code, hash: hash_(code), key: hash_('persona:' + name.toLowerCase()), phone: String(r[3] || ''), admin: isYes_(r[5]) };
  });
}

function who_(code) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = c ? participants_().find((x) => x.code === c) : null;
  if (!p) throw new Error('codi-incorrecte');
  return p;
}

function cleanTheme_(list, n) {
  // Evita que Sheets ho interpreti com una fórmula.
  const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
  const t = [0, 1, 2].map((i) => (i < n ? safe(String((list || [])[i] || '').replace(/\s+/g, ' ').trim().slice(0, 120)) : ''));
  if (t.slice(0, n).some((x) => !x)) throw new Error(n === 1 ? 'Escriu el tema.' : 'Escriu els ' + n + ' temes.');
  return t;
}

function deleteRows_(sh, test) {
  const rows = rows_(sh);
  for (let i = rows.length - 1; i >= 0; i--) if (test(rows[i])) sh.deleteRow(i + 2);
}

function rows_(sh) {
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1);
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function hash_(code) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'amic-invisible:' + code);
  return bytes.slice(0, 8).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function newCode_() {
  let s = 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)];
  for (let i = 1; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
