// Passes what hook.js reports from the page on to the background.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'unity-creative-packs') return;
  const { host, authorization } = event.data;
  chrome.runtime.sendMessage({ type: 'session', host, authorization }).catch(() => {});
});
