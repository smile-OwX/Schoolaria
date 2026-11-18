const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__SCHOOLARIA_DESKTOP__', true);
contextBridge.exposeInMainWorld('schoolariaDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
});
