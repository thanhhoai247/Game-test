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
    if (/^\d{6,}$/.test(s)) return { base: '', id: s }; // file Adjust chỉ có campaign_id_network
    const m = s.match(/^(.*?)\s*\((\d{6,})\)\s*$/);
    return m ? { base: m[1], id: m[2] } : { base: s, id: null };
  }
  const TOTAL_RE = /^(total|totals|grand total|tổng|tổng cộng)\b/i;

  // rows: mảng các dòng (đã bỏ header); trả về danh sách camp đã cộng dồn revenue
  function aggregateRevenue(rows, campIdx, revIdx, filter) {
    const decimal = detectDecimal(rows.map(r => r[revIdx]), '.');
    const map = new Map();
    let skipped = 0;
    for (const r of rows) {
      if (filter && !filter(r)) continue;
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
    list.forEach(x => { x.currency = currency || 'USD'; });
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
  // opts: { rate | rates:{IDR:..}, revenueUnit: 'USD' | 'COST', revenueLoaded }
  function costCheckOf(built, cost) {
    return built.total != null && built.total > 0 ? { pageTotal: built.total, sum: cost, diffPct: Math.abs(cost - built.total) / built.total * 100, label: built.totalLabel } : null;
  }
  function compute(built, adjustEntries, opts) {
    const rateFor = c => c === 'USD' ? 1 : ((opts.rates && Number(opts.rates[c])) || Number(opts.rate) || null);
    const rate = rateFor(built.currency);
    const rows = built.campaigns.map(c => ({ ...c, currency: c.currency || built.currency, revenue: 0, matchedLines: 0 }));
    const byId = new Map(), byName = new Map();
    for (const r of rows) {
      if (r.id) byId.set(String(r.id), r);
      const k = normName(r.name);
      byName.set(k, byName.has(k) ? 'DUP' : r);
    }
    const unmatched = [];
    for (const e of adjustEntries) {
      let t = (e.id && byId.get(e.id)) || null;
      if (!t && e.base) { const b = byName.get(normName(e.base)); if (b && b !== 'DUP') t = b; }
      if (!t) { const b = byName.get(normName(e.raw)); if (b && b !== 'DUP') t = b; }
      if (t) { t.revenue += e.revenue; t.matchedLines += e.lines; }
      else unmatched.push(e);
    }
    for (const r of rows) {
      const rr = rateFor(r.currency);
      r.matched = r.matchedLines > 0;
      r.costUsd = rr ? r.cost / rr : null;
      r.revenueUsd = opts.revenueUnit === 'COST' ? (rr ? r.revenue / rr : null) : r.revenue;
      // camp có ID mà file Adjust không có dòng nào => revenue thật sự bằng 0
      if (opts.revenueLoaded && !r.matched && r.id) r.revenueUsd = 0;
      r.roas = r.costUsd > 0 && r.revenueUsd != null && (r.matched || (opts.revenueLoaded && r.id)) ? r.revenueUsd / r.costUsd : null;
    }
    const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
    const cost = sum(rows, r => r.cost);
    const noRate = rows.some(r => r.cost > 0 && r.costUsd == null);
    const costUsd = noRate ? null : sum(rows, r => r.costUsd);
    const known = rows.filter(r => r.roas != null);   // chỉ tính ROAS tổng trên camp đã biết revenue
    const kCost = sum(known, r => r.costUsd), kRev = sum(known, r => r.revenueUsd);
    return {
      rows, unmatched, rate,
      totals: { cost, costUsd, revenueUsd: sum(rows, r => r.revenueUsd), roas: kCost > 0 ? kRev / kCost : null, unmatchedRevenue: sum(unmatched, e => e.revenue), matchedCamps: rows.filter(r => r.matched).length },
      costCheck: costCheckOf(built, cost)
    };
  }

  // ---------- Bộ lọc, màu, gộp ----------
  function parseTerms(text, chips) {
    const t = String(text || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    return t.concat((chips || []).map(x => String(x).toLowerCase()));
  }
  function matchTerms(name, terms) {
    if (!terms || !terms.length) return true;
    const n = String(name || '').toLowerCase();
    return terms.some(t => n.includes(t));
  }
  // >=100% xanh, 85-99% vàng, <85% đỏ (so sánh sau khi làm tròn 0,1%)
  function roasClass(r) {
    if (r == null || !isFinite(r)) return 'na';
    const x = Math.round(r * 1000) / 1000;
    return x >= 1 ? 'good' : x >= 0.85 ? 'warn' : 'bad';
  }
  function mergeBuilt(list) {
    const cur = [...new Set(list.map(b => b.currency))];
    return { campaigns: list.flatMap(b => b.campaigns), currency: cur.length === 1 ? cur[0] : 'MIX', total: null, totalUsd: null, totalLabel: null, decimal: '.' };
  }
  function campKey(c) { return c.id ? 'id:' + c.id : 'n:' + normName(c.name); }

  // ---------- Ngày ----------
  const p2 = x => String(x).padStart(2, '0');
  function normDay(v) {
    if (v == null) return null;
    if (v instanceof Date) v = v.toISOString();
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    return m ? `${m[3]}-${p2(m[2])}-${p2(m[1])}` : null;
  }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // Đọc chữ của bộ chọn ngày Google Ads -> ["YYYY-MM-DD"] hoặc [từ, đến]; null nếu không hiểu
  function parseRangeDays(text, nowIso) {
    const t = String(text || '');
    const ds = [...t.matchAll(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/g)].filter(m => MON[m[2].toLowerCase()]).map(m => `${m[3]}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`);
    if (ds.length) return ds.length === 1 ? ds : [ds[0], ds[ds.length - 1]];
    const base = nowIso ? new Date(nowIso) : new Date();
    const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (/yesterday|hôm qua/i.test(t)) { base.setDate(base.getDate() - 1); return [ymd(base)]; }
    if (/today|hôm nay/i.test(t)) return [ymd(base)];
    return null;
  }

  // ---------- Cột file Adjust ----------
  function guessAdjustColumns(headers) {
    const H = headers.map(h => String(h == null ? '' : h).trim());
    const g = guessColumns(H);
    return {
      campaign: g.campaign, revenue: g.revenue,
      day: pickFirst(H, [/^(day|date|ngày)$/i, /day|date|ngày/i]),
      channel: pickFirst(H, [/^channel$/i, /channel|network$|partner|kênh/i])
    };
  }

  // ---------- Bảng cost đọc từ bảng chữ (TikTok / ITG) ----------
  function guessCostColumns(headers) {
    const H = headers.map(h => String(h == null ? '' : h).trim());
    const bad = /per|avg|average|rate|ratio|cpc|cpm|cpa|cpi|roas|%|\//i;
    return {
      name: pickFirst(H, [/^campaign[ _]?name$/i, /^campaign$/i, /campaign.*name|name.*campaign/i, /^name$/i, /campaign|chiến dịch/i], /\bid\b|_id$/i),
      id: pickFirst(H, [/^campaign[ _]?id$/i, /campaign.*\bid\b|campaign_id/i, /^id$/i]),
      spend: pickFirst(H, [/^spend$/i, /^cost$/i, /^total[ _]?(spend|cost)/i, /spend|cost|chi phí/i], bad),
      status: pickFirst(H, [/^status$/i, /status|trạng thái/i])
    };
  }
  function buildFromTable(rows, cols, forcedCurrency) {
    const dec = detectDecimal(rows.map(r => r[cols.spend]), '.');
    let currency = forcedCurrency || null;
    const list = [], seen = new Set();
    for (const r of rows) {
      const nameCell = r[cols.name];
      if (nameCell == null || String(nameCell).trim() === '' || TOTAL_RE.test(String(nameCell).trim())) continue;
      const idCell = cols.id >= 0 ? r[cols.id] : null;
      const idm = String(idCell == null ? '' : idCell).match(/\d{6,}/) || String(nameCell).match(/\b\d{15,}\b/);
      const lines = String(nameCell).split('\n').map(x => x.trim()).filter(Boolean);
      const name = lines.find(x => !/^(id\s*[:：]?\s*)?\d{6,}$/i.test(x)) || lines[0];
      const raw = r[cols.spend];
      const key = (idm ? 'id:' + idm[0] : 'n:' + normName(name)) + '|' + raw;
      if (seen.has(key)) continue; seen.add(key);
      currency = currency || currencyOf(typeof raw === 'string' ? raw : '');
      list.push({ name, id: idm ? idm[0] : null, status: cols.status >= 0 ? String(r[cols.status] || '') : '', cost: parseNum(raw, dec) || 0, usdCol: null });
    }
    list.forEach(x => { x.currency = currency || 'USD'; });
    return { campaigns: list, currency: currency || null, total: null, totalUsd: null, totalLabel: null, decimal: dec };
  }

  // ---------- Unity: spend theo giờ, cửa sổ 17h hôm qua -> 16h59 hôm nay ----------
  function parseDateTime(v) {
    if (v == null) return null;
    if (v instanceof Date) v = v.toISOString();
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) {
      const n = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
      if (!n) return null;
      m = [n[0], n[3], n[2], n[1], n[4], n[5]];
    }
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0)); // giờ ghi trong file, coi như giờ treo tường
  }
  const HOUR = 3600000;
  function fmtWall(ms) { return new Date(ms).toISOString().slice(0, 13).replace('T', ' ') + ':00'; }
  function unityWindow(rows, o) {
    // o: { dtIdx, spendIdx, groupIdx, date:'YYYY-MM-DD', startHour, shiftHours }
    const dec = detectDecimal(rows.map(r => r[o.spendIdx]), '.');
    const [y, mo, d] = o.date.split('-').map(Number);
    const end = Date.UTC(y, mo - 1, d, o.startHour), start = end - 24 * HOUR;
    const hours = new Map(), groups = new Map();
    let total = 0, used = 0;
    for (const r of rows) {
      let t = parseDateTime(r[o.dtIdx]);
      if (t == null) continue;
      t = Math.floor((t + (o.shiftHours || 0) * HOUR) / HOUR) * HOUR;
      if (t < start || t >= end) continue;
      const v = parseNum(r[o.spendIdx], dec) || 0;
      total += v; used++;
      hours.set(t, (hours.get(t) || 0) + v);
      if (o.groupIdx >= 0) { const g = String(r[o.groupIdx] == null ? '' : r[o.groupIdx]).trim() || '(trống)'; groups.set(g, (groups.get(g) || 0) + v); }
    }
    const missing = [];
    for (let t = start; t < end; t += HOUR) if (!hours.has(t)) missing.push(t);
    return { total, used, start, end, hours, groups, missing };
  }

  return { decimalOfLocale, detectDecimal, parseNum, currencyOf, parseDelimited, findHeaderRow, guessColumns, normName, splitAdjustName, aggregateRevenue, buildCampaigns, autoRate, compute, costCheckOf, parseTerms, matchTerms, roasClass, mergeBuilt, campKey, normDay, parseRangeDays, guessAdjustColumns, guessCostColumns, buildFromTable, parseDateTime, fmtWall, unityWindow };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROASCore;
