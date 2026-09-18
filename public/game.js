import {
  createGame,
  stationAt,
  moveToward,
  interact,
  advance,
  buildCandidates,
  isFeasible,
  buildQuestions,
  rulePick,
  observe,
  STATIONS,
  STATION_IDS,
  ITEM_EMOJI,
  SPEED,
} from './model.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const g = createGame();
const keys = new Set();
const hud = { action: '—', obs: '—', age: '—', lat: '—', conf: '—', cands: 0 };
let mode = 'jev';
let policy = '';
let inFlight = false;
let dropped = 0;
let decisions = 0;
let lastDecideAt = -1e9;
const DECIDE_MS = 420; // decision cadence; RTT is ~100-500ms so we never queue observations

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- input

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    keys.add(k);
    ev.preventDefault();
  } else if ((k === 'e' || k === ' ') && !ev.repeat) {
    ev.preventDefault();
    humanInteract();
  }
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function humanInteract() {
  const near = stationAt(g, 'human');
  if (!near.inReach) return;
  const r = interact(g, 'human', near.id);
  if (r.ok) record('human', r.action);
}

function record(who, label) {
  const e = g[who];
  e.action = label;
  if (e.lastActions) {
    e.lastActions.push({ t: g.time, label });
    if (e.lastActions.length > 6) e.lastActions.shift();
  }
  log(who === 'ai' ? 'AI' : 'You', label);
}

// ---------------------------------------------------------------- ai

function stepAi(dt) {
  const ai = g.ai;
  if (!ai.intent) return;

  const it = ai.intent;
  if (it.id === 'wait') {
    if (g.time - it.startedAt > 600) ai.intent = null;
    return;
  }

  const st = STATIONS[it.station];
  if (!moveToward(ai, st.x, st.y, SPEED * dt)) return;

  const r = interact(g, 'ai', it.station);
  if (r.ok) {
    record('ai', r.action);
    ai.intent = null;
  } else if (it.station === 'board' && g.stations.board.state === 'chopping') {
    // wait it out; the board will free itself
  } else {
    log('AI', `× ${it.label}`);
    ai.intent = null;
  }
}

async function maybeDecide() {
  if (inFlight || g.ai.intent) return;
  if (g.time - lastDecideAt < DECIDE_MS) return;
  lastDecideAt = g.time;

  const cands = buildCandidates(g, 'ai');
  const obs = observe(g, policy);
  const obsAt = performance.now();

  if (mode === 'rule') {
    applyDecision(rulePick(g, cands), obsAt, 0, null, cands, null);
    return;
  }

  inFlight = true;
  const t0 = performance.now();
  try {
    const res =
      mode === 'llm'
        ? await postJson('/api/decide-llm', {
            state: obs,
            candidates: cands.map((c) => ({ id: c.id, label: c.label })),
          })
        : await postJson('/api/decide', { state: obs, questions: buildQuestions(cands) });

    const latency = Math.round(performance.now() - t0);
    if (!res || res.ok === false) {
      log('AI', `! ${res?.error ?? 'no response'}`);
      return;
    }
    const answer = res.result?.answers?.next_action;
    const cand = cands.find((c) => c.id === answer?.choice);
    applyDecision(cand, obsAt, latency, answer?.confidence ?? null, cands, res.upstreamMs, res.via);
  } catch (err) {
    log('AI', `! ${err?.message ?? err}`);
  } finally {
    inFlight = false;
  }
}

function applyDecision(cand, obsAt, latency, confidence, cands, upstreamMs, via) {
  decisions += 1;
  hud.obs = obsLabel(obsAt);
  hud.age = `${Math.round(performance.now() - obsAt)} ms`;
  hud.lat = upstreamMs != null ? `${latency}ms（model ${upstreamMs}ms · ${via}）` : `${latency} ms`;
  hud.conf = confidence == null ? '—' : confidence.toFixed(2);
  hud.cands = cands.length;

  if (!cand) {
    dropped += 1;
    hud.action = '（選択肢にない応答）';
    log('AI', '× 不正な選択');
    return;
  }
  if (!isFeasible(g, cand)) {
    dropped += 1;
    hud.action = `${cand.label} → 破棄`;
    log('AI', `× ${cand.label}（状況が変化）`);
    return;
  }
  g.ai.intent = { ...cand, startedAt: g.time };
  hud.action = cand.label;
  log('AI', `→ ${cand.label} (${latency}ms)`);
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ---------------------------------------------------------------- frame

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  g.time += dt * 1000;

  const ax =
    (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
    (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const ay =
    (keys.has('s') || keys.has('arrowdown') ? 1 : 0) -
    (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (ax || ay) {
    const l = Math.hypot(ax, ay);
    g.human.x = clamp(g.human.x + (ax / l) * SPEED * dt, 40, W - 40);
    g.human.y = clamp(g.human.y + (ay / l) * SPEED * dt, 40, H - 40);
  }

  advance(g);
  const hNear = stationAt(g, 'human');
  const aNear = stationAt(g, 'ai');
  g.human.station = hNear.inReach ? hNear.id : null;
  g.ai.station = aNear.inReach ? aNear.id : null;

  stepAi(dt);
  maybeDecide();

  draw();
  renderHud();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- draw

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawStation(id) {
  const s = STATIONS[id];
  roundRect(s.x - 60, s.y - 38, 120, 76, 12);
  ctx.fillStyle = '#1f2836';
  ctx.fill();
  ctx.strokeStyle = g[`${id}Active`] ? '#7cc4ff' : '#3a4a63';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText(s.name, s.x, s.y - 22);

  let label = '';
  if (id === 'board') {
    const b = g.stations.board;
    label = b.state === 'chopping' ? '🔪 切っている…' : b.state === 'chopped' ? '🥗 切ったトマト' : '（空）';
  } else if (id === 'crate') {
    label = '🍅 無限';
  } else if (id === 'plates') {
    label = '🍽️ 山';
  } else if (id === 'serve') {
    label = `✅ ${g.served} 配膳`;
  }
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#9fb3d1';
  ctx.fillText(label, s.x, s.y + 8);

  if (id === 'board' && g.stations.board.state === 'chopping') {
    const p = clamp((g.time - (g.stations.board.busyUntil - 1400)) / 1400, 0, 1);
    ctx.fillStyle = '#7cc4ff';
    ctx.fillRect(s.x - 50, s.y + 24, 100 * p, 4);
  }
}

function drawActor(a, color, name) {
  if (a.intent?.station) {
    const s = STATIONS[a.intent.station];
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,209,102,.5)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(a.x, a.y, 18, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0b0f16';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (a.carrying) {
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(ITEM_EMOJI[a.carrying], a.x, a.y - 32);
  }
  ctx.fillStyle = '#0b0f16';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(name, a.x, a.y + 4);
}

function draw() {
  ctx.fillStyle = '#141a24';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  for (const id of STATION_IDS) drawStation(id);
  drawActor(g.human, '#7cc4ff', 'あなた');
  drawActor(g.ai, '#ffd166', mode === 'jev' ? 'AI·Jev' : mode === 'llm' ? 'AI·LLM' : 'AI·固定');
}

// ---------------------------------------------------------------- hud

function renderHud() {
  $('s-action').textContent = hud.action;
  $('s-obs').textContent = hud.obs;
  $('s-age').textContent = hud.age;
  $('s-lat').textContent = hud.lat;
  $('s-conf').textContent = hud.conf;
  $('s-drop').textContent = `${dropped} / ${decisions}`;
  $('s-score').textContent = `${g.served}`;
  $('s-cands').textContent = `${hud.cands}`;
}

function obsLabel(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(ms % 1000, 3)}`;
}

function log(tag, text) {
  const el = document.createElement('div');
  el.className = 'logline';
  el.innerHTML = `<span class="tag">${esc(tag)}</span> ${esc(text)}`;
  const box = $('log');
  box.prepend(el);
  while (box.childElementCount > 40) box.lastElementChild.remove();
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- controls

document.querySelectorAll('#modes button').forEach((b) => {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x === b));
    g.ai.intent = null;
    log('system', `モード: ${b.textContent}`);
  });
});

$('policy').addEventListener('input', (ev) => {
  policy = ev.target.value;
});

document.querySelectorAll('.presets button').forEach((b) => {
  b.addEventListener('click', () => {
    $('policy').value = b.textContent;
    policy = b.textContent;
    log('system', `方針: ${b.textContent}`);
  });
});

requestAnimationFrame(frame);
