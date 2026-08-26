let ctx; let musicTimer; let enabled = false; let effectsEnabled = true;
const context = () => ctx ||= new (window.AudioContext || window.webkitAudioContext)();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function unlockAudio() { enabled = true; context().resume(); }
export function setSound(on) { effectsEnabled = on; }

function tone(freq, duration, type = 'sine', volume = .09, end = freq / 2, delay = 0, musicLayer = false) {
  if (!enabled || (!effectsEnabled && !musicLayer)) return;
  const c = context(), start = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(Math.max(25, freq), start); o.frequency.exponentialRampToValueAtTime(Math.max(25, end), start + duration);
  g.gain.setValueAtTime(.001, start); g.gain.exponentialRampToValueAtTime(volume, start + .015); g.gain.exponentialRampToValueAtTime(.001, start + duration);
  o.connect(g).connect(c.destination); o.start(start); o.stop(start + duration + .02);
}

function noise(duration = .25, volume = .05, delay = 0) {
  if (!enabled || !effectsEnabled) return;
  const c = context(), start = c.currentTime + delay, length = Math.ceil(c.sampleRate * duration), buffer = c.createBuffer(1, length, c.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(); source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 900;
  gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.001, start + duration); source.connect(filter).connect(gain).connect(c.destination); source.start(start);
}

export function sfx(kind) {
  if (!enabled || !effectsEnabled) return;
  const sounds = {
    shot: () => { tone(720, .08, 'square', .055, 260); tone(980, .05, 'sine', .025, 420, .025); },
    laser: () => { tone(820, .1, 'square', .065, 240); tone(1240, .06, 'sine', .025, 520, .02); },
    hit: () => { noise(.12, .07); tone(130, .14, 'sawtooth', .08, 48); },
    shield: () => { tone(420, .28, 'sine', .065, 980); tone(840, .32, 'triangle', .04, 1260, .08); },
    supply: () => { [440, 554, 659].forEach((f, i) => tone(f, .18, 'sine', .05, f * 1.04, i * .09)); },
    heal: () => { [440, 554, 659, 880].forEach((f, i) => tone(f, .18, 'sine', .045, f * 1.04, i * .09)); },
    grenade: () => { tone(180, .18, 'square', .05, 70); noise(.38, .11, .14); tone(72, .42, 'sawtooth', .12, 28, .12); },
    airstrike: () => { tone(980, .48, 'sawtooth', .045, 180); noise(.55, .12, .34); tone(58, .7, 'square', .13, 28, .3); },
    drone: () => { tone(180, .75, 'sawtooth', .035, 360); tone(880, .12, 'square', .07, 240, .55); },
    meteor: () => { tone(95, 1.05, 'sawtooth', .12, 28); noise(.8, .15, .55); tone(45, 1.1, 'square', .14, 25, .5); },
    explosion: () => { tone(150, .2, 'square', .06, 50); noise(.45, .12, .12); tone(55, .6, 'sawtooth', .1, 28, .1); },
    join: () => { tone(350, .16, 'sine', .04, 620); tone(700, .22, 'triangle', .05, 980, .1); },
    start: () => { [110, 165, 220, 330].forEach((f, i) => tone(f, .34, 'sawtooth', .07, f * 1.7, i * .11)); noise(.18, .05, .3); },
    elimination: () => { tone(420, .18, 'square', .07, 80); tone(95, .5, 'sawtooth', .09, 36, .08); },
    storm: () => { tone(64, .9, 'sawtooth', .06, 38); noise(.6, .045); },
    like: () => { [660, 880, 1100].forEach((f, i) => tone(f, .16, 'sine', .04, f * 1.1, i * .07)); },
    win: () => { [330, 440, 554, 659, 880].forEach((f, i) => tone(f, .55, 'triangle', .065, f * 1.08, i * .12)); },
  };
  (sounds[kind] || sounds.shot)();
}

export function setMusic(on) {
  if (!on) { clearInterval(musicTimer); musicTimer = null; return; }
  if (musicTimer) return;
  let step = 0; const bass = [55, 55, 65.4, 49, 55, 73.4, 65.4, 49];
  musicTimer = setInterval(() => {
    if (!enabled) return;
    const f = bass[step++ % bass.length];
    tone(f, .34, 'triangle', .018, f * .92, 0, true);
    if (step % 4 === 1) tone(110, .08, 'sine', .015, 55, 0, true);
  }, 390);
}

const MAX_PENDING_SPEECH = 4;
const FAST_STALE_MS = 4000;
let speechQueue = [], speaking = false, cachedVoices = [], voicesListener = null, lastSpeechText = '';
const criticalEmotions = new Set(['victory', 'legendary', 'urgent', 'battle']);
const loadVoices = () => { if ('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices(); };
export function prepareSpeech() { if (!('speechSynthesis' in window) || voicesListener) return; loadVoices(); voicesListener = loadVoices; window.speechSynthesis.addEventListener('voiceschanged', voicesListener); }

const isProtectedSpeech = (item) => item.path === 'slow' || item.eventType === 'round:ended' || item.emotion === 'victory' || item.emotion === 'legendary';
const pruneStaleSpeech = (now = Date.now()) => {
  speechQueue = speechQueue.filter((item) => item.path !== 'fast' || now - item.createdAt <= FAST_STALE_MS);
};
const oldestIndex = (predicate) => {
  let index = -1, oldest = Infinity;
  speechQueue.forEach((item, i) => { if (predicate(item) && item.createdAt < oldest) { oldest = item.createdAt; index = i; } });
  return index;
};
const makeSpeechRoom = (incoming) => {
  pruneStaleSpeech();
  if (speechQueue.length < MAX_PENDING_SPEECH) return true;
  const disposableFast = oldestIndex((item) => item.path === 'fast' && !isProtectedSpeech(item));
  if (disposableFast >= 0) { speechQueue.splice(disposableFast, 1); return true; }
  if (!isProtectedSpeech(incoming)) return false;
  const lowerPriority = oldestIndex((item) => item.eventType !== 'round:ended' && Number(item.priorityLevel || 1) <= Number(incoming.priorityLevel || 1));
  if (lowerPriority >= 0) { speechQueue.splice(lowerPriority, 1); return true; }
  return false;
};

const voiceScore = (voice, mode) => {
  const lang = String(voice.lang || '').toLowerCase(), name = String(voice.name || '');
  let score = lang === 'pt-br' ? 100 : lang.startsWith('pt') ? 50 : 0;
  if (/google|microsoft|edge/i.test(name)) score += 30;
  const genderHint = mode === 'female' ? /female|femin|francisca|maria|luciana|helena/i : /male|mascul|antonio|antônio|daniel|felipe|ricardo/i;
  if (genderHint.test(name)) score += 8;
  return score;
};
const bestPortugueseVoice = (mode) => [...cachedVoices].sort((a, b) => voiceScore(b, mode) - voiceScore(a, mode))[0] || null;

function playNext() {
  if (speaking || !('speechSynthesis' in window)) return;
  pruneStaleSpeech();
  speechQueue.sort((a, b) => Number(b.priorityLevel || 1) - Number(a.priorityLevel || 1) || a.createdAt - b.createdAt);
  const item = speechQueue.shift();
  if (!item) return;
  if (item.path === 'fast' && Date.now() - item.createdAt > FAST_STALE_MS) return playNext();
  const u = new SpeechSynthesisUtterance(item.text); speaking = true;
  u.lang = 'pt-BR'; u.volume = 1; u.rate = 1.45; u.pitch = 1.25; u.voice = bestPortugueseVoice(item.mode);
  u.onend = u.onerror = () => { speaking = false; playNext(); };
  window.speechSynthesis.speak(u);
}

export function speak(text, options = {}) {
  if (typeof options === 'string') options = { mode: options };
  if (!enabled || !('speechSynthesis' in window) || !text) return;
  const normalized = String(text).trim();
  if (!normalized || normalized === lastSpeechText || speechQueue.some((item) => item.text === normalized)) return;
  prepareSpeech();
  const priorityLevel = Number(options.priorityLevel || (options.priority ? 5 : 1));
  const item = {
    text: normalized,
    mode: options.mode || 'male',
    emotion: options.emotion || 'hype',
    priorityLevel: clamp(priorityLevel, 1, 5),
    path: options.path === 'slow' ? 'slow' : 'fast',
    eventType: String(options.eventType || 'system'),
    createdAt: Number(options.createdAt) || Date.now(),
  };
  if (!makeSpeechRoom(item)) return;
  lastSpeechText = normalized;
  speechQueue.push(item);
  playNext();
}

export function cleanupSpeech() {
  speechQueue = []; speaking = false; lastSpeechText = '';
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    if (voicesListener) window.speechSynthesis.removeEventListener('voiceschanged', voicesListener);
  }
  voicesListener = null; cachedVoices = [];
}

export const speechQueuePolicy = Object.freeze({ maxPending: MAX_PENDING_SPEECH, fastStaleMs: FAST_STALE_MS });
