const PATTERNS = Object.freeze({
  start: { notes: [392, 523, 659], step: 0.08, duration: 0.16, gain: 0.04 },
  action: { notes: [440, 554], step: 0.05, duration: 0.1, gain: 0.035 },
  success: { notes: [523, 659, 784, 1047], step: 0.09, duration: 0.18, gain: 0.05 },
  failure: { notes: [260, 196], step: 0.1, duration: 0.18, gain: 0.045 },
  finish: { notes: [784, 659, 523], step: 0.16, duration: 0.28, gain: 0.05 },
  applause: { notes: [0], step: 0, duration: 3, gain: 0.18 },
  dash: { notes: [220, 330], step: 0.04, duration: 0.08, gain: 0.03 },
});

const MAX_VOICES = 12;

function contextConstructor() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext;
}

function applauseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let clap = 0; clap < 36; clap++) {
    const start = Math.floor((clap * 0.073 + Math.random() * 0.04) * context.sampleRate);
    for (let i = 0; i < context.sampleRate * 0.12 && start + i < samples.length; i++) {
      const time = i / context.sampleRate;
      samples[start + i] +=
        (Math.random() * 2 - 1) * Math.min(1, time / 0.002) * Math.exp(-time * 55) * 0.45;
    }
  }
  return buffer;
}

export function createAudio({ enabled = true } = {}) {
  let context;
  const active = new Set();
  let soundEnabled = enabled;
  let contextAwake = false;
  let contextStateChange = Promise.resolve();

  function queueContextState(method) {
    if (!context?.[method]) return;
    contextStateChange = contextStateChange
      .catch(() => {})
      .then(() => context[method]())
      .catch(() => {
        if (method === 'resume') contextAwake = false;
      });
  }

  function resume() {
    if (contextAwake) return;
    contextAwake = true;
    queueContextState('resume');
  }

  function disconnect(voice) {
    if (voice.disconnected) return;
    voice.disconnected = true;
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      /* Disconnect is best effort when audio is unavailable. */
    }
  }

  function stopVoice(voice) {
    if (!active.delete(voice)) return;
    try {
      voice.source.stop();
    } catch {
      /* An oscillator may already have ended. */
    }
    disconnect(voice);
  }

  function stop() {
    for (const voice of active) stopVoice(voice);
    contextAwake = false;
    queueContextState('suspend');
  }

  function setEnabled(next) {
    soundEnabled = Boolean(next);
    if (!soundEnabled) stop();
  }

  function play(kind) {
    if (!soundEnabled) return false;
    const pattern = PATTERNS[kind];
    const AudioContext = contextConstructor();
    if (!pattern || !AudioContext) return false;
    try {
      context ??= new AudioContext();
      resume();
      while (active.size && active.size + pattern.notes.length > MAX_VOICES) {
        stopVoice(active.values().next().value);
      }
      pattern.notes.forEach((note, index) => {
        const source =
          kind === 'applause' ? context.createBufferSource() : context.createOscillator();
        const gain = context.createGain();
        const voice = { source, gain, disconnected: false };
        const at = context.currentTime + index * pattern.step;
        if (kind === 'applause') source.buffer = applauseBuffer(context);
        else {
          source.type = kind === 'failure' ? 'triangle' : 'sine';
          source.frequency.value = note;
        }
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(pattern.gain, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, at + pattern.duration);
        source.connect(gain);
        gain.connect(context.destination);
        source.onended = () => {
          active.delete(voice);
          disconnect(voice);
        };
        active.add(voice);
        source.start(at);
        source.stop(at + pattern.duration);
      });
      return true;
    } catch {
      stop();
      return false;
    }
  }

  return { play, setEnabled, stop };
}
