const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (ch, ...args) => {
  const res = await ipcRenderer.invoke(ch, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};
const on = (ch) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  clearApiKey: () => invoke('settings:clearKey'),
  sourceStatus: () => invoke('source:status'),
  getDDragon: () => invoke('ddragon:get'),
  lookupProfile: (riotId) => invoke('profile:lookup', riotId),
  myRiotId: () => invoke('profile:me'),
  analyzeGame: () => invoke('game:analyze'),
  liveStatus: () => invoke('live:status'),
  openExternal: (url) => invoke('open:external', url),
  toggleOverlay: () => invoke('overlay:toggle'),
  getStartup: () => invoke('startup:get'),
  leagueWindowMode: () => invoke('league:windowMode'),
  setStartup: (enabled) => invoke('startup:set', enabled),
  quitApp: () => invoke('app:quit'),
  overlayStatus: () => invoke('overlay:status'),

  onLiveUpdate: on('live:update'),
  onLiveState: on('live:state'),
  onClientPhase: on('client:phase'),
  onAnalysisStart: on('analysis:start'),
  onAnalysisPlayer: on('analysis:player'),
  onAnalysisDone: on('analysis:done'),
  onAnalysisAuto: on('analysis:auto'),
  onAnalysisError: on('analysis:error'),
});
