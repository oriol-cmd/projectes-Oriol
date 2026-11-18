import {
  api, state, esc, $, $$, money, fdate, today, isoDate, toast, errorToast, modal, confirmDialog, formHtml, readForm, customFields,
  statusChip, ASSIGN_STATUS, QUOTE_STATUS, INVOICE_STATUS, activityStatusMap, debounce, randomPassword, fileSize, copyText,
  weeklyEditorHtml, readWeekly, setTitle, go, reload,
} from './core.js';

// =====================================================================
// TAULER
// =====================================================================
export async function dashboard(el) {
  setTitle('Tauler', `<a class="btn primary" href="#/activitats" data-new-activity>+ Nova activitat</a>`);
  $('[data-new-activity]').onclick = e => { e.preventDefault(); openActivityForm(null, {}).then(id => id && go(`#/activitats/${id}`)); };
  const d = await api('/api/dashboard');
  const st = activityStatusMap();
  el.innerHTML = `
  ${d.smtpConfigured ? '' : `<div class="alert">✉️ El correu encara no està configurat: els correus i recordatoris es desen a «Correus enviats» però no surten. <a href="#/configuracio/correu">Configura'l</a>.</div>`}
  <div class="stats">
    <div class="stat"><b>${d.stats.activitiesMonth}</b><span>Activitats aquest mes</span></div>
    <div class="stat"><b>${money(d.stats.billedMonth)}</b><span>Facturat aquest mes</span></div>
    <div class="stat"><b>${money(d.stats.pendingAmount)}</b><span>Pendent de cobrar</span></div>
    <div class="stat"><b>${d.stats.openQuotes}</b><span>Pressupostos oberts</span></div>
  </div>
  <div class="cols">
    <section class="card"><h3>Properes activitats</h3>${d.upcoming.length ? `<ul class="list">${d.upcoming.map(a => `<li><a href="#/activitats/${a.id}">
      <div><b>${esc(a.title)}</b><small>${fdate(a.date, 'short')} ${esc(a.start_time || '')} · ${esc(a.location || '')}${a.client_name ? ' · ' + esc(a.client_name) : ''}</small></div>
      <div class="r">${statusChip(a.status, st)}<small>${a.n_confirmed}/${a.n_assigned} confirmats</small></div></a></li>`).join('')}</ul>` : '<p class="muted">Cap activitat programada.</p>'}</section>
    <section class="card"><h3>Treballadors pendents de confirmar</h3>${d.pendingConfirmations.length ? `<ul class="list">${d.pendingConfirmations.map(p => `<li><a href="#/activitats/${p.activity_id}">
      <div><b>${esc(p.first_name)} ${esc(p.last_name || '')}</b><small>${fdate(p.date, 'short')} · ${esc(p.title)}</small></div><div class="r">${statusChip(p.status, ASSIGN_STATUS)}</div></a></li>`).join('')}</ul>` : '<p class="muted">Tothom ha confirmat. 👍</p>'}</section>
    <section class="card"><h3>Pressupostos en seguiment</h3>${d.quotes.length ? `<ul class="list">${d.quotes.map(q => `<li><a href="#/pressupostos/${q.id}">
      <div><b>${esc(q.number)}</b> ${esc(q.client_name || '')}<small>Enviat ${fdate(q.sent_at)} · obert ${q.open_count || 0} cops</small></div><div class="r">${statusChip(q.status, QUOTE_STATUS)}<small>${money(q.total)}</small></div></a></li>`).join('')}</ul>` : '<p class="muted">Cap pressupost pendent de resposta.</p>'}</section>
    <section class="card"><h3>Factures pendents de cobrar</h3>${d.unpaid.length ? `<ul class="list">${d.unpaid.map(i => `<li><a href="#/factures/${i.id}">
      <div><b>${esc(i.number)}</b> ${esc(i.client_name || '')}<small>Venç ${fdate(i.due_date)}${i.deposit_amount > 0 && !i.deposit_paid_at ? ' · senyal pendent' : ''}</small></div><div class="r">${statusChip(i.status, INVOICE_STATUS)}<small>${money(i.total)}</small></div></a></li>`).join('')}</ul>` : '<p class="muted">Tot cobrat.</p>'}</section>
  </div>`;
}

// =====================================================================
// COMPONENT: SELECTOR DE CLIENT (cerca existent o crea'n un de nou)
// =====================================================================
const CLIENT_FIELDS = () => [
  { name: 'name', label: 'Nom / Raó social', required: true },
  { name: 'nif', label: 'NIF / CIF' },
  { name: 'email', label: 'Correu electrònic', type: 'email' },
  { name: 'phone', label: 'Telèfon', type: 'tel' },
  { name: 'address', label: 'Adreça', full: true },
  { name: 'postal_code', label: 'Codi postal' },
  { name: 'city', label: 'Població' },
  ...customFields('client'),
];
export function clientPickerHtml(client) {
  return `<div class="client-picker">
    <div class="field full search-field"><label>Cerca un client existent</label><input data-client-search placeholder="Escriu nom, NIF, correu o telèfon…" autocomplete="off"><div class="suggest" hidden></div></div>
    <div class="client-state muted">${client && client.id ? `Client existent: <b>${esc(client.name)}</b> · <a href="#" data-client-new>crear-ne un de nou</a>` : 'Client nou (es desarà a l\'apartat Clients)'}</div>
    <input type="hidden" data-client-id value="${client && client.id ? client.id : ''}">
    <div data-client-fields>${formHtml(CLIENT_FIELDS().map(f => ({ ...f, name: 'client.' + f.name })), { client: client || {} })}</div></div>`;
}
export function bindClientPicker(root) {
  const input = $('[data-client-search]', root), box = $('.suggest', root), idEl = $('[data-client-id]', root);
  const fill = c => {
    idEl.value = c ? c.id : '';
    for (const f of CLIENT_FIELDS()) {
      const elf = root.querySelector(`[name="client.${CSS.escape(f.name)}"]`);
      if (elf) elf.value = c ? (f.name.startsWith('extra.') ? (c.extra || {})[f.name.slice(6)] ?? '' : c[f.name] ?? '') : '';
    }
    $('.client-state', root).innerHTML = c ? `Client existent: <b>${esc(c.name)}</b> · <a href="#" data-client-new>crear-ne un de nou</a>` : 'Client nou (es desarà a l\'apartat Clients)';
  };
  root.addEventListener('click', e => { if (e.target.matches('[data-client-new]')) { e.preventDefault(); fill(null); } });
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const list = await api('/api/clients?q=' + encodeURIComponent(q));
    box.innerHTML = list.length ? list.slice(0, 8).map(c => `<button type="button" data-id="${c.id}"><b>${esc(c.name)}</b><small>${esc([c.nif, c.email, c.city].filter(Boolean).join(' · '))}</small></button>`).join('') : '<div class="muted pad">Cap coincidència: omple les dades per crear-lo.</div>';
    box.hidden = false;
    $$('button', box).forEach(b => b.onclick = () => { fill(list.find(c => c.id === Number(b.dataset.id))); box.hidden = true; input.value = ''; });
  }));
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 200));
  return () => {
    const data = readForm(root, CLIENT_FIELDS().map(f => ({ ...f, name: 'client.' + f.name, required: false }))).client || {};
    if (!data.name) return null;
    if (idEl.value) data.id = Number(idEl.value);
    return data;
  };
}

// =====================================================================
// ACTIVITATS: CALENDARI
// =====================================================================
const cal = { month: null, view: 'mes' };
export async function activitiesPage(el) {
  setTitle('Activitats', `<div class="seg"><button data-v="mes">Mes</button><button data-v="llista">Llista</button></div><button class="btn primary" data-new>+ Nova activitat</button>`);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!cal.month) cal.month = (params.get('m') || today().slice(0, 7));
  $$('.seg button').forEach(b => { b.classList.toggle('on', b.dataset.v === cal.view); b.onclick = () => { cal.view = b.dataset.v; activitiesPage(el); }; });
  $('[data-new]').onclick = () => openActivityForm(null, {}).then(id => id && go(`#/activitats/${id}`));
  if (cal.view === 'llista') return activitiesList(el);

  const [y, m] = cal.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 41);
  const acts = await api(`/api/activities?from=${isoDate(start)}&to=${isoDate(end)}`);
  const st = activityStatusMap();
  const byDay = {};
  for (const a of acts) {
    const s = new Date(a.date + 'T12:00:00'), e = new Date((a.end_date || a.date) + 'T12:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) (byDay[isoDate(d)] = byDay[isoDate(d)] || []).push(a);
  }
  const monthName = first.toLocaleDateString('ca-ES', { month: 'long' }).replace(/^./, c => c.toUpperCase()) + ' ' + y;
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoDate(d);
    const items = byDay[iso] || [];
    cells += `<div class="day ${d.getMonth() !== m - 1 ? 'other' : ''} ${iso === today() ? 'today' : ''}" data-date="${iso}">
      <div class="dn">${d.getDate()}</div>
      ${items.map(a => `<a class="ev" href="#/activitats/${a.id}" style="--c:${esc(a.color || '#64748b')};--s:${esc((st[a.status] || {}).color || '#999')}" title="${esc(a.title)}">
        <span>${esc(a.start_time || '')}</span> ${esc(a.title)}${a.n_assigned ? ` <em>${a.n_confirmed}/${a.n_assigned}</em>` : ''}</a>`).join('')}</div>`;
  }
  el.innerHTML = `<div class="card cal">
    <div class="cal-head"><button class="btn ghost" data-prev>‹</button><h3>${esc(monthName)}</h3><button class="btn ghost" data-next>›</button><button class="btn small ghost" data-today>Avui</button>
      <div class="legend">${(state.me.activity_statuses || []).map(s => `<span><i style="background:${esc(s.color)}"></i>${esc(s.label)}</span>`).join('')}</div></div>
    <div class="cal-grid">${['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'].map(d => `<div class="wd">${d}</div>`).join('')}${cells}</div>
    <p class="muted small">Fes clic a un dia per crear-hi una activitat. Els números (p. ex. 2/3) són treballadors confirmats / assignats.</p></div>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); cal.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; activitiesPage(el); };
  $('[data-prev]', el).onclick = () => shift(-1);
  $('[data-next]', el).onclick = () => shift(1);
  $('[data-today]', el).onclick = () => { cal.month = today().slice(0, 7); activitiesPage(el); };
  $$('.day', el).forEach(d => d.addEventListener('click', e => {
    if (e.target.closest('.ev')) return;
    openActivityForm(null, { date: d.dataset.date }).then(id => id && go(`#/activitats/${id}`));
  }));
}

async function activitiesList(el) {
  const acts = await api(`/api/activities?from=${today()}`);
  const past = await api(`/api/activities?to=${today()}&from=${isoDate(new Date(Date.now() - 60 * 86400000))}`);
  const st = activityStatusMap();
  const rows = list => list.map(a => `<tr data-href="#/activitats/${a.id}"><td>${fdate(a.date)}</td><td>${esc(a.start_time || '')}${a.end_time ? '–' + esc(a.end_time) : ''}</td>
    <td><b>${esc(a.title)}</b><br><small class="muted">${esc(a.product_names || '')}</small></td><td>${esc(a.client_name || '')}</td><td>${esc(a.location || '')}</td>
    <td>${a.n_confirmed}/${a.n_assigned}${a.n_rejected ? ` <span class="chip red">${a.n_rejected} rebutjat</span>` : ''}</td><td>${statusChip(a.status, st)}</td></tr>`).join('');
  el.innerHTML = `<div class="card"><input class="search" placeholder="Filtra…" data-filter>
    <h3>Properes</h3><div class="table-wrap"><table class="table click"><thead><tr><th>Data</th><th>Hora</th><th>Activitat</th><th>Client</th><th>Lloc</th><th>Equip</th><th>Estat</th></tr></thead><tbody>${rows(acts) || '<tr><td colspan="7" class="muted">Cap activitat</td></tr>'}</tbody></table></div>
    <h3>Últims 60 dies</h3><div class="table-wrap"><table class="table click"><tbody>${rows(past.reverse()) || '<tr><td class="muted">—</td></tr>'}</tbody></table></div></div>`;
  bindTableClicks(el); bindFilter(el);
}

export function bindTableClicks(el) { $$('tr[data-href]', el).forEach(tr => tr.onclick = e => { if (!e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; }); }
export function bindFilter(el) {
  const f = $('[data-filter]', el); if (!f) return;
  f.oninput = () => { const q = f.value.toLowerCase(); $$('tbody tr', el).forEach(tr => tr.hidden = q && !tr.textContent.toLowerCase().includes(q)); };
}

// =====================================================================
// FORMULARI D'ACTIVITAT
// =====================================================================
export async function openActivityForm(activity, { date } = {}) {
  const [products, workers] = await Promise.all([api('/api/products'), api('/api/workers')]);
  const a = activity || { date: date || today(), status: 'pendent', products: [] };
  const roles = state.me.worker_roles || [];
  let rows = (a.products || []).map(p => ({ id: p.id, product_id: p.product_id, name: p.name, quantity: p.quantity, price: p.price, vat: p.vat, workers: (p.workers || []).map(w => ({ worker_id: w.worker_id, role: w.role || '', status: w.status })) }));
  let avail = {};
  const statuses = (state.me.activity_statuses || []).map(s => ({ value: s.key, label: s.label }));
  const mainFields = [
    { name: 'date', label: 'Data', type: 'date', required: true },
    { name: 'end_date', label: 'Data final (si dura més d\'un dia)', type: 'date' },
    { name: 'start_time', label: 'Hora d\'inici', type: 'time' },
    { name: 'end_time', label: 'Hora de fi', type: 'time' },
    { name: 'location', label: 'Lloc', required: true, full: true, placeholder: 'Adreça o nom del lloc' },
    { name: 'title', label: 'Títol (opcional)', placeholder: 'Si el deixes buit, es posa el producte i el client' },
    { name: 'status', label: 'Estat', type: 'select', options: statuses, empty: false },
  ];
  const otherFields = [
    { name: 'whatsapp_link', label: 'Enllaç d\'invitació al grup de WhatsApp', full: true, placeholder: 'https://chat.whatsapp.com/…', help: 'Crea el grup al WhatsApp > Convida via enllaç > Copia. S\'enviarà als treballadors amb la convocatòria.' },
    { name: 'worker_notes', label: 'Notes per als treballadors', type: 'textarea', full: true },
    { name: 'notes', label: 'Notes internes', type: 'textarea', full: true },
    ...customFields('activity'),
  ];
  const body = document.createElement('div');
  body.innerHTML = `<form class="act-form" onsubmit="return false">
    <h4>1. Lloc i data</h4>${formHtml(mainFields, a)}
    <h4>2. Dades del client</h4>${clientPickerHtml(a.client)}
    <h4>3. Productes i treballadors</h4><div data-products></div>
    <div class="row gap"><select data-add-product><option value="">+ Afegeix un producte…</option>${products.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select>
      <a href="#/productes" class="small" target="_blank">Gestiona productes</a></div>
    <h4>4. Altres dades</h4>${formHtml(otherFields, a)}</form>`;
  const prodBox = $('[data-products]', body);

  const refreshAvail = async () => {
    const f = $('form', body);
    const d = f.date.value; if (!d) return;
    try {
      const list = await api(`/api/availability?date=${d}&start=${f.start_time.value}&end=${f.end_time.value}&exclude=${a.id || 0}`);
      avail = Object.fromEntries(list.map(x => [x.id, x]));
    } catch { avail = {}; }
    renderRows();
  };
  const workerName = id => { const w = workers.find(x => x.id === Number(id)); return w ? `${w.first_name} ${w.last_name || ''}`.trim() : '?'; };
  const renderRows = () => {
    if (!rows.length) { prodBox.innerHTML = '<p class="muted">Encara no hi ha cap producte. Afegeix-ne un a sota.</p>'; return; }
    prodBox.innerHTML = rows.map((r, i) => {
      const prod = products.find(p => p.id === r.product_id);
      const needed = prod ? prod.workers_needed : 0;
      const assignedIds = rows.flatMap(x => x.workers.map(w => Number(w.worker_id)));
      return `<div class="ap" data-i="${i}">
        <div class="ap-head"><input data-k="name" value="${esc(r.name)}" class="grow" aria-label="Producte">
          <label>Quant. <input data-k="quantity" type="number" step="0.01" value="${esc(r.quantity)}" class="w70"></label>
          <label>Preu <input data-k="price" type="number" step="0.01" value="${esc(r.price)}" class="w90"></label>
          <button type="button" class="icon-btn" data-rm title="Treu">🗑</button></div>
        <div class="ap-workers">${r.workers.map((w, j) => {
          const av = avail[w.worker_id];
          const flag = av ? (av.available ? (av.warn ? '⚠️' : '✅') : '⛔') : '';
          return `<span class="wchip" title="${esc(av ? av.reasons.join(' · ') : '')}">${flag} ${esc(workerName(w.worker_id))}
            ${roles.length ? `<select data-role="${j}"><option value="">rol…</option>${roles.map(ro => `<option ${ro === w.role ? 'selected' : ''}>${esc(ro)}</option>`).join('')}</select>` : ''}
            ${w.status ? statusChip(w.status, ASSIGN_STATUS) : ''}<button type="button" data-rmw="${j}" aria-label="Treu">✕</button></span>`;
        }).join('')}
        <select data-addw><option value="">+ Assigna treballador${needed ? ` (calen ${needed}, n'hi ha ${r.workers.length})` : ''}…</option>
          ${workers.filter(w => w.active && !r.workers.find(x => Number(x.worker_id) === w.id)).map(w => {
            const av = avail[w.id];
            const flag = av ? (av.available ? (av.warn ? '⚠️' : '✅') : '⛔') : '';
            const dup = assignedIds.includes(w.id) ? ' (ja assignat en un altre producte)' : '';
            return `<option value="${w.id}">${flag} ${esc(w.first_name)} ${esc(w.last_name || '')}${av && av.reasons.length ? ' — ' + esc(av.reasons.join(' · ')) : ''}${dup}</option>`;
          }).join('')}</select></div></div>`;
    }).join('') + `<p class="muted small">✅ disponible · ⚠️ disponible amb avisos · ⛔ no disponible (segons la seva disponibilitat i altres feines)</p>`;
  };
  prodBox.addEventListener('input', e => {
    const box = e.target.closest('.ap'); if (!box) return;
    const r = rows[box.dataset.i];
    if (e.target.dataset.k) r[e.target.dataset.k] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  });
  prodBox.addEventListener('change', e => {
    const box = e.target.closest('.ap'); if (!box) return;
    const r = rows[box.dataset.i];
    if (e.target.matches('[data-addw]') && e.target.value) {
      const av = avail[e.target.value];
      if (av && !av.available) toast(`Atenció: ${av.reasons.join(' · ')}`, 'warn');
      r.workers.push({ worker_id: Number(e.target.value), role: '' }); renderRows();
    }
    if (e.target.matches('[data-role]')) r.workers[e.target.dataset.role].role = e.target.value;
  });
  prodBox.addEventListener('click', e => {
    const box = e.target.closest('.ap'); if (!box) return;
    if (e.target.matches('[data-rm]')) { rows.splice(box.dataset.i, 1); renderRows(); }
    if (e.target.matches('[data-rmw]')) { rows[box.dataset.i].workers.splice(e.target.dataset.rmw, 1); renderRows(); }
  });
  $('[data-add-product]', body).onchange = e => {
    const p = products.find(x => x.id === Number(e.target.value)); if (!p) return;
    rows.push({ product_id: p.id, name: p.name, quantity: 1, price: p.price, vat: p.vat, workers: [] });
    e.target.value = ''; renderRows();
  };

  return modal({
    title: a.id ? 'Edita l\'activitat' : 'Nova activitat', size: 'large', body,
    onOpen: root => {
      const getClient = bindClientPicker(root);
      body._getClient = getClient;
      const f = $('form', root);
      ['date', 'start_time', 'end_time'].forEach(n => f[n].addEventListener('change', refreshAvail));
      refreshAvail();
    },
    actions: [{ label: 'Cancel·la', value: null }, {
      label: a.id ? 'Desa els canvis' : 'Crea l\'activitat', cls: 'primary', onClick: async root => {
        const data = readForm(root, [...mainFields, ...otherFields]);
        data.client = body._getClient();
        if (!data.client) data.client_id = null;
        data.products = rows.map(r => ({ id: r.id, product_id: r.product_id, name: r.name, quantity: r.quantity, price: r.price, vat: r.vat, workers: r.workers.map(w => ({ worker_id: w.worker_id, role: w.role })) }));
        if (data.extra) data.extra = { ...(a.extra || {}), ...data.extra };
        if (a.id) { await api.put(`/api/activities/${a.id}`, data); toast('Activitat desada'); return a.id; }
        const r = await api.post('/api/activities', data); toast('Activitat creada'); return r.id;
      },
    }],
  });
}

// =====================================================================
// DETALL D'ACTIVITAT
// =====================================================================
export async function activityDetail(el, id) {
  const a = await api(`/api/activities/${id}`);
  const st = activityStatusMap();
  setTitle(a.title, `<button class="btn" data-edit>✏️ Edita</button><button class="btn primary" data-send-all>✉️ Envia convocatòries</button>
    <div class="dropdown"><button class="btn">Més ▾</button><div class="menu">
      <button data-quote>📝 Crea pressupost</button><button data-invoice>🧾 Crea factura</button><button data-dup>📄 Duplica</button><button data-del class="danger-t">🗑 Esborra</button></div></div>`);
  const pendingCount = a.assignments.filter(s => ['pendent', 'enviat'].includes(s.status)).length;
  el.innerHTML = `<div class="cols">
    <section class="card"><h3>Detalls ${statusChip(a.status, st)}</h3>
      <dl class="dl"><dt>Data</dt><dd>${fdate(a.date, 'long')}${a.end_date && a.end_date !== a.date ? ' → ' + fdate(a.end_date, 'long') : ''}</dd>
      <dt>Horari</dt><dd>${esc(a.start_time || '—')}${a.end_time ? ' – ' + esc(a.end_time) : ''}</dd>
      <dt>Lloc</dt><dd>${esc(a.location || '—')} ${a.location ? `<a target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.location)}">mapa ↗</a>` : ''}</dd>
      <dt>Client</dt><dd>${a.client ? `<a href="#/clients/${a.client.id}">${esc(a.client.name)}</a><br><small>${esc([a.client.nif, a.client.email, a.client.phone].filter(Boolean).join(' · '))}</small>` : '—'}</dd>
      <dt>WhatsApp</dt><dd>${a.whatsapp_link ? `<a href="${esc(a.whatsapp_link)}" target="_blank">${esc(a.whatsapp_link)}</a>` : '<span class="muted">Sense grup. <a href="#" data-wa-set>Afegeix l\'enllaç del grup</a></span>'}</dd>
      ${(state.me.custom_fields.activity || []).map(f => `<dt>${esc(f.label)}</dt><dd>${esc((a.extra || {})[f.key] ?? '')}</dd>`).join('')}
      ${a.worker_notes ? `<dt>Notes treballadors</dt><dd class="pre">${esc(a.worker_notes)}</dd>` : ''}
      ${a.notes ? `<dt>Notes internes</dt><dd class="pre">${esc(a.notes)}</dd>` : ''}</dl>
      <div class="row gap wrap">${a.quotes.map(q => `<a class="chip blue" href="#/pressupostos/${q.id}">📝 ${esc(q.number)} · ${esc((QUOTE_STATUS[q.status] || {}).label || q.status)}</a>`).join('')}
        ${a.invoices.map(i => `<a class="chip green" href="#/factures/${i.id}">🧾 ${esc(i.number)} · ${esc((INVOICE_STATUS[i.status] || {}).label || i.status)}</a>`).join('')}</div>
    </section>
    <section class="card wide"><h3>Productes i equip <small class="muted">${pendingCount ? `${pendingCount} pendents de resposta` : ''}</small></h3>
      ${a.products.length ? a.products.map(p => `<div class="ap-view"><div class="ap-title"><i class="dot" style="background:${esc(p.color || '#94a3b8')}"></i><b>${esc(p.name)}</b> <span class="muted">× ${p.quantity} · ${money(p.price)}</span></div>
        ${p.workers.length ? `<table class="table"><tbody>${p.workers.map(w => `<tr><td><a href="#/treballadors/${w.worker_id}">${esc(w.first_name)} ${esc(w.last_name || '')}</a>${w.role ? ` <small class="muted">${esc(w.role)}</small>` : ''}
          ${w.response_note ? `<br><small>💬 ${esc(w.response_note)}</small>` : ''}</td><td>${statusChip(w.status, ASSIGN_STATUS)}<br><small class="muted">${w.responded_at ? fdate(w.responded_at) : w.received_at ? 'Vist ' + fdate(w.received_at) : w.sent_at ? 'Enviat ' + fdate(w.sent_at) : ''}</small></td>
          <td class="actions"><button class="btn small" data-mail="${w.id}" title="Envia per correu">✉️</button><button class="btn small wa" data-wa="${w.id}" title="Envia per WhatsApp">WhatsApp</button>
          <button class="btn small ghost" data-link="${w.token}" title="Copia l'enllaç de confirmació">🔗</button>
          <select data-st="${w.id}" class="small">${Object.entries(ASSIGN_STATUS).map(([k, v]) => `<option value="${k}" ${k === w.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Cap treballador assignat. Edita l\'activitat per assignar-ne.</p>'}</div>`).join('') : '<p class="muted">Sense productes. Edita l\'activitat per afegir-ne.</p>'}
    </section>
    <section class="card"><h3>Documents</h3><div data-docs></div></section>
    <section class="card"><h3>Historial</h3><ul class="timeline">${a.timeline.map(t => `<li><small>${fdate(t.created_at)}</small>${esc(t.message)}</li>`).join('') || '<li class="muted">—</li>'}</ul></section>
  </div>`;
  docsSection($('[data-docs]', el), 'activity', a.id, a.documents);

  $('[data-edit]').onclick = () => openActivityForm(a).then(r => r && reload());
  $('[data-send-all]').onclick = async () => {
    if (!pendingCount) return toast('No hi ha convocatòries pendents d\'enviar', 'warn');
    if (!a.whatsapp_link && !(await confirmDialog('L\'activitat no té enllaç de grup de WhatsApp. Vols enviar igualment les convocatòries?', 'Envia', false))) return;
    const r = await api.post(`/api/activities/${id}/send-assignments`);
    const sim = r.results.filter(x => x.status === 'simulat').length, err = r.results.filter(x => x.status === 'error');
    toast(`${r.results.length - err.length} convocatòries processades${sim ? ` (${sim} desades sense enviar: falta configurar el correu)` : ''}${err.length ? ` · ${err.length} errors: ${err[0].error}` : ''}`, err.length ? 'warn' : 'ok');
    reload();
  };
  $('[data-quote]').onclick = async () => { const r = await api.post(`/api/activities/${id}/to-quote`); go(`#/pressupostos/${r.id}`); };
  $('[data-invoice]').onclick = async () => { const r = await api.post(`/api/activities/${id}/to-invoice`); go(`#/factures/${r.id}`); };
  $('[data-dup]').onclick = async () => {
    const res = await modal({ title: 'Duplica l\'activitat', body: `${formHtml([{ name: 'date', label: 'Nova data', type: 'date', required: true }, { name: 'withWorkers', label: 'Copia també els treballadors', type: 'checkbox' }], { date: a.date })}`,
      actions: [{ label: 'Cancel·la', value: null }, { label: 'Duplica', cls: 'primary', onClick: root => readForm(root, [{ name: 'date', label: 'Data', type: 'date', required: true }, { name: 'withWorkers', type: 'checkbox', label: '' }]) }] });
    if (res) { const r = await api.post(`/api/activities/${id}/duplicate`, res); go(`#/activitats/${r.id}`); }
  };
  $('[data-del]').onclick = async () => { if (await confirmDialog('Segur que vols esborrar aquesta activitat i les seves assignacions?', 'Esborra')) { await api.del(`/api/activities/${id}`); go('#/activitats'); } };
  const waSet = $('[data-wa-set]', el);
  if (waSet) waSet.onclick = async e => {
    e.preventDefault();
    const v = prompt('Enganxa l\'enllaç d\'invitació del grup de WhatsApp (https://chat.whatsapp.com/…)');
    if (v) { await api.put(`/api/activities/${id}`, { date: a.date, whatsapp_link: v.trim() }); reload(); }
  };
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.mail) { const r = await api.post(`/api/assignments/${t.dataset.mail}/send`); toast(r.status === 'enviat' ? 'Convocatòria enviada' : r.status === 'simulat' ? 'Desada (el correu no està configurat)' : 'Error: ' + r.error, r.status === 'error' ? 'bad' : 'ok'); reload(); }
      if (t.dataset.wa) { const r = await api(`/api/assignments/${t.dataset.wa}/whatsapp?mark=1`); window.open(r.url, '_blank'); if (!r.phone) toast('Aquest treballador no té telèfon: tria el contacte al WhatsApp', 'warn'); setTimeout(reload, 800); }
      if (t.dataset.link) copyText(`${location.origin}/c/${t.dataset.link}`);
    } catch (err) { errorToast(err); }
  });
  $$('[data-st]', el).forEach(s => s.onchange = async () => { await api.put(`/api/assignments/${s.dataset.st}`, { status: s.value }); toast('Estat actualitzat'); reload(); });
}

// =====================================================================
// DOCUMENTS (treballadors, clients, activitats)
// =====================================================================
export function docsSection(box, owner_type, owner_id, docs) {
  const cats = state.me.document_categories || [];
  box.innerHTML = `<form class="upload" data-up><select name="category"><option value="">Categoria…</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
    <label class="btn"><input type="file" name="files" multiple hidden> 📎 Puja fitxers</label>
    ${owner_type === 'worker' ? '<label class="check"><input type="checkbox" name="visible" checked> Visible per al treballador</label>' : ''}</form>
    <div class="table-wrap"><table class="table"><tbody>${docs.map(d => `<tr><td><a href="/api/documents/${d.id}/file" target="_blank">📄 ${esc(d.name)}</a><br><small class="muted">${esc(d.category || '')} · ${fileSize(d.size)} · ${fdate(d.created_at)}${owner_type === 'worker' && !d.visible_to_worker ? ' · 🔒 ocult al treballador' : ''}</small></td>
      <td class="actions"><a class="btn small ghost" href="/api/documents/${d.id}/file?download=1">⬇</a><button class="btn small ghost" data-deldoc="${d.id}">🗑</button></td></tr>`).join('') || '<tr><td class="muted">Encara no hi ha documents.</td></tr>'}</tbody></table></div>`;
  const form = $('[data-up]', box);
  $('input[type=file]', form).onchange = async e => {
    const fd = new FormData();
    for (const f of e.target.files) fd.append('files', f);
    fd.append('owner_type', owner_type); fd.append('owner_id', owner_id);
    fd.append('category', form.category.value);
    if (form.visible) fd.append('visible_to_worker', form.visible.checked ? '1' : '0');
    try { await api('/api/documents', { body: fd }); toast('Document pujat'); refresh(); } catch (err) { errorToast(err); }
  };
  const refresh = async () => docsSection(box, owner_type, owner_id, await api(`/api/documents?owner_type=${owner_type}&owner_id=${owner_id}`));
  $$('[data-deldoc]', box).forEach(b => b.onclick = async () => { if (await confirmDialog('Esborrar aquest document?', 'Esborra')) { await api.del(`/api/documents/${b.dataset.deldoc}`); refresh(); } });
}

// =====================================================================
// CLIENTS
// =====================================================================
export async function clientsPage(el) {
  setTitle('Clients', '<button class="btn primary" data-new>+ Nou client</button>');
  $('[data-new]').onclick = async () => {
    const r = await modal({ title: 'Nou client', size: 'large', body: formHtml(CLIENT_FIELDS()), actions: [{ label: 'Cancel·la', value: null }, { label: 'Desa', cls: 'primary', onClick: root => api.post('/api/clients', readForm(root, CLIENT_FIELDS())) }] });
    if (r) go(`#/clients/${r.id}`);
  };
  const list = await api('/api/clients');
  el.innerHTML = `<div class="card"><input class="search" data-filter placeholder="Cerca per nom, NIF, correu…">
    <div class="table-wrap"><table class="table click"><thead><tr><th>Nom</th><th>NIF/CIF</th><th>Correu</th><th>Telèfon</th><th>Població</th><th>Activitats</th></tr></thead><tbody>
    ${list.map(c => `<tr data-href="#/clients/${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.nif || '')}</td><td>${esc(c.email || '')}</td><td>${esc(c.phone || '')}</td><td>${esc(c.city || '')}</td><td>${c.activity_count}${c.last_activity ? ` <small class="muted">(última ${fdate(c.last_activity)})</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Encara no hi ha clients. Es creen sols quan entres una activitat o un pressupost.</td></tr>'}
    </tbody></table></div></div>`;
  bindTableClicks(el); bindFilter(el);
}

export async function clientDetail(el, id) {
  const c = await api(`/api/clients/${id}`);
  setTitle(c.name, '<button class="btn primary" data-act>+ Activitat</button><button class="btn" data-q>+ Pressupost</button><button class="btn ghost danger-t" data-del>Esborra</button>');
  el.innerHTML = `<div class="cols"><section class="card wide"><h3>Dades</h3><form data-f>${formHtml(CLIENT_FIELDS(), c)}<div class="row end"><button class="btn primary">Desa</button></div></form></section>
    <section class="card"><h3>Activitats</h3><ul class="list">${c.activities.map(a => `<li><a href="#/activitats/${a.id}"><div>${esc(a.title)}<small>${fdate(a.date)} · ${esc(a.location || '')}</small></div><div class="r">${statusChip(a.status, activityStatusMap())}</div></a></li>`).join('') || '<li class="muted">—</li>'}</ul></section>
    <section class="card"><h3>Pressupostos</h3><ul class="list">${c.quotes.map(q => `<li><a href="#/pressupostos/${q.id}"><div>${esc(q.number)}<small>${fdate(q.date)}</small></div><div class="r">${statusChip(q.status, QUOTE_STATUS)}<small>${money(q.total)}</small></div></a></li>`).join('') || '<li class="muted">—</li>'}</ul></section>
    <section class="card"><h3>Factures</h3><ul class="list">${c.invoices.map(q => `<li><a href="#/factures/${q.id}"><div>${esc(q.number)}<small>${fdate(q.date)}</small></div><div class="r">${statusChip(q.status, INVOICE_STATUS)}<small>${money(q.total)}</small></div></a></li>`).join('') || '<li class="muted">—</li>'}</ul></section>
    <section class="card"><h3>Documents</h3><div data-docs></div></section></div>`;
  docsSection($('[data-docs]', el), 'client', c.id, c.documents);
  $('[data-f]', el).onsubmit = async e => { e.preventDefault(); try { const d = readForm(e.target, CLIENT_FIELDS()); if (d.extra) d.extra = { ...(c.extra || {}), ...d.extra }; await api.put(`/api/clients/${id}`, d); toast('Client desat'); } catch (err) { errorToast(err); } };
  $('[data-act]').onclick = () => openActivityForm({ date: today(), status: 'pendent', client: c, products: [] }).then(r => r && go(`#/activitats/${r}`));
  $('[data-q]').onclick = () => { sessionStorage.setItem('newDocClient', JSON.stringify(c)); go('#/pressupostos/nou'); };
  $('[data-del]').onclick = async () => { if (await confirmDialog('Esborrar el client? Les activitats i factures es conservaran sense client.', 'Esborra')) { await api.del(`/api/clients/${id}`); go('#/clients'); } };
}

// =====================================================================
// TREBALLADORS
// =====================================================================
const WORKER_FIELDS = () => [
  { name: 'first_name', label: 'Nom', required: true }, { name: 'last_name', label: 'Cognoms' },
  { name: 'dni', label: 'DNI / NIE' }, { name: 'email', label: 'Correu electrònic', type: 'email' },
  { name: 'phone', label: 'Telèfon (per al WhatsApp)', type: 'tel', placeholder: '+34 600 000 000' },
  { name: 'active', label: 'Actiu', type: 'checkbox', default: 1 },
  ...customFields('worker'),
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];
export async function workersPage(el) {
  setTitle('Treballadors', '<button class="btn primary" data-new>+ Nou treballador</button>');
  $('[data-new]').onclick = async () => {
    const r = await modal({ title: 'Nou treballador', size: 'large', body: formHtml(WORKER_FIELDS(), { active: 1 }), actions: [{ label: 'Cancel·la', value: null }, { label: 'Desa', cls: 'primary', onClick: root => api.post('/api/workers', readForm(root, WORKER_FIELDS())) }] });
    if (r) go(`#/treballadors/${r.id}`);
  };
  const list = await api('/api/workers');
  el.innerHTML = `<div class="card"><input class="search" data-filter placeholder="Cerca…">
    <div class="table-wrap"><table class="table click"><thead><tr><th>Nom</th><th>DNI</th><th>Correu</th><th>Telèfon</th><th>Docs</th><th>Accés</th><th></th></tr></thead><tbody>
    ${list.map(w => `<tr data-href="#/treballadors/${w.id}" class="${w.active ? '' : 'dim'}"><td><b>${esc(w.first_name)} ${esc(w.last_name || '')}</b></td><td>${esc(w.dni || '')}</td><td>${esc(w.email || '')}</td><td>${esc(w.phone || '')}</td>
      <td>${w.doc_count || ''}</td><td>${w.username ? `<span class="chip ${w.user_active ? 'green' : 'gray'}">👤 ${esc(w.username)}</span>` : '<span class="muted">—</span>'}</td><td>${w.active ? '' : '<span class="chip gray">Inactiu</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Encara no hi ha treballadors.</td></tr>'}
    </tbody></table></div></div>`;
  bindTableClicks(el); bindFilter(el);
}

export async function workerDetail(el, id, tab = 'dades') {
  const w = await api(`/api/workers/${id}`);
  setTitle(`${w.first_name} ${w.last_name || ''}`, '<button class="btn ghost danger-t" data-del>Esborra</button>');
  const tabs = [['dades', 'Dades'], ['documents', `Documents (${w.documents.length})`], ['disponibilitat', 'Disponibilitat'], ['acces', 'Accés'], ['feines', `Feines (${w.assignments.length})`]];
  el.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/treballadors/${id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div class="card" data-body></div>`;
  const body = $('[data-body]', el);
  $('[data-del]').onclick = async () => { if (await confirmDialog('Esborrar el treballador, els seus documents i el seu usuari d\'accés?', 'Esborra')) { await api.del(`/api/workers/${id}`); go('#/treballadors'); } };

  if (tab === 'dades') {
    body.innerHTML = `<form>${formHtml(WORKER_FIELDS(), w)}<div class="row end"><button class="btn primary">Desa</button></div></form>`;
    $('form', body).onsubmit = async e => { e.preventDefault(); try { const d = readForm(e.target, WORKER_FIELDS()); if (d.extra) d.extra = { ...(w.extra || {}), ...d.extra }; await api.put(`/api/workers/${id}`, d); toast('Desat'); } catch (err) { errorToast(err); } };
  } else if (tab === 'documents') {
    docsSection(body, 'worker', id, w.documents);
  } else if (tab === 'disponibilitat') {
    body.innerHTML = `<h3>Disponibilitat setmanal habitual</h3><div data-weekly>${weeklyEditorHtml(w.weekly)}</div><div class="row end"><button class="btn primary" data-save>Desa la disponibilitat</button></div>
      <h3>Dates concretes</h3>${unavailabilityHtml(w.unavailability)}`;
    $('[data-save]', body).onclick = async () => { await api.put(`/api/workers/${id}`, { weekly: readWeekly(body) }); toast('Disponibilitat desada'); };
    bindUnavailability(body, `/api/workers/${id}/unavailability`);
  } else if (tab === 'acces') {
    const u = w.user;
    body.innerHTML = `<h3>Usuari d'accés del treballador</h3>
      <p class="muted">Amb aquest usuari el treballador entra a la mateixa adreça i només veu: les seves feines (i les pot confirmar), la seva disponibilitat, els seus documents i el seu perfil.</p>
      ${u ? `<p>Usuari actual: <b>${esc(u.username)}</b> · ${u.active ? '<span class="chip green">Actiu</span>' : '<span class="chip gray">Desactivat</span>'} ${u.last_login ? `<small class="muted">· últim accés ${fdate(u.last_login)}</small>` : ''}</p>` : ''}
      <form class="grid-form">
        <div class="field"><label>Nom d'usuari</label><input name="username" value="${esc(u ? u.username : (w.email || (w.first_name + (w.last_name ? '.' + w.last_name.split(' ')[0] : ''))).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ''))}" autocapitalize="none"></div>
        <div class="field"><label>${u ? 'Nova contrasenya (deixa-ho buit per no canviar-la)' : 'Contrasenya'}</label><div class="row"><input name="password" class="grow" autocomplete="new-password"><button type="button" class="btn" data-gen>Genera</button></div></div>
      </form>
      <div class="row gap wrap"><button class="btn primary" data-save>${u ? 'Desa els canvis' : 'Crea l\'usuari'}</button>
      ${u ? `<button class="btn" data-toggle>${u.active ? 'Desactiva l\'accés' : 'Reactiva l\'accés'}</button><button class="btn ghost danger-t" data-rmuser>Esborra l'usuari</button>` : ''}
      <button class="btn ghost" data-share>📋 Copia les dades d'accés</button></div>`;
    const f = $('form', body);
    $('[data-gen]', body).onclick = () => { f.password.value = randomPassword(); };
    $('[data-save]', body).onclick = async () => {
      try { await api.post(`/api/workers/${id}/user`, { username: f.username.value, password: f.password.value || undefined }); toast(u ? 'Usuari actualitzat' : 'Usuari creat'); if (f.password.value) shareAccess(f.username.value, f.password.value, w); else workerDetail(el, id, 'acces'); } catch (err) { errorToast(err); }
    };
    $('[data-share]', body).onclick = () => copyText(accessText(f.username.value, f.password.value || '(la contrasenya que et vam donar)'));
    if (u) {
      $('[data-toggle]', body).onclick = async () => { await api.post(`/api/workers/${id}/user`, { active: !u.active }); workerDetail(el, id, 'acces'); };
      $('[data-rmuser]', body).onclick = async () => { if (await confirmDialog('Esborrar l\'usuari d\'accés?', 'Esborra')) { await api.del(`/api/workers/${id}/user`); workerDetail(el, id, 'acces'); } };
    }
  } else if (tab === 'feines') {
    body.innerHTML = `<div class="table-wrap"><table class="table click"><thead><tr><th>Data</th><th>Activitat</th><th>Producte</th><th>Lloc</th><th>Resposta</th></tr></thead><tbody>
      ${w.assignments.map(s => `<tr data-href="#/activitats/${s.activity_id}"><td>${fdate(s.date)} ${esc(s.start_time || '')}</td><td>${esc(s.title)}</td><td>${esc(s.product_name || '')}</td><td>${esc(s.location || '')}</td><td>${statusChip(s.status, ASSIGN_STATUS)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Cap feina.</td></tr>'}</tbody></table></div>`;
    bindTableClicks(body);
  }
}
function accessText(user, pass) { return `Accés a ${state.me.appearance.app_name}:\n${location.origin}\nUsuari: ${user}\nContrasenya: ${pass}`; }
function shareAccess(user, pass, w) {
  const text = accessText(user, pass);
  let phone = String(w.phone || '').replace(/[^\d+]/g, ''); if (phone.startsWith('+')) phone = phone.slice(1); else if (phone.length === 9) phone = '34' + phone;
  modal({ title: 'Dades d\'accés', body: `<p>Envia aquestes dades al treballador. <b>La contrasenya no es tornarà a mostrar.</b></p><pre class="box">${esc(text)}</pre>`,
    actions: [{ label: 'Copia', onClick: () => { copyText(text); return false; } }, { label: 'Envia per WhatsApp', cls: 'wa', onClick: () => { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank'); return false; } }, { label: 'Fet', cls: 'primary', value: true }] })
    .then(() => reload());
}

export function unavailabilityHtml(list) {
  return `<form class="row gap wrap" data-unav><select name="kind"><option value="no">⛔ No disponible</option><option value="si">✅ Disponible (excepcional)</option></select>
    <label>Del <input type="date" name="date_from" required></label><label>al <input type="date" name="date_to"></label><input name="reason" placeholder="Motiu (opcional)" class="grow"><button class="btn">Afegeix</button></form>
    <ul class="list">${list.map(u => `<li><div>${u.kind === 'si' ? '✅' : '⛔'} ${fdate(u.date_from)}${u.date_to !== u.date_from ? ' → ' + fdate(u.date_to) : ''} <small>${esc(u.reason || '')}</small></div><button class="btn small ghost" data-rmu="${u.id}">🗑</button></li>`).join('') || '<li class="muted">Cap data marcada.</li>'}</ul>`;
}
export function bindUnavailability(root, postUrl) {
  const f = $('[data-unav]', root);
  f.onsubmit = async e => { e.preventDefault(); try { await api.post(postUrl, Object.fromEntries(new FormData(f))); toast('Afegit'); reload(); } catch (err) { errorToast(err); } };
  $$('[data-rmu]', root).forEach(b => b.onclick = async () => { await api.del(`/api/unavailability/${b.dataset.rmu}`); reload(); });
}

// =====================================================================
// PRODUCTES
// =====================================================================
const PRODUCT_FIELDS = () => [
  { name: 'name', label: 'Nom del producte / servei', required: true, full: true },
  { name: 'description', label: 'Descripció', type: 'textarea', full: true },
  { name: 'price', label: 'Preu (sense IVA)', type: 'number', step: '0.01', default: 0 },
  { name: 'vat', label: 'IVA %', type: 'number', step: '0.01', default: state.me.invoicing?.default_vat ?? 21 },
  { name: 'unit', label: 'Unitat', placeholder: 'hora, unitat, dia…' },
  { name: 'workers_needed', label: 'Treballadors necessaris', type: 'number', default: 1, min: 0 },
  { name: 'color', label: 'Color al calendari', type: 'color' },
  { name: 'active', label: 'Actiu', type: 'checkbox', default: 1 },
];
export async function productsPage(el) {
  setTitle('Productes', '<button class="btn primary" data-new>+ Nou producte</button>');
  const edit = async p => {
    const r = await modal({ title: p ? 'Edita el producte' : 'Nou producte', body: formHtml(PRODUCT_FIELDS(), p || {}), actions: [
      ...(p ? [{ label: 'Esborra', cls: 'ghost danger-t', onClick: async () => { if (!(await confirmDialog('Esborrar el producte?', 'Esborra'))) return false; await api.del(`/api/products/${p.id}`); } }] : []),
      { label: 'Cancel·la', value: null },
      { label: 'Desa', cls: 'primary', onClick: root => { const d = readForm(root, PRODUCT_FIELDS()); return p ? api.put(`/api/products/${p.id}`, d) : api.post('/api/products', d); } }] });
    if (r) productsPage(el);
  };
  $('[data-new]').onclick = () => edit(null);
  const list = await api('/api/products');
  el.innerHTML = `<div class="card"><div class="table-wrap"><table class="table click"><thead><tr><th></th><th>Producte</th><th>Preu</th><th>IVA</th><th>Treballadors</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr data-id="${p.id}" class="${p.active ? '' : 'dim'}"><td><i class="dot" style="background:${esc(p.color)}"></i></td><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.description || '')}</small></td>
      <td>${money(p.price)}${p.unit ? ` / ${esc(p.unit)}` : ''}</td><td>${p.vat}%</td><td>${p.workers_needed}</td><td>${p.active ? '' : '<span class="chip gray">Inactiu</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Crea el primer producte o servei que ofereixes.</td></tr>'}
    </tbody></table></div></div>`;
  $$('tr[data-id]', el).forEach(tr => tr.onclick = () => edit(list.find(p => p.id === Number(tr.dataset.id))));
}
