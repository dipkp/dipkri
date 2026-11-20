"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// The web UI can detect the desktop shell and switch the player source to the
// local sidecar (zero server traffic) when window.dipkriDesktop is present.
contextBridge.exposeInMainWorld("dipkriDesktop", {
  isDesktop: true,
  getSidecarUrl: () => ipcRenderer.invoke("dipkri:sidecar-url"),
});
