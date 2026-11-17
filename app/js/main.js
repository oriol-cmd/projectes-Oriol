/* Xiu-xiu · Esdeveniments generals i arrencada. */
'use strict';

// ---------------------------------------------------------------------------
// Esdeveniments
// ---------------------------------------------------------------------------
$('#btn-record').onclick = () => {
  pendingContinue = null;
  // Videotrucades: abans de gravar, cal avisar els participants.
  if (CAN_CAPTURE_CALL && settings.source === 'call' && !missingSetup().length) {
    fillMicSelects();
    $('#consent-ok').checked = false;
    $('#btn-consent-start').disabled = true;
    openSheet('#consent-sheet');
    return;
  }
  startRecording();
};
$('#consent-ok').onchange = (e) => { $('#btn-consent-start').disabled = !e.target.checked; };
$('#btn-consent-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#consent-msg').textContent.trim()); toast('Missatge copiat: enganxa\'l al xat de la videotrucada'); }
  catch { toast("No s'ha pogut copiar. Selecciona el text i copia'l a mà."); }
};
let pendingContinue = null;
$('#btn-consent-start').onclick = () => { closeSheets(); const c = pendingContinue; pendingContinue = null; startRecording(c); };
// Continua gravant una reunió o revisió ja feta (un altre moment o un altre dia).
$('#btn-continue').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (!m || rec.meeting) return;
  if (pipelines.has(m.id) || m.status === 'processing') { toast("Espera que s'acabi de processar."); return; }
  if (!confirm("Continuar gravant aquí? El que diguis s'afegirà a aquesta reunió i se'n refarà el resum amb tot.")) return;
  if (m.source === 'call' && CAN_CAPTURE_CALL) {
    pendingContinue = m;
    $('#consent-ok').checked = false;
    $('#btn-consent-start').disabled = true;
    openSheet('#consent-sheet');
    return;
  }
  startRecording(m);
};
$('#btn-pause').onclick = togglePause;
$('#btn-stop').onclick = () => { if (confirm('Acabar la reunió i fer-ne el resum?')) stopRecording(); };
$('#btn-mark').onclick = addMark;
// Fotos: durant la reunió (amb el minut) o després (des del resultat).
let photoTarget = null;
$('#btn-photo').onclick = () => { photoTarget = 'rec'; $('#photo-input').click(); };
$('#btn-photo-after').onclick = () => { photoTarget = 'result'; $('#photo-input').click(); };
$('#photo-input').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (photoTarget === 'rec' && rec.meeting) {
    const n = await addPhotos(rec.meeting, files, Math.round(rec.activeMs));
    if (n) toast(`📷 ${n} foto${n > 1 ? 's' : ''} afegida${n > 1 ? 's' : ''} a la reunió`);
    $('#photo-count').textContent = rec.meeting.photos.length ? `${rec.meeting.photos.length} 📷` : '';
  } else if (photoTarget === 'result' && viewingId) {
    const m = await getMeeting(viewingId);
    const n = await addPhotos(m, files, null);
    await renderPhotos(m, $('#result-photos'));
    $('#result-photos-wrap').hidden = !(m.photos && m.photos.length);
    if (n) toast('Foto afegida. A «⋯» toca «Refés el resum» perquè la tingui en compte.', 5000);
  }
};
$('#btn-intro').onclick = () => {
  if (!rec.meeting || rec.paused) return;
  rec.segStartMs = rec.activeMs;
  rotateSegment(); // tanca el tram de presentacions: serà la mostra de veus
  $('#btn-intro').hidden = true;
  toast('Presentacions desades. Ja reconeixeré qui parla.');
};
$('#btn-history').onclick = () => showView('history');
$('#btn-settings').onclick = () => showView('settings');
$('#btn-tab-home').onclick = () => showView('home');
$('#btn-tab-ask').onclick = () => showView('ask');
document.querySelector('.brand').onclick = () => showView('home');
$('#btn-new').onclick = () => showView('home');
// Enllaços interns: qualsevol element amb data-goto porta a una pantalla.
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) showView(g.dataset.goto);
});

// ---------------------------------------------------------------------------
// Arrencada de l'app
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  // Quan arriba una versió nova, recarrega (si no s'està gravant).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || rec.meeting || pipelines.size) return;
    reloaded = true;
    location.reload();
  });
}
$('#app-version').textContent = `Versió ${APP_VERSION}`;
resumeUnfinished().catch(() => {});
setTimeout(() => retentionCleanup().catch(() => {}), 5000);
showView('home');
startGoogleSync();
{
  const qs = new URLSearchParams(location.search);
  const quick = qs.has('rec');
  if (quick) { qs.delete('rec'); history.replaceState(null, '', location.pathname + (qs.toString() ? `?${qs}` : '') + location.hash); }
  if (quick || settings.quickStart) setTimeout(offerQuickRec, 400);
}
