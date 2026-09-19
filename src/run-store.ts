/**
 * Server-owned state for verified runs and the leaderboard.
 *
 * `RunStore` is the seam the Worker talks to. Production uses Durable Objects
 * (`GameStore` in `src/game-store.ts`); tests inject `memoryRunStore`. Run state
 * lives with the run so a client cannot fork a decision chain or replay another
 * run's score.
 */

export interface RunRecord {
  sid: string;
  level: number;
  protocol: string;
  decisions: string[];
  status: 'open' | 'finished';
  startedAt: number;
  finishedAt?: number;
}

export interface BoardEntry {
  sid: string;
  level: number;
  protocol: string;
  score: number;
  served: number;
  quota: number;
  completed: boolean;
  timeMs: number;
  missed: number;
  burned: number;
  at: number;
}

export const MAX_BOARD = 20;

export interface RunStore {
  init(sid: string, level: number, protocol: string): Promise<void>;
  /** Append the server-issued choice to the run. Returns the ordinal, or null. */
  append(sid: string, choice: string): Promise<number | null>;
  finish(sid: string): Promise<RunRecord | null>;
  submit(entry: BoardEntry): Promise<void>;
  board(): Promise<BoardEntry[]>;
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
  const call = async (stub: ReturnType<typeof namespace.get>, path: string, init?: RequestInit) => {
    const response = await stub.fetch(`https://game-store${path}`, init);
    return response.json() as Promise<any>;
  };
  const runStub = (sid: string) => namespace.get(namespace.idFromName(sid));
  const boardStub = () => namespace.get(namespace.idFromName('board'));
  return {
    async init(sid, level, protocol) {
      await call(runStub(sid), '/init', post({ sid, level, protocol }));
    },
    async append(sid, choice) {
      const data = await call(runStub(sid), '/append', post({ sid, choice }));
      return typeof data?.ordinal === 'number' ? data.ordinal : null;
    },
    async finish(sid) {
      const data = await call(runStub(sid), '/finish', post({ sid }));
      return data?.run ?? null;
    },
    async submit(entry) {
      await call(boardStub(), '/board', post(entry));
    },
    async board() {
      const data = await call(boardStub(), '/board');
      return Array.isArray(data?.board) ? data.board : [];
    },
  };
}

/** In-memory store for tests and local runs without a Durable Object binding. */
export function memoryRunStore(): RunStore {
  const runs = new Map<string, RunRecord>();
  let board: BoardEntry[] = [];
  return {
    async init(sid, level, protocol) {
      if (!runs.has(sid))
        runs.set(sid, {
          sid,
          level,
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
      board = [...board, entry]
        .sort((a, b) => b.score - a.score || a.timeMs - b.timeMs)
        .slice(0, MAX_BOARD);
    },
    async board() {
      return [...board];
    },
  };
}
