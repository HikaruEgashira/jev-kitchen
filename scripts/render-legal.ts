import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Inline syntax used by the notice documents: code, bold, links.
const inline = (text: string): string =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const alignment = (cell: string): 'left' | 'right' | 'center' =>
  cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left';

const cells = (row: string): string[] =>
  row
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

const renderTable = (rows: string[]): string => {
  const head = cells(rows[0]);
  const align = cells(rows[1]).map(alignment);
  const cell = (tag: string, text: string, column: number): string =>
    `<${tag}${align[column] === 'left' ? '' : ` class="${align[column]}"`}>${inline(text)}</${tag}>`;
  return [
    '<table>',
    `<thead><tr>${head.map((text, column) => cell('th', text, column)).join('')}</tr></thead>`,
    '<tbody>',
    ...rows.slice(2).map(
      (row) =>
        `<tr>${cells(row)
          .map((text, c) => cell('td', text, c))
          .join('')}</tr>`,
    ),
    '</tbody>',
    '</table>',
  ].join('');
};

const isBlockStart = (line: string): boolean => /^(#{1,6} |```|\||[-*] )/.test(line);

// Renders the subset used by the notice documents. Headings start at h2 so the
// page keeps a single h1.
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      html.push(renderTable(rows));
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^[-*] /.test(lines[i])) items.push(lines[i].slice(2));
        else if (/^\s+\S/.test(lines[i]) && items.length)
          items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]))
      paragraph.push(lines[i++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

// The static pages are built ahead of the deploy, so the card image is written
// as an absolute URL here instead of being injected at build time.
const SITE = 'SIDEKICK kitchen';
const OG_IMAGE = 'https://jev-kitchen.egahika.dev/og.png';

const page = (title: string, description: string, body: string): string => `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | ${SITE}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE}" />
    <meta property="og:title" content="${title} | ${SITE}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/legal.css" />
  </head>
  <body>
    <header class="legal-nav">
      <a href="/">SIDEKICK kitchen</a>
      <nav>
        <a href="/licenses.html">ライセンス</a>
        <a href="/third-party-notices.html">追加通知</a>
      </nav>
    </header>
    <main class="legal">
${body}
    </main>
  </body>
</html>
`;

const read = (path: string): string => readFileSync(path, 'utf8');

const PAGES: Record<string, () => string> = {
  'public/licenses.html': () =>
    page(
      'ライセンス',
      'このアプリが同梱または利用する第三者ソフトウェアのライセンス一覧です。',
      [
        '<h1>ライセンス</h1>',
        '<p>このアプリが同梱または利用する第三者ソフトウェアの一覧と、バンドルされた依存関係のライセンス本文です。</p>',
        renderMarkdown(read('THIRD_PARTY_NOTICES.md')),
        renderMarkdown(read('dist/licenses.md')),
      ].join('\n'),
    ),
  'public/third-party-notices.html': () =>
    page(
      '追加通知',
      'このアプリが利用する第三者ソフトウェアの追加通知です。',
      ['<h1>追加通知</h1>', renderMarkdown(read('public/third-party-notices.md'))].join('\n'),
    ),
};

export function buildPages(): Record<string, string> {
  return Object.fromEntries(Object.entries(PAGES).map(([file, render]) => [file, render()]));
}

// Importing this file for the renderer must not touch the filesystem.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [file, html] of Object.entries(buildPages())) {
    if (!check) {
      writeFileSync(file, html);
      continue;
    }
    let current = '';
    try {
      current = read(file);
    } catch {
      // A missing output counts as stale.
    }
    if (current !== html) stale.push(file);
  }
  if (stale.length) throw new Error(`Run pnpm legal: stale ${stale.join(', ')}`);
}
