// ── 02b_icd_search.js ──
// ═══════════════════════════════════════════════════════
// 02b_icd_search.js — ICD-9 and referrer search helpers
// Uses element references (no inline quote-escaping issues)
// ═══════════════════════════════════════════════════════

// Called via oninput/onfocus with data-dd and data-hidden attributes
function icdSearchEl(inputEl) {
  var ddId     = inputEl.getAttribute('data-dd');
  var hiddenId = inputEl.getAttribute('data-hidden');
  icdSearch(inputEl.value, ddId, hiddenId, inputEl.id);
}

function refSearchEl(inputEl) {
  var ddId     = inputEl.getAttribute('data-dd');
  var hiddenId = inputEl.getAttribute('data-hidden');
  var nameId   = inputEl.getAttribute('data-name') || '';
  refSearch(inputEl.value, ddId, hiddenId, nameId);
}

// ── ICD-9 search — Tier 1 local + Tier 2 remote ────────────────────────────
//
// Tier 1: ~186 common cardiology codes in DIAGNOSES (instant, offline)
// Tier 2: Full 7,191 iClinic codes from Google Sheets ICD9 tab (async, wifi)
//
// On empty focus: shows top 12 local codes (recent first)
// On query:       shows up to 8 local matches immediately, then appends
//                 remote results from Sheets (deduped) after 400 ms debounce

var _icdRemoteTimer = null;
var _lastIcdQ = '';

function icdSearch(query, dropdownId, hiddenId, inputId) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;

  var ordered = getOrderedDiagnoses();
  var recentCodes = (st.recentIcds || []).map(function(r) { return r.code; });

  // Empty focus — show top 12 cardiology codes (recent first)
  if (!query || query.trim() === '') {
    var top = ordered.slice(0, 12);
    dd.style.display = 'block';
    dd.innerHTML =
      '<div style="padding:4px 10px;font-size:10px;color:var(--text3)">Common codes — type to search all 7,000+ iClinic codes</div>' +
      top.map(function(d) { return buildIcdRowHtml(d, dropdownId, hiddenId, inputId, recentCodes); }).join('');
    return;
  }

  // Tier 1: search local DIAGNOSES
  var q = query.toLowerCase();
  var local = ordered.filter(function(d) {
    return d.label.toLowerCase().indexOf(q) !== -1 || d.code.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);

  dd.style.display = 'block';
  dd.innerHTML = local.map(function(d) {
    return buildIcdRowHtml(d, dropdownId, hiddenId, inputId, recentCodes);
  }).join('');

  // Add "Searching…" placeholder for Tier 2
  if (SHEETS_URL && query.length >= 2) {
    dd.innerHTML += '<div class="icd-searching ref-dd-row" style="color:var(--text3);font-style:italic;font-size:11px">Searching full list…</div>';
    searchICDRemote(query, dropdownId, hiddenId, inputId);
  } else if (!local.length) {
    dd.style.display = 'none';
  }
}

// ── Tier 2: remote ICD search via Apps Script ──────────────────────────────
function searchICDRemote(query, dropdownId, hiddenId, inputId) {
  if (!SHEETS_URL || !query || query.length < 2) return;
  clearTimeout(_icdRemoteTimer);
  _icdRemoteTimer = setTimeout(function() {
    _lastIcdQ = query;
    fetch(SHEETS_URL + '?action=searchICD&q=' + encodeURIComponent(query) + '&key=' + SHARED_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (query !== _lastIcdQ) return; // stale
        if (!Array.isArray(data) || !data.length) {
          var ph = document.querySelector('#' + dropdownId + ' .icd-searching');
          if (ph) ph.remove();
          return;
        }
        var dd = document.getElementById(dropdownId);
        if (!dd || dd.style.display === 'none') return;
        // Remove placeholder
        var ph = dd.querySelector('.icd-searching');
        if (ph) ph.remove();
        // Find already-shown codes
        var shownCodes = [];
        dd.querySelectorAll('[data-code]').forEach(function(el) { shownCodes.push(el.getAttribute('data-code')); });
        // Append new results (deduped)
        var recentCodes = (st.recentIcds || []).map(function(r) { return r.code; });
        var extraHtml = data
          .filter(function(row) { return shownCodes.indexOf(String(row[0])) === -1; })
          .slice(0, 12)
          .map(function(row) {
            var code = String(row[0]);
            var desc = String(row[1]);
            // Title-case description
            desc = desc.charAt(0).toUpperCase() + desc.slice(1).toLowerCase();
            var d = { code: code, label: desc + ' (' + code + ')' };
            return buildIcdRowHtml(d, dropdownId, hiddenId, inputId, recentCodes);
          }).join('');
        if (extraHtml) {
          dd.innerHTML += extraHtml;
        } else if (!dd.querySelectorAll('[data-code]').length) {
          dd.style.display = 'none';
        }
      })
      .catch(function() {
        var ph = document.querySelector('#' + dropdownId + ' .icd-searching');
        if (ph) ph.remove();
      });
  }, 400);
}

// ── Build a single ICD row HTML string ─────────────────────────────────────
function buildIcdRowHtml(d, dropdownId, hiddenId, inputId, recentCodes) {
  var isRecent = recentCodes && recentCodes.indexOf(d.code) !== -1;
  var badge = isRecent ? '<span class="recent-badge">RECENT</span>' : '';
  return '<div class="ref-dd-row" data-code="' + d.code + '" data-label="' + esc(d.label) + '" ' +
         'data-dd="' + dropdownId + '" data-hidden="' + hiddenId + '" data-inp="' + inputId + '" ' +
         'onmousedown="event.preventDefault();selectIcdRow(this)">' + badge + esc(d.label) + '</div>';
}

function selectIcdRow(el) {
  if (el && !el.hasAttribute('data-code')) {
    el = el.closest('.ref-dd-row');
  }
  if (!el) return;
  var code     = el.getAttribute('data-code');
  var label    = el.getAttribute('data-label');
  var ddId     = el.getAttribute('data-dd');
  var hiddenId = el.getAttribute('data-hidden');
  var inputId  = el.getAttribute('data-inp');
  selectIcd(code, label, ddId, hiddenId, inputId);
}

function selectIcd(code, label, dropdownId, hiddenId, inputId) {
  var h = document.getElementById(hiddenId);
  if (h) h.value = code;
  var inp = document.getElementById(inputId);
  if (inp) inp.value = label;
  var dd = document.getElementById(dropdownId);
  if (dd) dd.style.display = 'none';
  recordIcdUsage(code);
}

// (duplicate close-dropdown listener removed — safe version retained in 12_referrers.js)

