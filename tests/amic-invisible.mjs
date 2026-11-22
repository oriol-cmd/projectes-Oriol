// Prova de punta a punta del tauler de temes de l'amic invisible (Sheets i Apps Script simulats).
// Ús: node tests/amic-invisible.mjs [carpeta-per-a-captures]
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

process.env.TZ = 'Europe/Madrid';
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
const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/PROVA/exec' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Europe/Madrid' },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).map((x) => [x.type, x.value]));
      return `${weekdays[p.weekday]}|${p.day}|${p.month}|${p.hour}:${p.minute}`;
    },
  },
  HtmlService: {},
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8'), ctx);
const gs = (code) => vm.runInContext(code, ctx);
const BEFORE = new Date('2026-11-22T12:00:00+01:00');
const AFTER = new Date('2026-12-08T10:00:00+01:00');
const setNow = (d) => { ctx.now_ = () => new Date(d); };
setNow(BEFORE);

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };
const J = JSON.stringify;

console.log('Servidor');
const people = gs('prepara()');
ok(people.length === 8 && people.every((p) => /^[A-Z][A-Z2-9]{5}$/.test(p[1])), 'prepara crea 8 codis de 6 caràcters');
ok(people[0][2].endsWith('?codi=' + people[0][1]), 'enllaç personal amb el codi');
ok(sheets.Tries.hidden, 'la pestanya Tries queda amagada');
ok(sheets['Configuració'].data.some((r) => r[0] === 'Família' && r[1] === 'Bové Palau'), 'la pestanya Configuració porta la família Bové Palau');
const setCfg = (label, value) => { sheets['Configuració'].data.find((r) => r[0] === label)[1] = value; };
setCfg('Temes per persona', '7'); setCfg('Estil', 'Groc');
ok(gs('config_()').numTemes === 2 && gs('config_()').estil === 'avet', 'valors de configuració estranys tornen als normals');
setCfg('Temes per persona', 2); setCfg('Estil', 'avet');
ok(gs('config_()').dataLimitText === 'dilluns 7 de desembre a les 22:00', 'la data límit es mostra en català: «dilluns 7 de desembre a les 22:00»');

// WhatsApp: telèfon opcional i missatge personal.
sheets.Participants.data[1][3] = '600 11 22 33';
const wa = gs('prepara()');
ok(wa.every((p, i) => p[1] === people[i][1]), 'tornar a executar prepara conserva els codis');
const waAnna = decodeURIComponent(wa[0][4]);
ok(wa[0][4].startsWith('=HYPERLINK("https://wa.me/34600112233?text='), 'amb telèfon, el botó de WhatsApp va directe al seu xat');
ok(wa[1][4].startsWith('=HYPERLINK("https://wa.me/?text='), 'sense telèfon, WhatsApp et deixa triar el contacte');
ok(waAnna.includes('Hola, Anna!') && waAnna.includes(wa[0][2]) && waAnna.includes('dilluns 7 de desembre a les 22:00'), 'el missatge porta el nom, l\'enllaç i la data límit');
const code = Object.fromEntries(people.map((p) => [p[0], p[1]]));

let err = ''; try { gs('entra("ZZZZZZ")'); } catch (e) { err = e.message; }
ok(err === 'codi-incorrecte', 'un codi inventat no entra');
const g1 = gs(`desa(${J(code.Gemma)}, ["=HYPERLINK(1)", "b"])`);
ok(g1.mine[0].startsWith("'="), 'no es poden colar fórmules al full');
err = ''; try { gs(`desa(${J(code.Gemma)}, ["Plantes", ""])`); } catch (e) { err = e.message; }
ok(/2 temes/.test(err), 'cal escriure els 2 temes');
const g2 = gs(`desa(${J(code.Gemma)}, ["Plantes", "Verd"])`);
ok(g2.mine.join() === 'Plantes,Verd' && sheets.Temes.data.filter((r) => r[1] === 'Gemma').length === 1, 'desar els temes els canvia (una fila per persona)');

console.log('Abans de la data límit');
const before = gs(`entra(${J(code.Anna)})`);
ok(before.phase === 'temes' && before.msLeft > 0, 'estem en la fase d\'escriure temes');
ok(before.others.every((o) => Object.keys(o).sort().join() === 'name,written'), 'dels altres només se sap si ja han escrit, no què');
ok(before.others.find((o) => o.name === 'Gemma').written, 'es veu que la Gemma ja els ha escrit');
ok(/Encara no es pot triar/.test(gs(`tria(${J(code.Anna)}, "Gemma")`).error), 'encara no es pot triar');

// ---------- Navegador ----------
const browser = await chromium.launch();
const html = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');

async function open(name, { viaLink = true, viewport = { width: 1100, height: 900 }, scheme = 'light', scale = 1, params = null } = {}) {
  const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: scale });
  page.on('pageerror', (e) => { console.log('  ✗ error a la pàgina: ' + e.message); fails++; });
  await page.exposeFunction('__gas', (fn, args) => {
    try { return { ok: ctx[fn](...args) }; } catch (e) { return { err: e.message }; }
  });
  const parameter = params || (viaLink && name ? { codi: code[name] } : {});
  await page.addInitScript(({ parameter }) => {
    const runner = (succ, fail) => new Proxy({}, {
      get(_, k) {
        if (k === 'withSuccessHandler') return (f) => runner(f, fail);
        if (k === 'withFailureHandler') return (f) => runner(succ, f);
        return (...args) => window.__gas(k, JSON.parse(JSON.stringify(args))).then((r) => (r.err ? fail && fail(new Error(r.err)) : succ && succ(r.ok)));
      },
    });
    window.google = { script: { run: runner(), url: { getLocation: (cb) => setTimeout(() => cb({ parameter }), 0) } } };
  }, { parameter });
  await page.route('https://amic.test/', (r) => r.fulfill({ contentType: 'text/html', body: html.replace('<?!= config ?>', JSON.stringify(gs('config_()')).replace(/</g, '\\u003c')) }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('https://amic.test/');
  await page.waitForSelector('#app:not([hidden]), #login:not([hidden]), #guide:not([hidden])');
  return page;
}
const card = (page, name) => page.locator('#othersList .tag', { hasText: name });

// L'Anna entra amb l'enllaç i escriu els seus temes.
const anna = await open('Anna');
ok((await anna.textContent('#hello')) === 'Família Bové Palau · Hola, Anna', 'l\'enllaç personal entra directament');
ok((await anna.textContent('#mono')) === 'BP', 'surt el monograma BP de la família');
ok((await anna.textContent('#phase')).includes('dilluns 7 de desembre a les 22:00') && (await anna.textContent('#phase')).includes('Falten 15 dies'), 'surt la data límit i el compte enrere');
await anna.fill('#t1', 'Cuina');
await anna.click('#saveBtn');
ok(!(await anna.evaluate(() => document.getElementById('t2').checkValidity())) && !gs(`entra(${J(code.Anna)})`).mine, 'si falta un tema, no es desa');
await anna.fill('#t2', 'Japó');
await anna.click('#saveBtn');
await anna.waitForFunction(() => document.querySelectorAll('#mineView .themes li').length === 2);
ok(await anna.locator('#themeForm').isHidden(), 'un cop desats, el formulari s\'amaga i surten els 2 temes');
await anna.getByRole('button', { name: 'Canvia\'ls' }).click();
ok((await anna.inputValue('#t2')) === 'Japó', 'en editar, el formulari surt omplert');
await anna.fill('#t2', 'Menjar japonès');
await anna.click('#saveBtn');
await anna.waitForFunction(() => document.querySelector('#mineView').textContent.includes('Menjar japonès'));
ok(true, 'abans de la data límit, l\'Anna pot canviar els temes');

// En Bernat entra escrivint el codi: encara no pot triar, només veu qui ha escrit.
const bernat = await open('Bernat', { viaLink: false });
await bernat.fill('#code', code.Bernat.toLowerCase());
await bernat.click('#loginBtn');
await bernat.waitForSelector('#app:not([hidden])');
ok(await bernat.locator('#login .snail').count() === 1, 'a l\'entrada hi ha el cargol');
await bernat.click('#tabOthers');
ok((await bernat.textContent('#pickBox')).includes('Encara no es pot triar'), 'en Bernat veu «Encara no es pot triar»');
ok((await card(bernat, 'Anna').textContent()).includes('Ja els ha escrit') && !(await card(bernat, 'Anna').textContent()).includes('Cuina'), 'veu que l\'Anna ja els ha escrit, però no quins són');
ok((await card(bernat, 'Carla').textContent()).includes('Encara no'), 'veu que la Carla encara no');
ok((await bernat.locator('#othersList button').count()) === 0, 'no hi ha cap botó per triar');

// Escriuen tots menys la Carla.
for (const [n, t] of Object.entries({ Bernat: ['Misteri', 'Llibres'], David: ['Música', 'Jazz'], Elena: ['Plantes', 'Balcó'], Ferran: ['Esport', 'Muntanya'], Oriol: ['Tecnologia', 'Petit i útil'] })) gs(`desa(${J(code[n])}, ${J(t)})`);

console.log('Després de la data límit');
setNow(AFTER);
ok(/data límit/.test(gs(`desa(${J(code.Anna)}, ["Altres", "Coses"])`).error), 'els temes ja no es poden canviar');
await anna.reload(); await anna.waitForSelector('#app:not([hidden])');
await anna.click('#tabMine');
ok(await anna.locator('#themeForm').isHidden() && (await anna.locator('#mineView button').count()) === 0, 'l\'Anna veu els seus temes, però sense poder-los canviar');
ok(!/triad|regales/i.test(await anna.textContent('#paneMine')), 'la pàgina de l\'Anna no mostra si l\'han triada');

await bernat.reload(); await bernat.waitForSelector('#app:not([hidden])');
ok(await bernat.locator('#paneOthers').isVisible(), 'després de la data límit, s\'obre directament «A qui regalo»');
ok((await card(bernat, 'Anna').locator('.themes li').allTextContents()).join() === 'Cuina,Menjar japonès', 'en Bernat ja veu els temes de l\'Anna');
ok((await card(bernat, 'Carla').textContent()).includes('sorpresa total') && (await card(bernat, 'Carla').getByRole('button', { name: 'La trio' }).count()) === 1, 'la Carla no va posar temes, però també es pot triar');
await card(bernat, 'Anna').getByRole('button', { name: 'La trio' }).click();
await card(bernat, 'Anna').locator('.chip.mine').waitFor();
ok((await bernat.textContent('#pickBox')).includes('Anna') && (await bernat.locator('#pickBox li').count()) === 2, 'en Bernat veu «Regales a Anna» amb els 2 temes');

const carla = await open('Carla', { viewport: { width: 390, height: 844 } });
ok((await carla.textContent('#mineView')).includes('No vas posar temes a temps'), 'la Carla, que no va posar temes, ho veu explicat');
ok(await card(carla, 'Anna').locator('.chip.taken').isVisible(), 'la Carla la veu «Ja està triada»');
ok((await card(carla, 'Anna').getByRole('button').count()) === 0, 'la Carla no la pot triar');
ok(/avançat/.test(gs(`tria(${J(code.Carla)}, "Anna")`).error), 'el servidor tampoc deixa triar-la dues vegades');
ok(await carla.evaluate(() => document.documentElement.scrollWidth) <= 390, 'al mòbil no hi ha desplaçament lateral');
const keys = new Set(gs(`entra(${J(code.Carla)})`).others.flatMap((o) => Object.keys(o)));
ok([...keys].sort().join() === 'name,status,themes', 'als altres només els arriba «triada», mai qui');
const annaMine = gs(`entra(${J(code.Anna)})`).mine;
ok(Array.isArray(annaMine) && annaMine.every((x) => typeof x === 'string'), 'el servidor no diu a l\'Anna si l\'han triada');

await card(bernat, 'Gemma').getByRole('button', { name: 'Canvia a aquesta' }).click();
await card(bernat, 'Gemma').locator('.chip.mine').waitFor();
ok(await card(bernat, 'Anna').locator('.chip.free').isVisible(), 'en Bernat canvia a la Gemma i l\'Anna torna a estar lliure');
await card(bernat, 'Gemma').getByRole('button', { name: 'Desfés' }).click();
await card(bernat, 'Gemma').locator('.chip.free').waitFor();
ok(!(await bernat.textContent('#pickBox')).includes('Regales a'), 'en Bernat desfà la tria');

// Que l'última no es quedi sense ningú a qui regalar.
const all = ['Anna', 'Bernat', 'Carla', 'David', 'Elena', 'Ferran', 'Gemma', 'Oriol'];
for (let i = 0; i < 6; i++) ok(!gs(`tria(${J(code[all[i]])}, ${J(all[i + 1])})`).error, `${all[i]} tria ${all[i + 1]}`);
ok(/l'última es quedaria/.test(gs(`tria(${J(code.Gemma)}, "Anna")`).error), 'la Gemma no pot deixar l\'Oriol sense ningú a qui regalar');
ok(!gs(`tria(${J(code.Gemma)}, "Oriol")`).error && !gs(`tria(${J(code.Oriol)}, "Anna")`).error, 'la Gemma tria l\'Oriol i l\'Oriol l\'Anna: tothom té a qui regalar');

console.log('Instruccions i configuració');
setNow(BEFORE);
const guide = await open(null, { params: { instruccions: '' }, viewport: { width: 390, height: 844 } });
const gText = await guide.textContent('#guideCard');
ok(gText.includes('Família Bové Palau') && gText.includes('dilluns 7 de desembre a les 22:00') && gText.includes('Escriu 2 temes'), 'la targeta d\'instruccions porta la família, la data i els 2 temes');
const gMsg = await guide.inputValue('#groupMsg');
ok(gMsg.includes('*dilluns 7 de desembre a les 22:00*') && gMsg.includes('🐌'), 'el text per al grup porta la data i el cargol');

setCfg('Temes per persona', 3); setCfg('Estil', 'nit'); setCfg('Títol', 'Amic invisible 2026');
const cfgPage = await open('Elena');
await cfgPage.click('#tabMine');
ok((await cfgPage.locator('#fields input').count()) === 3, 'amb «Temes per persona» = 3 surten 3 requadres');
ok((await cfgPage.getAttribute('html', 'data-estil')) === 'nit' && (await cfgPage.textContent('#title')) === 'Amic invisible 2026', 'l\'estil i el títol canvien sense tornar a implementar');
setCfg('Temes per persona', 2); setCfg('Estil', 'avet'); setCfg('Títol', 'Amic invisible');

if (shots) {
  fs.mkdirSync(shots, { recursive: true });
  sheets.Temes.data.splice(1); sheets.Tries.data.splice(1);
  const demo = { Anna: ['Cuina', 'Japó'], Bernat: ['Misteri', 'Llibres'], David: ['Música', 'Jazz'], Elena: ['Plantes', 'Balcó'], Ferran: ['Esport', 'Muntanya'], Oriol: ['Tecnologia', 'Petit i útil'] };
  for (const [n, t] of Object.entries(demo)) gs(`desa(${J(code[n])}, ${J(t)})`);
  const phone = { width: 390, height: 844 };
  const snap = async (page, file) => {
    await page.evaluate(() => { document.getElementById('toast').hidden = true; window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(shots, file) });
  };

  // Fase 1: escriure temes.
  let pg = await open('Carla', { viaLink: false, viewport: phone, scale: 2 });
  await snap(pg, '01-entrada.png');
  pg = await open('Carla', { viewport: phone, scale: 2 });
  await snap(pg, '02-escriu-els-temes.png');
  await pg.fill('#t1', 'Jocs de taula'); await pg.fill('#t2', 'Riure');
  await pg.click('#saveBtn');
  await pg.waitForFunction(() => document.querySelectorAll('#mineView .themes li').length === 2);
  await snap(pg, '03-temes-desats.png');
  await pg.click('#tabOthers');
  await snap(pg, '04-encara-no-es-pot-triar.png');

  // Fase 2: triar.
  setNow(AFTER);
  gs(`tria(${J(code.Anna)}, "Bernat")`); gs(`tria(${J(code.Elena)}, "Gemma")`); gs(`tria(${J(code.Oriol)}, "Elena")`);
  pg = await open('Carla', { viewport: phone, scale: 2 });
  await snap(pg, '05-tria-a-qui-regales.png');
  await card(pg, 'David').getByRole('button', { name: 'La trio' }).click();
  await card(pg, 'David').locator('.chip.mine').waitFor();
  await snap(pg, '06-regales-a.png');
  for (const estil of ['avet', 'nit', 'gerd', 'neu']) {
    setCfg('Estil', estil);
    for (const scheme of ['light', 'dark']) {
      const e = await open('Carla', { viewport: phone, scale: 2, scheme });
      await snap(e, `estil-${estil}${scheme === 'dark' ? '-fosc' : ''}.png`);
    }
  }
  setCfg('Estil', 'avet');

  // Targeta d'instruccions per a WhatsApp.
  setNow(BEFORE);
  const g = await open(null, { params: { instruccions: '' }, viewport: { width: 470, height: 1000 }, scale: 3 });
  await (await g.$('#guideCard')).screenshot({ path: path.join(shots, 'instruccions-whatsapp.png') });
  const gFull = await open(null, { params: { instruccions: '' }, viewport: phone, scale: 2 });
  await gFull.screenshot({ path: path.join(shots, 'pagina-instruccions.png'), fullPage: true });
}

await browser.close();
console.log(fails ? `\n${fails} proves han fallat` : '\nTot correcte');
process.exit(fails ? 1 : 0);
