// ── 13d_consult_pdf.js ──
// ═══════════════════════════════════════════════════════
// v5.39 (2026-10-22): row button is now "📞 Consult" (was "📄 Consult") so
//   it reads as the phone-consult transcript (Kathryn). Icon only.
// v5.38 (2026-10-22): VIEW PHONE-CONSULT PDFs (new file).
//   A physician asked to read the phone-consult PDF (web form / QuickChart)
//   from inside the app. Every KCA doctor may read every consult PDF
//   (Kathryn 2026-10-22). The PDFs live in the admin@ Drive folder, which
//   doctors cannot open (single shared Google login), so the backend fetches
//   the file and the app shows it in its own full-screen viewer.
//   Backend: Router v3.26 + ConsultPdf.gs v1.0 (listConsultPdfs /
//   getConsultPdf). Residents never see these buttons (the backend refuses
//   them anyway).
//
//   WHERE THE LINK APPEARS
//   1. Add Patient — once a valid 10-digit PHN is entered (typed or OCR), the
//      app asks the backend for consult PDFs on that PHN (or surname + DOB).
//      If any exist, a small "Phone consult on file — View" banner appears
//      under the scan bar. Information only: it does not change the v5.03
//      silent-merge flow and asks nothing.
//   2. Discharged search rows and 3. Archive search rows — a "📄 Consult"
//      button on any patient who looks like a phone consult: added by the
//      web form / QuickChart (addedVia PhoneConsult*), or with a phone-advice
//      claim (10001 / 10002 / 78711 etc.) in the claims the app has loaded.
//      ⚠ A patient whose phone-advice claims have already been purged from
//      the Claims tab AND who was not created by a consult will not show the
//      button — the Add Patient banner (server lookup) still finds them.
//
//   VIEWER: PDF.js 3.11.174 from cdnjs, loaded only the first time a PDF is
//   opened, renders every page to canvas — the only approach that shows ALL
//   pages on iPhone (an iframe/embed shows page 1 only on iOS). If PDF.js
//   cannot load, the viewer falls back to an "Open PDF" button (blob URL).
//   "Open in new tab" is offered on every PDF for zoom / print on a computer.
//   Nothing is cached on the device; the PDF lives in memory until closed.
// ═══════════════════════════════════════════════════════

var CPDF_PDFJS_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var CPDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

var _cpdfState = { list: null, who: '', blobUrl: '', reqSeq: 0 };
var _cpdfBannerFor = '';      // PHN the Add-Patient banner lookup is for
var _cpdfBannerPdfs = null;   // its result, reused when the banner is tapped
var _cpdfJsPromise = null;

// ─── Backend calls ────────────────────────────────────────────────
function _cpdfGet(params) {
  var q = '?key=' + encodeURIComponent(SHARED_KEY) + '&_t=' + Date.now();
  Object.keys(params).forEach(function(k) {
    if (params[k] != null && params[k] !== '') q += '&' + k + '=' + encodeURIComponent(params[k]);
  });
  return fetch(SHEETS_URL + q).then(function(r) { return r.json(); }).then(function(j) {
    if (j && j.error === 'unauthorized') {
      if (typeof handleUnauthorized === 'function') handleUnauthorized();
      throw new Error('Not signed in');
    }
    if (!j || j.ok === false) throw new Error((j && j.error) || 'No response');
    return j;
  });
}

function _cpdfDob(dob) {
  var s = String(dob || '').trim();
  if (!s) return '';
  try { if (typeof dobNormDMY === 'function') return dobNormDMY(s) || s; } catch (e) {}
  return s;
}

function cpdfList(phn, last, dob) {
  return _cpdfGet({
    action: 'listConsultPdfs',
    phn:  String(phn || '').replace(/\s/g, ''),
    last: String(last || '').trim(),
    dob:  _cpdfDob(dob)
  }).then(function(j) { return j.pdfs || []; });
}

// ─── Heuristic for list rows ──────────────────────────────────────
function cpdfLikely(p, claims) {
  if (!p) return false;
  if (/^phoneconsult/i.test(String(p.addedVia || ''))) return true;
  if (typeof isPhoneAdviceClaim !== 'function' || !p.phn) return false;
  var pool = claims || (st && st.claims) || [];
  for (var i = 0; i < pool.length; i++) {
    var c = pool[i];
    if (c && samePhn(c.phn, p.phn) && isPhoneAdviceClaim(c)) return true;
  }
  return false;
}

// Button for a discharged / archive row. Empty for residents or non-consults.
function cpdfRowBtn(p, claims) {
  if ((typeof isResident === 'function' && isResident()) || !cpdfLikely(p, claims)) return '';
  return '<button class="bb" style="font-size:10px;padding:5px 9px" title="View phone consult transcript" ' +
    'data-phn="' + esc(String(p.phn || '')) + '" data-last="' + esc(String(p.last || '')) + '" ' +
    'data-dob="' + esc(String(p.dob || '')) + '" ' +
    'data-name="' + esc(String(p.last || '') + ', ' + String(p.first || '')) + '" ' +
    'onclick="event.stopPropagation();cpdfOpenFromBtn(this)">📞 Consult</button>';
}

function cpdfOpenFromBtn(el) {
  cpdfOpen({
    phn:  el.getAttribute('data-phn'),
    last: el.getAttribute('data-last'),
    dob:  el.getAttribute('data-dob'),
    name: el.getAttribute('data-name')
  });
}

// ─── Add Patient banner ───────────────────────────────────────────
// Called by validatePhnLive (09_patient.js) on a valid 10-digit PHN.
function cpdfCheckForPhn(digits) {
  if (typeof isResident === 'function' && isResident()) return;
  if (!SHEETS_URL || !SHARED_KEY) return;
  if (digits === _cpdfBannerFor) return;   // already looked up (or in flight) for this PHN
  cpdfClearBanner();
  _cpdfBannerFor = digits;
  var last = (document.getElementById('f-last') || {}).value || '';
  var dob  = (document.getElementById('f-dob')  || {}).value || '';
  cpdfList(digits, last, dob).then(function(pdfs) {
    var cur = String((document.getElementById('f-phn') || {}).value || '').replace(/\D/g, '');
    if (cur !== digits || _cpdfBannerFor !== digits || !pdfs.length) return;
    _cpdfBannerPdfs = pdfs;
    var bar = document.getElementById('ocr-bar');
    if (!bar || !bar.parentNode) return;
    var newest = pdfs[0];
    var div = document.createElement('div');
    div.id = 'cpdf-banner';
    div.style.cssText = 'margin-top:6px;padding:9px 10px;border-radius:8px;display:flex;align-items:center;' +
      'justify-content:space-between;gap:8px;background:var(--teal-bg);border:1px solid var(--teal);color:var(--teal-t)';
    div.innerHTML =
      '<div style="font-size:12px;line-height:1.35"><b>Phone consult on file</b><br>' +
        esc(_cpdfDate(newest.date)) + (pdfs.length > 1 ? ' &middot; ' + pdfs.length + ' PDFs' : '') + '</div>' +
      '<button type="button" class="btn btn-s" style="margin:0;padding:6px 12px;font-size:12px;white-space:nowrap" ' +
        'onclick="cpdfOpenBanner()">View Phone Consult</button>';
    // After the "already on the list" banner if present, else under the scan bar
    var anchor = document.getElementById('existing-pt-banner') || bar;
    anchor.parentNode.insertBefore(div, anchor.nextSibling);
  }).catch(function() { /* silent — information only */ });
}

function cpdfOpenBanner() {
  var last = (document.getElementById('f-last') || {}).value || '';
  var first = (document.getElementById('f-first') || {}).value || '';
  cpdfOpen({ phn: _cpdfBannerFor, name: last + (first ? ', ' + first : '') }, _cpdfBannerPdfs);
}

function cpdfClearBanner() {
  var el = document.getElementById('cpdf-banner');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  _cpdfBannerFor = '';
  _cpdfBannerPdfs = null;
}

// ─── Viewer ───────────────────────────────────────────────────────
function _cpdfDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(iso || '');
}

function _cpdfShell() {
  var ov = document.getElementById('cpdf-viewer');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'cpdf-viewer';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9800;display:none;flex-direction:column;background:#525659';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top));' +
      'background:var(--surface);border-bottom:1px solid var(--border2)">' +
      '<button type="button" id="cpdf-back" class="btn btn-s" style="margin:0;padding:6px 10px;font-size:12px;display:none" onclick="cpdfShowList()">&#8249; List</button>' +
      '<div id="cpdf-title" style="flex:1;min-width:0;font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
      '<button type="button" id="cpdf-newtab" class="btn btn-s" style="margin:0;padding:6px 10px;font-size:12px;display:none" onclick="cpdfNewTab()">Open in new tab</button>' +
      '<button type="button" class="btn btn-p" style="margin:0;padding:6px 12px;font-size:12px" onclick="cpdfClose()">Close</button>' +
    '</div>' +
    '<div id="cpdf-body" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 8px calc(16px + env(safe-area-inset-bottom))"></div>';
  document.body.appendChild(ov);
  return ov;
}

function _cpdfMsg(html) {
  var b = document.getElementById('cpdf-body');
  if (b) b.innerHTML = '<div style="max-width:480px;margin:40px auto;padding:16px;border-radius:10px;background:var(--surface);' +
    'color:var(--text);font-size:13px;text-align:center;line-height:1.45">' + html + '</div>';
}

function _cpdfSetHeader(title, showBack, showNewTab) {
  var t = document.getElementById('cpdf-title'); if (t) t.textContent = title;
  var b = document.getElementById('cpdf-back');  if (b) b.style.display = showBack ? '' : 'none';
  var n = document.getElementById('cpdf-newtab'); if (n) n.style.display = showNewTab ? '' : 'none';
}

// o = { phn, last, dob, name }; pdfs = optional list already fetched
function cpdfOpen(o, pdfs) {
  o = o || {};
  var ov = _cpdfShell();
  ov.style.display = 'flex';
  _cpdfRevoke();
  _cpdfState.who = String(o.name || '').replace(/^,\s*|,\s*$/g, '') || 'Phone consult';
  _cpdfState.list = null;
  var seq = ++_cpdfState.reqSeq;
  _cpdfSetHeader(_cpdfState.who, false, false);
  var got = pdfs ? Promise.resolve(pdfs) : (_cpdfMsg('Finding phone consult&hellip;'), cpdfList(o.phn, o.last, o.dob));
  got.then(function(list) {
    if (seq !== _cpdfState.reqSeq) return;
    _cpdfState.list = list;
    if (!list.length) { _cpdfMsg('No phone-consult PDF found for <b>' + esc(_cpdfState.who) + '</b>.'); return; }
    if (list.length === 1) { cpdfShowPdf(0); return; }
    cpdfShowList();
  }).catch(function(e) {
    if (seq !== _cpdfState.reqSeq) return;
    _cpdfMsg('Could not look up the consult PDF &mdash; ' + esc(e && e.message || 'network error') + '.<br>Check connection and try again.');
  });
}

function cpdfShowList() {
  var list = _cpdfState.list || [];
  _cpdfRevoke();
  _cpdfState.reqSeq++;
  _cpdfSetHeader(_cpdfState.who, false, false);
  var b = document.getElementById('cpdf-body');
  if (!b) return;
  b.innerHTML = '<div style="max-width:520px;margin:8px auto">' +
    '<div style="color:#fff;font-size:12px;margin:0 4px 8px">' + list.length + ' phone-consult PDFs &mdash; newest first</div>' +
    list.map(function(p, i) {
      return '<button type="button" onclick="cpdfShowPdf(' + i + ')" style="display:block;width:100%;text-align:left;margin:0 0 8px;' +
        'padding:12px;border-radius:10px;border:none;background:var(--surface);color:var(--text);font-family:inherit;cursor:pointer">' +
        '<div style="font-weight:700;font-size:13px">' + esc(_cpdfDate(p.date)) + ' &middot; ' + esc(p.type || 'Phone consult') + '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(p.last) + ', ' + esc(p.first) +
          (p.match === 'name+dob' ? ' &middot; <span style="color:var(--amber-t)">matched on name + DOB (PHN differs)</span>' : '') +
        '</div></button>';
    }).join('') + '</div>';
}

function cpdfShowPdf(i) {
  var p = (_cpdfState.list || [])[i];
  if (!p) return;
  var multi = (_cpdfState.list || []).length > 1;
  var seq = ++_cpdfState.reqSeq;
  _cpdfRevoke();
  _cpdfSetHeader(_cpdfDate(p.date) + ' · ' + _cpdfState.who, multi, false);
  _cpdfMsg('Loading PDF&hellip;');
  _cpdfGet({ action: 'getConsultPdf', id: p.id }).then(function(j) {
    if (seq !== _cpdfState.reqSeq) return;
    var bin = atob(j.b64), bytes = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    _cpdfState.blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    _cpdfSetHeader(_cpdfDate(p.date) + ' · ' + _cpdfState.who, multi, true);
    return _cpdfRender(bytes, seq);
  }).catch(function(e) {
    if (seq !== _cpdfState.reqSeq) return;
    if (_cpdfState.blobUrl) {
      // PDF arrived but PDF.js could not draw it — offer the browser's own viewer.
      _cpdfMsg('Could not display the PDF in the app.<br><br>' +
        '<button type="button" class="btn btn-p" style="margin:0" onclick="cpdfNewTab()">Open PDF</button>');
    } else {
      _cpdfMsg('Could not load the PDF &mdash; ' + esc(e && e.message || 'network error') + '.<br>Check connection and try again.');
    }
  });
}

function _cpdfLoadJs() {
  if (_cpdfJsPromise) return _cpdfJsPromise;
  var loaded = window.pdfjsLib ? Promise.resolve() : new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = CPDF_PDFJS_URL;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('PDF viewer could not be downloaded')); };
    document.head.appendChild(s);
  });
  _cpdfJsPromise = loaded.then(function() {
    var lib = window.pdfjsLib;
    if (!lib || !lib.GlobalWorkerOptions) throw new Error('PDF viewer did not load');
    if (lib.GlobalWorkerOptions.workerSrc) return lib;
    // Same-origin blob wrapper for the worker (a cross-origin Worker URL is
    // refused by the browser); falls back to the direct URL.
    return fetch(CPDF_WORKER_URL).then(function(r) {
      if (!r.ok) throw new Error('worker ' + r.status);
      return r.text();
    }).then(function(txt) {
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
    }).catch(function() {
      lib.GlobalWorkerOptions.workerSrc = CPDF_WORKER_URL;
    }).then(function() { return lib; });
  }).catch(function(e) { _cpdfJsPromise = null; throw e; });
  return _cpdfJsPromise;
}

function _cpdfRender(bytes, seq) {
  return _cpdfLoadJs().then(function(lib) {
    return lib.getDocument({ data: bytes }).promise;
  }).then(function(doc) {
    if (seq !== _cpdfState.reqSeq) return;
    var body = document.getElementById('cpdf-body');
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:900px;margin:0 auto';
    body.appendChild(wrap);
    var width = Math.min(body.clientWidth - 16, 900);
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var chain = Promise.resolve();
    for (var n = 1; n <= doc.numPages; n++) {
      (function(n) {
        chain = chain.then(function() {
          if (seq !== _cpdfState.reqSeq) return;
          return doc.getPage(n).then(function(page) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: (width / base.width) * dpr });
            var c = document.createElement('canvas');
            c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            c.style.cssText = 'display:block;width:100%;height:auto;margin:0 0 10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
            wrap.appendChild(c);
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          });
        });
      })(n);
    }
    return chain;
  });
}

function cpdfNewTab() {
  if (!_cpdfState.blobUrl) return;
  var w = window.open(_cpdfState.blobUrl, '_blank');
  if (!w) showToast('Pop-up blocked — allow pop-ups for this site', 'error');
}

function _cpdfRevoke() {
  if (_cpdfState.blobUrl) {
    var u = _cpdfState.blobUrl;
    _cpdfState.blobUrl = '';
    // Delay so a just-opened tab has time to load it.
    setTimeout(function() { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000);
  }
}

function cpdfClose() {
  _cpdfState.reqSeq++;
  _cpdfRevoke();
  var b = document.getElementById('cpdf-body'); if (b) b.innerHTML = '';
  var ov = document.getElementById('cpdf-viewer'); if (ov) ov.style.display = 'none';
}
