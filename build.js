// ═══════════════════════════════════════════════════════════════════
// KGH Cardiology Billing — build.js
// Concatenates the modular source in src/ back into a single index.html.
//
// Usage:  node build.js
//
// How it works: src/index.template.html contains marker comments of the
// form <!--KGHBUILD:filename.js-->. Each marker is replaced with a
// <script> element wrapping the contents of src/js/filename.js.
// Output is written to ./index.html.
//
// Phase 1 build: pure substitution, no transformation — the rebuilt
// index.html is byte-identical to the original. (BUILD_ID auto-stamping
// can be added later, once the pipeline is trusted.)
// ═══════════════════════════════════════════════════════════════════

var fs   = require('fs');
var path = require('path');

var ROOT     = __dirname;
var TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
var JS_DIR   = path.join(ROOT, 'src', 'js');
var OUTPUT   = path.join(ROOT, 'index.html');

function build() {
  var html = fs.readFileSync(TEMPLATE, 'utf8');
  var used = [];

  html = html.replace(/<!--KGHBUILD:([^>]+?)-->/g, function (_match, name) {
    name = name.trim();
    var file = path.join(JS_DIR, name);
    if (!fs.existsSync(file)) {
      throw new Error('build.js: missing source file src/js/' + name);
    }
    used.push(name);
    var code = fs.readFileSync(file, 'utf8');
    return '<script>' + code + '</script>';
  });

  if (!used.length) {
    throw new Error('build.js: no <!--KGHBUILD:...--> markers found in template');
  }

  fs.writeFileSync(OUTPUT, html);
  console.log('Built index.html from ' + used.length + ' module(s):');
  used.forEach(function (n) { console.log('  - src/js/' + n); });
}

build();
