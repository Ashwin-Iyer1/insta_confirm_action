(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstaConfirmCore = api;
})(globalThis, function () {
  'use strict';
  const MAX_BODY = 131072;
  function endpoint(url, method, base = 'https://www.instagram.com/') {
    let target;
    try { target = new URL(url, base); } catch { return null; }
    if (target.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(target.hostname) || target.port || target.username || target.password || method.toUpperCase() !== 'POST') return null;
    const like = target.pathname.match(/^\/api\/v1\/web\/likes\/\d+\/(like|unlike)\/?$/);
    if (like) return { kind: like[1], path: `/api/v1/web/likes/…/${like[1]}/` };
    if (/^\/(api\/graphql|graphql(?:\/query)?)\/?$/.test(target.pathname)) return { kind: 'graphql', path: target.pathname };
    return null;
  }
  function fields(body) {
    if (!body) return {};
    if (typeof body === 'string') {
      if (body.length > MAX_BODY) return {};
      try { if (body.trim().startsWith('{')) return JSON.parse(body); } catch { return {}; }
      return Object.fromEntries(new URLSearchParams(body));
    }
    if (typeof body.entries === 'function') return Object.fromEntries([...body.entries()].filter(([, value]) => typeof value === 'string'));
    return {};
  }
  function classify(url, method, body, headers = {}, base) {
    const match = endpoint(url, method, base);
    if (!match) return null;
    if (match.kind !== 'graphql') return { ...match, title: match.kind === 'like' ? 'Like post' : 'Unlike post', fields: [] };
    const data = fields(body);
    const getHeader = key => typeof headers.get === 'function' ? headers.get(key) : Object.entries(headers).find(([name]) => name.toLowerCase() === key)?.[1];
    const name = String(data.fb_api_req_friendly_name || data.operationName || getHeader('x-fb-friendly-name') || '').slice(0, 160);
    const query = typeof data.query === 'string' ? data.query : '';
    // Only explicit reads pass through. Persisted, unnamed POSTs cannot be
    // classified safely from a container_module or opaque document ID.
    const mutation = /\bmutation\b/.test(query) || /mutation/i.test(name);
    if (!mutation && (/Query$/.test(name) || /^\s*(?:#[^\n]*\n\s*)*(query\b|\{)/.test(query))) return null;
    let variables = data.variables;
    try { if (typeof variables === 'string') variables = JSON.parse(variables); } catch { variables = null; }
    const names = variables && typeof variables === 'object' && !Array.isArray(variables) ? Object.keys(variables).filter(key => /^[a-zA-Z_][a-zA-Z_0-9]{0,39}$/.test(key)).slice(0, 12) : [];
    return { ...match, title: name || 'Unclassified GraphQL operation', fields: names };
  }
  return { MAX_BODY, endpoint, fields, classify };
});
