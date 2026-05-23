// ── 13_meditech.js ──
// ═══════════════════════════════════════════════════════
// 13_meditech.js — Meditech rounds list bulk photo import
// ═══════════════════════════════════════════════════════

// Decode Meditech location code + room-bed string into ward and room
function parseLocCode(locCode, roomBed) {
  var ward = 'OTHER';
  var room = '';
  var loc  = (locCode || '').toUpperCase();

  // CCU: KELKGHSCCU — must check before S2W/S2S since it contains neither
  if      (loc.indexOf('SCCU') !== -1 || loc.indexOf('CCU') !== -1)  ward = 'CCU';
  else if (loc.indexOf('S2W')  !== -1)                               ward = '2W';
  else if (loc.indexOf('S2S')  !== -1)                               ward = '2S';
  else if (loc.indexOf('CSICU')!== -1)                               ward = 'CSICU';
  else if (loc.indexOf('ICUA') !== -1)                               ward = 'ICUA';
  else if (loc.indexOf('ICUB') !== -1)                               ward = 'ICUB';
  else if (loc.indexOf('ED')   !== -1 || loc.indexOf('EMERG') !== -1) ward = 'ED';

  // Parse room number
  // CCU:  KGHS2502-A → bed = parseInt("2502") % 100 = 2
  // Ward: KGHS0201-A → strip leading zeros → "201A"
  var rb = (roomBed || '').replace(/-/g, '').toUpperCase().replace(/^KGHS/, '');
  if (ward === 'CCU') {
    var num = parseInt(rb, 10);
    if (!isNaN(num)) room = String(num % 100);
  } else {
    var m = rb.match(/^0*(\d+)([A-Z]?)$/);
    if (m) room = m[1] + m[2];
  }

  return { ward:ward, room:room };
}

// ── Cardiology / Cardiac Surgery matcher constants ────
// Cardiologists = app users + generic group MRP. Surnames must include
// trailing comma to match Meditech "LastName,FirstName" pattern.
var CARDIOLOGIST_SURNAMES = [
  'halperin,', 'patton,', 'brown,',   'todd,',    'webber,',
  'hoskin,',   'sodhi,',  'khosla,',  'massie,',  'baker,'
];
// Cardiac surgeons — confirmed by Kathryn 2026-05-13.
var CARDIAC_SURGEON_SURNAMES = [
  'schulze,', 'soon,', 'wan,', 'goubran,', 'poostizadeh,'
];

function _attHasAny(att, surnames) {
  for (var i = 0; i < surnames.length; i++) {
    if (att.indexOf(surnames[i]) !== -1) return true;
  }
  return false;
}

function isCardiologistAttending(attending) {
  var att = (attending || '').toLowerCase();
  // Generic group MRP — written as "CardiologyMRP" or just "Cardiology"
  if (att.indexOf('cardiologymrp') !== -1) return true;
  // Plain "cardiology" alone (not "cardiac surgery" or "cardiac surg")
  if (att.indexOf('cardiology') !== -1 && att.indexOf('cardiac surg') === -1) return true;
  return _attHasAny(att, CARDIOLOGIST_SURNAMES);
}

function isCardiacSurgeonAttending(attending) {
  var att = (attending || '').toLowerCase();
  if (att.indexOf('cardiac surg') !== -1) return true;
  return _attHasAny(att, CARDIAC_SURGEON_SURNAMES);
}

// Infer On/Off service and care type from ward and attending provider string
function inferMRP(attending) {
  var att = (attending || '').toLowerCase();
  if (isCardiologistAttending(attending))
    return 'Cardiology';
  if (att.indexOf('hospitalist') !== -1 || att.indexOf('internal med') !== -1)
    return 'Hospitalist';
  if (att.indexOf('ctu') !== -1 || att.indexOf('clinical teach') !== -1)
    return 'CTU';
  if (isCardiacSurgeonAttending(attending) || att.indexOf('csicu') !== -1)
    return 'Cardiac Surgery';
  if (att.indexOf('icu') !== -1 || att.indexOf('critical care') !== -1)
    return 'ICU';
  return '';
}

function inferCare(ward, attending) {
  var isCardioMRP = isCardiologistAttending(attending);

  if (isCardioMRP && (ward === '2S' || ward === '2W' || ward === 'CCU' || ward === 'CSICU' || ward === 'ICUA' || ward === 'ICUB')) {
    return { list:'on', care: (ward === 'CCU' || ward === 'CSICU' || ward === 'ICUA' || ward === 'ICUB') ? 'ccu' : 'daily', role:'mrp' };
  }
  var w = WARDS[ward] || {};
  return { list: w.list || 'off', care: w.care || 'directive', role:'consultant' };
}

// ── Photo handler ──────────────────────────────────────
function handleMediteachPhoto(inp) {
  var file = inp.files[0]; if (!file) return;
  inp.value = '';
  var reader = new FileReader();
  reader.onload = function(e) {
    openCropModal(e.target.result, 'meditech', function(croppedDataUrl) {
      var status = document.getElementById('mit-status');
      status.style.display  = 'block';
      status.className      = 'ocr-bar ocr-ok';
      status.textContent    = 'Reading Meditech list…';
      document.getElementById('mit-rows').innerHTML    = '';
      document.getElementById('mit-sum').style.display = 'none';
      document.getElementById('mit-actions').style.display = 'none';
      showModal('mit-modal');
      extractMediteachAI(croppedDataUrl);
    }, function() { /* cancelled — do nothing */ });
  };
  reader.readAsDataURL(file);
}

async function extractMediteachAI(dataUrl) {
  var status = document.getElementById('mit-status');
  try {
    var b64 = dataUrl.split(',')[1];
    var mt  = dataUrl.split(';')[0].split(':')[1];
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role:'user', content: [
          { type:'image', source:{ type:'base64', media_type:mt, data:b64 } },
          { type:'text', text:
            'Meditech rounds list from Kelowna General Hospital (KGH). Extract EVERY patient row visible.\n\n' +
            'Return a JSON array. Each object must have exactly these fields:\n' +
            '  last, first, sex, age, locationCode, roomBed, reason, attending, los\n\n' +
            'locationCode = top line of first column e.g. "KELKGHSCCU", "KELKGHS2W", "KELKGHS2S", "KELKGHS3E"\n' +
            'roomBed      = second line of first column e.g. "KGHS2502-A", "KGHS0201-A", "KGHS0225-B"\n' +
            'first        = use preferred name in brackets if shown e.g. "(Steve)" → "Steve"\n' +
            'reason       = full text, do not truncate\n\n' +
            'KGH reference:\n' +
            '  CCU  = KELKGHSCCU, rooms KGHS2502-A (2502 = Bed 2, 2506 = Bed 6 etc.)\n' +
            '  2W   = KELKGHS2W,  rooms KGHS0201-A to KGHS0213-A\n' +
            '  2S   = KELKGHS2S,  rooms KGHS0217-A to KGHS0234-B (225 and 226 have A and B)\n' +
            '  Other location codes = off-service ward\n\n' +
            'Return ONLY a JSON array, no markdown, no explanation.'
          }
        ]}]
      })
    });
    var data = await resp.json();
    var text = data.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    var parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed)) parsed = [parsed];
    renderMediteachPreview(parsed);
  } catch(e) {
    status.className  = 'ocr-bar ocr-warn';
    status.textContent = 'Could not read list — try a clearer photo, or add patients manually.';
  }
}

function renderMediteachPreview(patients) {
  var status = document.getElementById('mit-status');

  _mitPats = patients.map(function(p, i) {
    var loc  = parseLocCode(p.locationCode, p.roomBed);
    var care = inferCare(loc.ward, p.attending);
    var icd  = diagToIcd(p.reason);
    // v3.38: instead of a boolean "existing", collect ALL local patients
    // that match this Meditech entry by name. If there's exactly 1 match,
    // standard "already on list" behaviour. If >1, this is a duplicate in
    // the local DB (typo) — surface for cleanup. If 0, it's a new import.
    var matches = st.patients.filter(function(ep) {
      return String(ep.last || '').toLowerCase() === String(p.last || '').toLowerCase() &&
             String(ep.first || '').toLowerCase().split(' ')[0] === String(p.first || '').toLowerCase().split(' ')[0];
    });
    var existing = matches.length > 0;
    // MRP field rules:
    //   Cardiology MRP (role=mrp) → always 'Cardiology'
    //   Consulting (role=consultant) → recognised service ('Hospitalist',
    //     'CTU', etc.) if matched, else fall back to 'Other' so the value
    //     matches the Add/Edit MRP dropdown options.
    var _mrp;
    if (care.role === 'mrp') _mrp = 'Cardiology';
    else                      _mrp = inferMRP(p.attending) || 'Other';
    return Object.assign({}, p, {
      _idx: i, _ward: loc.ward, _room: loc.room,
      _list: care.list, _care: care.care, _role: care.role,
      _icd: icd, _mrp: _mrp, _include: !existing, _existing: existing,
      _matches: matches,  // v3.38: full match list for conflict detection
      _mrpTransition: null,
      _existingPid: null,
      _existingMrp: ''
    });
  });

  // v3.66: MRP transition detection — compares the existing local patient's
  // stored MRP/role against the role inferred from the Meditech attending.
  // Only fires when there is exactly one local match so we don't conflict
  // with the duplicate-detection banner. Two outcomes flagged:
  //   - left-cardiology   : was on Cardiology service, attending now non-Cardiology
  //                          (e.g. moved to CSICU, became Hospitalist primary).
  //                          Auto-UNCHECKED — doctor must explicitly confirm.
  //   - joined-cardiology : was off-service / different MRP, attending now
  //                          a cardiologist. Auto-checked (pulling onto our
  //                          service is the normal expected action).
  _mitPats.forEach(function(p) {
    if (!p._matches || p._matches.length !== 1) return;
    var ep = p._matches[0];
    p._existingPid = ep.id;
    p._existingMrp = String(ep.mrp || '').trim();
    if (!p._existingMrp) return;            // no prior MRP recorded → nothing to compare
    var wasCardiology = (ep.role === 'mrp') && /cardiology/i.test(p._existingMrp);
    var isCardiology  = (p._role === 'mrp');
    if (wasCardiology && !isCardiology)      p._mrpTransition = 'left-cardiology';
    else if (!wasCardiology && isCardiology) p._mrpTransition = 'joined-cardiology';
    // Override default _include for transitions. Existing matches normally
    // default to _include=false (skipped); we want left-cardiology to stay
    // unchecked (explicit confirm) and joined-cardiology to be auto-checked.
    if (p._mrpTransition === 'joined-cardiology') p._include = true;
    if (p._mrpTransition === 'left-cardiology')   p._include = false;
  });

  // v3.38: Detect demographic conflicts surfaced by the Meditech list.
  // Meditech is authoritative for name + age + ward. Any of these is a
  // cleanup signal:
  //   - Multiple local patients match one Meditech entry → typo duplicates
  //     in our DB (e.g. Cull at two PHNs differing by one digit)
  //   - Local patient has DOB that disagrees with Meditech's age (off by
  //     more than 1 year — allows for birthday slippage)
  //   - Local patient is on a different ward than Meditech (informational,
  //     usually means transfer, but worth showing)
  var _mitConflicts = [];
  _mitPats.forEach(function(p) {
    if (p._matches && p._matches.length > 1) {
      _mitConflicts.push({
        kind: 'duplicate',
        meditech: p,
        locals: p._matches
      });
    }
    if (p._matches && p._matches.length === 1 && p.age) {
      var ep = p._matches[0];
      if (ep.dob) {
        // Parse DOB DD/MM/YYYY → age now
        var parts = String(ep.dob).split('/');
        if (parts.length === 3) {
          var yr = parseInt(parts[2], 10);
          var now = new Date();
          var ageFromDob = now.getFullYear() - yr;
          var mitAge = parseInt(p.age, 10);
          if (!isNaN(ageFromDob) && !isNaN(mitAge) && Math.abs(ageFromDob - mitAge) > 1) {
            _mitConflicts.push({
              kind: 'age_mismatch',
              meditech: p,
              local: ep,
              meditechAge: mitAge,
              localAge: ageFromDob
            });
          }
        }
      }
    }
  });
  window._mitConflicts = _mitConflicts;  // for console inspection

  var onCnt    = _mitPats.filter(function(p) { return p._list === 'on'  && p._include; }).length;
  var offCnt   = _mitPats.filter(function(p) { return p._list === 'off' && p._include; }).length;
  var exCnt    = _mitPats.filter(function(p) { return p._existing; }).length;
  var leftCnt  = _mitPats.filter(function(p) { return p._mrpTransition === 'left-cardiology'; }).length;
  var joinCnt  = _mitPats.filter(function(p) { return p._mrpTransition === 'joined-cardiology'; }).length;

  // ── Discharge candidates ───────────────────────────────
  // For each currently active on-service patient, check whether they:
  //   (a) are missing from the imported Meditech list, OR
  //   (b) appear in the imported list but with a cardiac surgeon as attending
  // Pre-checked; user can uncheck any false positive (e.g. OCR missed a row).
  // Name match: case-insensitive last + first-token, same rule as _existing.
  function nameKey(last, first) {
    return String(last  || '').toLowerCase().trim() + '|' +
           String(first || '').toLowerCase().trim().split(' ')[0];
  }
  var importedByKey = {};
  _mitPats.forEach(function(p) { importedByKey[nameKey(p.last, p.first)] = p; });

  _mitDisch = st.patients.filter(function(p) {
    return !p.discharged && p.list === 'on';
  }).map(function(p, i) {
    var match = importedByKey[nameKey(p.last, p.first)];
    var reason = null;
    if (!match) {
      reason = 'No longer on Meditech Import List';
    } else if (isCardiacSurgeonAttending(match.attending)) {
      reason = '→ Cardiac Surgery (' + (match.attending || '').trim() + ')';
    }
    if (!reason) return null;
    return {
      _idx: i, pid: p.id, last: p.last, first: p.first,
      ward: p.ward, bed: p.bed || '', reason: reason, _include: true
    };
  }).filter(function(x) { return x !== null; });

  status.textContent = 'Found ' + _mitPats.length + ' patients — ' + onCnt + ' on service, ' + offCnt + ' off service.';

  var sumEl = document.getElementById('mit-sum');
  sumEl.style.display = 'block';
  sumEl.innerHTML = '<div class="imp-sum">' +
    _mitPats.length + ' patients &bull; ' + onCnt + ' on service &bull; ' + offCnt + ' off service' +
    (exCnt ? ' &bull; ' + exCnt + ' already on list (skipped)' : '') +
    (leftCnt ? ' &bull; <span style="color:var(--red-t)">⚠ ' + leftCnt + ' MRP review</span>' : '') +
    (joinCnt ? ' &bull; ' + joinCnt + ' joining Cardiology' : '') +
    (_mitDisch.length ? ' &bull; ' + _mitDisch.length + ' to remove' : '') +
    '</div>';

  // Discharge section (above the import rows) — only rendered if any candidates
  var dischHtml = '';
  if (_mitDisch.length) {
    dischHtml =
      '<div class="sec-lbl" style="color:var(--red-t);margin-top:4px">' +
        'Remove from on-service list (' + _mitDisch.length + ')' +
      '</div>' +
      '<div style="font-size:10px;color:var(--text2);margin-bottom:6px;line-height:1.4">' +
        'Pre-checked. Uncheck any patient who should stay on the list ' +
        '(e.g. OCR missed their row on a long list).' +
      '</div>' +
      _mitDisch.map(function(d) {
        return '<div class="imp-row" id="imp-disch-row-' + d._idx + '" style="border-color:#eab8b3;background:var(--red-bg)">' +
          '<div class="imp-chk on" id="imp-disch-chk-' + d._idx + '" ' +
            'style="background:var(--red);border-color:var(--red)" ' +
            'onclick="toggleImpDisch(' + d._idx + ')">' +
            '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</div>' +
          '<div class="imp-info">' +
            '<div class="imp-name">' + esc(d.last) + ', ' + esc(d.first) + '</div>' +
            '<div class="imp-meta">' + wardLabel(d.ward) + (d.bed ? ' Rm ' + esc(d.bed) : '') + '</div>' +
            '<div class="imp-meta" style="color:var(--red-t);font-weight:600">' + esc(d.reason) + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '<div style="height:10px"></div>' +
      (_mitPats.length
        ? '<div class="sec-lbl" style="margin-top:4px">Add from Meditech (' + _mitPats.filter(function(p){return !p._existing;}).length + ' new)</div>'
        : '');
  }

  // v3.38: Build conflicts banner — shown at the top of the modal before
  // the discharge and import sections.
  var conflictHtml = '';
  if (_mitConflicts.length) {
    conflictHtml =
      '<div class="sec-lbl" style="color:var(--red-t);margin-bottom:6px">⚠ Demographic conflicts (' + _mitConflicts.length + ')</div>' +
      _mitConflicts.map(function(cf) {
        if (cf.kind === 'duplicate') {
          var phns = cf.locals.map(function(l) { return String(l.phn || '?'); });
          return '<div class="imp-row" style="background:var(--red-bg);border:1px solid var(--red-t)">' +
            '<div class="imp-info">' +
              '<div class="imp-name" style="color:var(--red-t)">' +
                'Duplicate in DB: ' + esc(cf.meditech.last) + ', ' + esc(cf.meditech.first) +
              '</div>' +
              '<div class="imp-meta">Meditech shows one patient; local DB has ' + cf.locals.length + ':</div>' +
              cf.locals.map(function(l) {
                return '<div class="imp-meta" style="color:var(--text);margin-top:2px">' +
                       '· PHN <code>' + esc(l.phn || '(blank)') + '</code>' +
                       (l.dob ? ' · DOB ' + esc(l.dob) : '') +
                       (l.ward ? ' · ' + esc(l.ward) : '') +
                       ' · ' + (l.discharged ? 'discharged' : 'active') +
                       '</div>';
              }).join('') +
              '<div class="imp-meta" style="color:var(--red-t);font-weight:600;margin-top:4px">' +
                'Action: keep one, discharge the other(s) and reassign their claims.' +
              '</div>' +
            '</div>' +
          '</div>';
        } else if (cf.kind === 'age_mismatch') {
          return '<div class="imp-row" style="background:var(--amber-bg);border:1px solid var(--amber-t)">' +
            '<div class="imp-info">' +
              '<div class="imp-name" style="color:var(--amber-t)">' +
                'Age mismatch: ' + esc(cf.meditech.last) + ', ' + esc(cf.meditech.first) +
              '</div>' +
              '<div class="imp-meta">Meditech says age ' + cf.meditechAge +
                ', local DOB ' + esc(cf.local.dob) + ' implies age ' + cf.localAge + '.</div>' +
              '<div class="imp-meta" style="color:var(--amber-t);font-weight:600;margin-top:4px">' +
                'Action: verify DOB on the patient sticker and edit if wrong.' +
              '</div>' +
            '</div>' +
          '</div>';
        }
        return '';
      }).join('') +
      '<div style="height:10px"></div>';
  }

  // v3.66: row renderer extracted so transition rows can be rendered in
  // their own sections (above the rest of the import list) while preserving
  // the original _idx → _mitPats[idx] invariant that toggleImpRow relies on.
  function renderImpRow(p) {
    var rowCls   = 'imp-row';
    var rowStyle = '';
    var nameTag  = '';
    var transChip = '';
    if (p._mrpTransition === 'left-cardiology') {
      rowStyle  = ' style="border-color:#eab8b3;background:var(--red-bg)"';
      nameTag   = ' <span style="color:var(--red-t);font-size:10px;font-weight:700">⚠ MRP changed</span>';
      transChip = '<span class="chip chip-red">⚠ MRP: ' + esc(p._existingMrp || '?') + ' → ' + esc(p._mrp || 'Other') + '</span>';
    } else if (p._mrpTransition === 'joined-cardiology') {
      rowStyle  = ' style="border-color:#d4a84a;background:var(--amber-bg)"';
      nameTag   = ' <span style="color:var(--amber-t);font-size:10px;font-weight:700">joining Cardiology</span>';
      transChip = '<span class="chip chip-amber">→ Cardiology (was ' + esc(p._existingMrp || '?') + ')</span>';
    } else if (p._existing) {
      rowCls += ' existing';
      nameTag = ' <span style="color:var(--green-t);font-size:10px;font-weight:700">already on list</span>';
    }
    return '<div class="' + rowCls + '" id="imp-row-' + p._idx + '"' + rowStyle + '>' +
      '<div class="imp-chk' + (p._include ? ' on' : '') + '" id="imp-chk-' + p._idx + '" onclick="toggleImpRow(' + p._idx + ')">' +
        (p._include ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
      '</div>' +
      '<div class="imp-info">' +
        '<div class="imp-name">' + esc(p.last) + ', ' + esc(p.first) + nameTag + '</div>' +
        '<div class="imp-meta">' + esc(p.attending || '') + (p._room ? ' Rm ' + p._room : '') +
          ' &bull; Age ' + (p.age || '?') + ' ' + (p.sex || '') + ' &bull; ' + esc(p.los || '') + '</div>' +
        '<div class="imp-meta" style="color:var(--text)">Dx: ' + esc(p.reason || '') + '</div>' +
        '<div class="imp-badges">' +
          '<span class="chip ' + (p._list === 'on' ? 'chip-blue' : 'chip-amber') + '">' +
            (p._list === 'on' ? 'On: ' + wardLabel(p._ward) : 'Off: ' + wardLabel(p._ward)) +
          '</span>' +
          transChip +
        '</div>' +
      '</div>' +
      '</div>';
  }

  // MRP transitions appear in their own sections above the rest so the
  // doctor sees them before scrolling. left-cardiology rows are flagged
  // most prominently because they affect which service bills the patient.
  var transLeft   = _mitPats.filter(function(p) { return p._mrpTransition === 'left-cardiology'; });
  var transJoined = _mitPats.filter(function(p) { return p._mrpTransition === 'joined-cardiology'; });
  var restRows    = _mitPats.filter(function(p) { return !p._mrpTransition; });

  var mrpHtml = '';
  if (transLeft.length) {
    mrpHtml +=
      '<div class="sec-lbl" style="color:var(--red-t);margin-top:4px">' +
        '⚠ MRP changed — review before committing (' + transLeft.length + ')' +
      '</div>' +
      '<div style="font-size:10px;color:var(--text2);margin-bottom:6px;line-height:1.4">' +
        'Auto-unchecked. Check the row to confirm the patient has moved off ' +
        'Cardiology service — list/role/care will switch to off-service consultant.' +
      '</div>' +
      transLeft.map(renderImpRow).join('');
  }
  if (transJoined.length) {
    mrpHtml +=
      '<div class="sec-lbl" style="color:var(--amber-t);margin-top:4px">' +
        'MRP changed TO Cardiology (' + transJoined.length + ')' +
      '</div>' +
      transJoined.map(renderImpRow).join('');
  }

  document.getElementById('mit-rows').innerHTML =
    conflictHtml + dischHtml + mrpHtml + restRows.map(renderImpRow).join('');

  document.getElementById('mit-actions').style.display = 'block';
}

function toggleImpRow(idx) {
  var p   = _mitPats[idx];
  p._include = !p._include;
  var chk = document.getElementById('imp-chk-' + idx);
  var row = document.getElementById('imp-row-' + idx);
  chk.classList.toggle('on', p._include);
  chk.innerHTML = p._include ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '';
  row.classList.toggle('excluded', !p._include);
}

function toggleImpDisch(idx) {
  var d = _mitDisch[idx];
  d._include = !d._include;
  var chk = document.getElementById('imp-disch-chk-' + idx);
  var row = document.getElementById('imp-disch-row-' + idx);
  if (d._include) {
    chk.classList.add('on');
    chk.style.background    = 'var(--red)';
    chk.style.borderColor   = 'var(--red)';
    chk.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
    row.classList.remove('excluded');
  } else {
    chk.classList.remove('on');
    chk.style.background  = 'var(--surface)';
    chk.style.borderColor = 'var(--border2)';
    chk.innerHTML = '';
    row.classList.add('excluded');
  }
}

function confirmMediteachImport() {
  if (!checkDoc()) return;

  // ── Discharges first (so re-imports of same names don't re-add them) ──
  var toDisch = _mitDisch.filter(function(d) { return d._include; });
  toDisch.forEach(function(d) {
    var p = st.patients.find(function(pp) { return pp.id === d.pid; });
    if (!p) return;
    p.dischargeDate = TODAY;                                // DD/MM/YYYY display
    p.dischargedAt  = Date.now();                           // epoch ms — drives "recently discharged" sort
    p.discharged    = true;
    p.dischargeNote = d.reason;                             // non-billing Sheets note
    if (SHEETS_URL) push('savePatient', p);
    logChange(p, 'Discharged via Meditech import', d.reason);
  });

  // ── MRP transitions ───────────────────────────────────
  // v3.66: existing matches that have an MRP transition flagged AND have
  // been confirmed (left-cardiology auto-unchecked, joined-cardiology
  // auto-checked, both user-overridable). Mutates the existing patient
  // in place — does NOT create a new record.
  var toTransition = _mitPats.filter(function(p) {
    return p._include && p._existing && p._mrpTransition && p._existingPid;
  });
  toTransition.forEach(function(p) {
    var ep = st.patients.find(function(pp) { return pp.id === p._existingPid; });
    if (!ep) return;
    var prev = ep.mrp + '/' + ep.list + '/' + ep.role + '/' + ep.care;
    // Always refresh ward/bed from the Meditech list — that's the freshest
    // location signal regardless of transition direction.
    ep.ward = p._ward;
    ep.bed  = p._room;
    if (p._mrpTransition === 'left-cardiology') {
      ep.mrp  = p._mrp || 'Other';
      ep.list = 'off';
      ep.role = 'consultant';
      ep.care = 'directive';
    } else if (p._mrpTransition === 'joined-cardiology') {
      ep.mrp  = 'Cardiology';
      ep.list = 'on';
      ep.role = 'mrp';
      ep.care = (ep.ward === 'CCU' || ep.ward === 'CSICU' || ep.ward === 'ICUA' || ep.ward === 'ICUB')
                ? 'ccu' : 'daily';
    }
    if (SHEETS_URL) push('savePatient', ep);
    logChange(ep, 'MRP transition via Meditech import',
              prev + ' → ' + ep.mrp + '/' + ep.list + '/' + ep.role + '/' + ep.care);
  });

  // ── Imports ───────────────────────────────────────────
  var toImport = _mitPats.filter(function(p) { return p._include && !p._existing; });
  toImport.forEach(function(p) {
    var newPt = {
      id:          'p' + Date.now() + Math.floor(Math.random() * 9999),
      last:        p.last,
      first:       p.first,
      phn:         '',
      dob:         '',
      sex:         p.sex || '',
      ward:        p._ward,
      bed:         p._room,
      fac:         'OA040',
      refby:       '',
      refbyName:   '',
      care:        p._care,
      list:        p._list,
      role:        p._role || 'consultant',
      icd:         p._icd,
      roundedToday:null,
      mrp:         p._mrp || 'Other'
    };
    st.patients.push(newPt);
    if (SHEETS_URL) push('savePatient', newPt);
    logChange(newPt, 'Imported from Meditech', p._ward + (p._room ? ' Rm ' + p._room : ''));
  });
  sv('patients', st.patients);
  hideModal('mit-modal');
  render();

  var msg = [];
  if (toImport.length)     msg.push(toImport.length     + ' imported');
  if (toTransition.length) msg.push(toTransition.length + ' MRP changed');
  if (toDisch.length)      msg.push(toDisch.length      + ' discharged');
  showToast(msg.length ? msg.join(', ') : 'Nothing to change');

  _mitPats  = [];
  _mitDisch = [];
}

