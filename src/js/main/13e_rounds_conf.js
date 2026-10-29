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
  editKey: '', adding: false, loadSeq: 0
};

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
    _rd.patients.forEach(function (p) { if (p.order != null) orders[p.key] = p.order; });
    localStorage.setItem(rdLocalKey(), JSON.stringify({ at: Date.now(), start: _rd.start, attendees: _rd.attendees,
      orders: orders, dirty: _rd.dirty, submitted: _rd.submitted }));
  } catch (e) {}
}
function rdApplyLocalOrders(loc) {
  if (!loc || !loc.orders) return;
  _rd.patients.forEach(function (p) { p.order = (loc.orders[p.key] != null) ? loc.orders[p.key] : null; });
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
    _rd.patients = [];
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
    rdMergeList(j.listPatients || []);
    if (useLocal) {
      rdApplyLocalOrders(loc);
      _rd.attendees = loc.attendees || [];
      _rd.start = loc.start || '07:00';
      _rd.submitted = !!loc.submitted || !!(s && s.final);
      _rd.dirty = true;
    } else {
      _rd.attendees = s ? (s.attendees || []) : (j.defaultOn || []).slice();
      _rd.start = (s && s.start) || '07:00';
      _rd.submitted = !!(s && s.final);
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
// List patients join the session; anything the doctors edited is kept.
function rdMergeList(list) {
  list.forEach(function (lp) {
    var hit = null;
    for (var i = 0; i < _rd.patients.length && !hit; i++) {
      var p = _rd.patients[i];
      if ((lp.listId && p.listId === lp.listId) || (lp.phn && p.phn === lp.phn)) hit = p;
    }
    if (!hit) { _rd.patients.push(Object.assign({}, lp, { order: null })); return; }
    ['listId', 'dob', 'sex', 'refby', 'refbyName', 'presenter', 'icd', 'icdLabel', 'last', 'first'].forEach(function (k) {
      if (!hit[k] && lp[k]) hit[k] = lp[k];
    });
    if (!hit.icd && lp.icd) hit.icdAuto = true;
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
  _rd.start = v; rdChanged();
}
function rdToggleDoc(alias) {
  var i = _rd.attendees.indexOf(alias);
  if (i >= 0) _rd.attendees.splice(i, 1); else _rd.attendees.push(alias);
  rdChanged();
}
function rdRanked() {
  return _rd.patients.filter(function (p) { return p.order != null && !p.removed; })
                     .sort(function (a, b) { return a.order - b.order; });
}
function rdToggleDiscussed(key) {
  var p = rdFind(key);
  if (!p) return;
  if (p.order != null) {
    p.order = null;
  } else {
    var mx = 0; _rd.patients.forEach(function (q) { if (q.order != null && q.order > mx) mx = q.order; });
    p.order = mx + 1;
  }
  rdRanked().forEach(function (q, i) { q.order = i + 1; });     // close the gaps
  rdChanged();
}
function rdFind(key) { for (var i = 0; i < _rd.patients.length; i++) if (_rd.patients[i].key === key) return _rd.patients[i]; return null; }
function rdRemove(key) {
  var p = rdFind(key);
  if (!p || !p.added) return;
  _rd.patients = _rd.patients.filter(function (q) { return q.key !== key; });
  rdRanked().forEach(function (q, i) { q.order = i + 1; });
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
               order: p.order == null ? null : p.order, added: !!p.added };
    }),
    by: (st.doc && st.doc.alias) || '', final: !!final
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
  var sid = rdSid(), body = rdPayload(_rd.submitted);   // once submitted, later edits keep the review in step
  var snapshot = JSON.stringify(body.patients) + body.attendees.join() + body.start;
  rdRenderStatus();
  rdPost('roundsSave', body).then(function (j) {
    _rd.saving = false;
    if (sid !== rdSid()) return;
    var nowSnap = JSON.stringify(rdPayload(false).patients) + _rd.attendees.join() + _rd.start;
    if (nowSnap === snapshot) _rd.dirty = false; else rdQueueSave(false);
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
function rdSubmit() {
  if (_rd.submitting) return;
  var n = rdRanked().length;
  if (!n) { showToast('Tap Discussed on at least one patient first'); return; }
  if (!_rd.attendees.length) { showToast('Tick the doctors who attended'); return; }
  var miss = rdMissing();
  if (miss.length && !_rd.confirmMissing) { _rd.confirmMissing = true; rdRender(); return; }
  _rd.submitting = true; rdRender();
  var sid = rdSid();
  rdPost('roundsSave', rdPayload(true)).then(function (j) {
    _rd.submitting = false;
    if (sid !== rdSid()) return;
    _rd.submitted = true; _rd.dirty = false; _rd.confirmMissing = false;
    _rd.savedAt = j.savedAt || new Date().toISOString();
    rdLocalSave(); rdRender();
  }).catch(function (e) {
    _rd.submitting = false;
    showToast('Not submitted — ' + (e && e.message ? e.message : 'no connection') + '. Your taps are saved on this device; tap Submit again.');
    rdRender();
  });
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
  h += '<button class="btn btn-p rd-submit" onclick="rdSubmit()"' + (_rd.submitting ? ' disabled' : '') + '>' +
       (_rd.submitting ? 'Submitting…' : miss.length ? 'Submit anyway' : (_rd.submitted ? 'Re-submit for review' : 'Submit for review')) + '</button>';
  h += '</div>';
  host.innerHTML = h;
  rdRenderStatus();
}
function rdRenderStatus() {
  var el = document.getElementById('rd-status');
  if (!el) return;
  var t = '';
  if (_rd.saving) t = 'Saving…';
  else if (_rd.dirty) t = '<span class="rd-warn">Not saved to the sheet yet — kept on this device, retrying</span>';
  else if (_rd.submitted) t = 'Submitted for review' + (_rd.savedAt ? ' · last saved ' + esc(rdClock(_rd.savedAt)) : '') + ' — changes keep the review up to date';
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
  var h = '<div class="rd-card' + (tapped ? (over ? ' over' : ' on') : '') + '">' +
    '<div class="rd-info" onclick="rdEdit(\'' + k + '\')" title="Tap to edit">' +
      '<div class="rd-name">' + esc((p.last || '?') + ', ' + (p.first || '')) + '</div>' +
      '<div class="rd-meta">' + line2 + '</div><div class="rd-meta">' + line3 + '</div><div class="rd-meta">' + line4 + '</div>' +
    '</div>' +
    '<button class="rd-pill' + (tapped ? (over ? ' over' : ' on') : '') + '" onclick="rdToggleDiscussed(\'' + k + '\')">' + pill + '</button>' +
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
    rdRefFields('rde', p) + rdIcdFields('rde', p) +
    '<div id="rde-err" class="rd-err"></div>' +
    '<div class="rd-btns">' + (p.added ? '<button class="btn btn-s" onclick="rdRemove(\'' + esc(p.key) + '\')">Remove patient</button>' : '') +
      '<button class="btn btn-p" onclick="rdEditSave(\'' + esc(p.key) + '\')">Done</button></div>' +
  '</div>';
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
function rdEditSave(key) {
  var p = rdFind(key), err = document.getElementById('rde-err');
  if (!p) return;
  var dob = rdVal('rde-dob'), dn = rdCheckDob(dob);
  if (dob && !dn) { if (err) err.textContent = 'DOB must be DD/MM/YYYY'; return; }
  var phnE = rdVal('rde-phn').replace(/\D/g, ''), pp = rdPhnProblem(phnE);
  if (pp) { if (err) err.textContent = pp; return; }
  if (_rd.patients.some(function (q) { return q !== p && !q.removed && q.phn === phnE; })) { if (err) err.textContent = 'That PHN is already on the list'; return; }
  p.phn = phnE;
  p.last = rdVal('rde-last'); p.first = rdVal('rde-first');
  p.dob = dn === true ? '' : (dn || ''); p.sex = rdVal('rde-sex');
  rdReadRefIcd('rde', p);
  _rd.editKey = '';
  rdChanged();
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
    rdRefFields('rda', null) + rdIcdFields('rda', T.dx ? { icd: T.dx, icdLabel: T.dxLabel } : null) +
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
            presenter: '', refby: '', refbyName: '', icd: '', icdLabel: '', order: null, added: true };
  rdReadRefIcd('rda', p);
  if (!p.presenter && !p.refby) return say('Enter who presented');
  if (!p.icd) return say('Pick a Dx');
  _rd.patients.push(p);
  _rd.adding = false;
  rdChanged();
}
