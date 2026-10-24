// Runs inside the Unity dashboard page. Reports the Authorization header the
// dashboard attaches to its own API calls, so the extension can reuse your
// session. The background also watches requests; this second path covers
// requests made while the background was asleep or starting up.
(() => {
  const SOURCE = 'unity-creative-packs';
  const lastSent = new Map();

  const report = (url, value) => {
    try {
      if (!value || !/^bearer\s/i.test(value)) return;
      const host = new URL(url, location.href).hostname;
      if (!/(^|\.)unity(3d)?\.com$/i.test(host)) return;
      const key = `${host} ${value}`;
      if (Date.now() - (lastSent.get(key) || 0) < 30 * 1000) return;
      lastSent.set(key, Date.now());
      window.postMessage({ source: SOURCE, host, authorization: value }, location.origin);
    } catch {
      // never interfere with the page's own request
    }
  };

  const authorizationOf = (headers) => {
    if (!headers) return null;
    if (headers instanceof Headers) return headers.get('authorization');
    const entries = Array.isArray(headers) ? headers : Object.entries(headers);
    return entries.find(([name]) => String(name).toLowerCase() === 'authorization')?.[1] ?? null;
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const isRequest = input instanceof Request;
      report(isRequest ? input.url : String(input),
        authorizationOf(init?.headers) ?? (isRequest ? input.headers.get('authorization') : null));
    } catch {
      // ignore
    }
    return nativeFetch.apply(this, arguments);
  };

  const { open, setRequestHeader } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__unityCreativePacksUrl = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'authorization') report(this.__unityCreativePacksUrl, value);
    return setRequestHeader.apply(this, arguments);
  };
})();
