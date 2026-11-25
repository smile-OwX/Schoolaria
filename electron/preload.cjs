const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__SCHOOLARIA_DESKTOP__', true);
contextBridge.exposeInMainWorld('schoolariaDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  startSystemBrowserAuth: () => ipcRenderer.invoke('schoolaria:start-browser-auth'),
  onDesktopAuthToken: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('schoolaria:desktop-auth-token', listener);
    return () => {
      ipcRenderer.removeListener('schoolaria:desktop-auth-token', listener);
    };
  },
});
