// Usuaris, contrasenyes i sessions
const crypto = require('crypto');
const { get, run, insert } = require('./db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

const SESSION_DAYS = 30;
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  insert('sessions', { token, user_id: userId, expires_at: expires });
  run(`UPDATE users SET last_login = datetime('now') WHERE id = ?`, userId);
  return token;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromRequest(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  const s = get('SELECT * FROM sessions WHERE token = ?', sid);
  if (!s || new Date(s.expires_at) < new Date()) return null;
  const u = get('SELECT id, username, name, role, worker_id, active FROM users WHERE id = ?', s.user_id);
  if (!u || !u.active) return null;
  return { ...u, sid };
}

function authMiddleware(req, res, next) { req.user = userFromRequest(req); next(); }
function requireAuth(req, res, next) { if (!req.user) return res.status(401).json({ error: 'Cal iniciar sessió' }); next(); }
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Cal iniciar sessió' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accés restringit' });
  next();
}
function requireWorker(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Cal iniciar sessió' });
  if (req.user.role !== 'worker' || !req.user.worker_id) return res.status(403).json({ error: 'Només per a treballadors' });
  next();
}

// Límit d'intents d'accés
const attempts = new Map();
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60000) { attempts.delete(key); return false; }
  return a.count >= 10;
}
function registerFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60000) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
function clearFails(key) { attempts.delete(key); }

module.exports = { hashPassword, verifyPassword, createSession, authMiddleware, requireAuth, requireAdmin, requireWorker, parseCookies, tooManyAttempts, registerFail, clearFails };
