// Prova de punta a punta del tauler de temes de l'amic invisible (Sheets i Apps Script simulats).
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
const J = JSON.stringify;

console.log('Servidor');
const people = gs('prepara()');
ok(people.length === 8 && people.every((p) => /^[A-Z][A-Z2-9]{5}$/.test(p[1])), 'prepara crea 8 codis de 6 caràcters');
ok(people[0][2].endsWith('?codi=' + people[0][1]), 'enllaç personal amb el codi');
ok(sheets.Tries.hidden, 'la pestanya Tries queda amagada');
const again = gs('prepara()');
ok(again.every((p, i) => p[1] === people[i][1]), 'tornar a executar prepara conserva els codis');
const code = Object.fromEntries(people.map((p) => [p[0], p[1]]));
let err = ''; try { gs('entra("ZZZZZZ")'); } catch (e) { err = e.message; }
ok(err === 'codi-incorrecte', 'un codi inventat no entra');
const g1 = gs(`desa(${J(code.Gemma)}, {text: "=HYPERLINK(1)"})`);
ok(g1.mine.text.startsWith("'="), 'no es poden colar fórmules al full');
const g2 = gs(`desa(${J(code.Gemma)}, {text: "Plantes", hints: "balcó petit"})`);
ok(g2.mine.text === 'Plantes' && sheets.Temes.data.filter((r) => r[1] === 'Gemma').length === 1, 'cada persona té un sol tema (desar-lo el canvia)');
const own = gs(`tria(${J(code.Gemma)}, ${J(g2.mine.id)})`);
ok(/propi/.test(own.error), 'no pots triar el teu propi tema');

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
  await page.waitForSelector('#app:not([hidden]), #login:not([hidden])');
  return page;
}
const card = (page, name) => page.locator('#othersList .tag', { hasText: name });

// L'Anna entra amb l'enllaç i proposa el seu tema.
const anna = await open('Anna');
ok((await anna.textContent('#hello')) === 'Hola, Anna', 'l\'enllaç personal entra directament');
await anna.fill('#tText', 'Alguna cosa per a la cuina');
await anna.fill('#tHints', 'M\'agrada el menjar japonès');
await anna.click('#saveBtn');
await anna.waitForFunction(() => document.querySelector('#mineView').textContent.includes('cuina'));
ok(await anna.locator('#themeForm').isHidden(), 'un cop desat, el formulari s\'amaga i surt el tema');

// En Bernat entra escrivint el codi i tria el tema de l'Anna.
const bernat = await open('Bernat', { viaLink: false });
await bernat.fill('#code', code.Bernat.toLowerCase());
await bernat.click('#loginBtn');
await bernat.waitForSelector('#app:not([hidden])');
ok(true, 'en Bernat entra escrivint el codi en minúscules');
await bernat.click('#tabOthers');
ok((await card(bernat, 'Anna').locator('.hints').textContent()).includes('japonès'), 'es veuen les pistes del tema');
await card(bernat, 'Anna').getByRole('button', { name: 'El trio' }).click();
await card(bernat, 'Anna').locator('.chip.mine').waitFor();
ok((await bernat.textContent('#pickBox')).includes('Anna'), 'en Bernat veu «Regales a Anna»');

// La Carla el veu triat i no el pot triar.
const carla = await open('Carla', { viewport: { width: 390, height: 844 } });
await carla.click('#tabOthers');
ok(await card(carla, 'Anna').locator('.chip.taken').isVisible(), 'la Carla el veu «Ja està triat»');
ok((await card(carla, 'Anna').getByRole('button').count()) === 0, 'la Carla no el pot triar');
const annaId = gs(`entra(${J(code.Anna)})`).mine.id;
ok(/avançat/.test(gs(`tria(${J(code.Carla)}, ${J(annaId)})`).error), 'el servidor tampoc deixa triar-lo dues vegades');
ok(await carla.evaluate(() => document.documentElement.scrollWidth) <= 390, 'al mòbil no hi ha desplaçament lateral');

// L'Anna no en sap res; els altres no saben qui.
const annaView = gs(`entra(${J(code.Anna)})`);
ok(!('status' in annaView.mine), 'el servidor no diu a l\'Anna si han triat el seu tema');
await anna.reload(); await anna.waitForSelector('#app:not([hidden])');
await anna.click('#tabMine');
ok(!/triat|regales/i.test(await anna.textContent('#paneMine')), 'la pàgina de l\'Anna no mostra si l\'han triat');
const keys = new Set(gs(`entra(${J(code.Carla)})`).others.flatMap((o) => (o.theme ? Object.keys(o.theme) : [])));
ok([...keys].sort().join() === 'hints,id,status,text', 'als altres només els arriba «triat», mai qui');

// Cadascú tria només una persona: canviar allibera l'anterior.
await card(bernat, 'Gemma').getByRole('button', { name: 'Canvia a aquest' }).click();
await card(bernat, 'Gemma').locator('.chip.mine').waitFor();
ok(await card(bernat, 'Anna').locator('.chip.free').isVisible(), 'en Bernat canvia a la Gemma i l\'Anna torna a estar lliure');
await card(bernat, 'Gemma').getByRole('button', { name: 'Desfés' }).click();
await card(bernat, 'Gemma').locator('.chip.free').waitFor();
ok(!(await bernat.textContent('#pickBox')).includes('Regales a'), 'en Bernat desfà la tria');

// L'Anna canvia el seu tema.
await anna.getByRole('button', { name: 'Canvia-ho' }).click();
await anna.fill('#tText', 'Alguna cosa per a la cuina japonesa');
await anna.click('#saveBtn');
await anna.waitForFunction(() => document.querySelector('#mineView').textContent.includes('japonesa'));
ok(true, 'l\'Anna canvia el seu tema');

// Que l'últim no es quedi amb el seu propi tema.
const all = ['Anna', 'Bernat', 'Carla', 'David', 'Elena', 'Ferran', 'Gemma', 'Oriol'];
for (const n of all) gs(`desa(${J(code[n])}, {text: "Tema de ${n}"})`);
const id = (n) => gs(`entra(${J(code[n])})`).mine.id;
// Anna→Bernat→…→Ferran→Gemma: queden en Gemma i l'Oriol sense triar, i lliures els temes de l'Anna i l'Oriol.
for (let i = 0; i < 6; i++) ok(!gs(`tria(${J(code[all[i]])}, ${J(id(all[i + 1]))})`).error, `${all[i]} tria ${all[i + 1]}`);
const bad = gs(`tria(${J(code.Gemma)}, ${J(id('Anna'))})`);
ok(/l'última persona/.test(bad.error), 'la Gemma no pot deixar l\'Oriol només amb el seu tema');
ok(!gs(`tria(${J(code.Gemma)}, ${J(id('Oriol'))})`).error && !gs(`tria(${J(code.Oriol)}, ${J(id('Anna'))})`).error, 'la Gemma tria l\'Oriol i l\'Oriol l\'Anna: tothom té a qui regalar');

if (shots) {
  fs.mkdirSync(shots, { recursive: true });
  gs(`desfes(${J(code.Carla)})`); gs(`desfes(${J(code.Elena)})`); gs(`desfes(${J(code.Oriol)})`);
  const demo = { Bernat: ['Llibres de misteri', 'Ja tinc tots els de l\'Agatha Christie'], Carla: ['Jocs de taula', 'Millor cooperatius'], David: ['Música', 'Vinils de jazz'], Elena: ['Plantes', 'Tinc un balcó petit'], Ferran: ['Esport', 'Corro i vaig en bici'], Gemma: ['Alguna cosa per relaxar-se', ''], Oriol: ['Tecnologia', 'Gadgets petits per a la feina'], Anna: ['Alguna cosa per a la cuina', 'M\'agrada el menjar japonès'] };
  for (const [n, [t, h]] of Object.entries(demo)) gs(`desa(${J(code[n])}, {text: ${J(t)}, hints: ${J(h)}})`);
  gs(`tria(${J(code.Carla)}, ${J(id('David'))})`);
  const hide = async (p) => { await p.evaluate(() => { document.getElementById('toast').hidden = true; }); };
  const m = await open('Carla', { viewport: { width: 390, height: 844 } });
  await m.click('#tabOthers'); await hide(m);
  await m.screenshot({ path: path.join(shots, 'temes-mobil.png'), fullPage: true });
  const d = await open('Elena', { scheme: 'dark' });
  await d.click('#tabOthers'); await hide(d);
  await d.screenshot({ path: path.join(shots, 'temes-ordinador-fosc.png'), fullPage: true });
}

await browser.close();
console.log(fails ? `\n${fails} proves han fallat` : '\nTot correcte');
process.exit(fails ? 1 : 0);
