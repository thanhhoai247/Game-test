// Minimal client for the Unity Ads Unified Platform Advertiser API
// (the API behind cloud.unity.com → Acquire, where app IDs are UUIDs).
// Docs: https://docs.unity.com/en-us/oas-unified-platform-advertiser-public/1.0.0

export const DEFAULT_BASE_URL = 'https://services.api.unity.com/ads/advertiser/public/v1';

export class UnityApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'UnityApiError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The API wraps lists differently per endpoint (applications are a bare array,
// creatives and creative packs use different envelopes), so accept any of them.
export function extractList(data, preferredKeys = []) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of [...preferredKeys, 'data', 'items', 'results', 'content', 'list']) {
      if (Array.isArray(data[key])) return data[key];
    }
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  throw new Error(`Không đọc được danh sách từ phản hồi API: ${JSON.stringify(data).slice(0, 300)}`);
}

function totalOf(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') return null;
  for (const key of ['total', 'totalCount', 'count']) {
    if (Number.isFinite(data[key])) return data[key];
  }
  const meta = data.pagination || data.meta || data.page;
  if (meta && typeof meta === 'object') return totalOf(meta);
  return null;
}

function describeBody(body) {
  if (body == null || body === '') return '(không có nội dung)';
  if (typeof body === 'string') return body.slice(0, 500);
  return JSON.stringify(body).slice(0, 500);
}

export function createClient({
  keyId,
  secretKey,
  orgId,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  maxRetries = 5,
  retryBaseMs = 1000,
  pageSize = 100,
  log = () => {},
}) {
  if (!keyId || !secretKey) throw new Error('Thiếu UNITY_KEY_ID / UNITY_SECRET_KEY (service account).');
  if (!orgId) throw new Error('Thiếu organization ID (UNITY_ORG_ID hoặc --org).');

  const authorization = 'Basic ' + Buffer.from(`${keyId}:${secretKey}`).toString('base64');
  const orgUrl = `${baseUrl.replace(/\/+$/, '')}/organizations/${encodeURIComponent(orgId)}`;

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(orgUrl + path, {
        method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // keep raw text for the error message
      }
      if (res.ok) return data;

      // 429 means the request was not processed, so it is always safe to retry.
      // A 5xx on a write may still have been applied, so only GETs retry on 5xx;
      // a re-run of the tool skips packs that were in fact created.
      const retryable = res.status === 429 || (res.status >= 500 && method === 'GET');
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 60000)
          : Math.min(retryBaseMs * 2 ** attempt, 30000);
        log(`   … HTTP ${res.status}, thử lại sau ${(delay / 1000).toFixed(1)}s`);
        await sleep(delay);
        continue;
      }
      throw new UnityApiError(`${method} ${path} → HTTP ${res.status}: ${describeBody(data)}`, res.status, data);
    }
  }

  async function listAll(path, preferredKeys) {
    const all = [];
    const seen = new Set();
    for (let offset = 0; ; offset += pageSize) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await request('GET', `${path}${sep}limit=${pageSize}&offset=${offset}`);
      const page = extractList(data, preferredKeys);
      let added = 0;
      for (const item of page) {
        const id = item && item.id;
        if (id != null && seen.has(id)) continue;
        if (id != null) seen.add(id);
        all.push(item);
        added++;
      }
      const total = totalOf(data);
      // Stop on a short page, a reached total, or an endpoint that ignores offset.
      if (page.length < pageSize || added === 0 || (total != null && all.length >= total)) break;
    }
    return all;
  }

  const appPath = (appId) => `/applications/${encodeURIComponent(appId)}`;

  return {
    request,
    listApplications: async () => extractList(await request('GET', '/applications'), ['applications']),
    listCreatives: (appId) => listAll(`${appPath(appId)}/creatives`, ['creatives']),
    listCreativePacks: (appId) => listAll(`${appPath(appId)}/creative-packs`, ['creativePacks', 'creative_packs']),
    createCreativePack: (appId, { name, type, creativeIds }) =>
      request('POST', `${appPath(appId)}/creative-packs`, { name, type, creativeIds }),
  };
}
