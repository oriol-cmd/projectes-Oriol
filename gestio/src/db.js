// Base de dades SQLite (mòdul integrat de Node, sense dependències natives)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'gestio.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',          -- admin | worker
  worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  dni TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  weekly TEXT DEFAULT '{}',        -- disponibilitat setmanal {"1":{"on":true,"from":"09:00","to":"18:00"},...}
  extra TEXT DEFAULT '{}',         -- camps personalitzats
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worker_unavailability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  kind TEXT DEFAULT 'no',          -- no (no disponible) | si (disponible extra)
  reason TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,        -- worker | client | activity
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  category TEXT,
  visible_to_worker INTEGER DEFAULT 1,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nif TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  extra TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL DEFAULT 0,
  vat REAL DEFAULT 21,
  unit TEXT DEFAULT 'unitat',
  workers_needed INTEGER DEFAULT 1,
  color TEXT DEFAULT '#3b82f6',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  location TEXT,
  date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  status TEXT DEFAULT 'pendent',
  notes TEXT,
  worker_notes TEXT,
  whatsapp_link TEXT,
  quote_id INTEGER,
  extra TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT,
  quantity REAL DEFAULT 1,
  price REAL DEFAULT 0,
  vat REAL DEFAULT 21
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  activity_product_id INTEGER REFERENCES activity_products(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  role TEXT,
  status TEXT DEFAULT 'pendent',   -- pendent | enviat | rebut | confirmat | rebutjat
  token TEXT UNIQUE,
  sent_at TEXT,
  received_at TEXT,
  responded_at TEXT,
  response_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  activity_id INTEGER,
  title TEXT,
  date TEXT,
  valid_until TEXT,
  status TEXT DEFAULT 'esborrany', -- esborrany | enviat | vist | acceptat | rebutjat | caducat
  lines TEXT DEFAULT '[]',
  notes TEXT,
  conditions TEXT,
  deposit_type TEXT DEFAULT 'none',
  deposit_value REAL DEFAULT 0,
  token TEXT UNIQUE,
  sent_at TEXT,
  first_opened_at TEXT,
  last_opened_at TEXT,
  open_count INTEGER DEFAULT 0,
  responded_at TEXT,
  response_note TEXT,
  subtotal REAL DEFAULT 0,
  vat_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  activity_id INTEGER,
  quote_id INTEGER,
  date TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'esborrany', -- esborrany | emesa | senyal_pagat | pagada | anul·lada
  lines TEXT DEFAULT '[]',
  notes TEXT,
  deposit_type TEXT DEFAULT 'none', -- none | percent | amount
  deposit_value REAL DEFAULT 0,
  deposit_amount REAL DEFAULT 0,
  deposit_paid_at TEXT,
  paid_at TEXT,
  payment_method TEXT,
  token TEXT UNIQUE,
  sent_at TEXT,
  first_opened_at TEXT,
  open_count INTEGER DEFAULT 0,
  subtotal REAL DEFAULT 0,
  vat_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT,
  subject TEXT,
  body TEXT,
  related_type TEXT,
  related_id INTEGER,
  automation_id INTEGER,
  status TEXT,                     -- enviat | simulat | error
  error TEXT,
  token TEXT UNIQUE,
  opened_at TEXT,
  open_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT,
  entity_id INTEGER,
  kind TEXT,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  delay_value REAL DEFAULT 0,
  delay_unit TEXT DEFAULT 'dies',   -- hores | dies
  repeat_every REAL DEFAULT 0,      -- 0 = no repeteix
  max_runs INTEGER DEFAULT 1,
  subject TEXT,
  body TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  entity_type TEXT,
  entity_id INTEGER,
  run_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  UNIQUE (automation_id, entity_type, entity_id)
);
`);

// ---- Ajudes ----
const JSON_FIELDS = new Set(['weekly', 'extra', 'lines']);

function parseRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (JSON_FIELDS.has(k) && typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch { out[k] = k === 'lines' ? [] : {}; }
    }
  }
  return out;
}

function all(sql, ...params) { return db.prepare(sql).all(...params).map(parseRow); }
function get(sql, ...params) { return parseRow(db.prepare(sql).get(...params)); }
function run(sql, ...params) { return db.prepare(sql).run(...params); }

function cleanValue(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function insert(table, data) {
  const keys = Object.keys(data);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map(k => cleanValue(data[k])));
  return Number(r.lastInsertRowid);
}

function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map(k => cleanValue(data[k])), id);
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function addTimeline(entity_type, entity_id, kind, message) {
  insert('timeline', { entity_type, entity_id, kind, message });
}

module.exports = { db, all, get, run, insert, update, pick, addTimeline, DATA_DIR, UPLOAD_DIR };
