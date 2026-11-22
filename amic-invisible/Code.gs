/**
 * Amic invisible: tauler de desitjos per a un grup.
 *
 * Cada persona escriu què li agradaria rebre. Els altres veuen aquestes llistes i
 * poden marcar un desig («el regalo jo») sense que ningú sàpiga qui l'ha marcat.
 * Tu no veus mai si algú ha marcat res de la teva llista.
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
 * Si tu també hi participes: no obris la pestanya «Marques» (està amagada), que és on
 * es desa què s'ha marcat.
 */

const PARTICIPANTS = ['Anna', 'Bernat', 'Carla', 'David', 'Elena', 'Ferran', 'Gemma', 'Oriol'];

// Text que surt a dalt de tot per a tothom. Pots deixar-lo buit: ''.
const AVIS = 'Pressupost: uns 20 €. Intercanvi el dissabte 20 de desembre.';

const SHEET_PARTICIPANTS = 'Participants';
const SHEET_WISHES = 'Desitjos';
const SHEET_MARKS = 'Marques';
const MAX_WISHES = 15;
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
  sheet_(ss, SHEET_WISHES, ['id', 'Propietari', 'Desig', 'Enllaç', 'Preu aprox.', 'Creat']);
  const ms = sheet_(ss, SHEET_MARKS, ['id del desig', 'Marcat per (codi xifrat)', 'Data']);
  ms.hideSheet();

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
  const me = who_(code);
  return state_(me);
}

function afegeix(code, wish) {
  return withLock_(() => {
    const me = who_(code);
    const w = cleanWish_(wish);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_WISHES);
    const mine = rows_(sh).filter((r) => r[1] === me.name).length;
    if (mine >= MAX_WISHES) return state_(me, 'Ja tens ' + MAX_WISHES + ' desitjos. Esborra\'n algun per afegir-ne un altre.');
    sh.appendRow(['d' + Utilities.getUuid().slice(0, 8), me.name, w.text, w.link, w.price, new Date()]);
    return state_(me);
  });
}

function edita(code, id, wish) {
  return withLock_(() => {
    const me = who_(code);
    const w = cleanWish_(wish);
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_WISHES);
    const i = rows_(sh).findIndex((r) => r[0] === id && r[1] === me.name);
    if (i < 0) return state_(me, 'Aquest desig ja no existeix.');
    sh.getRange(i + 2, 3, 1, 3).setValues([[w.text, w.link, w.price]]);
    return state_(me);
  });
}

function esborra(code, id) {
  return withLock_(() => {
    const me = who_(code);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_WISHES);
    const i = rows_(sh).findIndex((r) => r[0] === id && r[1] === me.name);
    if (i >= 0) sh.deleteRow(i + 2);
    deleteMarks_(ss.getSheetByName(SHEET_MARKS), (r) => r[0] === id);
    return state_(me);
  });
}

function marca(code, id) {
  return withLock_(() => {
    const me = who_(code);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const wish = rows_(ss.getSheetByName(SHEET_WISHES)).find((r) => r[0] === id);
    if (!wish) return state_(me, 'Aquest desig s\'ha esborrat.');
    if (wish[1] === me.name) return state_(me, 'No pots marcar els teus propis desitjos.');
    const ms = ss.getSheetByName(SHEET_MARKS);
    if (rows_(ms).some((r) => r[0] === id)) return state_(me, 'Algú se t\'ha avançat: aquest desig ja està agafat.');
    ms.appendRow([id, me.hash, new Date()]);
    return state_(me);
  });
}

function desmarca(code, id) {
  return withLock_(() => {
    const me = who_(code);
    deleteMarks_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MARKS), (r) => r[0] === id && r[1] === me.hash);
    return state_(me);
  });
}

// ---------- Intern ----------

function state_(me, error) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const wishes = rows_(ss.getSheetByName(SHEET_WISHES)).filter((r) => r[0]);
  const marks = {};
  rows_(ss.getSheetByName(SHEET_MARKS)).forEach((r) => { if (r[0]) marks[r[0]] = r[1]; });
  const names = rows_(ss.getSheetByName(SHEET_PARTICIPANTS)).map((r) => String(r[0]).trim()).filter(Boolean);
  const plain = (r) => ({ id: r[0], text: String(r[2]), link: String(r[3] || ''), price: String(r[4] || '') });

  return {
    name: me.name,
    notice: AVIS,
    error: error || '',
    // Els teus desitjos: sense cap informació de marques.
    mine: wishes.filter((r) => r[1] === me.name).map(plain),
    others: names.filter((n) => n !== me.name).map((n) => ({
      name: n,
      wishes: wishes.filter((r) => r[1] === n).map((r) => {
        const w = plain(r);
        w.status = !marks[r[0]] ? 'free' : marks[r[0]] === me.hash ? 'mine' : 'taken';
        return w;
      }),
    })),
  };
}

function who_(code) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PARTICIPANTS);
  const row = c && sh ? rows_(sh).find((r) => String(r[1]).toUpperCase() === c && r[0]) : null;
  if (!row) throw new Error('codi-incorrecte');
  return { name: String(row[0]).trim(), hash: hash_(c) };
}

function cleanWish_(w) {
  w = w || {};
  const text = String(w.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) throw new Error('Escriu què t\'agradaria.');
  let link = String(w.link || '').trim().slice(0, 500);
  if (link && !/^https?:\/\//i.test(link)) link = /^[\w-]+(\.[\w-]+)+/.test(link) ? 'https://' + link : '';
  const price = String(w.price || '').trim().slice(0, 30);
  // Evita que Sheets ho interpreti com una fórmula.
  const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
  return { text: safe(text), link: link, price: safe(price) };
}

function deleteMarks_(ms, test) {
  const rows = rows_(ms);
  for (let i = rows.length - 1; i >= 0; i--) if (test(rows[i])) ms.deleteRow(i + 2);
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
