// League'in oyun içi görüntü modunu okur (Config/game.cfg → WindowMode).
// 0 = Tam ekran (üstüne pencere çizilemez), 1 = Pencere, 2 = Çerçevesiz
const fs = require('fs');
const path = require('path');

const DEFAULT_DIRS = [
  'C:\\Riot Games\\League of Legends',
  'D:\\Riot Games\\League of Legends',
  'C:\\Program Files\\Riot Games\\League of Legends',
];

function readWindowMode(installDir) {
  const dirs = installDir ? [installDir, ...DEFAULT_DIRS] : DEFAULT_DIRS;
  for (const dir of dirs) {
    try {
      const cfg = fs.readFileSync(path.join(dir, 'Config', 'game.cfg'), 'utf8');
      const m = cfg.match(/^\s*WindowMode\s*=\s*(\d)/m);
      if (m) return Number(m[1]);
    } catch { /* bu klasörde yok */ }
  }
  return null; // bilinmiyor
}

const MODE_TR = { 0: 'Tam ekran', 1: 'Pencere', 2: 'Çerçevesiz' };

module.exports = { readWindowMode, MODE_TR };
