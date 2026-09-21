import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio } from '../src/audio.ts';
import { createGame } from '../src/model.ts';
import { useKitchen, tick } from '../src/game.ts';

interface FakeAudioParam {
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

interface FakeAudioBuffer {
  sampleRate: number;
  length: number;
  getChannelData(index: number): Float32Array;
}

/** The AudioContext slot is set to the fakes at runtime, so it is viewed as unknown here. */
const audioGlobal = globalThis as {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
};

class FakeGain {
  gain: FakeAudioParam;
  disconnected: number;

  constructor() {
    this.gain = {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    this.disconnected = 0;
  }

  connect() {}

  disconnect() {
    this.disconnected++;
  }
}

class FakeOscillator {
  frequency: { value: number };
  type: string;
  onended: (() => void) | null;
  started: number[];
  stopped: Array<number | undefined>;
  cancelled: number;
  disconnected: number;
  buffer?: FakeAudioBuffer;

  constructor() {
    this.frequency = { value: 0 };
    this.type = '';
    this.onended = null;
    this.started = [];
    this.stopped = [];
    this.cancelled = 0;
    this.disconnected = 0;
  }

  connect() {}

  start(at: number) {
    this.started.push(at);
  }

  stop(at?: number) {
    this.stopped.push(at);
    if (at === undefined) this.cancelled++;
  }

  disconnect() {
    this.disconnected++;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime: number;
  sampleRate: number;
  destination: object;
  oscillators: FakeOscillator[];
  buffers: FakeOscillator[];
  states: string[];

  constructor() {
    this.currentTime = 10;
    this.sampleRate = 8000;
    this.destination = {};
    this.oscillators = [];
    this.buffers = [];
    this.states = [];
    FakeAudioContext.instances.push(this);
  }

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const samples = new Float32Array(length);
    return { sampleRate, length, getChannelData: () => samples };
  }

  createBufferSource(): FakeOscillator {
    const source = new FakeOscillator();
    this.buffers.push(source);
    return source;
  }

  resume(): Promise<void> {
    this.states.push('resume');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.states.push('suspend');
    return Promise.resolve();
  }
}

test('audio patterns distinguish action, success, and failure', () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    assert.equal(audio.play('action'), true);
    assert.equal(audio.play('success'), true);
    assert.equal(audio.play('failure'), true);
    assert.deepEqual(
      FakeAudioContext.instances[0].oscillators.map(({ frequency, type }) => [
        frequency.value,
        type,
      ]),
      [
        [440, 'sine'],
        [554, 'sine'],
        [523, 'sine'],
        [659, 'sine'],
        [784, 'sine'],
        [1047, 'sine'],
        [260, 'triangle'],
        [196, 'triangle'],
      ],
    );
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('stage start rings a two-strike bell instead of an arpeggio', () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    assert.equal(audio.play('start'), true);
    const context = FakeAudioContext.instances[0];
    assert.equal(context.oscillators.length, 0);
    assert.equal(context.buffers.length, 2);
    assert.deepEqual(
      context.buffers.map((source) => source.started[0]),
      [10, 10.22],
    );
    const samples = context.buffers[0].buffer!.getChannelData(0);
    assert.ok(samples.some((value) => Math.abs(value) > 0.05));
    assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('clear applause is bounded, ends after three seconds, and obeys mute', () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    assert.equal(audio.play('applause'), true);
    const source = FakeAudioContext.instances[0].buffers[0];
    const samples = source.buffer!.getChannelData(0);
    assert.equal(source.buffer!.length / source.buffer!.sampleRate, 3);
    assert.ok(samples.some((value) => Math.abs(value) > 0.05));
    assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
    assert.deepEqual(source.started, [10]);
    assert.deepEqual(source.stopped, [13]);
    audio.setEnabled(false);
    assert.equal(source.cancelled, 1);
    assert.equal(audio.play('applause'), false);
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('finish uses a descending cadence and rapid playback has a voice ceiling', () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    audio.play('success');
    audio.play('success');
    audio.play('success');
    audio.play('finish');
    const voices = FakeAudioContext.instances[0].oscillators;
    assert.deepEqual(
      voices.slice(-3).map(({ frequency }) => frequency.value),
      [784, 659, 523],
    );
    assert.equal(voices.filter(({ cancelled }) => cancelled).length, 3);
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('mute stops scheduled voices and blocks later playback', () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    assert.equal(audio.play('finish'), true);
    const voices = FakeAudioContext.instances[0].oscillators;
    audio.setEnabled(false);
    assert.ok(voices.every(({ cancelled }) => cancelled === 1));
    assert.equal(audio.play('success'), false);
    audio.setEnabled(true);
    assert.equal(audio.play('success'), true);
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('stop suspends audio and a later play resumes in call order', async () => {
  const previous = audioGlobal.AudioContext;
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    audio.play('action');
    audio.stop();
    audio.play('action');
    await new Promise(setImmediate);
    assert.deepEqual(FakeAudioContext.instances[0].states, ['resume', 'suspend', 'resume']);
  } finally {
    audioGlobal.AudioContext = previous;
  }
});

test('audio remains optional when the browser has no AudioContext', () => {
  const previous = audioGlobal.AudioContext;
  const webkit = audioGlobal.webkitAudioContext;
  delete audioGlobal.AudioContext;
  delete audioGlobal.webkitAudioContext;
  try {
    const audio = createAudio();
    assert.equal(audio.play('success'), false);
    assert.equal(audio.play('unknown'), false);
  } finally {
    audioGlobal.AudioContext = previous;
    audioGlobal.webkitAudioContext = webkit;
  }
});

test('countdown sounds once at 5 through 1 seconds, respects pause and mute, and skips practice', () => {
  const previous = audioGlobal.AudioContext;
  const saved = useKitchen.getState();
  audioGlobal.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const game = createGame({ level: 4, stock: 1, hired: [], duty: [] });
    game.time = 84000;
    useKitchen.setState({ game, phase: 'playing', benchmark: true, sound: true });
    const beeps = () =>
      FakeAudioContext.instances
        .flatMap((c) => c.oscillators)
        .filter((o) => o.frequency.value === 880).length;
    tick(0.5);
    assert.equal(beeps(), 0);
    tick(0.5);
    assert.equal(beeps(), 1);
    useKitchen.setState({ phase: 'paused' });
    tick(1);
    assert.equal(beeps(), 1);
    useKitchen.setState({ phase: 'playing' });
    for (let second = 4; second >= 0; second--) {
      tick(0.5);
      tick(0.5);
      assert.equal(beeps(), Math.min(5, 6 - second));
    }
    game.time = 84000;
    useKitchen.setState({ phase: 'playing', sound: false });
    tick(1);
    assert.equal(beeps(), 5);
    game.time = 84000;
    game.practice = true;
    useKitchen.setState({ sound: true });
    tick(1);
    assert.equal(beeps(), 5);
  } finally {
    audioGlobal.AudioContext = previous;
    useKitchen.setState(saved, true);
  }
});
