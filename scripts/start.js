#!/usr/bin/env node
const { exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_PORT = Number(process.env.PORT || 8000);

function runUpdate() {
  return new Promise((resolve, reject) => {
    console.log('Running update script...');
    // Only run forbidden update on startup to speed up boot; pre-release is manual now
    const p = exec('node ./scripts/update_forbidden.js', { cwd: path.join(__dirname, '..') }, (err, stdout, stderr) => {
      if (err) {
        console.error('Update script failed:', err && err.message ? err.message : err);
        // continue even if update fails
        resolve();
        return;
      }
      console.log(stdout);
      if (stderr) console.error(stderr);
      resolve();
    });
  });
}

function openSystemBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      require('child_process').spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (platform === 'darwin') {
      require('child_process').spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      require('child_process').spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch (e) {
    console.warn('Failed to auto-open system browser:', e && e.message ? e.message : e);
  }
}

// Launch an isolated Chromium window using Playwright (no sandbox flags). When the window closes, clean up and exit.
async function openInChromium(url, onExit) {
  let context = null;
  let userDataDir = null;
  const cleanup = async () => {
    try { if (context) await context.close(); } catch (_) {}
    try { if (userDataDir && fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    try { onExit && onExit(); } catch (_) {}
  };
  try {
    const { chromium } = require('playwright');
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygo-chromium-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 }
    });
    const pages = context.pages();
    const page = pages.length ? pages[0] : await context.newPage();
    await page.goto(url, { waitUntil: 'load' });

    const maybeExit = async () => { if (context.pages().length === 0) await cleanup(); };
    page.on('close', maybeExit);
    context.on('close', cleanup);

    const handleSig = async () => { await cleanup(); };
    process.once('SIGINT', handleSig);
    process.once('SIGTERM', handleSig);
    console.log('Opened isolated Chromium window via Playwright');
  } catch (e) {
    console.warn('[chromium] Failed to launch Playwright Chromium, falling back to system browser:', e && e.message ? e.message : e);
    openSystemBrowser(url);
  }
}

function createServerHandler(root) {
  let _updating = false;
  return (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    // SSE progress stream to update pre-release with live progress
    if (req.method === 'GET' && urlPath === '/__update_prerelease_stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
      if (_updating) {
        send({ type: 'error', message: 'busy' });
        res.end();
        return;
      }
      _updating = true;
      send({ type: 'start' });
  const child = require('child_process').spawn('node', ['./scripts/update_prerelease.js'], { cwd: root, env: { ...process.env, UI_TRIGGER: '1' } });
      const parseAndSend = (chunk) => {
        const s = chunk.toString('utf8');
        // Try to extract percent info
        const dl = /Download progress:\s*(\d+)%/g; let m;
        while ((m = dl.exec(s))) send({ type: 'download', percent: Number(m[1]) });
        const ex = /Extract progress:\s*(\d+)%\s*\((\d+)\/(\d+)\)/g;
        while ((m = ex.exec(s))) send({ type: 'extract', percent: Number(m[1]), done: Number(m[2]), total: Number(m[3]) });
        if (/Remote archive unchanged; skipping/.test(s)) send({ type: 'skipped' });
        // Also forward raw logs for visibility
        for (const line of s.split(/\r?\n/)) { if (line.trim()) send({ type: 'log', text: line }); }
      };
      child.stdout.on('data', parseAndSend);
      child.stderr.on('data', (chunk) => { send({ type: 'log', level: 'error', text: chunk.toString('utf8') }); });
      const closeOut = (code) => { _updating = false; send({ type: 'done', code: code || 0 }); try { res.end(); } catch (_) {} };
      child.on('close', closeOut);
      child.on('error', (e) => { _updating = false; send({ type: 'error', message: e && e.message ? e.message : String(e) }); try { res.end(); } catch (_) {} });
      // heartbeat
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
      req.on('close', () => { try { clearInterval(hb); } catch (_) {} });
      return;
    }
    if (req.method === 'GET' && urlPath === '/__pre_meta') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const p = path.join(root, 'data', 'pre-release', '.meta.json');
        if (!fs.existsSync(p)) { res.end(JSON.stringify({ ok: true, meta: null })); return; }
        const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
        res.end(JSON.stringify({ ok: true, meta }));
      } catch (e) {
        res.statusCode = 500; res.end(JSON.stringify({ ok: false }));
      }
      return;
    }
    if (urlPath === '/__update_prerelease') {
      // trigger on-demand pre-release update
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const done = (ok, msg) => { res.statusCode = ok ? 200 : 500; res.end(JSON.stringify({ ok, message: msg || '' })); };
      try {
  const p = exec('node ./scripts/update_prerelease.js', { cwd: root, env: { ...process.env, UI_TRIGGER: '1' } }, (err, stdout, stderr) => {
          if (err) { console.error('update_prerelease failed:', err && err.message ? err.message : err); return done(false, err && err.message ? err.message : String(err)); }
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
          done(true, 'updated');
        });
      } catch (e) {
        return done(false, e && e.message ? e.message : String(e));
      }
      return;
    }
    let fsPath = path.join(root, urlPath);
    if (urlPath === '/' || urlPath === '') fsPath = path.join(root, 'index.html');
    // 防止越界
    if (!fsPath.startsWith(root)) {
      res.statusCode = 403; res.end('Forbidden'); return;
    }
    fs.stat(fsPath, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404; res.end('Not found'); return;
      }
      const ext = path.extname(fsPath).toLowerCase();
      const map = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg' };
      res.setHeader('Content-Type', map[ext] || 'application/octet-stream');
      // Disable caching for dev to avoid stale CSS/JS
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      const stream = fs.createReadStream(fsPath);
      stream.pipe(res);
    });
  };
}

async function startServer() {
  const root = path.join(__dirname, '..');
  const handler = createServerHandler(root);
  const tryPorts = [];
  for (let i=0;i<10;i++) tryPorts.push(BASE_PORT + i);
  // 最后加一个 0 代表系统随机端口兜底
  tryPorts.push(0);
  let server = null;
  let selectedPort = null;
  for (const p of tryPorts) {
    try {
      server = http.createServer(handler);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      selectedPort = server.address().port;
      break;
    } catch (e) {
      if (server) { try { server.close(); } catch (_) {} }
      server = null;
      continue;
    }
  }
  if (!server || !selectedPort) {
    console.error('Failed to bind any port starting from', BASE_PORT);
    process.exit(1);
  }
  const url = 'http://127.0.0.1:' + selectedPort;
  console.log('Static server running at ' + url + (selectedPort !== BASE_PORT ? ` (fallback from ${BASE_PORT})` : ''));
  const pref = String(process.env.START_BROWSER || '').toLowerCase();
  if (!['none', 'off', 'false'].includes(pref)) {
    if (pref === 'chromium' || pref === 'playwright') {
      openInChromium(url, () => {
        try { server.close(() => process.exit(0)); } catch (_) { process.exit(0); }
      });
    } else {
      openSystemBrowser(url);
    }
  }
}

async function main() {
  await runUpdate();
  startServer();
}

main();
