// Renders Mintegral ad creatives (PNG) for "Caller ID: Identify & Block"
// (com.blockcall.id.spam.filter.app), using the app's own icon and store screenshots.
// Usage: node build.js  ->  ../output/<concept>_<w>x<h>.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });
const dataUri = (f) => `data:${f.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(path.join(ROOT, 'assets', f)).toString('base64')}`;

const APP = { name: 'Caller ID: Identify & Block', name2: 'Caller ID:<br>Identify & Block', dev: 'Solaris Digital Studio', icon: dataUri('icon.png') };

const CONCEPTS = {
  block: { h1: 'BLOCK', pill: 'UNWANTED CALLS', bar: 'Block unwanted calls & spam', cta: 'INSTALL NOW' },
  callerid: { h1: 'IDENTIFY', pill: 'UNKNOWN CALLERS', bar: 'See who is calling you', cta: 'INSTALL NOW' },
  sms: { h1: 'KEEP SPAM', pill: 'OUT OF MESSAGES', bar: 'Filter spam calls & SMS', cta: 'INSTALL NOW' },
};
for (const k of Object.keys(CONCEPTS)) CONCEPTS[k].hero = dataUri(`${k}_hero.jpg`);

// Landscape specs (px). heroW = width of the screenshot column on the right.
const LAND = {
  '1200x628': { pad: 56, icon: 84, name: 26, dev: 18, h1: 100, pill: 54, cta: 30, heroW: 590, gap: 22 },
  '480x320': { pad: 22, icon: 40, name: 13, dev: 10, h1: 44, pill: 22, cta: 14, heroW: 230, gap: 10 },
  '300x250': { breakName: true, pad: 14, icon: 30, name: 10, dev: 8, h1: 28, pill: 13, cta: 11, heroW: 140, gap: 8 },
};
const SIZES = [
  [1200, 628, 'land'], [480, 320, 'land'], [300, 250, 'land'],
  [320, 480, 'port'], [720, 1280, 'port'], [1080, 1920, 'port'],
  [320, 50, 'bar'],
];

const BASE = `*{box-sizing:border-box;margin:0;padding:0}
body{overflow:hidden;font-family:Inter,'DejaVu Sans',sans-serif;color:#fff;position:relative;
  background:radial-gradient(ellipse at 50% 30%,#4cc6ff 0%,#2a9dff 45%,#0d6cf2 100%)}
.h1{font-weight:900;letter-spacing:-.01em;line-height:1;text-shadow:0 .06em .18em #0047b366}
.pill{display:inline-block;background:#fff;color:#0a6ff0;font-weight:900;line-height:1;border-radius:.42em;padding:.22em .42em;
  white-space:nowrap;box-shadow:0 .12em .4em #0047b355}
.cta{display:inline-block;white-space:nowrap;font-weight:900;color:#fff;border-radius:999px;
  background:linear-gradient(180deg,#ffa62b,#ff5f00);box-shadow:0 .2em .6em #b8400066,inset 0 -.12em 0 #c64a00}
.icon{border-radius:22%;box-shadow:0 .08em .3em #00337a55;flex-shrink:0;display:block}
.app{display:flex;align-items:center}
.app b{display:block;font-weight:800;line-height:1.15}
.app span{display:block;opacity:.85;white-space:nowrap}`;

function land(c, w, h, s) {
  return `<style>${BASE}
.hero{position:absolute;right:0;top:0;width:${s.heroW}px;height:100%;background:url(${c.hero}) top center/100% auto no-repeat;
  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 14%),linear-gradient(to top,transparent 0,#000 24%);-webkit-mask-composite:source-in}
.txt{position:absolute;left:${s.pad}px;top:0;bottom:0;width:${w - s.heroW - s.pad + s.heroW * 0.08}px;display:flex;flex-direction:column;justify-content:center;gap:${s.gap}px}
.app{gap:${s.icon * 0.22}px}.icon{width:${s.icon}px;height:${s.icon}px}
.app b{font-size:${s.name}px}.app span{font-size:${s.dev}px}
.h1{font-size:${s.h1}px}.pill{font-size:${s.pill}px;align-self:flex-start;margin-top:${-s.gap * 0.4}px}
.cta{font-size:${s.cta}px;padding:.6em 1.5em;align-self:flex-start;margin-top:${s.gap * 0.3}px}
</style><div class="hero"></div><div class="txt">
<div class="app"><img class="icon" src="${APP.icon}"><div><b>${s.breakName ? APP.name2 : APP.name}</b><span>${APP.dev}</span></div></div>
<div class="h1">${c.h1}</div><div class="pill">${c.pill}</div><div class="cta">${c.cta}</div></div>`;
}

function port(c, w, h) {
  const k = w / 1080; // layout designed at 1080 wide; hero sits where it does in the store screenshot
  return `<style>${BASE}
.hero{position:absolute;left:0;top:${330 * k}px;width:100%;height:${1575 * k}px;background:url(${c.hero}) top center/100% auto no-repeat;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 5%)}
.head{position:absolute;top:${70 * k}px;left:0;right:0;text-align:center}
.h1{font-size:${150 * k}px}.pill{font-size:${92 * k}px;margin-top:${14 * k}px}
.card{position:absolute;left:${40 * k}px;right:${40 * k}px;bottom:${40 * k}px;background:#fff;border-radius:${44 * k}px;
  padding:${28 * k}px;display:flex;align-items:center;gap:${24 * k}px;box-shadow:0 ${12 * k}px ${40 * k}px #00337a55}
.icon{width:${150 * k}px;height:${150 * k}px}
.app{flex:1;min-width:0;color:#10233f;flex-direction:column;align-items:flex-start}
.app b{font-size:${44 * k}px}.app span{font-size:${32 * k}px;color:#4a5b75;opacity:1;margin-top:${6 * k}px}
.cta{font-size:${46 * k}px;padding:.62em 1.1em}
</style><div class="hero"></div>
<div class="head"><div class="h1">${c.h1}</div><div class="pill">${c.pill}</div></div>
<div class="card"><img class="icon" src="${APP.icon}"><div class="app"><b>${APP.name2}</b><span>${c.bar}</span></div><div class="cta">${c.cta.split(' ')[0]}</div></div>`;
}

function bar(c) {
  return `<style>${BASE}
.wrap{display:flex;align-items:center;gap:8px;height:100%;padding:0 7px}
.icon{width:38px;height:38px}
.app{flex:1;min-width:0;flex-direction:column;align-items:flex-start;line-height:1.2}
.app b{font-size:12.5px;white-space:nowrap}.app span{font-size:10.5px;opacity:.95}
.cta{font-size:11px;padding:7px 12px}
</style><div class="wrap"><img class="icon" src="${APP.icon}"><div class="app"><b>${APP.name}</b><span>${c.bar}</span></div><div class="cta">INSTALL</div></div>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  for (const [name, c] of Object.entries(CONCEPTS)) {
    for (const [w, h, layout] of SIZES) {
      const body = layout === 'land' ? land(c, w, h, LAND[`${w}x${h}`]) : layout === 'port' ? port(c, w, h) : bar(c);
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="width:${w}px;height:${h}px">${body}</body></html>`);
      // Fail loudly if text/buttons spill outside the canvas or overflow their box.
      const issues = await page.evaluate(([W, H]) => {
        const out = [];
        for (const el of document.querySelectorAll('.txt *, .head *, .card *, .wrap *')) {
          const r = el.getBoundingClientRect();
          if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) out.push('overflow:' + el.className);
          if (el.scrollWidth > el.clientWidth + 1) out.push('clip:' + (el.className || el.tagName));
        }
        // text column must not run into the hero column
        const hero = document.querySelector('.hero');
        if (hero && document.querySelector('.txt')) {
          const hl = hero.getBoundingClientRect().left + hero.getBoundingClientRect().width * 0.1;
          for (const el of document.querySelectorAll('.txt > *')) if (el.getBoundingClientRect().right > hl) out.push('hits-hero:' + el.className);
        }
        return out;
      }, [w, h]);
      if (issues.length) console.warn(`${name}_${w}x${h}:`, [...new Set(issues)].join(' '));
      await page.screenshot({ path: path.join(OUT, `${name}_${w}x${h}.png`) });
      await page.close();
    }
  }
  await browser.close();
  console.log('done');
})();
