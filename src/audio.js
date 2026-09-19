const PATTERNS = Object.freeze({
  start: { notes: [392, 523, 659], step: 0.08, duration: 0.16, gain: 0.04 },
  action: { notes: [440, 554], step: 0.05, duration: 0.1, gain: 0.035 },
  success: { notes: [523, 659, 784, 1047], step: 0.09, duration: 0.18, gain: 0.05 },
  failure: { notes: [260, 196], step: 0.1, duration: 0.18, gain: 0.045 },
  finish: { notes: [784, 659, 523], step: 0.16, duration: 0.28, gain: 0.05 },
  dash: { notes: [220, 330], step: 0.04, duration: 0.08, gain: 0.03 },
});

const MAX_VOICES = 12;

function contextConstructor() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext;
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
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    } catch {
      /* Disconnect is best effort when audio is unavailable. */
    }
  }

  function stopVoice(voice) {
    if (!active.delete(voice)) return;
    try {
      voice.oscillator.stop();
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
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const voice = { oscillator, gain, disconnected: false };
        const at = context.currentTime + index * pattern.step;
        oscillator.type = kind === 'failure' ? 'triangle' : 'sine';
        oscillator.frequency.value = note;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(pattern.gain, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, at + pattern.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          active.delete(voice);
          disconnect(voice);
        };
        active.add(voice);
        oscillator.start(at);
        oscillator.stop(at + pattern.duration);
      });
      return true;
    } catch {
      stop();
      return false;
    }
  }

  return { play, setEnabled, stop };
}
