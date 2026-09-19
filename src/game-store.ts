/**
 * Durable Object backing `RunStore`.
 *
 * One instance per `sid` holds that run's decision chain; a single `board`
 * instance holds the top scores. Everything the ranking trusts is written here
 * by the Worker, never by the client.
 */
import { MAX_BOARD } from './run-store.ts';

interface Storage {
  get(key: string): Promise<any>;
  put(key: string, value: unknown): Promise<void>;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export class GameStore {
  state: { storage: Storage };
  env: unknown;

  constructor(state: { storage: Storage }, env: unknown) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    const storage = this.state.storage;
    try {
      if (request.method === 'POST' && pathname === '/init') {
        const body: any = await request.json();
        const key = `run:${body.sid}`;
        if (!(await storage.get(key)))
          await storage.put(key, {
            sid: body.sid,
            level: body.level,
            protocol: body.protocol,
            decisions: [],
            status: 'open',
            startedAt: Date.now(),
          });
        return json({ ok: true });
      }
      if (request.method === 'POST' && pathname === '/append') {
        const body: any = await request.json();
        const key = `run:${body.sid}`;
        const run = await storage.get(key);
        if (!run) return json({ ok: false, error: 'unknown run' }, 404);
        if (run.status !== 'open') return json({ ok: false, error: 'run closed' }, 409);
        run.decisions.push(body.choice);
        await storage.put(key, run);
        return json({ ok: true, ordinal: run.decisions.length - 1 });
      }
      if (request.method === 'GET' && pathname === '/run') {
        return json({
          ok: true,
          run: (await storage.get(`run:${searchParams.get('sid')}`)) ?? null,
        });
      }
      if (request.method === 'POST' && pathname === '/finish') {
        const body: any = await request.json();
        const key = `run:${body.sid}`;
        const run = await storage.get(key);
        if (!run) return json({ ok: false, error: 'unknown run' }, 404);
        if (run.status === 'open') {
          run.status = 'finished';
          run.finishedAt = Date.now();
          await storage.put(key, run);
        }
        return json({ ok: true, run });
      }
      if (request.method === 'POST' && pathname === '/board') {
        const entry = await request.json();
        const board = (await storage.get('board')) ?? [];
        board.push(entry);
        board.sort((a: any, b: any) => b.score - a.score || a.timeMs - b.timeMs || a.at - b.at);
        await storage.put('board', board.slice(0, MAX_BOARD));
        return json({ ok: true });
      }
      if (request.method === 'GET' && pathname === '/board') {
        return json({ ok: true, board: (await storage.get('board')) ?? [] });
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch {
      return json({ ok: false, error: 'storage error' }, 500);
    }
  }
}
