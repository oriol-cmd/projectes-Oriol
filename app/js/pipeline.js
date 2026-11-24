/* Xiu-xiu · Processament: correu automàtic, cua de feina, importar (àudio, vídeo i YouTube), etiquetes i privadesa. */
'use strict';

// ---------------------------------------------------------------------------
// Enviament per correu (Google Apps Script)
// ---------------------------------------------------------------------------
const EMAIL_STYLE = {
  h1: 'font-size:22px;margin:0 0 12px;color:#13265c',
  h2: 'font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:24px 0 8px;color:#1f4bd8;border-bottom:1px solid #e3e6eb;padding-bottom:6px',
  h3: 'font-size:15px;margin:14px 0 4px;color:#0f172a',
  p: 'margin:6px 0',
  ul: 'margin:6px 0;padding-left:22px',
  ol: 'margin:6px 0;padding-left:22px',
  li: 'margin:3px 0',
};

function summaryTitle(m, md = m.summary) {
  const first = (md || '').split('\n').find((l) => /^#\s+/.test(l));
  return first ? first.replace(/^#\s+/, '').trim() : (m.title || 'Reunió');
}

// Extreu les tasques de la secció «Tasques» del resum, per a la pestanya del full de càlcul.
function parseTasks(md) {
  const tasks = [];
  let inTasks = false;
  for (const line of (md || '').split('\n')) {
    if (/^##\s+/.test(line)) { inTasks = /^##\s+(Tasques|Tareas|Tasks|Action items)/i.test(line); continue; }
    if (!inTasks) continue;
    const m = line.match(/^\s*[-*]\s+(?:\[[ xX]?\]\s*)?(.+)$/);
    if (!m || /^(cap|ninguna|none)\.?$/i.test(m[1].trim())) continue;
    let rest = m[1].trim();
    let who = '';
    const w = rest.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if (w) { who = w[1].replace(/:$/, '').trim(); rest = w[2]; }
    let due = '';
    const d = rest.split(/\s+[—–]\s+/);
    if (d.length > 1) { due = d.pop().trim(); rest = d.join(' — '); }
    tasks.push({ who, task: rest.replace(/\*\*/g, '').trim(), due });
  }
  return tasks;
}

function buildEmail(m, lang = settings.summaryLang || 'ca', mdOverride = null) {
  const L = L10N[lang] || L10N.ca;
  const md = mdOverride || getSummary(m, lang);
  const title = summaryTitle(m, md);
  const when = new Date(m.startedAt).toLocaleString(L.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const typeLabel = m.type && m.type !== 'general' && MEETING_TYPES[m.type] ? ` · ${MEETING_TYPES[m.type].label}` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:680px">
<p style="margin:0 0 14px;color:#64748b;font-size:13px">${escapeHtml(when)} · ${escapeHtml(fmtDuration(m.durationMs || 0))}${escapeHtml(typeLabel)}</p>
${mdToHtml(md, EMAIL_STYLE)}
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">${m.type === 'revisio' ? L.reviewFooter : L.emailFooter}</p>
</div>`;
  return {
    subject: m.type === 'revisio'
      ? `${L.review}: ${title.replace(/^(Revisió|Revisión|Review)\s*:\s*/i, '')}`
      : `${L.subject}: ${title} (${new Date(m.startedAt).toLocaleDateString(L.locale)})`,
    html,
    text: md,
    transcript: buildTranscript(m),
    filename: `transcripcio-${new Date(m.startedAt).toISOString().slice(0, 10)}.txt`,
    // Per al full de càlcul
    id: m.id,
    date: new Date(m.startedAt).toISOString(),
    title,
    durationMin: Math.round((m.durationMs || 0) / 60000),
    summary: md,
    tasks: parseTasks(m.summary),
  };
}

async function sendEmail(payload, { noFallback = false } = {}) {
  if (!settings.scriptUrl || !settings.scriptSecret) throw new FatalError("Falta configurar l'enviament de correu");
  const body = JSON.stringify({ secret: settings.scriptSecret, to: settings.email, ...payload });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // text/plain evita la petició CORS prèvia, que Apps Script no accepta.
      const res = await fetchWithTimeout(settings.scriptUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow',
      }, 60000);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("L'Apps Script no ha respost bé. Revisa que estigui publicat per a «Qualsevol»."); }
      if (!data.ok) {
        if (data.error === 'unauthorized') throw new FatalError("La clau secreta de l'Apps Script no coincideix");
        throw new Error(data.error || 'Error desconegut en enviar');
      }
      return { confirmed: true, data };
    } catch (e) {
      if (e instanceof FatalError) throw e;
      if (e instanceof TypeError && attempt === 2 && !noFallback) {
        // Error de CORS/xarxa: últim intent sense poder llegir la resposta.
        await fetch(settings.scriptUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
        return { confirmed: false };
      }
      if (attempt === 2) throw e;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

// ---------------------------------------------------------------------------
// Processament complet: transcripció -> resum -> correu (reprenible)
// ---------------------------------------------------------------------------
const pipelines = new Map();
function runPipeline(id, { redoSummary = false } = {}) {
  if (pipelines.has(id)) return pipelines.get(id);
  const p = (async () => {
    const m = await getMeeting(id);
    if (!m || deletedIds.has(id)) return; // s'ha esborrat
    if (rec.meeting && rec.meeting.id === id) return; // s'està gravant (p. ex. continuació): ja es processarà en acabar
    if (m.needsResummary) { redoSummary = true; delete m.needsResummary; }
    if (redoSummary) { m.summary = ''; m.translations = {}; m.email = { status: 'pending' }; m.textOnly = false; delete m.proDraft; }
    m.status = 'processing';
    m.error = '';
    await saveMeeting(m);
    // Si s'estava mirant aquesta reunió amb l'error, mostra el progrés del nou intent.
    if (currentView === 'result' && viewingId === id) showView('proc');
    updateProcView(m);
    try {
      // 1. Transcripció
      if (m.engine === 'docs') {
        if (!m.segments.length || m.segments.some((x) => x.status !== 'done')) {
          m.stage = 'transcribe'; updateProcView(m);
          await transcribeDocs(m);
        }
      } else if (m.engine === 'import') {
        if (!m.segments.length || m.segments.some((x) => x.status !== 'done')) {
          m.stage = 'transcribe'; updateProcView(m);
          await transcribeImport(m);
        }
      } else if (m.engine !== 'device') {
        m.segments.forEach((s) => { if (s.status === 'error') s.status = 'pending'; });
        await saveMeeting(m);
        updateProcView(m);
        await kickQueue(id);
        // Si no ha sortit cap paraula, torna a provar els trams que semblaven silenci (micròfon fluix).
        if (!m.segments.some((s) => s.status === 'done' && s.text) && !m.silentRetried) {
          let n = 0;
          for (const s of m.segments) {
            if ((s.silent || s.empty) && await db.get('audio', audioKey(m.id, s.idx))) { s.status = 'pending'; s.retry = true; delete s.silent; n++; }
          }
          m.silentRetried = true;
          await saveMeeting(m);
          if (n) { updateProcView(m); await kickQueue(id); }
        }
        const failed = m.segments.filter((s) => s.status !== 'done');
        if (failed.length) throw new Error(failed[0].error || 'Hi ha trams sense transcriure');
      }
      // 2. Resum (o, si només es vol el text, el text net de la transcripció)
      if (!m.summary && m.textOnly) {
        m.summary = textDocument(m);
        await saveMeeting(m);
      }
      if (!m.summary) {
        m.stage = 'summary'; updateProcView(m);
        let last = 0;
        m.summary = await summarize(m, (t) => {
          // Mostra el resum mentre s'escriu (com a màxim ~6 cops per segon).
          const now = Date.now();
          if (now - last < 150 || currentView !== 'proc' || viewingId !== m.id) return;
          last = now;
          const box = $('#proc-summary');
          box.hidden = !t;
          box.innerHTML = mdToHtml(t.replace(/^```(?:markdown)?\s*/i, ''));
        });
        await saveMeeting(m);
      }
      // 2b. Traducció a l'idioma per defecte (si no és el català)
      const lang = settings.summaryLang || 'ca';
      if (!m.textOnly && lang !== 'ca' && !(m.translations && m.translations[lang])) {
        m.stage = 'translate'; updateProcView(m);
        await translateSummary(m, lang);
      }
      // L'acta ja està feta: es mostra ara mateix; el correu, el Google Doc i les etiquetes
      // s'acaben en segon pla (abans calia esperar-los).
      m.stage = 'finishing';
      await saveMeeting(m);
      if (currentView === 'proc' && viewingId === id) showResult(id);
      // 3. Correu
      if (!emailEnabled()) {
        if (m.email.status !== 'sent') m.email = { status: 'off' };
      } else if (m.email.status !== 'sent') {
        try {
          const r = await sendEmail(buildEmail(m));
          m.email = { status: 'sent', at: Date.now(), confirmed: r.confirmed };
          if (r.data && r.data.docUrl) m.docUrl = r.data.docUrl;
        } catch (e) {
          m.email = { status: 'error', error: e.message };
        }
      }
      // 4. Etiquetes automàtiques (no és imprescindible: si falla, es continua)
      if (!m.tags && m.engine !== 'digest') await autoTag(m);
      // 5. Revisió de l'acta amb la gravació (marca el que no s'hi troba)
      if (settings.verify !== false && !m.textOnly && m.engine !== 'digest' && !verifyFresh(m)) {
        if (currentView === 'result' && viewingId === id) { $('#verify-banner').hidden = false; $('#verify-banner').className = 'banner verify-banner'; $('#verify-banner').textContent = "🔍 Comprovant l'acta amb la gravació…"; }
        try { await verifyActa(m); } catch (e) { if (e instanceof FatalError) { /* sense quota: es podrà fer a mà */ } }
      }
      m.status = 'done';
      m.doneAt = Date.now();
      m.stage = '';
      m.autoRetries = 0;
      delete m.retryAt;
      await saveMeeting(m);
      if (m.refIdx != null && !keepAudioNow()) await db.del('audio', audioKey(m.id, m.refIdx));
      if (m.engine === 'import' && !keepAudioNow()) for (const f of importList(m)) await db.del('audio', f.key);
      retentionCleanup().catch(() => {});
    } catch (e) {
      m.status = 'error';
      m.error = e.message;
      if (/quota/i.test(e.message || '')) m.quotaDay = quotaDay();
      // Errors temporals (connexió, Google saturat o caigut…): ho tornem a provar sols,
      // cada cop esperant més (fins a ~1 hora en total), per si la caiguda de Google dura.
      delete m.retryAt;
      const RETRY_DELAYS = [15000, 60000, 3 * 60000, 8 * 60000, 15 * 60000, 30 * 60000];
      if (!(e instanceof FatalError) && (m.autoRetries || 0) < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[m.autoRetries || 0];
        m.autoRetries = (m.autoRetries || 0) + 1;
        m.retryAt = Date.now() + delay;
        setTimeout(() => { if (!pipelines.has(id)) runPipeline(id); }, delay);
      }
      await saveMeeting(m);
    } finally {
      pipelines.delete(id);
    }
    updateProcView(m);
    if (currentView === 'proc' && viewingId === id) showResult(id);
    else if (currentView === 'result' && viewingId === id) refreshResultStatus(m);
    refreshHomeBanners();
    syncSoon(1500);
    return m;
  })();
  pipelines.set(id, p);
  return p;
}

// ---------------------------------------------------------------------------
// Represa del que ha quedat a mitges
// ---------------------------------------------------------------------------
// Reprèn el que hagi quedat a mitges (app tancada, sense cobertura...).
async function resumeUnfinished() {
  const all = await db.all('meetings');
  for (const stored of all) {
    if (rec.meeting && rec.meeting.id === stored.id) continue; // és la que s'està gravant ara
    if (!meetingCache.has(stored.id)) meetingCache.set(stored.id, stored);
    const m = meetingCache.get(stored.id);
    if (pipelines.has(m.id)) continue;
    if (m.status === 'recording') {
      // L'app es va tancar mentre gravava: processa el que es va desar.
      const hasContent = m.engine === 'device' ? !!m.liveText : m.segments.length > 0;
      m.status = hasContent ? 'processing' : 'error';
      if (!hasContent) m.error = "La gravació es va interrompre abans de desar àudio";
      await saveMeeting(m);
    }
    // Errors pendents de reintent (l'app es va tancar abans) o de quota d'un altre dia.
    const retryDue = m.status === 'error' && ((m.retryAt && m.retryAt <= Date.now() + 1000) || (m.quotaDay && m.quotaDay !== quotaDay()));
    if (m.status === 'error' && m.retryAt && m.retryAt > Date.now()) {
      setTimeout(() => { if (!pipelines.has(m.id)) runPipeline(m.id); }, m.retryAt - Date.now());
    }
    if (retryDue && m.quotaDay && m.quotaDay !== quotaDay()) { delete m.quotaDay; m.autoRetries = 0; }
    if (m.status === 'processing' || retryDue || (m.status === 'done' && m.email.status === 'error')) runPipeline(m.id);
  }
  refreshHomeBanners();
}
window.addEventListener('online', () => resumeUnfinished());

// ---------------------------------------------------------------------------
// Privadesa i espai: esborrat automàtic de l'àudio i de les reunions antigues
// ---------------------------------------------------------------------------
async function purgeAudio(snapshot) {
  const m = await getMeeting(snapshot.id);
  if (!m || m.status !== 'done' || pipelines.has(m.id) || (rec.meeting && rec.meeting.id === m.id)) return;
  // Els trossos que van tornar sense text es guarden (per poder-los tornar a transcriure).
  for (const sg of m.segments || []) if (sg.text || !sg.empty) await db.del('audio', audioKey(m.id, sg.idx));
  if (m.engine === 'import') for (const f of importList(m)) await db.del('audio', f.key);
  m.audioPurged = true;
  await saveMeeting(m);
}
// Edat d'una reunió: des de l'última vegada que s'ha acabat o tocat (no la data del fitxer importat).
const meetingAge = (m) => Date.now() - Math.max(m.doneAt || 0, m.updatedAt || 0, m.createdAt || 0, m.startedAt || 0);
const oldMeetings = (all, days) => all.filter((m) => days > 0 && m.status === 'done' && !pipelines.has(m.id)
  && !(rec.meeting && rec.meeting.id === m.id) && meetingAge(m) > days * 86400000);
let cleaning = false;
async function retentionCleanup() {
  if (cleaning || rec.meeting) return;
  cleaning = true;
  try {
    const all = (await db.all('meetings')).sort((a, b) => a.startedAt - b.startedAt);
    // 1. Reunions més antigues del que l'usuari vol guardar
    const mdays = Number(settings.meetingDays || 0);
    for (const m of oldMeetings(all, mdays)) await deleteMeeting(m, { ask: false });
    // 2. Àudio guardat més dies del compte
    const adays = Number(settings.audioDays ?? 7);
    for (const m of all) {
      if (m.audioPurged || m.status !== 'done' || pipelines.has(m.id) || deletedIds.has(m.id)) continue;
      const age = Date.now() - (m.doneAt || m.updatedAt || m.startedAt);
      if (adays === 0 || (adays > 0 && age > adays * 86400000)) await purgeAudio(m);
    }
    // 3. Si el mòbil va just d'espai, esborra primer l'àudio de les reunions més antigues
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && est.usage / est.quota > (adays === -1 ? 0.95 : 0.8)) {
        for (const m of all) {
          if (m.audioPurged || m.status !== 'done' || pipelines.has(m.id) || deletedIds.has(m.id)) continue;
          await purgeAudio(m);
          const e2 = await navigator.storage.estimate();
          if (e2.usage / e2.quota < 0.6) break;
        }
      }
    }
  } finally { cleaning = false; }
}

// ---------------------------------------------------------------------------
// Importar un àudio o vídeo (nota de veu, gravació de Zoom/Teams…)
// ---------------------------------------------------------------------------
function importMime(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const byExt = { opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mp3', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
  return byExt[ext] || (file.type || 'audio/mp4').split(';')[0];
}
function mediaDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement(/^video/.test(file.type) ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(isFinite(el.duration) ? Math.round(el.duration * 1000) : 0);
    el.onerror = () => done(0);
    setTimeout(() => done(0), 6000);
    el.src = url;
  });
}
// Puja un fitxer gran a Google (Files API) i retorna l'URI per fer-lo servir a Gemini.
async function uploadToGemini(blob, mime, name) {
  const start = await fetchWithTimeout('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': settings.geminiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: (name || 'reunio').slice(0, 100) } }),
  }, 60000);
  if (!start.ok) throw new Error(`Google no ha acceptat la pujada del fitxer (${start.status}): ${(await start.text()).slice(0, 160)}`);
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error("Google no ha retornat l'adreça per pujar el fitxer");
  const up = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: blob,
  }, 900000);
  if (!up.ok) throw new Error(`No s'ha pogut pujar el fitxer (${up.status})`);
  let file = (await up.json()).file;
  for (let i = 0; i < 100 && file && file.state === 'PROCESSING'; i++) {
    await sleep(3000);
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { 'x-goog-api-key': settings.geminiKey } }, 30000);
    if (r.ok) file = await r.json();
  }
  if (!file || file.state === 'FAILED') throw new Error('Google no ha pogut processar el fitxer');
  return file.uri;
}
// Fitxers d'una reunió importada (abans només n'hi havia un).
function importList(m) {
  return m.importFiles && m.importFiles.length
    ? m.importFiles
    : [{ key: `${m.id}:import`, name: m.importName, mime: m.importMime }];
}
async function transcribeImport(m) {
  const files = importList(m);
  if (m.segments.length !== files.length) m.segments = files.map((f, i) => ({ idx: i, startMs: 0, status: 'pending', text: '' }));
  // Diversos fitxers (p. ex. notes de veu): 2 alhora, per anar més de pressa.
  const one = async (i) => {
    const seg = m.segments[i];
    const f = files[i];
    const blob = f.youtube ? null : await db.get('audio', f.key);
    if (!blob && !f.youtube) throw new FatalError(`No s'ha trobat el fitxer «${f.name || 'importat'}». Torna'l a importar.`);
    const label = files.length > 1 ? `Àudio ${i + 1} de ${files.length}: ` : '';
    try {
      const text = await transcribeImportFile(m, blob, f, label);
      seg.text = files.length > 1 ? `[Àudio ${i + 1} de ${files.length}: ${f.name || ''}]\n${text}` : text;
      seg.status = 'done';
      delete seg.error;
    } catch (e) {
      seg.status = 'error';
      seg.error = e.message;
      await saveMeeting(m);
      throw e;
    }
    if (files.length > 1) m.importProgress = `${m.segments.filter((x) => x.status === 'done').length} de ${files.length} àudios transcrits…`;
    else delete m.importProgress;
    await saveMeeting(m);
    updateProcView(m);
  };
  const todo = m.segments.filter((x) => x.status !== 'done').map((x) => x.idx);
  let next = 0, failure = null;
  const worker = async () => {
    while (next < todo.length && !failure) {
      const i = todo[next++];
      try { await one(i); } catch (e) { failure = failure || e; }
    }
  };
  await Promise.all(files.length > 1 ? [worker(), worker()] : [worker()]);
  delete m.importProgress;
  if (failure) throw failure;
}
async function transcribeImportFile(m, blob, f, label) {
  const progress = (t) => { m.importProgress = label + t; updateProcView(m); };
  const prompt = [
    "Transcriu literalment aquesta gravació d'una reunió o conversa.",
    label ? "És una de diverses gravacions de la mateixa reunió o conversa (p. ex. notes de veu)." : '',
    settings.lang === 'auto'
      ? "Pot ser en català, en castellà o barrejat: escriu cada intervenció en l'idioma en què es parla, sense traduir."
      : `L'idioma principal és el ${LANG_NAMES[settings.lang]}; no tradueixis les intervencions en altres idiomes.`,
    "Si parlen diverses persones, comença cada intervenció en una línia nova amb el nom de qui parla i dos punts («Nom: …»). Fes servir el nom de qui parla si es presenta o si algú s'hi adreça directament pel nom (no pel simple fet que s'esmenti un nom); si no, fes servir «Persona 1», «Persona 2»… de manera coherent tota l'estona.",
    m.textOnly ? '' : "Cada 5 minuts aproximadament, afegeix una línia amb el temps de la gravació entre claudàtors, p. ex. [05:00], [10:00].",
    "Escriu només la transcripció, sense títols, comentaris ni resums. Si no hi ha veu, respon només: [silenci]",
    m.textOnly ? "Fes una transcripció NETA, perquè es pugui llegir i fer servir com a text: treu les crosses (eh, mmm, o sigui…), les repeticions i les frases que es tallen i es tornen a començar; posa bé la puntuació i separa-ho en paràgrafs. NO resumeixis, NO escurcis el contingut i NO canviïs el sentit ni l'ordre del que es diu: s'ha de conservar tot el que es demana o s'explica, amb tots els detalls. No posis marques de temps." : '',
    "Escolta amb atenció també les veus fluixes, llunyanes o que parlen alhora, i transcriu-les igualment, però només si realment hi distingeixes paraules: un soroll o un murmuri no és una intervenció.",
    "No completis ni endevinis paraules pel context: escriu només les paraules que realment sents. Escriu bé els noms propis, xifres, dates i imports que se senten.",
    "Si només parla una persona (p. ex. una nota de veu), no cal posar-hi nom a cada línia: separa'l en paràgrafs per idees.",
    "MOLT IMPORTANT: no t'inventis mai res. Quan una paraula o frase no s'entengui bé, escriu el que probablement s'ha dit (només si n'has sentit clarament una part) seguit de [dubte de comprensió]. Si un fragment no s'entén gens, escriu només [dubte de comprensió].",
    NO_LEAK,
    m.context ? `Context (per escriure bé noms i termes): ${m.context}` : '',
    settings.vocab ? `Noms i paraules que surten sovint (escriu-los exactament així): ${settings.vocab}` : '',
  ].filter(Boolean).join('\n');
  const clean = (t) => (/^\s*(\[silenci\]\.?\s*)+$/i.test(t) ? '' : t.trim());
  if (f.youtube) return transcribeYoutube(m, f, prompt, clean, progress);

  // Gravacions llargues: es tallen en trossos de ~5 minuts (com quan es grava en directe),
  // per pausa de la conversa, i es transcriuen un a un amb el final del tros anterior com a context.
  const dur = f.durationMs || 0;
  if (dur > 12 * 60000 || (!dur && blob.size > 15e6)) {
    try {
      const text = await transcribeLongImport(m, blob, f, label, prompt, clean, progress);
      if (text != null) return text;
    } catch (e) {
      if (e instanceof FatalError || /Gemini|Google|connexió|quota/i.test(e.message || '')) throw e;
      // no s'ha pogut descodificar al dispositiu (format o memòria): es fa d'una sola peça
    }
  }

  // Àudios curts: millora el so (veus fluixes, soroll) i envia'ls en WAV.
  if (settings.boost !== false && (dur > 0 ? dur <= 15 * 60000 && blob.size <= 60e6 : blob.size <= 5e6)) {
    let wav = null;
    try { progress('Millorant el so…'); wav = await enhanceAudio(blob); }
    catch { wav = null; } // no s'ha pogut descodificar: s'envia l'original
    if (wav) try {
      let part;
      if (wav.size <= 14e6) part = { inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } };
      else { progress('Pujant el fitxer a Google…'); part = { fileData: { mimeType: 'audio/wav', fileUri: await uploadToGemini(wav, 'audio/wav', f.name) } }; }
      progress('Transcrivint…');
      return clean(await gemini([part, { text: prompt }], { task: 'transcribe', thinking: 0, maxTokens: 65536 }));
    } catch (e) {
      if (!(e instanceof UnsupportedAudioError)) throw e; // errors de Google: no tornis a enviar el mateix
    }
  }

  const primary = f.mime || 'audio/mp4';
  const mimes = [...new Set([primary, ...(primary === 'audio/mp4' ? ['video/mp4', 'audio/aac'] : primary === 'audio/ogg' ? ['audio/opus'] : [])])];
  let lastErr;
  for (const mime of mimes) {
    try {
      let part;
      if (blob.size <= 14e6) {
        progress('Transcrivint…');
        part = { inlineData: { mimeType: mime, data: await blobToBase64(blob) } };
      } else {
        progress(`Pujant el fitxer a Google (${Math.round(blob.size / 1e6)} MB)…`);
        part = { fileData: { mimeType: mime, fileUri: await uploadToGemini(blob, mime, f.name) } };
        progress('Transcrivint… (pot trigar uns minuts)');
      }
      return clean(await gemini([part, { text: prompt }], { task: 'transcribe', thinking: 0, maxTokens: 65536 }));
    } catch (e) {
      lastErr = e;
      if (!(e instanceof UnsupportedAudioError)) throw e;
    }
  }
  // Últim recurs per a fitxers petits: convertir-los a WAV al mòbil.
  if (blob.size <= 25e6) {
    progress('Convertint el fitxer…');
    const wav = await toWav(blob);
    return clean(await gemini([{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }, { text: prompt }], { task: 'transcribe', thinking: 0, maxTokens: 65536 }));
  }
  throw new FatalError(`Google no accepta el format de «${f.name || 'fitxer'}». Prova d'exportar-lo en MP3 o M4A. (${lastErr ? lastErr.message : ''})`);
}
// Descodifica a mono 16 kHz (la resolució amb què escolta Gemini) i talla en trossos.
const LONG_CHUNK_MS = 5 * 60000;
async function decodeForChunks(blob) {
  const off = new OfflineAudioContext(1, 1, 16000);
  const buf = await off.decodeAudioData(await blob.arrayBuffer());
  return buf; // AudioBuffer a 16 kHz (1 o 2 canals)
}
// Busca el punt més silenciós entre ±20 s del tall previst, perquè no es parteixin paraules.
function quietCut(buf, target) {
  const rate = buf.sampleRate, ch = buf.getChannelData(0);
  const win = Math.round(rate * 0.25), from = Math.max(0, target - 20 * rate), to = Math.min(ch.length - win, target + 20 * rate);
  let best = target, bestE = Infinity;
  for (let i = from; i < to; i += win) {
    let e = 0;
    for (let k = i; k < i + win; k += 4) e += ch[k] * ch[k];
    if (e < bestE) { bestE = e; best = i + (win >> 1); }
  }
  return best;
}
function chunkPcm(buf, a, b) {
  const out = new Float32Array(b - a);
  const n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) { const d = buf.getChannelData(c); for (let i = a; i < b; i++) out[i - a] += d[i] / n; }
  return out;
}
// Mateixa millora de so que enhanceAudio, però sobre mostres ja descodificades.
async function enhancePcm(pcm, rate) {
  const off = new OfflineAudioContext(1, pcm.length, rate);
  const ab = off.createBuffer(1, pcm.length, rate);
  ab.getChannelData(0).set(pcm);
  const src = off.createBufferSource(); src.buffer = ab;
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -42; comp.knee.value = 18; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.35;
  src.connect(hp).connect(comp).connect(off.destination); src.start();
  const outp = (await off.startRendering()).getChannelData(0);
  let sum = 0, n = 0;
  for (let i = 0; i < outp.length; i += 2) { const v = Math.abs(outp[i]); if (v > 0.003) { sum += v * v; n++; } }
  if (n < outp.length / 2 * 0.005) return outp;
  const gain = Math.min(12, 0.1 / Math.sqrt(sum / n));
  for (let i = 0; i < outp.length; i++) outp[i] = Math.tanh(outp[i] * gain);
  return outp;
}
async function transcribeLongImport(m, blob, f, label, basePrompt, clean, progress) {
  progress('Preparant la gravació llarga…');
  // Si l'intent anterior es va tallar mentre es descodificava (p. ex. memòria plena a l'iPhone
  // i l'app es va reiniciar), no ho tornis a provar: es transcriurà d'una sola peça.
  m.importDecoding = m.importDecoding || {};
  if (m.importDecoding[f.key]) return null;
  m.importDecoding[f.key] = true;
  await saveMeeting(m);
  let buf;
  try { buf = await decodeForChunks(blob); } catch { return null; }
  delete m.importDecoding[f.key];
  await saveMeeting(m);
  const rate = buf.sampleRate, total = buf.length;
  const cuts = [0];
  while (total - cuts[cuts.length - 1] > rate * LONG_CHUNK_MS / 1000 * 1.3) cuts.push(quietCut(buf, cuts[cuts.length - 1] + Math.round(rate * LONG_CHUNK_MS / 1000)));
  cuts.push(total);
  const n = cuts.length - 1;
  // Es desa la feina feta: si es talla (connexió, quota), es reprèn pel tros on era.
  m.importParts = m.importParts || {};
  const saved = m.importParts[f.key] && m.importParts[f.key].n === n ? m.importParts[f.key] : { n, parts: [] };
  m.importParts[f.key] = saved;
  const prompt = basePrompt.replace(/\n?Cada 5 minuts aproximadament[^\n]*/, '');
  // El primer tros es fa sol (hi surten les presentacions i els noms); després, 3 trossos alhora
  // per anar molt més de pressa. Cada tros rep el final de l'anterior (si ja està fet) i els
  // noms de qui parla que han sortit fins ara, perquè siguin els mateixos a tot arreu.
  const namesSoFar = () => [...new Set(saved.parts.filter(Boolean).join('\n').split('\n')
    .map((l) => (l.match(/^\s*([\p{L}][\p{L}\p{N} .'’-]{0,30}):\s/u) || [])[1]).filter(Boolean))].slice(0, 20);
  const doneCount = () => saved.parts.filter((t) => typeof t === 'string').length;
  const doChunk = async (i) => {
    let pcm = chunkPcm(buf, cuts[i], cuts[i + 1]);
    if (settings.boost !== false) { try { pcm = await enhancePcm(pcm, rate); } catch { /* sense millora */ } }
    const wav = pcmToWav(pcm, rate);
    pcm = null;
    const prev = i > 0 && typeof saved.parts[i - 1] === 'string' ? saved.parts[i - 1].slice(-800) : '';
    const names = i > 0 ? namesSoFar() : [];
    const from = fmtClock(Math.round(cuts[i] / rate * 1000)), to = fmtClock(Math.round(cuts[i + 1] / rate * 1000));
    const lim = speechLimits(Math.round((cuts[i + 1] - cuts[i]) / rate * 1000));
    const ask = [
      prompt,
      `Aquest és el tros ${i + 1} de ${n} de la gravació (de ${from} a ${to}). Transcriu-lo sencer, des del principi fins al final.`,
      lim ? lim.note : '',
      prev ? `Final del tros anterior (només per continuïtat i per fer servir els mateixos noms de qui parla; no el repeteixis): «${prev}»` : '',
      names.length ? `Noms de qui parla que han sortit als trossos anteriors (fes-los servir si reconeixes la mateixa veu; no te'ls inventis si no hi són): ${names.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const part = wav.size <= 14e6
      ? { inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }
      : { fileData: { mimeType: 'audio/wav', fileUri: await uploadToGemini(wav, 'audio/wav', `${f.name || 'reunio'}-${i + 1}`) } };
    let t = clean(await gemini([part, { text: ask }], { task: 'transcribe', thinking: 0, maxTokens: lim ? lim.maxTokens : 16384 }));
    if (tooLong(t, lim)) { // massa text per a la durada: s'ha inventat part de la conversa
      let again = '';
      try { again = clean(await gemini([part, { text: `${ask}\nATENCIÓ: un intent anterior va retornar molt més text del que cap en aquest àudio. Transcriu exclusivament les paraules que sents.` }], { task: 'transcribe', precise: true, thinking: 0, maxTokens: lim.maxTokens })); } catch (e) { if (e instanceof FatalError) throw e; }
      if (again && wordCount(again) < wordCount(t)) t = again;
      if (tooLong(t, lim)) t = `${SUSPECT_MARK}\n${t}`;
    }
    saved.parts[i] = t;
    await saveMeeting(m);
    progress(`Transcrivint: ${doneCount()} de ${n} trossos fets…`);
  };
  progress(`Transcrivint: ${doneCount()} de ${n} trossos fets…`);
  if (typeof saved.parts[0] !== 'string') await doChunk(0);
  const todo = [];
  for (let i = 1; i < n; i++) if (typeof saved.parts[i] !== 'string') todo.push(i);
  let next = 0, failure = null;
  const worker = async () => {
    while (next < todo.length && !failure) {
      const i = todo[next++];
      try { await doChunk(i); } catch (e) { failure = failure || e; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (failure) throw failure; // la feina feta queda desada: es reprèn pels trossos que falten
  const text = saved.parts.map((t, i) => (m.textOnly || !t || i === 0 ? t : `[${fmtClock(Math.round(cuts[i] / rate * 1000))}]\n${t}`)).filter(Boolean).join('\n\n');
  delete m.importParts[f.key];
  return text;
}

async function importFiles(list, { textOnly = false } = {}) {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); return; }
  if (!list.length) return;
  if (list.length > 30) { toast('Com a màxim 30 fitxers alhora.', 5000); return; }
  const big = list.find((f) => f.size > 1.9e9);
  if (big) { toast(`«${big.name}» és massa gran (màxim 2 GB).`, 5000); return; }
  // Ordre: pel nom (les notes de veu porten la data i l'hora al nom).
  const files = list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const id = uid();
  if (files.length > 2) toast(`Preparant ${files.length} fitxers…`, 3000);
  const durations = [];
  for (const f of files) durations.push(await mediaDuration(f));
  const title = $('#meeting-title').value.trim()
    || (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '');
  const m = {
    id,
    title,
    context: $('#meeting-context').value.trim(),
    group: $('#meeting-group').value.trim(),
    startedAt: Math.min(...files.map((f) => f.lastModified || Date.now())),
    createdAt: Date.now(),
    durationMs: durations.reduce((a, b) => a + b, 0),
    engine: 'import',
    textOnly,
    reviewFor: reviewForm(),
    agenda: settings.lastType === 'important' ? $('#meeting-agenda').value.trim() : '',
    importFiles: files.map((f, i) => ({ key: `${id}:import:${i}`, name: f.name, mime: importMime(f), durationMs: durations[i] })),
    importName: files.map((f) => f.name).join(', ').slice(0, 200),
    type: settings.lastType || 'general',
    status: 'processing',
    segments: [],
    marks: [],
    summary: '',
    email: { status: 'pending' },
  };
  try {
    for (let i = 0; i < files.length; i++) await db.put('audio', files[i], m.importFiles[i].key);
    await saveMeeting(m);
  } catch (e) {
    // No deixis àudio orfe si no hi ha prou espai.
    for (const f of m.importFiles) await db.del('audio', f.key).catch(() => {});
    toast(`No s'han pogut desar els fitxers (potser no hi ha prou espai): ${e.message}`, 7000);
    return;
  }
  await attachAgendaPhotos(m);
  $('#meeting-title').value = ''; $('#meeting-context').value = ''; $('#meeting-group').value = ''; $('#meeting-agenda').value = '';
  viewingId = m.id;
  showView('proc');
  updateProcView(m);
  runPipeline(m.id);
}
$('#btn-import').onclick = () => $('#import-input').click();
$('#btn-voicememo').onclick = () => openSheet('#voicememo-sheet');
$('#btn-voicememo-import').onclick = () => { closeSheets(); $('#import-input').click(); };
if ($('#voicememo-tip')) $('#voicememo-tip').hidden = !IS_IOS;
let pendingImport = [], importKind = 'audio';
$('#import-input').onchange = (e) => {
  importKind = 'audio';
  pendingImport = [...e.target.files];
  e.target.value = '';
  if (!pendingImport.length) return;
  $('#import-sheet-title').textContent = pendingImport.length > 1 ? `Què vols fer amb els ${pendingImport.length} àudios?` : "Què vols fer amb l'àudio?";
  openSheet('#import-sheet');
};
function importChosen(textOnly) {
  closeSheets();
  const files = pendingImport;
  pendingImport = [];
  if (importKind === 'notes') importNotes(files, { textOnly }); else importFiles(files, { textOnly });
  importKind = 'audio';
}
$('#btn-import-summary').onclick = () => importChosen(false);
$('#btn-import-text').onclick = () => importChosen(true);

// Fotos d'apunts o PDF sense àudio: se'n treu el text i se'n fa el resum.
$('#btn-notes').onclick = () => $('#notes-input').click();
$('#notes-input').onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (files.length > MAX_PHOTOS) toast(`Com a màxim ${MAX_PHOTOS} documents: agafo els ${MAX_PHOTOS} primers.`, 5000);
  importKind = 'notes';
  pendingImport = files.slice(0, MAX_PHOTOS);
  $('#import-sheet-title').textContent = pendingImport.length > 1 ? `Què vols fer amb els ${pendingImport.length} documents?` : 'Què vols fer amb el document?';
  openSheet('#import-sheet');
};
async function importNotes(files, { textOnly = false } = {}) {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); return; }
  if (!files.length) return;
  const id = uid();
  const m = {
    id, title: $('#meeting-title').value.trim(),
    context: $('#meeting-context').value.trim(),
    group: $('#meeting-group').value.trim(),
    startedAt: Date.now(), createdAt: Date.now(), durationMs: 0,
    engine: 'docs', textOnly,
    type: ['important', 'revisio'].includes(settings.lastType) ? 'general' : (settings.lastType || 'general'),
    status: 'processing', segments: [], marks: [], summary: '', email: { status: 'pending' }, photos: [],
  };
  await saveMeeting(m);
  const n = await addPhotos(m, files, null);
  if (!n) { await db.del('meetings', id); meetingCache.delete(id); toast("No s'ha pogut llegir cap document."); return; }
  await attachAgendaPhotos(m);
  $('#meeting-title').value = ''; $('#meeting-context').value = ''; $('#meeting-group').value = '';
  viewingId = m.id;
  showView('proc');
  updateProcView(m);
  runPipeline(m.id);
}

// ---------------------------------------------------------------------------
// Vídeos de YouTube: Gemini els escolta directament (han de ser públics o «no llistats»)
// ---------------------------------------------------------------------------
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/i;
function youtubeUrl(text) {
  const mt = (text || '').trim().match(YT_RE);
  return mt ? `https://www.youtube.com/watch?v=${mt[1]}` : null;
}
const YT_CHUNK_S = 15 * 60; // trossos de 15 minuts (a resolució baixa, ~100 «tokens» per segon)
async function transcribeYoutube(m, f, prompt, clean, progress) {
  f.ytParts = f.ytParts || [];
  for (let i = f.ytParts.length; i < 16; i++) { // fins a 4 hores
    if (f.ytEnded) break;
    const from = i * YT_CHUNK_S, to = from + YT_CHUNK_S;
    progress(`Escoltant el vídeo (${fmtClock(from * 1000)} – ${fmtClock(to * 1000)})…`);
    let t;
    try {
      t = await gemini([
        { fileData: { fileUri: f.youtube }, videoMetadata: { startOffset: `${from}s`, endOffset: `${to}s` } },
        { text: `${prompt}\nÉs un vídeo: transcriu només el que es diu (la veu), no descriguis les imatges.\nAquest fragment comença al minut ${fmtClock(from * 1000)} del vídeo: les marques de temps han de comptar des de l'inici del vídeo.\nSi el vídeo s'acaba dins d'aquest fragment, escriu [final] a l'última línia. Si en aquest punt el vídeo ja s'ha acabat, respon només: [final]` },
      ], { task: 'transcribe', thinking: 0, maxTokens: 65536, mediaRes: 'MEDIA_RESOLUTION_LOW' });
    } catch (e) {
      if (e instanceof FatalError) throw e;
      if (/no ha acceptat/i.test(e.message)) {
        if (i === 0) throw new FatalError("Google no pot obrir aquest vídeo. Ha de ser públic o «no llistat» (no privat) i no pot ser una emissió en directe.");
        f.ytEnded = true; break; // s'ha passat del final del vídeo
      }
      throw e;
    }
    const ended = /\[final\]\s*$/i.test(t);
    const c = clean(t.replace(/\[final\]\s*$/i, ''));
    f.ytParts.push(c);
    if (ended || !c) f.ytEnded = true;
    m.durationMs = Math.max(m.durationMs || 0, ended || !c ? from * 1000 + 60000 : to * 1000);
    await saveMeeting(m);
  }
  const text = f.ytParts.filter(Boolean).join('\n');
  if (!text) throw new FatalError("No s'ha sentit cap veu al vídeo.");
  return text;
}
async function importYoutube(url, { textOnly = false } = {}) {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); return; }
  const id = uid();
  let title = $('#meeting-title').value.trim();
  if (!title) {
    try {
      const r = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {}, 5000);
      if (r.ok) title = ((await r.json()).title || '').slice(0, 150);
    } catch { /* sense títol */ }
  }
  const m = {
    id, title: title || 'Vídeo de YouTube',
    context: $('#meeting-context').value.trim(),
    group: $('#meeting-group').value.trim(),
    startedAt: Date.now(), createdAt: Date.now(), durationMs: 0,
    engine: 'import', textOnly,
    agenda: settings.lastType === 'important' ? $('#meeting-agenda').value.trim() : '',
    importFiles: [{ key: null, youtube: url, name: title || url, mime: 'video/*' }],
    importName: url,
    type: settings.lastType === 'revisio' ? 'general' : (settings.lastType || 'general'),
    status: 'processing', segments: [], marks: [], summary: '', email: { status: 'pending' },
  };
  await saveMeeting(m);
  await attachAgendaPhotos(m);
  $('#meeting-title').value = ''; $('#meeting-context').value = ''; $('#meeting-group').value = ''; $('#meeting-agenda').value = '';
  viewingId = m.id;
  showView('proc');
  updateProcView(m);
  runPipeline(m.id);
}
$('#btn-youtube').onclick = () => { $('#yt-url').value = ''; $('#yt-msg').textContent = ''; openSheet('#yt-sheet'); setTimeout(() => $('#yt-url').focus(), 300); };
function ytGo(textOnly) {
  const url = youtubeUrl($('#yt-url').value);
  if (!url) { $('#yt-msg').textContent = "Això no sembla un enllaç de YouTube (p. ex. https://youtu.be/…)."; return; }
  closeSheets();
  importYoutube(url, { textOnly });
}
$('#btn-yt-summary').onclick = () => ytGo(false);
$('#btn-yt-text').onclick = () => ytGo(true);

// ---------------------------------------------------------------------------
// Etiquetes automàtiques (per trobar les reunions més fàcilment)
// ---------------------------------------------------------------------------
const normTag = (t) => String(t || '').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/g, '-').slice(0, 30);
async function autoTag(m) {
  try {
    const counts = {};
    for (const x of await db.all('meetings')) for (const t of x.tags || []) counts[t] = (counts[t] || 0) + 1;
    const known = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t);
    const raw = await gemini([{ text: `Proposa etiquetes per classificar aquesta reunió: d'1 a 3 paraules clau curtes en català i en minúscula (temes, clients, projectes), que surtin realment de l'acta.${known.length ? `\nSi alguna d'aquestes etiquetes que ja fa servir l'usuari hi encaixa, fes-la servir tal qual: ${known.join(', ')}` : ''}\nRespon NOMÉS amb JSON: {"etiquetes":["…"]}\n\n<acta>\n${(m.summary || '').slice(0, 12000)}\n</acta>` }], { task: 'transcribe', thinking: 0, maxTokens: 200, json: true });
    const list = JSON.parse(raw.replace(/^```(?:json)?\s*|```\s*$/g, '')).etiquetes;
    m.tags = [...new Set((Array.isArray(list) ? list : []).map(normTag).filter(Boolean))].slice(0, 3);
    await saveMeeting(m);
  } catch (e) { /* no és imprescindible */ }
}
function renderResultTags(m) {
  const box = $('#result-tags');
  box.innerHTML = (m.tags || []).map((t) => `<button type="button" class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('');
  box.hidden = !(m.tags || []).length;
  box.querySelectorAll('.tag').forEach((b) => { b.onclick = () => { historyFilter = { kind: 'tag', value: b.dataset.tag }; showView('history'); }; });
}
$('#btn-set-tags').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (!m) return;
  const v = prompt("Etiquetes d'aquesta reunió (separades per comes). Deixa-ho buit per treure-les.", (m.tags || []).join(', '));
  if (v === null) return;
  m.tags = [...new Set(v.split(',').map(normTag).filter(Boolean))].slice(0, 8);
  await saveMeeting(m);
  syncSoon();
  renderResultTags(m);
  $('#tags-current').textContent = m.tags.length ? m.tags.map((t) => `#${t}`).join(' ') : 'cap';
};
