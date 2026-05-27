// ── 06c_patient_summary.js ──
// ═══════════════════════════════════════════════════════
// 06c_patient_summary.js — Patient summary "baseball card"
// Shows patient demographics + all claims chronologically.
// Opens as a bottom sheet modal.
// ═══════════════════════════════════════════════════════

function openPatientSummary(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;
  _cvActiveType = null;  // reset legend pill selection for fresh open
  _cvDocAlias   = null;  // reset calendar performing-doctor to signed-in default

  // All claims for this patient, sorted oldest → newest
  var claims = st.claims
    .filter(function(c) { return c.phn && p.phn && samePhn(c.phn, p.phn); })
    .sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });

  // Also check by name if no PHN match (sticker not yet scanned)
  if (!claims.length || !p.phn) {
    var nameClaims = st.claims.filter(function(c) {
      return samePhn(c.phn, p.phn);
    }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
    if (nameClaims.length > claims.length) claims = nameClaims;
  }

  var html = '';

  // ── Demographics card ────────────────────────────────
  html += '<div style="background:var(--blue-bg);border-radius:var(--r);padding:13px 14px;margin-bottom:13px;border:.5px solid #a8c4e8">';
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between">';
  html +=   '<div>';
  html +=     '<div style="display:flex;align-items:center;gap:7px">' +
              '<div style="font-size:17px;font-weight:800;letter-spacing:-.4px;color:var(--blue-t)">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
              '<button class="summary-pencil-btn" data-pid3="' + p.id + '" onclick="ptSummaryEdit(this)" title="Edit patient">' +
                '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
                '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
              '</button>' +
              '</div>';
  if (p.dob)  html += '<div style="font-size:12px;color:var(--blue-t);opacity:.8;margin-top:2px">DOB ' + esc(dispDate(p.dob)) + (p.sex ? ' &bull; ' + p.sex : '') + '</div>';
  if (p.phn)  html += '<div style="font-size:12px;color:var(--blue-t);opacity:.8;margin-top:1px">PHN ' + esc(p.phn) + '</div>';
  html +=   '</div>';
  // Discharge badge if applicable
  if (p.discharged) {
    var daysAgo = Math.floor((Date.now() - parseDischargedAt(p.dischargedAt)) / 86400000);
    html += '<span class="chip chip-grey" style="margin-top:3px">Discharged ' + (daysAgo === 0 ? 'today' : daysAgo + 'd ago') + '</span>';
  }
  html += '</div>';

  // Location / care row
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
  if (p.consultOnly) html += '<span class="chip chip-blue" style="background:var(--purple-bg,#eeeaf8);color:var(--purple-t,#3b2d6e)">Consult only</span>';
  if (p.ward) html += '<span class="chip chip-blue">' + wardLabel(p.ward) + (p.bed ? ' Rm ' + p.bed : '') + '</span>';
  var careLabel = { daily:'MRP daily', directive:'Directive', combined:'Combined daily', ccu:'CCU daily' };
  if (p.mrp) html += '<div style="font-size:11px;color:var(--blue-t);opacity:.8;margin-top:4px">MRP: ' + esc(p.mrp) + '</div>';
  if (p.care) html += '<span class="chip chip-grey">' + (careLabel[p.care] || p.care) + '</span>';
  if (p.list === 'off') html += '<span class="chip chip-amber">Off service</span>';
  html += '</div>';

  // Referring MD + diagnosis
  if (p.refbyName || p.refby) {
    html += '<div style="font-size:11px;color:var(--blue-t);opacity:.8;margin-top:7px">Referred by ' + esc(p.refbyName || p.refby) + (p.refby ? ' #' + p.refby : '') + '</div>';
  }
  if (p.icd) {
  }
  html += '</div>'; // end demographics card

  // ── Claims section — toggle (Calendar default) + List/Calendar views (v3.27) ─
  var addClaimFn2 = p.discharged ? 'openClaimFromDischarged' : 'openClaimScreen';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">';
  html +=   '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">' +
            claims.length + ' claim' + (claims.length !== 1 ? 's' : '') + ' on record</div>';
  html +=   '<div style="display:flex;gap:6px">' +
              '<button class="pt-addclaim-btn" data-pid2="' + p.id + '" data-fn2="' + addClaimFn2 + '" onclick="ptSummaryAddClaim(this)">+ Add claim</button>' +
            '</div>';
  html += '</div>';

  // Calendar (90% width, centred) + list below — no toggle
  html += '<div id="cv-view-cal" style="width:90%;margin:0 auto 0">' + _ptSummaryCalendarHTML(p, claims) + '</div>';

  html += '<div id="cv-view-list" style="margin-top:14px">' + _ptSummaryListHTML(p, claims) + '</div>';

  // Close button
  html += '<button class="btn btn-s" style="margin-top:12px;margin-bottom:0" onclick="hideModal(\'pt-summary-modal\')">Close</button>';

  document.getElementById('pt-summary-content').innerHTML = html;
  showModal('pt-summary-modal');

  // Stash the patient id for calendar interactions
  window._cvPid = p.id;
  // Default calendar month: most recent of (today's month, admit month)
  var admitMs = p.admitDate ? parseDMYsafe(p.admitDate) : null;
  var nowD = new Date();
  if (admitMs) {
    var aD = new Date(admitMs);
    // Show month containing today by default; user can navigate back to admit
    window._cvMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  } else {
    window._cvMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// v3.27 — Calendar view of patient claims
// ═════════════════════════════════════════════════════════════════════════

// Switch between list & calendar inside the patient summary modal
function togglePtSummaryView(view) {
  var listEl = document.getElementById('cv-view-list');
  var calEl  = document.getElementById('cv-view-cal');
  var tL = document.getElementById('cv-tog-list');
  var tC = document.getElementById('cv-tog-cal');
  if (!listEl || !calEl) return;
  if (view === 'list') {
    listEl.style.display = '';
    calEl.style.display  = 'none';
    if (tL) tL.classList.add('on');
    if (tC) tC.classList.remove('on');
  } else {
    listEl.style.display = 'none';
    calEl.style.display  = '';
    if (tL) tL.classList.remove('on');
    if (tC) tC.classList.add('on');
  }
}

// ── Existing list rendering — extracted into a helper so it can live in a div ──
function _ptSummaryListHTML(p, claims) {
  if (!claims.length) {
    return '<div class="empty" style="padding:16px 0">No claims recorded yet for this patient.</div>';
  }
  // Group by date for easier reading (oldest → newest, since claims arrive sorted that way)
  var byDate = {};
  var dateOrder = [];
  claims.forEach(function(c) {
    if (!byDate[c.date]) { byDate[c.date] = []; dateOrder.push(c.date); }
    byDate[c.date].push(c);
  });

  var html = '';
  dateOrder.forEach(function(date) {
    var dayClaims = byDate[date];
    html += '<div style="font-size:11px;font-weight:700;color:var(--text2);margin:10px 0 5px;padding-bottom:4px;border-bottom:.5px solid var(--border)">' + dispDate(date) + '</div>';
    dayClaims.forEach(function(c) {
      var feeLabel = getFeeLabel(c.fee);
      var dxLabel  = icdShortLabel(c.icd);
      if (dxLabel.length > 45) dxLabel = dxLabel.slice(0, 42) + '…';
      var isCCU = c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431';
      var feeMeta  = FEES.find(function(f) { return f.code === c.fee; });
      var feeChip  = (isCCU ? 'chip-red' : (feeMeta && feeMeta.clr) || 'chip-grey');

      html += '<div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:.5px solid var(--border)">';
      html +=   '<div style="min-width:52px;flex-shrink:0">';
      html +=     '<span class="' + feeChip + '" style="font-size:11px;font-weight:700;font-family:monospace;padding:2px 6px;border-radius:4px;display:inline-block">' + esc(c.fee === 'CCU_DAILY' ? '1411/21/31' : c.fee) + '</span>';
      if (c.units && c.units > 1) html += '<div style="font-size:9px;color:var(--text3);margin-top:2px">×' + c.units + '</div>';
      html +=   '</div>';
      html +=   '<div style="flex:1;min-width:0">';
      html +=     '<div style="font-size:12px;font-weight:600">' + esc(feeLabel) + '</div>';
      html +=     '<div style="font-size:10px;color:var(--text2);margin-top:2px">' + esc(dxLabel) + '</div>';
      if (c.notes) html += '<div style="font-size:10px;color:var(--amber-t);margin-top:2px;font-style:italic">' + esc(c.notes) + '</div>';
      html +=   '</div>';
      html +=   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">';
      html +=     '<div style="font-size:10px;color:var(--text3);text-align:right">' + esc(c.alias || '—');
      if (c.startTime) {
        var displayTime = fmtStartTime(c.startTime);
        if (displayTime && displayTime.length <= 5 && !/T|Z|\d{4}-/.test(displayTime)) {
          html += '<div style="margin-top:1px">' + esc(displayTime) + '</div>';
        }
      }
      html +=     '</div>';
      html +=     '<div style="display:flex;gap:4px">';
      html +=       '<button class="claim-action-btn claim-edit-btn" data-cid="' + c.id + '" data-pid="' + p.id + '" onclick="openClaimEdit(this)" title="Edit claim">✎</button>';
      html +=       '<button class="claim-action-btn claim-del-btn"  data-cid="' + c.id + '" data-pid="' + p.id + '" onclick="deleteClaimBtn(this)" title="Delete claim">✕</button>';
      html +=     '</div>';
      html +=   '</div>';
      html += '</div>';
    });
  });
  return html;
}

// ── Calendar view ─────────────────────────────────────────────────────────
// Returns 'ccu' (CCU/ICU ward + MRP role) | 'daily' (MRP role, non-CCU ward) | null
function _cvGapRuleForPatient(p) {
  if (!p) return null;
  if (p.role !== 'mrp' && p.care !== 'daily' && p.care !== 'ccu') return null;
  var ccuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (ccuWards.indexOf(p.ward) !== -1) return 'ccu';
  if (p.role === 'mrp' || p.care === 'daily') return 'daily';
  return null;
}

// Returns { startMs, endMs } — admission span as epoch ms, end = dischargeDate or today
function _cvAdmitSpan(p) {
  if (!p || !p.admitDate) return null;
  var startMs = parseDMYsafe(p.admitDate);
  if (!startMs) return null;
  var endMs;
  if (p.discharged && p.dischargeDate) {
    endMs = parseDMYsafe(p.dischargeDate);
  }
  if (!endMs) {
    // Fall back to today
    var now = new Date();
    endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  return { startMs: startMs, endMs: endMs };
}

// Map a DD/MM/YYYY date to the dominant cell-colour key.
// Priority: consult > ccu > daily > directive > combined
function _cvDominantType(dayClaims) {
  if (!dayClaims || !dayClaims.length) return null;
  var has = { consult:false, ccu:false, daily:false, directive:false, combined:false };
  var hasAny = false;
  dayClaims.forEach(function(c) {
    hasAny = true;
    // Consults (full / limited / emergency / prolonged counselling)
    if (c.fee === '33010' || c.fee === '33012' || c.fee === '33005' || c.fee === '33014') has.consult = true;
    // CCU bands (raw tap + days 1 / 2-7 / 8-30 / 31+)
    else if (c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431' || c.fee === '1441') has.ccu = true;
    // Directive visit
    else if (c.fee === '33006') has.directive = true;
    // 33008 is both daily AND combined daily — differentiate by note presence
    // (combined daily care from the calendar always adds an "<icd> — <reason>" note)
    else if (c.fee === '33008') {
      if (c.notes && String(c.notes).trim()) has.combined = true;
      else has.daily = true;
    }
    // Bedside procedures (cardioversion, pericardiocentesis) — flag as consult-coloured
    // since they typically accompany a consult/visit event the same day
    else if (c.fee === 'Y33025' || c.fee === '00751') has.consult = true;
    // 78717 (complex discharge) / 78720 (MOST) are extras that piggyback on a
    // regular visit. Fall through; if a 33008/33010 is also billed today, that
    // wins. If those are the ONLY claims, the hasAny fallback at the end paints
    // the day with consult colour so it isn't invisible.
  });
  if (has.consult)   return 'consult';
  if (has.ccu)       return 'ccu';
  if (has.daily)     return 'daily';
  if (has.directive) return 'directive';
  if (has.combined)  return 'combined';
  // Fallback — any claim on the day deserves *some* colour so the doctor sees it
  if (hasAny) return 'consult';
  return null;
}

// Build the list of gap days (DD/MM/YYYY strings) for a patient
function _cvGapDays(p, claims) {
  var span = _cvAdmitSpan(p);
  var rule = _cvGapRuleForPatient(p);
  if (!span || !rule) return [];
  var DAY_MS = 86400000;
  var todayMs = parseDMYsafe(TODAY);
  // Build a set of claimed days (any visit fee counts as occupying the day)
  var claimedSet = {};
  claims.forEach(function(c) {
    var ms = parseDMYsafe(c.date);
    if (ms) claimedSet[ms] = true;
  });
  var gaps = [];
  // Don't flag today as a gap — doctor may still be rounding
  var endMs = Math.min(span.endMs, todayMs - DAY_MS);
  for (var d = span.startMs; d <= endMs; d += DAY_MS) {
    if (!claimedSet[d]) {
      var dt = new Date(d);
      gaps.push(pad(dt.getDate()) + '/' + pad(dt.getMonth()+1) + '/' + dt.getFullYear());
    }
  }
  return gaps;
}

// CCU fee for a specific date based on consecutive prior CCU days
function _cvCcuFeeForDate(p, dateStr) {
  var CCU_FEES = ['CCU_DAILY','1411','1421','1431'];
  var DAY_MS = 86400000;
  var targetMs = parseDMYsafe(dateStr);
  if (!targetMs) return '1411';
  // Count consecutive CCU days immediately preceding targetMs
  var ccuDateSet = {};
  st.claims.forEach(function(c) {
    if (samePhn(c.phn, p.phn) && CCU_FEES.indexOf(c.fee) !== -1) {
      var ms = parseDMYsafe(c.date);
      if (ms && ms < targetMs) ccuDateSet[ms] = true;
    }
  });
  var consec = 0;
  var checkMs = targetMs - DAY_MS;
  while (ccuDateSet[checkMs]) { consec++; checkMs -= DAY_MS; }
  var dayNum = consec + 1;
  if (dayNum === 1) return '1411';
  if (dayNum <= 7)  return '1421';
  return '1431';
}

// Build calendar HTML
function _ptSummaryCalendarHTML(p, claims) {
  // Index claims by DD/MM/YYYY — normalize each claim's date first since
  // claims that round-trip through Sheets may come back as a Date object or
  // ISO string instead of DD/MM/YYYY (see fmtClaimDate defensive logic).
  var byDate = {};
  claims.forEach(function(c) {
    var dateKey = fmtClaimDate(c.date);  // always DD/MM/YYYY after this
    if (!dateKey) return;
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(c);
  });

  var span = _cvAdmitSpan(p);
  var rule = _cvGapRuleForPatient(p);
  var gaps = _cvGapDays(p, claims);
  var month = window._cvMonth || (function() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  })();

  var monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month.getMonth()];
  var year = month.getFullYear();

  var html = '';

  // Legend — Gap is view-only; Consult opens the consult card; CCU/Daily/
  // Directive/Combined daily are sticky type-selector pills.
  html += '<div class="cv-legend">' +
            '<button class="cv-lg-pill cv-lgp-consult"  id="cv-lgp-consult"  onclick="_cvOpenConsultCard()"><div class="cv-sw" style="background:#ffcf73"></div>Consult</button>' +
            '<button class="cv-lg-pill cv-lgp-ccu"       id="cv-lgp-ccu"       onclick="_cvSelectLegend(\'ccu\',this)"><div class="cv-sw" style="background:#f08585"></div>CCU</button>' +
            '<button class="cv-lg-pill cv-lgp-daily"     id="cv-lgp-daily"     onclick="_cvSelectLegend(\'daily\',this)"><div class="cv-sw" style="background:#3fa658"></div>Daily</button>' +
            '<button class="cv-lg-pill cv-lgp-directive" id="cv-lgp-directive" onclick="_cvSelectLegend(\'directive\',this)"><div class="cv-sw" style="background:#8eb5fa"></div>Directive</button>' +
            '<button class="cv-lg-pill cv-lgp-combined"  id="cv-lgp-combined"  onclick="_cvSelectLegend(\'combined\',this)"><div class="cv-sw" style="background:#b8e6c4"></div>Combined daily</button>' +
            (rule ? '<div class="cv-lg"><div class="cv-sw" style="background:#d4d4d8;border:1px dashed #8a8a92"></div>Gap</div>' : '') +
          '</div>' +
          '<div class="cv-tap-hint" id="cv-tap-hint"></div>';

  // Restore active pill highlight if a type was already selected
  if (window._cvActiveType) {
    var _restoreHint = html; // keep ref; actual DOM restore happens after render via _cvRestoreActivePill()
  }

  // Month nav
  html += '<div style="max-width:420px;margin:0 auto">';  // desktop width cap

  // Performing-doctor selector — applies to claims added by tapping a day
  // (legend-pill quick-add or the gap-fill picker). Defaults to the
  // signed-in doctor; change it when back-populating another doctor's days.
  var _cvCurDoc  = _cvDocAlias || (st.doc ? st.doc.alias : '');
  var _cvDocOpts = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === _cvCurDoc ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + '</option>';
  }).join('');
  if (_cvDocOpts) {
    html += '<div style="display:flex;align-items:center;gap:8px;margin:2px 0 10px">' +
              '<span style="font-size:11px;font-weight:600;color:var(--text2);white-space:nowrap">Performing doctor</span>' +
              '<select id="cv-legend-doc" onchange="_cvSetDoc(this.value)" ' +
                'style="flex:1;padding:6px 9px;border:.5px solid var(--border2);border-radius:8px;' +
                'font-size:12px;font-family:inherit;background:var(--surface2);color:var(--text)">' +
                _cvDocOpts +
              '</select>' +
            '</div>';
  }

  html += '<div class="cv-nav">' +
            '<button onclick="_cvChangeMonth(-1)">‹</button>' +
            '<div class="cv-month">' + monthName + ' ' + year + '</div>' +
            '<button onclick="_cvChangeMonth(1)">›</button>' +
          '</div>';

  // Grid
  html += '<div class="cv-grid">';
  html +=   '<div class="cv-dow">Su</div><div class="cv-dow">Mo</div><div class="cv-dow">Tu</div>' +
            '<div class="cv-dow">We</div><div class="cv-dow">Th</div><div class="cv-dow">Fr</div>' +
            '<div class="cv-dow">Sa</div>';

  var firstDow = new Date(year, month.getMonth(), 1).getDay();
  var daysIn   = new Date(year, month.getMonth() + 1, 0).getDate();
  for (var i = 0; i < firstDow; i++) html += '<div class="cv-day cv-outside"></div>';

  var todayKey = TODAY;
  for (var d = 1; d <= daysIn; d++) {
    var dateStr = pad(d) + '/' + pad(month.getMonth()+1) + '/' + year;
    var dayClaims = byDate[dateStr] || [];
    var dominant = _cvDominantType(dayClaims);
    var dayMs = new Date(year, month.getMonth(), d).getTime();
    var inSpan = span && dayMs >= span.startMs && dayMs <= span.endMs;
    var isGap = inSpan && rule && !dayClaims.length && dateStr !== todayKey;

    var cls = 'cv-day';
    if (dominant) cls += ' cv-' + dominant;
    else if (isGap) cls += ' cv-gap';
    if (dateStr === todayKey) cls += ' cv-today';
    if (p.discharged && p.dischargeDate === dateStr) cls += ' cv-discharged';

    var tag = '';
    if (dominant === 'ccu') {
      // Show the band (1411 / 1421 / 1431)
      var ccuClaim = dayClaims.find(function(c) {
        return c.fee === '1411' || c.fee === '1421' || c.fee === '1431';
      });
      if (ccuClaim) tag = ccuClaim.fee;
    }

    var tappable = true;  // all in-month days tappable — active pill mode needs this
    var onclick = ' onclick="tapCalDay(\'' + dateStr + '\')"';
    html += '<div class="' + cls + '"' + onclick + '>' +
              '<div class="cv-num">' + d + '</div>' +
              (tag ? '<div class="cv-tag">' + tag + '</div>' : '') +
            '</div>';
  }

  html += '</div>'; // close cv-grid

  // Gap warning banner
  if (rule) {
    if (gaps.length === 0) {
      html += '<div class="cv-warn cv-warn-ok">' +
                '<div class="cv-warn-icon">✓</div>' +
                '<div class="cv-warn-body"><b>No billing gaps</b>' +
                '<span>Every ' + (rule === 'ccu' ? 'CCU' : 'MRP') + ' day in this admission has a claim.</span></div>' +
              '</div>';
    } else {
      var gapStr = gaps.slice(0, 4).map(function(g) {
        var parts = g.split('/');
        return parseInt(parts[0]) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1])-1];
      }).join(', ') + (gaps.length > 4 ? '…' : '');
      html += '<div class="cv-warn">' +
                '<div class="cv-warn-icon">⚠</div>' +
                '<div class="cv-warn-body"><b>' + gaps.length + ' billing gap' + (gaps.length>1?'s':'') + ' in this admission</b>' +
                '<span>' + gapStr + '. Tap a grey day to fill.</span></div>' +
              '</div>';
    }
  }

  html += '</div>'; // close max-width wrapper

  return html;
}

// Change month and re-render calendar in-place
function _cvChangeMonth(delta) {
  var m = window._cvMonth || new Date();
  window._cvMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;
  var claims = st.claims.filter(function(c) {
    return c.phn && p.phn && samePhn(c.phn, p.phn);
  }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
  var calEl = document.getElementById('cv-view-cal');
  if (calEl) { calEl.innerHTML = _ptSummaryCalendarHTML(p, claims); _cvRestoreActivePill(); }
}

// Legend pill selection — sticky type mode
var _cvActiveType = null;

// Calendar performing-doctor — sticky across month navigation within a
// single summary open. Null means "use the signed-in doctor". Reset on
// every openPatientSummary() so it always starts at the logged-in user.
var _cvDocAlias = null;

// Record the calendar performing-doctor dropdown choice.
function _cvSetDoc(alias) { _cvDocAlias = alias || null; }

// Resolve the performing doctor for a calendar quick-add: live dropdown
// value first, then the remembered choice, then the signed-in doctor.
function _cvCurrentDocAlias() {
  var sel = document.getElementById('cv-legend-doc');
  if (sel && sel.value) return sel.value;
  return _cvDocAlias || (st.doc ? st.doc.alias : '');
}

function _cvSelectLegend(type, btn) {
  var wasActive = _cvActiveType === type;
  _cvActiveType = wasActive ? null : type;
  document.querySelectorAll('.cv-lg-pill').forEach(function(b) { b.classList.remove('active'); });
  if (!wasActive && btn) btn.classList.add('active');
  var hint = document.getElementById('cv-tap-hint');
  if (hint) {
    var labelMap = { ccu:'CCU', daily:'Daily', directive:'Directive', combined:'Combined daily' };
    hint.style.display = _cvActiveType ? '' : 'none';
    hint.style.color = _cvActiveType ? 'var(--blue-t)' : '';
    hint.textContent = _cvActiveType ? '↑ Tap any day to add ' + (labelMap[_cvActiveType] || _cvActiveType) + ' — tap pill again to cancel' : '';
  }
}

function _cvRestoreActivePill() {
  if (!_cvActiveType) return;
  var pill = document.getElementById('cv-lgp-' + _cvActiveType);
  if (pill) pill.classList.add('active');
  var hint = document.getElementById('cv-tap-hint');
  if (hint) {
    var labelMap = { ccu:'CCU', daily:'Daily', directive:'Directive', combined:'Combined daily' };
    hint.style.display = '';
    hint.style.color = 'var(--blue-t)';
    hint.textContent = '↑ Tap any day to add ' + (labelMap[_cvActiveType] || _cvActiveType) + ' — tap pill again to cancel';
  }
}

// Consult legend pill — opens the full consult card for the current patient.
// A consult is not a one-tap day add (it needs start/end times, MOST, CCFPP),
// so unlike the CCU/Daily/Directive pills it opens the consult form directly
// rather than arming a sticky day-tap mode.
function _cvOpenConsultCard() {
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;
  hideModal('pt-summary-modal');
  if (p.discharged) openClaimFromDischarged(pid);
  else              openClaimScreen(pid);
  selCT('consult');
}

// Tap a day — open details or the gap-fill picker
function tapCalDay(dateStr) {
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;

  // Active legend pill mode — add that type directly without opening picker
  if (_cvActiveType) {
    var alias = _cvCurrentDocAlias();
    if (_cvActiveType === 'combined') {
      // Combined daily: reuse this patient's reason if one is already on file;
      // only prompt the first time (see _cvPriorCombinedReason).
      var prc = _cvPriorCombinedReason(p);
      if (prc) _cvFillClaim(pid, dateStr, 'combined', prc.note, prc.icd, alias);
      else     _cvShowCombinedForm(pid, dateStr, alias);
    } else {
      _cvFillClaim(pid, dateStr, _cvActiveType, '', null, alias);
    }
    return;
  }

  var dayClaims = st.claims.filter(function(c) {
    return samePhn(c.phn, p.phn) && c.date === dateStr;
  });
  if (dayClaims.length) {
    _cvShowDayDetails(pid, dateStr, dayClaims);
  } else {
    _cvShowPicker(pid, dateStr, _cvCurrentDocAlias());
  }
}

// Sheet showing all claims on a single day with edit/delete
function _cvShowDayDetails(pid, dateStr, dayClaims) {
  var rows = dayClaims.map(function(c) {
    var feeLabel = getFeeLabel(c.fee);
    var dxLabel  = icdShortLabel(c.icd);
    if (dxLabel.length > 45) dxLabel = dxLabel.slice(0, 42) + '…';
    var typeColor = 'var(--text)';
    // Match calendar legend: Consult=yellow, Daily=green, Combined=teal, Directive=skyblue, CCU=red, Modifier=blue, Procedure=red, Discharge plan=green
    if (c.fee === '33010' || c.fee === '33012' || c.fee === '33014') typeColor = '#5a2700';            // consult yellow
    else if (c.fee === '33005')                                       typeColor = 'var(--red-t)';       // emergency consult
    else if (c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431' || c.fee === '1441') typeColor = 'var(--red-t)'; // CCU
    else if (c.fee === '33006')                                       typeColor = '#002461';            // directive sky-blue
    else if (c.fee === '33008' && c.notes)                            typeColor = 'var(--teal-t)';      // combined daily
    else if (c.fee === '33008')                                       typeColor = 'var(--green-t)';     // daily
    else if (c.fee === 'Y33025' || c.fee === '00751')                 typeColor = 'var(--red-t)';       // procedure
    else if (c.fee === '78717' || c.fee === '78720')                  typeColor = 'var(--green-t)';     // MOST / discharge plan
    else if (['1200','1201','1202','1205','1206','1207'].indexOf(c.fee) !== -1) typeColor = 'var(--blue-t)'; // modifiers
    return (
      '<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;color:' + typeColor + '">' +
          '<span>' + esc(feeLabel) + ' &bull; ' + esc(c.fee) + '</span>' +
          '<span>' + esc(c.alias || '—') + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:4px">' + esc(dxLabel) + '</div>' +
        (c.notes ? '<div style="font-size:11px;color:var(--amber-t);margin-top:4px;font-style:italic">' + esc(c.notes) + '</div>' : '') +
        (c.createdBy ? '<div style="font-size:10px;color:var(--text3);margin-top:4px">Submitted by ' + esc(c.createdBy) + (c.createdAt ? ' &middot; ' + auditTs(c.createdAt) : '') + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<button class="claim-action-btn claim-edit-btn" data-cid="' + c.id + '" data-pid="' + pid + '" onclick="_cvEditFromSheet(this)" title="Edit">✎ Edit</button>' +
          '<button class="claim-action-btn claim-del-btn"  data-cid="' + c.id + '" data-pid="' + pid + '" onclick="_cvDeleteFromSheet(this)" title="Delete">✕ Delete</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var html =
    '<div style="font-size:14px;font-weight:700;margin-bottom:2px">' + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:12px">' + dayClaims.length + ' claim' + (dayClaims.length>1?'s':'') + ' on this day</div>' +
    rows +
    '<button class="btn btn-s" style="margin-top:6px;margin-bottom:0" onclick="hideModal(\'cv-picker-modal\')">Close</button>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
}

function _cvEditFromSheet(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  hideModal('cv-picker-modal');
  hideModal('pt-summary-modal');
  // Reuse existing edit flow
  var fakeBtn = { getAttribute: function(k) { return k === 'data-cid' ? cid : (k === 'data-pid' ? pid : null); } };
  openClaimEdit(fakeBtn);
}

function _cvDeleteFromSheet(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  hideModal('cv-picker-modal');
  var fakeBtn = { getAttribute: function(k) { return k === 'data-cid' ? cid : (k === 'data-pid' ? pid : null); } };
  deleteClaimBtn(fakeBtn);
  // Re-render the calendar after the delete is processed
  setTimeout(function() {
    if (window._cvPid) {
      var p = getP(window._cvPid);
      if (p) openPatientSummary(p.id);
    }
  }, 100);
}

// Gap-fill picker — 4 options, rule-recommended type highlighted
function _cvShowPicker(pid, dateStr, preselectedAlias) {
  var p = getP(pid);
  if (!p) return;
  var rec = _cvGapRuleForPatient(p);   // 'ccu' | 'daily' | null

  var ccuFee  = _cvCcuFeeForDate(p, dateStr);
  var ccuBand = ccuFee === '1411' ? 'day 1' : (ccuFee === '1421' ? 'day 2–7' : 'day 8+');
  var typeOpts = [
    { id:'ccu',       label:'CCU',            sub:ccuBand + ' • ' + ccuFee, cls:'cv-pk-ccu' },
    { id:'daily',     label:'Daily',          sub:'33008',                  cls:'cv-pk-daily' },
    { id:'directive', label:'Directive',      sub:'33006',                  cls:'cv-pk-directive' },
    { id:'combined',  label:'Combined daily', sub:'needs reason',           cls:'cv-pk-combined' }
  ];
  var btns = typeOpts.map(function(o) {
    var recCls = (o.id === rec) ? ' cv-pk-rec' : '';
    return '<button class="cv-pick-btn ' + o.cls + recCls + '" data-pid="' + pid + '" data-date="' + dateStr + '" data-type="' + o.id + '" onclick="_cvPickType(this)">' +
             '<div class="cv-pk-l">' + o.label + '</div>' +
             '<div class="cv-pk-s">' + o.sub + '</div>' +
             (o.id === rec ? '<div class="cv-pk-flag">Recommended</div>' : '') +
           '</button>';
  }).join('');

  var headerColor = rec ? 'var(--amber-t)' : 'var(--text)';
  var headerIcon  = rec ? '⚠ ' : '+ ';
  var hint = rec
    ? p.last + ' was ' + (rec === 'ccu' ? 'in CCU' : 'MRP') + ' this day — pick a type to backfill.'
    : 'No claim on file. Pick a visit type to add for this date.';

  // Build performing doctor dropdown (unique id cv-performing-doc to avoid conflict with claim builder)
  var curAlias = preselectedAlias || (st.doc ? st.doc.alias : '');
  var docOpts = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === curAlias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');
  var docRow = docOpts
    ? '<div style="margin-bottom:10px">' +
        '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Performing doctor</label>' +
        '<select id="cv-performing-doc" style="width:100%;padding:8px 10px;border:.5px solid var(--border2);border-radius:8px;font-size:13px;font-family:inherit;background:var(--surface2)">' +
        docOpts + '</select></div>'
    : '';

  var html =
    '<div style="font-size:14px;font-weight:700;color:' + headerColor + ';margin-bottom:2px">' + headerIcon + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">' + hint + '</div>' +
    docRow +
    '<div class="cv-pick-grid">' + btns + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" onclick="hideModal(\'cv-picker-modal\')">Cancel</button>' +
    '</div>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
}

function _cvPickType(btn) {
  var pid     = btn.getAttribute('data-pid');
  var dateStr = btn.getAttribute('data-date');
  var type    = btn.getAttribute('data-type');
  var sel = document.getElementById('cv-performing-doc');
  var alias = (sel && sel.value) ? sel.value : (st.doc ? st.doc.alias : '');
  if (type === 'combined') {
    // Combined daily: reuse this patient's reason if already on file; only
    // prompt the first time.
    var prc = _cvPriorCombinedReason(getP(pid));
    if (prc) return _cvFillClaim(pid, dateStr, 'combined', prc.note, prc.icd, alias);
    return _cvShowCombinedForm(pid, dateStr, alias);
  }
  _cvFillClaim(pid, dateStr, type, '', null, alias);
}

// Combined daily — the reason is entered ONCE per patient, then reused.
// Returns { note, icd } from the most recent combined-daily claim (a 33008
// row carrying a note) on file for this patient, or null if there is none
// yet. Derived from claim history, so it needs no extra storage and works no
// matter which screen the first combined daily was entered on. To change the
// reason later, edit the note on any combined-daily claim — the most recent
// one wins.
function _cvPriorCombinedReason(p) {
  if (!p || !p.phn) return null;
  var best = null;
  st.claims.forEach(function(c) {
    if (c.fee !== '33008') return;
    if (!c.notes || !String(c.notes).trim()) return;   // note-less 33008 = plain daily
    if (!c.phn || !samePhn(c.phn, p.phn)) return;
    if (!best || parseDMY(c.date) >= parseDMY(best.date)) best = c;
  });
  return best
    ? { note: String(best.notes).trim(), icd: String(best.icd || p.icd || '').trim() }
    : null;
}

// Combined daily sub-form — ICD + reason. Shown only the FIRST time a combined
// daily is added for a patient; after that _cvPriorCombinedReason reuses it.
function _cvShowCombinedForm(pid, dateStr, alias) {
  var p = getP(pid);
  if (!p) return;
  var defaultIcd = String(p.icd || '').trim();
  var safeAlias = alias || (st.doc ? st.doc.alias : '');
  var html =
    '<div style="font-size:14px;font-weight:700;color:var(--teal-t);margin-bottom:2px">Combined daily — ' + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:12px">Entered once — this reason is reused for every future combined daily on this patient.</div>' +

    '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin:0 0 4px">ICD-9 diagnostic code</label>' +
    '<input id="cv-cb-icd" type="text" value="' + esc(defaultIcd) + '" placeholder="e.g. 428.0" autocomplete="off" ' +
    'style="width:100%;padding:11px;border:.5px solid var(--border2);border-radius:8px;font-size:14px;font-family:inherit;background:var(--surface2)">' +

    '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin:12px 0 4px">Reason for combined daily care</label>' +
    '<textarea id="cv-cb-reason" rows="3" autocomplete="off" placeholder="e.g. CHF — co-managed with hospitalist for renal optimization" ' +
    'style="width:100%;padding:11px;border:.5px solid var(--border2);border-radius:8px;font-size:14px;font-family:inherit;background:var(--surface2);resize:vertical"></textarea>' +

    '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" data-pid="' + pid + '" data-date="' + dateStr + '" data-alias="' + esc(safeAlias) + '" onclick="_cvBackFromCombined(this)">‹ Back</button>' +
      '<button class="btn btn-p" style="flex:1;margin-bottom:0" data-pid="' + pid + '" data-date="' + dateStr + '" data-alias="' + esc(safeAlias) + '" onclick="_cvConfirmCombined(this)">Add combined daily</button>' +
    '</div>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
  setTimeout(function() {
    var el = document.getElementById('cv-cb-reason');
    if (el) el.focus();
  }, 200);
}

function _cvBackFromCombined(btn) {
  var alias = btn.getAttribute('data-alias') || (st.doc ? st.doc.alias : '');
  _cvShowPicker(btn.getAttribute('data-pid'), btn.getAttribute('data-date'), alias);
}

function _cvConfirmCombined(btn) {
  var pid     = btn.getAttribute('data-pid');
  var dateStr = btn.getAttribute('data-date');
  var alias   = btn.getAttribute('data-alias') || (st.doc ? st.doc.alias : '');
  var icdEl    = document.getElementById('cv-cb-icd');
  var reasonEl = document.getElementById('cv-cb-reason');
  var icd    = (icdEl    ? icdEl.value    : '').trim();
  var reason = (reasonEl ? reasonEl.value : '').trim();
  if (!icd)    { if (icdEl)    icdEl.style.borderColor    = 'var(--red)'; return; }
  if (!reason) { if (reasonEl) reasonEl.style.borderColor = 'var(--red)'; return; }
  var note = icd + ' — ' + reason;
  _cvFillClaim(pid, dateStr, 'combined', note, icd, alias);
}

// Create the gap-fill claim and refresh the calendar
function _cvFillClaim(pid, dateStr, type, note, icdOverride, alias) {
  var p = getP(pid);
  if (!p) return;
  if (!checkDoc()) return;
  // Temporarily override patient ICD for the addClaim call if provided
  var origIcd = p.icd;
  if (icdOverride) p.icd = icdOverride;

  var performingAlias = alias || st.doc.alias;
  if (type === 'ccu') {
    // v3.60: write CCU_DAILY placeholder; export consolidates to 1411/1421/1431.
    addClaim(p, 'CCU_DAILY', 'CCU_DAILY', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'daily') {
    addClaim(p, '33008', '33008', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'directive') {
    addClaim(p, '33006', '33006', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'combined') {
    addClaim(p, '33008', '33008', 1, dateStr, 'I', null, note, null, performingAlias);
  }
  // Restore original ICD (the claim copy already captured it)
  if (icdOverride) p.icd = origIcd;

  sv('patients', st.patients);
  sv('claims',   st.claims);
  hideModal('cv-picker-modal');
  showToast(type === 'combined' ? 'Combined daily added — ' + p.last : 'Claim added — ' + p.last);

  // Refresh the calendar in-place
  var claims = st.claims.filter(function(c) {
    return c.phn && p.phn && samePhn(c.phn, p.phn);
  }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
  var calEl = document.getElementById('cv-view-cal');
  if (calEl) { calEl.innerHTML = _ptSummaryCalendarHTML(p, claims); _cvRestoreActivePill(); }
  var listEl = document.getElementById('cv-view-list');
  if (listEl) listEl.innerHTML = _ptSummaryListHTML(p, claims);
  render();
}

// Get short ICD-9 label: "Description (code)"
// Format a startTime value from any source (HH:MM string, Date object, ISO string)
// to display HH:MM only. Sheets stores time-only as 1899-12-30T<HH>:<MM>:00.000Z
// Normalise claim date — Sheets may serialise DD/MM/YYYY back as
// ISO timestamps, JS Date strings, or pandas Timestamps. Always
// produce DD/MM/YYYY for storage and display.
// Force Title Case on names — capitalize the first letter after each space,
// hyphen, or apostrophe. Mirrors fmtClaimDate's normalization role but for
// patient/claim last/first fields. Used at every layer where names enter the
// app (sync, OCR, form input, claim creation) so we never store mixed-casing.
// Caveat: Mc/Mac/O' prefixes are partially handled (O'Brien works, McMillan
// becomes "Mcmillan" — manual override still possible for those).
function fmtName(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(
    /(^|[\s'\-])([a-z])/g,
    function(_, sep, c) { return sep + c.toUpperCase(); }
  );
}

function fmtClaimDate(d) {
  if (!d) return '';
  // Already clean DD/MM/YYYY — return immediately, no further parsing
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  // ISO date string or timestamp (from Sheets) — YYYY-MM-DD[T...] — flip to DD/MM/YYYY
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    var m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var yr = parseInt(m[1]), mo = parseInt(m[2]), dy = parseInt(m[3]);
      // Sanity check: if the ISO date is in the future (month hasn't arrived yet)
      // and swapping day/month would give a past/present date, it's the UTC-offset
      // bug where toISOString() crossed midnight and swapped DD and MM.
      // e.g. 2026-06-05 with today in May 2026 → swap to 2026-05-06 → 06/05/2026
      var now = new Date();
      var isFuture = (yr > now.getFullYear()) ||
                     (yr === now.getFullYear() && mo > now.getMonth() + 1);
      if (isFuture && dy <= 12) {
        // Try swapping day and month
        var swappedMo = dy, swappedDy = mo;
        var swapFuture = (yr > now.getFullYear()) ||
                         (yr === now.getFullYear() && swappedMo > now.getMonth() + 1);
        if (!swapFuture) {
          // Swapped version is not in the future — use it
          return pad(swappedDy) + '/' + pad(swappedMo) + '/' + yr;
        }
      }
      return pad(dy) + '/' + pad(mo) + '/' + yr;
    }
  }
  // Date object (already local) — extract local day/month/year
  if (d instanceof Date && !isNaN(d)) {
    return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear();
  }
  // v3.92: named-month dates — "18 Jan 1944", "18/Jan/1944", "18-January-1944".
  // The month is spelled out, so this is unambiguous (no day/month inference) —
  // safe to normalise to DD/MM/YYYY. Both OCR display formatting and manual
  // entry following the "DD/MMM/YYYY" field hint produce this shape.
  if (typeof d === 'string') {
    var _tm = d.trim().match(/^(\d{1,2})[\s\/.\-]+([A-Za-z]{3,9})[\s\/.\-]+(\d{4})$/);
    if (_tm) {
      var _mon = _tm[2].charAt(0).toUpperCase() + _tm[2].slice(1,3).toLowerCase();
      var _mi  = _MONTHS.indexOf(_mon);
      if (_mi !== -1) return pad(parseInt(_tm[1],10)) + '/' + pad(_mi+1) + '/' + _tm[3];
    }
  }
  // Unknown format — return as-is rather than risk MM/DD mis-parse via new Date(string)
  return String(d);
}

function fmtStartTime(t) {
  if (!t && t !== 0) return '';
  // Decimal day-fraction from Sheets time cell (e.g. 0.029861 = 00:43, 0.919444 = 22:04)
  if (typeof t === 'number') {
    if (t > 0 && t < 1) {
      var totalMins = Math.round(t * 24 * 60);
      return pad(Math.floor(totalMins / 60)) + ':' + pad(totalMins % 60);
    }
    return ''; // other numbers not meaningful as time
  }
  // Already a clean HH:MM string?
  if (typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t)) return t;
  // ISO date string with the Sheets 1899 epoch placeholder
  if (typeof t === 'string' && t.indexOf('1899-12-30') !== -1) {
    var m = t.match(/T(\d{2}):(\d{2})/);
    if (m) return m[1] + ':' + m[2];
  }
  // Generic ISO string — extract HH:MM from time part
  if (typeof t === 'string' && t.indexOf('T') !== -1) {
    var m2 = t.match(/T(\d{2}):(\d{2})/);
    if (m2) return m2[1] + ':' + m2[2];
  }
  // Date object
  if (t instanceof Date && !isNaN(t)) {
    return pad(t.getHours()) + ':' + pad(t.getMinutes());
  }
  // Fallback
  return String(t);
}

function icdShortLabel(code) {
  if (!code) return '—';
  var c = String(code).trim();
  var dx = DIAGNOSES.find(function(d) { return String(d.code).trim() === c; });
  if (dx) return dx.label; // already "Description (code)" format
  return 'ICD-9 ' + c;    // fallback for custom/unknown codes
}

// Returns only the text description, no code suffix — e.g. "Heart Failure"
function icdDescOnly(code) {
  var full = icdShortLabel(code);
  return full.replace(/\s*\([^)]+\)\s*$/, '').trim() || full;
}

// Get short human label for a fee code
function getFeeLabel(fee) {
  // CCU pre-rollup tap (not a real MSC code)
  if (fee === 'CCU_DAILY') return 'CCU daily visit (band auto-assigned 1411/1421/1431)';
  // Look up canonical FEES first
  var f = FEES.find(function(x) { return x.code === fee; });
  if (f) return f.desc;
  // Fall back to legacy labels for historical claims that used invalid codes
  if (LEGACY_FEE_LABELS[fee]) return LEGACY_FEE_LABELS[fee];
  // Unknown — return the raw code so doctor can investigate
  return fee;
}

// Returns the $ amount for a fee code (e.g. '$186.14'), or empty string
function getFeeAmount(fee) {
  if (fee === 'CCU_DAILY') return '';  // band not yet assigned
  var f = FEES.find(function(x) { return x.code === fee; });
  return f ? (f.amount || '') : '';
}

function ptSummaryAddClaim(btn) {
  var pid = btn.getAttribute('data-pid2');
  var fn  = btn.getAttribute('data-fn2');
  hideModal('pt-summary-modal');
  if (fn === 'openClaimFromDischarged') openClaimFromDischarged(pid);
  else openClaimScreen(pid);
  // Set AFTER the open call (which clears the flag) so a successful submit
  // returns to this patient's calendar instead of the rounds list.
  _claimReturnSummaryPid = pid;
}

function ptSummaryEdit(btn) {
  var pid = btn.getAttribute('data-pid3');
  hideModal('pt-summary-modal');
  openPatientEdit(pid);
}

// ── Claim edit / delete ────────────────────────────────

// Find most recent referring MD and ICD from patient's prior claims.
// Used to pre-populate new claim entry (e.g. CCU daily inherits from earlier consult).
function inheritRefAndDxFromHistory(p) {
  var inherited = { refby: p.refby || '', refbyName: p.refbyName || '', icd: p.icd || '' };
  if (!p.phn) return inherited;
  // Walk claims in reverse chronological order
  var claims = st.claims.filter(function(c) { return samePhn(c.phn, p.phn); })
    .sort(function(a, b) {
      var da = parseDMYsafe(a.date), db = parseDMYsafe(b.date);
      return db - da;
    });
  for (var i = 0; i < claims.length; i++) {
    var c = claims[i];
    if (!inherited.refby && c.refby && !looksLikeMRPService(c.refbyName)) {
      inherited.refby = c.refby;
      inherited.refbyName = c.refbyName || '';
    }
    if (!inherited.icd && c.icd) {
      inherited.icd = String(c.icd).trim();
    }
    if (inherited.refby && inherited.icd) break;
  }
  return inherited;
}

function parseDMYsafe(s) {
  if (!s) return 0;
  var p = String(s).split('/');
  if (p.length !== 3) return 0;
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0])).getTime();
}

// ── Edit-claim fee-code picker ──────────────────────────
// A full search-as-you-type picker over the entire FEES catalogue, plus the
// CCU_DAILY placeholder. Unlike the Other-claim card it imposes NO category
// restrictions — consult, CCU and modifier codes are all selectable, because
// editing a claim must be able to reach any code the claim could legitimately
// carry. Replaces the old hard-coded 10-option <select>, which had no entry
// for unlisted fees (e.g. 00751) and so let the browser default the <select>
// to its first option (33010) — silently overwriting the real fee on save.
//
// Elements built into the Edit-claim modal by openClaimEdit():
//   ce-fee          hidden input — selected fee code (read by saveClaimEdit)
//   ce-fee-search   visible search input
//   ce-fee-dd       results dropdown
//   ce-fee-display  small confirmation line
var CE_FEE_EXTRA = [
  { code:'CCU_DAILY',
    desc:'CCU day (placeholder — export bands to 1411/1421/1431)',
    amount:'', cat:'CCU' }
];

// Whole searchable pool: every catalogued fee plus the CCU_DAILY placeholder.
function ceFeePool() { return FEES.concat(CE_FEE_EXTRA); }

// Resolve a stored fee code to display info. Falls back to LEGACY_FEE_LABELS,
// then to the bare code — so a claim's current code is ALWAYS shown and can
// never be dropped just because it is not in the active catalogue.
function ceFeeInfo(code) {
  var c = String(code || '').trim();
  if (!c) return null;
  var hit = ceFeePool().find(function(f) { return f.code === c; });
  if (hit) return { code:c, desc:hit.desc || '', amount:hit.amount || '', cat:hit.cat || '' };
  var legacy = (typeof LEGACY_FEE_LABELS !== 'undefined' && LEGACY_FEE_LABELS) ? LEGACY_FEE_LABELS[c] : '';
  return { code:c, desc:legacy || ('Fee code ' + c), amount:'', cat:'' };
}

// Build the picker markup, pre-filled with the claim's current fee.
function ceFeePickerHTML(currentCode) {
  var info = ceFeeInfo(currentCode);
  var searchVal = info ? (info.desc + ' (' + info.code + ')') : '';
  return '<input id="ce-fee" type="hidden" value="' + esc(currentCode || '') + '">' +
         '<input id="ce-fee-search" autocorrect="off" autocomplete="off" ' +
           'placeholder="Search fee code or description…" value="' + esc(searchVal) + '" ' +
           'oninput="ceFeeSearch(this.value)" onfocus="this.select();ceFeeSearch(\'\')">' +
         '<div class="ref-dd" id="ce-fee-dd"></div>' +
         '<div id="ce-fee-display" style="font-size:11px;color:var(--text2);margin-top:-4px;margin-bottom:6px"></div>';
}

var CE_FEE_CAT_COLORS = {
  'Consult':'var(--blue-t)',   'Daily':'var(--blue-t)',     'Directive':'var(--amber-t)',
  'Procedure':'var(--red-t)',  'Discharge':'var(--green-t)','CCU':'var(--red-t)',
  'Modifier':'var(--text3)',   'Other':'var(--teal-t)'
};

// Populate the dropdown. Empty query => the full list, no truncation.
function ceFeeSearch(query) {
  var dd = document.getElementById('ce-fee-dd');
  if (!dd) return;
  var q = (query || '').toLowerCase().trim();
  var pool = ceFeePool();
  var matches = q.length === 0
    ? pool.slice()
    : pool.filter(function(f) {
        return f.code.toLowerCase().indexOf(q) !== -1 ||
               (f.desc || '').toLowerCase().indexOf(q) !== -1;
      });
  if (!matches.length) {
    dd.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text2)">No matching fee codes</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = matches.map(function(f) {
    var col = CE_FEE_CAT_COLORS[f.cat] || 'var(--text2)';
    var amt = f.amount ? '<span style="font-size:11px;font-weight:700;color:var(--text2);margin-left:auto;padding-left:8px">' + esc(f.amount) + '</span>' : '';
    return '<div class="ref-dd-row" data-code="' + esc(f.code) + '" data-desc="' + esc(f.desc || '') + '" ' +
      'onclick="ceFeeSelect(this.getAttribute(\'data-code\'),this.getAttribute(\'data-desc\'))" ' +
      'style="display:flex;align-items:center;gap:4px">' +
      '<span style="font-weight:700;color:' + col + ';margin-right:6px;min-width:62px">' + esc(f.code) + '</span>' +
      '<span style="flex:1;min-width:0">' + esc(f.desc || '') + '</span>' +
      (f.cat ? '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + esc(f.cat) + '</span>' : '') +
      amt +
      '</div>';
  }).join('');
  dd.style.display = 'block';
}

// Commit a selection into the hidden input + search box.
function ceFeeSelect(code, desc) {
  var inp = document.getElementById('ce-fee');
  if (inp) inp.value = code;
  var search = document.getElementById('ce-fee-search');
  if (search) search.value = (desc ? desc + ' ' : '') + '(' + code + ')';
  var dd = document.getElementById('ce-fee-dd');
  if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
}

function openClaimEdit(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  var p   = getP(pid);
  if (!c) return;

  var feePicker = ceFeePickerHTML(c.fee);

  var curDx = DIAGNOSES.find(function(d) { return d.code === c.icd; });

  // Build doctor options for performing physician selector
  var docOptions = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (c.alias === d.alias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');

  // Convert DD/MM/YYYY to YYYY-MM-DD for the date input
  var cleanDate = fmtClaimDate(c.date || '');
  var dateISO = '';
  if (cleanDate && /^\d{2}\/\d{2}\/\d{4}$/.test(cleanDate)) {
    var dp = cleanDate.split('/');
    dateISO = dp[2] + '-' + dp[1] + '-' + dp[0];
  }
  var startTimeClean = fmtStartTime(c.startTime || '');

  var refLabel = c.refbyName ? c.refbyName + (c.refby ? ' #' + c.refby : '') : '';

  var html =
    '<div style="font-size:14px;font-weight:800;margin-bottom:12px">Edit claim — ' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<div class="card" style="padding:12px">' +
      '<div class="fl">' +
        '<div class="f1"><label>Date</label>' +
          '<input id="ce-date" type="date" value="' + esc(dateISO) + '"></div>' +
        '<div class="f1"><label>Start time</label>' +
          '<input id="ce-time" type="text" value="' + esc(startTimeClean) + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>' +
        '<div class="f1"><label>End time</label>' +
          '<input id="ce-end-time" type="text" value="' + esc(fmtStartTime(c.endTime || '')) + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>' +
      '</div>' +
      '<label style="margin-top:7px">Performing physician</label>' +
      '<select id="ce-alias" style="margin-bottom:7px">' + docOptions + '</select>' +
      '<label>Fee code</label>' + feePicker +
      '<label style="margin-top:10px">Referring MD</label>' +
      '<div style="position:relative">' +
      '<input id="ce-ref-search" value="' + esc(refLabel) + '" style="padding-right:32px" ' +
      'placeholder="Type name or doctor #..." autocorrect="off" autocomplete="off" ' +
      'data-dd="ce-ref-dd" data-hidden="ce-refby" data-name="ce-refby-name" ' +
      'oninput="refSearchEl(this)" onfocus="refSearchEl(this)">' +
      '<button type="button" tabindex="-1" onclick="clearSearchField(\'ce-ref-search\',\'ce-refby\',\'ce-refby-name\',\'ce-ref-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'ce-ref-search\',\'ce-refby\',\'ce-refby-name\',\'ce-ref-dd\')" ' +
      'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
      '</div>' +
      '<input id="ce-refby"      type="hidden" value="' + esc(c.refby || '') + '">' +
      '<input id="ce-refby-name" type="hidden" value="' + esc(c.refbyName || '') + '">' +
      '<div class="ref-dd" id="ce-ref-dd"></div>' +
      '<label style="margin-top:10px">Diagnosis</label>' +
      '<div style="position:relative">' +
      '<input id="ce-icd-search" value="' + esc(curDx ? curDx.label : (c.icd || '')) + '" style="padding-right:32px" ' +
      'placeholder="Type diagnosis or code..." autocorrect="off" autocomplete="off" ' +
      'data-dd="ce-icd-dd" data-hidden="ce-icd" oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
      '<button type="button" tabindex="-1" onclick="clearSearchField(\'ce-icd-search\',\'ce-icd\',null,\'ce-icd-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'ce-icd-search\',\'ce-icd\',null,\'ce-icd-dd\')" ' +
      'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
      '</div>' +
      '<input id="ce-icd" type="hidden" value="' + esc(c.icd || '') + '">' +
      '<div class="ref-dd" id="ce-icd-dd"></div>' +
      '<label style="margin-top:10px">Notes</label>' +
      '<input id="ce-notes" value="' + esc(c.notes || '') + '" placeholder="Optional notes…" autocorrect="off">' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn btn-p" style="margin:0;flex:1" data-cid="' + cid + '" data-pid="' + pid + '" onclick="saveClaimEdit(this)">Save</button>' +
      '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideClaimEditModal()">Cancel</button>' +
    '</div>';

  document.getElementById('claim-edit-content').innerHTML = html;
  showModal('claim-edit-modal');
}

function saveClaimEdit(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  var p   = getP(pid);
  if (!c) return;

  // Non-coercive: if the picker value is somehow blank, keep the claim's
  // existing fee rather than overwriting it (never silently drop a fee).
  var newFee   = ((document.getElementById('ce-fee') || {}).value || '').trim() || c.fee;
  var newIcd   = document.getElementById('ce-icd').value || c.icd;
  var newAlias = document.getElementById('ce-alias').value;
  var newDateISO = (document.getElementById('ce-date') || {}).value || '';
  var newTime    = (document.getElementById('ce-time')     || {}).value || '';
  var newEndTime = (document.getElementById('ce-end-time') || {}).value || '';
  var newNotes = (document.getElementById('ce-notes') || {}).value || '';
  var newRefby     = (document.getElementById('ce-refby')      || {}).value || '';
  var newRefName   = (document.getElementById('ce-refby-name') || {}).value || '';

  // Convert YYYY-MM-DD back to DD/MM/YYYY for storage
  var newDate = c.date;
  if (newDateISO && /^\d{4}-\d{2}-\d{2}$/.test(newDateISO)) {
    var dp = newDateISO.split('-');
    newDate = dp[2] + '/' + dp[1] + '/' + dp[0];
  }

  c.fee     = newFee;

  c.icd     = newIcd;
  c.date    = newDate;
  c.startTime = newTime;
  c.endTime   = newEndTime;
  c.notes   = newNotes;
  // Block writing service strings as referring MD
  if (newRefby && newRefName && !looksLikeMRPService(newRefName)) {
    c.refby     = newRefby;
    c.refbyName = newRefName;
  }
  if (newAlias) {
    var doc = st.doctors.find(function(d) { return d.alias === newAlias; });
    c.alias  = newAlias;
  }

  sv('claims', st.claims);
  if (SHEETS_URL) push('saveClaim', c);
  hideClaimEditModal();

  // Reopen summary to show updated claim
  openPatientSummary(pid);
  showToast('Claim updated');
}

function deleteClaimBtn(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  if (!c) return;

  if (!confirm('Delete ' + getFeeLabel(c.fee) + ' on ' + dispDate(c.date) + '?')) return;

  st.claims = st.claims.filter(function(x) { return String(x.id) !== String(cid); });
  sv('claims', st.claims);
  if (SHEETS_URL) push('deleteClaim', { id: cid });

  openPatientSummary(pid);
  showToast('Claim deleted');
}

function hideClaimEditModal() { hideModal('claim-edit-modal'); }

