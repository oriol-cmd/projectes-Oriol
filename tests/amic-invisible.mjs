// Prova de punta a punta del tauler de l'amic invisible (Sheets i Apps Script simulats).
// Ús: node tests/amic-invisible.mjs [carpeta-per-a-captures]
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'amic-invisible');
const shots = process.argv[2];
const pwPath = ['/opt/node-tools/node_modules/playwright-core/index.mjs'].find((p) => fs.existsSync(p));
const { chromium } = await import(pwPath || 'playwright');

// ---------- Google simulat ----------
function makeSheet(name) {
  const data = [];
  const width = () => Math.max(1, ...data.map((r) => r.length));
  return {
    name, data, hidden: false,
    appendRow(r) { data.push(r.slice()); },
    getLastRow() { return data.length; },
    getDataRange() { return { getValues: () => data.map((r) => Array.from({ length: width() }, (_, i) => (r[i] === undefined ? '' : r[i]))) }; },
    getRange(row, col, nr = 1, nc = 1) {
      return {
        setValues(vals) { for (let i = 0; i < nr; i++) { data[row - 1 + i] = data[row - 1 + i] || []; for (let j = 0; j < nc; j++) data[row - 1 + i][col - 1 + j] = vals[i][j]; } },
        setNumberFormat() { return this; },
      };
    },
    deleteRow(r) { data.splice(r - 1, 1); },
    hideSheet() { this.hidden = true; },
    setFrozenRows() {},
  };
}
const sheets = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/PROVA/exec' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
  },
  HtmlService: {},
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8'), ctx);
const gs = (code) => vm.runInContext(code, ctx);

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

console.log('Servidor');
const people = gs('prepara()');
ok(people.length === 8 && people.every((p) => /^[A-Z][A-Z2-9]{5}$/.test(p[1])), 'prepara crea 8 codis de 6 caràcters');
ok(people[0][2].endsWith('?codi=' + people[0][1]), 'enllaç personal amb el codi');
ok(sheets.Marques.hidden, 'la pestanya Marques queda amagada');
const again = gs('prepara()');
ok(again.every((p, i) => p[1] === people[i][1]), 'tornar a executar prepara conserva els codis');
const code = Object.fromEntries(people.map((p) => [p[0], p[1]]));
let err = ''; try { gs('entra("ZZZZZZ")'); } catch (e) { err = e.message; }
ok(err === 'codi-incorrecte', 'un codi inventat no entra');
const a1 = gs(`afegeix(${JSON.stringify(code.Anna)}, {text: "=HYPERLINK(1)", link: "amazon.es/llibre", price: "15 €"})`);
ok(a1.mine[0].text.startsWith("'="), 'no es poden colar fórmules al full');
ok(a1.mine[0].link === 'https://amazon.es/llibre', 'enllaç sense https es completa');
const own = gs(`marca(${JSON.stringify(code.Anna)}, ${JSON.stringify(a1.mine[0].id)})`);
ok(/propis/.test(own.error), 'no pots marcar els teus desitjos');
gs(`esborra(${JSON.stringify(code.Anna)}, ${JSON.stringify(a1.mine[0].id)})`);

// ---------- Navegador ----------
console.log('Navegador');
const browser = await chromium.launch();
const html = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');

async function open(name, { viaLink = true, viewport = { width: 1100, height: 900 }, scheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  page.on('pageerror', (e) => { console.log('  ✗ error a la pàgina: ' + e.message); fails++; });
  await page.exposeFunction('__gas', (fn, args) => {
    try { return { ok: ctx[fn](...args) }; } catch (e) { return { err: e.message }; }
  });
  await page.addInitScript(({ c }) => {
    const runner = (succ, fail) => new Proxy({}, {
      get(_, k) {
        if (k === 'withSuccessHandler') return (f) => runner(f, fail);
        if (k === 'withFailureHandler') return (f) => runner(succ, f);
        return (...args) => window.__gas(k, JSON.parse(JSON.stringify(args))).then((r) => (r.err ? fail && fail(new Error(r.err)) : succ && succ(r.ok)));
      },
    });
    window.google = { script: { run: runner(), url: { getLocation: (cb) => setTimeout(() => cb({ parameter: c ? { codi: c } : {} }), 0) } } };
  }, { c: viaLink ? code[name] : '' });
  await page.route('https://amic.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('https://amic.test/');
  return page;
}

// Anna entra amb l'enllaç personal i escriu dos desitjos.
const anna = await open('Anna');
await anna.waitForSelector('#app:not([hidden])');
ok((await anna.textContent('#hello')) === 'Hola, Anna', 'l\'enllaç personal entra directament');
for (const [t, l, p] of [['Llibre de cuina japonesa', 'https://example.com/llibre', '20 €'], ['Mitjons gruixuts de llana', '', '']]) {
  await anna.fill('#wText', t); await anna.fill('#wLink', l); await anna.fill('#wPrice', p);
  await anna.click('#saveBtn');
  await anna.waitForFunction((t) => document.querySelector('#mineList').textContent.includes(t), t);
}
ok((await anna.locator('#mineList .tag').count()) === 2, 'Anna té 2 desitjos');

// Bernat entra escrivint el codi i en marca un.
const bernat = await open('Bernat', { viaLink: false });
await bernat.waitForSelector('#login:not([hidden])');
await bernat.fill('#code', code.Bernat.toLowerCase());
await bernat.click('#loginBtn');
await bernat.waitForSelector('#app:not([hidden])');
ok(true, 'en Bernat entra escrivint el codi en minúscules');
await bernat.click('#tabOthers');
const annaSec = bernat.locator('.person', { hasText: 'Anna' });
await annaSec.locator('.tag', { hasText: 'Llibre' }).getByRole('button', { name: 'El regalo jo' }).click();
await annaSec.locator('.tag.is-mine').waitFor();
ok(await annaSec.locator('.tag', { hasText: 'Llibre' }).locator('.chip.mine').isVisible(), 'en Bernat veu «El regales tu»');

// La Carla el veu agafat i no el pot marcar.
const carla = await open('Carla', { viewport: { width: 390, height: 844 } });
await carla.waitForSelector('#app:not([hidden])');
await carla.click('#tabOthers');
const forCarla = carla.locator('.person', { hasText: 'Anna' }).locator('.tag', { hasText: 'Llibre' });
ok(await forCarla.locator('.chip.taken').isVisible(), 'la Carla el veu «Ja està agafat»');
ok((await forCarla.getByRole('button').count()) === 0, 'la Carla no el pot marcar');
const llibre = gs(`entra(${JSON.stringify(code.Anna)})`).mine.find((w) => w.text.startsWith('Llibre')).id;
const r = gs(`marca(${JSON.stringify(code.Carla)}, ${JSON.stringify(llibre)})`);
ok(/avançat/.test(r.error), 'el servidor tampoc deixa marcar-lo dues vegades');
const carlaW = await carla.evaluate(() => document.documentElement.scrollWidth);
ok(carlaW <= 390, 'al mòbil no hi ha desplaçament lateral');

// L'Anna no en sap res.
await anna.reload();
await anna.waitForSelector('#app:not([hidden])');
const annaView = gs(`entra(${JSON.stringify(code.Anna)})`);
ok(annaView.mine.every((w) => !('status' in w)), 'el servidor no envia a l\'Anna cap marca dels seus desitjos');
ok(!/agafat|regales/i.test(await anna.textContent('#paneMine')), 'la pàgina de l\'Anna no mostra res marcat');
const carlaView = gs(`entra(${JSON.stringify(code.Carla)})`);
const keys = new Set(carlaView.others.flatMap((o) => o.wishes.flatMap((w) => Object.keys(w))));
ok([...keys].sort().join() === 'id,link,price,status,text', 'als altres només els arriba «agafat», mai qui');

// En Bernat desmarca.
await annaSec.locator('.tag', { hasText: 'Llibre' }).getByRole('button', { name: 'Desmarca' }).click();
await annaSec.locator('.tag', { hasText: 'Llibre' }).locator('.chip.free').waitFor();
ok(true, 'en Bernat desmarca i torna a estar lliure');
await annaSec.locator('.tag', { hasText: 'Llibre' }).getByRole('button', { name: 'El regalo jo' }).click();
await annaSec.locator('.tag.is-mine').waitFor();

// Editar i esborrar (amb confirmació).
await anna.locator('#mineList .tag', { hasText: 'Mitjons' }).getByRole('button', { name: 'Edita' }).click();
await anna.fill('#wText', 'Mitjons gruixuts de llana merino');
await anna.click('#saveBtn');
await anna.waitForFunction(() => document.querySelector('#mineList').textContent.includes('merino'));
ok(true, 'l\'Anna edita un desig');
const del = anna.locator('#mineList .tag', { hasText: 'merino' }).getByRole('button', { name: /Esborra/ });
await del.click();
ok((await del.textContent()) === 'Segur? Esborra', 'esborrar demana confirmació');
await del.click();
await anna.waitForFunction(() => !document.querySelector('#mineList').textContent.includes('merino'));
ok(true, 'l\'Anna l\'esborra');

if (shots) {
  fs.mkdirSync(shots, { recursive: true });
  for (const [n, t] of [['David', 'Auriculars sense fil'], ['David', 'Entrades per al teatre'], ['Elena', 'Una planta per al balcó'], ['Carla', 'Joc de taula cooperatiu']]) {
    gs(`afegeix(${JSON.stringify(code[n])}, {text: ${JSON.stringify(t)}, price: "20 €"})`);
  }
  const david = gs(`entra(${JSON.stringify(code.David)})`).mine[0].id;
  gs(`marca(${JSON.stringify(code.Elena)}, ${JSON.stringify(david)})`);
  const cleanUp = async (p) => { await p.evaluate(() => { document.getElementById('toast').hidden = true; }); };
  const m = await open('Carla', { viewport: { width: 390, height: 844 } });
  await m.waitForSelector('#app:not([hidden])');
  await m.click('#tabOthers');
  await cleanUp(m);
  await m.screenshot({ path: path.join(shots, 'mobil-els-altres.png'), fullPage: true });
  await m.click('#tabMine');
  await m.screenshot({ path: path.join(shots, 'mobil-la-meva-llista.png'), fullPage: true });
  const d = await open('Bernat', { scheme: 'dark' });
  await d.waitForSelector('#app:not([hidden])');
  await d.click('#tabOthers');
  await cleanUp(d);
  await d.screenshot({ path: path.join(shots, 'ordinador-fosc.png'), fullPage: true });
}

await browser.close();
console.log(fails ? `\n${fails} proves han fallat` : '\nTot correcte');
process.exit(fails ? 1 : 0);
