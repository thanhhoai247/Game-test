import { isAllowedApiBase, parseDashboardUrl, tokenExpiresAt } from '../auth.js';
import { DEFAULT_NAME_TEMPLATE, packSignature } from '../planner.js';
import { createPacks, connect, fetchAppData, planFromData } from '../runner.js';
import { getApiBase, getSettings, getTokens, saveSettings } from '../storage.js';
import { DEFAULT_BASE_URL } from '../unity-api.js';

const $ = (id) => document.getElementById(id);
const KIND = { video: 'video', endcard: 'end card', playable: 'playable', banner: 'banner', unknown: '?' };
const ORIENT = { portrait: 'dọc', landscape: 'ngang', responsive: 'responsive' };

const state = {
  orgId: null,
  appId: null,
  client: null,
  token: null,
  apps: [],
  data: null,
  plan: null,
  planError: null,
  settings: null,
  excluded: [],
  busy: false,
  waitingForToken: false,
  lastError: null,
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

const time = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const dateTime = (ms) => new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const appLabel = (a) => `${a.name || '(không tên)'}${a.storeId || a.bundleId ? ` — ${a.storeId || a.bundleId}` : ''}`;

// The Unity tab the panel works on: the active tab, else any open dashboard tab.
async function findUnityTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (parseDashboardUrl(active?.url).orgId) return active;
  const tabs = await chrome.tabs.query({ url: 'https://cloud.unity.com/*' });
  return tabs.find((t) => parseDashboardUrl(t.url).orgId) || null;
}

// ---------- connection ----------

// Tab and storage events can ask for a reconnect at the same time; run one at a time.
let initQueue = Promise.resolve();
const init = () => (initQueue = initQueue.then(connectPanel, connectPanel));

async function connectPanel() {
  Object.assign(state, { client: null, data: null, plan: null, waitingForToken: false });
  for (const id of ['app-section', 'settings', 'plan-section', 'auto-section']) $(id).hidden = true;
  $('apiBase').placeholder = DEFAULT_BASE_URL;
  $('apiBase').value = (await chrome.storage.local.get('apiBase')).apiBase || '';

  const fromTab = parseDashboardUrl((await findUnityTab())?.url);
  const { lastOrgId, lastAppId } = await chrome.storage.local.get(['lastOrgId', 'lastAppId']);
  state.orgId = fromTab.orgId || lastOrgId;
  if (!state.orgId) {
    state.waitingForToken = true;
    setStatus('Mở cloud.unity.com (trang Acquire của organization) và đăng nhập. Bảng này sẽ tự kết nối.', 'bad');
    return renderDiag();
  }

  setStatus('Đang kết nối với Unity…');
  try {
    Object.assign(state, await connect({ orgId: state.orgId, tokens: await getTokens(), baseUrl: await getApiBase() }));
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    state.waitingForToken = e.code === 'no-token';
    setStatus(e.message, 'bad');
    if (!state.waitingForToken) $('diag').open = true;
    return renderDiag();
  }
  await chrome.storage.local.set({ lastOrgId: state.orgId });
  setStatus(`Đã kết nối bằng phiên đăng nhập của bạn (hết hạn lúc ${time(tokenExpiresAt(state.token))}).`, 'ok');

  const apps = [...state.apps];
  const wanted = fromTab.appId || lastAppId;
  if (fromTab.appId && !apps.some((a) => a.id === fromTab.appId)) apps.unshift({ id: fromTab.appId, name: fromTab.appId });
  if (!apps.length) return setStatus('Organization này chưa có app nào.', 'bad');
  $('app').replaceChildren(...apps.map((a) => el('option', { value: a.id, textContent: appLabel(a) })));
  $('app').value = apps.some((a) => a.id === wanted) ? wanted : apps[0].id;
  $('org').textContent = `Organization ${state.orgId}`;
  $('app-section').hidden = false;
  await loadApp($('app').value);
}

// ---------- app, settings, plan ----------

async function loadApp(appId) {
  state.appId = appId;
  await chrome.storage.local.set({ lastAppId: appId });
  const s = await getSettings(appId);
  state.settings = s;
  state.data = null;
  state.excluded = s.excluded || [];
  for (const box of document.querySelectorAll('input[name=type]')) box.checked = s.types.includes(box.value);
  $('filter').value = s.filter;
  $('nameTemplate').value = s.nameTemplate;
  $('auto').checked = s.auto;
  $('settings').hidden = false;
  $('auto-section').hidden = false;
  renderAutoLog();
  await reloadData(s);
}

async function reloadData(settings) {
  state.data = null;
  $('plan-section').hidden = false;
  $('plan-title').textContent = 'Đang tải creative…';
  for (const id of ['plan', 'warnings', 'existing', 'skipped']) $(id).replaceChildren();
  $('existing-box').hidden = $('skipped-box').hidden = true;
  updateCreateButton();
  try {
    state.data = await fetchAppData(state.client, state.appId);
  } catch (e) {
    state.lastError = e.message;
    $('plan-title').textContent = 'Không tải được creative';
    $('warnings').replaceChildren(el('li', { textContent: e.message }));
    return renderDiag();
  }
  fillCompanionSelects(settings || (await getSettings(state.appId)));
  await replan();
}

function fillCompanionSelects(s) {
  const usable = state.data.infos.filter((i) => i.id && !i.badStatus);
  const fill = (select, kind, emptyLabel, value) => {
    const options = usable.filter((i) => i.kind === kind);
    select.replaceChildren(el('option', { value: '', textContent: emptyLabel }),
      ...options.map((i) => el('option', { value: i.id, textContent: i.name })));
    select.value = options.some((i) => i.id === value) ? value : '';
  };
  fill($('endcard'), 'endcard', 'Tự động (end card cùng tên, hoặc end card duy nhất)', s.endcardId);
  fill($('playable'), 'playable', 'Không chọn', s.playableId);
}

function readSettings() {
  // The end card / playable lists are only filled once the app's creatives loaded.
  const loaded = Boolean(state.data);
  return {
    types: [...document.querySelectorAll('input[name=type]:checked')].map((b) => b.value),
    endcardId: loaded ? $('endcard').value : state.settings?.endcardId || '',
    playableId: loaded ? $('playable').value : state.settings?.playableId || '',
    filter: $('filter').value.trim(),
    nameTemplate: $('nameTemplate').value.trim() || DEFAULT_NAME_TEMPLATE,
    auto: $('auto').checked,
    orgId: state.orgId,
    excluded: state.excluded.slice(-500),
  };
}

async function replan() {
  if (!state.appId) return;
  const settings = readSettings();
  state.settings = settings;
  await saveSettings(state.appId, settings);
  if (!state.data) return;
  try {
    state.plan = planFromData(state.data, settings);
    state.planError = null;
  } catch (e) {
    state.plan = null;
    state.planError = e.message;
  }
  renderPlan();
}

function creativeLine(c, pack) {
  const parts = [KIND[c.kind] || c.kind];
  if (c.orientation) parts.push(ORIENT[c.orientation] || c.orientation);
  const companion = pack.endcard || pack.playable;
  const isDefault = pack.companionHow === 'default' && c.id === companion?.id;
  return `${c.name} (${parts.join(', ')})${isDefault ? ' — mặc định' : ''}`;
}

function renderPlan() {
  const { data, plan } = state;
  const counts = {};
  for (const i of data.infos) counts[i.kind] = (counts[i.kind] || 0) + 1;
  const found = Object.entries(counts).map(([k, n]) => `${n} ${KIND[k] || k}`).join(', ') || 'chưa có creative nào';
  $('warnings').replaceChildren(...[...data.warnings, state.planError].filter(Boolean).map((w) => el('li', { textContent: w })));
  if (!plan) {
    $('plan-title').textContent = `Tìm thấy ${found}`;
    $('plan').replaceChildren();
    return updateCreateButton();
  }
  $('plan-title').textContent = `${plan.packs.length} pack mới · ${found}`;
  $('plan').replaceChildren(...plan.packs.map((pack) => {
    const check = el('input', { type: 'checkbox', checked: !pack.excluded, title: 'Bỏ chọn để không tạo pack này (cả ở chế độ tự động)' });
    const name = el('input', { type: 'text', value: pack.name, title: 'Tên pack (có thể sửa)' });
    const li = el('li', {},
      el('div', { className: 'head' }, check, name, el('span', { className: 'type', textContent: pack.type })),
      el('ul', {}, ...pack.creatives.map((c) => el('li', { textContent: creativeLine(c, pack) }))));
    li.classList.toggle('off', !check.checked);
    check.addEventListener('change', () => {
      li.classList.toggle('off', !check.checked);
      const sig = packSignature(pack);
      state.excluded = state.excluded.filter((s) => s !== sig).concat(check.checked ? [] : [sig]);
      saveSettings(state.appId, readSettings());
      updateCreateButton();
    });
    Object.assign(li, { pack, check, nameInput: name });
    return li;
  }));
  const fillBox = (box, list, title, items) => {
    $(box).hidden = !items.length;
    $(box).querySelector('summary').textContent = `${title} (${items.length})`;
    $(list).replaceChildren(...items.map((text) => el('li', { textContent: text })));
  };
  fillBox('existing-box', 'existing', 'Đã có sẵn, bỏ qua',
    plan.existing.map((p) => `${p.name} — ${p.creatives.map((c) => c.name).join(' + ')}`));
  fillBox('skipped-box', 'skipped', 'Không tạo được', plan.skipped.map((s) => `${s.name}: ${s.reason}`));
  updateCreateButton();
}

function selectedPacks() {
  return [...$('plan').children]
    .filter((li) => li.check.checked)
    .map((li) => ({ ...li.pack, name: li.nameInput.value.trim() || li.pack.name }));
}

function updateCreateButton() {
  const n = state.plan ? selectedPacks().length : 0;
  $('create').textContent = n ? `Tạo ${n} creative pack` : 'Không có pack mới để tạo';
  $('create').disabled = !n || state.busy;
}

function setBusy(busy) {
  state.busy = busy;
  for (const node of document.querySelectorAll('section input, section select, section button')) node.disabled = busy;
  updateCreateButton();
}

async function createSelected() {
  const packs = selectedPacks();
  if (!packs.length) return;
  setBusy(true);
  $('progress').replaceChildren();
  try {
    const results = await createPacks(state.client, state.appId, packs, (r, done, total) => {
      const text = r.status === 'created' ? `✔ ${r.pack.name}${r.id ? ` → ${r.id}` : ''}`
        : r.status === 'exists' ? `= ${r.pack.name}: đã có, bỏ qua`
          : `✖ ${r.pack.name}: ${r.error}`;
      $('progress').append(el('li', { className: r.status, textContent: text }));
      $('create').textContent = `Đang tạo ${done}/${total}…`;
    });
    const created = results.filter((r) => r.status === 'created').length;
    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length) state.lastError = failed[0].error;
    $('progress').append(el('li', { textContent: `Xong: tạo ${created} pack${failed.length ? `, ${failed.length} lỗi` : ''}.` }));
  } catch (e) {
    state.lastError = e.message;
    $('progress').append(el('li', { className: 'failed', textContent: e.message }));
  } finally {
    setBusy(false);
  }
  await reloadData();
}

// ---------- auto mode & diagnostics ----------

async function renderAutoLog() {
  const { autoLog = [] } = await chrome.storage.local.get('autoLog');
  const { lastAutoCheck = {} } = await chrome.storage.session.get('lastAutoCheck');
  const checkedAt = lastAutoCheck[state.appId];
  $('auto-check').textContent = $('auto').checked && checkedAt ? `Lần kiểm tra tự động gần nhất: ${time(checkedAt)}` : '';
  $('auto-log').replaceChildren(...autoLog.filter((e) => e.appId === state.appId).slice(0, 5).map((e) => el('li', {
    textContent: `${dateTime(e.at)} (${e.reason}): ` + (e.error ? `lỗi — ${e.error}`
      : `tạo ${e.created.length} pack${e.failed.length ? `, ${e.failed.length} lỗi` : ''}${e.remaining ? `, còn ${e.remaining}` : ''}`),
  })));
}

async function renderDiag() {
  if (!$('diag').open) return;
  const tokens = await getTokens();
  const { requests = [] } = await chrome.storage.session.get('requests');
  const lines = [
    `Extension ${chrome.runtime.getManifest().version} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || ''}`,
    `Organization: ${state.orgId || '-'} · App: ${state.appId || '-'}`,
    `API: ${await getApiBase()}`,
    `Kết nối: ${state.client ? `OK (token từ ${state.token.host})` : 'chưa'}`,
    state.lastError && `Lỗi gần nhất: ${state.lastError}`,
    '',
    'Phiên đăng nhập đã bắt (không hiện giá trị token):',
    ...Object.values(tokens).map((t) => `  ${t.host} · lúc ${time(t.capturedAt)} · ${t.exp ? `hết hạn ${time(t.exp)}` : 'không rõ hạn'}`),
    '',
    `Request gần đây của dashboard (${requests.length}):`,
    ...requests.slice(-40).map((r) => `  ${r.method} ${r.status ?? '…'} ${r.host}${r.path}${r.hasAuth ? ' [auth]' : ''}`),
  ];
  $('diag-text').textContent = lines.filter((l) => l !== false && l != null).join('\n');
}

let replanTimer = null;
const replanSoon = () => {
  clearTimeout(replanTimer);
  replanTimer = setTimeout(replan, 300);
};

$('app').addEventListener('change', () => loadApp($('app').value));
for (const box of document.querySelectorAll('input[name=type]')) box.addEventListener('change', replan);
$('endcard').addEventListener('change', replan);
$('playable').addEventListener('change', replan);
$('filter').addEventListener('input', replanSoon);
$('nameTemplate').addEventListener('input', replanSoon);
$('reload').addEventListener('click', () => reloadData());
$('create').addEventListener('click', createSelected);
$('auto').addEventListener('change', async () => {
  await saveSettings(state.appId, readSettings());
  renderAutoLog();
});
$('diag').addEventListener('toggle', renderDiag);
$('copy-diag').addEventListener('click', async () => {
  await renderDiag();
  await navigator.clipboard.writeText($('diag-text').textContent);
  $('copy-diag').textContent = 'Đã copy';
  setTimeout(() => ($('copy-diag').textContent = 'Copy chẩn đoán'), 1500);
});
$('apiBase').addEventListener('change', async () => {
  const value = $('apiBase').value.trim();
  if (value && !isAllowedApiBase(value)) return setStatus('API base phải là địa chỉ https của unity.com.', 'bad');
  await (value ? chrome.storage.local.set({ apiBase: value }) : chrome.storage.local.remove('apiBase'));
  init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  // The dashboard was opened after the panel: connect as soon as a session shows up.
  if (area === 'session' && changes.tokens && state.waitingForToken && !state.busy) init();
  if (area === 'session' && changes.requests) renderDiag();
  if ((area === 'local' && changes.autoLog) || (area === 'session' && changes.lastAutoCheck)) renderAutoLog();
});

// Follow the user to another app or organization in the dashboard.
async function followActiveTab() {
  if (state.busy) return;
  const { orgId, appId } = parseDashboardUrl((await findUnityTab())?.url);
  if (!orgId) return;
  if (orgId !== state.orgId) return init();
  if (state.client && appId && appId !== state.appId && [...$('app').options].some((o) => o.value === appId)) {
    $('app').value = appId;
    loadApp(appId);
  }
}
chrome.tabs.onActivated.addListener(followActiveTab);
chrome.tabs.onUpdated.addListener((tabId, change) => change.url && followActiveTab());

init();
