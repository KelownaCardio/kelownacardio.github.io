// 14_init.js — App init, navigation, fee codes, doctor modal,
//              and all utility/helper functions
// ═══════════════════════════════════════════════════════

// ── Init ──────────────────────────────────────────────
// ── App-password gate ──────────
function _getStoredAppPw() {
  try { return localStorage.getItem(APP_PW_LS_KEY) || ''; } catch (e) { return ''; }
}
function ensureAppPassword() {
  if (_getStoredAppPw()) { SHARED_KEY = _getStoredAppPw(); return Promise.resolve(); }
  return promptAppPassword('This is a new device — you need to authorize it to access patient data.');
}
var _appPwResolve = null;
var _appPwOpen    = false;   // v4.70: re-entrancy guard (see below)
function promptAppPassword(msg) {
  // v4.70: if a prompt is already up, do NOT open a second one — the old code
  // overwrote _appPwResolve, orphaning the first promise so its caller (a queued
  // sync) never resumed.
  if (_appPwOpen) return new Promise(function() {});   // never resolves; the open prompt owns the flow
  return new Promise(function(resolve) {
    _appPwOpen = true;
    _appPwResolve = resolve;
    var sub = document.getElementById('apppw-sub');
    if (sub && msg) sub.textContent = msg;
    var err = document.getElementById('apppw-err');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    var inp = document.getElementById('apppw-input');
    if (inp) inp.value = '';
    var ov = document.getElementById('apppw-modal');
    if (ov) ov.classList.add('on');
    if (inp) setTimeout(function(){ try { inp.focus(); } catch(e){} }, 60);
  });
}

// v4.70: VERIFY BEFORE STORING. The old version wrote whatever was typed straight
// into localStorage and closed the modal — a typo'd password was persisted, every
// subsequent request came back unauthorized, and the app went back to pulsing with
// no error shown. Now the password is checked against the server (ping is behind
// the same key gate as every other action) and only stored if it is accepted.
async function submitAppPassword() {
  var inp = document.getElementById('apppw-input');
  var err = document.getElementById('apppw-err');
  var btn = document.getElementById('apppw-btn');
  var val = inp ? (inp.value || '').trim() : '';
  var showErr = function(m) { if (err) { err.textContent = m; err.style.display = 'block'; } };

  if (!val) { showErr('Enter the app password to continue.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  var verdict = 'network';   // 'ok' | 'rejected' | 'network'
  try {
    var r = await fetch(SHEETS_URL + '?action=ping&key=' + encodeURIComponent(val) + '&_t=' + Date.now(),
                        { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    if (r.ok) {
      var d = await r.json();
      verdict = (d && d.ok) ? 'ok' : (d && d.error === 'unauthorized' ? 'rejected' : 'network');
    }
  } catch (e) { verdict = 'network'; }
  if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }

  if (verdict === 'rejected') {
    showErr('That password was not accepted. Check it and try again.');
    return;                                  // modal stays open; stored password untouched
  }
  if (verdict === 'network') {
    showErr("Couldn't reach the server — check your connection and try again.");
    return;
  }

  // Verified.
  try { localStorage.setItem(APP_PW_LS_KEY, val); } catch (e) {}
  SHARED_KEY = val;
  resetUnauthCount();
  var ov = document.getElementById('apppw-modal');
  if (ov) ov.classList.remove('on');
  _appPwOpen = false;
  var res = _appPwResolve; _appPwResolve = null;
  if (res) res();
}

// ── Unauthorized handling ────────────────────────────────────────────
// v4.66 treated 2 consecutive 'unauthorized' responses as a real rejection and
// DELETED the stored password. v4.70 changes both halves of that:
//
//   • It never deletes. Deleting bought nothing — the prompt overwrites the
//     credential on success anyway — but it guaranteed a locked-out device if the
//     prompt was missed or dismissed, with the dot pulsing amber and no way back.
//     (This is what happened on 2026-07-13: an Apps Script version switch during
//     deploy returned unauthorized twice in a row, the valid password was wiped,
//     and the app sat on a prompt behind a pulsing amber dot.)
//   • 3 strikes, not 2, with a backoff between them — a redeploy blip is over in
//     a couple of seconds, so give it those seconds before bothering the doctor.
//
// The stored password is only ever REPLACED, by submitAppPassword, and only after
// the server has confirmed the new one.
var _unauthCount = 0;
var UNAUTH_STRIKES = 3;
function resetUnauthCount() { _unauthCount = 0; }
function handleUnauthorized() {
  _unauthCount++;
  if (_unauthCount < UNAUTH_STRIKES) {
    // Probably transient (flaky hospital wifi, or a backend deploy swapping
    // versions mid-request). Keep the credential, wait, let the caller retry.
    var backoffMs = _unauthCount * 1500;   // 1.5s, then 3s
    return new Promise(function(resolve) { setTimeout(resolve, backoffMs); });
  }
  _unauthCount = 0;
  // NOTE: deliberately does NOT clear localStorage or SHARED_KEY.
  return promptAppPassword('The server rejected the saved password. Re-enter it — '
    + 'or if the app was just updated, wait a moment and tap Connect again.');
}
async function init() {
  await ensureAppPassword();
  // Build the Add Patient "Location & list" card from the shared
  // component before anything references f-ward (custom-ward restore,
  // wardChange, prefill all need it present).
  var apLocHost = document.getElementById('ap-loc-host');
  if (apLocHost) {
    // v4.11: fresh Add Patient starts with NO ward / role / list pre-selected.
    // Users were skipping the location card and inheriting the prior CCU/MRP/
    // On-service defaults; apSubmit's new add-to-list guard requires an
    // explicit choice before a patient can be added to a rounds list.
    apLocHost.innerHTML = buildLocationCard('f', null, true);
  }
  // v4.25: attach DOB auto-slash + numeric keypad to f-dob.
  // pe-dob (edit modal) has it inline; f-dob is in the static template
  // so it must be wired programmatically here.
  // v4.48: placeholder changed to DD Mon YYYY; inputmode left as default
  // so users can type month names. dobAutoSlash still handles pure-digit
  // input (08051963 → 08/05/1963).
  var fDob = document.getElementById('f-dob');
  if (fDob) {
    fDob.placeholder = 'DD Mon YYYY';
    fDob.addEventListener('input', function() { dobAutoSlash(fDob); updateApDobAge(); });
  }
  updateDailyTotal();
  await loadLocal();
  purgeOldPatients(); // remove patients discharged > 21 days ago
  st.loaded = true;
  if (st.doc) {
    document.getElementById('doc-label').textContent = st.doc.alias;
    document.getElementById('doc-dot').classList.add('on');
  }
  // Seed doctor profiles on first launch
  if (!st.doctors.length) {
    st.doctors = DOCTORS_SEED.map(function(d) {
      return { id:'d'+d.alias, alias:d.alias, name:d.name };
    });
    sv('doctors', st.doctors);
  }

  // (test patients removed for live deployment)
    // Restore any custom wards saved from previous sessions
  try {
    var savedWards = JSON.parse(localStorage.getItem('kgh5:customWards') || '[]');
    savedWards.forEach(function(w) {
      if (!WARDS[w.key]) {
        WARDS[w.key] = { label:w.name, list:'off', care:'directive', role:'consultant', rooms:[] };
        ['f-ward','pe-ward','le-ward'].forEach(function(selId) {
          var sel = document.getElementById(selId);
          if (!sel) return;
          var otherOpt = sel.querySelector('option[value="OTHER"]');
          var newOpt = document.createElement('option');
          newOpt.value = w.key; newOpt.text = w.name;
          if (otherOpt) sel.insertBefore(newOpt, otherOpt);
          else sel.appendChild(newOpt);
        });
      }
    });
  } catch(e) {}
  wardChange();
  renderRefs('');
  _injectLeaderboardUI(); // 🏆 retro arcade leaderboard button + modal
  // Show loading state immediately
  render();
  if (SHEETS_URL) {
    // Sync from Sheets is the primary data source — await it on startup
    setSyncState('syncing');
    document.getElementById('sync-dot').title = 'Loading from Sheets…';
    try {
      await syncFromSheets();
      render(); // re-render after claims load so green tints are correct
    } catch(e) {
      setSyncState('error');
    }

    // v4.39: Auto-refresh every 5 min so other doctors' changes (including
    // handover summaries from the email processor) appear without closing
    // and reopening the app.
    setInterval(async function() {
      // Skip if any editing screen is open — don't clobber mid-edit state
      var claimOpen = document.getElementById('p-claim') &&
                      document.getElementById('p-claim').classList.contains('on');
      var addOpen   = document.getElementById('p1') &&
                      document.getElementById('p1').classList.contains('on');
      var dischOpen = document.getElementById('disch-modal') &&
                      document.getElementById('disch-modal').classList.contains('on');
      var ocrBusy   = typeof _ocrInFlight !== 'undefined' && _ocrInFlight;
      if (claimOpen || addOpen || dischOpen || ocrBusy) {
        console.log('[auto-refresh] skipped — editing in progress');
        return;
      }
      try {
        await syncFromSheets();
        render();
        console.log('[auto-refresh] synced');
      } catch(e) {
        console.log('[auto-refresh] failed:', e);
      }
    }, 5 * 60 * 1000);
  }
}

async function resetLocalData() {
  if (!confirm('This will clear all local data on this device and re-sync from Google Sheets. Any unsynced changes will be lost. Continue?')) return;
  // Clear all local storage keys for this app
  var keys = ['patients','claims','refs','doctors','doc','changelog','recentIcds','recentRefs'];
  for (var i = 0; i < keys.length; i++) {
    try { await LS.delete(STORAGE_PREFIX + keys[i]); } catch(e) {}
  }
  // Reset in-memory state
  st.patients  = [];
  st.claims    = [];
  st.refs      = [];
  st.doctors   = [];
  st.changelog = [];
  st.doc       = null;
  document.getElementById('doc-label').textContent = 'Sign in';
  document.getElementById('doc-dot').classList.remove('on');
  hideModal('doc-modal');
  showToast('Local data cleared — syncing from Sheets…');
  // Re-sync from Sheets fresh
  if (SHEETS_URL) {
    setSyncState('syncing');
    try {
      var r = await fetch(SHEETS_URL + '?action=getAll&key=' + SHARED_KEY);
      var d = await r.json();
      if (!d.error) {
        if (d.patients)  { st.patients  = d.patients;  sv('patients',  st.patients);  }
        if (d.claims)    { st.claims    = d.claims;    sv('claims',    st.claims);    }
        if (d.doctors)   { st.doctors   = d.doctors;   sv('doctors',   st.doctors);   }
        if (d.changelog) { st.changelog = d.changelog; sv('changelog', st.changelog); }
        setSyncState('synced');
        showToast('Sync complete — ' + st.patients.filter(function(p){return !p.discharged;}).length + ' active patients loaded');
      } else {
        setSyncState('error');
        showToast('Sync error — check connection');
      }
    } catch(e) { setSyncState('error'); showToast('Sync failed — check connection'); }
  }
  render();
}

// ── Navigation ─────────────────────────────────────────
var ALL_PANES = ['p0','p1','p-discharged','p-claim','p-loc'];

function showPane(id) {
  ALL_PANES.forEach(function(pid) { document.getElementById(pid).classList.remove('on'); });
  document.getElementById(id).classList.add('on');
  // Sweep any visible toasts so they don't hang over the new pane
  clearTimeout(_toastTimer);
  var stragglers = document.querySelectorAll('.kgh-toast');
  for (var i = 0; i < stragglers.length; i++) { stragglers[i].remove(); }
}

function nav(n, el) {
  document.querySelectorAll('.nb').forEach(function(b, i) { b.classList.toggle('on', i === n); });
  var paneMap = { 0:'p0', 1:'p1', 2:'p-discharged' };
  showPane(paneMap[n] || 'p0');
  var listSel = document.getElementById('list-sel-bar');
  if (listSel) listSel.classList.toggle('hidden', n !== 0);
  if (n === 0) render();
  if (n === 1) initAddPatientConsult();
  if (n === 2) initDischarged();
}

function setList(v) {
  _listView = v;
  document.getElementById('ls-on').classList.toggle('on', v === 'on');
  document.getElementById('ls-off').classList.toggle('on', v === 'off');
  // When search is active, search-view is shown; otherwise show on/off views per list
  var searching = !!_roundsQuery;
  document.getElementById('search-view').style.display = searching ? 'block' : 'none';
  document.getElementById('on-view').style.display  = (!searching && v === 'on')  ? 'block' : 'none';
  document.getElementById('off-view').style.display = (!searching && v === 'off') ? 'block' : 'none';
  // Show geo/alpha toggle only on On Service AND when not searching
  var vtBar = document.getElementById('view-tog-bar');
  if (vtBar) vtBar.style.display = (!searching && v === 'on') ? 'flex' : 'none';
  render();
}

function setView(v) {
  _geoView = v;
  document.getElementById('vt-geo').classList.toggle('on',   v === 'geo');
  document.getElementById('vt-alpha').classList.toggle('on', v === 'alpha');
  document.getElementById('geo-view').style.display   = v === 'geo'   ? 'block' : 'none';
  document.getElementById('alpha-view').style.display = v === 'alpha' ? 'block' : 'none';
  render();
}

// ── Doctor Modal ───────────────────────────────────────
function openCombinedReasonModal(pid, onConfirm) {
  var p   = getP(pid);
  var dx  = p.icd ? icdShortLabel(p.icd) : '(no diagnosis on file)';
  var h   = '<div style="margin-bottom:10px;font-size:13px;color:var(--text2)">' +
              '<strong>Diagnosis on file:</strong> ' + esc(dx) +
            '</div>' +
            '<label style="font-size:11px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Reason for combined daily care</label>' +
            '<textarea id="comb-reason-input" placeholder="e.g. Co-management with cardiac surgery post-CABG…" ' +
              'style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;min-height:72px;font-family:inherit;resize:vertical"></textarea>' +
            '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">' +
              '<button class="btn btn-p" style="margin:0" onclick="confirmCombinedReason(\'' + pid + '\')">Confirm &amp; continue</button>' +
              '<button class="btn btn-s" style="margin:0" onclick="hideModal(\'comb-reason-modal\')">Cancel</button>' +
            '</div>';
  document.getElementById('comb-reason-body').innerHTML = h;
  window._combReasonCallback = onConfirm;
  showModal('comb-reason-modal');
  setTimeout(function() {
    var el = document.getElementById('comb-reason-input');
    if (el) el.focus();
  }, 100);
}

function confirmCombinedReason(pid) {
  var reason = (document.getElementById('comb-reason-input').value || '').trim();
  if (!reason) { showToast('Please enter a reason for combined daily care'); return; }
  var p = getP(pid);
  p.combinedDailyReason = reason;
  push('savePatient', p);
  hideModal('comb-reason-modal');
  if (window._combReasonCallback) {
    window._combReasonCallback();
    window._combReasonCallback = null;
  }
}

function showModal(id) {
  document.getElementById(id).classList.add('on');
  if (id === 'doc-modal') renderDocOpts();
}

function hideModal(id) {
  document.getElementById(id).classList.remove('on');
}

function renderDocOpts() {
  document.getElementById('doc-opts').innerHTML = st.doctors.length
    ? doctorsSorted().map(function(d) {
        var ini = d.name.replace('Dr. ','').split(' ').map(function(w){return w[0]||''}).join('').slice(0,2).toUpperCase();
        var numLine = d.alias;
        return '<div class="doc-opt" data-alias="' + d.alias + '" data-num="' + d.num + '" data-name="' + esc(d.name) + '" onclick="selectDocEl(this)">' +
          '<div class="doc-av">' + ini + '</div>' +
          '<div style="flex:1"><div style="font-size:14px;font-weight:700">' + esc(d.name) + '</div>' +
          '<div style="font-size:11px;color:var(--text2);margin-top:1px">' + numLine + '</div></div>' +
          '</div>';
      }).join('')
    : '<div class="empty" style="padding:10px 0">No profiles found.</div>';
}

function selectDocEl(el) {
  selectDoc(
    el.getAttribute('data-alias'),
    el.getAttribute('data-num'),
    el.getAttribute('data-name')
  );
}

function selectDoc(alias, num, name) {
  st.doc = { alias:alias, num:num, name:name };
  sv('doc', st.doc);
  document.getElementById('doc-label').textContent = alias;
  document.getElementById('doc-dot').classList.add('on');
  hideModal('doc-modal');
  showToast('Signed in as ' + name);
}

// ── Utility functions ──────────────────────────────────
function getP(pid) {
  return st.patients.find(function(p) { return p.id === pid; }) || {};
}

function checkDoc() {
  if (!st.doc) { showToast('Sign in first'); showModal('doc-modal'); return false; }
  return true;
}

// ── Doctor list ordering ───────────────────────────────
// Surname used for sorting — the last whitespace-delimited token of the
// doctor's name, with any leading "Dr." stripped; falls back to the alias
// if no name is on file (e.g. a profile added with alias only).
function doctorSurname(d) {
  var n = String((d && d.name) || (d && d.alias) || '').replace(/^\s*Dr\.?\s+/i, '').trim();
  var parts = n.split(/\s+/).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : n).toLowerCase();
}

// st.doctors sorted alphabetically by surname (then full name as tie-break).
// Used by the sign-in list and every performing-physician selector so all
// doctor lists in the app share one consistent order. Returns a shallow
// copy — never mutates st.doctors.
function doctorsSorted() {
  return (st.doctors || []).slice().sort(function(a, b) {
    var sa = doctorSurname(a), sb = doctorSurname(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    var na = String((a && a.name) || '').toLowerCase();
    var nb = String((b && b.name) || '').toLowerCase();
    return na < nb ? -1 : (na > nb ? 1 : 0);
  });
}

function gv(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function todayStr() {
  var d = new Date();
  return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear();
}

// Returns today as YYYY-MM-DD in LOCAL time (not UTC).
// Replaces new Date().toISOString().slice(0,10) which uses UTC
// and gives the wrong date after 17:00 PDT (= midnight UTC+1 day).
function localISODate(d) {
  var dt = d || new Date();
  return dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate());
}

// Parse a YYYY-MM-DD string to a local-midnight Date — avoids UTC-shift bug
// where new Date("2025-05-04") returns May 3 in UTC-7 timezones.
function parseISODate(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

function fmtD(d) {
  if (!d || isNaN(d)) return '';
  return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear();
}

// Display-only formatter: DD/MM/YYYY → "06 May 2026"
// Storage and CSV export always use DD/MM/YYYY — this is UI display only.
var _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dispDate(d) {
  if (!d) return '';
  var s = fmtClaimDate(d); // normalise to DD/MM/YYYY first
  var p = s.split('/');
  if (p.length !== 3) return s;
  var mon = _MONTHS[parseInt(p[1], 10) - 1];
  if (!mon) return s;
  return p[0] + ' ' + mon + ' ' + p[2];
}

function parseDMY(s) {
  var p = s.split('/');
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
}

// Format an epoch-ms timestamp as a compact audit display: "14 May 2026 14:32"
// For "today", show just "today HH:MM" for brevity.
function auditTs(ms) {
  if (!ms) return '';
  var n = Number(ms);
  if (!isFinite(n) || n <= 0) return '';
  var d = new Date(n);
  var todayKey = localISODate();
  var thisKey  = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (thisKey === todayKey) return 'today ' + hhmm;
  var mon = _MONTHS[d.getMonth()];
  return d.getDate() + ' ' + mon + ' ' + d.getFullYear() + ' ' + hhmm;
}

function pad(n) { return String(n).padStart(2, '0'); }

function wardLabel(w) { return String((WARDS[w] && WARDS[w].label) || w || ''); }

// time string "HH:MM" → total minutes
// Accept any reasonable time format → HH:MM (24-hour).
// Handles: 14:30, 7:40, 740, 1430, 7:40am, 2:30PM, 7am, 7 am
function parseTime24(s) {
  if (!s) return '';
  s = String(s).trim();
  if (!s) return '';
  var ampm = s.match(/\s*([ap])\.?m?\.?$/i);
  s = s.replace(/\s*[ap]\.?m?\.?$/i, '').trim();
  var h, m;
  var c = s.match(/^(\d{1,2})[:\s](\d{2})$/);
  if (c) { h = parseInt(c[1]); m = parseInt(c[2]); }
  else if (/^\d{3,4}$/.test(s)) {
    if (s.length === 3) { h = parseInt(s[0]);      m = parseInt(s.slice(1)); }
    else                { h = parseInt(s.slice(0,2)); m = parseInt(s.slice(2)); }
  }
  else if (/^\d{1,2}$/.test(s)) { h = parseInt(s); m = 0; }
  else return '';
  if (isNaN(h) || isNaN(m) || m > 59) return '';
  if (ampm) {
    var ap = ampm[1].toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  }
  if (h > 23) return '';
  return pad(h) + ':' + pad(m);
}

function t2m(t) {
  if (!t) return 0;
  var n = parseTime24(String(t));
  var s = n || String(t);
  var p = s.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1] || 0);
}

// ── DOB auto-slash ────────────────────────────────────────────────
// Typing 01021990 auto-inserts slashes → 01/02/1990.
// Only fires on pure-digit input; mixed alpha (e.g. "26 Oct 1958")
// is left untouched so text-month entry still works.
function dobAutoSlash(el) {
  var v = el.value;
  var digits = v.replace(/\//g, '');
  if (/[^0-9]/.test(digits)) return;        // non-digit chars → leave alone
  if (digits.length > 8) digits = digits.slice(0, 8);
  var out = '';
  for (var i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += '/';
    out += digits[i];
  }
  if (out !== v) {
    el.value = out;
    el.setSelectionRange(out.length, out.length);
  }
}

// v4.59: Live age readout beside the Add-Patient DOB field. Recomputes on
// every keystroke and after an OCR sticker scan fills the DOB, so a mis-read
// date of birth shows an obviously wrong age (e.g. "Age 3" on a cardiology
// inpatient) BEFORE the claim is submitted. Same age maths as calcAgeGender.
// Grey = plausible adult; amber = implausibly young/old (shown + flagged);
// red = unparseable; blank while empty or mid-entry (year not yet 4 digits).
function updateApDobAge() {
  var out = document.getElementById('f-dob-age');
  if (!out) return;
  out.style.fontWeight = '800';
  var raw = (document.getElementById('f-dob') || {}).value || '';
  // Empty or still mid-entry (year not yet 4 digits) — neutral dash.
  var parts = raw.trim() ? fmtClaimDate(raw).split('/') : [];
  if (parts.length !== 3 || !parts[2] || parts[2].length < 4) {
    out.textContent = '—'; out.style.color = 'var(--text3)';
    return;
  }
  var dob = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  var now = new Date();
  var yr  = now.getFullYear() - dob.getFullYear();
  var mo  = now.getMonth() - dob.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < dob.getDate())) yr--;
  if (isNaN(yr) || yr < 0 || yr > 130) {
    out.textContent = '⚠ check DOB';    // unparseable / absurd date
    out.style.color = 'var(--red-t)';
    return;
  }
  // Plausible cardiology-patient window: 17–105. We don't see 16 or younger,
  // so anything under 17 (or over 105) is flagged as a likely OCR mis-read.
  var plausible = (yr >= 17 && yr <= 105);
  out.textContent = yr + ' yrs' + (plausible ? '' : '  ⚠');
  out.style.color = plausible ? 'var(--text)' : 'var(--amber-t)';
}

// total minutes → time string "HH:MM"  (wraps at midnight)
function minsToTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

function chkIco() {
  return '<span style="display:inline-flex;width:13px;height:13px;border-radius:50%;background:var(--green);' +
         'margin-left:3px;vertical-align:middle;align-items:center;justify-content:center">' +
         '<svg style="width:7px;height:7px;stroke:#fff;fill:none;stroke-width:3" viewBox="0 0 24 24">' +
         '<polyline points="20 6 9 17 4 12"/></svg></span>';
}

function chkIco10() {
  return '<svg style="width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:3" viewBox="0 0 24 24">' +
         '<polyline points="20 6 9 17 4 12"/></svg>';
}

// Toast notification
var _toastTimer;
function showToast(msg, kind) {
  // v4.29: If addClaim just blocked a duplicate (within last 2s), don't
  // let a success toast overwrite the error toast. The caller doesn't
  // know the claim was blocked and fires its success toast immediately.
  var isError = (kind === 'error');
  if (!isError && window._claimBlockedAt && (Date.now() - window._claimBlockedAt) < 2000) {
    return;  // suppress — let the error toast stay visible
  }
  // Remove any previous toast div BEFORE adding the new one — v3.31 only
  // cleared the removal timer, so rapid taps left orphan divs visible
  // until each one's individual timer fired. Tag with a class so showPane
  // can sweep any stragglers on navigation.
  // v4.11: optional `kind` parameter. 'error' = red background + longer
  // 3.5s dwell so OCR-misread warnings (e.g. PHN wrong length) have time
  // to be read. Default call sites with no kind argument are unchanged
  // (dark monochrome, 1.6s).
  clearTimeout(_toastTimer);
  var prev = document.querySelectorAll('.kgh-toast');
  for (var i = 0; i < prev.length; i++) { prev[i].remove(); }

  var bg = isError ? '#c42828' : '#1a1a18';
  var d = document.createElement('div');
  d.className = 'kgh-toast' + (isError ? ' kgh-toast-error' : '');
  d.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
                    'background:' + bg + ';color:#fff;padding:8px 16px;border-radius:20px;' +
                    'font-size:12px;font-weight:600;z-index:10000;white-space:nowrap;' +
                    'pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  d.textContent = msg;
  document.body.appendChild(d);
  _toastTimer = setTimeout(function() { d.remove(); }, isError ? 3500 : 1600);
}

// Re-sync whenever the user switches back to this tab/app
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && st.loaded && SHEETS_URL) {
    syncFromSheets();
  }
  // v4.15: when the app returns to the foreground, check whether a newer
  // build has been deployed. Off the critical path (never runs on first
  // load), fetches a ~40-byte version.json, fails silently on any error so
  // a missing file or offline state never shows a false prompt.
  if (document.visibilityState === 'visible' && st.loaded) {
    checkForNewVersion();
  }
});

// v4.15: version check + update banner. Fetches version.json (written by
// build.js on every deploy) with a cache-buster so the device never reads a
// stale cached copy of the version file itself. If the deployed version
// differs from the running APP_VERSION, shows a dismissible banner that
// reloads the page on tap. Reloading re-fetches index.html, whose new
// BUILD_ID then triggers the existing localStorage purge — so one tap fully
// updates the device. Fails silently: a 404 (version.json not yet deployed),
// network error, or malformed payload never shows a prompt.
// FIX (2026-06-27): only prompt when the deployed version is strictly NEWER
// than the running APP_VERSION. Previously ANY difference triggered the banner,
// so a lagging/stale version.json (the hand-built workspace rig runs AHEAD of
// the shared version.json, which tracks index.html) nagged an endless "update"
// to an OLDER version. Numeric component compare; malformed → 0 (no prompt).
function _verCmp(a, b) {
  var pa = String(a).replace(/[^0-9.]/g, '').split('.').map(Number);
  var pb = String(b).replace(/[^0-9.]/g, '').split('.').map(Number);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
var _versionCheckInFlight = false;
function checkForNewVersion() {
  if (_versionCheckInFlight) return;
  _versionCheckInFlight = true;
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      _versionCheckInFlight = false;
      if (!data || !data.version) return;            // missing/malformed → silent
      if (_verCmp(data.version, APP_VERSION) <= 0) return; // same or OLDER → no prompt (fixes downgrade-nag)
      showUpdateBanner(data.version);                // only strictly-newer reaches here
    })
    .catch(function() { _versionCheckInFlight = false; }); // offline/error → silent
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('kgh-update-banner')) return; // already showing
  var b = document.createElement('div');
  b.id = 'kgh-update-banner';
  b.setAttribute('role', 'button');
  b.style.cssText =
    'position:fixed;left:50%;top:calc(env(safe-area-inset-top, 0px) + 12px);transform:translateX(-50%);' +
    'background:var(--blue-t,#1a5fa8);color:#fff;padding:11px 18px;border-radius:22px;' +
    'font-size:13px;font-weight:700;z-index:1000;cursor:pointer;white-space:nowrap;' +
    'box-shadow:0 6px 18px rgba(0,0,0,.32);font-family:inherit;display:flex;align-items:center;gap:10px';
  b.innerHTML =
    '<span>New version (' + esc(newVersion) + ') \u2014 tap to update</span>' +
    '<span id="kgh-update-dismiss" style="opacity:.7;font-weight:400;padding:0 4px">\u2715</span>';
  b.onclick = function(e) {
    if (e.target && e.target.id === 'kgh-update-dismiss') {
      b.remove();          // dismiss only — they'll be prompted again on next focus
      return;
    }
    location.reload(true); // full reload → fresh index.html → BUILD_ID purge fires
  };
  document.body.appendChild(b);
}

// iOS Safari BFCache: when the page is restored from cache (back/forward, sometimes refresh),
// in-flight fetch promises are NOT resumed but the JS heap IS preserved — leading to stale
// st.* variables and a hung await fetch. Force a fresh sync on EVERY pageshow to recover.
window.addEventListener('pageshow', function(e) {
  if (st.loaded && SHEETS_URL) {
    if (e.persisted) {
      console.log('[kgh] pageshow restored from BFCache — re-syncing');
    }
    // Always trigger a fresh sync on pageshow — defensive against iOS Safari restoring
    // a hung fetch promise from cache
    syncFromSheets();
  }
});

// Disable BFCache: an empty unload listener is enough to prevent Safari/Firefox from
// freezing the page state. This avoids the "in-flight fetch never resumes" pathology
// where iOS Safari restores st.* variables but the await fetch hangs forever.
window.addEventListener('unload', function() {});

// Boot the app
init();

function openAddOff() { openAdd("ED"); }

function setOffViewAlpha() { setOffView("alpha"); }
function setOffViewLoc()   { setOffView("location"); }

function openAddBed(b)   { openAdd("CCU", b); }
function reorderBtn(btn) {
  reorder(btn.getAttribute("data-ward"), btn.getAttribute("data-pid"), parseInt(btn.getAttribute("data-dir")));
}

function ctxEditBtn(btn) { openPatientEdit(btn.getAttribute("data-pid")); }

function openSummaryEl(el) { openPatientNotes(el.getAttribute("data-pid") || el.closest("[data-pid]").getAttribute("data-pid")); }

