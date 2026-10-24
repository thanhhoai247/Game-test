import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, extractList } from '../src/unity-api.js';

function mockFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    const { status = 200, body, headers = {} } = await responder(url, init, calls.length);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
  };
  return { calls, fetchImpl };
}

const base = { keyId: 'key', secretKey: 'secret', orgId: '123', baseUrl: 'https://api.test/v1', retryBaseMs: 1 };

test('extractList accepts bare arrays and common envelopes', () => {
  assert.deepEqual(extractList([1]), [1]);
  assert.deepEqual(extractList({ data: [1], total: 1 }), [1]);
  assert.deepEqual(extractList({ creativePacks: [2] }, ['creativePacks']), [2]);
  assert.deepEqual(extractList({ whatever: [3], total: 1 }), [3]);
  assert.throws(() => extractList({ a: 1 }));
});

test('sends basic auth and walks every page', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
  const { calls, fetchImpl } = mockFetch((url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return { body: { data: items.slice(offset, offset + 2), total: items.length } };
  });
  const client = createClient({ ...base, fetchImpl, pageSize: 2 });
  const creatives = await client.listCreatives('app-1');
  assert.deepEqual(creatives.map((c) => c.id), ['c0', 'c1', 'c2', 'c3', 'c4']);
  assert.equal(calls[0].url, 'https://api.test/v1/organizations/123/applications/app-1/creatives?limit=2&offset=0');
  assert.equal(calls[0].headers.Authorization, 'Basic ' + Buffer.from('key:secret').toString('base64'));
});

test('stops paging when the endpoint ignores offset', async () => {
  const { calls, fetchImpl } = mockFetch(() => ({ body: [{ id: 'a' }, { id: 'b' }] }));
  const client = createClient({ ...base, fetchImpl, pageSize: 2 });
  assert.equal((await client.listCreativePacks('x')).length, 2);
  assert.equal(calls.length, 2);
});

test('retries 429 and GET 5xx, but never a failed POST', async () => {
  const { calls, fetchImpl } = mockFetch((url, init, n) => {
    if (init.method === 'POST') return { status: 500, body: { message: 'boom' } };
    return n === 1 ? { status: 429, headers: { 'retry-after': '0' } } : n === 2 ? { status: 503 } : { body: [{ id: 'app' }] };
  });
  const client = createClient({ ...base, fetchImpl });
  assert.deepEqual(await client.listApplications(), [{ id: 'app' }]);
  assert.equal(calls.length, 3);

  await assert.rejects(client.createCreativePack('app', { name: 'n', type: 'video', creativeIds: ['a'] }), (e) => {
    assert.equal(e.status, 500);
    assert.match(e.message, /boom/);
    return true;
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(calls[3].body), { name: 'n', type: 'video', creativeIds: ['a'] });
});
