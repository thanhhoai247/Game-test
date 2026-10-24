import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedApiBase, jwtExpiry, parseDashboardUrl, usableTokens } from '../src/auth.js';

const jwt = (payload) => `Bearer h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test('parseDashboardUrl reads org and app from Unity links only', () => {
  assert.deepEqual(
    parseDashboardUrl('https://cloud.unity.com/organizations/18967561323381/acquire-v2/creative-library?app=1a55837e-1467-4d2c-ac81-29d9f6c704e2'),
    { orgId: '18967561323381', appId: '1a55837e-1467-4d2c-ac81-29d9f6c704e2' },
  );
  assert.deepEqual(parseDashboardUrl('https://cloud.unity.com/home'), { orgId: undefined, appId: undefined });
  assert.deepEqual(parseDashboardUrl('https://evil.example/organizations/1?app=2'), {});
  assert.deepEqual(parseDashboardUrl(undefined), {});
});

test('isAllowedApiBase only accepts https Unity hosts', () => {
  assert.equal(isAllowedApiBase('https://services.api.unity.com/ads/advertiser/public/v1'), true);
  assert.equal(isAllowedApiBase('http://services.api.unity.com/x'), false);
  assert.equal(isAllowedApiBase('https://unity.com.evil.example/x'), false);
  assert.equal(isAllowedApiBase('not a url'), false);
});

test('jwtExpiry decodes exp from bearer JWTs', () => {
  assert.equal(jwtExpiry(jwt({ exp: 1700000000 })), 1700000000000);
  assert.equal(jwtExpiry('Bearer opaque-token-value'), null);
  assert.equal(jwtExpiry(jwt({ sub: 'x' })), null);
});

test('usableTokens drops expired ones and prefers the API host, then the newest', () => {
  const now = 1_000_000_000_000;
  const tokens = {
    'cloud.unity.com': { host: 'cloud.unity.com', authorization: 'Bearer aaaaaaaaaaaaaaaaaaaa', capturedAt: now - 1000, exp: null },
    'services.api.unity.com': { host: 'services.api.unity.com', authorization: 'Bearer bbbbbbbbbbbbbbbbbbbb', capturedAt: now - 5000, exp: now + 3600e3 },
    'old.unity.com': { host: 'old.unity.com', authorization: 'Bearer cccccccccccccccccccc', capturedAt: now - 2 * 3600e3, exp: null },
    'expired.unity.com': { host: 'expired.unity.com', authorization: 'Bearer dddddddddddddddddddd', capturedAt: now, exp: now - 1 },
    'dupe.unity.com': { host: 'dupe.unity.com', authorization: 'Bearer aaaaaaaaaaaaaaaaaaaa', capturedAt: now - 2000, exp: null },
    'basic.unity.com': { host: 'basic.unity.com', authorization: 'Basic eHh4', capturedAt: now, exp: null },
  };
  assert.deepEqual(usableTokens(tokens, now).map((t) => t.host), ['services.api.unity.com', 'cloud.unity.com']);
  assert.deepEqual(usableTokens(undefined, now), []);
});
