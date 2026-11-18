// Utilitats comunes del frontend
export const state = { me: null, cache: {} };

export async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  const isJson = (r.headers.get('content-type') || '').includes('json');
  const data = isJson ? await r.json() : await r.text();
  if (r.status === 401 && !opts.noRedirect) { location.hash = ''; location.reload(); throw new Error('Sessió caducada'); }
  if (!r.ok) throw new Error((data && data.error) || `Error ${r.status}`);
  return data;
}
api.put = (p, body) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });
api.post = (p, body = {}) => api(p, { method: 'POST', body });

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function money(n) {
  const cur = state.me?.invoicing?.currency || '€';
  return new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' ' + cur;
}
export function fdate(d, opts) {
  if (!d) return '';
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (opts === 'long') return new Date(s + 'T12:00:00').toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (opts === 'short') return new Date(s + 'T12:00:00').toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    const [y, m, dd] = s.split('-'); return `${dd}/${m}/${y}`;
  }
  const dt = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  if (isNaN(dt)) return s;
  return dt.toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
export function isoDate(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

export function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4000);
}
export function errorToast(e) { toast(e.message || String(e), 'bad'); }

// ---------- Finestres modals ----------
export function modal({ title, body, size = '', actions = [], onOpen }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Tanca">✕</button></div>
      <div class="modal-body"></div><div class="modal-foot"></div></div>`;
    const bodyEl = $('.modal-body', wrap);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = $('.modal-foot', wrap);
    const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.cls || ''}`; b.textContent = a.label;
      b.onclick = async () => {
        if (!a.onClick) return close(a.value ?? a.label);
        b.disabled = true;
        try { const r = await a.onClick(bodyEl, close); if (r !== false) close(r ?? true); }
        catch (e) { errorToast(e); } finally { b.disabled = false; }
      };
      foot.appendChild(b);
    }
    if (!actions.length) foot.remove();
    $('[data-close]', wrap).onclick = () => close(null);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    document.body.appendChild(wrap);
    if (onOpen) onOpen(bodyEl, close);
    const first = $('input:not([type=hidden]),select,textarea', bodyEl);
    if (first) requestAnimationFrame(() => { if (!wrap.contains(document.activeElement)) first.focus(); });
  });
}
export function confirmDialog(text, okLabel = 'Sí, continua', danger = true) {
  return modal({ title: 'Confirmació', body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancel·la', value: false }, { label: okLabel, cls: danger ? 'danger' : 'primary', value: true }] });
}

// ---------- Formularis ----------
// fields: [{ name, label, type, options, required, placeholder, full, help, step }]
export function fieldHtml(f, value) {
  const id = 'f_' + f.name.replace(/\W/g, '_') + '_' + Math.random().toString(36).slice(2, 6);
  const v = value ?? f.default ?? '';
  const req = f.required ? 'required' : '';
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
  let input;
  switch (f.type) {
    case 'textarea': input = `<textarea id="${id}" name="${esc(f.name)}" rows="${f.rows || 3}" ${req} ${ph}>${esc(v)}</textarea>`; break;
    case 'select': {
      const opts = (f.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: o }));
      input = `<select id="${id}" name="${esc(f.name)}" ${req}>${f.empty !== false ? `<option value="">${esc(f.empty || '—')}</option>` : ''}${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      break;
    }
    case 'checkbox': return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${esc(f.name)}" ${v && v !== '0' ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'color': input = `<input id="${id}" type="color" name="${esc(f.name)}" value="${esc(v || '#3b82f6')}">`; break;
    default: input = `<input id="${id}" type="${f.type || 'text'}" name="${esc(f.name)}" value="${esc(v)}" ${req} ${ph} ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} autocomplete="${f.autocomplete || 'off'}">`;
  }
  return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</div>`;
}
export function formHtml(fields, values = {}) {
  return `<div class="grid-form">${fields.map(f => fieldHtml(f, getPath(values, f.name))).join('')}</div>`;
}
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split('.'); let cur = o; ks.slice(0, -1).forEach(k => { cur[k] = cur[k] || {}; cur = cur[k]; }); cur[ks.at(-1)] = v; }
export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`[name="${CSS.escape(f.name)}"]`);
    if (!el) continue;
    let v;
    if (f.type === 'checkbox') v = el.checked ? 1 : 0;
    else if (f.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value.trim();
    if (f.required && (v === '' || v == null)) { el.focus(); throw new Error(`Falta: ${f.label}`); }
    setPath(out, f.name, v);
  }
  return out;
}
// camps personalitzats definits a Configuració
export function customFields(entity) {
  return (state.me?.custom_fields?.[entity] || []).map(f => ({ name: 'extra.' + f.key, label: f.label, type: f.type === 'select' ? 'select' : f.type, options: (f.options || '').split(',').map(s => s.trim()).filter(Boolean), full: f.type === 'textarea' }));
}

export function statusChip(status, map) {
  const m = map[status] || { label: status, cls: '' };
  return `<span class="chip ${m.cls || ''}" ${m.color ? `style="--c:${esc(m.color)}"` : ''}>${esc(m.label)}</span>`;
}
export const ASSIGN_STATUS = {
  pendent: { label: 'Per enviar', cls: 'gray' }, enviat: { label: 'Enviat', cls: 'blue' }, rebut: { label: 'Rebut (vist)', cls: 'amber' },
  confirmat: { label: 'Confirmat', cls: 'green' }, rebutjat: { label: 'Rebutjat', cls: 'red' },
};
export const QUOTE_STATUS = {
  esborrany: { label: 'Esborrany', cls: 'gray' }, enviat: { label: 'Enviat', cls: 'blue' }, vist: { label: 'Vist pel client', cls: 'amber' },
  acceptat: { label: 'Acceptat', cls: 'green' }, rebutjat: { label: 'Rebutjat', cls: 'red' }, caducat: { label: 'Caducat', cls: 'gray' },
};
export const INVOICE_STATUS = {
  esborrany: { label: 'Esborrany', cls: 'gray' }, emesa: { label: 'Pendent de cobrament', cls: 'amber' }, senyal_pagat: { label: 'Senyal pagat', cls: 'blue' },
  pagada: { label: 'Pagada', cls: 'green' }, 'anul·lada': { label: 'Anul·lada', cls: 'red' },
};
export function activityStatusMap() {
  const m = {};
  for (const s of state.me?.activity_statuses || []) m[s.key] = { label: s.label, color: s.color, cls: 'custom' };
  return m;
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function randomPassword() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), x => c[x % c.length]).join('');
}
export function fileSize(n) { if (!n) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
export async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copiat al porta-retalls'); } catch { prompt('Copia el text:', t); } }
export const WEEKDAYS = [['1', 'Dilluns'], ['2', 'Dimarts'], ['3', 'Dimecres'], ['4', 'Dijous'], ['5', 'Divendres'], ['6', 'Dissabte'], ['0', 'Diumenge']];

// Editor de disponibilitat setmanal (compartit admin / treballador)
export function weeklyEditorHtml(weekly = {}) {
  return `<table class="table weekly"><thead><tr><th>Dia</th><th>Disponible</th><th>Des de</th><th>Fins a</th></tr></thead><tbody>
  ${WEEKDAYS.map(([k, n]) => { const d = weekly[k] || {}; return `<tr data-day="${k}"><td>${n}</td><td><input type="checkbox" data-on ${d.on ? 'checked' : ''}></td>
    <td><input type="time" data-from value="${esc(d.from || '')}"></td><td><input type="time" data-to value="${esc(d.to || '')}"></td></tr>`; }).join('')}
  </tbody></table><small class="muted">Si no marques cap dia, es considera que el treballador està disponible sempre (excepte les dates bloquejades).</small>`;
}
export function readWeekly(root) {
  const out = {};
  for (const tr of $$('tr[data-day]', root)) {
    const on = $('[data-on]', tr).checked, from = $('[data-from]', tr).value, to = $('[data-to]', tr).value;
    if (on || from || to) out[tr.dataset.day] = { on, from, to };
  }
  return out;
}

export function setTitle(title, actionsHtml = '') {
  const t = document.getElementById('page-title'); if (t) t.textContent = title;
  const a = document.getElementById('page-actions'); if (a) a.innerHTML = actionsHtml;
  document.title = `${title} · ${state.me?.appearance?.app_name || ''}`;
}
export function go(hash) { if (location.hash === hash) window.__reload(); else location.hash = hash; }
export function reload() { window.__reload(); }
