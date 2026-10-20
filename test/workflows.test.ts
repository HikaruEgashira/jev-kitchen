import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// GitHub deprecated the Node.js 20 runtime for JavaScript actions and forces
// actions that still target it onto Node.js 24. The first major version of each
// action that runs natively on Node.js 24 is recorded here; a pinned older
// major keeps emitting the deprecation warning in CI.
const NODE24_MINIMUM_MAJOR: Record<string, number> = {
  'actions/checkout': 5,
  'actions/create-github-app-token': 3,
  'actions/setup-node': 5,
  'actions/upload-artifact': 5,
  'pnpm/action-setup': 5,
};

test('workflow actions target the Node.js 24 runtime', () => {
  const directory = '.github/workflows';
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.yml'))) {
    const source = readFileSync(`${directory}/${file}`, 'utf8');
    for (const match of source.matchAll(/uses:\s*([^\s#]+)/g)) {
      const [action, ref] = match[1].split('@');
      const minimum = NODE24_MINIMUM_MAJOR[action];
      if (minimum === undefined) continue;
      const major = Number(ref?.replace(/^v/, ''));
      assert.ok(
        Number.isInteger(major) && major >= minimum,
        `${file}: ${action}@${ref} targets Node.js 20; pin v${minimum} or newer`,
      );
    }
  }
});

test('workflow app tokens use client-id instead of the deprecated app-id', () => {
  const directory = '.github/workflows';
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.yml'))) {
    const source = readFileSync(`${directory}/${file}`, 'utf8');
    if (!source.includes('actions/create-github-app-token')) continue;
    assert.doesNotMatch(source, /^\s*app-id:/m, `${file}: app-id is deprecated; use client-id`);
    assert.match(source, /^\s*client-id:/m, `${file}: create-github-app-token is missing client-id`);
  }
});
