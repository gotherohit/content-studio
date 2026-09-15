// Runs the real Studio renderer against a separately started development server.
// Pass a fresh profile beneath the dedicated test folder; never open a real project.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const profile = process.argv.find(x => x.startsWith('--test-profile='))?.slice(15);
const root = path.resolve('D:/test content studio');
if (!profile || !path.resolve(profile).startsWith(root + path.sep)) throw Error('A dedicated test profile is required');
app.setPath('userData', path.resolve(profile));
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1400, height: 950, title: 'Studio Jupyter verification' });
  win.loadURL('http://127.0.0.1:4710/');
});
app.on('window-all-closed', () => app.quit());
