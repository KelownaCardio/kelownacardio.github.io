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
// ═══════════════════════════════════════════════════════

// ── Tier 1+2: Local search ────────────────────────────
function searchPhysiciansLocal(query) {
  var q = query.toLowerCase().trim();
  var results = [];
  var seen = {};

  // Search BC embedded directory (all ~2300 Interior BC physicians)
  if (typeof BC_PHYSICIANS_LOCAL !== 'undefined') {
    for (var i = 0; i < BC_PHYSICIANS_LOCAL.length; i++) {
      var p = BC_PHYSICIANS_LOCAL[i];
      var fullName = (p[0] + ' ' + p[1]).toLowerCase();
      var num      = String(p[2]).toLowerCase();
      if (fullName.indexOf(q) !== -1 || num.indexOf(q) !== -1) {
        if (!seen[p[2]]) {
          seen[p[2]] = true;
          results.push({ last:p[0], first:p[1], num:p[2], spec:p[3]||'', city:p[4]||'' });
          if (results.length >= 15) break;
        }
      }
    }
  }
  return results;
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
        if (!Array.isArray(data) || !data.length) return;
        var dd = document.getElementById(dropdownId);
        if (!dd || dd.style.display === 'none') return;
        // Remove "searching..." placeholder
        var ph = dd.querySelector('.bc-searching');
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
      })
      .catch(function() {}); // silent fail — offline OK
  }, 400);
}

// ── Build a ref row HTML string (same pattern as icdSearch — reliable on iOS) ──
function buildRefRowHtml(r, dropdownId, hiddenId, nameId) {
  var display = 'Dr. ' + r.last + (r.first ? ', ' + r.first : '');
  var sub = (r.spec||'') + (r.city ? (r.spec ? ' • ' : '') + r.city : '');
  return '<div class="ref-dd-row" data-num="' + esc(r.num) + '" data-name="' + esc(display) + '" ' +
         'data-dd="' + esc(dropdownId) + '" data-hidden="' + esc(hiddenId) + '" data-nameid="' + esc(nameId) + '" ' +
         'onmousedown="event.preventDefault();selectRefRow(this)">' +
         esc(display) + ' <span style="color:var(--text3)">#' + esc(r.num) + '</span>' +
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
    dd.innerHTML =
      '<div class="bc-searching" style="padding:8px 10px;font-size:11px;color:var(--text2)">Searching all BC...</div>' +
      buildAddNewRowHtml(query, dropdownId, hiddenId, nameId);
    dd.style.display = 'block';
    searchPhysiciansRemote(query, dropdownId, hiddenId, nameId);
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
  var parts = query.trim().split(' ');
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
    if (type === 'num') { i.inputMode = 'numeric'; i.autocapitalize = 'none'; }
    else i.autocapitalize = 'words';
    wrap.appendChild(i);
  }
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

  setTimeout(function() {
    var f = document.getElementById('nrp-last');
    if (f) { f.focus(); f.select(); }
  }, 100);
}

function submitNewPhysician(dropdownId, hiddenId, nameId) {
  var last  = (document.getElementById('nrp-last')  || {}).value || '';
  var first = (document.getElementById('nrp-first') || {}).value || '';
  var num   = (document.getElementById('nrp-num')   || {}).value || '';
  var spec  = (document.getElementById('nrp-spec')  || {}).value || '';
  var city  = (document.getElementById('nrp-city')  || {}).value || '';
  last = last.trim(); num = num.trim(); spec = spec.trim(); city = city.trim();

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
  if (!num) r.needsLookup = true; // flags the backend to email Kathryn

  // Save to Physicians tab so it's available to all doctors permanently
  if (SHEETS_URL) push('addPhysician', r);
  var display = 'Dr. ' + last + (first ? ', ' + first : '');
  // num may be blank — the referrer is selected by name; the MSP # is filled
  // in later once Kathryn looks it up.
  selectRef(num, display, dropdownId, hiddenId, nameId);
  hideModal('add-phys-modal'); // v4.68: close the bottom sheet on save
  showToast(num
    ? ('Dr. ' + last + ' added to physician directory')
    : ('Dr. ' + last + ' saved — MSP # will be emailed to Kathryn to look up'));
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
  var numEl = document.getElementById('f-refby-num');
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
  showToast('Referrer saved');
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

