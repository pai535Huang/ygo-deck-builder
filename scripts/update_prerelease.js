#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { URL: URLCtor } = require('url');
const unzipper = require('unzipper');
const streamPipeline = promisify(pipeline);

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PRE_DIR = path.join(DATA_DIR, 'pre-release');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');
const META_PATH = path.join(PRE_DIR, '.meta.json');

async function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  for (const f of fs.readdirSync(TEMP_DIR)) {
    const fp = path.join(TEMP_DIR, f);
    try {
      const st = fs.lstatSync(fp);
      if (st.isDirectory()) {
        (function rim(fp2){ for (const name of fs.readdirSync(fp2)) { const p2 = path.join(fp2,name); const s2 = fs.lstatSync(p2); if (s2.isDirectory()) rim(p2); else fs.unlinkSync(p2);} })(fp);
        fs.rmdirSync(fp);
      } else fs.unlinkSync(fp);
    } catch (_) {}
  }
}

async function downloadToTemp(url, _silent = false) {
  await ensureTempDir();
  const dest = path.join(TEMP_DIR, 'archive.ypk');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadToTemp(res.headers.location, true).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('Download failed, status ' + res.statusCode));
      const total = Number(res.headers['content-length'] || res.headers['Content-Length'] || 0);
      if (!_silent) console.log(`Downloading pre-release archive to ${dest}${total ? ` (${(total/1048576).toFixed(2)} MB)` : ''}`);
      const file = fs.createWriteStream(dest);
      let received = 0, lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && (pct % 2 === 0 || pct === 100)) { process.stdout.write(`\r  Download progress: ${pct}%`); lastPct = pct; }
        } else {
          if (received % (2*1024*1024) < 65536) process.stdout.write(`\r  Downloaded ${(received/1048576).toFixed(1)} MB`);
        }
      });
      res.on('end', () => { process.stdout.write('\n'); });
      res.pipe(file);
      file.on('finish', () => file.close(() => { const sec = ((Date.now() - t0)/1000).toFixed(1); console.log(`Download complete in ${sec}s.`); resolve(dest); }));
    });
    req.on('error', (err) => reject(err));
  });
}

async function fetchLatestPatchUrl() {
  const override = process.env.PRE_URL;
  if (override && /^https?:\/\/.+ygopro-super-pre-/.test(override)) return override;
  try {
    const puppeteer = require('puppeteer');
    const target = 'https://mycard.world/ygopro/arena/index.html#/superpre';
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'], executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    try {
      const page = await browser.newPage();
      await page.setUserAgent('ygo-deck-editor/1.0');
      await page.goto(target, { waitUntil: 'networkidle2', timeout: Number(process.env.PUPPETEER_GOTO_TIMEOUT_MS || 25000) });
      await page.waitForSelector('section.update-method a[href*="ygopro-super-pre/archive"]', { timeout: Number(process.env.PUPPETEER_WAIT_SELECTOR_MS || 12000) });
      const links = await page.evaluate(() => {
        const abs = (u) => { try { return new URL(u, location.href).toString(); } catch (_) { return null; } };
        const anchors = Array.from(document.querySelectorAll('section.update-method a[href*="ygopro-super-pre/archive"]'));
        const hrefs = anchors.map(a => a.getAttribute('href')).filter(Boolean).map(abs).filter(Boolean);
        return Array.from(new Set(hrefs));
      });
      if (Array.isArray(links) && links.length) {
        const parseVer = (u) => { const m = u.match(/ygopro-super-pre-([0-9.]+)\.ypk/i); return m ? m[1].split('.').map(x=>parseInt(x,10)||0) : []; };
        links.sort((a,b)=>{ const va=parseVer(a), vb=parseVer(b); const n=Math.max(va.length,vb.length); for(let i=0;i<n;i++){ const xa=va[i]||0, xb=vb[i]||0; if(xa!==xb) return xa-xb;} return 0; });
        const best = links[links.length-1];
        if (best) return best;
      }
      throw new Error('页面解析成功但未找到 archive 链接（页面结构可能变更）');
    } finally { try { await browser.close(); } catch (_) {} }
  } catch (e) {
    throw new Error('需要 Puppeteer 以解析 mycard 页面，但启动失败：' + (e && e.message ? e.message : e) + '。可设置 PUPPETEER_EXECUTABLE_PATH 指向系统 Chromium，或检查网络/代理。');
  }
}

async function extractArchive(archivePath, outDir) {
  try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const directory = await unzipper.Open.file(archivePath);
  const packIds = new Set();
  for (const entry of directory.files) {
    const entryPath = entry.path.replace(/^\/+/, '');
    const lower = entryPath.toLowerCase();
    if (entry.type !== 'Directory' && lower.startsWith('pack/') && lower.endsWith('.ydk')) {
      try {
        const buf = await entry.buffer();
        const text = buf.toString('utf8');
        for (const ln of text.split(/\r?\n/)) { const m = ln.match(/^\s*([0-9]+)\s*$/); if (m) packIds.add(String(Number(m[1]))); }
      } catch (_) {}
    }
  }
  const fileSetLower = new Set(directory.files.map(f => f.path.replace(/^\/+/, '').toLowerCase()));
  const desiredPics = new Set();
  for (const id of packIds) { const jpg = `pics/${id}.jpg`; const png = `pics/${id}.png`; if (fileSetLower.has(jpg)) desiredPics.add(jpg); else if (fileSetLower.has(png)) desiredPics.add(png); }
  let total = 0;
  for (const entry of directory.files) {
    const p = entry.path.replace(/^\/+/, '').toLowerCase();
    const needed = ((p.startsWith('pack/') && p.endsWith('.ydk')) || p.endsWith('.cdb') || (p.startsWith('pics/') && desiredPics.has(p)));
    if (entry.type !== 'Directory' && needed) total++;
  }
  console.log(`Extracting ${total} files...`);
  let done = 0; const expectedSet = new Set();
  for (const entry of directory.files) {
    const entryPath = entry.path.replace(/^\/+/, '');
    const lower = entryPath.toLowerCase();
    const isNeeded = ((lower.startsWith('pack/') && lower.endsWith('.ydk')) || lower.endsWith('.cdb') || (lower.startsWith('pics/') && desiredPics.has(lower)));
    if (entry.type === 'Directory' || !isNeeded) continue;
    const target = path.join(outDir, entryPath);
    expectedSet.add(entryPath.replace(/\\/g, '/'));
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const isPic = lower.startsWith('pics/');
    if (!(isPic && fs.existsSync(target))) await streamPipeline(entry.stream(), fs.createWriteStream(target));
    done++; const pct = total ? Math.floor((done / total) * 100) : 100; if (pct % 5 === 0 || done === total) process.stdout.write(`\r  Extract progress: ${pct}% (${done}/${total})`);
  }
  process.stdout.write('\n');
  return expectedSet;
}

function cleanupPreRelease(dir, expectedSet) {
  const walk = (p) => {
    for (const name of fs.readdirSync(p)) {
      const fp = path.join(p, name);
      const rel = path.relative(dir, fp).replace(/\\/g, '/');
      const relLower = rel.toLowerCase();
      let st; try { st = fs.lstatSync(fp); } catch (_) { continue; }
      if (st.isDirectory()) { if (relLower === 'pics' || relLower.startsWith('pics/')) continue; walk(fp); try { fs.rmdirSync(fp); } catch (_) {} }
      else {
        const isCandidate = ((relLower.startsWith('pack/') && relLower.endsWith('.ydk')) || relLower.endsWith('.cdb'));
        if (isCandidate && !expectedSet.has(rel)) { try { fs.unlinkSync(fp); } catch (_) {} }
      }
    }
  };
  try { if (fs.existsSync(dir)) walk(dir); } catch (_) {}
}

function readMeta() { try { if (fs.existsSync(META_PATH)) return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch (_) {} return null; }
function writeMeta(meta) { try { if (!fs.existsSync(PRE_DIR)) fs.mkdirSync(PRE_DIR, { recursive: true }); } catch (_) {} try { fs.writeFileSync(META_PATH, JSON.stringify(meta || {}, null, 2), 'utf8'); } catch (_) {} }

async function headRequest(url) {
  const TIMEOUT_MS = Number(process.env.HEAD_TIMEOUT_MS || 2000);
  return new Promise((resolve) => {
    try {
      const u = new URLCtor(url);
      const req = https.request({ method: 'HEAD', hostname: u.hostname, path: u.pathname + (u.search || ''), protocol: u.protocol, port: u.port || (u.protocol === 'https:' ? 443 : 80), headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'ygo-deck-editor/1.0' } }, (res) => { resolve({ statusCode: res.statusCode, headers: res.headers || {} }); });
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (_) {} resolve(null); });
      req.setTimeout(TIMEOUT_MS);
      req.on('error', () => resolve(null));
      req.end();
    } catch (e) { resolve(null); }
  });
}

async function main() {
  try {
    console.log('Preparing pre-release directory:', PRE_DIR);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const URL = await fetchLatestPatchUrl();
    console.log('Selected pre-release URL:', URL);
    let skip = false;
    {
      const HARD_HEAD_MS = Number(process.env.HARD_HEAD_MS || 3000);
      const raced = await Promise.race([headRequest(URL), new Promise((resolve) => setTimeout(() => resolve('__HARD_TIMEOUT__'), HARD_HEAD_MS))]);
      const head = (raced === '__HARD_TIMEOUT__') ? null : raced;
      const prev = readMeta();
      const idxExists = fs.existsSync(path.join(PRE_DIR, 'index.json')) && fs.existsSync(path.join(PRE_DIR, 'pics'));
      if (head && head.statusCode && head.statusCode >= 200 && head.statusCode < 400 && idxExists) {
        const etag = head.headers['etag'] || head.headers['ETag'];
        const lm = head.headers['last-modified'] || head.headers['Last-Modified'];
        const len = head.headers['content-length'] || head.headers['Content-Length'];
        if (prev && prev.url === URL && ((etag && prev.etag === etag) || (lm && prev.lastModified === lm) || (len && prev.contentLength === len))) {
          console.log('Remote archive unchanged; skipping download and rebuild.');
          skip = true;
        }
      }
      if (head && head.headers) writeMeta({ url: URL, etag: head.headers['etag'] || head.headers['ETag'] || '', lastModified: head.headers['last-modified'] || head.headers['Last-Modified'] || '', contentLength: head.headers['content-length'] || head.headers['Content-Length'] || '' });
      global.__PRE_URL_SELECTED__ = URL;
    }
    if (skip) { console.log('Pre-release prepared at', PRE_DIR); return; }
    if (!fs.existsSync(PRE_DIR)) fs.mkdirSync(PRE_DIR, { recursive: true });
    const archive = await downloadToTemp(global.__PRE_URL_SELECTED__);
    const expected = await extractArchive(archive, PRE_DIR);
    console.log('Extraction complete, cleaning up extra files...');
    cleanupPreRelease(PRE_DIR, expected);
    try {
      const index = {};
      const packDir = path.join(PRE_DIR, 'pack');
      if (fs.existsSync(packDir)) {
        const files = fs.readdirSync(packDir);
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.ydk')) continue;
          const text = fs.readFileSync(path.join(packDir, f), 'utf8');
          const lines = text.split(/\r?\n/);
          for (const ln of lines) {
            const m = ln.match(/^\s*([0-9]+)\s*$/);
            if (m) {
              const id = String(Number(m[1]));
              let picRel = null;
              if (expected.has(`pics/${id}.jpg`)) picRel = '/data/pre-release/pics/' + id + '.jpg';
              else if (expected.has(`pics/${id}.png`)) picRel = '/data/pre-release/pics/' + id + '.png';
              if (!picRel) continue;
              if (!index[id]) index[id] = { id: Number(id), cn_name: '', name: '', text: { desc: '', types: '' }, pic: picRel, hasPic: true };
            }
          }
        }
      }
      try {
        let sqlite = null; try { sqlite = require('better-sqlite3'); } catch (e) { sqlite = null; }
        if (!sqlite) { console.warn('better-sqlite3 not installed; skip .cdb parsing.'); }
        else {
          const cdbFiles = fs.readdirSync(PRE_DIR).filter(x => x.toLowerCase().endsWith('.cdb'));
          for (const cdb of cdbFiles) {
            const cdbPath = path.join(PRE_DIR, cdb);
            try {
              const db = new sqlite(cdbPath, { readonly: true });
              const hasTexts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='texts'").get();
              if (hasTexts) {
                let hasTypesCol = false;
                try { const cols = db.prepare("PRAGMA table_info('texts')").all(); hasTypesCol = Array.isArray(cols) && cols.some(c => String(c.name || c.cid || '').toLowerCase() === 'types'); } catch (_) { hasTypesCol = false; }
                const wantedIds = Object.keys(index).map(k => Number(k)); const BATCH = 500;
                for (let i = 0; i < wantedIds.length; i += BATCH) {
                  const slice = wantedIds.slice(i, i + BATCH); if (!slice.length) break;
                  const placeholders = slice.map(() => '?').join(',');
                  const stmt = hasTypesCol ? db.prepare(`SELECT id, name, desc, types FROM texts WHERE id IN (${placeholders})`) : db.prepare(`SELECT id, name, desc FROM texts WHERE id IN (${placeholders})`);
                  const rows = stmt.all(...slice);
                  for (const r of rows) { if (!r || !r.id) continue; const id = String(Number(r.id)); if (!index[id]) continue; if (r.name) { index[id].cn_name = index[id].cn_name || r.name; index[id].name = index[id].name || r.name; } if (r.desc) { index[id].text = index[id].text || { desc: '', types: '' }; index[id].text.desc = index[id].text.desc || r.desc; } if (hasTypesCol && r.types) { index[id].text = index[id].text || { desc: '', types: '' }; if (!index[id].text.types) index[id].text.types = String(r.types); } }
                }
              }
              const hasDatas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='datas'").get();
              if (hasDatas) {
                const wantedIds = Object.keys(index).map(k => Number(k)); const BATCH = 500;
                const TYPE = { MONSTER:0x1, SPELL:0x2, TRAP:0x4, NORMAL:0x10, EFFECT:0x20, FUSION:0x40, RITUAL:0x80, TUNER:0x1000, SYNCHRO:0x2000, QUICKPLAY:0x10000, CONTINUOUS:0x20000, EQUIP:0x40000, FIELD:0x80000, COUNTER:0x100000, FLIP:0x200000, TOON:0x400000, XYZ:0x800000, PENDULUM:0x1000000, LINK:0x4000000 };
                const toTypesText = (t) => { t = Number(t) || 0; const out = []; if (t & TYPE.MONSTER) { out.push('怪兽'); if (t & TYPE.FUSION) out.push('融合'); if (t & TYPE.SYNCHRO) out.push('同调'); if (t & TYPE.XYZ) out.push('超量'); if (t & TYPE.LINK) out.push('连接'); if (t & TYPE.RITUAL) out.push('仪式'); if (t & TYPE.PENDULUM) out.push('灵摆'); if (!(t & (TYPE.FUSION|TYPE.SYNCHRO|TYPE.XYZ|TYPE.LINK|TYPE.RITUAL))) { if (t & TYPE.NORMAL) out.push('通常'); if (t & TYPE.EFFECT) out.push('效果'); } } else if (t & TYPE.SPELL) { out.push('魔法'); if (t & TYPE.QUICKPLAY) out.push('速攻'); if (t & TYPE.CONTINUOUS) out.push('永续'); if (t & TYPE.FIELD) out.push('场地'); if (t & TYPE.EQUIP) out.push('装备'); if (t & TYPE.RITUAL) out.push('仪式'); if (!(t & (TYPE.QUICKPLAY|TYPE.CONTINUOUS|TYPE.FIELD|TYPE.EQUIP|TYPE.RITUAL))) out.push('通常'); } else if (t & TYPE.TRAP) { out.push('陷阱'); if (t & TYPE.CONTINUOUS) out.push('永续'); if (t & TYPE.COUNTER) out.push('反击'); if (!(t & (TYPE.CONTINUOUS|TYPE.COUNTER))) out.push('通常'); } return out.join('/'); };
                for (let i = 0; i < wantedIds.length; i += BATCH) {
                  const slice = wantedIds.slice(i, i + BATCH); if (!slice.length) break;
                  const placeholders = slice.map(() => '?').join(',');
                  const stmt = db.prepare(`SELECT id, type FROM datas WHERE id IN (${placeholders})`);
                  const rows = stmt.all(...slice);
                  for (const r of rows) { if (!r || !r.id) continue; const id = String(Number(r.id)); if (!index[id]) continue; if (!index[id].text) index[id].text = { desc: '', types: '' }; if (!index[id].text.types) { const tt = toTypesText(r.type); if (tt) index[id].text.types = tt; } }
                }
              }
              try { db.close(); } catch (_) {}
            } catch (e) {}
          }
        }
      } catch (e) { console.error('CDB enrichment failed:', e && e.message ? e.message : e); }
      for (const k of Object.keys(index)) { const it = index[k]; if (!it || !it.pic) delete index[k]; }
      const idxPath = path.join(PRE_DIR, 'index.json'); fs.writeFileSync(idxPath, JSON.stringify(Object.values(index), null, 2), 'utf8');
      console.log('Pre-release index written to', idxPath);
      try { const selectedUrl = global.__PRE_URL_SELECTED__; const head2 = await headRequest(selectedUrl); if (head2 && head2.headers) { writeMeta({ url: selectedUrl, etag: head2.headers['etag'] || head2.headers['ETag'] || '', lastModified: head2.headers['last-modified'] || head2.headers['Last-Modified'] || '', contentLength: head2.headers['content-length'] || head2.headers['Content-Length'] || '' }); } else { writeMeta({ url: selectedUrl, etag: '', lastModified: '', contentLength: '' }); } } catch (_) {}
    } catch (e) { console.error('Failed to build pre-release index:', e && e.message ? e.message : e); }
    console.log('Pre-release prepared at', PRE_DIR);
    try { if (fs.existsSync(TEMP_DIR)) { for (const f of fs.readdirSync(TEMP_DIR)) { const fp = path.join(TEMP_DIR, f); try { const st = fs.lstatSync(fp); if (st.isDirectory()) { (function rim(fp2){ for (const name of fs.readdirSync(fp2)) { const p2 = path.join(fp2,name); const s2 = fs.lstatSync(p2); if (s2.isDirectory()) rim(p2); else fs.unlinkSync(p2);} })(fp); fs.rmdirSync(fp); } else fs.unlinkSync(fp);} catch (e) {} } } } catch (e) {}
  } catch (e) { console.error('Failed to prepare pre-release:', e && e.message ? e.message : e); process.exitCode = 1; }
}

if (require.main === module) main();
