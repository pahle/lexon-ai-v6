import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, test } from 'node:test';
import {
  VARIANT_ORDER,
  buildSheetHtml,
  groupStates,
  renderContactSheets,
} from '../visual-contact-sheets.mjs';

const root = resolve(import.meta.dirname, '../..');
const realIndex = JSON.parse(
  readFileSync(resolve(root, 'docs/references/F4.1-visual/index.json'), 'utf8'),
);

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
/** A solid-colour RGB PNG, small enough to keep the spec fast. */
function solidPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = { desktop: [144, 90], mobile: [39, 84] };
function fixtureIndex(states) {
  const views = {};
  for (const [stateId, state] of states) {
    for (const viewport of ['desktop', 'mobile']) {
      for (const theme of ['light', 'dark']) {
        const id = `${stateId}-${viewport}-${theme}`;
        views[id] = {
          path: `review/${id}.png`,
          viewport,
          theme,
          state,
          prototypeReference: null,
          replaces: [],
        };
      }
    }
  }
  return { version: 1, viewports: {}, views };
}
function writeReviewImages(dir, index) {
  mkdirSync(resolve(dir, 'review'), { recursive: true });
  for (const [id, view] of Object.entries(index.views)) {
    const [w, h] = sizes[view.viewport];
    writeFileSync(
      resolve(dir, view.path),
      solidPng(w, h, view.theme === 'dark' ? [20, 20, 30] : [240, 240, 235]),
    );
    assert.ok(id);
  }
}

const temps = [];
function temp() {
  const dir = mkdtempSync(resolve(tmpdir(), 'lexon-sheets-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const states = [
  ['sign-in', 'Sign in, idle'],
  ['chat-edit', 'Editing a user message'],
];

test('groups the real F4.1 index into one entry per state, in index order', () => {
  const sheets = groupStates(realIndex);
  const expected = [
    ...new Set(
      Object.keys(realIndex.views).map((id) =>
        id.replace(/-(desktop|mobile)-(light|dark)$/, ''),
      ),
    ),
  ];
  assert.deepEqual(
    sheets.map((sheet) => sheet.stateId),
    expected,
  );
  assert.equal(
    new Set(sheets.map((sheet) => sheet.stateId)).size,
    sheets.length,
  );
  for (const sheet of sheets) {
    assert.deepEqual(
      sheet.variants.map((variant) => `${variant.viewport}-${variant.theme}`),
      VARIANT_ORDER,
      sheet.stateId,
    );
  }
});

test('refuses an index state that does not have all four variants', () => {
  const index = fixtureIndex(states);
  delete index.views['chat-edit-mobile-dark'];
  assert.throws(() => groupStates(index), /chat-edit.*mobile-dark/);
});

test('each sheet page holds four labelled variants with state, theme, and viewport', () => {
  const index = fixtureIndex(states);
  const [sheet] = groupStates(index);
  const html = buildSheetHtml(
    sheet,
    (variant) => `data:image/png;base64,${variant.id}`,
  );
  const variants = [
    ...html.matchAll(
      /<figure[^>]*data-variant="([^"]+)"[^>]*>(.*?)<\/figure>/gs,
    ),
  ];
  assert.deepEqual(
    variants.map((match) => match[1]),
    VARIANT_ORDER,
  );
  for (const [, key, body] of variants) {
    const [viewport, theme] = key.split('-');
    const caption = body.match(/<figcaption>(.*?)<\/figcaption>/s)?.[1] ?? '';
    assert.ok(caption.includes('Sign in, idle'), caption);
    assert.ok(caption.includes(theme), caption);
    assert.ok(caption.includes(viewport), caption);
    assert.match(body, /<img /);
  }
  assert.match(html, /<h1>Sign in, idle/);
});

test('renders exactly one PNG sheet per index state, named by state id', async () => {
  const dir = temp();
  const index = fixtureIndex(states);
  writeReviewImages(dir, index);
  const outDir = resolve(dir, 'review/contact-sheets');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'stale-state.png'), 'stale');
  writeFileSync(resolve(outDir, 'README.txt'), 'kept');

  // A fake renderer keeps this test browser-free: it records each call and
  // writes a tiny deterministic PNG-signature file wide enough to pass below.
  const calls = [];
  let closed = 0;
  const createRenderer = async () => ({
    async render(html, target) {
      calls.push({ html, target });
      const bytes = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
      bytes.writeUInt32BE(2600, 16);
      writeFileSync(target, bytes);
    },
    async close() {
      closed += 1;
    },
  });

  const written = await renderContactSheets(
    { index, reviewDir: resolve(dir, 'review'), outDir },
    { createRenderer },
  );

  assert.equal(closed, 1, 'renderer is closed once');
  assert.deepEqual(
    calls.map((call) => call.target),
    states.map(([stateId]) => resolve(outDir, `${stateId}.png`)),
  );
  for (const call of calls) {
    assert.equal(
      [...call.html.matchAll(/<figure[^>]*data-variant="([^"]+)"/g)]
        .map((m) => m[1])
        .join(','),
      VARIANT_ORDER.join(','),
      'renderer got the four labelled variants',
    );
  }

  const expected = states.map(([stateId]) => `${stateId}.png`);
  assert.deepEqual(
    written.map((path) => path.split('/').pop()),
    expected,
  );
  const sheets = readdirSync(outDir).filter((name) => name.endsWith('.png'));
  assert.deepEqual(sheets.sort(), [...expected].sort());
  assert.ok(readdirSync(outDir).includes('README.txt'));
  for (const name of expected) {
    const bytes = readFileSync(resolve(outDir, name));
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(
      bytes.readUInt32BE(16) > 400,
      'sheet is wide enough for four variants',
    );
  }
});

test('fails naming the missing review image', async () => {
  const dir = temp();
  const index = fixtureIndex(states);
  writeReviewImages(dir, index);
  rmSync(resolve(dir, 'review/chat-edit-mobile-light.png'));
  await assert.rejects(
    renderContactSheets({
      index,
      reviewDir: resolve(dir, 'review'),
      outDir: resolve(dir, 'out'),
    }),
    /chat-edit-mobile-light/,
  );
});
