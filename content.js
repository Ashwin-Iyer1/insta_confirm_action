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
    "#igq-confirm-overlay {",
    "  position:fixed;inset:0;background:rgba(0,0,0,0.55);",
    "  display:flex;align-items:center;justify-content:center;",
    "  z-index:2147483647;",
    "  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    "}",
    "#igq-confirm-box {",
    "  background:#fff;border-radius:12px;padding:28px 32px;max-width:480px;width:92%;",
    "  box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:center;",
    "}",
    "#igq-confirm-box h2 { margin:0 0 6px;font-size:17px;color:#262626; }",
    "#igq-confirm-action { margin:0 0 14px;font-size:14px;color:#e1306c;font-weight:600; }",
    "#igq-confirm-detail {",
    "  margin:0 0 18px;font-size:12px;color:#555;word-break:break-all;",
    "  max-height:220px;overflow-y:auto;text-align:left;background:#fafafa;",
    "  padding:10px;border-radius:6px;border:1px solid #eee;white-space:pre-wrap;",
    "}",
    "#igq-confirm-buttons { display:flex;gap:12px;justify-content:center; }",
    "#igq-confirm-buttons button {",
    "  padding:10px 28px;border:none;border-radius:8px;font-size:14px;",
    "  font-weight:600;cursor:pointer;transition:opacity .15s;",
    "}",
    "#igq-confirm-buttons button:hover { opacity:0.85; }",
    "#igq-allow-btn { background:#0095f6;color:#fff; }",
    "#igq-block-btn { background:#efefef;color:#262626; }",
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

        const h2 = document.createElement("h2");
        h2.textContent = title;
        box.appendChild(h2);

        const actionP = document.createElement("p");
        actionP.id = "igq-confirm-action";
        actionP.textContent = friendlyName
          ? "Action: " + friendlyName
          : "Unknown action";
        box.appendChild(actionP);

        const detailPre = document.createElement("pre");
        detailPre.id = "igq-confirm-detail";
        let detailText = "URL: " + url;
        if (variables) detailText += "\n\nVariables:\n" + variables;
        detailPre.textContent = detailText;
        box.appendChild(detailPre);

        const btnDiv = document.createElement("div");
        btnDiv.id = "igq-confirm-buttons";
        box.appendChild(btnDiv);

        const allowBtn = document.createElement("button");
        allowBtn.id = "igq-allow-btn";
        allowBtn.textContent = "Allow";
        btnDiv.appendChild(allowBtn);

        const blockBtn = document.createElement("button");
        blockBtn.id = "igq-block-btn";
        blockBtn.textContent = "Block";
        btnDiv.appendChild(blockBtn);

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
