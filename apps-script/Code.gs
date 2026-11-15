/**
 * Xiu-xiu: envia els resums per correu i els guarda en aquest full de càlcul.
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

// La teva adreça (la del compte de Google que instal·la l'script): rep els resums
// automàtics i les respostes dels altres. No cal canviar-la.
const ALLOWED_RECIPIENTS = [Session.getEffectiveUser().getEmail()];
const MAX_RECIPIENTS = 25;

// Desa també cada acta com a Google Doc a la carpeta «Xiu-xiu · Actes» del teu Drive.
const CREATE_DOCS = true;
const DOCS_FOLDER = 'Xiu-xiu · Actes';

const SHEET_MEETINGS = 'Reunions';
const SHEET_TASKS = 'Tasques';
const MAX_CELL = 49000; // Límit de caràcters d'una cel·la de Google Sheets

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    // Seguretat: si no s'ha canviat la clau d'exemple, l'script no envia res.
    if (SECRET === 'CANVIA-AQUESTA-CLAU') return json_({ ok: false, error: "Cal canviar la clau secreta (SECRET) de l'script abans de fer-lo servir" });
    if (!data.secret || data.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    // Enviament a altres persones (botó «Envia a altres persones»).
    if (Array.isArray(data.recipients)) return sendToOthers_(data);

    // 1. Desa-ho al full (si ja hi és, no ho duplica).
    let sheetWarning = '';
    if (data.id) {
      try { saveToSheet_(data); } catch (err) { sheetWarning = String(err); }
    }

    // 1b. Desa l'acta com a Google Doc (o l'actualitza si ja existeix).
    let docUrl = '';
    if (CREATE_DOCS && data.id && data.summary) {
      try { docUrl = saveDoc_(data); } catch (err) { sheetWarning += ' Doc: ' + String(err); }
    }

    // 2. Envia el correu.
    const to = ALLOWED_RECIPIENTS.indexOf(String(data.to || '').toLowerCase()) >= 0 ? data.to : ALLOWED_RECIPIENTS[0];
    const options = { name: 'Xiu-xiu' };
    if (data.html) options.htmlBody = data.html + (docUrl ? '<p style="margin:8px 0 0;font-size:12px"><a href="' + docUrl + '">Obre l\'acta a Google Docs</a></p>' : '') + sheetLink_();
    if (data.transcript) {
      options.attachments = [Utilities.newBlob(data.transcript, 'text/plain', data.filename || 'transcripcio.txt')];
    }
    GmailApp.sendEmail(to, data.subject || 'Resum de reunió', data.text || '', options);
    return json_({ ok: true, sentTo: [to], sheetWarning: sheetWarning, docUrl: docUrl });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function sendToOthers_(data) {
  const list = data.recipients
    .map(function (x) { return String(x).trim().toLowerCase(); })
    .filter(function (x) { return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(x); })
    .slice(0, MAX_RECIPIENTS);
  if (!list.length) return json_({ ok: false, error: 'Cap adreça vàlida' });
  const options = { name: 'Xiu-xiu', replyTo: ALLOWED_RECIPIENTS[0] };
  if (data.html) options.htmlBody = data.html; // sense l'enllaç al full privat
  if (data.transcript) {
    options.attachments = [Utilities.newBlob(data.transcript, 'text/plain', data.filename || 'transcripcio.txt')];
  }
  GmailApp.sendEmail(list.join(','), data.subject || 'Resum de reunió', data.text || '', options);
  return json_({ ok: true, sentTo: list });
}

function saveToSheet_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return; // script no vinculat a cap full
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const meetings = getSheet_(ss, SHEET_MEETINGS, ['Data', 'Títol', 'Durada (min)', 'Resum', 'Transcripció', 'ID']);
    const ids = meetings.getLastRow() > 1 ? meetings.getRange(2, 6, meetings.getLastRow() - 1, 1).getValues().map(String) : [];
    const date = d.date ? new Date(d.date) : new Date();
    const transcript = String(d.transcript || '');
    const pos = ids.indexOf(String(d.id));
    if (pos >= 0) {
      // Ja desada: actualitza el resum (p. ex. després de «Refés el resum» o de continuar la reunió).
      meetings.getRange(pos + 2, 2, 1, 4).setValues([[
        d.title || '', d.durationMin || 0, String(d.summary || '').slice(0, MAX_CELL),
        transcript.length > MAX_CELL ? transcript.slice(0, MAX_CELL) + '\n[…continua al correu]' : transcript,
      ]]);
      return;
    }

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

// ---------------------------------------------------------------------------
// Google Doc de cada acta
// ---------------------------------------------------------------------------
function saveDoc_(d) {
  const props = PropertiesService.getScriptProperties();
  const key = 'doc_' + d.id;
  const date = d.date ? new Date(d.date) : new Date();
  const name = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd') + ' · ' + (d.title || 'Acta de reunió');
  let doc = null;
  const oldId = props.getProperty(key);
  if (oldId) { try { doc = DocumentApp.openById(oldId); doc.setName(name); } catch (e) { doc = null; } }
  if (!doc) {
    doc = DocumentApp.create(name);
    const folders = DriveApp.getFoldersByName(DOCS_FOLDER);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DOCS_FOLDER);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
    props.setProperty(key, doc.getId());
  }
  writeMarkdown_(doc.getBody(), String(d.summary || ''));
  doc.saveAndClose();
  return doc.getUrl();
}

// Converteix l'acta (Markdown senzill) en un document amb títols, llistes i negretes.
function writeMarkdown_(body, md) {
  body.clear();
  const H = DocumentApp.ParagraphHeading;
  let first = true;
  md.split('\n').forEach(function (raw) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    let m, el;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      el = first ? body.getParagraphs()[0].setText('') : body.appendParagraph('');
      el.setHeading(m[1].length === 1 ? H.TITLE : m[1].length === 2 ? H.HEADING2 : H.HEADING3);
      richText_(el, m[2]);
    } else if ((m = line.match(/^(\s*)[-*•]\s+(?:\[[ xX]?\]\s*)?(.*)$/))) {
      el = body.appendListItem('');
      el.setGlyphType(DocumentApp.GlyphType.BULLET).setNestingLevel(m[1].length >= 2 ? 1 : 0);
      richText_(el, m[2]);
    } else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
      el = body.appendListItem('');
      el.setGlyphType(DocumentApp.GlyphType.NUMBER);
      richText_(el, m[2]);
    } else {
      el = first ? body.getParagraphs()[0].setText('') : body.appendParagraph('');
      el.setHeading(H.NORMAL);
      richText_(el, line);
    }
    first = false;
  });
}
function richText_(el, raw) {
  const parts = raw.split('**');
  let text = '', bold = [];
  parts.forEach(function (p, i) { if (i % 2 === 1 && p) bold.push([text.length, text.length + p.length - 1]); text += p; });
  el.setText(text || ' ');
  const t = el.editAsText();
  t.setBold(false);
  bold.forEach(function (r) { if (r[1] >= r[0]) t.setBold(r[0], r[1], true); });
  const dubte = /\[(dubte de comprensió|duda de comprensión|unclear)\]/gi;
  let mm;
  while ((mm = dubte.exec(text))) t.setForegroundColor(mm.index, mm.index + mm[0].length - 1, '#b45309');
}

// Per comprovar des del navegador que l'script està publicat.
function doGet() {
  return json_({ ok: true, service: 'reunions' });
}

// Executa-la un cop des de l'editor per donar permisos.
function autoritza() {
  GmailApp.getAliases();
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder();
  DocumentApp.getActiveDocument;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
