import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAppArg } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const ORG = '18967561323381';
const APP = '1a55837e-1467-4d2c-ac81-29d9f6c704e2';

// A tiny stand-in for the Unity Advertiser API.
const creatives = [
  { id: 'v1', name: 'Hook01_9x16.mp4', type: 'video' },
  { id: 'v2', name: 'Hook01_16x9.mp4', type: 'video' },
  { id: 'v3', name: 'Hook02_9x16.mp4', type: 'video' },
  { id: 'e1', name: 'Main_EC.png', type: 'endcard' },
  { id: 'p1', name: 'Puzzle_playable.html', type: 'playable' },
];
let packs;
let posts;
let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const prefix = `/v1/organizations/${ORG}`;
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Basic ' + Buffer.from('k:s').toString('base64')) return send(401, { message: 'bad auth' });
    if (req.method === 'GET' && url.pathname === `${prefix}/applications`) return send(200, [{ id: APP, name: 'Grow Island' }]);
    if (req.method === 'GET' && url.pathname === `${prefix}/applications/${APP}/creatives`) {
      const offset = Number(url.searchParams.get('offset'));
      return send(200, { results: creatives.slice(offset, offset + Number(url.searchParams.get('limit'))), total: creatives.length });
    }
    if (url.pathname === `${prefix}/applications/${APP}/creative-packs`) {
      if (req.method === 'GET') return send(200, { creativePacks: packs });
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const pack = { id: `cp${packs.length + 1}`, ...JSON.parse(body) };
        posts.push(pack);
        packs.push(pack);
        send(201, pack);
      });
      return;
    }
    send(404, { message: `no route ${req.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(() => server.close());

function run(args) {
  const env = { ...process.env, UNITY_KEY_ID: 'k', UNITY_SECRET_KEY: 's', UNITY_API_BASE: baseUrl, UNITY_ORG_ID: '', UNITY_APP_ID: '' };
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env, cwd: tmpdir() }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

const dashboardUrl = `https://cloud.unity.com/organizations/${ORG}/acquire-v2/creative-library?app=${APP}`;

test('parseAppArg reads org and app from a dashboard link', () => {
  assert.deepEqual(parseAppArg(dashboardUrl), { appId: APP, orgId: ORG });
  assert.deepEqual(parseAppArg(APP), { appId: APP });
});

test('creates packs from a dashboard link, then skips them on the next run', async () => {
  packs = [];
  posts = [];
  const first = await run(['--app', dashboardUrl, '--yes']);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /End card mặc định: Main_EC\.png/);
  assert.deepEqual(posts.map(({ name, type, creativeIds }) => ({ name, type, creativeIds })), [
    { name: 'Hook01_EC', type: 'video', creativeIds: ['v1', 'v2', 'e1'] },
    { name: 'Hook02_EC', type: 'video', creativeIds: ['v3', 'e1'] },
    { name: 'Puzzle_PL', type: 'playable', creativeIds: ['p1'] },
  ]);

  posts = [];
  const second = await run(['--app', dashboardUrl, '--yes']);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(posts.length, 0);
  assert.match(second.stdout, /Đã có sẵn, bỏ qua \(3\)/);
  assert.match(second.stdout, /Không có pack mới nào cần tạo/);
});

test('dry run and saved plans', async () => {
  packs = [];
  posts = [];
  const dry = await run(['--app', dashboardUrl, '--types', 'video+playable', '--playable', 'puzzle', '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /Kế hoạch: 2 pack mới/);
  assert.match(dry.stdout, /Hook01_VPL {2}\[video\+playable\]/);
  assert.equal(posts.length, 0);

  const planFile = join(mkdtempSync(join(tmpdir(), 'packs-')), 'plan.json');
  const saved = await run(['--app', dashboardUrl, '--types', 'video', '--save-plan', planFile]);
  assert.equal(saved.code, 0, saved.stderr);
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  assert.equal(plan.packs.length, 2);
  plan.packs = [{ ...plan.packs[0], name: 'Renamed by hand' }];
  writeFileSync(planFile, JSON.stringify(plan));

  const applied = await run(['--org', ORG, '--from-plan', planFile, '--yes']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.deepEqual(posts.map((p) => p.name), ['Renamed by hand']);
});

test('--dump prints only JSON on stdout', async () => {
  const dump = await run(['--app', dashboardUrl, '--dump']);
  assert.equal(dump.code, 0, dump.stderr);
  assert.deepEqual(JSON.parse(dump.stdout).map((c) => c.id), creatives.map((c) => c.id));
});

test('reports usage errors without calling the API for packs', async () => {
  packs = [];
  posts = [];
  const noApp = await run(['--org', ORG, '--yes']);
  assert.equal(noApp.code, 2);
  assert.match(noApp.stderr, /Thiếu --app/);

  const badType = await run(['--app', dashboardUrl, '--types', 'gif']);
  assert.equal(badType.code, 2);
  assert.match(badType.stderr, /Loại pack không hợp lệ/);

  const needsYes = await run(['--app', dashboardUrl]);
  assert.equal(needsYes.code, 2);
  assert.match(needsYes.stderr, /--yes/);
  assert.equal(posts.length, 0);
});
