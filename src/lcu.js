// League Client (LCU) bağlantısı: açık olan League istemcisinin yerel API'si. Anahtar gerekmez.
// Bağlantı bilgisi (port + parola) çalışan LeagueClientUx.exe komut satırından ya da lockfile'dan okunur.

const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');

const LOCKFILE_CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
];

function readProcessArgs() {
  return new Promise((resolve) => {
    const ps = "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const port = stdout.match(/--app-port=(\d+)/)?.[1];
      const token = stdout.match(/--remoting-auth-token=([\w-]+)/)?.[1];
      const dir = stdout.match(/--install-directory=([^"]+)/)?.[1];
      resolve(port && token ? { port: Number(port), password: token, installDir: dir } : null);
    });
  });
}

function readLockfile(extraDir) {
  const paths = extraDir ? [`${extraDir}\\lockfile`, ...LOCKFILE_CANDIDATES] : LOCKFILE_CANDIDATES;
  for (const p of paths) {
    try {
      const [, , port, password] = fs.readFileSync(p, 'utf8').split(':');
      if (port && password) return { port: Number(port), password };
    } catch { /* yok */ }
  }
  return null;
}

class LcuClient {
  constructor() { this.conn = null; this.lastInstallDir = null; this.lastAttempt = 0; this.connecting = null; }

  // İstemci kapalıyken en fazla 10 sn'de bir bağlantı dener (her denemede PowerShell çalışır)
  async connect() {
    if (this.connecting) return this.connecting;
    if (!this.conn && Date.now() - this.lastAttempt < 10000) return false;
    this.lastAttempt = Date.now();
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async _connect() {
    const fromProc = await readProcessArgs();
    if (fromProc?.installDir) this.lastInstallDir = fromProc.installDir;
    this.conn = fromProc || readLockfile(this.lastInstallDir);
    return !!this.conn;
  }

  _raw(method, path) {
    const { port, password } = this.conn;
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1', port, path, method,
        rejectUnauthorized: false, // istemci kendinden imzalı sertifika kullanır; sadece localhost
        timeout: 10000,
        headers: { Authorization: `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`, Accept: 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let data = null;
          try { data = body ? JSON.parse(body) : null; } catch { data = body; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else { const e = new Error(data?.message || `LCU ${res.statusCode}`); e.status = res.statusCode; reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('LCU zaman aşımı')));
      req.on('error', reject);
      req.end();
    });
  }

  // Bağlantı koparsa (istemci yeniden başlatıldı vb.) bir kez yeniden bağlanmayı dener
  async get(path) {
    if (!this.conn && !(await this.connect())) throw new Error('League istemcisi açık değil.');
    try {
      return await this._raw('GET', path);
    } catch (e) {
      if (e.status) throw e;
      this.conn = null;
      this.lastAttempt = 0;
      if (!(await this.connect())) throw new Error('League istemcisi açık değil.');
      return this._raw('GET', path);
    }
  }

  async isAvailable() {
    try { await this.get('/lol-summoner/v1/current-summoner'); return true; } catch { return false; }
  }
}

module.exports = { LcuClient };
