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

let speechQueue = [], speaking = false, cachedVoices = [], voicesListener = null, lastSpeechText = '';
const criticalEmotions = new Set(['victory', 'legendary', 'urgent', 'battle']);
const loadVoices = () => { if ('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices(); };
export function prepareSpeech() { if (!('speechSynthesis' in window) || voicesListener) return; loadVoices(); voicesListener = loadVoices; window.speechSynthesis.addEventListener('voiceschanged', voicesListener); }
function playNext() {
  if (speaking || !speechQueue.length || !('speechSynthesis' in window)) return;
  const { text, mode } = speechQueue.shift(), u = new SpeechSynthesisUtterance(text); speaking = true;
  u.lang = 'pt-BR'; u.volume = 1; u.rate = 1.25; u.pitch = mode === 'female' ? 1.3 : 1.1;
  const portuguese = cachedVoices.filter((v) => v.lang.toLowerCase().startsWith('pt'));
  const brazilian = portuguese.filter((v) => v.lang.toLowerCase() === 'pt-br');
  const hint = mode === 'female' ? /female|femin|francisca|maria|luciana|helena/i : /male|mascul|antonio|antônio|daniel|felipe|ricardo/i;
  u.voice = brazilian.find((v) => hint.test(v.name)) || brazilian[0] || portuguese[0] || cachedVoices[0] || null;
  u.onend = u.onerror = () => { speaking = false; playNext(); };
  window.speechSynthesis.speak(u);
}

export function speak(text, options = {}) {
  if (typeof options === 'string') options = { mode: options };
  if (!enabled || !('speechSynthesis' in window) || !text) return;
  const { mode = 'male', emotion = 'hype', priority = false } = options, normalized = String(text).trim();
  if (!normalized || normalized === lastSpeechText || speechQueue.some((item) => item.text === normalized)) return;
  prepareSpeech(); lastSpeechText = normalized;
  if (priority || criticalEmotions.has(emotion)) { window.speechSynthesis.cancel(); speechQueue = []; speaking = false; speechQueue.unshift({ text: normalized, mode }); }
  else { speechQueue.push({ text: normalized, mode }); const waitingLimit = speaking ? 2 : 3; while (speechQueue.length > waitingLimit) speechQueue.shift(); }
  playNext();
}

export function cleanupSpeech() { speechQueue = []; speaking = false; lastSpeechText = ''; if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); if (voicesListener) window.speechSynthesis.removeEventListener('voiceschanged', voicesListener); } voicesListener = null; cachedVoices = []; }
