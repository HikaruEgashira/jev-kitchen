import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio } from '../src/audio.js';

class FakeGain {
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

  start(at) {
    this.started.push(at);
  }

  stop(at) {
    this.stopped.push(at);
    if (at === undefined) this.cancelled++;
  }

  disconnect() {
    this.disconnected++;
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.currentTime = 10;
    this.destination = {};
    this.oscillators = [];
    this.states = [];
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return new FakeGain();
  }

  resume() {
    this.states.push('resume');
    return Promise.resolve();
  }

  suspend() {
    this.states.push('suspend');
    return Promise.resolve();
  }
}

test('audio patterns distinguish action, success, and failure', () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
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
    globalThis.AudioContext = previous;
  }
});

test('finish uses a descending cadence and rapid playback has a voice ceiling', () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
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
    globalThis.AudioContext = previous;
  }
});

test('mute stops scheduled voices and blocks later playback', () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
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
    globalThis.AudioContext = previous;
  }
});

test('stop suspends audio and a later play resumes in call order', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  FakeAudioContext.instances = [];
  try {
    const audio = createAudio();
    audio.play('action');
    audio.stop();
    audio.play('action');
    await new Promise(setImmediate);
    assert.deepEqual(FakeAudioContext.instances[0].states, ['resume', 'suspend', 'resume']);
  } finally {
    globalThis.AudioContext = previous;
  }
});

test('audio remains optional when the browser has no AudioContext', () => {
  const previous = globalThis.AudioContext;
  const webkit = globalThis.webkitAudioContext;
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  try {
    const audio = createAudio();
    assert.equal(audio.play('success'), false);
    assert.equal(audio.play('unknown'), false);
  } finally {
    globalThis.AudioContext = previous;
    globalThis.webkitAudioContext = webkit;
  }
});
