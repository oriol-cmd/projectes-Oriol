// Pressupostos i factures (mateix editor)
import { api, state, esc, $, $$, money, fdate, today, toast, errorToast, modal, confirmDialog, formHtml, readForm, statusChip, QUOTE_STATUS, INVOICE_STATUS, setTitle, go, reload, copyText } from './core.js';
import { clientPickerHtml, bindClientPicker, bindTableClicks, bindFilter } from './admin.js';

const K = {
  quote: { api: '/api/quotes', path: '#/pressupostos', title: 'Pressupostos', one: 'Pressupost', status: QUOTE_STATUS, newLabel: '+ Nou pressupost', newPath: 'nou' },
  invoice: { api: '/api/invoices', path: '#/factures', title: 'Factures', one: 'Factura', status: INVOICE_STATUS, newLabel: '+ Nova factura', newPath: 'nova' },
};

export async function listPage(el, kind) {
  const k = K[kind];
  setTitle(k.title, `<a class="btn primary" href="${k.path}/${k.newPath}">${k.newLabel}</a>`);
  const list = await api(k.api);
  const filters = Object.entries(k.status);
  el.innerHTML = `<div class="card"><div class="row gap wrap"><input class="search grow" data-filter placeholder="Cerca…">
    <select data-st><option value="">Tots els estats</option>${filters.map(([v, s]) => `<option value="${v}">${esc(s.label)}</option>`).join('')}</select></div>
    <div class="table-wrap"><table class="table click"><thead><tr><th>Núm.</th><th>Data</th><th>Client</th><th>Total</th><th>Estat</th><th>Seguiment</th></tr></thead><tbody>
    ${list.map(d => `<tr data-href="${k.path}/${d.id}" data-status="${esc(d.status)}"><td><b>${esc(d.number)}</b>${d.title ? `<br><small class="muted">${esc(d.title)}</small>` : ''}</td><td>${fdate(d.date)}</td><td>${esc(d.client_name || '—')}</td><td>${money(d.total)}</td>
      <td>${statusChip(d.status, k.status)}${kind === 'invoice' && d.deposit_amount > 0 ? `<br><small class="${d.deposit_paid_at ? 'ok-t' : 'warn-t'}">Senyal ${money(d.deposit_amount)} ${d.deposit_paid_at ? '✓' : 'pendent'}</small>` : ''}</td>
      <td><small>${d.sent_at ? `✉️ Enviat ${fdate(d.sent_at)}` : '<span class="muted">No enviat</span>'}${d.sent_at ? `<br>👁 ${d.open_count ? `Obert ${d.open_count} cops${kind === 'quote' && d.last_opened_at ? ' · últim ' + fdate(d.last_opened_at) : ''}` : 'Encara no obert'}` : ''}${d.email_count > 1 ? `<br>🔁 ${d.email_count - 1} recordatoris` : ''}</small></td></tr>`).join('') || `<tr><td colspan="6" class="muted">Encara no n'hi ha.</td></tr>`}
    </tbody></table></div></div>`;
  bindTableClicks(el); bindFilter(el);
  $('[data-st]', el).onchange = e => $$('tbody tr', el).forEach(tr => tr.hidden = e.target.value && tr.dataset.status !== e.target.value);
}

export async function editor(el, kind, idParam) {
  const k = K[kind];
  const isNew = !/^\d+$/.test(idParam);
  const inv = state.me.invoicing || {};
  let doc;
  if (isNew) {
    const presetClient = sessionStorage.getItem('newDocClient'); sessionStorage.removeItem('newDocClient');
    doc = { date: today(), lines: [], client: presetClient ? JSON.parse(presetClient) : null, deposit_type: inv.default_deposit_type || 'none', deposit_value: inv.default_deposit_value || 0, status: 'esborrany', conditions: kind === 'quote' ? inv.quote_conditions : '', notes: kind === 'invoice' ? inv.invoice_notes : '' };
  } else doc = await api(`${k.api}/${idParam}`);
  const products = await api('/api/products');

  setTitle(isNew ? `Nou ${k.one.toLowerCase()}` : `${k.one} ${doc.number}`, isNew ? '' : `
    <button class="btn" data-preview>👁 Previsualitza / PDF</button><button class="btn primary" data-send>✉️ Envia al client</button>
    <div class="dropdown"><button class="btn">Més ▾</button><div class="menu">
      ${doc.public_url ? '<button data-copy>🔗 Copia l\'enllaç per al client</button>' : ''}
      ${kind === 'quote' ? '<button data-accept>✅ Marca com acceptat</button><button data-reject>❌ Marca com rebutjat</button><button data-to-act>📅 Crea l\'activitat</button><button data-to-inv>🧾 Converteix en factura</button><button data-to-contract>📄 Crea el contracte</button>' : ''}
      ${kind === 'invoice' ? '<button data-cancel>🚫 Anul·la la factura</button>' : ''}
      <button data-del class="danger-t">🗑 Esborra</button></div></div>`);

  const headFields = kind === 'quote'
    ? [{ name: 'number', label: 'Número', placeholder: 'Automàtic' }, { name: 'title', label: 'Títol / concepte' }, { name: 'date', label: 'Data', type: 'date' }, { name: 'valid_until', label: 'Vàlid fins', type: 'date' }]
    : [{ name: 'number', label: 'Número', placeholder: 'Automàtic' }, { name: 'date', label: 'Data', type: 'date' }, { name: 'due_date', label: 'Venciment', type: 'date' },
      { name: 'status', label: 'Estat', type: 'select', options: Object.entries(INVOICE_STATUS).map(([value, s]) => ({ value, label: s.label })), empty: false }];
  const discFields = [
    { name: 'discount_type', label: 'Descompte general', type: 'select', empty: false, options: [{ value: 'none', label: 'Sense descompte' }, { value: 'percent', label: 'Percentatge (%)' }, { value: 'amount', label: 'Import fix (€)' }] },
    { name: 'discount_value', label: 'Valor del descompte', type: 'number', step: '0.01', min: 0 },
  ];
  const introFields = kind === 'quote' ? [{ name: 'intro', label: 'Text de presentació (surt a dalt del pressupost)', type: 'textarea', full: true, placeholder: 'Ex.: Benvolguts, us fem arribar la proposta per a la vostra jornada d\'equip…' }] : [];
  const tailFields = [
    { name: 'deposit_type', label: 'Paga i senyal', type: 'select', empty: false, options: [{ value: 'none', label: 'Sense paga i senyal' }, { value: 'percent', label: 'Percentatge del total' }, { value: 'amount', label: 'Import fix' }] },
    { name: 'deposit_value', label: 'Valor del senyal (% o €)', type: 'number', step: '0.01' },
    { name: 'notes', label: 'Notes (surten al document)', type: 'textarea', full: true },
    ...(kind === 'quote' ? [{ name: 'conditions', label: 'Condicions', type: 'textarea', full: true }] : [{ name: 'payment_method', label: 'Forma de pagament' }]),
  ];
  let lines = (doc.lines || []).map(l => ({ ...l }));
  if (!lines.length) lines.push({ description: '', quantity: 1, price: 0, vat: inv.default_vat ?? 21 });

  const f = doc.finance;
  el.innerHTML = `<div class="cols">
    <section class="card wide"><form data-f onsubmit="return false">
      ${!isNew ? `<div class="row gap wrap">${statusChip(doc.status, k.status)}${kind === 'invoice' && f && f.te_senyal ? `<span class="chip ${doc.deposit_paid_at ? 'green' : 'amber'}">Senyal ${esc(f.senyal)} ${doc.deposit_paid_at ? 'pagat ' + fdate(doc.deposit_paid_at) : 'pendent'}</span>` : ''}
        ${kind === 'invoice' && doc.paid_at ? `<span class="chip green">Pagada ${fdate(doc.paid_at)}</span>` : ''}</div>` : ''}
      ${formHtml(headFields, doc)}
      <h4>Client</h4>${clientPickerHtml(doc.client)}
      ${introFields.length ? formHtml(introFields, doc) : ''}
      <h4>Conceptes</h4>
      <div class="table-wrap"><table class="table lines-ed"><thead><tr><th>Concepte</th><th>Quant.</th><th>Preu</th><th>Dte %</th><th>IVA %</th><th class="r">Import</th><th></th></tr></thead><tbody data-lines></tbody></table></div>
      <div class="row gap wrap"><select data-addp><option value="">+ Afegeix un producte…</option>${products.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select><button type="button" class="btn small" data-addl>+ Línia lliure</button></div>
      <div class="disc-box"><h4>🎁 Descompte</h4><p class="muted small">Pots posar un descompte a cada línia (columna «Dte %») i/o un descompte general sobre el total. Al document es veu el descompte i l'estalvi.</p>${formHtml(discFields, { discount_type: 'none', ...doc })}</div>
      <div class="totals" data-totals></div>
      ${formHtml(tailFields, doc)}
      <div class="row end gap"><button class="btn primary" data-save>${isNew ? 'Crea' : 'Desa els canvis'}</button></div></form></section>
    ${isNew ? '' : `<section class="card">
      ${kind === 'invoice' ? `<h3>Cobrament</h3><div class="row gap wrap">
        ${f.te_senyal ? `<button class="btn ${doc.deposit_paid_at ? '' : 'primary'}" data-pay="deposit" data-v="${doc.deposit_paid_at ? 0 : 1}">${doc.deposit_paid_at ? '↩ Desmarca senyal' : `💶 Senyal pagat (${esc(f.senyal)})`}</button>` : ''}
        <button class="btn ${doc.paid_at ? '' : 'primary'}" data-pay="full" data-v="${doc.paid_at ? 0 : 1}">${doc.paid_at ? '↩ Desmarca pagada' : '✅ Marca com a pagada'}</button></div>
        <p class="muted small">Pendent de cobrar: <b>${esc(f.pendent)}</b></p>` : ''}
      <h3>Seguiment</h3>
      <dl class="dl"><dt>Enviat</dt><dd>${doc.sent_at ? fdate(doc.sent_at) : '—'}</dd><dt>Obert</dt><dd>${doc.open_count ? `${doc.open_count} cops · primer ${fdate(doc.first_opened_at)}` : 'Encara no'}</dd>
      ${kind === 'quote' && doc.responded_at ? `<dt>Resposta</dt><dd>${fdate(doc.responded_at)}${doc.response_note ? `<br>💬 «${esc(doc.response_note)}»` : ''}</dd>` : ''}</dl>
      <p class="muted small">L'obertura es detecta quan el client obre l'enllaç o carrega les imatges del correu (alguns programes ho bloquegen o ho fan automàticament).</p>
      <h4>Correus</h4><ul class="list">${doc.emails.map(e => `<li><div>${esc(e.subject)}<small>${fdate(e.created_at)} · ${esc(e.to_addr || '')}${e.automation_id ? ' · 🤖 automàtic' : ''}</small></div><div class="r"><span class="chip ${e.status === 'enviat' ? 'green' : e.status === 'error' ? 'red' : 'gray'}">${esc(e.status)}</span><small>${e.opened_at ? '👁 obert' : ''}</small></div></li>`).join('') || '<li class="muted">Cap correu enviat.</li>'}</ul>
      <h4>Historial</h4><ul class="timeline">${doc.timeline.map(t => `<li><small>${fdate(t.created_at)}</small>${esc(t.message)}</li>`).join('')}</ul></section>`}
  </div>`;

  const getClient = bindClientPicker(el);
  const tbody = $('[data-lines]', el);
  const form = $('[data-f]', el);
  const calc = () => {
    let gross = 0, lineDisc = 0; const buckets = {};
    for (const l of lines) {
      const full = (Number(l.quantity) || 0) * (Number(l.price) || 0);
      const a = full * (1 - Math.min(100, Number(l.discount) || 0) / 100);
      lineDisc += full - a; gross += a; buckets[Number(l.vat) || 0] = (buckets[Number(l.vat) || 0] || 0) + a;
    }
    const kt = form.discount_type.value, kv = Math.max(0, Number(form.discount_value.value) || 0);
    const disc = kt === 'percent' ? gross * Math.min(100, kv) / 100 : kt === 'amount' ? Math.min(gross, kv) : 0;
    const factor = gross ? (gross - disc) / gross : 1;
    const base = gross - disc;
    const vat = Object.entries(buckets).reduce((acc, [r, b]) => acc + b * factor * Number(r) / 100, 0);
    const total = base + vat;
    const dt = form.deposit_type.value, dv = Number(form.deposit_value.value) || 0;
    const dep = dt === 'percent' ? total * dv / 100 : dt === 'amount' ? dv : 0;
    const saving = disc + lineDisc;
    $('[data-totals]', el).innerHTML = `${disc ? `<div><span>Subtotal</span><b>${money(gross)}</b></div><div class="disc"><span>Descompte${kt === 'percent' ? ` (${kv}%)` : ''}</span><b>−${money(disc)}</b></div>` : ''}
      <div><span>Base imposable</span><b>${money(base)}</b></div><div><span>IVA</span><b>${money(vat)}</b></div><div class="big"><span>Total</span><b>${money(total)}</b></div>
      ${saving > 0.004 ? `<div class="disc"><span>🎁 Estalvi per al client</span><b>${money(saving)}</b></div>` : ''}
      ${dep ? `<div><span>Paga i senyal</span><b>${money(dep)}</b></div><div><span>Resta</span><b>${money(total - dep)}</b></div>` : ''}`;
    $$('tr', tbody).forEach((tr, i) => { const l = lines[i]; $('.amt', tr).textContent = money((Number(l.quantity) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100)); });
  };
  const renderLines = () => {
    tbody.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><textarea data-k="description" rows="1" placeholder="Descripció">${esc(l.description)}</textarea></td>
      <td><input data-k="quantity" type="number" step="0.01" value="${esc(l.quantity)}" class="w70"></td><td><input data-k="price" type="number" step="0.01" value="${esc(l.price)}" class="w90"></td>
      <td><input data-k="discount" type="number" step="0.01" value="${esc(l.discount || '')}" class="w60"></td><td><input data-k="vat" type="number" step="0.01" value="${esc(l.vat)}" class="w60"></td>
      <td class="r amt"></td><td><button type="button" class="icon-btn" data-rm>🗑</button></td></tr>`).join('');
    calc();
  };
  tbody.addEventListener('input', e => { const tr = e.target.closest('tr'); const l = lines[tr.dataset.i]; const key = e.target.dataset.k; l[key] = key === 'description' ? e.target.value : e.target.value; calc(); });
  tbody.addEventListener('click', e => { if (e.target.matches('[data-rm]')) { lines.splice(e.target.closest('tr').dataset.i, 1); renderLines(); } });
  $('[data-addl]', el).onclick = () => { lines.push({ description: '', quantity: 1, price: 0, vat: inv.default_vat ?? 21 }); renderLines(); };
  $('[data-addp]', el).onchange = e => {
    const p = products.find(x => x.id === Number(e.target.value)); if (!p) return;
    lines = lines.filter(l => l.description || Number(l.price));
    lines.push({ product_id: p.id, description: p.name + (p.description ? `\n${p.description}` : ''), quantity: 1, price: p.price, vat: p.vat });
    e.target.value = ''; renderLines();
  };
  form.deposit_type.onchange = calc; form.deposit_value.oninput = calc; form.discount_type.onchange = calc; form.discount_value.oninput = calc;
  renderLines();

  const save = async () => {
    const data = readForm(form, [...headFields, ...introFields, ...discFields, ...tailFields]);
    data.client = getClient();
    if (!data.client) data.client_id = null;
    data.lines = lines.map(l => ({ ...l, quantity: Number(l.quantity), price: Number(l.price), vat: Number(l.vat), discount: Number(l.discount) || 0 }));
    if (!data.number) delete data.number;
    if (isNew) { const r = await api.post(k.api, data); toast('Creat'); return r.id; }
    await api.put(`${k.api}/${doc.id}`, data); toast('Desat'); return doc.id;
  };
  $('[data-save]', el).onclick = async () => { try { const id = await save(); if (isNew) go(`${k.path}/${id}`); else reload(); } catch (e) { errorToast(e); } };
  if (isNew) return;

  const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = async () => { try { await fn(); } catch (e) { errorToast(e); } }; };
  act('[data-preview]', async () => { await save(); previewDoc(kind, doc.id); });
  act('[data-copy]', () => copyText(doc.public_url));
  act('[data-send]', async () => {
    await save();
    const p = await api(`${k.api}/${doc.id}/email-preview`);
    if (!p.to) return toast('El client no té correu electrònic. Afegeix-lo i desa.', 'warn');
    const r = await modal({ title: `Envia ${k.one.toLowerCase()} a ${p.to}`, size: 'large', body: formHtml([{ name: 'subject', label: 'Assumpte', full: true }, { name: 'body', label: 'Missatge', type: 'textarea', rows: 12, full: true }], p) + '<p class="muted small">El correu inclou un enllaç on el client veu el document, el pot descarregar en PDF' + (kind === 'quote' ? ' i acceptar-lo o rebutjar-lo' : '') + '.</p>',
      actions: [{ label: 'Cancel·la', value: null }, { label: 'Envia', cls: 'primary', onClick: root => api.post(`${k.api}/${doc.id}/send`, readForm(root, [{ name: 'subject', label: 'Assumpte' }, { name: 'body', label: 'Missatge', type: 'textarea' }])) }] });
    if (r) { toast(r.status === 'enviat' ? 'Enviat!' : r.status === 'simulat' ? 'Desat a la safata (configura el correu per enviar de debò)' : 'Error: ' + r.error, r.status === 'error' ? 'bad' : r.status === 'simulat' ? 'warn' : 'ok'); reload(); }
  });
  act('[data-del]', async () => { if (await confirmDialog(`Esborrar ${k.one.toLowerCase()} ${doc.number}?${kind === 'invoice' ? ' Si ja està emesa, és millor anul·lar-la per mantenir la numeració correlativa.' : ''}`, 'Esborra')) { await api.del(`${k.api}/${doc.id}`); go(k.path); } });
  act('[data-accept]', async () => { await api.put(`${k.api}/${doc.id}`, { status: 'acceptat' }); reload(); });
  act('[data-reject]', async () => { await api.put(`${k.api}/${doc.id}`, { status: 'rebutjat' }); reload(); });
  act('[data-cancel]', async () => { if (await confirmDialog('Anul·lar aquesta factura?', 'Anul·la')) { await api.put(`${k.api}/${doc.id}`, { status: 'anul·lada' }); reload(); } });
  act('[data-to-contract]', async () => { await save(); const r = await api.post(`/api/quotes/${doc.id}/to-contract`); go(`#/contractes/${r.id}`); });
  act('[data-to-inv]', async () => { const r = await api.post(`/api/quotes/${doc.id}/to-invoice`); go(`#/factures/${r.id}`); });
  act('[data-to-act]', async () => {
    const res = await modal({ title: 'Crea l\'activitat', body: formHtml([{ name: 'date', label: 'Data', type: 'date', required: true }, { name: 'location', label: 'Lloc' }], { date: today() }),
      actions: [{ label: 'Cancel·la', value: null }, { label: 'Crea', cls: 'primary', onClick: root => readForm(root, [{ name: 'date', label: 'Data', required: true }, { name: 'location', label: 'Lloc' }]) }] });
    if (res) { const r = await api.post(`/api/quotes/${doc.id}/to-activity`, res); go(`#/activitats/${r.id}`); }
  });
  $$('[data-pay]', el).forEach(b => b.onclick = async () => {
    try { await api.post(`/api/invoices/${doc.id}/payment`, { what: b.dataset.pay, paid: b.dataset.v === '1', date: today() }); toast('Cobrament actualitzat'); reload(); } catch (e) { errorToast(e); }
  });
}

export function previewDoc(kind, id) {
  const url = `${K[kind].api}/${id}/html`;
  modal({ title: 'Previsualització', size: 'xl', body: `<iframe class="doc-frame" src="${url}"></iframe>`,
    actions: [{ label: 'Obre en una pestanya', onClick: () => { window.open(url, '_blank'); return false; } }, { label: '🖨 Imprimeix / Desa PDF', cls: 'primary', onClick: root => { $('iframe', root).contentWindow.print(); return false; } }] });
}
