// VS Code terminali ELECTRON_RUN_AS_NODE=1 ayarlar; bu Electron'u düz Node gibi çalıştırır. Temizleyip başlatıyoruz.
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, cwd: require('path').join(__dirname, '..') });
child.on('close', (code) => process.exit(code ?? 0));
