/**
 * Amic invisible: tauler de temes de regal.
 *
 * Cada persona escriu uns quants temes de regal, els que vulgui. Els altres els llegeixen i
 * trien una persona: serà a qui regalen, i el regal l'interpreten com creguin.
 * Ningú sap qui l'ha triat, i cada persona només la pot triar algú.
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
 *      Configuració: títol, família, avís, temes per persona, colors i exemples.
 *      Participants: escriu-hi els noms a la columna A.
 * 6. Torna al full i, al menú «Amic invisible», prem «Genera codis i enllaços».
 *    A la pestanya Participants surt l'enllaç personal de cadascú. Envia a cada persona el seu.
 *
 * Tot el que hi ha a la pestanya Configuració es pot canviar quan vulguis: la pàgina ho
 * agafa al moment, sense tornar a implementar res.
 *
 * Si tu també hi participes: no obris la pestanya «Tries» (està amagada), que és on
 * es desa qui ha triat qui.
 */

// Valors inicials. Només s'usen la primera vegada, per omplir les pestanyes del full.
const INICIAL = {
  titol: 'Amic invisible',
  familia: 'Bové Palau',
  avis: 'Pressupost: uns 20 €. Intercanvi el dia de Nadal, a casa dels avis.',
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
  ['Títol', 'titol', 'Surt a dalt de tot.'],
  ['Família', 'familia', 'Surt sota el títol, amb les inicials. Deixa-ho buit si no en vols.'],
  ['Avís', 'avis', 'Text per a tothom: pressupost, data, lloc… Si és buit, no surt.'],
  ['Temes per persona', 'numTemes', '1, 2 o 3.'],
  ['Estil', 'estil', 'avet (verd i vermell), nit (blau i daurat), gerd (granat i taronja) o neu (blau gris i vermell).'],
  ['Exemples', 'exemples', 'Exemples que surten dins dels requadres buits, separats per comes.'],
];

// ---------- Pàgina ----------

function doGet() {
  const cfg = config_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.config = JSON.stringify(cfg).replace(/</g, '\\u003c');
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

// Crea les pestanyes que faltin i dona un codi i un enllaç a cada participant.
// Es pot tornar a executar sempre que vulguis: qui ja tenia codi el conserva.
function prepara() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cs = ss.getSheetByName(SHEET_CONFIG);
  if (!cs) {
    const c = sheet_(ss, SHEET_CONFIG, ['Opció', 'Valor', 'Explicació']);
    c.getRange(2, 1, CONFIG_ROWS.length, 3).setValues(CONFIG_ROWS.map((r) => [r[0], INICIAL[r[1]], r[2]]));
  }
  const ps = sheet_(ss, SHEET_PARTICIPANTS, ['Nom', 'Codi', 'Enllaç personal']);
  sheet_(ss, SHEET_THEMES, ['id', 'Nom', 'Tema 1', 'Tema 2', 'Tema 3', 'Actualitzat']);
  sheet_(ss, SHEET_PICKS, ['id dels temes', 'Triat per (codi xifrat)', 'Data']).hideSheet();

  const rows = rows_(ps).filter((r) => String(r[0]).trim());
  const source = rows.length ? rows : INICIAL.participants.map((n) => [n, '']);
  const names = source.map((r) => String(r[0]).trim());
  const seen = new Set();
  names.forEach((n) => {
    if (seen.has(n.toLowerCase())) throw new Error('El nom «' + n + '» surt dues vegades a Participants.');
    seen.add(n.toLowerCase());
  });

  const used = new Set(source.map((r) => String(r[1] || '')).filter(Boolean));
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }

  const out = source.map((r, i) => {
    let code = String(r[1] || '').trim().toUpperCase();
    if (!code) { do { code = newCode_(); } while (used.has(code)); used.add(code); }
    return [names[i], code, url ? url + '?codi=' + code : '(primer implementa l\'aplicació web i torna-ho a executar)'];
  });

  const last = ps.getLastRow();
  if (last > 1) ps.getRange(2, 1, last - 1, 3).setValues(Array.from({ length: last - 1 }, () => ['', '', '']));
  // Text pla, perquè Sheets no converteixi cap codi en número o data.
  ps.getRange(2, 2, out.length, 1).setNumberFormat('@');
  ps.getRange(2, 1, out.length, 3).setValues(out);
  return out;
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
  return {
    titol: String(get('titol') || '').trim() || 'Amic invisible',
    familia: String(get('familia') || '').trim(),
    avis: String(get('avis') || '').trim(),
    numTemes: n >= 1 && n <= 3 ? n : 2,
    estil: ESTILS.indexOf(estil) >= 0 ? estil : 'avet',
    exemples: String(get('exemples') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3),
  };
}

// ---------- Funcions que crida la pàgina ----------

function entra(code) {
  return state_(who_(code));
}

// Desa els temes de la persona (els crea o els canvia).
function desa(code, theme) {
  return withLock_(() => {
    const me = who_(code);
    const t = cleanTheme_(theme, config_().numTemes);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_THEMES);
    const i = rows_(sh).findIndex((r) => r[1] === me.name);
    if (i >= 0) sh.getRange(i + 2, 3, 1, 4).setValues([t.concat([new Date()])]);
    else sh.appendRow(['t' + Utilities.getUuid().slice(0, 8), me.name].concat(t, [new Date()]));
    return state_(me);
  });
}

// Tria una altra persona (pel seu id de temes). Si ja n'havies triat una altra, la canvia.
function tria(code, id) {
  return withLock_(() => {
    const me = who_(code);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const themes = rows_(ss.getSheetByName(SHEET_THEMES)).filter((r) => r[0]);
    const theme = themes.find((r) => r[0] === id);
    if (!theme) return state_(me, 'Aquesta persona encara no ha posat els temes.');
    if (theme[1] === me.name) return state_(me, 'No et pots triar a tu.');
    const ps = ss.getSheetByName(SHEET_PICKS);
    const picks = rows_(ps).filter((r) => r[0]);
    const holder = picks.find((r) => r[0] === id);
    if (holder && holder[1] === me.hash) return state_(me);
    if (holder) return state_(me, 'Algú se t\'ha avançat: aquesta persona ja està triada.');

    // Que l'última persona no es quedi només amb el seu propi tema.
    const names = participants_().map((p) => p.name);
    const others = picks.filter((r) => r[1] !== me.hash);
    const pickers = new Set(others.map((r) => r[1]));
    const takenIds = new Set(others.map((r) => r[0]).concat([id]));
    const withTheme = new Set(themes.map((r) => r[1]));
    const left = participants_().filter((p) => p.name !== me.name && !pickers.has(p.hash)).map((p) => p.name);
    const free = themes.filter((r) => !takenIds.has(r[0])).map((r) => r[1])
      .concat(names.filter((n) => !withTheme.has(n)));
    if (left.length === 1 && free.length === 1 && left[0] === free[0]) {
      return state_(me, 'Tria una altra persona: si no, l\'última es quedaria sense ningú a qui regalar.');
    }

    deleteRows_(ps, (r) => r[1] === me.hash);
    ps.appendRow([id, me.hash, new Date()]);
    return state_(me);
  });
}

function desfes(code) {
  return withLock_(() => {
    const me = who_(code);
    deleteRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PICKS), (r) => r[1] === me.hash);
    return state_(me);
  });
}

// ---------- Intern ----------

function state_(me, error) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const themes = rows_(ss.getSheetByName(SHEET_THEMES)).filter((r) => r[0]);
  const picks = {};
  rows_(ss.getSheetByName(SHEET_PICKS)).forEach((r) => { if (r[0]) picks[r[0]] = r[1]; });
  const names = participants_().map((p) => p.name);
  const n = config_().numTemes;
  const plain = (r) => (r ? { id: r[0], themes: [r[2], r[3], r[4]].slice(0, n).map((x) => String(x || '')).filter(Boolean) } : null);
  const byName = (n) => themes.find((r) => r[1] === n);

  let myPick = null;
  const others = names.filter((n) => n !== me.name).map((n) => {
    const t = plain(byName(n));
    if (t) {
      t.status = !picks[t.id] ? 'free' : picks[t.id] === me.hash ? 'mine' : 'taken';
      if (t.status === 'mine') myPick = { name: n, themes: t.themes };
    }
    return { name: n, theme: t };
  });

  return {
    name: me.name,
    error: error || '',
    mine: plain(byName(me.name)), // sense cap informació de si l'han triat
    myPick: myPick,
    others: others,
  };
}

function participants_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PARTICIPANTS);
  return rows_(sh).filter((r) => r[0] && r[1]).map((r) => {
    const code = String(r[1]).toUpperCase();
    return { name: String(r[0]).trim(), code: code, hash: hash_(code) };
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
