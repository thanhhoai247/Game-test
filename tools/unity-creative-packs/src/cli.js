#!/usr/bin/env node
// Creates Unity Ads creative packs from the creatives already uploaded for an app.
// Run `node src/cli.js --help` for usage.

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_BASE_URL, createClient } from './unity-api.js';
import { DEFAULT_NAME_TEMPLATE, PACK_TYPES, buildPlan, describeCreative, findCreative } from './planner.js';

const HELP = `
Tạo creative pack tự động từ các creative đã tải lên Unity Ads.

Cách dùng:
  node src/cli.js [tuỳ chọn]

Tuỳ chọn:
  --app <id|url>        App ID (UUID) hoặc dán nguyên link Creative Library trên cloud.unity.com.
                        Bỏ trống để chọn app từ danh sách.
  --org <id>            Organization ID (mặc định: UNITY_ORG_ID trong .env).
  --types <list>        Loại pack cần tạo, cách nhau bằng dấu phẩy:
                        video, playable, video+playable, hoặc all. Mặc định: video,playable
  --endcard <id|tên>    End card mặc định cho video không có end card cùng tên.
  --playable <id|tên>   Playable mặc định cho pack video+playable.
  --filter <regex>      Chỉ dùng video/playable có tên khớp regex (vd: "^Hook0[1-5]").
  --name <mẫu>          Mẫu đặt tên pack. Mặc định: "${DEFAULT_NAME_TEMPLATE}"
                        Biến: {base} {tag} {type} {orient} {endcard} {playable} {date}
  --dry-run             Chỉ xem kế hoạch, không tạo gì.
  --yes, -y             Không hỏi xác nhận trước khi tạo.
  --save-plan <file>    Lưu kế hoạch ra file JSON (để sửa tay) rồi thoát.
  --from-plan <file>    Tạo pack theo file kế hoạch đã lưu/sửa.
  --list-apps           Liệt kê các app trong organization rồi thoát.
  --dump                In dữ liệu thô của các creative (JSON) rồi thoát.
  --help, -h            Hiện hướng dẫn này.

Biến môi trường (đặt trong file .env cạnh package.json):
  UNITY_KEY_ID, UNITY_SECRET_KEY   Key của Service Account (bắt buộc)
  UNITY_ORG_ID                     Organization ID
  UNITY_APP_ID                     App mặc định (không bắt buộc)
  UNITY_API_BASE                   Mặc định ${DEFAULT_BASE_URL}
`;

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIND_LABEL = { video: 'video', endcard: 'end card', playable: 'playable', banner: 'banner', unknown: '?' };
const ORIENT_LABEL = { portrait: 'dọc', landscape: 'ngang', responsive: 'responsive' };

class UsageError extends Error {}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Accepts a bare app ID or a dashboard link such as
// https://cloud.unity.com/organizations/<org>/acquire-v2/creative-library?app=<app>
export function parseAppArg(value) {
  if (!value) return {};
  if (!/^https?:\/\//i.test(value)) return { appId: value.trim() };
  const url = new URL(value);
  const org = url.pathname.match(/\/organizations\/([^/]+)/);
  return { appId: url.searchParams.get('app') || undefined, orgId: org ? org[1] : undefined };
}

function parseTypes(value) {
  if (!value) return ['video', 'playable'];
  if (value.trim().toLowerCase() === 'all') return [...PACK_TYPES];
  const types = value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const bad = types.filter((t) => !PACK_TYPES.includes(t));
  if (bad.length) throw new UsageError(`Loại pack không hợp lệ: ${bad.join(', ')} (chỉ nhận ${PACK_TYPES.join(', ')}, all)`);
  return types;
}

function creativeLine(c, extra = '') {
  const parts = [KIND_LABEL[c.kind] || c.kind];
  if (c.orientation) parts.push(ORIENT_LABEL[c.orientation] || c.orientation);
  return `${c.name} (${parts.join(', ')})${extra}`;
}

function printPlan(plan, out) {
  if (plan.existing.length) {
    out(`\nĐã có sẵn, bỏ qua (${plan.existing.length}):`);
    for (const p of plan.existing) out(`  = ${p.name}  [${p.type}]  ${p.creatives.map((c) => c.name).join(' + ')}`);
  }
  if (plan.skipped.length) {
    out(`\nKhông tạo được (${plan.skipped.length}):`);
    for (const s of plan.skipped) out(`  ✗ ${s.name}: ${s.reason}`);
  }
  out(`\nKế hoạch: ${plan.packs.length} pack mới`);
  plan.packs.forEach((p, i) => {
    out(`  ${i + 1}. ${p.name}  [${p.type}]`);
    for (const c of p.creatives) {
      const isDefault = p.companionHow === 'default' && c.id === (p.endcard || p.playable)?.id;
      out(`       ▸ ${creativeLine(c, isDefault ? ' — mặc định' : '')}`);
    }
  });
}

function readPlanFile(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const packs = Array.isArray(data) ? data : data.packs;
  if (!Array.isArray(packs)) throw new UsageError(`${path}: không thấy danh sách "packs"`);
  packs.forEach((p, i) => {
    if (!p.name || !PACK_TYPES.includes(p.type) || !Array.isArray(p.creativeIds) || !p.creativeIds.length) {
      throw new UsageError(`${path}: pack #${i + 1} cần có name, type (${PACK_TYPES.join('/')}) và creativeIds`);
    }
  });
  return { data, packs: packs.map((p) => ({ ...p, creatives: p.creatives || p.creativeIds.map((id) => ({ id, name: id, kind: '' })) })) };
}

export async function main(argv = process.argv.slice(2), { out = console.log, err = console.error } = {}) {
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(TOOL_DIR, '.env'));

  const { values: opts } = parseArgs({
    args: argv,
    options: {
      app: { type: 'string' },
      org: { type: 'string' },
      types: { type: 'string' },
      endcard: { type: 'string' },
      playable: { type: 'string' },
      filter: { type: 'string' },
      name: { type: 'string' },
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'save-plan': { type: 'string' },
      'from-plan': { type: 'string' },
      'list-apps': { type: 'boolean' },
      dump: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (opts.help) {
    out(HELP);
    return 0;
  }

  const fromArg = parseAppArg(opts.app);
  const orgId = opts.org || fromArg.orgId || process.env.UNITY_ORG_ID;
  const types = parseTypes(opts.types);
  let filter = null;
  if (opts.filter) {
    try {
      filter = new RegExp(opts.filter, 'i');
    } catch (e) {
      throw new UsageError(`--filter không phải regex hợp lệ: ${e.message}`);
    }
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  // Lines are queued so answers typed ahead (e.g. while creatives load) are kept.
  let rl = null;
  const lines = [];
  const waiting = [];
  const ask = (question) => {
    if (!rl) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
      rl.on('close', () => waiting.splice(0).forEach((resolve) => resolve(null)));
    }
    rl.setPrompt(question);
    rl.prompt();
    const next = lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve) => waiting.push(resolve));
    return next.then((line) => {
      if (line == null) throw new UsageError('Đã huỷ.');
      return line.trim();
    });
  };
  const choose = async (title, items, label, { allowNone = false } = {}) => {
    out(`\n${title}`);
    items.forEach((item, i) => out(`  ${i + 1}. ${label(item)}`));
    if (allowNone) out('  0. Bỏ qua');
    for (;;) {
      const answer = await ask(`Chọn số (${allowNone ? '0' : '1'}-${items.length}): `);
      const n = Number(answer);
      if (allowNone && answer === '0') return null;
      if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    }
  };

  try {
    const client = createClient({
      keyId: process.env.UNITY_KEY_ID,
      secretKey: process.env.UNITY_SECRET_KEY,
      orgId,
      baseUrl: process.env.UNITY_API_BASE || DEFAULT_BASE_URL,
      log: err,
    });

    const appLabel = (a) => {
      const store = a.storeId || a.bundleId || a.packageName || a.store || a.platform || '';
      return `${a.name || '(không tên)'}${store ? ` — ${store}` : ''}  [${a.id}]`;
    };

    if (opts['list-apps']) {
      for (const app of await client.listApplications()) out(appLabel(app));
      return 0;
    }

    const planFile = opts['from-plan'] ? readPlanFile(opts['from-plan']) : null;
    let appId = fromArg.appId || process.env.UNITY_APP_ID || planFile?.data.appId;
    if (!appId) {
      if (!interactive) throw new UsageError('Thiếu --app (hoặc UNITY_APP_ID).');
      const apps = await client.listApplications();
      if (!apps.length) throw new UsageError('Organization chưa có app nào.');
      appId = (await choose('Chọn app:', apps, appLabel)).id;
    }
    // With --dump, stdout carries only the JSON so it can be redirected to a file.
    const status = opts.dump ? err : out;
    status(`App: ${appId}  (organization ${orgId})`);
    if (planFile?.data.appId && planFile.data.appId !== appId) {
      err(`! File kế hoạch được tạo cho app ${planFile.data.appId}, khác app đang chọn.`);
    }

    let plan;
    if (planFile) {
      plan = { packs: planFile.packs, existing: [], skipped: [] };
    } else {
      status('Đang tải danh sách creative…');
      const creatives = await client.listCreatives(appId);
      if (opts.dump) {
        out(JSON.stringify(creatives, null, 2));
        return 0;
      }
      let existingPacks = [];
      try {
        existingPacks = await client.listCreativePacks(appId);
      } catch (e) {
        err(`! Không đọc được creative pack hiện có (${e.message}) — sẽ không lọc được pack trùng.`);
      }
      const infos = creatives.map(describeCreative);
      const counts = {};
      for (const i of infos) counts[i.kind] = (counts[i.kind] || 0) + 1;
      out(`Tìm thấy ${creatives.length} creative: ${Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(', ') || 'không có'}; ${existingPacks.length} pack đã có.`);

      const resolveDefault = (query, kind) => {
        if (!query) return null;
        const found = findCreative(infos, query, kind);
        if (found.error) throw new UsageError(`--${kind}: ${found.error}`);
        return found.match;
      };
      let defaultEndcard = resolveDefault(opts.endcard, 'endcard');
      let defaultPlayable = resolveDefault(opts.playable, 'playable');
      const endcards = infos.filter((i) => i.kind === 'endcard' && !i.badStatus);
      if (!defaultEndcard && endcards.length === 1 && types.includes('video')) {
        defaultEndcard = endcards[0];
        out(`End card mặc định: ${defaultEndcard.name} (end card duy nhất của app)`);
      }

      const makePlan = () =>
        buildPlan({
          creatives,
          existingPacks,
          types,
          defaultEndcardId: defaultEndcard?.id,
          defaultPlayableId: defaultPlayable?.id,
          filter,
          nameTemplate: opts.name || DEFAULT_NAME_TEMPLATE,
        });
      plan = makePlan();

      // Ask for a default companion only when some videos actually need one.
      if (interactive) {
        const missing = (code) => plan.skipped.filter((s) => s.code === code).length;
        let changed = false;
        if (!defaultEndcard && missing('no-endcard') && endcards.length) {
          defaultEndcard = await choose(
            `${missing('no-endcard')} video không có end card cùng tên. Chọn end card mặc định:`,
            endcards, (c) => creativeLine(c), { allowNone: true });
          changed ||= Boolean(defaultEndcard);
        }
        const playables = infos.filter((i) => i.kind === 'playable' && !i.badStatus);
        if (!defaultPlayable && missing('no-playable') && playables.length) {
          defaultPlayable = await choose(
            `${missing('no-playable')} video không có playable cùng tên. Chọn playable mặc định:`,
            playables, (c) => creativeLine(c), { allowNone: true });
          changed ||= Boolean(defaultPlayable);
        }
        if (changed) plan = makePlan();
      }
    }

    printPlan(plan, out);

    if (opts['save-plan']) {
      const packs = plan.packs.map(({ name, type, creativeIds, creatives }) => ({ name, type, creativeIds, creatives }));
      writeFileSync(opts['save-plan'], JSON.stringify({ orgId, appId, packs }, null, 2) + '\n');
      out(`\nĐã lưu kế hoạch vào ${opts['save-plan']}. Sửa xong chạy lại với --from-plan ${opts['save-plan']}`);
      return 0;
    }
    if (!plan.packs.length) {
      out('\nKhông có pack mới nào cần tạo.');
      return 0;
    }
    if (opts['dry-run']) {
      out('\n(--dry-run: không tạo gì)');
      return 0;
    }
    if (!opts.yes) {
      if (!interactive) throw new UsageError('Thêm --yes để tạo pack khi không chạy trong terminal.');
      const answer = await ask(`\nTạo ${plan.packs.length} creative pack? (y/N): `);
      if (!/^(y|yes|c|co|có)$/i.test(answer)) {
        out('Đã huỷ.');
        return 0;
      }
    }

    let failed = 0;
    for (const [i, pack] of plan.packs.entries()) {
      const prefix = `[${i + 1}/${plan.packs.length}] ${pack.name}`;
      try {
        const res = await client.createCreativePack(appId, pack);
        const id = res?.id ?? res?.creativePackId ?? res?.data?.id;
        out(`✔ ${prefix}${id ? `  → ${id}` : ''}`);
      } catch (e) {
        failed++;
        err(`✖ ${prefix}: ${e.message}`);
      }
    }
    out(`\nXong: ${plan.packs.length - failed} pack đã tạo${failed ? `, ${failed} lỗi` : ''}.`);
    return failed ? 1 : 0;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`Lỗi: ${e.message}`);
      if (e.status === 401) console.error('→ Kiểm tra UNITY_KEY_ID / UNITY_SECRET_KEY.');
      if (e.status === 403) console.error('→ Service account cần quyền User Acquisition / creative pack (Advertise API) trong organization này.');
      if (e.status === 404) console.error('→ Kiểm tra lại organization ID và app ID.');
      process.exit(e instanceof UsageError ? 2 : 1);
    },
  );
}
