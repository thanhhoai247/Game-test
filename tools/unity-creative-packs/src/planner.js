// Turns the creatives uploaded for an app into the creative packs to create.
//
// Pack rules (Unity Advertiser API, "Create a creative pack"):
//   video           1–2 videos + exactly 1 end card
//   playable        1–2 playables
//   video+playable  1–2 videos + exactly 1 responsive playable
// When a pack holds 2 videos or 2 playables, one must be portrait and one landscape.
//
// Creatives are matched by name: "Hook01_9x16.mp4", "Hook01_16x9.mp4" and
// "Hook01_EC.png" share the base "Hook01", so they become one video pack.

export const PACK_TYPES = ['video', 'playable', 'video+playable'];
export const DEFAULT_NAME_TEMPLATE = '{base}_{tag}';
const TAGS = { video: 'EC', playable: 'PL', 'video+playable': 'VPL' };

const str = (v) => (typeof v === 'string' ? v : '');
const FILE_EXT = /\.(mp4|mov|m4v|webm|png|jpe?g|webp|gif|html?|zip)$/i;

export const creativeName = (c) => str(c.name) || str(c.fileName) || str(c.title) || String(c.id ?? '');
export const stripExt = (name) => name.replace(FILE_EXT, '');

// ---------- creative kind ----------

const KIND_FIELDS = ['type', 'creativeType', 'kind', 'format', 'assetType', 'mediaType', 'category'];

function kindFromText(text) {
  const t = text.toLowerCase();
  if (!t) return null;
  if (t.includes('banner')) return 'banner';
  if (/playable|mraid|html/.test(t)) return 'playable';
  if (/end.?card|image|square|pair/.test(t)) return 'endcard';
  if (t.includes('video')) return 'video';
  return null;
}

export function classifyKind(c) {
  for (const field of KIND_FIELDS) {
    const kind = kindFromText(str(c[field]));
    if (kind) return kind;
  }
  // Legacy-style creatives carry the asset under a key named after its type,
  // e.g. { video: {...} } or { squareEndCard: {...} }.
  for (const [key, value] of Object.entries(c)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const kind = kindFromText(key);
      if (kind) return kind;
    }
  }
  const ext = (creativeName(c).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'endcard';
  if (['html', 'htm', 'zip'].includes(ext)) return 'playable';
  return 'unknown';
}

// ---------- orientation ----------

function orientationFromRatio(w, h) {
  if (!(w > 0 && h > 0)) return null;
  if (h > w) return 'portrait';
  if (w > h) return 'landscape';
  return 'responsive';
}

function orientationFromText(text) {
  const t = text.toLowerCase();
  if (/portrait|vertical/.test(t)) return 'portrait';
  if (/landscape|horizontal/.test(t)) return 'landscape';
  if (/\b(responsive|square|both)\b/.test(t)) return 'responsive';
  const ratio = t.match(/^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/);
  return ratio ? orientationFromRatio(Number(ratio[1]), Number(ratio[2])) : null;
}

function findDimensions(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  const w = Number(obj.width);
  const h = Number(obj.height);
  if (w > 0 && h > 0) return { w, h };
  for (const value of Object.values(obj)) {
    const found = findDimensions(value, depth + 1);
    if (found) return found;
  }
  return null;
}

// Splits a name into tokens, merging "9_16", "9-16", "1080 x 1920" into
// "9x16" / "1080x1920". Plain number runs like "Hook_01_02" are left alone.
function tokenize(name) {
  const raw = stripExt(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const isNum = (t) => /^\d+$/.test(t ?? '');
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    const [a, mid, b] = [raw[i], raw[i + 1], raw[i + 2]];
    if (isNum(a) && mid?.toLowerCase() === 'x' && isNum(b)) {
      tokens.push(`${a}x${b}`);
      i += 2;
    } else if (isNum(a) && isNum(mid) && ((a === '9' && mid === '16') || (a === '16' && mid === '9') || (Number(a) >= 240 && Number(mid) >= 240))) {
      tokens.push(`${a}x${mid}`);
      i += 1;
    } else {
      tokens.push(a);
    }
  }
  return tokens;
}

const PORTRAIT_WORDS = new Set(['portrait', 'vertical', 'vert']);
const LANDSCAPE_WORDS = new Set(['landscape', 'horizontal', 'horiz']);

function orientationOfToken(token, isLastOfSeveral) {
  const t = token.toLowerCase();
  if (PORTRAIT_WORDS.has(t)) return 'portrait';
  if (LANDSCAPE_WORDS.has(t)) return 'landscape';
  const dims = t.match(/^(\d+)x(\d+)$/);
  if (dims) return orientationFromRatio(Number(dims[1]), Number(dims[2]));
  // Short suffixes like "Hook01_P" / "Hook01_L" only count as the last token.
  if (isLastOfSeveral && (t === 'p' || t === 'v')) return 'portrait';
  if (isLastOfSeveral && (t === 'l' || t === 'h')) return 'landscape';
  return null;
}

function orientationFromName(name) {
  const tokens = tokenize(name);
  for (let i = 0; i < tokens.length; i++) {
    const o = orientationOfToken(tokens[i], tokens.length > 1 && i === tokens.length - 1);
    if (o) return o;
  }
  return null;
}

export function orientationOf(c) {
  for (const field of ['orientation', 'videoOrientation', 'layout', 'aspectRatio', 'subType', 'playableType']) {
    const o = orientationFromText(str(c[field]));
    if (o) return o;
  }
  const dims = findDimensions(c);
  if (dims) return orientationFromRatio(dims.w, dims.h);
  for (const field of ['type', 'creativeType']) {
    const o = orientationFromText(str(c[field]));
    if (o) return o;
  }
  return orientationFromName(creativeName(c));
}

// ---------- base name ----------

const KIND_WORDS = new Set(['ec', 'endcard', 'playable', 'mraid', 'video', 'vid']);

export function baseName(name) {
  const tokens = tokenize(name);
  const kept = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (orientationOfToken(t, tokens.length > 1 && i === tokens.length - 1)) continue;
    if (KIND_WORDS.has(t)) continue;
    if (t === 'end' && tokens[i + 1]?.toLowerCase() === 'card') {
      i++;
      continue;
    }
    kept.push(tokens[i]);
  }
  const parts = kept.length ? kept : tokens.length ? tokens : [name];
  return { key: parts.join('_').toLowerCase(), display: parts.join('_') };
}

// ---------- status ----------

const UNUSABLE_STATUS = /reject|fail|error|declin|delet|archiv|invalid|disabled/i;

function unusableStatus(c) {
  for (const field of ['status', 'reviewStatus', 'approvalStatus', 'state']) {
    if (UNUSABLE_STATUS.test(str(c[field]))) return str(c[field]);
  }
  return null;
}

export function describeCreative(c) {
  const name = creativeName(c);
  const { key, display } = baseName(name);
  return {
    raw: c,
    id: c.id != null ? String(c.id) : c.creativeId != null ? String(c.creativeId) : null,
    name,
    kind: classifyKind(c),
    orientation: orientationOf(c),
    key,
    base: display,
    badStatus: unusableStatus(c),
  };
}

// ---------- existing packs ----------

export function packCreativeIds(pack) {
  const raw = pack.creativeIds ?? pack.creatives ?? [];
  return (Array.isArray(raw) ? raw : [])
    .map((x) => (x && typeof x === 'object' ? x.id ?? x.creativeId : x))
    .filter((x) => x != null)
    .map(String);
}

const signature = (ids) => [...ids].map(String).sort().join(',');

// ---------- lookup ----------

// Finds one creative of the given kind by ID, exact name (with or without
// extension) or a unique part of its name.
export function findCreative(infos, query, kind) {
  const pool = infos.filter((i) => !kind || i.kind === kind);
  const q = String(query).trim().toLowerCase();
  const byId = pool.find((i) => i.id && i.id.toLowerCase() === q);
  if (byId) return { match: byId };
  const exact = pool.filter((i) => i.name.toLowerCase() === q || stripExt(i.name).toLowerCase() === q);
  if (exact.length === 1) return { match: exact[0] };
  const partial = exact.length ? exact : pool.filter((i) => i.name.toLowerCase().includes(q));
  if (partial.length === 1) return { match: partial[0] };
  if (!partial.length) return { error: `không tìm thấy ${kind || 'creative'} "${query}"` };
  return { error: `"${query}" khớp ${partial.length} creative: ${partial.map((i) => i.name).join(', ')}` };
}

// ---------- planning ----------

// Groups creatives of one kind by base name into portrait/landscape pairs.
// A group that cannot be paired safely (two portraits, unknown orientation…)
// becomes one pack per creative.
function buildUnits(infos) {
  const groups = new Map();
  for (const info of infos) {
    if (!groups.has(info.key)) groups.set(info.key, { key: info.key, base: info.base, items: [] });
    groups.get(info.key).items.push(info);
  }
  const units = [];
  for (const group of groups.values()) {
    const portrait = group.items.filter((i) => i.orientation === 'portrait');
    const landscape = group.items.filter((i) => i.orientation === 'landscape');
    if (portrait.length <= 1 && landscape.length <= 1 && portrait.length + landscape.length === group.items.length) {
      units.push({ key: group.key, base: group.base, members: [...portrait, ...landscape] });
    } else if (group.items.length === 1) {
      units.push({ key: group.key, base: group.base, members: group.items });
    } else {
      for (const item of group.items) {
        units.push({ key: group.key, base: stripExt(item.name), members: [item], split: true });
      }
    }
  }
  return units;
}

function pickCompanion(unit, candidates, fallback) {
  const sameName = candidates.filter((c) => c.key === unit.key).sort((a, b) => a.name.localeCompare(b.name));
  if (sameName.length) return { creative: sameName[0], how: 'same-name' };
  if (fallback) return { creative: fallback, how: 'default' };
  return null;
}

function orientTag(members) {
  const o = members.map((m) => m.orientation);
  if (o.includes('portrait') && o.includes('landscape')) return 'PL';
  if (o.includes('portrait')) return 'P';
  if (o.includes('landscape')) return 'L';
  if (o.includes('responsive')) return 'R';
  return '';
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function renderName(template, pack) {
  const values = {
    base: pack.base,
    type: pack.type,
    tag: TAGS[pack.type] || pack.type,
    orient: pack.orient,
    endcard: pack.endcard?.base ?? '',
    playable: pack.playable?.base ?? '',
    date: today(),
  };
  return template
    .replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m))
    .replace(/([_\-. ])\1+/g, '$1')
    .replace(/^[_\-. ]+|[_\-. ]+$/g, '')
    .trim();
}

function uniqueName(name, used) {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name}_${n}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function makePack(type, unit, companion) {
  const members = companion ? [...unit.members, companion.creative] : unit.members;
  return {
    type,
    base: unit.base,
    orient: orientTag(unit.members),
    endcard: type === 'video' ? companion.creative : undefined,
    playable: type === 'video+playable' ? companion.creative : undefined,
    companionHow: companion?.how,
    creativeIds: members.map((m) => m.id),
    creatives: members.map((m) => ({ id: m.id, name: m.name, kind: m.kind, orientation: m.orientation })),
  };
}

export function buildPlan({
  creatives,
  existingPacks = [],
  types = ['video', 'playable'],
  defaultEndcardId = null,
  defaultPlayableId = null,
  filter = null,
  nameTemplate = DEFAULT_NAME_TEMPLATE,
}) {
  const skipped = [];
  const usable = [];
  for (const info of creatives.map(describeCreative)) {
    if (!info.id) skipped.push({ name: info.name, reason: 'thiếu ID' });
    else if (info.badStatus) skipped.push({ name: info.name, reason: `trạng thái "${info.badStatus}"` });
    else usable.push(info);
  }

  const ofKind = (kind) => usable.filter((i) => i.kind === kind);
  const primary = (kind) => ofKind(kind).filter((i) => !filter || filter.test(i.name));
  const endcards = ofKind('endcard');
  // video+playable needs a responsive playable (unless the user picked one).
  const responsivePlayables = ofKind('playable').filter((i) => i.orientation === 'responsive' || i.orientation == null);
  const defaultEndcard = defaultEndcardId ? usable.find((i) => i.id === defaultEndcardId) : null;
  const defaultPlayable = defaultPlayableId ? usable.find((i) => i.id === defaultPlayableId) : null;

  for (const info of usable) {
    if (filter && !filter.test(info.name)) continue;
    if (info.kind === 'unknown') skipped.push({ name: info.name, reason: 'không nhận diện được loại creative' });
    if (info.kind === 'banner') skipped.push({ name: info.name, reason: 'banner — tool chưa hỗ trợ banner pack' });
  }

  const packs = [];
  const unitLabel = (u) => u.members.map((m) => m.name).join(' + ');
  if (types.includes('video') || types.includes('video+playable')) {
    for (const unit of buildUnits(primary('video'))) {
      if (types.includes('video')) {
        const endcard = pickCompanion(unit, endcards, defaultEndcard);
        if (endcard) packs.push(makePack('video', unit, endcard));
        else skipped.push({ name: unitLabel(unit), code: 'no-endcard', reason: 'không có end card cùng tên và chưa chọn end card mặc định (--endcard)' });
      }
      if (types.includes('video+playable')) {
        const playable = pickCompanion(unit, responsivePlayables, defaultPlayable);
        if (playable) packs.push(makePack('video+playable', unit, playable));
        else skipped.push({ name: unitLabel(unit), code: 'no-playable', reason: 'không có playable cùng tên và chưa chọn playable mặc định (--playable)' });
      }
    }
  }
  if (types.includes('playable')) {
    for (const unit of buildUnits(primary('playable'))) packs.push(makePack('playable', unit));
  }

  const existingBySignature = new Map();
  // Packs listed without their creatives can only be recognised by name.
  const existingByNameOnly = new Map();
  for (const p of existingPacks) {
    const ids = packCreativeIds(p);
    if (ids.length) existingBySignature.set(signature(ids), p);
    else if (str(p.name)) existingByNameOnly.set(str(p.name).toLowerCase(), p);
  }
  const usedNames = new Set(existingPacks.map((p) => str(p.name).toLowerCase()).filter(Boolean));
  const planned = new Set();
  const toCreate = [];
  const existing = [];
  for (const pack of packs) {
    const sig = signature(pack.creativeIds);
    const name = renderName(nameTemplate, pack);
    const match = existingBySignature.get(sig) || existingByNameOnly.get(name.toLowerCase());
    if (match) {
      existing.push({ ...pack, name: str(match.name) || '(không tên)' });
      continue;
    }
    if (planned.has(sig)) continue;
    planned.add(sig);
    toCreate.push({ ...pack, name: uniqueName(name, usedNames) });
  }

  return { packs: toCreate, existing, skipped, creatives: usable };
}
