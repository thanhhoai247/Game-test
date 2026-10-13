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
console.log(`\n${n} test đạt`);
