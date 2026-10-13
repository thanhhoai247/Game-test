/* Logic tính toán thuần (không đụng tới trình duyệt) – dùng chung cho side panel và cho bài test. */
const ROASCore = (() => {
  // ---------- Số ----------
  function decimalOfLocale(lang) {
    try {
      const p = new Intl.NumberFormat(lang || 'en').formatToParts(1.5).find(x => x.type === 'decimal');
      return p ? p.value : '.';
    } catch (e) { return '.'; }
  }

  // Đoán dấu thập phân của cả một cột chữ số ("1,234.5" / "1.234,5" / "12.3456")
  function detectDecimal(values, fallback = '.') {
    let comma = 0, dot = 0;
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const t = v.replace(/[^\d.,]/g, '');
      if (!t) continue;
      const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
      if (lc >= 0 && ld >= 0) { lc > ld ? comma++ : dot++; continue; }
      if (lc >= 0) {
        const n = (t.match(/,/g) || []).length, after = t.length - lc - 1;
        if (n === 1 && after !== 3) comma++;
      }
      if (ld >= 0) {
        const n = (t.match(/\./g) || []).length, after = t.length - ld - 1;
        if (n === 1 && after !== 3) dot++;
        if (n > 1) comma++; // "1.234.567" => dấu chấm là phân cách nghìn
      }
      if (lc >= 0 && (t.match(/,/g) || []).length > 1) dot++; // "1,234,567"
    }
    if (comma > dot) return ',';
    if (dot > comma) return '.';
    return fallback;
  }

  function parseNum(v, dec = '.') {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).trim();
    if (!s || /^[-–—]+$/.test(s)) return null;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d\-.,]/g, ''));
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  const SYMBOLS = { '₫': 'VND', 'đ': 'VND', 'US$': 'USD', '$': 'USD', '€': 'EUR', '£': 'GBP', 'Rp': 'IDR', '฿': 'THB', '₱': 'PHP', '₹': 'INR', '¥': 'JPY', 'RM': 'MYR', 'R$': 'BRL' };
  function currencyOf(text) {
    if (!text) return null;
    const rest = String(text).replace(/[\d.,\s\-–—()]/g, '');
    if (!rest) return null;
    if (/^[A-Z]{3}$/.test(rest)) return rest;
    const code = rest.match(/[A-Z]{3}/);
    if (code) return code[0];
    return SYMBOLS[rest] || rest;
  }

  // ---------- Đọc bảng chữ (CSV / TSV / dán từ web) ----------
  function parseDelimited(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
    const counts = { '\t': 0, ';': 0, ',': 0 };
    let inQ = false;
    for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
    const delim = counts['\t'] > 0 ? '\t' : (counts[';'] > counts[','] ? ';' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== '')).map(r => r.map(c => typeof c === 'string' ? c.trim() : c));
  }

  function findHeaderRow(rows) {
    const lim = Math.min(rows.length, 25);
    for (let i = 0; i < lim; i++) {
      if (rows[i].some(c => typeof c === 'string' && /campaign|chiến dịch/i.test(c))) return i;
    }
    for (let i = 0; i < lim; i++) if (rows[i].filter(c => c !== '' && c != null).length >= 2) return i;
    return 0;
  }

  function pickFirst(headers, tests, exclude) {
    for (const t of tests) {
      const i = headers.findIndex(h => t.test(h) && !(exclude && exclude.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  }

  function guessColumns(headers) {
    const H = headers.map(h => String(h == null ? '' : h).trim());
    const campaign = pickFirst(H, [
      /^campaign$/i, /^campaign[ _]?name$/i, /^campaign[ _(]*network\)?$/i, /campaign[ _]?network/i,
      /^campaign/i, /campaign/i, /chiến dịch/i
    ], /\bid\b|_id$/i);
    const revenue = pickFirst(H, [
      /^ad[ _]?revenue$/i, /^revenue$/i, /^ad[ _]?revenue/i, /ad[ _]?revenue/i,
      /^all[ _]?revenue/i, /revenue[ _]?total|total[ _]?revenue/i, /revenue/i, /doanh thu/i
    ], /per|roas|arpu|arpdau|\/|%|margin|share/i);
    return { campaign, revenue };
  }

  // ---------- Khớp tên camp ----------
  function normName(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function splitAdjustName(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^(.*?)\s*\((\d{6,})\)\s*$/);
    return m ? { base: m[1], id: m[2] } : { base: s, id: null };
  }
  const TOTAL_RE = /^(total|totals|grand total|tổng|tổng cộng)\b/i;

  // rows: mảng các dòng (đã bỏ header); trả về danh sách camp đã cộng dồn revenue
  function aggregateRevenue(rows, campIdx, revIdx) {
    const decimal = detectDecimal(rows.map(r => r[revIdx]), '.');
    const map = new Map();
    let skipped = 0;
    for (const r of rows) {
      const raw = r[campIdx];
      if (raw == null || String(raw).trim() === '' || TOTAL_RE.test(String(raw).trim())) { skipped++; continue; }
      const rev = parseNum(r[revIdx], decimal);
      const key = normName(raw);
      if (!map.has(key)) map.set(key, { raw: String(raw).trim(), ...splitAdjustName(raw), revenue: 0, lines: 0 });
      const e = map.get(key);
      e.revenue += rev || 0; e.lines++;
    }
    return { entries: [...map.values()], decimal, skipped };
  }

  // ---------- Cost từ Google Ads ----------
  function buildCampaigns(scrape) {
    const dec = scrape.decimal || decimalOfLocale(scrape.lang);
    let currency = null;
    const list = [];
    const seen = new Set();
    for (const r of scrape.rows || []) {
      const key = r.id ? 'id:' + r.id : 'n:' + normName(r.name) + '|' + r.costText;
      if (seen.has(key)) continue;
      seen.add(key);
      currency = currency || currencyOf(r.costText);
      list.push({ name: r.name, id: r.id || null, status: r.status || '', cost: parseNum(r.costText, dec) || 0, usdCol: r.usdText != null ? parseNum(r.usdText, dec) : null });
    }
    let total = null, totalUsd = null, totalLabel = null;
    const sums = scrape.summaries || [];
    const s = sums.find(x => /filter|lọc/i.test(x.label)) || sums.find(x => /campaign|chiến dịch/i.test(x.label)) || sums[0];
    if (s) { total = parseNum(s.costText, dec); totalUsd = s.usdText != null ? parseNum(s.usdText, dec) : null; totalLabel = s.label; currency = currency || currencyOf(s.costText); }
    return { campaigns: list, currency: currency || 'USD', total, totalUsd, totalLabel, decimal: dec };
  }

  function autoRate(built) {
    if (built.currency === 'USD') return 1;
    if (built.total > 0 && built.totalUsd > 0) return roundRate(built.total / built.totalUsd);
    let c = 0, u = 0;
    for (const x of built.campaigns) if (x.usdCol != null && x.usdCol >= 1) { c += x.cost; u += x.usdCol; }
    if (u > 0) return roundRate(c / u);
    return null;
  }
  function roundRate(r) { return r >= 100 ? Math.round(r) : Math.round(r * 10000) / 10000; }

  // ---------- Ghép & tính ROAS ----------
  // opts: { rate: số đơn vị tiền cost cho 1 USD, revenueUnit: 'USD' | 'COST' }
  function compute(built, adjustEntries, opts) {
    const rate = built.currency === 'USD' ? 1 : Number(opts.rate) || null;
    const rows = built.campaigns.map(c => ({ ...c, revenue: 0, matchedLines: 0 }));
    const byId = new Map(), byName = new Map();
    for (const r of rows) {
      if (r.id) byId.set(String(r.id), r);
      const k = normName(r.name);
      byName.set(k, byName.has(k) ? 'DUP' : r);
    }
    const unmatched = [];
    for (const e of adjustEntries) {
      let t = (e.id && byId.get(e.id)) || null;
      if (!t) { const b = byName.get(normName(e.base)); if (b && b !== 'DUP') t = b; }
      if (!t) { const b = byName.get(normName(e.raw)); if (b && b !== 'DUP') t = b; }
      if (t) { t.revenue += e.revenue; t.matchedLines += e.lines; }
      else unmatched.push(e);
    }
    const toUsd = v => (rate ? v / rate : null);
    for (const r of rows) {
      r.costUsd = toUsd(r.cost);
      r.revenueUsd = opts.revenueUnit === 'COST' ? toUsd(r.revenue) : r.revenue;
      r.roas = r.costUsd > 0 && r.revenueUsd != null ? r.revenueUsd / r.costUsd : null;
      r.matched = r.matchedLines > 0;
    }
    const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
    const cost = sum(rows, r => r.cost);
    const costUsd = rate ? cost / rate : null;
    const revenueUsd = sum(rows, r => r.revenueUsd);
    const unmatchedRevenue = sum(unmatched, e => e.revenue);
    return {
      rows, unmatched, rate,
      totals: { cost, costUsd, revenueUsd, roas: costUsd > 0 ? revenueUsd / costUsd : null, unmatchedRevenue, matchedCamps: rows.filter(r => r.matched).length },
      costCheck: built.total != null && built.total > 0 ? { pageTotal: built.total, sum: cost, diffPct: Math.abs(cost - built.total) / built.total * 100, label: built.totalLabel } : null
    };
  }

  return { decimalOfLocale, detectDecimal, parseNum, currencyOf, parseDelimited, findHeaderRow, guessColumns, normName, splitAdjustName, aggregateRevenue, buildCampaigns, autoRate, compute };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROASCore;
