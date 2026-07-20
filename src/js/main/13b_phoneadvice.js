// 13b_phoneadvice.js — Phone Advice tab (v4.80 BETA, hidden)
// ═══════════════════════════════════════════════════════════════════
// Opened by the unlabelled 📞 in the footer build stamp. Replaces the
// clunky screenshot→QuickChart→phone@ round trip for outside advice
// calls with one screen inside the billing app:
//
//   1. Photograph / upload the MBMD call-request screenshot → OCR
//      auto-fills caller, facility, call-back number, patient, PHN.
//      Reuses the existing backend `ocrSticker` action (Crud.gs) with a
//      message-specific prompt — NO backend billing-app change needed.
//   2. Tap-to-dial: the call-back number renders as a tel: link.
//   3. After the call, dictate the advice with the keyboard mic and
//      submit. The payload matches the standalone webform's contract
//      exactly and is POSTed to the PhoneAdvice(Personal) web app's new
//      JSON endpoint (PhoneAdviceApi.gs v1.0 → processWebFormSubmission),
//      so the claim row, patient stub, letter PDF, phone@ email, EMR
//      SFTP and iClinic CSV billing all flow through the SAME tested
//      pipeline as the webform. The webform itself is untouched.
//
// Endpoint setup (one-time per device): the modal asks for the Phone
// Advice webform link and stores the /exec URL in localStorage
// (kgh5:paUrl). Auth: the same app password the device already holds
// (SHARED_KEY) — PhoneAdviceApi.gs checks it against its APP_PW script
// property.
//
// Deliberately NOT in this beta (use the full webform instead):
// Out-of-Province, RACE referrals, allied-health callers.
//
// v4.81 (2026-07-19, Kathryn feedback after deploy):
//   (1) Calling physician is now DIRECTORY-LINKED — the same 3-tier
//       search the consult card uses (refSearchEl → saved refs +
//       embedded BC directory + remote Sheets, incl. "+ Add new
//       physician"). A selected match puts the MSP # straight on the
//       claim via manualRefNum, so billing no longer depends on the
//       server-side name match. Free text still allowed (server
//       matches/holds as before) but the confirm dialog warns.
//   (2) ICD-9 free-text fields replaced by the webform's 12 quick-tap
//       pills (same codes/labels as kelownacardio.com/md) + two
//       optional directory-search fields (icdSearchEl) for anything
//       else. At least one diagnosis is required; no free typing.
// ═══════════════════════════════════════════════════════════════════

var PA_URL_LS_KEY = 'kgh5:paUrl';

// v4.81: quick-tap ICD pills — same codes/labels as the phone advice
// webform's #icd-quick block (kelownacardio.com/md).
var PA_ICD_PILLS = [
  { code:'7865', desc:'Chest pain',                    label:'Chest Pain' },
  { code:'411',  desc:'Unstable angina',               label:'U/A' },
  { code:'4100', desc:'Acute MI',                      label:'NSTEMI/STEMI' },
  { code:'4280', desc:'Congestive heart failure',      label:'Heart Failure' },
  { code:'4254', desc:'Primary cardiomyopathy',        label:'Cardiomyopathy' },
  { code:'4273', desc:'Atrial fibrillation / flutter', label:'AFib' },
  { code:'427',  desc:'Cardiac dysrhythmia',           label:'Arrhythmia' },
  { code:'4261', desc:'AV block',                      label:'Heart Block' },
  { code:'7802', desc:'Syncope',                       label:'Syncope' },
  { code:'420',  desc:'Acute pericarditis',            label:'Pericarditis' },
  { code:'4019', desc:'Essential hypertension',        label:'HTN' },
  { code:'4140', desc:'Coronary atherosclerosis',      label:'CAD' }
];

// OCR prompt for MBMD call-request message screenshots.
var PA_MBMD_PROMPT =
  'Screenshot of a physician call-request message from a hospital ' +
  'messaging app. Extract the fields and return a single JSON object ' +
  'with exactly these keys:\n' +
  '  callerName, facility, phone, patientLast, patientFirst, phn, dob\n\n' +
  'Rules:\n' +
  '  callerName   — the physician to call back, surname only if that is\n' +
  '                 all that is given (e.g. "Dr. Veale" -> "Veale").\n' +
  '  facility     — the hospital/clinic named, e.g. "QVH - Revelstoke",\n' +
  '                 "Boundary hospital". Blank if not shown.\n' +
  '  phone        — the call-back phone number exactly as printed,\n' +
  '                 e.g. "(250) 814-9588". This is the number labelled\n' +
  '                 "Ph:" or given beside the physician, NOT the PHN.\n' +
  '  patientLast / patientFirst — from the "Patient:" line. "Pendrak,\n' +
  '                 Christopher" is Last, First. Without a comma, an\n' +
  '                 ALL-CAPS word is the last name ("Jane HOFFMAN" ->\n' +
  '                 last HOFFMAN, first Jane).\n' +
  '  phn          — the number labelled PHN, DIGITS ONLY (strip spaces\n' +
  '                 and punctuation). BC PHNs are 10 digits starting\n' +
  '                 with 9. If the PHN value looks like a phone number,\n' +
  '                 still return its digits — the doctor will verify.\n' +
  '  dob          — date of birth as YYYY-MM-DD if shown, else "".\n\n' +
  'Use "" for anything not present. Return ONLY valid JSON, no ' +
  'markdown, no explanation.';

// ── BC PHN MOD-11 check digit (same as webform / server) ───────────
function paIsValidPHN(phn) {
  var d = String(phn).replace(/\D/g, '');
  if (d.length !== 10 || d[0] !== '9') return false;
  var w = [2, 4, 8, 5, 10, 9, 7, 3];
  var sum = 0;
  for (var i = 0; i < 8; i++) sum += (parseInt(d[i + 1], 10) * w[i]) % 11;
  var chk = 11 - (sum % 11);
  return chk < 10 && chk === parseInt(d[9], 10);
}

// ── Endpoint URL (one-time paste, per device) ──────────────────────
function paGetUrl() {
  var u = '';
  try { u = localStorage.getItem(PA_URL_LS_KEY) || ''; } catch (e) {}
  return u;
}

function paAskUrl() {
  var raw = prompt(
    'One-time setup — paste the Phone Advice webform link\n' +
    '(the same link colleagues use for the phone advice form):');
  if (!raw) return '';
  var m = String(raw).trim().match(/^https:\/\/script\.google\.com\/macros\/s\/[^\/\s]+\/exec/);
  if (!m) {
    showToast('That does not look like a script.google.com /exec link', 'error');
    return '';
  }
  try { localStorage.setItem(PA_URL_LS_KEY, m[0]); } catch (e) {}
  return m[0];
}

// ── Open / render ──────────────────────────────────────────────────
function openPhoneAdvice() {
  paRenderForm();
  showModal('pa-modal');
}

function paV(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function paRenderForm() {
  var now = new Date();
  var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
  var iso  = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  var hm   = pad2(now.getHours()) + ':' + pad2(now.getMinutes());

  var docs = (typeof st !== 'undefined' && st.doctors && st.doctors.length)
    ? st.doctors : (typeof DOCTORS_SEED !== 'undefined' ? DOCTORS_SEED : []);
  var curAlias = (typeof st !== 'undefined' && st.doc) ? st.doc : '';
  var docOpts = docs.map(function(d) {
    var sel = (d.alias === curAlias) ? ' selected' : '';
    return '<option value="' + d.name.replace(/"/g, '&quot;') + '"' + sel + '>' +
           d.name + '</option>';
  }).join('');

  document.getElementById('pa-content').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div style="font-size:16px;font-weight:800">📞 Phone Advice ' +
        '<span style="font-size:10px;font-weight:700;color:var(--amber-t);background:var(--amber-bg);' +
        'border:1px solid var(--amber-t);border-radius:8px;padding:1px 7px;vertical-align:2px">BETA</span></div>' +
      '<button onclick="hideModal(\'pa-modal\')" style="background:transparent;border:none;' +
        'font-size:20px;color:var(--text3);cursor:pointer;padding:0 4px">×</button>' +
    '</div>' +

    // ── Screenshot OCR ──
    '<label for="pa-photo" style="display:block;text-align:center;padding:11px;border:1.5px dashed var(--border2);' +
      'border-radius:var(--rsm);font-weight:700;color:var(--blue);cursor:pointer;margin-bottom:4px">' +
      '📷 Photo / screenshot of the call request</label>' +
    '<input type="file" id="pa-photo" accept="image/*" style="display:none" onchange="paPhoto(this)">' +
    '<div class="ocr-bar" id="pa-ocr-bar" style="display:none"></div>' +

    // ── Caller ── (v4.81: directory-linked, same machinery as the
    // consult card's Referring MD — selected match → MSP # on the claim)
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">CALLER</div>' +
    '<label>Calling physician</label>' +
    '<div style="position:relative">' +
      '<input id="pa-ref-search" placeholder="Type name or doctor #..." autocorrect="off" autocomplete="off" style="padding-right:32px" ' +
        'data-dd="pa-ref-dd" data-hidden="pa-ref-num" data-name="pa-ref-name" ' +
        'oninput="paRefTyped(this)" onfocus="refSearchEl(this)">' +
      '<button type="button" tabindex="-1" onclick="clearSearchField(\'pa-ref-search\',\'pa-ref-num\',\'pa-ref-name\',\'pa-ref-dd\')" ' +
        'onpointerdown="event.preventDefault();clearSearchField(\'pa-ref-search\',\'pa-ref-num\',\'pa-ref-name\',\'pa-ref-dd\')" ' +
        'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
    '</div>' +
    '<div class="ref-dd" id="pa-ref-dd"></div>' +
    '<input id="pa-ref-num"  type="hidden" value="">' +
    '<input id="pa-ref-name" type="hidden" value="">' +
    '<label>Calling from</label>' +
    '<input id="pa-from" autocorrect="off" placeholder="e.g. QVH - Revelstoke">' +
    '<label>Call-back number</label>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
      '<input id="pa-phone" inputmode="tel" style="flex:1" placeholder="(250) 000-0000" oninput="paPhoneLink()">' +
      '<a id="pa-dial" href="#" onclick="return paDial()" style="flex:0 0 auto;background:var(--blue);color:#fff;' +
        'text-decoration:none;border-radius:14px;padding:8px 16px;font-size:13px;font-weight:700">📞 Call</a>' +
    '</div>' +

    // ── Patient ──
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">PATIENT</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>Last name</label><input id="pa-last" autocorrect="off" autocapitalize="words"></div>' +
      '<div class="f1"><label>First name</label><input id="pa-first" autocorrect="off" autocapitalize="words"></div>' +
    '</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>PHN</label>' +
        '<input id="pa-phn" inputmode="numeric" maxlength="10" placeholder="10 digits" oninput="paPhnLive()"></div>' +
      '<div class="f1"><label>DOB (if known)</label><input id="pa-dob" type="date"></div>' +
    '</div>' +
    '<div id="pa-phn-err" style="display:none;margin:2px 0 4px;padding:6px 10px;background:var(--red-bg);' +
      'border:1px solid var(--red-t);border-radius:6px;font-size:12px;font-weight:600;color:var(--red-t)"></div>' +
    '<label>Sex</label>' +
    '<div class="fl" style="gap:6px;max-width:52%;margin-bottom:4px">' +
      '<button type="button" class="ap-list-pill" id="pa-sex-m" onclick="paSex(\'M\')">M</button>' +
      '<button type="button" class="ap-list-pill" id="pa-sex-f" onclick="paSex(\'F\')">F</button>' +
    '</div>' +
    '<input type="hidden" id="pa-sex" value="">' +

    // ── Call details ──
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">CALL</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>Date of call</label><input id="pa-date" type="date" value="' + iso + '"></div>' +
      '<div class="f1"><label>Time</label><input id="pa-time" type="time" value="' + hm + '"></div>' +
    '</div>' +
    '<label>Fee code</label>' +
    '<div class="fl" style="gap:6px;margin-bottom:4px">' +
      '<button type="button" class="ap-list-pill on" id="pa-fee-10001" onclick="paFee(\'10001\')">&lt;24hr (10001)</button>' +
      '<button type="button" class="ap-list-pill" id="pa-fee-10004" onclick="paFee(\'10004\')">&lt;7day (10004)</button>' +
      '<button type="button" class="ap-list-pill" id="pa-fee-78711" onclick="paFee(\'78711\')">Conf (78711)</button>' +
    '</div>' +
    '<input type="hidden" id="pa-fee" value="10001">' +
    '<label>Discussed with (KCA physician)</label>' +
    '<select id="pa-doc" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);' +
      'font-size:14px;font-family:inherit;background:#fff">' + docOpts + '</select>' +

    // ── Clinical ── (v4.81: webform quick-tap pills + directory search,
    // no free-text ICD entry)
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">CLINICAL</div>' +
    '<label>Diagnosis — tap all that apply (first tap = primary)</label>' +
    '<div id="pa-icd-quick" style="display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px">' +
      PA_ICD_PILLS.map(function(p) {
        return '<button type="button" class="ap-list-pill" id="pa-pill-' + p.code + '" ' +
               'onclick="paTogglePill(\'' + p.code + '\')">' + p.label + '</button>';
      }).join('') +
    '</div>' +
    '<div class="fl">' +
      '<div class="f1" style="position:relative"><label>Other Dx 1 (optional)</label>' +
        '<input id="pa-icd2-search" placeholder="Type to search ICD-9" autocorrect="off" autocomplete="off" ' +
          'data-dd="pa-icd2-dd" data-hidden="pa-icd2-code" ' +
          'oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
        '<div class="ref-dd" id="pa-icd2-dd"></div>' +
        '<input id="pa-icd2-code" type="hidden" value=""></div>' +
      '<div class="f1" style="position:relative"><label>Other Dx 2 (optional)</label>' +
        '<input id="pa-icd3-search" placeholder="Type to search ICD-9" autocorrect="off" autocomplete="off" ' +
          'data-dd="pa-icd3-dd" data-hidden="pa-icd3-code" ' +
          'oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
        '<div class="ref-dd" id="pa-icd3-dd"></div>' +
        '<input id="pa-icd3-code" type="hidden" value=""></div>' +
    '</div>' +
    // v4.81: single compact box (Kathryn) — feeds the letter's ADVICE
    // GIVEN section; the separate Background field was dropped.
    '<label>Summary of Phone Advice</label>' +
    '<textarea id="pa-advice" rows="5" style="width:100%;padding:8px;border:.5px solid var(--border2);' +
      'border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical" ' +
      'placeholder="Tap the mic on your keyboard to dictate the summary and advice given"></textarea>' +

    '<div style="margin:8px 0 4px;font-size:11px;color:var(--text3);line-height:1.5">' +
      'Out-of-Province or RACE case? Use the full phone advice webform — this beta form is BC/MSP only.</div>' +

    '<button class="btn" style="width:100%;margin-top:6px;background:var(--blue);color:#fff;font-weight:800" ' +
      'onclick="paSubmit()" id="pa-submit-btn">Submit — letter + billing</button>' +
    '<div id="pa-status" style="display:none;margin-top:8px;padding:8px 10px;border-radius:6px;' +
      'font-size:13px;font-weight:600;line-height:1.4"></div>';

  window._paPillOrder = [];   // v4.81: ICD pill codes in tap order
  paPhoneLink();
}

// ── v4.81: caller directory search ─────────────────────────────────
// Typing clears any previously selected MSP # (the text no longer
// matches the selection), then runs the normal 3-tier search.
function paRefTyped(inputEl) {
  var n = document.getElementById('pa-ref-num');
  if (n) n.value = '';
  var nm = document.getElementById('pa-ref-name');
  if (nm) nm.value = '';
  refSearchEl(inputEl);
}

// ── v4.81: ICD quick pills ─────────────────────────────────────────
function paTogglePill(code) {
  var btn = document.getElementById('pa-pill-' + code);
  if (!btn) return;
  var order = window._paPillOrder = window._paPillOrder || [];
  var idx = order.indexOf(code);
  if (idx >= 0) { order.splice(idx, 1); btn.classList.remove('on'); }
  else          { order.push(code);     btn.classList.add('on'); }
}

// All selected diagnoses as "code - description" strings (webform
// format — the server takes the code from before the dash): pills in
// tap order first, then the two optional search fields.
function paIcdList() {
  var icds = [];
  (window._paPillOrder || []).forEach(function(code) {
    for (var i = 0; i < PA_ICD_PILLS.length; i++) {
      if (PA_ICD_PILLS[i].code === code) {
        icds.push(code + ' - ' + PA_ICD_PILLS[i].desc);
        break;
      }
    }
  });
  ['pa-icd2', 'pa-icd3'].forEach(function(base) {
    var code = paV(base + '-code');
    if (!code) return;
    // Directory label is "Description (code)" — rebuild as "code - Description".
    var label = paV(base + '-search').replace(/\s*\([^)]*\)\s*$/, '').trim();
    icds.push(code + (label ? ' - ' + label : ''));
  });
  return icds;
}

// ── Small UI helpers ───────────────────────────────────────────────
function paSex(s) {
  document.getElementById('pa-sex').value = s;
  document.getElementById('pa-sex-m').classList.toggle('on', s === 'M');
  document.getElementById('pa-sex-f').classList.toggle('on', s === 'F');
}

function paFee(code) {
  document.getElementById('pa-fee').value = code;
  ['10001', '10004', '78711'].forEach(function(c) {
    document.getElementById('pa-fee-' + c).classList.toggle('on', c === code);
  });
}

function paPhoneLink() {
  var digits = paV('pa-phone').replace(/\D/g, '');
  var a = document.getElementById('pa-dial');
  if (!a) return;
  a.style.opacity = digits.length >= 7 ? '1' : '.4';
}

function paDial() {
  var digits = paV('pa-phone').replace(/\D/g, '');
  if (digits.length < 7) { showToast('No call-back number yet', 'error'); return false; }
  window.location.href = 'tel:' + digits;
  return false;
}

function paPhnLive() {
  var el  = document.getElementById('pa-phn');
  var err = document.getElementById('pa-phn-err');
  var d   = el.value.replace(/\D/g, '');
  el.value = d;
  if (d.length === 10 && !paIsValidPHN(d)) {
    err.textContent = 'PHN check digit invalid — a digit is likely wrong';
    err.style.display = 'block';
  } else {
    err.style.display = 'none';
  }
}

function paStatus(msg, kind) {
  var el = document.getElementById('pa-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = kind === 'err' ? 'var(--red-bg)'  : 'var(--green-bg)';
  el.style.border     = '1px solid ' + (kind === 'err' ? 'var(--red-t)' : 'var(--green-t)');
  el.style.color      = kind === 'err' ? 'var(--red-t)'  : 'var(--green-t)';
  el.textContent = msg;
}

// ── Screenshot OCR ─────────────────────────────────────────────────
function paPhoto(inp) {
  var file = inp && inp.files && inp.files[0];
  if (!file) return;
  inp.value = '';
  var bar = document.getElementById('pa-ocr-bar');
  var reader = new FileReader();
  reader.onerror = function() {
    if (bar) { bar.style.display = 'block'; bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not read the image file'; }
  };
  reader.onload = function(e) {
    var img = new Image();
    img.onerror = function() {
      if (bar) { bar.style.display = 'block'; bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not decode the image'; }
    };
    img.onload = function() {
      // Same downscale budget as sticker OCR (1200px / 0.75 — v4.42).
      var MAX = 1200;
      var w = img.width, h = img.height;
      if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      else if (h > MAX)     { w = Math.round(w * MAX / h); h = MAX; }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      window._paLastB64 = b64;
      paRunOCR(b64, bar);
    };
    img.src = e.target.result || '';
  };
  reader.readAsDataURL(file);
}

function paRunOCR(b64, bar) {
  if (bar) {
    bar.style.display = 'block';
    bar.className = 'ocr-bar ocr-ok';
    bar.innerHTML = '<span style="display:inline-block;animation:pulse 1s infinite">📷</span> Reading the message…';
  }
  // Single attempt + manual retry — the modal is interactive, the fields
  // are never locked, and the doctor can always type from the screenshot.
  _runAppsScriptOCR(b64, 'image/jpeg', PA_MBMD_PROMPT, 400)
    .then(function(r) { paFillFromOCR(r || {}, bar); })
    .catch(function(err) {
      if (bar) {
        bar.className = 'ocr-bar ocr-warn';
        bar.innerHTML = '⚠️ Could not read the screenshot (' +
          ((err && err.message) || 'error').slice(0, 60) + ') ' +
          '<button onclick="paOcrRetry()" style="background:var(--blue);color:#fff;border:none;' +
          'border-radius:12px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;margin-left:6px">↻ Retry</button>';
      }
    });
}

function paOcrRetry() {
  if (!window._paLastB64) { showToast('No image to retry — re-take the screenshot', 'error'); return; }
  paRunOCR(window._paLastB64, document.getElementById('pa-ocr-bar'));
}

function paFillFromOCR(p, bar) {
  var set = function(id, val) {
    if (!val) return;
    var el = document.getElementById(id);
    if (el) el.value = String(val).trim();
  };
  set('pa-from',   p.facility);
  set('pa-phone',  p.phone);
  set('pa-last',   p.patientLast);
  set('pa-first',  p.patientFirst);
  set('pa-phn',    String(p.phn || '').replace(/\D/g, ''));
  if (p.dob && /^\d{4}-\d{2}-\d{2}$/.test(String(p.dob).trim())) set('pa-dob', String(p.dob).trim());
  paPhnLive();
  paPhoneLink();
  // v4.81: caller goes into the DIRECTORY SEARCH box and the match list
  // opens immediately — one tap links the MSP # to the claim.
  var caller = String(p.callerName || '').trim();
  if (caller) {
    set('pa-ref-search', caller);
    try { refSearch(caller, 'pa-ref-dd', 'pa-ref-num', 'pa-ref-name'); } catch (e) {}
  }
  var got = ['pa-ref-search', 'pa-phone', 'pa-last', 'pa-phn'].filter(function(id) { return paV(id); }).length;
  if (bar) {
    bar.className = 'ocr-bar ' + (got >= 2 ? 'ocr-ok' : 'ocr-warn');
    bar.textContent = got >= 2
      ? '✓ Extracted — tap the caller in the list to link them, and check every field'
      : '⚠️ Little data found — type the details from the screenshot';
  }
}

// ── Submit ─────────────────────────────────────────────────────────
function paSubmit() {
  // v4.81: caller from the directory search; ICDs from pills + search.
  var callerNum  = paV('pa-ref-num');                              // MSP # when matched
  var callerName = (paV('pa-ref-name') || paV('pa-ref-search'))
                     .replace(/^Dr\.?\s*/i, '').trim();
  var icds = paIcdList();

  var errs = [];
  if (!paV('pa-last'))   errs.push('Patient last name is required');
  if (!paV('pa-first'))  errs.push('Patient first name is required');
  if (!callerName)       errs.push('Calling physician is required — search the directory');
  if (!icds.length)      errs.push('Tap at least one diagnosis pill (or search Other Dx)');
  if (!paV('pa-date'))   errs.push('Date of call is required');
  if (!paV('pa-time'))   errs.push('Time of call is required');
  if (!paV('pa-sex'))    errs.push('Sex is required');
  if (!paV('pa-advice')) errs.push('Summary of Phone Advice is required — it becomes the letter');
  var phn = paV('pa-phn');
  if (phn && (phn.length !== 10 || !paIsValidPHN(phn)))
    errs.push('PHN must be 10 digits with a valid check digit (or leave blank)');
  if (errs.length) { showToast(errs[0], 'error'); return; }

  var url = paGetUrl() || paAskUrl();
  if (!url) return;

  var summary =
    'Submit phone advice?\n\n' +
    'Patient: ' + paV('pa-last').toUpperCase() + ', ' + paV('pa-first') +
    (phn ? '  PHN ' + phn : '  ⚠️ NO PHN — will be flagged for billing review') + '\n' +
    'Caller: Dr. ' + callerName +
    (callerNum ? '  ✓ MSP #' + callerNum
               : '  ⚠️ NOT matched to directory — billing will need review') +
    (paV('pa-from') ? '\nFrom: ' + paV('pa-from') : '') + '\n' +
    'Dx: ' + icds.join('; ') + '\n' +
    'Fee: ' + paV('pa-fee') + '  ·  ' + paV('pa-date') + ' ' + paV('pa-time') + '\n' +
    'Discussed with: ' + paV('pa-doc') + '\n\n' +
    'This creates the claim AND queues the letter to the EMR.';
  if (!confirm(summary)) return;

  var data = {
    dateOfCall:   paV('pa-date'),
    timeOfCall:   paV('pa-time'),
    patientLast:  paV('pa-last'),
    patientFirst: paV('pa-first'),
    phn:          phn,
    dob:          paV('pa-dob'),
    gender:       paV('pa-sex'),
    oop:          false,
    homeProvince: '',
    homeHCN:      '',
    callingPhysician: callerName,
    callingFrom:  paV('pa-from') +
                  (paV('pa-phone') ? (paV('pa-from') ? ' | ' : '') + 'Call-back ' + paV('pa-phone') : ''),
    discussedWith: paV('pa-doc'),
    background:   '',                                  // v4.81: single-box form
    adviceGiven:  paV('pa-advice'),
    icd1:         icds[0] || '',
    icd2:         icds[1] || '',
    icd3:         icds[2] || '',
    icdExtra:     icds.slice(3).join('; '),
    feeCode:      paV('pa-fee') || '10001',
    // Directory match → MSP # straight onto the claim (server uses
    // manualRefNum verbatim). Unmatched → server name-match as before.
    manualRefName: callerNum ? callerName : '',
    manualRefNum:  callerNum,
    raceApproved: false,
    raceDetails:  '',
    source:       'BillingAppTab'
  };

  var btn = document.getElementById('pa-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  fetchWithTimeout(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
    body: JSON.stringify({ action: 'submitPhoneAdvice', key: SHARED_KEY, data: data })
  }, 45000, 'Phone advice submit')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(j) {
      btn.disabled = false;
      btn.textContent = 'Submit — letter + billing';
      if (j && j.ok) {
        paStatus('✓ Submitted: ' + ((j.result && j.result.message) || 'done') +
                 ' — letter queued, claim in billing.', 'ok');
        showToast('Phone advice submitted ✓', 'ok');
      } else {
        var msg = (j && (j.error || (j.result && j.result.error))) || 'Submission failed';
        // 'Unauthorized' → likely APP_PW mismatch on the PhoneAdvice project.
        paStatus('✗ ' + msg, 'err');
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Submit — letter + billing';
      paStatus('✗ ' + ((err && err.message) || 'Network error') +
               ' — nothing was saved. Retry, or use the webform.', 'err');
    });
}
