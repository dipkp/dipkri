const { contextBridge, ipcRenderer } = require("electron");

// The web UI detects this bridge and switches the player to the local
// sidecar (zero server traffic). The token never leaves this process pair.
contextBridge.exposeInMainWorld("dipkriDesktop", {
  isDesktop: true,
  getSidecar: () => ipcRenderer.invoke("dipkri:sidecar"),
  onSidecarPort: (cb) => {
    const listener = (_event, port) => cb(port);
    ipcRenderer.on("dipkri:sidecar-port", listener);
    return () => ipcRenderer.removeListener("dipkri:sidecar-port", listener);
  },
});
