/* MAIN-world guard. Also exported for the offline test bench. */
(function () {
  'use strict';
  function install(win, { baseURL = win.location.href, timeout = 30000 } = {}) {
    const core = win.InstaConfirmCore;
    const nativeFetch = win.fetch.bind(win);
    const proto = win.XMLHttpRequest.prototype;
    const nativeOpen = proto.open, nativeSend = proto.send, nativeAbort = proto.abort;
    const nativeHeader = proto.setRequestHeader;
    const states = new WeakMap();
    const stats = { allowed: 0, cancelled: 0, pending: 0 };
    const queue = [];
    let active = null;
    const cancelled = () => new DOMException('Action cancelled before sending', 'AbortError');
    function update() { win.dispatchEvent(new CustomEvent('instaconfirm:status', { detail: { ...stats } })); }
    function pump() {
      if (active || !queue.length) return;
      if (!win.document.body) {
        win.document.addEventListener('DOMContentLoaded', pump, { once: true });
        return;
      }
      const item = queue.shift();
      active = item;
      const previous = win.document.activeElement;
      const host = win.document.createElement('div');
      host.id = 'instaconfirm-dialog';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = win.document.createElement('style');
      style.textContent = `:host{all:initial}dialog{box-sizing:border-box;width:min(460px,calc(100vw - 32px));border:1px solid #bad1cc;border-radius:18px;padding:28px;background:#f8faf7;color:#142e28;font:16px/1.5 system-ui;box-shadow:0 24px 100px #0006}dialog::backdrop{background:#10271fcc;backdrop-filter:blur(4px)}h2{font-size:24px;line-height:1.2;margin:10px 0 14px;overflow-wrap:anywhere}p{margin:12px 0}small{color:#516b63}code{display:block;background:#e9efeb;padding:12px;border-radius:8px;font-size:12px;overflow-wrap:anywhere}footer{display:flex;gap:10px;margin-top:24px}button{font:inherit;cursor:pointer;min-height:44px;border:1px solid #758f86;padding:10px 18px;border-radius:8px;background:white;color:#163d31}button:last-child{background:#163d31;color:white}button:focus-visible{outline:3px solid #d18e23;outline-offset:3px}`;
      const dialog = win.document.createElement('dialog');
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      const eyebrow = win.document.createElement('small'); eyebrow.textContent = 'INSTAGRAM ACTION GUARD';
      const title = win.document.createElement('h2'); title.id = 'confirm-title'; title.textContent = item.info.title;
      const explanation = win.document.createElement('p'); explanation.textContent = 'Send this action to Instagram? It is waiting locally for your decision.';
      const details = win.document.createElement('code'); details.textContent = `POST ${item.info.path}${item.info.fields.length ? '\nVariable names: ' + item.info.fields.join(', ') : ''}`;
      const note = win.document.createElement('small'); note.textContent = 'Values are hidden. Escape, closing this page, or 30 seconds without a decision cancels the action.';
      const footer = win.document.createElement('footer');
      const cancel = win.document.createElement('button'); cancel.textContent = 'Cancel action'; cancel.autofocus = true;
      const allow = win.document.createElement('button'); allow.textContent = 'Allow once';
      cancel.onclick = () => item.finish(false); allow.onclick = () => item.finish(true);
      dialog.oncancel = event => { event.preventDefault(); item.finish(false); };
      footer.append(cancel, allow); dialog.append(eyebrow, title, explanation, details, note, footer);
      shadow.append(style, dialog); win.document.body.append(host);
      item.cleanupUI = () => { dialog.close(); host.remove(); if (previous?.isConnected && typeof previous.focus === 'function') previous.focus(); };
      try { dialog.showModal(); cancel.focus(); } catch { item.finish(false); }
    }
    function confirm(info, signal) {
      if (signal?.aborted || stats.pending >= 20) { stats.cancelled++; update(); return Promise.resolve(false); }
      return new Promise(resolve => {
        let settled = false;
        const item = { info, finish(allow) {
          if (settled) return;
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1);
          item.cleanupUI?.(); if (active === item) active = null;
          stats.pending--; stats[allow ? 'allowed' : 'cancelled']++; update();
          resolve(allow); pump();
        } };
        const abort = () => item.finish(false);
        const timer = setTimeout(abort, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        stats.pending++; queue.push(item); update(); pump();
      });
    }
    win.fetch = async function (input, init) {
      const request = input instanceof win.Request ? input : null;
      const url = request?.url || String(input);
      const method = init?.method || request?.method || 'GET';
      if (!core.endpoint(url, method, baseURL)) return nativeFetch(input, init);
      const signal = init?.signal || request?.signal;
      if (signal?.aborted) throw cancelled();
      let body = init?.body;
      // Inspect a clone: the original request remains readable by native fetch.
      if (body == null && request?.body) {
        const clone = request.clone();
        const reader = clone.body.getReader();
        const decoder = new TextDecoder();
        let total = 0; body = '';
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            total += chunk.value.length;
            if (total > core.MAX_BODY) { body = ''; void reader.cancel(); break; }
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
        } catch { body = ''; }
      }
      const info = core.classify(url, method, body, new Headers(init?.headers || request?.headers), baseURL);
      if (!info) return nativeFetch(input, init);
      if (!await confirm(info, signal) || signal?.aborted) throw cancelled();
      return nativeFetch(input, init);
    };
    proto.open = function (method, url, async = true, ...rest) {
      const old = states.get(this); old?.controller?.abort();
      const result = nativeOpen.call(this, method, url, async, ...rest);
      states.set(this, { method, url: String(url), async: async !== false, headers: {}, pending: false });
      return result;
    };
    proto.setRequestHeader = function (name, value) {
      if (states.get(this)?.pending) throw new DOMException('Request already waiting for confirmation', 'InvalidStateError');
      const result = nativeHeader.call(this, name, value);
      const state = states.get(this); if (state) state.headers[name.toLowerCase()] = value;
      return result;
    };
    proto.abort = function () {
      const state = states.get(this);
      if (state?.pending) {
        state.pending = false; state.controller.abort();
        nativeAbort.call(this);
        this.dispatchEvent(new ProgressEvent('abort')); this.dispatchEvent(new ProgressEvent('loadend'));
        return;
      }
      return nativeAbort.call(this);
    };
    proto.send = function (body) {
      const state = states.get(this);
      if (!state || !core.endpoint(state.url, state.method, baseURL)) return nativeSend.call(this, body);
      if (state.pending || state.sent || this.readyState !== 1) throw new DOMException('Request is not available for sending', 'InvalidStateError');
      const info = core.classify(state.url, state.method, body, state.headers, baseURL);
      if (!info) return nativeSend.call(this, body);
      if (!state.async) throw new DOMException('Synchronous actions cannot display an asynchronous confirmation', 'NotSupportedError');
      state.pending = true; state.sent = true; state.controller = new AbortController();
      confirm(info, state.controller.signal).then(allow => {
        if (states.get(this) !== state || !state.pending) return;
        state.pending = false;
        if (allow) {
          try { nativeSend.call(this, body); }
          catch { nativeAbort.call(this); this.dispatchEvent(new ProgressEvent('error')); this.dispatchEvent(new ProgressEvent('loadend')); }
        } else {
          nativeAbort.call(this); this.dispatchEvent(new ProgressEvent('abort')); this.dispatchEvent(new ProgressEvent('loadend'));
        }
      });
    };
    win.addEventListener('pagehide', () => { active?.finish(false); [...queue].forEach(item => item.finish(false)); });
    update();
    return { getStats: () => ({ ...stats }) };
  }
  window.InstaConfirmInstall = install;
  if (['instagram.com', 'www.instagram.com'].includes(location.hostname)) install(window);
})();
