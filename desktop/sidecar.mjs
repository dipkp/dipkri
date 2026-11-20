/**
 * dipkri local torrent sidecar (Phase 2)
 *
 * Runs on the user's machine, next to the app. Torrent bytes never touch our
 * server: this process streams from the swarm to 127.0.0.1 and deletes the
 * data when the room ends or the app quits.
 *
 *   GET  /health                                  (no token, loopback only)
 *   GET  /info?torrent=<magnet>
 *   GET  /stream?torrent=<magnet>&fileIndex=N     (Range supported)
 *   POST /stop      { infoHash }
 *   POST /room-end
 *
 * Only magnet URIs are accepted, every endpoint except /health needs the
 * per-launch token, and the Host header must be loopback, so a random website
 * cannot drive the local torrent client.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import WebTorrent from "webtorrent";
import parseTorrent from "parse-torrent";

const BASE_PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);
const TOKEN = String(process.env.DIPKRI_TOKEN || "");

// The sidecar owns this folder completely: it is removed on boot and on quit.
const CACHE_ROOT = path.join(
  process.env.DIPKRI_CACHE_DIR || os.tmpdir(),
  "dipkri-cache"
);

const IDLE_MINUTES = Number(process.env.DIPKRI_IDLE_MINUTES || 30);
const MIN_FREE_GB = Number(process.env.DIPKRI_MIN_FREE_GB || 1);
const META_TIMEOUT_MS = Number(process.env.DIPKRI_META_TIMEOUT_MS || 40000);
const DESTROY_TIMEOUT_MS = Number(process.env.DIPKRI_DESTROY_TIMEOUT_MS || 5000);
const PARENT_TIMEOUT_MS = Number(process.env.DIPKRI_PARENT_TIMEOUT_MS || 90000);
const MAX_BODY_BYTES = 64 * 1024;

const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.DIPKRI_APP_URL || "https://dipkri.duckdns.org").origin;
  } catch (e) {
    return "https://dipkri.duckdns.org";
  }
})();

// The configured app plus the local dev server; never a wildcard.
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
};

if (!TOKEN) {
  console.error(
    "[sidecar] DIPKRI_TOKEN is not set. The sidecar refuses to start without it:\n" +
      "          set DIPKRI_TOKEN=<random string> (the Electron shell does this for you)."
  );
  process.exit(1);
}

// A previous run may have crashed mid-playback: start from a clean slate.
try {
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({ maxConns: 80 });
const pending = new Map(); // infoHash -> Promise<Torrent>
let shuttingDown = false;

client.on("error", (err) => console.warn("[sidecar] client error:", err && err.message));

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
process.on("uncaughtException", (err) => {
  console.error("[sidecar] uncaught:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  console.error("[sidecar] unhandled rejection:", err && err.stack ? err.stack : err);
});

// --- helpers ----------------------------------------------------------------

function freeDiskGB() {
  try {
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(CACHE_ROOT);
      return (Number(s.bavail) * Number(s.bsize)) / 1e9;
    }
  } catch (e) {}
  return Number.POSITIVE_INFINITY;
}

function cacheSizeMB() {
  let total = 0;
  try {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };
    walk(CACHE_ROOT);
  } catch (e) {}
  return total / (1024 * 1024);
}

function mimeFor(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || "").toLowerCase();
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "x-dipkri-token, content-type, range",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    Vary: "Origin",
  };
}

function json(req, res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(req),
  });
  res.end(body);
}

function tokenMatches(req, url) {
  const given = String(req.headers["x-dipkri-token"] || url.searchParams.get("token") || "");
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hostIsLocal(req) {
  const host = String(req.headers.host || "").toLowerCase();
  if (!host) return false;
  const name = host.replace(/:\d+$/, "");
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // native client, curl, or a <video> tag without CORS
  return ALLOWED_ORIGINS.has(String(origin).toLowerCase());
}

// Only magnet links are accepted: WebTorrent would otherwise also treat the
// string as a file path or an http(s) URL.
async function readMagnet(raw) {
  const value = String(raw || "").trim();
  if (!value.toLowerCase().startsWith("magnet:?")) return null;
  try {
    const parsed = await parseTorrent(value);
    if (!parsed || !parsed.infoHash) return null;
    return {
      infoHash: String(parsed.infoHash).toLowerCase(),
      magnet: value,
    };
  } catch (e) {
    return null;
  }
}

function videoFiles(torrent) {
  return (torrent.files || [])
    .map((f, index) => ({ index, name: f.name, length: f.length }))
    .filter((f) => MIME_BY_EXT[path.extname(String(f.name || "")).toLowerCase()])
    .sort((a, b) => b.length - a.length);
}

function findLoaded(infoHash) {
  return client.torrents.find((t) => (t.infoHash || "").toLowerCase() === infoHash);
}

// Resolve only once the torrent has metadata; `files` is empty before that.
// Always settles: /stop, the sweeper or a timeout can destroy the torrent
// while a request is still waiting.
function whenReady(torrent) {
  torrent.__lastAccess = Date.now();
  if (torrent.ready) return Promise.resolve(torrent);
  if (torrent.destroyed) return Promise.reject(new Error("torrent closed"));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("torrent did not become ready in time"));
    }, META_TIMEOUT_MS);

    const onReady = () => {
      cleanup();
      torrent.__lastAccess = Date.now();
      resolve(torrent);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("torrent closed"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      torrent.removeListener("ready", onReady);
      torrent.removeListener("error", onError);
      torrent.removeListener("close", onClose);
    };

    torrent.once("ready", onReady);
    torrent.once("error", onError);
    torrent.once("close", onClose);
  });
}

function addTorrent({ infoHash, magnet }) {
  if (pending.has(infoHash)) return pending.get(infoHash);

  const known = findLoaded(infoHash);
  if (known) return whenReady(known);

  const promise = new Promise((resolve, reject) => {
    let torrent;
    try {
      torrent = client.add(magnet, {
        announce: TRACKERS,
        path: path.join(CACHE_ROOT, infoHash),
        deselect: true, // metadata only: /info must not pull the whole movie
        destroyStoreOnDestroy: true,
      });
    } catch (err) {
      const dup = findLoaded(infoHash);
      return dup ? whenReady(dup).then(resolve, reject) : reject(err);
    }

    torrent.__lastAccess = Date.now();
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(infoHash);
      torrent.removeListener("ready", onReady);
      torrent.removeListener("error", onError);
      torrent.removeListener("close", onClose);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("No seeders responded in time"));
      void destroyTorrent(torrent, "metadata timeout");
    }, META_TIMEOUT_MS);

    const onReady = () => finish(resolve, torrent);
    const onError = (err) => finish(reject, err);
    const onClose = () => finish(reject, new Error("torrent closed"));

    torrent.once("ready", onReady);
    torrent.once("error", onError);
    torrent.once("close", onClose);
  });

  pending.set(infoHash, promise);
  // A failed add must not stay cached (client.add can throw synchronously,
  // in which case finish() never runs).
  promise.then(
    () => pending.delete(infoHash),
    () => pending.delete(infoHash)
  );
  return promise;
}

// Resolves true only when the store was actually deleted.
function destroyTorrent(torrent, reason) {
  if (!torrent) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      console.warn(`[sidecar] destroy timed out: ${torrent.infoHash || "?"}`);
      finish(false);
    }, DESTROY_TIMEOUT_MS);

    console.log(`[sidecar] dropping ${torrent.infoHash || torrent.magnetURI || "?"} (${reason})`);
    try {
      torrent.destroy({ destroyStore: true }, (err) => {
        if (err) console.warn("[sidecar] destroy error:", err.message);
        finish(!err);
      });
    } catch (err) {
      console.warn("[sidecar] destroy threw:", err.message);
      finish(false);
    }
  });
}

async function destroyAll(reason) {
  const list = [...client.torrents];
  const results = await Promise.all(list.map((t) => destroyTorrent(t, reason)));
  return { dropped: list.length, deleted: results.every(Boolean) };
}

function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;

  let start;
  let end;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end, partial: true };
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve("");
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(""));
  });
}

// --- periodic sweeper -------------------------------------------------------

setInterval(() => {
  if (shuttingDown) return;
  const cutoff = Date.now() - IDLE_MINUTES * 60000;
  for (const t of [...client.torrents]) {
    if ((t.__active || 0) > 0) continue;
    if ((t.__lastAccess || 0) < cutoff) void destroyTorrent(t, "idle");
  }
}, 60000).unref();

// --- routes -----------------------------------------------------------------

async function handleInfo(req, res, url) {
  const target = await readMagnet(url.searchParams.get("torrent"));
  if (!target) return json(req, res, 400, { ok: false, error: "invalid magnet" });

  const torrent = await addTorrent(target);
  return json(req, res, 200, {
    ok: true,
    infoHash: torrent.infoHash,
    name: torrent.name,
    files: videoFiles(torrent),
  });
}

async function handleStream(req, res, url) {
  const target = await readMagnet(url.searchParams.get("torrent"));
  if (!target) return json(req, res, 400, { ok: false, error: "invalid magnet" });

  const rawIndex = url.searchParams.get("fileIndex");
  let fileIndex = null;
  if (rawIndex !== null) {
    fileIndex = Number(rawIndex);
    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      return json(req, res, 400, { ok: false, error: "bad fileIndex" });
    }
  }

  if (freeDiskGB() < MIN_FREE_GB) {
    return json(req, res, 507, {
      ok: false,
      error: "Not enough free disk space on this device",
    });
  }

  const torrent = await addTorrent(target);
  if (res.destroyed) return; // player gave up while metadata was loading

  torrent.__lastAccess = Date.now();

  const files = torrent.files || [];
  let file;
  if (fileIndex === null) {
    const videos = videoFiles(torrent);
    file = videos.length > 0 ? files[videos[0].index] : null;
  } else {
    file = files[fileIndex] || null; // an explicit index must exist
  }
  if (!file) return json(req, res, 404, { ok: false, error: "no playable file" });

  const size = file.length;
  if (!size) return json(req, res, 404, { ok: false, error: "empty file" });

  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.writeHead(416, { "Content-Range": `bytes */${size}`, ...corsHeaders(req) });
    return res.end();
  }

  const { start, end, partial } = range;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": mimeFor(file.name),
    "Cache-Control": "no-store",
    ...corsHeaders(req),
  };
  if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, headers);

  if (req.method === "HEAD") return res.end();
  if (res.destroyed) return;

  torrent.__active = (torrent.__active || 0) + 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    torrent.__active = Math.max(0, (torrent.__active || 1) - 1);
    torrent.__lastAccess = Date.now();
    try {
      file.deselect();
    } catch (e) {}
  };
  res.on("close", release);

  try {
    file.select();
  } catch (e) {}

  // WebTorrent reads `end: 0` as "to the end of the file", so a one-byte range
  // needs a bounded read of its own.
  if (end === 0) {
    const raw = file.createReadStream({ start: 0, end: 1 });
    raw.once("data", (chunk) => {
      try {
        res.write(chunk.subarray(0, 1));
      } catch (e) {}
      raw.destroy();
      release();
      res.end();
    });
    raw.once("error", () => {
      release();
      try {
        res.end();
      } catch (e) {}
    });
    return;
  }

  const stream = file.createReadStream({ start, end });
  stream.on("error", () => {
    release();
    if (!res.headersSent) res.writeHead(500);
    try {
      res.end();
    } catch (e) {}
  });
  stream.on("end", release);
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

async function handleControl(req, res, url) {
  const body = await readBody(req);

  if (url.pathname === "/room-end") {
    const result = await destroyAll("room ended");
    return json(req, res, 200, { ok: true, ...result });
  }

  let infoHash = "";
  try {
    infoHash = String(JSON.parse(body || "{}").infoHash || "").toLowerCase();
  } catch (e) {}
  if (!infoHash) return json(req, res, 400, { ok: false, error: "missing infoHash" });

  const target = findLoaded(infoHash);
  const deleted = await destroyTorrent(target, "stop requested");
  return json(req, res, 200, { ok: true, dropped: Boolean(target), deleted });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostIsLocal(req)) {
      return json(req, res, 403, { ok: false, error: "forbidden host" });
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${server.address()?.port || BASE_PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (url.pathname === "/health") {
      return json(req, res, 200, {
        ok: true,
        torrents: client.torrents.length,
        freeDiskGB: Number(freeDiskGB().toFixed(1)),
        cacheDir: CACHE_ROOT,
        cacheMB: Number(cacheSizeMB().toFixed(1)),
      });
    }

    if (!originAllowed(req)) {
      return json(req, res, 403, { ok: false, error: "origin not allowed" });
    }
    if (!tokenMatches(req, url)) {
      return json(req, res, 401, { ok: false, error: "bad token" });
    }
    if (shuttingDown) {
      return json(req, res, 503, { ok: false, error: "shutting down" });
    }

    if (url.pathname === "/info") return await handleInfo(req, res, url);
    if (url.pathname === "/stream") return await handleStream(req, res, url);
    if (req.method === "POST" && (url.pathname === "/stop" || url.pathname === "/room-end")) {
      return await handleControl(req, res, url);
    }

    return json(req, res, 404, { ok: false, error: "not found" });
  } catch (err) {
    const message = err && err.message ? err.message : "internal error";
    console.warn("[sidecar] request failed:", message);
    if (!res.headersSent) return json(req, res, 502, { ok: false, error: message });
    try {
      res.end();
    } catch (e) {}
  }
});

// --- listen (with port fallback) --------------------------------------------

function listen(port, attempt = 0) {
  const onError = (err) => {
    server.removeListener("listening", onListening);
    if (err.code === "EADDRINUSE" && attempt < 10) {
      console.warn(`[sidecar] port ${port} busy, trying ${port + 1}`);
      listen(port + 1, attempt + 1);
      return;
    }
    console.error("[sidecar] cannot listen:", err.message);
    process.exit(1);
  };

  const onListening = () => {
    server.removeListener("error", onError);
    const actual = server.address().port;
    console.log(`[sidecar] listening on http://127.0.0.1:${actual}`);
    console.log(
      `[sidecar] idle=${IDLE_MINUTES}m minFree=${MIN_FREE_GB}GB cache=${CACHE_ROOT}`
    );
    if (process.send) process.send({ type: "ready", port: actual });
  };

  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, "127.0.0.1");
}

// --- shutdown ---------------------------------------------------------------

let cleanupReported = false;

function reportCleanup(ok) {
  if (cleanupReported) return;
  cleanupReported = true;
  if (process.send) {
    try {
      process.send({ type: "cleanup", ok });
    } catch (e) {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows keeps a handle open for a moment after a store is destroyed, so the
// first delete can fail with EPERM. Retry with a short pause.
async function removeCacheRoot() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    } catch (e) {}
    if (!fs.existsSync(CACHE_ROOT)) return true;
    await sleep(250 * (attempt + 1));
  }
  return !fs.existsSync(CACHE_ROOT);
}

let shutdownPromise = null;

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true; // reject new torrent work from here on
  console.log(`[sidecar] shutting down (${signal})`);

  shutdownPromise = (async () => {
    const list = [...client.torrents];
    await Promise.all(list.map((t) => destroyTorrent(t, "shutdown")));

    const cleaned = await removeCacheRoot();
    reportCleanup(cleaned);
    if (!cleaned) console.error("[sidecar] cache cleanup FAILED:", CACHE_ROOT);

    server.close(() => process.exit(cleaned ? 0 : 1));
    setTimeout(() => process.exit(cleaned ? 0 : 1), 1500).unref();
  })();

  return shutdownPromise;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
let lastParentPing = Date.now();

process.on("message", (msg) => {
  if (!msg) return;
  if (msg.type === "shutdown") shutdown("ipc");
  if (msg.type === "ping") lastParentPing = Date.now();
});
// Parent died without telling us: still wipe the cache before leaving.
process.on("disconnect", () => shutdown("parent gone"));

// Belt and braces: a force-killed Electron may never close the IPC channel, so
// the shell pings us and we shut down when the pings stop.
if (process.send) {
  const checkMs = Math.max(1000, Math.min(30000, Math.floor(PARENT_TIMEOUT_MS / 3)));
  setInterval(() => {
    if (shuttingDown) return;
    if (Date.now() - lastParentPing > PARENT_TIMEOUT_MS) shutdown("parent silent");
  }, checkMs).unref();
}

listen(BASE_PORT);
