// Prova que la gravació sempre arrenca, també amb el comportament de l'iPhone (motor d'àudio
// que no es pot reprendre fora d'un toc, bloqueig de pantalla que no respon, micròfon penjat).
// Ús: node tests/gravacio-ios.mjs   (des de l'arrel del projecte o des de tests/)
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

const b = await chromium.launch({ executablePath: exe, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });

const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message)); p.on('dialog', d => d.accept());
await ctx.route(/generativelanguage/, async (r) => { if (r.request().method() === 'GET') return r.fulfill({ status: 200, body: '{}' }); const sys = r.request().postDataJSON().systemInstruction; const txt = sys ? '# R\n\n## Resum\nok' : 'Marta: hola'; const pl = JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] }, finishReason: 'STOP' }] }); const sse = r.request().url().includes('alt=sse'); await r.fulfill({ status: 200, contentType: sse ? 'text/event-stream' : 'application/json', body: sse ? `data: ${pl}\n\n` : pl }); });
await ctx.route(/fonts\./, r => r.fulfill({ status: 200, body: '' }));
await p.goto(URL0);
await p.evaluate(() => localStorage.setItem('settings', JSON.stringify({ geminiKey: 'AQ.t', v: 3, liveSec: 10, speakers: false })));
await p.reload(); await p.waitForTimeout(500);
const recOnce = async (label) => {
  const t0 = Date.now();
  await p.click('#btn-record');
  try { await p.waitForFunction(() => currentView === 'rec', null, { timeout: 30000 }); } catch { console.log(label, '→ NO HA COMENÇAT', await p.evaluate(() => ({ starting: rec.starting, toast: document.querySelector('#toast').textContent }))); return; }
  console.log(label, `→ gravant en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.waitForTimeout(11000); await p.click('#btn-stop');
  await p.waitForFunction(() => currentView === 'result' && !pipelines.size, null, { timeout: 30000 });
  const m = await p.evaluate(async () => { const all = (await db.all('meetings')).sort((a, b) => b.updatedAt - a.updatedAt); return all[0]; });
  console.log('   trossos:', m.segments.map(s => s.silent ? 's' : (s.text ? 'T' : '-')).join(''), '| estat:', m.status);
  await p.evaluate(() => showView('home'));
};
await recOnce('1a reunió (normal)');
// Simula l'iPhone: fora d'un toc, «resume» no respon mai, i el bloqueig de pantalla tampoc
await p.evaluate(() => {
  const orig = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function () { return navigator.userActivation && navigator.userActivation.isActive ? orig.call(this) : new Promise(() => {}); };
  navigator.wakeLock && (navigator.wakeLock.request = () => new Promise(() => {}));
});
await recOnce('2a reunió (iPhone simulat)');
await recOnce('3a reunió (iPhone simulat)');
// Micròfon que no respon mai → el vigilant ho ha d'aturar i deixar tornar-ho a provar
await p.evaluate(() => { window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); });
const t0 = Date.now(); await p.click('#btn-record');
await p.waitForFunction(() => !rec.starting, null, { timeout: 40000 });
console.log(`micròfon penjat → alliberat en ${((Date.now() - t0) / 1000).toFixed(0)} s | missatge: ${(await p.textContent('#toast')).slice(0, 60)} | botó actiu: ${!(await p.isDisabled('#btn-record'))}`);
await p.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; });
await recOnce('després del micròfon penjat');
await b.close(); srv.close();
