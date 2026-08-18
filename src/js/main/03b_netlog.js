// ═══════════════════════════════════════════════════════════════════
// 03b_netlog.js — v5.04 CONNECTION FAILURE TELEMETRY
//
// WHY THIS EXISTS
// Kathryn, 2026-08-18: a red "can't connect" banner on cellular data,
// with a COMPLETELY CLEAN Apps Script executions log. Other doctors saw
// the same thing that morning. Nothing in the log because Apps Script
// only records runs it actually starts — a request that never arrived,
// or whose response was lost on the way back (Apps Script 302-redirects
// its payload to *.googleusercontent.com; that second leg can drop on a
// mobile network while doGet logs a clean "Completed"), leaves no trace
// server-side at all.
//
// The app already knew exactly what failed — window._lastSyncError and a
// checkpoint trail — but nothing ever displayed or transmitted it.
//
// THREE THINGS THIS MODULE ADDS
//   1. Every network failure is recorded locally with full context
//      (checkpoint, error name, HTTP status, attempt #, whether the
//      auto-retry rescued it, connection type, downlink, doctor).
//   2. The buffer is flushed to the "Client Errors" sheet on the NEXT
//      SUCCESSFUL sync. Deferred on purpose — at the moment of failure
//      the network is exactly what is broken, so logging live would just
//      fail too. Nothing is asked of the user.
//   3. If it never flushes (device stays offline / app closed), the red
//      banner carries a "Report" button that opens a pre-filled email.
//      Belt and braces.
//
// READING THE SHEET: the column that answers the question is `recovered`.
//   recovered=TRUE in bulk  → transient transport drop (the redirect-leg
//                             theory). Users now never see these.
//   recovered=FALSE + errName=AbortError → genuinely slow/hung backend.
//   recovered=FALSE + httpStatus 429/500/502/503 → Google-side quota or
//                             outage; correlate ts with the exec log.
//   online=false            → the device really had no signal.
// ═══════════════════════════════════════════════════════════════════

var NETLOG_KEY      = 'kgh5:netlog';
var NETLOG_MAX      = 40;      // ring buffer — oldest dropped past this
var NETLOG_REPORTTO = 'kathrynb77@gmail.com';   // "Report" button destination
var _netlogFlushing = false;   // recursion guard: a failed flush must never log itself

// Stable per-load id so multi-attempt sequences group in the sheet.
var NETLOG_SESSION = 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _netlogRead() {
  try {
    var raw = localStorage.getItem(NETLOG_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _netlogWrite(arr) {
  try { localStorage.setItem(NETLOG_KEY, JSON.stringify(arr.slice(-NETLOG_MAX))); } catch (e) {}
}

// Connection context, defended on every field — navigator.connection is
// absent on iOS Safari, so these are usually blank there. Still worth
// capturing: Android/Chrome users fill them in, and the blanks themselves
// identify the platform.
function _netlogConn() {
  var c = {};
  try {
    var n = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    c.connType  = String(n.effectiveType || '');
    c.downlink  = (n.downlink  != null) ? String(n.downlink)  : '';
    c.rtt       = (n.rtt       != null) ? String(n.rtt)       : '';
    c.saveData  = (n.saveData  != null) ? String(n.saveData)  : '';
  } catch (e) {}
  try { c.online = String(navigator.onLine !== false); } catch (e) { c.online = ''; }
  try { c.vis    = String(document.visibilityState || ''); } catch (e) { c.vis = ''; }
  return c;
}

function _netlogDoctor() {
  try {
    var d = (typeof st !== 'undefined' && st) ? st.doc : null;
    if (!d) return '';
    if (typeof d === 'object') return String(d.alias || d.name || '');
    return String(d);
  } catch (e) { return ''; }
}

// Classify a thrown fetch error / response into a stable short code.
// This is what makes the sheet groupable — free-text messages differ per
// browser ("Load failed" on Safari, "Failed to fetch" on Chrome, both
// meaning the same thing).
function netlogClassify(err, resp) {
  if (resp && !resp.ok) return 'http_' + resp.status;
  if (!err) return 'unknown';
  var name = String(err.name || '');
  var msg  = String(err.message || err || '');
  if (name === 'AbortError')                   return 'timeout';
  try { if (navigator.onLine === false)        return 'offline'; } catch (e) {}
  if (name === 'TypeError' ||
      /failed to fetch|load failed|networkerror|network request/i.test(msg)) return 'transport';
  if (/json/i.test(msg))                       return 'bad_json';
  return 'other';
}

// Plain-English text for a code. Used for the banner AND the email so the
// two never drift apart.
function netlogExplain(code) {
  if (code === 'offline')   return "You're offline — the app will resync when signal returns";
  if (code === 'timeout')   return 'Server took too long to answer — tap Retry';
  if (code === 'transport') return 'Connection dropped before the server replied — tap Retry';
  if (code === 'bad_json')  return 'Server sent an unreadable reply — tap Retry';
  if (code && code.indexOf('http_') === 0) return 'Server error ' + code.slice(5) + ' — tap Retry';
  if (code === 'rejected')  return 'Server rejected the request — tap Report';
  return "Can't reach the server — tap Retry";
}

// ── The recorder ───────────────────────────────────────────────────
// kind:   'sync' | 'push' | 'init'
// detail: { action, checkpoint, code, errName, errMsg, httpStatus,
//           attempt, recovered, durationMs }
// Returns the record so callers can hold it for the banner.
function netlogRecord(kind, detail) {
  // NOTE: deliberately NOT gated on _netlogFlushing. The first draft was,
  // to "never log the logger" — but netlogFlush contains no netlogRecord
  // call, so there was nothing to guard against, and the gate silently
  // DROPPED every failure that happened during a flush. That window is
  // when syncFromSheets replays _pendingPush writes, i.e. exactly the
  // most diagnostic events available.
  var d = detail || {};
  var rec = {
    ts:         new Date().toISOString(),
    session:    NETLOG_SESSION,
    kind:       String(kind || ''),
    action:     String(d.action     || ''),
    checkpoint: String(d.checkpoint || ''),
    code:       String(d.code       || ''),
    errName:    String(d.errName    || ''),
    errMsg:     String(d.errMsg     || '').slice(0, 300),
    httpStatus: (d.httpStatus != null) ? String(d.httpStatus) : '',
    attempt:    String(d.attempt   != null ? d.attempt : 1),
    recovered:  String(!!d.recovered),
    durationMs: (d.durationMs != null) ? String(Math.round(d.durationMs)) : '',
    appVersion: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '',
    doctor:     _netlogDoctor()
  };
  var c = _netlogConn();
  for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) rec[k] = c[k]; }
  try { rec.ua = String(navigator.userAgent || '').slice(0, 160); } catch (e) { rec.ua = ''; }

  var buf = _netlogRead();
  buf.push(rec);
  _netlogWrite(buf);
  window._netlogLast = rec;
  try { console.warn('[netlog] ' + rec.kind + '/' + rec.action + ' ' + rec.code +
                     ' attempt ' + rec.attempt + (d.recovered ? ' → RECOVERED' : ''), rec); } catch (e) {}
  return rec;
}

// ── Deferred central flush ─────────────────────────────────────────
// Called from syncFromSheets the moment a sync completes cleanly, i.e.
// the exact moment we know the network is working again. Fire-and-forget:
// a flush that fails leaves the buffer intact for the next sync, and is
// itself never logged (guard above), so this can never storm.
function netlogFlush() {
  if (_netlogFlushing) return;
  if (typeof SHEETS_URL === 'undefined' || !SHEETS_URL) return;
  var buf = _netlogRead();
  if (!buf.length) return;
  _netlogFlushing = true;
  var batch = buf.slice(0, NETLOG_MAX);
  var sentN = batch.length;

  // A flush that HANGS (rather than errors) is the realistic failure on a
  // stalled mobile link — and without a timeout it would leave
  // _netlogFlushing stuck true, blocking every later flush for the rest of
  // the session. Same 20s abort used everywhere else.
  var fCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var fTid  = setTimeout(function () { if (fCtrl) fCtrl.abort(); }, 20000);
  var done  = function () { clearTimeout(fTid); _netlogFlushing = false; };

  var opts = { method: 'POST', body: JSON.stringify({ events: batch }) };
  if (fCtrl) opts.signal = fCtrl.signal;

  fetch(SHEETS_URL + '?action=logClientErrors&key=' + SHARED_KEY, opts)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);   // transport-ish → keep buffer
      return r.json();
    })
    .then(function (d) {
      if (d && d.ok) {
        // Drop exactly what we sent, by COUNT off the front — anything
        // recorded while this was in flight is at the tail and survives.
        var now = _netlogRead();
        _netlogWrite(now.slice(sentN));
        try { console.log('[netlog] flushed ' + sentN + ' event(s)'); } catch (e) {}
        return;
      }
      // A definitive server reply that is not ok:true will say the same
      // thing forever — an old Router with no logClientErrors action (the
      // partial-rollout case: frontend on GitHub Pages before the Apps
      // Script deploy), or {error:'unauthorized'} on a stale password.
      // The first draft kept the buffer on ANY non-ok reply, which meant
      // every phone re-POSTing a 25KB body on every sync, forever. Only a
      // transient marker earns a retry; anything else is dropped.
      if (d && d.transient) return;                      // keep, try next sync
      var now2 = _netlogRead();
      _netlogWrite(now2.slice(sentN));
      try { console.warn('[netlog] server refused the batch — dropped ' + sentN +
                         ' event(s):', d && d.error); } catch (e) {}
    })
    .catch(function () {
      // Transport failure or abort. Buffer untouched; next good sync retries.
    })
    .then(done, done);
}

// ── Human-readable dump, for the email ─────────────────────────────
function netlogSummary(maxEvents) {
  var buf = _netlogRead();
  var n   = maxEvents || 6;
  var recent = buf.slice(-n);
  var lines = [];
  lines.push('App: ' + ((typeof APP_VERSION !== 'undefined') ? APP_VERSION : '?') +
             '  Doctor: ' + (_netlogDoctor() || '(not signed in)'));
  lines.push('Session: ' + NETLOG_SESSION);
  lines.push('Local time: ' + new Date().toString());
  lines.push('Buffered events: ' + buf.length + ' (showing last ' + recent.length + ')');
  lines.push('');
  if (!recent.length) lines.push('(no failures recorded)');
  recent.forEach(function (r, i) {
    lines.push('--- ' + (i + 1) + ' ---');
    lines.push('when      : ' + r.ts);
    lines.push('what      : ' + r.kind + (r.action ? ' / ' + r.action : ''));
    lines.push('cause     : ' + r.code + (r.httpStatus ? ' (HTTP ' + r.httpStatus + ')' : ''));
    lines.push('checkpoint: ' + r.checkpoint);
    lines.push('error     : ' + r.errName + ' ' + r.errMsg);
    lines.push('attempt   : ' + r.attempt + '   recovered: ' + r.recovered +
               (r.durationMs ? '   took: ' + r.durationMs + 'ms' : ''));
    lines.push('network   : online=' + r.online + ' type=' + (r.connType || 'n/a') +
               ' downlink=' + (r.downlink || 'n/a') + ' rtt=' + (r.rtt || 'n/a') +
               ' tab=' + (r.vis || 'n/a'));
    lines.push('device    : ' + (r.ua || ''));
  });
  return lines.join('\n');
}

// ── "Report to KB" ─────────────────────────────────────────────────
// Sends itself. No mail app, no typing, no dialog — one tap and it is gone.
// The direct POST is the primary path: it carries the FULL buffer and the
// backend emails KB straight away. The mailto is only the last resort for a
// device that still has no usable connection, because in that state there is
// nothing else left to try.
//
// Note the ordering: this is a Retry as well as a Report. If the tap succeeds,
// the doctor has just proved the network is back, and the buffer goes out
// with it.
function netlogReport() {
  var btn = document.getElementById('wifi-banner-report');
  var restore = function (label) {
    if (btn) { btn.disabled = false; btn.textContent = label || 'Report to KB'; }
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  var buf = _netlogRead();
  if (!buf.length && window._netlogLast) buf = [window._netlogLast];
  if (!buf.length) {
    restore();
    try { showToast('Nothing to report — no failures recorded'); } catch (e) {}
    return;
  }
  var sentN = Math.min(buf.length, NETLOG_MAX);

  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var tid  = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
  var opts = {
    method: 'POST',
    // notify:true => backend emails KB immediately, bypassing the hourly
    // throttle. A doctor who bothered to tap the button is telling us this
    // one matters.
    body: JSON.stringify({ events: buf.slice(-NETLOG_MAX), notify: true,
                           note: 'Sent by ' + (_netlogDoctor() || 'an unidentified device') +
                                 ' from the error banner' })
  };
  if (ctrl) opts.signal = ctrl.signal;

  fetch(SHEETS_URL + '?action=logClientErrors&key=' + SHARED_KEY, opts)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      clearTimeout(tid);
      if (!(d && d.ok)) throw new Error((d && d.error) || 'refused');
      // Delivered — drop exactly what we sent, by count off the front, so
      // anything recorded during the 15s flight survives to the next flush
      // (same accounting netlogFlush uses).
      _netlogWrite(_netlogRead().slice(sentN));
      restore('Reported ✓');
      try { showToast('Reported to KB — thank you'); } catch (e) {}
    })
    .catch(function () {
      clearTimeout(tid);
      // Still no usable connection. Fall back to the pre-filled email so the
      // information is not lost — the doctor still types nothing, they just
      // have to press send in their mail app.
      restore();
      _netlogMailtoFallback();
    });
}

// Last resort only. Body is capped — some mail clients silently truncate very
// long mailto URLs, so 4 events is the safe payload; the rest still reach the
// sheet whenever a sync next succeeds.
function _netlogMailtoFallback() {
  var body = netlogSummary(4) +
             '\n\n(Anything else worth noting — what you were doing at the time?)\n';
  var subj = 'Billing app — connection problem ' +
             ((typeof APP_VERSION !== 'undefined') ? APP_VERSION : '') +
             ' — ' + ((window._netlogLast && window._netlogLast.code) || 'unknown');
  var href = 'mailto:' + NETLOG_REPORTTO +
             '?subject=' + encodeURIComponent(subj) +
             '&body='    + encodeURIComponent(body);
  try {
    showToast('Still offline — opening an email you can send when signal returns', 'error');
  } catch (e) {}
  try {
    window.location.href = href;
  } catch (e) {
    try { console.log(netlogSummary(20)); } catch (e2) {}
  }
}

// ── Shared retry helper ────────────────────────────────────────────
// ONE extra attempt, ~1.2s apart with jitter. Deliberately not more:
// the failure being targeted is a single dropped leg, and a doctor on
// rounds should not wait through an exponential ladder. Both attempts
// are recorded, so the sheet shows how often attempt 2 saves the day.
//
// SAFETY: only ever wrap requests that are safe to repeat. Reads always
// are. Writes only if the backend upserts by key (saveRow-by-id), because
// a "transport" failure may mean the write DID land and only the reply
// was lost — replaying an append-only action would duplicate the row.
var NETLOG_RETRY_DELAY_MS = 1200;

function _netlogSleep(ms) {
  return new Promise(function (res) { setTimeout(res, ms + Math.floor(Math.random() * 300)); });
}

// Codes where a second try has a real chance. A 4xx or a server-side
// rejection will fail identically, so those go straight to the banner.
function netlogWorthRetry(code) {
  if (code === 'transport' || code === 'timeout' || code === 'bad_json') return true;
  if (code && code.indexOf('http_5') === 0) return true;   // 500/502/503/504
  // NOT http_429. A 429 means the Google-side quota is already spent;
  // retrying 1.2s later cannot succeed and doubles the load from every
  // phone at once — which would lengthen the very outage this is meant
  // to diagnose. Logged, surfaced, not retried.
  return false;
}

// ── Which writes are safe to replay ────────────────────────────────
// A 'transport' failure is ambiguous: the request may have reached the
// server and only the REPLY was lost. Replaying is therefore only safe
// for actions the backend upserts by key — saveRow(sheet, body, 'id')
// and saveGapNote (keyed phn|date) overwrite the same row, so a second
// delivery is a no-op. Everything append-only (logChange, logOCR*,
// logRoomDetection, saveHistorical, addPhysician) is DELIBERATELY absent:
// retrying those would duplicate audit rows. They keep the old behaviour
// — one attempt, and _pendingPush retries them on the next sync cycle.
//
// ⚠️ REVIEW FINDING, 18/08 — saveRef and saveDoctor were on this list in the
// first draft and had to come OFF. Crud saveRow() takes the script lock and
// flushes ONLY for 'Claims' and 'Patients' (Crud v3.15 line 548:
// `if (sheetName === 'Claims' || sheetName === 'Patients')`). For Referrers
// and Doctors the lock is null, the "re-check rowIdx now that we hold the
// lock" line is skipped, and SpreadsheetApp.flush() never runs — so attempt
// 2 can call findRowIndex before attempt 1's append has committed, miss it,
// and append a SECOND row with the same id/alias. Upsert-by-key is only
// idempotent when the read-modify-write is serialized. It is not, here.
var NETLOG_IDEMPOTENT = {
  savePatient: 1, saveClaim: 1, saveGapNote: 1,
  deletePatient: 1, deleteClaim: 1
};

// ── Throttled variant, for high-frequency probes ───────────────────
// The 30s keep-alive ping is the app's best network sensor — it runs all
// day, silently, and is the first thing to notice a bad patch of signal.
// But an unthrottled recorder would let one 20-minute dead zone flush the
// entire 40-slot ring with identical ping rows and push the interesting
// sync/push failures out. One row per code per 5 min keeps the signal
// (when it started, when it stopped, which doctor, which hour) without
// the noise.
var _netlogThrottle  = {};
var _netlogSuppressed = {};   // PER KEY — a global counter misattributed the
                              // volume of one outage to whatever cause
                              // happened to be recorded next, which is
                              // precisely the column clientErrorReport_ reads.
function netlogRecordThrottled(kind, detail, everyMs) {
  var d   = detail || {};
  var key = kind + '|' + (d.action || '') + '|' + (d.code || '');
  var now = Date.now();
  var win = everyMs || (5 * 60 * 1000);
  if (_netlogThrottle[key] && (now - _netlogThrottle[key]) < win) {
    _netlogSuppressed[key] = (_netlogSuppressed[key] || 0) + 1;
    return null;
  }
  _netlogThrottle[key] = now;
  // Carry the suppressed count so the sheet never implies a single blip
  // when it was actually a sustained outage.
  if (_netlogSuppressed[key]) {
    d.errMsg = String(d.errMsg || '') + ' [+' + _netlogSuppressed[key] + ' suppressed since last]';
    _netlogSuppressed[key] = 0;
  }
  return netlogRecord(kind, d);
}
