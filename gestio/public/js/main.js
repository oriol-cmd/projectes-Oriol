import { api, state, esc, $, $$, toast, errorToast, modal } from './core.js';
import * as Admin from './admin.js';
import * as Docs from './docs.js';
import * as Config from './config.js';
import * as Worker from './worker.js';

const ADMIN_MENU = [
  { key: 'tauler', path: '#/', icon: '🏠', label: 'Tauler' },
  { key: 'activitats', path: '#/activitats', icon: '📅', label: 'Activitats' },
  { key: 'clients', path: '#/clients', icon: '👥', label: 'Clients' },
  { key: 'treballadors', path: '#/treballadors', icon: '🧑‍🔧', label: 'Treballadors' },
  { key: 'productes', path: '#/productes', icon: '📦', label: 'Productes' },
  { key: 'pressupostos', path: '#/pressupostos', icon: '📝', label: 'Pressupostos' },
  { key: 'factures', path: '#/factures', icon: '🧾', label: 'Factures' },
  { key: 'automatismes', path: '#/automatismes', icon: '⚙️', label: 'Automatismes' },
  { key: 'correus', path: '#/correus', icon: '✉️', label: 'Correus enviats' },
  { key: 'configuracio', path: '#/configuracio', icon: '🛠️', label: 'Configuració', always: true },
];
const WORKER_MENU = [
  { key: 'feines', path: '#/', icon: '📅', label: 'Les meves feines' },
  { key: 'disponibilitat', path: '#/disponibilitat', icon: '🗓️', label: 'Disponibilitat' },
  { key: 'documents', path: '#/documents', icon: '📄', label: 'Els meus documents' },
  { key: 'perfil', path: '#/perfil', icon: '👤', label: 'El meu perfil' },
];

const ADMIN_ROUTES = [
  [/^\/?$/, 'tauler', el => Admin.dashboard(el)],
  [/^\/activitats\/?$/, 'activitats', el => Admin.activitiesPage(el)],
  [/^\/activitats\/(\d+)$/, 'activitats', (el, m) => Admin.activityDetail(el, Number(m[1]))],
  [/^\/clients\/?$/, 'clients', el => Admin.clientsPage(el)],
  [/^\/clients\/(\d+)$/, 'clients', (el, m) => Admin.clientDetail(el, Number(m[1]))],
  [/^\/treballadors\/?$/, 'treballadors', el => Admin.workersPage(el)],
  [/^\/treballadors\/(\d+)(?:\/(\w+))?$/, 'treballadors', (el, m) => Admin.workerDetail(el, Number(m[1]), m[2])],
  [/^\/productes\/?$/, 'productes', el => Admin.productsPage(el)],
  [/^\/pressupostos\/?$/, 'pressupostos', el => Docs.listPage(el, 'quote')],
  [/^\/pressupostos\/(\d+|nou)$/, 'pressupostos', (el, m) => Docs.editor(el, 'quote', m[1])],
  [/^\/factures\/?$/, 'factures', el => Docs.listPage(el, 'invoice')],
  [/^\/factures\/(\d+|nova)$/, 'factures', (el, m) => Docs.editor(el, 'invoice', m[1])],
  [/^\/automatismes\/?$/, 'automatismes', el => Config.automationsPage(el)],
  [/^\/correus\/?$/, 'correus', el => Config.emailsPage(el)],
  [/^\/configuracio(?:\/(\w+))?$/, 'configuracio', (el, m) => Config.settingsPage(el, m[1])],
];
const WORKER_ROUTES = [
  [/^\/?$/, 'feines', el => Worker.jobs(el)],
  [/^\/disponibilitat$/, 'disponibilitat', el => Worker.availability(el)],
  [/^\/documents$/, 'documents', el => Worker.documents(el)],
  [/^\/perfil$/, 'perfil', el => Worker.profile(el)],
];

function applyTheme(color) {
  if (color) document.documentElement.style.setProperty('--primary', color);
}

async function boot() {
  try {
    state.me = await api('/api/me', { noRedirect: true });
  } catch {
    return loginScreen();
  }
  applyTheme(state.me.appearance.primary_color);
  document.title = state.me.appearance.app_name || 'Gestió';
  layout();
  window.addEventListener('hashchange', route);
  route();
}

async function loginScreen() {
  const st = await api('/api/setup-status', { noRedirect: true });
  applyTheme(st.color);
  document.title = st.appName;
  const app = $('#app');
  app.innerHTML = `<div class="login"><form class="card login-card">
    ${st.hasLogo ? '<img src="/logo" alt="" class="login-logo">' : `<div class="login-mark">${esc((st.appName || 'G')[0])}</div>`}
    <h1>${esc(st.appName)}</h1>
    ${st.needsSetup ? `<p class="muted">Primer accés: crea l'usuari administrador.</p>
      <div class="field"><label>Nom de l'empresa</label><input name="company" autocomplete="organization"></div>
      <div class="field"><label>El teu nom</label><input name="name" autocomplete="name"></div>` : ''}
    <div class="field"><label>Usuari</label><input name="username" required autocomplete="username" autocapitalize="none"></div>
    <div class="field"><label>Contrasenya</label><input name="password" type="password" required autocomplete="${st.needsSetup ? 'new-password' : 'current-password'}" ${st.needsSetup ? 'minlength="8"' : ''}></div>
    <button class="btn primary block">${st.needsSetup ? 'Crea i entra' : 'Entra'}</button>
    <p class="err" hidden></p></form></div>`;
  const form = $('form', app);
  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(st.needsSetup ? '/api/setup' : '/api/login', { body: data, noRedirect: true });
      location.hash = '#/';
      boot();
    } catch (err) { const p = $('.err', form); p.hidden = false; p.textContent = err.message; }
  };
}

function menuItems() {
  if (state.me.user.role !== 'admin') return WORKER_MENU;
  const mods = state.me.appearance.modules || {};
  const labels = state.me.appearance.labels || {};
  return ADMIN_MENU.filter(m => m.always || mods[m.key] !== false).map(m => ({ ...m, label: labels[m.key] || m.label }));
}

function layout() {
  const me = state.me;
  $('#app').innerHTML = `<div class="shell">
    <aside class="side"><div class="brand">${me.company.logo ? '<img src="/logo" alt="">' : ''}<span>${esc(me.appearance.app_name)}</span></div>
      <nav>${menuItems().map(m => `<a href="${m.path}" data-key="${m.key}"><span class="ic">${m.icon}</span>${esc(m.label)}</a>`).join('')}</nav>
      <div class="side-foot"><div class="who">${esc(me.user.name || me.user.username)}<small>${me.user.role === 'admin' ? 'Administrador' : 'Treballador'}</small></div>
      ${me.user.role === 'admin' ? '<a href="#/configuracio/compte" class="link">Canviar contrasenya</a>' : ''}
      <button class="btn small ghost" id="logout">Surt</button></div></aside>
    <div class="side-back"></div>
    <main><header class="top"><button class="icon-btn menu-btn" aria-label="Menú">☰</button><h2 id="page-title"></h2><div id="page-actions"></div></header>
      <div id="view" class="view"></div></main></div>`;
  $('#logout').onclick = async () => { await api.post('/api/logout'); location.hash = ''; location.reload(); };
  const shell = $('.shell');
  $('.menu-btn').onclick = () => shell.classList.toggle('open');
  $('.side-back').onclick = () => shell.classList.remove('open');
  $$('.side nav a').forEach(a => a.addEventListener('click', () => shell.classList.remove('open')));
}


async function route() {
  const hash = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const routes = state.me.user.role === 'admin' ? ADMIN_ROUTES : WORKER_ROUTES;
  // vista nova a cada navegació (evita escoltadors duplicats)
  const oldView = $('#view'); const view = oldView.cloneNode(false); oldView.replaceWith(view);
  for (const [re, key, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      $$('.side nav a').forEach(a => a.classList.toggle('active', a.dataset.key === key));
      view.innerHTML = '<div class="loading">Carregant…</div>';
      try { await fn(view, m); } catch (e) { view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; errorToast(e); }
      view.scrollTop = 0; window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = '<div class="card empty">Pàgina no trobada</div>';
}
window.__reload = () => route();

// recarrega les dades de l'usuari (p. ex. després de canviar la configuració)
async function refreshMe() {
  state.me = await api('/api/me');
  applyTheme(state.me.appearance.primary_color);
  layout(); route();
}
window.__refreshMe = refreshMe;

boot();
