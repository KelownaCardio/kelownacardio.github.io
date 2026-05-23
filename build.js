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

var fs   = require('fs');
var path = require('path');

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

  fs.writeFileSync(OUTPUT, html);
  console.log('Built index.html from ' + used.length + ' module(s):');
  used.forEach(function (n) { console.log('  - src/js/' + n); });
}

build();
