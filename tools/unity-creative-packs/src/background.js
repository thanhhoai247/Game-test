// Background service worker.
//  - Watches the requests the Unity dashboard makes (read-only) and keeps the
//    Authorization header it sends, so the extension can call the API as you.
//  - Keeps a short log of those requests (without any header values) for the
//    Diagnostics section.
//  - Runs the automatic mode for apps where it is switched on.
import { isBearer, isUnityHost, jwtExpiry, parseDashboardUrl, usableTokens } from './auth.js';
import { autoRun } from './runner.js';
import { appendAutoLog, getApiBase, getSettings, getTokens, settingsKey } from './storage.js';

const UNITY_FILTER = { urls: ['https://*.unity.com/*', 'https://*.unity3d.com/*'], types: ['xmlhttprequest'] };
const MAX_REQUESTS = 60;
const MAX_TOKENS = 8;
const PAGE_VISIT_COOLDOWN_MS = 2 * 60 * 1000;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('auto', { periodInMinutes: 15 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('auto', { periodInMinutes: 15 }));

// Only requests a Unity page makes itself; the extension's own have tabId -1.
function fromDashboard(details) {
  if (details.tabId < 0) return false;
  try {
    return isUnityHost(new URL(details.initiator || '').hostname);
  } catch {
    return false;
  }
}

// ---------- captured session ----------

let tokens = null;
const tokensReady = getTokens().then((stored) => {
  tokens = stored;
});

async function saveToken(host, authorization) {
  await tokensReady;
  const prev = tokens[host];
  if (prev?.authorization === authorization && Date.now() - prev.capturedAt < 60 * 1000) return;
  tokens[host] = { host, authorization, capturedAt: Date.now(), exp: jwtExpiry(authorization) };
  const newest = Object.values(tokens).sort((a, b) => b.capturedAt - a.capturedAt).slice(0, MAX_TOKENS);
  tokens = Object.fromEntries(newest.map((t) => [t.host, t]));
  await chrome.storage.session.set({ tokens });
}

// ---------- request log for diagnostics ----------

let requests = null;
const requestsReady = chrome.storage.session.get('requests').then((r) => {
  requests = r.requests || [];
});
const pending = new Map();
let flushTimer = null;

function flushSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => chrome.storage.session.set({ requests }), 1000);
}

async function logRequest(details, hasAuth) {
  await requestsReady;
  const url = new URL(details.url);
  const entry = { at: Date.now(), method: details.method, host: url.hostname, path: url.pathname, hasAuth };
  pending.set(details.requestId, entry);
  requests.push(entry);
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);
  flushSoon();
}

function finishRequest(details, status) {
  const entry = pending.get(details.requestId);
  if (!entry) return;
  pending.delete(details.requestId);
  entry.status = status;
  flushSoon();
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!fromDashboard(details)) return;
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization')?.value;
    logRequest(details, Boolean(auth));
    if (isBearer(auth)) saveToken(new URL(details.url).hostname, auth);
  },
  UNITY_FILTER,
  ['requestHeaders', 'extraHeaders'],
);

// Same session, reported by the content script inside the dashboard page.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'session' || !sender.tab || !sender.url) return;
  if (!isUnityHost(new URL(sender.url).hostname) || !isUnityHost(message.host)) return;
  if (isBearer(message.authorization)) saveToken(message.host, message.authorization);
});

chrome.webRequest.onCompleted.addListener((details) => {
  finishRequest(details, details.statusCode);
  if (fromDashboard(details)) maybeCreativeUploaded(details);
}, UNITY_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => finishRequest(details, details.error), UNITY_FILTER);

// ---------- automatic mode ----------

const timers = new Map();
const running = new Set();
const lastPageVisitRun = new Map();

async function scheduleAuto(pageUrl, reason, delayMs) {
  const { orgId, appId } = parseDashboardUrl(pageUrl || '');
  if (!orgId || !appId || !/\/acquire/i.test(new URL(pageUrl).pathname)) return;
  if (!(await getSettings(appId)).auto) return;
  if (reason === 'page') {
    if (Date.now() - (lastPageVisitRun.get(appId) || 0) < PAGE_VISIT_COOLDOWN_MS) return;
    lastPageVisitRun.set(appId, Date.now());
  }
  clearTimeout(timers.get(appId));
  timers.set(appId, setTimeout(() => {
    timers.delete(appId);
    runAuto(orgId, appId, reason);
  }, delayMs));
}

function maybeCreativeUploaded(details) {
  if (!['POST', 'PUT'].includes(details.method) || details.statusCode >= 300) return;
  const path = new URL(details.url).pathname.toLowerCase();
  if (!path.includes('creative') || path.includes('pack')) return;
  chrome.tabs.get(details.tabId).then((tab) => scheduleAuto(tab.url, 'upload', 15000), () => {});
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' || change.url) scheduleAuto(tab.url, 'page', 8000);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'auto') return;
  await tokensReady;
  if (!usableTokens(tokens).length) return;
  const stored = await chrome.storage.local.get(null);
  for (const [key, settings] of Object.entries(stored)) {
    if (!key.startsWith(settingsKey('')) || !settings.auto || !settings.orgId) continue;
    await runAuto(settings.orgId, key.slice(settingsKey('').length), 'timer');
  }
});

const REASON_LABEL = { page: 'mở Creative Library', upload: 'vừa tải creative', timer: 'định kỳ 15 phút' };

async function runAuto(orgId, appId, reason) {
  if (running.has(appId)) return;
  running.add(appId);
  const entry = { at: Date.now(), appId, reason: REASON_LABEL[reason] || reason };
  try {
    const settings = await getSettings(appId);
    if (!settings.auto) return;
    await tokensReady;
    Object.assign(entry, await autoRun({ orgId: settings.orgId || orgId, appId, tokens, baseUrl: await getApiBase(), settings }));
  } catch (e) {
    entry.error = e.message;
  } finally {
    running.delete(appId);
  }
  const { lastAutoCheck = {} } = await chrome.storage.session.get('lastAutoCheck');
  await chrome.storage.session.set({ lastAutoCheck: { ...lastAutoCheck, [appId]: entry.at } });
  // Runs that found nothing new are not logged.
  if (!entry.error && !entry.created?.length && !entry.failed?.length) return;
  await appendAutoLog(entry);
  await notify(entry);
}

async function notify(entry) {
  const created = entry.created?.length || 0;
  const failed = entry.failed?.length || 0;
  // The same error (e.g. an expired session) is only announced once.
  const { lastNotifiedError } = await chrome.storage.session.get('lastNotifiedError');
  let message;
  if (entry.error) {
    if (entry.error === lastNotifiedError) return;
    await chrome.storage.session.set({ lastNotifiedError: entry.error });
    message = `Lỗi: ${entry.error}`;
  } else {
    await chrome.storage.session.remove('lastNotifiedError');
    message = `${entry.appName}: đã tạo ${created} pack${failed ? `, ${failed} lỗi` : ''}` +
      (entry.remaining ? ` (còn ${entry.remaining} pack, sẽ tạo ở lần sau)` : '');
  }
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Creative Pack Builder — tự động',
    message,
  });
}
