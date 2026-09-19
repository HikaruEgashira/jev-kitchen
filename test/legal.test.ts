import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderMarkdown } from '../scripts/render-legal.ts';

test('renderMarkdown covers the notice documents without leaking raw markdown', () => {
  const html = renderMarkdown(
    [
      '# Title',
      '',
      'A paragraph with `code`, **bold** and [a link](https://example.com/a).',
      'Wrapped onto a second line.',
      '',
      '## Table',
      '',
      '| Name | Version |',
      '| ---- | ------: |',
      '| `three` | 1.0.0 |',
      '',
      '## Steps',
      '',
      '- first',
      '- second',
      '  continued',
      '',
      '```text',
      'MIT <License>',
      '```',
    ].join('\n'),
  );
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<h3>Table<\/h3>/);
  assert.match(
    html,
    /<p>A paragraph with <code>code<\/code>, <strong>bold<\/strong> and <a href="https:\/\/example\.com\/a">a link<\/a>\. Wrapped onto a second line\.<\/p>/,
  );
  assert.match(html, /<th class="right">Version<\/th>/);
  assert.match(html, /<td><code>three<\/code><\/td><td class="right">1\.0\.0<\/td>/);
  assert.match(html, /<ul><li>first<\/li><li>second continued<\/li><\/ul>/);
  assert.match(html, /<pre><code>MIT &lt;License&gt;<\/code><\/pre>/);
  assert.ok(!html.includes('| ----'), 'table separators must not survive');
  assert.ok(!html.includes('**'), 'bold markers must not survive');
});

test('the served pages render every markdown source in the repository', () => {
  for (const file of ['public/licenses.html', 'public/third-party-notices.html']) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /href="\/legal\.css"/);
    assert.ok(!/^#{1,6} /m.test(html), `${file} still contains markdown headings`);
  }
});
