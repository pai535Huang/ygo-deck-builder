// Electron main process to wrap the existing static site into a desktop app
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

// If developer requests to disable Chromium OS-level sandbox, append switches early
const __NO_SANDBOX__ = String(process.env.ELECTRON_NO_CHROME_SANDBOX || '').toLowerCase() === '1';
if (__NO_SANDBOX__) {
  try {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
  } catch (_) {}
}

let mainWindow = null;
let server = null;
let _updatingPre = false; // guard concurrent pre-release update

function createStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    try {
      const srv = http.createServer((req, res) => {
        try {
          const urlPath = decodeURIComponent((req.url || '').split('?')[0] || '/');
          // SSE progress stream
          if (req.method === 'GET' && urlPath === '/__update_prerelease_stream') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no'
            });
            const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
            if (_updatingPre) {
              const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
              send({ type: 'error', message: 'busy' });
              try { res.end(); } catch (_) {}
              return;
            }
            _updatingPre = true;
            const child = require('child_process').spawn('node', ['./scripts/update_prerelease.js'], { cwd: rootDir, env: { ...process.env, UI_TRIGGER: '1' } });
            const parseAndSend = (chunk) => {
              const s = chunk.toString('utf8');
              const dl = /Download progress:\s*(\d+)%/g; let m;
              while ((m = dl.exec(s))) send({ type: 'download', percent: Number(m[1]) });
              const ex = /Extract progress:\s*(\d+)%\s*\((\d+)\/(\d+)\)/g;
              while ((m = ex.exec(s))) send({ type: 'extract', percent: Number(m[1]), done: Number(m[2]), total: Number(m[3]) });
              if (/Remote archive unchanged; skipping/.test(s)) send({ type: 'skipped' });
              for (const line of s.split(/\r?\n/)) { if (line.trim()) send({ type: 'log', text: line }); }
            };
            child.stdout.on('data', parseAndSend);
            child.stderr.on('data', (chunk) => { send({ type: 'log', level: 'error', text: chunk.toString('utf8') }); });
            const closeOut = (code) => { _updatingPre = false; send({ type: 'done', code: code || 0 }); try { res.end(); } catch (_) {} };
            child.on('close', closeOut);
            child.on('error', (e) => { _updatingPre = false; send({ type: 'error', message: e && e.message ? e.message : String(e) }); try { res.end(); } catch (_) {} });
            // hard timeout to avoid hanging forever
            const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, Number(process.env.PRE_HARD_TIMEOUT_MS || 6*60*1000));
            child.on('exit', () => { try { clearTimeout(killTimer); } catch (_) {} });
            const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
            req.on('close', () => { try { clearInterval(hb); } catch (_) {} });
            return;
          }
          if (req.method === 'GET' && urlPath === '/__pre_meta') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            try {
              const p = path.join(rootDir, 'data', 'pre-release', '.meta.json');
              if (!fs.existsSync(p)) { res.end(JSON.stringify({ ok: true, meta: null })); return; }
              const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
              res.end(JSON.stringify({ ok: true, meta }));
            } catch (e) {
              res.statusCode = 500; res.end(JSON.stringify({ ok: false }));
            }
            return;
          }
          // Manual update endpoint for pre-release data
          if ((req.method === 'POST' || req.method === 'GET') && urlPath === '/__update_prerelease') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const done = (ok, msg) => { res.statusCode = ok ? 200 : 500; res.end(JSON.stringify({ ok, message: msg || '' })); };
            if (_updatingPre) return done(false, 'busy');
            _updatingPre = true;
            try {
              const child = require('child_process').spawn('node', ['./scripts/update_prerelease.js'], { cwd: rootDir, env: { ...process.env, UI_TRIGGER: '1' } });
              let stderrBuf = '';
              child.stdout.on('data', (c) => { try { process.stdout.write(c); } catch (_) {} });
              child.stderr.on('data', (c) => { stderrBuf += c.toString('utf8'); try { process.stderr.write(c); } catch (_) {} });
              const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, Number(process.env.PRE_HARD_TIMEOUT_MS || 6*60*1000));
              child.on('close', (code) => {
                _updatingPre = false;
                try { clearTimeout(killTimer); } catch (_) {}
                if (code === 0) return done(true, 'updated');
                return done(false, stderrBuf || ('exit code ' + code));
              });
              child.on('error', (e) => { _updatingPre = false; return done(false, e && e.message ? e.message : String(e)); });
            } catch (e) {
              _updatingPre = false;
              return done(false, e && e.message ? e.message : String(e));
            }
            return;
          }
          let fsPath = path.join(rootDir, urlPath);
          if (urlPath === '/' || urlPath === '') fsPath = path.join(rootDir, 'index.html');
          // sandbox path traversal
          if (!fsPath.startsWith(rootDir)) {
            res.statusCode = 403; res.end('Forbidden'); return;
          }
          fs.stat(fsPath, (err, st) => {
            if (err || !st.isFile()) {
              res.statusCode = 404; res.end('Not found'); return;
            }
            const ext = path.extname(fsPath).toLowerCase();
            const map = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.mjs': 'application/javascript; charset=utf-8',
              '.json': 'application/json; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.ico': 'image/x-icon'
            };
            res.setHeader('Content-Type', map[ext] || 'application/octet-stream');
            // disable caching to avoid stale assets
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
            fs.createReadStream(fsPath).pipe(res);
          });
        } catch (e) {
          res.statusCode = 500; res.end('Server error');
        }
      });
      // 0 means random free port
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    } catch (e) {
      reject(e);
    }
  });
}

async function createWindow() {
  const appRoot = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
  // Serve project root to keep absolute paths like /data/* and /favicon.svg working
  const rootDir = appRoot;

  // Bootstrap essential data in dev/desktop mode to stay consistent with `npm start` behavior
  try {
    // Run forbidden and GENESYS updates once before starting server (best-effort)
    exec('node ./scripts/update_forbidden.js', { cwd: rootDir }, (e) => { if (e) try { console.warn('update_forbidden failed:', e.message || e); } catch(_){} });
    exec('node ./scripts/update_forbidden_cn.js', { cwd: rootDir }, (e) => { if (e) try { console.warn('update_forbidden_cn failed:', e.message || e); } catch(_){} });
    exec('node ./scripts/update_genesys_and_maybe_build.js', { cwd: rootDir }, (e) => { if (e) try { console.warn('update_genesys_and_maybe_build failed:', e.message || e); } catch(_){} });
  } catch (_) {}

  try {
    server = await createStaticServer(rootDir);
  } catch (e) {
    dialog.showErrorBox('启动失败', '无法启动内置静态服务器：' + (e && e.message ? e.message : e));
    app.quit();
    return;
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  const noChromeSandbox = String(process.env.ELECTRON_NO_CHROME_SANDBOX || '').toLowerCase() === '1';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 当设置 ELECTRON_NO_CHROME_SANDBOX=1 时，关闭 Chromium 级别的 sandbox（仅用于开发排障）
      sandbox: !noChromeSandbox,
      // Enable webSecurity; assets are served via http so CORS/file issues are avoided
      webSecurity: true
    }
  });

  if (noChromeSandbox) {
    try {
      dialog.showMessageBox({
        type: 'warning',
        title: '警告（开发模式）',
        message: '已在开发模式下禁用 Chromium 沙箱，仅用于临时排障。请勿在生产环境使用该选项。',
        buttons: ['我知道了']
      });
    } catch (_) {}
  }

  await mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    try { server && server.close(); } catch (_) {}
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
