// ── 08_daily.js ──
// ═══════════════════════════════════════════════════════
// 08_daily.js — Daily, combined daily, directive, CCU forms
// ═══════════════════════════════════════════════════════

// ── Shared Diagnosis + Referring MD card ─────────────
// Uses data-* attributes to avoid quote-escaping in inline handlers
function buildIcdRefCard(p) {
  var curDx = DIAGNOSES.find(function(d) { return d.code === (p.icd || '3062'); });
  var curLabel = curDx ? curDx.label : (p.icd || '');

  var h = '<div class="card"><div class="card-title">Diagnosis &amp; referring MD</div>';

  // Diagnosis search input
  h += '<label>Diagnosis</label>' +
       '<div style="position:relative">' +
       '<input id="cb-icd-search" value="' + esc(curLabel) + '" style="padding-right:32px" ' +
             'placeholder="Type diagnosis or code..." autocorrect="off" autocomplete="off" ' +
             'data-dd="cb-icd-dd" data-hidden="cb-icd" ' +
             'oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
       '<button type="button" tabindex="-1" onclick="clearSearchField(\'cb-icd-search\',\'cb-icd\',null,\'cb-icd-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'cb-icd-search\',\'cb-icd\',null,\'cb-icd-dd\')" ' +
       'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
       '</div>' +
       '<input id="cb-icd" type="hidden" value="' + esc(p.icd || '3062') + '">' +
       '<div class="ref-dd" id="cb-icd-dd"></div>';

  // Referring MD search input
  h += '<label style="margin-top:4px">Referred by</label>' +
       '<div style="position:relative">' +
       '<input id="cb-ref-search" value="' + esc(p.refbyName || p.refby || '') + '" style="padding-right:32px" ' +
             'placeholder="Type name or doctor #..." autocorrect="off" ' +
             'data-dd="cb-ref-dd" data-hidden="cb-refby" data-name="cb-refby-name" ' +
             'oninput="refSearchEl(this)" onfocus="refSearchEl(this)">' +
       '<button type="button" tabindex="-1" onclick="clearSearchField(\'cb-ref-search\',\'cb-refby\',\'cb-refby-name\',\'cb-ref-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'cb-ref-search\',\'cb-refby\',\'cb-refby-name\',\'cb-ref-dd\')" ' +
       'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
       '</div>' +
       '<div class="ref-dd" id="cb-ref-dd"></div>' +
       '<input id="cb-refby"      type="hidden" value="' + esc(p.refby || '') + '">' +
       '<input id="cb-refby-name" type="hidden" value="' + esc(p.refbyName || '') + '">';

  h += buildPerformingPhysSelector();
  h += '</div>';
  return h;
}

// Returns HTML for the performing physician dropdown.
// Pre-selects the currently signed-in doc; user can change before submitting.
function buildPerformingPhysSelector() {
  if (!st.doctors || !st.doctors.length) return '';
  var curAlias = st.doc ? st.doc.alias : '';
  var opts = st.doctors.map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === curAlias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');
  return '<label style="margin-top:6px">Performing physician</label>' +
         '<select id="cb-performing-doc">' + opts + '</select>';
}

// Read the performing physician dropdown; falls back to signed-in doc if absent.
function getPerformingAlias() {
  var sel = document.getElementById('cb-performing-doc');
  return (sel && sel.value) ? sel.value : (st.doc ? st.doc.alias : '');
}

function getClaimIcd(p) {
  var hidden = document.getElementById('cb-icd');
  if (hidden && hidden.value) return hidden.value;
  return p.icd || '3062';
}

// Save ICD-9 and referring MD changes back to patient record
function updatePatientFromClaimForm(p) {
  var icd = getClaimIcd(p);
  if (icd && icd !== p.icd) p.icd = icd;

  var rb = document.getElementById('cb-refby');
  var rn = document.getElementById('cb-refby-name');
  if (rb && rb.value) {
    if (rb.value !== p.refby || (!p.refbyName && rn && rn.value)) {
      p.refby     = rb.value;
      if (rn && rn.value && !looksLikeMRPService(rn.value)) p.refbyName = rn.value;
    }
  }
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
}

// ── Daily rounds (33008) ───────────────────────────────
function buildDailyForm(p) {
  var iso = localISODate();
  return '<div class="card"><div class="card-title">Daily rounds (33008)</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>Start date</label><input type="date" id="cb-dal-start" value="' + iso + '"></div>' +
      '<div class="f1"><label>Days</label><input type="number" id="cb-dal-days" value="1" min="1" inputmode="numeric"></div>' +
    '</div></div>' +
    buildIcdRefCard(p) +
    '<button class="btn btn-p" onclick="claimSubmitOnce(submitDaily)">Add daily care claim</button>';
}

function submitDaily() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  var ds   = gv('cb-dal-start');
  var days = parseInt(gv('cb-dal-days')) || 1;
  if (!ds) { showToast('Enter start date'); return; }
  updatePatientFromClaimForm(p);
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }
  var alias = getPerformingAlias();
  addClaim(p, '33008', '33008', days, fmtD(parseISODate(ds)), 'I', null, null, null, alias);
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('33008 ×' + days + ' — ' + p.last);
  closeClaimScreen();
}

// ── Combined daily care (33008, up to 2×/day for ICU) ─
function buildCombinedForm(p) {
  var iso = localISODate();
  return '<div class="card"><div class="card-title">Combined daily care (33008)</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>Date</label><input type="date" id="cb-dal-start" value="' + iso + '"></div>' +
      '<div class="f1"><label>Visits today</label>' +
        '<select id="cb-comb-v" onchange="combinedVisitChange()">' +
          '<option value="1">1 visit</option>' +
          '<option value="2">2 visits (unstable)</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div id="cb-comb-note-wrap"></div>' +
    '</div>' +
    buildIcdRefCard(p) +
    '<button class="btn btn-p" onclick="claimSubmitOnce(submitCombined)">Add combined daily claim</button>';
}

function combinedVisitChange() {
  var v   = gv('cb-comb-v');
  var wrap = document.getElementById('cb-comb-note-wrap');
  wrap.innerHTML = v === '2'
    ? '<div class="dir-warn">Note required for 2nd visit</div><textarea id="cb-comb-note" placeholder="Reason second visit required today (instability)…"></textarea>'
    : '';
}

function submitCombined() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  var ds = gv('cb-dal-start');
  var v  = parseInt(gv('cb-comb-v')) || 1;
  if (!ds) { showToast('Enter date'); return; }
  var note2 = document.getElementById('cb-comb-note') ? gv('cb-comb-note') : '';
  if (v === 2 && !note2) { showToast('Note required for 2nd visit'); return; }
  updatePatientFromClaimForm(p);
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }
  // First combined daily for this patient — capture reason before submitting
  if (!p.combinedDailyReason) {
    openCombinedReasonModal(p.id, function() {
      submitCombined(); // retry after reason saved
    });
    return;
  }
  var alias = getPerformingAlias();
  var baseNote = p.combinedDailyReason || '';
  addClaim(p, '33008', '33008', 1, fmtD(parseISODate(ds)), 'I', null, baseNote, null, alias);
  if (v === 2) addClaim(p, '33008', '33008', 1, fmtD(parseISODate(ds)), 'I', null, (baseNote ? baseNote + ' | ' : '') + (note2 || 'Second visit — patient unstable'), null, alias);
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('Combined daily ×' + v + ' — ' + p.last);
  closeClaimScreen();
}

// ── Directive visit (33006, max 2/week Sun–Sat) ────────
function buildDirectiveForm(p) {
  var cnt = dirCountThisWeek(p.phn); // count for current week (default date)
  var iso = localISODate();
  var h   = cnt >= 2
    ? '<div class="dir-warn">⚠ ' + cnt + ' directive visits already billed this Sun–Sat week. A note is required if the claim date falls in the same week.</div>'
    : '';
  h += '<div class="card"><div class="card-title">Directive visit (33006)</div>' +
       '<label>Date</label><input type="date" id="cb-dir-date" value="' + iso + '">';
  // Always render note field — required on submit if ≥2 directives exist in the claim date's week
  h += '<label>Note (required if 3rd directive in same Sun–Sat week)</label>' +
       '<textarea id="cb-dir-note" placeholder="Leave blank if this is the 1st or 2nd directive this week, or enter reason if exceeding 2/week…"></textarea>';
  h += '</div>';
  h += buildIcdRefCard(p);
  h += '<button class="btn btn-p" onclick="claimSubmitOnce(submitDirective)">Add directive claim</button>';
  return h;
}

function submitDirective() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  var ds  = gv('cb-dir-date');
  if (!ds) { showToast('Enter date'); return; }
  // Count directives in the week that contains the entered claim date, not today's week.
  // This allows historical entries from prior weeks even if current week is full.
  var cnt  = dirCountThisWeek(p.phn, ds);
  var note = (document.getElementById('cb-dir-note') ? gv('cb-dir-note') : '').trim();
  if (cnt >= 2 && !note) { showToast('Note required for 3rd directive in the same Sun–Sat week'); return; }
  updatePatientFromClaimForm(p);
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }
  var alias = getPerformingAlias();
  addClaim(p, '33006', '33006', 1, fmtD(parseISODate(ds)), 'I', null, note, null, alias);
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('33006 directive — ' + p.last);
  closeClaimScreen();
}

// ── CCU daily tap ──────────────────────────────────────
// Records raw tap; 1411/1421/1431 bands calculated at export
function buildCCUForm(p) {
  var alreadyToday = st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) && c.fee === 'CCU_DAILY' && c.date === TODAY;
  });
  var h = '<div class="card"><div class="card-title">CCU daily</div>' +
    '<p style="font-size:12px;color:var(--text2);margin-bottom:9px">' +
    'Records today\'s CCU visit. Codes 1411/1421/1431 are auto-calculated at export from total days.</p>';
  if (alreadyToday) h += '<div class="dir-warn">⚠ CCU daily already recorded today for this patient.</div>';
  h += '</div>';
  h += buildIcdRefCard(p);
  if (alreadyToday) {
    h += '<button class="btn btn-s" onclick="claimSubmitOnce(function(){submitCCU(true)})">Record again (confirm duplicate)</button>';
  } else {
    h += '<button class="btn btn-p" onclick="claimSubmitOnce(function(){submitCCU(false)})">Record CCU daily</button>';
  }
  return h;
}

function submitCCU(isDuplicate) {
  var p = getP(_claimPid); if (!checkDoc()) return;
  updatePatientFromClaimForm(p);
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }
  var alias = getPerformingAlias();
  // v3.60: write CCU_DAILY placeholder; export consolidates.
  addClaim(p, 'CCU_DAILY', 'CCU_DAILY', 1, TODAY, 'I', null, null, null, alias);
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('CCU daily recorded' + (isDuplicate ? ' (duplicate)' : '') + ' — ' + p.last);
  closeClaimScreen();
}

