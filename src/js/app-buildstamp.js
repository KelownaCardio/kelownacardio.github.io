
(function () {
  try {
    if (typeof APP_VERSION === 'undefined') return;
    var foot = document.getElementById('kgh-build-stamp-text');
    if (foot) foot.textContent = APP_VERSION + ' · built ' + APP_BUILT;
    // Keep header badge in sync — single source of truth (APP_VERSION).
    var hdr = document.getElementById('hdr-version');
    if (hdr) hdr.textContent = APP_VERSION;
  } catch (e) {}
})();
