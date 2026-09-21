interface SoundPattern {
  notes: number[];
  step: number;
  duration: number;
  gain: number;
}

interface Voice {
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
  disconnected: boolean;
}

const PATTERNS: Record<string, SoundPattern> = Object.freeze({
  start: { notes: [1046.5, 1046.5], step: 0.22, duration: 0.45, gain: 0.05 },
  action: { notes: [440, 554], step: 0.05, duration: 0.1, gain: 0.035 },
  success: { notes: [523, 659, 784, 1047], step: 0.09, duration: 0.18, gain: 0.05 },
  failure: { notes: [260, 196], step: 0.1, duration: 0.18, gain: 0.045 },
  finish: { notes: [784, 659, 523], step: 0.16, duration: 0.28, gain: 0.05 },
  applause: { notes: [0], step: 0, duration: 3, gain: 0.18 },
  dash: { notes: [220, 330], step: 0.04, duration: 0.08, gain: 0.03 },
  countdown: { notes: [880], step: 0, duration: 0.09, gain: 0.045 },
});

const MAX_VOICES = 12;

function contextConstructor(): typeof AudioContext | undefined {
  const global = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return global.AudioContext ?? global.webkitAudioContext;
}

function applauseBuffer(context: AudioContext): AudioBuffer {
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

/**
 * One struck-bell tone for the stage-start "カランカラン". Inharmonic partials
 * (a bell is not a harmonic stack) decay faster as they rise, so each strike
 * settles into its fundamental like a real chime.
 */
function bellBuffer(context: AudioContext, frequency: number): AudioBuffer {
  const duration = 0.5;
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  const partials = [1, 2.76, 5.4, 8.93];
  for (let i = 0; i < samples.length; i++) {
    const time = i / context.sampleRate;
    let value = 0;
    for (let p = 0; p < partials.length; p++) {
      value +=
        (Math.sin(2 * Math.PI * frequency * partials[p] * time) / (p + 1)) *
        Math.exp(-time * (2 + p * 5));
    }
    samples[i] = value * 0.35;
  }
  return buffer;
}

export function createAudio({ enabled = true }: { enabled?: boolean } = {}) {
  let context: AudioContext | undefined;
  const active = new Set<Voice>();
  let soundEnabled = enabled;
  let contextAwake = false;
  let contextStateChange = Promise.resolve();

  function queueContextState(method: 'resume' | 'suspend') {
    const ctx = context;
    if (!ctx?.[method]) return;
    contextStateChange = contextStateChange
      .catch(() => {})
      .then(() => ctx[method]())
      .catch(() => {
        if (method === 'resume') contextAwake = false;
      });
  }

  function resume() {
    if (contextAwake) return;
    contextAwake = true;
    queueContextState('resume');
  }

  function disconnect(voice: Voice) {
    if (voice.disconnected) return;
    voice.disconnected = true;
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      /* Disconnect is best effort when audio is unavailable. */
    }
  }

  function stopVoice(voice: Voice) {
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

  function setEnabled(next: unknown) {
    soundEnabled = Boolean(next);
    if (!soundEnabled) stop();
  }

  function play(kind: string): boolean {
    if (!soundEnabled) return false;
    const pattern = PATTERNS[kind];
    const AudioContextCtor = contextConstructor();
    if (!pattern || !AudioContextCtor) return false;
    try {
      context ??= new AudioContextCtor();
      const ctx = context;
      resume();
      while (active.size && active.size + pattern.notes.length > MAX_VOICES) {
        const oldest = active.values().next().value;
        if (!oldest) break;
        stopVoice(oldest);
      }
      pattern.notes.forEach((note, index) => {
        const source =
          kind === 'applause' || kind === 'start'
            ? ctx.createBufferSource()
            : ctx.createOscillator();
        const gain = ctx.createGain();
        const voice: Voice = { source, gain, disconnected: false };
        const at = ctx.currentTime + index * pattern.step;
        if (kind === 'applause') {
          (source as AudioBufferSourceNode).buffer = applauseBuffer(ctx);
        } else if (kind === 'start') {
          (source as AudioBufferSourceNode).buffer = bellBuffer(ctx, note);
        } else {
          const oscillator = source as OscillatorNode;
          oscillator.type = kind === 'failure' ? 'triangle' : 'sine';
          oscillator.frequency.value = note;
        }
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(pattern.gain, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, at + pattern.duration);
        source.connect(gain);
        gain.connect(ctx.destination);
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
