/*
 * M-invoice – Công cụ tải hàng loạt PDF + XML chứng từ khấu trừ thuế TNCN
 * Cách dùng: xem README.md. Dán toàn bộ file này vào Console (F12) của trang
 * https://0104961939.minvoice.com.vn/#!/app khi đã đăng nhập.
 *
 * Nguyên lý: script "học" các request mà chính trang web gửi đi (danh sách chứng từ,
 * tải PDF, tải XML), rồi gửi lại các request đó cho TOÀN BỘ chứng từ (lật hết các trang),
 * và gói PDF + XML vào file .zip lưu về máy. Chạy hoàn toàn trong trình duyệt của bạn,
 * dùng phiên đăng nhập của bạn; không gửi dữ liệu đi đâu khác.
 */
(() => {
  if (window.MV && window.MV._installed) {
    console.log('%c[MV] Đã cài từ trước. Dùng MV.help()', 'color:#0a0');
    return;
  }
  const MV = (window.MV = { _installed: true, entries: [], sel: {}, failed: [], cfg: {
    concurrency: 3,      // số file tải song song
    retries: 3,          // số lần thử lại mỗi file
    zipEvery: 300,       // mỗi file zip chứa tối đa bấy nhiêu chứng từ (x2 file)
    delayMs: 0,          // nghỉ giữa các lần tải (tăng nếu server báo lỗi quá tải)
    pageSize: null,      // ép số dòng/trang khi lấy danh sách (null = giữ như trang đang dùng)
    paging: null,        // chỉ định tay tên tham số, vd {offset:'start', limit:'limit'} hoặc {page:'page', limit:'pageSize'}
    nameFn: null,        // hàm tự đặt tên: (row, index) => 'ten_file_khong_duoi'
    idFields: null,      // chỉ định tay tên trường làm khóa tải, vd ['inv_invoiceAuth_id']
  } });
  const C = MV.cfg;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isStatic = (u) => /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(u);

  // ---------------------------------------------------------------- ghi lại request của trang
  function sniff(bytes) {
    const s = String.fromCharCode(...bytes.slice(0, 6));
    if (s.startsWith('%PDF')) return 'pdf';
    if (s.startsWith('PK')) return 'zip';
    if (/^\s*<\?xml|^\s*</.test(s)) return 'xml';
    return null;
  }
  function kindOfText(t, ctype) {
    if (/pdf/i.test(ctype)) return 'pdf';
    if (/^\s*<\?xml|^\s*<[A-Za-z]/.test(t) && !/json/i.test(ctype)) return 'xml';
    if (/json/i.test(ctype) || /^\s*[\[{]/.test(t)) {
      if (/"(JVBERi0)/.test(t)) return 'pdf-b64';
      if (/"(PD94bWw)/.test(t)) return 'xml-b64';
      return 'json';
    }
    return 'text';
  }
  function push(e) {
    e.idx = MV.entries.length;
    e.time = Date.now();
    MV.entries.push(e);
  }
  function finishText(e, text, ctype, status) {
    e.status = status; e.ctype = ctype || '';
    e.kind = kindOfText(text, e.ctype);
    e.size = text.length;
    if (text.length < 8e6) e.text = text;
  }

  const XO = XMLHttpRequest.prototype;
  const xOpen = XO.open, xSend = XO.send, xSet = XO.setRequestHeader;
  XO.open = function (m, u) {
    try { this._mv = { via: 'xhr', method: String(m).toUpperCase(), url: new URL(u, location.href).href, headers: {} }; } catch (_) {}
    return xOpen.apply(this, arguments);
  };
  XO.setRequestHeader = function (k, v) {
    if (this._mv) this._mv.headers[k] = v;
    return xSet.apply(this, arguments);
  };
  XO.send = function (b) {
    const e = this._mv;
    if (e && !isStatic(e.url)) {
      if (typeof b === 'string') e.body = b;
      else if (b instanceof FormData) { e.form = [...b.entries()].filter(([, v]) => typeof v === 'string'); }
      else if (b instanceof URLSearchParams) e.body = b.toString();
      this.addEventListener('loadend', () => {
        try {
          const ctype = this.getResponseHeader('content-type') || '';
          const rt = this.responseType;
          if (rt === '' || rt === 'text') finishText(e, this.responseText || '', ctype, this.status);
          else if (rt === 'json') finishText(e, JSON.stringify(this.response), ctype || 'application/json', this.status);
          else {
            const blob = rt === 'blob' ? this.response : new Blob([this.response]);
            e.status = this.status; e.ctype = ctype; e.size = blob.size;
            blob.slice(0, 6).arrayBuffer().then((ab) => { e.kind = sniff(new Uint8Array(ab)) || (/pdf/i.test(ctype) ? 'pdf' : 'bin'); });
          }
        } catch (_) {}
        push(e);
      });
    }
    return xSend.apply(this, arguments);
  };

  const oFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = oFetch.apply(this, arguments);
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
      if (!isStatic(url)) {
        const e = { via: 'fetch', url, method: ((init && init.method) || (input && input.method) || 'GET').toUpperCase(), headers: {} };
        const h = (init && init.headers) || (input && input.headers);
        if (h) (h instanceof Headers ? [...h.entries()] : Object.entries(h)).forEach(([k, v]) => (e.headers[k] = v));
        if (init && typeof init.body === 'string') e.body = init.body;
        p.then((r) => r.clone().blob().then(async (blob) => {
          const ctype = r.headers.get('content-type') || '';
          if (/json|xml|text|html/i.test(ctype) && blob.size < 8e6) finishText(e, await blob.text(), ctype, r.status);
          else {
            e.status = r.status; e.ctype = ctype; e.size = blob.size;
            e.kind = sniff(new Uint8Array(await blob.slice(0, 6).arrayBuffer())) || (/pdf/i.test(ctype) ? 'pdf' : 'bin');
          }
          push(e);
        })).catch(() => {});
      }
    } catch (_) {}
    return p;
  };

  // PDF thường mở bằng window.open / iframe / thẻ <a>: ghi lại URL (GET)
  const oOpen = window.open;
  window.open = function (u) {
    try { push({ via: 'open', method: 'GET', url: new URL(u, location.href).href, headers: {}, kind: 'url' }); } catch (_) {}
    return oOpen.apply(this, arguments);
  };
  try {
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true, get: d.get,
      set(v) { try { if (v && !/^(about|blob|data|javascript)/.test(v)) push({ via: 'iframe', method: 'GET', url: new URL(v, location.href).href, headers: {}, kind: 'url' }); } catch (_) {} return d.set.call(this, v); },
    });
  } catch (_) {}

  // ---------------------------------------------------------------- tiện ích JSON
  const jparse = (t) => { try { return JSON.parse(t); } catch (_) { return null; } };
  function findRows(o, depth = 0) {            // mảng object lớn nhất trong JSON
    let best = null;
    (function walk(x, d) {
      if (d > 6 || x == null) return;
      if (Array.isArray(x)) {
        if (x.length && typeof x[0] === 'object' && x[0] && !Array.isArray(x[0]) && (!best || x.length > best.arr.length)) best = { arr: x };
        x.slice(0, 3).forEach((v) => walk(v, d + 1));
      } else if (typeof x === 'object') Object.values(x).forEach((v) => walk(v, d + 1));
    })(o, depth);
    return best ? best.arr : null;
  }
  function findB64(o, prefix) {
    let r = null;
    (function walk(x) {
      if (r || x == null) return;
      if (typeof x === 'string') { if (x.startsWith(prefix)) r = x; }
      else if (typeof x === 'object') Object.values(x).forEach(walk);
    })(o);
    return r;
  }
  const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  function findKey(obj, re) {                  // tìm key (đệ quy) khớp regex, trả {parent,key}
    let r = null;
    (function walk(x) {
      if (r || x == null || typeof x !== 'object') return;
      for (const k of Object.keys(x)) {
        if (re.test(k) && (typeof x[k] === 'number' || /^\d+$/.test(String(x[k])))) { r = { parent: x, key: k }; return; }
      }
      Object.values(x).forEach(walk);
    })(obj);
    return r;
  }

  // ---------------------------------------------------------------- liệt kê / chọn request
  MV.show = () => {
    const rows = MV.entries.map((e) => {
      const j = e.kind === 'json' ? jparse(e.text) : null;
      const rr = j ? findRows(j) : null;
      return { '#': e.idx, method: e.method, kind: e.kind || '?', status: e.status || '', size: e.size || '', 'số dòng': rr ? rr.length : '', url: e.url.replace(location.origin, '').slice(0, 90) };
    });
    console.table(rows);
  };
  MV.use = (role, idx) => { MV.sel[role] = MV.entries[idx]; console.log(`[MV] ${role} = #${idx}`, MV.sel[role].url); };
  MV.clear = () => { MV.entries.length = 0; MV.sel = {}; console.log('[MV] Đã xóa danh sách request đã ghi.'); };

  function autoPick() {
    const E = MV.entries;
    const last = (f) => { for (let i = E.length - 1; i >= 0; i--) if (f(E[i])) return E[i]; return null; };
    if (!MV.sel.list) {
      MV.sel.list = last((e) => { const j = e.kind === 'json' && jparse(e.text); const r = j && findRows(j); return r && r.length >= 2; })
        || last((e) => { const j = e.kind === 'json' && jparse(e.text); return j && findRows(j); });
    }
    if (!MV.sel.pdf) MV.sel.pdf = last((e) => e.kind === 'pdf' || e.kind === 'pdf-b64');
    if (!MV.sel.xml) MV.sel.xml = last((e) => e.kind === 'xml' || e.kind === 'xml-b64');
  }

  // ---------------------------------------------------------------- mẫu request (template)
  function candidates(row) {
    return Object.entries(row).filter(([, v]) => (typeof v === 'string' || typeof v === 'number') && String(v).length >= 3).map(([k, v]) => [k, String(v)]);
  }
  function buildTemplate(e, rows) {
    // tìm dòng + trường của danh sách xuất hiện trong URL/body của request tải
    const hay = (e.url || '') + '\n' + (e.body || '') + '\n' + JSON.stringify(e.form || []);
    const dec = (() => { try { return decodeURIComponent(hay); } catch (_) { return hay; } })();
    let best = null;
    for (const row of rows) {
      let c = candidates(row).filter(([k, v]) => hay.includes(v) || dec.includes(v) || hay.includes(encodeURIComponent(v)));
      if (C.idFields) c = c.filter(([k]) => C.idFields.includes(k));
      if (!c.length) continue;
      c.sort((a, b) => (/id$/i.test(b[0]) - /id$/i.test(a[0])) || b[1].length - a[1].length);
      best = { row, fields: c }; break;
    }
    if (!best) return null;
    const used = best.fields.filter(([k, v], i) => i === 0 || (/id$/i.test(k) && v.length >= 8));
    const sub = (s) => {
      if (s == null) return s;
      for (const [k, v] of used) {
        s = s.split(encodeURIComponent(v)).join(`{{${k}}}`).split(v).join(`{{${k}}}`);
      }
      return s;
    };
    return { method: e.method, url: sub(e.url), body: sub(e.body), form: e.form && e.form.map(([k, v]) => [k, sub(v)]), headers: e.headers, fields: used.map(([k]) => k), sampleRow: best.row };
  }
  function render(t, row) {
    const fill = (s, mode) => s == null ? s : s.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
      const v = row[k] == null ? '' : String(row[k]);
      return mode === 'json' ? JSON.stringify(v).slice(1, -1) : mode === 'raw' ? v : encodeURIComponent(v);
    });
    const jsonBody = t.body && /^\s*[\[{]/.test(t.body);
    return { method: t.method, url: fill(t.url, 'url'), headers: t.headers,
      body: t.body != null ? fill(t.body, jsonBody ? 'json' : (/=/.test(t.body) && !jsonBody ? 'url' : 'raw')) : undefined,
      form: t.form && t.form.map(([k, v]) => [k, fill(v, 'raw')]) };
  }
  async function send(req) {
    const init = { method: req.method, credentials: 'include', headers: {} };
    for (const [k, v] of Object.entries(req.headers || {})) if (!/^(content-length|host|cookie)$/i.test(k)) init.headers[k] = v;
    if (req.form) { const fd = new FormData(); req.form.forEach(([k, v]) => fd.append(k, v)); init.body = fd; }
    else if (req.body != null && req.method !== 'GET') init.body = req.body;
    const r = await oFetch(req.url, init);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  }

  // ---------------------------------------------------------------- lấy toàn bộ danh sách (lật trang)
  function parseListReq(e) {
    const u = new URL(e.url);
    let mode, obj;
    if (e.form) { mode = 'form'; obj = Object.fromEntries(e.form); }
    else if (e.body && /^\s*[\[{]/.test(e.body)) { mode = 'json'; obj = jparse(e.body); }
    else if (e.body) { mode = 'urlenc'; obj = Object.fromEntries(new URLSearchParams(e.body)); }
    else { mode = 'query'; obj = Object.fromEntries(u.searchParams); }
    return { u, mode, obj };
  }
  function buildListReq(e, p) {
    const req = { method: e.method, headers: e.headers, url: p.u.href };
    if (p.mode === 'query') { const u = new URL(p.u.href); Object.entries(p.obj).forEach(([k, v]) => u.searchParams.set(k, v)); req.url = u.href; }
    else if (p.mode === 'json') req.body = JSON.stringify(p.obj);
    else if (p.mode === 'urlenc') req.body = new URLSearchParams(p.obj).toString();
    else if (p.mode === 'form') req.form = Object.entries(p.obj);
    return req;
  }
  async function fetchAllRows(e, replaceKyHieu) {
    const base = parseListReq(e);
    let src = JSON.parse(JSON.stringify(base.obj));
    if (replaceKyHieu) {
      const [from, to] = replaceKyHieu;
      src = JSON.parse(JSON.stringify(src).split(from).join(to));
      if (base.u.href.includes(from)) base.u = new URL(base.u.href.split(from).join(to));
    }
    const p = { u: base.u, mode: base.mode, obj: src };
    // xác định tham số phân trang
    let off, lim, pg;
    if (C.paging) {
      const find = (n) => n && findKey(p.obj, new RegExp('^' + n + '$'));
      off = find(C.paging.offset); lim = find(C.paging.limit); pg = find(C.paging.page);
    } else {
      off = findKey(p.obj, /^(start|skip|offset)$/i);
      lim = findKey(p.obj, /^(limit|take|pagesize|page_size|rows|pagelength|size)$/i);
      pg = findKey(p.obj, /^(page|pageindex|pagenumber|currentpage|pageno)$/i);
    }
    if (C.pageSize && lim) lim.parent[lim.key] = C.pageSize;
    const limit = lim ? Number(lim.parent[lim.key]) : 0;
    const page0 = pg ? Number(pg.parent[pg.key]) : 0;   // trang đầu là 0 hay 1?
    const firstPage = pg && (e._firstPage != null ? e._firstPage : (page0 <= 1 ? page0 : 1));
    if (!off && !pg) console.warn('[MV] Không thấy tham số phân trang trong request danh sách -> chỉ lấy được các dòng của 1 request. Nếu còn nhiều trang hơn, xem README mục "Phân trang" (MV.cfg.paging).');
    else console.log('[MV] Phân trang:', off ? `offset=${off.key}` : '', pg ? `page=${pg.key}` : '', lim ? `limit=${lim.key}(${limit})` : '(không thấy limit)');

    const all = [], seen = new Set();
    for (let i = 0; i < 2000; i++) {
      if (off) { const v = limit ? i * limit : all.length; off.parent[off.key] = typeof off.parent[off.key] === 'string' ? String(v) : v; }
      if (pg) pg.parent[pg.key] = firstPage + i;
      const r = await send(buildListReq(e, p));
      const j = jparse(await r.text());
      const rows = (j && findRows(j)) || [];
      let added = 0;
      for (const row of rows) { const k = JSON.stringify(row); if (!seen.has(k)) { seen.add(k); all.push(row); added++; } }
      console.log(`[MV] Trang ${i + 1}: ${rows.length} dòng (mới ${added}), tổng ${all.length}`);
      setStatus(`Đang lấy danh sách… ${all.length} chứng từ`);
      if (!added || (!off && !pg)) break;
      if (C.delayMs) await sleep(C.delayMs);
    }
    return all;
  }

  // ---------------------------------------------------------------- ZIP (không nén, không cần thư viện)
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const n = new Date();
    const dt = ((n.getFullYear() - 1980) << 9) | ((n.getMonth() + 1) << 5) | n.getDate();
    const tm = (n.getHours() << 11) | (n.getMinutes() << 5) | (n.getSeconds() >> 1);
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
      parts.push(lh.buffer, nm, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      central.push(ch.buffer, nm);
      off += 30 + nm.length + sz;
    }
    const cd = central.reduce((a, b) => a + b.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cd, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ---------------------------------------------------------------- hộp trạng thái
  let box;
  function setStatus(t) {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#1a3c7a;color:#fff;padding:10px 14px;border-radius:8px;font:13px/1.4 sans-serif;max-width:360px;box-shadow:0 2px 10px #0006';
      document.body.appendChild(box);
    }
    box.textContent = '[MV] ' + t;
  }

  // ---------------------------------------------------------------- tải 1 file
  async function fetchFile(tpl, row, want) {            // want: 'pdf' | 'xml'
    const r = await send(render(tpl, row));
    const ctype = r.headers.get('content-type') || '';
    let bytes = new Uint8Array(await r.arrayBuffer());
    let kind = sniff(bytes);
    if (!kind || (kind === 'xml' && /json/i.test(ctype))) {
      const t = new TextDecoder().decode(bytes);
      const j = jparse(t);
      if (j) {
        const b = findB64(j, 'JVBERi0') || findB64(j, 'PD94bWw');
        if (b) { bytes = b64ToBytes(b); kind = sniff(bytes); }
      }
    }
    if (!kind) throw new Error('Phản hồi không phải PDF/XML: ' + new TextDecoder().decode(bytes.slice(0, 120)));
    if (want === 'pdf' && kind !== 'pdf') throw new Error('Mong đợi PDF nhưng nhận ' + kind);
    return { bytes, ext: kind === 'zip' ? 'zip' : kind };
  }
  async function withRetry(fn) {
    let err;
    for (let i = 0; i < C.retries; i++) {
      try { return await fn(); } catch (e) { err = e; await sleep(800 * (i + 1)); }
    }
    throw err;
  }

  const clean = (s) => String(s).replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  function nameOf(row, i, tpl) {
    if (C.nameFn) return clean(C.nameFn(row, i));
    const key = (re) => Object.keys(row).find((k) => re.test(k) && row[k] != null && row[k] !== '');
    const kh = key(/kyhieu|ky_hieu|serial|symbol/i), so = key(/so_?ct|sochungtu|so_?chung|invoicenumber|invoice_number|soct|^so$/i);
    const idk = tpl.fields[0];
    const parts = [];
    if (kh) parts.push(String(row[kh]).replace(/\//g, '-'));
    if (so) parts.push(String(row[so]));
    if (!parts.length || (!so)) parts.push(String(row[idk]).slice(0, 36));
    return clean(parts.join('_')) || ('chungtu_' + (i + 1));
  }

  // ---------------------------------------------------------------- chạy chính
  MV.analyze = () => {
    autoPick();
    const s = MV.sel;
    console.log('[MV] list =', s.list && s.list.url, '| pdf =', s.pdf && s.pdf.url, '| xml =', s.xml && s.xml.url);
    return s;
  };

  MV.run = async (opts = {}) => {
    const only = opts.only || ['pdf', 'xml'];
    autoPick();
    const s = MV.sel;
    if (!s.list) return console.error('[MV] Chưa ghi được request danh sách. Bấm "Tải dữ liệu" trên trang rồi chạy lại (xem MV.show()).');
    const wants = only.filter((w) => s[w]);
    const missing = only.filter((w) => !s[w]);
    if (!wants.length) return console.error('[MV] Chưa ghi được request tải PDF/XML. Làm thủ công 1 lần với 1 chứng từ rồi chạy lại. Xem MV.show().');
    if (missing.length) console.warn('[MV] Chưa ghi được request cho:', missing.join(', '), '(sẽ bỏ qua)');

    // danh sách ký hiệu cần chạy
    let kyList = [null];
    if (opts.kyHieu) {
      const text = decodeURIComponent((s.list.url || '') + (s.list.body || '') + JSON.stringify(s.list.form || ''));
      const base = opts.base || opts.kyHieu.find((k) => text.includes(k))
        || (text.match(/[A-Z0-9]{1,4}\/\d{2,4}\/[A-Z0-9]{1,2}|[A-Z0-9]{1,4}\/\d{2,4}[A-Z]/) || [])[0];
      if (!base) return console.error('[MV] Không tự nhận ra ký hiệu hiện tại trong request. Truyền thêm base: MV.run({kyHieu:[...], base:"AA/2023/E"})');
      kyList = opts.kyHieu.map((k) => [base, k, k]);
      console.log('[MV] Ký hiệu gốc trong request:', base);
    }

    const tStart = Date.now();
    const report = [];
    for (const ky of kyList) {
      const label = ky ? ky[2].replace(/\//g, '-') : (opts.label || 'chungtu');
      console.log(`%c[MV] ===== ${ky ? 'Ký hiệu ' + ky[2] : 'Danh sách hiện tại'} =====`, 'font-weight:bold');
      let rows;
      try { rows = await fetchAllRows(s.list, ky && [ky[0], ky[1]]); } catch (e) { console.error('[MV] Lỗi lấy danh sách:', e); continue; }
      if (opts.limit) rows = rows.slice(0, opts.limit);
      if (!rows.length) { console.warn('[MV] Danh sách rỗng.'); continue; }
      console.log('[MV] Mẫu 1 dòng dữ liệu (để kiểm tra tên trường):', rows[0]);

      const sampleRows = findRows(jparse(s.list.text) || {}) || [];   // dòng mẫu gốc: id của PDF/XML đã ghi nằm trong danh sách gốc
      const tpls = {};
      for (const w of wants) {
        tpls[w] = buildTemplate(s[w], sampleRows.concat(rows));
        if (!tpls[w]) return console.error(`[MV] Không tìm thấy mã chứng từ nào của danh sách trong request ${w.toUpperCase()}. Có thể bạn đã tải ${w.toUpperCase()} của chứng từ không nằm trong danh sách hiện tại. Bấm "Tải dữ liệu", rồi tải ${w.toUpperCase()} 1 chứng từ trong danh sách đó và chạy lại. Hoặc đặt MV.cfg.idFields.`);
        console.log(`[MV] Mẫu ${w}:`, tpls[w].method, tpls[w].url, tpls[w].body || '', '← trường:', tpls[w].fields.join(','));
      }

      const names = new Map();
      const items = rows.map((row, i) => {
        let n = nameOf(row, i, tpls[wants[0]]);
        const c = names.get(n) || 0; names.set(n, c + 1);
        if (c) n += '_' + (c + 1);
        return { row, i, name: n };
      });
      let done = 0, part = 1, buf = [], failed = [];
      const flush = (final) => {
        if (!buf.length) return;
        const partName = `minvoice_${label}${final && part === 1 ? '' : '_phan' + part}.zip`;
        saveBlob(makeZip(buf), partName);
        console.log('[MV] Đã lưu', partName, `(${buf.length} file)`);
        buf = []; part++;
      };
      let cursor = 0, inBuf = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const it = items[cursor++];
          try {
            for (const w of wants) {
              const f = await withRetry(() => fetchFile(tpls[w], it.row, w));
              buf.push({ name: `${label}/${w.toUpperCase()}/${it.name}.${f.ext}`, data: f.bytes });
            }
            inBuf++;
          } catch (e) {
            failed.push({ name: it.name, row: it.row, error: String(e.message || e) });
            console.warn('[MV] Lỗi', it.name, e.message || e);
          }
          done++;
          setStatus(`${label}: ${done}/${items.length} (lỗi ${failed.length})`);
          if (inBuf >= C.zipEvery) { inBuf = 0; flush(false); }
          if (C.delayMs) await sleep(C.delayMs);
        }
      };
      await Promise.all(Array.from({ length: C.concurrency }, worker));
      flush(true);
      if (failed.length) saveBlob(new Blob([failed.map((f) => `${f.name}\t${f.error}`).join('\n')], { type: 'text/plain' }), `minvoice_${label}_LOI.txt`);
      MV.failed.push(...failed);
      report.push({ 'ký hiệu': label, 'tổng': items.length, 'thành công': items.length - failed.length, 'lỗi': failed.length });
    }
    setStatus(`Xong sau ${Math.round((Date.now() - tStart) / 1000)}s`);
    console.table(report);
    return report;
  };

  MV.help = () => console.log(`
[MV] Các bước:
 1) (đã làm) Dán script này. 2) Chọn ký hiệu, bấm "Tải dữ liệu".
 3) Với 1 chứng từ trong danh sách: tải/xem PDF và tải XML như bình thường (chỉ cần 1 lần).
 4) MV.show()    → xem các request đã ghi (kiểm tra có list/pdf/xml)
    MV.analyze() → xem script tự chọn request nào
    MV.use('list'|'pdf'|'xml', số#) → chọn tay nếu tự chọn sai
 5) MV.run({limit:3})   → chạy thử 3 chứng từ
    MV.run()            → tải toàn bộ ký hiệu đang chọn
    MV.run({kyHieu:['AA/2023/E','AA/2022/E']}) → lần lượt nhiều ký hiệu
    MV.run({only:['xml']}) / MV.run({only:['pdf']})
 Tùy chỉnh: MV.cfg (concurrency, delayMs, pageSize, paging, nameFn, idFields)`);

  setStatus('Đã sẵn sàng. Bấm "Tải dữ liệu", rồi tải thử 1 PDF + 1 XML. Sau đó chạy MV.run()');
  console.log('%c[MV] Đã cài. Gõ MV.help() để xem hướng dẫn.', 'color:#0a0;font-weight:bold');
})();
