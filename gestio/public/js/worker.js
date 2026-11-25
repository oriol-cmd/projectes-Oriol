// Portal del treballador (accés limitat)
import { api, esc, $, $$, fdate, today, toast, errorToast, statusChip, ASSIGN_STATUS, fileSize, weeklyEditorHtml, readWeekly, setTitle, reload, formHtml, readForm } from './core.js';
import { unavailabilityHtml, bindUnavailability } from './admin.js';
import { passwordForm } from './config.js';

export async function jobs(el) {
  setTitle('Les meves feines');
  const list = await api('/api/my/assignments');
  const upcoming = list.filter(j => j.date >= today()).reverse();
  const past = list.filter(j => j.date < today());
  const card = j => `<div class="card job ${j.status}">
    <div class="row between"><b>${fdate(j.date, 'long')}</b>${statusChip(j.status, ASSIGN_STATUS)}</div>
    <h3>${esc(j.title)}</h3>
    <dl class="dl"><dt>Horari</dt><dd>${esc(j.start_time || '—')}${j.end_time ? ' – ' + esc(j.end_time) : ''}</dd>
    <dt>Lloc</dt><dd>${esc(j.location || '—')} ${j.location ? `<a target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.location)}">mapa ↗</a>` : ''}</dd>
    <dt>Tasca</dt><dd>${esc(j.product_name || '')}${j.role ? ` · ${esc(j.role)}` : ''}</dd>
    ${j.worker_notes ? `<dt>Notes</dt><dd class="pre">${esc(j.worker_notes)}</dd>` : ''}
    ${j.colleagues.length ? `<dt>Equip</dt><dd>${j.colleagues.map(c => `${esc(c.first_name)} ${esc(c.last_name || '')}`).join(', ')}</dd>` : ''}</dl>
    ${j.whatsapp_link ? `<a class="btn wa" href="${esc(j.whatsapp_link)}" target="_blank">👥 Entra al grup de WhatsApp</a>` : ''}
    ${j.date >= today() ? `<div class="row gap wrap respond"><input data-note="${j.id}" placeholder="Comentari (opcional)" class="grow" value="${esc(j.response_note || '')}">
      <button class="btn ${j.status === 'confirmat' ? '' : 'primary'}" data-r="${j.id}" data-s="confirmat">✓ Confirmo</button><button class="btn ghost danger-t" data-r="${j.id}" data-s="rebutjat">No hi puc anar</button></div>` : ''}</div>`;
  el.innerHTML = `${upcoming.filter(j => !['confirmat', 'rebutjat'].includes(j.status)).length ? '<div class="alert">Tens feines pendents de confirmar 👇</div>' : ''}
    <div class="jobs">${upcoming.map(card).join('') || '<div class="card empty">No tens cap feina programada.</div>'}</div>
    ${past.length ? `<details><summary>Feines anteriors (${past.length})</summary><div class="jobs">${past.map(card).join('')}</div></details>` : ''}`;
  $$('[data-r]', el).forEach(b => b.onclick = async () => {
    try { await api.post(`/api/my/assignments/${b.dataset.r}/respond`, { status: b.dataset.s, note: $(`[data-note="${b.dataset.r}"]`, el).value }); toast(b.dataset.s === 'confirmat' ? 'Confirmat! Gràcies' : 'Resposta enviada'); reload(); } catch (e) { errorToast(e); }
  });
}

export async function availability(el) {
  setTitle('La meva disponibilitat');
  const d = await api('/api/my/availability');
  el.innerHTML = `<div class="card"><h3>Dies i hores que normalment pots treballar</h3>${weeklyEditorHtml(d.weekly)}<div class="row end"><button class="btn primary" data-save>Desa</button></div></div>
    <div class="card"><h3>Dates concretes</h3><p class="muted">Marca els dies que no podràs treballar (vacances, exàmens…) o dies extra que sí que pots.</p>${unavailabilityHtml(d.unavailability)}</div>`;
  $('[data-save]', el).onclick = async () => { await api.put('/api/my/availability', { weekly: readWeekly(el) }); toast('Disponibilitat desada'); };
  bindUnavailability(el, '/api/my/unavailability');
}

export async function documents(el) {
  setTitle('Els meus documents');
  const list = await api('/api/my/documents');
  el.innerHTML = `<div class="card"><label class="btn primary"><input type="file" multiple hidden data-up> 📎 Puja un document</label>
    <ul class="list">${list.map(d => `<li><a href="/api/documents/${d.id}/file" target="_blank"><div>📄 ${esc(d.name)}<small>${esc(d.category || '')} · ${fileSize(d.size)} · ${fdate(d.created_at)}</small></div></a>${d.mine ? `<button class="btn small ghost" data-del="${d.id}">🗑</button>` : ''}</li>`).join('') || '<li class="muted">No hi ha documents.</li>'}</ul></div>`;
  $('[data-up]', el).onchange = async e => {
    const fd = new FormData(); for (const f of e.target.files) fd.append('files', f);
    try { await api('/api/documents', { body: fd }); toast('Document pujat'); reload(); } catch (err) { errorToast(err); }
  };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { await api.del(`/api/documents/${b.dataset.del}`); reload(); });
}

export async function profile(el) {
  setTitle('El meu perfil');
  const p = await api('/api/my/profile');
  const F = [{ name: 'email', label: 'Correu electrònic', type: 'email' }, { name: 'phone', label: 'Telèfon', type: 'tel' }];
  el.innerHTML = `<div class="card"><h3>${esc(p.first_name)} ${esc(p.last_name || '')}</h3><p class="muted">DNI: ${esc(p.dni || '—')}</p><form data-f>${formHtml(F, p)}<div class="row end"><button class="btn primary">Desa</button></div></form></div><div class="card" data-pw></div>`;
  $('[data-f]', el).onsubmit = async e => { e.preventDefault(); try { await api.put('/api/my/profile', readForm(e.target, F)); toast('Desat'); } catch (err) { errorToast(err); } };
  passwordForm($('[data-pw]', el));
}
