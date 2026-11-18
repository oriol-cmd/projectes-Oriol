process.env.TZ = process.env.TZ || 'Europe/Madrid';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, all, get, run, insert, update, pick, addTimeline, UPLOAD_DIR, DATA_DIR } = require('./db');
const backup = require('./backup');
const A = require('./auth');
const S = require('./services');
const { PRESETS, TRIGGERS, DEFAULT_AUTOMATIONS } = require('./defaults');
const { esc, render } = require('./tpl');
const automations = require('./automations');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use(A.authMiddleware);
app.use((req, res, next) => { if (req.user && req.user.role === 'admin') S.setSeenOrigin(`${req.protocol}://${req.get('host')}`); next(); });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${S.token().slice(0, 10)}${path.extname(file.originalname || '').slice(0, 10)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error' });
});
function fail(status, msg) { const e = new Error(msg); e.status = status; throw e; }
const idp = req => Number(req.params.id);

// Primera execució: automatismes per defecte
if (!get('SELECT id FROM automations LIMIT 1')) for (const a of DEFAULT_AUTOMATIONS) insert('automations', a);

// ================= AUTENTICACIÓ =================
app.get('/api/setup-status', (req, res) => {
  res.json({ needsSetup: !get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`), appName: S.getSettings().appearance.app_name, color: S.getSettings().appearance.primary_color, hasLogo: !!S.getSettings().company.logo });
});
app.post('/api/setup', wrap((req, res) => {
  if (get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)) fail(400, 'Ja hi ha un administrador');
  const { username, password, name, company } = req.body || {};
  if (!username || !password || password.length < 8) fail(400, 'Usuari i contrasenya (mínim 8 caràcters) obligatoris');
  const id = insert('users', { username: username.trim().toLowerCase(), name: name || username, password_hash: A.hashPassword(password), role: 'admin' });
  if (company) S.saveSettings({ company: { name: company } });
  setCookie(res, A.createSession(id), req);
  res.json({ ok: true });
}));

function setCookie(res, token, req) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
}

app.post('/api/login', wrap((req, res) => {
  const key = req.ip;
  if (A.tooManyAttempts(key)) fail(429, 'Massa intents. Torna-ho a provar d\'aquí a 15 minuts.');
  const { username, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE username = ?', String(username || '').trim().toLowerCase());
  if (!u || !A.verifyPassword(password, u.password_hash)) { A.registerFail(key); fail(401, 'Usuari o contrasenya incorrectes'); }
  if (!u.active) fail(403, 'Aquest usuari està desactivat');
  A.clearFails(key);
  setCookie(res, A.createSession(u.id), req);
  res.json({ ok: true, role: u.role });
}));
app.post('/api/logout', (req, res) => {
  if (req.user) run('DELETE FROM sessions WHERE token = ?', req.user.sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', A.requireAuth, (req, res) => {
  const s = S.getSettings();
  const out = { user: pick(req.user, ['id', 'username', 'name', 'role', 'worker_id']), appearance: s.appearance, company: { name: s.company.name, logo: !!s.company.logo } };
  if (req.user.worker_id) out.worker = get('SELECT id, first_name, last_name, email, phone FROM workers WHERE id = ?', req.user.worker_id);
  if (req.user.role === 'admin') {
    out.custom_fields = s.custom_fields; out.activity_statuses = s.activity_statuses; out.worker_roles = s.worker_roles;
    out.document_categories = s.document_categories; out.invoicing = s.invoicing;
  } else {
    out.document_categories = s.document_categories;
  }
  res.json(out);
});
app.put('/api/me/password', A.requireAuth, wrap((req, res) => {
  const { current, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!A.verifyPassword(current, u.password_hash)) fail(400, 'La contrasenya actual no és correcta');
  if (!password || password.length < 8) fail(400, 'La nova contrasenya ha de tenir 8 caràcters o més');
  update('users', u.id, { password_hash: A.hashPassword(password) });
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', u.id, req.user.sid);
  res.json({ ok: true });
}));

// ================= CONFIGURACIÓ =================
app.get('/api/settings', A.requireAdmin, (req, res) => {
  const s = JSON.parse(JSON.stringify(S.getSettings()));
  s.email.smtp_pass = s.email.smtp_pass ? '••••••••' : '';
  res.json({ settings: s, presets: Object.keys(PRESETS), triggers: TRIGGERS, baseUrl: S.baseUrl(), smtpConfigured: S.smtpConfigured() });
});
app.put('/api/settings', A.requireAdmin, wrap((req, res) => {
  const body = req.body || {};
  if (body.email && body.email.smtp_pass === '••••••••') delete body.email.smtp_pass;
  S.saveSettings(body);
  res.json({ ok: true });
}));
app.get('/api/settings/preset/:name', A.requireAdmin, (req, res) => res.json({ html: PRESETS[req.params.name] || '' }));
app.post('/api/settings/logo', A.requireAdmin, upload.single('file'), wrap((req, res) => {
  if (!req.file) fail(400, 'Cap fitxer');
  if (!/^image\//.test(req.file.mimetype)) { fs.unlinkSync(req.file.path); fail(400, 'Ha de ser una imatge'); }
  const old = S.getSettings().company.logo;
  if (old) fs.rm(path.join(UPLOAD_DIR, old), () => {});
  S.saveSettings({ company: { logo: req.file.filename } });
  res.json({ ok: true });
}));
app.delete('/api/settings/logo', A.requireAdmin, (req, res) => {
  const old = S.getSettings().company.logo;
  if (old) fs.rm(path.join(UPLOAD_DIR, old), () => {});
  S.saveSettings({ company: { logo: '' } });
  res.json({ ok: true });
});
app.get('/logo', (req, res) => {
  const l = S.getSettings().company.logo;
  if (!l) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, l));
});
app.post('/api/settings/test-email', A.requireAdmin, wrap(async (req, res) => {
  const r = await S.sendEmail({ to: req.body.to, subject: 'Prova de correu', text: 'Si llegeixes això, el correu de la plataforma funciona correctament. ✅' });
  res.json(r);
}));

// Còpia de seguretat descarregable (base de dades + documents)
app.get('/api/backup', A.requireAdmin, (req, res) => {
  const tar = backup.backupStream(db, DATA_DIR);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="gestio-${backup.stamp()}.tar.gz"`);
  tar.stdout.pipe(res);
  tar.on('error', () => res.destroy());
});

// Previsualització d'una plantilla de document amb dades d'exemple
app.post('/api/render-preview', A.requireAdmin, wrap((req, res) => {
  const { kind = 'invoice', html } = req.body || {};
  const sample = {
    number: kind === 'invoice' ? 'F2026-0001' : 'P2026-0001', date: S.todayISO(), due_date: S.addDays(S.todayISO(), 30), valid_until: S.addDays(S.todayISO(), 30),
    lines: [{ description: 'Servei de monitoratge (4 h)', quantity: 2, price: 80, vat: 21 }, { description: 'Material', quantity: 1, price: 45.5, vat: 21 }],
    deposit_type: 'percent', deposit_value: 30, notes: 'Notes d\'exemple del document.', conditions: S.getSettings().invoicing.quote_conditions,
  };
  const ctx = S.buildDocContext(kind, sample);
  ctx.client = { nom: 'Client d\'exemple SL', nif: 'B12345678', adreca: 'Carrer Major, 1', cp: '08001', poblacio: 'Barcelona', email: 'client@exemple.cat' };
  ctx.activitat = { titol: 'Activitat d\'exemple', data: S.fdate(S.addDays(S.todayISO(), 10)), lloc: 'Parc de la Ciutadella' };
  res.type('html').send(render(html || S.templateFor(kind), ctx));
}));

// ================= USUARIS ADMINISTRADORS =================
app.get('/api/users', A.requireAdmin, (req, res) => res.json(all(`SELECT id, username, name, role, active, last_login, worker_id FROM users WHERE role = 'admin' ORDER BY username`)));
app.post('/api/users', A.requireAdmin, wrap((req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password || password.length < 8) fail(400, 'Usuari i contrasenya (mínim 8) obligatoris');
  if (get('SELECT id FROM users WHERE username = ?', username.trim().toLowerCase())) fail(400, 'Aquest nom d\'usuari ja existeix');
  res.json({ id: insert('users', { username: username.trim().toLowerCase(), name, password_hash: A.hashPassword(password), role: 'admin' }) });
}));
app.put('/api/users/:id', A.requireAdmin, wrap((req, res) => {
  const u = get(`SELECT * FROM users WHERE id = ? AND role = 'admin'`, idp(req)); if (!u) fail(404, 'No trobat');
  const patch = pick(req.body, ['name', 'active']);
  if (req.body.password) { if (req.body.password.length < 8) fail(400, 'Mínim 8 caràcters'); patch.password_hash = A.hashPassword(req.body.password); }
  if (u.id === req.user.id && patch.active === 0) fail(400, 'No et pots desactivar a tu mateix');
  update('users', u.id, patch);
  if (patch.active === 0 || patch.password_hash) run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', u.id, req.user.sid);
  res.json({ ok: true });
}));
app.delete('/api/users/:id', A.requireAdmin, wrap((req, res) => {
  if (idp(req) === req.user.id) fail(400, 'No et pots esborrar a tu mateix');
  run(`DELETE FROM users WHERE id = ? AND role = 'admin'`, idp(req));
  res.json({ ok: true });
}));

// ================= TREBALLADORS =================
const WORKER_FIELDS = ['first_name', 'last_name', 'dni', 'email', 'phone', 'notes', 'active', 'weekly', 'extra'];
app.get('/api/workers', A.requireAdmin, (req, res) => {
  res.json(all(`SELECT w.*, u.username, u.active AS user_active, u.id AS user_id,
    (SELECT COUNT(*) FROM documents d WHERE d.owner_type = 'worker' AND d.owner_id = w.id) AS doc_count
    FROM workers w LEFT JOIN users u ON u.worker_id = w.id ORDER BY w.active DESC, w.first_name, w.last_name`));
});
app.get('/api/workers/:id', A.requireAdmin, wrap((req, res) => {
  const w = get('SELECT * FROM workers WHERE id = ?', idp(req)); if (!w) fail(404, 'No trobat');
  w.user = get('SELECT id, username, active, last_login FROM users WHERE worker_id = ?', w.id);
  w.documents = all(`SELECT * FROM documents WHERE owner_type = 'worker' AND owner_id = ? ORDER BY created_at DESC`, w.id);
  w.unavailability = all('SELECT * FROM worker_unavailability WHERE worker_id = ? ORDER BY date_from DESC', w.id);
  w.assignments = all(`SELECT s.*, a.title, a.date, a.start_time, a.location, a.status AS activity_status, ap.name AS product_name FROM assignments s
    JOIN activities a ON a.id = s.activity_id LEFT JOIN activity_products ap ON ap.id = s.activity_product_id WHERE s.worker_id = ? ORDER BY a.date DESC LIMIT 100`, w.id);
  res.json(w);
}));
app.post('/api/workers', A.requireAdmin, wrap((req, res) => {
  if (!req.body.first_name) fail(400, 'El nom és obligatori');
  res.json({ id: insert('workers', pick(req.body, WORKER_FIELDS)) });
}));
app.put('/api/workers/:id', A.requireAdmin, wrap((req, res) => { update('workers', idp(req), pick(req.body, WORKER_FIELDS)); res.json({ ok: true }); }));
app.delete('/api/workers/:id', A.requireAdmin, wrap((req, res) => {
  for (const d of all(`SELECT filename FROM documents WHERE owner_type = 'worker' AND owner_id = ?`, idp(req))) fs.rm(path.join(UPLOAD_DIR, d.filename), () => {});
  run(`DELETE FROM documents WHERE owner_type = 'worker' AND owner_id = ?`, idp(req));
  run('DELETE FROM workers WHERE id = ?', idp(req));
  res.json({ ok: true });
}));
// Usuari d'accés del treballador (accés limitat)
app.post('/api/workers/:id/user', A.requireAdmin, wrap((req, res) => {
  const w = get('SELECT * FROM workers WHERE id = ?', idp(req)); if (!w) fail(404, 'No trobat');
  const { username, password, active } = req.body || {};
  const existing = get('SELECT * FROM users WHERE worker_id = ?', w.id);
  if (existing) {
    const patch = {};
    if (username) {
      const u = username.trim().toLowerCase();
      if (get('SELECT id FROM users WHERE username = ? AND id <> ?', u, existing.id)) fail(400, 'Aquest nom d\'usuari ja existeix');
      patch.username = u;
    }
    if (password) { if (password.length < 8) fail(400, 'La contrasenya ha de tenir 8 caràcters o més'); patch.password_hash = A.hashPassword(password); }
    if (active !== undefined) patch.active = active ? 1 : 0;
    update('users', existing.id, patch);
    if (patch.password_hash || patch.active === 0) run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    return res.json({ ok: true });
  }
  if (!username || !password || password.length < 8) fail(400, 'Usuari i contrasenya (mínim 8) obligatoris');
  const u = username.trim().toLowerCase();
  if (get('SELECT id FROM users WHERE username = ?', u)) fail(400, 'Aquest nom d\'usuari ja existeix');
  insert('users', { username: u, name: `${w.first_name} ${w.last_name || ''}`.trim(), password_hash: A.hashPassword(password), role: 'worker', worker_id: w.id });
  res.json({ ok: true });
}));
app.delete('/api/workers/:id/user', A.requireAdmin, (req, res) => { run(`DELETE FROM users WHERE worker_id = ? AND role = 'worker'`, idp(req)); res.json({ ok: true }); });

app.post('/api/workers/:id/unavailability', A.requireAdmin, wrap((req, res) => {
  const { date_from, date_to, reason, kind } = req.body || {};
  if (!date_from) fail(400, 'Cal la data');
  res.json({ id: insert('worker_unavailability', { worker_id: idp(req), date_from, date_to: date_to || date_from, reason, kind: kind || 'no' }) });
}));
app.delete('/api/unavailability/:id', A.requireAuth, wrap((req, res) => {
  const u = get('SELECT * FROM worker_unavailability WHERE id = ?', idp(req)); if (!u) fail(404, 'No trobat');
  if (req.user.role !== 'admin' && req.user.worker_id !== u.worker_id) fail(403, 'Accés restringit');
  run('DELETE FROM worker_unavailability WHERE id = ?', u.id);
  res.json({ ok: true });
}));

// Disponibilitat per a una data
function overlap(s1, e1, s2, e2) { if (!s1 || !s2) return true; return (s1 < (e2 || '23:59')) && (s2 < (e1 || '23:59')); }
function availability(date, start, end, excludeActivityId) {
  const day = String(new Date(date + 'T12:00:00').getDay());
  const workers = all('SELECT id, first_name, last_name, weekly, active, phone, email FROM workers WHERE active = 1 ORDER BY first_name');
  return workers.map(w => {
    const reasons = []; let available = true; let warn = false;
    const weekly = w.weekly || {};
    const configured = Object.keys(weekly).length > 0;
    const extraYes = get(`SELECT * FROM worker_unavailability WHERE worker_id = ? AND kind = 'si' AND ? BETWEEN date_from AND date_to`, w.id, date);
    if (configured && !extraYes) {
      const d = weekly[day];
      if (!d || !d.on) { available = false; reasons.push('No treballa aquest dia de la setmana'); }
      else if (start && d.from && d.to && (start < d.from || (end && end > d.to))) { warn = true; reasons.push(`Horari habitual ${d.from}-${d.to}`); }
    }
    const un = get(`SELECT * FROM worker_unavailability WHERE worker_id = ? AND kind = 'no' AND ? BETWEEN date_from AND date_to`, w.id, date);
    if (un) { available = false; reasons.push('No disponible' + (un.reason ? `: ${un.reason}` : '')); }
    const busy = all(`SELECT a.id, a.title, a.start_time, a.end_time FROM assignments s JOIN activities a ON a.id = s.activity_id
      WHERE s.worker_id = ? AND a.date = ? AND a.id <> ? AND a.status <> 'cancel·lada' AND s.status <> 'rebutjat'`, w.id, date, excludeActivityId || 0);
    for (const b of busy) {
      if (overlap(start, end, b.start_time, b.end_time)) { available = false; reasons.push(`Ja té feina: ${b.title || 'activitat'} ${b.start_time || ''}`); }
      else { warn = true; reasons.push(`Altra feina el mateix dia (${b.start_time}-${b.end_time || ''})`); }
    }
    return { id: w.id, name: `${w.first_name} ${w.last_name || ''}`.trim(), available, warn, reasons };
  });
}
app.get('/api/availability', A.requireAdmin, wrap((req, res) => {
  if (!req.query.date) fail(400, 'Cal la data');
  res.json(availability(req.query.date, req.query.start, req.query.end, Number(req.query.exclude) || 0));
}));

// ================= DOCUMENTS =================
function canAccessDoc(user, d) {
  if (user.role === 'admin') return true;
  return d.owner_type === 'worker' && d.owner_id === user.worker_id && d.visible_to_worker;
}
app.post('/api/documents', A.requireAuth, upload.array('files', 20), wrap((req, res) => {
  let owner_type = req.body.owner_type, owner_id = Number(req.body.owner_id);
  if (req.user.role !== 'admin') { owner_type = 'worker'; owner_id = req.user.worker_id; }
  if (!['worker', 'client', 'activity'].includes(owner_type) || !owner_id) fail(400, 'Propietari no vàlid');
  const ids = [];
  for (const f of req.files || []) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    ids.push(insert('documents', { owner_type, owner_id, name: req.body.name && req.files.length === 1 ? req.body.name : name, filename: f.filename, mime: f.mimetype, size: f.size, category: req.body.category || null, visible_to_worker: req.body.visible_to_worker === '0' ? 0 : 1, uploaded_by: req.user.id }));
  }
  res.json({ ids });
}));
app.get('/api/documents', A.requireAdmin, (req, res) => res.json(all('SELECT * FROM documents WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC', req.query.owner_type, Number(req.query.owner_id))));
app.put('/api/documents/:id', A.requireAdmin, (req, res) => { update('documents', idp(req), pick(req.body, ['name', 'category', 'visible_to_worker'])); res.json({ ok: true }); });
app.get('/api/documents/:id/file', A.requireAuth, wrap((req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', idp(req)); if (!d || !canAccessDoc(req.user, d)) fail(404, 'No trobat');
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  fs.createReadStream(path.join(UPLOAD_DIR, d.filename)).on('error', () => res.status(404).end()).pipe(res);
}));
app.delete('/api/documents/:id', A.requireAuth, wrap((req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', idp(req)); if (!d) fail(404, 'No trobat');
  if (req.user.role !== 'admin' && !(d.owner_type === 'worker' && d.owner_id === req.user.worker_id && d.uploaded_by === req.user.id)) fail(403, 'Accés restringit');
  fs.rm(path.join(UPLOAD_DIR, d.filename), () => {});
  run('DELETE FROM documents WHERE id = ?', d.id);
  res.json({ ok: true });
}));

// ================= CLIENTS =================
const CLIENT_FIELDS = ['name', 'nif', 'email', 'phone', 'address', 'city', 'postal_code', 'notes', 'extra'];
app.get('/api/clients', A.requireAdmin, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM activities a WHERE a.client_id = c.id) AS activity_count,
    (SELECT MAX(date) FROM activities a WHERE a.client_id = c.id) AS last_activity
    FROM clients c WHERE c.name LIKE ? OR IFNULL(c.nif,'') LIKE ? OR IFNULL(c.email,'') LIKE ? OR IFNULL(c.phone,'') LIKE ? ORDER BY c.name LIMIT 500`, q, q, q, q));
});
app.get('/api/clients/:id', A.requireAdmin, wrap((req, res) => {
  const c = get('SELECT * FROM clients WHERE id = ?', idp(req)); if (!c) fail(404, 'No trobat');
  c.activities = all('SELECT id, title, date, location, status FROM activities WHERE client_id = ? ORDER BY date DESC', c.id);
  c.quotes = all('SELECT id, number, date, status, total FROM quotes WHERE client_id = ? ORDER BY date DESC', c.id);
  c.invoices = all('SELECT id, number, date, status, total, paid_at FROM invoices WHERE client_id = ? ORDER BY date DESC', c.id);
  c.documents = all(`SELECT * FROM documents WHERE owner_type = 'client' AND owner_id = ?`, c.id);
  res.json(c);
}));
app.post('/api/clients', A.requireAdmin, wrap((req, res) => { if (!req.body.name) fail(400, 'El nom és obligatori'); res.json({ id: insert('clients', pick(req.body, CLIENT_FIELDS)) }); }));
app.put('/api/clients/:id', A.requireAdmin, wrap((req, res) => { update('clients', idp(req), pick(req.body, CLIENT_FIELDS)); res.json({ ok: true }); }));
app.delete('/api/clients/:id', A.requireAdmin, (req, res) => { run('DELETE FROM clients WHERE id = ?', idp(req)); res.json({ ok: true }); });

// Desa o actualitza el client que ve d'un formulari (activitat, pressupost, factura)
function resolveClient(body) {
  if (body.client && body.client.name) {
    const data = pick(body.client, CLIENT_FIELDS);
    if (body.client.id) { update('clients', Number(body.client.id), data); return Number(body.client.id); }
    // evita duplicats pel NIF o el correu
    const dup = (data.nif && get('SELECT id FROM clients WHERE UPPER(nif) = UPPER(?)', data.nif)) || (data.email && get('SELECT id FROM clients WHERE LOWER(email) = LOWER(?)', data.email));
    if (dup) { update('clients', dup.id, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v != null))); return dup.id; }
    return insert('clients', data);
  }
  return body.client_id ? Number(body.client_id) : null;
}

// ================= PRODUCTES =================
const PRODUCT_FIELDS = ['name', 'description', 'price', 'vat', 'unit', 'workers_needed', 'color', 'active'];
app.get('/api/products', A.requireAdmin, (req, res) => res.json(all('SELECT * FROM products ORDER BY active DESC, name')));
app.post('/api/products', A.requireAdmin, wrap((req, res) => { if (!req.body.name) fail(400, 'El nom és obligatori'); res.json({ id: insert('products', pick(req.body, PRODUCT_FIELDS)) }); }));
app.put('/api/products/:id', A.requireAdmin, wrap((req, res) => { update('products', idp(req), pick(req.body, PRODUCT_FIELDS)); res.json({ ok: true }); }));
app.delete('/api/products/:id', A.requireAdmin, (req, res) => { run('DELETE FROM products WHERE id = ?', idp(req)); res.json({ ok: true }); });

// ================= ACTIVITATS =================
const ACTIVITY_FIELDS = ['title', 'location', 'date', 'end_date', 'start_time', 'end_time', 'status', 'notes', 'worker_notes', 'whatsapp_link', 'extra', 'quote_id'];
function activityFull(id) {
  const a = get(`SELECT a.*, c.name AS client_name FROM activities a LEFT JOIN clients c ON c.id = a.client_id WHERE a.id = ?`, id);
  if (!a) return null;
  a.client = a.client_id ? get('SELECT * FROM clients WHERE id = ?', a.client_id) : null;
  a.products = all('SELECT ap.*, p.color FROM activity_products ap LEFT JOIN products p ON p.id = ap.product_id WHERE ap.activity_id = ? ORDER BY ap.id', id);
  const assigns = all(`SELECT s.*, w.first_name, w.last_name, w.phone, w.email FROM assignments s JOIN workers w ON w.id = s.worker_id WHERE s.activity_id = ? ORDER BY s.id`, id);
  for (const p of a.products) p.workers = assigns.filter(s => s.activity_product_id === p.id);
  a.unassigned = assigns.filter(s => !s.activity_product_id);
  a.assignments = assigns;
  a.timeline = all(`SELECT * FROM timeline WHERE entity_type = 'activity' AND entity_id = ? ORDER BY id DESC LIMIT 50`, id);
  a.documents = all(`SELECT * FROM documents WHERE owner_type = 'activity' AND owner_id = ?`, id);
  a.invoices = all('SELECT id, number, status, total FROM invoices WHERE activity_id = ?', id);
  a.quotes = all('SELECT id, number, status, total FROM quotes WHERE activity_id = ? OR id = ?', id, a.quote_id || 0);
  return a;
}
app.get('/api/activities', A.requireAdmin, (req, res) => {
  const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31';
  const rows = all(`SELECT a.*, c.name AS client_name,
    (SELECT GROUP_CONCAT(ap.name, ', ') FROM activity_products ap WHERE ap.activity_id = a.id) AS product_names,
    (SELECT p.color FROM activity_products ap JOIN products p ON p.id = ap.product_id WHERE ap.activity_id = a.id LIMIT 1) AS color,
    (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id) AS n_assigned,
    (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id AND s.status = 'confirmat') AS n_confirmed,
    (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id AND s.status = 'rebutjat') AS n_rejected
    FROM activities a LEFT JOIN clients c ON c.id = a.client_id WHERE a.date <= ? AND COALESCE(NULLIF(a.end_date,''), a.date) >= ? ORDER BY a.date, a.start_time`, to, from);
  res.json(rows);
});
app.get('/api/activities/:id', A.requireAdmin, wrap((req, res) => { const a = activityFull(idp(req)); if (!a) fail(404, 'No trobada'); res.json(a); }));

function saveActivity(id, body) {
  if (!body.date) fail(400, 'La data és obligatòria');
  const data = pick(body, ACTIVITY_FIELDS);
  for (const k of ['end_date', 'start_time', 'end_time']) if (data[k] === '') data[k] = null;
  if (data.end_date && data.end_date < (data.date || '')) data.end_date = null;
  if ('client' in body || 'client_id' in body) data.client_id = resolveClient(body);
  const client_id = data.client_id !== undefined ? data.client_id : (id ? get('SELECT client_id FROM activities WHERE id = ?', id)?.client_id : null);
  if ((!id && !data.title) || data.title === '') {
    const firstProduct = (body.products || [])[0];
    const c = client_id ? get('SELECT name FROM clients WHERE id = ?', client_id) : null;
    data.title = [firstProduct && (firstProduct.name || (firstProduct.product_id && get('SELECT name FROM products WHERE id = ?', firstProduct.product_id)?.name)), c && c.name].filter(Boolean).join(' · ') || 'Activitat';
  }
  if (id) update('activities', id, data); else { id = insert('activities', data); addTimeline('activity', id, 'creada', 'Activitat creada'); }
  if (Array.isArray(body.products)) {
    const keep = [];
    for (const p of body.products) {
      const prod = p.product_id ? get('SELECT * FROM products WHERE id = ?', p.product_id) : null;
      const row = { activity_id: id, product_id: p.product_id || null, name: p.name || (prod && prod.name) || 'Producte', quantity: p.quantity ?? 1, price: p.price ?? (prod ? prod.price : 0), vat: p.vat ?? (prod ? prod.vat : 21) };
      let apId = p.id && get('SELECT id FROM activity_products WHERE id = ? AND activity_id = ?', p.id, id) ? Number(p.id) : null;
      if (apId) update('activity_products', apId, row); else apId = insert('activity_products', row);
      keep.push(apId);
      const wanted = (p.workers || []).map(w => (typeof w === 'object' ? w : { worker_id: w }));
      const existing = all('SELECT * FROM assignments WHERE activity_product_id = ?', apId);
      for (const e of existing) {
        const w = wanted.find(x => Number(x.worker_id) === e.worker_id);
        if (!w) run('DELETE FROM assignments WHERE id = ?', e.id);
        else if (w.role !== undefined && w.role !== e.role) update('assignments', e.id, { role: w.role });
      }
      for (const w of wanted) {
        if (!existing.find(e => e.worker_id === Number(w.worker_id))) {
          insert('assignments', { activity_id: id, activity_product_id: apId, worker_id: Number(w.worker_id), role: w.role || null, token: S.token() });
        }
      }
    }
    const old = all('SELECT id FROM activity_products WHERE activity_id = ?', id).filter(r => !keep.includes(r.id));
    for (const o of old) run('DELETE FROM activity_products WHERE id = ?', o.id);
  }
  return id;
}
app.post('/api/activities', A.requireAdmin, wrap((req, res) => res.json({ id: saveActivity(null, req.body || {}) })));
app.put('/api/activities/:id', A.requireAdmin, wrap((req, res) => {
  const before = get('SELECT * FROM activities WHERE id = ?', idp(req)); if (!before) fail(404, 'No trobada');
  saveActivity(idp(req), req.body || {});
  const after = get('SELECT * FROM activities WHERE id = ?', idp(req));
  if (before.date !== after.date || before.start_time !== after.start_time || before.location !== after.location)
    addTimeline('activity', after.id, 'canvi', `Canvi de data/hora/lloc: ${S.fdate(before.date)} ${before.start_time || ''} ${before.location || ''} → ${S.fdate(after.date)} ${after.start_time || ''} ${after.location || ''}`);
  if (before.status !== after.status) addTimeline('activity', after.id, 'estat', `Estat: ${before.status} → ${after.status}`);
  res.json({ ok: true });
}));
app.delete('/api/activities/:id', A.requireAdmin, (req, res) => { run('DELETE FROM activities WHERE id = ?', idp(req)); res.json({ ok: true }); });
app.post('/api/activities/:id/duplicate', A.requireAdmin, wrap((req, res) => {
  const a = activityFull(idp(req)); if (!a) fail(404, 'No trobada');
  const body = { ...pick(a, ACTIVITY_FIELDS), client_id: a.client_id, date: req.body.date || a.date, status: 'pendent', products: a.products.map(p => ({ product_id: p.product_id, name: p.name, quantity: p.quantity, price: p.price, vat: p.vat, workers: req.body.withWorkers ? p.workers.map(w => ({ worker_id: w.worker_id, role: w.role })) : [] })) };
  res.json({ id: saveActivity(null, body) });
}));

// Convocatòries
app.post('/api/activities/:id/send-assignments', A.requireAdmin, wrap(async (req, res) => {
  const ids = req.body.ids && req.body.ids.length ? req.body.ids : all(`SELECT id FROM assignments WHERE activity_id = ? AND status IN ('pendent','enviat')`, idp(req)).map(r => r.id);
  const results = [];
  for (const id of ids) results.push({ id, ...(await S.sendAssignment(id)) });
  res.json({ results });
}));
app.post('/api/assignments/:id/send', A.requireAdmin, wrap(async (req, res) => res.json(await S.sendAssignment(idp(req)))));
app.get('/api/assignments/:id/whatsapp', A.requireAdmin, wrap((req, res) => {
  const r = S.whatsappLink(idp(req)); if (!r) fail(404, 'No trobada');
  const a = get('SELECT * FROM assignments WHERE id = ?', idp(req));
  if (req.query.mark && a.status === 'pendent') update('assignments', a.id, { status: 'enviat', sent_at: S.nowISO() });
  res.json(r);
}));
app.put('/api/assignments/:id', A.requireAdmin, wrap((req, res) => {
  const patch = pick(req.body, ['status', 'role', 'response_note']);
  if (patch.status === 'confirmat' || patch.status === 'rebutjat') patch.responded_at = S.nowISO();
  update('assignments', idp(req), patch);
  res.json({ ok: true });
}));

// ================= PRESSUPOSTOS I FACTURES =================
const QUOTE_FIELDS = ['number', 'title', 'date', 'valid_until', 'status', 'notes', 'conditions', 'activity_id', 'deposit_type', 'deposit_value', 'response_note'];
const INVOICE_FIELDS = ['number', 'date', 'due_date', 'status', 'notes', 'activity_id', 'quote_id', 'deposit_type', 'deposit_value', 'payment_method', 'deposit_paid_at', 'paid_at'];

function docPatch(body, fields) {
  const data = pick(body, fields);
  if (body.lines) {
    const t = S.computeTotals(body.lines, body.deposit_type, body.deposit_value);
    Object.assign(data, { lines: t.lines, subtotal: t.subtotal, vat_total: t.vat_total, total: t.total });
    if (fields === INVOICE_FIELDS) data.deposit_amount = t.deposit_amount;
  }
  const client_id = resolveClient(body);
  if (client_id || body.client_id === null) data.client_id = client_id;
  return data;
}

function listDocs(table) {
  return all(`SELECT d.*, c.name AS client_name, c.email AS client_email,
    (SELECT COUNT(*) FROM emails e WHERE e.related_type = ? AND e.related_id = d.id) AS email_count
    FROM ${table} d LEFT JOIN clients c ON c.id = d.client_id ORDER BY d.date DESC, d.id DESC`, table === 'quotes' ? 'quote' : 'invoice');
}
function docFull(table, id) {
  const d = get(`SELECT d.*, c.name AS client_name FROM ${table} d LEFT JOIN clients c ON c.id = d.client_id WHERE d.id = ?`, id);
  if (!d) return null;
  const type = table === 'quotes' ? 'quote' : 'invoice';
  d.client = d.client_id ? get('SELECT * FROM clients WHERE id = ?', d.client_id) : null;
  d.timeline = all('SELECT * FROM timeline WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC', type, id);
  d.emails = all('SELECT id, to_addr, subject, status, error, opened_at, open_count, created_at, automation_id FROM emails WHERE related_type = ? AND related_id = ? ORDER BY id DESC', type, id);
  d.public_url = d.token ? S.baseUrl() + (type === 'quote' ? '/p/' : '/f/') + d.token : '';
  d.finance = S.docFinance(d);
  delete d.finance.t.vatMap;
  return d;
}

// --- Pressupostos
app.get('/api/quotes', A.requireAdmin, (req, res) => res.json(listDocs('quotes')));
app.get('/api/quotes/:id', A.requireAdmin, wrap((req, res) => { const d = docFull('quotes', idp(req)); if (!d) fail(404, 'No trobat'); res.json(d); }));
app.post('/api/quotes', A.requireAdmin, wrap((req, res) => {
  const s = S.getSettings();
  const data = docPatch(req.body, QUOTE_FIELDS);
  data.number = data.number || S.nextNumber('quote');
  data.date = data.date || S.todayISO();
  data.valid_until = data.valid_until || S.addDays(data.date, s.invoicing.quote_validity_days);
  data.conditions = data.conditions ?? s.invoicing.quote_conditions;
  data.token = S.token();
  const id = insert('quotes', data);
  addTimeline('quote', id, 'creat', 'Pressupost creat');
  res.json({ id });
}));
app.put('/api/quotes/:id', A.requireAdmin, wrap((req, res) => {
  const before = get('SELECT status FROM quotes WHERE id = ?', idp(req)); if (!before) fail(404, 'No trobat');
  const data = docPatch(req.body, QUOTE_FIELDS);
  if (data.status && data.status !== before.status) {
    addTimeline('quote', idp(req), 'estat', `Estat canviat manualment: ${before.status} → ${data.status}`);
    if (['acceptat', 'rebutjat'].includes(data.status)) data.responded_at = S.nowISO();
  }
  update('quotes', idp(req), data);
  res.json({ ok: true });
}));
app.delete('/api/quotes/:id', A.requireAdmin, (req, res) => { run('DELETE FROM quotes WHERE id = ?', idp(req)); res.json({ ok: true }); });
app.post('/api/quotes/:id/send', A.requireAdmin, wrap(async (req, res) => res.json(await S.sendQuote(idp(req), req.body || {}))));
app.get('/api/quotes/:id/html', A.requireAdmin, wrap((req, res) => { const q = get('SELECT * FROM quotes WHERE id = ?', idp(req)); if (!q) fail(404, 'No trobat'); res.type('html').send(S.renderDoc('quote', q)); }));
app.get('/api/quotes/:id/email-preview', A.requireAdmin, wrap((req, res) => {
  const q = get('SELECT * FROM quotes WHERE id = ?', idp(req)); if (!q) fail(404, 'No trobat');
  const client = q.client_id ? get('SELECT * FROM clients WHERE id = ?', q.client_id) : null;
  const ctx = S.messageCtx({ client, quote: q }); const m = S.getSettings().messages;
  res.json({ to: client?.email || '', subject: S.renderMessage(m.quote_subject, ctx), body: S.renderMessage(m.quote_body, ctx) });
}));
app.post('/api/quotes/:id/to-invoice', A.requireAdmin, wrap((req, res) => {
  const q = get('SELECT * FROM quotes WHERE id = ?', idp(req)); if (!q) fail(404, 'No trobat');
  res.json({ id: createInvoice({ client_id: q.client_id, activity_id: q.activity_id, quote_id: q.id, lines: q.lines, notes: q.notes, deposit_type: q.deposit_type, deposit_value: q.deposit_value }) });
}));
app.post('/api/quotes/:id/to-activity', A.requireAdmin, wrap((req, res) => {
  const q = get('SELECT * FROM quotes WHERE id = ?', idp(req)); if (!q) fail(404, 'No trobat');
  const id = saveActivity(null, { client_id: q.client_id, date: req.body.date || S.todayISO(), title: q.title || null, quote_id: q.id, status: 'pendent', location: req.body.location || '',
    products: (q.lines || []).filter(l => l.product_id).map(l => ({ product_id: l.product_id, name: l.description, quantity: l.quantity, price: l.price, vat: l.vat, workers: [] })) });
  update('quotes', q.id, { activity_id: id });
  res.json({ id });
}));

// --- Factures
function createInvoice(body) {
  const s = S.getSettings();
  const data = docPatch(body, INVOICE_FIELDS);
  data.number = data.number || S.nextNumber('invoice');
  data.date = data.date || S.todayISO();
  data.due_date = data.due_date || S.addDays(data.date, s.invoicing.due_days);
  data.status = data.status || 'esborrany';
  data.token = S.token();
  if (data.notes == null) data.notes = s.invoicing.invoice_notes;
  const id = insert('invoices', data);
  addTimeline('invoice', id, 'creada', 'Factura creada');
  return id;
}
app.get('/api/invoices', A.requireAdmin, (req, res) => res.json(listDocs('invoices')));
app.get('/api/invoices/:id', A.requireAdmin, wrap((req, res) => { const d = docFull('invoices', idp(req)); if (!d) fail(404, 'No trobada'); res.json(d); }));
app.post('/api/invoices', A.requireAdmin, wrap((req, res) => res.json({ id: createInvoice(req.body || {}) })));
app.put('/api/invoices/:id', A.requireAdmin, wrap((req, res) => {
  const before = get('SELECT * FROM invoices WHERE id = ?', idp(req)); if (!before) fail(404, 'No trobada');
  const data = docPatch(req.body, INVOICE_FIELDS);
  if (data.status && data.status !== before.status) addTimeline('invoice', before.id, 'estat', `Estat: ${before.status} → ${data.status}`);
  update('invoices', before.id, data);
  res.json({ ok: true });
}));
app.delete('/api/invoices/:id', A.requireAdmin, (req, res) => { run('DELETE FROM invoices WHERE id = ?', idp(req)); res.json({ ok: true }); });
app.post('/api/invoices/:id/send', A.requireAdmin, wrap(async (req, res) => res.json(await S.sendInvoice(idp(req), req.body || {}))));
app.get('/api/invoices/:id/html', A.requireAdmin, wrap((req, res) => { const d = get('SELECT * FROM invoices WHERE id = ?', idp(req)); if (!d) fail(404, 'No trobada'); res.type('html').send(S.renderDoc('invoice', d)); }));
app.get('/api/invoices/:id/email-preview', A.requireAdmin, wrap((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', idp(req)); if (!inv) fail(404, 'No trobada');
  const client = inv.client_id ? get('SELECT * FROM clients WHERE id = ?', inv.client_id) : null;
  const ctx = S.messageCtx({ client, invoice: inv }); const m = S.getSettings().messages;
  res.json({ to: client?.email || '', subject: S.renderMessage(m.invoice_subject, ctx), body: S.renderMessage(m.invoice_body, ctx) });
}));
app.post('/api/invoices/:id/payment', A.requireAdmin, wrap((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', idp(req)); if (!inv) fail(404, 'No trobada');
  const { what, paid, date, method } = req.body || {}; // what: deposit | full
  const when = paid ? (date || S.todayISO()) : null;
  const patch = {};
  if (what === 'deposit') { patch.deposit_paid_at = when; if (inv.status !== 'pagada') patch.status = when ? 'senyal_pagat' : 'emesa'; }
  else { patch.paid_at = when; patch.status = when ? 'pagada' : (inv.deposit_paid_at ? 'senyal_pagat' : 'emesa'); }
  if (method) patch.payment_method = method;
  update('invoices', inv.id, patch);
  addTimeline('invoice', inv.id, 'pagament', `${what === 'deposit' ? 'Paga i senyal' : 'Pagament total'} ${paid ? 'marcat com a pagat (' + S.fdate(when) + ')' : 'desmarcat'}`);
  res.json({ ok: true });
}));
app.post('/api/activities/:id/to-invoice', A.requireAdmin, wrap((req, res) => {
  const a = activityFull(idp(req)); if (!a) fail(404, 'No trobada');
  const s = S.getSettings();
  const lines = a.products.map(p => ({ product_id: p.product_id, description: p.name, quantity: p.quantity, price: p.price, vat: p.vat }));
  const q = a.quote_id ? get('SELECT * FROM quotes WHERE id = ?', a.quote_id) : null;
  res.json({ id: createInvoice({ client_id: a.client_id, activity_id: a.id, quote_id: a.quote_id, lines: q ? q.lines : lines, deposit_type: req.body.deposit_type ?? s.invoicing.default_deposit_type, deposit_value: req.body.deposit_value ?? s.invoicing.default_deposit_value }) });
}));
app.post('/api/activities/:id/to-quote', A.requireAdmin, wrap((req, res) => {
  const a = activityFull(idp(req)); if (!a) fail(404, 'No trobada');
  const s = S.getSettings();
  const lines = a.products.map(p => ({ product_id: p.product_id, description: p.name, quantity: p.quantity, price: p.price, vat: p.vat }));
  const t = S.computeTotals(lines);
  const id = insert('quotes', { number: S.nextNumber('quote'), client_id: a.client_id, activity_id: a.id, title: a.title, date: S.todayISO(), valid_until: S.addDays(S.todayISO(), s.invoicing.quote_validity_days),
    conditions: s.invoicing.quote_conditions, lines: t.lines, subtotal: t.subtotal, vat_total: t.vat_total, total: t.total, token: S.token(), deposit_type: s.invoicing.default_deposit_type, deposit_value: s.invoicing.default_deposit_value });
  update('activities', a.id, { quote_id: id });
  addTimeline('quote', id, 'creat', 'Creat des de l\'activitat');
  res.json({ id });
}));

// ================= AUTOMATISMES =================
const AUTO_FIELDS = ['name', 'trigger', 'delay_value', 'delay_unit', 'repeat_every', 'max_runs', 'subject', 'body', 'active'];
app.get('/api/automations', A.requireAdmin, (req, res) => res.json({
  automations: all(`SELECT a.*, (SELECT COUNT(*) FROM emails e WHERE e.automation_id = a.id) AS sent_count, (SELECT MAX(created_at) FROM emails e WHERE e.automation_id = a.id) AS last_sent FROM automations a ORDER BY a.id`),
  triggers: TRIGGERS,
}));
app.post('/api/automations', A.requireAdmin, wrap((req, res) => { if (!req.body.name || !TRIGGERS[req.body.trigger]) fail(400, 'Nom i disparador obligatoris'); res.json({ id: insert('automations', pick(req.body, AUTO_FIELDS)) }); }));
app.put('/api/automations/:id', A.requireAdmin, wrap((req, res) => { update('automations', idp(req), pick(req.body, AUTO_FIELDS)); res.json({ ok: true }); }));
app.delete('/api/automations/:id', A.requireAdmin, (req, res) => { run('DELETE FROM automations WHERE id = ?', idp(req)); res.json({ ok: true }); });
app.post('/api/automations/run', A.requireAdmin, wrap(async (req, res) => res.json(await automations.tick())));

// ================= CORREUS I TAULER =================
app.get('/api/emails', A.requireAdmin, (req, res) => res.json(all(`SELECT e.id, e.to_addr, e.subject, e.status, e.error, e.related_type, e.related_id, e.opened_at, e.open_count, e.created_at, a.name AS automation_name
  FROM emails e LEFT JOIN automations a ON a.id = e.automation_id ORDER BY e.id DESC LIMIT 500`)));
app.get('/api/emails/:id', A.requireAdmin, wrap((req, res) => { const e = get('SELECT * FROM emails WHERE id = ?', idp(req)); if (!e) fail(404, 'No trobat'); res.json(e); }));

app.get('/api/dashboard', A.requireAdmin, (req, res) => {
  const today = S.todayISO();
  res.json({
    upcoming: all(`SELECT a.id, a.title, a.date, a.start_time, a.location, a.status, c.name AS client_name,
      (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id) AS n_assigned,
      (SELECT COUNT(*) FROM assignments s WHERE s.activity_id = a.id AND s.status = 'confirmat') AS n_confirmed
      FROM activities a LEFT JOIN clients c ON c.id = a.client_id WHERE a.date >= ? AND a.status <> 'cancel·lada' ORDER BY a.date, a.start_time LIMIT 10`, today),
    pendingConfirmations: all(`SELECT s.id, s.status, s.sent_at, w.first_name, w.last_name, a.id AS activity_id, a.title, a.date FROM assignments s
      JOIN workers w ON w.id = s.worker_id JOIN activities a ON a.id = s.activity_id WHERE a.date >= ? AND s.status IN ('pendent','enviat','rebut','rebutjat') AND a.status <> 'cancel·lada' ORDER BY a.date LIMIT 20`, today),
    quotes: all(`SELECT q.id, q.number, q.status, q.total, q.sent_at, q.open_count, c.name AS client_name FROM quotes q LEFT JOIN clients c ON c.id = q.client_id WHERE q.status IN ('enviat','vist') ORDER BY q.sent_at DESC LIMIT 10`),
    unpaid: all(`SELECT i.id, i.number, i.status, i.total, i.due_date, i.deposit_amount, i.deposit_paid_at, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.status IN ('emesa','senyal_pagat') ORDER BY i.due_date LIMIT 10`),
    stats: {
      activitiesMonth: get(`SELECT COUNT(*) n FROM activities WHERE substr(date,1,7) = substr(?,1,7) AND status <> 'cancel·lada'`, today).n,
      billedMonth: get(`SELECT IFNULL(SUM(total),0) n FROM invoices WHERE substr(date,1,7) = substr(?,1,7) AND status NOT IN ('esborrany','anul·lada')`, today).n,
      pendingAmount: get(`SELECT IFNULL(SUM(total - CASE WHEN deposit_paid_at IS NOT NULL THEN deposit_amount ELSE 0 END),0) n FROM invoices WHERE status IN ('emesa','senyal_pagat')`).n,
      openQuotes: get(`SELECT COUNT(*) n FROM quotes WHERE status IN ('enviat','vist')`).n,
    },
    smtpConfigured: S.smtpConfigured(),
  });
});

// ================= PORTAL DEL TREBALLADOR (accés limitat) =================
app.get('/api/my/assignments', A.requireWorker, (req, res) => {
  const rows = all(`SELECT s.id, s.status, s.role, s.response_note, s.token, a.id AS activity_id, a.title, a.date, a.end_date, a.start_time, a.end_time, a.location, a.worker_notes, a.whatsapp_link, a.status AS activity_status, ap.name AS product_name
    FROM assignments s JOIN activities a ON a.id = s.activity_id LEFT JOIN activity_products ap ON ap.id = s.activity_product_id
    WHERE s.worker_id = ? AND a.status <> 'cancel·lada' ORDER BY a.date DESC, a.start_time LIMIT 200`, req.user.worker_id);
  for (const r of rows) {
    if (['pendent', 'enviat'].includes(r.status)) S.markOpened('assignment', r.id, 'portal');
    r.colleagues = all(`SELECT w.first_name, w.last_name, s.status FROM assignments s JOIN workers w ON w.id = s.worker_id WHERE s.activity_id = ? AND s.worker_id <> ?`, r.activity_id, req.user.worker_id);
    delete r.token;
  }
  res.json(rows);
});
app.post('/api/my/assignments/:id/respond', A.requireWorker, wrap((req, res) => {
  const a = get('SELECT * FROM assignments WHERE id = ? AND worker_id = ?', idp(req), req.user.worker_id); if (!a) fail(404, 'No trobada');
  respondAssignment(a, req.body.status, req.body.note, 'portal');
  res.json({ ok: true });
}));
app.get('/api/my/availability', A.requireWorker, (req, res) => {
  const w = get('SELECT weekly FROM workers WHERE id = ?', req.user.worker_id);
  res.json({ weekly: w.weekly, unavailability: all('SELECT * FROM worker_unavailability WHERE worker_id = ? ORDER BY date_from DESC', req.user.worker_id) });
});
app.put('/api/my/availability', A.requireWorker, (req, res) => { update('workers', req.user.worker_id, { weekly: req.body.weekly || {} }); res.json({ ok: true }); });
app.post('/api/my/unavailability', A.requireWorker, wrap((req, res) => {
  const { date_from, date_to, reason, kind } = req.body || {}; if (!date_from) fail(400, 'Cal la data');
  res.json({ id: insert('worker_unavailability', { worker_id: req.user.worker_id, date_from, date_to: date_to || date_from, reason, kind: kind === 'si' ? 'si' : 'no' }) });
}));
app.get('/api/my/documents', A.requireWorker, (req, res) => res.json(all(`SELECT id, name, mime, size, category, created_at, uploaded_by = ? AS mine FROM documents WHERE owner_type = 'worker' AND owner_id = ? AND visible_to_worker = 1 ORDER BY created_at DESC`, req.user.id, req.user.worker_id)));
app.get('/api/my/profile', A.requireWorker, (req, res) => res.json(get('SELECT first_name, last_name, dni, email, phone FROM workers WHERE id = ?', req.user.worker_id)));
app.put('/api/my/profile', A.requireWorker, (req, res) => { update('workers', req.user.worker_id, pick(req.body, ['email', 'phone'])); res.json({ ok: true }); });

function respondAssignment(a, status, note, via) {
  if (!['confirmat', 'rebutjat'].includes(status)) fail(400, 'Resposta no vàlida');
  update('assignments', a.id, { status, response_note: note || null, responded_at: S.nowISO(), received_at: a.received_at || S.nowISO() });
  const w = get('SELECT first_name, last_name FROM workers WHERE id = ?', a.worker_id);
  addTimeline('activity', a.activity_id, status, `${w.first_name} ${w.last_name || ''} ha ${status === 'confirmat' ? 'CONFIRMAT' : 'REBUTJAT'} la feina (${via})${note ? ': ' + note : ''}`);
}

// ================= PÀGINES PÚBLIQUES =================
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/t/:token.gif', (req, res) => {
  const e = get('SELECT * FROM emails WHERE token = ?', req.params.token);
  if (e) {
    update('emails', e.id, { opened_at: e.opened_at || S.nowISO(), open_count: (e.open_count || 0) + 1 });
    if (e.related_type && e.related_id) S.markOpened(e.related_type, e.related_id, 'correu');
  }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate' }).send(PIXEL);
});

function publicPage(title, inner, extraHead = '') {
  const s = S.getSettings();
  const color = esc(s.appearance.primary_color);
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827}
.bar{background:${color};color:#fff;padding:14px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:2}
.bar b{flex:1}.btn{border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
.ok{background:#10b981;color:#fff}.ko{background:#fff;color:#b91c1c;border:1px solid #fca5a5}.ghost{background:rgba(255,255,255,.2);color:#fff}
.wrap{max-width:900px;margin:16px auto;padding:0 12px}.card{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:14px}
iframe{width:100%;border:0;background:#fff;border-radius:8px;min-height:1100px}textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:8px;font:inherit}
.msg{padding:12px;border-radius:8px;background:#ecfdf5;color:#065f46}.msg.bad{background:#fef2f2;color:#991b1b}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}dt{color:#6b7280}dd{margin:0;font-weight:500}
@media print{.bar,.noprint{display:none}.wrap{margin:0;max-width:none;padding:0}iframe{min-height:0}}</style>${extraHead}</head><body>${inner}</body></html>`;
}
function isAdminViewer(req) { return req.user && req.user.role === 'admin'; }

app.get('/p/:token', (req, res) => {
  const q = get('SELECT * FROM quotes WHERE token = ?', req.params.token);
  if (!q) return res.status(404).send(publicPage('No trobat', '<div class="wrap"><div class="card">Aquest pressupost no existeix o ja no està disponible.</div></div>'));
  if (!isAdminViewer(req)) S.markOpened('quote', q.id, 'enllaç');
  const fresh = get('SELECT * FROM quotes WHERE id = ?', q.id);
  const answered = ['acceptat', 'rebutjat'].includes(fresh.status);
  const expired = fresh.valid_until && fresh.valid_until < S.todayISO() && !answered;
  const docHtml = S.renderDoc('quote', fresh, { absolute: true });
  const actions = answered
    ? `<div class="msg ${fresh.status === 'rebutjat' ? 'bad' : ''}">Pressupost ${fresh.status === 'acceptat' ? 'ACCEPTAT' : 'REBUTJAT'} el ${S.fdate(String(fresh.responded_at).slice(0, 10))}. Gràcies!</div>`
    : expired ? `<div class="msg bad">Aquest pressupost va caducar el ${S.fdate(fresh.valid_until)}. Posa't en contacte amb nosaltres per actualitzar-lo.</div>`
    : `<form method="post" action="/p/${esc(q.token)}/respond"><p><b>Què et sembla aquest pressupost?</b> Respondre no té cap compromís addicional.</p>
      <textarea name="note" rows="2" placeholder="Comentari opcional (canvis, dubtes...)"></textarea>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ok" name="status" value="acceptat">✓ Accepto el pressupost</button>
      <button class="btn ko" name="status" value="rebutjat">No m'interessa</button></p></form>`;
  res.send(publicPage(`Pressupost ${fresh.number}`, `<div class="bar"><b>Pressupost ${esc(fresh.number)}</b><button class="btn ghost" onclick="document.getElementById('d').contentWindow.print()">Imprimir / PDF</button></div>
    <div class="wrap"><div class="card noprint">${actions}</div><iframe id="d" srcdoc="${esc(docHtml)}" onload="this.style.height=this.contentDocument.body.scrollHeight+40+'px'"></iframe></div>`));
});
app.post('/p/:token/respond', express.urlencoded({ extended: false }), (req, res) => {
  const q = get('SELECT * FROM quotes WHERE token = ?', req.params.token);
  if (q && !['acceptat', 'rebutjat'].includes(q.status) && ['acceptat', 'rebutjat'].includes(req.body.status)) {
    update('quotes', q.id, { status: req.body.status, responded_at: S.nowISO(), response_note: req.body.note || null });
    addTimeline('quote', q.id, req.body.status, `El client l'ha ${req.body.status === 'acceptat' ? 'ACCEPTAT' : 'REBUTJAT'}${req.body.note ? ': «' + req.body.note + '»' : ''}`);
    // avís a l'empresa
    const c = S.getSettings().company;
    const to = S.getSettings().email.reply_to || c.email;
    if (to) S.sendEmail({ to, subject: `Pressupost ${q.number} ${req.body.status}`, text: `El pressupost ${q.number} ha estat ${req.body.status} pel client.${req.body.note ? '\n\nComentari: ' + req.body.note : ''}`, related_type: 'quote_notice', related_id: q.id }).catch(() => {});
  }
  res.redirect(`/p/${encodeURIComponent(req.params.token)}`);
});

app.get('/f/:token', (req, res) => {
  const inv = get('SELECT * FROM invoices WHERE token = ?', req.params.token);
  if (!inv) return res.status(404).send(publicPage('No trobada', '<div class="wrap"><div class="card">Aquesta factura no existeix.</div></div>'));
  if (!isAdminViewer(req)) S.markOpened('invoice', inv.id, 'enllaç');
  const docHtml = S.renderDoc('invoice', inv, { absolute: true });
  res.send(publicPage(`Factura ${inv.number}`, `<div class="bar"><b>Factura ${esc(inv.number)}</b><button class="btn ghost" onclick="document.getElementById('d').contentWindow.print()">Descarregar / imprimir</button></div>
    <div class="wrap"><iframe id="d" srcdoc="${esc(docHtml)}" onload="this.style.height=this.contentDocument.body.scrollHeight+40+'px'"></iframe></div>`));
});

app.get('/c/:token', (req, res) => {
  const a = get('SELECT * FROM assignments WHERE token = ?', req.params.token);
  if (!a) return res.status(404).send(publicPage('No trobat', '<div class="wrap"><div class="card">Aquesta convocatòria no existeix.</div></div>'));
  if (!isAdminViewer(req)) S.markOpened('assignment', a.id, 'enllaç');
  const fresh = get('SELECT * FROM assignments WHERE id = ?', a.id);
  const b = S.assignmentBundle(a.id);
  const act = b.ctx.activitat;
  const done = ['confirmat', 'rebutjat'].includes(fresh.status);
  const cancelled = b.activity.status === 'cancel·lada';
  res.send(publicPage('Convocatòria', `<div class="bar"><b>${esc(S.getSettings().company.name)} · Convocatòria</b></div><div class="wrap">
    <div class="card"><h2 style="margin-top:0">Hola ${esc(b.worker.first_name)} 👋</h2>
    <dl><dt>Activitat</dt><dd>${esc(act.titol)}</dd><dt>Data</dt><dd>${esc(act.data)}</dd><dt>Horari</dt><dd>${esc(act.hora || '—')}</dd>
    <dt>Lloc</dt><dd>${esc(act.lloc || '—')}${act.lloc ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.lloc)}" target="_blank">mapa</a>` : ''}</dd>
    <dt>Tasca</dt><dd>${esc(b.ctx.assignacio.producte || '—')}</dd>${act.notes_treballadors ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(act.notes_treballadors)}</dd>` : ''}</dl></div>
    ${act.whatsapp ? `<div class="card"><b>Grup de WhatsApp de la feina</b><p>Entra al grup per rebre tots els detalls i parlar amb l'equip.</p><a class="btn ok" style="background:#25D366" href="${esc(act.whatsapp)}" target="_blank">Entrar al grup de WhatsApp</a></div>` : ''}
    <div class="card">${cancelled ? '<div class="msg bad">Aquesta activitat s\'ha cancel·lat.</div>' : done
      ? `<div class="msg ${fresh.status === 'rebutjat' ? 'bad' : ''}">Has ${fresh.status === 'confirmat' ? 'CONFIRMAT' : 'REBUTJAT'} aquesta feina. ${fresh.status === 'confirmat' ? 'Gràcies!' : ''}</div>
         <form method="post" action="/c/${esc(a.token)}/respond" style="margin-top:10px"><button class="btn ko" name="status" value="${fresh.status === 'confirmat' ? 'rebutjat' : 'confirmat'}">Canviar la resposta</button></form>`
      : `<form method="post" action="/c/${esc(a.token)}/respond"><p><b>Hi pots anar?</b></p><textarea name="note" rows="2" placeholder="Comentari opcional"></textarea>
         <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ok" name="status" value="confirmat">✓ Confirmo que hi aniré</button><button class="btn ko" name="status" value="rebutjat">No hi puc anar</button></p></form>`}</div>
  </div>`));
});
app.post('/c/:token/respond', express.urlencoded({ extended: false }), (req, res) => {
  const a = get('SELECT * FROM assignments WHERE token = ?', req.params.token);
  if (a) { try { respondAssignment(a, req.body.status, req.body.note, 'enllaç'); } catch { /* ignora */ } }
  res.redirect(`/c/${encodeURIComponent(req.params.token)}`);
});

// ================= FRONTEND =================
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, process.env.HOST || undefined, () => {
    console.log(`Plataforma en marxa a http://localhost:${PORT}`);
    automations.start();
  });
}
module.exports = { app, automations };
