// ═══════════════════════════════════════════════════════════════════
// KGH Cardiology Billing — build.js
// Concatenates the modular source in src/ back into a single index.html.
//
// Usage:  node build.js
//
// src/index.template.html contains two kinds of marker comment:
//
//   <!--KGHBUILDDIR:name-->   replaced by one <script> wrapping ALL .js
//                             files in src/js/name/, concatenated in
//                             filename order (00_*, 01_*, 02_* ...).
//
//   <!--KGHBUILD:file.js-->   replaced by one <script> wrapping the
//                             single file src/js/file.js.
//
// Pure substitution, no transformation — the rebuilt index.html is
// byte-identical to the original.
// ═══════════════════════════════════════════════════════════════════

var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

var ROOT     = __dirname;
var TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
var JS_DIR   = path.join(ROOT, 'src', 'js');
var OUTPUT   = path.join(ROOT, 'index.html');

function build() {
  var html = fs.readFileSync(TEMPLATE, 'utf8');
  var used = [];

  // Directory markers — all .js in src/js/<dir>/, sorted, one <script>.
  html = html.replace(/<!--KGHBUILDDIR:([^>]+?)-->/g, function (_m, dir) {
    dir = dir.trim();
    var full = path.join(JS_DIR, dir);
    if (!fs.existsSync(full)) {
      throw new Error('build.js: missing source folder src/js/' + dir);
    }
    var files = fs.readdirSync(full)
                  .filter(function (f) { return /\.js$/.test(f); })
                  .sort();
    if (!files.length) {
      throw new Error('build.js: no .js files in src/js/' + dir);
    }
    var code = files.map(function (f) {
      used.push(dir + '/' + f);
      return fs.readFileSync(path.join(full, f), 'utf8');
    }).join('');
    return '<script>' + code + '</script>';
  });

  // Single-file markers.
  html = html.replace(/<!--KGHBUILD:([^>]+?)-->/g, function (_m, name) {
    name = name.trim();
    var file = path.join(JS_DIR, name);
    if (!fs.existsSync(file)) {
      throw new Error('build.js: missing source file src/js/' + name);
    }
    used.push(name);
    return '<script>' + fs.readFileSync(file, 'utf8') + '</script>';
  });

  if (!used.length) {
    throw new Error('build.js: no KGHBUILD markers found in template');
  }

  console.log('Built index.html from ' + used.length + ' module(s):');
  used.forEach(function (n) { console.log('  - src/js/' + n); });

  // ── Content hash — the thing that makes updates automatic ────────
  // 2026-09-02. Until now version.json carried only APP_VERSION, so a
  // deploy that nobody remembered to hand-bump was INVISIBLE to every
  // device: the client compared version strings, saw no change, and never
  // prompted. That is a safety fix silently not reaching the doctors, and
  // it is not a discipline problem to solve with a checklist — the build
  // knows perfectly well whether the code changed.
  //
  // So: hash the built HTML. Any change to any src file changes the hash,
  // and the client (14_init.js, v5.11+) arms a mandatory update on a hash
  // mismatch. APP_VERSION becomes a human-readable label, not the
  // mechanism. Hashing BEFORE the stamp is injected keeps it stable and
  // independent of its own value.
  var buildHash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);

  var verMatch   = html.match(/var\s+APP_VERSION\s*=\s*'([^']+)'/);
  var buildMatch = html.match(/var\s+BUILD_ID\s*=\s*'([^']+)'/);
  if (!verMatch) {
    throw new Error('build.js: APP_VERSION not found in built index.html — cannot write version.json');
  }

  // Inject the stamp so the running app knows which build it IS. Placed
  // last so it is defined before any deferred code reads it, and guarded
  // in the client with typeof for builds that predate this.
  // MUST be lastIndexOf + splice, never String.replace(). replace() with a
  // string pattern hits the FIRST match, and the app's own JavaScript builds
  // an HTML document as a string (the QuickChart export) which contains a
  // literal </body>. Injecting there put a <script> tag inside a JS string
  // literal, which closed the real script early and dumped the rest of the
  // app onto the page as visible text — the whole app dead, 2026-09-02.
  // The real closing tag is the LAST one in the document.
  var stampTag = '<script>var BUILD_HASH = ' + JSON.stringify(buildHash) + ';</script>';
  var _bodyIdx = html.lastIndexOf('</body>');
  if (_bodyIdx !== -1) {
    html = html.slice(0, _bodyIdx) + stampTag + html.slice(_bodyIdx);
  } else {
    html += stampTag;
  }
  fs.writeFileSync(OUTPUT, html);

  // ── Emit version.json ────────────────────────────────────────────
  // The app fetches this tiny file to detect a newer deploy. Single source
  // of truth: read straight out of the just-built index.html, so the file
  // can never drift from the running app.
  var versionPayload = {
    version: verMatch[1],
    buildId: buildMatch ? buildMatch[1] : verMatch[1],
    hash:    buildHash
  };
  var VERSION_OUT = path.join(ROOT, 'version.json');
  // Read the committed version.json BEFORE overwriting it. The CI checkout
  // carries it, so this works on every run — an earlier draft used a scratch
  // .prev file, which CI never commits and so never sees. Compare first,
  // write second.
  var prevPayload = null;
  try { prevPayload = JSON.parse(fs.readFileSync(VERSION_OUT, 'utf8')); } catch (e) {}
  fs.writeFileSync(VERSION_OUT, JSON.stringify(versionPayload) + '\n');
  console.log('Wrote version.json → ' + versionPayload.version +
              ' (buildId ' + versionPayload.buildId + ', hash ' + buildHash + ')');

  // ── Stamp the service worker's cache key ─────────────────────────
  // sw.js is hand-maintained and its CACHE_VERSION had not been bumped
  // since v3.26 while the app reached v5.10 — against the instruction in
  // its own header. index.html is network-first so this did not cause the
  // stale-version incident, but ocr_offline.js is in the cache-first SHELL
  // and was therefore frozen on every device at whatever it first cached.
  // Derive it from the hash so it can never be forgotten again.
  var SW = path.join(ROOT, 'sw.js');
  if (fs.existsSync(SW)) {
    var sw = fs.readFileSync(SW, 'utf8');
    var swRe = /(var\s+CACHE_VERSION\s*=\s*')([^']*)(')/;
    if (swRe.test(sw)) {
      var before = sw.match(swRe)[2];
      var after  = verMatch[1] + '-' + buildHash;
      if (before !== after) {
        fs.writeFileSync(SW, sw.replace(swRe, '$1' + after + '$3'));
        console.log('Stamped sw.js CACHE_VERSION → ' + after + ' (was ' + before + ')');
      }
    } else {
      console.warn('build.js: CACHE_VERSION not found in sw.js — cache key NOT stamped');
    }
  } else {
    console.warn('build.js: sw.js not found — cache key NOT stamped');
  }

  // ── Advisory: content changed but the label did not ──────────────
  // Not fatal — the hash makes the update work regardless. This only keeps
  // the footer version meaningful to a human reading a build log. Requires
  // prev.hash, so the first build after this change stays quiet instead of
  // warning about a version.json that predates hashing.
  if (prevPayload && prevPayload.hash &&
      prevPayload.hash !== buildHash &&
      prevPayload.version === versionPayload.version) {
    console.warn('build.js: NOTE — code changed but APP_VERSION is still ' +
                 versionPayload.version + '. Devices WILL update (hash differs); ' +
                 'consider bumping APP_VERSION so the footer means something.');
  }
}

build();
