#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '..', 'obfuscated.js');
const MAP_JSON = path.resolve(__dirname, '..', 'out', 'class-map.json');
const OUT_DIR = path.resolve(__dirname, '..', 'out');
const OUTPUT = path.join(OUT_DIR, 'deobfuscated.js');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function loadMap() {
  const map = JSON.parse(fs.readFileSync(MAP_JSON, 'utf8'));
  // Build symbol->readable map for core classes and ctors
  const rename = new Map();
  for (const c of map) {
    // Class symbol var name -> ClassName
    if (/^[A-Za-z_$][\w$]*$/.test(c.symbol) && /^[A-Za-z][\w/ ]*$/.test(c.name)) {
      // Sanitize name to JS identifier (replace spaces and slashes)
      const id = c.name.replace(/[\s/]+/g, '_');
      rename.set(c.symbol, id);
    }
    // Constructor function -> ClassName (if simple)
    if (c.ctor && /^[A-Za-z_$][\w$]*$/.test(c.ctor)) {
      const id = c.name.replace(/[\s/]+/g, '_');
      rename.set(c.ctor, id);
    }
  }
  return rename;
}

function buildRegex(symbols) {
  // Whole-identifier replacements only
  const escaped = symbols.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  // Create one big alternation; use \b around to limit to identifiers
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
}

function main() {
  const src = fs.readFileSync(INPUT, 'utf8');
  const rename = loadMap();

  // Produce a stable ordering: longer names first to avoid shadowing (though \b should help)
  const entries = Array.from(rename.entries()).sort((a, b) => b[0].length - a[0].length);
  ensureDir(OUT_DIR);

  let out = src;
  // Chunked replacement to avoid massive regex backtracking
  const batchSize = 200;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const regex = buildRegex(batch.map(([k]) => k));
    out = out.replace(regex, (m) => {
      const rep = rename.get(m);
      return rep || m;
    });
  }

  fs.writeFileSync(OUTPUT, out);
  console.log(`Renamed ${entries.length} identifiers. Wrote ${OUTPUT}`);
}

if (require.main === module) main();


