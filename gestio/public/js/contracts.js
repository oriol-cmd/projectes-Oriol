// Contractes: llista, editor (text enriquit) i signatura en línia
import { api, state, esc, $, $$, fdate, toast, errorToast, modal, confirmDialog, formHtml, readForm, setTitle, go, reload, copyText, statusChip } from './core.js';
import { clientPickerHtml, bindClientPicker, bindTableClicks, bindFilter } from './admin.js';

export const CONTRACT_STATUS = {
  esborrany: { label: 'Esborrany', cls: 'gray' }, enviat: { label: 'Enviat', cls: 'blue' }, vist: { label: 'Vist pel client', cls: 'amber' },
  signat: { label: 'Signat', cls: 'green' }, rebutjat: { label: 'Rebutjat', cls: 'red' },
};

export const CONTRACT_VARS = [
  ['Avui', 'avui'], ['Empresa: nom', 'empresa.nom'], ['Empresa: NIF', 'empresa.nif'], ['Empresa: adreça', 'empresa.adreca'], ['Empresa: població', 'empresa.poblacio'], ['Empresa: correu', 'empresa.email'], ['Empresa: IBAN', 'empresa.iban'], ['Empresa: forma de pagament', 'empresa.pagament'],
  ['Client: nom', 'client.nom'], ['Client: NIF/CIF', 'client.nif'], ['Client: adreça', 'client.adreca'], ['Client: població', 'client.poblacio'], ['Client: correu', 'client.email'], ['Client: telèfon', 'client.telefon'],
  ['Activitat: títol', 'activitat.titol'], ['Activitat: data', 'activitat.data'], ['Activitat: horari', 'activitat.hora'], ['Activitat: lloc', 'activitat.lloc'],
  ['Pressupost: número', 'pressupost.numero'], ['Pressupost: total', 'pressupost.total'], ['Pressupost: paga i senyal', 'pressupost.senyal'], ['Pressupost: descompte', 'pressupost.descompte'], ['Pressupost: taula de conceptes', '{pressupost.taula}'],
];

// ---------- Editor de text enriquit (sense dependències) ----------
export function richEditorHtml(html, { vars = false, readonly = false } = {}) {
  const b = (cmd, arg, label, title) => `<button type="button" data-cmd="${cmd}" ${arg ? `data-arg="${arg}"` : ''} title="${title || label}">${label}</button>`;
  return `<div class="rte ${readonly ? 'ro' : ''}">${readonly ? '' : `<div class="rte-bar">
    ${b('formatBlock', 'h2', 'Títol', 'Títol de secció')}${b('formatBlock', 'h3', 'Subtítol', 'Subtítol / clàusula')}${b('formatBlock', 'p', '¶', 'Paràgraf normal')}
    <span class="sep"></span>${b('bold', '', '<b>N</b>', 'Negreta')}${b('italic', '', '<i>C</i>', 'Cursiva')}${b('underline', '', '<u>S</u>', 'Subratllat')}
    <span class="sep"></span>${b('insertUnorderedList', '', '• Llista', 'Llista de punts')}${b('insertOrderedList', '', '1. Llista', 'Llista numerada')}
    <span class="sep"></span>${b('justifyLeft', '', '⯇', 'Alinea a l\'esquerra')}${b('justifyCenter', '', '≡', 'Centra')}${b('justifyFull', '', '☰', 'Justifica')}
    <span class="sep"></span>${b('undo', '', '↶', 'Desfés')}${b('redo', '', '↷', 'Refés')}${b('removeFormat', '', '⌫ format', 'Treu el format')}
    ${vars ? `<select data-var><option value="">+ Insereix una dada…</option>${CONTRACT_VARS.map(([l, v]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : ''}
  </div>`}<div class="rte-body" ${readonly ? '' : 'contenteditable="true"'} spellcheck="true">${html || '<p></p>'}</div></div>`;
}
export function bindRichEditor(root, onChange) {
  const body = $('.rte-body', root);
  root.addEventListener('mousedown', e => { if (e.target.closest('[data-cmd]')) e.preventDefault(); });
  $$('[data-cmd]', root).forEach(btn => btn.onclick = () => {
    body.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.arg ? `<${btn.dataset.arg}>` : null);
    onChange && onChange();
  });
  const sel = $('[data-var]', root);
  if (sel) sel.onchange = () => {
    if (!sel.value) return;
    body.focus();
    document.execCommand('insertText', false, `{{${sel.value}}}`);
    sel.value = ''; onChange && onChange();
  };
  body.addEventListener('input', () => onChange && onChange());
  // enganxar com a text net per no portar estils estranys de Word
  body.addEventListener('paste', e => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
  return () => body.innerHTML;
}

// ---------- Llista ----------
export async function listPage(el) {
  setTitle('Contractes', '<button class="btn primary" data-new>+ Nou contracte</button>');
  $('[data-new]').onclick = () => newContract();
  const list = await api('/api/contracts');
  el.innerHTML = `<div class="card"><input class="search" data-filter placeholder="Cerca…">
    <div class="table-wrap"><table class="table click"><thead><tr><th>Núm.</th><th>Contracte</th><th>Client</th><th>Pressupost</th><th>Estat</th><th>Seguiment</th></tr></thead><tbody>
    ${list.map(k => `<tr data-href="#/contractes/${k.id}"><td><b>${esc(k.number)}</b></td><td>${esc(k.title)}</td><td>${esc(k.client_name || '—')}</td><td>${esc(k.quote_number || '')}</td><td>${statusChip(k.status, CONTRACT_STATUS)}</td>
      <td><small>${k.signed_at ? `✍️ Signat ${fdate(k.signed_at)}` : k.sent_at ? `✉️ Enviat ${fdate(k.sent_at)}${k.open_count ? ` · 👁 obert ${k.open_count} cops` : ' · encara no obert'}` : '<span class="muted">No enviat</span>'}</small></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Encara no hi ha contractes. Crea\'n un des d\'aquí o des d\'un pressupost («Més > Crea el contracte»).</td></tr>'}
    </tbody></table></div></div>`;
  bindTableClicks(el); bindFilter(el);
}

async function newContract() {
  const quotes = await api('/api/quotes');
  const body = document.createElement('div');
  body.innerHTML = `<p class="muted">El contracte s'omple sol a partir del <b>contracte tipus</b> (Configuració > Contracte tipus) amb les dades del client i, si en tries un, del pressupost. Després el podràs editar.</p>
    ${formHtml([{ name: 'quote_id', label: 'A partir del pressupost (opcional)', type: 'select', full: true, empty: '— Sense pressupost —', options: quotes.map(q => ({ value: q.id, label: `${q.number} · ${q.client_name || 'sense client'} · ${q.title || ''}` })) }])}
    <h4>Client</h4><p class="muted small">Si tries un pressupost, s'agafa el seu client i no cal omplir això.</p>${clientPickerHtml(null)}`;
  const r = await modal({ title: 'Nou contracte', size: 'large', body, onOpen: root => { body._getClient = bindClientPicker(root); },
    actions: [{ label: 'Cancel·la', value: null }, { label: 'Crea el contracte', cls: 'primary', onClick: root => {
      const quote_id = Number($('[name=quote_id]', root).value) || null;
      const client = body._getClient();
      if (!quote_id && !client) throw new Error('Tria un pressupost o omple les dades del client');
      return api.post('/api/contracts', { quote_id, client: quote_id ? undefined : client });
    } }] });
  if (r) go(`#/contractes/${r.id}`);
}

// ---------- Editor ----------
export async function editor(el, idParam) {
  if (idParam === 'nou') { await newContract(); return go('#/contractes'); }
  const k = await api(`/api/contracts/${idParam}`);
  const signed = k.status === 'signat';
  setTitle(`Contracte ${k.number}`, `<button class="btn" data-preview>👁 Previsualitza / PDF</button>${signed ? '' : '<button class="btn primary" data-send>✉️ Envia per signar</button>'}
    <div class="dropdown"><button class="btn">Més ▾</button><div class="menu">
      <button data-copy>🔗 Copia l'enllaç de signatura</button>
      ${signed ? '' : '<button data-regen>♻️ Torna a omplir des del contracte tipus</button><button data-mark>✍️ Marca com a signat (en paper)</button>'}
      <button data-del class="danger-t">🗑 Esborra</button></div></div>`);
  el.innerHTML = `<div class="cols">
    <section class="card wide">
      <div class="row gap wrap">${statusChip(k.status, CONTRACT_STATUS)}
        ${k.client ? `<a class="chip" href="#/clients/${k.client.id}">👤 ${esc(k.client.name)}</a>` : '<span class="chip amber">Sense client</span>'}
        ${k.quote ? `<a class="chip blue" href="#/pressupostos/${k.quote.id}">📝 ${esc(k.quote.number)}</a>` : ''}
        ${k.activity ? `<a class="chip" href="#/activitats/${k.activity.id}">📅 ${esc(k.activity.title)} · ${fdate(k.activity.date)}</a>` : ''}</div>
      ${signed ? '<div class="alert info" style="margin-top:12px">Aquest contracte ja està signat i no es pot modificar.</div>' : ''}
      ${formHtml([{ name: 'title', label: 'Títol del contracte', full: true }], k)}
      <label class="field-l">Text del contracte</label>
      ${richEditorHtml(k.body, { vars: !signed, readonly: signed })}
      ${signed ? '' : '<p class="muted small">Les dades entre {{ }} s\'omplen quan tornes a omplir des del contracte tipus. El text el pots canviar lliurement: només afecta aquest contracte.</p><div class="row end"><button class="btn primary" data-save>Desa</button></div>'}
    </section>
    <section class="card"><h3>Seguiment</h3>
      <dl class="dl"><dt>Enviat</dt><dd>${k.sent_at ? fdate(k.sent_at) : '—'}</dd><dt>Obert</dt><dd>${k.open_count ? `${k.open_count} cops · primer ${fdate(k.first_opened_at)}` : 'Encara no'}</dd>
      ${signed ? `<dt>Signat</dt><dd>${fdate(k.signed_at)}<br>${esc(k.signer_name || '')}${k.signer_nif ? ' · ' + esc(k.signer_nif) : ''}${k.signer_ip ? `<br><small class="muted">IP ${esc(k.signer_ip)}</small>` : ''}</dd>` : ''}</dl>
      ${k.signature ? `<img src="${esc(k.signature)}" alt="signatura" class="sig-prev">` : ''}
      <p class="muted small">El client rep un enllaç on llegeix el contracte i el signa amb el dit o el ratolí. Es desa el nom, el NIF, la data, l'hora i l'IP de la signatura.</p>
      <h4>Correus</h4><ul class="list">${k.emails.map(e => `<li><div>${esc(e.subject)}<small>${fdate(e.created_at)} · ${esc(e.to_addr || '')}${e.automation_id ? ' · 🤖 automàtic' : ''}</small></div><div class="r"><span class="chip ${e.status === 'enviat' ? 'green' : e.status === 'error' ? 'red' : 'gray'}">${esc(e.status)}</span></div></li>`).join('') || '<li class="muted">Cap correu enviat.</li>'}</ul>
      <h4>Historial</h4><ul class="timeline">${k.timeline.map(t => `<li><small>${fdate(t.created_at)}</small>${esc(t.message)}</li>`).join('')}</ul></section></div>`;
  const getBody = signed ? null : bindRichEditor($('.rte', el));
  const save = async () => { if (signed) return; await api.put(`/api/contracts/${k.id}`, { title: $('[name=title]', el).value.trim(), body: getBody() }); };
  const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = async () => { try { await fn(); } catch (e) { errorToast(e); } }; };
  act('[data-save]', async () => { await save(); toast('Contracte desat'); });
  act('[data-preview]', async () => {
    await save();
    const url = `/api/contracts/${k.id}/html`;
    modal({ title: 'Previsualització', size: 'xl', body: `<iframe class="doc-frame" src="${url}"></iframe>`,
      actions: [{ label: 'Obre en una pestanya', onClick: () => { window.open(url, '_blank'); return false; } }, { label: '🖨 Imprimeix / Desa PDF', cls: 'primary', onClick: root => { $('iframe', root).contentWindow.print(); return false; } }] });
  });
  act('[data-copy]', () => copyText(k.public_url));
  act('[data-send]', async () => {
    await save();
    const p = await api(`/api/contracts/${k.id}/email-preview`);
    if (!p.to) return toast('El client no té correu electrònic. Afegeix-lo a la seva fitxa.', 'warn');
    const F = [{ name: 'subject', label: 'Assumpte', full: true }, { name: 'body', label: 'Missatge', type: 'textarea', rows: 10, full: true }];
    const r = await modal({ title: `Envia el contracte a ${p.to}`, size: 'large', body: formHtml(F, p) + '<p class="muted small">El correu porta un enllaç on el client llegeix i signa el contracte en línia.</p>',
      actions: [{ label: 'Cancel·la', value: null }, { label: 'Envia', cls: 'primary', onClick: root => api.post(`/api/contracts/${k.id}/send`, readForm(root, F)) }] });
    if (r) { toast(r.status === 'enviat' ? 'Enviat!' : r.status === 'simulat' ? 'Desat a la safata (configura el correu per enviar de debò)' : 'Error: ' + r.error, r.status === 'error' ? 'bad' : r.status === 'simulat' ? 'warn' : 'ok'); reload(); }
  });
  act('[data-regen]', async () => {
    if (!(await confirmDialog('Es substituirà el text actual pel contracte tipus omplert amb les dades del client i del pressupost. Vols continuar?', 'Torna a omplir', false))) return;
    await api.post(`/api/contracts/${k.id}/regenerate`); toast('Contracte omplert de nou'); reload();
  });
  act('[data-mark]', async () => { if (await confirmDialog('Marcar el contracte com a signat (per exemple, si l\'ha signat en paper)?', 'Marca com a signat', false)) { await save(); await api.put(`/api/contracts/${k.id}`, { status: 'signat' }); reload(); } });
  act('[data-del]', async () => { if (await confirmDialog(`Esborrar el contracte ${k.number}?`, 'Esborra')) { await api.del(`/api/contracts/${k.id}`); go('#/contractes'); } });
}

// ---------- Configuració: contracte tipus ----------
export async function templateTab(body, s) {
  body.innerHTML = `<p>Aquest és el <b>contracte tipus</b>: cada contracte nou s'omple sol amb aquest text i les dades del client, de l'activitat i del pressupost. Després cada contracte es pot editar per separat.</p>
    <p class="muted small">⚖️ És un model orientatiu. Fes-lo revisar per un assessor abans de fer-lo servir.</p>
    ${formHtml([{ name: 'title', label: 'Títol per defecte', full: true }], s.contract)}
    <div class="tpl-ed"><div>${richEditorHtml(s.contract.body, { vars: true })}</div><iframe class="doc-frame" data-prev></iframe></div>
    <div class="row end"><button class="btn ghost" data-reset>Restaura el model original</button><button class="btn primary" data-save>Desa</button></div>`;
  const frame = $('[data-prev]', body);
  let t;
  const preview = () => { clearTimeout(t); t = setTimeout(async () => {
    const r = await fetch('/api/contract-template-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: getBody(), title: $('[name=title]', body).value }) });
    frame.srcdoc = await r.text();
  }, 500); };
  const getBody = bindRichEditor($('.rte', body), preview);
  preview();
  $('[data-save]', body).onclick = async () => { try { await api.put('/api/settings', { contract: { title: $('[name=title]', body).value.trim(), body: getBody() } }); toast('Contracte tipus desat'); } catch (e) { errorToast(e); } };
  $('[data-reset]', body).onclick = async () => {
    if (!(await confirmDialog('Vols tornar al model de contracte original? Perdràs els canvis que hi hagis fet.', 'Restaura', false))) return;
    const r = await api('/api/settings/default-contract');
    $('.rte-body', body).innerHTML = r.body; preview();
  };
}
