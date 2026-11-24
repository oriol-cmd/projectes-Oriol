// Proves de punta a punta de Xiu-xiu amb Chromium (Gemini, l'Apps Script i Google simulats).
// Ús: node tests/e2e.mjs   (des de l'arrel del projecte o des de tests/)
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xiuxiu-'));
const pwPath = ['/opt/node-tools/node_modules/playwright-core/index.mjs'].find((p) => fs.existsSync(p));
const { chromium } = await import(pwPath || 'playwright-core');
const exe = (() => {
  const base = '/opt/pw-browsers';
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = path.join(base, d, sub); if (d.startsWith('chromium-') && fs.existsSync(p)) return p; }
  }
  return undefined;
})();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
let fakeVersion = null;
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/version.json' && fakeVersion) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(fakeVersion)); }
  let f = path.join(root, u); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const PORT = srv.address().port;
const URL0 = `http://localhost:${PORT}/`;

const b = await chromium.launch({ executablePath: exe, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire'] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'], acceptDownloads: true });

// --- Simulacions ---
const log = { gemini: [], script: [], sys: [], mimes: [] };
let geminiFail = 0;
const SUMMARY = "# Reunió de prova\n\n## Resum\nS'ha parlat del pressupost.\n\n## Desenvolupament de la reunió\n### Pressupost\n- Aprovat amb canvis.\n\n## Decisions\n- Tirar endavant.\n\n## Tasques\n- [ ] **Marta**: enviar l'informe — divendres\n- [ ] **Persona 1**: revisar el contracte [dubte de comprensió] — dilluns\n\n## Temes oberts i propers passos\n- Cap.\n\n## Dades clau\n- 5.000 €\n\n## Dubtes de comprensió\n- No s'entén el nom del proveïdor.";
await ctx.route(/generativelanguage\.googleapis\.com/, async (r) => {
  const url = r.request().url();
  if (log.hang && r.request().method() === 'POST') { log.hung = (log.hung || 0) + 1; return; } // es queda penjada (sense resposta)
  if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[{"name":"models/x"}]}' });
  if (geminiFail > 0) { geminiFail--; return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":503,"status":"UNAVAILABLE","message":"overloaded"}}' }); }
  const body = r.request().postDataJSON();
  const parts = body.contents[0].parts;
  const sys = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
  const user = parts.filter((x) => x.text).map((x) => x.text).join(' ');
  if (sys) log.sys.push(sys);
  for (const x of parts) { const md = x.inlineData || x.fileData; if (md) log.mimes.push(md.mimeType || md.fileUri); }
  let txt;
  if (log.slowSeg && /tram d'una reunió/.test(user)) await new Promise((res) => setTimeout(res, 500));
  const tros = user.match(/Aquest és el tros (\d+) de (\d+)/);
  if (tros) {
    await new Promise((res) => setTimeout(res, 600)); // com una resposta real: dona temps que en coincideixin diversos
    txt = `Marta: text del tros ${tros[1]}.`;
  } else if (parts.some((x) => x.fileData && /youtube\.com/.test(x.fileData.fileUri || ''))) txt = 'Marta: aquest vídeo parla del pressupost.\n[final]';
  else if (user.includes("fragment curt d'una reunió")) txt = 'Això és el text en directe de prova.';
  else if (user.includes("Transcriu literalment el text d'aquests documents")) txt = "[Document 1]\nApunts: pressupost 5.000 €\n- Revisar contracte";
  else if (log.blockSummary && sys && !sys.includes("aquesta part d'una reunió") && !sys.includes('estructura de les etiquetes') && !/consultar|Tradueix|traductor/.test(sys)) {
    // Simula que Google ho bloqueja tot menys el resum per parts.
    log.blocked = (log.blocked || 0) + 1;
    const pl = JSON.stringify({ candidates: [{ finishReason: 'RECITATION' }] });
    return r.fulfill({ status: 200, contentType: url.includes('alt=sse') ? 'text/event-stream' : 'application/json', body: url.includes('alt=sse') ? `data: ${pl}\n\n` : pl });
  }
  else if (sys.includes("aquesta part d'una reunió")) txt = '- Es parla del pressupost de 5.000 €.';
  else if (sys.includes('apunts o documents') && log.recitation && parts.some((x) => x.inlineData)) {
    // Simula el filtre de «recitació» de Google quan s'envien les fotos.
    log.blocked = (log.blocked || 0) + 1;
    const pl = JSON.stringify({ candidates: [{ content: { parts: [{ text: '# Apunts' }] }, finishReason: 'RECITATION' }] });
    return r.fulfill({ status: 200, contentType: url.includes('alt=sse') ? 'text/event-stream' : 'application/json', body: url.includes('alt=sse') ? `data: ${pl}\n\n` : pl });
  }
  else if (sys.includes('apunts o documents')) txt = "# Apunts del pressupost\n\n## Resum\nNotes sobre el pressupost.\n\n## Punts principals\n- Pressupost de 5.000 €.\n\n## Dades clau\n- 5.000 €\n\n## Tasques\n- Cap.\n\n## Dubtes de comprensió\n- Cap.";
  else if (user.includes('Proposa etiquetes')) txt = '{"etiquetes":["pressupost","Finances 2027"]}';
  else if (sys.includes('Analitzes una reunió')) txt = '## Temps per tema\n- Pressupost [00:00]–[00:20]\n\n## Temes que han quedat oberts\n- Cap.';
  else if (sys.includes('correus de seguiment')) txt = JSON.stringify({ correus: [{ nom: 'Marta', assumpte: 'Seguiment de la reunió', text: "Hola Marta,\nEt toca enviar l'informe.\nSalutacions," }, { nom: 'Persona 1', assumpte: 'x', text: 'x' }] });
  else if (sys.includes('document de recull')) txt = '# Recull de prova\n\n## Resum general\n- Tot ha anat bé.';
  else if (sys.includes('Respon preguntes sobre UNA reunió')) txt = 'La Marta va parlar del pressupost [00:05].';
  if (txt) { log.gemini.push(sys ? 'SYS' : user.slice(0, 30)); return r.fulfill({ status: 200, contentType: url.includes('alt=sse') ? 'text/event-stream' : 'application/json', body: url.includes('alt=sse') ? `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] })}\n\n` : JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] }) }); }
  if (sys.includes("editor d'actes")) txt = SUMMARY.replace('[dubte de comprensió] ', '').replace("- No s'entén el nom del proveïdor.", '- Cap.');
  else if (sys.includes('Tradueix') || sys.includes('traductor')) txt = SUMMARY.replace('## Resum', '## Resumen');
  else if (sys.includes("estructura de l'usuari")) txt = '# Patronat\n\n## Assistents\n- Marta\n\n## Acords\n- Cap.\n\n## Tasques\n- Cap.';
  else if (/secretari|resumeix gravacions|document de revisió/.test(sys)) txt = SUMMARY;
  else if (sys.includes('escriu el document que et demana')) txt = '# Per a direcció\n\n- Pressupost de 5.000 € aprovat.';
  else if (user.includes('tipus de reunió possibles')) txt = '{"tipus":"comercial"}';
  else if (sys.includes('consultar les seves reunions')) txt = 'El pressupost és de 5.000 € (Reunió de prova).';
  else if (parts.some((x) => x.inlineData || x.fileData)) txt = 'Marta: parlem del pressupost de 5.000 euros.';
  else txt = 'OK';
  log.gemini.push(sys ? 'SYS' : user.slice(0, 30));
  const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] });
  const sse = url.includes('alt=sse');
  await r.fulfill({ status: 200, contentType: sse ? 'text/event-stream' : 'application/json', body: sse ? `data: ${payload}\n\n` : payload });
});
await ctx.route(/script\.google\.com/, async (r) => {
  const d = JSON.parse(r.request().postData() || '{}');
  if (log.slowScript && !d.action) await new Promise((res) => setTimeout(res, 4000));
  if (d.action === 'currentEvent') { log.script.push('calendari'); const t = Date.now(); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events: [{ title: 'Comitè de pressupostos', start: t - 300000, end: t + 3000000, guests: ['marta@exemple.cat', 'pere@exemple.cat'], location: 'Sala 2', description: '1. Pressupost\n2. Torn obert' }] }) }); }
  log.script.push(d.recipients ? `altres:${d.recipients.join(',')}` : `auto:${d.subject}`);
  await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sentTo: d.recipients || [d.to], docUrl: 'https://docs.google.com/document/d/PROVA' }) });
});
await ctx.route(/youtube\.com\/oembed/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"title":"Xerrada de prova"}' }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(/correu/i.test(d.message()) ? 'marta@exemple.cat' : 'Projecte Prova') : d.accept()));
const results = [];
const step = async (name, fn) => {
  try { const r = await fn(); results.push(`✅ ${name}${r ? ` — ${r}` : ''}`); }
  catch (e) { results.push(`❌ ${name} — ${String(e.message).split('\n')[0]}`); await p.screenshot({ path: path.join(tmp, `fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {}); }
};
const ok = (c, msg) => { if (!c) throw new Error(msg); };
// En arribar al resultat, s'espera també que acabi la feina de fons (correu, etiquetes).
const waitView = (v, t = 30000) => p.waitForFunction((v) => currentView === v && (v !== 'result' || !pipelines.size), v, { timeout: t });
const waitStatus = async (id, want, ms = 60000) => { const t0 = Date.now(); for (;;) { const st = await p.evaluate(async (id) => { const m = await getMeeting(id); return m && m.status; }, id); if (want.includes(st)) return st; if (Date.now() - t0 > ms) throw new Error(`estat ${st}`); await p.waitForTimeout(300); } };
const lastId = () => p.evaluate(async () => (await db.all('meetings')).sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
const meeting = (id) => p.evaluate((id) => getMeeting(id), id);
const fx = (f) => path.join(here, f);
const buildOrder = (t) => [...(t || '').matchAll(/text del tros (\d+)/g)].map((x) => Number(x[1]));

await p.goto(URL0);

// 1. Primers passos
await step('Benvinguda i clau de Gemini', async () => {
  await p.waitForTimeout(600);
  ok(await p.isVisible('#setup-banner'), 'sense benvinguda');
  await p.click('[data-kw="1"] [data-kw-go="3"]');
  await p.fill('#welcome-key', 'AQ.Ab8RN6Itestkeytestkeytestkey1234567');
  await p.waitForTimeout(1500);
  ok(await p.isVisible('#home-main'), 'no entra a l\'inici');
});
await step('Ajustos: desar i recuperar', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  await p.fill('#set-email', 'jo@exemple.cat'); await p.fill('#set-script-url', 'https://script.google.com/macros/s/X/exec'); await p.fill('#set-script-secret', 'secret');
  await p.fill('#set-vocab', 'Marta, Esportec'); await p.fill('#set-segment', '10'); await p.uncheck('#set-speakers');
  await p.selectOption('#set-audio-days', '7');
  await p.click('#btn-save-settings'); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(700); await p.click('#btn-settings');
  const v = await p.evaluate(() => ({ e: $('#set-email').value, voc: $('#set-vocab').value, seg: $('#set-segment').value, a: $('#set-audio-days').value, ver: $('#app-version').textContent }));
  ok(v.e === 'jo@exemple.cat' && v.voc.includes('Marta') && v.seg === '10' && v.a === '7', JSON.stringify(v));
  return v.ver;
});
await step('Correu de prova i comprovar clau', async () => {
  await p.click('#btn-test-email'); await p.waitForTimeout(1200);
  const a = await p.textContent('#settings-msg');
  await p.click('#btn-test-keys'); await p.waitForTimeout(1200);
  const k = await p.textContent('#settings-msg');
  ok(/✓/.test(a) && /✓/.test(k), `${a} | ${k}`);
});

// 2. Gravar
async function record(mode, secs, { important = false } = {}) {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.evaluate((m) => { saveSettings({ source: m }); renderSourceSwitch(); }, mode);
  await p.click(`.mode[data-mode="${important ? 'important' : 'general'}"]`);
  await p.fill('#meeting-title', `Prova ${mode}`);
  await p.click('#btn-record');
  if (mode === 'call') { await p.waitForSelector('#consent-sheet:not([hidden])'); ok(await p.isVisible('#consent-mic'), 'sense triar micròfon'); await p.check('#consent-ok'); await p.click('#btn-consent-start'); }
  await waitView('rec', 10000);
  const inputsShown = mode !== 'call' || await p.isVisible('#rec-inputs');
  await p.waitForTimeout(secs * 500);
  await p.click('#btn-mark');
  await p.click('#btn-pause'); await p.waitForTimeout(1200);
  ok(await p.textContent('#rec-state-text') === 'En pausa', 'no pausa');
  await p.click('#btn-pause'); await p.waitForTimeout(secs * 500);
  await p.click('#btn-stop');
  await waitView('result', 90000);
  ok(inputsShown, 'sense indicadors de so');
  const id = await lastId();
  const m = await meeting(id);
  ok(m.summary && m.status === 'done', `estat ${m.status} ${m.error || ''}`);
  ok(m.email.status === 'sent', `correu ${JSON.stringify(m.email)}`);
  ok(m.segments.some((s) => s.status === 'done' && s.text), 'cap tros transcrit');
  return { id, m };
}
let micId;
await step('Gravar amb micròfon (pausa, marca, resum, correu, Google Doc)', async () => {
  const { id, m } = await record('mic', 22);
  micId = id;
  ok(m.docUrl === 'https://docs.google.com/document/d/PROVA', 'sense docUrl');
  return `trams=${m.segments.length} marques=${m.marks.length}`;
});
await step('Gravar videotrucada (PC)', async () => { const { m } = await record('call', 22); return `trams=${m.segments.length}`; });
await step('Reunió important (acta per fases)', async () => {
  const before = log.sys.length;
  await record('mic', 14, { important: true });
  const used = log.sys.slice(before).join(' ');
  ok(/ORDRE DEL DIA REAL/.test(used), 'no fa servir el pla de l\'acta professional');
  return 'pla demanat';
});

// 3. Resultat
await step('Resultat: acta, dubtes, informe, enllaç Doc', async () => {
  await p.evaluate((id) => showResult(id), micId); await waitView('result');
  ok((await p.textContent('#result-summary')).includes("enviar l'informe"), 'sense tasques');
  ok(await p.isVisible('#doubt-banner'), 'sense avís de dubtes');
  ok(await p.isVisible('#doc-link'), 'sense enllaç Google Doc');
});
await step('Escoltar l\'àudio de la transcripció', async () => {
  await p.click('details.transcript summary');
  await p.waitForTimeout(500);
  const n = await p.$$eval('#result-transcript .play-btn', (l) => l.length);
  ok(n > 0, 'sense botons ▶');
  await p.click('#result-transcript .play-btn >> nth=0'); await p.waitForTimeout(500);
  return `${n} trossos amb ▶`;
});
await step('Corregir dubtes', async () => {
  await p.click('#btn-fix-banner'); await p.waitForTimeout(300);
  const n = await p.$$eval('#fix-doubts input', (l) => l.length);
  await p.fill('#fix-doubts input >> nth=0', 'Proveïdor Garcia');
  await p.click('#btn-fix-apply'); await p.waitForTimeout(1200);
  const m = await meeting(micId);
  ok(m.corrections && m.corrections.length, 'no desa la correcció');
  return `${n} dubtes llistats`;
});
await step('Noms de qui parla', async () => {
  await p.evaluate(async (id) => { const m = await getMeeting(id); m.segments[0].text = 'Persona 1: hola\nMarta: bon dia'; await saveMeeting(m); showResult(id); }, micId);
  await p.waitForTimeout(400);
  await p.click('#btn-speakers'); await p.waitForTimeout(300);
  await p.fill('#spk-list input[data-label="Persona 1"]', 'Jordi'); await p.click('#btn-spk-apply'); await p.waitForTimeout(500);
  const m = await meeting(micId);
  ok(/^Jordi: hola/.test(m.segments[0].text) && /\*\*Jordi\*\*/.test(m.summary), 'no canvia el nom');
});
await step('Mapa mental', async () => {
  await p.click('#btn-map'); await p.waitForTimeout(400);
  const n = await p.$$eval('#map-box svg rect', (l) => l.length);
  ok(n > 5, 'mapa buit');
  await p.evaluate(() => closeSheets());
  return `${n - 1} nodes`;
});
await step('Canviar idioma (castellà)', async () => {
  await p.click('#lang-switch button[data-lang="es"]'); await p.waitForTimeout(1500);
  ok((await p.textContent('#result-summary')).includes('Resumen'), 'no tradueix');
  await p.click('#lang-switch button[data-lang="ca"]'); await p.waitForTimeout(300);
});
for (const [name, btn, magic] of [['PDF', '#btn-pdf', '%PDF'], ['Word', '#btn-docx', 'PK'], ['Markdown', '#btn-md', '# ']]) {
  await step(`Exportar ${name}`, async () => {
    await p.click('#btn-share-open'); await p.waitForTimeout(200);
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click(btn)]);
    const f = path.join(tmp, d.suggestedFilename()); await d.saveAs(f);
    ok(fs.readFileSync(f).subarray(0, magic.length).toString('latin1') === magic && fs.statSync(f).size > 300, 'fitxer erroni');
    await p.evaluate(() => closeSheets());
    return `${d.suggestedFilename()} (${Math.round(fs.statSync(f).size / 1024)} KB)`;
  });
}
await step('Compartir: copiar i WhatsApp', async () => {
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.click('#btn-share-open'); await p.click('#btn-copy'); await p.waitForTimeout(300);
  const c = await p.evaluate(() => navigator.clipboard.readText());
  await p.click('#btn-share-open'); await p.click('#btn-wa'); await p.waitForTimeout(300);
  const o = await p.evaluate(() => window.__opened[0] || '');
  ok(c.length > 50 && /wa\.me/.test(o), 'copiar o WhatsApp');
});
await step('Enviar a altres persones', async () => {
  await p.evaluate(() => closeSheets());
  await p.click('#btn-share-open'); await p.click('#btn-share'); await p.fill('#share-to', 'montse@exemple.cat');
  await p.click('#btn-share-send'); await p.waitForTimeout(1200);
  ok(log.script.some((s) => s.startsWith('altres:montse')), log.script.join('|'));
  await p.evaluate(() => closeSheets());
});
await step('Continuar gravant una reunió feta', async () => {
  await p.evaluate((id) => showResult(id), micId); await p.waitForTimeout(300);
  const before = (await meeting(micId)).segments.length;
  await p.click('#btn-continue'); await waitView('rec', 10000); await p.waitForTimeout(11000);
  await p.click('#btn-stop'); await waitView('result', 60000);
  const after = (await meeting(micId)).segments.length;
  ok(after > before, `${before} → ${after}`);
  return `${before} → ${after} trossos`;
});

// 4. Importar
await step('Importar 2 àudios → resum', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.setInputFiles('#import-input', [fx('fixtures-a2.wav'), fx('fixtures-a1.wav')]);
  await p.click('#btn-import-summary'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.summary && m.importFiles.length === 2, 'import');
});
await step('Importar → només text', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]);
  await p.click('#btn-import-text'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.textOnly && /Marta/.test(m.summary), 'només text');
});

// 5. Modes i plantilles
await step('Revisió de feina', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.click('.mode[data-mode="revisio"]');
  await p.fill('#review-name', 'Marta'); await p.fill('#review-email', 'marta@exemple.cat');
  await p.click('#btn-record'); await waitView('rec'); await p.waitForTimeout(11000);
  await p.click('#btn-stop'); await waitView('result', 60000);
  ok((await p.textContent('#btn-share-open')).includes('Marta'), 'botó Envia-ho a Marta');
});
await step('Plantilla de resum pròpia', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  await p.click('#btn-stpl-new'); await p.click('#btn-stpl-example'); await p.click('#btn-stpl-save'); await p.waitForTimeout(300);
  await p.click('#btn-tab-home'); await waitView('home');
  await p.click('.mode[data-mode="general"]');
  const chip = await p.$('.type-chip[data-type^="tpl_"]');
  ok(chip, 'no surt el xip');
  await chip.click();
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(/^# Patronat/.test(m.summary), 'no fa servir la plantilla');
  await p.click('#btn-tab-home'); await p.click('.type-chip[data-type="general"]');
});
await step('Omplir la reunió amb el calendari', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.click('.mode[data-mode="general"]');
  ok(await p.isVisible('#btn-cal-fill'), 'no surt el botó del calendari');
  await p.fill('#meeting-title', ''); await p.fill('#meeting-context', '');
  await p.click('#btn-cal-fill'); await p.waitForTimeout(800);
  const v = await p.evaluate(() => ({ t: $('#meeting-title').value, c: $('#meeting-context').value }));
  ok(v.t === 'Comitè de pressupostos', `títol: ${v.t}`);
  ok(/pere@exemple\.cat/.test(v.c) && /Sala 2/.test(v.c) && /Torn obert/.test(v.c), `context: ${v.c}`);
  await p.fill('#meeting-title', ''); await p.fill('#meeting-context', '');
});
await step('Biblioteca de plantilles i tipus Automàtic', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  await p.click('#btn-gallery'); await p.waitForSelector('#gallery-sheet:not([hidden])');
  const n = await p.$$eval('#gallery-list button', (l) => l.length);
  await p.click('#gallery-list button:has-text("Junta de veïns")'); await p.waitForTimeout(300);
  ok(await p.isDisabled('#gallery-list button:has-text("Junta de veïns")'), 'no queda afegida');
  await p.evaluate(() => closeSheets());
  await p.click('#btn-tab-home'); await waitView('home');
  ok(await p.$('.type-chip[data-type^="tpl_"]:has-text("Junta de veïns")'), 'no surt el xip nou');
  await p.click('.type-chip[data-type="auto"]');
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.type === 'auto' && m.autoType === 'comercial', `tipus ${m.type}/${m.autoType}`);
  await p.click('#btn-tab-home'); await p.click('.type-chip[data-type="general"]');
  return `${n} plantilles; detectat: ${m.autoType}`;
});
await step('Diverses versions de la reunió', async () => {
  const id = await lastId(); await p.evaluate((id) => showResult(id), id); await waitView('result');
  ok(await p.isVisible('#version-tabs'), 'sense pestanyes');
  await p.click('.ver-tab.add'); await p.waitForSelector('#ver-sheet:not([hidden])');
  await p.click('#ver-list button:has-text("Resum per a direcció")');
  await p.waitForFunction(() => (document.querySelector('#result-summary').textContent || '').includes('Per a direcció'), null, { timeout: 30000 });
  ok(!(await p.isVisible('#lang-switch')) && await p.isVisible('#btn-ver-delete'), 'controls de versió');
  await p.click('.ver-tab.add'); await p.fill('#ver-custom', 'Un correu curt per al proveïdor'); await p.click('#btn-ver-custom');
  await p.waitForFunction(() => document.querySelectorAll('.ver-tab').length === 4, null, { timeout: 30000 });
  // Copiar fa servir la versió que es mira
  await p.click('#btn-share-open').catch(() => {});
  await p.evaluate(() => closeSheets());
  await p.click('.ver-tab >> nth=0'); await p.waitForTimeout(300);
  ok((await p.textContent('#result-summary')).includes("enviar l'informe"), "no torna a l'acta");
  await p.click('.ver-tab >> nth=1'); await p.waitForTimeout(200);
  await p.click('#btn-ver-delete'); await p.waitForTimeout(500);
  const m = await meeting(id);
  ok(m.versions.length === 1 && m.summary.includes("enviar l'informe"), `versions ${m.versions.length}`);
  return `${m.versions.length} versió desada`;
});
await step('Editar la transcripció i refer l\'acta', async () => {
  const id = await lastId();
  await p.evaluate(() => { document.querySelector('details.transcript').open = true; });
  await p.click('#btn-tr-edit'); await p.waitForSelector('#tr-sheet:not([hidden])');
  const before = await p.inputValue('#tr-text');
  ok(/pressupost/.test(before), 'textarea buida');
  await p.fill('#tr-text', before.replace(/pressupost/g, 'PRESSUPOST CORREGIT'));
  const calls = log.gemini.length;
  await p.click('#btn-tr-save');
  for (let i = 0; i < 100 && log.gemini.length === calls; i++) await p.waitForTimeout(300);
  await waitStatus(id, ['done'], 60000); await waitView('result', 60000);
  const m = await meeting(id);
  ok(m.transcriptEdited && m.transcriptEdited.includes('PRESSUPOST CORREGIT'), 'no desa');
  ok(log.gemini.length > calls, "no refà l'acta");
  ok((await p.textContent('#result-transcript')).includes('PRESSUPOST CORREGIT'), 'no es veu');
  await p.evaluate(() => { document.querySelector('details.transcript').open = true; });
  await p.click('#btn-tr-edit'); await p.click('#btn-tr-original'); await p.waitForTimeout(600);
  ok(!(await meeting(id)).transcriptEdited, 'no torna a la original');
});
await step('Etiquetes automàtiques', async () => {
  const m = await meeting(await lastId());
  ok(JSON.stringify(m.tags) === '["pressupost","finances-2027"]', `etiquetes ${JSON.stringify(m.tags)}`);
  await p.click('#btn-history'); await waitView('history');
  await p.click('#history-filters .type-chip:has-text("#pressupost")'); await p.waitForTimeout(300);
  const n = await p.$$eval('#history-list li', (l) => l.length);
  const tagged = await p.$$eval('#history-list .tag', (l) => l.length);
  ok(n > 0 && tagged >= n, `filtre: ${n} reunions, ${tagged} etiquetes`);
  await p.evaluate(() => { historyFilter = { kind: 'all', value: '' }; });
  return `${n} reunions amb #pressupost`;
});
await step('Pregunta sobre aquesta reunió', async () => {
  await p.evaluate((id) => showResult(id), micId); await waitView('result');
  await p.evaluate(() => { document.querySelector('#mq').open = true; });
  await p.fill('#mq-input', 'Què va dir la Marta?'); await p.click('#btn-mq');
  await p.waitForSelector('#mq-log .mq-at', { timeout: 30000 });
  await p.click('#mq-log .mq-at'); await p.waitForTimeout(500);
  return (await p.textContent('#mq-log .bubble.a')).slice(0, 40);
});
await step('Anàlisi de la reunió', async () => {
  await p.click('#btn-more'); await p.click('#btn-analysis');
  await p.waitForFunction(() => /Temps per tema/.test(document.querySelector('#an-body').textContent), null, { timeout: 30000 });
  const m = await meeting(await p.evaluate(() => viewingId));
  ok(m.analysis, 'no es desa');
  await p.evaluate(() => closeSheets());
});
await step('Correu de seguiment a cada assistent', async () => {
  await p.click('#btn-share-open'); await p.click('#btn-followup');
  await p.waitForSelector('#fu-list .fu-card', { timeout: 30000 });
  const n = await p.$$eval('#fu-list .fu-card', (l) => l.length);
  ok(n === 1, `${n} correus (Persona 1 no hi ha de ser)`);
  await p.fill('#fu-list .fu-to', 'marta@exemple.cat');
  await p.click('#fu-list .fu-send');
  await p.waitForFunction(() => /Enviat/.test(document.querySelector('.fu-st').textContent), null, { timeout: 15000 });
  ok(log.script.some((x) => x === 'altres:marta@exemple.cat'), 'no ha sortit');
  await p.evaluate(() => closeSheets());
});
await step('Documents PDF a la reunió', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await p.setInputFiles('#docs-input', { name: 'pressupost.pdf', mimeType: 'application/pdf', buffer: pdf });
  ok(/pressupost\.pdf/.test(await p.textContent('#docs-info')), 'no surt el document');
  const before = log.mimes.length;
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.photos && m.photos[0].pdf && m.photos[0].name === 'pressupost.pdf', 'no es desa a la reunió');
  ok(log.mimes.slice(before).includes('application/pdf'), 'no arriba a Gemini');
  ok(await p.isVisible('#result-photos .thumb.doc'), 'no es veu al resultat');
});
await step('Vídeo de YouTube', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.click('#btn-youtube'); await p.fill('#yt-url', 'no és un enllaç'); await p.click('#btn-yt-summary');
  ok(/no sembla/.test(await p.textContent('#yt-msg')), 'accepta un enllaç dolent');
  await p.fill('#yt-url', 'https://youtu.be/abcDEF12345?si=x'); await p.click('#btn-yt-summary');
  await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.importFiles[0].youtube === 'https://www.youtube.com/watch?v=abcDEF12345', m.importFiles[0].youtube);
  ok(m.title === 'Xerrada de prova', `títol ${m.title}`);
  ok(m.status === 'done' && /vídeo parla del pressupost/.test(await p.textContent('#result-transcript')), 'sense transcripció');
  return `trossos=${m.importFiles[0].ytParts.length}`;
});
await step('Resum de diverses reunions', async () => {
  await p.click('#btn-history'); await waitView('history');
  ok(await p.isVisible('#btn-multi'), 'no surt el botó');
  await p.click('#btn-multi'); await p.waitForSelector('#multi-sheet:not([hidden])');
  const n = await p.$$eval('#multi-list input:checked', (l) => l.length);
  await p.click('#btn-multi-go'); await waitView('result', 30000);
  const m = await meeting(await p.evaluate(() => viewingId));
  ok(m.engine === 'digest' && m.digestOf.length === n && /Recull de prova/.test(m.summary), `recull ${m.engine}`);
  ok(!(await p.isVisible('details.transcript')), 'mostra transcripció buida');
  const tasks = await p.evaluate(async () => (await allTasks()).filter((t) => t.m.engine === 'digest').length);
  ok(tasks === 0, 'el recull duplica tasques');
  return `${n} reunions`;
});
await step("Fotos d'apunts → resum", async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#notes-input', [{ name: 'apunts1.png', mimeType: 'image/png', buffer: png }, { name: 'apunts2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') }]);
  await p.waitForSelector('#import-sheet:not([hidden])');
  ok(/2 documents/.test(await p.textContent('#import-sheet-title')), 'títol del full');
  await p.click('#btn-import-summary'); await waitView('result', 60000);
  const m = await meeting(await lastId());
  ok(m.engine === 'docs' && m.photos.length === 2, `motor ${m.engine}, ${m.photos.length} docs`);
  ok(/Revisar contracte/.test(m.segments[0].text) && /^# Apunts del pressupost/.test(m.summary), 'sense text o sense resum');
  ok(/Revisar contracte/.test(await p.textContent('#result-transcript')), 'no es veu el text');
  return m.summary.split('\n')[0];
});
await step("Apunts: el resum es fa del text llegit (sense tornar a enviar les fotos)", async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  log.recitation = true; log.blocked = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  try {
    await p.setInputFiles('#notes-input', [{ name: 'guio.png', mimeType: 'image/png', buffer: png }]);
    await p.waitForSelector('#import-sheet:not([hidden])');
    await p.click('#btn-import-summary'); await waitView('result', 90000);
  } finally { log.recitation = false; }
  const m = await meeting(await lastId());
  ok(m.status === 'done' && /^# Apunts del pressupost/.test(m.summary), `estat ${m.status} ${m.error || ''}`);
  ok(log.blocked === 0, `ha enviat les fotos al resum (${log.blocked})`);
});
await step("L'acta surt sempre, encara que Google ho bloquegi", async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  log.blockSummary = true; log.blocked = 0;
  try {
    await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary'); await waitView('result', 120000);
  } finally { log.blockSummary = false; }
  const m = await meeting(await lastId());
  ok(m.status === 'done' && /Resum per parts/.test(m.summary) && /5\.000/.test(m.summary), `estat ${m.status} ${m.error || ''} ${m.summary.slice(0, 80)}`);
  return `${log.blocked} bloquejos → acta per parts`;
});
await step('Text en directe mentre grava', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.evaluate(() => { saveSettings({ source: 'mic', liveSec: 120 }); renderSourceSwitch(); });
  await p.click('.mode[data-mode="general"]');
  await p.click('#btn-record'); await waitView('rec', 10000);
  try {
    await p.waitForSelector('#live-text p.draft', { timeout: 60000 }).catch(async (e) => {
      throw new Error(`${e.message.split('\n')[0]} · ${await p.evaluate(() => JSON.stringify({ tap: !!rec.tapNode, live: settings.liveText, st: rec.live && { n: rec.live.n, busy: rec.live.busy, off: rec.live.off, d: rec.live.drafts.length } }))}`);
    });
    const t = await p.textContent('#live-text p.draft');
    ok(/text en directe de prova/.test(t) && /esborrany/.test(await p.textContent('#live-label')), t);
    return t;
  } finally { await p.click('#btn-stop'); await waitView('result', 90000); await p.evaluate(() => saveSettings({ liveSec: 10 })); }
});
await step('Triar i provar el micròfon', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  await p.waitForFunction(() => document.querySelectorAll('#set-mic option').length > 1, null, { timeout: 10000 });
  const opts = await p.$$eval('#set-mic option', (l) => l.map((o) => [o.value, o.textContent]));
  const dev = opts.find(([v]) => v && v !== '__ask');
  ok(dev, `sense micròfons: ${JSON.stringify(opts)}`);
  await p.selectOption('#set-mic', dev[0]); await p.waitForTimeout(300);
  ok(await p.evaluate(() => settings.micId) === dev[0], 'no es desa');
  await p.click('#btn-mic-test');
  await p.waitForFunction(() => /✓|fluix|No arriba/.test(document.querySelector('#mic-test-msg').textContent), null, { timeout: 15000 });
  const msg = await p.textContent('#mic-test-msg');
  // Es grava amb el micròfon triat
  await p.click('#btn-tab-home'); await waitView('home');
  await p.evaluate(() => { saveSettings({ source: 'mic' }); renderSourceSwitch(); });
  await p.click('#btn-record'); await waitView('rec', 10000);
  const used = await p.evaluate(() => rec.stream.getAudioTracks()[0].getSettings().deviceId);
  await p.click('#btn-stop'); await waitView('result', 90000);
  ok(used === dev[0], `grava amb ${used}`);
  await p.evaluate(() => saveSettings({ micId: '', micLabel: '' }));
  return `${dev[1]} · ${msg}`;
});
await step('Trossos «en silenci»: es tornen a provar abans de donar error', async () => {
  const id = await p.evaluate(async () => {
    const id = uid();
    for (let i = 0; i < 2; i++) await db.put('audio', pcmToWav(new Float32Array(32000), 16000), audioKey(id, i));
    await saveMeeting({ id, title: 'Micròfon fluix', startedAt: Date.now(), createdAt: Date.now(), durationMs: 120000, engine: 'audio', source: 'mic', type: 'general', status: 'processing', marks: [], summary: '', email: { status: 'pending' },
      segments: [{ idx: 0, startMs: 0, status: 'done', text: '', silent: true }, { idx: 1, startMs: 60000, status: 'done', text: '', silent: true }] });
    runPipeline(id);
    return id;
  });
  await waitStatus(id, ['done', 'error'], 60000);
  const m = await meeting(id);
  ok(m.status === 'done' && m.segments.every((x) => x.text), `estat ${m.status} ${m.error || ''}`);
  return 'transcrit a la segona';
});
await step('Trucada durant la gravació: avís gran i continua', async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  await p.evaluate(() => { saveSettings({ source: 'mic', liveSec: 120 }); renderSourceSwitch(); });
  await p.click('#btn-record'); await waitView('rec', 10000);
  try {
    await p.waitForTimeout(2000);
    // Entra una trucada: el micròfon queda mut
    await p.evaluate(() => { const t = rec.stream.getAudioTracks()[0]; Object.defineProperty(t, 'muted', { get: () => true }); t.dispatchEvent(new Event('mute')); });
    await p.waitForTimeout(400);
    ok(await p.isVisible('#resume-rec') && /No s'està gravant/.test(await p.textContent('#resume-rec')), 'no surt l\'avís gran');
    // Es penja: torna a gravar sol i l'avís desapareix
    await p.waitForFunction(() => $('#resume-rec').hidden && rec.recorder && rec.recorder.state === 'recording' && !rec.stream.getAudioTracks()[0].muted, null, { timeout: 15000 });
    // Segona trucada, i el mòbil no deixa obrir el micròfon sense un toc
    await p.evaluate(() => { const t = rec.stream.getAudioTracks()[0]; Object.defineProperty(t, 'muted', { get: () => true }); window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); t.dispatchEvent(new Event('mute')); });
    await p.waitForTimeout(6000);
    ok(await p.isVisible('#btn-resume-rec'), 'sense botó per continuar');
    await p.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; });
    await p.click('#btn-resume-rec');
    await p.waitForFunction(() => $('#resume-rec').hidden && rec.recorder && rec.recorder.state === 'recording', null, { timeout: 15000 });
  } finally { await p.click('#btn-stop'); await waitView('result', 90000); await p.evaluate(() => saveSettings({ liveSec: 10 })); }
  const m = await meeting(await lastId());
  ok(m.status === 'done', `estat ${m.status} ${m.error || ''}`);
  return `${m.segments.length} trams`;
});
await step('Importar una gravació llarga (trossos alhora)', async () => {
  // 13 minuts de so a 8 kHz
  const rate = 8000, secs = 13 * 60, n = rate * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 3000 * (((i / rate) % 4) < 2 ? 1 : 0.05)), 44 + i * 2);
  const file = path.join(tmp, 'llarga.wav'); fs.writeFileSync(file, buf);
  await p.click('#btn-tab-home'); await waitView('home');
  // Compta quantes crides a Gemini van alhora dins de l'app.
  await p.evaluate(() => { if (window.__wrapped) { window.__m = 0; return; } window.__wrapped = true; window.__c = 0; window.__m = 0; const g = gemini; gemini = async (...a) => { window.__c++; window.__m = Math.max(window.__m, window.__c); try { return await g(...a); } finally { window.__c--; } }; });
  const t0 = Date.now();
  await p.setInputFiles('#import-input', [file]); await p.click('#btn-import-text'); await waitView('result', 120000);
  const m = await meeting(await lastId());
  const tr = buildOrder(m.summary);
  ok(m.status === 'done' && tr.length >= 3, `estat ${m.status}, ${tr.length} trossos`);
  ok(tr.every((x, i) => x === i + 1), `ordre ${tr.join(',')}`);
  const alhora = await p.evaluate(() => window.__m);
  ok(alhora >= 2, `no van alhora (màx ${alhora})`);
  return `${tr.length} trossos, ${alhora} alhora, ${Math.round((Date.now() - t0) / 1000)} s`;
});
await step("Reunió llarga: trams pendents alhora i l'acta surt abans del correu", async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  log.slowSeg = true; log.slowScript = true;
  try {
    const id = await p.evaluate(async () => {
      if (!window.__wrapped) { window.__wrapped = true; window.__c = 0; const g = gemini; gemini = async (...a) => { window.__c++; window.__m = Math.max(window.__m || 0, window.__c); try { return await g(...a); } finally { window.__c--; } }; }
      window.__m = 0;
      const id = uid();
      const segs = [];
      for (let i = 0; i < 8; i++) { await db.put('audio', pcmToWav(new Float32Array(16000).map((_, k) => Math.sin(k / 5) * 0.3), 16000), audioKey(id, i)); segs.push({ idx: i, startMs: i * 60000, status: 'pending', text: '' }); }
      await saveMeeting({ id, title: 'Llarga', startedAt: Date.now(), createdAt: Date.now(), durationMs: 480000, engine: 'audio', source: 'mic', type: 'general', status: 'processing', marks: [], summary: '', email: { status: 'pending' }, segments: segs });
      viewingId = id; showView('proc'); runPipeline(id);
      return id;
    });
    // L'acta es veu mentre el correu encara s'està enviant
    await p.waitForFunction(() => currentView === 'result' && /Acta feta/.test($('#result-status').textContent), null, { timeout: 60000 });
    const early = await p.evaluate(() => ({ email: !!pipelines.size, text: $('#result-summary').textContent.length }));
    await p.waitForFunction(() => /Resum enviat/.test($('#result-status').textContent), null, { timeout: 30000 });
    const alhora = await p.evaluate(() => window.__m);
    const m = await meeting(id);
    ok(early.email && early.text > 50, 'no surt abans del correu');
    ok(alhora >= 2, `els trams no van alhora (${alhora})`);
    ok(m.status === 'done' && m.segments.every((x) => x.status === 'done'), `estat ${m.status}`);
    return `${alhora} trams alhora; acta visible abans del correu`;
  } finally { log.slowSeg = false; log.slowScript = false; }
});
await step('Reunió important: cada punt rep només el seu tros', async () => {
  const r = await p.evaluate(() => {
    const lines = [];
    for (let min = 0; min < 120; min++) lines.push(`[${String(min).padStart(2, '0')}:00]`, `Marta: minut ${min} ${'bla '.repeat(30)}`);
    const t = lines.join('\n');
    const part = sliceTranscript(t, 30 * 60000, 40 * 60000);
    return { total: t.length, part: part.length, from: /minut 26 /.test(part), to: /minut 44 /.test(part), out: /minut 50 /.test(part) || /minut 20 /.test(part) };
  });
  ok(r.from && r.to && !r.out, JSON.stringify(r));
  return `${Math.round(r.part / r.total * 100)}% de la transcripció per punt`;
});
await step("Petició penjada: en tornar a l'app continua de seguida", async () => {
  await p.click('#btn-tab-home'); await waitView('home');
  log.hang = true; log.hung = 0;
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary');
  await p.waitForFunction(() => currentView === 'proc', null, { timeout: 15000 });
  for (let i = 0; i < 40 && !log.hung; i++) await p.waitForTimeout(250);
  ok(log.hung > 0, 'cap petició penjada');
  const id = await p.evaluate(() => viewingId);
  // El mòbil s'adorm i es desperta: les peticions mortes es tallen i es tornen a fer
  log.hang = false;
  const t0 = Date.now();
  await p.evaluate(() => abortGeminiInflight());
  await waitStatus(id, ['done'], 60000);
  const secs = Math.round((Date.now() - t0) / 1000);
  ok(secs < 30, `ha trigat ${secs} s`);
  return `acabada ${secs} s després de despertar`;
});
await step('Plantilla de PDF amb logotip', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  await p.click('#btn-tpl-new'); await p.fill('#tpl-name', 'Esportec'); await p.fill('#tpl-org', 'Esportec SL');
  await p.setInputFiles('#tpl-logo-input', path.join(root, 'icons', 'icon-192.png')); await p.waitForTimeout(400);
  await p.click('#btn-tpl-save'); await p.waitForTimeout(300);
  await p.evaluate((id) => showResult(id), micId); await p.waitForTimeout(300);
  await p.click('#btn-share-open'); await p.click('#btn-pdf'); await p.waitForTimeout(300);
  const n = await p.$$eval('#pdf-pick-list .sheet-row', (l) => l.length);
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#pdf-pick-list .sheet-row >> nth=0')]);
  ok(n === 2 && d, 'tria de plantilla');
  await p.evaluate(() => closeSheets());
});

// 6. Tasques, historial, pregunta
await step('Tasques: llista, fetes, persona, calendari, enviar', async () => {
  await p.evaluate(() => showView('tasks')); await p.waitForTimeout(500);
  const n = await p.$$eval('#tasks-list .task-card', (l) => l.length);
  ok(n > 0, 'sense tasques');
  await p.click('#tasks-list .task-card >> nth=0 >> input'); await p.waitForTimeout(300);
  await p.click('#tasks-people .type-chip >> text=Marta'); await p.waitForTimeout(200);
  await p.click('#tasks-list .task-cal >> nth=0'); await p.waitForTimeout(200);
  const date = await p.inputValue('#cal-date');
  const [ics] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('#btn-cal-ics')]);
  const sendVisible = await p.isVisible('#btn-tasks-send');
  if (sendVisible) { await p.click('#btn-tasks-send'); await p.waitForTimeout(800); }
  ok(date && ics, 'calendari');
  return `${n} pendents · data ${date}${sendVisible ? ' · enviades' : ''}`;
});
await step('Historial: llista i cerca', async () => {
  await p.click('#btn-history'); await waitView('history'); await p.waitForTimeout(600);
  const n = await p.$$eval('#history-list > *', (l) => l.length);
  await p.fill('#history-search', 'Prova mic'); await p.waitForTimeout(300);
  const n2 = await p.$$eval('#history-list > *', (l) => l.length);
  await p.fill('#history-search', '');
  ok(n >= 6 && n2 >= 1, `${n} / ${n2}`);
  return `${n} reunions`;
});
await step('Pregunta a les reunions', async () => {
  await p.click('#btn-tab-ask'); await waitView('ask');
  await p.fill('#ask-input', 'Quin és el pressupost?'); await p.click('#btn-ask'); await p.waitForTimeout(2000);
  ok(/5\.000/.test(await p.textContent('#ask-log')), 'sense resposta');
});

// 7. Còpia, privadesa, errors, Google
await step('Còpia de seguretat i restaurar', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#btn-backup')]);
  const f = path.join(tmp, 'backup.json'); await d.saveAs(f);
  const n = JSON.parse(fs.readFileSync(f, 'utf8')).meetings.length;
  await p.evaluate(async () => { for (const m of await db.all('meetings')) await db.del('meetings', m.id); meetingCache.clear(); });
  await p.setInputFiles('#restore-input', f); await p.waitForTimeout(2000);
  const n2 = (await p.evaluate(() => db.all('meetings'))).length;
  ok(n2 === n, `${n} vs ${n2}`);
  return `${n} reunions`;
});
await step('Privadesa: esborrar àudio i reunions antigues', async () => {
  await p.evaluate(async () => {
    const old = Date.now() - 400 * 86400000;
    await db.put('audio', new Blob(['x'.repeat(3000)]), 'vell:0');
    await db.put('meetings', { id: 'vell', title: 'Molt antiga', startedAt: old, doneAt: old, updatedAt: old, durationMs: 1, engine: 'audio', status: 'done', segments: [{ idx: 0, startMs: 0, status: 'done', text: 'a' }], marks: [], summary: '# Vella', email: { status: 'off' } });
    meetingCache.delete('vell');
  });
  await p.evaluate(async () => {
    const old = Date.now() - 400 * 86400000;
    // importada avui però amb un fitxer antic: no s'ha d'esborrar
    await saveMeeting({ id: 'importvella', title: 'Fitxer antic', startedAt: old, createdAt: Date.now(), doneAt: Date.now(), durationMs: 1, engine: 'import', status: 'done', segments: [], marks: [], summary: '# Nova', email: { status: 'off' } });
    // amb error (pendent de reintent): no s'ha d'esborrar
    await db.put('meetings', { id: 'errvella', title: 'Error', startedAt: old, updatedAt: old, durationMs: 1, engine: 'audio', status: 'error', segments: [], marks: [], summary: '', email: { status: 'off' } });
    // tros buit: el seu àudio es guarda encara que s'esborri la resta
    await db.put('audio', new Blob(['y'.repeat(3000)]), 'buit:1'); await db.put('audio', new Blob(['z'.repeat(3000)]), 'buit:0');
    await saveMeeting({ id: 'buit', title: 'Buit', startedAt: Date.now(), doneAt: Date.now() - 40 * 86400000, durationMs: 1, engine: 'audio', status: 'done', segments: [{ idx: 0, startMs: 0, status: 'done', text: 'hola' }, { idx: 1, startMs: 60000, status: 'done', text: '', empty: true }], marks: [], summary: '# B', email: { status: 'off' } });
    // perquè «buit» no compti com a vella per a les reunions, però sí per a l'àudio (30 dies)
    const mm = await getMeeting('buit'); mm.updatedAt = Date.now(); await db.put('meetings', mm);
  });
  await p.click('#btn-settings'); await waitView('settings');
  await p.selectOption('#set-meeting-days', '365'); await p.selectOption('#set-audio-days', '30'); await p.click('#btn-save-settings'); await p.waitForTimeout(1500);
  const gone = await p.evaluate(async () => !(await db.get('meetings', 'vell')) && !(await db.get('audio', 'vell:0')));
  const kept = await p.evaluate(async () => ({ imp: !!(await db.get('meetings', 'importvella')), err: !!(await db.get('meetings', 'errvella')), buit1: !!(await db.get('audio', 'buit:1')), buit0: !!(await db.get('audio', 'buit:0')) }));
  ok(kept.imp && kept.err && kept.buit1 && !kept.buit0, `conservació incorrecta ${JSON.stringify(kept)}`);
  await p.click('#btn-settings'); await p.selectOption('#set-audio-days', '7'); await p.click('#btn-save-settings');
  await p.click('#btn-settings'); await p.selectOption('#set-meeting-days', '0'); await p.click('#btn-save-settings');
  ok(gone, 'no esborra la reunió antiga');
});
await step('Error de Google (503) i reintent', async () => {
  geminiFail = 100;
  await p.click('#btn-tab-home'); await waitView('home');
  await p.setInputFiles('#import-input', [fx('fixtures-a1.wav')]); await p.click('#btn-import-summary');
  await p.waitForTimeout(1500);
  const id = await p.evaluate(() => viewingId);
  await waitStatus(id, ['error'], 200000);
  await p.waitForSelector('#btn-retry', { timeout: 10000 });
  const msg = await p.textContent('#result-status');
  geminiFail = 0; await p.click('#btn-retry'); await waitStatus(id, ['done'], 60000);
  return msg.slice(0, 50);
});
await step('Esborrar una reunió', async () => {
  const before = (await p.evaluate(() => db.all('meetings'))).length;
  await p.click('#btn-more'); await p.click('#btn-delete'); await p.waitForTimeout(600);
  const after = (await p.evaluate(() => db.all('meetings'))).length;
  ok(after === before - 1, `${before} → ${after}`);
});
await step('Google: identificador i enllaç per vincular', async () => {
  await p.click('#btn-settings'); await waitView('settings');
  ok(await p.isVisible('#gcid-setup'), 'no surt la configuració');
  await p.fill('#set-gcid', '1234-abc.apps.googleusercontent.com'); await p.click('#btn-gcid-save'); await p.waitForTimeout(300);
  ok(await p.isVisible('#btn-google-signin') && await p.isVisible('#btn-gcid-link'), 'no surt «Entra amb Google»');
  await p.click('#btn-gcid-link'); await p.waitForTimeout(300);
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(/\?gcid=1234-abc\.apps\.googleusercontent\.com/.test(link), link);
  // Un altre aparell obre l'enllaç
  const p2 = await ctx.newPage();
  await p2.goto(link.replace(/^https?:\/\/[^/]+\/[^?]*/, URL0)); await p2.waitForTimeout(800);
  const got = await p2.evaluate(() => localStorage.getItem('googleClientId'));
  await p2.close();
  ok(got === '1234-abc.apps.googleusercontent.com', `rebut: ${got}`);
  await p.evaluate(() => { localStorage.removeItem('googleClientId'); renderAccount(); });
});
await step('Avís d\'actualització', async () => {
  fakeVersion = { v: 999, notes: 'Prova' }; await p.evaluate(() => checkForUpdate()); await p.waitForTimeout(600);
  ok(await p.isVisible('#update-banner'), 'sense avís'); fakeVersion = null;
});
await step('Gravar amb un toc (?rec=1)', async () => {
  await p.goto(URL0 + '?rec=1'); await p.waitForTimeout(1200);
  ok(await p.isVisible('#quick-rec'), 'no surt el botó gran');
  ok(!/rec=1/.test(p.url()), "l'adreça conserva ?rec=1");
  await p.click('#btn-quick-rec'); await waitView('rec', 15000);
  await p.waitForTimeout(3000);
  await p.click('#btn-stop'); await waitView('result', 90000);
  // L'ajust: en obrir l'app també surt
  await p.evaluate(() => saveSettings({ quickStart: true })); await p.reload(); await p.waitForTimeout(1200);
  ok(await p.isVisible('#quick-rec'), 'amb l\'ajust no surt');
  await p.click('#btn-quick-no'); ok(!(await p.isVisible('#quick-rec')), 'no es tanca');
  await p.evaluate(() => saveSettings({ quickStart: false }));
});
await step('Instruccions a Gemini sense noms d\'exemple', async () => {
  const all = log.sys.join(' ');
  ok(!/Oriol|Montse|quedem dijous|Pressupost 2027, 6/.test(all), 'hi ha noms d\'exemple');
  ok(/REGLA PRINCIPAL/.test(all), 'falta la regla de no inventar');
});

console.log(results.join('\n'));
console.log(`\nGemini: ${log.gemini.length} crides · Script: ${log.script.length} crides`);
console.log(errors.length ? `Errors de la pàgina:\n${errors.join('\n')}` : 'Errors de la pàgina: cap');
const failed = results.filter((r) => r.startsWith('❌')).length;
console.log(failed ? `\n${failed} PROVES HAN FALLAT (captures a ${tmp})` : '\nTOTES LES PROVES HAN PASSAT');
await b.close(); srv.close();
process.exit(failed ? 1 : 0);
