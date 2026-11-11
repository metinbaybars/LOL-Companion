// Oyun içi küçük pencere: kısayol tuşuyla açılır/kapanır, tıklamaları oyuna geçirir, odak çalmaz.
// Not: League "Tam ekran" modunda üstüne pencere çizilemez; "Çerçevesiz" veya "Pencere" modu gerekir.

const { BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('path');
const { cleanText } = require('./riot-api');

const WIDTH = 330;
const HEIGHT = 560; // panel içeriğe göre uzar; boş alan şeffaf ve tıklanamaz
const MARGIN = 16;
const norm = (s) => cleanText(s).toLowerCase();

class OverlayManager {
  constructor({ getSettings, ddragon }) {
    this.getSettings = getSettings;
    this.ddragon = ddragon;
    this.win = null;
    this.visible = false;
    this.hotkey = null;
    // Ana pencereye giden olaylardan toplanan son durum
    this.snap = null;
    this.inGame = false;
    this.analysis = null; // { myTeam, players, reports: { normRiotId: report } }
    this.summary = null;
    this._pushTimer = null;
  }

  // ---- Kısayol ----
  setHotkey(accelerator) {
    if (this.hotkey) { try { globalShortcut.unregister(this.hotkey); } catch { /* yok say */ } }
    this.hotkey = null;
    if (!accelerator) return true;
    let ok = false;
    try { ok = globalShortcut.register(accelerator, () => this.toggle()); } catch { ok = false; }
    if (ok) this.hotkey = accelerator;
    return ok;
  }

  // ---- Pencere ----
  _create() {
    this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT,
      frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-overlay.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver'); // oyunun da üstünde
    this.win.setIgnoreMouseEvents(true);           // tıklamalar oyuna geçsin
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
    this.win.webContents.on('did-finish-load', () => this.push(true));
    this.win.on('closed', () => { this.win = null; this.visible = false; });
  }

  _position() {
    if (!this.win) return;
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds; // oyun tüm ekranı kaplar
    const pos = this.getSettings().overlayPosition || 'right';
    const left = pos.includes('left') ? x + MARGIN : x + width - WIDTH - MARGIN;
    let top;
    if (pos.startsWith('top')) top = y + 90;
    else if (pos.startsWith('bottom')) top = y + height - HEIGHT - 260; // minimap/skor tablosunun üstü
    else top = y + Math.round((height - HEIGHT) / 2);
    this.win.setBounds({ x: left, y: Math.max(y, top), width: WIDTH, height: HEIGHT });
  }

  show() {
    if (!this.win) this._create();
    this._position();
    this.win.showInactive(); // odağı oyundan çalma
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.visible = true;
    this.push(true);
  }

  hide() {
    if (this.win) this.win.hide();
    this.visible = false;
  }

  toggle() { if (this.visible) this.hide(); else this.show(); return this.visible; }

  applySettings() { if (this.visible) { this._position(); this.push(true); } }

  destroy() {
    globalShortcut.unregisterAll();
    if (this.win) this.win.destroy();
  }

  // ---- Veri ----
  // Ana pencereye gönderilen olayları izleyip overlay durumunu günceller
  track(channel, payload) {
    switch (channel) {
      case 'live:update': this.snap = payload; this.inGame = true; break;
      case 'live:state':
        this.inGame = payload.inGame;
        if (!payload.inGame) { this.snap = null; if (this.getSettings().overlayAutoShow) this.hide(); }
        else if (this.getSettings().overlayAutoShow) this.show();
        break;
      case 'analysis:start':
        this.analysis = { myTeam: payload.myTeam, players: payload.players, reports: {} };
        this.summary = null;
        break;
      case 'analysis:player':
        if (this.analysis) this.analysis.reports[norm(payload.riotId)] = payload;
        break;
      case 'analysis:done': this.summary = payload; break;
      default: return;
    }
    this.push();
  }

  // Sık güncellemeleri birleştir (en fazla ~4/sn)
  push(now = false) {
    if (!this.visible || !this.win || this.win.isDestroyed()) return;
    if (now) { clearTimeout(this._pushTimer); this._pushTimer = null; this._send(); return; }
    if (this._pushTimer) return;
    this._pushTimer = setTimeout(() => { this._pushTimer = null; this._send(); }, 250);
  }

  _send() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('overlay:data', this.build());
  }

  build() {
    const s = this.getSettings();
    const snap = this.inGame ? this.snap : null;
    const reports = this.analysis?.reports || {};
    const myTeam = snap?.myTeam || this.analysis?.myTeam;
    const slim = (r) => r && (r.error ? { error: r.error } : {
      solo: r.solo && { tier: r.solo.tier, rank: r.solo.rank, lp: r.solo.lp },
      threat: r.threat, position: r.position,
      tags: r.tags, games: r.summary.games, winrate: r.summary.winrate,
      champGames: r.champStats?.games || 0,
    });

    let enemies = [];
    if (snap) {
      enemies = snap.players.filter((p) => p.team !== snap.myTeam).map((p) => ({
        riotId: p.riotId, champion: p.champion, level: p.level,
        kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.cs,
        isDead: p.isDead, respawn: p.respawnTimer,
        report: slim(reports[norm(p.riotId)]),
      }));
    } else if (this.analysis) {
      enemies = this.analysis.players.filter((p) => p.team !== myTeam).map((p) => ({
        riotId: p.riotId, champion: p.champion, report: slim(reports[norm(p.riotId)]),
      }));
    }

    let score = null;
    if (snap) {
      const A = snap.teams[snap.myTeam];
      const E = snap.teams[snap.enemyTeam];
      score = { ally: A, enemy: E, goldDiff: A.itemGold - E.itemGold };
    }

    return {
      inGame: !!snap, gameTime: snap?.gameTime || 0, score, enemies,
      enemySummary: this.summary?.enemy || null, allySummary: this.summary?.ally || null,
      ddVersion: this.ddragon.state.version,
      hotkey: this.hotkey, opacity: s.overlayOpacity ?? 0.88, position: s.overlayPosition || 'right',
    };
  }
}

module.exports = { OverlayManager };
