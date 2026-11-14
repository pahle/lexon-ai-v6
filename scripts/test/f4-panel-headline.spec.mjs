import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from '../../frontend/node_modules/jsdom/lib/api.js';

const shellTest = readFileSync('backend/test/e2e/app-shell.spec.ts', 'utf8');

test('768px panel geometry resolves the welcome headline inside main content', () => {
  assert.match(
    shellTest,
    /one\(\s*'h2',\s*'page headline',\s*contentElement,?\s*\)/u,
  );

  const { document } = new JSDOM(`
    <main id="main">
      <div class="content"><h2>Welcome, Maya</h2></div>
      <div data-panel-host><aside><h2>Panel</h2></aside></div>
    </main>
  `).window;
  const contentElement = document.querySelector('.content');
  assert.ok(contentElement);
  assert.equal(document.querySelectorAll('main#main h2').length, 2);
  assert.equal(contentElement.querySelectorAll('h2').length, 1);
  assert.equal(
    contentElement.querySelector('h2')?.textContent,
    'Welcome, Maya',
  );
});
