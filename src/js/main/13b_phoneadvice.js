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
// ═══════════════════════════════════════════════════════════════════

var PA_URL_LS_KEY = 'kgh5:paUrl';

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

    // ── Caller ──
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">CALLER</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>Calling physician</label>' +
        '<input id="pa-caller" autocorrect="off" autocapitalize="words" placeholder="e.g. Veale"></div>' +
      '<div class="f1"><label>MSP # (optional)</label>' +
        '<input id="pa-refnum" inputmode="numeric" placeholder="blank = auto-match"></div>' +
    '</div>' +
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

    // ── Clinical ──
    '<div style="font-size:12px;font-weight:800;color:var(--text3);margin:10px 0 2px">CLINICAL</div>' +
    '<div class="fl">' +
      '<div class="f1"><label>ICD-9 (primary)</label><input id="pa-icd1" autocorrect="off" placeholder="e.g. 427.31"></div>' +
      '<div class="f1"><label>ICD-9 (optional)</label><input id="pa-icd2" autocorrect="off"></div>' +
    '</div>' +
    '<label>Background</label>' +
    '<textarea id="pa-bg" rows="2" style="width:100%;padding:8px;border:.5px solid var(--border2);' +
      'border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical" ' +
      'placeholder="Brief clinical context"></textarea>' +
    '<label>Advice given</label>' +
    '<textarea id="pa-advice" rows="4" style="width:100%;padding:8px;border:.5px solid var(--border2);' +
      'border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical" ' +
      'placeholder="Tap the mic on your keyboard to dictate the advice given"></textarea>' +

    '<div style="margin:8px 0 4px;font-size:11px;color:var(--text3);line-height:1.5">' +
      'Out-of-Province or RACE case? Use the full phone advice webform — this beta form is BC/MSP only.</div>' +

    '<button class="btn" style="width:100%;margin-top:6px;background:var(--blue);color:#fff;font-weight:800" ' +
      'onclick="paSubmit()" id="pa-submit-btn">Submit — letter + billing</button>' +
    '<div id="pa-status" style="display:none;margin-top:8px;padding:8px 10px;border-radius:6px;' +
      'font-size:13px;font-weight:600;line-height:1.4"></div>';

  paPhoneLink();
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
  set('pa-caller', p.callerName);
  set('pa-from',   p.facility);
  set('pa-phone',  p.phone);
  set('pa-last',   p.patientLast);
  set('pa-first',  p.patientFirst);
  set('pa-phn',    String(p.phn || '').replace(/\D/g, ''));
  if (p.dob && /^\d{4}-\d{2}-\d{2}$/.test(String(p.dob).trim())) set('pa-dob', String(p.dob).trim());
  paPhnLive();
  paPhoneLink();
  var got = ['pa-caller', 'pa-phone', 'pa-last', 'pa-phn'].filter(function(id) { return paV(id); }).length;
  if (bar) {
    bar.className = 'ocr-bar ' + (got >= 2 ? 'ocr-ok' : 'ocr-warn');
    bar.textContent = got >= 2
      ? '✓ Extracted — check every field against the screenshot before calling'
      : '⚠️ Little data found — type the details from the screenshot';
  }
}

// ── Submit ─────────────────────────────────────────────────────────
function paSubmit() {
  var errs = [];
  if (!paV('pa-last'))   errs.push('Patient last name is required');
  if (!paV('pa-first'))  errs.push('Patient first name is required');
  if (!paV('pa-caller')) errs.push('Calling physician is required');
  if (!paV('pa-date'))   errs.push('Date of call is required');
  if (!paV('pa-time'))   errs.push('Time of call is required');
  if (!paV('pa-sex'))    errs.push('Sex is required');
  if (!paV('pa-advice')) errs.push('Advice given is required — it becomes the letter');
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
    'Caller: Dr. ' + paV('pa-caller') + (paV('pa-from') ? ' (' + paV('pa-from') + ')' : '') + '\n' +
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
    callingPhysician: paV('pa-caller'),
    callingFrom:  paV('pa-from') +
                  (paV('pa-phone') ? (paV('pa-from') ? ' | ' : '') + 'Call-back ' + paV('pa-phone') : ''),
    discussedWith: paV('pa-doc'),
    background:   paV('pa-bg'),
    adviceGiven:  paV('pa-advice'),
    icd1:         paV('pa-icd1'),
    icd2:         paV('pa-icd2'),
    icd3:         '',
    icdExtra:     '',
    feeCode:      paV('pa-fee') || '10001',
    manualRefName: paV('pa-refnum') ? paV('pa-caller') : '',
    manualRefNum:  paV('pa-refnum'),
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
