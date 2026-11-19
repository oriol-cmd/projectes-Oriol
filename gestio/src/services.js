// Lògica compartida: configuració, imports, contextos de plantilles, correus i enllaços
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { all, get, run, insert, update, addTimeline } = require('./db');
const { DEFAULT_SETTINGS, PRESETS, CONTRACT_DOC } = require('./defaults');
const { render, esc } = require('./tpl');

// ---------- Configuració ----------
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

let settingsCache = null;
function getSettings() {
  if (settingsCache) return settingsCache;
  const rows = all('SELECT key, value FROM settings');
  const stored = {};
  for (const r of rows) { try { stored[r.key] = JSON.parse(r.value); } catch { /* ignora */ } }
  settingsCache = deepMerge(DEFAULT_SETTINGS, stored);
  return settingsCache;
}
function saveSettings(partial) {
  const current = getSettings();
  for (const key of Object.keys(partial)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const value = isObj(DEFAULT_SETTINGS[key]) && isObj(partial[key]) ? deepMerge(current[key], partial[key]) : partial[key];
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }
  settingsCache = null;
  return getSettings();
}

// URL pública (per als enllaços dels correus)
let lastSeenOrigin = '';
function setSeenOrigin(o) { if (o) lastSeenOrigin = o; }
function baseUrl() {
  const b = (getSettings().email.base_url || '').trim().replace(/\/+$/, '');
  return b || (process.env.PUBLIC_URL || '').replace(/\/+$/, '') || lastSeenOrigin || `http://localhost:${process.env.PORT || 3000}`;
}

// ---------- Formats ----------
function money(n) {
  const cur = getSettings().invoicing.currency || '€';
  return new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' ' + cur;
}
function num(n) { return new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 2 }).format(Number(n) || 0); }
function fdate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function token() { return crypto.randomBytes(18).toString('base64url'); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + Number(n || 0)); return d.toISOString().slice(0, 10); }
function parseTs(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s);
}
function nowISO() { return new Date().toISOString(); }

// ---------- Imports ----------
function computeTotals(lines, depositType, depositValue, discountType, discountValue) {
  let gross = 0, lineDiscounts = 0; const buckets = {};
  const clean = (lines || []).filter(l => l && (l.description || l.price)).map(l => {
    const quantity = Number(l.quantity) || 0, price = Number(l.price) || 0, vat = Number(l.vat) || 0;
    const discount = Math.min(100, Math.max(0, Number(l.discount) || 0));
    const full = round2(quantity * price);
    const amount = round2(full * (1 - discount / 100));
    lineDiscounts += full - amount;
    gross += amount;
    buckets[vat] = (buckets[vat] || 0) + amount;
    return { product_id: l.product_id || null, description: l.description || '', quantity, price, vat, discount, amount };
  });
  gross = round2(gross);
  // descompte general sobre el subtotal (es reparteix entre els tipus d'IVA)
  let discount_amount = 0;
  if (discountType === 'percent') discount_amount = round2(gross * Math.min(100, Math.max(0, Number(discountValue) || 0)) / 100);
  else if (discountType === 'amount') discount_amount = round2(Math.min(gross, Math.max(0, Number(discountValue) || 0)));
  const factor = gross ? (gross - discount_amount) / gross : 1;
  const vatMap = {};
  for (const [rate, base] of Object.entries(buckets)) vatMap[rate] = base * factor * Number(rate) / 100;
  const subtotal = round2(gross - discount_amount);
  const vat_total = round2(Object.values(vatMap).reduce((a, b) => a + b, 0));
  const total = round2(subtotal + vat_total);
  let deposit_amount = 0;
  if (depositType === 'percent') deposit_amount = round2(total * (Number(depositValue) || 0) / 100);
  else if (depositType === 'amount') deposit_amount = round2(Number(depositValue) || 0);
  return { lines: clean, gross, discount_amount, line_discounts: round2(lineDiscounts), subtotal, vat_total, total, deposit_amount, vatMap };
}

// ---------- Numeració ----------
function nextNumber(kind) { // kind: invoice | quote
  const s = getSettings();
  const n = { ...s.numbering };
  const year = new Date().getFullYear();
  if (n.reset_yearly && n.year !== year) { n.year = year; n.invoice_next = 1; n.quote_next = 1; n.contract_next = 1; }
  const prefix = (n[`${kind}_prefix`] || '').replace('{ANY}', year).replace('{AA}', String(year).slice(2));
  const value = n[`${kind}_next`] || 1;
  const number = prefix + String(value).padStart(Number(n.digits) || 1, '0');
  n[`${kind}_next`] = value + 1;
  saveSettings({ numbering: n });
  return number;
}

// ---------- Contextos per a plantilles ----------
function companyCtx(absolute) {
  const c = getSettings().company;
  return {
    nom: c.name, nif: c.nif, adreca: c.address, poblacio: c.city, cp: c.postal_code, email: c.email,
    telefon: c.phone, web: c.website, iban: c.iban, pagament: c.payment_info, peu: c.footer,
    logo: c.logo ? (absolute ? baseUrl() : '') + '/logo?v=' + encodeURIComponent(c.logo) : '',
  };
}
function clientCtx(c) {
  c = c || {};
  return { nom: c.name || '', nif: c.nif || '', email: c.email || '', telefon: c.phone || '', adreca: c.address || '', poblacio: c.city || '', cp: c.postal_code || '', ...(c.extra || {}) };
}
function activityCtx(a) {
  if (!a) return {};
  const hora = [a.start_time, a.end_time].filter(Boolean).join(' - ');
  return {
    titol: a.title || 'Activitat', data: fdate(a.date) + (a.end_date && a.end_date !== a.date ? ' – ' + fdate(a.end_date) : ''),
    hora, lloc: a.location || '', notes: a.notes || '', notes_treballadors: a.worker_notes || '', whatsapp: a.whatsapp_link || '', ...(a.extra || {}),
  };
}
function workerCtx(w) {
  w = w || {};
  return { nom: w.first_name || '', cognoms: w.last_name || '', nom_complet: [w.first_name, w.last_name].filter(Boolean).join(' '), email: w.email || '', telefon: w.phone || '', dni: w.dni || '', ...(w.extra || {}) };
}

function docFinance(doc) {
  const t = computeTotals(doc.lines, doc.deposit_type, doc.deposit_value, doc.discount_type, doc.discount_value);
  const paidDeposit = !!doc.deposit_paid_at;
  const paid = !!doc.paid_at;
  const pending = paid ? 0 : round2(t.total - (paidDeposit ? t.deposit_amount : 0));
  return {
    t, te_senyal: t.deposit_amount > 0, senyal: money(t.deposit_amount),
    senyal_estat: t.deposit_amount > 0 ? (paidDeposit ? '(pagat)' : '(pendent)') : '',
    pendent: money(pending), pendingValue: pending,
  };
}

function quoteCtx(q) {
  const f = docFinance(q);
  return { numero: q.number, total: money(f.t.total), data: fdate(q.date), validesa: fdate(q.valid_until), enllac: baseUrl() + '/p/' + q.token, titol: q.title || '', senyal: f.senyal, te_senyal: f.te_senyal,
    descompte: f.t.discount_amount + f.t.line_discounts > 0 ? money(f.t.discount_amount + f.t.line_discounts) : '' };
}
function invoiceCtx(inv) {
  const f = docFinance(inv);
  return { numero: inv.number, total: money(f.t.total), data: fdate(inv.date), venciment: fdate(inv.due_date), enllac: baseUrl() + '/f/' + inv.token, senyal: f.senyal, senyal_estat: inv.deposit_paid_at ? 'pagat' : 'pendent', te_senyal: f.te_senyal, pendent: f.pendent };
}

function styleCtx() {
  const s = getSettings();
  const t = s.templates;
  return {
    estil: { color: t.color || s.appearance.primary_color, color2: t.color2 || '#1f2937', font: s.appearance.font, logo_h: Math.min(200, Math.max(20, Number(t.logo_height) || 70)) },
    opt: { caixa_servei: t.show_service !== false, columna_iva: t.show_vat_column !== false, eslogan: t.tagline || '' },
  };
}

function buildDocContext(kind, doc, { absolute = false } = {}) {
  const s = getSettings();
  const client = doc.client_id ? get('SELECT * FROM clients WHERE id = ?', doc.client_id) : null;
  const activity = doc.activity_id ? get('SELECT * FROM activities WHERE id = ?', doc.activity_id) : null;
  const f = docFinance(doc);
  const ivas = Object.entries(f.t.vatMap).filter(([, v]) => v > 0).map(([k, v]) => ({ tipus: num(k), quota: money(v) }));
  const discText = doc.discount_type === 'percent' ? `Descompte (${num(doc.discount_value)}%)` : 'Descompte';
  const saving = round2(f.t.discount_amount + f.t.line_discounts);
  return {
    ...styleCtx(),
    empresa: companyCtx(absolute),
    client: clientCtx(client),
    activitat: activityCtx(activity),
    linies: f.t.lines.map(l => ({ descripcio: l.description, quantitat: num(l.quantity), preu: money(l.price), iva: num(l.vat), descompte: l.discount ? '−' + num(l.discount) + '%' : '', import: money(l.amount) })),
    doc: {
      tipus: kind === 'invoice' ? 'FACTURA' : 'PRESSUPOST', numero: doc.number || '', data: fdate(doc.date),
      venciment: fdate(kind === 'invoice' ? doc.due_date : doc.valid_until),
      etiqueta_venciment: kind === 'invoice' ? 'Venciment' : 'Vàlid fins',
      te_dte_linia: f.t.lines.some(l => l.discount > 0),
      te_descompte: f.t.discount_amount > 0, brut: money(f.t.gross), descompte: money(f.t.discount_amount), descompte_text: discText,
      estalvi_total: saving > 0, estalvi: money(saving),
      base: money(f.t.subtotal), iva: money(f.t.vat_total), ivas, total: money(f.t.total),
      te_senyal: f.te_senyal, senyal: f.senyal, senyal_estat: kind === 'invoice' ? f.senyal_estat : '', pendent: f.pendent,
      notes: doc.notes || '', condicions: kind === 'quote' ? (doc.conditions || '') : '', titol: doc.title || '',
      intro: kind === 'quote' ? (doc.intro || '') : '',
      signatura: kind === 'quote' && s.templates.quote_signature,
    },
  };
}

function templateFor(kind) {
  const t = getSettings().templates;
  const custom = kind === 'invoice' ? t.invoice_html : t.quote_html;
  if (custom && custom.trim()) return custom;
  return PRESETS[kind === 'invoice' ? t.invoice_preset : t.quote_preset] || PRESETS.classica;
}

function renderDoc(kind, doc, opts) {
  return render(templateFor(kind), buildDocContext(kind, doc, opts));
}

function messageCtx({ client, quote, invoice, worker, activity, assignment } = {}) {
  const ctx = { empresa: companyCtx(true) };
  if (client) ctx.client = clientCtx(client);
  if (quote) ctx.pressupost = quoteCtx(quote);
  if (invoice) ctx.factura = invoiceCtx(invoice);
  if (worker) ctx.treballador = workerCtx(worker);
  if (activity) ctx.activitat = activityCtx(activity);
  if (assignment) {
    const ap = assignment.activity_product_id ? get('SELECT name FROM activity_products WHERE id = ?', assignment.activity_product_id) : null;
    ctx.assignacio = { producte: (ap && ap.name) || assignment.role || '', rol: assignment.role || '' };
    ctx.enllac_confirmacio = baseUrl() + '/c/' + assignment.token;
  }
  return ctx;
}

// ---------- Correu ----------
function textToHtml(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
}

function smtpConfigured() {
  const e = getSettings().email;
  return !!(e.smtp_host && e.from_email);
}

async function sendEmail({ to, subject, text, related_type = null, related_id = null, automation_id = null }) {
  const s = getSettings();
  const e = s.email;
  const tk = token();
  const sig = e.signature ? '\n\n' + e.signature : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${textToHtml(text + sig)}</div>` +
    `<img src="${baseUrl()}/t/${tk}.gif" width="1" height="1" alt="" style="display:none">`;
  const id = insert('emails', { to_addr: to, subject, body: text + sig, related_type, related_id, automation_id, status: 'pendent', token: tk });
  if (!to) { update('emails', id, { status: 'error', error: 'Sense adreça de correu' }); return { id, status: 'error', error: 'Sense adreça de correu' }; }
  if (!smtpConfigured()) {
    update('emails', id, { status: 'simulat', error: 'Correu no configurat (Configuració > Correu). Desat a la safata.' });
    return { id, status: 'simulat' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: e.smtp_host, port: Number(e.smtp_port) || 587, secure: !!e.smtp_secure,
      auth: e.smtp_user ? { user: e.smtp_user, pass: e.smtp_pass } : undefined,
    });
    await transporter.sendMail({
      from: e.from_name ? `"${e.from_name}" <${e.from_email}>` : e.from_email,
      replyTo: e.reply_to || undefined, to, subject, text: text + sig, html,
    });
    update('emails', id, { status: 'enviat' });
    return { id, status: 'enviat' };
  } catch (err) {
    update('emails', id, { status: 'error', error: String(err.message || err) });
    return { id, status: 'error', error: String(err.message || err) };
  }
}

function renderMessage(str, ctx) { return render(str || '', ctx, { escape: false }); }

// ---------- Accions de domini ----------
async function sendQuote(quoteId, { subject, body } = {}) {
  const q = get('SELECT * FROM quotes WHERE id = ?', quoteId);
  if (!q) throw new Error('Pressupost no trobat');
  const client = q.client_id ? get('SELECT * FROM clients WHERE id = ?', q.client_id) : null;
  if (!q.token) { q.token = token(); update('quotes', q.id, { token: q.token }); }
  const ctx = messageCtx({ client, quote: q });
  const m = getSettings().messages;
  const r = await sendEmail({
    to: client && client.email, subject: renderMessage(subject || m.quote_subject, ctx), text: renderMessage(body || m.quote_body, ctx),
    related_type: 'quote', related_id: q.id,
  });
  if (r.status !== 'error') {
    const patch = { sent_at: q.sent_at || nowISO() };
    if (q.status === 'esborrany') patch.status = 'enviat';
    update('quotes', q.id, patch);
  }
  addTimeline('quote', q.id, 'enviat', `Enviat a ${client?.email || '(sense correu)'} — ${r.status}${r.error ? ': ' + r.error : ''}`);
  return r;
}

async function sendInvoice(invoiceId, { subject, body } = {}) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw new Error('Factura no trobada');
  const client = inv.client_id ? get('SELECT * FROM clients WHERE id = ?', inv.client_id) : null;
  if (!inv.token) { inv.token = token(); update('invoices', inv.id, { token: inv.token }); }
  const ctx = messageCtx({ client, invoice: inv });
  const m = getSettings().messages;
  const r = await sendEmail({
    to: client && client.email, subject: renderMessage(subject || m.invoice_subject, ctx), text: renderMessage(body || m.invoice_body, ctx),
    related_type: 'invoice', related_id: inv.id,
  });
  if (r.status !== 'error') {
    const patch = { sent_at: inv.sent_at || nowISO() };
    if (inv.status === 'esborrany') patch.status = 'emesa';
    update('invoices', inv.id, patch);
  }
  addTimeline('invoice', inv.id, 'enviat', `Enviada a ${client?.email || '(sense correu)'} — ${r.status}${r.error ? ': ' + r.error : ''}`);
  return r;
}

function assignmentBundle(assignmentId) {
  const a = get('SELECT * FROM assignments WHERE id = ?', assignmentId);
  if (!a) return null;
  if (!a.token) { a.token = token(); update('assignments', a.id, { token: a.token }); }
  const worker = get('SELECT * FROM workers WHERE id = ?', a.worker_id);
  const activity = get('SELECT * FROM activities WHERE id = ?', a.activity_id);
  return { a, worker, activity, ctx: messageCtx({ worker, activity, assignment: a }) };
}

async function sendAssignment(assignmentId, { subject, body, automation_id } = {}) {
  const b = assignmentBundle(assignmentId);
  if (!b) throw new Error('Assignació no trobada');
  const m = getSettings().messages;
  const r = await sendEmail({
    to: b.worker.email, subject: renderMessage(subject || m.assignment_subject, b.ctx), text: renderMessage(body || m.assignment_body, b.ctx),
    related_type: 'assignment', related_id: b.a.id, automation_id,
  });
  if (r.status !== 'error' && b.a.status === 'pendent') update('assignments', b.a.id, { status: 'enviat', sent_at: nowISO() });
  addTimeline('activity', b.a.activity_id, 'convocatoria', `Convocatòria a ${b.worker.first_name} ${b.worker.last_name || ''} — ${r.status}${r.error ? ': ' + r.error : ''}`);
  return r;
}

function whatsappLink(assignmentId) {
  const b = assignmentBundle(assignmentId);
  if (!b) return null;
  const text = renderMessage(getSettings().messages.whatsapp_text, b.ctx);
  let phone = String(b.worker.phone || '').replace(/[^\d+]/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  else if (phone.startsWith('00')) phone = phone.slice(2);
  else if (phone.length === 9) phone = '34' + phone; // número espanyol sense prefix
  const url = (phone ? `https://wa.me/${phone}` : 'https://wa.me/') + '?text=' + encodeURIComponent(text);
  return { url, text, phone };
}

// ---------- Contractes ----------
function quoteTableHtml(q) {
  if (!q) return '';
  const f = docFinance(q);
  const rows = f.t.lines.map(l => `<tr><td>${esc(l.description)}</td><td style="text-align:right">${num(l.quantity)}</td><td style="text-align:right">${money(l.price)}${l.discount ? ` <small>(−${num(l.discount)}%)</small>` : ''}</td><td style="text-align:right">${money(l.amount)}</td></tr>`).join('');
  const disc = f.t.discount_amount > 0 ? `<tr><td colspan="3" style="text-align:right">Descompte</td><td style="text-align:right">−${money(f.t.discount_amount)}</td></tr>` : '';
  return `<table><thead><tr><th>Concepte</th><th style="text-align:right">Quant.</th><th style="text-align:right">Preu</th><th style="text-align:right">Import</th></tr></thead><tbody>${rows}${disc}
    <tr><td colspan="3" style="text-align:right">Base imposable</td><td style="text-align:right">${money(f.t.subtotal)}</td></tr>
    <tr><td colspan="3" style="text-align:right">IVA</td><td style="text-align:right">${money(f.t.vat_total)}</td></tr>
    <tr><td colspan="3" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b>${money(f.t.total)}</b></td></tr></tbody></table>`;
}

// variables disponibles per omplir el contracte tipus
function contractFillCtx({ client, quote, activity }) {
  const ctx = messageCtx({ client, quote, activity });
  ctx.client = ctx.client || clientCtx(null);
  ctx.activitat = ctx.activitat || {};
  ctx.pressupost = ctx.pressupost || {};
  if (quote) ctx.pressupost.taula = quoteTableHtml(quote);
  // si no hi ha activitat, el servei és el títol del pressupost o els seus conceptes
  if (!ctx.activitat.titol && quote) ctx.activitat.titol = quote.title || (quote.lines || []).map(l => String(l.description || '').split('\n')[0]).filter(Boolean).join(', ');
  ctx.avui = new Date().toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  return ctx;
}

function fillContractTemplate(body, refs) { return render(body || getSettings().contract.body, contractFillCtx(refs)); }

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

function contractDocCtx(c, { absolute = false } = {}) {
  const client = c.client_id ? get('SELECT * FROM clients WHERE id = ?', c.client_id) : null;
  return {
    ...styleCtx(),
    empresa: companyCtx(absolute),
    client: clientCtx(client),
    contracte: {
      titol: c.title || 'Contracte', numero: c.number || '', data: fdate(String(c.created_at || '').slice(0, 10) || todayISO()),
      cos: sanitizeHtml(c.body), signat: c.status === 'signat' && !!c.signature,
      signatura: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.signature || '') ? c.signature : '',
      signant: c.signer_name || '', signant_nif: c.signer_nif || '', ip: c.signer_ip || '',
      data_signatura: c.signed_at ? new Date(c.signed_at).toLocaleString('ca-ES') : '',
    },
  };
}
function renderContract(c, opts) { return render(CONTRACT_DOC, contractDocCtx(c, opts)); }

function contractMsgCtx(c) {
  const client = c.client_id ? get('SELECT * FROM clients WHERE id = ?', c.client_id) : null;
  const ctx = messageCtx({ client });
  ctx.contracte = { numero: c.number, titol: c.title, enllac: baseUrl() + '/k/' + c.token };
  return { ctx, client };
}

async function sendContract(id, { subject, body } = {}) {
  const c = get('SELECT * FROM contracts WHERE id = ?', id);
  if (!c) throw new Error('Contracte no trobat');
  if (!c.token) { c.token = token(); update('contracts', c.id, { token: c.token }); }
  const { ctx, client } = contractMsgCtx(c);
  const m = getSettings().messages;
  const r = await sendEmail({ to: client && client.email, subject: renderMessage(subject || m.contract_subject, ctx), text: renderMessage(body || m.contract_body, ctx), related_type: 'contract', related_id: c.id });
  if (r.status !== 'error') {
    const patch = { sent_at: c.sent_at || nowISO() };
    if (c.status === 'esborrany') patch.status = 'enviat';
    update('contracts', c.id, patch);
  }
  addTimeline('contract', c.id, 'enviat', `Enviat a ${client?.email || '(sense correu)'} — ${r.status}${r.error ? ': ' + r.error : ''}`);
  return r;
}

// Quan s'obre un correu o un enllaç públic
function markOpened(type, id, via) {
  const now = nowISO();
  if (type === 'quote') {
    const q = get('SELECT * FROM quotes WHERE id = ?', id); if (!q) return;
    const patch = { last_opened_at: now, open_count: (q.open_count || 0) + 1 };
    if (!q.first_opened_at) patch.first_opened_at = now;
    if (q.status === 'enviat') patch.status = 'vist';
    update('quotes', id, patch);
    if (!q.first_opened_at) addTimeline('quote', id, 'vist', `El client l'ha obert per primer cop (${via})`);
  } else if (type === 'invoice') {
    const inv = get('SELECT * FROM invoices WHERE id = ?', id); if (!inv) return;
    update('invoices', id, { open_count: (inv.open_count || 0) + 1, first_opened_at: inv.first_opened_at || now });
    if (!inv.first_opened_at) addTimeline('invoice', id, 'vist', `El client l'ha oberta (${via})`);
  } else if (type === 'contract') {
    const c = get('SELECT * FROM contracts WHERE id = ?', id); if (!c) return;
    const patch = { open_count: (c.open_count || 0) + 1, first_opened_at: c.first_opened_at || now };
    if (c.status === 'enviat') patch.status = 'vist';
    update('contracts', id, patch);
    if (!c.first_opened_at) addTimeline('contract', id, 'vist', `El client l'ha obert (${via})`);
  } else if (type === 'assignment') {
    const a = get('SELECT * FROM assignments WHERE id = ?', id); if (!a) return;
    if (['pendent', 'enviat'].includes(a.status)) update('assignments', id, { status: 'rebut', received_at: now });
    else if (!a.received_at) update('assignments', id, { received_at: now });
  }
}

module.exports = {
  getSettings, saveSettings, setSeenOrigin, baseUrl, money, num, fdate, round2, token, todayISO, addDays, parseTs, nowISO,
  computeTotals, nextNumber, buildDocContext, renderDoc, templateFor, messageCtx, renderMessage, sendEmail, smtpConfigured,
  sendQuote, sendInvoice, sendAssignment, whatsappLink, markOpened, docFinance, assignmentBundle,
  fillContractTemplate, contractFillCtx, renderContract, sendContract, sanitizeHtml, contractMsgCtx, styleCtx, companyCtx,
};
