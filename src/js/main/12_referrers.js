// 12_referrers.js — Physician search (3 tiers) + referrer directory
//
// Tier 1: Saved referrers (instant, offline)
// Tier 2: 3,451 Interior BC physicians embedded (2026 College directory, instant, offline)
// Tier 3: Full 15,819 BC physicians via Google Sheets (async, requires internet)
//         + inline "Add new physician" form for new grads / anyone not in directory
//
// v4.67 (2026-07-10): Add-new-physician no longer hard-requires the MSP #.
//   A doctor may save with EITHER the MSP # (preferred) OR both specialty AND
//   city. No-number entries are saved to the Physicians tab with a blank num
//   and needsLookup:true; the backend (addPhysician) emails Kathryn so she can
//   look the number up and fill it in. New "City / hospital / clinic" field
//   maps to the existing Physicians.city column. Button relabelled "Save to
//   database". Pairs with backend addPhysician email patch.
// v4.68 (2026-07-10): the Add-new-physician form now opens in its OWN
//   bottom-sheet modal (#add-phys-modal) via showModal/hideModal, instead of
//   rendering inside the referrer dropdown (which was cramped and scrollable
//   inside the Add-Patient card on iPhone). Needs the #add-phys-modal markup
//   in index.template.html.
// v5.66 (2026-11-25, Kathryn): STOP FREE-TEXT REFERRER DUPLICATES.
//   Pairs with Lookup.gs v2.32 (backend). Doctors re-added referrers who were
//   already listed because search only matched "Last First" typed in order:
//   "Mark Sanderson" / "Jack Macgillivray" returned "No match found".
//   (a) Search: words in ANY order, each matching the start of a name word
//       or the MSP #; then one wrong letter per word allowed (local list;
//       the server does the same for all-BC search).
//   (b) "+ Add as new physician" first shows "Is it one of these?" — the
//       closest directory matches with MSP #, specialty and city, one tap to
//       use. The list refreshes as the names are edited.
//   (c) Names tidied before saving (no "Dr.", stray commas, capitals fixed).
//       An MSP # must be up to 5 digits or a letter + 4 digits (letter kept).
//   (d) No MSP #: the doctor goes to Kathryn's Referrer Requests list, not
//       the directory; the claim keeps the name and the # is filled in at
//       export once she enters it.
//   (e) A directory row with no MSP # says so in the dropdown.
// ═══════════════════════════════════════════════════════

// ── v5.66 helpers ─────────────────────────────────────
function refLev1(a, b) {
  if (a === b) return true;
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  var i = 0, j = 0, d = 0;
  while (i < la && j < lb) {
    if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
    if (++d > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return d + (la - i) + (lb - j) <= 1;
}
// 2 = every word matches exactly, 1 = with one wrong letter, 0 = no match
function refMatchLevel(toks, last, first, num) {
  var words = (String(last || '') + ' ' + String(first || '')).toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, ' ').split(/[\s\-']+/).filter(String);
  var n = String(num || '').toLowerCase(), level = 2;
  for (var t = 0; t < toks.length; t++) {
    var tk = toks[t];
    if ((n && n.indexOf(tk) === 0) || words.some(function(w) { return w.indexOf(tk) === 0; })) continue;
    if (tk.length >= 4 && words.some(function(w) {
          return refLev1(w, tk) || (w.length > tk.length && refLev1(w.slice(0, tk.length), tk)); })) { level = 1; continue; }
    return 0;
  }
  return level;
}
function refToks(q) {
  return String(q || '').toLowerCase().replace(/^\s*dr\.?\s+/, '').split(/[\s,.]+/).filter(function(t) { return t.length; });
}
function refTitleCase(s) {
  s = String(s || '').trim().replace(/\s+/g, ' ');
  if (!s || (s !== s.toLowerCase() && s !== s.toUpperCase())) return s;
  return s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, function(m, a, b) { return a + b.toUpperCase(); });
}
function refTidy(last, first) {
  last = String(last || '').trim(); first = String(first || '').trim();
  if (/^dr\.?$/i.test(last) && first.indexOf(',') >= 0) { last = first.split(',')[0]; first = first.split(',').slice(1).join(','); }
  if (!first && last.indexOf(',') >= 0) { first = last.split(',').slice(1).join(','); last = last.split(',')[0]; }
  var strip = function(x) { return x.replace(/^\s*dr\.?(\s+|$)/i, '').replace(/\([^)]*\)/g, '').replace(/,/g, ' ').trim(); };
  return { last: refTitleCase(strip(last)), first: refTitleCase(strip(first)) };
}

// ── Tier 1+2: Local search ────────────────────────────
function searchPhysiciansLocal(query) {
  // v5.66: words in any order; exact matches first, then one-letter-off.
  var toks = refToks(query);
  var exact = [], near = [], seen = {};
  if (!toks.length || typeof BC_PHYSICIANS_LOCAL === 'undefined') return [];
  for (var i = 0; i < BC_PHYSICIANS_LOCAL.length && exact.length < 15; i++) {
    var p = BC_PHYSICIANS_LOCAL[i];
    if (seen[p[2]]) continue;
    var lv = refMatchLevel(toks, p[0], p[1], p[2]);
    if (!lv) continue;
    seen[p[2]] = true;
    (lv === 2 ? exact : near).push({ last:p[0], first:p[1], num:p[2], spec:p[3]||'', city:p[4]||'' });
  }
  return exact.concat(near).slice(0, 15);
}

// ── Tier 3: Remote search via Google Sheets (debounced) ──
var _remoteTimer = null;
var _lastRemoteQ = '';

function searchPhysiciansRemote(query, dropdownId, hiddenId, nameId) {
  if (!SHEETS_URL || !query || query.length < 2) return;
  clearTimeout(_remoteTimer);
  _remoteTimer = setTimeout(function() {
    _lastRemoteQ = query;
    fetch(SHEETS_URL + '?action=searchPhysicians&q=' + encodeURIComponent(query) + '&key=' + SHARED_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (query !== _lastRemoteQ) return; // stale
        var dd = document.getElementById(dropdownId);
        if (!dd || dd.style.display === 'none') return;
        var ph = dd.querySelector('.bc-searching');
        // No results anywhere in BC — tell the doctor so they know to use
        // "+ Add as new physician" instead of waiting on a spinner that
        // never resolves.
        if (!Array.isArray(data) || !data.length) {
          if (ph) ph.textContent = 'No match found — add as new physician below';
          return;
        }
        // Remove "searching..." placeholder
        if (ph) ph.remove();
        // Find already-shown numbers
        var shownNums = [];
        dd.querySelectorAll('[data-num]').forEach(function(el) { shownNums.push(el.getAttribute('data-num')); });
        // Append new results
        var extraHtml = data
            .filter(function(p) { return shownNums.indexOf(String(p.num||p[2]||'')) === -1; })
            .slice(0, 8)
            .map(function(p) {
              return buildRefRowHtml(
                { last:p.last||p[0]||'', first:p.first||p[1]||'', num:p.num||p[2]||'', spec:p.spec||p[3]||'', city:p.city||p[4]||'' },
                dropdownId, hiddenId, nameId
              );
            }).join('');
          if (extraHtml) {
            var addRow = dd.querySelector('.ref-dd-add');
            if (addRow) addRow.insertAdjacentHTML('beforebegin', extraHtml);
            else dd.innerHTML += extraHtml;
          }
          // Remote came back with results, but none new (all duplicates of
          // what's already shown) — still resolve the "searching" state.
          else if (ph) {
            ph.textContent = 'No match found — add as new physician below';
          }
      })
      .catch(function() {
        // Offline / request failed — can't confirm a match either way, but
        // leaving "Searching..." on screen forever is worse than telling
        // the doctor to enter it manually.
        var dd = document.getElementById(dropdownId);
        if (!dd || dd.style.display === 'none') return;
        var ph = dd.querySelector('.bc-searching');
        if (ph) ph.textContent = 'No match found — add as new physician below';
      });
  }, 400);
}

// ── Build a ref row HTML string (same pattern as icdSearch — reliable on iOS) ──
function buildRefRowHtml(r, dropdownId, hiddenId, nameId) {
  var display = 'Dr. ' + r.last + (r.first ? ', ' + r.first : '');
  var sub = (r.spec||'') + (r.city ? (r.spec ? ' • ' : '') + r.city : '');
  return '<div class="ref-dd-row" data-num="' + esc(r.num) + '" data-name="' + esc(display) + '" ' +
         'data-dd="' + esc(dropdownId) + '" data-hidden="' + esc(hiddenId) + '" data-nameid="' + esc(nameId) + '" ' +
         'onmousedown="event.preventDefault();selectRefRow(this)">' +
         esc(display) + ' <span style="color:var(--text3)">' + (r.num ? '#' + esc(r.num) : '(no MSP # yet)') + '</span>' +
         (sub ? '<div style="font-size:10px;color:var(--text2);margin-top:1px">' + sub + '</div>' : '') +
         '</div>';
}

// ── Build "Add new physician" row HTML string ──────────
function buildAddNewRowHtml(query, dropdownId, hiddenId, nameId) {
  return '<div class="ref-dd-row ref-dd-add" style="color:var(--blue-t);font-style:italic" ' +
         'data-query="' + esc(query) + '" data-dd="' + esc(dropdownId) + '" ' +
         'data-hidden="' + esc(hiddenId) + '" data-nameid="' + esc(nameId) + '" ' +
         'onmousedown="event.preventDefault();openAddPhysicianForm(this)">+ Add &ldquo;' + esc(query) + '&rdquo; as new physician</div>';
}

// ── Main search function (called on input/focus) ───────
function refSearch(query, dropdownId, hiddenId, nameId) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;

  // Empty field on focus — show top Kelowna physicians as a starting list
  if (!query || !query.trim()) {
    if (typeof BC_PHYSICIANS_LOCAL !== 'undefined' && BC_PHYSICIANS_LOCAL.length) {
      var kelowna = BC_PHYSICIANS_LOCAL.filter(function(p) { return p[4] === 'Kelowna'; }).slice(0, 12);
      dd.innerHTML =
        '<div style="padding:5px 10px;font-size:10px;color:var(--text3)">Type to search all BC physicians</div>' +
        kelowna.map(function(p) { return buildRefRowHtml({ last:p[0], first:p[1], num:p[2], spec:p[3]||'', city:p[4]||'' }, dropdownId, hiddenId, nameId); }).join('');
      dd.style.display = 'block';
    }
    return;
  }

  // Search local BC directory as user types
  var local = searchPhysiciansLocal(query);

  if (!local.length) {
    // No remote search configured/available (offline, no SHEETS_URL) —
    // nothing will ever resolve the "Searching..." placeholder, so tell
    // the doctor right away instead of leaving a spinner on screen.
    var canSearchRemote = query.length >= 2 && typeof SHEETS_URL !== 'undefined' && SHEETS_URL;
    dd.innerHTML =
      (canSearchRemote
        ? '<div class="bc-searching" style="padding:8px 10px;font-size:11px;color:var(--text2)">Searching all BC...</div>'
        : '<div class="bc-searching" style="padding:8px 10px;font-size:11px;color:var(--text2)">No match found — add as new physician below</div>') +
      buildAddNewRowHtml(query, dropdownId, hiddenId, nameId);
    dd.style.display = 'block';
    if (canSearchRemote) searchPhysiciansRemote(query, dropdownId, hiddenId, nameId);
    return;
  }

  var html = local.map(function(r) {
    return buildRefRowHtml(r, dropdownId, hiddenId, nameId);
  }).join('');

  // Also search remote if fewer than 5 local results
  if (local.length < 5 && typeof SHEETS_URL !== 'undefined' && SHEETS_URL) {
    html += '<div class="bc-searching" style="padding:6px 10px;font-size:10px;color:var(--text3)">Also searching all BC...</div>';
    searchPhysiciansRemote(query, dropdownId, hiddenId, nameId);
  }

  html += buildAddNewRowHtml(query, dropdownId, hiddenId, nameId);
  dd.innerHTML = html;
  dd.style.display = 'block';
}

// ── Add New Physician form ─────────────────────────────
// v4.68: renders into its OWN bottom-sheet modal (#add-phys-modal) instead of
// inside the referrer dropdown, which was cramped/scrollable inside the
// Add-Patient card on iPhone. Uses the app's standard showModal/hideModal.
function openAddPhysicianForm(el) {
  if (el && !el.hasAttribute('data-query')) { el = el.closest('.ref-dd-row'); }
  if (!el) return;
  var query      = el.getAttribute('data-query') || '';
  var dropdownId = el.getAttribute('data-dd');
  var hiddenId   = el.getAttribute('data-hidden');
  var nameId     = el.getAttribute('data-nameid');

  // Close the referrer dropdown behind the sheet.
  var dd = document.getElementById(dropdownId);
  if (dd) dd.style.display = 'none';

  var body = document.getElementById('add-phys-body');
  if (!body) return;

  // Pre-fill from query text
  var parts = query.trim().replace(/^\s*dr\.?\s+/i, '').split(/[\s,]+/).filter(String);
  var prefLast  = parts[0] || '';
  var prefFirst = parts.slice(1).join(' ') || '';

  // Build form as DOM to avoid all quote issues
  body.innerHTML = '';
  var wrap = document.createElement('div');

  function inp(id, placeholder, value, type) {
    var i = document.createElement('input');
    i.id = id; i.placeholder = placeholder; i.value = value || '';
    i.style.cssText = 'width:100%;margin-bottom:8px;box-sizing:border-box';
    i.autocorrect = 'off';
    // MSP doctor #s are normally digits, but some newer/out-of-province
    // numbers carry a letter prefix (e.g. "J1234") — a numeric-only mobile
    // keypad makes those impossible to type, so use a plain text field with
    // auto-uppercase instead of forcing digits.
    if (type === 'num') { i.inputMode = 'text'; i.autocapitalize = 'characters'; }
    else i.autocapitalize = 'words';
    wrap.appendChild(i);
  }
  // v5.66: "Is it one of these?" — closest directory matches, one tap to use.
  var sug = document.createElement('div');
  sug.id = 'nrp-suggest';
  sug.style.cssText = 'margin-bottom:10px';
  wrap.appendChild(sug);

  inp('nrp-last',  'Last name',            prefLast);
  inp('nrp-first', 'First name',           prefFirst);
  inp('nrp-num',   'MSP doctor #',         '', 'num');

  // Helper under MSP # — explains the preferred vs fallback rule
  var numHint = document.createElement('div');
  numHint.style.cssText = 'font-size:12px;color:var(--text3);margin:-2px 0 10px;line-height:1.4';
  numHint.textContent = 'Preferred. If you don’t know it, fill in both fields below and it will be emailed to Kathryn to look up.';
  wrap.appendChild(numHint);

  // Divider — "or, if the MSP # is unknown"
  var divRow = document.createElement('div');
  divRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:2px 0 10px';
  divRow.innerHTML = '<div style="flex:1;height:.5px;background:var(--border2)"></div>' +
                     '<div style="font-size:11px;color:var(--text3)">or, if the MSP # is unknown</div>' +
                     '<div style="flex:1;height:.5px;background:var(--border2)"></div>';
  wrap.appendChild(divRow);

  inp('nrp-spec',  'Specialty',            '');
  inp('nrp-city',  'City / hospital / clinic', '');

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px';

  var save = document.createElement('button');
  save.className = 'btn btn-p';
  save.style.margin = '0';
  save.textContent = 'Save to database';
  save.onclick = function() { submitNewPhysician(dropdownId, hiddenId, nameId); };

  var cancel = document.createElement('button');
  cancel.className = 'btn btn-s';
  cancel.style.margin = '0';
  cancel.textContent = 'Cancel';
  cancel.onclick = function() { hideModal('add-phys-modal'); };

  btnRow.appendChild(save);
  btnRow.appendChild(cancel);
  wrap.appendChild(btnRow);
  body.appendChild(wrap);

  showModal('add-phys-modal');

  // v5.66: suggestions now, and again whenever the names change.
  var refresh = function() { refSuggestForAdd(dropdownId, hiddenId, nameId); };
  ['nrp-last', 'nrp-first'].forEach(function(id) {
    var f = document.getElementById(id);
    if (f) f.addEventListener('input', function() { clearTimeout(_sugTimer); _sugTimer = setTimeout(refresh, 350); });
  });
  refresh();

  setTimeout(function() {
    var f = document.getElementById('nrp-last');
    if (f) { f.focus(); f.select(); }
  }, 100);
}

var _sugTimer = null, _sugSeq = 0;
function refSuggestForAdd(dropdownId, hiddenId, nameId) {
  var box = document.getElementById('nrp-suggest');
  if (!box) return;
  var last  = ((document.getElementById('nrp-last')  || {}).value || '').trim();
  var first = ((document.getElementById('nrp-first') || {}).value || '').trim();
  var q = (last + ' ' + first).trim();
  if (last.length < 2) { box.innerHTML = ''; return; }
  var seq = ++_sugSeq, shown = {};
  var rows = [];
  var paint = function() {
    if (seq !== _sugSeq) return;
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:4px">Is it one of these? Tap to use</div>';
    rows.slice(0, 6).forEach(function(r) {
      var d = document.createElement('div');
      d.className = 'ref-dd-row';
      d.style.cssText = 'border:.5px solid var(--border2);border-radius:8px;margin-bottom:4px';
      var display = 'Dr. ' + r.last + (r.first ? ', ' + r.first : '');
      var sub = [r.spec, r.city].filter(Boolean).join(' • ');
      d.innerHTML = esc(display) + ' <span style="color:var(--text3)">' + (r.num ? '#' + esc(r.num) : '(no MSP # yet)') + '</span>' +
        (sub ? '<div style="font-size:10px;color:var(--text2);margin-top:1px">' + esc(sub) + '</div>' : '');
      d.onclick = function() { selectRef(r.num || '', display, dropdownId, hiddenId, nameId); hideModal('add-phys-modal'); };
      box.appendChild(d);
    });
    var hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:var(--text3);margin-top:2px';
    hint.textContent = 'None of these? Fill in the details below.';
    box.appendChild(hint);
  };
  // Surname alone (one wrong letter allowed) finds the doctor even if the first name differs.
  var add = function(list) {
    (list || []).forEach(function(r) {
      var key = (r.num || '') + '|' + r.last + '|' + r.first;
      if (shown[key]) return; shown[key] = true; rows.push(r);
    });
  };
  add(searchPhysiciansLocal(q));
  add(searchPhysiciansLocal(last));
  paint();
  if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) {
    fetch(SHEETS_URL + '?action=searchPhysicians&q=' + encodeURIComponent(last) + '&key=' + SHARED_KEY)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return;
        var fTok = refToks(first)[0] || '';
        // first-name agreement ranks first; keep the rest as fallbacks
        var mapped = data.map(function(p) { return { last:p.last||p[0]||'', first:p.first||p[1]||'', num:p.num||p[2]||'', spec:p.spec||p[3]||'', city:p.city||p[4]||'' }; });
        mapped.sort(function(a, b) {
          var fa = fTok && String(a.first).toLowerCase().indexOf(fTok) === 0 ? 0 : 1;
          var fb = fTok && String(b.first).toLowerCase().indexOf(fTok) === 0 ? 0 : 1;
          return fa - fb;
        });
        add(mapped); paint();
      })
      .catch(function() {});
  }
}

function submitNewPhysician(dropdownId, hiddenId, nameId) {
  var last  = (document.getElementById('nrp-last')  || {}).value || '';
  var first = (document.getElementById('nrp-first') || {}).value || '';
  var num   = (document.getElementById('nrp-num')   || {}).value || '';
  var spec  = (document.getElementById('nrp-spec')  || {}).value || '';
  var city  = (document.getElementById('nrp-city')  || {}).value || '';
  // v5.66: tidy names; MSP # must be up to 5 digits or a letter + 4 digits (letter kept).
  var tidy = refTidy(last, first);
  last = tidy.last; first = tidy.first;
  num = num.toUpperCase().replace(/\s+/g, ''); spec = spec.trim(); city = refTitleCase(city);
  if (num && !/^(\d{1,5}|[A-Z]\d{4})$/.test(num)) {
    showToast('MSP # should be up to 5 digits (12345) or a letter + 4 digits (Q1234 — keep the letter) — check the number, or leave it blank');
    return;
  }

  // Last name is always required.
  if (!last) { showToast('Last name required'); return; }
  // Then EITHER an MSP # (preferred) OR both specialty AND city, so a
  // no-number entry can be looked up by Kathryn after the fact.
  if (!num && !(spec && city)) {
    showToast('Enter the MSP # — or specialty AND city so it can be looked up');
    return;
  }
  // Only dedupe when a number was given (blanks would collide with each other).
  if (num) {
    var existing = st.refs.find(function(r) { return r.num === num; });
    if (existing) { showToast('Doctor #' + num + ' already saved'); return; }
  }

  var r = { last:last, first:first.trim(), num:num, spec:spec, city:city };
  if (!num) r.needsLookup = true; // v5.66: backend queues it on Referrer Requests + emails Kathryn once

  // Save to Physicians tab so it's available to all doctors permanently
  if (SHEETS_URL) push('addPhysician', r);
  var display = 'Dr. ' + last + (first ? ', ' + first : '');
  // num may be blank — the referrer is selected by name; the MSP # is filled
  // in later once Kathryn looks it up.
  selectRef(num, display, dropdownId, hiddenId, nameId);
  hideModal('add-phys-modal'); // v4.68: close the bottom sheet on save
  // v5.32: silent when complete; the no-MSP case still says what happens next.
  if (num) showSaved('Dr. ' + last + ' added to physician directory');
  else showToast('Dr. ' + last + ' sent to Kathryn to look up the MSP # — your claim keeps the name and the # is added at export');
}

// ── selectRefRow / selectRef ───────────────────────────
function selectRefRow(el) {
  // If tap landed on a child element (span/div inside the row), walk up to the row
  if (el && !el.hasAttribute('data-num')) {
    el = el.closest('.ref-dd-row');
  }
  if (!el) return;
  selectRef(
    el.getAttribute('data-num'),
    el.getAttribute('data-name'),
    el.getAttribute('data-dd'),
    el.getAttribute('data-hidden'),
    el.getAttribute('data-nameid')
  );
}

function selectRef(num, displayName, dropdownId, hiddenId, nameId) {
  var hiddenEl = document.getElementById(hiddenId);
  if (hiddenEl) hiddenEl.value = num;

  var nameEl = document.getElementById(nameId);
  if (nameEl) nameEl.value = displayName;

  // Populate f-refby-num if present (Add Patient form)
  // v5.46: not when the pick came from the Rounds card (rde-/rda- fields) —
  // it must never overwrite an Add Patient form that is open in another tab.
  var numEl = /^rd[ea]-/.test(String(dropdownId || '')) ? null : document.getElementById('f-refby-num');
  if (numEl) numEl.value = num;

  // Fill visible search input with selected name
  var dd = document.getElementById(dropdownId);
  if (dd) dd.style.display = 'none';
  // Derive search input ID from dropdown ID (e.g. 'f-ref-dd' -> 'f-ref-search')
  var searchId = dropdownId.replace(/-dd$/, '-search');
  var inp = document.getElementById(searchId);
  if (inp && inp.tagName === 'INPUT') inp.value = displayName;

  // Track recently used
  if (!st.recentRefs) st.recentRefs = [];
  st.recentRefs = st.recentRefs.filter(function(r) { return r.num !== num; });
  st.recentRefs.unshift({ num: num });
  if (st.recentRefs.length > 5) st.recentRefs = st.recentRefs.slice(0, 5);
  sv('recentRefs', st.recentRefs);

  // No auto-save — physicians are found via search, only manually added ones go to the sheet
}

// ── Referrers pane ─────────────────────────────────────
function renderRefs(q) {
  var refList = document.getElementById('ref-list');
  if (!refList) return; // pane removed in v2.82, no-op
  var list = st.refs.filter(function(r) {
    var s = (q || '').toLowerCase();
    return !s ||
      r.last.toLowerCase().includes(s) ||
      (r.first||'').toLowerCase().includes(s) ||
      r.num.includes(s);
  });
  refList.innerHTML = list.length
    ? list.map(function(r) {
        var ini = (r.first ? r.first[0] : '') + (r.last ? r.last[0] : '');
        var display = 'Dr. ' + r.last + (r.first ? ', ' + r.first : '');
        return '<div class="ref-row">' +
          '<div class="ref-av">' + ini.toUpperCase() + '</div>' +
          '<div class="ref-info">' +
            '<div class="ref-name">' + esc(display) + '</div>' +
            '<div class="ref-meta">#' + r.num + (r.spec ? ' &bull; ' + r.spec : '') + '</div>' +
          '</div>' +
          '<button class="ref-use" onclick="useRef(\'' + r.num + '\',\'' + esc(display) + '\')">Use</button>' +
          '</div>';
      }).join('')
    : '<div class="empty">No referrers saved yet.</div>';
}

function useRef(num, displayName) {
  document.getElementById('f-refby-num').value  = num;
  document.getElementById('f-refby-name').value = displayName;
  document.getElementById('f-ref-search').value = displayName;
  nav(1, document.querySelectorAll('.nb')[1]);
  showToast('Referrer #' + num + ' selected');
}

function addRef() {
  var last = gv('r-last'), num = gv('r-num');
  if (!last || !num) { showToast('Need last name and doctor #'); return; }
  var r = { id:'r'+Date.now(), last:last, first:gv('r-first'), num:num, spec:gv('r-spec') };
  st.refs.push(r);
  sv('refs', st.refs);
  if (SHEETS_URL) push('saveRef', r);
  ['r-last','r-first','r-num','r-spec'].forEach(function(id) { document.getElementById(id).value = ''; });
  renderRefs('');
  showSaved('Referrer saved');
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  try {
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.closest('.ref-dd')) return;
    if (t.hasAttribute('data-dd') || t.hasAttribute('data-hidden')) return;
    if (t.id === 'f-ref-search' || t.id === 'cb-ref-search' ||
        t.id === 'pe-ref-search' || t.id === 'f-icd-search' ||
        t.id === 'cb-icd-search' || t.id === 'pe-icd-search' ||
        t.id === 'ce-icd-search' || t.id === 'ce-ref-search' || t.id === 'oc-icd-search' ||
        t.id === 'oc-ref-search' ||
        t.id === 'oc-fee-search' ||
        // v4.81: Phone Advice tab search fields
        t.id === 'pa-ref-search' || t.id === 'pa-icd2-search' || t.id === 'pa-icd3-search') return;
    document.querySelectorAll('.ref-dd').forEach(function(dd) { dd.style.display = 'none'; });
  } catch(e2) {}
});

