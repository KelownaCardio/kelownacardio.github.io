// 11_export.js — export queue helpers (CSV export removed v3.75;
//   all CSV generation handled by Google Sheets Apps Script)
// ═══════════════════════════════════════════════════════

function purgeSubmittedClaims() {
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-90);
  var cutoffStr = cutoff.toISOString().slice(0,10);
  var before = st.claims.length;
  st.claims = st.claims.filter(function(c) {
    if (!parseBool(c.submitted)) return true;
    if (!c.submittedAt) return true;
    return c.submittedAt.slice(0,10) >= cutoffStr;
  });
  if (st.claims.length < before) sv('claims', st.claims);
}

function removeClaim(id) {
  st.claims = st.claims.filter(function(c) { return c.id !== id; });
  sv('claims', st.claims);
}

function clearQueue() {
  st.claims = [];
  sv('claims', st.claims);
  showToast('Queue cleared');
}

// ═══════════════════════════════════════════════════════
// LEADERBOARD — retro arcade high-score board
// ═══════════════════════════════════════════════════════
//
// Three categories, each showing top-3 single-day records:
//   1. CCU Admissions   — most 1411 claims in one service date
//   2. Consults         — most 33010 + 33012 + 1411 in one service date
//   3. High Roller      — highest SUM(feeAmount × units) in one day
//
// Data: fetched from Apps Script → BigQuery (getLeaderboard route).
// UI:   self-injecting CSS + HTML so no template change is needed.

var _lbInjected = false;
var _lbData     = null;   // cached response from backend
var _lbLoading  = false;

// ── Doctor alias → 3-char arcade initials ────────────
var LB_INITIALS = {
  'KBrown':'KBR', 'DPatton':'DPT', 'FH':'F·H', 'JW':'J·W',
  'LH':'L·H', 'SB':'S·B', 'ASodhi':'ASO', 'EMMassie':'EMM',
  'KHoskin':'KHO', 'AKhosla':'AKH', 'AK':'A·K', 'KT':'JKT', 'KP':'K·P'
};

function _lbInitials(alias) {
  if (LB_INITIALS[alias]) return LB_INITIALS[alias];
  // Fallback: first 3 chars uppercased
  var s = String(alias || '???').toUpperCase();
  return s.length >= 3 ? s.slice(0,3) : (s + '···').slice(0,3);
}

// ── CSS — injected once on first open ────────────────
var LB_CSS =
  '.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:200;' +
    'display:none;flex-direction:column;align-items:center;overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch}' +
  '.lb-overlay.open{display:flex}' +

  /* CRT scanlines */
  '.lb-scan{position:fixed;inset:0;pointer-events:none;z-index:201;' +
    'background:repeating-linear-gradient(0deg,transparent,transparent 2px,' +
    'rgba(0,255,0,.035) 2px,rgba(0,255,0,.035) 4px)}' +

  /* CRT vignette */
  '.lb-vignette{position:fixed;inset:0;pointer-events:none;z-index:201;' +
    'background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.5) 100%)}' +

  '.lb-screen{width:100%;max-width:420px;padding:24px 16px 40px;position:relative;z-index:201}' +

  /* Power-on flicker */
  '@keyframes lb-poweron{0%{opacity:0}5%{opacity:.8}10%{opacity:.2}' +
    '20%{opacity:.9}30%{opacity:.4}50%{opacity:1}100%{opacity:1}}' +
  '.lb-screen.animating{animation:lb-poweron .6s ease-out}' +

  /* Title */
  '.lb-title{font-family:"Courier New",Courier,monospace;font-size:22px;font-weight:900;' +
    'text-align:center;color:#0f0;text-shadow:0 0 10px #0f0,0 0 20px #0f0,0 0 40px #080;' +
    'letter-spacing:4px;margin-bottom:2px;text-transform:uppercase}' +
  '.lb-subtitle{font-family:"Courier New",monospace;font-size:10px;text-align:center;' +
    'color:#0a0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase}' +

  /* Category headers */
  '.lb-cat{margin-bottom:22px}' +
  '.lb-cat-hdr{font-family:"Courier New",monospace;font-size:12px;font-weight:700;' +
    'color:#ff0;text-shadow:0 0 8px rgba(255,255,0,.6);letter-spacing:2px;text-align:center;' +
    'text-transform:uppercase;border-top:1px solid #333;border-bottom:1px solid #333;' +
    'padding:6px 0;margin-bottom:2px}' +

  /* Category subtitles */
  '.lb-cat-sub{font-family:"Courier New",monospace;font-size:9px;color:#070;' +
    'text-align:center;letter-spacing:1px;margin-bottom:8px;text-transform:uppercase}' +

  /* Score rows */
  '.lb-row{display:flex;align-items:center;padding:5px 2px;gap:6px}' +
  '.lb-medal{font-size:20px;width:30px;text-align:center;flex-shrink:0}' +
  '.lb-ini{font-family:"Courier New",monospace;font-size:17px;color:#0f0;' +
    'text-shadow:0 0 6px #0f0;letter-spacing:3px;font-weight:700;width:60px}' +
  '.lb-dots{flex:1;font-family:"Courier New",monospace;font-size:12px;color:#040;' +
    'overflow:hidden;white-space:nowrap;letter-spacing:2px}' +
  '.lb-score{font-family:"Courier New",monospace;font-size:17px;color:#fff;' +
    'text-align:right;font-weight:700;text-shadow:0 0 4px rgba(255,255,255,.5);' +
    'white-space:nowrap}' +
  '.lb-date{font-family:"Courier New",monospace;font-size:9px;color:#070;' +
    'text-align:right;margin-top:1px;letter-spacing:1px}' +
  '.lb-score-wrap{text-align:right;flex-shrink:0}' +

  /* Empty / loading / error */
  '.lb-msg{font-family:"Courier New",monospace;font-size:12px;text-align:center;' +
    'padding:16px;color:#0a0}' +
  '.lb-loading{animation:lb-blink 1s infinite}' +
  '@keyframes lb-blink{0%,100%{opacity:1}50%{opacity:.3}}' +
  '.lb-err{color:#f44;text-shadow:0 0 6px #f00}' +

  /* Retry button */
  '.lb-retry{font-family:"Courier New",monospace;color:#0f0;border:1px solid #0f0;' +
    'background:transparent;padding:6px 18px;margin-top:12px;cursor:pointer;' +
    'font-size:12px;letter-spacing:1px;border-radius:2px}' +
  '.lb-retry:active{background:#0f0;color:#000}' +

  /* Close button */
  '.lb-close{position:fixed;top:14px;right:14px;z-index:202;width:36px;height:36px;' +
    'border-radius:50%;border:2px solid #0f0;background:rgba(0,0,0,.8);color:#0f0;' +
    'font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'text-shadow:0 0 6px #0f0;font-family:"Courier New",monospace}' +
  '.lb-close:active{background:#0f0;color:#000}' +

  /* Footer */
  '.lb-footer{font-family:"Courier New",monospace;font-size:10px;color:#040;' +
    'text-align:center;letter-spacing:3px;margin-top:20px;text-transform:uppercase}' +

  /* Refresh link */
  '.lb-refresh{font-family:"Courier New",monospace;font-size:10px;color:#0a0;' +
    'text-align:center;cursor:pointer;margin-top:8px;letter-spacing:1px;' +
    'text-decoration:underline;text-underline-offset:2px}' +
  '.lb-refresh:active{color:#0f0}' +

  /* Trophy header button */
  '.lb-trophy-btn{display:flex;align-items:center;justify-content:center;' +
    'width:30px;height:30px;border:.5px solid var(--border2);border-radius:50%;' +
    'cursor:pointer;background:var(--surface);font-size:15px;' +
    'transition:border-color .15s,background .15s}' +
  '.lb-trophy-btn:active{border-color:var(--amber-t);background:var(--amber-bg)}';


// ── HTML — the modal shell ───────────────────────────
function _lbModalHtml() {
  return '<div class="lb-overlay" id="lb-overlay" onclick="_lbOverlayTap(event)">' +
    '<div class="lb-scan"></div>' +
    '<div class="lb-vignette"></div>' +
    '<div class="lb-close" onclick="hideLeaderboard()">✕</div>' +
    '<div class="lb-screen" id="lb-screen">' +
      '<div class="lb-title">HIGH SCORES</div>' +
      '<div class="lb-subtitle">KGH Cardiology</div>' +
      '<div id="lb-body">' +
        '<div class="lb-msg lb-loading">LOADING···</div>' +
      '</div>' +
      '<div class="lb-footer">— 24hr clinical day —</div>' +
      '<div class="lb-refresh" onclick="fetchLeaderboard()">↻ refresh</div>' +
    '</div>' +
  '</div>';
}

// ── Inject UI into DOM — called once from init() ─────
function _injectLeaderboardUI() {
  if (_lbInjected) return;
  _lbInjected = true;

  // CSS
  var style = document.createElement('style');
  style.textContent = LB_CSS;
  document.head.appendChild(style);

  // Modal
  document.body.insertAdjacentHTML('beforeend', _lbModalHtml());

  // Trophy button in header (before doc-chip)
  var hdrRight = document.querySelector('.hdr > div:last-child');
  if (hdrRight) {
    var btn = document.createElement('div');
    btn.className = 'lb-trophy-btn';
    btn.title = 'Leaderboard';
    btn.onclick = showLeaderboard;
    btn.textContent = '\uD83C\uDFC6'; // 🏆
    hdrRight.insertBefore(btn, hdrRight.firstChild);
  }
}

// ── Show / hide ──────────────────────────────────────
function showLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  // CRT power-on animation
  var screen = document.getElementById('lb-screen');
  if (screen) {
    screen.classList.remove('animating');
    void screen.offsetWidth; // force reflow
    screen.classList.add('animating');
  }
  if (!_lbData && !_lbLoading) fetchLeaderboard();
}

function hideLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _lbOverlayTap(e) {
  // Close if tapping the dark overlay background, not the content
  if (e.target.id === 'lb-overlay') hideLeaderboard();
}

// ── Fetch from Apps Script → BigQuery ────────────────
async function fetchLeaderboard() {
  if (!SHEETS_URL) {
    _renderLbError('NO BACKEND CONNECTION');
    return;
  }
  _lbLoading = true;
  var body = document.getElementById('lb-body');
  if (body) body.innerHTML = '<div class="lb-msg lb-loading">LOADING···</div>';

  try {
    var url = SHEETS_URL + '?action=getLeaderboard&key=' + SHARED_KEY + '&_t=' + Date.now();
    var resp = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    _lbData = data;
    _renderLeaderboard(data);
  } catch(e) {
    console.warn('[Leaderboard]', e.message || e);
    _renderLbError(String(e.message || 'NETWORK ERROR').toUpperCase());
  } finally {
    _lbLoading = false;
  }
}

// ── Render the three categories ──────────────────────
var LB_MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49']; // 🥇🥈🥉
var LB_RANK_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

function _renderLeaderboard(data) {
  var body = document.getElementById('lb-body');
  if (!body) return;

  var html = '';
  html += _renderCategory('\u2764\uFE0F HIGH ACUITY', 'Most CCU admissions in 24hrs', data.ccuAdmits || [], false);
  html += _renderCategory('\uD83D\uDC1D BUSY BEE', 'Most consults in 24hrs', data.consults || [], false);
  html += _renderCategory('\uD83D\uDCB0 THE TAX MAN COMETH', 'Highest $ billed in 24hrs', data.revenue || [], true);

  if (!html) html = '<div class="lb-msg">NO DATA YET — CHECK BACK AFTER SUNDAY SYNC</div>';
  body.innerHTML = html;
}

function _renderCategory(title, subtitle, rows, isDollar) {
  if (!rows.length) {
    return '<div class="lb-cat">' +
      '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
      '<div class="lb-cat-sub">' + esc(subtitle) + '</div>' +
      '<div class="lb-msg">— NO ENTRIES —</div>' +
    '</div>';
  }
  var html = '<div class="lb-cat">' +
    '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
    '<div class="lb-cat-sub">' + esc(subtitle) + '</div>';
  for (var i = 0; i < rows.length && i < 3; i++) {
    var r = rows[i];
    // Each row: [billingDoc, serviceDate (DD/MM/YYYY), count_or_amount]
    var alias = r[0] || '???';
    var dt    = r[1] || '';
    var score = isDollar
      ? ('$' + Number(r[2] || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}))
      : String(r[2] || 0);
    var ini   = _lbInitials(alias);

    html += '<div class="lb-row">' +
      '<div class="lb-medal">' + LB_MEDALS[i] + '</div>' +
      '<div class="lb-ini">' + esc(ini) + '</div>' +
      '<div class="lb-dots">·····················</div>' +
      '<div class="lb-score-wrap">' +
        '<div class="lb-score">' + esc(score) + '</div>' +
        '<div class="lb-date">' + esc(dt) + '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
}

function _renderLbError(msg) {
  var body = document.getElementById('lb-body');
  if (!body) return;
  body.innerHTML =
    '<div class="lb-msg lb-err">' + esc(msg) + '</div>' +
    '<div style="text-align:center">' +
      '<button class="lb-retry" onclick="fetchLeaderboard()">↻ RETRY</button>' +
    '</div>';
}
