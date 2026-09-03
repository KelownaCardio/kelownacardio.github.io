// ═══════════════════════════════════════════════════════════════════
// 15_review.js — PHYSICIAN REVIEW MODE            v5.12 (2026-09-02)
// ───────────────────────────────────────────────────────────────────
// index.html?review=<token> — a doctor's list of billing blockers from the
// ClaimReview tab (filled nightly by PhysicianReview.gs), presented as one
// card each, fixed with THE APP'S OWN SCREENS: the Day Timeline for time
// edits (so every call-out tier, unit count, 08:00 cap and CCFPP note is
// re-derived by the same code as the phone), Patient Edit for demographics
// (M/F pills, DOB validation, cascade onto claim rows), the claim editor
// for a referring physician (directory search + add-new), and addClaim for
// a MOST. This file adds NO billing logic of its own.
//
// Kathryn's decisions this design follows (2026-09-01/02):
//   • the token is a DEEP LINK to a card, not a credential — the app's
//     normal password applies, and st.doc is set in memory from the token
//   • one card per point, read straight down: what's missing → the one
//     tap → the chart link → optional note → Resubmit
//   • patient-record gaps (DOB + sex) are ONE card
//   • banner is two words: "Not yet billable" / "Can submit"
//   • ATTEST codes are a single tap on one of two pills; FILL only closes
//     on real data; RESOLVE (overlaps) has NO dismiss — only fix, or
//     "Email me — I'll fix it later" (a note to self, re-emailed next sweep)
//   • nothing on the page says error, wrong or failed
//
// Inert unless ?review= is present: in the normal app this file defines a
// few functions and does nothing.
// ═══════════════════════════════════════════════════════════════════

var RV = {
  token: (typeof window !== 'undefined' && window.REVIEW_TOKEN) || '',
  bundle: null,       // last getClaimReview response
  cards: [],          // built from bundle.rows (+ grouping)
  cur: 0,
  choice: {},         // cardKey → 'attest' | 'add'
  notes: {},          // cardKey → the doctor's note to self
  busy: false
};

var RV_CONSULT_FEES = { '33010':1,'33012':1,'33005':1,'33014':1,'00751':1 };
var RV_MOD_FEES     = { '1200':1,'1201':1,'1202':1,'1205':1,'1206':1,'1207':1 };
var RV_GROUP_BY_PATIENT = { MISSING_DEMOGRAPHICS:1, MISSING_NAME:1 };

// ── boot ───────────────────────────────────────────────────────────
(function rvBoot(){
  if (typeof isReviewMode !== 'function' || !isReviewMode()) return;
  if (!window._kghReady) return;
  // Mount NOW, before the first sync — otherwise the doctor sees and can
  // use the phone UI for up to ~40s while getAll runs.
  try { rvInjectCss(); rvMountPane(); rvMessage('Loading your claims…'); } catch (e) {}
  window._kghReady.then(function(ready){ rvStart(ready); });
})();

async function rvStart(ready) {
  rvInjectCss();
  rvMountPane();

  if (typeof isResident === 'function' && isResident()) {
    rvMessage('This review page is for the billing physician\'s own sign-in. '
            + 'This device is signed in as Resident.');
    return;
  }
  if (!ready || !ready.ok) {
    // Most often: this device's stored password is stale, and the app's
    // own prompt is about to appear. Wait for a good sync, then load.
    rvMessage('Waiting for the app to sign in on this device…'
            + (ready && ready.error ? ' (' + ready.error + ')' : ''));
    var t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await new Promise(function(r){ setTimeout(r, 2000); });
      if (window._lastSyncOkAt) return rvLoad();
    }
    rvMessage('Still not signed in — enter the app password when prompted, then reload this page.');
    return;
  }
  await rvLoad();
}

async function rvLoad() {
  rvMessage('Loading your claims…');
  var res = await rvCall('getClaimReview', { token: RV.token });
  if (res && /unauthorized/i.test(String(res.error || ''))) {
    // The stored password is wrong for this device (shared PC, rotated
    // key). The app's own prompt takes over after its retry budget; wait
    // for a good sync, then load again — up to 5 minutes.
    rvMessage('The app password on this device needs entering — use the prompt, and this page will carry on.');
    var t0 = Date.now(), before = window._lastSyncOkAt || 0;
    while (Date.now() - t0 < 300000) {
      await new Promise(function(r){ setTimeout(r, 2000); });
      if ((window._lastSyncOkAt || 0) > before) return rvLoad();
    }
    rvMessage('Still waiting for the app password — reload the page once it is entered.');
    return;
  }
  if (!res || !res.ok) {
    rvMessage((res && res.error) || 'This link could not be opened.');
    return;
  }
  RV.bundle = res;
  rvAdoptDoctor(res.doctor);
  rvPinBundle(res);
  RV.cards = rvBuildCards(res);
  rvRender();
}

// POST exactly as push() does, but return the parsed reply. Reads AND the
// reviewAction write go through here — push() is fire-and-forget by design.
async function rvCall(action, body) {
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var tid = ctrl ? setTimeout(function(){ ctrl.abort(); }, 25000) : null;
  try {
    var r = await fetch(SHEETS_URL + '?action=' + action + '&key=' + encodeURIComponent(SHARED_KEY),
                        ctrl ? { method:'POST', body: JSON.stringify(body || {}), signal: ctrl.signal }
                             : { method:'POST', body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) {
    return { ok:false, error: (e && e.name === 'AbortError') ? 'No reply from billing in 25s — try again' : (e.message || String(e)) };
  } finally {
    if (tid) clearTimeout(tid);
  }
}

// ── identity: canon alias → the app's own alias, IN MEMORY ONLY ────
// The queue stores the canonical alias ('KP'); claims and st.doctors use
// the app alias ('KPistawka'). Match on canonAlias() so the Day Timeline
// (which filters c.alias === st.doc.alias) sees this doctor's rows, and so
// addClaim stamps new rows under the alias the phone app shows.
// 🔑 Never sv('doc'): on a shared hospital PC that would silently change
// who the NEXT person bills as in the normal app.
function rvAdoptDoctor(d) {
  var canon = d.canon;
  var rec = (st.doctors || []).find(function(x){
    return rvCanon(x.alias) === canon || x.alias === d.alias;
  });
  st.doc = rec ? { alias:rec.alias, name:rec.name || d.name, num:rec.num || '' }
               : { alias:d.alias, name:d.name, num:'' };
  var lbl = document.getElementById('doc-label');
  if (lbl) lbl.textContent = st.doc.alias;
}
function rvCanon(a) {
  a = String(a || '').trim();
  try { if (typeof canonAlias === 'function') return canonAlias(a); } catch (e) {}
  var M = { FHalperin:'FH', SBaker:'SB', JWebber:'JW', AKhosla:'AK', KTodd:'KT', KPistawka:'KP', LH:'LHalperin' };
  return M[a] || a;
}

// ── pin the bundle's patients + claims into st ─────────────────────
// getAll drops patients discharged >7 days and all their claims — which is
// exactly where unsubmitted-claim / missing-DOB issues live. Same pinning
// pullArchivedPatient uses, so the 30s sync merge keeps them.
function rvPinBundle(res) {
  if (!window._pulledPin) window._pulledPin = { pids:{}, phns:{} };
  var have = {}; st.claims.forEach(function(c){ if (c.id) have[String(c.id)] = true; });
  var added = 0;

  Object.keys(res.patients || {}).forEach(function(phn){
    var raw = res.patients[phn];
    var p = (typeof _normArchivePatient === 'function') ? _normArchivePatient(raw) : raw;
    var existing = st.patients.find(function(x){ return String(x.id) === String(p.id); });
    if (!existing || !existing.id) { st.patients.push(p); added++; }
    if (p.id) window._pulledPin.pids[String(p.id)] = Date.now();
    window._pulledPin.phns[String(phn)] = Date.now();
  });

  (res.claims || []).forEach(function(raw){
    var c = (typeof _normArchiveClaim === 'function') ? _normArchiveClaim(raw) : raw;
    if (c.id && have[String(c.id)]) return;
    st.claims.push(c);
    if (c.id) have[String(c.id)] = true;
  });
}

// ── cards ──────────────────────────────────────────────────────────
function rvBuildCards(res) {
  var scope = res.scope || {};
  var cards = [], byPhn = {};
  (res.rows || []).forEach(function(r){
    var sc = scope[r.issueType] || { dispo:'FILL', title:r.issueType, blurb:r.issueType };
    var part = { issueType:r.issueType, detail:r.detail, issueKey:r.issueKey };
    if (RV_GROUP_BY_PATIENT[r.issueType] && r.phn && byPhn[r.phn]) {
      byPhn[r.phn].parts.push(part);
      byPhn[r.phn].issueKeys.push(r.issueKey);
      byPhn[r.phn].grouped = true;
      return;
    }
    var card = {
      key: r.issueKey, issueKeys:[r.issueKey], parts:[part],
      issueType: r.issueType, dispo: sc.dispo, title: sc.title, blurb: sc.blurb || sc.title,
      attestLabel: sc.attestLabel || '', addLabel: sc.addLabel || '',
      phn: r.phn, patientName: r.patientName, serviceDate: r.serviceDate, severity: r.severity
    };
    if (RV_GROUP_BY_PATIENT[r.issueType] && r.phn) byPhn[r.phn] = card;
    cards.push(card);
  });
  return cards;
}

function rvPatient(phn) {
  phn = String(phn || '').replace(/\D/g, '');
  // Prefer the row the backend chose for this PHN (open admission, else the
  // newest) — a PHN can wrongly have two Patients rows, and getAll's copy
  // of the other one sorts first in st.patients.
  var chosen = RV.bundle && RV.bundle.patients && RV.bundle.patients[phn];
  if (chosen && chosen.id) {
    var byId = st.patients.find(function(p){ return String(p.id) === String(chosen.id); });
    if (byId) return byId;
  }
  return st.patients.find(function(p){ return String(p.phn || '').replace(/\D/g, '') === phn; }) || null;
}
function rvClaims(phn, date) {
  phn = String(phn || '').replace(/\D/g, '');
  return st.claims.filter(function(c){
    return String(c.phn || '').replace(/\D/g, '') === phn && (!date || String(c.date) === date);
  });
}
// Every claim of this doctor on the date that carries BOTH times — judged
// by the times themselves, not a fee list, so a code DataCheck treats as
// timed that this list forgot cannot slip through as "nothing to clash".
function rvDay(date) {
  var me = rvCanon(st.doc && st.doc.alias);
  return st.claims.filter(function(c){
    return String(c.date) === date && rvCanon(c.alias) === me
        && rvT2m(c.startTime) >= 0 && rvT2m(c.endTime) >= 0;
  });
}

// ── what is blocking this card, judged on LIVE st ──────────────────
function rvBlockers(card) {
  var out = [];
  var p = rvPatient(card.phn) || {};

  if (card.dispo === 'ATTEST') {
    var ch = RV.choice[card.key];
    // "Added" counts only against THIS date. With no date on the card
    // (MISSING_MOST trigger (b)), a 78720 from any earlier admission would
    // otherwise satisfy it — so without a date only the attest pill can.
    if (card.issueType === 'MISSING_MOST' && card.serviceDate) {
      if (rvClaims(card.phn, card.serviceDate).some(function(c){ return String(c.fee) === '78720'; })) return [];
    }
    if (card.issueType === 'MISSING_OOH_MODIFIER' && card.serviceDate) {
      if (rvClaims(card.phn, card.serviceDate).some(function(c){ return RV_MOD_FEES[String(c.fee)]; })) return [];
    }
    if (ch !== 'attest') out.push('Needs your yes or no.');
    return out;
  }

  if (card.issueType === 'DOC_TIME_OVERLAP') {
    var day = rvDay(card.serviceDate);
    // 🔑 Fail CLOSED. The check named TWO of this doctor's timed claims on
    // this date; if fewer than two loaded, the clash cannot be judged here
    // and "Can submit" would be a guess. Same for unreadable times.
    if (!card.serviceDate || day.length < 2) {
      out.push('Your claims for that day could not all be loaded, so this cannot be checked here. Report it to KB below.');
      return out;
    }
    var bad = day.filter(function(c){ return rvT2m(c.startTime) < 0 || rvT2m(c.endTime) < 0; });
    if (bad.length) { out.push('Some of that day\'s times could not be read, so this cannot be checked here. Report it to KB below.'); return out; }
    if (Object.keys(rvClashSet(day)).length) out.push('Two claims cover the same minutes.');
    return out;
  }

  card.parts.forEach(function(part){
    var d = String(part.detail || '').toLowerCase();
    if (part.issueType === 'MISSING_NAME') {
      if (!p.last) out.push('Last name is missing.');
      if (d.indexOf('first') >= 0 && !p.first) out.push('First name is missing.');
    } else if (part.issueType === 'MISSING_DEMOGRAPHICS') {
      if (d.indexOf('sex') >= 0 || d.indexOf('gender') >= 0) {
        if (!p.sex) out.push('Sex is missing.');
      } else if (d.indexOf('dob') >= 0 || d.indexOf('birth') >= 0) {
        if (!p.dob) out.push('Date of birth is missing.');
        else if (!rvValidDMY(p.dob)) out.push('Date of birth is not a valid date.');
      } else out.push(rvFirst(part.detail) || 'Something on this patient record still needs filling in.');
    } else if (part.issueType === 'REFERRER_MISSING') {
      var consults = rvClaims(card.phn, card.serviceDate).filter(function(c){
        return RV_CONSULT_FEES[String(c.fee)] && !rvBool(c.submitted); });
      if (!consults.length) out.push('That consult could not be loaded, so this cannot be checked here. Report it to KB below.');
      else if (consults.some(function(c){ return !c.refbyName; })) out.push('No referring physician on this consult.');
    } else if (part.issueType === 'MODIFIER_MISSING_TIMES') {
      var mods = rvClaims(card.phn, card.serviceDate).filter(function(c){
        return RV_MOD_FEES[String(c.fee)] && !rvBool(c.submitted); });
      if (!mods.length) out.push('That call-out claim could not be loaded, so this cannot be checked here. Report it to KB below.');
      else if (mods.some(function(c){ return !c.startTime || !c.endTime; })) out.push('The call-out claim has no start and end time.');
    } else {
      out.push(rvFirst(part.detail) || 'This still needs sorting out before the claim can go.');
    }
  });
  return out;
}

// Same three exemptions as DataCheck.docOverlapCheck: same patient, both
// already submitted, and a call-out pair where either patient's rows carry
// a CCFPP note. RESOLVE class has no dismiss button, so a false clash would
// strand a doctor on a red bar over correct billing.
function rvClashSet(day) {
  var hit = {}, ccfpp = {};
  day.forEach(function(c){ if (/CCFPP/i.test(c.notes || '')) ccfpp[String(c.phn)] = true; });
  for (var i = 0; i < day.length; i++) for (var j = i + 1; j < day.length; j++) {
    var a = day[i], b = day[j];
    if (String(a.phn) === String(b.phn)) continue;
    if (rvBool(a.submitted) && rvBool(b.submitted)) continue;
    var modInvolved = RV_MOD_FEES[String(a.fee)] || RV_MOD_FEES[String(b.fee)];
    if (modInvolved && (ccfpp[String(a.phn)] || ccfpp[String(b.phn)])) continue;
    var aS = rvT2m(a.startTime), aE = rvT2m(a.endTime), bS = rvT2m(b.startTime), bE = rvT2m(b.endTime);
    if (aS < 0 || aE < 0 || bS < 0 || bE < 0) continue;
    if (aE < aS) aE += 1440; if (bE < bS) bE += 1440;
    if (aS < bE && bS < aE) { hit[a.id] = true; hit[b.id] = true; }
  }
  return hit;
}

// ── render ─────────────────────────────────────────────────────────
function rvRender() {
  var pane = document.getElementById('p-review');
  if (!pane) return;
  var anyOpen = ['tl-modal','pt-edit-modal','claim-edit-modal','pt-summary-modal','add-phys-modal'].some(function(id){
    var el = document.getElementById(id); return el && (el.classList.contains('on') || (el.style && el.style.display === 'block')); });
  if (!anyOpen) window._reviewEditing = false;
  var doc = RV.bundle.doctor;
  var n = RV.cards.length;
  var html = '<div class="rv-head"><div><h1>KGH Claim Review</h1>'
    + '<div class="rv-sub">' + (n ? (n === 1 ? '1 patient claim needs review before it can be billed successfully'
                                              : n + ' patient claims need review before they can be billed successfully')
                                  : 'Nothing outstanding — thank you') + '</div></div>'
    + '<div class="rv-doc">Dr. ' + esc(doc.name || doc.alias) + '</div></div>';

  if (!n) {
    html += '<div class="rv-empty"><h2>All clear</h2><p>Nothing of yours is waiting on a detail. Thank you.</p></div>';
    pane.innerHTML = html; return;
  }
  if (RV.cur >= n) RV.cur = 0;

  html += '<div class="rv-wrap"><div class="rv-rail"><h2>Your claims</h2>';
  RV.cards.forEach(function(card, i){
    var settled = rvBlockers(card).length === 0;
    html += '<button class="rv-item' + (i === RV.cur ? ' on' : '') + '" onclick="rvGo(' + i + ')">'
      + '<div class="rv-pn">' + esc(card.patientName || '—') + '</div>'
      + '<div class="rv-pt"><span class="rv-dot' + (settled ? ' ok' : '') + '"></span>' + esc(card.blurb) + '</div></button>';
  });
  html += '</div><div class="rv-panel">' + rvCard(RV.cards[RV.cur]) + '</div></div>';
  pane.innerHTML = html;
}
function rvGo(i) { RV.cur = i; rvRender(); }

function rvCard(card) {
  var blockers = rvBlockers(card);
  var clear = blockers.length === 0;
  var fault = blockers.some(function(b){ return /Report it to KB/.test(b); });
  var p = rvPatient(card.phn) || {};
  var sibs = RV.cards.filter(function(c){ return c !== card && c.phn === card.phn; }).length;
  var iclinic = RV.bundle.iclinicUrl || 'https://secure.iclinicemr.com/';

  var h = '<div class="rv-card">'
    + '<div class="rv-banner ' + (clear ? 'good' : 'block') + '">' + (clear ? '✓ Can submit' : '⛔ Not yet billable') + '</div>'
    // A "could not be checked here" blocker is the ONLY explanation the
    // doctor gets, so it must render; ordinary blockers are already said
    // once by the fix section and stay out of the banner.
    + (function(){ var f = blockers.filter(function(b){ return /Report it to KB/.test(b); });
        return f.length ? '<div class="rv-notice">' + f.map(esc).join('<br>') + '</div>' : ''; })()
    // 1 · who and what
    + '<div class="rv-sec"><div class="rv-who">' + esc(card.patientName || (p.last ? p.last + ', ' + p.first : '—')) + '</div>'
    + '<div class="rv-why">' + esc(card.blurb) + (card.serviceDate ? ' &nbsp;·&nbsp; ' + esc(card.serviceDate) : '') + '</div>'
    + (sibs ? '<div class="rv-muted">' + (sibs === 1 ? 'One other thing on this patient is still open — it is in your list on the left.'
                                                    : sibs + ' other things on this patient are still open — they are in your list on the left.') + '</div>' : '')
    + '</div>'
    // 2 · the fix
    + '<div class="rv-sec">' + rvFix(card, p, blockers) + '</div>'
    // 3 · the chart
    + '<div class="rv-sec"><div class="rv-row">'
    + '<button class="rv-phn" onclick="rvCopyPhn()"><span class="rv-lbl">PHN</span><span>' + esc(card.phn || '—') + '</span><span class="rv-act" id="rv-phn-act">copy</span></button>'
    + '<a class="btn btn-s rv-a" href="' + esc(iclinic) + '" target="_blank" rel="noopener">Launch iClinic to Review Chart ↗</a>'
    + '</div><div class="rv-muted">Copy the PHN — it is the surest way to pull up the right chart in iClinic or Meditech.</div></div>'
    // 4 · note + resubmit
    + '<div class="rv-sec"><label class="rv-fl">Not now?</label>'
    + '<div class="rv-muted" style="margin:0 0 8px">Leave yourself a note and you will get this back by email tomorrow morning. The claim is <b>not</b> submitted until it is fixed.</div>'
    + '<textarea id="rv-note" oninput="rvNote(this.value)" placeholder="e.g. Check the chart for the referring MD / The consult ran over because…">' + esc(RV.notes[card.key] || '') + '</textarea>'
    + '<div class="rv-actions">'
    +   (fault
          ? '<button class="btn btn-s" onclick="rvAct(\'escalate\')">Report this to KB</button>'
          : '<button class="btn btn-s" onclick="rvAct(\'later\')">Email me — I\'ll fix it later</button>')
    +   '<div class="rv-sp"></div>'
    + '<button class="btn btn-p" id="rv-resubmit" onclick="rvAct(\'fix\')"' + (clear ? '' : ' disabled') + '>Resubmit</button></div>'
    + (clear ? '' : '<div class="rv-muted">Resubmit switches on once the points above are settled.</div>')
    + '</div></div>';
  return h;
}

// The fix section — every path opens an APP screen; nothing is re-implemented.
function rvFix(card, p, blockers) {
  var h = '';
  if (card.dispo === 'ATTEST') {
    var sel = RV.choice[card.key] || '';
    var satisfied = blockers.length === 0 && sel !== 'attest';   // the thing now exists
    h += '<div class="rv-pills">'
      + '<button class="rv-pill' + (sel === 'attest' ? ' on' : '') + '" onclick="rvChoose(\'attest\')">' + esc(card.attestLabel || 'It does not apply') + '</button>'
      + '<button class="rv-pill' + (satisfied ? ' on' : '') + '" onclick="rvAddFor(' + RV.cur + ')">' + esc(card.addLabel || 'Add it') + (satisfied ? ' — done' : '') + '</button>'
      + '</div>';
    return h;
  }
  if (card.issueType === 'DOC_TIME_OVERLAP') {
    var day = rvDay(card.serviceDate), clash = rvClashSet(day);
    h += '<div class="rv-list">' + day.map(function(c){
      return '<div class="rv-li' + (clash[c.id] ? ' clash' : '') + '"><b>' + esc(c.last || '') + '</b> · ' + esc(c.fee) + ' · '
           + esc(c.startTime || '?') + '–' + esc(c.endTime || '?') + (rvBool(c.submitted) ? ' · submitted' : '') + '</div>';
    }).join('') + '</div>'
      + '<button class="btn btn-p rv-big" onclick="rvTapTimeline()">Open my day timeline to adjust the times</button>'
      + '<div class="rv-muted">The same timeline as the app. Tap a box, retype start and finish, Save times — call-out charges, units and CCFPP notes re-derive exactly as they do on your phone.</div>';
    return h;
  }
  // FILL
  var rows = [];
  card.parts.forEach(function(part){
    var d = String(part.detail || '').toLowerCase();
    if (part.issueType === 'MISSING_NAME') rows.push(['Last name', p.last, !!p.last, 'needed']);
    else if (part.issueType === 'MISSING_DEMOGRAPHICS') {
      if (d.indexOf('sex') >= 0 || d.indexOf('gender') >= 0) rows.push(['Sex', p.sex, !!p.sex, 'M or F']);
      else if (d.indexOf('dob') >= 0 || d.indexOf('birth') >= 0) rows.push(['Date of birth', p.dob, !!p.dob && rvValidDMY(p.dob), 'DD/MM/YYYY']);
    }
  });
  if (rows.length) {
    h += '<div class="rv-miss">' + rows.map(function(r){
      return '<div class="rv-fname">' + esc(r[0]) + '</div><div class="rv-fval' + (r[2] ? ' set' : '') + '">' + (r[1] ? esc(r[1]) : esc(r[3])) + '</div>';
    }).join('') + '</div>'
      + '<button class="btn btn-p rv-big" onclick="rvTapPatient()">Enter the missing details</button>'
      + '<div class="rv-muted">Opens the app\'s Edit Patient screen — M/F pills, date check, and the change carries onto the claim rows.</div>';
  }
  if (card.parts.some(function(x){ return x.issueType === 'REFERRER_MISSING'; })) {
    var consult = rvClaims(card.phn, card.serviceDate).filter(function(c){ return RV_CONSULT_FEES[String(c.fee)] && !rvBool(c.submitted); })[0];
    h += '<div class="rv-miss"><div class="rv-fname">Referring physician</div><div class="rv-fval' + (consult && consult.refbyName ? ' set' : '') + '">'
      + (consult && consult.refbyName ? esc(consult.refbyName) : 'search by name or MSP #') + '</div></div>'
      + (consult ? '<button class="btn btn-p rv-big" onclick="rvTapReferrer()">Add the referring physician</button>' : '')
      + '<div class="rv-muted">Opens the app\'s claim editor: search the directory, or add a physician who is not listed — name and MSP #. '
      + 'Look the MSP # up in the <a href="' + esc(RV.bundle.cpsbcUrl || 'https://www.cpsbc.ca/directory') + '" target="_blank" rel="noopener">College of Physicians &amp; Surgeons of BC directory ↗</a>. '
      + 'Anyone you add is saved for next time.</div>';
  }
  if (card.parts.some(function(x){ return x.issueType === 'MODIFIER_MISSING_TIMES'; })) {
    h += '<button class="btn btn-p rv-big" onclick="rvTapTimeline()">Open my day timeline to set the times</button>'
      + '<div class="rv-muted">Call-out times come from the consult\'s start and finish — set those and the call-out rows are rebuilt.</div>';
  }
  return h || '<p class="rv-muted">Nothing to fill in here.</p>';
}

// ── the taps — all resolved from RV.cur, never from interpolated strings
//    (esc() does not escape a single quote, so nothing from the sheet is
//    ever placed inside an inline handler) ──
function rvNote(v) { var c = RV.cards[RV.cur]; if (c) RV.notes[c.key] = v; }
function rvTapTimeline() { var c = RV.cards[RV.cur]; if (c) rvOpenTimeline(c.serviceDate, c.phn); }
function rvTapPatient()  { var c = RV.cards[RV.cur]; if (c) rvOpenPatientEdit(c.phn); }
function rvTapReferrer() {
  var c = RV.cards[RV.cur]; if (!c) return;
  var consult = rvClaims(c.phn, c.serviceDate).filter(function(x){ return RV_CONSULT_FEES[String(x.fee)] && !rvBool(x.submitted); })[0];
  if (consult) rvOpenClaimEdit(consult.id, c.phn);
}
function rvChoose(which) {
  var card = RV.cards[RV.cur];
  RV.choice[card.key] = (RV.choice[card.key] === which) ? '' : which;
  rvRender();
}

// "Add MOST to consult" / "Add out-of-hours premium" — the app's own path.
function rvAddFor(idx) {
  var card = RV.cards[idx]; if (!card) return;
  var p = rvPatient(card.phn);
  if (!p || !p.id) { showToast('Patient record not loaded — report it to KB'); return; }
  var consult = rvClaims(card.phn, card.serviceDate).filter(function(c){ return RV_CONSULT_FEES[String(c.fee)]; })[0];
  // 🔑 Never guess the date or the location. A 78720 with no date is
  // blocked by push() but still lands in st.claims (and would turn the
  // card green); a facility code in `loc` is rejected by MSP.
  if (!card.serviceDate || !consult) {
    showToast('The consult for that day could not be loaded — report it to KB', 'error'); return;
  }
  RV.choice[card.key] = 'add';
  if (card.issueType === 'MISSING_MOST') {
    if (rvClaims(card.phn, card.serviceDate).some(function(c){ return String(c.fee) === '78720'; })) { rvRender(); return; }
    // addClaim(p, fee, feeCode, units, date, loc, startTime, notes, endTime, alias, overrides)
    // — the same call the +Claim screen makes for its MOST button, with the
    // consult's own location, alias and referrer/dx riding on the row.
    addClaim(p, '78720', '78720', 1, card.serviceDate, consult.loc || 'I', null, null, null,
             consult.alias || st.doc.alias, { icd:consult.icd, refby:consult.refby, refbyName:consult.refbyName });
    showToast('MOST (78720) added for ' + card.serviceDate);
  } else if (card.issueType === 'MISSING_OOH_MODIFIER') {
    if (!consult.startTime || !consult.endTime) { rvOpenClaimEdit(consult.id, card.phn); return; }
    // getModifier wants an ISO date (isWeekendOrStat does new Date(iso+'T12:00')).
    var tier = null;
    try {
      var _d = parseDMY(consult.date);
      var _iso = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
      tier = getModifier(consult.startTime, _iso);
    } catch (e) {}
    if (!tier) {
      RV.choice[card.key] = '';
      showToast('Those times are not in a call-out period (evening 18:00+, night 23:00–07:45, weekend/stat). If that is right, choose "Not out of hours".', 'error');
      rvRender(); return;
    }
    // Re-derive through the same function the timeline's Save uses:
    // rebuilds the 12xx rows, persists, recomputes CCFPP around the day.
    applyConsultTimes_(consult, consult.startTime, consult.endTime);
    showToast('Call-out premium re-derived from the consult times');
  }
  rvRender();
}

// The Day Timeline only draws consults that HAVE start+end. If this card's
// consult has neither, the doctor would land on an empty clock with nothing
// to tap — send them to the claim editor instead, which has time fields.
function rvOpenTimeline(dateFmt, phn) {
  if (phn) {
    var cons = rvClaims(phn, dateFmt).filter(function(c){ return RV_CONSULT_FEES[String(c.fee)] && !rvBool(c.submitted); })[0];
    if (cons && (!cons.startTime || !cons.endTime)) { rvOpenClaimEdit(cons.id, phn); return; }
  }
  try { openDayTimeline(st.doc.alias, dateFmt); } catch (e) { showToast('Could not open the timeline — report it to KB', 'error'); return; }
  rvMarkEditing('tl-modal');
}
function rvOpenPatientEdit(phn) {
  var p = rvPatient(phn);
  if (!p || !p.id) { showToast('Patient record not loaded — report it to KB'); return; }
  openPatientEdit(p.id, !p.dob);
  rvMarkEditing('pt-edit-modal');
}
function rvOpenClaimEdit(cid, phn) {
  var p = rvPatient(phn);
  var c = st.claims.find(function(x){ return String(x.id) === String(cid); });
  if (!c) { showToast('That claim could not be loaded — report it to KB'); return; }
  openClaimEdit({ getAttribute: function(k){ return k === 'data-cid' ? cid : (p ? p.id : ''); } });
  // The editor's performing-physician <select> marks `selected` only on an
  // exact alias match; a legacy short alias ('LH') on the row would fall to
  // the FIRST doctor and Save would silently reassign the claim. Pin it.
  try {
    var sel = document.getElementById('ce-alias');
    if (sel && c.alias && sel.value !== c.alias) {
      var has = Array.prototype.some.call(sel.options, function(o){ return o.value === c.alias; });
      if (!has) { var o = document.createElement('option'); o.value = c.alias; o.text = c.alias; sel.appendChild(o); }
      sel.value = c.alias;
    }
  } catch (e) {}
  rvMarkEditing('claim-edit-modal');
}
// Only mark "editing" once a screen is actually open. A silent early return
// in the app's opener used to leave the flag stuck true, which switched off
// every guarded sync for the rest of the session.
function rvMarkEditing(modalId) {
  setTimeout(function(){
    var el = document.getElementById(modalId);
    var open = el && (el.classList.contains('on') || (el.style && el.style.display === 'block'));
    window._reviewEditing = !!open;
  }, 30);
}

// Re-evaluate every card whenever an app screen closes. Wrapping rather
// than editing those functions keeps this file the only review-specific
// change in the frontend.
(function rvHooks(){
  if (typeof isReviewMode !== 'function' || !isReviewMode()) return;
  var _hide = window.hideModal, _closeTl = window.closeDayTimeline, _showPane = window.showPane;

  function afterClose(){
    var anyOpen = ['tl-modal','pt-edit-modal','claim-edit-modal','add-phys-modal'].some(function(id){
      var el = document.getElementById(id); return el && (el.classList.contains('on') || (el.style && el.style.display === 'block')); });
    if (anyOpen) { if (RV.bundle) rvRender(); return; }   // e.g. editor → Day timeline handoff
    window._reviewEditing = false;
    // A stale-claim refusal that arrived while an editor was open deferred
    // its resync (03_state.js) — run it now that the editor has closed.
    if (window._staleResyncPending) {
      window._staleResyncPending = false;
      try { syncFromSheets().then(function(){ if (RV.bundle) rvRender(); }); } catch (e) {}
    }
    if (RV.bundle) rvRender();
  }
  window.hideModal = function(id){
    var r = _hide.apply(this, arguments);
    setTimeout(afterClose, 60);
    return r;
  };
  window.closeDayTimeline = function(){
    var r = _closeTl.apply(this, arguments);
    setTimeout(afterClose, 60);
    return r;
  };
  // The app's save flows end with showPane('p0') / showPane('p-claim') to
  // "go home". In review mode every pane but ours is display:none, so that
  // would leave a blank page. Stay on the review pane, whatever is asked.
  window.showPane = function(id){
    return _showPane.call(this, 'p-review');
  };
  // The claim editor's Save ends with openPatientSummary(pid) — the phone's
  // patient sheet, with +Claim / D/C buttons that lead nowhere here. Skip
  // it; the card re-render (afterClose) is what the doctor should see.
  window.openPatientSummary = function(){ if (RV.bundle) rvRender(); };
})();

// ── Resubmit / Send to KB ──────────────────────────────────────────
async function rvAct(kind) {
  if (RV.busy) return;
  var card = RV.cards[RV.cur];
  var note = RV.notes[card.key] || '';
  var body = { token: RV.token, issueKeys: card.issueKeys, mdNote: note,
               by: (st.doc && st.doc.alias) || '', after: rvSnapshot(card) };
  if (kind === 'fix') {
    if (rvBlockers(card).length) return;
    if (card.dispo === 'ATTEST' && RV.choice[card.key] === 'attest') {
      body.kind = 'attest';
      body.attestNote = card.attestLabel + ' — ' + (st.doc && st.doc.alias) + ' ' + new Date().toISOString().slice(0, 10);
      // 🔑 The attestation lives on the CLAIM, not only on the review tab.
      // DataCheck has always honoured "no MOST" / "no call-out" in the
      // consult's note (Kathryn's own documented workflow); v2.52 turns
      // that skip into a visible INFO line. Writing the same marker here
      // means one mechanism for every door — this page, the v5.13
      // consult-submit prompt, or a note typed by hand.
      RV.busy = true;
      var stamped = await rvStampDeclined(card);
      RV.busy = false;
      if (!stamped) {
        showToast('That could not be recorded on the claim just now — please try again', 'error');
        rvRender(); return;
      }
    } else body.kind = 'fix';
  } else if (kind === 'later') {
    body.kind = 'later';
  } else body.kind = 'escalate';

  RV.busy = true;
  var btn = document.getElementById('rv-resubmit'); if (btn) btn.disabled = true;
  var res = await rvCall('reviewAction', body);
  RV.busy = false;
  if (!res || !res.ok) {
    showToast((res && res.error) || 'That did not save — please try again', 'warn');
    rvRender(); return;
  }
  if (!res.updated || !res.updated.length) {
    showToast('Could not close that: ' + ((res.refused || []).join('; ') || 'nothing matched — reload the page'), 'error');
    rvRender(); return;
  }
  if (res.refused && res.refused.length) showToast('Partly closed — ' + res.refused.join('; '), 'error');
  else showToast(kind === 'escalate' ? 'Reported to KB' : (kind === 'later' ? 'Noted — it will be back in your email tomorrow' : 'Done — thank you'));
  if (kind !== 'later') {
    RV.cards.splice(RV.cur, 1);
    if (RV.cur >= RV.cards.length) RV.cur = 0;
  }
  rvRender();
}

// Append the decline marker to the consult's notes and save it through the
// app's normal claim path (arbitrated, gated by nothing — it is one row).
// Segments are |-joined, the same convention CCFPP notes use, so the
// CCFPP regex (/(^|\|)\s*CCFPP:/) is untouched by what we add.
async function rvStampDeclined(card) {
  var stamp = (st.doc && st.doc.alias) || '';
  var today = (typeof TODAY !== 'undefined') ? TODAY : new Date().toLocaleDateString('en-GB');
  var isOoh = card.issueType === 'MISSING_OOH_MODIFIER';
  var marker = (isOoh ? 'no call-out' : 'no MOST') + ' (' + stamp + ' ' + today + ')';
  var rows = rvClaims(card.phn, card.serviceDate).filter(function(c){ return !rvBool(c.submitted); });
  // 🔑 Put the marker on the row DataCheck actually tests: MISSING_MOST (a)
  // is raised on a 33010; MISSING_OOH_MODIFIER on a 33010/33012. A same-day
  // 33005/00751 sorting first would otherwise take the note and the MEDIUM
  // would persist. RACE-triggered MOST (no 33010) tests every pending row.
  var want = isOoh ? { '33010':1, '33012':1 } : { '33010':1 };
  var target = rows.filter(function(c){ return want[String(c.fee)]; })[0]
            || rows.filter(function(c){ return RV_CONSULT_FEES[String(c.fee)]; })[0]
            || rvClaims(card.phn, '').filter(function(c){ return !rvBool(c.submitted); })[0];
  if (!target) return false;
  var re = isOoh ? /no\s*call[\s-]?out/i : /no\s*most/i;
  if (re.test(target.notes || '')) return true;              // already on the row
  if (typeof SHEETS_URL === 'undefined' || !SHEETS_URL) return false;
  var before = target.notes;
  target.notes = (target.notes ? String(target.notes).replace(/\s*\|\s*$/, '') + ' | ' : '') + marker;
  // Await it. The attestation must not close the review row unless the
  // marker is really on the sheet — otherwise DataCheck keeps raising the
  // MEDIUM with no INFO twin, and nothing re-asks the doctor for 45 days.
  // A stale refusal (edited on another device since this page loaded)
  // has push() resync; the doctor simply taps again on the fresh row.
  var ok = await push('saveClaim', target);
  if (!ok) { target.notes = before; return false; }
  try { sv('claims', st.claims); } catch (e) {}
  return true;
}

function rvSnapshot(card) {
  var p = rvPatient(card.phn) || {};
  return {
    patient: { last:p.last, first:p.first, dob:p.dob, sex:p.sex, refbyName:p.refbyName },
    claims: rvClaims(card.phn, card.serviceDate).map(function(c){
      return { id:c.id, fee:c.fee, date:c.date, startTime:c.startTime, endTime:c.endTime,
               units:c.units, refbyName:c.refbyName, notes:c.notes, submitted:c.submitted }; })
  };
}

// ── chrome ─────────────────────────────────────────────────────────
function rvMountPane() {
  if (document.getElementById('p-review')) return;
  document.body.classList.add('rv-mode');
  var pane = document.createElement('div');
  pane.className = 'pane'; pane.id = 'p-review';
  document.body.appendChild(pane);
  if (typeof ALL_PANES !== 'undefined' && ALL_PANES.indexOf('p-review') === -1) ALL_PANES.push('p-review');
  try { showPane('p-review'); } catch (e) { pane.classList.add('on'); }
}
function rvMessage(msg) {
  var pane = document.getElementById('p-review'); if (!pane) return;
  pane.innerHTML = '<div class="rv-head"><div><h1>KGH Claim Review</h1></div></div><div class="rv-empty"><p>' + esc(msg) + '</p></div>';
}
function rvCopyPhn() {
  var card = RV.cards[RV.cur];
  var ta = document.createElement('textarea'); ta.value = String(card.phn || '');
  ta.setAttribute('readonly', ''); ta.style.cssText = 'position:absolute;left:-9999px';
  document.body.appendChild(ta); ta.select();
  var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  var a = document.getElementById('rv-phn-act'); if (a) { a.textContent = ok ? 'copied' : 'select it to copy'; setTimeout(function(){ a.textContent = 'copy'; }, 2200); }
}

// ── helpers ────────────────────────────────────────────────────────
function rvT2m(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
function rvBool(v) { return v === true || String(v).toLowerCase() === 'true'; }
function rvFirst(s) { s = String(s || ''); var i = s.indexOf(' — '); var t = i > 20 ? s.slice(0, i) : s; return t.length > 150 ? t.slice(0, 147) + '…' : t; }
function rvValidDMY(s) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); if (!m) return false;
  var d = +m[1], mo = +m[2], y = +m[3]; if (mo < 1 || mo > 12 || d < 1 || y < 1900) return false;
  var dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && dt.getTime() <= Date.now();
}

function rvInjectCss() {
  if (document.getElementById('rv-style')) return;
  var css = document.createElement('style'); css.id = 'rv-style';
  css.textContent =
    // desktop width: the app is a 430px phone column; review is read on a monitor
    'body.rv-mode{max-width:1180px}' +
    'body.rv-mode .modal{max-width:560px;margin-left:auto;margin-right:auto}' +
    'body.rv-mode #tl-sheet{max-width:640px;margin:0 auto;left:0;right:0}' +
    'body.rv-mode .nav,body.rv-mode #p0,body.rv-mode #p1,body.rv-mode #p-discharged,body.rv-mode #p-claim,body.rv-mode #p-loc{display:none!important}' +
    '#p-review{padding:0 0 40px}' +
    '.rv-head{background:var(--blue);color:#fff;padding:14px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}' +
    '.rv-head h1{margin:0;font-size:17px;font-weight:700}.rv-sub{font-size:13px;opacity:.85}.rv-doc{margin-left:auto;font-size:13px;opacity:.9}' +
    '.rv-wrap{display:flex;gap:20px;padding:20px;align-items:flex-start}@media(max-width:900px){.rv-wrap{flex-direction:column}}' +
    '.rv-rail{width:250px;flex:0 0 250px;position:sticky;top:20px}@media(max-width:900px){.rv-rail{width:100%;flex:none;position:static}}' +
    '.rv-rail h2{font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text3);margin:0 0 9px 3px;font-weight:700}' +
    '.rv-item{display:block;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-left:3px solid transparent;border-radius:8px;padding:11px 13px;margin-bottom:8px;cursor:pointer;font:inherit;color:inherit}' +
    '.rv-item.on{border-left-color:var(--blue);background:var(--blue-bg);border-color:var(--blue)}' +
    '.rv-pn{font-weight:700;font-size:14px}.rv-pt{font-size:12.5px;color:var(--text2);margin-top:3px;line-height:1.4}' +
    '.rv-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);margin-right:6px;vertical-align:1px}.rv-dot.ok{background:var(--green)}' +
    '.rv-panel{flex:1;min-width:0}' +
    '.rv-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}' +
    '.rv-banner{padding:13px 20px;font-weight:800;font-size:14.5px;letter-spacing:.02em;color:#fff}.rv-banner.block{background:var(--red)}.rv-banner.good{background:var(--green)}' +
    '.rv-sec{padding:18px 20px;border-top:1px solid var(--border)}.rv-sec:first-of-type{border-top:0}' +
    '.rv-notice{padding:11px 20px;background:var(--amber-bg);color:var(--amber-t);font-size:13.5px;border-bottom:1px solid var(--border)}' +
    '.rv-who{font-size:17px;font-weight:700}.rv-why{color:var(--text2);font-size:13.5px;margin-top:3px}' +
    '.rv-muted{color:var(--text3);font-size:12.5px;margin-top:10px;line-height:1.5}.rv-muted a{color:var(--blue-t)}' +
    '.rv-pills{display:flex;gap:10px;flex-wrap:wrap}' +
    '.rv-pill{border:1.5px solid var(--border2);background:var(--surface);border-radius:999px;padding:11px 20px;font:inherit;font-size:14.5px;cursor:pointer;color:var(--text)}' +
    '.rv-pill.on{border-color:var(--blue);background:var(--blue-bg);color:var(--blue-t);font-weight:700}.rv-pill.on::before{content:"✓ "}' +
    '.rv-miss{display:grid;grid-template-columns:auto 1fr;gap:11px 18px;align-items:center;max-width:460px;margin-bottom:14px}' +
    '.rv-fname{font-size:14px;color:var(--text2);white-space:nowrap}' +
    '.rv-fval{border:1.5px solid var(--red);background:var(--red-bg);border-radius:7px;padding:9px 12px;font-size:14.5px;color:var(--text2)}.rv-fval.set{border-color:var(--green);background:var(--green-bg);color:var(--text)}' +
    '.rv-list{margin-bottom:14px}.rv-li{padding:6px 10px;border:1px solid var(--border);border-radius:7px;margin-bottom:5px;font-size:13px}.rv-li.clash{border-color:var(--red);background:var(--red-bg)}' +
    '.rv-big{width:100%;padding:12px;font-size:14px}' +
    '.rv-row{display:flex;gap:11px;align-items:center;flex-wrap:wrap}' +
    '.rv-phn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border2);background:var(--surface2);border-radius:7px;padding:8px 12px;cursor:pointer;font:inherit;font-size:14px;color:var(--text)}' +
    '.rv-lbl{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--text3);font-weight:700}.rv-act{font-size:12px;color:var(--blue-t)}' +
    '.rv-a{text-decoration:none;display:inline-block;width:auto;margin-bottom:0}' +
    '.rv-fl{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);font-weight:700;margin-bottom:6px}' +
    '#rv-note{width:100%;min-height:74px;resize:vertical}' +
    '.rv-actions{display:flex;gap:10px;align-items:center;margin-top:13px}.rv-sp{flex:1}' +
    '.rv-actions .btn{width:auto}' +
    '.rv-empty{text-align:center;padding:70px 20px;color:var(--text3)}.rv-empty h2{color:var(--green-t)}';
  document.head.appendChild(css);
}
