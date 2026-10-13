/* Hàm này được tiêm vào tab Google Ads (trang Campaigns) để đọc bảng chiến dịch.
   Phải tự chứa hết (không dùng biến bên ngoài) vì Chrome chép nguyên hàm sang trang. */
async function scrapeGoogleAdsCampaigns() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ICONS = /\b(help_outline|arrow_upward|arrow_downward|arrow_drop_down|arrow_drop_up|expand_more|expand_less|chevron_left|chevron_right|info_outline)\b/g;
  const clean = s => (s || '').replace(ICONS, ' ').replace(/\s+/g, ' ').trim();

  const table = document.querySelector('ess-particle-table');
  if (!table) return { ok: false, error: 'NO_TABLE', url: location.pathname };

  const header = table.querySelector('.particle-table-header') ||
    [...table.querySelectorAll('[role="row"]')].find(r => r.querySelector('[role="columnheader"]'));
  if (!header) return { ok: false, error: 'NO_HEADER' };

  const headerAll = [...header.querySelectorAll('[role="columnheader"],[role="gridcell"],[role="rowheader"],[role="cell"]')];
  const cols = [...header.querySelectorAll('[role="columnheader"]')].map(h => {
    const r = h.getBoundingClientRect();
    return { label: clean(h.innerText), left: r.left, right: r.right, idx: headerAll.indexOf(h) };
  });
  const find = names => cols.find(c => names.includes(c.label.toLowerCase()));
  const colName = find(['campaign', 'chiến dịch']);
  const colCost = find(['cost', 'chi phí']);
  const colId = find(['campaign id', 'id chiến dịch']);
  const colStatus = find(['status', 'trạng thái']);
  const colUsd = cols.find(c => c !== colCost && /^usd$|\(usd\)|cost.*usd|usd.*cost/i.test(c.label));
  if (!colName || !colCost) return { ok: false, error: 'NO_COLUMN', columns: cols.map(c => c.label) };

  const cellsOf = row => [...row.querySelectorAll('[role="gridcell"],[role="rowheader"],[role="cell"]')];
  function cellFor(row, col) {
    const cells = cellsOf(row);
    const mid = (col.left + col.right) / 2;
    const byPos = cells.find(c => { const r = c.getBoundingClientRect(); return r.width > 0 && r.left <= mid && r.right >= mid; });
    return byPos || cells[col.idx] || null;
  }
  const text = el => (el ? el.innerText : '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';

  const rows = new Map();
  const summaries = new Map();
  function collect() {
    for (const row of table.querySelectorAll('.particle-table-row')) {
      if (row.classList.contains('summary-draft-overview-row')) continue;
      const nameCell = cellFor(row, colName);
      if (row.classList.contains('particle-table-summary-row')) {
        // Ô tên của dòng tổng lệch 1 ô so với header -> lấy nhãn từ chữ của cả dòng ("Total: Filtered campaigns" / "Total: Account")
        const m = clean(row.innerText).match(/(Total|Tổng)[^0-9]*?(?=\s+(?:IDR|VND|USD|[$₫€£]|\d)|$)/i);
        const label = m ? m[0].trim() : clean(row.innerText).slice(0, 60);
        summaries.set(label, { label, costText: text(cellFor(row, colCost)), usdText: colUsd ? text(cellFor(row, colUsd)) : null });
        continue;
      }
      if (!nameCell) continue;
      const link = nameCell.querySelector('a');
      const name = (link ? link.innerText : text(nameCell)).trim();
      if (!name) continue;
      let id = null;
      if (colId) { const m = text(cellFor(row, colId)).match(/\d{6,}/); if (m) id = m[0]; }
      if (!id) {
        // Link mang campaignId không phải lúc nào cũng là link tên camp -> tìm trong cả dòng
        const a = row.querySelector('a[href*="campaignId="]');
        const m = a && (a.getAttribute('href') || '').match(/campaignId=(\d+)/);
        if (m) id = m[1];
      }
      const costText = text(cellFor(row, colCost));
      const key = id ? 'id:' + id : 'n:' + name + '|' + costText;
      rows.set(key, { name, id, costText, usdText: colUsd ? text(cellFor(row, colUsd)) : null, status: colStatus ? text(cellFor(row, colStatus)) : '' });
    }
  }

  // Bảng của Google Ads chỉ vẽ những dòng đang nhìn thấy -> cuộn từ trên xuống dưới để gom đủ
  let scroller = table.parentElement;
  while (scroller && scroller !== document.body) {
    const s = getComputedStyle(scroller);
    if (/(auto|scroll)/.test(s.overflowY) && scroller.scrollHeight > scroller.clientHeight + 5) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.body) scroller = document.scrollingElement;
  const startTop = scroller.scrollTop;
  scroller.scrollTop = 0; await sleep(500); collect();
  for (let i = 0; i < 500; i++) {
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    if (atBottom) break;
    scroller.scrollTop += Math.max(200, Math.round(scroller.clientHeight * 0.6));
    await sleep(300); collect();
  }
  await sleep(400); collect();
  scroller.scrollTop = startTop;

  let pager = null;
  const pagerRe = /(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)\s+(?:of|trên|trong số|\/)\s+(\d[\d.,]*)/i;
  for (const el of document.querySelectorAll('div, span')) {
    if (el.children.length) continue;
    const m = (el.textContent || '').match(pagerRe);
    if (m) { const n = x => parseInt(x.replace(/\D/g, ''), 10); pager = { from: n(m[1]), to: n(m[2]), total: n(m[3]) }; break; }
  }

  const picker = document.querySelector('material-date-range-picker');
  const dateRange = picker ? clean(picker.innerText.replace(/\b(compare|so sánh)\b/gi, ' ')) : '';
  const titleParts = document.title.split(' - ');
  const account = titleParts.length >= 3 ? titleParts.slice(1, -1).join(' - ') : '';
  let customerId = '';
  for (const el of document.querySelectorAll('div, span')) {
    if (el.children.length) continue;
    const m = (el.textContent || '').match(/\b\d{3}-\d{3}-\d{4}\b/);
    if (m) { customerId = m[0]; break; }
  }
  const lang = document.documentElement.lang || navigator.language;
  let decimal = '.';
  try { decimal = new Intl.NumberFormat(lang).formatToParts(1.5).find(p => p.type === 'decimal').value; } catch (e) {}

  return {
    ok: true, account, customerId, dateRange, lang, decimal,
    columns: cols.map(c => c.label), hasIdColumn: !!colId, usdColumn: colUsd ? colUsd.label : null,
    rows: [...rows.values()], summaries: [...summaries.values()], pager, scrapedAt: new Date().toISOString()
  };
}
