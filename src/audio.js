let ctx;
let musicTimer;
let enabled = false;
let effectsEnabled = true;
let howlerModule = null;
let howlerLoading = null;
const howlBank = new Map();
const HOWLER_CDN = 'https://cdn.jsdelivr.net/npm/howler@2.2.4/+esm';
const context = () => ctx ||= new (window.AudioContext || window.webkitAudioContext)();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const SOUND_PROFILES = Object.freeze({
  shot: { notes: [760, 360], duration: 0.11, volume: 0.2 },
  laser: { notes: [1050, 680, 310], duration: 0.14, volume: 0.2 },
  hit: { notes: [145, 75], duration: 0.14, volume: 0.23, noise: 0.34 },
  shield: { notes: [420, 720, 1040], duration: 0.28, volume: 0.2 },
  heal: { notes: [440, 554, 659, 880], duration: 0.34, volume: 0.17 },
  boost: { notes: [340, 620, 980], duration: 0.22, volume: 0.18 },
  join: { notes: [360, 620, 920], duration: 0.22, volume: 0.16 },
  warning: { notes: [880, 880, 620], duration: 0.24, volume: 0.14 },
  explosion: { notes: [92, 48], duration: 0.48, volume: 0.3, noise: 0.55 },
  meteor: { notes: [130, 72, 42], duration: 0.72, volume: 0.29, noise: 0.42 },
  elimination: { notes: [420, 170, 74], duration: 0.38, volume: 0.23 },
  storm: { notes: [86, 64, 48], duration: 0.5, volume: 0.18, noise: 0.2 },
  like: { notes: [660, 880, 1100], duration: 0.24, volume: 0.15 },
  start: { notes: [110, 165, 220, 330], duration: 0.45, volume: 0.2 },
  win: { notes: [330, 440, 554, 659, 880], duration: 0.7, volume: 0.2 },
  legendary: { notes: [440, 659, 880, 1320], duration: 0.48, volume: 0.2 },
  boss: { notes: [72, 58, 44], duration: 0.72, volume: 0.28, noise: 0.18 },
  'boss-phase': { notes: [165, 220, 330, 494], duration: 0.52, volume: 0.22 },
  'boss-critical': { notes: [110, 82, 55, 41], duration: 0.68, volume: 0.3, noise: 0.36 },
});

function wavDataUri(profile) {
  const sampleRate = 11025;
  const duration = Math.max(0.08, Number(profile.duration) || 0.2);
  const samples = Math.floor(sampleRate * duration);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  const notes = profile.notes?.length ? profile.notes : [440];
  const segment = Math.max(1, Math.floor(samples / notes.length));
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const noteIndex = Math.min(notes.length - 1, Math.floor(i / segment));
    const freq = notes[noteIndex];
    phase += Math.PI * 2 * freq / sampleRate;
    const local = (i % segment) / segment;
    const attack = Math.min(1, local / 0.08);
    const release = Math.min(1, (1 - local) / 0.24);
    const envelope = Math.max(0, Math.min(attack, release));
    const harmonic = Math.sin(phase) * 0.7 + Math.sin(phase * 2.03) * 0.2 + Math.sin(phase * 0.5) * 0.1;
    const noise = (Math.random() * 2 - 1) * Number(profile.noise || 0);
    const value = clamp((harmonic + noise) * envelope * 0.72, -1, 1);
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function ensureHowler() {
  if (howlerModule) return howlerModule;
  if (howlerLoading) return howlerLoading;
  howlerLoading = import(/* @vite-ignore */ HOWLER_CDN)
    .then((module) => {
      howlerModule = module;
      module.Howler?.volume?.(0.9);
      return module;
    })
    .catch(() => null)
    .finally(() => { howlerLoading = null; });
  return howlerLoading;
}

function playHowler(kind) {
  if (!howlerModule?.Howl) return false;
  const profile = SOUND_PROFILES[kind] || SOUND_PROFILES.shot;
  let sound = howlBank.get(kind);
  if (!sound) {
    sound = new howlerModule.Howl({ src: [wavDataUri(profile)], format: ['wav'], preload: true, volume: profile.volume ?? 0.18, pool: 6 });
    howlBank.set(kind, sound);
  }
  sound.play();
  return true;
}

export function unlockAudio() {
  enabled = true;
  context().resume();
  void ensureHowler();
}

export function setSound(on) {
  effectsEnabled = on;
  if (howlerModule?.Howler) howlerModule.Howler.mute(!on);
}

function tone(freq, duration, type = 'sine', volume = 0.09, end = freq / 2, delay = 0, musicLayer = false) {
  if (!enabled || (!effectsEnabled && !musicLayer)) return;
  const c = context();
  const start = c.currentTime + delay;
  const oscillator = c.createOscillator();
  const gain = c.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(25, freq), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, end), start + duration);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain).connect(c.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(duration = 0.25, volume = 0.05, delay = 0) {
  if (!enabled || !effectsEnabled) return;
  const c = context();
  const start = c.currentTime + delay;
  const length = Math.ceil(c.sampleRate * duration);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(filter).connect(gain).connect(c.destination);
  source.start(start);
}

function fallbackSfx(kind) {
  const sounds = {
    shot: () => { tone(720, 0.08, 'square', 0.055, 260); tone(980, 0.05, 'sine', 0.025, 420, 0.025); },
    laser: () => { tone(820, 0.1, 'square', 0.065, 240); tone(1240, 0.06, 'sine', 0.025, 520, 0.02); },
    hit: () => { noise(0.12, 0.07); tone(130, 0.14, 'sawtooth', 0.08, 48); },
    shield: () => { tone(420, 0.28, 'sine', 0.065, 980); tone(840, 0.32, 'triangle', 0.04, 1260, 0.08); },
    heal: () => { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.18, 'sine', 0.045, f * 1.04, i * 0.09)); },
    boost: () => { [350, 620, 960].forEach((f, i) => tone(f, 0.16, 'triangle', 0.04, f * 1.1, i * 0.05)); },
    meteor: () => { tone(95, 1.05, 'sawtooth', 0.12, 28); noise(0.8, 0.15, 0.55); },
    explosion: () => { tone(150, 0.2, 'square', 0.06, 50); noise(0.45, 0.12, 0.12); },
    join: () => { tone(350, 0.16, 'sine', 0.04, 620); tone(700, 0.22, 'triangle', 0.05, 980, 0.1); },
    warning: () => { tone(880, 0.12, 'square', 0.04, 620); tone(880, 0.12, 'square', 0.04, 620, 0.16); },
    start: () => { [110, 165, 220, 330].forEach((f, i) => tone(f, 0.34, 'sawtooth', 0.07, f * 1.7, i * 0.11)); },
    elimination: () => { tone(420, 0.18, 'square', 0.07, 80); tone(95, 0.5, 'sawtooth', 0.09, 36, 0.08); },
    storm: () => { tone(64, 0.9, 'sawtooth', 0.06, 38); noise(0.6, 0.045); },
    like: () => { [660, 880, 1100].forEach((f, i) => tone(f, 0.16, 'sine', 0.04, f * 1.1, i * 0.07)); },
    win: () => { [330, 440, 554, 659, 880].forEach((f, i) => tone(f, 0.55, 'triangle', 0.065, f * 1.08, i * 0.12)); },
    legendary: () => { [440, 659, 880, 1320].forEach((f, i) => tone(f, 0.23, 'triangle', 0.05, f * 1.06, i * 0.08)); },
    boss: () => { tone(72, 0.72, 'sawtooth', 0.08, 36); noise(0.4, 0.06, 0.1); },
    'boss-phase': () => { [165, 220, 330, 494].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.05, f * 1.15, i * 0.07)); },
    'boss-critical': () => { tone(110, 0.62, 'sawtooth', 0.1, 38); noise(0.5, 0.09); },
  };
  (sounds[kind] || sounds.shot)();
}

export function sfx(kind) {
  if (!enabled || !effectsEnabled) return;
  if (!playHowler(kind)) {
    fallbackSfx(kind);
    void ensureHowler();
  }
}

export function setMusic(on) {
  if (!on) {
    clearInterval(musicTimer);
    musicTimer = null;
    return;
  }
  if (musicTimer) return;
  let step = 0;
  const bass = [55, 55, 65.4, 49, 55, 73.4, 65.4, 49];
  musicTimer = setInterval(() => {
    if (!enabled) return;
    const f = bass[step++ % bass.length];
    tone(f, 0.34, 'triangle', 0.018, f * 0.92, 0, true);
    if (step % 4 === 1) tone(110, 0.08, 'sine', 0.015, 55, 0, true);
  }, 390);
}

const MAX_PENDING_SPEECH = 4;
const FAST_STALE_MS = 4000;
let speechQueue = [];
let speaking = false;
let cachedVoices = [];
let voicesListener = null;
let lastSpeechText = '';

const loadVoices = () => {
  if ('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices();
};

export function prepareSpeech() {
  if (!('speechSynthesis' in window) || voicesListener) return;
  loadVoices();
  voicesListener = loadVoices;
  window.speechSynthesis.addEventListener('voiceschanged', voicesListener);
}

const isProtectedSpeech = (item) => item.path === 'slow' || item.eventType === 'round:ended' || item.emotion === 'victory' || item.emotion === 'legendary';
const pruneStaleSpeech = (now = Date.now()) => {
  speechQueue = speechQueue.filter((item) => item.path !== 'fast' || now - item.createdAt <= FAST_STALE_MS);
};
const oldestIndex = (predicate) => {
  let index = -1;
  let oldest = Infinity;
  speechQueue.forEach((item, i) => {
    if (predicate(item) && item.createdAt < oldest) {
      oldest = item.createdAt;
      index = i;
    }
  });
  return index;
};
const makeSpeechRoom = (incoming) => {
  pruneStaleSpeech();
  if (speechQueue.length < MAX_PENDING_SPEECH) return true;
  const disposableFast = oldestIndex((item) => item.path === 'fast' && !isProtectedSpeech(item));
  if (disposableFast >= 0) {
    speechQueue.splice(disposableFast, 1);
    return true;
  }
  if (!isProtectedSpeech(incoming)) return false;
  const lowerPriority = oldestIndex((item) => item.eventType !== 'round:ended' && Number(item.priorityLevel || 1) <= Number(incoming.priorityLevel || 1));
  if (lowerPriority >= 0) {
    speechQueue.splice(lowerPriority, 1);
    return true;
  }
  return false;
};

const voiceScore = (voice, mode) => {
  const lang = String(voice.lang || '').toLowerCase();
  const name = String(voice.name || '');
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
  const utterance = new SpeechSynthesisUtterance(item.text);
  speaking = true;
  utterance.lang = 'pt-BR';
  utterance.volume = 1;
  utterance.rate = 1.45;
  utterance.pitch = 1.25;
  utterance.voice = bestPortugueseVoice(item.mode);
  utterance.onend = utterance.onerror = () => {
    speaking = false;
    playNext();
  };
  window.speechSynthesis.speak(utterance);
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
  speechQueue = [];
  speaking = false;
  lastSpeechText = '';
  clearInterval(musicTimer);
  musicTimer = null;
  for (const sound of howlBank.values()) sound.unload?.();
  howlBank.clear();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    if (voicesListener) window.speechSynthesis.removeEventListener('voiceschanged', voicesListener);
  }
  voicesListener = null;
  cachedVoices = [];
}

export const speechQueuePolicy = Object.freeze({ maxPending: MAX_PENDING_SPEECH, fastStaleMs: FAST_STALE_MS });
