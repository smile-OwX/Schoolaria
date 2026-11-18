const { app, BrowserWindow, shell } = require('electron');
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

function isAuthOrInternalUrl(url) {
  if (!url) return false;
  return (
    url === 'about:blank' ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.includes('accounts.google.com') ||
    url.includes('accounts.youtube.com') ||
    url.includes('.google.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('web.app') ||
    url.includes('apis.google.com')
  );
}

function startLocalDistServer(distDir) {
  const resolvedDistDir = path.resolve(distDir);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = (req.url || '/').split('?')[0];
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
        resolve(`http://localhost:${boundPort}`);
      });
    }

    tryListen();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: 'Schoolaria — Gestion Scolaire',
    autoHideMenuBar: true,
    backgroundColor: '#ede9fe',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
          },
        },
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  const targetUrl = process.env.SCHOOLARIA_DESKTOP_URL;
  if (targetUrl) {
    await win.loadURL(targetUrl);
    return;
  }

  // Serve dist/ on http://localhost:<port> instead of file:// so Firebase Auth
  // (which rejects file:// with auth/unauthorized-domain) works natively.
  const distDir = path.resolve(__dirname, '../dist');
  const localUrl = await startLocalDistServer(distDir);
  await win.loadURL(localUrl);
}

app.whenReady().then(() => {
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
