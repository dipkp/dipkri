"use strict";

/**
 * dipkri desktop shell (Phase 1)
 *
 * Opens the existing dipkri UI and runs the local torrent sidecar next to it.
 * The server keeps handling rooms/chat/playback sync; media bytes come from
 * this machine's swarm connection via http://127.0.0.1:<port>.
 */

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const { fork } = require("child_process");

const APP_URL = process.env.DIPKRI_APP_URL || "https://dipkri.duckdns.org";
const SIDECAR_PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);
const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

let mainWindow = null;
let sidecar = null;

function startSidecar() {
  sidecar = fork(path.join(__dirname, "sidecar.mjs"), [], {
    env: { ...process.env, DIPKRI_SIDECAR_PORT: String(SIDECAR_PORT) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  sidecar.stdout.on("data", (d) => process.stdout.write(`[sidecar] ${d}`));
  sidecar.stderr.on("data", (d) => process.stderr.write(`[sidecar:err] ${d}`));
  sidecar.on("exit", (code) => console.warn(`[desktop] sidecar exited (${code})`));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0b0b12",
    title: "dipkri",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  // external links open in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("dipkri:sidecar-url", () => SIDECAR_URL);

app.whenReady().then(() => {
  startSidecar();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (sidecar && !sidecar.killed) {
    try {
      sidecar.kill();
    } catch (e) {}
  }
});
