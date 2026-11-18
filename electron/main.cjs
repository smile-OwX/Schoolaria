const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function isAuthOrInternalUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('http://localhost') ||
    url.startsWith('https://localhost') ||
    url.includes('accounts.google.com') ||
    url.includes('firebaseapp.com') ||
    url.includes('web.app') ||
    url.includes('apis.google.com')
  );
}

function createWindow() {
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
    win.loadURL(targetUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
