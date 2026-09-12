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

  // The presenter window: a second window for the other monitor, outside any capture.
  openPresenter: () => ipcRenderer.invoke("studio:openPresenter"),
  closePresenter: () => ipcRenderer.invoke("studio:closePresenter"),
  presenterOpen: () => ipcRenderer.invoke("studio:presenterOpen"),
  /** Studio window -> presenter window. */
  publishPresenterState: (state) => ipcRenderer.send("presenter:state", state),
  onPresenterState: (fn) => {
    const relay = (_e, s) => fn(s);
    ipcRenderer.on("presenter:state", relay);
    return () => ipcRenderer.removeListener("presenter:state", relay);
  },
  /** Presenter window -> studio window. */
  sendPresenterCommand: (cmd) => ipcRenderer.send("presenter:command", cmd),
  onPresenterCommand: (fn) => {
    const relay = (_e, c) => fn(c);
    ipcRenderer.on("presenter:command", relay);
    return () => ipcRenderer.removeListener("presenter:command", relay);
  },
  onPresenterClosed: (fn) => {
    const relay = () => fn();
    ipcRenderer.on("presenter:closed", relay);
    return () => ipcRenderer.removeListener("presenter:closed", relay);
  },
});
