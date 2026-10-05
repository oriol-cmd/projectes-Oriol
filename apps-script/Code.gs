/**
 * Enviament de resums de reunions per correu.
 *
 * L'app de l'iPhone fa un POST a aquest script amb el resum, i el script
 * l'envia des del teu compte de Google (Gmail de oriol@esportec.cat).
 *
 * 1. Canvia SECRET per una frase llarga que només sàpigues tu.
 * 2. Implementa > Nova implementació > Aplicació web
 *      Executa com a: Jo
 *      Qui hi té accés: Qualsevol
 * 3. Copia l'URL (acaba en /exec) a la configuració de l'app, amb el mateix SECRET.
 */

const SECRET = 'CANVIA-AQUESTA-CLAU';

// Adreces a què l'app pot enviar. Qualsevol altra es redirigeix a la primera.
const ALLOWED_RECIPIENTS = ['oriol@esportec.cat'];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.secret || data.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    const to = ALLOWED_RECIPIENTS.indexOf(String(data.to || '').toLowerCase()) >= 0 ? data.to : ALLOWED_RECIPIENTS[0];
    const options = {
      name: 'Resums de Reunions',
      htmlBody: data.html || undefined,
    };
    if (data.transcript) {
      options.attachments = [
        Utilities.newBlob(data.transcript, 'text/plain', data.filename || 'transcripcio.txt'),
      ];
    }
    GmailApp.sendEmail(to, data.subject || 'Resum de reunió', data.text || '', options);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// Per comprovar des del navegador que l'script està publicat.
function doGet() {
  return json_({ ok: true, service: 'reunions' });
}

// Executa-la un cop des de l'editor per donar permisos a Gmail.
function autoritza() {
  GmailApp.getAliases();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
