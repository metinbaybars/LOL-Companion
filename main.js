const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { OverlayManager } = require('./src/overlay');
const path = require('path');
const fs = require('fs');
const { RiotApi, parseRiotId, cleanText } = require('./src/riot-api');
const { LcuClient } = require('./src/lcu');
const { LcuProvider, RiotProvider, mapLimit } = require('./src/providers');
const { LiveClient } = require('./src/live-client');
const ddragon = require('./src/ddragon');
const analysis = require('./src/analysis');

// ---------- Ayarlar ----------
const DEFAULT_SETTINGS = {
  dataSource: 'auto', // auto: istemci açıksa istemci, değilse Riot API | riot: sadece Riot API
  apiKey: '', platform: 'tr1', riotId: '', alwaysOnTop: false,
  profileMatchCount: 15, liveMatchCount: 8, autoAnalyze: true,
  // Oyun içi pencere
  overlayHotkey: 'Alt+X', overlayPosition: 'right', overlayOpacity: 0.88, overlayAutoShow: false,
};
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  let s = { ...DEFAULT_SETTINGS };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* ilk çalıştırma */ }
  if (!s.apiKey && process.env.RIOT_API_KEY) s.apiKey = process.env.RIOT_API_KEY;
  s.riotId = cleanText(s.riotId);
  s.apiKey = cleanText(s.apiKey);
  return s;
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

let settings;
let riot;
let lcuProvider;
let riotProvider;
let win;
const live = new LiveClient(2000);
let analysisRun = 0; // yeni analiz başlayınca eskisini iptal etmek için
let overlay;

const send = (ch, payload) => {
  if (overlay) overlay.track(ch, payload); // oyun içi pencere de aynı olayları izler
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
};

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { console.error(channel, e.message); return { ok: false, error: e.message || String(e) }; }
  });
}

// Hangi kaynaktan veri çekileceğini seçer
async function getProvider() {
  if (settings.dataSource !== 'riot' && (await lcuProvider.available())) return lcuProvider;
  if (settings.apiKey) return riotProvider;
  throw new Error(settings.dataSource === 'riot'
    ? 'Riot API anahtarı girilmemiş (Ayarlar).'
    : 'League istemcisi açık değil. İstemciyi açıp tekrar deneyin.');
}

async function sourceStatus() {
  const lcuOk = settings.dataSource !== 'riot' && (await lcuProvider.available());
  const source = lcuOk ? 'lcu' : settings.apiKey ? 'riot' : null;
  return { source, label: source === 'lcu' ? 'League istemcisi' : source === 'riot' ? 'Riot API' : null };
}

// ---------- Profil ----------
let queueNamesLoaded = false;
async function loadQueueNames() {
  if (queueNamesLoaded) return;
  try {
    const qs = await lcuProvider.lcu.get('/lol-game-queues/v1/queues');
    const map = {};
    for (const q of qs || []) if (q.name || q.description) map[q.id] = q.name || q.description;
    analysis.setQueueNames(map);
    queueNamesLoaded = true;
  } catch { /* sabit liste kullanılır */ }
}

async function lookupProfile(riotIdStr) {
  await ddragon.load().catch(() => {});
  const provider = await getProvider();
  if (provider.name === 'lcu') await loadQueueNames();
  const [gameName, tagLine] = parseRiotId(riotIdStr);
  const account = await provider.findPlayer(gameName, tagLine);
  const puuid = account.puuid;
  const [summoner, league, masteries, matches] = await Promise.all([
    provider.getSummoner(puuid),
    provider.getLeague(puuid).catch(() => []),
    provider.getTopMasteries(puuid, 5).catch(() => []),
    provider.getMatches(puuid, settings.profileMatchCount, { full: true }),
  ]);
  return {
    source: provider.label,
    account, summoner,
    solo: analysis.soloEntry(league), flex: analysis.flexEntry(league),
    masteries: masteries.map((m) => ({ ...m, champion: ddragon.resolveChampion({ championId: m.championId }) })),
    summary: analysis.summarize(matches, puuid),
    matches: matches.map((m) => analysis.matchRow(m, puuid)).filter(Boolean),
  };
}

async function myRiotId() {
  if (settings.dataSource !== 'riot' && (await lcuProvider.available())) {
    const me = await lcuProvider.getCurrentPlayer().catch(() => null);
    if (me?.gameName) return `${me.gameName}#${me.tagLine}`;
  }
  return settings.riotId || '';
}

// ---------- Oyun analizi ----------
async function analyzePlayers(provider, players, myTeam) {
  const run = ++analysisRun;
  await ddragon.load().catch(() => {});
  const ordered = [...players].sort((a, b) => (a.team === myTeam) - (b.team === myTeam)); // önce rakipler

  send('analysis:start', {
    source: provider.label, myTeam,
    players: ordered.map((p) => ({ riotId: p.riotId, team: p.team, champion: ddragon.resolveChampion(p), position: p.position })),
  });

  const reports = [];
  await mapLimit(ordered, provider.name === 'lcu' ? 4 : 2, async (p) => {
    if (run !== analysisRun) return;
    try {
      let puuid = p.puuid;
      if (!puuid) {
        const [g, t] = parseRiotId(p.riotId);
        puuid = (await provider.findPlayer(g, t)).puuid;
      }
      const champion = ddragon.resolveChampion(p);
      const [summoner, league, mastery, matches] = await Promise.all([
        provider.getSummoner(puuid).catch(() => null),
        provider.getLeague(puuid).catch(() => []),
        champion ? provider.getChampionMastery(puuid, champion.key).catch(() => null) : null,
        provider.getMatches(puuid, settings.liveMatchCount).catch(() => []),
      ]);
      const report = analysis.playerReport({
        riotId: p.riotId, puuid, team: p.team, champion, position: p.position, league, mastery, summoner, matches,
      });
      reports.push(report);
      if (run === analysisRun) send('analysis:player', report);
    } catch (e) {
      if (run === analysisRun) send('analysis:player', { riotId: p.riotId, team: p.team, error: e.message });
    }
  });
  if (run !== analysisRun) return;
  send('analysis:done', {
    ally: analysis.teamSummary(reports.filter((r) => r.team === myTeam)),
    enemy: analysis.teamSummary(reports.filter((r) => r.team !== myTeam)),
  });
}

async function analyzeActiveGame() {
  await ddragon.load().catch(() => {});
  const provider = await getProvider();
  const game = await provider.getActiveGame({ live: live.last, riotId: settings.riotId });
  if (!game || !game.players.length) {
    throw new Error('Aktif oyun bulunamadı. Analiz, oyun yükleme ekranı açıldığında başlar.');
  }
  analyzePlayers(provider, game.players, game.myTeam).catch((e) => send('analysis:error', e.message));
  return { queue: game.queue, source: provider.label };
}

// ---------- Otomatik oyun algılama ----------
let analyzedThisGame = false;
let lastPhase = null;
function tryAutoAnalyze() {
  if (analyzedThisGame || !settings.autoAnalyze) return;
  analyzedThisGame = true;
  analyzeActiveGame()
    .then((g) => send('analysis:auto', g))
    .catch((e) => { analyzedThisGame = false; console.error('auto analyze:', e.message); });
}

async function pollClientPhase() {
  let phase = null;
  if (settings.dataSource !== 'riot' && (await lcuProvider.available())) {
    phase = await lcuProvider.lcu.get('/lol-gameflow/v1/gameflow-phase').catch(() => null);
  }
  if (phase !== lastPhase) { lastPhase = phase; send('client:phase', phase); }
  if (phase === 'InProgress') tryAutoAnalyze(); // yükleme ekranında başlar
  else if (!live.inGame && phase !== 'Reconnect') analyzedThisGame = false;
  setTimeout(pollClientPhase, 3000);
}

// ---------- Pencere ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#07090e',
    title: 'LoL Companion',
    autoHideMenuBar: true,
    // Özel koyu başlık çubuğu; küçült/büyüt/kapat düğmeleri Windows'un kendisi
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07090e', symbolColor: '#a3adbd', height: 40 },
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; app.quit(); }); // gizli oyun içi pencere uygulamayı açık tutmasın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  settings = loadSettings();
  riot = new RiotApi({ apiKey: settings.apiKey, platform: settings.platform });
  lcuProvider = new LcuProvider(new LcuClient());
  riotProvider = new RiotProvider(riot);
  overlay = new OverlayManager({ getSettings: () => settings, ddragon });
  if (!overlay.setHotkey(settings.overlayHotkey)) console.error('Kısayol kaydedilemedi:', settings.overlayHotkey);

  // Anahtarın kendisi arayüze gönderilmez, sadece ayarlı olup olmadığı
  const publicSettings = () => ({ ...settings, apiKey: '', apiKeySet: !!settings.apiKey });
  handle('settings:get', publicSettings);
  handle('settings:set', (patch) => {
    patch = { ...patch };
    if (!patch.apiKey) delete patch.apiKey; else patch.apiKey = cleanText(patch.apiKey);
    if (patch.riotId !== undefined) patch.riotId = cleanText(patch.riotId);
    // Kısayol değiştiyse önce kaydetmeyi dene; başka program kullanıyorsa eskisini geri al
    if (patch.overlayHotkey !== undefined && patch.overlayHotkey !== overlay.hotkey) {
      if (!overlay.setHotkey(patch.overlayHotkey)) {
        overlay.setHotkey(settings.overlayHotkey);
        throw new Error(`"${patch.overlayHotkey}" kısayolu kullanılamıyor (başka bir program kullanıyor olabilir).`);
      }
    }
    settings = { ...settings, ...patch };
    overlay.applySettings();
    saveSettings(settings);
    riot.configure({ apiKey: settings.apiKey, platform: settings.platform });
    if (win && patch.alwaysOnTop !== undefined) win.setAlwaysOnTop(!!settings.alwaysOnTop);
    return publicSettings();
  });
  handle('settings:clearKey', () => {
    settings.apiKey = '';
    saveSettings(settings);
    riot.configure({ apiKey: '' });
    return publicSettings();
  });
  handle('source:status', sourceStatus);
  handle('ddragon:get', async () => { await ddragon.load(); return ddragon.publicData(); });
  handle('profile:lookup', (riotId) => lookupProfile(riotId));
  handle('profile:me', myRiotId);
  handle('game:analyze', analyzeActiveGame);
  handle('live:status', () => ({ inGame: live.inGame, phase: lastPhase }));
  handle('overlay:toggle', () => overlay.toggle());
  handle('overlay:status', () => ({ visible: overlay.visible, hotkey: overlay.hotkey }));
  handle('open:external', (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  createWindow();

  live.on('gameStart', () => { send('live:state', { inGame: true }); tryAutoAnalyze(); });
  live.on('update', (data) => send('live:update', analysis.liveSnapshot(data, ddragon)));
  live.on('gameEnd', () => send('live:state', { inGame: false }));
  ddragon.load().catch((e) => console.error('DDragon yüklenemedi:', e.message)).finally(() => live.start());
  pollClientPhase();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Oyun içi pencere açık kalsa bile ana pencere kapanınca uygulama kapanır
app.on('window-all-closed', () => { live.stop(); if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (overlay) overlay.destroy(); });
