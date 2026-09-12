// The only bridge between the page and the desktop. Nothing else crosses.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  isDesktop: true,
  info: () => ipcRenderer.invoke("studio:info"),
  pickFolder: (title) => ipcRenderer.invoke("studio:pickFolder", title),
  openExternal: (url) => ipcRenderer.invoke("studio:openExternal", url),
  installUpdate: () => ipcRenderer.invoke("studio:installUpdate"),
  updateState: () => ipcRenderer.invoke("studio:updateState"),
  checkForUpdates: () => ipcRenderer.invoke("studio:checkForUpdates"),
  onUpdateState: (fn) => {
    const relay = (_e, s) => fn(s);
    ipcRenderer.on("update:state", relay);
    return () => ipcRenderer.removeListener("update:state", relay);
  },
  onPanePopup: (fn) => ipcRenderer.on("pane:popup", (_e, url) => fn(url)),
});
