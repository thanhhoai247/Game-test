import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseName, buildPlan, classifyKind, findCreative, describeCreative, orientationOf, renderName } from '../src/planner.js';

const video = (id, name, extra = {}) => ({ id, name, type: 'video', ...extra });
const endcard = (id, name, extra = {}) => ({ id, name, type: 'endcard', ...extra });
const playable = (id, name, extra = {}) => ({ id, name, type: 'playable', ...extra });

test('classifyKind reads type fields, legacy keys and file extensions', () => {
  assert.equal(classifyKind({ type: 'VIDEO' }), 'video');
  assert.equal(classifyKind({ creativeType: 'square_end_card' }), 'endcard');
  assert.equal(classifyKind({ type: 'endCardPair' }), 'endcard');
  assert.equal(classifyKind({ type: 'image' }), 'endcard');
  assert.equal(classifyKind({ type: 'playable_responsive' }), 'playable');
  assert.equal(classifyKind({ type: 'banner' }), 'banner');
  assert.equal(classifyKind({ squareEndCard: { fileName: 'a.png' } }), 'endcard');
  assert.equal(classifyKind({ name: 'clip.MP4' }), 'video');
  assert.equal(classifyKind({ name: 'ec.png' }), 'endcard');
  assert.equal(classifyKind({ name: 'game.html' }), 'playable');
  assert.equal(classifyKind({ name: 'mystery' }), 'unknown');
});

test('orientationOf uses fields, dimensions, then name tokens', () => {
  assert.equal(orientationOf({ orientation: 'PORTRAIT' }), 'portrait');
  assert.equal(orientationOf({ aspectRatio: '16:9' }), 'landscape');
  assert.equal(orientationOf({ files: [{ width: 1080, height: 1920 }] }), 'portrait');
  assert.equal(orientationOf({ name: 'Hook01_9x16.mp4' }), 'portrait');
  assert.equal(orientationOf({ name: 'Hook01_16_9.mp4' }), 'landscape');
  assert.equal(orientationOf({ name: 'Hook01 1920x1080.mp4' }), 'landscape');
  assert.equal(orientationOf({ name: 'Hook01-vertical.mp4' }), 'portrait');
  assert.equal(orientationOf({ name: 'Hook01_P.mp4' }), 'portrait');
  assert.equal(orientationOf({ name: 'Hook01_L.mp4' }), 'landscape');
  assert.equal(orientationOf({ name: 'L.mp4' }), null);
  assert.equal(orientationOf({ name: 'Hook_01_02.mp4' }), null);
  assert.equal(orientationOf({ name: 'Playable', type: 'playable', subType: 'responsive' }), 'responsive');
});

test('baseName strips orientation and kind tokens so related creatives match', () => {
  const keys = ['Hook01_9x16.mp4', 'Hook01_16x9.mp4', 'Hook01_EC.png', 'hook01-end-card.jpg', 'Hook01_P.mp4']
    .map((n) => baseName(n).key);
  assert.deepEqual(new Set(keys), new Set(['hook01']));
  assert.equal(baseName('Hook01_9x16.mp4').display, 'Hook01');
  assert.equal(baseName('Hook_01_02_portrait.mp4').key, 'hook_01_02');
  assert.equal(baseName('EC.png').key, 'ec');
});

test('pairs portrait + landscape videos with the end card of the same name', () => {
  const plan = buildPlan({
    creatives: [
      video('v1', 'Hook01_9x16.mp4'),
      video('v2', 'Hook01_16x9.mp4'),
      endcard('e1', 'Hook01_EC.png'),
      endcard('e2', 'Other_EC.png'),
    ],
  });
  assert.equal(plan.packs.length, 1);
  assert.deepEqual(plan.packs[0], {
    ...plan.packs[0],
    name: 'Hook01_EC',
    type: 'video',
    creativeIds: ['v1', 'v2', 'e1'],
  });
  assert.deepEqual(plan.skipped, []);
});

test('uses the default end card when no end card shares the name, else skips', () => {
  const creatives = [video('v1', 'Hook02_9x16.mp4'), endcard('e1', 'Main_EC.png'), endcard('e2', 'Alt_EC.png')];
  const without = buildPlan({ creatives });
  assert.equal(without.packs.length, 0);
  assert.equal(without.skipped[0].code, 'no-endcard');

  const withDefault = buildPlan({ creatives, defaultEndcardId: 'e2' });
  assert.deepEqual(withDefault.packs.map((p) => p.creativeIds), [['v1', 'e2']]);
  assert.equal(withDefault.packs[0].companionHow, 'default');
});

test('splits groups that cannot be paired safely', () => {
  const plan = buildPlan({
    creatives: [
      video('v1', 'Hook03_9x16_a.mp4'),
      video('v2', 'Hook03_a_1080x1920.mp4'),
      video('v3', 'Hook04.mp4'),
      endcard('e1', 'Main.png'),
    ],
    defaultEndcardId: 'e1',
  });
  assert.deepEqual(plan.packs.map((p) => p.creativeIds), [['v1', 'e1'], ['v2', 'e1'], ['v3', 'e1']]);
  assert.deepEqual(plan.packs.map((p) => p.name), ['Hook03_9x16_a_EC', 'Hook03_a_1080x1920_EC', 'Hook04_EC']);
});

test('skips packs that already exist and keeps new names unique', () => {
  const plan = buildPlan({
    creatives: [video('v1', 'A_9x16.mp4'), video('v2', 'B_9x16.mp4'), endcard('e1', 'EC.png')],
    defaultEndcardId: 'e1',
    existingPacks: [
      { id: 'p1', name: 'Old A', creativeIds: ['e1', 'v1'] },
      { id: 'p2', name: 'B_EC', creatives: [{ id: 'other' }] },
    ],
  });
  assert.deepEqual(plan.existing.map((p) => p.name), ['Old A']);
  assert.deepEqual(plan.packs.map((p) => p.name), ['B_EC_2']);
});

test('recognises existing packs by name when they are listed without creatives', () => {
  const plan = buildPlan({
    creatives: [video('v1', 'A_9x16.mp4'), video('v2', 'B_9x16.mp4'), endcard('e1', 'EC.png')],
    defaultEndcardId: 'e1',
    existingPacks: [{ id: 'p1', name: 'A_EC' }],
  });
  assert.deepEqual(plan.existing.map((p) => p.name), ['A_EC']);
  assert.deepEqual(plan.packs.map((p) => p.name), ['B_EC']);
});

test('skips creatives with a rejected status, banners and unknown kinds', () => {
  const plan = buildPlan({
    creatives: [
      video('v1', 'A_9x16.mp4', { status: 'REJECTED' }),
      { id: 'b1', name: 'Banner', type: 'banner' },
      { id: 'u1', name: 'mystery' },
      endcard('e1', 'EC.png'),
    ],
    defaultEndcardId: 'e1',
  });
  assert.equal(plan.packs.length, 0);
  assert.deepEqual(plan.skipped.map((s) => s.name), ['A_9x16.mp4', 'Banner', 'mystery']);
});

test('builds playable and video+playable packs', () => {
  const creatives = [
    video('v1', 'Hook01_9x16.mp4'),
    playable('p1', 'Hook01_playable.html', { orientation: 'responsive' }),
    playable('p2', 'Level_portrait.html'),
    playable('p3', 'Level_landscape.html'),
  ];
  const plan = buildPlan({ creatives, types: ['playable', 'video+playable'] });
  assert.deepEqual(
    plan.packs.map((p) => [p.name, p.type, p.creativeIds]),
    [
      ['Hook01_VPL', 'video+playable', ['v1', 'p1']],
      ['Hook01_PL', 'playable', ['p1']],
      ['Level_PL', 'playable', ['p2', 'p3']],
    ],
  );
});

test('filter limits the videos and playables used, not the end cards', () => {
  const plan = buildPlan({
    creatives: [video('v1', 'New_9x16.mp4'), video('v2', 'Old_9x16.mp4'), endcard('e1', 'Main.png')],
    defaultEndcardId: 'e1',
    filter: /^new/i,
  });
  assert.deepEqual(plan.packs.map((p) => p.creativeIds), [['v1', 'e1']]);
});

test('renderName fills placeholders and tidies empty ones', () => {
  const pack = { base: 'Hook01', type: 'video', orient: '', endcard: { base: 'Main' } };
  assert.equal(renderName('{base}_{orient}_{tag}', pack), 'Hook01_EC');
  assert.equal(renderName('UA - {base} + {endcard}', pack), 'UA - Hook01 + Main');
});

test('findCreative matches by id, name and unique substring', () => {
  const infos = [endcard('e1', 'Main_EC.png'), endcard('e2', 'Main_EC_v2.png'), video('v1', 'Main.mp4')].map(describeCreative);
  assert.equal(findCreative(infos, 'e2', 'endcard').match.id, 'e2');
  assert.equal(findCreative(infos, 'main_ec', 'endcard').match.id, 'e1');
  assert.equal(findCreative(infos, 'v2', 'endcard').match.id, 'e2');
  assert.match(findCreative(infos, 'main', 'endcard').error, /khớp 2/);
  assert.match(findCreative(infos, 'nope', 'endcard').error, /không tìm thấy/);
});
