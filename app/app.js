/* Xiu-xiu — grava, transcriu, resumeix i envia per correu. */
'use strict';
const APP_VERSION = 23;

// ---------------------------------------------------------------------------
// Configuració
// ---------------------------------------------------------------------------
const DEFAULTS = {
  email: '',
  scriptUrl: '',
  scriptSecret: '',
  engine: 'audio', // 'audio' = Gemini escolta l'àudio · 'device' = dictat del mòbil
  geminiKey: '',
  lang: 'auto',
  extra: '',
  liveSec: 60, // cada quants segons apareix text nou en directe
  speakers: true, // identifica qui parla a partir de les presentacions inicials
  v: 2,
  keepAudio: false,
};

function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') }; }
  catch { s = { ...DEFAULTS }; }
  if (s.engine !== 'device') s.engine = 'audio';
  if (!s.v || s.v < 2) { s.liveSec = 60; s.v = 2; } // trams més llargs: la quota gratuïta és limitada
  delete s.geminiModel;
  return s;
}
let settings = loadSettings();
function saveSettings(s) {
  settings = { ...settings, ...s };
  localStorage.setItem('settings', JSON.stringify(settings));
}
const emailEnabled = () => !!(settings.scriptUrl && settings.scriptSecret);
function missingSetup() {
  const miss = [];
  if (!settings.geminiKey) miss.push('clau de Gemini');
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

// Instruccions diferents per a iPhone (Safari) i Android (Chrome).
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const TXT = IS_IOS ? {
  micDenied: 'Cal donar permís al micròfon (Ajustos > Apps > Safari > Micròfon > Permetre)',
  noWake: "Aquest iPhone no permet mantenir la pantalla encesa des de la web: posa Ajustos > Pantalla i brillantor > Bloqueig automàtic a «Mai» mentre gravis.",
  dictation: "Dictat de l'iPhone",
} : {
  micDenied: 'Cal donar permís al micròfon: toca la icona ⓘ o el cadenat al costat de l\'adreça > Permisos > Micròfon > Permet',
  noWake: 'Aquest mòbil no permet mantenir la pantalla encesa des de la web: posa Configuració > Pantalla > Temps d\'espera de la pantalla al màxim mentre gravis.',
  dictation: 'Dictat del mòbil',
};

// ---------------------------------------------------------------------------
// Markdown mínim -> HTML (per a l'app i per al correu)
// ---------------------------------------------------------------------------
// Ressalta les marques «[dubte de comprensió]» (text ja escapat).
const DOUBT_STYLE = 'background:#fde68a;color:#78350f;border-radius:4px;padding:0 4px;font-weight:600';
// Una línia de transcripció en HTML: nom de qui parla en negreta + dubtes ressaltats.
function speakerHtml(line) {
  const m = line.match(/^([^:\[\]]{1,40}):\s+(.*)$/);
  if (!m) return markDoubts(escapeHtml(line));
  return `<strong>${escapeHtml(m[1])}:</strong> ${markDoubts(escapeHtml(m[2]))}`;
}
function markDoubts(html) {
  return html.replace(/\[dubte de comprensió[^\]]*\]/gi, (t) => `<mark style="${DOUBT_STYLE}">${t}</mark>`);
}
function inlineMd(s) {
  return markDoubts(escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>'));
}
function mdToHtml(md, style = {}) {
  const st = (tag) => (style[tag] ? ` style="${style[tag]}"` : '');
  const out = [];
  const stack = []; // llistes obertes: {type, indent}
  const closeTo = (indent) => {
    while (stack.length && stack[stack.length - 1].indent > indent) out.push(`</li></${stack.pop().type}>`);
  };
  const closeAll = () => closeTo(-1);
  const item = (type, indent, html) => {
    closeTo(indent);
    const top = stack[stack.length - 1];
    if (top && top.indent === indent && top.type !== type) { out.push(`</li></${stack.pop().type}>`); }
    const cur = stack[stack.length - 1];
    if (!cur || cur.indent < indent) {
      out.push(`<${type}${st(type)}>`);
      stack.push({ type, indent });
    } else {
      out.push('</li>');
    }
    out.push(`<li${st('li')}>${html}`);
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) continue;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeAll();
      const tag = 'h' + m[1].length;
      out.push(`<${tag}${st(tag)}>${inlineMd(m[2])}</${tag}>`);
    } else if ((m = line.match(/^(\s*)[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/))) {
      const box = m[2] ? (m[3].trim() ? '☑ ' : '☐ ') : '';
      item('ul', m[1].replace(/\t/g, '    ').length, box + inlineMd(m[4]));
    } else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
      item('ol', m[1].replace(/\t/g, '    ').length, inlineMd(m[2]));
    } else {
      closeAll();
      out.push(`<p${st('p')}>${inlineMd(line)}</p>`);
    }
  }
  closeAll();
  return out.join('\n');
}

// El mateix resum en text pla ben ordenat (per a l'app de correu del mòbil).
function mdToPlain(md) {
  const out = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    const clean = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S.*?)\*/g, '$1$2');
    if (!line.trim()) continue;
    if ((m = line.match(/^#\s+(.*)$/))) out.push(clean(m[1]).toUpperCase(), '');
    else if ((m = line.match(/^#{2,3}\s+(.*)$/))) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(clean(m[1]).toUpperCase()); }
    else if ((m = line.match(/^(\s*)[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/))) {
      const nested = m[1].length >= 2;
      const mark = m[2] ? (m[3].trim() ? '☑' : '☐') : nested ? '–' : '•';
      out.push(`${nested ? '     ' : ''}${mark} ${clean(m[4])}`);
    } else if ((m = line.match(/^(\s*)(\d+[.)])\s+(.*)$/))) out.push(`${m[1].length >= 2 ? '     ' : ''}${m[2]} ${clean(m[3])}`);
    else out.push(clean(line));
  }
  return out.join('\r\n').replace(/(\r\n){3,}/g, '\r\n\r\n');
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

// Demana al navegador que no esborri les dades.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------------------------------------------------------------------------
// Gemini (Google AI Studio, nivell gratuït): transcripció i resum
// ---------------------------------------------------------------------------
class UnsupportedAudioError extends Error {}
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Flash-Lite té molta més quota gratuïta diària que Flash: el fem servir per a la
// transcripció (moltes peticions) i reservem Flash per al resum (una per reunió).
const GEMINI_MODELS = {
  transcribe: ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'],
  summary: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'],
};
const missingModels = new Set();
const QUOTA_MSG = "S'ha esgotat la quota gratuïta de Gemini d'avui (es renova cap a les 9 del matí). Ho reprendrà sol; si fas moltes reunions, mira «Quota» al README.";

// La quota diària de Google es renova a mitjanit de Califòrnia.
const quotaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
function exhaustedModels() {
  try {
    const q = JSON.parse(localStorage.getItem('quota') || '{}');
    return q.day === quotaDay() ? q.models || [] : [];
  } catch { return []; }
}
// Oblida les quotes esgotades (p. ex. després d'activar la facturació).
function resetQuota() { try { localStorage.removeItem('quota'); } catch { /* res */ } }
function markExhausted(model) {
  const models = [...new Set([...exhaustedModels(), model])];
  try { localStorage.setItem('quota', JSON.stringify({ day: quotaDay(), models })); } catch { /* res */ }
}

const noThinkingCfg = new Set(); // models que no accepten thinkingConfig

// Llegeix una resposta en streaming (SSE) de Gemini i va cridant onText amb el text acumulat.
async function readGeminiStream(res, onText) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', finish = '', blocked = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch { continue; }
      if (data.promptFeedback && data.promptFeedback.blockReason) blocked = data.promptFeedback.blockReason;
      const cand = (data.candidates || [])[0];
      if (!cand) continue;
      if (cand.finishReason) finish = cand.finishReason;
      const piece = ((cand.content && cand.content.parts) || []).filter((pt) => pt.text && !pt.thought).map((pt) => pt.text).join('');
      if (piece) { text += piece; onText(text); }
    }
  }
  if (blocked) throw new Error(`Gemini ha bloquejat la petició (${blocked})`);
  if (!text.trim() && finish && finish !== 'STOP') throw new Error(`Gemini no ha respost (${finish})`);
  return text.trim();
}

// thinking: límit de «pensament» (tokens) per anar més de pressa · onText: resposta en directe
async function gemini(parts, { system, maxTokens = 16384, task = 'summary', thinking = null, onText = null } = {}) {
  const spent = exhaustedModels();
  const models = GEMINI_MODELS[task].filter((x) => !missingModels.has(x) && !spent.includes(x));
  if (!models.length) throw new FatalError(QUOTA_MSG);
  let lastErr;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const hasNext = mi < models.length - 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: maxTokens },
      };
      if (thinking != null && !noThinkingCfg.has(model)) body.generationConfig.thinkingConfig = { thinkingBudget: thinking };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const url = onText
        ? `${GEMINI_URL}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
        : `${GEMINI_URL}${encodeURIComponent(model)}:generateContent`;
      let res;
      try {
        res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.geminiKey },
          body: JSON.stringify(body),
        }, 300000);
      } catch (e) {
        lastErr = new Error('Sense connexió amb Gemini');
        await sleep(3000 * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        if (onText) {
          try { return await readGeminiStream(res, onText); }
          catch (e) {
            if (/bloquejat|no ha respost/.test(e.message)) throw e;
            lastErr = new Error('La connexió amb Gemini s\'ha tallat');
            onText('');
            await sleep(2000);
            continue;
          }
        }
        const data = await res.json();
        if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error(`Gemini ha bloquejat la petició (${data.promptFeedback.blockReason})`);
        const cand = (data.candidates || [])[0];
        const text = ((cand && cand.content && cand.content.parts) || [])
          .filter((pt) => pt.text && !pt.thought).map((pt) => pt.text).join('').trim();
        if (!text && cand && cand.finishReason && cand.finishReason !== 'STOP') throw new Error(`Gemini no ha respost (${cand.finishReason})`);
        return text;
      }
      const errText = await res.text();
      if (res.status === 404) { missingModels.add(model); lastErr = new Error(`Model ${model} no disponible`); break; }
      if (/API_KEY_INVALID|API key not valid/i.test(errText)) throw new FatalError('La clau de Gemini no és vàlida');
      if (res.status === 403) throw new FatalError(`Gemini ha denegat l'accés: ${errText.slice(0, 160)}`);
      if (res.status === 400 && /thinking/i.test(errText) && body.generationConfig.thinkingConfig) {
        noThinkingCfg.add(model); // aquest model no accepta el límit: torna-ho a provar sense
        continue;
      }
      if (res.status === 400 && /mime|unsupported|audio|inline/i.test(errText) && parts.some((pt) => pt.inlineData)) {
        throw new UnsupportedAudioError(errText.slice(0, 160));
      }
      if (res.status === 429) {
        if (/PerDay|per day/i.test(errText)) { markExhausted(model); lastErr = new FatalError(QUOTA_MSG); break; }
        lastErr = new Error('Gemini: massa peticions seguides');
        // Si hi ha un altre model disponible, no esperis: prova'l ara mateix.
        if (hasNext) break;
        const m = errText.match(/"retryDelay":\s*"(\d+)/);
        await sleep(Math.min(30, m ? Number(m[1]) + 1 : 5 * 2 ** attempt) * 1000);
        continue;
      }
      if (res.status >= 500) { lastErr = new Error(`Gemini ${res.status}`); if (hasNext) break; await sleep(3000 * 2 ** attempt); continue; }
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
    }
  }
  throw lastErr || new Error('Gemini no respon');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Converteix l'àudio a WAV mono 16 kHz, per si Gemini no accepta el format original.
async function toWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close && ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const LANG_NAMES = { ca: 'català', es: 'castellà', en: 'anglès' };
let forceWav = false;

// ref: { blob, text } = àudio de les presentacions (mostra de veus) · isRef: és el tram de presentacions
async function transcribeBlob(blob, idx, prevText, context, { ref = null, isRef = false, speakers = false } = {}) {
  const speakerRules = !speakers ? [
    'Escriu només la transcripció, sense títols, comentaris ni resums. Comença una línia nova cada cop que canviï la persona que parla.',
  ] : isRef ? [
    "Aquest és l'INICI de la reunió: normalment els participants es presenten dient el seu nom.",
    "Escriu només la transcripció, sense títols ni comentaris. Comença cada intervenció en una línia nova amb el nom de qui parla i dos punts (p. ex. «Oriol: …»), fent servir el nom amb què cadascú s'ha presentat. Si algú no ha dit el nom, posa «Persona no identificada:».",
  ] : [
    "Et dono DOS àudios. El PRIMER és l'inici de la reunió, on els participants es presenten" + (ref && ref.text ? ` (transcripció de les presentacions: «${ref.text.slice(0, 700)}»)` : '') + ". Fes-lo servir NOMÉS com a mostra per reconèixer la veu de cada persona: NO el transcriguis.",
    "El SEGON àudio és el tram que has de transcriure.",
    "Escriu només la transcripció del segon àudio, sense títols ni comentaris. Comença cada intervenció en una línia nova amb el nom de qui parla i dos punts (p. ex. «Oriol: …»). Identifica qui parla comparant la veu amb la mostra i ajudant-te del context (si algú diu «Montse, tu faràs…», qui respon probablement és la Montse).",
    "Fes servir només noms de persones que s'hagin presentat. Si no pots saber amb seguretat qui parla, posa «Persona no identificada:».",
  ];
  const prompt = [
    isRef || !ref
      ? "Transcriu literalment aquest àudio, que és un tram d'una reunió gravada amb un mòbil damunt la taula."
      : "Transcriu literalment un tram d'una reunió gravada amb un mòbil damunt la taula.",
    settings.lang === 'auto'
      ? "Pot ser en català, en castellà o barrejat: escriu cada intervenció en l'idioma en què es parla, sense traduir."
      : `L'idioma principal és el ${LANG_NAMES[settings.lang]}; no tradueixis les intervencions en altres idiomes.`,
    ...speakerRules,
    "Si no hi ha veu, respon només: [silenci]",
    "MOLT IMPORTANT: no t'inventis mai res. Quan una paraula o frase no s'entengui bé, escriu el que probablement s'ha dit seguit de [dubte de comprensió]. Si un fragment no s'entén gens, escriu només [dubte de comprensió] en aquell punt. Exemple: «quedem dijous [dubte de comprensió] a les deu».",
    context ? `Context de la reunió (per escriure bé noms i termes): ${context}` : '',
    prevText ? `Final del tram anterior (només per continuïtat, no el repeteixis): «${prevText.slice(-300)}»` : '',
  ].filter(Boolean).join('\n');

  const audioPart = async (b) => ({ inlineData: { mimeType: (b.type || 'audio/mp4').split(';')[0], data: await blobToBase64(b) } });
  const send = async (b, r) => gemini([
    ...(r ? [await audioPart(r)] : []),
    await audioPart(b),
    { text: prompt },
  ], { task: 'transcribe', thinking: 0 }); // transcriure no requereix «pensar»: més ràpid
  const refBlob = ref && ref.blob ? ref.blob : null;
  let text;
  if (!forceWav) {
    try { text = await send(blob, refBlob); }
    catch (e) {
      if (!(e instanceof UnsupportedAudioError)) throw e;
      forceWav = true;
    }
  }
  if (text === undefined) text = await send(await toWav(blob), refBlob ? await toWav(refBlob) : null);
  text = text.trim();
  return /^\[silenci\]$/i.test(text) ? '' : text;
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
        const isRef = !!m.speakers && seg.idx === m.refIdx;
        let ref = null;
        if (m.speakers && m.refIdx != null && !isRef) {
          const refSeg = m.segments.find((s) => s.idx === m.refIdx);
          const refBlob = await db.get('audio', audioKey(m.id, m.refIdx));
          if (refBlob) ref = { blob: refBlob, text: refSeg && refSeg.text };
        }
        try {
          seg.text = await transcribeBlob(blob, seg.idx, prev, m.context, { ref, isRef, speakers: !!m.speakers });
          seg.status = 'done';
          delete seg.error;
          // L'àudio de les presentacions es guarda fins al final: és la mostra de veus.
          if (!settings.keepAudio && !isRef) await db.del('audio', audioKey(m.id, seg.idx));
        } catch (e) {
          seg.status = 'error';
          seg.error = e.message;
          await saveMeeting(m);
          if (e instanceof FatalError) { updateRecProgress(); throw e; }
        }
        await saveMeeting(m);
        if (rec.meeting === m) updateRecProgress();
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
// Resum
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `Ets un secretari de reunions excel·lent. Reps la transcripció automàtica d'una reunió (gravada amb un mòbil damunt la taula) i n'has de fer l'acta-resum.

La transcripció pot indicar qui parla al principi de cada línia («Nom: …»), identificat per la veu a partir de les presentacions de l'inici. Fes-ho servir per atribuir a cada persona les seves opinions, propostes, decisions i, sobretot, les TASQUES (qui s'encarrega de què). Si una línia diu «Persona no identificada» o no hi ha noms, dedueix pel context qui diu què només quan sigui raonablement clar; si no, no atribueixis la tasca a ningú i afegeix-hi [dubte de comprensió]. La transcripció pot tenir errors de reconeixement: corregeix errors evidents i no t'inventis res.

La transcripció marca amb [dubte de comprensió] les parts que no s'han entès bé. Si un nom, xifra, data o idea que poses al resum ve d'una part marcada, o te'n falta informació per entendre-la, afegeix-hi just al costat [dubte de comprensió]. No elimines aquests dubtes ni els resolguis inventant.

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

## Dubtes de comprensió
- Llista breu dels punts on la transcripció no era clara i que poden afectar el resum (què no s'ha entès i en quin tema). Si no n'hi ha cap, escriu "- Cap."

Si una secció no té contingut, escriu "- Cap." Sigues concret i útil: el lector no ha assistit a la reunió i ha de poder actuar amb aquest resum. No afegeixis cap text abans del títol ni després de l'última secció.`;

function buildTranscript(m) {
  if (m.engine === 'device') return (m.liveText || '').trim();
  return m.segments
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .filter((s) => s.status === 'done' && s.text)
    .reduce((acc, s) => {
      const t = s.startMs || 0;
      if (acc.lastMark === null || t - acc.lastMark >= 300000) {
        acc.lastMark = t;
        acc.out.push(`\n[${fmtClock(t)}]`);
      }
      acc.out.push(s.text);
      return acc;
    }, { out: [], lastMark: null }).out
    .join('\n').trim();
}

// ---------------------------------------------------------------------------
// Fotos de documents
// ---------------------------------------------------------------------------
const MAX_PHOTOS = 15;
async function prepImage(file) {
  let src;
  try { src = await createImageBitmap(file); } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No s'ha pogut llegir la foto"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const scale = Math.min(1, 1800 / Math.max(w, h)); // prou per llegir lletra manuscrita
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.82));
}
async function addPhotos(m, files, atMs) {
  m.photos = m.photos || [];
  let added = 0;
  for (const f of files) {
    if (m.photos.length >= MAX_PHOTOS) { toast(`Màxim ${MAX_PHOTOS} fotos per reunió`); break; }
    try {
      const blob = await prepImage(f);
      const key = `${m.id}:img:${uid()}`;
      await db.put('audio', blob, key);
      m.photos.push({ key, atMs });
      added++;
    } catch (e) { toast(e.message); }
  }
  await saveMeeting(m);
  return added;
}
const photoUrls = new Map();
async function renderPhotos(m, box) {
  box.textContent = '';
  for (const ph of m.photos || []) {
    let url = photoUrls.get(ph.key);
    if (!url) {
      const blob = await db.get('audio', ph.key);
      if (!blob) continue;
      url = URL.createObjectURL(blob);
      photoUrls.set(ph.key, url);
    }
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.className = 'thumb';
    const img = document.createElement('img');
    img.src = url; img.alt = 'Foto de document';
    a.appendChild(img);
    if (ph.atMs != null) { const t = document.createElement('span'); t.textContent = fmtClock(ph.atMs); a.appendChild(t); }
    box.appendChild(a);
  }
}

async function summarize(m, onText = null) {
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

  // Fotos de documents (p. ex. notes escrites a mà) com a context.
  const photoParts = [];
  const photos = (m.photos || []).slice(0, MAX_PHOTOS);
  for (const ph of photos) {
    const blob = await db.get('audio', ph.key);
    if (blob) photoParts.push({ inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(blob) } });
  }
  if (photoParts.length) {
    info.push(`S'adjunten ${photoParts.length} foto${photoParts.length > 1 ? 's' : ''} de documents mostrats o comentats a la reunió (sovint escrits a mà), en aquest ordre: ${photos.map((ph, i) => `foto ${i + 1}${ph.atMs != null ? ` (feta al minut ${fmtClock(ph.atMs)} de la reunió)` : " (afegida després de la reunió)"}`).join(', ')}.
Llegeix-les amb atenció i fes-les servir per entendre de què es parla (xifres, noms, llistes, esquemes) i relaciona-les amb el que es deia en aquell moment. Afegeix una secció «## Documents comentats» just abans de «## Dubtes de comprensió», amb què conté cada document i com s'ha fet servir a la reunió. Si alguna part escrita a mà no es llegeix bé, no t'ho inventis: marca-ho amb [dubte de comprensió].`);
  }

  const text = await gemini(
    [{ text: `${info.join('\n')}\n\n<transcripcio>\n${transcript}\n</transcripcio>` }, ...photoParts],
    { system: SYSTEM_PROMPT, maxTokens: 16384, thinking: 2048, onText },
  );
  const clean = text.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!clean) throw new Error('Gemini ha retornat un resum buit');
  return clean;
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

// Extreu les tasques de la secció «Tasques» del resum, per a la pestanya del full de càlcul.
function parseTasks(md) {
  const tasks = [];
  let inTasks = false;
  for (const line of (md || '').split('\n')) {
    if (/^##\s+/.test(line)) { inTasks = /^##\s+Tasques/i.test(line); continue; }
    if (!inTasks) continue;
    const m = line.match(/^\s*[-*]\s+(?:\[[ xX]?\]\s*)?(.+)$/);
    if (!m || /^cap\.?$/i.test(m[1].trim())) continue;
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

function buildEmail(m) {
  const title = summaryTitle(m);
  const when = fmtDate(m.startedAt);
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:680px">
<p style="margin:0 0 14px;color:#64748b;font-size:13px">${escapeHtml(when)} · ${escapeHtml(fmtDuration(m.durationMs || 0))}</p>
${mdToHtml(m.summary, EMAIL_STYLE)}
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">Transcripció completa adjunta. Generat automàticament per Xiu-xiu.</p>
</div>`;
  return {
    subject: `Resum: ${title} (${new Date(m.startedAt).toLocaleDateString('ca-ES')})`,
    html,
    text: m.summary,
    transcript: buildTranscript(m),
    filename: `transcripcio-${new Date(m.startedAt).toISOString().slice(0, 10)}.txt`,
    // Per al full de càlcul
    id: m.id,
    date: new Date(m.startedAt).toISOString(),
    title,
    durationMin: Math.round((m.durationMs || 0) / 60000),
    summary: m.summary,
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
      // 3. Correu
      if (!emailEnabled()) {
        if (m.email.status !== 'sent') m.email = { status: 'off' };
      } else if (m.email.status !== 'sent') {
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
      if (m.refIdx != null && !settings.keepAudio) await db.del('audio', audioKey(m.id, m.refIdx));
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
  r.onstop = () => finishSegment(r, chunks, segStart, rec.segPeak);
  r.onerror = () => { if (!rec.stopping) recoverMic(); };
  rec.recorder = r;
  rec.segStartMs = segStart;
  rec.segPeak = rec.analyser ? 0 : 1; // sense mesurador, suposem que hi ha veu
  rec.quietMs = 0;
  r.start();
}

let segmentChain = Promise.resolve();
const SILENCE_PEAK = 0.03;
function finishSegment(r, chunks, startMs, peak) {
  const m = rec.meeting;
  const type = r.mimeType || rec.mime || 'audio/mp4';
  segmentChain = segmentChain.then(async () => {
    const blob = new Blob(chunks, { type });
    if (m && peak < SILENCE_PEAK) {
      // Tram en silenci: no cal enviar-lo.
      m.segments.push({ idx: m.segments.length, startMs, status: 'done', text: '', silent: true });
      await saveMeeting(m);
    } else if (blob.size > 2000 && m) {
      const idx = m.segments.length;
      await db.put('audio', blob, audioKey(m.id, idx));
      m.segments.push({ idx, startMs, status: 'pending', text: '' });
      if (m.speakers && m.refIdx == null) { m.refIdx = idx; updateIntroButton(); }
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
  if (!SR) throw new Error("Aquest navegador no té dictat. Tria el motor «Gemini escolta l'àudio».");
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
    renderLive(interim);
  };
  sr.onerror = (e) => { if (e.error === 'not-allowed') toast('Cal permetre el micròfon i el reconeixement de veu', 5000); };
  sr.onend = () => { if (rec.meeting && !rec.stopping && !rec.paused) { try { sr.start(); } catch { /* ja actiu */ } } };
  sr.start();
  rec.speech = sr;
}

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
    speakers: settings.engine !== 'device' && settings.speakers !== false,
    status: 'recording',
    segments: [],
    marks: [],
    summary: '',
    email: { status: 'pending' },
  };

  try {
    if (m.engine !== 'device') {
      rec.mime = pickMime();
      if (rec.mime === null) throw new Error('Aquest navegador no pot gravar àudio');
      await openMic();
    }
    Object.assign(rec, { meeting: m, activeMs: 0, paused: false, stopping: false, levels: [] });
    await saveMeeting(m);
    if (m.engine !== 'device') startSegment(); else startSpeech();
  } catch (e) {
    rec.meeting = null;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    toast(denied ? TXT.micDenied : e.message, 7000);
    return;
  }

  const hasWake = await requestWakeLock();
  $('#rec-warning').hidden = false;
  if (!hasWake) $('#rec-warning').textContent = TXT.noWake;
  $('#rec-title').textContent = m.title || fmtDate(m.startedAt);
  $('#btn-pause').textContent = 'Pausa';
  setRecStateUi();
  showView('rec');
  renderLive();
  updateIntroButton();
  $('#photo-count').textContent = '';
  rec.lastTick = performance.now();
  rec.tickTimer = setInterval(tick, 250);
  requestAnimationFrame(drawMeter);
}

function readLevel() {
  if (!rec.analyser) return 0;
  const buf = new Float32Array(rec.analyser.fftSize);
  rec.analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buf.length) * 6);
}

function tick() {
  const now = performance.now();
  const dt = now - rec.lastTick;
  if (!rec.paused) rec.activeMs += dt;
  rec.lastTick = now;
  $('#timer').textContent = fmtClock(rec.activeMs);
  if (rec.meeting.engine !== 'device' && !rec.paused) {
    // Talla el tram en una pausa de la conversa, perquè no es parteixin paraules.
    const level = readLevel();
    rec.segPeak = Math.max(rec.segPeak || 0, level);
    rec.avgLevel = rec.avgLevel == null ? level : rec.avgLevel * 0.97 + level * 0.03;
    rec.quietMs = level < Math.max(0.02, rec.avgLevel * 0.5) ? (rec.quietMs || 0) + dt : 0;
    const minMs = Math.max(10, Number(settings.liveSec) || DEFAULTS.liveSec) * 1000;
    const elapsed = rec.activeMs - rec.segStartMs;
    if (elapsed >= minMs * 2 || (elapsed >= minMs && rec.quietMs >= 600)) {
      rec.segStartMs = rec.activeMs; // evita rotacions repetides mentre s'atura
      rotateSegment();
    }
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
  if (rec.meeting.engine !== 'device') {
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
    if (m.engine !== 'device') {
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

// Botó «Presentacions fetes»: visible fins que hi ha mostra de veus.
function updateIntroButton() {
  const m = rec.meeting;
  $('#btn-intro').hidden = !(m && m.speakers && m.refIdx == null);
}

function addMark() {
  if (!rec.meeting) return;
  rec.meeting.marks.push(Math.round(rec.activeMs));
  saveMeeting(rec.meeting);
  toast(`Moment marcat a ${fmtClock(rec.activeMs)}`);
}

function updateRecProgress() {
  const m = rec.meeting;
  if (!m || m.engine === 'device') return;
  const err = m.segments.find((s) => s.status === 'error');
  $('#rec-progress').textContent = err ? `⚠ ${err.error}` : '';
  renderLive();
}

// Transcripció en directe a la pantalla de gravació.
function renderLive(interim = '') {
  const m = rec.meeting;
  const box = $('#live-text');
  if (!m) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.textContent = '';
  const add = (text, cls) => {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.innerHTML = speakerHtml(text);
    box.appendChild(p);
  };
  if (m.engine === 'device') {
    if (m.liveText) add(m.liveText);
    if (interim) add(interim, 'interim');
  } else {
    m.segments.slice().sort((a, b) => a.idx - b.idx).forEach((s) => {
      if (s.status === 'done' && s.text) s.text.split('\n').filter(Boolean).forEach((l) => add(l));
    });
    if (m.segments.some((s) => s.status === 'pending')) add('Transcrivint…', 'interim');
  }
  if (!box.firstChild) add('El text apareixerà aquí mentre parleu.', 'placeholder');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function drawMeter() {
  const c = $('#meter');
  if (!rec.meeting || currentView !== 'rec') return;
  const ctx = c.getContext('2d');
  rec.levels.push(rec.paused ? 0 : readLevel());
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
  if (rec.meeting.engine !== 'device' && !rec.paused) {
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
  if (m.stage !== 'summary') { $('#proc-summary').hidden = true; $('#proc-summary').innerHTML = ''; }
  $('#proc-title').textContent = m.title || 'Processant la reunió…';
  const total = m.segments.length;
  const done = m.segments.filter((s) => s.status === 'done').length;
  const segErr = m.segments.find((s) => s.status === 'error');
  if (m.engine === 'device') setStep('step-transcribe', 'done', TXT.dictation);
  else if (total && done === total) setStep('step-transcribe', 'done', `${total} trams`);
  else if (segErr && m.status === 'error') setStep('step-transcribe', 'error', segErr.error);
  else setStep('step-transcribe', 'active', total ? `${done} de ${total} trams` : 'Preparant…');

  if (m.summary) setStep('step-summary', 'done', 'Fet');
  else if (m.stage === 'summary') setStep('step-summary', m.status === 'error' ? 'error' : 'active', m.status === 'error' ? m.error : 'Escrivint el resum…');
  else setStep('step-summary', '', '');

  $('#step-email').hidden = m.email.status === 'off' || (!emailEnabled() && m.email.status !== 'sent');
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
    $('#btn-retry').onclick = () => { resetQuota(); showView('proc'); updateProcView(m); runPipeline(id); };
  } else if (m.email.status === 'off') {
    st.className = 'banner ok';
    st.textContent = '✓ Resum llest';
  } else if (m.email.status === 'sent') {
    st.className = m.email.confirmed === false ? 'banner warn' : 'banner ok';
    st.textContent = m.email.confirmed === false
      ? `No s'ha pogut confirmar que el correu hagi sortit: l'script de Google no ha respost. Revisa l'URL i que estigui publicat per a «Qualsevol», i toca «Torna a enviar».`
      : `✓ Resum enviat a ${settings.email}`;
  } else {
    st.className = 'banner warn';
    st.textContent = `No s'ha pogut enviar el correu: ${m.email.error || 'pendent'}. Toca «Torna a enviar».`;
  }
  $('#result-summary').innerHTML = m.summary ? mdToHtml(m.summary) : '<p>Encara no hi ha resum.</p>';
  $('#result-transcript').innerHTML = (buildTranscript(m) || '(buida)').split('\n').map(speakerHtml).join('\n');
  $('#btn-resend').disabled = !m.summary;
  $('#btn-copy').disabled = !m.summary;
  $('#btn-mail').disabled = !m.summary;
  await renderPhotos(m, $('#result-photos'));
  $('#result-photos-wrap').hidden = false;
  $('#btn-share').disabled = !m.summary;
  $('#share-panel').hidden = true;
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
    else if (m.email && m.email.status === 'sent' && m.email.confirmed === false) badge = '<span class="badge warn">Sense confirmar</span>';
    else if (m.email && m.email.status === 'sent') badge = '<span class="badge ok">Enviat</span>';
    else if (m.status === 'done' && m.email && m.email.status === 'error') badge = '<span class="badge warn">No enviat</span>';
    li.innerHTML = `<button class="item"><div class="t">${escapeHtml(m.summary ? summaryTitle(m) : (m.title || 'Reunió'))}${badge}</div>
      <div class="m">${escapeHtml(fmtDate(m.startedAt))} · ${escapeHtml(fmtDuration(m.durationMs || 0))}</div></button>
      <div class="row-actions"><button class="btn ghost small" data-del>Esborra</button></div>`;
    li.querySelector('.item').onclick = () => showResult(m.id);
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Esborrar aquesta reunió i el seu àudio?')) return;
      for (const s of m.segments || []) await db.del('audio', audioKey(m.id, s.idx));
      for (const ph of m.photos || []) await db.del('audio', ph.key);
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
  const pending = all.filter((m) => m.status === 'error' || (m.status === 'done' && m.email.status === 'error'));
  const working = all.filter((m) => pipelines.has(m.id));
  const b = $('#pending-banner');
  if (working.length) {
    b.hidden = false; b.className = 'banner';
    b.textContent = `Processant ${working.length} reunió${working.length > 1 ? 'ns' : ''} en segon pla…`;
  } else if (pending.length) {
    b.hidden = false; b.className = 'banner warn';
    b.innerHTML = `${pending.length} reunió${pending.length > 1 ? 'ns' : ''} amb problemes. <button class="link" data-goto="history">Revisa-les</button>`;
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
  $('#set-gemini-key').value = settings.geminiKey;
  $('#set-lang').value = settings.lang;
  $('#set-extra').value = settings.extra;
  $('#set-segment').value = settings.liveSec;
  $('#set-keep-audio').checked = settings.keepAudio;
  $('#set-speakers').checked = settings.speakers !== false;
  syncEngineFields();
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
    liveSec: Math.min(300, Math.max(10, Number($('#set-segment').value) || DEFAULTS.liveSec)),
    v: 2,
    keepAudio: $('#set-keep-audio').checked,
    speakers: $('#set-speakers').checked,
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
  return { ok: false, msg: `Google ha respost ${res.status}. Torna-ho a provar d'aquí a un moment.` };
}

// Assistent de la pantalla de benvinguda: enganxa, comprova i desa la clau.
async function useWelcomeKey(raw) {
  const msg = $('#welcome-msg');
  const key = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!/^AIza[\w-]{20,}$/.test(key)) {
    msg.textContent = key ? 'Això no sembla una clau de Google (ha de començar per «AIza»).' : 'Primer copia la clau a la pàgina de Google.';
    return;
  }
  msg.textContent = 'Comprovant la clau…';
  const r = await checkGeminiKey(key);
  if (!r.ok) { msg.textContent = `✗ ${r.msg}`; return; }
  saveSettings({ geminiKey: key });
  resetQuota();
  msg.textContent = '';
  $('#welcome-key').value = '';
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
$('#welcome-key').oninput = (e) => { if (/^\s*AIza[\w-]{20,}\s*$/.test(e.target.value)) useWelcomeKey(e.target.value); };

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
// Esdeveniments
// ---------------------------------------------------------------------------
$('#btn-record').onclick = startRecording;
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
    if (n) toast('Foto afegida. Toca «Refés el resum» perquè la tingui en compte.', 4500);
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
document.querySelector('.topbar h1').onclick = () => showView('home');
$('#btn-new').onclick = () => showView('home');
// ---------------------------------------------------------------------------
// Enviar el resum a altres persones
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
function parseEmails(text) {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}
function recentEmails() {
  try { return JSON.parse(localStorage.getItem('recentEmails') || '[]'); } catch { return []; }
}
function rememberEmails(list) {
  const all = [...new Set([...list, ...recentEmails()])].slice(0, 15);
  try { localStorage.setItem('recentEmails', JSON.stringify(all)); } catch { /* res */ }
}
function renderRecentEmails() {
  const box = $('#share-recent');
  box.textContent = '';
  const current = parseEmails($('#share-to').value);
  for (const e of recentEmails()) {
    if (current.includes(e)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = '+ ' + e;
    b.onclick = () => {
      const v = $('#share-to').value.trim();
      $('#share-to').value = v ? `${v.replace(/[,;\s]+$/, '')}, ${e}` : e;
      renderRecentEmails();
    };
    box.appendChild(b);
  }
}
function shareRecipients() {
  const list = parseEmails($('#share-to').value);
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  if (!list.length) { $('#share-msg').textContent = 'Escriu almenys una adreça.'; return null; }
  if (bad.length) { $('#share-msg').textContent = `Adreça no vàlida: ${bad.join(', ')}`; return null; }
  return list;
}
$('#btn-share').onclick = () => {
  const panel = $('#share-panel');
  panel.hidden = !panel.hidden;
  $('#share-msg').textContent = '';
  if (!panel.hidden) { renderRecentEmails(); $('#share-to').focus(); }
};
$('#share-to').oninput = renderRecentEmails;
$('#btn-share-send').onclick = async () => {
  const list = shareRecipients();
  if (!list) return;
  const msg = $('#share-msg');
  if (!emailEnabled()) {
    msg.textContent = "L'enviament automàtic no està configurat: fes servir «Obre al correu del mòbil».";
    return;
  }
  const m = await getMeeting(viewingId);
  const e = buildEmail(m);
  const payload = { subject: e.subject, html: e.html, text: e.text, recipients: list, external: true };
  if ($('#share-transcript').checked) { payload.transcript = e.transcript; payload.filename = e.filename; }
  const btn = $('#btn-share-send');
  btn.disabled = true;
  msg.textContent = 'Enviant…';
  try {
    const r = await sendEmail(payload, { noFallback: true });
    if (!r.data || !Array.isArray(r.data.sentTo)) {
      msg.textContent = "✗ Cal actualitzar l'script de Google perquè pugui enviar a altres adreces (instruccions al README).";
      return;
    }
    rememberEmails(list);
    m.shares = [...(m.shares || []), { to: r.data.sentTo, at: Date.now() }];
    await saveMeeting(m);
    msg.textContent = `✓ Enviat a ${r.data.sentTo.join(', ')}`;
    $('#share-to').value = '';
    renderRecentEmails();
  } catch (err) {
    msg.textContent = `✗ ${err.message}`;
  } finally {
    btn.disabled = false;
  }
};
$('#btn-share-mail').onclick = async () => {
  const list = shareRecipients();
  if (!list) return;
  rememberEmails(list);
  const m = await getMeeting(viewingId);
  const subject = `Resum: ${summaryTitle(m)} (${new Date(m.startedAt).toLocaleDateString('ca-ES')})`;
  location.href = `mailto:${list.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mdToPlain(m.summary))}`;
};

// Obre l'app de correu amb el resum ja escrit (no depèn de l'script de Google).
$('#btn-mail').onclick = async () => {
  const m = await getMeeting(viewingId);
  // Amb l'script de Google configurat: s'envia sol, amb format, sense obrir el correu.
  if (emailEnabled() && settings.email) {
    const btn = $('#btn-mail');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviant…';
    try {
      const r = await sendEmail(buildEmail(m), { noFallback: true });
      m.email = { status: 'sent', at: Date.now(), confirmed: r.confirmed };
      await saveMeeting(m);
      toast(`✓ Resum enviat a ${settings.email}`);
      showResult(m.id);
    } catch (e) {
      toast(`✗ No s'ha pogut enviar: ${e.message}`, 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
    return;
  }
  // Sense script: obre l'app de correu del mòbil amb el resum ja escrit.
  const subject = `Resum: ${summaryTitle(m)} (${new Date(m.startedAt).toLocaleDateString('ca-ES')})`;
  const body = mdToPlain(m.summary);
  location.href = `mailto:${encodeURIComponent(settings.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
$('#btn-copy').onclick = async () => {
  const m = await getMeeting(viewingId);
  // Amb format (per enganxar a un correu) i en text pla com a alternativa.
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;font-size:15px;line-height:1.5">${mdToHtml(m.summary, EMAIL_STYLE)}</div>`;
  const plain = mdToPlain(m.summary);
  try {
    if (window.ClipboardItem && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    toast('Resum copiat amb format. Enganxa\'l al correu.');
  } catch {
    try { await navigator.clipboard.writeText(plain); toast('Resum copiat'); } catch { toast("No s'ha pogut copiar"); }
  }
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  // Quan arriba una versió nova, recarrega (si no s'està gravant).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || rec.meeting) return;
    reloaded = true;
    location.reload();
  });
}
$('#app-version').textContent = `Versió ${APP_VERSION}`;
resumeUnfinished().catch(() => {});
showView('home');
