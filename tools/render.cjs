const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
const jobs = [];
for (const kind of ['circle','square','tile']) for (const tone of ['seal','ink','midnight','parchment']) for (const w of [512,1024])
  jobs.push([`01_VECTOR/marks/LEXON-mark-${kind}-${tone}.svg`, `02_PNG/marks/LEXON-mark-${kind}-${tone}-${w}w.png`, w]);
for (const tone of ['seal','ink','midnight','parchment']) for (const w of [512,1024])
  jobs.push([`03_APP_ICONS/lexon-app-${tone}.svg`, `03_APP_ICONS/lexon-app-${tone}-${w}.png`, w]);
jobs.push(['03_APP_ICONS/favicon.svg','03_APP_ICONS/favicon-16.png',16],['03_APP_ICONS/favicon.svg','03_APP_ICONS/favicon-32.png',32],
  ['01_VECTOR/marks/LEXON-mark-tile-seal-small.svg','03_APP_ICONS/favicon-48.png',48],
  ['03_APP_ICONS/lexon-app-seal.svg','03_APP_ICONS/apple-touch-icon.png',180],
  ['03_APP_ICONS/lexon-app-seal.svg','03_APP_ICONS/android-chrome-192x192.png',192],
  ['03_APP_ICONS/lexon-app-seal.svg','03_APP_ICONS/android-chrome-512x512.png',512]);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [src, out, w] of jobs) {
    const svg = fs.readFileSync(path.join(root, src)).toString('base64');
    await p.setViewportSize({ width: w, height: w });
    await p.setContent(`<html><body style="margin:0;background:transparent"><img id="i" width="${w}" height="${w}" src="data:image/svg+xml;base64,${svg}"></body></html>`);
    await p.waitForFunction(() => document.getElementById('i').complete);
    await p.locator('#i').screenshot({ path: path.join(root, out), omitBackground: true });
  }
  await b.close(); console.log('rendered', jobs.length);
})();
