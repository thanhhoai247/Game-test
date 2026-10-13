/* Xuất số-multichannel – side panel. Logic tính toán nằm trong core.js (ROASCore). */
(() => {
  const C = ROASCore;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = { apps: [], sel: { google: [], tiktok: [] }, free: { google: '', tiktok: '' }, rates: {}, rateManual: {}, mapping: {}, unit: 'USD', acctSel: null };
  let hist = [];
  let tab = 'google';
  let fileTarget = null;
  const adj = { table: null, idx: { camp: -1, rev: -1, day: -1, chan: -1, id: -1 }, day: 'all' };
  const st = {
    google: { builts: [], accts: [], result: null, sort: { key: 'costUsd', asc: false }, prevMap: null, prevDay: null, rateKey: null, notes: [], sel: null },
    tiktok: { builts: [], tk: null, result: null, sort: { key: 'costUsd', asc: false }, prevMap: null, prevDay: null, rateKey: null, notes: [], sel: null }
  };
  const CHAN_RE = { google: /google/i, tiktok: /tik\s*-?\s*tok/i };

  // ---------- tiện ích ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtCost = n => n == null ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2 });
  const pct = n => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(1) + '%';
  const setMsg = (el, text, cls) => { el.textContent = text || ''; el.className = el.className.replace(/\b(err|ok)\b/g, '').trim() + (cls ? ' ' + cls : ''); };
  const roundN = (n, d = 2) => n == null ? '' : Math.round(n * 10 ** d) / 10 ** d;
  const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  const colOptions = (headers, cur, none = '— chọn cột —') => `<option value="-1">${none}</option>` + headers.map((h, i) => opt(i, h, i === cur)).join('');

  async function loadStore() {
    try { const o = await chrome.storage.local.get(['xs', 'xshist']); if (o.xs) Object.assign(store, o.xs); if (Array.isArray(o.xshist)) hist = o.xshist; } catch (e) {}
    store.sel = Object.assign({ google: [], tiktok: [] }, store.sel); store.free = Object.assign({ google: '', tiktok: '' }, store.free);
    $('selUnit').value = store.unit;
  }
  const saveStore = () => { try { chrome.storage.local.set({ xs: store }); } catch (e) {} };
  const saveHist = () => { try { chrome.storage.local.set({ xshist: hist }); } catch (e) {} };

  // ---------- đọc file ----------
  async function readRows(file) {
    if (/\.xlsx$/i.test(file.name)) {
      let r = await readXlsxFile(file);
      if (Array.isArray(r) && r[0] && r[0].data) r = r[0].data;
      else if (r && r.rows) r = r.rows;
      return r.map(row => row.map(c => c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 16).replace('T', ' ') : c));
    }
    return C.parseDelimited(await file.text());
  }
  async function onFile(target, file) {
    try { handleRows(target, await readRows(file), file.name); }
    catch (e) { showTargetMsg(target, 'Không đọc được file: ' + (e.message || e), 'err'); }
  }
  function showTargetMsg(target, text, cls) {
    const el = target === 'adjust' ? $('adjMsg') : target === 'unity' ? $('unMsg') : document.querySelector('#p-tiktok .runMsg');
    setMsg(el, text, cls);
  }
  function handleRows(target, rows, label) {
    if (!rows || rows.length < 2) return showTargetMsg(target, 'Không có dữ liệu.', 'err');
    if (target === 'adjust') setAdjust(rows, label);
    else if (target === 'unity') setUnity(rows, label);
    else setTkTable(C.findHeaderRow(rows), rows, label);
  }
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { fileTarget = b.dataset.pick; $('file').value = ''; $('file').click(); });
  $('file').onchange = e => e.target.files[0] && onFile(fileTarget, e.target.files[0]);
  document.querySelectorAll('.drop').forEach(d => {
    ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) onFile(d.dataset.for, f); });
  });

  // ---------- tab ----------
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    for (const id of ['google', 'tiktok', 'unity']) $('p-' + id).hidden = id !== tab;
    $('adjustBox').hidden = tab === 'unity';
    if (tab === 'google') refreshAccts();
    renderHist();
  });

  // ---------- Revenue Adjust ----------
  $('adjPasteBtn').onclick = () => { const t = $('adjPaste').value; t.trim() ? setAdjust(C.parseDelimited(t), 'nội dung đã dán') : setMsg($('adjMsg'), 'Chưa dán gì cả.', 'err'); };
  function setAdjust(rows, label) {
    const h = C.findHeaderRow(rows);
    const headers = rows[h].map((x, i) => String(x == null || x === '' ? 'Cột ' + (i + 1) : x).trim());
    adj.table = { headers, rows: rows.slice(h + 1) };
    const key = 'adj|' + headers.join('|'), g = C.guessAdjustColumns(headers), guess = { camp: g.campaign, rev: g.revenue, day: g.day, chan: g.channel, id: g.id }, saved = store.mapping[key];
    adj.idx = saved ? { ...guess, ...saved } : guess;
    fillAdjSelects(headers);
    const days = adj.idx.day >= 0 ? [...new Set(adj.table.rows.map(r => C.normDay(r[adj.idx.day])).filter(Boolean))].sort().reverse() : [];
    adj.days = days;
    fillDays();
    $('adjMap').hidden = false;
    setMsg($('adjMsg'), `Đã nạp ${label} (${adj.table.rows.length} dòng${days.length ? ', ' + days.length + ' ngày' : ''}).`, 'ok');
    afterAdjustChange();
  }
  function fillAdjSelects(headers) {
    $('selCamp').innerHTML = colOptions(headers, adj.idx.camp); $('selRev').innerHTML = colOptions(headers, adj.idx.rev);
    $('selDayCol').innerHTML = colOptions(headers, adj.idx.day, '— không có —'); $('selChan').innerHTML = colOptions(headers, adj.idx.chan, '— không có —'); $('selId').innerHTML = colOptions(headers, adj.idx.id, '— không có —');
  }
  function fillDays() {
    const days = adj.days || [];
    adj.day = days.includes(adj.day) ? adj.day : (days[0] || 'all');
    $('selDay').innerHTML = days.map(d => opt(d, d, d === adj.day)).join('') + opt('all', 'Tất cả các ngày', adj.day === 'all');
  }
  $('selDay').onchange = () => { adj.day = $('selDay').value; st.google.prevMap = st.tiktok.prevMap = null; afterAdjustChange(); };
  $('selUnit').onchange = () => { store.unit = $('selUnit').value; saveStore(); afterAdjustChange(); };
  [['selCamp', 'camp'], ['selRev', 'rev'], ['selDayCol', 'day'], ['selChan', 'chan'], ['selId', 'id']].forEach(([id, k]) => $(id).onchange = () => {
    adj.idx[k] = +$(id).value;
    store.mapping['adj|' + adj.table.headers.join('|')] = { ...adj.idx }; saveStore();
    if (k === 'day') { adj.days = adj.idx.day >= 0 ? [...new Set(adj.table.rows.map(r => C.normDay(r[adj.idx.day])).filter(Boolean))].sort().reverse() : []; fillDays(); }
    afterAdjustChange();
  });
  const afterAdjustChange = () => { calc('google'); calc('tiktok'); };

  // doanh thu theo kênh + ngày đã chọn; null nếu chưa nạp
  function adjustFor(ch) {
    if (!adj.table || adj.idx.camp < 0 || adj.idx.rev < 0) return null;
    const { camp, rev, day, chan, id } = adj.idx;
    const f = r => (adj.day === 'all' || day < 0 || C.normDay(r[day]) === adj.day) && (chan < 0 || CHAN_RE[ch].test(String(r[chan] == null ? '' : r[chan])));
    const agg = C.aggregateRevenue(adj.table.rows, camp, rev, f, id);
    return { entries: agg.entries, chanRows: chan < 0 ? null : adj.table.rows.filter(r => CHAN_RE[ch].test(String(r[chan] == null ? '' : r[chan]))).length };
  }

  // ---------- bộ lọc app ----------
  function renderChips(ch) {
    const root = $('p-' + ch);
    root.querySelector('.chips').innerHTML = store.apps.map((a, i) => `<span class="chip ${store.sel[ch].includes(a) ? 'on' : ''}" data-a="${esc(a)}">${esc(a)}<span class="x" data-i="${i}" title="Xoá">×</span></span>`).join('') || '<span class="hint">Chưa có mã app nào — thêm bên dưới, hoặc để trống để xem tất cả camp.</span>';
  }
  function termsOf(ch) { return C.parseTerms(store.free[ch], store.sel[ch]); }

  // ---------- khởi tạo panel Google / TikTok ----------
  function initPanel(ch) {
    const root = $('p-' + ch), res = root.querySelector('.result');
    res.appendChild($('tplResult').content.cloneNode(true));
    root.querySelector('.chips').onclick = e => {
      const x = e.target.closest('.x'), chip = e.target.closest('.chip');
      if (x) { const a = store.apps[+x.dataset.i]; store.apps.splice(+x.dataset.i, 1); for (const k of ['google', 'tiktok']) store.sel[k] = store.sel[k].filter(v => v !== a); saveStore(); renderChips('google'); renderChips('tiktok'); calc(ch); }
      else if (chip) { const a = chip.dataset.a, s = store.sel[ch], i = s.indexOf(a); i >= 0 ? s.splice(i, 1) : s.push(a); saveStore(); renderChips(ch); calc(ch); }
    };
    root.querySelector('.btnAddApp').onclick = () => {
      const inp = root.querySelector('.addApp'), v = inp.value.trim();
      if (v && !store.apps.includes(v)) { store.apps.push(v); store.sel[ch].push(v); saveStore(); renderChips('google'); renderChips('tiktok'); calc(ch); }
      inp.value = '';
    };
    const ft = root.querySelector('.freeText'); ft.value = store.free[ch] || '';
    ft.oninput = () => { store.free[ch] = ft.value; saveStore(); calc(ch); };
    res.querySelector('.hideZero').onchange = () => renderTable(ch);
    res.querySelectorAll('th').forEach(th => th.onclick = () => { const S = st[ch], k = th.dataset.k; S.sort = { key: k, asc: S.sort.key === k ? !S.sort.asc : k === 'name' }; renderTable(ch); });
    res.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr'); if (tr && tr.dataset.key) { st[ch].sel = tr.dataset.key; renderTable(ch); renderHist(); } };
    res.querySelector('.btnSave').onclick = () => saveSnapshot(ch);
    res.querySelector('.btnCopy').onclick = () => copyTable(ch);
    res.querySelector('.btnXlsx').onclick = () => exportXlsx(ch);
    root.querySelector('.btnRun').onclick = () => (ch === 'google' ? runGoogle() : runTikTok());
    renderChips(ch);
  }

  // ---------- Google Ads ----------
  const googleRoot = () => $('p-google');
  async function refreshAccts() {
    const box = googleRoot().querySelector('.accts');
    try {
      const tabs = (await chrome.tabs.query({ url: 'https://ads.google.com/*' })).filter(t => /\/aw\/campaigns/.test(t.url || ''));
      st.google.accts = tabs.map(t => { const p = (t.title || '').split(' - '); return { id: t.id, name: p.length >= 3 ? p.slice(1, -1).join(' - ') : (t.title || 'Tab ' + t.id) }; });
    } catch (e) { st.google.accts = []; }
    const A = st.google.accts;
    if (!A.length) { box.innerHTML = '<div class="none">Chưa thấy tab Campaigns nào của Google Ads đang mở.</div>'; return; }
    box.innerHTML = A.map(a => `<label><input type="checkbox" data-id="${a.id}" ${(store.acctSel == null || store.acctSel.includes(a.name)) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('');
    box.querySelectorAll('input').forEach(i => i.onchange = () => {
      store.acctSel = A.filter(a => box.querySelector(`input[data-id="${a.id}"]`).checked).map(a => a.name); saveStore();
    });
  }
  googleRoot().querySelector('.btnRefresh').onclick = refreshAccts;

  async function runGoogle() {
    const msg = googleRoot().querySelector('.runMsg'), btn = googleRoot().querySelector('.btnRun');
    await refreshAccts();
    const picked = st.google.accts.filter(a => googleRoot().querySelector(`input[data-id="${a.id}"]`).checked);
    if (!picked.length) return setMsg(msg, 'Hãy mở và tick ít nhất một tài khoản Google Ads.', 'err');
    btn.disabled = true;
    const [orig] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const builts = [], errs = [];
    for (const a of picked) {
      setMsg(msg, `Đang đọc ${a.name} (${builts.length + 1}/${picked.length})…`);
      try {
        await chrome.tabs.update(a.id, { active: true }); await sleep(500);
        const [r] = await chrome.scripting.executeScript({ target: { tabId: a.id }, func: scrapeGoogleAdsCampaigns });
        const s = r && r.result;
        if (!s || !s.ok) {
          const why = { NO_TABLE: 'không thấy bảng chiến dịch (đợi trang tải xong)', NO_HEADER: 'không thấy dòng tiêu đề', NO_COLUMN: 'bảng thiếu cột Campaign/Cost' }[s && s.error] || 'không đọc được';
          errs.push(`${a.name}: ${why}`); continue;
        }
        builts.push({ label: a.name, scrape: s, built: C.buildCampaigns(s) });
      } catch (e) { errs.push(`${a.name}: ${e.message || e}`); }
    }
    if (orig) chrome.tabs.update(orig.id, { active: true }).catch(() => {});
    btn.disabled = false;
    const S = st.google; S.builts = builts; S.prevMap = null; S.rateKey = null;
    setMsg(msg, errs.length ? errs.join(' · ') : `Đã đọc ${builts.length} tài khoản.`, errs.length ? 'err' : 'ok');
    calc('google');
  }

  // ---------- TikTok (ITG) ----------
  const tkRoot = () => $('p-tiktok');
  tkRoot().querySelector('.tkPasteBtn').onclick = () => {
    const t = tkRoot().querySelector('.tkPaste').value;
    if (!t.trim()) return setMsg(tkRoot().querySelector('.runMsg'), 'Chưa dán gì cả.', 'err');
    const rows = C.parseDelimited(t); setTkTable(C.findHeaderRow(rows), rows, 'nội dung đã dán');
  };
  async function runTikTok() {
    const msg = tkRoot().querySelector('.runMsg'), btn = tkRoot().querySelector('.btnRun');
    btn.disabled = true; setMsg(msg, 'Đang đọc bảng…');
    try {
      const [tb] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tb || !/^https:\/\/marketing\.itgproduct\.com\//.test(tb.url || '')) throw new Error('Tab đang mở không phải trang marketing.itgproduct.com. Hãy mở trang TikTok Ads Editor rồi bấm lại.');
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tb.id }, func: scrapeGenericTable });
      const s = r && r.result;
      if (!s || !s.ok) throw new Error('Không thấy bảng có cột campaign và spend trên trang.' + (s && s.found && s.found.length ? ' Các bảng tìm thấy có tiêu đề: ' + s.found.map(h => '[' + h.join(', ') + ']').join(' ; ').slice(0, 300) : '') + ' Có thể dán bảng thủ công ở mục bên dưới.');
      setTkTable(0, [s.headers, ...s.rows], 'trang ITG', s);
    } catch (e) { setMsg(msg, e.message || String(e), 'err'); }
    btn.disabled = false;
  }
  function setTkTable(h, rows, label, scrape) {
    const headers = rows[h].map((x, i) => String(x == null || x === '' ? 'Cột ' + (i + 1) : x).replace(/\s+/g, ' ').trim());
    const tk = { headers, rows: rows.slice(h + 1), hint: scrape ? scrape.currencyHint : '', pager: scrape ? scrape.pagerText : '' };
    const key = 'tk|' + headers.join('|'), cols = { ...C.guessCostColumns(headers), ...(store.mapping[key] || {}) };
    tk.cols = cols; st.tiktok.tk = tk;
    const r = tkRoot();
    r.querySelector('.mName').innerHTML = colOptions(headers, cols.name); r.querySelector('.mId').innerHTML = colOptions(headers, cols.id, '— không có —'); r.querySelector('.mSpend').innerHTML = colOptions(headers, cols.spend);
    r.querySelector('.tkMap').hidden = false;
    setMsg(r.querySelector('.runMsg'), `Đã nạp ${tk.rows.length} dòng từ ${label}.`, 'ok');
    buildTk(true);
  }
  ['mName', 'mId', 'mSpend', 'mCur'].forEach(c => tkRoot().querySelector('.' + c).onchange = () => {
    const tk = st.tiktok.tk; if (!tk) return;
    const r = tkRoot(); tk.cols = { ...tk.cols, name: +r.querySelector('.mName').value, id: +r.querySelector('.mId').value, spend: +r.querySelector('.mSpend').value };
    store.mapping['tk|' + tk.headers.join('|')] = { name: tk.cols.name, id: tk.cols.id, spend: tk.cols.spend }; saveStore();
    buildTk(false);
  });
  function buildTk(reset) {
    const S = st.tiktok, tk = S.tk, r = tkRoot();
    if (!tk || tk.cols.name < 0 || tk.cols.spend < 0) return;
    const manual = r.querySelector('.mCur').value;
    const forced = manual || (tk.hint ? C.currencyOf(tk.hint) : null);
    const built = C.buildFromTable(tk.rows, tk.cols, forced);
    const info = r.querySelector('.curInfo');
    if (!built.currency) { info.innerHTML = '<b style="color:#b91c1c">Chưa nhận ra mệnh giá (IDR hay VND?).</b> Hãy chọn ở ô "Mệnh giá".'; built.currency = 'USD'; built.unknown = true; }
    else info.innerHTML = `Mệnh giá TikTok: <b>${esc(built.currency)}</b> ${manual ? '(chọn tay)' : '(tự nhận)'} · ${built.campaigns.length} camp`;
    S.builts = [{ label: 'TikTok (ITG)', built, scrape: { pager: null } }];
    if (reset) { S.prevMap = null; S.rateKey = null; }
    calc('tiktok');
  }

  // ---------- tính & hiển thị ----------
  function rateInputs(ch) { const o = {}; $('p-' + ch).querySelectorAll('.rates input').forEach(i => { const v = parseFloat(i.value); if (v > 0) o[i.dataset.cur] = v; }); return o; }
  function renderRates(ch, currencies) {
    const S = st[ch], box = $('p-' + ch).querySelector('.rates'), key = currencies.join(',');
    if (S.rateKey === key) return; S.rateKey = key;
    box.innerHTML = currencies.map(cur => {
      let auto = null;
      if (ch === 'google') for (const b of S.builts) if (b.built.currency === cur && !auto) auto = C.autoRate(b.built);
      const v = store.rateManual[cur] ? store.rates[cur] : (auto || store.rates[cur] || '');
      const note = store.rateManual[cur] ? 'nhập tay' : auto ? 'tự tính từ cột USD' : v ? 'đã lưu lần trước' : 'hãy nhập';
      return `<label>${esc(cur)} / 1 USD <input type="number" min="0" step="any" data-cur="${esc(cur)}" value="${esc(v)}"><small>${note}</small></label>`;
    }).join('');
    box.querySelectorAll('input').forEach(i => i.oninput = () => {
      const v = parseFloat(i.value); if (v > 0) { store.rates[i.dataset.cur] = v; store.rateManual[i.dataset.cur] = true; saveStore(); }
      calc(ch);
    });
  }

  function calc(ch) {
    const S = st[ch], res = $('p-' + ch).querySelector('.result');
    if (!S.builts.length) { res.hidden = true; return; }
    res.hidden = false;
    const terms = termsOf(ch);
    const builts = S.builts.map(b => ({ ...b.built, campaigns: b.built.campaigns.filter(c => C.matchTerms(c.name, terms)) }));
    const merged = C.mergeBuilt(builts);
    const currencies = [...new Set(merged.campaigns.map(c => c.currency))].filter(c => c && c !== 'USD').sort();
    renderRates(ch, currencies);
    const a = adjustFor(ch);
    S.result = C.compute(merged, a ? a.entries : [], { rates: rateInputs(ch), revenueUnit: store.unit, revenueLoaded: !!a });
    S.hasRev = !!a; S.adjInfo = a;
    if (S.prevDay !== adj.day) { S.prevMap = null; S.prevDay = adj.day; }
    if (!S.prevMap) S.prevMap = lastRoasMap(ch, adj.day);
    const r = S.result, t = r.totals, W = [];
    const q = s => res.querySelector(s);
    q('.tCost').textContent = fmt(t.costUsd); q('.tRev').textContent = a ? fmt(t.revenueUsd) : '–'; q('.tRoas').textContent = a ? pct(t.roas) : '–';
    const card = q('.tRoas').parentElement; card.className = 'card ' + (a ? C.roasClass(t.roas) : '');
    if (!a) W.push(['Chưa nạp file revenue Adjust — mới hiện cost.', 0]);
    if (currencies.some(c => !rateInputs(ch)[c])) W.push(['Chưa có tỷ giá nên chưa tính được cost USD/ROAS. Hãy nhập tỷ giá.', 1]);
    if (ch === 'tiktok' && S.builts[0] && S.builts[0].built.unknown) W.push(['Chưa nhận ra mệnh giá của TikTok — chọn ở ô "Mệnh giá".', 1]);
    const noId = r.rows.filter(x => x.cost > 0 && !x.id && !x.matched).length;
    if (a && noId) W.push([`${noId} camp có chi tiêu nhưng không đọc được Campaign ID và tên cũng không khớp tên trong file Adjust.${ch === 'google' ? ' Hãy bật cột "Campaign ID" trong bảng Google Ads rồi đọc lại.' : ' Hãy chọn cột ID camp (nếu bảng có).'}`, 1]);
    if (a && a.chanRows === 0) W.push(['File Adjust không có dòng nào của kênh này — kiểm tra ô "Cột kênh".', 1]);
    if (a && adj.idx.day >= 0 && adj.day !== 'all' && !a.entries.length) W.push(['Không có revenue nào trong ngày/kênh đã chọn.', 1]);
    if (ch === 'google') for (const b of S.builts) {
      const s = b.scrape, cc = C.costCheckOf(b.built, b.built.campaigns.reduce((x, c) => x + c.cost, 0));
      if (cc && cc.diffPct > 0.5) W.push([`${b.label}: tổng cost các dòng đọc được lệch ${cc.diffPct.toFixed(1)}% so với "${cc.label}".`, 1]);
      if (s.pager && s.pager.total > b.built.campaigns.length) W.push([`${b.label}: bảng có ${s.pager.total} camp nhưng chỉ đọc được ${b.built.campaigns.length}. Tăng "Show rows".`, 1]);
      const days = C.parseRangeDays(s.dateRange, s.scrapedAt);
      if (adj.day !== 'all' && days && (days.length > 1 || days[0] !== adj.day)) W.push([`${b.label}: ngày trên Google Ads là "${s.dateRange}", khác ngày xuất số ${adj.day}.`, 1]);
      else if (!days) W.push([`${b.label}: nhớ đối chiếu ngày Google Ads ("${s.dateRange || '?'}") với ngày xuất số.`, 0]);
    }
    if (ch === 'tiktok' && S.tk && S.tk.pager) W.push([`Trang ITG báo "${S.tk.pager}" — nếu bảng chia trang, hãy tăng số dòng mỗi trang để đọc đủ camp.`, 0]);
    if (ch === 'tiktok') W.push(['Nhớ đối chiếu ngày đang chọn trên trang ITG với ngày xuất số.', 0]);
    q('.warns').innerHTML = W.map(([w, e]) => `<div class="warn ${e ? 'err' : ''}">${esc(w)}</div>`).join('');
    q('.unCount').textContent = r.unmatched.length;
    q('.unTbl').tBodies[0].innerHTML = r.unmatched.map(e => `<tr><td>${esc(e.raw)}</td><td class="num">${fmt(e.revenue)}</td></tr>`).join('');
    q('.unBox').hidden = !a;
    renderTable(ch); renderHist();
  }

  function deltaOf(ch, x) {
    const S = st[ch], prev = S.prevMap && S.prevMap[C.campKey(x)];
    return prev == null || x.roas == null ? null : x.roas - prev;
  }
  function visibleRows(ch) {
    const S = st[ch]; if (!S.result) return [];
    const { key, asc } = S.sort, hide = $('p-' + ch).querySelector('.hideZero').checked;
    const val = x => key === 'name' ? x.name.toLowerCase() : key === 'delta' ? (deltaOf(ch, x) ?? -Infinity) : (x[key] == null ? -Infinity : x[key]);
    return S.result.rows.filter(x => !(hide && !(x.cost > 0))).sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (asc ? 1 : -1));
  }
  function deltaHtml(d) {
    if (d == null) return '–';
    const p = d * 100;
    return Math.abs(p) < 0.05 ? '0' : `<span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'}${Math.abs(p).toFixed(1)}</span>`;
  }
  function renderTable(ch) {
    const S = st[ch], res = $('p-' + ch).querySelector('.result');
    res.querySelectorAll('th').forEach(th => { th.classList.toggle('sorted', th.dataset.k === S.sort.key); th.classList.toggle('asc', th.dataset.k === S.sort.key && S.sort.asc); });
    res.querySelector('tbody').innerHTML = visibleRows(ch).map(x => {
      const cls = S.hasRev ? C.roasClass(x.roas) : 'na', key = C.campKey(x);
      return `<tr class="${cls} ${S.sel === key ? 'sel' : ''}" data-key="${esc(key)}"><td class="name" title="${esc(x.name + (x.id ? ' · ' + x.id : '') + ' · cost ' + fmtCost(x.cost) + ' ' + x.currency)}">${esc(x.name)}</td>` +
        `<td class="num">${fmt(x.costUsd)}</td><td class="num">${S.hasRev ? fmt(x.revenueUsd) : '–'}</td><td class="num">${S.hasRev ? pct(x.roas) : '–'}</td><td class="num">${deltaHtml(S.hasRev ? deltaOf(ch, x) : null)}</td></tr>`;
    }).join('');
  }

  // ---------- lịch sử & biểu đồ ----------
  function lastRoasMap(ch, day) {
    const m = {};
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i]; if (h.ch !== ch || (day !== 'all' && h.day !== day)) continue;
      for (const k in h.camps) if (!(k in m) && h.camps[k].x != null) m[k] = h.camps[k].x;
    }
    return m;
  }
  function saveSnapshot(ch) {
    const S = st[ch], res = $('p-' + ch).querySelector('.result'), msg = res.querySelector('.actMsg');
    if (!S.result || !S.hasRev) return setMsg(msg, 'Cần đọc cost và nạp revenue trước khi lưu.', 'err');
    const camps = {};
    for (const x of S.result.rows) if (x.cost > 0) camps[C.campKey(x)] = { n: x.name, c: roundN(x.costUsd, 4), r: roundN(x.revenueUsd, 4), x: x.roas == null ? null : roundN(x.roas, 5) };
    camps.__total = { n: 'Tổng', c: roundN(S.result.totals.costUsd, 4), r: roundN(S.result.totals.revenueUsd, 4), x: S.result.totals.roas == null ? null : roundN(S.result.totals.roas, 5) };
    hist.push({ t: Date.now(), ch, day: adj.day, scope: termsOf(ch).join(', ') || 'tất cả', camps });
    if (hist.length > 600) hist = hist.slice(-600);
    saveHist();
    const n = hist.filter(h => h.ch === ch && h.day === adj.day).length;
    setMsg(msg, `Đã lưu lúc ${hhmm(Date.now())} (lần check thứ ${n} của ngày ${adj.day}).`, 'ok');
    renderHist();
  }
  $('histCamp').onchange = () => { if (st[tab]) { st[tab].sel = $('histCamp').value; renderTable(tab); renderHist(true); } };
  $('btnClearHist').onclick = () => {
    if (!st[tab] || !confirm('Xoá toàn bộ lịch sử ROAS đã lưu của kênh này?')) return;
    hist = hist.filter(h => h.ch !== tab); saveHist(); st[tab].prevMap = null; renderHist(); calc(tab);
  };
  function renderHist(keepSelect) {
    const box = $('histBox');
    if (tab === 'unity') { box.hidden = true; return; }
    const S = st[tab], snaps = hist.filter(h => h.ch === tab && (adj.day === 'all' || h.day === adj.day));
    box.hidden = !snaps.length && !S.result;
    if (box.hidden) return;
    const names = {}; 
    if (S.result) for (const x of S.result.rows) if (x.cost > 0) names[C.campKey(x)] = x.name;
    for (const h of snaps) for (const k in h.camps) if (!(k in names)) names[k] = h.camps[k].n;
    names.__total = 'Tổng (tất cả camp đang lọc)';
    if (!S.sel || !(S.sel in names)) S.sel = '__total';
    $('histCamp').innerHTML = Object.entries(names).sort((a, b) => a[0] === '__total' ? -1 : b[0] === '__total' ? 1 : a[1].localeCompare(b[1])).map(([k, n]) => opt(k, n, k === S.sel)).join('');
    const series = snaps.filter(h => S.sel in h.camps && h.camps[S.sel].x != null).map(h => ({ t: h.t, x: h.camps[S.sel].x }));
    $('chart').innerHTML = chartSvg(series);
    const last = series[series.length - 1], prev = series[series.length - 2];
    $('histInfo').textContent = !series.length ? 'Chưa có lần lưu nào cho camp này — bấm "Lưu lần check".' :
      `${series.length} lần check · gần nhất ${hhmm(last.t)}: ${pct(last.x)}` + (prev ? ` (${last.x >= prev.x ? '▲' : '▼'}${Math.abs((last.x - prev.x) * 100).toFixed(1)} điểm so với lần trước)` : '');
  }
  function chartSvg(series) {
    const W = 340, H = 170, L = 36, R = 12, T = 12, B = 26;
    if (!series.length) return '';
    const xs = series.map(p => p.x), lo = Math.max(0, Math.min(Math.min(...xs), 0.8) - 0.05), hi = Math.max(Math.max(...xs), 1.05) + 0.05;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const t0 = series[0].t, t1 = series[series.length - 1].t;
    const x = t => series.length === 1 || t1 === t0 ? (L + W - R) / 2 : L + (t - t0) / (t1 - t0) * (W - L - R);
    const col = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626', na: '#6b7280' };
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${Math.max(0, y(1) - T)}" fill="#dcfce7"/>`;
    s += `<rect x="${L}" y="${y(1)}" width="${W - L - R}" height="${Math.max(0, y(0.85) - y(1))}" fill="#fef9c3"/>`;
    s += `<rect x="${L}" y="${y(0.85)}" width="${W - L - R}" height="${Math.max(0, H - B - y(0.85))}" fill="#fee2e2"/>`;
    for (const v of [0.85, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#9ca3af" stroke-dasharray="3 3"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`;
    s += `<polyline fill="none" stroke="#374151" stroke-width="1.5" points="${series.map(p => `${x(p.t).toFixed(1)},${y(p.x).toFixed(1)}`).join(' ')}"/>`;
    series.forEach((p, i) => {
      const c = col[C.roasClass(p.x)], px = x(p.t), py = y(p.x);
      s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${c}" stroke="#fff"><title>${hhmm(p.t)} — ${pct(p.x)}</title></circle>`;
      if (series.length <= 8 || i === series.length - 1) s += `<text x="${px.toFixed(1)}" y="${(py - 7).toFixed(1)}" text-anchor="middle" style="fill:#111827">${(p.x * 100).toFixed(0)}%</text>`;
    });
    s += `<text x="${L}" y="${H - 8}">${hhmm(t0)}</text>` + (series.length > 1 ? `<text x="${W - R}" y="${H - 8}" text-anchor="end">${hhmm(t1)}</text>` : '');
    return s + '</svg>';
  }

  // ---------- xuất ----------
  function rowsForExport(ch) { return visibleRows(ch); }
  async function copyTable(ch) {
    const S = st[ch], msg = $('p-' + ch).querySelector('.actMsg'), hr = S.hasRev;
    const lines = [['Camp', 'ID', 'Tiền tệ', 'Cost', 'Cost USD', 'Revenue USD', 'ROAS', 'Δ điểm %'].join('\t')];
    for (const x of rowsForExport(ch)) { const d = deltaOf(ch, x); lines.push([x.name, x.id || '', x.currency, x.cost, roundN(x.costUsd), hr ? roundN(x.revenueUsd) : '', hr && x.roas != null ? roundN(x.roas * 100, 2) + '%' : '', d == null ? '' : roundN(d * 100, 2)].join('\t')); }
    try { await navigator.clipboard.writeText(lines.join('\n')); setMsg(msg, 'Đã copy bảng.', 'ok'); } catch (e) { setMsg(msg, 'Không copy được.', 'err'); }
  }
  const FILL = { good: '#DCFCE7', warn: '#FEF9C3', bad: '#FEE2E2' };
  async function exportXlsx(ch) {
    const S = st[ch], msg = $('p-' + ch).querySelector('.actMsg'), hr = S.hasRev;
    try {
      const H = h => ({ value: h, fontWeight: 'bold' }), num = (v, f) => v == null ? null : { value: v, type: Number, format: f || '#,##0.00' };
      const data = [['Camp', 'ID', 'Tiền tệ', 'Cost', 'Cost USD', 'Revenue USD', 'ROAS', 'Δ điểm %'].map(H)];
      for (const x of rowsForExport(ch)) {
        const bg = hr ? FILL[C.roasClass(x.roas)] : undefined, d = deltaOf(ch, x);
        data.push([{ value: x.name, type: String, backgroundColor: bg }, { value: x.id || '', type: String }, { value: x.currency, type: String },
          num(x.cost), num(x.costUsd), hr ? num(x.revenueUsd) : null,
          hr && x.roas != null ? { value: x.roas, type: Number, format: '0.00%', backgroundColor: bg } : null, d == null ? null : num(d * 100, '0.00')]);
      }
      const t = S.result.totals;
      data.push([{ value: 'TỔNG', fontWeight: 'bold' }, null, null, null, num(t.costUsd), hr ? num(t.revenueUsd) : null, hr && t.roas != null ? { value: t.roas, type: Number, format: '0.00%', fontWeight: 'bold' } : null, null]);
      const name = `${ch === 'google' ? 'GoogleAds' : 'TikTok'}_ROAS_${adj.day}_${hhmm(Date.now()).replace(':', 'h')}.xlsx`;
      await writeXlsxFile(data, { columns: [{ width: 48 }, { width: 18 }, { width: 8 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 10 }] }).toFile(name);
      setMsg(msg, 'Đã tải ' + name, 'ok');
    } catch (e) { setMsg(msg, 'Lỗi xuất Excel: ' + (e.message || e), 'err'); }
  }

  // ---------- Unity ----------
  const un = { table: null, last: null };
  $('unPasteBtn').onclick = () => { const t = $('unPaste').value; t.trim() ? setUnity(C.parseDelimited(t), 'nội dung đã dán') : setMsg($('unMsg'), 'Chưa dán gì cả.', 'err'); };
  function setUnity(rows, label) {
    const h = C.findHeaderRow(rows);
    const headers = rows[h].map((x, i) => String(x == null || x === '' ? 'Cột ' + (i + 1) : x).trim());
    un.table = { headers, rows: rows.slice(h + 1) };
    const find = (re, bad) => headers.findIndex(x => re.test(x) && !(bad && bad.test(x)));
    let dt = find(/timestamp|date.?time|hour|time|giờ|thời gian/i); if (dt < 0) dt = find(/date|day|ngày/i);
    const sp = find(/spend|cost|chi phí/i, /per|avg|cpi|cpm|ecpm|rate|\//i);
    $('unDt').innerHTML = colOptions(headers, dt); $('unSpend').innerHTML = colOptions(headers, sp); $('unGroup').innerHTML = colOptions(headers, -1, '— không nhóm —');
    // chọn D mặc định theo mốc thời gian mới nhất trong file
    let max = null; for (const r of un.table.rows) { const t = C.parseDateTime(r[dt]); if (t != null && (max == null || t > max)) max = t; }
    $('unDate').value = max != null ? new Date(max).toISOString().slice(0, 10) : ymdLocal(new Date());
    $('unMap').hidden = false;
    setMsg($('unMsg'), `Đã nạp ${label} (${un.table.rows.length} dòng).`, 'ok');
    renderUnity();
  }
  ['unDate', 'unStart', 'unDt', 'unSpend', 'unGroup', 'unShift'].forEach(id => $(id).onchange = $(id).oninput = renderUnity);
  function renderUnity() {
    if (!un.table) return;
    const o = { dtIdx: +$('unDt').value, spendIdx: +$('unSpend').value, groupIdx: +$('unGroup').value, date: $('unDate').value, startHour: Math.min(23, Math.max(0, parseInt($('unStart').value) || 0)), shiftHours: parseFloat($('unShift').value) || 0 };
    if (o.dtIdx < 0 || o.spendIdx < 0 || !o.date) { $('unOut').innerHTML = '<div class="warn">Hãy chọn cột thời gian, cột spend và ngày D.</div>'; return; }
    const w = C.unityWindow(un.table.rows, o); un.last = { w, o };
    const hrs = []; for (let t = w.start; t < w.end; t += 3600000) hrs.push(t);
    let h = `<div class="info">Khoảng tính: <b>${C.fmtWall(w.start)}</b> → <b>${C.fmtWall(w.end - 1)}</b> (đến hết 59 phút)</div>`;
    h += `<div class="cards" style="grid-template-columns:1fr 1fr"><div class="card"><span>Tổng spend</span><b class="big">${fmt(w.total)}</b></div><div class="card"><span>Số giờ có dữ liệu</span><b class="big">${hrs.length - w.missing.length}/${hrs.length}</b></div></div>`;
    if (w.missing.length) h += `<div class="warn err">Thiếu dữ liệu ${w.missing.length} giờ: ${w.missing.slice(0, 8).map(t => C.fmtWall(t).slice(5, 13) + 'h').join(', ')}${w.missing.length > 8 ? '…' : ''}. Kiểm tra file xuất, ngày D hoặc ô "Lệch giờ".</div>`;
    if (!w.used) h += '<div class="warn err">Không có dòng nào nằm trong khoảng này.</div>';
    if (w.groups.size) h += `<table><thead><tr><th>${esc(un.table.headers[o.groupIdx])}</th><th class="num">Spend</th></tr></thead><tbody>${[...w.groups].sort((a, b) => b[1] - a[1]).map(([g, v]) => `<tr><td class="name" title="${esc(g)}">${esc(g)}</td><td class="num">${fmt(v)}</td></tr>`).join('')}</tbody></table>`;
    h += `<details><summary>Spend từng giờ</summary><table><tbody>${hrs.map(t => `<tr><td>${C.fmtWall(t).slice(5)}</td><td class="num">${w.hours.has(t) ? fmt(w.hours.get(t)) : '<span class="down">thiếu</span>'}</td></tr>`).join('')}</tbody></table></details>`;
    h += `<div class="row"><button class="primary" id="unCopy">Copy</button><button id="unXlsx">Tải Excel</button><span class="hint" id="unAct"></span></div>`;
    $('unOut').innerHTML = h;
    $('unCopy').onclick = async () => { try { await navigator.clipboard.writeText(unityRows().map(r => r.join('\t')).join('\n')); setMsg($('unAct'), 'Đã copy.', 'ok'); } catch (e) { setMsg($('unAct'), 'Không copy được.', 'err'); } };
    $('unXlsx').onclick = async () => {
      try { await writeXlsxFile(unityRows().map((r, i) => r.map(c => i === 0 ? { value: c, fontWeight: 'bold' } : typeof c === 'number' ? { value: c, type: Number, format: '#,##0.00' } : c === '' ? null : { value: c, type: String })), { columns: [{ width: 22 }, { width: 14 }] }).toFile(`Unity_spend_${o.date}.xlsx`); setMsg($('unAct'), 'Đã tải file.', 'ok'); }
      catch (e) { setMsg($('unAct'), 'Lỗi: ' + (e.message || e), 'err'); }
    };
  }
  function unityRows() {
    const { w } = un.last, rows = [['Giờ', 'Spend']];
    for (let t = w.start; t < w.end; t += 3600000) rows.push([C.fmtWall(t), w.hours.has(t) ? roundN(w.hours.get(t), 4) : '']);
    rows.push(['TỔNG', roundN(w.total, 4)]);
    return rows;
  }

  // ---------- khởi động ----------
  (async () => {
    await loadStore();
    $('selUnit').value = store.unit;
    initPanel('google'); initPanel('tiktok');
    refreshAccts();
  })();
})();
