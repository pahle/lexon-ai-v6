// Minimal renderer for the prototype's .dc.html files, used only to capture PNGs.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [, , srcDir, outDir, brand] = process.argv;
const blobs = {
  '2ae483d54f74d1ba727de1302eb88986': '01_VECTOR/LEXON-wordmark-compact-ink.svg',
  'cf27d35fa96b084e2db0450125508cf9': '01_VECTOR/LEXON-wordmark-compact-cream.svg',
  '35866d95b3b7acd0c814fa1f4876290a': '01_VECTOR/marks/LEXON-mark-tile-seal-micro.svg',
  '6c66f5b33cfde3748f43584d98c9cd3e': '01_VECTOR/marks/LEXON-mark-tile-parchment-micro.svg',
};
function load(file) {
  let html = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const [id, f] of Object.entries(blobs)) {
    const data = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(brand, f)).toString('base64');
    html = html.split('/_blob/' + id).join(data);
  }
  const helmet = html.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
  const body = html.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1].replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  const scriptTag = html.match(/<script type="text\/x-dc"[^>]*>/)[0];
  let propsRaw = scriptTag.match(/data-props='([^']*)'/)?.[1] ?? scriptTag.match(/data-props="([^"]*)"/)[1].replace(/&quot;/g, '"');
  const code = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  return { helmet, body, props: JSON.parse(propsRaw), code };
}
const runtime = `
window.__mount = (tpl, code, props) => {
  class DCLogic { constructor(p){ this.props = p; this.state = {}; } setState(u){ this.state = Object.assign({}, this.state, typeof u === 'function' ? u(this.state) : u); window.__render(); } forceUpdate(){ window.__render(); } }
  const Component = new Function('DCLogic', code + '; return Component;')(DCLogic);
  const comp = new Component(props); window.__comp = comp;
  const root = document.getElementById('root');
  const look = (scope, p) => { if (p === 'true') return true; if (p === 'false') return false; return p.split('.').reduce((o, k) => o == null ? undefined : o[k], scope); };
  const interp = (s, scope) => s.replace(/\\{\\{\\s*([\\w.$]+)\\s*\\}\\}/g, (_, p) => { const v = look(scope, p); return v == null ? '' : String(v); });
  const whole = /^\\{\\{\\s*([\\w.$]+)\\s*\\}\\}$/;
  function proc(node, scope, parent) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-if') { const v = look(scope, node.getAttribute('value').match(whole)[1]); if (v) for (const c of node.childNodes) proc(c, scope, parent); return; }
    if (tag === 'sc-for') { const list = look(scope, node.getAttribute('list').match(whole)[1]) || []; const as = node.getAttribute('as'); list.forEach((it, i) => { const sc = Object.assign({}, scope, { [as]: it, $index: i }); for (const c of node.childNodes) proc(c, sc, parent); }); return; }
    const el = node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? document.createElement(tag) : document.createElementNS(node.namespaceURI, node.tagName);
    for (const a of node.attributes) {
      const m = a.value.match(whole);
      if (/^on[A-Z]/.test(a.name) || /^on[a-z]/.test(a.name) && m) { const fn = look(scope, m[1]); if (fn) el.addEventListener(a.name.slice(2).toLowerCase(), fn); continue; }
      if (a.name.startsWith('hint-')) continue;
      el.setAttribute(a.name, m ? String(look(scope, m[1]) ?? '') : interp(a.value, scope));
      if (a.name === 'value' && 'value' in el) el.value = el.getAttribute('value');
    }
    for (const c of node.childNodes) proc(c, scope, el);
    parent.appendChild(el);
  }
  window.__render = () => { const t = document.createElement('template'); t.innerHTML = tpl; const vals = comp.renderVals(); root.textContent = ''; for (const c of t.content.childNodes) proc(c, vals, root); };
  window.__render();
};`;
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const b = await chromium.launch({ proxy });
  const shots = JSON.parse(fs.readFileSync(path.join(outDir, 'shots.json'), 'utf8'));
  fs.mkdirSync(path.join(outDir, 'screens'), { recursive: true });
  for (const s of shots) {
    const d = load(s.file);
    const props = {}; for (const [k, v] of Object.entries(d.props)) if (k[0] !== '$') props[k] = v.default;
    Object.assign(props, s.props || {});
    const ctx = await b.newContext({ viewport: { width: d.props.$preview.width, height: d.props.$preview.height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8">' + d.helmet.replace(/<\/?helmet>/g, '') + '</head><body style="margin:0"><div id="root"></div></body></html>', { waitUntil: 'load' });
    await p.addScriptTag({ content: runtime });
    await p.evaluate(([t, c, pr]) => window.__mount(t, c, pr), [d.body, d.code, props]);
    if (s.state) await p.evaluate((st) => window.__comp.setState(st), s.state);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(outDir, 'screens', s.name + '.png') });
    await ctx.close();
  }
  await b.close(); console.log('captured', shots.length);
})();
