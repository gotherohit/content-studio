// Disposable native window for manual handoff verification; no project or user files.
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 760, height: 500, title: "Handoff test target" });
  win.webContents.once("did-finish-load", () => {
    win.show();
    win.webContents.executeJavaScript(`document.body.dataset.hwnd = '${win.getNativeWindowHandle().readBigUInt64LE()}'`);
  });
  win.loadURL('data:text/html,' + encodeURIComponent('<title>Handoff test target</title><body style="font:20px system-ui;padding:30px"><h1>Handoff test target</h1><p>Type, select and drag here using the real app.</p><textarea aria-label="Test editor" style="width:95%;height:180px">Scratch text only</textarea></body>'));
});
app.on("window-all-closed", () => app.quit());
