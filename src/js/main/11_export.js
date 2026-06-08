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
// QuikChart export — patient list for QuikChart MD AI scribe
// Generates a print-ready page with patient name, DOB, PHN,
// sex, and appointment time. User prints / saves as PDF.
// ═══════════════════════════════════════════════════════

var _qcListMode = 'on';   // 'on' | 'off'
var _qcCcuOrder = 'desc'; // 'desc' | 'asc'

function openQuikChartExport() {
  _qcListMode = 'on';
  _qcCcuOrder = 'desc';
  _qcRenderModal();
  showModal('qc-modal');
}

function _qcRenderModal() {
  var html = '';
  // List mode pills
  html += '<div style="margin-bottom:12px">';
  html += '<label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Patient list</label>';
  html += '<div class="fl" style="gap:6px">';
  html += '<button class="ap-list-pill' + (_qcListMode === 'on'  ? ' on' : '') + '" onclick="_qcSetList(\'on\')">On Service</button>';
  html += '<button class="ap-list-pill' + (_qcListMode === 'off' ? ' on' : '') + '" onclick="_qcSetList(\'off\')">Off Service</button>';
  html += '</div></div>';

  // CCU order pills (only for on-service)
  if (_qcListMode === 'on') {
    html += '<div style="margin-bottom:12px">';
    html += '<label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">CCU bed order</label>';
    html += '<div class="fl" style="gap:6px">';
    html += '<button class="ap-list-pill' + (_qcCcuOrder === 'desc' ? ' on' : '') + '" onclick="_qcSetCcu(\'desc\')">Descending (8→1)</button>';
    html += '<button class="ap-list-pill' + (_qcCcuOrder === 'asc'  ? ' on' : '') + '" onclick="_qcSetCcu(\'asc\')">Ascending (1→8)</button>';
    html += '</div></div>';
  }

  // Patient count preview
  var pts = _qcGetPatients();
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding:8px 10px;background:var(--surface2);border-radius:var(--rsm)">';
  html += '<b>' + pts.length + '</b> patient' + (pts.length !== 1 ? 's' : '') + ' will be exported';
  if (_qcListMode === 'on' && pts.length > 0) {
    var wards = {};
    pts.forEach(function(p) { var w = p.ward || 'Other'; wards[w] = (wards[w] || 0) + 1; });
    var bits = [];
    Object.keys(wards).forEach(function(w) { bits.push(w + ': ' + wards[w]); });
    html += ' (' + bits.join(', ') + ')';
  }
  html += '</div>';

  // Export button
  html += '<button class="btn btn-p" style="width:100%" onclick="_qcGenerate()"' +
          (pts.length === 0 ? ' disabled style="width:100%;opacity:.4;pointer-events:none"' : '') +
          '>Export PDF</button>';

  document.getElementById('qc-content').innerHTML = html;
}

function _qcSetList(mode) {
  _qcListMode = mode;
  _qcRenderModal();
}

function _qcSetCcu(order) {
  _qcCcuOrder = order;
  _qcRenderModal();
}

function _qcGetPatients() {
  var list = _qcListMode;
  return st.patients.filter(function(p) {
    return p.list === list && !p.discharged;
  });
}

function _qcSortOnService(pts) {
  var WARD_PRI = { 'CCU': 0, '2S': 1, '2W': 2 };
  var ccuOrder = _qcCcuOrder;

  return pts.slice().sort(function(a, b) {
    var wA = String(a.ward || '');
    var wB = String(b.ward || '');
    var priA = WARD_PRI[wA] != null ? WARD_PRI[wA] : 3;
    var priB = WARD_PRI[wB] != null ? WARD_PRI[wB] : 3;

    if (priA !== priB) return priA - priB;

    if (priA === 3) {
      if (wA !== wB) return wA.localeCompare(wB);
      return _qcBedCompare(a.bed, b.bed, 'asc');
    }

    var bedOrder = (wA === 'CCU') ? ccuOrder : 'asc';
    return _qcBedCompare(a.bed, b.bed, bedOrder);
  });
}

function _qcBedCompare(bedA, bedB, order) {
  var nA = parseInt(String(bedA || ''), 10);
  var nB = parseInt(String(bedB || ''), 10);
  var cmp;
  if (!isNaN(nA) && !isNaN(nB)) {
    cmp = nA - nB;
  } else {
    cmp = String(bedA || '').localeCompare(String(bedB || ''));
  }
  return order === 'desc' ? -cmp : cmp;
}

function _qcGenerate() {
  var pts = _qcGetPatients();
  if (!pts.length) { showToast('No patients to export', 'error'); return; }

  if (_qcListMode === 'on') {
    pts = _qcSortOnService(pts);
  } else {
    pts = pts.slice().sort(function(a, b) {
      return String(a.last || '').localeCompare(String(b.last || ''));
    });
  }

  var baseHour = 7, baseMin = 0;
  var rows = pts.map(function(p, i) {
    var mins = _qcListMode === 'on' ? (baseMin + i * 10) : 0;
    var h = baseHour + Math.floor(mins / 60);
    var m = mins % 60;
    var timeStr = pad(h) + ':' + pad(m);

    var dobDisplay = '';
    if (p.dob) {
      var parts = String(p.dob).split('/');
      if (parts.length === 3) {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var mm = parseInt(parts[1], 10);
        dobDisplay = parts[0] + '-' + (months[mm - 1] || parts[1]) + '-' + parts[2];
      } else {
        dobDisplay = p.dob;
      }
    }

    return {
      name: (p.last || '') + ', ' + (p.first || ''),
      dob:  dobDisplay,
      phn:  p.phn || '',
      sex:  p.sex || '',
      time: timeStr,
      ward: p.ward || '',
      bed:  p.bed  || ''
    };
  });

  var today = new Date();
  var dateStr = today.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  var listLabel = _qcListMode === 'on' ? 'On Service' : 'Off Service';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>QuikChart \u2014 ' + listLabel + ' \u2014 ' + dateStr + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,system-ui,sans-serif;margin:20px;color:#222;font-size:12px}' +
    'h1{font-size:16px;margin:0 0 4px;font-weight:800}' +
    '.subtitle{font-size:12px;color:#666;margin-bottom:14px}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;' +
    'border-bottom:2px solid #333;padding:5px 8px;font-weight:700}' +
    'td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;vertical-align:top}' +
    'tr:last-child td{border-bottom:none}' +
    '.ward-label{font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;' +
    'padding:10px 8px 4px;background:none;border:none}' +
    '.time{font-family:monospace;font-size:12px;white-space:nowrap}' +
    '.phn{font-family:monospace;letter-spacing:.5px}' +
    '@media print{body{margin:10px}h1{font-size:14px}}' +
    '@media screen{.print-hint{display:block;margin-top:16px;padding:10px;background:#f0f4ff;' +
    'border:1px solid #c8d8f0;border-radius:6px;font-size:11px;color:#336}}' +
    '</style></head><body>';

  html += '<h1>QuikChart \u2014 ' + esc(listLabel) + '</h1>';
  html += '<div class="subtitle">' + esc(dateStr);
  if (_qcListMode === 'on') {
    html += ' &middot; CCU ' + (_qcCcuOrder === 'desc' ? 'descending' : 'ascending');
  }
  html += ' &middot; ' + rows.length + ' patient' + (rows.length !== 1 ? 's' : '');
  html += '</div>';

  html += '<table><thead><tr>';
  html += '<th>Time</th><th>Name</th><th>DOB</th><th>PHN</th><th>Sex</th>';
  if (_qcListMode === 'on') html += '<th>Ward</th><th>Bed</th>';
  html += '</tr></thead><tbody>';

  var lastWard = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (_qcListMode === 'on' && r.ward !== lastWard) {
      html += '<tr><td colspan="7" class="ward-label">' + esc(r.ward || 'Other') + '</td></tr>';
      lastWard = r.ward;
    }
    html += '<tr>';
    html += '<td class="time">' + esc(r.time) + '</td>';
    html += '<td><b>' + esc(r.name) + '</b></td>';
    html += '<td>' + esc(r.dob) + '</td>';
    html += '<td class="phn">' + esc(r.phn) + '</td>';
    html += '<td>' + esc(r.sex) + '</td>';
    if (_qcListMode === 'on') {
      html += '<td>' + esc(r.ward) + '</td>';
      html += '<td>' + esc(r.bed) + '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  html += '<div class="print-hint">Tap <b>Share \u2192 Print</b> (iOS) or <b>\u22ee \u2192 Print</b> (Android) to save as PDF, then import into QuikChart MD.</div>';
  html += '</body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  var url = URL.createObjectURL(blob);
  window.open(url, '_blank');

  hideModal('qc-modal');
  showToast(rows.length + ' patient' + (rows.length !== 1 ? 's' : '') + ' exported for QuikChart');
}

// ═══════════════════════════════════════════════════════
// LEADERBOARD — retro arcade high-score board
// ═══════════════════════════════════════════════════════
//
// Four categories, each showing top-3 single-day records:
//   1. High Acuity    — most CCU admissions (resolved 1411) in one day
//   2. Busy Bee       — most consults (33010/33012/1411) in one day
//   3. Tax Man Cometh — highest SUM($) in one day
//   4. The Shepherd   — most distinct patients on MRP Cardiology service
//
// Hybrid data source:
//   - Local st.claims renders instantly (covers recent ~2 weeks)
//   - BigQuery fetch merges in historical all-time records
//   Best of both is shown.

var _lbInjected = false;

// ── Doctor alias → 2-char arcade initials (JKT is the exception) ─
var LB_INITIALS = {
  'KBrown':'KB', 'DPatton':'DP', 'FH':'FH', 'JW':'JW',
  'LH':'LH', 'SB':'SB', 'ASodhi':'AS', 'EMMassie':'EM',
  'KHoskin':'KH', 'AKhosla':'AK', 'AK':'AK', 'KT':'JKT', 'KP':'KP'
};

function _lbInitials(alias) {
  if (LB_INITIALS[alias]) return LB_INITIALS[alias];
  var s = String(alias || '??').toUpperCase();
  return s.length >= 2 ? s.slice(0,2) : (s + '\u00B7').slice(0,2);
}

// ── Compute leaderboard from local claims ────────────
// Fee codes that always count for shepherd (CCU family)
var LB_CCU_FEES = { 'CCU_DAILY':1, '1411':1, '1421':1, '1431':1, '1441':1 };

// Return the Monday that starts this DD/MM/YYYY's Mon-Sun week ("YYYY-MM-DD")
function _lbWeekKey(dateStr) {
  var parts = String(dateStr).split('/');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  d.setHours(12); // avoid DST edge
  var day = d.getDay(); // 0=Sun 1=Mon ... 6=Sat
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _computeLeaderboard() {
  if (!st.claims || !st.claims.length) return null;

  // Build PHN → patient lookup for shepherd MRP check
  var patByPhn = {};
  (st.patients || []).forEach(function(p) {
    if (p.phn) patByPhn[String(p.phn)] = p;
  });

  // Group claims by (alias, date)
  var groups = {};
  st.claims.forEach(function(c) {
    if (!c.alias || !c.date) return;
    var key = c.alias + '|' + c.date;
    if (!groups[key]) groups[key] = { alias: c.alias, date: c.date, claims: [] };
    groups[key].claims.push(c);
  });

  // Score each doctor-day
  var entries = [];
  for (var key in groups) {
    var g = groups[key];
    var ccuAdmits = 0;
    var consults  = 0;
    var revenue   = 0;
    var shepherdPHNs = {};

    g.claims.forEach(function(c) {
      var fee = c.fee;
      var resolved = fee;
      var rate;
      if (fee === 'CCU_DAILY') {
        resolved = ccuFeeForDate({ phn: c.phn }, c.date);
        rate = FEE_RATES[resolved] || 0;
      } else {
        rate = FEE_RATES[fee] || 0;
      }
      if (resolved === '1411') ccuAdmits++;
      if (resolved === '33010' || resolved === '33012' || resolved === '1411') consults++;
      revenue += rate * (c.units || 1);

      // Shepherd: CCU family always counts
      if (LB_CCU_FEES[fee] && c.phn) {
        shepherdPHNs[c.phn] = true;
      }
      // Daily (33008) counts only if patient is MRP Cardiology
      if (fee === '33008' && c.phn) {
        var pat = patByPhn[String(c.phn)];
        if (pat && /cardiology/i.test(pat.mrp) && pat.role === 'mrp') {
          shepherdPHNs[c.phn] = true;
        }
      }
    });

    var shepherdCount = 0;
    for (var _p in shepherdPHNs) shepherdCount++;

    entries.push({
      alias: g.alias, date: g.date,
      ccuAdmits: ccuAdmits, consults: consults,
      revenue: revenue, shepherd: shepherdCount
    });
  }

  // Top 3 per category
  var byAdmits = entries.filter(function(e) { return e.ccuAdmits > 0; })
    .sort(function(a, b) { return b.ccuAdmits - a.ccuAdmits; }).slice(0, 3);
  var byConsults = entries.filter(function(e) { return e.consults > 0; })
    .sort(function(a, b) { return b.consults - a.consults; }).slice(0, 3);
  var byRevenue = entries.filter(function(e) { return e.revenue > 0; })
    .sort(function(a, b) { return b.revenue - a.revenue; }).slice(0, 3);
  var byShepherd = (function() {
    // One entry per doctor per Mon-Sun rotation week (best day wins)
    var weekBest = {};  // key: "alias|weekStart" → { alias, date, shepherd }
    entries.filter(function(e) { return e.shepherd > 0; }).forEach(function(e) {
      var wk = _lbWeekKey(e.date);
      var key = e.alias + '|' + wk;
      if (!weekBest[key] || e.shepherd > weekBest[key].shepherd) {
        weekBest[key] = e;
      }
    });
    var arr = [];
    for (var k in weekBest) arr.push(weekBest[k]);
    arr.sort(function(a, b) { return b.shepherd - a.shepherd; });
    return arr.slice(0, 3);
  })();

  return {
    ccuAdmits: byAdmits.map(function(e) { return [e.alias, e.date, e.ccuAdmits]; }),
    consults:  byConsults.map(function(e) { return [e.alias, e.date, e.consults]; }),
    revenue:   byRevenue.map(function(e) { return [e.alias, e.date, Math.round(e.revenue * 100) / 100]; }),
    shepherd:  byShepherd.map(function(e) { return [e.alias, e.date, e.shepherd]; })
  };
}

// ── Merge local + BQ results ─────────────────────────
function _mergeLeaderboards(local, bq) {
  return {
    ccuAdmits: _mergeCat(local ? local.ccuAdmits : [], bq ? bq.ccuAdmits : [], 3),
    consults:  _mergeCat(local ? local.consults  : [], bq ? bq.consults  : [], 3),
    revenue:   _mergeCat(local ? local.revenue   : [], bq ? bq.revenue   : [], 3),
    shepherd:  _mergeShepherd(local ? local.shepherd : [], bq ? bq.shepherd : [])
  };
}

function _mergeCat(a, b, limit) {
  var map = {};
  (a || []).concat(b || []).forEach(function(r) {
    var key = r[0] + '|' + r[1];
    var score = Number(r[2]) || 0;
    if (!map[key] || score > Number(map[key][2])) map[key] = r;
  });
  var out = [];
  for (var k in map) out.push(map[k]);
  out.sort(function(x, y) { return Number(y[2]) - Number(x[2]); });
  return out.slice(0, limit || 3);
}

// Shepherd merge: one entry per doctor per Mon-Sun week
function _mergeShepherd(a, b) {
  var map = {};
  (a || []).concat(b || []).forEach(function(r) {
    var key = r[0] + '|' + r[1];
    var score = Number(r[2]) || 0;
    if (!map[key] || score > Number(map[key][2])) map[key] = r;
  });
  var all = [];
  for (var k in map) all.push(map[k]);
  all.sort(function(x, y) { return Number(y[2]) - Number(x[2]); });
  // Dedup: one entry per doctor per Mon-Sun week
  var seen = {};
  var out = [];
  for (var i = 0; i < all.length && out.length < 3; i++) {
    var wk = all[i][0] + '|' + _lbWeekKey(all[i][1]);
    if (!seen[wk]) {
      seen[wk] = true;
      out.push(all[i]);
    }
  }
  return out;
}

// ── Async BQ fetch (background merge for historical) ──
async function _fetchBQLeaderboard(localData) {
  if (!SHEETS_URL) return;
  try {
    var url = SHEETS_URL + '?action=getLeaderboard&key=' + SHARED_KEY + '&_t=' + Date.now();
    var resp = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) return;
    var bqData = await resp.json();
    if (bqData.error) return;
    var merged = _mergeLeaderboards(localData, bqData);
    _renderLeaderboard(merged);
  } catch(e) {
    // BQ failed — local data already shown, no problem
    console.warn('[Leaderboard] BQ fetch failed:', e.message);
  }
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

  /* Empty */
  '.lb-msg{font-family:"Courier New",monospace;font-size:12px;text-align:center;' +
    'padding:16px;color:#0a0}' +

  /* Close button */
  '.lb-close{position:fixed;top:14px;right:14px;z-index:202;width:36px;height:36px;' +
    'border-radius:50%;border:2px solid #0f0;background:rgba(0,0,0,.8);color:#0f0;' +
    'font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'text-shadow:0 0 6px #0f0;font-family:"Courier New",monospace}' +
  '.lb-close:active{background:#0f0;color:#000}' +

  /* Footer */
  '.lb-footer{font-family:"Courier New",monospace;font-size:10px;color:#040;' +
    'text-align:center;letter-spacing:3px;margin-top:20px;text-transform:uppercase}' +

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
    '<div class="lb-close" onclick="hideLeaderboard()">\u2715</div>' +
    '<div class="lb-screen" id="lb-screen">' +
      '<div class="lb-title">HIGH SCORES</div>' +
      '<div class="lb-subtitle">KGH Cardiology</div>' +
      '<div id="lb-body"></div>' +
      '<div class="lb-footer">\u2014 24hr clinical day \u2014</div>' +
    '</div>' +
  '</div>';
}

// ── Inject UI into DOM — called once from init() ─────
function _injectLeaderboardUI() {
  if (_lbInjected) return;
  _lbInjected = true;

  var style = document.createElement('style');
  style.textContent = LB_CSS;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', _lbModalHtml());

  var hdrRight = document.querySelector('.hdr > div:last-child');
  if (hdrRight) {
    var btn = document.createElement('div');
    btn.className = 'lb-trophy-btn';
    btn.title = 'Leaderboard';
    btn.onclick = showLeaderboard;
    btn.textContent = '\uD83C\uDFC6';
    hdrRight.insertBefore(btn, hdrRight.firstChild);
  }
}

// ── Show / hide ──────────────────────────────────────
function showLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  var screen = document.getElementById('lb-screen');
  if (screen) {
    screen.classList.remove('animating');
    void screen.offsetWidth;
    screen.classList.add('animating');
  }
  // 1. Local data — instant render
  var localData = _computeLeaderboard();
  _renderLeaderboard(localData);
  // 2. BQ historical — merges in when it arrives
  _fetchBQLeaderboard(localData);
}

function hideLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _lbOverlayTap(e) {
  if (e.target.id === 'lb-overlay') hideLeaderboard();
}

// ── Render the four categories ───────────────────────
var LB_MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

function _renderLeaderboard(data) {
  var body = document.getElementById('lb-body');
  if (!body) return;

  if (!data) {
    body.innerHTML = '<div class="lb-msg">NO CLAIMS DATA \u2014 SYNC FIRST</div>';
    return;
  }

  var html = '';
  html += _renderCategory('\u2764\uFE0F HIGH ACUITY', 'Most CCU admissions in 24hrs', data.ccuAdmits || [], false);
  html += _renderCategory('\uD83D\uDC1D BUSY BEE', 'Most consults in 24hrs', data.consults || [], false);
  html += _renderCategory('\uD83D\uDCB0 THE TAX MAN COMETH', 'Highest $ billed in 24hrs', data.revenue || [], true);
  html += _renderCategory('\uD83D\uDC11 THE SHEPHERD', 'Most patients on service in 24hrs', data.shepherd || [], false);

  body.innerHTML = html;
}

function _renderCategory(title, subtitle, rows, isDollar) {
  if (!rows.length) {
    return '<div class="lb-cat">' +
      '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
      '<div class="lb-cat-sub">' + esc(subtitle) + '</div>' +
      '<div class="lb-msg">\u2014 NO ENTRIES \u2014</div>' +
    '</div>';
  }
  var html = '<div class="lb-cat">' +
    '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
    '<div class="lb-cat-sub">' + esc(subtitle) + '</div>';
  for (var i = 0; i < rows.length && i < 3; i++) {
    var r = rows[i];
    var alias = r[0] || '???';
    var dt    = r[1] || '';
    var score = isDollar
      ? ('$' + Number(r[2] || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0}))
      : String(r[2] || 0);
    var ini   = _lbInitials(alias);

    html += '<div class="lb-row">' +
      '<div class="lb-medal">' + LB_MEDALS[i] + '</div>' +
      '<div class="lb-ini">' + esc(ini) + '</div>' +
      '<div class="lb-dots">\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7</div>' +
      '<div class="lb-score-wrap">' +
        '<div class="lb-score">' + esc(score) + '</div>' +
        '<div class="lb-date">' + esc(dt) + '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
}
// ── 12_referrers.js ──
// ═══════════════════════════════════════════════════════
