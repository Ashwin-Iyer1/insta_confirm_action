// content.js – runs in MAIN world at document_start via manifest.
// Chrome natively injects this into the page context, bypassing CSP.
(function () {
  "use strict";

  /* ================================================================
   *  Instagram Request Confirm
   *  Intercepts fetch() and XMLHttpRequest for:
   *    - /graphql/query
   *    - /api/v1/web/likes
   *  and shows a confirmation dialog before they fire.
   * ================================================================ */

  const INTERCEPT_PATTERNS = [
    "/graphql/query",
    "/api/v1/web/likes",
  ];

  function shouldIntercept(url, bodyStr) {
    if (url.includes("/api/v1/web/likes")) return true;
    if (url.includes("/graphql/query")) {
      // ONLY intercept graphql requests that have container_module = feed_timeline
      return isFeedTimeline(bodyStr);
    }
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  function parseFriendlyName(url, bodyStr) {
    if (url.includes("/api/v1/web/likes")) {
      if (url.includes("/like/"))   return "Like Post";
      if (url.includes("/unlike/")) return "Unlike Post";
      return "Likes API";
    }
    if (!bodyStr) return null;
    try {
      const params = new URLSearchParams(bodyStr);
      return (
        params.get("fb_api_req_friendly_name") ||
        params.get("x-fb-friendly-name") ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function parseVariables(bodyStr) {
    if (!bodyStr) return null;
    try {
      const params = new URLSearchParams(bodyStr);
      const v = params.get("variables");
      if (!v) return null;
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch (_) {
      return null;
    }
  }

  /** Returns true if the variables contain container_module = feed_timeline. */
  function isFeedTimeline(bodyStr) {
    if (!bodyStr) return false;
    try {
      const params = new URLSearchParams(bodyStr);
      const v = params.get("variables");
      if (!v) return false;
      const vars = JSON.parse(v);
      return vars.container_module === "feed_timeline" || vars.container_module === "profile";
    } catch (_) {
      return false;
    }
  }

  // ── Modal UI ──────────────────────────────────────────────────────────

  const STYLE_TEXT = [
    "@keyframes igq-fade-in {",
    "  from { opacity:0; } to { opacity:1; }",
    "}",
    "@keyframes igq-slide-up {",
    "  from { opacity:0;transform:translateY(24px) scale(0.97); }",
    "  to { opacity:1;transform:translateY(0) scale(1); }",
    "}",
    "#igq-confirm-overlay {",
    "  position:fixed;inset:0;background:rgba(0,0,0,0.6);",
    "  display:flex;align-items:center;justify-content:center;",
    "  z-index:2147483647;",
    "  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    "  animation:igq-fade-in .2s ease-out;",
    "  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);",
    "}",
    "#igq-confirm-box {",
    "  background:#fff;border-radius:16px;padding:0;max-width:440px;width:90%;",
    "  box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.1);",
    "  overflow:hidden;animation:igq-slide-up .25s ease-out;",
    "}",
    "#igq-confirm-header {",
    "  background:linear-gradient(135deg,#833ab4 0%,#e1306c 50%,#fd1d1d 100%);",
    "  padding:20px 24px 16px;text-align:center;position:relative;",
    "}",
    "#igq-confirm-header::after {",
    "  content:'';position:absolute;inset:0;",
    "  background:radial-gradient(circle at 30% 50%,rgba(255,255,255,0.12) 0%,transparent 60%);",
    "}",
    "#igq-confirm-header h2 {",
    "  margin:0;font-size:16px;color:#fff;font-weight:700;letter-spacing:-0.2px;position:relative;z-index:1;",
    "}",
    "#igq-confirm-header .igq-subtitle {",
    "  font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;font-weight:500;position:relative;z-index:1;",
    "}",
    "#igq-confirm-body { padding:20px 24px; }",
    "#igq-confirm-action {",
    "  margin:0 0 14px;display:flex;align-items:center;gap:10px;",
    "  padding:10px 14px;border-radius:10px;",
    "  background:linear-gradient(135deg,#fce7f3,#ede9fe);",
    "}",
    "#igq-confirm-action .igq-action-icon {",
    "  width:32px;height:32px;border-radius:8px;",
    "  background:linear-gradient(135deg,#833ab4,#e1306c);",
    "  display:flex;align-items:center;justify-content:center;",
    "  font-size:15px;flex-shrink:0;color:#fff;",
    "}",
    "#igq-confirm-action .igq-action-text {",
    "  font-size:13px;color:#262626;font-weight:600;",
    "}",
    "#igq-confirm-action .igq-action-text span {",
    "  display:block;font-size:11px;color:#737373;font-weight:400;margin-top:1px;",
    "}",
    "#igq-confirm-detail {",
    "  margin:0 0 16px;font-size:11.5px;color:#555;word-break:break-all;",
    "  max-height:180px;overflow-y:auto;text-align:left;background:#f9fafb;",
    "  padding:12px 14px;border-radius:10px;border:1px solid #e5e7eb;",
    "  white-space:pre-wrap;line-height:1.5;",
    "  font-family:'SF Mono','Fira Code','Consolas',monospace;",
    "}",
    "#igq-confirm-detail::-webkit-scrollbar { width:5px; }",
    "#igq-confirm-detail::-webkit-scrollbar-track { background:transparent; }",
    "#igq-confirm-detail::-webkit-scrollbar-thumb { background:#d1d5db;border-radius:9px; }",
    "#igq-confirm-buttons {",
    "  display:flex;gap:10px;justify-content:stretch;",
    "}",
    "#igq-confirm-buttons button {",
    "  flex:1;padding:11px 20px;border:none;border-radius:10px;font-size:14px;",
    "  font-weight:600;cursor:pointer;transition:all .15s ease;letter-spacing:-0.1px;",
    "}",
    "#igq-confirm-buttons button:active { transform:scale(0.97); }",
    "#igq-allow-btn {",
    "  background:linear-gradient(135deg,#833ab4,#e1306c);color:#fff;",
    "  box-shadow:0 2px 8px rgba(225,48,108,0.3);",
    "}",
    "#igq-allow-btn:hover { box-shadow:0 4px 14px rgba(225,48,108,0.4);opacity:0.95; }",
    "#igq-block-btn {",
    "  background:#f3f4f6;color:#374151;",
    "  box-shadow:0 1px 3px rgba(0,0,0,0.06);",
    "}",
    "#igq-block-btn:hover { background:#e5e7eb; }",
  ].join("\n");

  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) return resolve();
      const obs = new MutationObserver(() => {
        if (document.body) { obs.disconnect(); resolve(); }
      });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  function showConfirmation(url, bodyStr) {
    const friendlyName = parseFriendlyName(url, bodyStr);
    const variables = parseVariables(bodyStr);
    const title = url.includes("/graphql/query")
      ? "\u26a0\ufe0f GraphQL Request Intercepted"
      : "\u26a0\ufe0f Instagram API Request Intercepted";

    return new Promise((resolve) => {
      waitForBody().then(() => {
        const overlay = document.createElement("div");
        overlay.id = "igq-confirm-overlay";

        const styleEl = document.createElement("style");
        styleEl.textContent = STYLE_TEXT;
        overlay.appendChild(styleEl);

        const box = document.createElement("div");
        box.id = "igq-confirm-box";
        overlay.appendChild(box);

        // Header with gradient
        const header = document.createElement("div");
        header.id = "igq-confirm-header";
        box.appendChild(header);

        const h2 = document.createElement("h2");
        h2.textContent = title;
        header.appendChild(h2);

        const subtitle = document.createElement("div");
        subtitle.className = "igq-subtitle";
        subtitle.textContent = "A request is about to be sent";
        header.appendChild(subtitle);

        // Body
        const body = document.createElement("div");
        body.id = "igq-confirm-body";
        box.appendChild(body);

        // Action badge
        const actionDiv = document.createElement("div");
        actionDiv.id = "igq-confirm-action";
        body.appendChild(actionDiv);

        const actionIcon = document.createElement("div");
        actionIcon.className = "igq-action-icon";
        actionIcon.textContent = url.includes("/likes") ? "\u2665" : "\u25C8";
        actionDiv.appendChild(actionIcon);

        const actionText = document.createElement("div");
        actionText.className = "igq-action-text";
        actionText.innerHTML = friendlyName
          ? friendlyName + "<span>Detected action</span>"
          : "Unknown action<span>Could not identify request type</span>";
        actionDiv.appendChild(actionText);

        const detailPre = document.createElement("pre");
        detailPre.id = "igq-confirm-detail";
        let detailText = "URL: " + url;
        if (variables) detailText += "\n\nVariables:\n" + variables;
        detailPre.textContent = detailText;
        body.appendChild(detailPre);

        const btnDiv = document.createElement("div");
        btnDiv.id = "igq-confirm-buttons";
        body.appendChild(btnDiv);

        const blockBtn = document.createElement("button");
        blockBtn.id = "igq-block-btn";
        blockBtn.textContent = "Block";
        btnDiv.appendChild(blockBtn);

        const allowBtn = document.createElement("button");
        allowBtn.id = "igq-allow-btn";
        allowBtn.textContent = "Allow";
        btnDiv.appendChild(allowBtn);

        document.body.appendChild(overlay);

        allowBtn.addEventListener("click", () => { overlay.remove(); resolve(true); });
        blockBtn.addEventListener("click", () => { overlay.remove(); resolve(false); });
      });
    });
  }

  // ── Intercept fetch() ─────────────────────────────────────────────────

  const _fetch = window.fetch;

  window.fetch = function (...args) {
    const [resource, init] = args;
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof Request
        ? resource.url
        : String(resource);

    let bodyText = "";
    if (init && init.body != null) {
      bodyText =
        typeof init.body === "string"
          ? init.body
          : init.body instanceof URLSearchParams
          ? init.body.toString()
          : "(binary body)";
    }

    if (shouldIntercept(url, bodyText)) {
      return showConfirmation(url, bodyText).then((allowed) => {
        if (!allowed) {
          return new Response('{"status":"ok"}', {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return _fetch.apply(window, args);
      });
    }
    return _fetch.apply(window, args);
  };

  // ── Intercept XMLHttpRequest ──────────────────────────────────────────

  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__igqUrl = typeof url === "string" ? url : String(url);
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const bodyText = body ? String(body) : "";
    if (this.__igqUrl && shouldIntercept(this.__igqUrl, bodyText)) {
      const xhr = this;

      showConfirmation(this.__igqUrl, bodyText).then((allowed) => {
        if (allowed) {
          _xhrSend.call(xhr, body);
        } else {
          Object.defineProperty(xhr, "readyState",    { value: 4, writable: false });
          Object.defineProperty(xhr, "status",        { value: 200, writable: false });
          Object.defineProperty(xhr, "responseText",  { value: '{"status":"ok"}', writable: false });
          Object.defineProperty(xhr, "response",      { value: '{"status":"ok"}', writable: false });
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new Event("load"));
          xhr.dispatchEvent(new Event("loadend"));
        }
      });
      return;
    }
    return _xhrSend.call(this, body);
  };

  console.log(
    "%c[IG Request Confirm]%c Interceptor active - watching: " +
      INTERCEPT_PATTERNS.join(", "),
    "color:#0095f6;font-weight:bold",
    "color:inherit"
  );
})();
