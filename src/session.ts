/**
 * Stateless run tickets and edge rate limiting for the public API.
 *
 * Model routes must never be reachable without a server-issued ticket: a session
 * costs a rate-limited round trip, so an anonymous caller cannot turn the Worker
 * into an open Jev/LLM proxy. The ticket also carries the server seed used to
 * bind a later submission to this run.
 *
 * ponytail: tickets are stateless, so a captured ticket can be replayed until it
 * expires; per-IP rate limits bound that window. Upgrade path: a Durable Object
 * counter when a per-run call budget must be exact.
 */

export interface Ticket {
  /** Server run id; a submission is accepted once per id. */
  sid: string;
  /** Server seed for applicant draws and order layout. */
  seed: number;
  mode: 'play' | 'bench';
  /** Unix milliseconds. */
  exp: number;
}

/** The Cloudflare Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    };
  }
  return cachedKey.key;
}

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== 'object') return false;
  const ticket = value as Record<string, unknown>;
  return (
    typeof ticket.sid === 'string' &&
    ticket.sid.length > 0 &&
    ticket.sid.length <= 64 &&
    Number.isSafeInteger(ticket.seed) &&
    (ticket.mode === 'play' || ticket.mode === 'bench') &&
    Number.isSafeInteger(ticket.exp)
  );
}

export async function signTicket(secret: string, ticket: Ticket): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Constant-time signature check; returns null for anything malformed or expired. */
export async function verifyTicket(
  secret: string,
  token: unknown,
  now: number,
): Promise<Ticket | null> {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  let given: Uint8Array;
  try {
    given = fromBase64Url(signature);
  } catch {
    return null;
  }
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)),
  );
  if (given.length !== expected.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= expected[index] ^ given[index];
  if (difference !== 0) return null;
  try {
    const ticket: unknown = JSON.parse(decoder.decode(fromBase64Url(payload)));
    if (!isTicket(ticket) || ticket.exp <= now) return null;
    return ticket;
  } catch {
    return null;
  }
}

/** Fail closed: a limiter error denies the request instead of opening the model. */
export async function withinLimit(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

export const clientKey = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  'local';
