// ── 13e_rounds_conf.js ──
// ═══════════════════════════════════════════════════════
// 13e_rounds_conf.js — v5.46 ROUNDS tab: conference billing (G10004)
//   v5.47 (2026-10-28): fine-print footer under Submit removed (Kathryn).
//   v5.48 (2026-10-28): DOB fields auto-insert the slashes (dobAutoSlash, same as
//     the patient-edit form) — the iPhone number pad has no "/" key.
//   v5.49 (2026-10-28): PHN check — spaces added as typed (9999 999 999), BC
//     MOD-11 check digit (the app's isValidPHN), red message under the field;
//     Add / Done refuse a bad PHN. PHN is now editable on the card (fix a List
//     typo); a List PHN that fails the check shows amber "PHN check failed".
//   v5.50 (2026-10-29): picking a different referring MD now shows on the card
//     ("Referring MD: Dr. Hodge, Steven" under the presenter) — e.g. an NP
//     presenting for a physician. The List presenter is kept as presented.
//   v5.59 (2026-11-18, Kathryn): NOTES + RE-SUBMIT PICKS. Each card has a
//     Notes box (extra comorbidities supporting complexity — the ICD-9 stays
//     the one Dx); shown on the card, added to every claim's note at release.
//     Re-submit: if the Review tab already holds a different value (e.g.
//     Kathryn fixed it there), the same old-vs-new pop-up as "Existing patient
//     found" opens and the doctor picks per field. Autosaves after submit no
//     longer re-stamp the submit time. Needs Rounds.gs v1.4.
//   v5.64 (2026-11-25, Kathryn): EDITS ALWAYS PERSIST. Every field a doctor
//     changes gets an edit stamp (p.ed[field]); saves send merge:1 and
//     Rounds.gs v1.8 merges field by field — a device that never touched a
//     field can't blank or revert it (Barna 25/11: a second device wiped the
//     DOB + Discussed tap). The merged copy comes back and is adopted, so
//     devices converge. Removing an added patient is a stamped flag, not a
//     splice. The List is a ONE-AND-DONE import: it only adds cards that
//     aren't in the session — it never refills or overwrites a card.
//   v5.65 (2026-11-25, Kathryn): PER-PATIENT "SUBMITTED". After Submit each
//     discussed card's pill reads "✓ 07:00–07:15 / Submitted — tap to edit
//     and resubmit" (plus Billed / On hold: reason from the Review tab).
//     Tapping a submitted pill opens the card (no accidental un-tap); the
//     card has "Save & resubmit" and "Not discussed". A changed card shows
//     "Changed — not resubmitted". The main button reads "Submit for
//     review" → "Submit changes (n)" → "✓ All submitted". Needs Rounds.gs
//     v1.9 (Submit-only Review writes, newest-wins, re-release, change log).
//   Wed Combined Heart Rounds · IHA Sarcoid Rounds · Amyloid EDRD Rounds.
//   Replaces the Wix form at kelownacardio.com/rounds (Kathryn 2026-10-28).
//   Backend: Router v3.28 + Rounds.gs v1.0 (roundsGet / roundsPhn /
//   roundsSave). Residents never see the tab (backend refuses anyway).
//
//   HOW IT WORKS (built to be used on the projector, 07:00–08:00 Wed)
//   • Wed Combined Heart is selected by default, with today (if Wednesday)
//     or the coming Wednesday, start 07:00.
//   • That day's patients come pre-loaded from the SharePoint List (the
//     Wed 06:00 Power Automate email). Attendees are pre-ticked from the
//     KCA Macro Schedule — tap a doctor to change.
//   • Tap "Discussed" in the order patients are discussed. The tap order
//     sets the 15-min slots (07:00–07:15, 07:15–07:30 …). Un-tapping moves
//     the later patients up. 6th onward = amber "over cap", not billed.
//   • "+ Add patient" — typed (no camera: the screen is projected). A PHN
//     already in the app fills name / DOB / gender.
//   • Every change autosaves to the sheet (and to this device). Submit for
//     review sends it to Kathryn's Rounds Review tab — nothing is billed
//     until she releases it after the Thursday List check.
// ═══════════════════════════════════════════════════════

var RD_TYPES = [
  { id: 'wed',     label: 'Wed Combined Heart', title: 'Wed Combined Heart Rounds', dx: '',     dxLabel: '' },
  { id: 'sarcoid', label: 'IHA Sarcoid',        title: 'IHA Sarcoid Rounds',        dx: '135',  dxLabel: 'Sarcoid (135)' },
  { id: 'amyloid', label: 'Amyloid EDRD',       title: 'Amyloid EDRD Rounds',       dx: '2773', dxLabel: 'Amyloid (2773)' }
];
var RD_CAP = 5, RD_SLOT_MIN = 15;
// Dx quick-pick pills — the phone advice web form's pills (same codes and
// labels as kelownacardio.com/md #icd-quick and PA_ICD_PILLS), plus Aortic
// Valve Dz / Mitral Valve Dz / Endocarditis / Sarcoid / Amyloid (Kathryn
// 2026-10-28). Rounds.gs suggests from the same list. One Dx per patient.
var RD_DX_PILLS = [
  { code: '4140', label: 'CAD' },            { code: '4280', label: 'Heart Failure' },
  { code: '4241', label: 'Aortic Valve Dz' }, { code: '4240', label: 'Mitral Valve Dz' },
  { code: '421',  label: 'Endocarditis' },   { code: '4254', label: 'Cardiomyopathy' },
  { code: '4273', label: 'AFib' },           { code: '427',  label: 'Arrhythmia' },
  { code: '4261', label: 'Heart Block' },    { code: '4100', label: 'NSTEMI/STEMI' },
  { code: '411',  label: 'U/A' },            { code: '7865', label: 'Chest Pain' },
  { code: '7802', label: 'Syncope' },        { code: '420',  label: 'Pericarditis' },
  { code: '4019', label: 'HTN' },            { code: '135',  label: 'Sarcoid' },
  { code: '2773', label: 'Amyloid' }
];
function rdPillLabel(code) { for (var i = 0; i < RD_DX_PILLS.length; i++) if (RD_DX_PILLS[i].code === code) return RD_DX_PILLS[i].label + ' (' + code + ')'; return ''; }
var RD_ROSTER_SEED = [
  { alias: 'SBaker', name: 'Sandy Baker' }, { alias: 'AKhosla', name: 'Amit Khosla' }, { alias: 'ASodhi', name: 'Amit Sodhi' },
  { alias: 'KBrown', name: 'Kathryn Brown' }, { alias: 'EMMassie', name: 'Emma Massie' }, { alias: 'KTodd', name: 'Keith Todd' },
  { alias: 'FHalperin', name: 'Frank Halperin' }, { alias: 'DPatton', name: 'Dan Patton' }, { alias: 'JWebber', name: 'Jordan Webber' },
  { alias: 'KHoskin', name: 'Kurt Hoskin' }, { alias: 'LHalperin', name: 'Laura Halperin' }
];

var _rd = {
  type: 'wed', date: '', start: '07:00', roster: RD_ROSTER_SEED, attendees: [], patients: [],
  scheduleNote: '', loading: false, loadErr: '', saveTimer: null, saving: false, savedAt: '',
  dirty: false, submitted: false, submitting: false, confirmMissing: false,
  editKey: '', adding: false, loadSeq: 0, conflicts: [], picks: {}, sessEd: {}
};

// ─── v5.64: edit stamps + field merge (mirror of Rounds.gs _rdMergePatients_) ──
var RD_MERGE_FIELDS = ['phn','last','first','dob','sex','presenter','refby','refbyName','icd','icdLabel','notes','order','removed'];
function rdNextTs(prev, floor) { return Math.max(Date.now(), (+prev || 0) + 1, (+floor || 0) + 1); }   // newer than anything this device has seen (v5.65: and the last submit)
function rdSnap(p) { var o = {}; RD_MERGE_FIELDS.forEach(function (f) { o[f] = p[f]; }); return o; }
function rdStampDiff(p, before) {
  p.ed = p.ed || {};
  RD_MERGE_FIELDS.forEach(function (f) {
    var a = before ? before[f] : undefined, b = p[f];
    var same = (a == null || a === '' || a === false) && (b == null || b === '' || b === false) ? true : a === b;
    if (!same) p.ed[f] = rdNextTs(p.ed[f], p.sub);
  });
}
function rdStampSess(f) { _rd.sessEd = _rd.sessEd || {}; _rd.sessEd[f] = rdNextTs(_rd.sessEd[f], _rd.sessEd._sub); }
// ─── v5.65: per-patient submit state ───
// 'new' = never submitted · 'submitted' = unchanged since its last Submit · 'changed' = edited since
function rdPState(p) {
  if (!p.sub) return (p.order != null && !p.removed) ? 'new' : 'none';
  var sub = +p.sub, e = p.ed || {}, se = _rd.sessEd || {};
  var changed = RD_MERGE_FIELDS.some(function (f) { return (+e[f] || 0) > sub; });
  if (!changed && p.order != null && (+se.attendees || 0) > (+se._sub || 0)) changed = true;   // attendees affect every claim
  if (changed) return 'changed';
  return p.order != null && !p.removed ? 'submitted' : 'none';
}
function rdPending() { return _rd.patients.filter(function (p) { var st = rdPState(p); return st === 'new' || st === 'changed'; }); }
function rdAnySubmitted() { return _rd.patients.some(function (p) { return !!p.sub; }); }
function rdBlank(v) { return v === undefined || v === null || v === '' || v === false; }
// stored = the sheet's copy, incoming = this device's. Newer stamp per field wins;
// an un-stamped value only fills a blank. Patients on either side are kept.
function rdMergePatients(stored, incoming) {
  var out = [], byKey = {}, byPhn = {};
  (stored || []).forEach(function (s) {
    var c = JSON.parse(JSON.stringify(s)); c.ed = c.ed || {};
    out.push(c); if (c.key) byKey[c.key] = c; if (c.phn) byPhn[c.phn] = c;
  });
  (incoming || []).forEach(function (x) {
    var hit = (x.key && byKey[x.key]) || (x.phn && !byKey[x.key] && byPhn[x.phn] && !x.added ? byPhn[x.phn] : null);
    if (!hit) { var n = JSON.parse(JSON.stringify(x)); n.ed = n.ed || {}; out.push(n); if (n.key) byKey[n.key] = n; return; }
    var xe = x.ed || {};
    RD_MERGE_FIELDS.forEach(function (f) {
      var inTs = +xe[f] || 0, stTs = +hit.ed[f] || 0;
      if (inTs > stTs) { hit[f] = x[f]; hit.ed[f] = inTs; }
      else if (!inTs && !stTs && rdBlank(hit[f]) && !rdBlank(x[f])) hit[f] = x[f];
    });
    if (x.listId && !hit.listId) hit.listId = x.listId;
    if (x.added) hit.added = true;
    if (x.icdAuto && hit.icd === x.icd) hit.icdAuto = true;
  });
  out.filter(function (p) { return p.order != null && p.order !== '' && !isNaN(p.order) && !p.removed; })
     .sort(function (a, b) { return (+a.order - +b.order) || ((+(a.ed || {}).order || 0) - (+(b.ed || {}).order || 0)); })
     .forEach(function (p, i) { p.order = i + 1; });
  out.forEach(function (p) { if (p.removed) p.order = null; });
  return out;
}
// Take the server's merged copy after a save, keeping any edit made on this
// device while the save was in flight (its stamp is newer).
function rdAdopt(sess) {
  if (!sess || !sess.patients) return;
  var auto = {}; _rd.patients.forEach(function (p) { if (p.icdAuto) auto[p.key] = p.icd; });
  _rd.patients = rdMergePatients(sess.patients, _rd.patients);
  _rd.patients.forEach(function (p) { if (auto[p.key] && auto[p.key] === p.icd) p.icdAuto = true; });
  var se = sess.sessEd || {}, me = _rd.sessEd || {};
  if (!((+me.attendees || 0) > (+se.attendees || 0)) && sess.attendees) _rd.attendees = sess.attendees.slice();
  if (!((+me.start || 0) > (+se.start || 0)) && sess.start) _rd.start = sess.start;
  _rd.sessEd = Object.assign({}, se, { attendees: Math.max(+me.attendees || 0, +se.attendees || 0), start: Math.max(+me.start || 0, +se.start || 0) });
}

// ─── dates ────────────────────────────────────────────────────────
function rdYmd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function rdDefaultDate(type) {
  var d = new Date();
  if (type !== 'wed') return rdYmd(d);
  var add = (3 - d.getDay() + 7) % 7;                  // today if Wednesday
  return rdYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + add));
}
function rdNiceDate(ymd) {
  var d = new Date(ymd + 'T12:00:00');
  if (isNaN(d)) return ymd;
  return d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}
function rdIsStat(ymd) { try { return typeof isBCStat === 'function' && isBCStat(ymd); } catch (e) { return false; } }
function rdTimeAdd(hhmm, mins) {
  var m = String(hhmm || '07:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  var t = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + mins) % 1440;
  return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}
function rdAge(dob) {
  var m = String(dob || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var b = new Date(+m[3], +m[2] - 1, +m[1]), n = new Date();
  var y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return (y >= 0 && y < 130) ? String(y) : '';
}
// v5.49: PHN check — the app's BC MOD-11 test (09_patient.js isValidPHN).
function rdPhnOk(d) { return typeof isValidPHN === 'function' ? isValidPHN(d) : /^9\d{9}$/.test(d); }
function rdPhnProblem(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (!d) return 'Enter the 10-digit PHN';
  if (d.length !== 10) return 'PHN is ' + d.length + ' digit' + (d.length === 1 ? '' : 's') + ' — must be 10';
  if (d.charAt(0) !== '9') return 'Not a BC PHN — BC PHNs start with 9';
  if (!rdPhnOk(d)) return 'PHN check digit invalid — a digit is likely wrong';
  return '';
}
// Spaces as typed: 9999 999 999. Shows the problem under the field once 10 digits are in.
function rdPhnTyping(el, errId) {
  var d = String(el.value || '').replace(/\D/g, '').slice(0, 10);
  var out = d.length > 7 ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d;
  if (out !== el.value) { el.value = out; try { el.setSelectionRange(out.length, out.length); } catch (e) {} }
  var err = document.getElementById(errId), msg = d.length === 10 ? rdPhnProblem(d) : '';
  if (err) err.textContent = msg;
  el.style.cssText = msg ? 'border:1.5px solid var(--red-t);background:var(--red-bg)' : '';
  return d.length === 10 && !msg ? d : '';
}
function rdFmtPhn(p) { var s = String(p || '').replace(/\D/g, ''); return s.length === 10 ? s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7) : s; }
function rdSid() { return _rd.type + '|' + _rd.date; }
function rdTypeObj() { for (var i = 0; i < RD_TYPES.length; i++) if (RD_TYPES[i].id === _rd.type) return RD_TYPES[i]; return RD_TYPES[0]; }

// ─── dot on the Rounds tab: Wed 06:30–07:50, not on a BC stat ─────
function rdDotDue() {
  var d = new Date(), mins = d.getHours() * 60 + d.getMinutes();
  return d.getDay() === 3 && mins >= 390 && mins < 470 && !rdIsStat(rdYmd(d));
}
function rdUpdateDot() {
  var dot = document.getElementById('nb-rounds-dot');
  if (dot) dot.style.display = rdDotDue() ? 'inline-block' : 'none';
}
// The pill row makes the nav taller; keep the sticky bars below it.
function rdFixSticky() {
  try {
    var h = document.querySelector('.hdr'), n = document.querySelector('.nav');
    if (h && n) document.documentElement.style.setProperty('--stick-top', (h.offsetHeight + n.offsetHeight) + 'px');
  } catch (e) {}
}
(function () {
  function boot() {
    rdUpdateDot(); rdFixSticky();
    setInterval(rdUpdateDot, 60000);
    window.addEventListener('resize', rdFixSticky);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

// ─── backend ──────────────────────────────────────────────────────
function rdGet(params) {
  var q = '?key=' + encodeURIComponent(SHARED_KEY) + '&_t=' + Date.now();
  Object.keys(params).forEach(function (k) { if (params[k] != null && params[k] !== '') q += '&' + k + '=' + encodeURIComponent(params[k]); });
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var tid = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
  return fetch(SHEETS_URL + q, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
    clearTimeout(tid);
    if (j && j.error === 'unauthorized') { if (typeof handleUnauthorized === 'function') handleUnauthorized(); throw new Error('Not signed in'); }
    if (!j || j.ok === false) throw new Error((j && j.error) || 'No response');
    return j;
  }, function (e) { clearTimeout(tid); throw e; });
}
function rdPost(action, body) {
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var tid = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
  var url = SHEETS_URL + '?action=' + action + '&key=' + encodeURIComponent(SHARED_KEY);
  var opts = { method: 'POST', body: JSON.stringify(body) };
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts).then(function (r) { return r.json(); }).then(function (j) {
    clearTimeout(tid);
    if (j && j.error === 'unauthorized') { if (typeof handleUnauthorized === 'function') handleUnauthorized(); throw new Error('Not signed in'); }
    if (!j || j.ok === false) throw new Error((j && j.error) || 'No response');
    return j;
  }, function (e) { clearTimeout(tid); throw e; });
}

// Local copy so a reload / dropped connection never loses the TAPS. No
// clinical data on the device (app rule): only card keys (List item id or
// "A<timestamp>"), the tap order, attendee aliases and the start time.
// Typed-in patients live in memory until the sheet has them.
function rdLocalKey() { return 'kgh5:roundsConf:' + rdSid(); }
function rdLocalSave() {
  try {
    var orders = {};
    var orderEd = {};
    _rd.patients.forEach(function (p) { if (p.order != null) orders[p.key] = p.order; if (p.ed && p.ed.order) orderEd[p.key] = p.ed.order; });
    localStorage.setItem(rdLocalKey(), JSON.stringify({ at: Date.now(), start: _rd.start, attendees: _rd.attendees,
      orders: orders, orderEd: orderEd, sessEd: _rd.sessEd || {}, dirty: _rd.dirty, submitted: _rd.submitted }));
  } catch (e) {}
}
function rdApplyLocalOrders(loc) {
  if (!loc || !loc.orders) return;
  var oe = loc.orderEd || {};
  _rd.patients.forEach(function (p) {
    p.ed = p.ed || {};
    var ts = +oe[p.key] || +loc.at || 0;                    // v5.64: only an unsaved tap newer than the sheet's
    if (ts <= (+p.ed.order || 0)) return;
    var v = (loc.orders[p.key] != null) ? loc.orders[p.key] : null;
    if (v !== p.order) { p.order = v; p.ed.order = ts; }
  });
  rdRanked().forEach(function (q, i) { q.order = i + 1; });
}
function rdLocalLoad() { try { return JSON.parse(localStorage.getItem(rdLocalKey()) || 'null'); } catch (e) { return null; } }

// ─── open the tab / load a session ────────────────────────────────
function initRoundsConf() {
  if (!_rd.date) _rd.date = rdDefaultDate(_rd.type);
  rdLoad();
}
function rdLoad() {
  var seq = ++_rd.loadSeq;
  _rd.loading = true; _rd.loadErr = ''; _rd.editKey = ''; _rd.adding = false; _rd.confirmMissing = false;
  var loc = rdLocalLoad();
  var keepMem = _rd.patients.length && _rd.memSid === rdSid();   // same session still in memory (tab switch)
  if (!keepMem) {
    _rd.patients = []; _rd.sessEd = (loc && loc.sessEd) || {};
    _rd.attendees = loc ? loc.attendees || [] : [];
    _rd.start = loc && loc.start ? loc.start : '07:00';
    _rd.dirty = !!(loc && loc.dirty); _rd.submitted = !!(loc && loc.submitted);
  }
  _rd.memSid = rdSid();
  rdRender();
  if (keepMem && _rd.dirty) { _rd.loading = false; rdRender(); rdQueueSave(true); return; }   // never overwrite unsaved taps
  if (!SHEETS_URL) { _rd.loading = false; _rd.loadErr = 'Offline'; rdRender(); return; }
  rdGet({ action: 'roundsGet', date: _rd.date, type: _rd.type }).then(function (j) {
    if (seq !== _rd.loadSeq) return;
    _rd.loading = false;
    if (j.roster && j.roster.length) _rd.roster = j.roster;
    _rd.scheduleNote = j.scheduleNote || '';
    var s = j.session;
    var useLocal = loc && loc.dirty && (!s || !s.savedAt || loc.at > Date.parse(s.savedAt));
    _rd.patients = s ? (s.patients || []) : [];
    _rd.patients.forEach(function (p) { p.ed = p.ed || {}; });
    _rd.sessEd = (s && s.sessEd) || {};
    rdMergeList(j.listPatients || []);
    if (useLocal) {
      rdApplyLocalOrders(loc);
      var le = loc.sessEd || {};   // v5.64: local attendees/start only if edited after the sheet's
      if (!s || (+le.attendees || 0) > (+_rd.sessEd.attendees || 0) || !le.attendees && !_rd.sessEd.attendees) {
        _rd.attendees = loc.attendees || []; if (le.attendees) _rd.sessEd.attendees = le.attendees;
      } else _rd.attendees = s.attendees || [];
      if (!s || (+le.start || 0) > (+_rd.sessEd.start || 0) || !le.start && !_rd.sessEd.start) {
        _rd.start = loc.start || '07:00'; if (le.start) _rd.sessEd.start = le.start;
      } else _rd.start = s.start || '07:00';
      _rd.submitted = !!loc.submitted || !!(s && s.final) || rdAnySubmitted();
      _rd.dirty = true;
    } else {
      _rd.attendees = s ? (s.attendees || []) : (j.defaultOn || []).slice();
      _rd.start = (s && s.start) || '07:00';
      _rd.submitted = !!(s && s.final) || rdAnySubmitted();
      _rd.dirty = false;
      if (s && s.savedAt) _rd.savedAt = s.savedAt;
    }
    rdLocalSave();
    rdRender();
    if (useLocal) rdQueueSave(true);   // push the unsaved taps up now
  }).catch(function (e) {
    if (seq !== _rd.loadSeq) return;
    _rd.loading = false; _rd.loadErr = String(e && e.message || e);
    rdRender();
  });
}
// v5.64: the List is a ONE-AND-DONE import — it only adds cards that aren't
// in the session yet. A card already here is never refilled or overwritten
// from the List (doctors' edits are final).
function rdMergeList(list) {
  list.forEach(function (lp) {
    var hit = null;
    for (var i = 0; i < _rd.patients.length && !hit; i++) {
      var p = _rd.patients[i];
      if ((lp.listId && p.listId === lp.listId) || (lp.phn && p.phn === lp.phn)) hit = p;
    }
    if (!hit) _rd.patients.push(Object.assign({}, lp, { order: null, ed: {} }));
  });
}

// ─── actions ──────────────────────────────────────────────────────
function rdSetType(id) {
  if (id === _rd.type) return;
  rdFlushNow();
  _rd.type = id; _rd.date = rdDefaultDate(id); _rd.savedAt = '';
  rdLoad();
}
function rdSetDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v === _rd.date) return;
  rdFlushNow();
  _rd.date = v; _rd.savedAt = '';
  rdLoad();
}
function rdSetStart(v) {
  if (!/^\d{1,2}:\d{2}$/.test(v)) return;
  _rd.start = v; rdStampSess('start'); rdChanged();
}
function rdToggleDoc(alias) {
  var i = _rd.attendees.indexOf(alias);
  if (i >= 0) _rd.attendees.splice(i, 1); else _rd.attendees.push(alias);
  rdStampSess('attendees');
  rdChanged();
}
function rdRanked() {
  return _rd.patients.filter(function (p) { return p.order != null && !p.removed; })
                     .sort(function (a, b) { return a.order - b.order; });
}
function rdToggleDiscussed(key) {
  var p = rdFind(key);
  if (!p) return;
  var before = {}; _rd.patients.forEach(function (q) { before[q.key] = q.order; });   // v5.64
  if (p.order != null) {
    p.order = null;
  } else {
    var mx = 0; _rd.patients.forEach(function (q) { if (q.order != null && q.order > mx) mx = q.order; });
    p.order = mx + 1;
  }
  rdRanked().forEach(function (q, i) { q.order = i + 1; });     // close the gaps
  _rd.patients.forEach(function (q) { if (q.order !== before[q.key]) { q.ed = q.ed || {}; q.ed.order = rdNextTs(q.ed.order, q.sub); } });
  rdChanged();
}
function rdFind(key) { for (var i = 0; i < _rd.patients.length; i++) if (_rd.patients[i].key === key) return _rd.patients[i]; return null; }
function rdRemove(key) {
  var p = rdFind(key);
  if (!p || !p.added) return;
  // v5.64: a stamped flag (not a splice) so the merge can't bring it back.
  var b = rdSnap(p);
  p.removed = true; p.order = null; _rd.editKey = '';
  rdStampDiff(p, b);
  var before = {}; _rd.patients.forEach(function (q) { before[q.key] = q.order; });
  rdRanked().forEach(function (q, i) { q.order = i + 1; });
  _rd.patients.forEach(function (q) { if (q !== p && q.order !== before[q.key]) { q.ed = q.ed || {}; q.ed.order = rdNextTs(q.ed.order, q.sub); } });
  rdChanged();
}
function rdChanged() {
  _rd.dirty = true; _rd.confirmMissing = false;
  rdLocalSave(); rdRender(); rdQueueSave(false);
}

// ─── autosave ─────────────────────────────────────────────────────
function rdPayload(final) {
  return {
    date: _rd.date, type: _rd.type, start: _rd.start, attendees: _rd.attendees.slice(),
    patients: _rd.patients.map(function (p) {
      return { key: p.key, listId: p.listId || '', phn: p.phn || '', last: p.last || '', first: p.first || '',
               dob: p.dob || '', sex: p.sex || '', presenter: p.presenter || '', refby: p.refby || '',
               refbyName: p.refbyName || '', icd: p.icd || '', icdLabel: p.icdLabel || '',
               notes: p.notes || '',
               order: p.order == null ? null : p.order, added: !!p.added,
               removed: !!p.removed, ed: p.ed || {} };                 // v5.64
    }),
    by: (st.doc && st.doc.alias) || '', final: !!final,
    merge: 1, sessEd: _rd.sessEd || {}                                // v5.64: field merge (Rounds.gs v1.8)
  };
}
function rdQueueSave(now) {
  clearTimeout(_rd.saveTimer);
  _rd.saveTimer = setTimeout(rdDoSave, now ? 0 : 1200);
}
function rdFlushNow() { if (_rd.dirty) { clearTimeout(_rd.saveTimer); rdDoSave(); } }
function rdDoSave() {
  if (!SHEETS_URL || !_rd.dirty) return;
  if (_rd.saving) { rdQueueSave(false); return; }
  _rd.saving = true;
  // v5.59: autosave never re-submits; the backend still keeps the Review in
  // step once the session is submitted, but never overwrites a Review edit.
  var sid = rdSid(), body = rdPayload(false);
  var snapshot = JSON.stringify(body.patients) + body.attendees.join() + body.start;
  rdRenderStatus();
  rdPost('roundsSave', body).then(function (j) {
    _rd.saving = false;
    if (sid !== rdSid()) return;
    var nowSnap = JSON.stringify(rdPayload(false).patients) + _rd.attendees.join() + _rd.start;
    var editedMeanwhile = nowSnap !== snapshot;
    if (j.session) { rdAdopt(j.session); if (!_rd.editKey && !_rd.adding) rdRender(); }   // v5.64: converge on the merged copy
    if (!editedMeanwhile) _rd.dirty = false; else rdQueueSave(false);
    _rd.savedAt = j.savedAt || new Date().toISOString();
    rdLocalSave(); rdRenderStatus();
  }).catch(function () {
    _rd.saving = false;
    if (sid !== rdSid()) return;
    rdRenderStatus();
    clearTimeout(_rd.saveTimer);
    _rd.saveTimer = setTimeout(rdDoSave, 8000);                // quiet retry; taps are kept on the device
  });
}

// ─── submit for review ────────────────────────────────────────────
function rdMissing() {
  var out = [];
  rdRanked().forEach(function (p, i) {
    if (i >= RD_CAP) return;
    var m = [];
    if (String(p.phn || '').replace(/\D/g, '').length !== 10) m.push('PHN');
    if (!p.dob) m.push('DOB'); if (!p.sex) m.push('gender'); if (!p.icd) m.push('Dx'); if (!p.refby) m.push('presenter MSP #');
    if (m.length) out.push((p.last || '?') + ': ' + m.join(', '));
  });
  return out;
}
function rdSubmit(resolve) {
  if (_rd.submitting) return;
  var n = rdRanked().length;
  if (!n) { showToast('Tap Discussed on at least one patient first'); return; }
  if (!_rd.attendees.length) { showToast('Tick the doctors who attended'); return; }
  if (rdAnySubmitted() && !rdPending().length && !resolve) { showToast('All submitted — tap a patient to change it'); return; }   // v5.65
  var miss = rdMissing();
  if (miss.length && !_rd.confirmMissing) { _rd.confirmMissing = true; rdRender(); return; }
  _rd.submitting = true; rdRender();
  var sid = rdSid(), body = rdPayload(true);
  if (resolve) body.resolve = resolve;
  rdPost('roundsSave', body).then(function (j) {
    _rd.submitting = false;
    if (sid !== rdSid()) return;
    _rd.submitted = true; _rd.dirty = false; _rd.confirmMissing = false;
    _rd.savedAt = j.savedAt || new Date().toISOString();
    if (j.session) rdAdopt(j.session);                                // v5.64
    rdLocalSave(); rdRender();
    // v5.65: claims already exported to iClinic are never changed from here
    if (j.afterExport && j.afterExport.length) showToast('Already exported to iClinic — fix there: ' + j.afterExport.join('; '));
    else if (j.problems && j.problems.length) showToast(j.problems.join('; '));
    if (j.conflicts && j.conflicts.length) rdOpenConflicts(j.conflicts);   // v5.59
  }).catch(function (e) {
    _rd.submitting = false;
    showToast('Not submitted — ' + (e && e.message ? e.message : 'no connection') + '. Your taps are saved on this device; tap Submit again.');
    rdRender();
  });
}

// ─── v5.59: re-submit — Review tab value vs app value, doctor picks ───
// Same look as the "Existing patient found" pop-up (merge-modal, dup-* CSS).
function rdConflictShow(c, v) {
  if (c.field === 'attendees') {
    var nm = {}; _rd.roster.forEach(function (d) { nm[d.alias] = d.name; });
    return String(v || '').split(',').map(function (a) { a = a.trim(); return nm[a] || a; }).filter(String).join(', ');
  }
  if (c.field === 'phn') return rdFmtPhn(v);
  if (c.field === 'icd') return rdPillLabel(String(v).replace(/\./g, '')) || v;
  return v;
}
function rdOpenConflicts(list) {
  _rd.conflicts = list; _rd.picks = {};
  var h = '<div class="dup-confirm">The Review tab already has different info for ' +
          (list.length === 1 ? 'this field' : 'these fields') + ' — pick the correct value.</div>';
  var lastName = null;
  list.forEach(function (c, i) {
    _rd.picks[i] = 'app';
    if (c.name !== lastName) { h += '<div class="rd-lbl" style="margin:10px 0 2px">' + esc(c.name) + '</div>'; lastName = c.name; }
    h += '<div class="dup-row"><div class="dup-label">' + esc(c.label) + '</div><div class="dup-pills">' +
         '<button class="dup-pill" data-ci="' + i + '" data-which="sheet" onclick="rdTapConflict(this)">' +
           esc(rdConflictShow(c, c.sheet)) + '<span class="dup-pill-tag">in review</span></button>' +
         '<button class="dup-pill selected" data-ci="' + i + '" data-which="app" onclick="rdTapConflict(this)">' +
           esc(rdConflictShow(c, c.app)) + '<span class="dup-pill-tag">new</span></button>' +
         '</div></div>';
  });
  h += '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-p" style="flex:1;margin:0" onclick="rdSaveConflicts()">Save choices</button></div>';
  document.getElementById('merge-title').textContent = 'Changed since submitted — which is correct?';
  document.getElementById('merge-body').innerHTML = h;
  showModal('merge-modal');
}
function rdTapConflict(el) {
  var i = el.getAttribute('data-ci'), which = el.getAttribute('data-which');
  _rd.picks[i] = which;
  Array.prototype.forEach.call(document.querySelectorAll('.dup-pill[data-ci="' + i + '"]'), function (b) {
    b.classList.toggle('selected', b.getAttribute('data-which') === which);
  });
}
function rdSaveConflicts() {
  var resolve = {};
  _rd.conflicts.forEach(function (c, i) {
    if (_rd.picks[i] === 'app') { (resolve[c.key] = resolve[c.key] || {})[c.field] = 'app'; return; }
    // Review value wins → copy it into the app so both agree from now on.
    if (c.field === 'attendees') { _rd.attendees = String(c.sheet || '').split(',').map(function (a) { return a.trim(); }).filter(String); rdStampSess('attendees'); return; }
    var p = rdFind(c.key);
    if (!p) return;
    var _b = rdSnap(p);
    if (c.field === 'refby') { p.refby = (c.sheetVal && c.sheetVal.refby) || ''; p.refbyName = (c.sheetVal && c.sheetVal.refbyName) || ''; }
    else if (c.field === 'icd') { p.icd = String(c.sheet).replace(/\./g, ''); p.icdLabel = rdPillLabel(p.icd) || p.icd; p.icdAuto = false; }
    else if (c.field === 'phn') p.phn = String(c.sheet).replace(/\D/g, '');
    else p[c.field] = c.sheet;
    rdStampDiff(p, _b);                                               // v5.64
  });
  _rd.conflicts = []; _rd.picks = {};
  hideModal('merge-modal');
  _rd.confirmMissing = true;               // already confirmed once — don't re-ask about missing fields
  rdSubmit(resolve);
}

// ─── render ───────────────────────────────────────────────────────
function rdRender() {
  var host = document.getElementById('rd-host');
  if (!host) return;
  var T = rdTypeObj(), ranked = rdRanked(), stat = rdIsStat(_rd.date);
  var nameOf = {}; _rd.roster.forEach(function (d) { nameOf[d.alias] = d.name; });
  var h = '';
  // Banner
  h += '<div class="rd-banner"><div class="rd-banner-t">' + esc(T.title) + '</div>' +
       '<div class="rd-banner-s">' + esc(rdNiceDate(_rd.date)) + ' · ' + esc(_rd.start) + ' · ' +
       _rd.patients.filter(function (p) { return !p.removed; }).length + ' patient(s) · ' + ranked.length + ' discussed' +
       (stat ? ' · <b>BC stat holiday</b>' : '') + '</div></div>';
  // Type chips
  h += '<div class="rd-chips">' + RD_TYPES.map(function (t) {
    return '<button class="rd-chip' + (t.id === _rd.type ? ' on' : '') + '" onclick="rdSetType(\'' + t.id + '\')">' + esc(t.label) + '</button>';
  }).join('') + '</div>';
  // Date + start
  h += '<div class="rd-row2"><label>Date <input type="date" value="' + esc(_rd.date) + '" onchange="rdSetDate(this.value)"></label>' +
       '<label>Start <input type="time" value="' + esc(_rd.start) + '" step="300" onchange="rdSetStart(this.value)"></label></div>';
  // Attendees
  h += '<div class="rd-lbl">Attending' + (_rd.type === 'wed' ? ' — from this week\'s schedule, tap to change' : ' — tap who attended') + '</div>';
  h += '<div class="rd-chips">' + _rd.roster.map(function (d) {
    var on = _rd.attendees.indexOf(d.alias) >= 0;
    return '<button class="rd-doc' + (on ? ' on' : '') + '" onclick="rdToggleDoc(\'' + d.alias + '\')">' + (on ? '✓ ' : '') + esc(d.name) + '</button>';
  }).join('') + '</div>';
  if (_rd.scheduleNote) h += '<div class="rd-note">' + esc(_rd.scheduleNote) + '</div>';
  // Patients
  h += '<div class="rd-lbl">Patients' + (_rd.type === 'wed' ? ' from the List' : '') + ' — tap Discussed in the order discussed</div>';
  if (_rd.loading && !_rd.patients.length) h += '<div class="rd-empty">Loading…</div>';
  else if (_rd.loadErr && !_rd.patients.length) h += '<div class="rd-empty rd-warn">Couldn\'t load the List (' + esc(_rd.loadErr) + '). Add patients below — or <a href="#" onclick="rdLoad();return false">try again</a>.</div>';
  else if (!_rd.patients.length) h += '<div class="rd-empty">' + (_rd.type === 'wed' ? 'No List patients for this date yet. ' : '') + 'Add patients below.</div>';
  var rankOf = {}; ranked.forEach(function (p, i) { rankOf[p.key] = i; });
  _rd.patients.forEach(function (p) { if (!p.removed) h += rdCardHtml(p, rankOf[p.key]); });
  // Add patient
  h += _rd.adding ? rdAddFormHtml() : '<button class="rd-add" onclick="rdOpenAdd()">+ Add patient</button>';
  // Footer
  var miss = _rd.confirmMissing ? rdMissing() : [];
  h += '<div class="rd-foot">';
  if (miss.length) h += '<div class="rd-warn rd-missing">Missing — Kathryn will need to fill these in review:<br>• ' + miss.map(esc).join('<br>• ') + '</div>';
  h += '<div id="rd-status" class="rd-status"></div>';
  var _allDone = rdAnySubmitted() && !rdPending().length;   // v5.65
  h += '<button class="btn ' + (_allDone ? 'btn-s' : 'btn-p') + ' rd-submit" onclick="rdSubmit()"' + (_rd.submitting ? ' disabled' : '') + '>' +
       (_rd.submitting ? 'Submitting…' : miss.length ? 'Submit anyway' : rdSubmitLabel()) + '</button>';
  h += '</div>';
  host.innerHTML = h;
  rdRenderStatus();
}
function rdSubmitLabel() {   // v5.65
  if (!rdAnySubmitted()) return 'Submit for review';
  var n = rdPending().length;
  return n ? 'Submit changes (' + n + ')' : '✓ All submitted';
}
function rdRenderStatus() {
  var el = document.getElementById('rd-status');
  if (!el) return;
  var t = '';
  if (_rd.saving) t = 'Saving…';
  else if (_rd.dirty) t = '<span class="rd-warn">Not saved to the sheet yet — kept on this device, retrying</span>';
  else if (_rd.submitted) t = rdPending().length ? '<span class="rd-warn">Changes not submitted yet — tap Submit changes</span>' : 'All discussed patients submitted' + (_rd.savedAt ? ' · ' + esc(rdClock(_rd.savedAt)) : '');
  else if (_rd.savedAt) t = 'Saved ' + esc(rdClock(_rd.savedAt));
  el.innerHTML = t;
}
function rdClock(iso) { var d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function rdCardHtml(p, rank) {
  var tapped = rank != null, over = tapped && rank >= RD_CAP;
  var age = rdAge(p.dob);
  var ag = (age || p.sex) ? (age + (p.sex || '')) : '';
  var line2 = (ag ? esc(ag) : '<span class="rd-warn">Age/gender ?</span>') + ' · PHN ' + (p.phn ? esc(rdFmtPhn(p.phn)) + (rdPhnProblem(p.phn) ? ' <span class="rd-warn">PHN check failed</span>' : '') : '<span class="rd-warn">?</span>');
  var pres = p.presenter || p.refbyName || '';
  // v5.50: show the referring MD when it differs from the presenter (e.g. an NP
  // presenting for the physician) — the claim bills the referring MD, not the presenter.
  var _sur = function (x) {
    var t = String(x || '').replace(/\b(dr|np)\.?\s+/ig, '').trim();
    t = t.indexOf(',') >= 0 ? t.split(',')[0] : t.split(/\s+/).pop();
    return t.toLowerCase().replace(/[^a-z]/g, '');
  };
  var _refSame = !!(p.refbyName && p.presenter && _sur(p.refbyName) === _sur(p.presenter));
  var line3 = 'Presented: ' + (pres ? esc(pres) : '<span class="rd-warn">?</span>') + (pres && !p.refby ? ' <span class="rd-tag">no MSP #</span>' : '') +
              (p.refby && p.refbyName && p.presenter && !_refSame ? '<br>Referring MD: ' + esc(p.refbyName) : '');
  var line4 = 'Dx: ' + (p.icd ? esc(p.icdLabel || p.icd) + (p.icdAuto ? ' <span class="rd-tag">suggested</span>' : '') : '<span class="rd-warn">tap to pick</span>');
  var pill = over ? 'Discussed — over cap' : tapped ? '✓ ' + rdTimeAdd(_rd.start, rank * RD_SLOT_MIN) + '–' + rdTimeAdd(_rd.start, (rank + 1) * RD_SLOT_MIN) : 'Discussed';
  var k = esc(p.key);
  // v5.65: per-patient submit state
  var pst = rdPState(p), subTap = tapped && (pst === 'submitted' || pst === 'changed');
  if (tapped && pst === 'submitted') pill += '<span class="rd-pill-sub">Submitted — tap to edit and resubmit</span>';
  else if (tapped && pst === 'changed') pill += '<span class="rd-pill-sub">Changed — not resubmitted</span>';
  var rv = p.rv || {}, line5 = '';
  if (tapped && p.sub && pst === 'submitted') {
    if (rv.s === 'RELEASED') line5 = rv.why ? '<span class="rd-warn">' + esc(rv.why) + '</span>' : '<span class="rd-ok">Billed ✓</span>';
    else if (rv.s === 'READY') line5 = '<span class="rd-ok">Ready to bill</span>';
    else if (rv.s === 'HOLD') line5 = '<span class="rd-warn">On hold: ' + esc(rv.why || '') + '</span>';
    else if (rv.s === 'SKIP') line5 = '<span class="rd-warn">Not billed: ' + esc(rv.why || '') + '</span>';
  }
  var h = '<div class="rd-card' + (tapped ? (over ? ' over' : ' on') : '') + '">' +
    '<div class="rd-info" onclick="rdEdit(\'' + k + '\')" title="Tap to edit">' +
      '<div class="rd-name">' + esc((p.last || '?') + ', ' + (p.first || '')) + '</div>' +
      '<div class="rd-meta">' + line2 + '</div><div class="rd-meta">' + line3 + '</div><div class="rd-meta">' + line4 + '</div>' +
      (p.notes ? '<div class="rd-meta">Notes: ' + esc(p.notes.length > 140 ? p.notes.slice(0, 140) + '…' : p.notes) + '</div>' : '') +
      (line5 ? '<div class="rd-meta">' + line5 + '</div>' : '') +
    '</div>' +
    '<button class="rd-pill' + (tapped ? (over ? ' over' : ' on') : '') + (pst === 'changed' && tapped ? ' chg' : '') + '" onclick="' +
      (subTap ? 'rdEdit' : 'rdToggleDiscussed') + '(\'' + k + '\')">' + pill + '</button>' +
  '</div>';
  if (_rd.editKey === p.key) h += rdEditHtml(p);
  return h;
}

// ─── edit a card (DOB / gender / presenter / Dx) ──────────────────
function rdEdit(key) { _rd.editKey = (_rd.editKey === key) ? '' : key; _rd.adding = false; rdRender(); }
function rdEditHtml(p) {
  return '<div class="rd-edit">' +
    '<div class="rd-grid">' +
      '<input id="rde-phn" placeholder="PHN (10 digits)" value="' + esc(rdFmtPhn(p.phn || '')) + '" inputmode="numeric" maxlength="12" oninput="rdPhnTyping(this,\'rde-phn-err\')">' +
      '<div id="rde-phn-err" class="rd-err" style="grid-column:1 / -1;margin:0">' + esc(p.phn ? rdPhnProblem(p.phn) : '') + '</div>' +
      '<input id="rde-last" placeholder="Last name" value="' + esc(p.last || '') + '" autocapitalize="words">' +
      '<input id="rde-first" placeholder="First name" value="' + esc(p.first || '') + '" autocapitalize="words">' +
      '<input id="rde-dob" placeholder="DOB DD/MM/YYYY" value="' + esc(p.dob || '') + '" inputmode="numeric" maxlength="10" oninput="dobAutoSlash(this)">' +
      rdSexSelect('rde-sex', p.sex) +
    '</div>' +
    rdRefFields('rde', p) + rdIcdFields('rde', p) + rdNotesField('rde-notes', p.notes) +
    '<div id="rde-err" class="rd-err"></div>' +
    '<div class="rd-btns">' + (p.added ? '<button class="btn btn-s" onclick="rdRemove(\'' + esc(p.key) + '\')">Remove patient</button>' : '') +
      (p.sub && p.order != null ? '<button class="btn btn-s" onclick="rdUndiscuss(\'' + esc(p.key) + '\')">Not discussed</button>' +
        '<button class="btn btn-p" onclick="rdEditSave(\'' + esc(p.key) + '\',true)">Save &amp; resubmit</button>'
        : '<button class="btn btn-p" onclick="rdEditSave(\'' + esc(p.key) + '\')">Done</button>') + '</div>' +
  '</div>';
}
function rdNotesField(id, v) {   // v5.59
  return '<div class="rd-lbl" style="margin-top:4px">Notes — other comorbidities / complexity (optional)</div>' +
    '<textarea id="' + id + '" class="rd-wide" rows="2" maxlength="600" style="resize:vertical;font-family:inherit" ' +
    'placeholder="e.g. CKD 4, prior CABG, frailty — added to the claim note">' + esc(v || '') + '</textarea>';
}
function rdSexSelect(id, v) {
  return '<select id="' + id + '"><option value="">Gender</option>' + ['F', 'M', 'X'].map(function (s) {
    return '<option' + (v === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
}
function rdRefFields(pre, p) {
  return '<input id="' + pre + '-ref-search" class="rd-wide" placeholder="Presented by — search name" autocomplete="off" autocorrect="off" ' +
    'value="' + esc((p && (p.refbyName || p.presenter)) || '') + '" data-dd="' + pre + '-ref-dd" data-hidden="' + pre + '-ref-num" data-name="' + pre + '-ref-name" ' +
    'oninput="refSearchEl(this)" onfocus="refSearchEl(this)">' +
    '<div id="' + pre + '-ref-dd" class="ref-dd"></div>' +
    '<input type="hidden" id="' + pre + '-ref-num" value="' + esc((p && p.refby) || '') + '">' +
    '<input type="hidden" id="' + pre + '-ref-name" value="' + esc((p && p.refbyName) || '') + '">';
}
function rdIcdFields(pre, p) {
  var cur = (p && p.icd) || '';
  return '<div class="rd-lbl" style="margin-top:4px">Dx — one major cardiac diagnosis</div>' +
    '<div class="rd-chips" id="' + pre + '-pills">' + RD_DX_PILLS.map(function (d) {
      return '<button type="button" class="rd-chip' + (d.code === cur ? ' on' : '') + '" data-code="' + d.code + '" ' +
             'onclick="rdPickPill(\'' + pre + '\',\'' + d.code + '\')">' + esc(d.label) + '</button>';
    }).join('') + '</div>' +
    '<input id="' + pre + '-icd-search" class="rd-wide" placeholder="Other Dx — search ICD-9" autocomplete="off" autocorrect="off" ' +
    'value="' + esc((p && (p.icdLabel || p.icd)) || '') + '" data-dd="' + pre + '-icd-dd" data-hidden="' + pre + '-icd-code" ' +
    'oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
    '<div id="' + pre + '-icd-dd" class="ref-dd"></div>' +
    '<input type="hidden" id="' + pre + '-icd-code" value="' + esc((p && p.icd) || '') + '">';
}
function rdPickPill(pre, code) {
  var h = document.getElementById(pre + '-icd-code'), inp = document.getElementById(pre + '-icd-search');
  var same = h && h.value === code;
  if (h) h.value = same ? '' : code;
  if (inp) inp.value = same ? '' : rdPillLabel(code);
  var box = document.getElementById(pre + '-pills');
  if (box) Array.prototype.forEach.call(box.querySelectorAll('.rd-chip'), function (b) {
    b.classList.toggle('on', !same && b.getAttribute('data-code') === code);
  });
}
function rdVal(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
function rdReadRefIcd(pre, p) {
  var num = rdVal(pre + '-ref-num'), nm = rdVal(pre + '-ref-name'), typed = rdVal(pre + '-ref-search');
  if (nm && typed === nm) { p.refby = num; p.refbyName = nm; p.presenter = p.presenter || nm; }
  else if (typed !== (p.refbyName || p.presenter || '')) { p.presenter = typed; p.refby = ''; p.refbyName = ''; }
  var code = rdVal(pre + '-icd-code'), lab = rdVal(pre + '-icd-search');
  if (code && code !== p.icd) { p.icd = code; p.icdLabel = lab || code; p.icdAuto = false; }
  else if (!lab) { p.icd = ''; p.icdLabel = ''; p.icdAuto = false; }
  else if (code === p.icd && lab !== p.icdLabel && /^\d{3,4}$/.test(lab)) { p.icd = lab; p.icdLabel = lab; p.icdAuto = false; }
}
function rdCheckDob(v) { return !v || (typeof dobNormDMY === 'function' ? dobNormDMY(v) : (/^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v : '')); }
// v5.65: un-tap a submitted patient from its card, then resubmit (its claims are withdrawn if not yet exported)
function rdUndiscuss(key) {
  var p = rdFind(key);
  if (!p || p.order == null) return;
  _rd.editKey = '';
  rdToggleDiscussed(key);
  _rd.confirmMissing = true;
  rdSubmit();
}
function rdEditSave(key, resubmit) {
  var p = rdFind(key), err = document.getElementById('rde-err');
  if (!p) return;
  var dob = rdVal('rde-dob'), dn = rdCheckDob(dob);
  if (dob && !dn) { if (err) err.textContent = 'DOB must be DD/MM/YYYY'; return; }
  var phnE = rdVal('rde-phn').replace(/\D/g, ''), pp = rdPhnProblem(phnE);
  if (pp) { if (err) err.textContent = pp; return; }
  if (_rd.patients.some(function (q) { return q !== p && !q.removed && q.phn === phnE; })) { if (err) err.textContent = 'That PHN is already on the list'; return; }
  var before = rdSnap(p);                                             // v5.64
  p.phn = phnE;
  p.last = rdVal('rde-last'); p.first = rdVal('rde-first');
  p.dob = dn === true ? '' : (dn || ''); p.sex = rdVal('rde-sex');
  rdReadRefIcd('rde', p);
  p.notes = rdVal('rde-notes').replace(/\s+/g, ' ');
  rdStampDiff(p, before);                                             // v5.64: only what changed is stamped
  _rd.editKey = '';
  rdChanged();
  if (resubmit) { _rd.confirmMissing = true; rdSubmit(); }            // v5.65: card shows any hold reason
}

// ─── add a patient (typed) ────────────────────────────────────────
function rdOpenAdd() { _rd.adding = true; _rd.editKey = ''; rdRender(); setTimeout(function () { var e = document.getElementById('rda-phn'); if (e) e.focus(); }, 50); }
function rdCloseAdd() { _rd.adding = false; rdRender(); }
function rdAddFormHtml() {
  var T = rdTypeObj();
  return '<div class="rd-edit rd-addform"><div class="rd-addt">Add patient</div>' +
    '<input id="rda-phn" class="rd-wide" placeholder="PHN (10 digits)" inputmode="numeric" maxlength="12" oninput="rdPhnInput(this)">' +
    '<div id="rda-phn-err" class="rd-err" style="margin:-4px 0 4px"></div>' +
    '<div id="rda-hit" class="rd-note"></div>' +
    '<div class="rd-grid">' +
      '<input id="rda-last" placeholder="Last name" autocapitalize="words">' +
      '<input id="rda-first" placeholder="First name" autocapitalize="words">' +
      '<input id="rda-dob" placeholder="DOB DD/MM/YYYY" inputmode="numeric" maxlength="10" oninput="dobAutoSlash(this)">' +
      rdSexSelect('rda-sex', '') +
    '</div>' +
    rdRefFields('rda', null) + rdIcdFields('rda', T.dx ? { icd: T.dx, icdLabel: T.dxLabel } : null) + rdNotesField('rda-notes', '') +
    '<div id="rda-err" class="rd-err"></div>' +
    '<div class="rd-btns"><button class="btn btn-s" onclick="rdCloseAdd()">Cancel</button>' +
    '<button class="btn btn-p" onclick="rdAddSave()">Add to rounds</button></div></div>';
}
var _rdPhnSeq = 0;
function rdPhnInput(el) {
  var phn = rdPhnTyping(el, 'rda-phn-err'), hit = document.getElementById('rda-hit');
  if (hit) hit.textContent = '';
  if (!phn) return;                                   // incomplete or fails the check
  var fill = function (src, where) {
    var set = function (id, val) { var e = document.getElementById(id); if (e && val && !e.value) e.value = val; };
    set('rda-last', src.last); set('rda-first', src.first); set('rda-dob', src.dob);
    var sx = document.getElementById('rda-sex'); if (sx && src.sex && !sx.value) sx.value = String(src.sex).toUpperCase().slice(0, 1);
    if (hit) hit.textContent = 'Found ' + (src.last || '') + ', ' + (src.first || '') + ' ' + where + ' — check and add.';
  };
  var local = (st.patients || []).filter(function (p) { return String(p.phn || '').replace(/\D/g, '') === phn; })[0];
  if (local) { fill(local, 'in the app'); return; }
  var seq = ++_rdPhnSeq;
  if (hit) hit.textContent = 'Looking up…';
  rdGet({ action: 'roundsPhn', phn: phn }).then(function (j) {
    if (seq !== _rdPhnSeq) return;
    if (j.found) fill(j, 'in the patient archive'); else if (hit) hit.textContent = 'Not in the app — type the details.';
  }).catch(function () { if (seq === _rdPhnSeq && hit) hit.textContent = 'Lookup unavailable — type the details.'; });
}
function rdAddSave() {
  var err = document.getElementById('rda-err');
  var say = function (m) { if (err) err.textContent = m; };
  var phn = rdVal('rda-phn').replace(/\D/g, '');
  var pp = rdPhnProblem(phn);
  if (pp) return say(pp);
  if (_rd.patients.some(function (p) { return !p.removed && p.phn === phn; })) return say('That patient is already on the list');
  var last = rdVal('rda-last'), first = rdVal('rda-first');
  if (!last || !first) return say('Enter last and first name');
  var dob = rdVal('rda-dob'), dn = rdCheckDob(dob);
  if (!dob || !dn || dn === true) return say('Enter DOB as DD/MM/YYYY');
  var sex = rdVal('rda-sex');
  if (!sex) return say('Pick a gender');
  var p = { key: 'A' + Date.now(), listId: '', phn: phn, last: last, first: first, dob: dn, sex: sex,
            presenter: '', refby: '', refbyName: '', icd: '', icdLabel: '', order: null, added: true,
            notes: rdVal('rda-notes').replace(/\s+/g, ' ') };
  rdReadRefIcd('rda', p);
  if (!p.presenter && !p.refby) return say('Enter who presented');
  if (!p.icd) return say('Pick a Dx');
  rdStampDiff(p, null);                                               // v5.64: every typed field is an edit
  _rd.patients.push(p);
  _rd.adding = false;
  rdChanged();
}
