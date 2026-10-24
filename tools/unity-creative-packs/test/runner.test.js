import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packSignature } from '../src/planner.js';
import { AUTO_LIMIT, NotConnectedError, autoRun, connect, createPacks, fetchAppData, planFromData } from '../src/runner.js';

const now = Date.now();
const token = (host, value) => ({ host, authorization: `Bearer ${value.padEnd(20, 'x')}`, capturedAt: now, exp: null });

// In-memory stand-in for the Unity API, keyed on the Authorization header.
function fakeUnity({ goodAuth, creatives = [], packs = [], failNames = [] }) {
  const posts = [];
  const fetchImpl = async (url, init) => {
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (init.headers.Authorization !== goodAuth) return reply(401, { message: 'invalid token' });
    const path = new URL(url).pathname;
    if (path.endsWith('/applications')) return reply(200, [{ id: 'app', name: 'Grow Island' }]);
    if (path.endsWith('/creatives')) return reply(200, { results: creatives });
    if (path.endsWith('/creative-packs') && init.method === 'GET') return reply(200, { creativePacks: packs });
    const body = JSON.parse(init.body);
    if (failNames.includes(body.name)) return reply(400, { message: 'bad pack' });
    const pack = { id: `cp${packs.length + 1}`, ...body };
    posts.push(pack);
    packs.push(pack);
    return reply(201, pack);
  };
  return { fetchImpl, posts, packs };
}

const creatives = [
  { id: 'v1', name: 'Hook01_9x16.mp4', type: 'video' },
  { id: 'v2', name: 'Hook02_9x16.mp4', type: 'video' },
  { id: 'e1', name: 'Main_EC.png', type: 'endcard' },
];

test('connect needs a captured token and skips rejected ones', async () => {
  await assert.rejects(connect({ orgId: '1', tokens: {} }), (e) => e instanceof NotConnectedError && e.code === 'no-token');

  const good = token('cloud.unity.com', 'good');
  const unity = fakeUnity({ goodAuth: good.authorization });
  const tokens = { 'services.api.unity.com': token('services.api.unity.com', 'stale'), 'cloud.unity.com': good };
  const { apps, token: used } = await connect({ orgId: '1', tokens, fetchImpl: unity.fetchImpl });
  assert.equal(used.host, 'cloud.unity.com');
  assert.deepEqual(apps.map((a) => a.id), ['app']);

  await assert.rejects(
    connect({ orgId: '1', tokens: { a: token('a.unity.com', 'stale') }, fetchImpl: unity.fetchImpl }),
    (e) => e.code === 'rejected' && /401/.test(e.message),
  );
});

test('planFromData uses the only end card automatically and validates the filter', async () => {
  const good = token('cloud.unity.com', 'good');
  const ok = fakeUnity({ goodAuth: good.authorization, creatives });
  const connected = await connect({ orgId: '1', tokens: { c: good }, fetchImpl: ok.fetchImpl });
  const data = await fetchAppData(connected.client, 'app');
  const plan = planFromData(data, {});
  assert.equal(plan.defaultEndcardId, 'e1');
  assert.deepEqual(plan.packs.map((p) => [p.name, p.creativeIds]), [['Hook01_EC', ['v1', 'e1']], ['Hook02_EC', ['v2', 'e1']]]);
  assert.throws(() => planFromData(data, { filter: '(' }), /regex/);
});

test('createPacks re-checks existing packs and reports each result', async () => {
  const good = token('cloud.unity.com', 'good');
  const unity = fakeUnity({ goodAuth: good.authorization, creatives, failNames: ['Hook02_EC'] });
  const { client } = await connect({ orgId: '1', tokens: { c: good }, fetchImpl: unity.fetchImpl });
  const plan = planFromData(await fetchAppData(client, 'app'), {});
  // Another run created the first pack after this plan was made.
  unity.packs.push({ id: 'cpX', name: 'Other', creativeIds: ['e1', 'v1'] });
  const progress = [];
  const results = await createPacks(client, 'app', plan.packs, (r, done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(results.map((r) => r.status), ['exists', 'failed']);
  assert.match(results[1].error, /bad pack/);
  assert.deepEqual(progress, ['1/2', '2/2']);
  assert.equal(unity.posts.length, 0);
});

test('autoRun creates at most AUTO_LIMIT packs per run', async () => {
  const many = Array.from({ length: AUTO_LIMIT + 3 }, (_, i) => ({ id: `v${i}`, name: `Clip${i}_9x16.mp4`, type: 'video' }));
  const good = token('cloud.unity.com', 'good');
  const unity = fakeUnity({ goodAuth: good.authorization, creatives: [...many, { id: 'e1', name: 'EC.png', type: 'endcard' }] });
  const first = await autoRun({ orgId: '1', appId: 'app', tokens: { c: good }, settings: {}, fetchImpl: unity.fetchImpl });
  assert.equal(first.appName, 'Grow Island');
  assert.equal(first.created.length, AUTO_LIMIT);
  assert.equal(first.remaining, 3);
  const second = await autoRun({ orgId: '1', appId: 'app', tokens: { c: good }, settings: {}, fetchImpl: unity.fetchImpl });
  assert.equal(second.created.length, 3);
  assert.equal(second.remaining, 0);
  assert.equal(unity.posts.length, AUTO_LIMIT + 3);
});

test('packs the user unticked stay out of automatic runs', async () => {
  const good = token('cloud.unity.com', 'good');
  const unity = fakeUnity({ goodAuth: good.authorization, creatives });
  const { client } = await connect({ orgId: '1', tokens: { c: good }, fetchImpl: unity.fetchImpl });
  const plan = planFromData(await fetchAppData(client, 'app'), {});
  const excluded = [packSignature(plan.packs[0])];
  assert.deepEqual(planFromData(await fetchAppData(client, 'app'), { excluded }).packs.map((p) => p.excluded), [true, false]);
  const run = await autoRun({ orgId: '1', appId: 'app', tokens: { c: good }, settings: { excluded }, fetchImpl: unity.fetchImpl });
  assert.deepEqual(run.created, ['Hook02_EC']);
});
