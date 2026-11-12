// Sistem tepsisi (saatin yanındaki simgeler): uygulama arka planda burada yaşar.
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const ICON = path.join(__dirname, '..', 'assets', 'tray.png');

// Windows ile başlatma. Portable .exe her açılışta geçici bir klasöre çıkar;
// asıl dosya yolu PORTABLE_EXECUTABLE_FILE'dadır.
function exePath() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }

function getOpenAtLogin() {
  if (!app.isPackaged) return false;
  return app.getLoginItemSettings({ path: exePath(), args: ['--hidden'] }).openAtLogin;
}

function setOpenAtLogin(enabled) {
  if (!app.isPackaged) throw new Error('"Windows ile başlat" sadece kurulu .exe sürümünde çalışır.');
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: exePath(), args: ['--hidden'] });
  return getOpenAtLogin();
}

class TrayManager {
  // actions: { showWindow, toggleOverlay, isOverlayVisible, getHotkey, getStatus, quit }
  constructor(actions) {
    this.a = actions;
    this.tray = new Tray(nativeImage.createFromPath(ICON));
    this.tray.setToolTip('LoL Companion');
    this.tray.on('click', () => this.a.showWindow());
    this.tray.on('double-click', () => this.a.showWindow());
    this.refresh();
  }

  refresh() {
    const status = this.a.getStatus();
    const hotkey = this.a.getHotkey();
    this.tray.setToolTip(`LoL Companion — ${status}`);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'LoL Companion', enabled: false },
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Aç', click: () => this.a.showWindow() },
      {
        label: `Oyun içi pencere${hotkey ? `\t${hotkey}` : ''}`, type: 'checkbox',
        checked: this.a.isOverlayVisible(), click: () => { this.a.toggleOverlay(); this.refresh(); },
      },
      { type: 'separator' },
      {
        label: 'Windows ile başlat', type: 'checkbox', checked: getOpenAtLogin(), enabled: app.isPackaged,
        click: (item) => { try { setOpenAtLogin(item.checked); } catch { /* geliştirme modu */ } this.refresh(); },
      },
      { type: 'separator' },
      { label: 'Çıkış', click: () => this.a.quit() },
    ]));
  }

  // İlk kez tepsiye inince kullanıcıya nerede olduğunu söyle
  notifyHidden() {
    this.tray.displayBalloon({
      iconType: 'info', title: 'LoL Companion arka planda çalışıyor',
      content: 'Açmak için tepsideki simgeye tıkla. Tamamen kapatmak için sağ tık → Çıkış.',
    });
  }

  destroy() { this.tray.destroy(); }
}

module.exports = { TrayManager, getOpenAtLogin, setOpenAtLogin };
