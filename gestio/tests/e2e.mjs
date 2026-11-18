// Prova de punta a punta: arrenca el servidor amb una base de dades buida i fa el recorregut principal amb Chromium
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = mkdtempSync(path.join(tmpdir(), 'gestio-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';

const server = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { cwd: root, env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => (serverLog += d)); server.stderr.on('data', d => (serverLog += d));
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('El servidor no arrenca\n' + serverLog)), 8000); server.stdout.on('data', d => { if (String(d).includes('en marxa')) { clearTimeout(t); res(); } }); });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });
const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const api = (p, body, method) => page.evaluate(async ([p, body, method]) => {
  const r = await fetch(p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}, [p, body, method]);

try {
  console.log('Primer accés');
  await page.goto(BASE);
  await page.fill('input[name=company]', 'Esports Prova SL');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'contrasenya-segura');
  await shot('01-login');
  await page.click('button:has-text("Crea i entra")');
  await page.waitForSelector('text=Properes activitats');
  ok(true, 'administrador creat i tauler visible');
  await shot('02-tauler');

  console.log('Productes');
  await page.click('a[href="#/productes"]');
  await page.click('button:has-text("Nou producte")');
  await page.fill('.modal input[name=name]', 'Taller d\'escalada');
  await page.fill('.modal input[name=price]', '250');
  await page.fill('.modal input[name=workers_needed]', '2');
  await page.click('.modal button:has-text("Desa")');
  await page.waitForSelector('text=Taller d\'escalada');
  ok(true, 'producte creat');

  console.log('Treballadors');
  await page.click('a[href="#/treballadors"]');
  for (const [n, c, ph] of [['Anna', 'Puig', '600111222'], ['Jordi', 'Soler', '600333444']]) {
    await page.waitForSelector('.table');
    await page.click('button:has-text("Nou treballador")');
    await page.waitForSelector('.modal input[name=first_name]');
    await page.fill('.modal input[name=first_name]', n);
    await page.fill('.modal input[name=last_name]', c);
    await page.fill('.modal input[name=dni]', '12345678Z');
    await page.fill('.modal input[name=email]', `${n.toLowerCase()}@exemple.cat`);
    await page.fill('.modal input[name=phone]', ph);
    await page.click('.modal button:has-text("Desa")');
    await page.waitForSelector('.tabs');
    await page.click('a[href="#/treballadors"]');
  }
  await page.waitForSelector('text=Jordi');
  const ws = await api('/api/workers');
  ok(ws.map(w => `${w.first_name} ${w.last_name}`).sort().join(',') === 'Anna Puig,Jordi Soler', 'dos treballadors creats amb les dades correctes');
  // document + disponibilitat + accés per a l'Anna
  await page.click('text=Anna');
  await page.click('.tabs a:has-text("Documents")');
  await page.setInputFiles('input[type=file][name=files]', { name: 'contracte.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prova') });
  await page.waitForSelector('text=contracte.pdf');
  ok(true, 'document pujat');
  await page.click('.tabs a:has-text("Disponibilitat")');
  await page.check('tr[data-day="1"] [data-on]'); await page.check('tr[data-day="6"] [data-on]');
  await page.click('button:has-text("Desa la disponibilitat")');
  await page.waitForSelector('text=Disponibilitat desada');
  await page.click('.tabs a:has-text("Accés")');
  await page.fill('input[name=username]', 'anna');
  await page.fill('input[name=password]', 'anna-12345');
  await page.click('button:has-text("Crea l\'usuari")');
  await page.waitForSelector('text=La contrasenya no es tornarà a mostrar');
  await page.click('.modal button:has-text("Fet")');
  ok(true, 'usuari d\'accés creat per al treballador');
  await shot('03-treballador');

  console.log('Activitat nova amb client nou');
  await page.click('a[href="#/activitats"]');
  await page.waitForSelector('.cal-grid');
  const next = new Date(); next.setDate(next.getDate() + ((6 - next.getDay() + 7) % 7 || 7)); // proper dissabte
  const date = next.toISOString().slice(0, 10);
  await page.click('button[data-new]');
  await page.fill('.modal input[name=date]', date);
  await page.fill('.modal input[name=start_time]', '10:00');
  await page.fill('.modal input[name=end_time]', '13:00');
  await page.fill('.modal input[name=location]', 'Parc de Collserola');
  await page.fill('.modal input[name="client.name"]', 'Escola Bosc SL');
  await page.fill('.modal input[name="client.nif"]', 'B11223344');
  await page.fill('.modal input[name="client.email"]', 'escola@exemple.cat');
  await page.fill('.modal input[name="client.address"]', 'Carrer del Bosc, 5');
  await page.selectOption('.modal [data-add-product]', { label: 'Taller d\'escalada — 250,00 €' });
  await page.waitForSelector('.modal .ap');
  const opts = await page.$$eval('.modal [data-addw] option', os => os.map(o => o.textContent));
  ok(opts.some(o => o.includes('✅') && o.includes('Anna')), 'l\'Anna surt disponible el dissabte');
  ok(opts.some(o => o.includes('Jordi')), 'el Jordi surt a la llista');
  await page.selectOption('.modal [data-addw]', { index: 1 });
  await page.selectOption('.modal [data-addw]', { index: 1 });
  await page.fill('.modal input[name=whatsapp_link]', 'https://chat.whatsapp.com/ABCdef123');
  await shot('04-activitat-form');
  await page.click('.modal button:has-text("Crea l\'activitat")');
  await page.waitForSelector('text=Productes i equip');
  ok(await page.isVisible('text=Escola Bosc SL'), 'activitat creada amb client');
  const actId = Number(page.url().split('/').pop());

  // el client s'ha desat
  const clients = await api('/api/clients');
  ok(clients.length === 1 && clients[0].nif === 'B11223344', 'el client s\'ha desat a Clients');

  console.log('Convocatòries');
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Envia convocatòries")');
  await page.waitForSelector('text=convocatòries processades');
  const act = await api(`/api/activities/${actId}`);
  ok(act.assignments.length === 2 && act.assignments.every(a => a.status === 'enviat'), 'assignacions marcades com a enviades');
  const emails = await api('/api/emails');
  ok(emails.some(e => e.subject.includes('Nova feina') && e.to_addr === 'anna@exemple.cat'), 'correu de convocatòria a la safata');
  const wa = await api(`/api/assignments/${act.assignments[0].id}/whatsapp`);
  ok(wa.url.startsWith('https://wa.me/34600') && decodeURIComponent(wa.url).includes('chat.whatsapp.com/ABCdef123'), 'enllaç de WhatsApp amb el grup');
  await shot('05-activitat');

  // confirmació des de l'enllaç públic (sense sessió)
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/c/${act.assignments[1].token}`);
  ok(await ap.isVisible('text=Entrar al grup de WhatsApp'), 'pàgina de confirmació amb el grup de WhatsApp');
  await ap.click('button:has-text("Confirmo")');
  await ap.waitForSelector('text=Has CONFIRMAT');
  ok(true, 'el treballador confirma des de l\'enllaç');

  console.log('Pressupost');
  await page.click('a[href="#/pressupostos"]');
  await page.click('a:has-text("Nou pressupost")');
  await page.fill('input[data-client-search]', 'Escola');
  await page.click('.suggest button');
  await page.selectOption('[data-addp]', { index: 1 });
  await page.click('button[data-save]');
  await page.waitForSelector('button:has-text("Envia al client")');
  const qid = Number(page.url().split('/').pop());
  await page.click('button:has-text("Envia al client")');
  await page.click('.modal button:has-text("Envia")');
  await page.waitForSelector('text=Desat a la safata');
  let q = await api(`/api/quotes/${qid}`);
  ok(q.status === 'enviat' && q.total === 302.5, 'pressupost enviat amb total 302,50 €');
  await ap.goto(q.public_url);
  ok(await ap.isVisible('text=Accepto el pressupost'), 'el client veu el pressupost');
  q = await api(`/api/quotes/${qid}`);
  ok(q.status === 'vist' && q.open_count === 1, 'seguiment: pressupost marcat com a vist');
  await ap.click('button:has-text("Accepto")');
  await ap.waitForSelector('text=ACCEPTAT');
  q = await api(`/api/quotes/${qid}`);
  ok(q.status === 'acceptat', 'el client accepta el pressupost');
  await page.reload(); await page.waitForSelector('text=Seguiment');
  await shot('06-pressupost');

  console.log('Factura amb paga i senyal');
  const inv = await api(`/api/quotes/${qid}/to-invoice`, {});
  await page.goto(`${BASE}/#/factures/${inv.id}`);
  await page.waitForSelector('h3:has-text("Cobrament")');
  await page.selectOption('select[name=deposit_type]', 'percent');
  await page.fill('input[name=deposit_value]', '30');
  await page.selectOption('select[name=status]', 'emesa');
  await page.click('button[data-save]');
  await page.waitForSelector('button:has-text("Senyal pagat")');
  let f = await api(`/api/invoices/${inv.id}`);
  ok(f.deposit_amount === 90.75, 'senyal del 30% = 90,75 €');
  await page.click('button:has-text("Senyal pagat")');
  await page.waitForSelector('text=Cobrament actualitzat');
  f = await api(`/api/invoices/${inv.id}`);
  ok(f.status === 'senyal_pagat' && f.finance.pendingValue === 211.75, 'senyal pagat, pendent 211,75 €');
  const html = await page.evaluate(async id => (await fetch(`/api/invoices/${id}/html`)).text(), inv.id);
  ok(html.includes('FACTURA') && html.includes('Escola Bosc SL') && html.includes('Paga i senyal'), 'la factura es genera amb la plantilla');
  await shot('07-factura');

  console.log('Automatismes');
  // simula que el pressupost es va enviar fa 5 dies i no s'ha obert
  const q2 = await api('/api/quotes', { client_id: clients[0].id, lines: [{ description: 'Prova', quantity: 1, price: 100, vat: 21 }] });
  await api(`/api/quotes/${q2.id}/send`, {});
  await page.evaluate(() => 0);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'gestio.db'));
  db.prepare(`UPDATE quotes SET sent_at = ? WHERE id = ?`).run(new Date(Date.now() - 5 * 86400000).toISOString(), q2.id);
  const run = await api('/api/automations/run', {});
  ok(run.sent >= 1, `l'automatisme envia el recordatori (${run.sent} enviats)`);
  const em2 = await api('/api/emails');
  ok(em2.some(e => e.automation_name === 'Recordatori: no han obert el pressupost'), 'recordatori de pressupost no obert a la safata');
  ok(em2.some(e => e.automation_name === 'Recordatori de pagament del senyal') === false, 'no recorda el senyal si ja està pagat');
  const run2 = await api('/api/automations/run', {});
  ok(run2.sent === 0, 'no repeteix el recordatori abans d\'hora');
  await page.click('a[href="#/automatismes"]');
  await page.waitForSelector('.auto');
  await shot('08-automatismes');

  console.log('Configuració');
  for (const t of ['empresa', 'aparenca', 'camps', 'llistes', 'facturacio', 'plantilles', 'missatges', 'correu', 'usuaris', 'compte']) {
    await page.goto(`${BASE}/#/configuracio/${t}`);
    await page.waitForSelector('[data-body] *');
  }
  ok(true, 'totes les pestanyes de configuració carreguen');
  await page.goto(`${BASE}/#/configuracio/camps`);
  await page.click('button[data-add="worker"]');
  await page.fill('tr[data-e="worker"] input[data-k="label"]', 'Talla samarreta');
  await page.click('button[data-save]');
  await page.waitForSelector('text=Configuració desada');
  await page.goto(`${BASE}/#/treballadors`);
  await page.click('text=Jordi');
  ok(await page.waitForSelector('label:has-text("Talla samarreta")', { timeout: 5000 }).then(() => true, () => false), 'el camp personalitzat surt a la fitxa');
  await page.goto(`${BASE}/#/configuracio/plantilles`);
  await page.waitForTimeout(800);
  await shot('09-plantilla');
  await page.goto(`${BASE}/#/activitats`);
  await page.waitForSelector('.ev');
  await shot('10-calendari');

  console.log('Portal del treballador');
  const wctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const wp = await wctx.newPage();
  wp.on('pageerror', e => errors.push('worker: ' + e.message));
  await wp.goto(BASE);
  await wp.fill('input[name=username]', 'anna');
  await wp.fill('input[name=password]', 'anna-12345');
  await wp.click('button:has-text("Entra")');
  await wp.waitForSelector('text=Les meves feines');
  ok(await wp.isVisible('text=Entra al grup de WhatsApp'), 'el treballador veu la feina i el grup');
  if (SHOTS) await wp.screenshot({ path: path.join(SHOTS, '11-portal-treballador.png') });
  await wp.click('button[data-s="confirmat"]');
  await wp.waitForSelector('text=Confirmat! Gràcies');
  const forbidden = await wp.evaluate(async () => (await fetch('/api/clients')).status);
  ok(forbidden === 403, 'el treballador no pot veure els clients (accés limitat)');
  const final = await api(`/api/activities/${actId}`);
  ok(final.assignments.every(a => a.status === 'confirmat'), 'els dos treballadors han confirmat');

  ok(errors.length === 0, 'cap error de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  failures++;
  console.error('ERROR:', e.message);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} proves han fallat` : '\nTotes les proves han passat ✅');
process.exit(failures ? 1 : 0);
