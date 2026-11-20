/**
 * dipkri desktop shell (Phase 2)
 *
 * Opens the existing dipkri UI and runs the local torrent sidecar next to it.
 * The server keeps handling rooms/chat/playback sync; media bytes come from
 * this machine's swarm connection via http://127.0.0.1:<port>.
 */

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { fork } = require("child_process");

const APP_URL = process.env.DIPKRI_APP_URL || "https://dipkri.duckdns.org";
const REQUESTED_PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);

// One token per launch: only our renderer can drive the local torrent client.
const SIDECAR_TOKEN = crypto.randomBytes(24).toString("hex");

let mainWindow = null;
let sidecar = null;
let sidecarPort = REQUESTED_PORT;
let sidecarReady = false;
let quitting = false;

function sidecarUrl() {
  return `http://127.0.0.1:${sidecarPort}`;
}

function startSidecar() {
  sidecar = fork(path.join(__dirname, "sidecar.mjs"), [], {
    env: {
      ...process.env,
      DIPKRI_SIDECAR_PORT: String(REQUESTED_PORT),
      DIPKRI_TOKEN: SIDECAR_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  sidecar.stdout.on("data", (d) => process.stdout.write(String(d)));
  sidecar.stderr.on("data", (d) => process.stderr.write(String(d)));

  sidecar.on("message", (msg) => {
    if (msg && msg.type === "ready" && Number.isInteger(msg.port)) {
      sidecarPort = msg.port;
      sidecarReady = true;
      console.log(`[desktop] sidecar ready on ${sidecarUrl()}`);
      if (mainWindow) mainWindow.webContents.send("dipkri:sidecar-port", sidecarPort);
    }
  });

  sidecar.on("exit", (code) => {
    sidecarReady = false;
    console.warn(`[desktop] sidecar exited (${code})`);
  });
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
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // external links open in the system browser; OAuth popups stay in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { hostname } = new URL(url);
      const sameApp = url.startsWith(APP_URL);
      const oauth = hostname === "accounts.google.com" || hostname === "appleid.apple.com";
      if (sameApp || oauth) return { action: "allow" };
    } catch (e) {}
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // never let the page navigate away from the app origin
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (sidecarReady) mainWindow.webContents.send("dipkri:sidecar-port", sidecarPort);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("dipkri:sidecar", () => ({
  url: sidecarUrl(),
  token: SIDECAR_TOKEN,
  ready: sidecarReady,
}));

// Ask the sidecar to delete everything and wait for it to exit, so closing the
// app really leaves no video files behind.
function stopSidecar() {
  return new Promise((resolve) => {
    if (!sidecar || sidecar.killed) return resolve();

    const done = () => resolve();
    const timer = setTimeout(() => {
      try {
        sidecar.kill();
      } catch (e) {}
      resolve();
    }, 2500);

    sidecar.once("exit", () => {
      clearTimeout(timer);
      done();
    });

    if (sidecar.connected) {
      try {
        sidecar.send({ type: "shutdown" });
        return;
      } catch (e) {}
    }

    // fallback: HTTP room-end, then kill
    const req = http.request(
      { host: "127.0.0.1", port: sidecarPort, path: "/room-end", method: "POST", headers: { "x-dipkri-token": SIDECAR_TOKEN } },
      () => {}
    );
    req.on("error", () => {});
    req.end();
  });
}

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

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  stopSidecar().then(() => app.quit());
});
