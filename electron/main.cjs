const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

let staticServer = null;
let mainWindow = null;
let boundBaseUrl = '';
const desktopAuthNonce = crypto.randomBytes(24).toString('hex');

function getCleanChromeUserAgent(rawUa) {
  const fallback =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  if (!rawUa || typeof rawUa !== 'string') return fallback;
  const cleaned = rawUa
    .replace(/\s*Electron\/[^\s]+/gi, '')
    .replace(/\s*schoolaria\/[^\s]+/gi, '')
    .trim();
  return cleaned || fallback;
}

function isAuthOrInternalUrl(url) {
  if (!url) return false;
  if (url === 'about:blank') return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const proto = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if ((proto === 'http:' || proto === 'https:') && (host === 'localhost' || host === '127.0.0.1')) {
    return true;
  }
  if (proto !== 'https:') return false;
  return (
    host === 'accounts.google.com' ||
    host === 'accounts.youtube.com' ||
    host === 'apis.google.com' ||
    host.endsWith('.google.com') ||
    host.endsWith('.gstatic.com') ||
    host.endsWith('.firebaseapp.com') ||
    host.endsWith('.web.app')
  );
}

function isSafeExternalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startLocalDistServer(distDir) {
  const resolvedDistDir = path.resolve(distDir);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = (req.url || '/').split('?')[0];

      if (reqUrl === '/__desktop_auth_callback') {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        try {
          const body = await readJsonBody(req);
          if (
            !body ||
            typeof body.nonce !== 'string' ||
            !constantTimeEqual(body.nonce, desktopAuthNonce)
          ) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid auth session nonce' }));
            return;
          }
          const idToken = typeof body.idToken === 'string' && body.idToken ? body.idToken : null;
          const accessToken =
            typeof body.accessToken === 'string' && body.accessToken ? body.accessToken : null;
          if (!idToken && !accessToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing Google credential token' }));
            return;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('schoolaria:desktop-auth-token', {
              idToken,
              accessToken,
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid callback payload' }));
        }
        return;
      }

      let decodedPath = reqUrl;
      try {
        decodedPath = decodeURIComponent(reqUrl);
      } catch {
        decodedPath = reqUrl;
      }
      let relPath = decodedPath.replace(/^\/+/, '');
      if (!relPath) relPath = 'index.html';

      let targetPath = path.resolve(resolvedDistDir, relPath);
      if (
        targetPath !== resolvedDistDir &&
        !targetPath.startsWith(resolvedDistDir + path.sep)
      ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(resolvedDistDir, 'index.html');
      }

      fs.readFile(targetPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(targetPath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
        });
        res.end(data);
      });
    });

    const preferredPorts = [45821, 45822, 45823, 0];
    let idx = 0;

    function tryListen() {
      const port = preferredPorts[idx++];
      const onError = (err) => {
        if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && idx < preferredPorts.length) {
          tryListen();
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, 'localhost', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        staticServer = server;
        boundBaseUrl = `http://localhost:${boundPort}`;
        resolve(boundBaseUrl);
      });
    }

    tryListen();
  });
}

async function createWindow() {
  const cleanUa = getCleanChromeUserAgent(app.userAgentFallback);
  app.userAgentFallback = cleanUa;

  const icoPath = path.resolve(__dirname, '../build/icon.ico');
  const pngIconPath = path.resolve(__dirname, '../public/pwa-512x512.png');
  const windowIcon = fs.existsSync(icoPath)
    ? icoPath
    : fs.existsSync(pngIconPath)
    ? pngIconPath
    : undefined;

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: 'Schoolaria — Gestion Scolaire',
    ...(windowIcon ? { icon: windowIcon } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#ede9fe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.webContents.setUserAgent(cleanUa);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthOrInternalUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAuthOrInternalUrl(url)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });

  win.webContents.on('did-create-window', (childWin) => {
    childWin.webContents.setUserAgent(cleanUa);
  });

  const targetUrl = process.env.SCHOOLARIA_DESKTOP_URL;
  if (targetUrl) {
    boundBaseUrl = targetUrl.replace(/\/+$/, '');
    await win.loadURL(targetUrl);
    return;
  }

  const distDir = path.resolve(__dirname, '../dist');
  const localUrl = await startLocalDistServer(distDir);
  await win.loadURL(localUrl);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.handle('schoolaria:start-browser-auth', async () => {
    if (!boundBaseUrl) {
      throw new Error('Serveur local desktop non prêt.');
    }
    const authUrl = `${boundBaseUrl}/?desktopAuth=1&nonce=${encodeURIComponent(desktopAuthNonce)}`;
    await shell.openExternal(authUrl);
    return { opened: true };
  });

  app.whenReady().then(() => {
    app.userAgentFallback = getCleanChromeUserAgent(app.userAgentFallback);
    void createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (staticServer) {
      staticServer.close();
      staticServer = null;
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
