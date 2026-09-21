/**
 * Server-owned state for verified runs and the leaderboard.
 *
 * `RunStore` is the seam the Worker talks to. Production uses Durable Objects
 * (`GameStore` in `src/game-store.ts`); tests inject `memoryRunStore`. Run state
 * lives with the run so a client cannot fork a decision chain or replay another
 * run's score.
 */
import type { BoardEntry, LeaderboardKind } from './types.ts';

export type { BoardEntry, LeaderboardKind };

export interface RunRecord {
  sid: string;
  seed: number;
  protocol: string;
  decisions: string[];
  status: 'open' | 'finished';
  startedAt: number;
  finishedAt?: number;
}

export const MAX_BOARD = 20;

const nonNegative = (value: unknown): number =>
  Number.isFinite(value) && (value as number) >= 0 ? Math.floor(value as number) : 0;

/** Normalize a stored entry; entries predating `kind`/`owner` are the bench board. */
export function normalizeBoardEntry(value: unknown): BoardEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<BoardEntry>;
  if (typeof entry.sid !== 'string' || entry.sid.length === 0) return null;
  return {
    sid: entry.sid,
    owner: typeof entry.owner === 'string' && entry.owner ? entry.owner : entry.sid,
    kind: entry.kind === 'human' ? 'human' : 'ai',
    protocol: typeof entry.protocol === 'string' ? entry.protocol : '',
    score: nonNegative(entry.score),
    served: nonNegative(entry.served),
    clearedLevels: nonNegative(entry.clearedLevels),
    reachedLevel: nonNegative(entry.reachedLevel),
    completed: entry.completed === true,
    truncated: entry.truncated === true,
    at: nonNegative(entry.at),
  };
}

/** Lower sorts first: furthest reach, then most cleared, then score, then oldest. */
export function rankBoard(a: BoardEntry, b: BoardEntry): number {
  return (
    b.reachedLevel - a.reachedLevel ||
    b.clearedLevels - a.clearedLevels ||
    b.score - a.score ||
    a.at - b.at
  );
}

/** Keep the top `MAX_BOARD` of each kind so one board cannot starve the other. */
function trimBoard(board: BoardEntry[]): BoardEntry[] {
  return (['human', 'ai'] as const).flatMap((kind) =>
    board
      .filter((entry) => entry.kind === kind)
      .sort(rankBoard)
      .slice(0, MAX_BOARD),
  );
}

/** Insert one entry, keeping only the best slot per (kind, owner). */
export function mergeBoard(board: BoardEntry[], entry: BoardEntry): BoardEntry[] {
  const index = board.findIndex((e) => e.kind === entry.kind && e.owner === entry.owner);
  const next = [...board];
  if (index < 0) next.push(entry);
  else if (rankBoard(entry, next[index]) < 0) next[index] = entry;
  else return board;
  return trimBoard(next);
}

export interface RunStore {
  init(sid: string, seed: number, protocol: string): Promise<void>;
  /** Append the server-issued choice to the run. Returns the ordinal, or null. */
  append(sid: string, choice: string): Promise<number | null>;
  finish(sid: string): Promise<RunRecord | null>;
  submit(entry: BoardEntry): Promise<void>;
  board(kind?: LeaderboardKind): Promise<BoardEntry[]>;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Adapter over the `GameStore` Durable Object namespace. */
export function durableRunStore(namespace: {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}): RunStore {
  const call = async <T>(
    stub: ReturnType<typeof namespace.get>,
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    const response = await stub.fetch(`https://game-store${path}`, init);
    return (await response.json()) as T;
  };
  const runStub = (sid: string) => namespace.get(namespace.idFromName(sid));
  const boardStub = () => namespace.get(namespace.idFromName('board'));
  return {
    async init(sid, seed, protocol) {
      await call<unknown>(runStub(sid), '/init', post({ sid, seed, protocol }));
    },
    async append(sid, choice) {
      const data = await call<{ ordinal?: number }>(runStub(sid), '/append', post({ sid, choice }));
      return typeof data.ordinal === 'number' ? data.ordinal : null;
    },
    async finish(sid) {
      const data = await call<{ run?: RunRecord | null }>(runStub(sid), '/finish', post({ sid }));
      return data.run ?? null;
    },
    async submit(entry) {
      await call<unknown>(boardStub(), '/board', post(entry));
    },
    async board(kind) {
      const query = kind ? `?kind=${kind}` : '';
      const data = await call<{ board?: BoardEntry[] }>(boardStub(), `/board${query}`);
      return Array.isArray(data.board) ? data.board : [];
    },
  };
}

/** In-memory store for tests and local runs without a Durable Object binding. */
export function memoryRunStore(): RunStore {
  const runs = new Map<string, RunRecord>();
  let board: BoardEntry[] = [];
  return {
    async init(sid, seed, protocol) {
      if (!runs.has(sid))
        runs.set(sid, {
          sid,
          seed,
          protocol,
          decisions: [],
          status: 'open',
          startedAt: Date.now(),
        });
    },
    async append(sid, choice) {
      const run = runs.get(sid);
      if (!run || run.status !== 'open') return null;
      run.decisions.push(choice);
      return run.decisions.length - 1;
    },
    async finish(sid) {
      const run = runs.get(sid);
      if (!run) return null;
      if (run.status === 'open') {
        run.status = 'finished';
        run.finishedAt = Date.now();
      }
      return run;
    },
    async submit(entry) {
      board = mergeBoard(board, entry);
    },
    async board(kind) {
      const sorted = [...board].sort(rankBoard);
      return kind ? sorted.filter((entry) => entry.kind === kind) : sorted;
    },
  };
}
