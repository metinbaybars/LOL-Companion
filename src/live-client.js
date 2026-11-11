// League istemcisinin oyun sırasında açtığı yerel Live Client Data API'sini (https://127.0.0.1:2999) dinler.
// Bu API anahtar gerektirmez ve sadece oyun yüklendikten sonra çalışır.

const https = require('https');
const { EventEmitter } = require('events');

function getLocal(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: '127.0.0.1', port: 2999, path,
      rejectUnauthorized: false, // istemci kendinden imzalı sertifika kullanır; sadece localhost için
      timeout: 1500,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class LiveClient extends EventEmitter {
  constructor(intervalMs = 2000) {
    super();
    this.intervalMs = intervalMs;
    this.inGame = false;
    this.last = null;
    this.timer = null;
  }
  start() {
    if (this.timer) return;
    const tick = async () => {
      try {
        const data = await getLocal('/liveclientdata/allgamedata');
        if (!data || !data.allPlayers || !data.allPlayers.length) throw new Error('yükleniyor');
        if (!this.inGame) { this.inGame = true; this.emit('gameStart', data); }
        this.last = data;
        this.emit('update', data);
      } catch {
        if (this.inGame) { this.inGame = false; this.last = null; this.emit('gameEnd'); }
      }
      this.timer = setTimeout(tick, this.intervalMs);
    };
    tick();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { LiveClient };
