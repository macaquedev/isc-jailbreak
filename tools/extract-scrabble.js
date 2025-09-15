#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '..', 'obfuscated.js');
const OUT_DIR = path.resolve(__dirname, '..', 'out');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const src = fs.readFileSync(INPUT, 'utf8');

// Extract BoardValues matrix from function qZ() new arrays literal (15x15 multipliers)
function extractBoardValues() {
  const qzIdx = src.indexOf('function qZ()');
  if (qzIdx === -1) return null;
  const body = src.slice(qzIdx, qzIdx + 4000);
  // capture all 15 arrays inside Pt(Ht(wu, 1), $rb, 44, 15, [ ... ])
  const rowRe = /\[\s*(?:-?\d+\s*,\s*)*-?\d+\s*\]/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(body)) !== null && rows.length < 15) {
    const arr = JSON.parse(m[0]);
    if (arr.length === 15) rows.push(arr);
  }
  if (rows.length === 15) return rows;
  return null;
}

// Extract tile distributions from Y7() where new $7(letterCode, points, count)
function extractTileDistributions() {
  const y7Idx = src.indexOf('function Y7()');
  if (y7Idx === -1) return null;
  const body = src.slice(y7Idx, y7Idx + 6000);
  // Find arrays of new $7(a,b,c)
  const bagRe = /\[\s*(?:new \$7\((\d+),(\d+),(\d+)\)\s*,\s*)*new \$7\((\d+),(\d+),(\d+)\)\s*\]/g;
  const bags = [];
  let m;
  while ((m = bagRe.exec(body)) !== null && bags.length < 5) {
    const text = m[0];
    const tiles = [];
    const tRe = /new \$7\((\d+),(\d+),(\d+)\)/g;
    let t;
    while ((t = tRe.exec(text)) !== null) {
      const code = Number(t[1]);
      const points = Number(t[2]);
      const count = Number(t[3]);
      tiles.push({ code, letter: String.fromCharCode(code), points, count });
    }
    if (tiles.length) bags.push(tiles);
  }
  return bags.length ? bags : null;
}

function main() {
  ensureDir(OUT_DIR);
  const board = extractBoardValues();
  if (board) {
    fs.writeFileSync(path.join(OUT_DIR, 'board-values.json'), JSON.stringify(board, null, 2));
    console.log('BoardValues: 15x15 matrix extracted');
  } else {
    console.log('BoardValues: not found');
  }
  const bags = extractTileDistributions();
  if (bags) {
    fs.writeFileSync(path.join(OUT_DIR, 'tile-bags.json'), JSON.stringify(bags, null, 2));
    console.log(`Tile distributions: extracted ${bags.length} bag variants`);
  } else {
    console.log('Tile distributions: not found');
  }
}

if (require.main === module) main();


