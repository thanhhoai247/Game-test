// Renders Mintegral ad creatives (PNG) for a call-blocker / caller-ID app.
// Usage: node build.js  ->  ../output/<concept>_<w>x<h>.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'output');
fs.mkdirSync(OUT, { recursive: true });

// Per-size layout specs (all px). Port sizes scale from the 320x480 base.
const port = (s, rows = 3) => ({
  layout: 'port', pad: 24 * s, gap: 14 * s, h1: 38 * s, h2: 16 * s, cta: 18 * s, ctaPad: [12 * s, 34 * s],
  phone: 250 * s, rows, name: 14 * s, sub: 11 * s, st: 11 * s, av: 30 * s, badge: 44 * s,
});
const SIZES = [
  [1200, 628, { layout: 'land', pad: 70, gap: 22, h1: 78, h2: 30, cta: 30, ctaPad: [18, 48], phone: 380, rows: 3, name: 21, sub: 16, st: 16, av: 46, badge: 72 }],
  [480, 320, { layout: 'land', pad: 26, gap: 12, h1: 36, h2: 14, cta: 15, ctaPad: [10, 24], phone: 180, rows: 2, compact: true, name: 12, sub: 10, st: 10, av: 26, badge: 36 }],
  [300, 250, { layout: 'land', pad: 16, gap: 9, h1: 24, h2: 11, cta: 11, ctaPad: [8, 14], phone: 128, rows: 2, compact: true, name: 10, sub: 8, st: 8, av: 20, badge: 28 }],
  [320, 480, port(1, 2)],
  [720, 1280, port(2.25)],
  [1080, 1920, port(3.375)],
  [320, 50, { layout: 'bar' }],
];

const CONCEPTS = {
  shield: {
    bg: ['#0b1f4d', '#1a55e0'], accent: '#35e08a', btn: '#35e08a', btnText: '#06281a',
    h1: 'Block Spam Calls', h2: 'Stop scam & robocalls automatically', cta: 'INSTALL FREE', badge: 'shield', bar: 'Stop robocalls automatically',
    rows: [['Spam Risk', '0147', 'Blocked', '#d62839'], ['Robocall', '0199', 'Blocked', '#d62839'], ['Mom', '0122', 'Allowed', '#1f9d55']],
  },
  callerid: {
    bg: ['#3a0ca3', '#7b2ff7'], accent: '#ffd23f', btn: '#ffd23f', btnText: '#2b1a00',
    h1: "Who's Calling?", h2: 'Identify unknown numbers instantly', cta: 'TRY NOW', badge: 'search', bar: 'Identify unknown numbers',
    rows: [['Unknown', '0183', 'Spam Risk', '#c77d00'], ['Delivery', '0164', 'Verified', '#1f9d55'], ['Sales Call', '0158', 'Reported', '#d62839']],
  },
  scam: {
    bg: ['#1b1b2f', '#e5383b'], accent: '#ffffff', btn: '#ffffff', btnText: '#a4161a',
    h1: 'Tired of Scam Calls?', h2: 'Filter spam. Keep your peace.', cta: 'GET IT FREE', badge: 'warn', bar: 'Filter spam. Keep your peace.',
    rows: [['Scam Likely', '0131', 'Blocked', '#d62839'], ['Spam Risk', '0176', 'Blocked', '#d62839'], ['Sales Call', '0108', 'Blocked', '#d62839']],
  },
};

const ICONS = {
  shield: `<path d="M50 6 L88 20 V50 C88 74 71 90 50 96 C29 90 12 74 12 50 V20 Z" fill="#fff"/><path d="M33 52 L45 64 L68 38" stroke="#1a55e0" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  search: `<circle cx="43" cy="43" r="26" fill="none" stroke="#fff" stroke-width="10"/><path d="M63 63 L88 88" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`,
  warn: `<path d="M50 10 L92 86 H8 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><rect x="45" y="36" width="10" height="27" rx="5" fill="#e5383b"/><circle cx="50" cy="74" r="6" fill="#e5383b"/>`,
};
const PHONE_ICON = `<path d="M24 14 C18 14 14 20 15 27 C18 52 48 82 73 85 C80 86 86 82 86 76 L86 68 L70 62 L62 70 C52 66 34 48 30 38 L38 30 L32 14 Z" fill="currentColor"/>`;

function phoneHtml(c, s) {
  const rows = c.rows.slice(0, s.rows).map(([n, num, st, col]) => `
    <div class="row"><div class="av" style="color:${col}"><svg viewBox="0 0 100 100">${PHONE_ICON}</svg></div>
    <div class="nm"><b>${n}</b>${s.compact
      ? `<div><span class="st" style="background:${col}1f;color:${col}">${st}</span></div></div>`
      : `<span>+1 (555) ${num}</span></div><div class="st" style="background:${col}1f;color:${col}">${st}</div>`}</div>`).join('');
  return `<div class="phone"><div class="notch"></div><div class="hd"><svg viewBox="0 0 100 100" class="badge">${ICONS[c.badge]}</svg></div>${rows}</div>`;
}

function html(c, w, h, s) {
  const base = `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;font-family:Inter,'DejaVu Sans',sans-serif}
body{background:radial-gradient(circle at 80% 15%,${c.bg[1]},${c.bg[0]} 78%);position:relative;color:#fff}
.cta{background:${c.btn};color:${c.btnText};font-weight:900;border-radius:999px;white-space:nowrap;display:inline-block}`;
  if (s.layout === 'bar') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
.bar{display:flex;align-items:center;gap:8px;height:100%;padding:0 8px}
.ic{width:34px;height:34px;border-radius:9px;background:#ffffff22;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ic svg{width:24px;height:24px}
.t{flex:1;min-width:0;line-height:1.15}
.t b{display:block;font-size:14px;font-weight:900;white-space:nowrap}
.t span{display:block;font-size:10px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cta{font-size:11px;padding:7px 11px}
</style></head><body><div class="bar"><div class="ic"><svg viewBox="0 0 100 100">${ICONS[c.badge]}</svg></div>
<div class="t"><b>${c.h1}</b><span>${c.bar}</span></div><div class="cta">${c.cta}</div></div></body></html>`;
  }
  const land = s.layout === 'land';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
body:before{content:'';position:absolute;width:${Math.max(w, h) * 0.8}px;height:${Math.max(w, h) * 0.8}px;border-radius:50%;background:${c.accent}1c;right:-${Math.max(w, h) * 0.2}px;bottom:-${Math.max(w, h) * 0.35}px}
.wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;padding:${s.pad}px;gap:${s.gap}px;
  ${land ? 'justify-content:space-between' : 'flex-direction:column;justify-content:space-evenly;text-align:center'}}
.txt{display:flex;flex-direction:column;gap:${s.gap}px;align-items:${land ? 'flex-start' : 'center'};${land ? 'flex:1;min-width:0' : ''}}
.h1{font-weight:900;line-height:1.04;font-size:${s.h1}px;letter-spacing:-.02em;text-shadow:0 ${s.h1 / 20}px ${s.h1 / 6}px #0005}
.h2{font-weight:600;opacity:.93;line-height:1.25;font-size:${s.h2}px}
.cta{font-size:${s.cta}px;padding:${s.ctaPad[0]}px ${s.ctaPad[1]}px;margin-top:${s.gap * 0.4}px;box-shadow:0 ${s.cta / 4}px ${s.cta * 0.7}px #0006}
.phone{width:${s.phone}px;flex-shrink:0;background:#fff;color:#14213d;border-radius:${s.phone * 0.1}px;border:${s.phone * 0.018}px solid #0b1020;
  box-shadow:0 ${s.phone * 0.05}px ${s.phone * 0.16}px #0008;padding:${s.phone * 0.05}px;display:flex;flex-direction:column;gap:${s.phone * 0.035}px}
.notch{width:32%;height:${s.phone * 0.022}px;background:#0b1020;border-radius:99px;align-self:center}
.hd{display:flex;justify-content:center;background:linear-gradient(135deg,${c.bg[0]},${c.bg[1]});border-radius:${s.phone * 0.06}px;padding:${s.phone * 0.045}px}
.badge{width:${s.badge}px;height:${s.badge}px}
.row{display:flex;align-items:center;gap:${s.phone * 0.03}px;background:#f1f4fb;border-radius:${s.phone * 0.04}px;padding:${s.phone * 0.03}px;text-align:left}
.av{width:${s.av}px;height:${s.av}px;border-radius:50%;background:#14213d;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:${s.av * 0.22}px}
.av svg{width:100%;height:100%}
.nm{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}
.nm b{font-size:${s.name}px;font-weight:800;white-space:nowrap}
.nm span{font-size:${s.sub}px;opacity:.6;white-space:nowrap}
.nm div{margin-top:${s.st * 0.25}px;line-height:1}
.st{display:inline-block;font-size:${s.st}px;font-weight:800;padding:${s.st * 0.3}px ${s.st * 0.7}px;border-radius:99px;white-space:nowrap}
</style></head><body><div class="wrap"><div class="txt"><div class="h1">${c.h1}</div><div class="h2">${c.h2}</div><div class="cta">${c.cta}</div></div>${phoneHtml(c, s)}</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const [name, c] of Object.entries(CONCEPTS)) {
    for (const [w, h, spec] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(html(c, w, h, spec));
      // Fail loudly if any element spills outside the canvas or text is clipped.
      const issues = await page.evaluate(([W, H]) => {
        const out = [];
        for (const el of document.querySelectorAll('.wrap *, .bar *')) {
          const r = el.getBoundingClientRect();
          if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) out.push('overflow:' + el.className);
          if (el.scrollWidth > el.clientWidth + 1) out.push('clip:' + el.className);
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
