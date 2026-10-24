// Helpers for the Unity dashboard session the extension borrows. No chrome.* here,
// so this file is unit-tested in Node.

const UNITY_HOST = /(^|\.)unity(3d)?\.com$/i;
const API_HOST = 'services.api.unity.com';
// Tokens without a readable expiry are trusted for this long after capture.
const OPAQUE_TOKEN_TTL_MS = 50 * 60 * 1000;

export const isUnityHost = (host) => UNITY_HOST.test(String(host || ''));

// The token is only ever sent to Unity, so a custom API base must be a Unity host.
export function isAllowedApiBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && isUnityHost(url.hostname);
  } catch {
    return false;
  }
}

// https://cloud.unity.com/organizations/<org>/acquire-v2/creative-library?app=<app>
export function parseDashboardUrl(value) {
  try {
    const url = new URL(value);
    if (!isUnityHost(url.hostname)) return {};
    const org = url.pathname.match(/\/organizations\/([^/?#]+)/);
    return { orgId: org ? decodeURIComponent(org[1]) : undefined, appId: url.searchParams.get('app') || undefined };
  } catch {
    return {};
  }
}

export function isBearer(authorization) {
  return /^bearer\s+\S{16,}/i.test(String(authorization || ''));
}

function base64UrlDecode(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
}

// Expiry (ms since epoch) of a JWT bearer token, or null if it is not a JWT.
export function jwtExpiry(authorization) {
  const token = String(authorization || '').replace(/^bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function tokenExpiresAt(token) {
  return token.exp ?? token.capturedAt + OPAQUE_TOKEN_TTL_MS;
}

// Usable tokens, best first: the one the dashboard sends to the API host itself,
// then the most recently seen. Identical header values are tried once.
export function usableTokens(tokens, now = Date.now()) {
  const seen = new Set();
  return Object.values(tokens || {})
    .filter((t) => t && isBearer(t.authorization) && tokenExpiresAt(t) > now + 30 * 1000)
    .sort((a, b) => (b.host === API_HOST) - (a.host === API_HOST) || b.capturedAt - a.capturedAt)
    .filter((t) => !seen.has(t.authorization) && seen.add(t.authorization));
}
