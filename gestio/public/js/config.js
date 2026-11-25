// Automatismes, correus enviats i Configuració
import { templateTab as contractTemplateTab } from './contracts.js';
import { api, state, esc, $, $$, fdate, toast, errorToast, modal, confirmDialog, formHtml, readForm, setTitle, go, reload, debounce } from './core.js';

const VARS = {
  client: ['client.nom', 'client.nif', 'client.email', 'client.telefon', 'client.adreca', 'empresa.nom', 'empresa.telefon', 'empresa.email', 'empresa.pagament', 'empresa.iban'],
  quote: ['pressupost.numero', 'pressupost.total', 'pressupost.enllac', 'pressupost.validesa', 'pressupost.data', 'pressupost.titol'],
  invoice: ['factura.numero', 'factura.total', 'factura.enllac', 'factura.venciment', 'factura.senyal', 'factura.pendent', 'factura.senyal_estat'],
  worker: ['treballador.nom', 'treballador.cognoms', 'activitat.titol', 'activitat.data', 'activitat.hora', 'activitat.lloc', 'activitat.whatsapp', 'activitat.notes_treballadors', 'assignacio.producte', 'assignacio.rol', 'enllac_confirmacio', 'empresa.nom'],
  activity: ['activitat.titol', 'activitat.data', 'activitat.hora', 'activitat.lloc'],
  contract: ['contracte.numero', 'contracte.titol', 'contracte.enllac'],
};
function varsFor(trigger) {
  if (trigger.startsWith('quote')) return [...VARS.client, ...VARS.quote];
  if (trigger.startsWith('invoice') || trigger.startsWith('deposit')) return [...VARS.client, ...VARS.invoice];
  if (trigger === 'activity_client_reminder') return [...VARS.client, ...VARS.activity];
  if (trigger.startsWith('contract')) return [...VARS.client, ...VARS.contract];
  return VARS.worker;
}
function varChips(list) {
  return `<div class="vars"><small class="muted">Variables (clica per inserir):</small> ${list.map(v => `<button type="button" class="chip var" data-var="${v}">{{${v}}}</button>`).join('')}</div>`;
}
function bindVarChips(root) {
  let last = null;
  root.addEventListener('focusin', e => { if (e.target.matches('textarea,input[type=text],input:not([type])')) last = e.target; });
  root.addEventListener('mousedown', e => { if (e.target.matches('[data-var]')) e.preventDefault(); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-var]'); if (!b) return;
    const t = last || $('textarea', root); if (!t) return;
    const ins = `{{${b.dataset.var}}}`;
    const s = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, s) + ins + t.value.slice(t.selectionEnd ?? s);
    t.focus(); t.selectionStart = t.selectionEnd = s + ins.length;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// =====================================================================
// AUTOMATISMES
// =====================================================================
export async function automationsPage(el) {
  setTitle('Automatismes', '<button class="btn" data-run>▶ Executa ara</button><button class="btn primary" data-new>+ Nou automatisme</button>');
  const { automations, triggers } = await api('/api/automations');
  const unitTxt = (v, u) => `${v} ${u === 'hores' ? (v == 1 ? 'hora' : 'hores') : (v == 1 ? 'dia' : 'dies')}`;
  const group = t => (triggers[t]?.target === 'worker' ? 'worker' : 'client');
  const card = a => {
    const t = triggers[a.trigger] || { label: a.trigger, ref: '' };
    return `<div class="auto ${a.active ? '' : 'off'}" data-id="${a.id}"><label class="switch"><input type="checkbox" data-toggle ${a.active ? 'checked' : ''}><span></span></label>
      <div class="grow"><b>${esc(a.name)}</b><small>${esc(t.label)} · ${Number(a.delay_value) ? unitTxt(a.delay_value, a.delay_unit) + ' ' + esc(t.ref) : 'immediatament'}${Number(a.repeat_every) ? ` · repeteix cada ${unitTxt(a.repeat_every, a.delay_unit)} (màx. ${a.max_runs})` : ''}</small>
      <small class="muted">${a.sent_count ? `${a.sent_count} enviats · últim ${fdate(a.last_sent)}` : 'Encara no ha enviat res'}</small></div><button class="btn small" data-edit>Edita</button></div>`;
  };
  el.innerHTML = `<div class="alert info">Els automatismes es revisen cada minut i envien correus quan es compleix la condició. Cada recordatori només s'envia el nombre de vegades indicat i s'atura sol quan el client respon, paga o el treballador confirma.</div>
    <div class="cols"><section class="card"><h3>Clients</h3>${automations.filter(a => group(a.trigger) === 'client').map(card).join('') || '<p class="muted">—</p>'}</section>
    <section class="card"><h3>Treballadors</h3>${automations.filter(a => group(a.trigger) === 'worker').map(card).join('') || '<p class="muted">—</p>'}</section></div>`;
  $('[data-new]').onclick = () => editAutomation(null, triggers).then(r => r && reload());
  $('[data-run]').onclick = async () => { const r = await api.post('/api/automations/run'); toast(r.skipped ? 'Ja s\'està executant' : `Fet: ${r.sent} correus enviats`); reload(); };
  $$('.auto', el).forEach(c => {
    const a = automations.find(x => x.id === Number(c.dataset.id));
    $('[data-toggle]', c).onchange = async e => { await api.put(`/api/automations/${a.id}`, { active: e.target.checked ? 1 : 0 }); c.classList.toggle('off', !e.target.checked); };
    $('[data-edit]', c).onclick = () => editAutomation(a, triggers).then(r => r && reload());
  });
}

function editAutomation(a, triggers) {
  a = a || { trigger: 'quote_not_opened', delay_value: 3, delay_unit: 'dies', repeat_every: 0, max_runs: 1, active: 1 };
  const fields = [
    { name: 'name', label: 'Nom', required: true, full: true },
    { name: 'trigger', label: 'Quan…', type: 'select', empty: false, full: true, options: Object.entries(triggers).map(([value, t]) => ({ value, label: `${t.target === 'worker' ? '🧑‍🔧' : '👤'} ${t.label}` })) },
    { name: 'delay_value', label: 'Espera', type: 'number', step: '0.5', min: 0 },
    { name: 'delay_unit', label: 'Unitat', type: 'select', empty: false, options: ['hores', 'dies'] },
    { name: 'repeat_every', label: 'Repeteix cada (0 = no)', type: 'number', step: '0.5', min: 0 },
    { name: 'max_runs', label: 'Màxim d\'enviaments', type: 'number', min: 1 },
    { name: 'subject', label: 'Assumpte del correu', full: true },
    { name: 'body', label: 'Missatge', type: 'textarea', rows: 10, full: true },
    { name: 'active', label: 'Actiu', type: 'checkbox' },
  ];
  const body = document.createElement('div');
  const draw = () => {
    const t = triggers[a.trigger];
    body.innerHTML = formHtml(fields, a) + `<p class="muted small" data-ref>L'espera compta ${esc(t?.ref || '')}. ${a.trigger === 'assignment_new' ? 'Si deixes l\'assumpte i el missatge buits, s\'usa el missatge de convocatòria de Configuració > Missatges.' : ''}</p>` + varChips(varsFor(a.trigger));
    body.querySelector('[name=trigger]').onchange = e => { Object.assign(a, readForm(body, fields)); a.trigger = e.target.value; draw(); };
  };
  draw();
  bindVarChips(body);
  return modal({ title: a.id ? 'Edita l\'automatisme' : 'Nou automatisme', size: 'large', body, actions: [
    ...(a.id ? [{ label: 'Esborra', cls: 'ghost danger-t', onClick: async () => { if (!(await confirmDialog('Esborrar l\'automatisme?', 'Esborra'))) return false; await api.del(`/api/automations/${a.id}`); } }] : []),
    { label: 'Cancel·la', value: null },
    { label: 'Desa', cls: 'primary', onClick: root => { const d = readForm(root, fields); return a.id ? api.put(`/api/automations/${a.id}`, d) : api.post('/api/automations', d); } }] });
}

// =====================================================================
// CORREUS ENVIATS
// =====================================================================
export async function emailsPage(el) {
  setTitle('Correus enviats');
  const list = await api('/api/emails');
  const link = e => ({ quote: '#/pressupostos/', invoice: '#/factures/' }[e.related_type]);
  el.innerHTML = `<div class="card"><input class="search" data-filter placeholder="Cerca…"><div class="table-wrap"><table class="table click"><thead><tr><th>Data</th><th>Per a</th><th>Assumpte</th><th>Origen</th><th>Estat</th><th>Obert</th></tr></thead><tbody>
    ${list.map(e => `<tr data-id="${e.id}"><td>${fdate(e.created_at)}</td><td>${esc(e.to_addr || '—')}</td><td>${esc(e.subject)}</td><td>${e.automation_name ? '🤖 ' + esc(e.automation_name) : 'Manual'}${link(e) ? ` · <a href="${link(e)}${e.related_id}">veure</a>` : ''}</td>
      <td><span class="chip ${e.status === 'enviat' ? 'green' : e.status === 'error' ? 'red' : 'gray'}" title="${esc(e.error || '')}">${esc(e.status)}</span></td><td>${e.opened_at ? `👁 ${e.open_count}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Encara no s\'ha enviat cap correu.</td></tr>'}
    </tbody></table></div></div>`;
  $$('input[data-filter]', el).forEach(f => f.oninput = () => { const q = f.value.toLowerCase(); $$('tbody tr', el).forEach(tr => tr.hidden = q && !tr.textContent.toLowerCase().includes(q)); });
  $$('tr[data-id]', el).forEach(tr => tr.onclick = async ev => {
    if (ev.target.closest('a')) return;
    const e = await api(`/api/emails/${tr.dataset.id}`);
    modal({ title: e.subject, size: 'large', body: `<p><b>Per a:</b> ${esc(e.to_addr || '')} · ${fdate(e.created_at)} · <b>${esc(e.status)}</b>${e.error ? ` <small class="muted">(${esc(e.error)})</small>` : ''}</p><pre class="box">${esc(e.body)}</pre>` });
  });
}

// =====================================================================
// CONFIGURACIÓ
// =====================================================================
const TABS = [['empresa', 'Empresa'], ['aparenca', 'Aparença i apartats'], ['camps', 'Camps personalitzats'], ['llistes', 'Llistes'], ['facturacio', 'Facturació i numeració'], ['plantilles', 'Disseny dels documents'], ['contracte', 'Contracte tipus'], ['missatges', 'Missatges'], ['correu', 'Correu'], ['usuaris', 'Usuaris'], ['copia', 'Còpia de seguretat'], ['compte', 'El meu compte']];

export async function settingsPage(el, tab = 'empresa') {
  setTitle('Configuració');
  const { settings: s, presets, baseUrl, smtpConfigured } = await api('/api/settings');
  el.innerHTML = `<div class="tabs">${TABS.map(([k, l]) => `<a href="#/configuracio/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div class="card" data-body></div>`;
  const body = $('[data-body]', el);
  const saveBtn = '<div class="row end"><button class="btn primary" data-save>Desa</button></div>';
  const onSave = fn => { $('[data-save]', body).onclick = async () => { try { await fn(); toast('Configuració desada'); await window.__refreshMe(); } catch (e) { errorToast(e); } }; };

  if (tab === 'empresa') {
    const F = [{ name: 'name', label: 'Nom de l\'empresa', required: true }, { name: 'nif', label: 'NIF / CIF' }, { name: 'address', label: 'Adreça', full: true }, { name: 'postal_code', label: 'Codi postal' }, { name: 'city', label: 'Població' },
      { name: 'email', label: 'Correu (rep els avisos de pressupostos acceptats)', type: 'email' }, { name: 'phone', label: 'Telèfon' }, { name: 'website', label: 'Web' }, { name: 'iban', label: 'IBAN' },
      { name: 'payment_info', label: 'Forma de pagament (surt a factures i correus)', type: 'textarea', full: true }, { name: 'footer', label: 'Peu de pàgina dels documents (dades registrals, LOPD…)', type: 'textarea', full: true }];
    body.innerHTML = `<h3>Logotip</h3><div class="row gap">${s.company.logo ? `<img src="/logo?v=${esc(s.company.logo)}" class="logo-prev" alt="">` : '<span class="muted">Sense logotip</span>'}
      <label class="btn"><input type="file" accept="image/*" hidden data-logo> Puja logotip</label>${s.company.logo ? '<button class="btn ghost" data-rmlogo>Treu-lo</button>' : ''}</div>
      <h3>Dades fiscals</h3>${formHtml(F, s.company)}${saveBtn}`;
    $('[data-logo]', body).onchange = async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); try { await api('/api/settings/logo', { body: fd }); toast('Logotip desat'); await window.__refreshMe(); } catch (err) { errorToast(err); } };
    const rm = $('[data-rmlogo]', body); if (rm) rm.onclick = async () => { await api.del('/api/settings/logo'); await window.__refreshMe(); };
    onSave(() => api.put('/api/settings', { company: readForm(body, F) }));
  }

  if (tab === 'aparenca') {
    const MODS = [['tauler', 'Tauler'], ['activitats', 'Activitats'], ['clients', 'Clients'], ['treballadors', 'Treballadors'], ['productes', 'Productes'], ['pressupostos', 'Pressupostos'], ['factures', 'Factures'], ['contractes', 'Contractes'], ['automatismes', 'Automatismes'], ['correus', 'Correus enviats']];
    const F = [{ name: 'app_name', label: 'Nom de la plataforma' }, { name: 'primary_color', label: 'Color principal', type: 'color' },
      { name: 'font', label: 'Tipus de lletra dels documents', type: 'select', empty: false, options: [{ value: "'Helvetica Neue', Arial, sans-serif", label: 'Helvetica / Arial' }, { value: "Georgia, 'Times New Roman', serif", label: 'Georgia (serif)' }, { value: "'Trebuchet MS', Verdana, sans-serif", label: 'Trebuchet' }, { value: "'Courier New', monospace", label: 'Courier' }] }];
    body.innerHTML = `${formHtml(F, s.appearance)}<h3>Apartats del menú</h3><p class="muted">Activa o amaga apartats i canvia'ls el nom.</p>
      <table class="table"><tbody>${MODS.map(([k, l]) => `<tr><td><label class="check"><input type="checkbox" data-mod="${k}" ${s.appearance.modules[k] !== false ? 'checked' : ''}> ${l}</label></td><td><input data-label="${k}" value="${esc(s.appearance.labels[k] || '')}" placeholder="${l}"></td></tr>`).join('')}</tbody></table>${saveBtn}`;
    onSave(() => {
      const ap = readForm(body, F);
      ap.modules = Object.fromEntries($$('[data-mod]', body).map(c => [c.dataset.mod, c.checked]));
      ap.labels = Object.fromEntries($$('[data-label]', body).map(c => [c.dataset.label, c.value.trim()]).filter(([, v]) => v));
      return api.put('/api/settings', { appearance: ap });
    });
  }

  if (tab === 'camps') {
    const ENT = [['worker', 'Treballadors'], ['client', 'Clients'], ['activity', 'Activitats']];
    const cf = JSON.parse(JSON.stringify(s.custom_fields));
    const draw = () => {
      body.innerHTML = `<p class="muted">Afegeix camps propis a les fitxes (p. ex. «Talla de samarreta», «Núm. de la Seguretat Social», «Nombre d'infants»…). Els pots fer servir a les plantilles amb {{treballador.clau}}, {{client.clau}} o {{activitat.clau}}.</p>
        ${ENT.map(([e, l]) => `<h3>${l}</h3><table class="table"><thead><tr><th>Etiqueta</th><th>Clau</th><th>Tipus</th><th>Opcions (separades per comes)</th><th></th></tr></thead><tbody>
        ${cf[e].map((f, i) => `<tr data-e="${e}" data-i="${i}"><td><input data-k="label" value="${esc(f.label)}"></td><td><input data-k="key" value="${esc(f.key)}" class="w120"></td>
          <td><select data-k="type">${['text', 'number', 'date', 'email', 'tel', 'textarea', 'select', 'checkbox'].map(t => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td><input data-k="options" value="${esc(f.options || '')}"></td><td><button class="icon-btn" data-rm>🗑</button></td></tr>`).join('')}</tbody></table>
        <button class="btn small" data-add="${e}">+ Afegeix camp</button>`).join('')}${saveBtn}`;
      $$('[data-add]', body).forEach(b => b.onclick = () => { sync(); cf[b.dataset.add].push({ label: '', key: '', type: 'text' }); draw(); });
      $$('[data-rm]', body).forEach(b => b.onclick = () => { sync(); const tr = b.closest('tr'); cf[tr.dataset.e].splice(tr.dataset.i, 1); draw(); });
      onSave(() => { sync(); for (const e in cf) cf[e] = cf[e].filter(f => f.label).map(f => ({ ...f, key: f.key || f.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_') })); return api.put('/api/settings', { custom_fields: cf }); });
    };
    const sync = () => $$('tr[data-e]', body).forEach(tr => { const f = cf[tr.dataset.e][tr.dataset.i]; $$('[data-k]', tr).forEach(i => f[i.dataset.k] = i.value.trim()); });
    draw();
  }

  if (tab === 'llistes') {
    const sts = JSON.parse(JSON.stringify(s.activity_statuses));
    const draw = () => {
      body.innerHTML = `<h3>Estats de les activitats</h3><table class="table"><tbody>${sts.map((x, i) => `<tr data-i="${i}"><td><input type="color" data-k="color" value="${esc(x.color)}"></td><td><input data-k="label" value="${esc(x.label)}"></td><td><small class="muted">${esc(x.key)}</small></td><td>${['pendent', 'confirmada', 'feta', 'cancel·lada'].includes(x.key) ? '' : '<button class="icon-btn" data-rm>🗑</button>'}</td></tr>`).join('')}</tbody></table>
        <button class="btn small" data-addst>+ Afegeix estat</button>
        <h3>Rols dels treballadors</h3><textarea data-roles rows="4">${esc(s.worker_roles.join('\n'))}</textarea><small class="muted">Un per línia.</small>
        <h3>Categories de documents</h3><textarea data-cats rows="5">${esc(s.document_categories.join('\n'))}</textarea><small class="muted">Una per línia.</small>${saveBtn}`;
      const sync = () => $$('tr[data-i]', body).forEach(tr => $$('[data-k]', tr).forEach(i => sts[tr.dataset.i][i.dataset.k] = i.value));
      $('[data-addst]', body).onclick = () => { sync(); sts.push({ key: 'estat_' + Date.now().toString(36), label: 'Nou estat', color: '#8b5cf6' }); draw(); };
      $$('[data-rm]', body).forEach(b => b.onclick = () => { sync(); sts.splice(b.closest('tr').dataset.i, 1); draw(); });
      onSave(() => { sync(); return api.put('/api/settings', { activity_statuses: sts, worker_roles: $('[data-roles]', body).value.split('\n').map(x => x.trim()).filter(Boolean), document_categories: $('[data-cats]', body).value.split('\n').map(x => x.trim()).filter(Boolean) }); });
    };
    draw();
  }

  if (tab === 'facturacio') {
    const F = [{ name: 'invoicing.default_vat', label: 'IVA per defecte %', type: 'number', step: '0.01' }, { name: 'invoicing.due_days', label: 'Dies fins al venciment', type: 'number' },
      { name: 'invoicing.quote_validity_days', label: 'Validesa dels pressupostos (dies)', type: 'number' }, { name: 'invoicing.currency', label: 'Moneda' },
      { name: 'invoicing.default_deposit_type', label: 'Paga i senyal per defecte', type: 'select', empty: false, options: [{ value: 'none', label: 'Sense' }, { value: 'percent', label: 'Percentatge' }, { value: 'amount', label: 'Import fix' }] },
      { name: 'invoicing.default_deposit_value', label: 'Valor del senyal (% o €)', type: 'number', step: '0.01' },
      { name: 'invoicing.quote_conditions', label: 'Condicions per defecte dels pressupostos', type: 'textarea', full: true },
      { name: 'invoicing.invoice_notes', label: 'Notes per defecte de les factures', type: 'textarea', full: true },
      { name: 'numbering.invoice_prefix', label: 'Prefix de factures', help: '{ANY} = any actual, {AA} = dues xifres' }, { name: 'numbering.invoice_next', label: 'Següent núm. de factura', type: 'number' },
      { name: 'numbering.quote_prefix', label: 'Prefix de pressupostos' }, { name: 'numbering.quote_next', label: 'Següent núm. de pressupost', type: 'number' },
      { name: 'numbering.digits', label: 'Xifres del número', type: 'number' }, { name: 'numbering.reset_yearly', label: 'Reinicia la numeració cada any', type: 'checkbox' }];
    body.innerHTML = formHtml(F, s) + saveBtn;
    onSave(() => { const d = readForm(body, F); d.numbering.reset_yearly = !!d.numbering.reset_yearly; return api.put('/api/settings', d); });
  }

  if (tab === 'plantilles') {
    let kind = 'invoice';
    const t = { ...s.templates };
    const draw = () => {
      const presetKey = kind === 'invoice' ? 'invoice_preset' : 'quote_preset', htmlKey = kind === 'invoice' ? 'invoice_html' : 'quote_html';
      body.innerHTML = `<h3>🎨 Colors i estil de l'empresa</h3>
        <p class="muted small">S'apliquen a factures, pressupostos i contractes. Si no poses colors, es fa servir el color principal de la plataforma.</p>
        <div class="grid-form design">
          <div class="field"><label>Color principal</label><input type="color" data-o="color" value="${esc(t.color || s.appearance.primary_color)}"></div>
          <div class="field"><label>Color secundari (detalls, descomptes)</label><input type="color" data-o="color2" value="${esc(t.color2 || '#1f2937')}"></div>
          <div class="field"><label>Mida del logotip (px)</label><input type="number" min="20" max="200" data-o="logo_height" value="${esc(t.logo_height || 70)}"></div>
          <div class="field full"><label>Eslògan (surt sota el logotip)</label><input data-o="tagline" value="${esc(t.tagline || '')}" placeholder="Ex.: Experiències castelleres per a empreses"></div>
          <label class="check"><input type="checkbox" data-o="show_service" ${t.show_service !== false ? 'checked' : ''}> Mostra el requadre del servei (data i lloc)</label>
          <label class="check"><input type="checkbox" data-o="show_vat_column" ${t.show_vat_column !== false ? 'checked' : ''}> Mostra la columna d'IVA</label>
          <label class="check"><input type="checkbox" data-o="quote_signature" ${t.quote_signature ? 'checked' : ''}> Espai per signar la conformitat al pressupost</label>
        </div>
        <h3>Disseny</h3>
        <div class="row gap wrap"><div class="seg"><button data-k="invoice" class="${kind === 'invoice' ? 'on' : ''}">Factura</button><button data-k="quote" class="${kind === 'quote' ? 'on' : ''}">Pressupost</button></div>
        <label>Disseny base <select data-preset>${presets.map(p => `<option ${p === t[presetKey] ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-custom ${t[htmlKey] ? 'checked' : ''}> Personalitza l'HTML</label></div>
        <p class="muted small">Tria un disseny i ajusta'l: el logotip, el color i les dades surten de «Empresa» i «Aparença». Si vols que sigui <b>idèntica a la teva factura actual</b>, activa «Personalitza l'HTML» i edita el codi (o demana que te l'adaptin a partir d'un PDF teu). Les factures existents també es veuen amb la plantilla nova.</p>
        <div class="tpl-ed"><div class="tpl-code" ${t[htmlKey] ? '' : 'hidden'}><textarea data-html spellcheck="false">${esc(t[htmlKey] || '')}</textarea>
          <details><summary>Variables disponibles</summary><pre class="box small">{{empresa.nom}} {{empresa.nif}} {{empresa.adreca}} {{empresa.cp}} {{empresa.poblacio}} {{empresa.telefon}} {{empresa.email}} {{empresa.iban}} {{empresa.pagament}} {{empresa.peu}} {{empresa.logo}}
{{client.nom}} {{client.nif}} {{client.adreca}} {{client.cp}} {{client.poblacio}} {{client.email}} {{client.telefon}}
{{doc.tipus}} {{doc.numero}} {{doc.data}} {{doc.venciment}} {{doc.base}} {{doc.iva}} {{doc.total}} {{doc.notes}} {{doc.condicions}}
{{#if doc.te_senyal}} {{doc.senyal}} {{doc.senyal_estat}} {{doc.pendent}} {{/if}}
{{#each doc.ivas}} {{tipus}} {{quota}} {{/each}}
{{#each linies}} {{descripcio}} {{quantitat}} {{preu}} {{iva}} {{descompte}} {{import}} {{/each}}
{{activitat.titol}} {{activitat.data}} {{activitat.lloc}} · {{{estil.color}}} {{{estil.font}}}</pre></details></div>
        <iframe class="doc-frame" data-prev></iframe></div>${saveBtn}`;
      $$('.seg button', body).forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
      const ta = $('[data-html]', body), frame = $('[data-prev]', body);
      const preview = debounce(async () => {
        const html = $('[data-custom]', body).checked ? ta.value : null;
        const r = await fetch('/api/render-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, html: html || (await (await fetch('/api/settings/preset/' + $('[data-preset]', body).value)).json()).html }) });
        frame.srcdoc = await r.text();
      }, 400);
      $('[data-preset]', body).onchange = async e => { t[presetKey] = e.target.value; if ($('[data-custom]', body).checked && await confirmDialog('Vols substituir el teu HTML pel disseny triat?', 'Substitueix', false)) { ta.value = (await api('/api/settings/preset/' + e.target.value)).html; t[htmlKey] = ta.value; } preview(); };
      $('[data-custom]', body).onchange = async e => {
        $('.tpl-code', body).hidden = !e.target.checked;
        if (e.target.checked && !ta.value) ta.value = (await api('/api/settings/preset/' + t[presetKey])).html;
        if (!e.target.checked) t[htmlKey] = '';
        preview();
      };
      ta.oninput = () => { t[htmlKey] = ta.value; preview(); };
      const readOpts = () => { for (const i of $$('[data-o]', body)) t[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value; };
      $$('[data-o]', body).forEach(i => i.addEventListener(i.type === 'checkbox' || i.type === 'color' ? 'change' : 'input', async () => { readOpts(); await api.put('/api/settings', { templates: { color: t.color, color2: t.color2, logo_height: t.logo_height, tagline: t.tagline, show_service: t.show_service, show_vat_column: t.show_vat_column, quote_signature: t.quote_signature } }); preview(); }));
      preview();
      onSave(() => api.put('/api/settings', { templates: { ...t, [htmlKey]: $('[data-custom]', body).checked ? ta.value : '' } }));
    };
    draw();
  }

  if (tab === 'missatges') {
    const F = [
      { name: 'assignment_subject', label: 'Convocatòria al treballador — assumpte', full: true },
      { name: 'assignment_body', label: 'Convocatòria al treballador — missatge (correu)', type: 'textarea', rows: 12, full: true },
      { name: 'whatsapp_text', label: 'Convocatòria per WhatsApp', type: 'textarea', rows: 8, full: true },
      { name: 'quote_subject', label: 'Enviament de pressupost — assumpte', full: true },
      { name: 'quote_body', label: 'Enviament de pressupost — missatge', type: 'textarea', rows: 10, full: true },
      { name: 'invoice_subject', label: 'Enviament de factura — assumpte', full: true },
      { name: 'invoice_body', label: 'Enviament de factura — missatge', type: 'textarea', rows: 10, full: true },
      { name: 'contract_subject', label: 'Enviament de contracte — assumpte', full: true },
      { name: 'contract_body', label: 'Enviament de contracte — missatge', type: 'textarea', rows: 10, full: true },
    ];
    body.innerHTML = formHtml(F, s.messages) + varChips([...new Set([...VARS.worker, ...VARS.client, ...VARS.quote, ...VARS.invoice, ...VARS.contract])]) + saveBtn;
    bindVarChips(body);
    onSave(() => api.put('/api/settings', { messages: readForm(body, F) }));
  }

  if (tab === 'correu') {
    const F = [{ name: 'base_url', label: 'Adreça pública de la plataforma', full: true, placeholder: baseUrl, help: 'S\'usa als enllaços dels correus (pressupostos, confirmacions). Ha de ser accessible des d\'internet.' },
      { name: 'smtp_host', label: 'Servidor SMTP', placeholder: 'smtp.gmail.com' }, { name: 'smtp_port', label: 'Port', type: 'number' },
      { name: 'smtp_secure', label: 'SSL directe (port 465)', type: 'checkbox' }, { name: 'smtp_user', label: 'Usuari SMTP' },
      { name: 'smtp_pass', label: 'Contrasenya SMTP', type: 'password', help: 'A Gmail/Google Workspace cal una «contrasenya d\'aplicació».' },
      { name: 'from_name', label: 'Nom del remitent' }, { name: 'from_email', label: 'Correu del remitent', type: 'email' }, { name: 'reply_to', label: 'Respondre a', type: 'email' },
      { name: 'signature', label: 'Signatura dels correus', type: 'textarea', full: true }];
    body.innerHTML = `<p>${smtpConfigured ? '<span class="chip green">Correu configurat</span>' : '<span class="chip amber">Sense configurar: els correus es desen però no s\'envien</span>'}</p>${formHtml(F, s.email)}
      <div class="row gap"><input type="email" data-test placeholder="correu de prova" value="${esc(s.company.email || '')}"><button class="btn" data-testbtn>Envia un correu de prova</button></div>${saveBtn}`;
    onSave(() => api.put('/api/settings', { email: readForm(body, F) }));
    $('[data-testbtn]', body).onclick = async () => { try { const r = await api.post('/api/settings/test-email', { to: $('[data-test]', body).value }); toast(r.status === 'enviat' ? 'Correu de prova enviat ✅' : `${r.status}: ${r.error || ''}`, r.status === 'enviat' ? 'ok' : 'bad'); } catch (e) { errorToast(e); } };
  }

  if (tab === 'usuaris') {
    const users = await api('/api/users');
    body.innerHTML = `<h3>Administradors</h3><p class="muted">Tenen accés complet. Els usuaris dels treballadors (accés limitat) es creen des de la fitxa de cada treballador, a la pestanya «Accés».</p>
      <table class="table"><tbody>${users.map(u => `<tr><td><b>${esc(u.username)}</b> ${esc(u.name || '')}<br><small class="muted">${u.last_login ? 'Últim accés ' + fdate(u.last_login) : 'Mai'}</small></td>
      <td>${u.active ? '<span class="chip green">Actiu</span>' : '<span class="chip gray">Inactiu</span>'}</td><td class="actions"><button class="btn small" data-pw="${u.id}">Contrasenya</button>
      ${u.id !== state.me.user.id ? `<button class="btn small" data-act="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Desactiva' : 'Activa'}</button><button class="btn small ghost" data-del="${u.id}">🗑</button>` : '<small class="muted">(tu)</small>'}</td></tr>`).join('')}</tbody></table>
      <h3>Nou administrador</h3><form class="row gap wrap" data-new><input name="username" placeholder="Usuari" required autocapitalize="none"><input name="name" placeholder="Nom"><input name="password" type="password" placeholder="Contrasenya (mín. 8)" required minlength="8"><button class="btn primary">Crea</button></form>`;
    $('[data-new]', body).onsubmit = async e => { e.preventDefault(); try { await api.post('/api/users', Object.fromEntries(new FormData(e.target))); toast('Usuari creat'); reload(); } catch (err) { errorToast(err); } };
    $$('[data-pw]', body).forEach(b => b.onclick = async () => { const p = prompt('Nova contrasenya (mínim 8 caràcters)'); if (p) { try { await api.put(`/api/users/${b.dataset.pw}`, { password: p }); toast('Contrasenya canviada'); } catch (e) { errorToast(e); } } });
    $$('[data-act]', body).forEach(b => b.onclick = async () => { await api.put(`/api/users/${b.dataset.act}`, { active: Number(b.dataset.v) }); reload(); });
    $$('[data-del]', body).forEach(b => b.onclick = async () => { if (await confirmDialog('Esborrar aquest usuari?', 'Esborra')) { await api.del(`/api/users/${b.dataset.del}`); reload(); } });
  }

  if (tab === 'copia') {
    body.innerHTML = `<h3>Còpia de seguretat</h3>
      <p>Descarrega un fitxer amb <b>totes les dades</b> (treballadors, clients, activitats, pressupostos, factures, configuració) i <b>tots els documents</b> pujats.</p>
      <p class="muted">Al servidor ja se'n fa una cada nit automàticament, però si el servidor es fes malbé també es perdrien. Descarrega'n una de tant en tant (per exemple, cada mes) i guarda-la al teu ordinador o al Drive.</p>
      <a class="btn primary" href="/api/backup" download>⬇ Descarrega la còpia de seguretat</a>`;
  }

  if (tab === 'contracte') await contractTemplateTab(body, s);

  if (tab === 'compte') passwordForm(body);
}

export function passwordForm(body) {
  body.innerHTML = `<h3>Canvia la contrasenya</h3><form class="grid-form" data-pw><div class="field"><label>Contrasenya actual</label><input type="password" name="current" required autocomplete="current-password"></div>
    <div class="field"><label>Nova contrasenya</label><input type="password" name="password" required minlength="8" autocomplete="new-password"></div><div class="row end full"><button class="btn primary">Canvia-la</button></div></form>`;
  $('[data-pw]', body).onsubmit = async e => { e.preventDefault(); try { await api.put('/api/me/password', Object.fromEntries(new FormData(e.target))); toast('Contrasenya canviada'); e.target.reset(); } catch (err) { errorToast(err); } };
}
