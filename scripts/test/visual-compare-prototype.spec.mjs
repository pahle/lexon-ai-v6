import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, test } from 'node:test';
import {
  parseDeviations,
  prototypeState,
  variantsFor,
  runCompare,
  pendingCompareIds,
  PROTOTYPE_REVISION,
} from '../visual-compare-prototype.mjs';

const script = resolve(import.meta.dirname, '../visual-compare-prototype.mjs');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** RGB PNG whose pixels come from pixel(x, y) -> [r, g, b]. */
function png(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const base = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), base + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const temps = [];
function temp() {
  const dir = mkdtempSync(resolve(tmpdir(), 'lexon-compare-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// A prototype with the same URL contract: white page, an animated `.spin`
// box at (10,10) 100x100 for state "alpha", nothing for any other state.
const prototypeHtml = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#fff"><div id="root"></div>
<script>
const id = location.hash.slice(1);
if (id === 'alpha') document.getElementById('root').innerHTML =
  '<div class="spin" style="position:absolute;left:10px;top:10px;width:100px;height:100px;background:#000"></div>';
</script>`;

function fixture() {
  const dir = temp();
  const captureDir = resolve(dir, 'review');
  mkdirSync(captureDir);
  const prototype = resolve(dir, 'prototype.html');
  writeFileSync(prototype, prototypeHtml);
  return { dir, captureDir, prototype, outDir: resolve(dir, 'compare') };
}
const white = () => [255, 255, 255];

test('maps indicator captures to the indicator state and leaves others alone', () => {
  for (const id of ['indicator-wander', 'indicator-mark', 'indicator-finished'])
    assert.deepEqual(prototypeState(id), {
      state: 'indicator',
      layoutOnly: true,
    });
  assert.deepEqual(prototypeState('sign-in'), {
    state: 'sign-in',
    layoutOnly: false,
  });
});

test('lists the four variants with their sheet names', () => {
  assert.deepEqual(
    variantsFor('x').map((v) => [v.key, v.sheet, v.size]),
    [
      ['desktop-light', 'x-d.png', [1440, 900]],
      ['desktop-dark', 'x-d-dark.png', [1440, 900]],
      ['mobile-light', 'x-m.png', [390, 844]],
      ['mobile-dark', 'x-m-dark.png', [390, 844]],
    ],
  );
});

test('parses deviations from the round 4 section only', () => {
  const md = `# T
| id | variant | % | reason |
| a | d | 9 | ignored, wrong section |

## Comparison deviations (round 4)

| id | variant | % | reason |
| --- | --- | --- | --- |
| \`sign-in\` | d-dark | 2.1 | font |
| chat-new | all | 3 | x |

## Other
| b | d | 1 | no |
`;
  const set = parseDeviations(md);
  assert.equal(set.has('sign-in', 'd-dark'), true);
  assert.equal(set.has('sign-in', 'd'), false);
  assert.equal(set.has('chat-new', 'm-dark'), true);
  assert.equal(set.has('a', 'd'), false);
  assert.equal(set.has('b', 'd'), false);
});

test('matching capture is 0 percent, mismatch fails, missing is reported', async () => {
  const f = fixture();
  // alpha: the animated box differs but its sidecar mask covers it.
  writeFileSync(
    resolve(f.captureDir, 'alpha-desktop-light.png'),
    png(1440, 900, white),
  );
  writeFileSync(
    resolve(f.captureDir, 'alpha-desktop-light.png.masks.json'),
    JSON.stringify([{ x: 20, y: 20, width: 10, height: 10 }]),
  );
  // beta: solid black against a white prototype.
  writeFileSync(
    resolve(f.captureDir, 'beta-desktop-light.png'),
    png(1440, 900, () => [0, 0, 0]),
  );
  const results = await runCompare({
    captureDir: f.captureDir,
    outDir: f.outDir,
    ids: ['alpha', 'beta'],
    prototype: f.prototype,
  });
  const by = (id, key) => results.find((r) => r.id === id && r.key === key);
  assert.equal(by('alpha', 'desktop-light').status, 'PASS');
  assert.equal(by('alpha', 'desktop-light').percent, 0);
  assert.equal(by('beta', 'desktop-light').status, 'FAIL');
  assert.ok(by('beta', 'desktop-light').percent > 99);
  assert.equal(by('alpha', 'mobile-dark').status, 'MISSING');
  for (const name of ['alpha-d.png', 'beta-d.png', 'results.json', 'README.md'])
    assert.ok(existsSync(resolve(f.outDir, name)), name);
  assert.equal(existsSync(resolve(f.outDir, 'alpha-m.png')), false);
  const readme = readFileSync(resolve(f.outDir, 'README.md'), 'utf8');
  assert.match(
    readme,
    new RegExp(`compared with prototype revision ${PROTOTYPE_REVISION} `),
  );
  assert.doesNotMatch(readme, /revision 15/);
  assert.match(readme, /beta \| d \| 100\.00/);
  assert.match(readme, /MISSING/);
  assert.ok(
    readme.indexOf('| beta |') < readme.indexOf('| alpha |'),
    'worst first',
  );
  assert.match(readme, /1 over 1\.5%/);
});

test('without --gate sheets that fail exit 0; with --gate they exit 1', () => {
  const f = fixture();
  writeFileSync(
    resolve(f.captureDir, 'beta-desktop-light.png'),
    png(1440, 900, () => [0, 0, 0]),
  );
  const base = [
    script,
    '--capture-dir',
    f.captureDir,
    '--out-dir',
    f.outDir,
    '--ids',
    'beta',
    '--prototype',
    f.prototype,
  ];
  assert.equal(spawnSync(process.execPath, base).status, 0);
  const gated = spawnSync(process.execPath, [
    ...base,
    '--gate',
    '--deviations',
    resolve(f.dir, 'none.md'),
  ]);
  assert.equal(gated.status, 1);
  writeFileSync(
    resolve(f.dir, 'dev.md'),
    '## Comparison deviations (round 4)\n\n| id | variant | % | reason |\n| --- | --- | --- | --- |\n| beta | d | 100 | test |\n',
  );
  const allowed = spawnSync(process.execPath, [
    ...base,
    '--gate',
    '--deviations',
    resolve(f.dir, 'dev.md'),
  ]);
  assert.equal(allowed.status, 0, allowed.stderr.toString());
});

test('pendingCompareIds maps pending view keys to unique capture ids', () => {
  assert.deepEqual(
    pendingCompareIds({
      pending: [
        'a-b-desktop-light',
        'a-b-desktop-dark',
        'a-b-mobile-light',
        'c-mobile-dark',
      ],
    }),
    ['a-b', 'c'],
  );
  assert.deepEqual(pendingCompareIds({}), []);
});

test('the comparison names the prototype revision the README calls current', () => {
  const lead = readFileSync(
    resolve(import.meta.dirname, '../../docs/design/f4.1-prototype/README.md'),
    'utf8',
  )
    .split('\n')
    .find((line) => line.startsWith('**Approved'));
  const revisions = [...lead.matchAll(/revision (\d+)(?:\.\d+)?/g)].map(
    (match) => Number(match[1]),
  );
  assert.equal(PROTOTYPE_REVISION, 16);
  assert.equal(PROTOTYPE_REVISION, Math.max(...revisions));
});
