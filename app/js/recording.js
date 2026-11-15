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
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
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
  try { rec.peakNode && rec.peakNode.disconnect(); rec.mixer && rec.mixer.disconnect(); } catch { /* res */ }
  rec.peakNode = null; rec.mixer = null;
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
    rec.audioCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(mixer);
    if (micStream) rec.audioCtx.createMediaStreamSource(micStream).connect(mixer);
    mixer.connect(dest);
    rec.mixer = mixer;
    display.getVideoTracks().forEach((t) => { t.enabled = false; });
    display.getAudioTracks().forEach((t) => { t.onended = () => { if (rec.meeting && !rec.stopping) toast("S'ha deixat de compartir la videotrucada. Toca «Acaba la reunió» o torna a començar.", 7000); }; });
    rec.extraStreams = micStream ? [display, micStream] : [display];
    rec.stream = dest.stream;
  } else {
    rec.stream = await getMicStream();
    rec.stream.getAudioTracks().forEach((t) => { t.onended = () => { if (!document.hidden) recoverMic(); }; });
  }
  try {
    if (!rec.audioCtx) rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (rec.audioCtx.state !== 'running') await withTimeout(rec.audioCtx.resume(), 1500);
    const src = rec.meeting && rec.meeting.source === 'call' && rec.mixer ? rec.mixer : rec.audioCtx.createMediaStreamSource(rec.stream);
    rec.analyser = rec.audioCtx.createAnalyser();
    rec.analyser.fftSize = 1024;
    src.connect(rec.analyser);
    await startPeakMeter(src);
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
    if (m && meterOk && peak < (settings.boost !== false ? SILENCE_PEAK / 2.5 : SILENCE_PEAK)) {
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
      toast("S'ha aturat la captura de la videotrucada. Toca «Continua» i torna a triar la pestanya de la trucada.", 9000);
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
    try { rec.peakNode && rec.peakNode.disconnect(); rec.mixer && rec.mixer.disconnect(); } catch { /* res */ }
    // Es tanca (no s'adorm): a l'iPhone, un motor adormit no es pot tornar a engegar fora d'un toc.
    if (rec.audioCtx) { rec.audioCtx.close().catch(() => {}); rec.audioCtx = null; }
    Object.assign(rec, { meeting: null, stream: null, recorder: null, speech: null, analyser: null, peakNode: null, mixer: null });
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
