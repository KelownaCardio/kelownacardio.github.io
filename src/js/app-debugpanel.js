// ── Debug panel show/hide ──────────────────────────────
function dbgToggle(expand) {
  var pill  = document.getElementById('kgh-debug-pill');
  var panel = document.getElementById('kgh-debug-panel');
  if (!pill || !panel) return;
  if (expand) {
    pill.style.display  = 'none';
    panel.style.display = 'block';
    try { localStorage.setItem('kgh:dbg-expanded', '1'); } catch (e) {}
  } else {
    pill.style.display  = 'inline-flex';
    panel.style.display = 'none';
    try { localStorage.setItem('kgh:dbg-expanded', '0'); } catch (e) {}
  }
}

// Activate debug panel if URL has ?debug=1
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get('debug') !== '1') return;

    // Show pill or panel based on last-saved preference (default: minimized)
    var wasExpanded = false;
    try { wasExpanded = localStorage.getItem('kgh:dbg-expanded') === '1'; } catch (e) {}
    dbgToggle(wasExpanded);

    var pill   = document.getElementById('dbg-engine-pill');
    var pillText = document.getElementById('dbg-pill-text');

    function paintPill() {
      if (pill) { pill.textContent = 'Apps Script OCR'; pill.style.background = '#1f3d2f'; }
      if (pillText) pillText.textContent = 'debug';
    }

    paintPill();

    // Tap status area to see full parser log
    document.getElementById('dbg-status').addEventListener('click', function() {
      if (!window._lastOCR) return;
      var meta = window._lastOCR._meta || {};
      var log = (meta.parseLog || []).join('\n');
      alert((log || '(no parser log — cloud engine)') +
            '\n\n--- raw OCR text ---\n' + (meta.rawText || '(none)'));
    });
  } catch (e) {
    console.error('Debug panel init failed:', e);
  }
})();

function dbgSetStatus(msg) {
  var el = document.getElementById('dbg-status');
  if (el) el.textContent = msg;
  // Also briefly show a notification dot on the minimized pill
  var pillText = document.getElementById('dbg-pill-text');
  if (pillText && document.getElementById('kgh-debug-pill').style.display !== 'none') {
    var prev = pillText.textContent;
    pillText.textContent = '● new';
    setTimeout(function() {
      if (pillText.textContent === '● new') pillText.textContent = prev;
    }, 2500);
  }
}

// Hook into handleOCRResult so the panel updates after every scan
(function () {
  if (typeof handleOCRResult !== 'function') return;
  var orig = handleOCRResult;
  window.handleOCRResult = function(data, bar) {
    var result = orig.apply(this, arguments);
    // Only run debug work if the pill/panel are present (i.e. ?debug=1)
    var panel = document.getElementById('kgh-debug-panel');
    var pill  = document.getElementById('kgh-debug-pill');
    if (!panel || (panel.style.display === 'none' && pill.style.display === 'none')) return result;

    var p = window._lastOCR || {};
    var meta = p._meta || {};
    var bits = [];
    bits.push((p._engine || '?') + ' / ' + (meta.stickerType || 'n/a'));
    bits.push('last=' + (p.last  || '∅'));
    bits.push('first='+ (p.first || '∅'));
    bits.push('phn='  + (p.phn   || '∅'));
    bits.push('dob='  + (p.dob   || '∅'));
    if (meta.flags) {
      var flagged = Object.keys(meta.flags).filter(function(k){ return meta.flags[k]; });
      if (flagged.length) bits.push('flags: ' + flagged.join(','));
    }
    dbgSetStatus(bits.join(' · ') + '\n\n[tap for parser log]');
    return result;
  };
})();

function dbgShowLast() {
  if (!window._lastOCR) { dbgSetStatus('No scan yet. Tap photograph in Add Patient.'); return; }
  var p = window._lastOCR;
  var meta = p._meta || {};
  var summary = JSON.stringify({
    engine:      p._engine,
    stickerType: meta.stickerType,
    last:        p.last,
    first:       p.first,
    phn:         p.phn,
    dob:         p.dob,
    sex:         p.sex,
    mrp:         p.mrp,
    ward:        p.ward,
    room:        p.room,
    flags:       meta.flags
  }, null, 2);
  alert('OCR RESULT\n\n' + summary +
        '\n\n--- parser log ---\n' + ((meta.parseLog || []).join('\n') || '(none)'));
}

function dbgCopyLast() {
  if (!window._lastOCR) { dbgSetStatus('Nothing to copy yet.'); return; }
  var bundle = {
    timestamp:    new Date().toISOString(),
    appVersion:   (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown'),
    userAgent:    navigator.userAgent,
    lastOCR:      window._lastOCR,
    ocrOriginal:  window._ocrOriginal || null
  };
  var text = JSON.stringify(bundle, null, 2);

  function done() {
    dbgSetStatus('✓ Copied ' + text.length + ' chars. Paste into chat.');
  }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { dbgSetStatus('Copy failed. Use console: copy(JSON.stringify(window._lastOCR))'); }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}
