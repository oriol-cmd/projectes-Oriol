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
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/EDITOR/dev' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Europe/Madrid' },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, fmt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', year: 'numeric', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).map((x) => [x.type, x.value]));
      const t = { yyyy: p.year, MM: p.month.padStart(2, '0'), dd: p.day.padStart(2, '0'), HH: p.hour, mm: p.minute, u: String(weekdays[p.weekday]), d: String(Number(p.day)), M: String(Number(p.month)) };
      return fmt.replace(/yyyy|MM|dd|HH|mm|u|d|M/g, (k) => t[k]);
    },
  },
  HtmlService: {},
  ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }), MimeType: { JSON: 'json' } },
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
const first = gs('prepara()');
ok(first[0][2].startsWith('(enganxa'), 'si Google només dona l\'enllaç /dev (que només et funciona a tu), no el fa servir i demana el bo');
sheets['Configuració'].data.find((r) => r[0] === "Enllaç de l'aplicació")[1] = 'https://script.google.com/macros/s/PROVA/exec';
const people = gs('prepara()');
ok(people.length === 8 && people.every((p) => /^[A-Z][A-Z2-9]{5}$/.test(p[1])), 'prepara crea 8 codis de 6 caràcters');
ok(people[0][2] === 'https://oriol-cmd.github.io/projectes-Oriol/amic-invisible-bove-palau/?codi=' + people[0][1], 'l\'enllaç personal és curt: …/amic-invisible-bove-palau/?codi=' + people[0][1]);
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

async function open(name, { viaLink = true, viewport = { width: 1100, height: 900 }, scheme = 'light', scale = 1, params = null, keepHelp = false } = {}) {
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
  await page.route('https://amic.test/', (r) => r.fulfill({ contentType: 'text/html', body: html.replace('<?!= config ?>', JSON.stringify(gs('publicConfig_(config_())')).replace(/</g, '\\u003c')) }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('https://amic.test/');
  await page.waitForSelector('#app:not([hidden]), #login:not([hidden]), #guide:not([hidden])');
  if (!keepHelp) await dismiss(page);
  return page;
}
// El primer cop que algú entra surt el full «Com funciona»: el tanquem per seguir provant.
async function dismiss(page) {
  if (await page.locator('#help').isVisible()) await page.click('#helpOk');
}
const card = (page, name) => page.locator('#othersList .tag', { hasText: name });

// L'Anna entra amb l'enllaç i escriu els seus temes.
const anna = await open('Anna');
ok((await anna.textContent('#hello')) === 'Família Bové Palau · Hola, Anna', 'l\'enllaç personal entra directament');
ok((await anna.textContent('#mono')) === 'BP', 'surt el monograma BP de la família');
{
  const first = await open('Ferran', { keepHelp: true, viewport: { width: 390, height: 844 } });
  ok(await first.locator('#help').isVisible(), 'el primer cop que algú entra, surt el full «Com funciona»');
  const helpText = await first.textContent('#help');
  ok((await first.locator('#help .snail').count()) === 1 && helpText.includes('Amic invisible Bové Palau') && helpText.includes('dilluns 7 de desembre a les 22:00') && helpText.includes('Escriu 2 temes'), 'amb el cargol, la família, la data límit i els passos');
  await first.keyboard.press('Escape');
  await first.mouse.click(195, 30);
  ok(await first.locator('#help').isVisible(), 'el primer cop no es pot tancar tocant fora ni amb Esc: s\'ha d\'acceptar');
  await first.click('#helpOk');
  ok(await first.locator('#help').isHidden(), '«Entesos, som-hi!» el tanca');
  await first.reload(); await first.waitForSelector('#app:not([hidden])');
  ok(await first.locator('#help').isHidden(), 'la segona vegada ja no surt sol');
  await first.click('#helpOpen');
  ok(await first.locator('#help').isVisible(), 'però es pot tornar a obrir amb «Com funciona?»');
  await first.keyboard.press('Escape');
  ok(await first.locator('#help').isHidden(), 'i es tanca amb Esc');
}
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
await dismiss(bernat);
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

console.log('Ajustos');
setCfg('Data límit', '07/12/2026 22:00');
const oriolRow = sheets.Participants.data.find((r) => r[0] === 'Oriol');
oriolRow[5] = 'sí';
gs('prepara()');
ok(sheets.Participants.data.find((r) => r[0] === 'Oriol')[5] === 'Sí', 'a Participants, «sí» a «Pot configurar» queda com a «Sí»');
ok(/No tens accés/.test(gs(`desaAjustos(${J(code.Anna)}, {date: "2026-12-01", time: "10:00", numTemes: 2, estil: "avet"})`).error), 'qui no té accés no pot canviar els ajustos');
ok(gs(`entra(${J(code.Anna)})`).admin === null, 'a qui no té accés no li arriba res dels ajustos');
const adm = gs(`entra(${J(code.Oriol)})`).admin;
ok(adm && adm.date === '2026-12-07' && adm.time === '22:00' && adm.people.length === 8, 'l\'Oriol rep els ajustos (data límit i família)');
ok(!JSON.stringify(adm).match(/status|triat|pick/i) && adm.people.every((p) => Object.keys(p).sort().join() === 'admin,link,name,phone,wa,written'), 'als ajustos no hi surt qui ha triat qui');

const annaP = await open('Anna');
ok(await annaP.locator('#tabAdmin').isHidden(), 'l\'Anna no veu la pestanya Ajustos');
const oriol = await open('Oriol', { viewport: { width: 390, height: 844 } });
ok(await oriol.locator('#tabAdmin').isVisible(), 'l\'Oriol veu la pestanya Ajustos');
await oriol.click('#tabAdmin');
ok((await oriol.inputValue('#cDate')) === '2026-12-07' && (await oriol.inputValue('#cTime')) === '22:00', 'el panell mostra la data límit actual');
await oriol.fill('#cDate', '2026-12-10'); await oriol.fill('#cTime', '21:30');
await oriol.fill('#cAvis', 'Pressupost: 25 €. Intercanvi a casa dels avis.');
await oriol.click('label.swatch:has(input[value="gerd"])');
await oriol.click('#cfgSave');
await oriol.waitForFunction(() => document.documentElement.getAttribute('data-estil') === 'gerd');
ok(gs('config_()').dataLimitText === 'dijous 10 de desembre a les 21:30', 'l\'Oriol canvia la data límit des del mòbil');
ok(sheets['Configuració'].data.find((r) => r[0] === 'Data límit')[1] === '10/12/2026 21:30', 'i queda escrita al full com a «10/12/2026 21:30»');
ok((await oriol.textContent('#phase')).includes('dijous 10 de desembre a les 21:30') && (await oriol.textContent('#notice')).includes('25 €'), 'la pàgina s\'actualitza amb la data, l\'avís i els colors nous');
ok(decodeURIComponent(sheets.Participants.data[1][4]).includes('dijous 10 de desembre'), 'els missatges de WhatsApp ja porten la data nova');
await annaP.reload(); await annaP.waitForSelector('#app:not([hidden])');
ok((await annaP.textContent('#phase')).includes('dijous 10 de desembre a les 21:30'), 'l\'Anna també veu la data nova');

// Família: afegir, donar accés i treure.
await oriol.fill('#pName', 'Iu'); await oriol.fill('#pPhone', '611 22 33 44');
await oriol.click('#addPerson button[type="submit"]');
await oriol.locator('.person-row', { hasText: 'Iu' }).waitFor();
const iu = sheets.Participants.data.find((r) => r[0] === 'Iu');
ok(iu && /^[A-Z][A-Z2-9]{5}$/.test(iu[1]) && iu[2].endsWith('codi=' + iu[1]), 'en Iu té codi i enllaç propis');
ok((await oriol.locator('.person-row', { hasText: 'Iu' }).locator('a.wa').getAttribute('href')).startsWith('https://wa.me/34611223344?text='), 'i un botó de WhatsApp directe al seu mòbil');
ok(/Ja hi ha algú/.test(gs(`afegeixPersona(${J(code.Oriol)}, "anna", "")`).error), 'no es pot afegir un nom repetit');
await oriol.locator('.person-row', { hasText: 'Anna' }).locator('input[type="checkbox"]').check();
await oriol.waitForFunction(() => !document.body.style.cursor);
ok(sheets.Participants.data.find((r) => r[0] === 'Anna')[5] === 'Sí', 'l\'Oriol dona accés als ajustos a l\'Anna');
await annaP.reload(); await annaP.waitForSelector('#app:not([hidden])');
ok(await annaP.locator('#tabAdmin').isVisible(), 'i ara l\'Anna també veu la pestanya Ajustos');
ok(/a tu mateix/.test(gs(`canviaAcces(${J(code.Oriol)}, "Oriol", false)`).error), 'ningú es pot treure l\'accés a si mateix');
const rmBtn = oriol.locator('.person-row', { hasText: 'Iu' }).getByRole('button', { name: /Treu/ });
await rmBtn.click();
ok((await rmBtn.textContent()) === 'Segur? Treu-la', 'treure algú demana confirmació');
await rmBtn.click();
await oriol.locator('.person-row', { hasText: 'Iu' }).waitFor({ state: 'detached' });
ok(!sheets.Participants.data.some((r) => r[0] === 'Iu'), 'en Iu ja no hi és');
gs(`canviaAcces(${J(code.Oriol)}, "Anna", false)`);

// Edició nova per a l'any que ve.
gs(`desa(${J(code.Anna)}, ["Cuina", "Japó"])`);
const codesBefore = sheets.Participants.data.slice(1).map((r) => r[1]).join();
ok(/més endavant/.test(gs(`novaEdicio(${J(code.Oriol)}, "2026-01-01", "22:00")`).error), 'l\'edició nova necessita una data límit futura');
await oriol.fill('#nDate', '2027-12-07');
await oriol.click('#nBtn');
ok((await oriol.textContent('#nBtn')) === 'Segur? Es buidarà el tauler', 'començar una edició nova demana confirmació');
await oriol.click('#nBtn');
await oriol.waitForFunction(() => document.getElementById('phase').textContent.includes('2027') || document.getElementById('phase').textContent.includes('7 de desembre'));
const arch = Object.keys(sheets).find((n) => n.startsWith('Arxiu '));
ok(arch && sheets[arch].data.some((r) => r[0] === 'Anna' && r[1] === 'Cuina'), 'els temes d\'aquest any queden guardats a «' + arch + '»');
ok(sheets.Temes.data.length === 1 && sheets.Tries.data.length === 1, 'el tauler queda net (sense temes ni tries)');
ok(sheets.Participants.data.slice(1).map((r) => r[1]).join() === codesBefore, 'la família i els enllaços són els mateixos');
ok(sheets['Configuració'].data.find((r) => r[0] === 'Data límit')[1] === '07/12/2027 22:00', 'amb la data límit nova: 07/12/2027 22:00');
setCfg('Data límit', '07/12/2026 22:00'); setCfg('Estil', 'avet'); setCfg('Avís', 'Pressupost: uns 20 €. Intercanvi el dia de Nadal, a casa dels avis.');

console.log('Des de GitHub Pages (sense comptes de Google)');
async function openHosted(query, viewport = { width: 390, height: 844 }, path0 = 'https://pages.test/amic-invisible/', body = html) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => { console.log('  ✗ error a la pàgina: ' + e.message); fails++; });
  const calls = [];
  await page.route('https://pages.test/**', (r) => r.fulfill({ contentType: 'text/html', body }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://script.google.com/macros/s/PROVA/exec', (r) => {
    const req = r.request();
    calls.push({ method: req.method(), cookie: req.headers().cookie || '' });
    const out = ctx.doPost({ postData: { contents: req.postData() } }).getContent();
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
  });
  await page.goto(path0 + query);
  return { page, calls };
}
{
  const { page, calls } = await openHosted('?s=PROVA&codi=' + code.Elena);
  await page.waitForSelector('#app:not([hidden])');
  await dismiss(page);
  ok((await page.textContent('#hello')).includes('Hola, Elena') && (await page.textContent('#mono')) === 'BP', 'des de GitHub Pages, l\'Elena entra amb el seu enllaç');
  ok(calls.length >= 2 && calls.every((c) => c.method === 'POST' && !c.cookie), 'parla amb el full sense enviar cap compte de Google');
  ok((await page.title()) === 'Amic invisible · Bové Palau', 'el títol de la pestanya és el de la família');
  await page.fill('#t1', 'Plantes'); await page.fill('#t2', 'Balcó');
  await page.click('#saveBtn');
  await page.waitForFunction(() => document.querySelectorAll('#mineView .themes li').length === 2);
  ok(gs(`entra(${J(code.Elena)})`).mine.join() === 'Plantes,Balcó', 'i els temes es desen al full');
  await page.goto('https://pages.test/amic-invisible/');
  await page.waitForSelector('#app:not([hidden])');
  ok((await page.textContent('#hello')).includes('Hola, Elena'), 'l\'endemà, amb l\'adreça curta, el mòbil se\'n recorda');
  const baked = html.replace('__APP_ID__', 'PROVA');
  const short = await openHosted('?codi=' + code.David, undefined, 'https://pages.test/amic-invisible-bove-palau/', baked);
  await short.page.waitForSelector('#app:not([hidden])');
  ok((await short.page.textContent('#hello')).includes('Hola, David'), 'amb l\'enllaç curt (…/amic-invisible-bove-palau/?codi=…) en David entra directament');
  const bad = await openHosted('');
  await bad.page.waitForFunction(() => document.getElementById('loading').textContent.includes('incompleta'));
  ok(true, 'sense l\'enllaç sencer, explica que cal obrir el que han enviat');
  const g = await openHosted('?s=PROVA&instruccions');
  await g.page.waitForSelector('#guide:not([hidden])');
  ok((await g.page.textContent('#guideCard')).includes('Família Bové Palau'), 'la targeta d\'instruccions també funciona des de GitHub');
  ok(/No conec/.test(JSON.parse(ctx.doPost({ postData: { contents: '{"fn":"prepara","args":[]}' } }).getContent()).error), 'des de fora només es poden fer les accions de la pàgina');
  ok(gs(`entra(${J(code.Oriol)})`).config.guideUrl === 'https://oriol-cmd.github.io/projectes-Oriol/amic-invisible-bove-palau/?instruccions', 'el botó d\'instruccions dels ajustos porta a GitHub');
}

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

  // Full «Com funciona» que surt el primer cop.
  setNow(BEFORE);
  const hp = await open('Gemma', { viewport: phone, scale: 2, keepHelp: true });
  await hp.waitForTimeout(400);
  await hp.screenshot({ path: path.join(shots, 'full-com-funciona.png') });

  // Panell d'ajustos (l'Oriol hi té accés).
  sheets.Participants.data.find((r) => r[0] === 'David')[3] = '622 33 44 55';
  gs('prepara()');
  setNow(BEFORE);
  const adm = await open('Oriol', { viewport: phone, scale: 2 });
  await adm.click('#tabAdmin');
  await adm.evaluate(() => { document.getElementById('toast').hidden = true; window.scrollTo(0, 0); });
  await adm.screenshot({ path: path.join(shots, 'ajustos.png'), fullPage: true });
  await (await adm.$('#cfgForm')).screenshot({ path: path.join(shots, 'ajustos-1-data-i-textos.png') });
  await (await adm.$('#peopleList')).evaluate((e) => e.closest('section').id = 'familyBox');
  await (await adm.$('#familyBox')).screenshot({ path: path.join(shots, 'ajustos-2-familia.png') });
  await (await adm.$('#newEdition')).screenshot({ path: path.join(shots, 'ajustos-3-edicio-nova.png') });

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
