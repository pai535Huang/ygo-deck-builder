#!/usr/bin/env node
// scripts/build_name_id_map.js
// 收集 data 目录中已有的卡名，调用 ygocdb API 获取 id/cid，生成 data/name_id_map.json

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'name_id_map.json');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  } catch (e) {
    return {};
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function fetchYgocdb(name) {
  const url = `https://ygocdb.com/api/v0/?search=${encodeURIComponent(name)}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          resolve(j);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function pickBestResult(name, results) {
  if (!results || results.length === 0) return null;
  const lc = String(name || '').toLowerCase();
  // exact match on name, jp_name, cn_name
  for (const r of results) {
    if (r.name && r.name.toLowerCase() === lc) return r;
    if (r.jp_name && r.jp_name.toLowerCase() === lc) return r;
    if (r.cn_name && r.cn_name.toLowerCase() === lc) return r;
  }
  // fallback: first result
  return results[0];
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // load candidate names only from GENESYS scores (data/genesys_scores.json)
  const candidates = new Set();
  const gfile = path.join(DATA_DIR, 'genesys_scores.json');
  if (fs.existsSync(gfile)) {
    const gj = readJsonSafe(gfile);
    if (gj && typeof gj === 'object') {
      for (const k of Object.keys(gj)) {
        if (!k) continue;
        candidates.add(k);
      }
    }
  }

  const names = Array.from(candidates).sort((a, b) => a.localeCompare(b));
  console.log(`Found ${names.length} unique candidate names to resolve.`);

  const out = {};
  let processed = 0;

  // simple rate-limited sequential resolution to be safe
  for (const name of names) {
    processed++;
    const short = name.length > 80 ? name.slice(0, 77) + '...' : name;
    process.stdout.write(`(${processed}/${names.length}) Resolving: ${short}\r`);
    let attempts = 0;
    let success = false;
    while (attempts < 3 && !success) {
      attempts++;
      try {
        const res = await fetchYgocdb(name);
        const best = pickBestResult(name, res && res.result ? res.result : res);
        if (best) {
          // prefer cid if present
          const id = best.id || best.card_def || best.cid || null;
          out[name] = { id: id || null, cid: best.cid || null, name: best.name || best.jp_name || best.cn_name || name };
        } else {
          out[name] = { id: null, cid: null, name };
        }
        success = true;
      } catch (e) {
        // wait and retry
        await sleep(300 * attempts);
      }
    }
    // polite pause
    await sleep(120);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWrote', OUT_FILE, 'entries:', Object.keys(out).length);
}

main().catch((e) => {
  console.error('Failed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
