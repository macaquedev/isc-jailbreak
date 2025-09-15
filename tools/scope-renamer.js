#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'out', 'deobfuscated.js');

// Renaming preferences for parameters and local variables
const paramRename = new Map([
  ['Collections_UnmodifiableSet', 'ctx'],
  ['DeckLayoutPanel', 'index'],
  ['MenuBar', 'value'],
]);

const localRename = new Map([
  ['DeckLayoutPanel', 'i'],
  ['MenuBar', 'j'],
]);

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function replaceIdentifiersInRange(src, start, end, mapping) {
  // Skip strings and simple comments, perform whole-word replacement not preceded by '.'
  let out = '';
  let i = start;
  const isWordStart = (s, pos) => !isIdentChar(s[pos - 1] || '') && isIdentChar(s[pos] || '');
  const isWordEnd = (s, pos, len) => !isIdentChar(s[pos + len] || '');
  while (i < end) {
    const ch = src[i];
    // Handle strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch; i++;
      while (i < end) {
        const c = src[i]; out += c; i++;
        if (c === '\\') { if (i < end) { out += src[i]; i++; } continue; }
        if (c === quote) break;
      }
      continue;
    }
    // Handle single-line comments
    if (ch === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      if (j === -1 || j > end) { out += src.slice(i, end); i = end; break; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    // Handle block comments
    if (ch === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const stop = j === -1 ? end : Math.min(j + 2, end);
      out += src.slice(i, stop); i = stop; continue;
    }
    // Try identifier replacement at this position
    let replaced = false;
    if (isWordStart(src, i)) {
      // Find full identifier
      let j = i;
      while (j < end && isIdentChar(src[j])) j++;
      const name = src.slice(i, j);
      const newName = mapping.get(name);
      if (newName && src[i - 1] !== '.') { // don't touch property accesses
        out += newName;
        i = j;
        replaced = true;
      }
    }
    if (!replaced) { out += ch; i++; }
  }
  return src.slice(0, start) + out + src.slice(end);
}

function process() {
  let src = fs.readFileSync(FILE, 'utf8');
  let offset = 0;
  // Find functions by a simple parser: 'function name(args) {' with brace matching
  const funRe = /function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = funRe.exec(src)) !== null) {
    const headerStart = m.index;
    const argsText = m[1];
    const bodyStart = funRe.lastIndex; // position just after '{'
    // Find matching closing brace for this function
    let depth = 1;
    let i = bodyStart;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === '`') { // skip strings
        const quote = ch; i++;
        while (i < src.length) {
          const c = src[i]; i++;
          if (c === '\\') { i++; continue; }
          if (c === quote) break;
        }
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = (j === -1 ? src.length : j + 2); continue; }
      if (ch === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i + 2); i = (j === -1 ? src.length : j + 1); continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const bodyEnd = i - 1; // position of closing '}'

    // Build renaming mapping for this function scope
    const mapping = new Map();
    // Parameters renaming
    const params = argsText.split(',').map(s => s.trim()).filter(Boolean);
    for (const name of params) {
      const newName = paramRename.get(name);
      if (newName) mapping.set(name, newName);
    }
    // 'var' declarations at the top few lines of the function body
    const bodyHead = src.slice(bodyStart, Math.min(bodyStart + 300, bodyEnd));
    const varRe = /\bvar\s+([^;]+);/g;
    let v;
    while ((v = varRe.exec(bodyHead)) !== null) {
      const decl = v[1];
      const names = decl.split(',').map(s => s.trim().split('=')[0].trim());
      for (const n of names) {
        const nn = localRename.get(n);
        if (nn && !mapping.has(n)) mapping.set(n, nn);
      }
    }
    if (mapping.size === 0) continue;

    src = replaceIdentifiersInRange(src, bodyStart, bodyEnd, mapping);
  }
  fs.writeFileSync(FILE, src);
  console.log('Scoped renaming completed.');
}

process();


