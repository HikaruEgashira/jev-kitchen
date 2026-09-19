import assert from 'node:assert/strict';
import test from 'node:test';
import { apiFetch } from '../src/api-client.ts';

test('a submitted run never reuses its ticket for the next attempt', async (t) => {
  let sessions = 0;
  const tickets: Array<[string, string]> = [];
  let finish!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    if (path === '/api/session')
      return Response.json({
        ok: true,
        ticket: `run-${++sessions}`,
        expiresAt: Date.now() + 3600000,
      });
    tickets.push([path, (options.headers as Record<string, string>)['x-run-ticket']]);
    if (path === '/api/runs/finish')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Response.json({ ok: true });
  });
  await apiFetch('/api/bench/decide', {}, 'bench');
  const submitted = apiFetch('/api/runs/finish', {}, 'bench');
  await apiFetch('/api/bench/decide', {}, 'bench');
  finish(Response.json({ ok: true }));
  await submitted;
  assert.equal(sessions, 2);
  assert.deepEqual(tickets, [
    ['/api/bench/decide', 'run-1'],
    ['/api/runs/finish', 'run-1'],
    ['/api/bench/decide', 'run-2'],
  ]);
});
