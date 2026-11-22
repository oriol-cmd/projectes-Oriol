/**
 * Amic invisible: tauler de temes de regal.
 *
 * Cada persona escriu 2 temes de regal, els que vulgui. Els altres els llegeixen i trien
 * una persona: serà a qui regalen, i el regal l'interpreten com creguin.
 * Ningú sap qui l'ha triat, i cada persona només la pot triar algú.
 *
 * Com instal·lar-lo (un sol cop, uns 5 minuts):
 * 1. Crea un full de càlcul nou a Google Sheets (p. ex. «Amic invisible»).
 * 2. Extensions > Apps Script. Esborra el que hi hagi a Code.gs i enganxa-hi aquest codi.
 * 3. Fitxer «+» > HTML, posa-li de nom «Index» i enganxa-hi el contingut d'Index.html.
 * 4. Escriu els noms a PARTICIPANTS (aquí sota) i, si vols, un AVIS. Desa.
 * 5. Implementa > Nova implementació > ⚙️ Aplicació web
 *      Executa com a: Jo
 *      Qui hi té accés: Qualsevol
 *    Accepta els permisos.
 * 6. Tria la funció «prepara» i prem Executa. Al full apareix la pestanya «Participants»
 *    amb l'enllaç personal de cadascú. Envia a cada persona el seu (i només el seu).
 *
 * Si canvies els noms, torna a executar «prepara»: qui ja hi era conserva el seu codi.
 *
 * Si tu també hi participes: no obris la pestanya «Tries» (està amagada), que és on
 * es desa quins temes s'han triat.
 */

const PARTICIPANTS = ['Anna', 'Bernat', 'Carla', 'David', 'Elena', 'Ferran', 'Gemma', 'Oriol'];

// Text que surt a dalt de tot per a tothom. Pots deixar-lo buit: ''.
const AVIS = 'Pressupost: uns 20 €. Intercanvi el dissabte 20 de desembre.';

const SHEET_PARTICIPANTS = 'Participants';
const SHEET_THEMES = 'Temes';
const SHEET_PICKS = 'Tries';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sense 0/O ni 1/I, que es confonen

// ---------- Pàgina ----------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Amic invisible')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Preparació (l'executes tu des de l'editor) ----------

function prepara() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ps = sheet_(ss, SHEET_PARTICIPANTS, ['Nom', 'Codi', 'Enllaç personal']);
  sheet_(ss, SHEET_THEMES, ['id', 'Nom', 'Tema 1', 'Tema 2', 'Actualitzat']);
  sheet_(ss, SHEET_PICKS, ['id del tema', 'Triat per (codi xifrat)', 'Data']).hideSheet();

  const names = PARTICIPANTS.map((n) => String(n).trim()).filter(Boolean);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Hi ha noms repetits a PARTICIPANTS');

  const old = {};
  rows_(ps).forEach((r) => { if (r[0] && r[1]) old[String(r[0]).trim().toLowerCase()] = String(r[1]); });
  const used = new Set(Object.values(old));
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }

  const out = names.map((name) => {
    let code = old[name.toLowerCase()];
    if (!code) { do { code = newCode_(); } while (used.has(code)); used.add(code); }
    return [name, code, url ? url + '?codi=' + code : '(primer implementa l\'aplicació web i torna a executar «prepara»)'];
  });

  const last = ps.getLastRow();
  if (last > 1) ps.getRange(2, 1, last - 1, 3).setValues(Array.from({ length: last - 1 }, () => ['', '', '']));
  // Text pla, perquè Sheets no converteixi cap codi en número o data.
  ps.getRange(2, 2, out.length, 1).setNumberFormat('@');
  ps.getRange(2, 1, out.length, 3).setValues(out);
  return out;
}

// ---------- Funcions que crida la pàgina ----------

function entra(code) {
  return state_(who_(code));
}

// Desa els 2 temes de la persona (els crea o els canvia).
function desa(code, theme) {
  return withLock_(() => {
    const me = who_(code);
    const t = cleanTheme_(theme);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_THEMES);
    const i = rows_(sh).findIndex((r) => r[1] === me.name);
    if (i >= 0) sh.getRange(i + 2, 3, 1, 3).setValues([t.concat([new Date()])]);
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
  const plain = (r) => (r ? { id: r[0], themes: [r[2], r[3]].map((x) => String(x || '')) } : null);
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
    notice: AVIS,
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

function cleanTheme_(list) {
  // Evita que Sheets ho interpreti com una fórmula.
  const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
  const t = [0, 1].map((i) => safe(String((list || [])[i] || '').replace(/\s+/g, ' ').trim().slice(0, 120)));
  if (t.some((x) => !x)) throw new Error('Escriu els 2 temes.');
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
