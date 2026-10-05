/**
 * Reunions: envia els resums per correu i els guarda en aquest full de càlcul.
 *
 * Com instal·lar-lo (un sol cop):
 * 1. Crea un full de càlcul nou a Google Sheets (p. ex. «Reunions»).
 * 2. Extensions > Apps Script. Esborra-hi el que hi hagi i enganxa aquest codi.
 * 3. Canvia SECRET per una frase llarga que només sàpigues tu. Desa.
 * 4. Tria la funció «autoritza» i prem Executa. Accepta els permisos.
 * 5. Implementa > Nova implementació > Aplicació web
 *      Executa com a: Jo
 *      Qui hi té accés: Qualsevol
 * 6. Copia l'URL (acaba en /exec) a la configuració de l'app, amb el mateix SECRET.
 */

const SECRET = 'CANVIA-AQUESTA-CLAU';

// Adreces a què l'app pot enviar. Qualsevol altra es redirigeix a la primera.
const ALLOWED_RECIPIENTS = ['oriol@esportec.cat'];

const SHEET_MEETINGS = 'Reunions';
const SHEET_TASKS = 'Tasques';
const MAX_CELL = 49000; // Límit de caràcters d'una cel·la de Google Sheets

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.secret || data.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    // 1. Desa-ho al full (si ja hi és, no ho duplica).
    let sheetWarning = '';
    if (data.id) {
      try { saveToSheet_(data); } catch (err) { sheetWarning = String(err); }
    }

    // 2. Envia el correu.
    const to = ALLOWED_RECIPIENTS.indexOf(String(data.to || '').toLowerCase()) >= 0 ? data.to : ALLOWED_RECIPIENTS[0];
    const options = { name: 'Resums de Reunions' };
    if (data.html) options.htmlBody = data.html + sheetLink_();
    if (data.transcript) {
      options.attachments = [Utilities.newBlob(data.transcript, 'text/plain', data.filename || 'transcripcio.txt')];
    }
    GmailApp.sendEmail(to, data.subject || 'Resum de reunió', data.text || '', options);
    return json_({ ok: true, sheetWarning: sheetWarning });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function saveToSheet_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return; // script no vinculat a cap full
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const meetings = getSheet_(ss, SHEET_MEETINGS, ['Data', 'Títol', 'Durada (min)', 'Resum', 'Transcripció', 'ID']);
    const ids = meetings.getLastRow() > 1 ? meetings.getRange(2, 6, meetings.getLastRow() - 1, 1).getValues().map(String) : [];
    if (ids.indexOf(String(d.id)) >= 0) return; // ja desada (reenviament)

    const date = d.date ? new Date(d.date) : new Date();
    const transcript = String(d.transcript || '');
    meetings.appendRow([
      date,
      d.title || '',
      d.durationMin || 0,
      String(d.summary || '').slice(0, MAX_CELL),
      transcript.length > MAX_CELL ? transcript.slice(0, MAX_CELL) + '\n[…continua al correu]' : transcript,
      d.id,
    ]);

    const tasks = d.tasks || [];
    if (tasks.length) {
      const sheet = getSheet_(ss, SHEET_TASKS, ['Fet', 'Data reunió', 'Reunió', 'Responsable', 'Tasca', 'Termini']);
      const first = sheet.getLastRow() + 1;
      const rows = tasks.map(function (t) { return [false, date, d.title || '', t.who || '', t.task || '', t.due || '']; });
      sheet.getRange(first, 1, rows.length, rows[0].length).setValues(rows);
      sheet.getRange(first, 1, rows.length, 1).insertCheckboxes();
    }
  } finally {
    lock.releaseLock();
  }
}

function getSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    if (name === SHEET_MEETINGS) {
      sh.setColumnWidth(2, 220);
      sh.setColumnWidth(4, 480);
      sh.setColumnWidth(5, 300);
      sh.hideColumns(6);
      sh.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
      sh.getRange('D:E').setWrap(true).setVerticalAlignment('top');
    } else {
      sh.setColumnWidth(5, 420);
      sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
    }
    // Treu el full buit inicial si encara hi és.
    const def = ss.getSheetByName('Full 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
    if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  }
  return sh;
}

function sheetLink_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return '';
  return '<p style="margin:8px 0 0;font-size:12px"><a href="' + ss.getUrl() + '">Obre el full de reunions i tasques</a></p>';
}

// Per comprovar des del navegador que l'script està publicat.
function doGet() {
  return json_({ ok: true, service: 'reunions' });
}

// Executa-la un cop des de l'editor per donar permisos.
function autoritza() {
  GmailApp.getAliases();
  SpreadsheetApp.getActiveSpreadsheet();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
