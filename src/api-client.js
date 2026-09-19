/**
 * Session-ticketed API client.
 *
 * The Worker bills a model call only for a request that carries a server-issued
 * run ticket, so every billed call goes through here. The ticket is cached in
 * memory per mode and refreshed shortly before it expires.
 */
const REFRESH_WINDOW_MS = 60 * 1000;

const sessions = new Map();

async function requestSession(mode, signal) {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
    // Bound the session call by the same caller deadline as the decision, so an
    // offline session cannot leave a decision pending forever.
    signal,
  });
  if (!response.ok) throw new Error(`session: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok || typeof data.ticket !== 'string' || !Number.isFinite(data.expiresAt))
    throw new Error('session failed');
  return { ticket: data.ticket, expiresAt: data.expiresAt, seed: data.seed };
}

function readyTicket(mode) {
  const cached = sessions.get(mode);
  if (cached?.ticket && cached.expiresAt - REFRESH_WINDOW_MS > Date.now()) return cached.ticket;
  return null;
}

export async function runTicket(mode, signal) {
  const ready = readyTicket(mode);
  if (ready) return ready;
  const cached = sessions.get(mode);
  if (cached?.inflight) return cached.inflight;
  const inflight = requestSession(mode, signal).then(
    (session) => {
      sessions.set(mode, session);
      return session.ticket;
    },
    (error) => {
      sessions.delete(mode);
      throw error;
    },
  );
  sessions.set(mode, { ...cached, inflight });
  return inflight;
}

/** Seed of the cached session ticket, or undefined when none is available. */
export async function sessionSeed(mode) {
  if (!readyTicket(mode)) await runTicket(mode);
  return sessions.get(mode)?.seed;
}

/** POST a billed request with a fresh run ticket for `mode`. */
export async function apiFetch(path, body, mode, options = {}) {
  // Keep the cached path synchronous up to `fetch` so a decision that already
  // holds a ticket is issued in the same tick (tests and retry timing rely on it).
  const ticket = readyTicket(mode) ?? (await runTicket(mode, options.signal));
  // Submission closes this run; the next attempt needs its own decision chain.
  if (path === '/api/runs/finish') sessions.delete(mode);
  return fetch(path, {
    ...options,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-run-ticket': ticket,
      ...options.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
