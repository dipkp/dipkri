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
const APP_ORIGIN = new URL(APP_URL).origin;
const REQUESTED_PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);

// One token per launch: only our own top-level page can drive the local
// torrent client.
const SIDECAR_TOKEN = crypto.randomBytes(24).toString("hex");

const OAUTH_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);

let mainWindow = null;
let sidecar = null;
let sidecarPort = REQUESTED_PORT;
let sidecarReady = false;
let sidecarRestarts = 0;
let quitting = false;

// Exact origin match: "https://app.example.evil.com" must not count as the app.
function isAppUrl(url) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch (e) {
    return false;
  }
}

// A packaged GUI app has no console, and a pipe can break when the parent
// goes away. Either case raises EPIPE, which surfaces as "A JavaScript error
// occurred in the main process" unless the stream has an error listener.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

function logLine(stream, text) {
  try {
    if (stream && stream.writable) stream.write(text);
  } catch (e) {}
}

function pipeChild(stream, target) {
  if (!stream) return;
  stream.on("error", () => {});
  stream.on("data", (chunk) => logLine(target, String(chunk)));
}

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

  pipeChild(sidecar.stdout, process.stdout);
  pipeChild(sidecar.stderr, process.stderr);
  sidecar.on("error", (err) => console.warn("[desktop] sidecar channel error:", err.message));

  sidecar.on("message", (msg) => {
    if (msg && msg.type === "ready" && Number.isInteger(msg.port)) {
      sidecarPort = msg.port;
      sidecarReady = true;
      logLine(process.stdout, `[desktop] sidecar ready on ${sidecarUrl()}\n`);
      if (mainWindow) mainWindow.webContents.send("dipkri:sidecar-port", sidecarPort);
    }
  });

  sidecar.on("exit", (code) => {
    sidecarReady = false;
    console.warn(`[desktop] sidecar exited (${code})`);

    // Recover from a crash, but do not loop forever on a broken install.
    if (!quitting && sidecarRestarts < 3) {
      sidecarRestarts += 1;
      setTimeout(() => {
        if (!quitting) {
          console.warn(`[desktop] restarting sidecar (${sidecarRestarts}/3)`);
          startSidecar();
        }
      }, 1500 * sidecarRestarts);
    }
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

  // Only the app origin and the OAuth consent pages may open inside the app;
  // everything else goes to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    try {
      if (OAUTH_HOSTS.has(new URL(url).hostname)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            webPreferences: {
              preload: undefined,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
    } catch (e) {}
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Keep the window on the app origin, including server-side redirects.
  const guardNavigation = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);

  mainWindow.webContents.once("did-finish-load", () => {
    if (sidecarReady) mainWindow.webContents.send("dipkri:sidecar-port", sidecarPort);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// The token stays with the top-level app frame: OAuth popups inherit the
// preload, so the sender is validated instead of trusting the bridge.
ipcMain.handle("dipkri:sidecar", (event) => {
  const denied = { url: "", token: "", ready: false };
  const frame = event.senderFrame;
  if (!mainWindow || event.sender !== mainWindow.webContents) return denied;
  if (!frame || event.sender.mainFrame !== frame) return denied;
  if (!isAppUrl(frame.url)) return denied;

  return { url: sidecarUrl(), token: SIDECAR_TOKEN, ready: sidecarReady };
});

// Ask the sidecar to delete everything and wait for it to exit, so closing the
// app really leaves no video files behind.
function stopSidecar() {
  return new Promise((resolve) => {
    if (!sidecar || sidecar.killed || sidecar.exitCode !== null) return resolve();

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
      {
        host: "127.0.0.1",
        port: sidecarPort,
        path: "/room-end",
        method: "POST",
        headers: { "x-dipkri-token": SIDECAR_TOKEN },
      },
      () => {}
    );
    req.on("error", () => {});
    req.end();
  });
}

// One window, one sidecar: a second launch would otherwise wipe the cache the
// first instance is streaming from.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

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
}
