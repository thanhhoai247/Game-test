// Steps shared by the side panel and the background auto-run.
import { usableTokens } from './auth.js';
import { DEFAULT_NAME_TEMPLATE, buildPlan, describeCreative, indexExistingPacks, packSignature } from './planner.js';
import { DEFAULT_BASE_URL, createClient } from './unity-api.js';

export const DEFAULT_SETTINGS = {
  types: ['video', 'playable'],
  endcardId: '',
  playableId: '',
  filter: '',
  nameTemplate: DEFAULT_NAME_TEMPLATE,
  auto: false,
  // Signatures of packs the user unticked; automatic runs leave them out too.
  excluded: [],
};

// Most packs one automatic run creates; the rest wait for the next run.
export const AUTO_LIMIT = 20;

export class NotConnectedError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Tries the captured dashboard tokens until the API accepts one.
export async function connect({ orgId, tokens, baseUrl = DEFAULT_BASE_URL, fetchImpl, retryBaseMs }) {
  const candidates = usableTokens(tokens);
  if (!candidates.length) {
    throw new NotConnectedError('Chưa bắt được phiên đăng nhập Unity. Mở hoặc tải lại (F5) trang cloud.unity.com; bảng này sẽ tự kết nối.', 'no-token');
  }
  const failures = [];
  for (const token of candidates) {
    const client = createClient({ authorization: token.authorization, orgId, baseUrl, fetchImpl, retryBaseMs });
    try {
      return { client, apps: await client.listApplications(), token };
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw e;
      failures.push(`token từ ${token.host}: ${e.message}`);
    }
  }
  throw new NotConnectedError(
    `Unity không nhận phiên đăng nhập cho API (${failures.join(' | ')}). ` +
      'Tài khoản cần quyền User Acquisition trong organization này; nếu đã có quyền, hãy gửi nội dung mục Chẩn đoán.',
    'rejected',
  );
}

export async function fetchAppData(client, appId) {
  const warnings = [];
  const [creatives, existingPacks] = await Promise.all([
    client.listCreatives(appId),
    client.listCreativePacks(appId).catch((e) => {
      warnings.push(`Không đọc được creative pack hiện có (${e.message}) — không lọc được pack trùng.`);
      return [];
    }),
  ]);
  return { creatives, existingPacks, infos: creatives.map(describeCreative), warnings };
}

export function planFromData(data, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const usable = data.infos.filter((i) => i.id && !i.badStatus);
  const has = (id) => Boolean(id) && usable.some((i) => i.id === id);
  let endcardId = has(s.endcardId) ? s.endcardId : null;
  const endcards = usable.filter((i) => i.kind === 'endcard');
  // An app with a single end card uses it for every video.
  if (!endcardId && endcards.length === 1) endcardId = endcards[0].id;
  let filter = null;
  if (s.filter) {
    try {
      filter = new RegExp(s.filter, 'i');
    } catch (e) {
      throw new Error(`Bộ lọc tên không phải regex hợp lệ: ${e.message}`);
    }
  }
  const plan = buildPlan({
    creatives: data.creatives,
    existingPacks: data.existingPacks,
    types: s.types,
    defaultEndcardId: endcardId,
    defaultPlayableId: has(s.playableId) ? s.playableId : null,
    filter,
    nameTemplate: s.nameTemplate || DEFAULT_NAME_TEMPLATE,
  });
  const excluded = new Set(s.excluded || []);
  const packs = plan.packs.map((p) => ({ ...p, excluded: excluded.has(packSignature(p)) }));
  return { ...plan, packs, defaultEndcardId: endcardId };
}

const withLock = (name, fn) => (globalThis.navigator?.locks ? navigator.locks.request(name, fn) : fn());

// Creates packs one at a time. The existing packs are re-read under a lock
// shared by the panel and the background, so two runs never create the same pack.
export function createPacks(client, appId, packs, onProgress = () => {}) {
  return withLock(`create-packs-${appId}`, async () => {
    let index = null;
    try {
      index = indexExistingPacks(await client.listCreativePacks(appId));
    } catch {
      // already reported as a warning when planning
    }
    const results = [];
    for (const pack of packs) {
      let result;
      if (index?.find(pack.creativeIds, pack.name)) {
        result = { pack, status: 'exists' };
      } else {
        try {
          const res = await client.createCreativePack(appId, pack);
          result = { pack, status: 'created', id: res?.id ?? res?.creativePackId ?? res?.data?.id };
        } catch (e) {
          result = { pack, status: 'failed', error: e.message };
        }
      }
      results.push(result);
      onProgress(result, results.length, packs.length);
    }
    return results;
  });
}

export async function autoRun({ orgId, appId, tokens, baseUrl, settings, fetchImpl }) {
  const { client, apps } = await connect({ orgId, tokens, baseUrl, fetchImpl });
  const data = await fetchAppData(client, appId);
  const wanted = planFromData(data, settings).packs.filter((p) => !p.excluded);
  const packs = wanted.slice(0, AUTO_LIMIT);
  const results = packs.length ? await createPacks(client, appId, packs) : [];
  const app = apps.find((a) => a.id === appId);
  return {
    appName: app?.name || appId,
    created: results.filter((r) => r.status === 'created').map((r) => r.pack.name),
    failed: results.filter((r) => r.status === 'failed').map((r) => ({ name: r.pack.name, error: r.error })),
    remaining: wanted.length - packs.length,
    warnings: data.warnings,
  };
}
