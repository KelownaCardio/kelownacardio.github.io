// ── 07_consult.js ──
// ═══════════════════════════════════════════════════════
// 07_consult.js — Consult form (33010/33012), MOST toggle,
//                 start/end time, modifier detection, +15 button,
//                 live claim preview, submit
// ═══════════════════════════════════════════════════════

function buildConsultForm(p) {
  var now      = new Date();
  var todayISO = localISODate(now);
  var nowTime  = pad(now.getHours()) + ':' + pad(now.getMinutes());
  var endTime  = minsToTime(now.getHours() * 60 + now.getMinutes() + 50);

  var h = '<div class="card">';
  h += '<div class="card-title">Consult</div>';

  // 33010 / 33012 toggle
  h += '<div class="fl" style="margin-bottom:9px">' +
       '<button id="cb-33010" class="ct-btn ct-on-consult" style="flex:1" onclick="toggleConsultCode(\'33010\')">33010 — Full</button>' +
       '<button id="cb-33012" class="ct-btn" style="flex:1" onclick="toggleConsultCode(\'33012\')">33012 — Limited</button>' +
       '</div>';

  // MOST button
  h += '<button class="most-btn on" id="cb-most" onclick="toggleMost()">' +
       '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
       '+ MOST (78720)</button>';

  // Date + Start time (pre-filled with now)
  h += '<div class="fl">' +
       '<div class="f1"><label>Date</label>' +
       '<input type="date" id="cb-date" value="' + todayISO + '" oninput="updateConsultUI()"></div>' +
       '<div class="f1"><label>Start time</label>' +
       '<input type="text" id="cb-start" value="' + nowTime + '" placeholder="14:30 or 2:30pm" oninput="updateConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateConsultUI();}"></div>' +
       '</div>';

  // End time — defaults to start+45, doctor adjusts if shorter
  h += '<div class="fl" style="margin-bottom:9px">' +
       '<div class="f1"><label>End time' +
       '<span style="font-size:10px;color:var(--text3)"> — adjust if &lt; 45 min</span></label>' +
       '<input type="text" id="cb-end" value="' + endTime + '" placeholder="14:30 or 2:30pm" oninput="updateConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateConsultUI();}"></div>' +
       '</div>';

  // Modifier display area
  h += '<div id="cb-mod"></div>';
  h += '</div>';

  // ICD-9 and referring MD
  h += buildIcdRefCard(p);

  // Live claim preview
  h += '<div class="cp" id="cb-preview"><div class="cp-title">Claims preview</div></div>';

  // Optional notes
  h += '<label style="margin-top:9px">Notes <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></label>';
  h += '<textarea id="cb-notes" rows="2" placeholder="Add any claim notes..." autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:9px"></textarea>';

  // Submit button
  h += '<button class="btn btn-p" onclick="claimSubmitOnce(submitConsult)">Add consult claims</button>';
  return h;
}

function toggleConsultCode(code) {
  document.getElementById('cb-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  document.getElementById('cb-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
  updateConsultUI();
}

function toggleMost() {
  _mostOn = !_mostOn;
  document.getElementById('cb-most').className = 'most-btn' + (_mostOn ? ' on' : '');
  updateConsultUI();
}

function updateConsultUI() {
  var start   = gv('cb-start');
  var end     = gv('cb-end');
  var dateISO = gv('cb-date');

  // Track which field triggered this update so the end time follows the start time
  // unless the doctor has manually edited the end. Start input always pulls end +45 min.
  var endEl = document.getElementById('cb-end');
  var changed = (typeof event !== 'undefined' && event && event.target) ? event.target.id : '';
  if (start && (changed === 'cb-start' || !end)) {
    if (endEl) endEl.value = minsToTime(t2m(start) + 50);
    end = gv('cb-end');
  }

  var modBase = getModifier(start, dateISO);
  var hasInc  = consultHasIncrement(start, end);
  var modInc  = hasInc ? getModifierForIncrement(start, dateISO) : null;

  // Modifier banner
  var incUnits = consultIncUnits(start, end);
  var modEl = document.getElementById('cb-mod');
  if (modEl) {
    if (modBase) {
      // Line 1: base modifier from start time
      var banner = '<div class="mod-box ' + modBase.cls + '" style="margin-bottom:0;border-radius:var(--rsm) var(--rsm) 0 0">' +
        '<span style="font-weight:700">' + modBase.label + '</span>' +
        '<span style="font-size:10px;opacity:.75;margin-left:6px">' + modBase.base + ' ×1</span>' +
        '</div>';
      // Line 2: increment based on duration
      if (incUnits > 0) {
        var incMod = modInc || modBase;
        banner += '<div class="mod-box ' + incMod.cls + '" style="margin-top:1px;border-radius:0 0 var(--rsm) var(--rsm);opacity:.85">' +
          '<span>Consult time &gt; 45 min</span>' +
          '<span style="font-size:10px;font-weight:700;margin-left:6px">' + incMod.inc + ' ×' + incUnits + '</span>' +
          '</div>';
      } else {
        banner += '<div style="font-size:11px;padding:5px 10px;color:var(--text3);' +
          'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
          'background:var(--surface2)">' +
          'Consult ≤ 45 min — no increment</div>';
      }
      modEl.innerHTML = banner;
    } else if (start) {
      modEl.innerHTML = '<div class="mod-box mod-day">✓ Daytime weekday — no call-out modifier</div>';
    } else {
      modEl.innerHTML = '';
    }
  }

  updateConsultPreview(modBase, modInc);
}

function updateConsultPreview(modBase, modInc) {
  var p    = getP(_claimPid);
  var code = document.getElementById('cb-33010') &&
             document.getElementById('cb-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
  var icd  = getClaimIcd(p);
  var rows = [{ code:code, desc:'Cardiology consultation', u:1 }];
  if (_mostOn) rows.push({ code:'78720', desc:'MOST — advance care planning', u:1 });
  var incUnits2 = consultIncUnits(gv('cb-start'), gv('cb-end'));
  if (modBase) {
    rows.push({ code:modBase.base, desc:modBase.label + ' — base (30 min)', u:1 });
    if (incUnits2 > 0) {
      var incMod2 = modInc || modBase;
      rows.push({ code:incMod2.inc, desc:'Consult time > 45 min', u:incUnits2 });
    }
  }
  var prev = document.getElementById('cb-preview');
  if (prev) {
    prev.innerHTML =
      '<div class="cp-title">Claims to add (ICD-9 ' + icd + ')</div>' +
      rows.map(function(r) {
        return '<div class="cp-row">' +
               '<span class="cp-code">' + r.code + '</span>' +
               '<span class="cp-desc">' + r.desc + '</span>' +
               '<span class="cp-units">×' + r.u + '</span>' +
               '</div>';
      }).join('');
  }
}

// Submit guard — prevents double/triple tap on mobile from firing twice
var _submitGuard = false;
function claimSubmitOnce(fn) {
  if (_submitGuard) return;
  _submitGuard = true;
  setTimeout(function() { _submitGuard = false; }, 1500);
  fn();
}

function submitConsult() {
  var p = getP(_claimPid);
  if (!checkDoc()) return;

  var alias   = getPerformingAlias();
  var code    = document.getElementById('cb-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
  var dateISO = gv('cb-date');
  var start   = gv('cb-start');
  var end     = gv('cb-end');
  if (!dateISO) { showToast('Enter date'); return; }
  if (!start)   { showToast('Start time required for ' + code); return; }
  if (!end)     { showToast('End time required for ' + code); return; }

  var dateFmt = fmtD(parseISODate(dateISO));
  var loc     = p.ward === 'ED' ? 'E' : 'I';

  // Save any ICD-9/referrer changes back to patient record
  updatePatientFromClaimForm(p);
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }

  // CCFPP — detect + retroactively update overlapping peer claims
  var ccfppNote = ccfppDetectAndUpdate(p, alias, dateISO, dateFmt, start, end);

  // Combine user-entered notes with CCFPP auto-note (if any)
  var userNote = (gv('cb-notes') || '').trim();
  var fullNote = [userNote, ccfppNote].filter(function(s) { return s; }).join(' | ');

  // Base consult — combined note on consult itself
  addClaim(p, code, code, 1, dateFmt, loc, start, fullNote, gv('cb-end'), alias);

  // MOST — standalone item, no CCFPP
  if (_mostOn) addClaim(p, '78720', '78720', 1, dateFmt, loc, null, null, null, alias);

  var modBase  = getModifier(start, dateISO);
  var incUnits = consultIncUnits(start, end);
  var hasInc   = incUnits > 0;
  var modInc   = hasInc ? getModifierForIncrement(start, dateISO) : null;

  if (modBase) {
    // Base modifier — first 30 min from consult start
    var modBaseEnd = minsToTime((t2m(start) + 30) % (24 * 60));
    addClaim(p, modBase.base, modBase.base, 1, dateFmt, loc, start, fullNote, modBaseEnd, alias);

    if (modInc) {
      // Increment modifier — start+30 to consult end
      var incStart = minsToTime((t2m(start) + 30) % (24 * 60));
      addClaim(p, modInc.inc, modInc.inc, incUnits, dateFmt, loc, incStart, fullNote, end, alias);
    }
  }
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('Consult claims added for ' + p.last);
  closeClaimScreen();
}

