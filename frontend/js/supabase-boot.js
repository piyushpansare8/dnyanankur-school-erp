/* ============================================================================
 * Dnyanankur ERP — Supabase Boot Loader
 * ----------------------------------------------------------------------------
 * Supabase is the source of truth. localStorage is only a warm, synchronous
 * cache of it.
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT LOADS BEFORE app.js
 * -----------------------------------------------------------
 * app.js is one ~77k-line classic script. Dozens of its IIFEs read storage at
 * parse time (PortalAuthEngine.restoreSessionFromStorage(), the Repository
 * layer, Cache warmers, …), and every one of those reads is SYNCHRONOUS.
 * Fetching from Supabase is not. There is no way to interleave the two safely
 * inside app.js — and getting it wrong is destructive, not merely wrong:
 *
 *     app.js boots -> reads 'students' -> cache is empty -> app shows 0 students
 *     -> user registers one -> saveStudents() writes an array of length 1
 *     -> that 1-element array is pushed to Supabase, replacing all 35 records.
 *
 * Every key in this ERP is stored as one whole-value blob, so a premature read
 * followed by any write is a full-table overwrite. The only safe ordering is
 * to finish hydrating BEFORE a single line of app.js executes. So this file
 * hydrates first and then injects app.js itself.
 *
 * If hydration fails we deliberately DO NOT load app.js. Booting on stale
 * localStorage would let the user work against old data and then push it over
 * newer Supabase rows — silent divergence, which is exactly the failure this
 * file exists to prevent. A blocked screen with a Retry button is recoverable;
 * overwritten student records are not.
 *
 * The matching write path lives in Dnyanankur.CloudSync inside app.js.
 * ==========================================================================*/
(function () {
  "use strict";

  var URL_BASE = (window.DNK_SUPABASE_URL || "").replace(/\/+$/, "");
  var ANON_KEY = window.DNK_SUPABASE_ANON_KEY || "";
  var TABLE    = window.DNK_SUPABASE_TABLE || "erp_kv_store";
  var APP_SRC  = "js/app.js";

  function configured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(URL_BASE) &&
           ANON_KEY && ANON_KEY.indexOf("YOUR-") !== 0;
  }

  // ---- Splash -------------------------------------------------------------
  var splash = document.createElement("div");
  splash.id = "dnk-boot-splash";
  splash.setAttribute("style",
    "position:fixed;inset:0;z-index:100000;background:#0f2244;color:#fff;" +
    "display:flex;align-items:center;justify-content:center;text-align:center;" +
    "font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;padding:24px;");
  splash.innerHTML =
    '<div style="max-width:440px;">' +
      '<div style="width:64px;height:64px;background:#c9973a;border-radius:14px;display:inline-flex;' +
           'align-items:center;justify-content:center;font-size:28px;font-family:Georgia,serif;' +
           'font-weight:700;margin-bottom:18px;">D</div>' +
      '<div id="dnk-boot-title" style="font-size:17px;font-weight:600;margin-bottom:8px;">Connecting to school database…</div>' +
      '<div id="dnk-boot-msg" style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.6;">Loading the latest records from Supabase.</div>' +
      '<div id="dnk-boot-actions" style="margin-top:20px;"></div>' +
    '</div>';

  function onReady(fn) {
    if (document.body) return fn();
    document.addEventListener("DOMContentLoaded", fn);
  }
  onReady(function () { document.body.appendChild(splash); });

  function setState(title, msg, actionsHtml) {
    onReady(function () {
      var t = document.getElementById("dnk-boot-title");
      var m = document.getElementById("dnk-boot-msg");
      var a = document.getElementById("dnk-boot-actions");
      if (t) t.textContent = title;
      if (m) m.innerHTML = msg;
      if (a) a.innerHTML = actionsHtml || "";
    });
  }

  function removeSplash() {
    onReady(function () {
      var el = document.getElementById("dnk-boot-splash");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  // ---- Load app.js once hydration has settled -----------------------------
  //
  // app.js registers 21 DOMContentLoaded listeners and 1 load listener AT
  // PARSE TIME — its entire startup (school branding, session restore, the
  // portal chooser, nav guards, the Parent/Student portal restores) hangs off
  // them. We inject it after an async fetch, so by then both events have
  // normally already fired and every one of those listeners would be dead on
  // arrival: the app would render a bare shell and throw.
  //
  // So the two lifecycle events are re-dispatched once app.js has parsed.
  // Third-party libraries loaded earlier in the page may see them a second
  // time; they are all passive (xlsx, chart.js, qrcode, JsBarcode,
  // html2canvas, supabase-js) or idempotent DOM scanners (the Tailwind
  // browser build), so a repeat is harmless. Nothing in app.js has run yet at
  // this point, so its own listeners fire exactly once.
  function replayLifecycle() {
    // Still parsing: the real events are yet to come, so leave them alone.
    if (document.readyState === "loading") return;
    try {
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: false, cancelable: false }));
    } catch (e) { console.error("[SupabaseBoot] DOMContentLoaded replay failed", e); }
    try {
      window.dispatchEvent(new Event("load"));
    } catch (e) { console.error("[SupabaseBoot] load replay failed", e); }
  }

  var _appLoaded = false;
  function loadApp() {
    if (_appLoaded) return;
    _appLoaded = true;
    var s = document.createElement("script");
    s.src = APP_SRC;
    s.onload = function () {
      replayLifecycle();
      removeSplash();
    };
    s.onerror = function () {
      setState("Could not load the application",
        "js/app.js failed to load. Check that the file exists and reload the page.", "");
    };
    onReady(function () { document.body.appendChild(s); });
  }

  function retryButton() {
    return '<button onclick="location.reload()" style="background:#c9973a;color:#fff;border:none;' +
           'border-radius:8px;padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;">Retry</button>';
  }

  // ---- Hydrate ------------------------------------------------------------
  if (!configured()) {
    // No credentials: this is a genuine local-only deployment, not a failed
    // sync, so booting on localStorage is correct rather than dangerous.
    console.warn("[SupabaseBoot] Not configured — starting in local-only mode.");
    loadApp();
    return;
  }

  var endpoint = URL_BASE + "/rest/v1/" + TABLE + "?select=storage_key,payload";

  fetch(endpoint, {
    headers: {
      "apikey": ANON_KEY,
      "Authorization": "Bearer " + ANON_KEY,
      "Accept": "application/json",
      // Ask for the true row count so a truncated response can be detected.
      "Prefer": "count=exact"
    }
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (body) {
        throw new Error("HTTP " + res.status + " " + res.statusText + (body ? (" — " + body) : ""));
      });
    }
    // PostgREST caps responses when db-max-rows is configured, and it does so
    // SILENTLY — a 200 with fewer rows than exist. Hydrating a short list is
    // the worst possible outcome: the missing keys look empty to the app, and
    // the first save overwrites them in Supabase. Compare the returned count
    // against the Content-Range total and refuse to boot if they disagree.
    var range = res.headers.get("content-range"); // e.g. "0-48/49"
    var total = null;
    if (range && range.indexOf("/") > -1) {
      var t = range.split("/")[1];
      if (t && t !== "*") total = parseInt(t, 10);
    }
    return res.json().then(function (rows) {
      if (total !== null && rows && rows.length < total) {
        throw new Error("Server returned only " + rows.length + " of " + total +
          " records (response truncated). Refusing to start on partial data.");
      }
      return rows;
    });
  }).then(function (rows) {
    var written = 0, skipped = 0;
    (rows || []).forEach(function (row) {
      if (!row || !row.storage_key) return;
      try {
        // payload is jsonb. localStorage holds JSON text, and
        // Dnyanankur.Storage.get() JSON.parse()s it back, so stringifying
        // here round-trips objects, arrays, numbers and strings correctly.
        localStorage.setItem(row.storage_key, JSON.stringify(row.payload));
        written++;
      } catch (e) {
        // Quota or serialisation failure on one key — keep going; a partial
        // cache is still better than none, and the count is surfaced below.
        skipped++;
        console.error("[SupabaseBoot] Could not cache key: " + row.storage_key, e);
      }
    });

    window.DNK_HYDRATION = { ok: true, keys: written, skipped: skipped, at: new Date().toISOString() };
    console.info("[SupabaseBoot] Hydrated " + written + " keys from Supabase" +
                 (skipped ? (" (" + skipped + " skipped)") : "") + ".");

    if (skipped) {
      setState("Loaded with warnings",
        skipped + " record group(s) could not be cached locally. The app will start, " +
        "but those sections may be incomplete.", "");
    }
    loadApp();
  }).catch(function (err) {
    console.error("[SupabaseBoot] Hydration failed", err);
    window.DNK_HYDRATION = { ok: false, error: String(err && err.message || err) };

    setState(
      "Cannot reach the school database",
      "The app has been stopped on purpose. Starting now would show outdated records, " +
      "and saving anything could overwrite newer data in Supabase.<br><br>" +
      "Check your internet connection and try again.<br><br>" +
      '<span style="color:rgba(255,255,255,.4);font-size:11.5px;">' +
      String(err && err.message || err).replace(/[<>&]/g, "") + "</span>",
      retryButton()
    );
  });
})();


