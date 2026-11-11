const { contextBridge, ipcRenderer } = require('electron');

// Oyun içi pencere sadece veri alır; başka bir şeye erişimi yok
contextBridge.exposeInMainWorld('overlayApi', {
  onData: (cb) => ipcRenderer.on('overlay:data', (_e, d) => cb(d)),
});
