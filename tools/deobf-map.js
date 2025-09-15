#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '..', 'obfuscated.js');
const OUT_DIR = path.resolve(__dirname, '..', 'out');
const MAP_JSON = path.join(OUT_DIR, 'class-map.json');
const ANNOTATED = path.join(OUT_DIR, 'obfuscated.annotated.js');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function extractClasses(src) {
  const map = [];
  const re = /var\s+([A-Za-z_$][\w$]*)\s*=\s*Ufb\(([^,]+),\s*'([^']+)'\s*,\s*(\d+)\);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const sym = m[1];
    const pkg = m[2].trim();
    const name = m[3];
    const classId = Number(m[4]);
    map.push({ symbol: sym, package: pkg, name, classId, index: m.index });
  }
  return map;
}

function extractAHBlocks(src) {
  // aH(classId, ... , ConstructorName, [optional more])
  const blocks = [];
  const re = /aH\((\d+)\s*,[^,]*,[^,]*,\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ classId: Number(m[1]), ctor: m[2], index: m.index });
  }
  return blocks;
}

function buildMap(src) {
  const classes = extractClasses(src);
  const ah = extractAHBlocks(src);
  const idToCtor = new Map();
  for (const b of ah) idToCtor.set(b.classId, b.ctor);
  for (const c of classes) c.ctor = idToCtor.get(c.classId) || null;
  return classes;
}

function annotate(src, classes) {
  // Insert brief comment headers before each class registration.
  const inserts = classes
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(c => ({
      index: c.index,
      text: `/* GWT Class: ${c.name} (id ${c.classId}) symbol ${c.symbol} ctor ${c.ctor ?? 'unknown'} */\n`
    }));
  let offset = 0;
  let out = src;
  for (const ins of inserts) {
    out = out.slice(0, ins.index + offset) + ins.text + out.slice(ins.index + offset);
    offset += ins.text.length;
  }
  return out;
}

function main() {
  const src = fs.readFileSync(INPUT, 'utf8');
  const classes = buildMap(src);
  ensureDir(OUT_DIR);
  fs.writeFileSync(MAP_JSON, JSON.stringify(classes, null, 2));
  const annotated = annotate(src, classes);
  fs.writeFileSync(ANNOTATED, annotated);
  console.log(`Extracted ${classes.length} classes.`);
  // Print a few key classes if present
  const keys = ['Board', 'Rack', 'Move', 'Tile', 'BoardValues', 'Anchor'];
  for (const k of keys) {
    const hit = classes.find(c => c.name === k);
    if (hit) console.log(`${k}: symbol=${hit.symbol} id=${hit.classId} ctor=${hit.ctor || 'unknown'}`);
  }
}

if (require.main === module) {
  main();
}


