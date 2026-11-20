/**
 * dipkri desktop shell (Phase 2)
 *
 * Opens the existing dipkri UI and runs the local torrent sidecar next to it.
 * The server keeps handling rooms/chat/playback sync; media bytes come from
 * this machine's swarm connection via http://127.0.0.1:<port>.
 */

const { app, BrowserWindow, session, shell, ipcMain } = require("electron");
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

const { isAllowedPopup } = require("./popup-policy");

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

// The window can be destroyed while a message is in flight.
function sendToWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, payload);
  } catch (e) {}
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
      DIPKRI_APP_URL: APP_URL,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  pipeChild(sidecar.stdout, process.stdout);
  pipeChild(sidecar.stderr, process.stderr);
  sidecar.on("error", (err) => {
    console.warn("[desktop] sidecar error:", err.message);
    handleSidecarGone(); // spawn failures emit 'error' without 'exit'
  });

  // Keep the child alive while we are alive; if the shell is force-killed the
  // pings stop and the sidecar cleans up after itself.
  const heartbeat = setInterval(() => {
    if (!sidecar || !sidecar.connected) return;
    try {
      sidecar.send({ type: "ping" });
    } catch (e) {}
  }, 15000);
  heartbeat.unref();

  sidecar.on("message", (msg) => {
    if (msg && msg.type === "ready" && Number.isInteger(msg.port)) {
      sidecarPort = msg.port;
      sidecarReady = true;
      goneHandled = false;
      logLine(process.stdout, `[desktop] sidecar ready on ${sidecarUrl()}\n`);
      sendToWindow("dipkri:sidecar-port", sidecarPort);
    }
  });

  sidecar.on("exit", (code) => {
    console.warn(`[desktop] sidecar exited (${code})`);
    handleSidecarGone();
  });
}

// A child can fail either via 'error' (spawn failure) or 'exit'. Both paths
// land here exactly once, so readiness is reset and one retry is scheduled.
let goneHandled = false;

function handleSidecarGone() {
  sidecarReady = false;
  if (goneHandled) return;
  goneHandled = true;

  if (quitting || sidecarRestarts >= 3) return;
  sidecarRestarts += 1;
  setTimeout(() => {
    goneHandled = false;
    if (!quitting) {
      console.warn(`[desktop] restarting sidecar (${sidecarRestarts}/3)`);
      startSidecar();
    }
  }, 1500 * sidecarRestarts);
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

  // Firebase sign-in opens <project>.firebaseapp.com, which then hops to
  // Google, so that whole auth chain has to stay inside the app. Everything
  // else opens in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPopup(url, APP_ORIGIN)) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Keep the window on the app origin, including server-side redirects.
  const guardNavigation = (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame === false) return; // subframe redirects are not our call
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);

  mainWindow.webContents.once("did-finish-load", () => {
    if (sidecarReady) sendToWindow("dipkri:sidecar-port", sidecarPort);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    // An open OAuth popup would otherwise keep the app (and the sidecar) alive.
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.close();
      } catch (e) {}
    }
  });
}

// The token stays with the top-level app frame: OAuth popups inherit the
// preload, so the sender is validated instead of trusting the bridge.
ipcMain.handle("dipkri:sidecar", (event) => {
  const denied = { url: "", token: "", ready: false };
  if (!sidecarReady) return denied;
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

    if (!sidecarReady) return; // port unknown: just let the timer kill it

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
    // Google blocks OAuth from browsers that identify as Electron (or as any
    // other app), so present a plain Chrome user agent with the same Chromium.
    try {
      const raw = session.defaultSession.getUserAgent();
      const version = (/Chrome\/([\d.]+)/.exec(raw) || [null, "140.0.0.0"])[1];
      const platform = {
        win32: "Windows NT 10.0; Win64; x64",
        darwin: "Macintosh; Intel Mac OS X 10_15_7",
        linux: "X11; Linux x86_64",
      }[process.platform] || "X11; Linux x86_64";
      session.defaultSession.setUserAgent(
        `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`
      );
    } catch (e) {}

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
