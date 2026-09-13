const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("handoff", {
  back: () => ipcRenderer.invoke("handoff:return"),
  hide: () => ipcRenderer.invoke("handoff:hide"),
});
