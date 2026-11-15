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
const log = { gemini: [], script: [], sys: [] };
let geminiFail = 0;
const SUMMARY = "# Reunió de prova\n\n## Resum\nS'ha parlat del pressupost.\n\n## Desenvolupament de la reunió\n### Pressupost\n- Aprovat amb canvis.\n\n## Decisions\n- Tirar endavant.\n\n## Tasques\n- [ ] **Marta**: enviar l'informe — divendres\n- [ ] **Persona 1**: revisar el contracte [dubte de comprensió] — dilluns\n\n## Temes oberts i propers passos\n- Cap.\n\n## Dades clau\n- 5.000 €\n\n## Dubtes de comprensió\n- No s'entén el nom del proveïdor.";
await ctx.route(/generativelanguage\.googleapis\.com/, async (r) => {
  const url = r.request().url();
  if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[{"name":"models/x"}]}' });
  if (geminiFail > 0) { geminiFail--; return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":503,"status":"UNAVAILABLE","message":"overloaded"}}' }); }
  const body = r.request().postDataJSON();
  const parts = body.contents[0].parts;
  const sys = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
  const user = parts.filter((x) => x.text).map((x) => x.text).join(' ');
  if (sys) log.sys.push(sys);
  let txt;
  if (sys.includes("editor d'actes")) txt = SUMMARY.replace('[dubte de comprensió] ', '').replace("- No s'entén el nom del proveïdor.", '- Cap.');
  else if (sys.includes('Tradueix') || sys.includes('traductor')) txt = SUMMARY.replace('## Resum', '## Resumen');
  else if (sys.includes("estructura de l'usuari")) txt = '# Patronat\n\n## Assistents\n- Marta\n\n## Acords\n- Cap.\n\n## Tasques\n- Cap.';
  else if (/secretari|resumeix gravacions|document de revisió/.test(sys)) txt = SUMMARY;
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
  log.script.push(d.recipients ? `altres:${d.recipients.join(',')}` : `auto:${d.subject}`);
  await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sentTo: d.recipients || [d.to], docUrl: 'https://docs.google.com/document/d/PROVA' }) });
});
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
const waitView = (v, t = 30000) => p.waitForFunction((v) => currentView === v, v, { timeout: t });
const waitStatus = async (id, want, ms = 60000) => { const t0 = Date.now(); for (;;) { const st = await p.evaluate(async (id) => { const m = await getMeeting(id); return m && m.status; }, id); if (want.includes(st)) return st; if (Date.now() - t0 > ms) throw new Error(`estat ${st}`); await p.waitForTimeout(300); } };
const lastId = () => p.evaluate(async () => (await db.all('meetings')).sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
const meeting = (id) => p.evaluate((id) => getMeeting(id), id);
const fx = (f) => path.join(here, f);

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
  if (mode === 'call') { await p.waitForSelector('#consent-sheet:not([hidden])'); await p.check('#consent-ok'); await p.click('#btn-consent-start'); }
  await waitView('rec', 10000);
  await p.waitForTimeout(secs * 500);
  await p.click('#btn-mark');
  await p.click('#btn-pause'); await p.waitForTimeout(1200);
  ok(await p.textContent('#rec-state-text') === 'En pausa', 'no pausa');
  await p.click('#btn-pause'); await p.waitForTimeout(secs * 500);
  await p.click('#btn-stop');
  await waitView('result', 90000);
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
