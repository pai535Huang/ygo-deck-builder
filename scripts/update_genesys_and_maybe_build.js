#!/usr/bin/env node
// scripts/update_genesys_and_maybe_build.js
// Run update_genesys.js to fetch latest table. If data/genesys_scores.json changed (content-wise), run build_name_id_map.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, '..', 'data', 'genesys_scores.json');

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function normalizeContent(s) {
  try {
    const j = JSON.parse(s);
    return stableStringify(j);
  } catch (e) {
    return s || '';
  }
}

let oldNorm = '';
if (fs.existsSync(DATA_FILE)) {
  try { oldNorm = normalizeContent(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { oldNorm = ''; }
}

console.log('Running update_genesys.js to refresh GENESYS scores...');
try {
  execSync('node ./scripts/update_genesys.js', { stdio: 'inherit' });
} catch (e) {
  console.error('update_genesys.js failed: ', e && e.message ? e.message : e);
  process.exit(1);
}

let newNorm = '';
if (fs.existsSync(DATA_FILE)) {
  try { newNorm = normalizeContent(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { newNorm = ''; }
}

if (oldNorm === newNorm) {
  console.log('No meaningful change detected in data/genesys_scores.json — skipping build_name_id_map.');
  process.exit(0);
}

console.log('Detected changes in GENESYS scores — running build_name_id_map.js to update name->id mapping...');
try {
  execSync('node ./scripts/build_name_id_map.js', { stdio: 'inherit' });
  console.log('build_name_id_map.js completed successfully.');
  process.exit(0);
} catch (e) {
  console.error('build_name_id_map.js failed: ', e && e.message ? e.message : e);
  process.exit(1);
}
