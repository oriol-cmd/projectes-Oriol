/* Xiu-xiu — grava, transcriu, resumeix i envia per correu. */
'use strict';
const APP_VERSION = 32;

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
  summaryLang: 'ca', // idioma per defecte dels resums: ca | es | en
  lastType: 'general', // últim tipus de reunió triat
  lastBackup: 0, // data de l'última còpia de seguretat
  source: 'mic', // 'mic' | 'call' (videotrucada a l'ordinador)
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
  return html.replace(/\[(dubte de comprensió|duda de comprensión|unclear)[^\]]*\]/gi, (t) => `<mark style="${DOUBT_STYLE}">${t}</mark>`);
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
// El resum amb el format de WhatsApp (*negreta*, _cursiva_).
function mdToWhatsApp(md) {
  const out = [];
  const bold = (t) => t.replace(/\*\*(.+?)\*\*/g, '*$1*');
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) continue;
    if ((m = line.match(/^#\s+(.*)$/))) out.push(`*${m[1].replace(/\*\*/g, '')}*`, '');
    else if ((m = line.match(/^#{2,3}\s+(.*)$/))) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(`*${m[1].replace(/\*\*/g, '').toUpperCase()}*`); }
    else if ((m = line.match(/^(\s*)[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/))) {
      const nested = m[1].length >= 2;
      const mark = m[2] ? (m[3].trim() ? '☑' : '☐') : nested ? '◦' : '•';
      out.push(`${nested ? '    ' : ''}${mark} ${bold(m[4])}`);
    } else if ((m = line.match(/^(\s*)(\d+[.)])\s+(.*)$/))) out.push(`${m[2]} ${bold(m[3])}`);
    else out.push(bold(line));
  }
  out.push('', '_Resum fet amb Xiu-xiu_');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

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
      if (res.status === 400) {
        // Google sovint respon un genèric «invalid argument». Anem descartant causes:
        // 1) el límit de «pensament» (alguns models no l'accepten)
        if (body.generationConfig.thinkingConfig) { noThinkingCfg.add(model); continue; }
        // 2) el format de l'àudio (es reenvia en WAV)
        const media = (pt) => pt.inlineData || pt.fileData;
        const nonWavAudio = parts.some((pt) => media(pt) && /^(audio|video)\//.test(media(pt).mimeType) && media(pt).mimeType !== 'audio/wav');
        if (nonWavAudio) throw new UnsupportedAudioError(errText.slice(0, 160));
        // 3) el model: prova el següent
        lastErr = new Error(`Google no ha acceptat la petició (${model})`);
        if (hasNext) break;
        throw new Error(`Google no ha acceptat la petició: ${errText.replace(/\s+/g, ' ').slice(0, 160)}`);
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
  if (m.group) info.push(`Grup de treball o projecte: ${m.group}`);
  if (m.source === 'call') info.push("És una videotrucada: s'ha gravat el so de la trucada i el micròfon de l'usuari.");
  if (m.engine === 'import') info.push("La reunió prové d'un fitxer d'àudio o vídeo importat.");
  if (m.type && m.type !== 'general' && MEETING_TYPES[m.type]) {
    info.push(`Tipus de reunió: ${MEETING_TYPES[m.type].label}. ${MEETING_TYPES[m.type].prompt}`);
  }
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

function buildEmail(m, lang = settings.summaryLang || 'ca') {
  const L = L10N[lang] || L10N.ca;
  const md = getSummary(m, lang);
  const title = summaryTitle(m, md);
  const when = new Date(m.startedAt).toLocaleString(L.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const typeLabel = m.type && m.type !== 'general' && MEETING_TYPES[m.type] ? ` · ${MEETING_TYPES[m.type].label}` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:680px">
<p style="margin:0 0 14px;color:#64748b;font-size:13px">${escapeHtml(when)} · ${escapeHtml(fmtDuration(m.durationMs || 0))}${escapeHtml(typeLabel)}</p>
${mdToHtml(md, EMAIL_STYLE)}
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">${L.emailFooter}</p>
</div>`;
  return {
    subject: `${L.subject}: ${title} (${new Date(m.startedAt).toLocaleDateString(L.locale)})`,
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
    if (redoSummary) { m.summary = ''; m.translations = {}; m.email = { status: 'pending' }; }
    m.status = 'processing';
    m.error = '';
    await saveMeeting(m);
    updateProcView(m);
    try {
      // 1. Transcripció
      if (m.engine === 'import') {
        if (!(m.segments[0] && m.segments[0].status === 'done')) {
          m.stage = 'transcribe'; updateProcView(m);
          await transcribeImport(m);
        }
      } else if (m.engine !== 'device') {
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
      // 2b. Traducció a l'idioma per defecte (si no és el català)
      const lang = settings.summaryLang || 'ca';
      if (lang !== 'ca' && !(m.translations && m.translations[lang])) {
        m.stage = 'translate'; updateProcView(m);
        await translateSummary(m, lang);
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
      m.autoRetries = 0;
      delete m.retryAt;
      await saveMeeting(m);
      if (m.refIdx != null && !settings.keepAudio) await db.del('audio', audioKey(m.id, m.refIdx));
      if (m.engine === 'import' && !settings.keepAudio) await db.del('audio', `${m.id}:import`);
    } catch (e) {
      m.status = 'error';
      m.error = e.message;
      // Errors temporals (connexió, Google saturat…): ho tornem a provar sols, fins a 3 cops.
      delete m.retryAt;
      if (!(e instanceof FatalError) && (m.autoRetries || 0) < 3) {
        m.autoRetries = (m.autoRetries || 0) + 1;
        const delay = 15000 * m.autoRetries;
        m.retryAt = Date.now() + delay;
        setTimeout(() => { if (!pipelines.has(id)) runPipeline(id); }, delay);
      }
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

const CAN_CAPTURE_CALL = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !IS_IOS;
function stopExtraStreams() {
  (rec.extraStreams || []).forEach((st) => st.getTracks().forEach((t) => t.stop()));
  rec.extraStreams = [];
}
async function openMic() {
  stopExtraStreams();
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  if (rec.meeting && rec.meeting.source === 'call') {
    // Videotrucada: barreja el so de la pestanya/ordinador amb el micròfon.
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' });
    } catch (e) { micStream.getTracks().forEach((t) => t.stop()); throw new Error("Cal triar la pestanya o la pantalla de la videotrucada per poder-la gravar."); }
    if (!display.getAudioTracks().length) {
      display.getTracks().forEach((t) => t.stop()); micStream.getTracks().forEach((t) => t.stop());
      throw new Error("No s'ha compartit l'àudio. Torna-ho a provar i marca «Comparteix també l'àudio» (de la pestanya o del sistema).");
    }
    if (!rec.audioCtx) rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') await rec.audioCtx.resume();
    const dest = rec.audioCtx.createMediaStreamDestination();
    rec.audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
    rec.audioCtx.createMediaStreamSource(micStream).connect(dest);
    display.getVideoTracks().forEach((t) => { t.enabled = false; });
    display.getAudioTracks().forEach((t) => { t.onended = () => { if (rec.meeting && !rec.stopping) toast("S'ha deixat de compartir la videotrucada. Toca «Acaba la reunió» o torna a començar.", 7000); }; });
    rec.extraStreams = [display, micStream];
    rec.stream = dest.stream;
  } else {
    rec.stream = micStream;
    rec.stream.getAudioTracks().forEach((t) => { t.onended = () => { if (!document.hidden) recoverMic(); }; });
  }
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
    stopExtraStreams();
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
    group: $('#meeting-group').value.trim(),
    source: CAN_CAPTURE_CALL && settings.source === 'call' ? 'call' : 'mic',
    startedAt: Date.now(),
    durationMs: 0,
    engine: settings.engine,
    speakers: settings.engine !== 'device' && settings.speakers !== false,
    type: settings.lastType || 'general',
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
      rec.meeting = m; // openMic necessita saber la font (micròfon o videotrucada)
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
    stopExtraStreams();
    if (rec.wakeLock) { rec.wakeLock.release().catch(() => {}); rec.wakeLock = null; }
    Object.assign(rec, { meeting: null, stream: null, recorder: null, speech: null, analyser: null });
    $('#btn-stop').disabled = false;
  }
  m.durationMs = rec.activeMs;
  m.status = 'processing';
  await saveMeeting(m);
  $('#meeting-title').value = '';
  $('#meeting-context').value = '';
  $('#meeting-group').value = '';
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
  if (typeof closeSheets === 'function' && document.querySelector('.sheet:not([hidden])')) closeSheets();
  if (rec.meeting && name !== 'rec') { toast('Primer acaba la reunió'); return; }
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  currentView = name;
  updateTabbar();
  window.scrollTo(0, 0);
  if (name === 'home') refreshHomeBanners();
  if (name === 'history') renderHistory();
  if (name === 'settings') fillSettings();
  if (name === 'ask') renderAskScope();
}

// Barra de navegació inferior: sempre visible, excepte gravant o sense clau.
function updateTabbar() {
  const tabView = { home: 'home', rec: 'home', proc: 'history', result: 'history', history: 'history', ask: 'ask', settings: 'settings' }[currentView];
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', String(t.dataset.view === tabView)));
  const hide = currentView === 'rec' || (currentView === 'home' && missingSetup().length > 0);
  $('#tabbar').hidden = hide;
  document.body.classList.toggle('has-tabbar', !hide);
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
  else if (m.engine === 'import') {
    if (m.segments[0] && m.segments[0].status === 'done') setStep('step-transcribe', 'done', 'Fitxer transcrit');
    else if (m.status === 'error' && m.stage === 'transcribe') setStep('step-transcribe', 'error', friendlyError(m.error));
    else setStep('step-transcribe', 'active', m.importProgress || 'Transcrivint el fitxer… (pot trigar uns minuts)');
  }
  else if (total && done === total) setStep('step-transcribe', 'done', `${total} trams`);
  else if (segErr && m.status === 'error') setStep('step-transcribe', 'error', friendlyError(segErr.error));
  else setStep('step-transcribe', 'active', total ? `${done} de ${total} trams` : 'Preparant…');

  if (m.summary) setStep('step-summary', 'done', 'Fet');
  else if (m.stage === 'summary') setStep('step-summary', m.status === 'error' ? 'error' : 'active', m.status === 'error' ? friendlyError(m.error) : 'Escrivint el resum…');
  else if (m.stage === 'translate') setStep('step-summary', m.status === 'error' ? 'error' : 'active', m.status === 'error' ? friendlyError(m.error) : 'Traduint el resum…');
  else setStep('step-summary', '', '');

  $('#step-email').hidden = m.email.status === 'off' || (!emailEnabled() && m.email.status !== 'sent');
  if (m.email.status === 'sent') setStep('step-email', 'done', settings.email);
  else if (m.email.status === 'error') setStep('step-email', 'error', friendlyError(m.email.error));
  else if (m.stage === 'email') setStep('step-email', 'active', `Enviant a ${settings.email}…`);
  else setStep('step-email', '', '');
}

async function showResult(id) {
  const m = await getMeeting(id);
  if (!m) return;
  $('#share-panel').hidden = true;
  viewingId = id;
  if (m.status === 'processing' || pipelines.has(id)) { showView('proc'); updateProcView(m); return; }
  showView('result');
  const st = $('#result-status');
  if (m.status === 'error') {
    st.className = 'banner err';
    const auto = m.retryAt && m.retryAt > Date.now();
    st.innerHTML = `<b>${escapeHtml(friendlyError(m.error))}</b><br>`
      + (auto ? 'Ho tornem a provar automàticament d\'aquí a uns segons… ' : 'No s\'ha perdut res. ')
      + `<button class="link" id="btn-retry">${auto ? 'Prova-ho ara' : 'Torna-ho a provar'}</button>`
      + `<details class="tech"><summary>Detall tècnic</summary>${escapeHtml(m.error || '')}</details>`;
    $('#btn-retry').onclick = () => { resetQuota(); m.autoRetries = 0; showView('proc'); updateProcView(m); runPipeline(id); };
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
    st.textContent = `No s'ha pogut enviar el correu (${friendlyError(m.email.error || '')}). Toca «Torna a enviar».`;
  }
  resultLang = (m.translations && m.translations[settings.summaryLang]) ? settings.summaryLang : 'ca';
  renderResultSummary(m);
  $('#result-transcript').innerHTML = (buildTranscript(m) || '(buida)').split('\n').map(speakerHtml).join('\n');
  $('#btn-resend').disabled = !m.summary;
  $('#btn-copy').disabled = !m.summary;
  $('#btn-mail').disabled = !m.summary;
  await renderPhotos(m, $('#result-photos'));
  $('#result-photos-wrap').hidden = !(m.photos && m.photos.length);
  $('#btn-share').disabled = !m.summary;
  $('#btn-pdf').disabled = !m.summary;
  $('#lang-switch').hidden = !m.summary;
  // Sense resum, només té sentit fer-ne un de nou: amaga «Comparteix» i «Torna a enviar».
  ['#btn-share-open', '#btn-resend'].forEach((sel) => { $(sel).hidden = !m.summary; });
  $('#btn-resend').hidden = !m.summary || !emailEnabled();
  $('.action-bar').classList.toggle('solo', !m.summary);
  $('#btn-more').textContent = m.summary ? '⋯' : '⋯  Més opcions';
  $('#group-current').textContent = m.group || 'cap';
  closeSheets();
}

// Targeta d'una reunió (inici i historial)
function meetingBadge(m) {
  if (pipelines.has(m.id) || m.status === 'processing') return '<span class="badge warn">Processant</span>';
  if (m.status === 'error') return '<span class="badge err">Cal revisar</span>';
  if (m.email && m.email.status === 'sent' && m.email.confirmed === false) return '<span class="badge warn">Sense confirmar</span>';
  if (m.email && m.email.status === 'sent') return '<span class="badge ok">Enviat</span>';
  if (m.status === 'done' && m.email && m.email.status === 'error') return '<span class="badge warn">No enviat</span>';
  return '';
}
function meetingCard(m, { withDelete = false, onDelete = null } = {}) {
  const li = document.createElement('li');
  const t = MEETING_TYPES[m.type || 'general'] || MEETING_TYPES.general;
  const title = m.summary ? summaryTitle(m) : (m.title || 'Reunió');
  li.innerHTML = `<button class="item" type="button"><span class="ticon">${t.icon}</span><span class="body">
      <span class="t">${escapeHtml(title)}</span>
      <span class="m">${escapeHtml(fmtDate(m.startedAt))} · ${escapeHtml(fmtDuration(m.durationMs || 0))}${m.group ? ` · 🏷 ${escapeHtml(m.group)}` : ''}${meetingBadge(m)}</span></span></button>`;
  li.querySelector('.item').onclick = () => showResult(m.id);
  if (withDelete) {
    li.classList.add('has-del');
    const del = document.createElement('button');
    del.className = 'del'; del.type = 'button'; del.setAttribute('aria-label', 'Esborra'); del.textContent = '🗑';
    del.onclick = onDelete;
    li.appendChild(del);
  }
  return li;
}
async function deleteMeeting(m) {
  if (!confirm('Esborrar aquesta reunió (resum, transcripció i fotos)?')) return false;
  for (const s of m.segments || []) await db.del('audio', audioKey(m.id, s.idx));
  for (const ph of m.photos || []) await db.del('audio', ph.key);
  await db.del('audio', `${m.id}:import`);
  await db.del('meetings', m.id);
  meetingCache.delete(m.id);
  return true;
}
async function renderHistory() {
  const q = ($('#history-search').value || '').trim().toLowerCase();
  const all = (await db.all('meetings')).sort((a, b) => b.startedAt - a.startedAt);
  renderHistoryFilters(all);
  const filtered = filterMeetings(all, historyFilter);
  const list = q ? filtered.filter((m) => `${m.title || ''} ${m.context || ''} ${m.group || ''} ${m.summary || ''}`.toLowerCase().includes(q)) : filtered;
  const ul = $('#history-list');
  ul.innerHTML = '';
  $('#history-empty').hidden = list.length > 0;
  $('#history-empty').textContent = all.length ? 'Cap reunió coincideix amb la cerca.' : 'Encara no hi ha reunions.';
  $('#history-search').hidden = all.length < 2;
  for (const m of list) {
    ul.appendChild(meetingCard(m, { withDelete: true, onDelete: async () => { if (await deleteMeeting(m)) renderHistory(); } }));
  }
}
$('#history-search').oninput = () => renderHistory();

async function refreshHomeBanners() {
  const miss = missingSetup();
  // Sense clau: només la benvinguda. Amb clau: només la part de gravar.
  $('#setup-banner').hidden = miss.length === 0;
  $('#home-main').hidden = miss.length > 0;
  if (currentView === 'home') updateTabbar();
  renderTypeChips();
  renderHome();
  renderSourceSwitch();
  renderGroupsDatalist();
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
  $('#set-summary-lang').value = settings.summaryLang || 'ca';
  $('#backup-info').textContent = settings.lastBackup ? `Última còpia: ${fmtDate(settings.lastBackup)}` : 'Encara no has fet cap còpia.';
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
  return { ok: false, msg: `Google ha respost ${res.status}. Torna-ho a provar d'aquí a un moment.` };
}

// Claus de Google: format clàssic (AIza…) i format nou (AQ.…). La validesa real la decideix Google.
const KEY_RE = /^(AIza[\w-]{20,}|AQ\.[\w.-]{20,}|[\w.-]{30,})$/;

// Assistent de la pantalla de benvinguda: enganxa, comprova i desa la clau.
async function useWelcomeKey(raw) {
  const msg = $('#welcome-msg');
  const key = (raw || '').trim().replace(/^["']|["']$/g, '');
  if (!KEY_RE.test(key)) {
    msg.textContent = key ? 'Això no sembla una clau de Google. Torna a copiar-la amb el botó de copiar de la pàgina de Google.' : 'Primer copia la clau a la pàgina de Google.';
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
$('#welcome-key').oninput = (e) => { if (KEY_RE.test(e.target.value.trim())) useWelcomeKey(e.target.value); };

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
// Tipus de reunió (adapten el resum)
// ---------------------------------------------------------------------------
const MEETING_TYPES = {
  general: { icon: '💬', label: 'General', prompt: '' },
  equip: { icon: '👥', label: "Reunió d'equip", prompt: "Posa èmfasi en l'estat de cada projecte o àrea, els bloquejos i qui fa què. A «Punts tractats» agrupa per projecte o àrea." },
  comercial: { icon: '🤝', label: 'Comercial / client', prompt: "Afegeix just després de «## Resum» una secció «## Client i necessitats» (qui és, què necessita, pressupost, terminis i objeccions). A «Temes oberts i propers passos» deixa clar el següent pas comercial, qui el fa i quan." },
  u1: { icon: '🙋', label: '1 a 1', prompt: "Centra't en el feedback, els objectius, les preocupacions i els acords entre les dues persones. Sigues discret i respectuós amb els temes personals." },
  entrevista: { icon: '🎤', label: 'Entrevista', prompt: "Afegeix just després de «## Resum» una secció «## Perfil i respostes clau» amb les respostes rellevants de la persona entrevistada, punts forts i dubtes, sense judicis de valor no fonamentats." },
  formacio: { icon: '🎓', label: 'Formació / classe', prompt: "Afegeix just després de «## Resum» una secció «## Conceptes clau» amb el que s'ha explicat, ordenat i didàctic." },
  projecte: { icon: '📈', label: 'Seguiment de projecte', prompt: "Afegeix just després de «## Resum» una secció «## Estat del projecte» (avenços, fites, riscos i calendari)." },
};
function renderTypeChips() {
  const box = $('#type-chips');
  if (!box || box.childElementCount) { updateTypeChips(); return; }
  for (const [key, t] of Object.entries(MEETING_TYPES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'type-chip';
    b.dataset.type = key;
    b.textContent = `${t.icon} ${t.label}`;
    b.onclick = () => { saveSettings({ lastType: key }); updateTypeChips(); };
    box.appendChild(b);
  }
  updateTypeChips();
}
function updateTypeChips() {
  document.querySelectorAll('.type-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === (settings.lastType || 'general'))));
}

// ---------------------------------------------------------------------------
// Idiomes del resum (el català és l'original; la resta són traduccions)
// ---------------------------------------------------------------------------
const L10N = {
  ca: { name: 'català', locale: 'ca-ES', subject: 'Resum', doubt: '[dubte de comprensió]', minutes: 'Acta de reunió', date: 'Data', duration: 'Durada', type: 'Tipus', context: 'Context i assistents', who: 'Responsable', task: 'Tasca', due: 'Termini', page: 'Pàgina', emailFooter: 'Transcripció completa adjunta. Generat automàticament per Xiu-xiu.' },
  es: { name: 'castellà', locale: 'es-ES', subject: 'Resumen', doubt: '[duda de comprensión]', minutes: 'Acta de reunión', date: 'Fecha', duration: 'Duración', type: 'Tipo', context: 'Contexto y asistentes', who: 'Responsable', task: 'Tarea', due: 'Plazo', page: 'Página', emailFooter: 'Transcripción completa adjunta. Generado automáticamente por Xiu-xiu.' },
  en: { name: 'anglès', locale: 'en-GB', subject: 'Summary', doubt: '[unclear]', minutes: 'Meeting minutes', date: 'Date', duration: 'Duration', type: 'Type', context: 'Context and attendees', who: 'Owner', task: 'Task', due: 'Due', page: 'Page', emailFooter: 'Full transcript attached. Automatically generated by Xiu-xiu.' },
};
let resultLang = 'ca';
function getSummary(m, lang = 'ca') {
  if (lang === 'ca' || !m.translations || !m.translations[lang]) return m.summary || '';
  return m.translations[lang];
}
async function translateSummary(m, lang) {
  const L = L10N[lang];
  const system = `Ets un traductor professional. Tradueix al ${L.name} l'acta de reunió en Markdown que et donaré. Mantén exactament la mateixa estructura Markdown (títols #, ##, llistes, caselles [ ], negretes), els noms propis, les xifres i les dates. Tradueix també els títols de les seccions. Les marques «[dubte de comprensió]» tradueix-les com «${L.doubt}». Respon només amb l'acta traduïda, sense cap comentari.`;
  const text = await gemini([{ text: m.summary }], { system, maxTokens: 16384, thinking: 0 });
  const clean = text.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!clean) throw new Error('La traducció ha sortit buida');
  m.translations = { ...(m.translations || {}), [lang]: clean };
  await saveMeeting(m);
  return clean;
}
function renderResultSummary(m) {
  $('#result-summary').innerHTML = m.summary ? mdToHtml(getSummary(m, resultLang)) : '<p>Encara no hi ha resum.</p>';
  document.querySelectorAll('#lang-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === resultLang)));
}
document.querySelectorAll('#lang-switch button').forEach((b) => {
  b.onclick = async () => {
    const m = await getMeeting(viewingId);
    if (!m || !m.summary) return;
    const lang = b.dataset.lang;
    if (lang !== 'ca' && !(m.translations && m.translations[lang])) {
      b.disabled = true;
      const prev = b.textContent;
      b.textContent = '…';
      try { await translateSummary(m, lang); }
      catch (e) { toast(`No s'ha pogut traduir: ${friendlyError(e.message)}`, 5000); return; }
      finally { b.disabled = false; b.textContent = prev; }
    }
    resultLang = lang;
    renderResultSummary(m);
  };
});

// ---------------------------------------------------------------------------
// Errors entenedors (el detall tècnic queda amagat)
// ---------------------------------------------------------------------------
function friendlyError(raw) {
  const t = String(raw || '');
  if (/quota/i.test(t) && /esgotat/i.test(t)) return t;
  if (/clau de Gemini no és vàlida|API key not valid|API_KEY_INVALID/i.test(t)) return 'La clau de Google no és vàlida. Revisa-la a ⚙️ Configuració.';
  if (/denegat|PERMISSION|403/i.test(t)) return "Google no ha permès l'accés amb aquesta clau. Revisa-la a ⚙️ Configuració.";
  if (/Sense connexió|Failed to fetch|NetworkError|Load failed|s'ha tallat|network/i.test(t)) return 'No hi ha connexió a internet. Ho tornarem a provar quan hi hagi cobertura.';
  if (/massa peticions|429|RESOURCE_EXHAUSTED/i.test(t)) return 'Google està molt saturat ara mateix.';
  if (/Gemini 5\d\d|50[0-4]|UNAVAILABLE|INTERNAL/i.test(t)) return 'Els servidors de Google tenen problemes ara mateix.';
  if (/no ha acceptat|INVALID_ARGUMENT|Gemini 400/i.test(t)) return 'Google no ha pogut processar la reunió.';
  if (/bloquejat|SAFETY|no ha respost/i.test(t)) return 'Google no ha volgut generar aquest contingut.';
  if (/No s'ha captat cap paraula/i.test(t)) return "No s'ha captat cap paraula a la gravació.";
  if (/script|Apps Script|correu/i.test(t)) return t;
  return 'Hi ha hagut un problema inesperat.';
}

// ---------------------------------------------------------------------------
// Pantalla d'inici: últimes reunions i tasques
// ---------------------------------------------------------------------------
async function renderHome() {
  if (!$('#home-recent')) return;
  const all = (await db.all('meetings')).sort((a, b) => b.startedAt - a.startedAt);
  const recent = all.slice(0, 3);
  const ul = $('#recent-list');
  ul.innerHTML = '';
  for (const m of recent) ul.appendChild(meetingCard(m));
  $('#home-recent').hidden = !recent.length;
  const last = all.find((m) => m.summary);
  const tasks = last ? parseTasks(last.summary).slice(0, 6) : [];
  const tl = $('#recent-tasks');
  tl.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="box"></span><div>${t.who ? `<b>${escapeHtml(t.who)}</b>: ` : ''}${markDoubts(escapeHtml(t.task))}${t.due ? ` <span class="due">${escapeHtml(t.due)}</span>` : ''}</div>`;
    tl.appendChild(li);
  }
  $('#home-tasks').hidden = !tasks.length;
  if (last) $('#home-tasks-title').textContent = `Tasques · ${last.summary ? summaryTitle(last) : ''}`;
  // Recordatori de còpia de seguretat
  const oldBackup = Date.now() - (settings.lastBackup || 0) > 14 * 86400000;
  $('#backup-reminder').hidden = !(all.length >= 3 && oldBackup);
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
  if (!confirm(`Recuperar la còpia del ${fmtDate(data.exportedAt)}?\n\n${data.meetings.length} reunions i la configuració (clau, correu, script…). Les reunions que ja tens no s'esborren.`)) return;
  let added = 0;
  for (const m of data.meetings) {
    if (await db.get('meetings', m.id)) continue;
    if (m.status === 'processing' || m.status === 'recording') { m.status = 'error'; m.error = "Recuperada d'una còpia: s'havia quedat a mitges"; }
    await db.put('meetings', m);
    added++;
  }
  for (const [key, b64] of Object.entries(data.photos || {})) await db.put('audio', base64ToBlob(b64, 'image/jpeg'), key);
  if (data.settings) {
    const { lastBackup, ...rest } = data.settings;
    saveSettings({ ...rest, v: settings.v });
  }
  if (Array.isArray(data.recentEmails)) rememberEmails(data.recentEmails);
  meetingCache.clear();
  fillSettings();
  msg.textContent = `✓ Recuperat: ${added} reunions noves i la configuració.`;
  toast(`✓ Còpia recuperada: ${added} reunions`);
  refreshHomeBanners();
}
$('#btn-backup').onclick = () => exportBackup().catch((e) => { $('#backup-msg').textContent = `✗ ${e.message}`; });
$('#btn-restore').onclick = () => $('#restore-input').click();
$('#btn-welcome-restore').onclick = () => $('#restore-input').click();
$('#restore-input').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
$('#btn-backup-now').onclick = () => { showView('settings'); setTimeout(() => $('#backup-section').scrollIntoView({ behavior: 'smooth' }), 100); };

// ---------------------------------------------------------------------------
// PDF amb el disseny de Xiu-xiu
// ---------------------------------------------------------------------------
let pdfLibPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error(`No s'ha pogut carregar ${src}`));
    document.head.appendChild(el);
  });
}
function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = loadScript('lib/jspdf.umd.min.js').then(() => loadScript('lib/jspdf.plugin.autotable.min.js')).then(() => window.jspdf.jsPDF);
  return pdfLibPromise;
}
// Les fonts estàndard del PDF només admeten caràcters occidentals (Windows-1252).
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(t) {
  return String(t)
    .replace(/[☐☑✓✔]/g, '').replace(/→/g, '->').replace(/≈/g, '~')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[^\u0000-ÿ]/g, (c) => (CP1252_EXTRA.includes(c) ? c : (c.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\u0000-ÿ]/g, '') || '')))
    .replace(/\s+/g, ' ').trim();
}
async function imageDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}
async function makePdf(m, lang) {
  const JsPDF = await loadPdfLib();
  const L = L10N[lang] || L10N.ca;
  const md = getSummary(m, lang);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 16, maxW = W - 2 * M, BOTTOM = 280;
  const ACCENT = [30, 64, 175], INK = [17, 24, 39], MUTED = [100, 116, 139], DOUBT = [180, 83, 9];
  let y = 0;
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 18; } };

  // Capçalera
  doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 26, 'F');
  try { doc.addImage(await imageDataUrl('icons/icon-192.png'), 'PNG', M, 5, 16, 16); } catch { /* sense icona */ }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Xiu-xiu', M + 20, 13.5);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.text('by Oriolbop', M + 20, 19);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(pdfText(L.minutes), W - M, 15, { align: 'right' });
  y = 38;

  // Títol i dades
  const title = pdfText(summaryTitle(m, md));
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  const tl = doc.splitTextToSize(title, maxW); doc.text(tl, M, y); y += tl.length * 7.5;
  const when = new Date(m.startedAt).toLocaleString(L.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const meta = [`${L.date}: ${when}`, `${L.duration}: ${fmtDuration(m.durationMs || 0)}`];
  if (m.type && m.type !== 'general' && MEETING_TYPES[m.type]) meta.push(`${L.type}: ${MEETING_TYPES[m.type].label}`);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  const ml = doc.splitTextToSize(pdfText(meta.join('   ·   ')), maxW); doc.text(ml, M, y + 1); y += ml.length * 4.6 + 1;
  if (m.context) { const cl = doc.splitTextToSize(pdfText(`${L.context}: ${m.context}`), maxW); doc.text(cl, M, y + 1); y += cl.length * 4.6 + 1; }
  doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4); doc.line(M, y + 2, W - M, y + 2); y += 9;

  // Text amb etiqueta inicial en negreta («**Nom**: text»)
  const rich = (raw, x, width, { size = 10.5, color = INK, lead = 5 } = {}) => {
    let label = '', rest = raw;
    const lm = raw.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if (lm) { label = pdfText(lm[1]) + ': '; rest = lm[2]; }
    rest = pdfText(rest.replace(/\*\*/g, '').replace(/(^|\s)\*(\S.*?)\*/g, '$1$2'));
    const doubt = /\[(dubte de comprensi|duda de comprensi|unclear)/i.test(rest);
    doc.setFontSize(size);
    let lw = 0;
    if (label) { doc.setFont('helvetica', 'bold'); lw = doc.getTextWidth(label); }
    doc.setFont('helvetica', 'normal');
    const firstW = Math.max(20, width - lw);
    const words = rest.split(' ');
    const lines = []; let cur = '', limit = firstW;
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (doc.getTextWidth(test) > limit && cur) { lines.push(cur); cur = w; limit = width; } else cur = test;
    }
    if (cur || !lines.length) lines.push(cur);
    ensure(lines.length * lead + 1);
    if (label) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(label, x, y); }
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...(doubt ? DOUBT : color));
    lines.forEach((ln, i) => doc.text(ln, i === 0 ? x + lw : x, y + i * lead));
    y += lines.length * lead + 1.2;
  };

  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    let mm;
    if (!line.trim() || /^#\s+/.test(line)) { i++; continue; }
    if ((mm = line.match(/^#{2,3}\s+(.*)$/))) {
      const heading = mm[1];
      // Secció de tasques: com a taula
      if (/^(Tasques|Tareas|Tasks|Action items)/i.test(heading)) {
        const block = [line];
        i++;
        while (i < lines.length && !/^#{1,3}\s+/.test(lines[i])) block.push(lines[i++]);
        const tasks = parseTasks(block.join('\n'));
        ensure(16); y += 2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ACCENT); doc.text(pdfText(heading), M, y);
        doc.setDrawColor(...ACCENT); doc.setLineWidth(0.3); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7;
        if (tasks.length) {
          doc.autoTable({
            startY: y, margin: { left: M, right: M, bottom: 297 - BOTTOM },
            head: [['', L.who, L.task, L.due].map(pdfText)],
            body: tasks.map((t) => ['', pdfText(t.who || '—'), pdfText(t.task), pdfText(t.due || '')]),
            styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.2, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.2, valign: 'middle' },
            headStyles: { fillColor: [239, 246, 255], textColor: ACCENT, fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 34, fontStyle: 'bold' }, 3: { cellWidth: 30 } },
            didDrawCell: (d) => {
              if (d.section === 'body' && d.column.index === 0) {
                doc.setDrawColor(...MUTED); doc.setLineWidth(0.3);
                doc.rect(d.cell.x + 2.4, d.cell.y + d.cell.height / 2 - 1.6, 3.2, 3.2);
              }
            },
          });
          y = doc.lastAutoTable.finalY + 6;
        } else {
          rich('—', M, maxW);
          y += 2;
        }
        continue;
      }
      ensure(14); y += 2;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...ACCENT); doc.text(pdfText(heading), M, y);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.3); doc.line(M, y + 1.8, W - M, y + 1.8); y += 7;
    } else if ((mm = line.match(/^(\s*)[-*•]\s+(?:\[[ xX]?\]\s*)?(.*)$/))) {
      const nested = mm[1].replace(/\t/g, '    ').length >= 2;
      const x = M + (nested ? 10 : 4);
      ensure(6);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...ACCENT);
      doc.text(nested ? '–' : '•', x - 3.5, y);
      rich(mm[2], x, W - M - x);
    } else if ((mm = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
      const x = M + 6;
      ensure(6);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...ACCENT); doc.text(`${mm[2]}.`, M, y);
      rich(mm[3], x, W - M - x);
    } else {
      rich(line, M, maxW);
      y += 1;
    }
    i++;
  }

  // Peu de pàgina
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(M, 287, W - M, 287);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text('Xiu-xiu', M, 291.5);
    const brandW = doc.getTextWidth('Xiu-xiu') + 1.5;
    doc.setFont('helvetica', 'italic'); doc.text('by Oriolbop', M + brandW, 291.5);
    doc.setFont('helvetica', 'normal'); doc.text(`${L.page} ${p} / ${n}`, W - M, 291.5, { align: 'right' });
  }
  return doc.output('blob');
}
// ---------------------------------------------------------------------------
// Fulls inferiors: «Comparteix» i «⋯ Més opcions»
// ---------------------------------------------------------------------------
function openSheet(id) {
  closeSheets();
  $(id).hidden = false;
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach((el) => { el.hidden = true; });
  $('#share-panel').hidden = true;
}
$('#btn-share-open').onclick = () => { $('#share-msg').textContent = ''; openSheet('#share-sheet'); };
$('#btn-more').onclick = () => openSheet('#more-sheet');
document.querySelectorAll('[data-close-sheet]').forEach((el) => { el.onclick = closeSheets; });
// Les accions marcades amb data-closes tanquen el full un cop tocades.
document.querySelectorAll('.sheet [data-closes]').forEach((el) => el.addEventListener('click', () => setTimeout(closeSheets, 50)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });
$('#btn-delete').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (m && await deleteMeeting(m)) { toast('Reunió esborrada'); showView('home'); }
};

// Obre WhatsApp amb el resum ja escrit (només cal triar el contacte o el grup).
$('#btn-wa').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (!m || !m.summary) return;
  const text = mdToWhatsApp(getSummary(m, resultLang));
  const enc = encodeURIComponent(text);
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || IS_IOS;
  if (mobile) {
    location.href = `whatsapp://send?text=${enc}`;
    // Si WhatsApp no s'ha obert (no instal·lat), prova la versió web.
    setTimeout(() => { if (document.visibilityState === 'visible') window.open(`https://wa.me/?text=${enc}`, '_blank'); }, 1800);
  } else {
    window.open(`https://wa.me/?text=${enc}`, '_blank');
  }
};

$('#btn-pdf').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (!m || !m.summary) return;
  const btn = $('#btn-pdf');
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Preparant l\'acta…';
  try {
    const blob = await makePdf(m, resultLang);
    const name = `${summaryTitle(m, getSummary(m, resultLang)).replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'Acta'} - ${new Date(m.startedAt).toISOString().slice(0, 10)}.pdf`;
    const r = await shareOrDownload(blob, name, summaryTitle(m));
    if (r !== 'cancelled') closeSheets();
  } catch (e) {
    toast(`No s'ha pogut fer el PDF: ${e.message}`, 5000);
  } finally {
    btn.disabled = false; btn.innerHTML = label;
  }
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
// Font de l'àudio a l'ordinador: micròfon o videotrucada
// ---------------------------------------------------------------------------
function renderSourceSwitch() {
  $('#source-switch').hidden = !CAN_CAPTURE_CALL;
  const src = CAN_CAPTURE_CALL && settings.source === 'call' ? 'call' : 'mic';
  document.querySelectorAll('#source-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === src)));
  $('#source-hint').hidden = src !== 'call';
}
document.querySelectorAll('#source-switch button').forEach((b) => {
  b.onclick = () => { saveSettings({ source: b.dataset.source }); renderSourceSwitch(); };
});

// ---------------------------------------------------------------------------
// Grups de treball / projectes
// ---------------------------------------------------------------------------
async function allGroups() {
  const all = await db.all('meetings');
  const count = {};
  for (const m of all) if (m.group) count[m.group] = (count[m.group] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
async function renderGroupsDatalist() {
  const dl = $('#groups-list');
  dl.innerHTML = '';
  for (const g of await allGroups()) { const o = document.createElement('option'); o.value = g; dl.appendChild(o); }
}
$('#btn-set-group').onclick = async () => {
  const m = await getMeeting(viewingId);
  if (!m) return;
  const groups = await allGroups();
  const v = prompt(`Grup o projecte d'aquesta reunió${groups.length ? `\n(els que ja tens: ${groups.slice(0, 8).join(', ')})` : ''}\nDeixa-ho buit per treure'l.`, m.group || '');
  if (v === null) return;
  m.group = v.trim();
  await saveMeeting(m);
  $('#group-current').textContent = m.group || 'cap';
  toast(m.group ? `🏷 Reunió classificada a «${m.group}»` : 'Grup tret');
};

// ---------------------------------------------------------------------------
// Classificació a l'historial (per tipus i per grup)
// ---------------------------------------------------------------------------
let historyFilter = { kind: 'all', value: '' };
function filterMeetings(list, f) {
  if (f.kind === 'type') return list.filter((m) => (m.type || 'general') === f.value);
  if (f.kind === 'group') return list.filter((m) => m.group === f.value);
  return list;
}
function renderHistoryFilters(all) {
  const box = $('#history-filters');
  box.innerHTML = '';
  const chips = [{ kind: 'all', value: '', label: 'Totes', n: all.length }];
  const types = {};
  for (const m of all) { const t = m.type || 'general'; types[t] = (types[t] || 0) + 1; }
  for (const [t, n] of Object.entries(types)) if (MEETING_TYPES[t]) chips.push({ kind: 'type', value: t, label: `${MEETING_TYPES[t].icon} ${MEETING_TYPES[t].label}`, n });
  const groups = {};
  for (const m of all) if (m.group) groups[m.group] = (groups[m.group] || 0) + 1;
  for (const [g, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) chips.push({ kind: 'group', value: g, label: `🏷 ${g}`, n });
  box.hidden = chips.length <= 2 && !Object.keys(groups).length;
  for (const c of chips) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'type-chip';
    b.innerHTML = `${escapeHtml(c.label)} <span class="n">${c.n}</span>`;
    b.setAttribute('aria-pressed', String(historyFilter.kind === c.kind && historyFilter.value === c.value));
    b.onclick = () => { historyFilter = { kind: c.kind, value: c.value }; renderHistory(); };
    box.appendChild(b);
  }
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
async function transcribeImport(m) {
  const blob = await db.get('audio', `${m.id}:import`);
  if (!blob) throw new FatalError("No s'ha trobat el fitxer importat. Torna'l a importar.");
  const prompt = [
    "Transcriu literalment aquesta gravació d'una reunió o conversa.",
    settings.lang === 'auto'
      ? "Pot ser en català, en castellà o barrejat: escriu cada intervenció en l'idioma en què es parla, sense traduir."
      : `L'idioma principal és el ${LANG_NAMES[settings.lang]}; no tradueixis les intervencions en altres idiomes.`,
    "Comença cada intervenció en una línia nova amb el nom de qui parla i dos punts (p. ex. «Oriol: …»). Fes servir els noms si es presenten o es diuen durant la conversa; si no, fes servir «Persona 1», «Persona 2»… de manera coherent tota l'estona.",
    "Cada 5 minuts aproximadament, afegeix una línia amb el temps de la gravació entre claudàtors, p. ex. [05:00], [10:00].",
    "Escriu només la transcripció, sense títols, comentaris ni resums.",
    "MOLT IMPORTANT: no t'inventis mai res. Quan una paraula o frase no s'entengui bé, escriu el que probablement s'ha dit seguit de [dubte de comprensió]. Si un fragment no s'entén gens, escriu només [dubte de comprensió].",
    m.context ? `Context (per escriure bé noms i termes): ${m.context}` : '',
  ].filter(Boolean).join('\n');

  const primary = m.importMime || 'audio/mp4';
  const mimes = [...new Set([primary, ...(primary === 'audio/mp4' ? ['video/mp4', 'audio/aac'] : primary === 'audio/ogg' ? ['audio/opus'] : [])])];
  let lastErr;
  for (const mime of mimes) {
    try {
      let part;
      if (blob.size <= 14e6) {
        m.importProgress = 'Transcrivint el fitxer…'; updateProcView(m);
        part = { inlineData: { mimeType: mime, data: await blobToBase64(blob) } };
      } else {
        m.importProgress = `Pujant el fitxer a Google (${Math.round(blob.size / 1e6)} MB)…`; updateProcView(m);
        part = { fileData: { mimeType: mime, fileUri: await uploadToGemini(blob, mime, m.importName) } };
        m.importProgress = 'Transcrivint el fitxer… (pot trigar uns minuts)'; updateProcView(m);
      }
      const text = await gemini([part, { text: prompt }], { task: 'transcribe', thinking: 0, maxTokens: 65536 });
      m.segments = [{ idx: 0, startMs: 0, status: 'done', text: text.trim() }];
      delete m.importProgress;
      await saveMeeting(m);
      return;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof UnsupportedAudioError)) throw e;
    }
  }
  // Últim recurs per a fitxers petits: convertir-los a WAV al mòbil.
  if (blob.size <= 25e6) {
    m.importProgress = 'Convertint el fitxer…'; updateProcView(m);
    const wav = await toWav(blob);
    const text = await gemini([{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }, { text: prompt }], { task: 'transcribe', thinking: 0, maxTokens: 65536 });
    m.segments = [{ idx: 0, startMs: 0, status: 'done', text: text.trim() }];
    delete m.importProgress;
    await saveMeeting(m);
    return;
  }
  throw new FatalError(`Google no accepta aquest format de fitxer. Prova d'exportar-lo en MP3 o M4A. (${lastErr ? lastErr.message : ''})`);
}
async function importFile(file) {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); return; }
  if (file.size > 1.9e9) { toast('El fitxer és massa gran (màxim 2 GB).', 5000); return; }
  const m = {
    id: uid(),
    title: $('#meeting-title').value.trim() || file.name.replace(/\.[^.]+$/, ''),
    context: $('#meeting-context').value.trim(),
    group: $('#meeting-group').value.trim(),
    startedAt: file.lastModified || Date.now(),
    durationMs: await mediaDuration(file),
    engine: 'import',
    importMime: importMime(file),
    importName: file.name,
    type: settings.lastType || 'general',
    status: 'processing',
    segments: [],
    marks: [],
    summary: '',
    email: { status: 'pending' },
  };
  await db.put('audio', file, `${m.id}:import`);
  await saveMeeting(m);
  $('#meeting-title').value = ''; $('#meeting-context').value = ''; $('#meeting-group').value = '';
  viewingId = m.id;
  showView('proc');
  updateProcView(m);
  runPipeline(m.id);
}
$('#btn-import').onclick = () => $('#import-input').click();
$('#import-input').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };

// ---------------------------------------------------------------------------
// Pregunta a les reunions
// ---------------------------------------------------------------------------
let askHistory = []; // [{ q, a }]
async function renderAskScope() {
  const sel = $('#ask-scope');
  const prev = sel.value;
  const all = await db.all('meetings');
  sel.innerHTML = '';
  const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
  add('all', `Totes les reunions (${all.filter((m) => m.summary).length})`);
  const types = [...new Set(all.map((m) => m.type || 'general'))].filter((t) => MEETING_TYPES[t]);
  for (const t of types) add(`type:${t}`, `${MEETING_TYPES[t].icon} ${MEETING_TYPES[t].label}`);
  for (const g of await allGroups()) add(`group:${g}`, `🏷 ${g}`);
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
function renderAskLog(streaming = null) {
  const log = $('#ask-log');
  log.innerHTML = '';
  const bubble = (cls, html) => { const d = document.createElement('div'); d.className = `bubble ${cls}`; d.innerHTML = html; log.appendChild(d); return d; };
  for (const t of askHistory) {
    bubble('q', escapeHtml(t.q));
    if (t.a != null) bubble('a', mdToHtml(t.a));
  }
  if (streaming != null) bubble(streaming ? 'a' : 'a thinking', streaming ? mdToHtml(streaming) : 'Buscant a les reunions…');
  $('#btn-ask-clear').hidden = !askHistory.length;
  $('#ask-suggest').hidden = askHistory.length > 0;
}
function scoreMeeting(m, words) {
  const hay = `${m.title || ''} ${m.group || ''} ${m.summary || ''}`.toLowerCase();
  return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}
async function askMeetings(q) {
  const scope = $('#ask-scope').value || 'all';
  let list = (await db.all('meetings')).filter((m) => m.summary).sort((a, b) => b.startedAt - a.startedAt);
  if (scope.startsWith('type:')) list = filterMeetings(list, { kind: 'type', value: scope.slice(5) });
  if (scope.startsWith('group:')) list = filterMeetings(list, { kind: 'group', value: scope.slice(6) });
  if (!list.length) throw new FatalError('Encara no hi ha cap reunió amb resum en aquest apartat.');
  // Context: resums (més recents primer) i, per a les 3 reunions més relacionades, la transcripció.
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
  const related = list.slice().sort((a, b) => scoreMeeting(b, words) - scoreMeeting(a, words)).slice(0, 3).filter((m) => scoreMeeting(m, words) > 0);
  let ctx = '';
  for (const m of list) {
    const t = MEETING_TYPES[m.type || 'general'] || MEETING_TYPES.general;
    const block = `\n\n=== REUNIÓ: «${summaryTitle(m)}» — ${fmtDate(m.startedAt)} — ${t.label}${m.group ? ` — grup: ${m.group}` : ''} ===\n${m.summary}`;
    if (ctx.length + block.length > 160000) break;
    ctx += block;
  }
  for (const m of related) {
    const tr = buildTranscript(m);
    if (tr) ctx += `\n\n=== TRANSCRIPCIÓ (fragment) de «${summaryTitle(m)}» — ${fmtDate(m.startedAt)} ===\n${tr.slice(0, 15000)}`;
  }
  const system = `Ets l'assistent de l'usuari per consultar les seves reunions. Respon NOMÉS a partir de la informació de les reunions que et dono (resums i fragments de transcripció). Si no hi ha prou informació, digues-ho clarament i no t'ho inventis. Cita sempre de quina reunió treus cada dada, entre parèntesis amb el títol i la data, p. ex. (Pressupost 2027, 6 d'oct.). Sigues concret i breu; fes servir llistes quan ajudi. Respon en l'idioma de la pregunta. Avui és ${new Date().toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
  const convo = askHistory.filter((t) => t.a != null).slice(-4).map((t) => `Pregunta anterior: ${t.q}\nResposta anterior: ${t.a}`).join('\n\n');
  const text = `<reunions>${ctx}\n</reunions>\n\n${convo ? `${convo}\n\n` : ''}Pregunta: ${q}`;
  let last = 0;
  return gemini([{ text }], {
    system, maxTokens: 8192, thinking: 1024,
    onText: (t) => { const now = Date.now(); if (now - last > 120) { last = now; renderAskLog(t); } },
  });
}
async function sendAsk(q) {
  q = (q || '').trim();
  if (!q) return;
  $('#ask-input').value = '';
  const turn = { q, a: null };
  askHistory.push(turn);
  renderAskLog('');
  $('#btn-ask').disabled = true;
  try {
    turn.a = await askMeetings(q);
  } catch (e) {
    turn.a = `⚠️ ${friendlyError(e.message) === 'Hi ha hagut un problema inesperat.' ? e.message : friendlyError(e.message)}`;
  } finally {
    $('#btn-ask').disabled = false;
    renderAskLog();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
}
$('#btn-ask').onclick = () => sendAsk($('#ask-input').value);
$('#ask-input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk($('#ask-input').value); } };
document.querySelectorAll('#ask-suggest .chip').forEach((c) => { c.onclick = () => sendAsk(c.textContent); });
$('#btn-ask-clear').onclick = () => { askHistory = []; renderAskLog(); };

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
  if (!panel.hidden) { renderRecentEmails(); panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('#share-to').focus(); }
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
  const e = buildEmail(m, resultLang);
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
  const md = getSummary(m, resultLang);
  const subject = `${L10N[resultLang].subject}: ${summaryTitle(m, md)} (${new Date(m.startedAt).toLocaleDateString(L10N[resultLang].locale)})`;
  location.href = `mailto:${list.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mdToPlain(md))}`;
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
      const r = await sendEmail(buildEmail(m, resultLang), { noFallback: true });
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
  const md = getSummary(m, resultLang);
  const subject = `${L10N[resultLang].subject}: ${summaryTitle(m, md)} (${new Date(m.startedAt).toLocaleDateString(L10N[resultLang].locale)})`;
  const body = mdToPlain(md);
  location.href = `mailto:${encodeURIComponent(settings.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
$('#btn-copy').onclick = async () => {
  const m = await getMeeting(viewingId);
  // Amb format (per enganxar a un correu) i en text pla com a alternativa.
  const md = getSummary(m, resultLang);
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;font-size:15px;line-height:1.5">${mdToHtml(md, EMAIL_STYLE)}</div>`;
  const plain = mdToPlain(md);
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
