/**
 * Session-ticketed API client.
 *
 * The Worker bills a model call only for a request that carries a server-issued
 * run ticket, so every billed call goes through here. The ticket is cached in
 * memory per mode and refreshed shortly before it expires.
 */
const REFRESH_WINDOW_MS = 60 * 1000;

interface Session {
  ticket?: string;
  expiresAt?: number;
  seed?: number;
  inflight?: Promise<string>;
}

const sessions = new Map<string, Session>();

async function requestSession(
  mode: string,
  signal?: AbortSignal,
): Promise<{ ticket: string; expiresAt: number; seed: number | undefined }> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
    // Bound the session call by the same caller deadline as the decision, so an
    // offline session cannot leave a decision pending forever.
    signal,
  });
  if (!response.ok) throw new Error(`session: HTTP ${response.status}`);
  const data: unknown = await response.json();
  const session = data as { ok?: boolean; ticket?: unknown; expiresAt?: unknown; seed?: unknown };
  if (!session.ok || typeof session.ticket !== 'string' || !Number.isFinite(session.expiresAt))
    throw new Error('session failed');
  return {
    ticket: session.ticket,
    expiresAt: session.expiresAt as number,
    seed: typeof session.seed === 'number' ? session.seed : undefined,
  };
}

function readyTicket(mode: string): string | null {
  const cached = sessions.get(mode);
  if (cached?.ticket && (cached.expiresAt ?? 0) - REFRESH_WINDOW_MS > Date.now())
    return cached.ticket;
  return null;
}

export async function runTicket(mode: string, signal?: AbortSignal): Promise<string> {
  const ready = readyTicket(mode);
  if (ready) return ready;
  const cached = sessions.get(mode);
  if (cached?.inflight) return cached.inflight;
  const inflight = requestSession(mode, signal).then(
    (session) => {
      sessions.set(mode, session);
      return session.ticket;
    },
    (error: unknown) => {
      sessions.delete(mode);
      throw error;
    },
  );
  sessions.set(mode, { ...cached, inflight });
  return inflight;
}

/** Seed of the cached session ticket, or undefined when none is available. */
export async function sessionSeed(mode: string): Promise<number | undefined> {
  if (!readyTicket(mode)) await runTicket(mode);
  return sessions.get(mode)?.seed;
}

/** POST a billed request with a fresh run ticket for `mode`. */
export async function apiFetch(
  path: string,
  body: unknown,
  mode: string,
  options: RequestInit = {},
): Promise<Response> {
  // Keep the cached path synchronous up to `fetch` so a decision that already
  // holds a ticket is issued in the same tick (tests and retry timing rely on it).
  const ticket = readyTicket(mode) ?? (await runTicket(mode, options.signal ?? undefined));
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
