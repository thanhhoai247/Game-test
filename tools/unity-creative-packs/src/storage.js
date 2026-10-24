// chrome.storage helpers shared by the panel and the background.
import { isAllowedApiBase } from './auth.js';
import { DEFAULT_SETTINGS } from './runner.js';
import { DEFAULT_BASE_URL } from './unity-api.js';

const MAX_AUTO_LOG = 30;
export const settingsKey = (appId) => `settings:${appId}`;

export async function getSettings(appId) {
  const key = settingsKey(appId);
  const stored = (await chrome.storage.local.get(key))[key];
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(appId, settings) {
  await chrome.storage.local.set({ [settingsKey(appId)]: settings });
}

export async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return isAllowedApiBase(apiBase) ? apiBase : DEFAULT_BASE_URL;
}

export async function getTokens() {
  return (await chrome.storage.session.get('tokens')).tokens || {};
}

export async function appendAutoLog(entry) {
  const { autoLog = [] } = await chrome.storage.local.get('autoLog');
  await chrome.storage.local.set({ autoLog: [entry, ...autoLog].slice(0, MAX_AUTO_LOG) });
}
