/* Resums de Reunions — grava, transcriu, resumeix i envia per correu. */
'use strict';

// ---------------------------------------------------------------------------
// Configuració
// ---------------------------------------------------------------------------
const DEFAULTS = {
  email: 'oriol@esportec.cat',
  scriptUrl: '',
  scriptSecret: '',
  engine: 'openai',
  openaiKey: '',
  lang: 'auto',
  anthropicKey: '',
  extra: '',
  sttModel: 'gpt-4o-transcribe',
  claudeModel: 'claude-opus-5-5',
  segmentMin: 5,
  keepAudio: false,
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
let settings = loadSettings();
function saveSettings(s) {
  settings = { ...settings, ...s };
  localStorage.setItem('settings', JSON.stringify(settings));
}
function missingSetup() {
  const miss = [];
  if (!settings.scriptUrl || !settings.scriptSecret) miss.push('correu');
  if (settings.engine === 'openai' && !settings.openaiKey) miss.push('OpenAI');
  if (!settings.anthropicKey) miss.push('Claude');
  return miss;
}

// ---------------------------------------------------------------------------
// Utilitats
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

async function fetchWithTimeout(url, opts = {}, ms = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

class FatalError extends Error {}

// ---------------------------------------------------------------------------
// Markdown mínim -> HTML (per a l'app i per al correu)
// ---------------------------------------------------------------------------
function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}
function mdToHtml(md, style = {}) {
  const st = (tag) => (style[tag] ? ` style="${style[tag]}"` : '');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { closeList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const tag = 'h' + m[1].length;
      out.push(`<${tag}${st(tag)}>${inlineMd(m[2])}</${tag}>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push(`<ul${st('ul')}>`); list = 'ul'; }
      const box = m[1] ? (m[2].trim() ? '☑ ' : '☐ ') : '';
      out.push(`<li${st('li')}>${box}${inlineMd(m[3])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push(`<ol${st('ol')}>`); list = 'ol'; }
      out.push(`<li${st('li')}>${inlineMd(m[1])}</li>`);
    } else {
      closeList();
      out.push(`<p${st('p')}>${inlineMd(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Emmagatzematge (IndexedDB): reunions + trams d'àudio
// ---------------------------------------------------------------------------
const db = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('reunions', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('meetings', { keyPath: 'id' });
          d.createObjectStore('audio');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transacció avortada'));
    });
  }
  return {
    put: (store, val, key) => tx(store, 'readwrite', (s) => s.put(val, key)),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
  };
})();

// Una sola instància en memòria per reunió, perquè gravació i cua no es trepitgin.
const meetingCache = new Map();
async function getMeeting(id) {
  if (meetingCache.has(id)) return meetingCache.get(id);
  const m = await db.get('meetings', id);
  if (m) meetingCache.set(id, m);
  return m;
}
async function saveMeeting(m) {
  meetingCache.set(m.id, m);
  await db.put('meetings', m);
}
const audioKey = (id, idx) => `${id}:${idx}`;

// Demana a Safari que no esborri les dades.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------------------------------------------------------------------------
// Transcripció amb OpenAI (per trams, mentre es grava)
// ---------------------------------------------------------------------------
async function transcribeBlob(blob, idx, prevText, context) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : 'wav';
  const promptParts = [];
  if (context) promptParts.push(context);
  if (prevText) promptParts.push(prevText.slice(-400));
  for (let attempt = 0; attempt < 4; attempt++) {
    const fd = new FormData();
    fd.append('file', blob, `tram-${idx}.${ext}`);
    fd.append('model', settings.sttModel);
    fd.append('response_format', 'json');
    if (settings.lang !== 'auto') fd.append('language', settings.lang);
    if (promptParts.length) fd.append('prompt', promptParts.join('\n'));
    let res;
    try {
      res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.openaiKey}` },
        body: fd,
      }, 180000);
    } catch (e) {
      if (attempt === 3) throw new Error('Sense connexió amb OpenAI');
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      return (data.text || '').trim();
    }
    const body = await res.text();
    if (res.status === 401) throw new FatalError("La clau d'OpenAI no és vàlida");
    if (res.status === 400 && /model/i.test(body)) throw new FatalError(`Model de transcripció no vàlid: ${body.slice(0, 160)}`);
    if (res.status === 429 && /quota|billing/i.test(body)) throw new FatalError("Compte d'OpenAI sense saldo");
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) throw new Error(`OpenAI ${res.status}: ${body.slice(0, 160)}`);
    await sleep(2000 * 2 ** attempt);
  }
}

const queueRunning = new Map(); // meetingId -> Promise
function kickQueue(meetingId) {
  if (queueRunning.has(meetingId)) return queueRunning.get(meetingId);
  const p = (async () => {
    try {
      for (;;) {
        const m = await getMeeting(meetingId);
        const seg = m.segments.find((s) => s.status === 'pending');
        if (!seg) return;
        const blob = await db.get('audio', audioKey(m.id, seg.idx));
        if (!blob) { seg.status = 'error'; seg.error = "No s'ha trobat l'àudio"; await saveMeeting(m); continue; }
        const prev = m.segments.filter((s) => s.idx < seg.idx && s.status === 'done').map((s) => s.text).join(' ');
        try {
          seg.text = await transcribeBlob(blob, seg.idx, prev, m.context);
          seg.status = 'done';
          delete seg.error;
          if (!settings.keepAudio) await db.del('audio', audioKey(m.id, seg.idx));
        } catch (e) {
          seg.status = 'error';
          seg.error = e.message;
          await saveMeeting(m);
          if (e instanceof FatalError) { updateRecProgress(); throw e; }
        }
        await saveMeeting(m);
        updateRecProgress();
        updateProcView(m);
      }
    } finally {
      queueRunning.delete(meetingId);
    }
  })();
  p.catch(() => {});
  queueRunning.set(meetingId, p);
  return p;
}

// ---------------------------------------------------------------------------
// Resum amb Claude
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `Ets un secretari de reunions excel·lent. Reps la transcripció automàtica d'una reunió (gravada amb un mòbil damunt la taula) i n'has de fer l'acta-resum.

La transcripció no identifica qui parla i pot tenir errors de reconeixement: dedueix pel context qui diu què quan sigui raonablement clar, corregeix errors evidents de transcripció i no t'inventis res. Si un nom, xifra o data és dubtós, indica-ho amb "(?)".

Escriu SEMPRE en català, en Markdown, amb exactament aquesta estructura:

# <Títol breu i descriptiu de la reunió>

## Resum
3-6 frases amb el més important: de què s'ha parlat i a què s'ha arribat.

## Punts tractats
- **Tema**: explicació concisa del que s'ha dit, amb arguments i dades rellevants.

## Decisions
- Cada decisió presa, clara i accionable.

## Tasques
- [ ] **Responsable**: tasca concreta — termini (si s'ha dit)

## Temes oberts i propers passos
- Qüestions pendents, dubtes o temes per a la propera reunió.

## Dades clau
- Xifres, imports, dates i noms propis importants esmentats.

Si una secció no té contingut, escriu "- Cap." Sigues concret i útil: el lector no ha assistit a la reunió i ha de poder actuar amb aquest resum. No afegeixis cap text abans del títol ni després de l'última secció.`;

function buildTranscript(m) {
  if (m.engine === 'device') return (m.liveText || '').trim();
  return m.segments
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .filter((s) => s.status === 'done' && s.text)
    .map((s) => `[${fmtClock(s.startMs || 0)}] ${s.text}`)
    .join('\n\n');
}

async function callClaude(body, useFallbacks = true) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.anthropicKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const payload = { ...body };
  if (useFallbacks) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    payload.fallbacks = 'default';
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(payload),
      }, 600000);
    } catch (e) {
      if (attempt === 3) throw new Error('Sense connexió amb Claude');
      await sleep(3000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status === 401) throw new FatalError("La clau d'Anthropic no és vàlida");
    if (res.status === 400 && useFallbacks && /fallback|beta/i.test(text)) return callClaude(body, false);
    if (res.status === 400 && /credit balance/i.test(text)) throw new FatalError("Compte d'Anthropic sense crèdit");
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) throw new Error(`Claude ${res.status}: ${text.slice(0, 200)}`);
    await sleep(3000 * 2 ** attempt);
  }
}

async function summarize(m) {
  const transcript = buildTranscript(m);
  if (!transcript) throw new FatalError("No s'ha captat cap paraula a la gravació");
  const info = [
    `Data: ${fmtDate(m.startedAt)}`,
    `Durada: ${fmtDuration(m.durationMs || 0)}`,
  ];
  if (m.title) info.push(`Títol indicat per l'usuari: ${m.title}`);
  if (m.context) info.push(`Context i assistents: ${m.context}`);
  if (m.marks && m.marks.length) info.push(`L'usuari ha marcat com a moments importants (temps de gravació): ${m.marks.map(fmtClock).join(', ')}. Dona-hi especial atenció.`);
  if (settings.extra) info.push(`Instruccions addicionals de l'usuari: ${settings.extra}`);

  const data = await callClaude({
    model: settings.claudeModel,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${info.join('\n')}\n\n<transcripcio>\n${transcript}\n</transcripcio>`,
    }],
  });
  if (data.stop_reason === 'refusal') throw new Error("Claude no ha pogut resumir aquesta reunió");
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('Claude ha retornat un resum buit');
  return text;
}

// ---------------------------------------------------------------------------
// Enviament per correu (Google Apps Script)
// ---------------------------------------------------------------------------
const EMAIL_STYLE = {
  h1: 'font-size:22px;margin:0 0 12px;color:#0f172a',
  h2: 'font-size:16px;margin:22px 0 6px;color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px',
  h3: 'font-size:15px;margin:14px 0 4px;color:#0f172a',
  p: 'margin:6px 0',
  ul: 'margin:6px 0;padding-left:22px',
  ol: 'margin:6px 0;padding-left:22px',
  li: 'margin:3px 0',
};

function summaryTitle(m) {
  const first = (m.summary || '').split('\n').find((l) => /^#\s+/.test(l));
  return first ? first.replace(/^#\s+/, '').trim() : (m.title || 'Reunió');
}

function buildEmail(m) {
  const title = summaryTitle(m);
  const when = fmtDate(m.startedAt);
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:680px">
<p style="margin:0 0 14px;color:#64748b;font-size:13px">${escapeHtml(when)} · ${escapeHtml(fmtDuration(m.durationMs || 0))}</p>
${mdToHtml(m.summary, EMAIL_STYLE)}
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">Transcripció completa adjunta. Generat automàticament per l'app Reunions.</p>
</div>`;
  return {
    subject: `Resum: ${title} (${new Date(m.startedAt).toLocaleDateString('ca-ES')})`,
    html,
    text: m.summary,
    transcript: buildTranscript(m),
    filename: `transcripcio-${new Date(m.startedAt).toISOString().slice(0, 10)}.txt`,
  };
}

async function sendEmail(payload) {
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
      return { confirmed: true };
    } catch (e) {
      if (e instanceof FatalError) throw e;
      if (e instanceof TypeError && attempt === 2) {
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
    if (redoSummary) { m.summary = ''; m.email = { status: 'pending' }; }
    m.status = 'processing';
    m.error = '';
    await saveMeeting(m);
    updateProcView(m);
    try {
      // 1. Transcripció
      if (m.engine !== 'device') {
        m.segments.forEach((s) => { if (s.status === 'error') s.status = 'pending'; });
        await saveMeeting(m);
        updateProcView(m);
        await kickQueue(id);
        const failed = m.segments.filter((s) => s.status !== 'done');
        if (failed.length) throw new Error(failed[0].error || 'Hi ha trams sense transcriure');
      }
      // 2. Resum
      if (!m.summary) {
        m.stage = 'summary'; updateProcView(m);
        m.summary = await summarize(m);
        await saveMeeting(m);
      }
      // 3. Correu
      if (m.email.status !== 'sent') {
        m.stage = 'email'; updateProcView(m);
        try {
          const r = await sendEmail(buildEmail(m));
          m.email = { status: 'sent', at: Date.now(), confirmed: r.confirmed };
        } catch (e) {
          m.email = { status: 'error', error: e.message };
        }
      }
      m.status = 'done';
      m.stage = '';
      await saveMeeting(m);
    } catch (e) {
      m.status = 'error';
      m.error = e.message;
      await saveMeeting(m);
    } finally {
      pipelines.delete(id);
    }
    updateProcView(m);
    if (currentView === 'proc' && viewingId === id) showResult(id);
    refreshHomeBanners();
    return m;
  })();
  pipelines.set(id, p);
  return p;
}

// ---------------------------------------------------------------------------
// Gravació
// ---------------------------------------------------------------------------
const rec = {
  meeting: null,
  stream: null,
  recorder: null,
  mime: '',
  chunks: [],
  segStartMs: 0,
  activeMs: 0,
  lastTick: 0,
  paused: false,
  stopping: false,
  tickTimer: null,
  wakeLock: null,
  audioCtx: null,
  analyser: null,
  levels: [],
  speech: null,
};

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const opts = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return opts.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      rec.wakeLock = await navigator.wakeLock.request('screen');
      return true;
    }
  } catch { /* no disponible */ }
  return false;
}

async function openMic() {
  rec.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  rec.stream.getAudioTracks().forEach((t) => { t.onended = () => { if (!document.hidden) recoverMic(); }; });
  try {
    if (!rec.audioCtx) rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') await rec.audioCtx.resume();
    const src = rec.audioCtx.createMediaStreamSource(rec.stream);
    rec.analyser = rec.audioCtx.createAnalyser();
    rec.analyser.fftSize = 1024;
    src.connect(rec.analyser);
  } catch { rec.analyser = null; }
}

function startSegment() {
  const options = rec.mime ? { mimeType: rec.mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 };
  const r = new MediaRecorder(rec.stream, options);
  const chunks = [];
  const segStart = rec.activeMs;
  r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  r.onstop = () => finishSegment(r, chunks, segStart);
  r.onerror = () => { if (!rec.stopping) recoverMic(); };
  rec.recorder = r;
  rec.segStartMs = segStart;
  r.start();
}

let segmentChain = Promise.resolve();
function finishSegment(r, chunks, startMs) {
  const m = rec.meeting;
  const type = r.mimeType || rec.mime || 'audio/mp4';
  segmentChain = segmentChain.then(async () => {
    const blob = new Blob(chunks, { type });
    if (blob.size > 2000 && m) {
      const idx = m.segments.length;
      await db.put('audio', blob, audioKey(m.id, idx));
      m.segments.push({ idx, startMs, status: 'pending', text: '' });
      await saveMeeting(m);
      kickQueue(m.id);
      updateRecProgress();
    }
    // Continua amb el següent tram si encara gravem.
    if (rec.meeting === m && !rec.stopping && rec.stream && rec.recorder === r) startSegment();
  });
}

function rotateSegment() {
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
}

async function recoverMic() {
  if (!rec.meeting || rec.stopping || rec.recovering) return;
  rec.recovering = true;
  try {
    const old = rec.recorder;
    if (old && old.state !== 'inactive') { rec.recorder = null; old.stop(); }
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    await segmentChain;
    await openMic();
    if (!rec.paused) startSegment();
    toast('Micròfon reconnectat');
  } catch (e) {
    toast("No s'ha pogut reprendre el micròfon. Toca «Acaba la reunió» per processar el que s'ha gravat.", 6000);
  } finally {
    rec.recovering = false;
  }
}

function startSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("Aquest navegador no té dictat. Fes servir el motor d'OpenAI.");
  const langMap = { auto: 'ca-ES', ca: 'ca-ES', es: 'es-ES', en: 'en-US' };
  const sr = new SR();
  sr.lang = langMap[settings.lang] || 'ca-ES';
  sr.continuous = true;
  sr.interimResults = true;
  sr.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        rec.meeting.liveText = `${rec.meeting.liveText || ''} ${r[0].transcript}`.trim();
        saveMeeting(rec.meeting);
      } else interim += r[0].transcript;
    }
    $('#rec-progress').textContent = interim || lastWords(rec.meeting.liveText);
  };
  sr.onerror = (e) => { if (e.error === 'not-allowed') toast('Cal permetre el micròfon i el reconeixement de veu', 5000); };
  sr.onend = () => { if (rec.meeting && !rec.stopping && !rec.paused) { try { sr.start(); } catch { /* ja actiu */ } } };
  sr.start();
  rec.speech = sr;
}
const lastWords = (t) => (t || '').split(/\s+/).slice(-12).join(' ');

async function startRecording() {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); showView('settings'); return; }

  const m = {
    id: uid(),
    title: $('#meeting-title').value.trim(),
    context: $('#meeting-context').value.trim(),
    startedAt: Date.now(),
    durationMs: 0,
    engine: settings.engine,
    status: 'recording',
    segments: [],
    marks: [],
    summary: '',
    email: { status: 'pending' },
  };

  try {
    if (m.engine === 'openai') {
      rec.mime = pickMime();
      if (rec.mime === null) throw new Error('Aquest navegador no pot gravar àudio');
      await openMic();
    }
    Object.assign(rec, { meeting: m, activeMs: 0, paused: false, stopping: false, levels: [] });
    await saveMeeting(m);
    if (m.engine === 'openai') startSegment(); else startSpeech();
  } catch (e) {
    rec.meeting = null;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    toast(denied ? "Cal donar permís al micròfon (Ajustos > Safari > Micròfon)" : e.message, 6000);
    return;
  }

  const hasWake = await requestWakeLock();
  $('#rec-warning').hidden = false;
  if (!hasWake) $('#rec-warning').textContent = "Aquest iPhone no permet mantenir la pantalla encesa des de la web: posa Ajustos > Pantalla > Bloqueig automàtic a «Mai» mentre gravis.";
  $('#rec-title').textContent = m.title || fmtDate(m.startedAt);
  $('#btn-pause').textContent = 'Pausa';
  setRecStateUi();
  showView('rec');
  rec.lastTick = performance.now();
  rec.tickTimer = setInterval(tick, 250);
  requestAnimationFrame(drawMeter);
}

function tick() {
  const now = performance.now();
  if (!rec.paused) rec.activeMs += now - rec.lastTick;
  rec.lastTick = now;
  $('#timer').textContent = fmtClock(rec.activeMs);
  const segMs = Math.max(1, Number(settings.segmentMin) || 5) * 60000;
  if (rec.meeting.engine === 'openai' && !rec.paused && rec.activeMs - rec.segStartMs >= segMs) {
    rec.segStartMs = rec.activeMs; // evita rotacions repetides mentre s'atura
    rotateSegment();
  }
  // Desa la durada de tant en tant per si es talla.
  if (Math.floor(rec.activeMs / 10000) !== Math.floor((rec.activeMs - 250) / 10000)) {
    rec.meeting.durationMs = rec.activeMs;
    saveMeeting(rec.meeting);
  }
}

function setRecStateUi() {
  const el = $('#rec-state-text').parentElement;
  el.classList.toggle('paused', rec.paused);
  $('#rec-state-text').textContent = rec.paused ? 'En pausa' : 'Gravant';
}

function togglePause() {
  if (!rec.meeting) return;
  rec.paused = !rec.paused;
  if (rec.meeting.engine === 'openai') {
    const r = rec.recorder;
    if (rec.paused && r && r.state === 'recording') r.pause();
    else if (!rec.paused && r && r.state === 'paused') r.resume();
    else if (!rec.paused && rec.stream && (!r || r.state === 'inactive')) startSegment();
  } else if (rec.speech) {
    if (rec.paused) rec.speech.stop(); else { try { rec.speech.start(); } catch { /* ja actiu */ } }
  }
  $('#btn-pause').textContent = rec.paused ? 'Continua' : 'Pausa';
  setRecStateUi();
}

async function stopRecording() {
  if (!rec.meeting || rec.stopping) return;
  rec.stopping = true;
  const m = rec.meeting;
  clearInterval(rec.tickTimer);
  $('#btn-stop').disabled = true;
  try {
    if (m.engine === 'openai') {
      if (rec.recorder && rec.recorder.state !== 'inactive') {
        if (rec.recorder.state === 'paused') rec.recorder.resume();
        rec.recorder.stop();
      }
      await sleep(50);
      await segmentChain;
    } else if (rec.speech) {
      rec.speech.onend = null;
      rec.speech.stop();
      await sleep(800); // deixa arribar els últims resultats
    }
  } finally {
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    if (rec.wakeLock) { rec.wakeLock.release().catch(() => {}); rec.wakeLock = null; }
    Object.assign(rec, { meeting: null, stream: null, recorder: null, speech: null, analyser: null });
    $('#btn-stop').disabled = false;
  }
  m.durationMs = rec.activeMs;
  m.status = 'processing';
  await saveMeeting(m);
  $('#meeting-title').value = '';
  $('#meeting-context').value = '';
  viewingId = m.id;
  showView('proc');
  updateProcView(m);
  runPipeline(m.id);
}

function addMark() {
  if (!rec.meeting) return;
  rec.meeting.marks.push(Math.round(rec.activeMs));
  saveMeeting(rec.meeting);
  toast(`Moment marcat a ${fmtClock(rec.activeMs)}`);
}

function updateRecProgress() {
  const m = rec.meeting;
  if (!m || m.engine !== 'openai') return;
  const done = m.segments.filter((s) => s.status === 'done').length;
  const err = m.segments.find((s) => s.status === 'error');
  $('#rec-progress').textContent = err
    ? `⚠ ${err.error}`
    : done ? `Transcrits ${done} de ${m.segments.length} trams mentre graves` : '';
}

function drawMeter() {
  const c = $('#meter');
  if (!rec.meeting || currentView !== 'rec') return;
  const ctx = c.getContext('2d');
  let level = 0;
  if (rec.analyser && !rec.paused) {
    const buf = new Float32Array(rec.analyser.fftSize);
    rec.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }
  rec.levels.push(level);
  const bars = 60;
  if (rec.levels.length > bars) rec.levels.shift();
  ctx.clearRect(0, 0, c.width, c.height);
  const color = getComputedStyle(document.documentElement).getPropertyValue('--rec').trim() || '#dc2626';
  ctx.fillStyle = color;
  const w = c.width / bars;
  rec.levels.forEach((l, i) => {
    const h = Math.max(4, l * c.height);
    ctx.globalAlpha = 0.35 + 0.65 * (i / bars);
    ctx.fillRect(i * w + 2, (c.height - h) / 2, w - 4, h);
  });
  ctx.globalAlpha = 1;
  requestAnimationFrame(drawMeter);
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !rec.meeting) return;
  if (!rec.wakeLock || rec.wakeLock.released) await requestWakeLock();
  if (rec.audioCtx && rec.audioCtx.state !== 'running') rec.audioCtx.resume().catch(() => {});
  if (rec.meeting.engine === 'openai' && !rec.paused) {
    const trackDead = !rec.stream || rec.stream.getAudioTracks().some((t) => t.readyState === 'ended');
    const recDead = !rec.recorder || rec.recorder.state === 'inactive';
    if (trackDead || recDead) recoverMic();
  }
});
window.addEventListener('beforeunload', (e) => { if (rec.meeting) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------------
// Vistes
// ---------------------------------------------------------------------------
let currentView = 'home';
let viewingId = null;

function showView(name) {
  if (rec.meeting && name !== 'rec') { toast('Primer acaba la reunió'); return; }
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  currentView = name;
  window.scrollTo(0, 0);
  if (name === 'home') refreshHomeBanners();
  if (name === 'history') renderHistory();
  if (name === 'settings') fillSettings();
}

function setStep(id, state, info) {
  const li = $(`#${id}`);
  li.className = state;
  $(`#${id}-info`).textContent = info || '';
}

function updateProcView(m) {
  if (!m || currentView !== 'proc' || viewingId !== m.id) return;
  $('#proc-title').textContent = m.title || 'Processant la reunió…';
  const total = m.segments.length;
  const done = m.segments.filter((s) => s.status === 'done').length;
  const segErr = m.segments.find((s) => s.status === 'error');
  if (m.engine === 'device') setStep('step-transcribe', 'done', "Dictat de l'iPhone");
  else if (total && done === total) setStep('step-transcribe', 'done', `${total} trams`);
  else if (segErr && m.status === 'error') setStep('step-transcribe', 'error', segErr.error);
  else setStep('step-transcribe', 'active', total ? `${done} de ${total} trams` : 'Preparant…');

  if (m.summary) setStep('step-summary', 'done', 'Fet');
  else if (m.stage === 'summary') setStep('step-summary', m.status === 'error' ? 'error' : 'active', m.status === 'error' ? m.error : 'Escrivint el resum…');
  else setStep('step-summary', '', '');

  if (m.email.status === 'sent') setStep('step-email', 'done', settings.email);
  else if (m.email.status === 'error') setStep('step-email', 'error', m.email.error);
  else if (m.stage === 'email') setStep('step-email', 'active', `Enviant a ${settings.email}…`);
  else setStep('step-email', '', '');
}

async function showResult(id) {
  const m = await getMeeting(id);
  if (!m) return;
  viewingId = id;
  if (m.status === 'processing' || pipelines.has(id)) { showView('proc'); updateProcView(m); return; }
  showView('result');
  const st = $('#result-status');
  if (m.status === 'error') {
    st.className = 'banner err';
    st.innerHTML = `No s'ha pogut completar: ${escapeHtml(m.error)} <button class="link" id="btn-retry">Reintenta</button>`;
    $('#btn-retry').onclick = () => { showView('proc'); updateProcView(m); runPipeline(id); };
  } else if (m.email.status === 'sent') {
    st.className = 'banner ok';
    st.textContent = m.email.confirmed === false
      ? `Resum enviat a ${settings.email} (sense confirmació del servidor).`
      : `✓ Resum enviat a ${settings.email}`;
  } else {
    st.className = 'banner warn';
    st.textContent = `No s'ha pogut enviar el correu: ${m.email.error || 'pendent'}. Toca «Torna a enviar».`;
  }
  $('#result-summary').innerHTML = m.summary ? mdToHtml(m.summary) : '<p>Encara no hi ha resum.</p>';
  $('#result-transcript').textContent = buildTranscript(m) || '(buida)';
  $('#btn-resend').disabled = !m.summary;
  $('#btn-copy').disabled = !m.summary;
}

async function renderHistory() {
  const list = (await db.all('meetings')).sort((a, b) => b.startedAt - a.startedAt);
  const ul = $('#history-list');
  ul.innerHTML = '';
  $('#history-empty').hidden = list.length > 0;
  for (const m of list) {
    const li = document.createElement('li');
    let badge = '';
    if (pipelines.has(m.id) || m.status === 'processing') badge = '<span class="badge warn">Processant</span>';
    else if (m.status === 'error') badge = '<span class="badge err">Error</span>';
    else if (m.email && m.email.status === 'sent') badge = '<span class="badge ok">Enviat</span>';
    else if (m.status === 'done') badge = '<span class="badge warn">No enviat</span>';
    li.innerHTML = `<button class="item"><div class="t">${escapeHtml(m.summary ? summaryTitle(m) : (m.title || 'Reunió'))}${badge}</div>
      <div class="m">${escapeHtml(fmtDate(m.startedAt))} · ${escapeHtml(fmtDuration(m.durationMs || 0))}</div></button>
      <div class="row-actions"><button class="btn ghost small" data-del>Esborra</button></div>`;
    li.querySelector('.item').onclick = () => showResult(m.id);
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Esborrar aquesta reunió i el seu àudio?')) return;
      for (const s of m.segments || []) await db.del('audio', audioKey(m.id, s.idx));
      await db.del('meetings', m.id);
      meetingCache.delete(m.id);
      renderHistory();
    };
    ul.appendChild(li);
  }
}

async function refreshHomeBanners() {
  const miss = missingSetup();
  $('#setup-banner').hidden = miss.length === 0;
  const all = await db.all('meetings');
  const pending = all.filter((m) => m.status === 'error' || (m.status === 'done' && m.email.status !== 'sent'));
  const working = all.filter((m) => pipelines.has(m.id));
  const b = $('#pending-banner');
  if (working.length) {
    b.hidden = false; b.className = 'banner';
    b.textContent = `Processant ${working.length} reunió${working.length > 1 ? 'ns' : ''} en segon pla…`;
  } else if (pending.length) {
    b.hidden = false; b.className = 'banner warn';
    b.innerHTML = `${pending.length} reunió${pending.length > 1 ? 'ns' : ''} sense enviar. <button class="link" data-goto="history">Revisa-les</button>`;
  } else b.hidden = true;
}

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
    if (m.status === 'processing' || (m.status === 'done' && m.email.status === 'error')) runPipeline(m.id);
  }
  refreshHomeBanners();
}
window.addEventListener('online', () => resumeUnfinished());

// ---------------------------------------------------------------------------
// Configuració (UI)
// ---------------------------------------------------------------------------
function fillSettings() {
  $('#set-email').value = settings.email;
  $('#set-script-url').value = settings.scriptUrl;
  $('#set-script-secret').value = settings.scriptSecret;
  $('#set-engine').value = settings.engine;
  $('#set-openai-key').value = settings.openaiKey;
  $('#set-lang').value = settings.lang;
  $('#set-anthropic-key').value = settings.anthropicKey;
  $('#set-extra').value = settings.extra;
  $('#set-stt-model').value = settings.sttModel;
  $('#set-claude-model').value = settings.claudeModel;
  $('#set-segment').value = settings.segmentMin;
  $('#set-keep-audio').checked = settings.keepAudio;
  syncEngineFields();
  $('#settings-msg').textContent = '';
}
function readSettingsForm() {
  return {
    email: $('#set-email').value.trim() || DEFAULTS.email,
    scriptUrl: $('#set-script-url').value.trim(),
    scriptSecret: $('#set-script-secret').value.trim(),
    engine: $('#set-engine').value,
    openaiKey: $('#set-openai-key').value.trim(),
    lang: $('#set-lang').value,
    anthropicKey: $('#set-anthropic-key').value.trim(),
    extra: $('#set-extra').value.trim(),
    sttModel: $('#set-stt-model').value.trim() || DEFAULTS.sttModel,
    claudeModel: $('#set-claude-model').value.trim() || DEFAULTS.claudeModel,
    segmentMin: Math.min(10, Math.max(1, Number($('#set-segment').value) || DEFAULTS.segmentMin)),
    keepAudio: $('#set-keep-audio').checked,
  };
}
function syncEngineFields() {
  const eng = $('#set-engine').value;
  document.querySelectorAll('[data-engine]').forEach((el) => { el.hidden = el.dataset.engine !== eng; });
}

async function testKeys() {
  saveSettings(readSettingsForm());
  const msg = $('#settings-msg');
  msg.textContent = 'Comprovant…';
  const results = [];
  if (settings.engine === 'openai') {
    try {
      const r = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${settings.openaiKey}` } }, 20000);
      results.push(r.ok ? 'OpenAI ✓' : `OpenAI ✗ (${r.status})`);
    } catch { results.push('OpenAI ✗ (sense connexió)'); }
  }
  try {
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }, 20000);
    results.push(r.ok ? 'Claude ✓' : `Claude ✗ (${r.status})`);
  } catch { results.push('Claude ✗ (sense connexió)'); }
  msg.textContent = results.join(' · ');
}

async function testEmail() {
  saveSettings(readSettingsForm());
  const msg = $('#settings-msg');
  msg.textContent = 'Enviant correu de prova…';
  try {
    const r = await sendEmail({
      subject: 'Prova: app de Reunions',
      html: '<p>Si reps aquest correu, l\'enviament automàtic de resums funciona correctament. ✅</p>',
      text: "Si reps aquest correu, l'enviament automàtic de resums funciona correctament.",
    });
    msg.textContent = r.confirmed ? `✓ Correu enviat a ${settings.email}` : `Enviat a ${settings.email} (revisa la safata d'entrada)`;
  } catch (e) {
    msg.textContent = `✗ ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// Esdeveniments
// ---------------------------------------------------------------------------
$('#btn-record').onclick = startRecording;
$('#btn-pause').onclick = togglePause;
$('#btn-stop').onclick = () => { if (confirm('Acabar la reunió i fer-ne el resum?')) stopRecording(); };
$('#btn-mark').onclick = addMark;
$('#btn-history').onclick = () => showView('history');
$('#btn-settings').onclick = () => showView('settings');
document.querySelector('.topbar h1').onclick = () => showView('home');
$('#btn-new').onclick = () => showView('home');
$('#btn-copy').onclick = async () => {
  const m = await getMeeting(viewingId);
  try { await navigator.clipboard.writeText(m.summary); toast('Resum copiat'); } catch { toast("No s'ha pogut copiar"); }
};
$('#btn-resend').onclick = async () => {
  const m = await getMeeting(viewingId);
  m.email = { status: 'pending' };
  await saveMeeting(m);
  showView('proc'); updateProcView(m);
  runPipeline(m.id);
};
$('#btn-redo').onclick = async () => {
  if (!confirm('Tornar a generar el resum i enviar-lo de nou?')) return;
  showView('proc');
  runPipeline(viewingId, { redoSummary: true });
  updateProcView(await getMeeting(viewingId));
};
$('#set-engine').onchange = syncEngineFields;
$('#btn-save-settings').onclick = () => {
  saveSettings(readSettingsForm());
  toast('Configuració desada');
  showView('home');
};
$('#btn-test-keys').onclick = testKeys;
$('#btn-test-email').onclick = testEmail;
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) showView(g.dataset.goto);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
resumeUnfinished().catch(() => {});
showView('home');
