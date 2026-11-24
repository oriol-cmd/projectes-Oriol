/* Xiu-xiu · Ajustos: configuració, plantilles, còpia de seguretat, actualitzacions i compte de Google. */
'use strict';

// ---------------------------------------------------------------------------
// Configuració (UI)
// ---------------------------------------------------------------------------
function fillSettings() {
  $('#set-email').value = settings.email;
  $('#set-script-url').value = settings.scriptUrl;
  $('#set-script-secret').value = settings.scriptSecret;
  $('#set-engine').value = settings.engine;
  $('#set-gemini-key').value = settings.geminiKey;
  $('#set-lang').value = settings.lang;
  $('#set-extra').value = settings.extra;
  $('#set-vocab').value = settings.vocab || '';
  $('#set-boost').checked = settings.boost !== false;
  $('#set-precise').checked = settings.precise === true;
  $('#set-short-imports').checked = settings.shortImports !== false;
  $('#set-quick').checked = !!settings.quickStart;
  $('#set-verify').checked = settings.verify !== false;
  $('#set-live').checked = settings.liveText !== false;
  fillMicSelects();
  $('#set-detail').value = settings.detail || 'full';
  $('#set-segment').value = settings.liveSec;
  $('#set-audio-days').value = String(settings.audioDays ?? 7);
  $('#set-meeting-days').value = String(settings.meetingDays || 0);
  $('#set-speakers').checked = settings.speakers !== false;
  $('#set-summary-lang').value = settings.summaryLang || 'ca';
  $('#backup-info').textContent = settings.lastBackup ? `Última còpia: ${fmtDate(settings.lastBackup)}` : 'Encara no has fet cap còpia.';
  syncEngineFields();
  renderTplList();
  renderStplList();
  $('#settings-msg').textContent = '';
}
function readSettingsForm() {
  return {
    email: $('#set-email').value.trim() || DEFAULTS.email,
    scriptUrl: $('#set-script-url').value.trim(),
    scriptSecret: $('#set-script-secret').value.trim(),
    engine: $('#set-engine').value,
    geminiKey: $('#set-gemini-key').value.trim(),
    lang: $('#set-lang').value,
    extra: $('#set-extra').value.trim(),
    vocab: $('#set-vocab').value.trim(),
    boost: $('#set-boost').checked,
    precise: $('#set-precise').checked,
    shortImports: $('#set-short-imports').checked,
    quickStart: $('#set-quick').checked,
    verify: $('#set-verify').checked,
    liveText: $('#set-live').checked,
    detail: $('#set-detail').value,
    liveSec: Math.min(300, Math.max(10, Number($('#set-segment').value) || DEFAULTS.liveSec)),
    v: 3,
    keepAudio: false,
    audioDays: Number($('#set-audio-days').value),
    meetingDays: Number($('#set-meeting-days').value),
    speakers: $('#set-speakers').checked,
    summaryLang: $('#set-summary-lang').value,
  };
}
function syncEngineFields() {
  const eng = $('#set-engine').value;
  document.querySelectorAll('[data-engine]').forEach((el) => { el.hidden = el.dataset.engine !== eng; });
}

// Comprova una clau sense gastar quota (llista de models).
async function checkGeminiKey(key) {
  let res;
  try {
    res = await fetchWithTimeout(`${GEMINI_URL.replace(/models\/$/, 'models')}?pageSize=1`, { headers: { 'x-goog-api-key': key } }, 20000);
  } catch { return { ok: false, msg: 'Sense connexió. Torna-ho a provar.' }; }
  if (res.ok) return { ok: true };
  const t = await res.text();
  if (/API_KEY_INVALID|API key not valid/i.test(t)) return { ok: false, msg: 'Aquesta clau no és vàlida. Torna a copiar-la de Google.' };
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(t)) return { ok: false, msg: "La clau existeix però Google encara l'està activant. Espera un minut i torna a tocar «Enganxa la clau»." };
  if (/location is not supported|User location/i.test(t)) return { ok: false, msg: 'Google diu que Gemini no està disponible des d\'on et connectes. Prova sense VPN.' };
  if (res.status === 403) return { ok: false, msg: "Google no deixa fer servir aquesta clau. Si és un compte de la feina, prova de crear-la amb un Gmail personal." };
  return { ok: false, msg: `Google ha respost ${res.status}. Torna-ho a provar d'aquí a un moment.` };
}

// Claus de Google: format clàssic (AIza…) i format nou (AQ.…). La validesa real la decideix Google.
const KEY_RE = /^(AIza[\w-]{20,}|AQ\.[\w.-]{20,}|[\w.-]{30,})$/;

// Assistent de la pantalla de benvinguda: enganxa, comprova i desa la clau.
async function useWelcomeKey(raw) {
  const msg = $('#welcome-msg');
  const key = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!KEY_RE.test(key)) {
    msg.textContent = key
      ? "Això no sembla una clau de Google (ha de començar per AIza o AQ. i ser llarga). Torna a la pàgina de Google i toca «Copy»."
      : 'El porta-retalls és buit: primer copia la clau a la pàgina de Google (pas 2).';
    return;
  }
  msg.textContent = 'Comprovant la clau…';
  const r = await checkGeminiKey(key);
  if (!r.ok) { msg.textContent = `✗ ${r.msg}`; return; }
  saveSettings({ geminiKey: key });
  resetQuota();
  msg.textContent = '';
  $('#welcome-key').value = '';
  try { localStorage.removeItem('kwStep'); } catch { /* res */ }
  toast('✓ Llest! Ja pots començar a gravar.', 4000);
  refreshHomeBanners();
}
$('#btn-paste-key').onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    $('#welcome-key').value = t.trim();
    useWelcomeKey(t);
  } catch {
    $('#welcome-msg').textContent = 'No puc llegir el porta-retalls: mantén premut el camp de sota i tria «Enganxa».';
    $('#welcome-key').focus();
  }
};
$('#welcome-key').oninput = (e) => { if (KEY_RE.test(e.target.value.trim())) useWelcomeKey(e.target.value); };

// Assistent pas a pas per crear la clau de Google.
function kwGo(step) {
  const kw = $('#kw');
  if (!kw) return;
  kw.dataset.step = String(step);
  kw.querySelectorAll('.kw-step').forEach((el) => { el.hidden = el.dataset.kw !== String(step); });
  try { localStorage.setItem('kwStep', String(step)); } catch { /* res */ }
  if (step === 3) $('#welcome-msg').textContent = '';
  kw.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
document.querySelectorAll('[data-kw-go]').forEach((b) => { b.onclick = () => kwGo(Number(b.dataset.kwGo)); });
// En obrir Google, passa sol al pas següent (quan tornis, ja hi seràs).
$('#kw-open').addEventListener('click', () => setTimeout(() => kwGo(2), 600));
try { const st = Number(localStorage.getItem('kwStep')); if (st >= 1 && st <= 3) kwGo(st); } catch { /* res */ }
// A l'ordinador, en tornar de Google prova d'agafar la clau copiada directament.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || settings.geminiKey || IS_IOS || !$('#kw') || $('#setup-banner').hidden) return;
  if (Number($('#kw').dataset.step) < 2) return;
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (KEY_RE.test(t) && /^(AIza|AQ\.)/.test(t)) { kwGo(3); $('#welcome-key').value = t; useWelcomeKey(t); }
  } catch { /* sense permís: l'usuari tocarà «Enganxa» */ }
});

async function testKeys() {
  resetQuota();
  saveSettings(readSettingsForm());
  const msg = $('#settings-msg');
  msg.textContent = 'Comprovant…';
  try {
    const t = await gemini([{ text: 'Respon només: OK' }], { maxTokens: 2048, task: 'transcribe' });
    msg.textContent = t ? '✓ La clau de Gemini funciona' : '✗ Gemini no ha respost';
  } catch (e) {
    msg.textContent = `✗ ${e.message}`;
  }
}

async function testEmail() {
  saveSettings(readSettingsForm());
  const msg = $('#settings-msg');
  if (!settings.email) { msg.textContent = 'Escriu primer el teu correu.'; return; }
  msg.textContent = 'Enviant correu de prova…';
  try {
    const r = await sendEmail({
      subject: 'Prova: Xiu-xiu',
      html: '<p>Si reps aquest correu, l\'enviament automàtic de resums funciona correctament. ✅</p>',
      text: "Si reps aquest correu, l'enviament automàtic de resums funciona correctament.",
    });
    msg.textContent = r.confirmed ? `✓ Correu enviat a ${settings.email}` : `✗ L'script de Google no respon. Comprova l'URL (ha d'acabar en /exec) i que l'accés sigui «Qualsevol».`;
  } catch (e) {
    msg.textContent = `✗ ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Còpia de seguretat (configuració + reunions + fotos) en un fitxer
// ---------------------------------------------------------------------------
function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'downloaded';
}
async function exportBackup() {
  const msg = $('#backup-msg');
  msg.textContent = 'Preparant la còpia…';
  const meetings = await db.all('meetings');
  const photos = {};
  for (const m of meetings) {
    for (const ph of m.photos || []) {
      const blob = await db.get('audio', ph.key);
      if (blob) photos[ph.key] = await blobToBase64(blob);
    }
  }
  const data = {
    app: 'xiu-xiu', format: 1, exportedAt: new Date().toISOString(), appVersion: APP_VERSION,
    settings, recentEmails: recentEmails(), meetings, photos,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `xiu-xiu-copia-${new Date().toISOString().slice(0, 10)}.json`;
  const r = await shareOrDownload(blob, name, 'Còpia de seguretat de Xiu-xiu');
  if (r === 'cancelled') { msg.textContent = 'Còpia cancel·lada.'; return; }
  saveSettings({ lastBackup: Date.now() });
  $('#backup-info').textContent = `Última còpia: ${fmtDate(settings.lastBackup)}`;
  msg.textContent = `✓ Còpia feta (${meetings.length} reunions). Guarda el fitxer en un lloc privat: inclou les teves claus.`;
}
async function importBackup(file) {
  const msg = $('#backup-msg');
  let data;
  try { data = JSON.parse(await file.text()); } catch { msg.textContent = '✗ Aquest fitxer no és una còpia de Xiu-xiu.'; return; }
  if (!data || data.app !== 'xiu-xiu' || !Array.isArray(data.meetings)) { msg.textContent = '✗ Aquest fitxer no és una còpia de Xiu-xiu.'; return; }
  if (!confirm(`Recuperar la còpia del ${fmtDate(data.exportedAt)}?\n\n${data.meetings.length} reunions. Les reunions que ja tens no s'esborren.`)) return;
  // La configuració personal (correu, script, clau, noms…) només es copia si aquest aparell no en té,
  // o si l'usuari ho demana: si la còpia és d'una altra persona, els resums anirien al seu correu.
  const fresh = !settings.geminiKey && !settings.scriptUrl;
  const takeConfig = data.settings && (fresh || confirm("La còpia també porta configuració: clau de Google, correu, script, noms habituals, plantilles…\n\nVols substituir la teva per la de la còpia?\n\nSi la còpia és d'una altra persona, toca «Cancel·la»."));
  let added = 0;
  for (const m of data.meetings) {
    if (await db.get('meetings', m.id)) continue;
    if (m.status === 'processing' || m.status === 'recording') { m.status = 'error'; m.error = "Recuperada d'una còpia: s'havia quedat a mitges"; }
    await db.put('meetings', m);
    added++;
  }
  const pdfKeys = new Set(data.meetings.flatMap((m) => (m.photos || []).filter((ph) => ph.pdf).map((ph) => ph.key)));
  for (const [key, b64] of Object.entries(data.photos || {})) await db.put('audio', base64ToBlob(b64, pdfKeys.has(key) ? 'application/pdf' : 'image/jpeg'), key);
  if (takeConfig) {
    const { lastBackup, ...rest } = data.settings;
    saveSettings({ ...rest, v: settings.v });
  }
  if (Array.isArray(data.recentEmails)) rememberEmails(data.recentEmails);
  meetingCache.clear();
  fillSettings();
  msg.textContent = `✓ Recuperat: ${added} reunions noves${takeConfig ? ' i la configuració' : ''}.`;
  toast(`✓ Còpia recuperada: ${added} reunions`);
  refreshHomeBanners();
}
$('#btn-backup').onclick = () => exportBackup().catch((e) => { $('#backup-msg').textContent = `✗ ${e.message}`; });
$('#btn-restore').onclick = () => $('#restore-input').click();
$('#btn-welcome-restore').onclick = () => $('#restore-input').click();
$('#restore-input').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
$('#btn-backup-now').onclick = () => { showView('settings'); setTimeout(() => $('#backup-section').scrollIntoView({ behavior: 'smooth' }), 100); };

// ---------------------------------------------------------------------------
// Plantilles de resum de l'usuari (estructura pròpia)
// ---------------------------------------------------------------------------
let stplEdit = null;
// Biblioteca de plantilles en català (s'afegeixen a «Les meves plantilles» amb un toc).
const BUILTIN_TEMPLATES = [
  { name: 'Junta de veïns', structure: "Assistents i propietats representades\nOrdre del dia\nDesenvolupament de cada punt\nAcords i votacions (a favor, en contra, abstencions)\nDerrames o quotes aprovades\nTasques (administrador, president, veïns)\nPrecs i preguntes" },
  { name: 'Consell escolar / AFA', structure: "Assistents\nOrdre del dia\nInformacions de la direcció\nTemes tractats\nAcords\nTasques\nPrecs i preguntes\nPropera reunió" },
  { name: 'Patronat o junta directiva', structure: "Assistents i quòrum\nOrdre del dia\nAprovació de l'acta anterior\nDesenvolupament de cada punt\nAcords (numerats, amb el resultat de la votació)\nTasques\nPropera reunió" },
  { name: "Assemblea d'entitat", structure: "Assistents i quòrum\nOrdre del dia\nInforme de la junta\nComptes i pressupost\nPropostes i votacions\nAcords\nPrecs i preguntes" },
  { name: "Consell d'administració", structure: "Consellers assistents\nOrdre del dia\nSituació econòmica i resultats (xifres dites)\nDecisions estratègiques\nAcords\nRiscos i temes oberts\nTasques\nPropera sessió" },
  { name: 'Entrevista de feina', structure: "Candidat/a i lloc\nTrajectòria i experiència explicada\nRespostes clau a les preguntes\nPunts forts (només els que s'han vist a l'entrevista)\nDubtes o aspectes a confirmar\nCondicions parlades (sou, disponibilitat)\nPropers passos" },
  { name: 'Visita a client', structure: "Client i assistents\nNecessitats i problemes del client\nPropostes presentades\nPreus, terminis i condicions parlades\nObjeccions\nAcords\nPropers passos (qui fa què i quan)" },
  { name: 'Pluja d\'idees', structure: "Repte o pregunta de partida\nIdees proposades (agrupades per temes, amb qui les proposa)\nIdees preferides i per què\nDubtes i riscos\nPropers passos" },
  { name: 'Seguiment setmanal d\'equip', structure: "Assistents\nEstat de cada persona o àrea (fet, en curs, bloquejos)\nPrioritats de la setmana\nDecisions\nTasques" },
  { name: 'Formació o classe', structure: "Tema i ponent\nConceptes explicats (ordenats i didàctics)\nExemples i casos\nPreguntes i respostes\nIdees clau per recordar\nDeures o propers passos" },
  { name: 'Retrospectiva de projecte', structure: "Què ha anat bé\nQuè ha anat malament\nQuè hem après\nAccions de millora\nTasques" },
  { name: 'Visita mèdica o professional', structure: "Motiu de la consulta\nExplicacions del professional\nProves o tractaments proposats\nIndicacions i pautes (dosi, horaris)\nDubtes a consultar\nPropera visita" },
];
function renderGallery() {
  const box = $('#gallery-list');
  box.textContent = '';
  const have = new Set((settings.summaryTemplates || []).map((t) => t.name.toLowerCase()));
  for (const t of BUILTIN_TEMPLATES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sheet-row tpl-row';
    const added = have.has(t.name.toLowerCase());
    b.innerHTML = `<span class="tpl-sw xx">${svgIcon(added ? 'check' : 'doc')}</span><span><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.structure.split('\n').slice(0, 4).join(' · '))}…</small></span>`;
    b.disabled = added;
    b.onclick = () => {
      const list = [...(settings.summaryTemplates || []), { id: uid(), name: t.name, structure: t.structure }];
      if (saveSettings({ summaryTemplates: list }) === false) return;
      renderGallery(); renderStplList(); renderTypeChips(true);
      toast(`✓ «${t.name}» afegida als tipus de reunió`);
    };
    box.appendChild(b);
  }
}
function openGallery() { renderGallery(); openSheet('#gallery-sheet'); }
const STPL_EXAMPLE = "Assistents\nOrdre del dia (els punts tal com s'han tractat)\nAcords (numerats)\nVotacions (resultat de cada votació, si n'hi ha)\nTasques\nPropera reunió (data i temes)";
function renderStplList() {
  const box = $('#stpl-list');
  if (!box) return;
  box.textContent = '';
  const list = settings.summaryTemplates || [];
  if (!list.length) { box.innerHTML = '<p class="fineprint left">Encara no n\'has creat cap.</p>'; return; }
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sheet-row tpl-row';
    b.innerHTML = `<span class="tpl-sw xx">${svgIcon('doc')}</span><span><b>${escapeHtml(t.name)}</b><small>${escapeHtml((t.structure || '').split('\n').filter(Boolean).slice(0, 3).join(' · '))}…</small></span>`;
    b.onclick = () => openStpl(t.id);
    box.appendChild(b);
  }
}
function openStpl(id = null) {
  const found = (settings.summaryTemplates || []).find((t) => t.id === id);
  stplEdit = found ? { ...found } : { id: uid(), name: '', structure: '' };
  $('#stpl-title').textContent = found ? 'Edita la plantilla de resum' : 'Nova plantilla de resum';
  $('#stpl-name').value = stplEdit.name;
  $('#stpl-structure').value = stplEdit.structure;
  $('#btn-stpl-delete').hidden = !found;
  openSheet('#stpl-sheet');
}
$('#btn-stpl-new').onclick = () => openStpl();
$('#btn-gallery').onclick = openGallery;
$('#btn-stpl-example').onclick = () => { if (!$('#stpl-structure').value.trim()) $('#stpl-structure').value = STPL_EXAMPLE; if (!$('#stpl-name').value.trim()) $('#stpl-name').value = 'Acta de patronat'; };
$('#btn-stpl-save').onclick = () => {
  const name = $('#stpl-name').value.trim(), structure = $('#stpl-structure').value.trim();
  if (!name || !structure) { toast('Posa-hi un nom i els apartats'); return; }
  const list = (settings.summaryTemplates || []).filter((t) => t.id !== stplEdit.id);
  list.push({ id: stplEdit.id, name, structure });
  if (saveSettings({ summaryTemplates: list }) === false) return;
  closeSheets(); renderStplList(); renderTypeChips(true);
  toast(`Plantilla desada: la trobaràs a «Tipus de reunió»`);
};
$('#btn-stpl-delete').onclick = () => {
  if (!confirm(`Esborrar la plantilla «${stplEdit.name}»?`)) return;
  const patch = { summaryTemplates: (settings.summaryTemplates || []).filter((t) => t.id !== stplEdit.id) };
  if (settings.lastType === `tpl_${stplEdit.id}`) patch.lastType = 'general';
  saveSettings(patch);
  closeSheets(); renderStplList(); renderTypeChips(true);
};

// ---------------------------------------------------------------------------
// Plantilles de l'acta en PDF (logotip, color, organització, peu)
// ---------------------------------------------------------------------------
const TPL_COLORS = ['#13265c', '#1f4bd8', '#0e7490', '#0f766e', '#15803d', '#b45309', '#b91c1c', '#7c3aed', '#be185d', '#334155'];
let tplEdit = null; // plantilla que s'està editant
function renderTplList() {
  const box = $('#tpl-list');
  if (!box) return;
  box.textContent = '';
  const tpls = settings.pdfTemplates || [];
  if (!tpls.length) { box.innerHTML = '<p class="fineprint left">Encara no n\'has creat cap. De moment, les actes surten amb el disseny de Xiu-xiu.</p>'; return; }
  for (const t of tpls) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sheet-row tpl-row';
    b.innerHTML = `<span class="tpl-sw" style="background:${escapeHtml(t.color || '#1f4bd8')}">${t.logo ? `<img src="${t.logo}" alt="">` : ''}</span><span><b>${escapeHtml(t.name || 'Plantilla')}</b><small>${escapeHtml(t.org || '')}${settings.pdfDefault === t.id ? ' · per defecte' : ''}</small></span>`;
    b.onclick = () => openTplEditor(t.id);
    box.appendChild(b);
  }
}
function renderTplColors() {
  const box = $('#tpl-colors');
  box.textContent = '';
  for (const c of TPL_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tpl-color'; b.style.background = c;
    b.setAttribute('aria-label', c); b.setAttribute('aria-pressed', String(tplEdit.color === c));
    b.onclick = () => { tplEdit.color = c; renderTplColors(); };
    box.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color'; custom.className = 'tpl-color custom'; custom.value = tplEdit.color || '#1f4bd8';
  custom.title = 'Un altre color';
  custom.oninput = () => { tplEdit.color = custom.value; box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); };
  box.appendChild(custom);
}
function renderTplLogo() {
  const has = !!tplEdit.logo;
  $('#tpl-logo-prev').hidden = !has;
  if (has) $('#tpl-logo-prev').src = tplEdit.logo;
  $('#tpl-logo-empty').hidden = has;
  $('#btn-tpl-logo-clear').hidden = !has;
  $('#btn-tpl-logo').textContent = has ? 'Canvia la imatge' : 'Tria una imatge';
}
function openTplEditor(id = null) {
  const found = (settings.pdfTemplates || []).find((t) => t.id === id);
  tplEdit = found ? { ...found } : { id: uid(), name: '', org: '', color: '#13265c', logo: '', logoRatio: 1, footer: '' };
  $('#tpl-sheet-title').textContent = found ? 'Edita la plantilla' : 'Nova plantilla';
  $('#tpl-name').value = tplEdit.name;
  $('#tpl-org').value = tplEdit.org;
  $('#tpl-footer').value = tplEdit.footer;
  $('#tpl-default').checked = settings.pdfDefault === tplEdit.id || (!found && !(settings.pdfTemplates || []).length);
  $('#btn-tpl-delete').hidden = !found;
  renderTplColors();
  renderTplLogo();
  openSheet('#tpl-sheet');
}
// Redueix el logotip (PNG, conserva la transparència) perquè ocupi poc.
async function prepLogo(file) {
  let src;
  try { src = await createImageBitmap(file); } catch {
    src = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("No s'ha pogut llegir la imatge")); img.src = URL.createObjectURL(file); });
  }
  const scale = Math.min(1, 400 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale)); c.height = Math.max(1, Math.round(src.height * scale));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return { logo: c.toDataURL('image/png'), logoRatio: c.width / c.height };
}
function readTplForm() {
  tplEdit.name = $('#tpl-name').value.trim() || $('#tpl-org').value.trim() || 'Plantilla';
  tplEdit.org = $('#tpl-org').value.trim();
  tplEdit.footer = $('#tpl-footer').value.trim();
  return tplEdit;
}
$('#btn-tpl-new').onclick = () => openTplEditor();
$('#btn-tpl-logo').onclick = () => $('#tpl-logo-input').click();
$('#tpl-logo-input').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { Object.assign(tplEdit, await prepLogo(f)); renderTplLogo(); } catch (err) { toast(err.message); }
};
$('#btn-tpl-logo-clear').onclick = () => { tplEdit.logo = ''; tplEdit.logoRatio = 1; renderTplLogo(); };
$('#btn-tpl-save').onclick = () => {
  const t = readTplForm();
  const list = (settings.pdfTemplates || []).filter((x) => x.id !== t.id);
  list.push(t);
  const patch = { pdfTemplates: list };
  if ($('#tpl-default').checked) patch.pdfDefault = t.id;
  else if (settings.pdfDefault === t.id) patch.pdfDefault = '';
  if (saveSettings(patch) === false) return;
  closeSheets();
  renderTplList();
  toast('Plantilla desada');
};
$('#btn-tpl-delete').onclick = () => {
  if (!confirm(`Esborrar la plantilla «${tplEdit.name || 'Plantilla'}»?`)) return;
  const patch = { pdfTemplates: (settings.pdfTemplates || []).filter((x) => x.id !== tplEdit.id) };
  if (settings.pdfDefault === tplEdit.id) patch.pdfDefault = '';
  saveSettings(patch);
  closeSheets();
  renderTplList();
};
// Exemple: l'última reunió amb resum o, si no n'hi ha, una acta de mostra.
$('#btn-tpl-preview').onclick = async () => {
  const t = readTplForm();
  const all = (await db.all('meetings')).filter((x) => x.summary).sort((a, b) => b.startedAt - a.startedAt);
  const sample = all[0] || { id: 'mostra', startedAt: Date.now(), durationMs: 45 * 60000, type: 'general', summary: "# Reunió de mostra\n\n## Resum\nAixí es veurà l'acta amb aquesta plantilla.\n\n## Decisions\n- Aprovar el pressupost.\n\n## Tasques\n- [ ] **Marta**: enviar la proposta — divendres\n" };
  exportPdf(sample, t, $('#btn-tpl-preview'));
};

// ---------------------------------------------------------------------------
// Avís de versió nova
// ---------------------------------------------------------------------------
async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    if (Number(info.v) > APP_VERSION) {
      $('#update-notes').textContent = info.notes ? ` ${info.notes}` : '';
      $('#update-banner').hidden = false;
    }
  } catch { /* sense connexió */ }
}
$('#btn-update').onclick = async () => {
  if (rec.meeting) { toast('Acaba la reunió abans d\'actualitzar'); return; }
  $('#btn-update').textContent = 'Actualitzant…';
  try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch { /* res */ }
  location.reload();
};
setTimeout(checkForUpdate, 3000);
setInterval(checkForUpdate, 30 * 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

// ---------------------------------------------------------------------------
// Compte de Google: inici de sessió i sincronització amb el Drive de cada persona
// ---------------------------------------------------------------------------
// Identificador públic de l'app a Google Cloud (OAuth). Buit = funció amagada.
const GOOGLE_CLIENT_ID = '';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email profile';
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
class AuthError extends Error {}

function loadAuth() { try { return JSON.parse(localStorage.getItem('gauth') || '{}'); } catch { return {}; } }
let gauth = loadAuth();
function saveAuth(a) { gauth = { ...gauth, ...a }; try { localStorage.setItem('gauth', JSON.stringify(gauth)); } catch { /* res */ } }
// L'identificador es pot posar a Ajustos o arribar amb l'enllaç «per vincular un altre aparell» (?gcid=…).
const GCID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;
const googleClientId = () => GOOGLE_CLIENT_ID || (() => { try { return localStorage.getItem('googleClientId') || ''; } catch { return ''; } })();
const googleEnabled = () => !!googleClientId();
const signedIn = () => googleEnabled() && !!gauth.email;
const tokenValid = () => !!(gauth.token && gauth.exp && gauth.exp - Date.now() > 60000);

function tombstones() { try { return JSON.parse(localStorage.getItem('tombstones') || '[]'); } catch { return []; } }
function addTombstone(id) {
  const t = tombstones(); if (!t.includes(id)) t.push(id);
  try { localStorage.setItem('tombstones', JSON.stringify(t)); } catch { /* res */ }
  syncSoon();
}

// Inici de sessió per redirecció (funciona també a l'iPhone amb l'app a la pantalla d'inici).
function googleSignIn({ silent = false } = {}) {
  if (!googleEnabled()) return;
  if (rec.meeting) { toast('Acaba la reunió abans de connectar amb Google'); return; }
  const state = uid();
  try { localStorage.setItem('oauthState', JSON.stringify({ state, silent, at: Date.now() })); } catch { /* res */ }
  const q = new URLSearchParams({
    client_id: googleClientId(), redirect_uri: APP_URL, response_type: 'token',
    scope: GOOGLE_SCOPES, include_granted_scopes: 'true', state,
    prompt: silent ? 'none' : 'select_account',
  });
  if (gauth.email) q.set('login_hint', gauth.email);
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
// En tornar de Google, la resposta arriba al final de l'adreça (#access_token=…).
function handleOAuthRedirect() {
  if (!/(access_token|error)=/.test(location.hash)) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', APP_URL);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('oauthState') || '{}'); localStorage.removeItem('oauthState'); } catch { /* res */ }
  if (!saved.state || h.get('state') !== saved.state) return 'state';
  if (h.get('error')) { if (saved.silent) saveAuth({ needsLogin: true }); return h.get('error'); }
  saveAuth({ token: h.get('access_token'), exp: Date.now() + Number(h.get('expires_in') || 3600) * 1000, needsLogin: false });
  return 'ok';
}
async function gfetch(url, opts = {}, ms = 60000) {
  if (!tokenValid()) throw new AuthError('Sessió de Google caducada');
  const res = await fetchWithTimeout(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${gauth.token}` } }, ms);
  if (res.status === 401) { saveAuth({ token: null, exp: 0 }); throw new AuthError('Sessió de Google caducada'); }
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 400)}`);
  return res;
}
async function loadGoogleProfile() {
  const r = await gfetch('https://openidconnect.googleapis.com/v1/userinfo');
  const u = await r.json();
  saveAuth({ email: u.email, name: u.name || u.email, picture: u.picture || '' });
}
async function driveList() {
  const files = {};
  let pageToken = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,appProperties)', pageSize: '1000' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await (await gfetch(`${DRIVE}/files?${q}`)).json();
    for (const f of data.files || []) files[f.name] = f;
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}
async function driveUpload({ id, name, blob, updatedAt }) {
  const meta = id ? { appProperties: { updatedAt: String(updatedAt || Date.now()) } }
    : { name, parents: ['appDataFolder'], appProperties: { updatedAt: String(updatedAt || Date.now()) } };
  const b = `xiuxiu${uid()}`;
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob, `\r\n--${b}--`,
  ]);
  const url = id ? `${DRIVE_UP}/files/${id}?uploadType=multipart&fields=id` : `${DRIVE_UP}/files?uploadType=multipart&fields=id`;
  return (await gfetch(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body }, 180000)).json();
}
const driveGet = (id) => gfetch(`${DRIVE}/files/${id}?alt=media`, {}, 180000);
const driveDelete = (id) => gfetch(`${DRIVE}/files/${id}`, { method: 'DELETE' }).catch(() => {});
const photoFileName = (key) => `photo-${key.replace(/[^\w-]/g, '_')}.jpg`;

function syncableSettings() {
  const { source, v, lastBackup, meetingDays, audioDays, ...rest } = settings; // l'esborrat és de cada aparell
  if (!settings.syncKeys && settings.syncKeys !== undefined) { delete rest.geminiKey; delete rest.scriptSecret; }
  return rest;
}
let syncing = null;
let syncTimer = null;
function syncSoon(delay = 2500) {
  if (!signedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), delay);
}
const isBusy = (m) => pipelines.has(m.id) || m.status === 'recording' || m.status === 'processing' || (rec.meeting && rec.meeting.id === m.id);
async function syncNow({ manual = false } = {}) {
  if (!signedIn() || syncing) return syncing;
  if (!tokenValid()) {
    if (manual) googleSignIn({ silent: !gauth.needsLogin });
    renderAccount();
    return null;
  }
  syncing = (async () => {
    renderAccount('Sincronitzant…');
    const files = await driveList();
    let changed = false;

    // 1. Configuració i esborrats
    const cfgFile = files['config.json'];
    let remoteCfg = null;
    if (cfgFile) remoteCfg = await (await driveGet(cfgFile.id)).json();
    const localDeleted = tombstones();
    const deleted = [...new Set([...localDeleted, ...((remoteCfg && remoteCfg.deleted) || [])])];
    try { localStorage.setItem('tombstones', JSON.stringify(deleted)); } catch { /* res */ }
    const remoteNewer = remoteCfg && Number(remoteCfg.updatedAt || 0) > Number(settings.updatedAt || 0);
    if (remoteNewer) {
      const keep = { source: settings.source, v: settings.v, lastBackup: settings.lastBackup, meetingDays: settings.meetingDays, audioDays: settings.audioDays };
      saveSettings({ ...remoteCfg.settings, ...keep, updatedAt: remoteCfg.updatedAt }, { silent: true });
      if (Array.isArray(remoteCfg.recentEmails)) rememberEmails(remoteCfg.recentEmails);
      syncCustomTypes(); renderTypeChips(true);
      changed = true;
    }
    if (!remoteCfg || !remoteNewer && (Number(settings.updatedAt || 0) > Number(remoteCfg.updatedAt || 0) || deleted.length !== (remoteCfg.deleted || []).length)) {
      const cfg = { settings: syncableSettings(), recentEmails: recentEmails(), deleted, updatedAt: settings.updatedAt || Date.now() };
      await driveUpload({ id: cfgFile && cfgFile.id, name: 'config.json', blob: new Blob([JSON.stringify(cfg)], { type: 'application/json' }), updatedAt: cfg.updatedAt });
    }

    // 2. Reunions esborrades en algun aparell
    for (const id of deleted) {
      const local = await db.get('meetings', id);
      if (local && !isBusy(local)) {
        for (const ph of local.photos || []) await db.del('audio', ph.key);
        await db.del('meetings', id); meetingCache.delete(id); changed = true;
      }
      for (const [name, f] of Object.entries(files)) if (name.includes(id)) { await driveDelete(f.id); delete files[name]; }
    }

    // 3. Reunions: baixa les noves o més recents, puja les locals noves o modificades
    const locals = {};
    for (const m of await db.all('meetings')) locals[m.id] = m;
    for (const [name, f] of Object.entries(files)) {
      const mm = name.match(/^meeting-(.+)\.json$/);
      if (!mm || deleted.includes(mm[1])) continue;
      const local = locals[mm[1]];
      const rUpd = Number((f.appProperties || {}).updatedAt || 0);
      if (local && (isBusy(local) || (local.updatedAt || 0) >= rUpd)) continue;
      const remote = await (await driveGet(f.id)).json();
      remote.updatedAt = rUpd;
      await db.put('meetings', remote); meetingCache.set(remote.id, remote);
      locals[remote.id] = remote; changed = true;
    }
    for (const m of Object.values(locals)) {
      if (isBusy(m) || deleted.includes(m.id)) continue;
      const f = files[`meeting-${m.id}.json`];
      const rUpd = f ? Number((f.appProperties || {}).updatedAt || 0) : -1;
      if ((m.updatedAt || 0) > rUpd) {
        if (!m.updatedAt) { m.updatedAt = Date.now(); await db.put('meetings', m); }
        await driveUpload({ id: f && f.id, name: `meeting-${m.id}.json`, blob: new Blob([JSON.stringify(m)], { type: 'application/json' }), updatedAt: m.updatedAt });
      }
      // Fotos de documents
      for (const ph of m.photos || []) {
        const pf = files[photoFileName(ph.key)];
        const blob = await db.get('audio', ph.key);
        if (!pf && blob) await driveUpload({ name: photoFileName(ph.key), blob });
        else if (pf && !blob) { await db.put('audio', await (await driveGet(pf.id)).blob(), ph.key); changed = true; }
      }
    }
    saveAuth({ lastSync: Date.now() });
    return changed;
  })().then((changed) => {
    if (changed) { refreshHomeBanners(); if (currentView === 'history') renderHistory(); if (currentView === 'settings') fillSettings(); }
    renderAccount();
    return changed;
  }).catch((e) => {
    if (e instanceof AuthError) { if (manual) googleSignIn({ silent: true }); }
    else saveAuth({ lastError: e.message });
    renderAccount(e instanceof AuthError ? '' : `⚠️ No s'ha pogut sincronitzar: ${friendlyError(e.message)}`);
    throw e;
  }).finally(() => { syncing = null; });
  return syncing;
}

function renderAccount(statusText = null) {
  const on = googleEnabled();
  $('#account-section').hidden = false;
  $('#gcid-setup').hidden = on;
  $('#gcid-ready').hidden = !on;
  $('#btn-gcid-change').hidden = !!GOOGLE_CLIENT_ID;
  $('#welcome-google').hidden = !on || signedIn();
  if (!on) return;
  const st = $('#account-status');
  if (signedIn()) {
    const when = gauth.lastSync ? `Última sincronització: ${fmtDate(gauth.lastSync)}` : "Encara no s'ha sincronitzat";
    st.innerHTML = `✅ Connectat com a <b>${escapeHtml(gauth.email)}</b><br><span class="muted">${escapeHtml(statusText || (gauth.needsLogin ? 'Cal tornar a connectar amb Google.' : when))}</span>`;
  } else {
    st.textContent = 'No connectat. Entra amb Google per tenir les reunions a tots els teus aparells.';
  }
  $('#btn-google-signin').hidden = signedIn() && !gauth.needsLogin;
  $('#btn-sync-now').hidden = !signedIn();
  $('#btn-google-signout').hidden = !signedIn();
  $('#set-sync-keys').checked = settings.syncKeys !== false;
  $('#reconnect-banner').hidden = !(signedIn() && gauth.needsLogin);
}
document.querySelectorAll('.btn-google').forEach((b) => { b.onclick = () => googleSignIn(); });
$('#btn-sync-now').onclick = () => syncNow({ manual: true }).then((c) => toast(c ? '✓ Sincronitzat: hi ha canvis nous' : '✓ Tot està al dia')).catch(() => {});
$('#btn-google-signout').onclick = () => {
  if (!confirm("Tancar la sessió de Google en aquest aparell? Les reunions es queden al mòbil i al teu Drive.")) return;
  if (gauth.token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(gauth.token)}`, { method: 'POST' }).catch(() => {});
  gauth = {}; try { localStorage.removeItem('gauth'); } catch { /* res */ }
  renderAccount();
};
$('#set-sync-keys').onchange = (e) => saveSettings({ syncKeys: e.target.checked });
$('#btn-reconnect').onclick = () => googleSignIn();
$('#btn-gcid-save').onclick = () => {
  const v = $('#set-gcid').value.trim();
  if (!GCID_RE.test(v)) { toast("Això no sembla un identificador de client de Google (acaba en .apps.googleusercontent.com)", 6000); return; }
  try { localStorage.setItem('googleClientId', v); } catch { /* res */ }
  renderAccount();
  toast('✓ Desat. Ara toca «Entra amb Google».');
};
$('#btn-gcid-link').onclick = async () => {
  const link = `${APP_URL}?gcid=${encodeURIComponent(googleClientId())}`;
  try { await navigator.clipboard.writeText(link); toast("✓ Enllaç copiat. Obre'l a l'altre aparell i toca «Entra amb Google».", 6000); }
  catch { prompt("Copia aquest enllaç i obre'l a l'altre aparell:", link); }
};
$('#btn-gcid-change').onclick = () => {
  if (GOOGLE_CLIENT_ID) return;
  if (!confirm("Treure l'identificador de Google d'aquest aparell? Hauràs de tornar a entrar amb Google.")) return;
  try { localStorage.removeItem('googleClientId'); } catch { /* res */ }
  gauth = {}; try { localStorage.removeItem('gauth'); } catch { /* res */ }
  renderAccount();
};
// Enllaç per vincular: ?gcid=… a l'adreça.
(() => {
  try {
    const u = new URL(location.href);
    const g = u.searchParams.get('gcid');
    if (!g) return;
    u.searchParams.delete('gcid');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    if (GCID_RE.test(g)) { localStorage.setItem('googleClientId', g); setTimeout(() => toast('Aquest aparell ja es pot vincular: toca «Entra amb Google».', 6000), 800); }
  } catch { /* res */ }
})();

// En obrir l'app: recull la resposta de Google, i sincronitza (o renova la sessió en silenci).
async function startGoogleSync() {
  if (!googleEnabled()) { renderAccount(); return; }
  const r = handleOAuthRedirect();
  if (r === 'ok') {
    try { await loadGoogleProfile(); toast(`✓ Connectat com a ${gauth.email}`); }
    catch (e) { toast(`No s'ha pogut connectar amb Google: ${e.message}`, 6000); }
  } else if (r && r !== 'state' && !/interaction_required|login_required|consent_required/.test(r)) {
    toast(`Google no ha permès connectar (${r})`, 6000);
  }
  renderAccount();
  if (!signedIn()) return;
  if (tokenValid()) { syncNow().catch(() => {}); return; }
  // Sessió caducada: renova-la en silenci (com a molt un cop cada 10 minuts).
  if (!gauth.needsLogin && Date.now() - (gauth.silentAt || 0) > 600000 && !rec.meeting) {
    saveAuth({ silentAt: Date.now() });
    googleSignIn({ silent: true });
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && signedIn() && tokenValid() && Date.now() - (gauth.lastSync || 0) > 120000) syncSoon(500);
});
setInterval(() => { if (document.visibilityState === 'visible' && signedIn() && tokenValid()) syncSoon(0); }, 5 * 60000);

// Botons de la pantalla d'ajustos
$('#set-engine').onchange = syncEngineFields;
$('#btn-save-settings').onclick = async () => {
  const next = readSettingsForm();
  // Abans d'activar l'esborrat de reunions antigues, diu quantes se n'esborrarien ara.
  if (next.meetingDays > 0 && next.meetingDays !== Number(settings.meetingDays || 0)) {
    const n = oldMeetings(await db.all('meetings'), next.meetingDays).length;
    if (n && !confirm(`Amb aquest ajust s'esborraran ara ${n === 1 ? '1 reunió antiga' : `${n} reunions antigues`} (resum, transcripció i fotos). Vols continuar?`)) return;
  }
  saveSettings(next);
  retentionCleanup().catch(() => {});
  toast('Configuració desada');
  showView('home');
};
$('#btn-test-keys').onclick = testKeys;
$('#btn-test-email').onclick = testEmail;
