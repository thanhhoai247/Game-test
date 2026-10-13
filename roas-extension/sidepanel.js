/* Side panel: điều phối 3 bước. Logic tính toán nằm trong core.js (ROASCore). */
(() => {
  const $ = id => document.getElementById(id);
  const C = ROASCore;
  const state = {
    scrape: null, built: null,
    table: null,            // { headers, rows }
    campIdx: -1, revIdx: -1,
    result: null, sort: { key: 'cost', asc: false },
    store: { mapping: {}, rates: {}, threshold: 100, unit: 'USD' }
  };

  // ---------- Lưu cài đặt ----------
  async function loadStore() {
    try { const o = await chrome.storage.local.get('roas'); if (o.roas) Object.assign(state.store, o.roas); } catch (e) {}
    $('thr').value = state.store.threshold; $('selUnit').value = state.store.unit;
  }
  function saveStore() { try { chrome.storage.local.set({ roas: state.store }); } catch (e) {} }

  // ---------- Định dạng ----------
  const fmt = (n, d = 2) => n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtCost = n => n == null ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2 });
  const pct = n => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(1) + '%';
  const setMsg = (el, text, cls) => { el.textContent = text || ''; el.className = 'msg ' + (cls || ''); };

  // ---------- Bước 1: đọc cost ----------
  $('btnScrape').onclick = async () => {
    const btn = $('btnScrape'), msg = $('scrapeMsg');
    btn.disabled = true; setMsg(msg, 'Đang đọc bảng (khoảng vài giây)…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !/^https:\/\/ads\.google\.com\/aw\/campaigns/.test(tab.url || '')) {
        throw new Error('Tab đang mở không phải trang Campaigns của Google Ads (ads.google.com/aw/campaigns). Hãy mở đúng trang rồi bấm lại.');
      }
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeGoogleAdsCampaigns });
      const s = res && res.result;
      if (!s || !s.ok) {
        const why = { NO_TABLE: 'Không thấy bảng chiến dịch. Đợi trang tải xong, và chọn tab "Campaigns".', NO_HEADER: 'Không thấy dòng tiêu đề của bảng.', NO_COLUMN: 'Bảng thiếu cột Campaign hoặc Cost. Hãy bật hai cột này (Columns → Modify columns).' }[s && s.error] || 'Không đọc được bảng.';
        throw new Error(why + (s && s.columns ? ' Cột hiện có: ' + s.columns.join(', ') : ''));
      }
      state.scrape = s; state.built = C.buildCampaigns(s);
      showScrapeInfo(); setMsg(msg, 'Đã đọc xong.', 'ok');
      recompute();
    } catch (e) { setMsg(msg, e.message || String(e), 'err'); }
    btn.disabled = false;
  };

  function showScrapeInfo() {
    const s = state.scrape, b = state.built, el = $('scrapeInfo');
    const sum = b.campaigns.reduce((a, c) => a + c.cost, 0);
    const lines = [
      `<b>${esc(s.account || 'Google Ads')}</b> ${esc(s.customerId || '')}`,
      `Ngày: ${esc(s.dateRange || '?')}`,
      `${b.campaigns.length} camp · Tổng cost ${fmtCost(sum)} ${esc(b.currency)}` + (b.totalLabel ? ` (${esc(b.totalLabel)})` : '')
    ];
    if (s.pager && s.pager.total > b.campaigns.length) lines.push(`<span class="warn err">Bảng có ${s.pager.total} camp nhưng chỉ đọc được ${b.campaigns.length}. Tăng "Show rows" trong Google Ads rồi đọc lại.</span>`);
    if (!s.hasIdColumn) lines.push('Mẹo: bật cột "Campaign ID" trong Google Ads để khớp camp chính xác hơn.');
    el.innerHTML = lines.join('<br>'); el.hidden = false;
  }

  // ---------- Bước 2: nạp revenue ----------
  $('btnFile').onclick = () => $('file').click();
  $('file').onchange = e => e.target.files[0] && loadFile(e.target.files[0]);
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  $('btnPaste').onclick = () => {
    const t = $('paste').value;
    if (!t.trim()) return setMsg($('loadMsg'), 'Chưa dán gì cả.', 'err');
    setTable(C.parseDelimited(t), 'nội dung đã dán');
  };

  async function loadFile(file) {
    setMsg($('loadMsg'), 'Đang đọc ' + file.name + '…');
    try {
      let rows;
      if (/\.xlsx$/i.test(file.name)) {
        let r = await readXlsxFile(file);
        if (Array.isArray(r) && r[0] && r[0].data) r = r[0].data;      // v9: [{sheet, data}]
        else if (r && r.rows) r = r.rows;
        rows = r.map(row => row.map(c => c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : c));
      } else rows = C.parseDelimited(await file.text());
      setTable(rows, file.name);
    } catch (e) { setMsg($('loadMsg'), 'Không đọc được file: ' + (e.message || e), 'err'); }
  }

  function setTable(rows, label) {
    if (!rows || rows.length < 2) return setMsg($('loadMsg'), 'File không có dữ liệu.', 'err');
    const h = C.findHeaderRow(rows);
    const headers = rows[h].map((x, i) => String(x == null || x === '' ? 'Cột ' + (i + 1) : x).trim());
    state.table = { headers, rows: rows.slice(h + 1) };
    const key = headers.join('|'), saved = state.store.mapping[key], guess = C.guessColumns(headers);
    state.campIdx = saved ? saved.camp : guess.campaign;
    state.revIdx = saved ? saved.rev : guess.revenue;
    for (const id of ['selCamp', 'selRev']) {
      $(id).innerHTML = '<option value="-1">— chọn cột —</option>' + headers.map((x, i) => `<option value="${i}">${esc(x)}</option>`).join('');
    }
    $('selCamp').value = state.campIdx; $('selRev').value = state.revIdx;
    $('mapping').hidden = false;
    setMsg($('loadMsg'), `Đã nạp ${label} (${state.table.rows.length} dòng).`, 'ok');
    recompute();
  }
  $('selCamp').onchange = $('selRev').onchange = () => {
    state.campIdx = +$('selCamp').value; state.revIdx = +$('selRev').value;
    if (state.table && state.campIdx >= 0 && state.revIdx >= 0) {
      state.store.mapping[state.table.headers.join('|')] = { camp: state.campIdx, rev: state.revIdx }; saveStore();
    }
    recompute();
  };
  $('selUnit').onchange = () => { state.store.unit = $('selUnit').value; saveStore(); recompute(); };

  // ---------- Bước 3: tính & hiển thị ----------
  $('rate').oninput = () => {
    const v = parseFloat($('rate').value);
    if (v > 0 && state.built) { state.store.rates[state.built.currency] = v; saveStore(); }
    renderResult();
  };
  $('thr').oninput = () => { state.store.threshold = parseFloat($('thr').value) || 0; saveStore(); renderTable(); };
  $('hideZero').onchange = renderTable;
  document.querySelectorAll('#tbl th').forEach(th => th.onclick = () => {
    const k = th.dataset.k; state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : k === 'name' };
    renderTable();
  });

  function recompute() {
    const ready = state.built && state.table && state.campIdx >= 0 && state.revIdx >= 0;
    $('s3').hidden = !state.built;
    if (!state.built) return;
    const cur = state.built.currency;
    $('rateRow').hidden = cur === 'USD';
    if (cur !== 'USD') {
      $('curLabel').textContent = cur;
      const auto = C.autoRate(state.built);
      const stored = state.store.rates[cur];
      $('rate').value = auto || stored || '';
      $('rateNote').textContent = auto ? 'Tự tính từ cột USD của Google Ads (sửa tay được).' : stored ? 'Dùng tỷ giá đã nhập lần trước.' : 'Không có cột USD — hãy nhập tỷ giá.';
    }
    state.agg = ready ? C.aggregateRevenue(state.table.rows, state.campIdx, state.revIdx) : null;
    renderResult();
  }

  function renderResult() {
    if (!state.built) return;
    const agg = state.agg || { entries: [], skipped: 0 };
    state.result = C.compute(state.built, agg.entries, { rate: parseFloat($('rate').value), revenueUnit: $('selUnit').value });
    const r = state.result, t = r.totals, warns = [];
    $('tCost').textContent = fmt(t.costUsd); $('tRev').textContent = state.agg ? fmt(t.revenueUsd) : '–'; $('tRoas').textContent = state.agg ? pct(t.roas) : '–';
    if (!state.agg) warns.push(['Chưa nạp revenue — mới hiện cost. Hãy làm bước 2.', 0]);
    if (!r.rate) warns.push(['Chưa có tỷ giá nên chưa tính được ROAS. Hãy nhập tỷ giá.', 1]);
    if (r.costCheck && r.costCheck.diffPct > 0.5) warns.push([`Tổng cost các dòng đọc được (${fmtCost(r.costCheck.sum)}) lệch ${r.costCheck.diffPct.toFixed(1)}% so với "${r.costCheck.label}" (${fmtCost(r.costCheck.pageTotal)}). Có thể thiếu camp do bộ lọc/chia trang.`, 1]);
    if (state.agg) {
      if (t.unmatchedRevenue > 0) warns.push([`${fmt(t.unmatchedRevenue)} revenue không khớp camp nào (xem mục bên dưới).`, 0]);
      warns.push([`Nhớ đối chiếu khoảng ngày Google Ads (${state.scrape.dateRange || '?'}) với ngày của file Adjust.`, 0]);
    }
    $('warns').innerHTML = warns.map(([w, e]) => `<div class="warn ${e ? 'err' : ''}">${esc(w)}</div>`).join('');
    $('unCount').textContent = r.unmatched.length;
    $('unTbl').tBodies[0].innerHTML = r.unmatched.map(e => `<tr><td>${esc(e.raw)}</td><td class="num">${fmt(e.revenue)}</td></tr>`).join('');
    $('unmatchedBox').hidden = !state.agg;
    renderTable();
  }

  function visibleRows() {
    const r = state.result; if (!r) return [];
    const { key, asc } = state.sort;
    let rows = r.rows.filter(x => !($('hideZero').checked && !(x.cost > 0)));
    const val = x => key === 'name' ? x.name.toLowerCase() : (x[key] == null ? -Infinity : x[key]);
    rows = rows.slice().sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (asc ? 1 : -1));
    return rows;
  }

  function renderTable() {
    const thr = (parseFloat($('thr').value) || 0) / 100, hasRev = !!state.agg;
    document.querySelectorAll('#tbl th').forEach(th => {
      th.classList.toggle('sorted', th.dataset.k === state.sort.key);
      th.classList.toggle('asc', th.dataset.k === state.sort.key && state.sort.asc);
    });
    $('tbl').tBodies[0].innerHTML = visibleRows().map(x => {
      const low = hasRev && x.roas != null && x.cost > 0 && x.roas < thr;
      const cls = (low ? 'low ' : '') + (hasRev && !x.matched ? 'nomatch' : '');
      return `<tr class="${cls}"><td class="name" title="${esc(x.name)}">${esc(x.name)}</td>` +
        `<td class="num">${fmtCost(x.cost)}</td><td class="num">${fmt(x.costUsd)}</td>` +
        `<td class="num">${hasRev ? fmt(x.revenueUsd) : '–'}</td><td class="num">${hasRev ? pct(x.roas) : '–'}</td></tr>`;
    }).join('');
  }

  // ---------- Xuất ----------
  const exportRows = () => visibleRows();
  $('btnCopy').onclick = async () => {
    const hasRev = !!state.agg, cur = state.built.currency;
    const lines = [['Camp', 'Cost ' + cur, 'Cost USD', 'Revenue USD', 'ROAS'].join('\t')];
    for (const x of exportRows()) lines.push([x.name, x.cost, round(x.costUsd), hasRev ? round(x.revenueUsd) : '', hasRev && x.roas != null ? round(x.roas * 100, 2) + '%' : ''].join('\t'));
    try { await navigator.clipboard.writeText(lines.join('\n')); $('actMsg').textContent = 'Đã copy.'; } catch (e) { $('actMsg').textContent = 'Không copy được.'; }
  };
  $('btnXlsx').onclick = async () => {
    try {
      const hasRev = !!state.agg, cur = state.built.currency;
      const H = h => ({ value: h, fontWeight: 'bold' });
      const data = [[H('Camp'), H('Trạng thái'), H('Cost ' + cur), H('Cost USD'), H('Revenue USD'), H('ROAS')]];
      for (const x of exportRows()) data.push([
        { value: x.name, type: String }, { value: x.status || '', type: String },
        { value: x.cost, type: Number, format: '#,##0.00' },
        x.costUsd == null ? null : { value: x.costUsd, type: Number, format: '#,##0.00' },
        hasRev && x.revenueUsd != null ? { value: x.revenueUsd, type: Number, format: '#,##0.00' } : null,
        hasRev && x.roas != null ? { value: x.roas, type: Number, format: '0.00%' } : null
      ]);
      const t = state.result.totals;
      data.push([{ value: 'TỔNG', fontWeight: 'bold' }, null, { value: t.cost, type: Number, format: '#,##0.00', fontWeight: 'bold' },
        t.costUsd == null ? null : { value: t.costUsd, type: Number, format: '#,##0.00', fontWeight: 'bold' },
        hasRev ? { value: t.revenueUsd, type: Number, format: '#,##0.00', fontWeight: 'bold' } : null,
        hasRev && t.roas != null ? { value: t.roas, type: Number, format: '0.00%', fontWeight: 'bold' } : null]);
      const name = 'ROAS_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      await writeXlsxFile(data, { columns: [{ width: 48 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 10 }] }).toFile(name);
      $('actMsg').textContent = 'Đã tải ' + name;
    } catch (e) { $('actMsg').textContent = 'Lỗi xuất Excel: ' + (e.message || e); }
  };

  function round(n, d = 2) { return n == null ? '' : Math.round(n * 10 ** d) / 10 ** d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  loadStore();
})();
