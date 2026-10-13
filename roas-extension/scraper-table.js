/* Đọc một bảng dữ liệu bất kỳ trên trang (dùng cho trang TikTok của ITG Marketing Tool).
   Tự chứa hết vì được tiêm vào trang. Chưa kiểm tra trên trang thật: nếu không thấy bảng
   thì trả lỗi kèm danh sách tiêu đề đã tìm thấy để chỉnh lại. */
async function scrapeGenericTable() {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const HEAD_SEL = 'th, [role="columnheader"]';
  const ROOT_SEL = '.ant-table-wrapper, .ant-table, .el-table, [role="grid"], [role="table"], table';
  const heads = [...document.querySelectorAll(HEAD_SEL)].filter(h => h.getBoundingClientRect().width > 0);
  const roots = new Map();
  for (const h of heads) {
    const root = h.closest(ROOT_SEL);
    if (!root) continue;
    const top = root.closest('.ant-table-wrapper, .el-table') || root;
    if (!roots.has(top)) roots.set(top, []);
    roots.get(top).push(h);
  }
  const found = [];
  for (const [root, hs] of roots) {
    const headers = hs.map(h => clean(h.innerText));
    found.push(headers);
    if (!headers.some(h => /spend|cost|chi phí/i.test(h)) || !headers.some(h => /campaign|name|chiến dịch/i.test(h))) continue;
    const rows = [...root.querySelectorAll('tbody tr, [role="row"], .ant-table-row, .el-table__row')]
      .filter(r => !r.querySelector(HEAD_SEL) && r.getBoundingClientRect().height > 0)
      .map(r => [...r.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map(c => (c.innerText || '').split('\n').map(x => x.trim()).filter(Boolean).join('\n')))
      .filter(c => c.length >= 2);
    // Ô đánh dấu (checkbox) có thể làm lệch cột: bỏ cột thừa ở đầu nếu số ô nhiều hơn số tiêu đề
    const fixed = rows.map(c => c.length > headers.length ? c.slice(c.length - headers.length) : c);
    let currencyHint = '';
    const hm = headers.join(' ').match(/\b(IDR|VND|USD|THB|PHP|MYR|SGD|JPY)\b|₫|Rp/);
    if (hm) currencyHint = hm[0];
    if (!currencyHint) { const m = document.body.innerText.match(/currency\s*[:：]?\s*([A-Z]{3})\b/i); if (m) currencyHint = m[1].toUpperCase(); }
    const pm = document.body.innerText.match(/(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)\s+(?:of|trên|\/)\s+(\d[\d.,]*)|total\s*(\d[\d.,]*)/i);
    return { ok: true, headers, rows: fixed, currencyHint, pagerText: pm ? pm[0] : '', title: document.title, scrapedAt: new Date().toISOString() };
  }
  return { ok: false, error: 'NO_TABLE', found };
}
