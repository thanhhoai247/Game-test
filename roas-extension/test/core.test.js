// Chạy: node test/core.test.js
const assert = require('assert');
const C = require('../core.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('parseNum', () => {
  assert.strictEqual(C.parseNum('IDR43,371'), 43371);
  assert.strictEqual(C.parseNum('1.234,5', ','), 1234.5);
  assert.strictEqual(C.parseNum('(12.5)'), -12.5);
  assert.strictEqual(C.parseNum('--'), null);
  assert.strictEqual(C.parseNum(7), 7);
});
t('detectDecimal', () => {
  assert.strictEqual(C.detectDecimal(['1,234.50', '12.3']), '.');
  assert.strictEqual(C.detectDecimal(['1.234,50', '12,3']), ',');
  assert.strictEqual(C.detectDecimal(['1.234.567', '2.345.678']), ',');
  assert.strictEqual(C.detectDecimal([12, 3]), '.');
});
t('currencyOf', () => {
  assert.strictEqual(C.currencyOf('IDR43,371'), 'IDR');
  assert.strictEqual(C.currencyOf('₫1.000'), 'VND');
  assert.strictEqual(C.currencyOf('$12.50'), 'USD');
});
t('CSV: tên camp có dấu phẩy trong ngoặc kép', () => {
  const csv = 'Campaign,Ad Revenue\r\n"13/10_SPL_009_TNT_Global_ROAS_70%_BS2_6,7,8,9,10",12.5\r\nSPL_009_X (123456789),3\r\nTotal,15.5\r\n';
  const rows = C.parseDelimited(csv);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[1][0], '13/10_SPL_009_TNT_Global_ROAS_70%_BS2_6,7,8,9,10');
  const g = C.guessColumns(rows[0]);
  assert.deepStrictEqual(g, { campaign: 0, revenue: 1 });
  const a = C.aggregateRevenue(rows.slice(1), 0, 1);
  assert.strictEqual(a.entries.length, 2);
  assert.strictEqual(a.skipped, 1);
});
t('TSV và dấu chấm phẩy', () => {
  assert.deepStrictEqual(C.parseDelimited('a\tb\n1\t2')[1], ['1', '2']);
  assert.deepStrictEqual(C.parseDelimited('a;b\n1,5;2')[1], ['1,5', '2']);
});
t('khớp ID + tên, cộng dồn, tỷ giá tự động, ROAS', () => {
  const scrape = {
    lang: 'en-GB',
    rows: [
      { name: 'Camp A', id: '111111', costText: 'IDR17,908', usdText: '1.00' },
      { name: '13/10_Camp B, x', id: null, costText: 'IDR35,816', usdText: '2.00' },
      { name: 'Camp C', id: null, costText: 'IDR0', usdText: '0.00' }
    ],
    summaries: [{ label: 'Total: Account', costText: 'IDR900,000', usdText: '50.00' }, { label: 'Total: Filtered campaigns', costText: 'IDR53,724', usdText: '3.00' }]
  };
  const built = C.buildCampaigns(scrape);
  assert.strictEqual(built.currency, 'IDR');
  assert.strictEqual(built.total, 53724);
  assert.strictEqual(C.autoRate(built), 17908);
  const entries = [
    { raw: 'Camp A (111111)', base: 'Camp A', id: '111111', revenue: 1, lines: 1 },
    { raw: 'camp a  (111111)', base: 'camp a', id: '111111', revenue: 0.5, lines: 1 },
    { raw: '13/10_Camp B, x', base: '13/10_Camp B, x', id: null, revenue: 3, lines: 2 },
    { raw: 'Ghost', base: 'Ghost', id: null, revenue: 9, lines: 1 }
  ];
  const r = C.compute(built, entries, { rate: 17908, revenueUnit: 'USD' });
  assert.strictEqual(r.rows[0].revenue, 1.5);
  assert.ok(Math.abs(r.rows[0].roas - 1.5) < 1e-9);
  assert.ok(Math.abs(r.rows[1].roas - 1.5) < 1e-9);
  assert.strictEqual(r.rows[2].roas, null);
  assert.strictEqual(r.unmatched.length, 1);
  assert.strictEqual(r.totals.unmatchedRevenue, 9);
  assert.strictEqual(r.costCheck.diffPct, 0);
});
t('revenueUnit COST quy đổi sang USD', () => {
  const built = C.buildCampaigns({ lang: 'en', rows: [{ name: 'A', id: null, costText: 'IDR17,908' }], summaries: [] });
  const r = C.compute(built, [{ raw: 'A', base: 'A', id: null, revenue: 35816, lines: 1 }], { rate: 17908, revenueUnit: 'COST' });
  assert.ok(Math.abs(r.rows[0].roas - 2) < 1e-9);
});
t('tên trùng nhau thì không khớp', () => {
  const built = C.buildCampaigns({ lang: 'en', rows: [{ name: 'A', id: null, costText: '$1.00' }, { name: 'A', id: null, costText: '$2.00' }], summaries: [] });
  const r = C.compute(built, [{ raw: 'A', base: 'A', id: null, revenue: 5, lines: 1 }], { rate: 1, revenueUnit: 'USD' });
  assert.strictEqual(r.unmatched.length, 1);
});

t('Adjust chỉ có campaign_id_network: khớp theo ID, lọc kênh/ngày', () => {
  const csv = 'day,channel,campaign_id_network,cohort_ad_revenue\n2026-10-13,Google Ads,111111111,2.5\n2026-10-13,TikTok for Business,222222222,1.5\n2026-10-12,Google Ads,111111111,9\n';
  const rows = C.parseDelimited(csv), h = rows[0], g = C.guessAdjustColumns(h);
  assert.deepStrictEqual(g, { campaign: 2, revenue: 3, day: 0, channel: 1 });
  const agg = C.aggregateRevenue(rows.slice(1), g.campaign, g.revenue, r => C.normDay(r[0]) === '2026-10-13' && /google/i.test(r[1]));
  assert.strictEqual(agg.entries.length, 1);
  const built = { campaigns: [{ name: 'X', id: '111111111', cost: 5, currency: 'USD' }, { name: 'Y', id: '333333333', cost: 5, currency: 'USD' }], currency: 'USD' };
  const r = C.compute(built, agg.entries, { rates: {}, revenueUnit: 'USD', revenueLoaded: true });
  assert.strictEqual(r.rows[0].roas, 0.5);
  assert.strictEqual(r.rows[1].roas, 0); // có ID nhưng không có revenue => 0%
});
t('roasClass: >=100 xanh, 85-99 vàng, <85 đỏ', () => {
  assert.strictEqual(C.roasClass(1), 'good'); assert.strictEqual(C.roasClass(0.9996), 'good');
  assert.strictEqual(C.roasClass(0.99), 'warn'); assert.strictEqual(C.roasClass(0.85), 'warn');
  assert.strictEqual(C.roasClass(0.849), 'bad'); assert.strictEqual(C.roasClass(null), 'na');
});
t('lọc theo mã app', () => {
  const terms = C.parseTerms('sgt_001, x', ['SPL_009']);
  assert.ok(C.matchTerms('13/10_SPL_009_TNT', terms)); assert.ok(C.matchTerms('SGT_001_a', terms)); assert.ok(!C.matchTerms('ABC', terms));
  assert.ok(C.matchTerms('anything', []));
});
t('nhiều tiền tệ: mỗi camp quy đổi theo tỷ giá riêng', () => {
  const m = C.mergeBuilt([{ campaigns: [{ name: 'A', id: '1', cost: 17908, currency: 'IDR' }], currency: 'IDR' }, { campaigns: [{ name: 'B', id: '2', cost: 10, currency: 'USD' }], currency: 'USD' }]);
  const r = C.compute(m, [], { rates: { IDR: 17908 }, revenueUnit: 'USD' });
  assert.strictEqual(r.totals.costUsd, 11);
});
t('TikTok: bảng ITG, nhận mệnh giá, ID trong ô tên', () => {
  const headers = ['Campaign', 'Status', 'Spend'];
  const cols = C.guessCostColumns(headers);
  const b = C.buildFromTable([['SGT_001 a\nID: 1878927480102258', 'On', 'Rp 1.234.500'], ['Total', '', 'Rp 1.234.500']], cols, null);
  assert.strictEqual(b.campaigns.length, 1); assert.strictEqual(b.currency, 'IDR');
  assert.strictEqual(b.campaigns[0].id, '1878927480102258'); assert.strictEqual(b.campaigns[0].cost, 1234500); assert.strictEqual(b.campaigns[0].name, 'SGT_001 a');
});
t('ngày trên Google Ads', () => {
  assert.deepStrictEqual(C.parseRangeDays('Today 13 Oct 2026'), ['2026-10-13']);
  assert.deepStrictEqual(C.parseRangeDays('1 Oct 2026 – 13 Oct 2026'), ['2026-10-01', '2026-10-13']);
  assert.strictEqual(C.parseRangeDays('Custom'), null);
});
t('Unity: cửa sổ 17h hôm qua -> 16h59 hôm nay', () => {
  const rows = [['2026-10-13T16:00:00Z', 'A', '5'], ['2026-10-13T17:00:00Z', 'A', '10'], ['2026-10-14 16:30', 'B', '7'], ['2026-10-14T17:00:00Z', 'A', '100'], ['14/10/2026 01:00', 'B', '3']];
  const w = C.unityWindow(rows, { dtIdx: 0, spendIdx: 2, groupIdx: 1, date: '2026-10-14', startHour: 17, shiftHours: 0 });
  assert.strictEqual(w.total, 20); assert.strictEqual(w.groups.get('B'), 10); assert.strictEqual(w.missing.length, 21);
  const w2 = C.unityWindow(rows, { dtIdx: 0, spendIdx: 2, groupIdx: -1, date: '2026-10-14', startHour: 17, shiftHours: 7 });
  assert.notStrictEqual(w2.total, 20);
});
console.log(`\n${n} test đạt`);
