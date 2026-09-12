// The only bridge between the page and the desktop. Nothing else crosses.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  isDesktop: true,
  info: () => ipcRenderer.invoke("studio:info"),
  pickFolder: (title) => ipcRenderer.invoke("studio:pickFolder", title),
  openExternal: (url) => ipcRenderer.invoke("studio:openExternal", url),
  installUpdate: () => ipcRenderer.invoke("studio:installUpdate"),
  onUpdateReady: (fn) => ipcRenderer.on("update:ready", (_e, v) => fn(v)),
  onPanePopup: (fn) => ipcRenderer.on("pane:popup", (_e, url) => fn(url)),
});
