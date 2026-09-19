import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { TTFLoader } from 'three-stdlib';

const source = readdirSync('src')
  .filter((name) => /\.[jt]sx?$/.test(name))
  .map((name) => readFileSync(`src/${name}`, 'utf8'))
  .join('');
const codepoints = [...new Set([...source].map((char) => char.codePointAt(0)))]
  .filter((code) => code >= 32 && code < 0xfe00)
  .sort((a, b) => a - b);
if (process.argv.includes('--check')) {
  const covered = new Set(JSON.parse(readFileSync('public/fonts/coverage.json', 'utf8')));
  const missing = codepoints.filter((code) => !covered.has(code));
  if (missing.length)
    throw new Error(`Run pnpm fonts: missing ${String.fromCodePoint(...missing)}`);
  process.exit(0);
}
execFileSync(
  process.execPath,
  [
    'node_modules/@pmndrs/glyph/bin/glyph.js',
    'bake',
    '--input',
    'assets/fonts/MPLUSRounded1c-Bold.ttf',
    '--output',
    'public/fonts/kitchen.font.glb',
    '--unicodes',
    codepoints.map((code) => `U+${code.toString(16)}`).join(','),
    '--msdf',
    'em-size=32',
    '--yes',
  ],
  { stdio: 'inherit' },
);
writeFileSync('public/fonts/coverage.json', `${JSON.stringify(codepoints)}\n`);
const ttf = readFileSync('assets/fonts/MPLUSRounded1c-Bold.ttf');
const titleFont = new TTFLoader().parse(
  ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength),
);
titleFont.glyphs = Object.fromEntries(
  [...new Set('SIDEKICK')].map((letter) => [letter, titleFont.glyphs[letter]]),
);
writeFileSync('public/fonts/title.typeface.json', `${JSON.stringify(titleFont)}\n`);
