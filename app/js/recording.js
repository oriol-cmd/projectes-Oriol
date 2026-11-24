/* Xiu-xiu · Gravació (micròfon i videotrucada) i gravar amb un toc. */
'use strict';

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

// Cap pas de l'inici de la gravació pot quedar-se esperant per sempre.
const withTimeout = (p, ms, fallback = undefined) => Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
// Prepara el motor d'àudio DINS del toc al botó (a l'iPhone, fora del toc no es pot engegar).
function primeAudio() {
  try {
    if (!rec.audioCtx || rec.audioCtx.state === 'closed') rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') rec.audioCtx.resume().catch(() => {});
  } catch { /* sense Web Audio: es grava igualment, sense mesurador */ }
}
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      rec.wakeLock = await withTimeout(navigator.wakeLock.request('screen'), 2000, null);
      return !!rec.wakeLock;
    }
  } catch { /* no disponible */ }
  return false;
}

const CAN_CAPTURE_CALL = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !IS_IOS;
function stopExtraStreams() {
  (rec.extraStreams || []).forEach((st) => st.getTracks().forEach((t) => t.stop()));
  rec.extraStreams = [];
}
// Obre el micròfon. Si el dispositiu no accepta les opcions (o un altre programa
// el té ocupat), ho torna a provar amb la configuració més simple.
async function getMicStream() {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  // El micròfon triat a Ajustos (p. ex. un micròfon extern). Si ja no hi és, el de sempre.
  if (settings.micId) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: settings.micId } } }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      toast("No trobo el micròfon que vas triar a Ajustos: faig servir el de l'ordinador. Revisa que estigui connectat.", 8000);
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: base });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    await sleep(300);
    try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e2) {
      if (e2 && (e2.name === 'NotAllowedError' || e2.name === 'SecurityError')) throw e2;
      const err = new Error(MIC_BUSY);
      err.name = 'MicBusy';
      throw err;
    }
  }
}
const MIC_BUSY = "No s'ha pogut obrir el micròfon: potser el té ocupat un altre programa o no n'hi ha cap de connectat. Tanca altres apps que el facin servir i torna-ho a provar.";

async function openMic() {
  stopExtraStreams();
  try { rec.peakNode && rec.peakNode.disconnect(); rec.tapNode && rec.tapNode.disconnect(); rec.mixer && rec.mixer.disconnect(); } catch { /* res */ }
  rec.peakNode = null; rec.tapNode = null; rec.mixer = null;
  if (rec.meeting && rec.meeting.source === 'call') {
    // Videotrucada: primer el so de la trucada (mentre el clic encara compta),
    // després el micròfon, i ho barreja tot.
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' });
    } catch (e) { throw new Error("Cal triar la pestanya o la pantalla de la videotrucada per poder-la gravar."); }
    if (!display.getAudioTracks().length) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error("No s'ha compartit l'àudio. Torna-ho a provar i marca «Comparteix també l'àudio» (de la pestanya o del sistema).");
    }
    let micStream = null;
    try { micStream = await getMicStream(); }
    catch (e) {
      if (e && e.name !== 'MicBusy' && e.name !== 'NotAllowedError') { display.getTracks().forEach((t) => t.stop()); throw e; }
      toast("No s'ha pogut fer servir el micròfon: es grava només el so de la trucada (la teva veu potser no hi sortirà).", 9000);
    }
    if (!rec.audioCtx) rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') await withTimeout(rec.audioCtx.resume(), 1500);
    // Barreja: so de la trucada + micròfon -> mixer -> (gravació i mesurador).
    // El mesurador s'ha de connectar al mixer: si es llegeix del flux de sortida
    // del mateix AudioContext, Chrome hi dona silenci i tot semblava mut.
    const dest = rec.audioCtx.createMediaStreamDestination();
    const mixer = rec.audioCtx.createGain();
    const callSrc = rec.audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
    callSrc.connect(mixer);
    rec.inCall = rec.audioCtx.createAnalyser(); rec.inCall.fftSize = 1024; callSrc.connect(rec.inCall);
    rec.inMic = null;
    if (micStream) {
      const micSrc = rec.audioCtx.createMediaStreamSource(micStream);
      micSrc.connect(mixer);
      rec.inMic = rec.audioCtx.createAnalyser(); rec.inMic.fftSize = 1024; micSrc.connect(rec.inMic);
    }
    mixer.connect(dest);
    rec.mixer = mixer;
    display.getVideoTracks().forEach((t) => { t.enabled = false; });
    display.getAudioTracks().forEach((t) => { t.onended = () => { if (rec.meeting && !rec.stopping && !rec.paused) recoverMic(); }; });
    rec.extraStreams = micStream ? [display, micStream] : [display];
    rec.stream = dest.stream;
  } else {
    rec.stream = await getMicStream();
    rec.stream.getAudioTracks().forEach((t) => {
      t.onended = () => { if (!document.hidden) recoverMic(); else micInterrupted(); };
      // Una trucada (o una altra app) pren el micròfon: el so queda mut fins que es torna a obrir.
      t.onmute = () => micInterrupted();
      t.onunmute = () => { if (rec.interrupted) resumeAfterInterruption(); };
    });
  }
  try {
    if (!rec.audioCtx) rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') await withTimeout(rec.audioCtx.resume(), 1500);
    rec.audioCtx.onstatechange = () => {
      const st = rec.audioCtx && rec.audioCtx.state;
      if (st === 'interrupted') micInterrupted();
      else if (st === 'running' && rec.interrupted) resumeAfterInterruption();
    };
    const src = rec.meeting && rec.meeting.source === 'call' && rec.mixer ? rec.mixer : rec.audioCtx.createMediaStreamSource(rec.stream);
    rec.analyser = rec.audioCtx.createAnalyser();
    rec.analyser.fftSize = 1024;
    src.connect(rec.analyser);
    if (!(rec.meeting && rec.meeting.source === 'call')) { rec.inCall = null; rec.inMic = rec.analyser; }
    rec.inMax = { call: 0, mic: 0 }; rec.inWarned = { call: false, mic: false }; rec.inSince = rec.activeMs;
    await startPeakMeter(src);
    await startLiveTap(src);
  } catch { rec.analyser = null; }
}

// Mesura el volum màxim de manera contínua (al fil d'àudio). El rellotge de la
// pàgina va molt més lent quan la pestanya no es veu (p. ex. mentre mires Meet),
// i amb mostres tan espaiades un tram amb veu podia semblar silenci i perdre's.
const PEAK_WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.s=0;this.n=0;this.m=0;this.c=0}
process(i){const ch=i[0]&&i[0][0];if(ch){for(let k=0;k<ch.length;k++){this.s+=ch[k]*ch[k]}this.n+=ch.length;
if(this.n>=1024){const v=Math.min(1,Math.sqrt(this.s/this.n)*6);if(v>this.m)this.m=v;this.s=0;this.n=0}
if(++this.c>=94){this.port.postMessage(this.m);this.m=0;this.c=0}}return true}}registerProcessor('xx-peak',P);`;
async function startPeakMeter(src) {
  rec.peakNode = null;
  try {
    if (!window.AudioWorkletNode || !rec.audioCtx.audioWorklet) return;
    if (!rec.audioCtx.xxPeak) {
      const url = URL.createObjectURL(new Blob([PEAK_WORKLET], { type: 'text/javascript' }));
      rec.audioCtx.xxPeak = rec.audioCtx.audioWorklet.addModule(url);
    }
    await withTimeout(rec.audioCtx.xxPeak, 3000);
    const node = new AudioWorkletNode(rec.audioCtx, 'xx-peak', { numberOfOutputs: 0 });
    node.port.onmessage = (e) => { if (!rec.paused) rec.segPeak = Math.max(rec.segPeak || 0, e.data); };
    src.connect(node);
    rec.peakNode = node;
  } catch { /* sense mesurador continu: es fa servir el del rellotge */ }
}

// ---- Text en directe (esborrany) --------------------------------------------------
// Una còpia del so (a 16 kHz) va a part de la gravació: cada ~20 s se n'envia el tros nou a
// Gemini i el text surt a la pantalla. És només un esborrany: l'acta es fa amb la
// transcripció completa de cada tram. Si falla, la gravació no se n'assabenta.
const LIVE_S = 20;
const TAP_WORKLET = `class T extends AudioWorkletProcessor{constructor(o){super();this.r=o.processorOptions.ratio;this.a=0;this.s=0;this.n=0;this.b=new Float32Array(4000);this.k=0}
process(i){const ch=i[0]&&i[0][0];if(ch){for(let j=0;j<ch.length;j++){this.s+=ch[j];this.n++;this.a+=1;if(this.a>=this.r){this.a-=this.r;this.b[this.k++]=this.s/this.n;this.s=0;this.n=0;
if(this.k===this.b.length){this.port.postMessage(this.b);this.b=new Float32Array(4000);this.k=0}}}}return true}}registerProcessor('xx-tap',T);`;
async function startLiveTap(src) {
  rec.tapNode = null;
  try {
    if (settings.liveText === false || !window.AudioWorkletNode || !rec.audioCtx.audioWorklet) return;
    if (!rec.audioCtx.xxTap) {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
      rec.audioCtx.xxTap = rec.audioCtx.audioWorklet.addModule(url);
    }
    await withTimeout(rec.audioCtx.xxTap, 3000);
    const node = new AudioWorkletNode(rec.audioCtx, 'xx-tap', { numberOfOutputs: 0, processorOptions: { ratio: rec.audioCtx.sampleRate / 16000 } });
    node.port.onmessage = (e) => { try { liveSamples(e.data); } catch { /* res */ } };
    src.connect(node);
    rec.tapNode = node;
  } catch { /* sense text en directe */ }
}
function liveState() {
  const m = rec.meeting;
  if (!m) return null;
  if (!rec.live || rec.live.mid !== m.id) rec.live = { mid: m.id, buf: [], n: 0, atMs: null, busy: false, off: false, drafts: [] };
  return rec.live;
}
function liveSamples(chunk) {
  const m = rec.meeting;
  if (!m || m.engine === 'device' || rec.paused || rec.stopping || settings.liveText === false || rec.activeMs > 3 * 3600e3) return;
  const L = liveState();
  if (L.off) return;
  if (!L.n) L.atMs = rec.activeMs;
  L.buf.push(chunk); L.n += chunk.length;
  const max = 16000 * 90; // si Gemini va lent, no s'acumula més d'un minut i mig
  while (L.n > max && L.buf.length > 1) { L.n -= L.buf.shift().length; L.atMs += 250; }
  if (!L.busy && L.n >= 16000 * LIVE_S && navigator.onLine !== false) liveFlush(m, L);
}
async function liveFlush(m, L) {
  const pcm = new Float32Array(L.n);
  let o = 0;
  for (const c of L.buf) { pcm.set(c, o); o += c.length; }
  const atMs = L.atMs, endMs = rec.activeMs;
  L.buf = []; L.n = 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
  if (Math.sqrt(sum / (pcm.length / 4)) < 0.004) return; // silenci: no cal gastar quota
  L.busy = true;
  try {
    if (settings.boost !== false) { // el mateix filtre de veus fluixes, amb l'ús lleuger
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
      const g = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
      if (g > 1.05) for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
    }
    const prev = L.drafts.slice(-2).map((x) => x.text).join(' ').slice(-400);
    const text = await gemini([{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(pcmToWav(pcm, 16000)) } }, { text: [
      "Transcriu literalment aquest fragment curt d'una reunió que s'està gravant ara mateix (uns segons d'àudio).",
      settings.lang === 'auto' ? "Pot ser en català, en castellà o barrejat: escriu-ho en l'idioma en què es parla." : `L'idioma principal és el ${LANG_NAMES[settings.lang] || 'català'}.`,
      'Escriu només el que es diu, sense títols ni comentaris. No posis noms de qui parla.',
      "No completis ni endevinis paraules: si un tros no s'entén, escriu [dubte de comprensió]. Si no hi ha veu, respon només: [silenci]",
      prev ? `Per context, el text anterior era (no el repeteixis): «${prev}»` : '',
      NO_LEAK,
    ].filter(Boolean).join('\n') }], { task: 'transcribe', thinking: 0, maxTokens: 2048 });
    const t = (text || '').replace(/^\s*(\[silenci\]\.?\s*)+$/i, '').trim();
    if (t && rec.meeting === m) { L.drafts.push({ atMs, endMs, text: t }); if (L.drafts.length > 200) L.drafts.shift(); renderLive(); }
  } catch (e) {
    if (e instanceof FatalError) L.off = true; // sense quota o clau: no insisteixis
  } finally { L.busy = false; }
}

function startSegment() {
  if (!rec.stream || rec.stream.active === false) return false;
  const options = rec.mime ? { mimeType: rec.mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 };
  const r = new MediaRecorder(rec.stream, options);
  const chunks = [];
  const segStart = rec.activeMs;
  const m = rec.meeting; // la reunió d'aquest tram (encara que s'aturi abans que acabi de desar-se)
  r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  r.onstop = () => {
    const peak = r.xxPeak != null ? r.xxPeak : rec.segPeak;
    // Primer arrenca el tram següent (perquè no es perdin paraules), després desa aquest.
    if (rec.meeting === m && !rec.stopping && !rec.paused && rec.recorder === r) {
      try { startSegment(); } catch { recoverMic(); }
    }
    finishSegment(m, r, chunks, segStart, peak);
    if (r.xxDone) r.xxDone();
  };
  r.xxStopped = new Promise((res) => { r.xxDone = res; });
  r.onerror = () => { if (!rec.stopping) recoverMic(); };
  rec.recorder = r;
  rec.segStartMs = segStart;
  rec.segPeak = rec.analyser ? 0 : 1; // sense mesurador, suposem que hi ha veu
  rec.quietMs = 0;
  r.start();
  return true;
}
// Atura una gravadora i recorda el volum màxim que ha tingut el seu tram.
function stopRecorder(r) {
  if (!r || r.state === 'inactive') return;
  r.xxPeak = rec.segPeak;
  if (r.state === 'paused') r.resume();
  r.stop();
}

let segmentChain = Promise.resolve();
const SILENCE_PEAK = 0.03;
function finishSegment(m, r, chunks, startMs, peak) {
  const type = r.mimeType || rec.mime || 'audio/mp4';
  segmentChain = segmentChain.catch(() => {}).then(async () => {
    const blob = new Blob(chunks, { type });
    // Només es descarta com a silenci si el mesurador funcionava (si l'àudio estava aturat, marcaria 0).
    const meterOk = rec.audioCtx && rec.audioCtx.state === 'running';
    if (m && meterOk && m.source !== 'call' && peak < (settings.boost !== false ? SILENCE_PEAK / 2.5 : SILENCE_PEAK)) {
      // Sembla silenci: no s'envia ara, però l'àudio es guarda per si al final no hi ha res
      // (un micròfon molt fluix pot semblar silenci) i cal tornar-ho a provar.
      const idx = m.segments.length;
      if (blob.size > 2000) await db.put('audio', blob, audioKey(m.id, idx));
      m.segments.push({ idx, startMs, status: 'done', text: '', silent: true });
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
  }).catch((e) => {
    // No deixis que un error en desar un tram aturi tota la gravació.
    toast(`No s'ha pogut desar un tros de la gravació (${e && e.message ? e.message : e}). Continuem gravant.`, 6000);
  });
}

function rotateSegment() {
  stopRecorder(rec.recorder);
}

async function recoverMic() {
  if (!rec.meeting || rec.stopping || rec.recovering) return;
  rec.recovering = true;
  try {
    const old = rec.recorder;
    if (old && old.state !== 'inactive') { rec.recorder = null; stopRecorder(old); }
    if (rec.meeting.source === 'call') {
      // La captura de la trucada només es pot tornar a demanar amb un clic.
      rec.paused = true;
      $('#btn-pause').textContent = 'Continua';
      setRecStateUi();
      showResumeOverlay("S'ha aturat la captura de la videotrucada. Toca el botó i torna a triar la pestanya (o la pantalla) de la trucada, amb «Comparteix també l'àudio».");
      return;
    }
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    stopExtraStreams();
    await segmentChain;
    if (!rec.meeting || rec.stopping) return;
    await openMic();
    if (!rec.meeting || rec.stopping) { rec.stream && rec.stream.getTracks().forEach((t) => t.stop()); stopExtraStreams(); return; }
    if (!rec.paused) startSegment();
    toast('Micròfon reconnectat');
  } catch (e) {
    // Sovint (p. ex. a l'iPhone després d'una trucada) cal un toc per tornar a obrir el micròfon.
    showResumeOverlay("No s'ha pogut tornar a obrir el micròfon sol. Toca el botó per continuar.");
  } finally {
    rec.recovering = false;
  }
}

// ---- Trucades i altres interrupcions (sobretot al mòbil) --------------------------------
// Quan entra una trucada, el sistema pren el micròfon. En penjar, es torna a obrir sol;
// si el mòbil no ho deixa sense un toc, surt un botó gran per continuar.
function micInterrupted() {
  if (!rec.meeting || rec.paused || rec.stopping || rec.interrupted || rec.meeting.source === 'call' || rec.meeting.engine === 'device') return;
  rec.interrupted = { at: Date.now(), atMs: rec.activeMs };
  $('#rec-warn').hidden = false;
  $('#rec-warn').textContent = "📞 S'ha interromput el micròfon (una trucada?).";
  showResumeOverlay("S'ha interromput el micròfon (una trucada?). Quan pengis, continuarà sol; si no, toca el botó.");
  if (document.visibilityState === 'visible') setTimeout(() => { if (rec.interrupted) resumeAfterInterruption(); }, 4000);
}
async function resumeAfterInterruption({ manual = false } = {}) {
  const it = rec.interrupted;
  if (!it || !rec.meeting || rec.stopping || rec.recovering) return;
  if (!manual && document.visibilityState !== 'visible') return; // es reprèn en tornar a l'app
  const gap = Date.now() - it.at;
  if (gap > 8000) {
    // Si en tornar de l'app ja s'ha anotat aquest tall, no es duplica.
    const last = (rec.meeting.gaps || []).slice(-1)[0];
    if (!last || Math.abs(last.atMs - it.atMs) > 15000) rec.meeting.gaps = [...(rec.meeting.gaps || []), { atMs: it.atMs, ms: gap }];
  }
  rec.interrupted = null;
  if (manual) primeAudio();
  await recoverMic();
  const track = rec.stream && rec.stream.getAudioTracks()[0];
  const ok = track && track.readyState === 'live' && !track.muted && rec.recorder && rec.recorder.state === 'recording';
  if (ok) {
    hideResumeOverlay();
    $('#rec-warn').hidden = false;
    $('#rec-warn').textContent = `✓ S'ha reprès la gravació${gap > 8000 ? ` (s'han perdut uns ${fmtGap(gap)} mentre durava la interrupció)` : ''}.`;
    saveMeeting(rec.meeting);
  } else showResumeOverlay("No s'ha pogut tornar a obrir el micròfon sol. Toca el botó per continuar.");
}
// Avís a tota la pantalla quan NO s'està gravant, amb un botó gran per continuar.
function showResumeOverlay(why) {
  if (!rec.meeting || rec.stopping) return;
  if (!rec.interrupted && !(rec.meeting.source === 'call' && rec.paused)) rec.interrupted = { at: Date.now(), atMs: rec.activeMs };
  if (why) $('#resume-why').textContent = why;
  if ($('#resume-rec').hidden) { try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch { /* res */ } }
  $('#resume-rec').hidden = false;
  document.title = "⚠️ No s'està gravant · Xiu-xiu";
}
function hideResumeOverlay() {
  $('#resume-rec').hidden = true;
  if (rec.meeting) document.title = rec.meeting.source === 'call' ? '🔴 Gravant la videotrucada · Xiu-xiu' : '🔴 Gravant · Xiu-xiu';
}
$('#btn-resume-rec').onclick = async () => {
  if (!rec.meeting) { hideResumeOverlay(); return; }
  const btn = $('#btn-resume-rec');
  btn.disabled = true;
  try {
    if (rec.meeting.source === 'call' && rec.paused) await togglePause(); // torna a demanar la pestanya (dins del toc)
    else if (rec.interrupted) await resumeAfterInterruption({ manual: true });
    else if (rec.paused) await togglePause();
    else { primeAudio(); await recoverMic(); }
  } finally { btn.disabled = false; }
  if (rec.meeting && !rec.paused && rec.recorder && rec.recorder.state === 'recording') hideResumeOverlay();
};
// Vigilant: si el micròfon queda mut o el motor d'àudio interromput sense avisar, es detecta igual.
function watchMic() {
  if (!rec.meeting || rec.paused || rec.stopping || rec.recovering || rec.resuming || rec.meeting.engine === 'device' || document.visibilityState !== 'visible') { rec.muteSince = 0; rec.idleSince = 0; return; }
  // Qualsevol cas: la gravadora fa estona que no grava (entre trams només s'atura un instant).
  if (!rec.recorder || rec.recorder.state !== 'recording') {
    rec.idleSince = rec.idleSince || Date.now();
    if (Date.now() - rec.idleSince > 4000) { rec.idleSince = 0; if (rec.meeting.source === 'call') recoverMic(); else { micInterrupted(); resumeAfterInterruption(); } }
  } else rec.idleSince = 0;
  if (rec.meeting.source === 'call') return;
  const track = rec.stream && rec.stream.getAudioTracks()[0];
  const ctxSt = rec.audioCtx && rec.audioCtx.state;
  const bad = !track || track.readyState === 'ended' || track.muted || ctxSt === 'interrupted';
  if (!bad) { rec.muteSince = 0; return; }
  rec.muteSince = rec.muteSince || Date.now();
  if (Date.now() - rec.muteSince < 2500) return;
  rec.muteSince = 0;
  if (!rec.interrupted) micInterrupted();
  resumeAfterInterruption();
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

// cont: reunió ja feta que es vol continuar gravant (s'hi afegeix àudio i es refà el resum).
async function startRecording(cont = null) {
  const miss = missingSetup();
  if (miss.length) { toast(`Falta configurar: ${miss.join(', ')}`); showView('settings'); return; }
  if (rec.starting) return; // ja s'està iniciant (doble toc)
  if (rec.meeting) {
    // Una gravació que ja va: torna-hi. Si era un estat penjat (sense gravadora), es neteja.
    const alive = rec.recorder && rec.recorder.state !== 'inactive';
    if (alive || rec.paused) { showView('rec'); return; }
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    stopExtraStreams();
    Object.assign(rec, { meeting: null, stream: null, recorder: null });
  }
  primeAudio(); // dins del toc
  rec.starting = true;
  const token = uid();
  rec.startToken = token;
  const btn = $('#btn-record');
  btn.classList.add('starting'); btn.disabled = true;
  const caption = $('#record-caption') ? $('#record-caption').textContent : '';
  if ($('#record-caption')) $('#record-caption').textContent = 'Iniciant la gravació…';
  const done = () => { rec.starting = false; btn.classList.remove('starting'); btn.disabled = false; if ($('#record-caption')) $('#record-caption').textContent = caption; };
  // Vigilant: si en 25 s no ha començat, s'atura i s'avisa (mai no es queda encallat).
  const watchdog = setTimeout(() => {
    if (rec.startToken !== token || !rec.starting) return;
    rec.startToken = null;
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    stopExtraStreams();
    Object.assign(rec, { meeting: null, stream: null, recorder: null });
    done();
    toast("No s'ha pogut començar a gravar (el micròfon no ha respost). Torna a tocar el botó. Si passa sovint, tanca Xiu-xiu del tot i torna-la a obrir.", 9000);
  }, 25000);
  try {
    await startRecordingInner(cont, token);
  } finally {
    clearTimeout(watchdog);
    if (rec.startToken === token) { rec.startToken = null; done(); }
  }
}
async function startRecordingInner(cont, token) {
  const cancelled = () => rec.startToken !== token;

  const m = cont || {
    id: uid(),
    title: $('#meeting-title').value.trim(),
    context: $('#meeting-context').value.trim(),
    group: $('#meeting-group').value.trim(),
    source: CAN_CAPTURE_CALL && settings.source === 'call' ? 'call' : 'mic',
    startedAt: Date.now(),
    createdAt: Date.now(),
    durationMs: 0,
    engine: settings.engine,
    speakers: settings.engine !== 'device' && settings.speakers !== false && settings.lastType !== 'revisio',
    reviewFor: reviewForm(),
    agenda: settings.lastType === 'important' ? $('#meeting-agenda').value.trim() : '',
    type: settings.lastType || 'general',
    status: 'recording',
    segments: [],
    marks: [],
    summary: '',
    email: { status: 'pending' },
  };

  const prevStatus = m.status;
  if (cont) {
    // Al mòbil no es pot capturar una videotrucada: es continua amb el micròfon.
    if (m.source === 'call' && !CAN_CAPTURE_CALL) m.source = 'mic';
  }
  try {
    if (m.engine !== 'device') {
      rec.mime = pickMime();
      if (rec.mime === null) throw new Error('Aquest navegador no pot gravar àudio');
      rec.meeting = m; // openMic necessita saber la font (micròfon o videotrucada)
      await openMic();
      if (cancelled()) { rec.stream && rec.stream.getTracks().forEach((t) => t.stop()); stopExtraStreams(); return; }
    }
    if (cont) {
      // Marca on comença la continuació i demana refer el resum en acabar.
      const when = new Date().toLocaleString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      m.segments.push({ idx: m.segments.length, startMs: m.durationMs || 0, status: 'done', text: `[Continuació gravada el ${when}]` });
      m.needsResummary = true;
      delete m.audioPurged;
      delete m.retryAt;
      m.autoRetries = 0;
      m.status = 'recording';
      m.error = '';
    }
    if (!cont) await attachAgendaPhotos(m);
    Object.assign(rec, { meeting: m, activeMs: cont ? (m.durationMs || 0) : 0, paused: false, stopping: false, levels: [], avgLevel: null, quietMs: 0, resuming: false, recovering: false });
    await saveMeeting(m);
    if (m.engine !== 'device') { if (!startSegment()) throw new Error("No s'ha pogut començar a gravar l'àudio."); } else startSpeech();
  } catch (e) {
    rec.meeting = null;
    if (cont) m.status = prevStatus;
    // Allibera el micròfon i la captura de pantalla si ja s'havien obert.
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    stopExtraStreams();
    rec.stream = null;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    toast(denied ? TXT.micDenied : e.message, 7000);
    return;
  }

  if (cancelled()) return;
  // La pantalla de gravació surt de seguida; mantenir la pantalla encesa es demana en paral·lel.
  const warn = (hasWake) => { $('#rec-warning').textContent = m.source === 'call'
    ? "Pots anar a la pestanya de la videotrucada: Xiu-xiu continua gravant. No tanquis aquesta pestanya ni deixis de compartir."
    : CAN_CAPTURE_CALL
      ? 'No tanquis aquesta pestanya mentre gravis.'
      : (hasWake ? "No bloquegis el mòbil ni canviïs d'app: el mòbil atura el micròfon de les webs en segon pla." : TXT.noWake); };
  $('#rec-warning').hidden = false;
  warn(true);
  requestWakeLock().then(warn);
  $('#rec-title').textContent = m.title || fmtDate(m.startedAt);
  $('#btn-pause').textContent = 'Pausa';
  setRecStateUi();
  $('#rec-warn').hidden = true;
  rec.interrupted = null; rec.muteSince = 0; $('#resume-rec').hidden = true;
  $('#rec-inputs').hidden = m.source !== 'call';
  $('#in-mic').classList.toggle('off', m.source === 'call' && !rec.inMic);
  rec.inMax = { call: 0, mic: 0 }; rec.inWarned = { call: false, mic: false }; rec.inSince = rec.activeMs;
  showView('rec');
  document.title = m.source === 'call' ? '🔴 Gravant la videotrucada · Xiu-xiu' : '🔴 Gravant · Xiu-xiu';
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
  let dt = now - rec.lastTick;
  // A l'iPhone, amb la pantalla bloquejada o una altra app, no es grava: aquest temps no compta.
  if (rec.hiddenAt && IS_IOS && rec.meeting && rec.meeting.source !== 'call') dt = Math.min(dt, 1000);
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
  if (!rec.paused && rec.meeting.engine !== 'device') updateInputs();
  if (Math.floor(rec.activeMs / 1000) !== Math.floor((rec.activeMs - dt) / 1000)) watchMic();
  // Desa la durada de tant en tant per si es talla.
  if (Math.floor(rec.activeMs / 10000) !== Math.floor((rec.activeMs - 250) / 10000)) {
    rec.meeting.durationMs = rec.activeMs;
    saveMeeting(rec.meeting);
  }
}

// Indicadors de so (trucada i micròfon) i avís si alguna entrada no rep res.
function levelOf(an) {
  if (!an) return 0;
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buf.length) * 6);
}
function updateInputs() {
  const box = $('#rec-inputs');
  const call = rec.meeting && rec.meeting.source === 'call';
  if (!rec.inMax) return;
  const lc = call ? levelOf(rec.inCall) : 0, lm = levelOf(rec.inMic);
  rec.inMax.call = Math.max(rec.inMax.call, lc); rec.inMax.mic = Math.max(rec.inMax.mic, lm);
  box.hidden = !call;
  if (call) {
    $('#in-call').classList.toggle('on', lc > 0.03);
    $('#in-mic').classList.toggle('on', lm > 0.03);
    $('#in-mic').classList.toggle('off', !rec.inMic);
  }
  // Al cap d'una estona, si una entrada no ha rebut mai so, s'avisa (un sol cop).
  const since = rec.activeMs - (rec.inSince || 0);
  if (since < 25000) return;
  const warn = [];
  if (call && !rec.inWarned.call && rec.inMax.call < 0.02) {
    rec.inWarned.call = true;
    warn.push("No arriba el so de la videotrucada. Torna a començar i, en compartir, tria la pestanya de la reunió (o «Tota la pantalla») i marca «Comparteix també l'àudio».");
  }
  // En una videotrucada potser només escoltes: el micròfon s'avisa més tard.
  if (!rec.inWarned.mic && rec.inMic && rec.inMax.mic < 0.02 && (!call || since > 90000)) {
    rec.inWarned.mic = true;
    warn.push(`El micròfon no capta res${call ? ' (la teva veu no es gravarà)' : ''}. Si fas servir un micròfon extern, tria'l a Ajustos › Micròfon.`);
  }
  if (warn.length) {
    $('#rec-warn').hidden = false;
    $('#rec-warn').textContent = `⚠️ ${warn.join(' ')}`;
    toast(`⚠️ ${warn[0]}`, 9000);
  }
}

function setRecStateUi() {
  const el = $('#rec-state-text').parentElement;
  el.classList.toggle('paused', rec.paused);
  $('#rec-state-text').textContent = rec.paused ? 'En pausa' : 'Gravant';
}

// Pausa: tanca el tram en curs (queda desat i es transcriu). En continuar,
// comprova que el micròfon segueixi viu (el mòbil el pot tallar si es bloqueja)
// i comença un tram nou.
async function togglePause() {
  if (!rec.meeting || rec.resuming) return;
  if (rec.meeting.engine === 'device') {
    rec.paused = !rec.paused;
    if (rec.speech) { if (rec.paused) rec.speech.stop(); else { try { rec.speech.start(); } catch { /* ja actiu */ } } }
  } else if (!rec.paused) {
    rec.paused = true;
    stopRecorder(rec.recorder);
  } else {
    rec.resuming = true;
    $('#btn-pause').disabled = true;
    try {
      // En videotrucada, el que cal que segueixi viu és la captura de la trucada.
      const tracks = rec.meeting.source === 'call'
        ? (rec.extraStreams || []).flatMap((st) => st.getAudioTracks())
        : (rec.stream ? rec.stream.getAudioTracks() : []);
      const alive = tracks.length && tracks.some((t) => t.readyState === 'live')
        && (rec.meeting.source !== 'call' || (rec.extraStreams[0] && rec.extraStreams[0].getAudioTracks().some((t) => t.readyState === 'live')));
      if (!alive) await openMic(); // ara, mentre el clic encara compta (cal per tornar a triar la pestanya)
      if (rec.recorder && rec.recorder.xxStopped && rec.recorder.state === 'inactive') await rec.recorder.xxStopped;
      await segmentChain;
      if (!rec.meeting || rec.stopping) return;
      if (rec.audioCtx && rec.audioCtx.state !== 'running') await withTimeout(rec.audioCtx.resume(), 1500);
      rec.paused = false;
      rec.lastTick = performance.now();
      if (!rec.recorder || rec.recorder.state === 'inactive') startSegment();
      else if (rec.recorder.state === 'paused') rec.recorder.resume();
      rec.interrupted = null;
      hideResumeOverlay();
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      toast(denied ? TXT.micDenied : (e && e.message) || "No s'ha pogut reprendre la gravació.", 7000);
    } finally {
      rec.resuming = false;
      $('#btn-pause').disabled = false;
    }
  }
  $('#btn-pause').textContent = rec.paused ? 'Continua' : 'Pausa';
  setRecStateUi();
}

async function stopRecording() {
  document.title = 'Xiu-xiu';
  if (!rec.meeting || rec.stopping) return;
  rec.stopping = true;
  const m = rec.meeting;
  clearInterval(rec.tickTimer);
  $('#btn-stop').disabled = true;
  try {
    if (m.engine !== 'device') {
      const r = rec.recorder;
      if (r && r.state !== 'inactive') {
        stopRecorder(r);
        // Espera que la gravadora lliuri l'últim tros (amb un límit, per si de cas).
        await Promise.race([r.xxStopped, sleep(5000)]);
      }
      await sleep(50);
      await segmentChain.catch(() => {});
    } else if (rec.speech) {
      rec.speech.onend = null;
      rec.speech.stop();
      await sleep(800); // deixa arribar els últims resultats
    }
  } finally {
    rec.stream && rec.stream.getTracks().forEach((t) => t.stop());
    stopExtraStreams();
    if (rec.wakeLock) { rec.wakeLock.release().catch(() => {}); rec.wakeLock = null; }
    try { rec.peakNode && rec.peakNode.disconnect(); rec.tapNode && rec.tapNode.disconnect(); rec.mixer && rec.mixer.disconnect(); } catch { /* res */ }
    rec.tapNode = null; rec.live = null;
    // Es tanca (no s'adorm): a l'iPhone, un motor adormit no es pot tornar a engegar fora d'un toc.
    if (rec.audioCtx) { rec.audioCtx.close().catch(() => {}); rec.audioCtx = null; }
    Object.assign(rec, { meeting: null, stream: null, recorder: null, speech: null, analyser: null, peakNode: null, mixer: null, interrupted: null, muteSince: 0 });
    hideResumeOverlay();
    $('#btn-stop').disabled = false;
  }
  m.durationMs = rec.activeMs;
  m.status = 'processing';
  await saveMeeting(m);
  $('#meeting-title').value = '';
  $('#meeting-context').value = '';
  $('#meeting-group').value = '';
  $('#meeting-agenda').value = '';
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
    const segs = m.segments.slice().sort((a, b) => a.idx - b.idx);
    segs.forEach((s) => {
      if (s.status === 'done' && s.text) s.text.split('\n').filter(Boolean).forEach((l) => add(l));
    });
    // Esborrany en directe del que encara no té la transcripció bona.
    const open = segs.filter((s) => s.status !== 'done').map((s) => s.startMs || 0);
    const cut = open.length ? Math.min(...open) : (rec.segStartMs || 0);
    const drafts = rec.live && rec.live.mid === m.id ? rec.live.drafts.filter((x) => x.endMs > cut + 1500) : [];
    drafts.forEach((x) => add(x.text, 'draft'));
    $('#live-label').textContent = drafts.length ? 'Transcripció en directe · esborrany' : 'Transcripció en directe';
    if (!drafts.length && m.segments.some((s) => s.status === 'pending')) add('Transcrivint…', 'interim');
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
  if (!rec.meeting) return;
  const mobileMic = IS_IOS && rec.meeting.engine !== 'device' && rec.meeting.source !== 'call';
  if (document.visibilityState === 'hidden') {
    if (mobileMic && !rec.paused) rec.hiddenAt = Date.now();
    return;
  }
  // Tornem a l'app: a l'iPhone, el temps amb el mòbil bloquejat o en una altra app no s'ha gravat.
  if (rec.hiddenAt) {
    const gap = Date.now() - rec.hiddenAt;
    rec.hiddenAt = null;
    if (gap > 8000) {
      rec.meeting.gaps = [...(rec.meeting.gaps || []), { atMs: rec.activeMs, ms: gap }];
      saveMeeting(rec.meeting);
      toast(`⚠️ Durant ${fmtGap(gap)} no s'ha gravat: el mòbil estava bloquejat o en una altra app. Mantén Xiu-xiu obert i la pantalla encesa.`, 9000);
    }
  }
  if (!rec.wakeLock || rec.wakeLock.released) await requestWakeLock();
  if (rec.interrupted && !rec.paused) { resumeAfterInterruption(); return; } // tornem d'una trucada
  if (rec.audioCtx && rec.audioCtx.state !== 'running') rec.audioCtx.resume().catch(() => {});
  if (rec.meeting.engine !== 'device' && !rec.paused) {
    const dead = () => {
      const tracks = rec.meeting && rec.meeting.source === 'call'
        ? (rec.extraStreams || []).flatMap((st) => st.getAudioTracks())
        : (rec.stream ? rec.stream.getAudioTracks() : []);
      return !tracks.length || tracks.every((t) => t.readyState === 'ended');
    };
    if (dead()) { recoverMic(); return; }
    // Entre tram i tram la gravadora està un moment aturada: comprova-ho al cap d'una estona.
    if (!rec.recorder || rec.recorder.state === 'inactive') {
      await sleep(2000);
      if (rec.meeting && !rec.paused && !rec.stopping && rec.stream && (!rec.recorder || rec.recorder.state === 'inactive')) startSegment();
    }
  }
});
window.addEventListener('beforeunload', (e) => { if (rec.meeting) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------------
// Font de l'àudio a l'ordinador: micròfon o videotrucada
// ---------------------------------------------------------------------------
function renderSourceSwitch() {
  $('#source-switch').hidden = !CAN_CAPTURE_CALL;
  $('#call-mobile-note').hidden = CAN_CAPTURE_CALL;
  const src = CAN_CAPTURE_CALL && settings.source === 'call' ? 'call' : 'mic';
  document.querySelectorAll('#source-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === src)));
  $('#source-hint').hidden = src !== 'call';
}
document.querySelectorAll('#source-switch button').forEach((b) => {
  b.onclick = () => { saveSettings({ source: b.dataset.source }); renderSourceSwitch(); };
});

// ---------------------------------------------------------------------------
// Gravar amb un toc: en obrir l'app (ajust o enllaç ?rec=1) surt un botó gran a tota la pantalla
// ---------------------------------------------------------------------------
function offerQuickRec() {
  if (rec.meeting || rec.starting || missingSetup().length || currentView !== 'home' || document.querySelector('.sheet:not([hidden])')) return;
  const t = MEETING_TYPES[settings.lastType || 'general'] || MEETING_TYPES.general;
  $('#quick-rec-mode').textContent = `${t.label}${CAN_CAPTURE_CALL && settings.source === 'call' ? ' · videotrucada' : ''}`;
  $('#quick-rec').hidden = false;
}
$('#btn-quick-rec').onclick = () => { $('#quick-rec').hidden = true; $('#btn-record').click(); };
$('#btn-quick-no').onclick = () => { $('#quick-rec').hidden = true; };
let hiddenSince = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); return; }
  // L'iPhone no torna a obrir l'app: la reprèn. Si fa estona que no s'hi entrava, també s'ofereix.
  if (settings.quickStart && hiddenSince && Date.now() - hiddenSince > 10 * 60000) offerQuickRec();
  hiddenSince = 0;
});

// ---------------------------------------------------------------------------
// Triar el micròfon (p. ex. un micròfon extern o uns auriculars) i provar-lo
// ---------------------------------------------------------------------------
async function fillMicSelects() {
  const sels = document.querySelectorAll('.mic-select');
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch { /* res */ }
  const named = devs.some((d) => d.label);
  sels.forEach((sel) => {
    sel.innerHTML = '<option value="">El de l\'ordinador (per defecte)</option>';
    devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `Micròfon ${i + 1}`; sel.appendChild(o); });
    if (!named) { const o = document.createElement('option'); o.value = '__ask'; o.textContent = '🔍 Mostra els noms dels micròfons…'; sel.appendChild(o); }
    // Un micròfon triat que ara no hi és (desconnectat): es manté a la llista.
    if (settings.micId && !devs.some((d) => d.deviceId === settings.micId)) { const o = document.createElement('option'); o.value = settings.micId; o.textContent = `${settings.micLabel || 'Micròfon triat'} (no connectat)`; sel.appendChild(o); }
    sel.value = settings.micId || '';
  });
}
async function onMicChange(e) {
  const v = e.target.value;
  if (v === '__ask') {
    // Els noms només es veuen després de donar permís al micròfon.
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); }
    catch { toast("Cal donar permís al micròfon per veure'n els noms."); }
    await fillMicSelects();
    return;
  }
  const label = v ? e.target.selectedOptions[0].textContent : '';
  saveSettings({ micId: v, micLabel: label });
  document.querySelectorAll('.mic-select').forEach((s) => { s.value = v; });
  toast(v ? `🎤 Gravaré amb «${label}»` : "🎤 Gravaré amb el micròfon de l'ordinador");
}
document.querySelectorAll('.mic-select').forEach((s) => { s.onchange = onMicChange; s.onfocus = () => { if (s.options.length <= 2) fillMicSelects(); }; });
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => fillMicSelects());
let micTest = null;
$('#btn-mic-test').onclick = async () => {
  if (micTest) return;
  const msg = $('#mic-test-msg'), bar = $('#mic-test-level');
  if (rec.meeting) { msg.textContent = 'Ara estàs gravant: prova-ho quan acabis.'; return; }
  let st;
  try { st = await getMicStream(); } catch (e) { msg.textContent = `✗ ${e.message || "No s'ha pogut obrir el micròfon"}`; return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(st).connect(an);
  const name = (st.getAudioTracks()[0] || {}).label || 'micròfon';
  msg.textContent = `Parla ara… (${name})`;
  let max = 0;
  const t0 = performance.now();
  micTest = setInterval(() => {
    const l = levelOf(an); max = Math.max(max, l);
    bar.style.width = `${Math.round(l * 100)}%`;
    if (performance.now() - t0 > 6000) {
      clearInterval(micTest); micTest = null; bar.style.width = '0';
      st.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {});
      msg.textContent = max > 0.08 ? `✓ Et sento bé amb «${name}».` : max > 0.02 ? `Et sento molt fluix amb «${name}». Apropa't o puja el volum del micròfon.` : `✗ No arriba so de «${name}». Tria un altre micròfon o revisa que no estigui silenciat.`;
    }
  }, 100);
};
