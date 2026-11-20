/**
 * dipkri local torrent sidecar (Phase 2)
 *
 * Runs on the user's machine, next to the app. Torrent bytes never touch our
 * server: this process streams from the swarm to 127.0.0.1 and deletes the
 * data when the room ends or the app quits.
 *
 *   GET  /health                                  (no token, local only)
 *   GET  /info?torrent=<magnet>
 *   GET  /stream?torrent=<magnet>&fileIndex=N     (Range supported)
 *   POST /stop      { infoHash }
 *   POST /room-end
 *
 * Every endpoint except /health needs the per-launch token in the
 * `x-dipkri-token` header (or `token=` query param) so a random website
 * cannot drive the local torrent client.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import WebTorrent from "webtorrent";

const BASE_PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);
const TOKEN = String(process.env.DIPKRI_TOKEN || "");

// All torrent data lives here and nowhere else, so "room over" == wipe folder.
// DIPKRI_CACHE_DIR is a parent, never the folder itself: the sidecar deletes
// CACHE_ROOT on boot and on quit, so it must own the folder completely.
const CACHE_ROOT = path.join(
  process.env.DIPKRI_CACHE_DIR || os.tmpdir(),
  "dipkri-cache"
);
const IDLE_MINUTES = Number(process.env.DIPKRI_IDLE_MINUTES || 30);
const MIN_FREE_GB = Number(process.env.DIPKRI_MIN_FREE_GB || 1);
const META_TIMEOUT_MS = Number(process.env.DIPKRI_META_TIMEOUT_MS || 40000);
const MAX_BODY_BYTES = 64 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://dipkri.duckdns.org",
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

// A previous run may have crashed mid-playback: start from a clean slate.
try {
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({ maxConns: 80 });
const pending = new Map();

client.on("error", (err) => console.warn("[sidecar] client error:", err && err.message));

// If the app dies first, our stdout pipe is gone; logging must not throw.
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

function isAllowedOrigin(origin) {
  if (!origin) return true; // native / curl / <video> without crossorigin
  const host = origin.replace(/^https?:\/\//i, "").toLowerCase();
  if (ALLOWED_ORIGINS.has(origin.toLowerCase())) return true;
  return ALLOWED_ORIGINS.has(`https://${host}`) || ALLOWED_ORIGINS.has(`http://${host}`);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "x-dipkri-token, content-type, range",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    Vary: "Origin",
  };
}

function json(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(req),
  });
  res.end(body);
}

function tokenMatches(req, url) {
  if (!TOKEN) return true; // dev mode: token not configured
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

function videoFiles(torrent) {
  return (torrent.files || [])
    .map((f, index) => ({ index, name: f.name, length: f.length }))
    .filter((f) => MIME_BY_EXT[path.extname(String(f.name || "")).toLowerCase()])
    .sort((a, b) => b.length - a.length);
}

function pickFile(torrent, fileIndex) {
  const files = torrent.files || [];
  if (files.length === 0) return null;
  if (Number.isInteger(fileIndex) && fileIndex >= 0 && files[fileIndex]) {
    return files[fileIndex];
  }
  const videos = videoFiles(torrent);
  if (videos.length > 0) return files[videos[0].index];
  return null;
}

function infoHashOf(magnet) {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(magnet || "");
  return m ? m[1].toLowerCase() : "";
}

function findLoaded(magnet) {
  const hash = infoHashOf(magnet);
  return client.torrents.find(
    (t) => t.magnetURI === magnet || (hash && (t.infoHash || "").toLowerCase() === hash)
  );
}

// Resolve only once the torrent has metadata; `files` is empty before that.
function whenReady(torrent) {
  torrent.__lastAccess = Date.now();
  if (torrent.ready) return Promise.resolve(torrent);
  if (torrent.destroyed) return Promise.reject(new Error("torrent closed"));

  // Always settles: /stop, the sweeper or a timeout can destroy the torrent
  // while a request is still waiting for metadata.
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

function addTorrent(magnet) {
  // Reuse the in-flight add first: concurrent /info + /stream for one magnet
  // must share a single promise.
  if (pending.has(magnet)) return pending.get(magnet);

  const known = findLoaded(magnet);
  if (known) return whenReady(known);

  const promise = new Promise((resolve, reject) => {
    let torrent;
    try {
      torrent = client.add(magnet, {
        announce: TRACKERS,
        path: CACHE_ROOT,
        destroyStoreOnDestroy: true,
      });
    } catch (err) {
      const dup = findLoaded(magnet);
      if (dup) return whenReady(dup).then(resolve, reject);
      return reject(err);
    }

    torrent.__lastAccess = Date.now();
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(magnet);
      torrent.removeListener("ready", onReady);
      torrent.removeListener("error", onError);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("No seeders responded in time"));
      destroyTorrent(torrent, "metadata timeout");
    }, META_TIMEOUT_MS);

    const onReady = () => finish(resolve, torrent);
    const onError = (err) => finish(reject, err);

    torrent.once("ready", onReady);
    torrent.once("error", onError);
  });

  pending.set(magnet, promise);
  return promise;
}

function destroyTorrent(torrent, reason) {
  if (!torrent) return false;
  console.log(`[sidecar] dropping ${torrent.infoHash || torrent.magnetURI || "?"} (${reason})`);
  try {
    torrent.destroy({ destroyStore: true });
  } catch (e) {}
  return true;
}

function destroyAll(reason) {
  const list = [...client.torrents];
  let dropped = 0;
  for (const t of list) {
    if (destroyTorrent(t, reason)) dropped += 1;
  }
  return dropped;
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

// Nothing should stay on disk after a room is over, but a torrent that is
// being watched right now must survive even a long pause.
setInterval(() => {
  const cutoff = Date.now() - IDLE_MINUTES * 60000;
  for (const t of [...client.torrents]) {
    if ((t.__active || 0) > 0) continue;
    if ((t.__lastAccess || 0) < cutoff) destroyTorrent(t, "idle");
  }
}, 60000).unref();

// --- routes -----------------------------------------------------------------

async function handleInfo(req, res, url) {
  const magnet = url.searchParams.get("torrent") || "";
  if (!magnet) return json(req, res, 400, { ok: false, error: "missing torrent" });

  const torrent = await addTorrent(magnet);
  return json(req, res, 200, {
    ok: true,
    infoHash: torrent.infoHash,
    name: torrent.name,
    files: videoFiles(torrent),
  });
}

async function handleStream(req, res, url) {
  const magnet = url.searchParams.get("torrent") || "";
  if (!magnet) return json(req, res, 400, { ok: false, error: "missing torrent" });

  const rawIndex = url.searchParams.get("fileIndex");
  const fileIndex = rawIndex === null ? null : Number(rawIndex);
  if (rawIndex !== null && !Number.isInteger(fileIndex)) {
    return json(req, res, 400, { ok: false, error: "bad fileIndex" });
  }

  if (freeDiskGB() < MIN_FREE_GB) {
    return json(req, res, 507, {
      ok: false,
      error: "Not enough free disk space on this device",
    });
  }

  const torrent = await addTorrent(magnet);
  torrent.__lastAccess = Date.now();

  const file = pickFile(torrent, fileIndex);
  if (!file) return json(req, res, 404, { ok: false, error: "no playable file" });

  const size = file.length;
  if (!size) return json(req, res, 404, { ok: false, error: "empty file" });

  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.writeHead(416, {
      "Content-Range": `bytes */${size}`,
      ...corsHeaders(req),
    });
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

  torrent.__active = (torrent.__active || 0) + 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    torrent.__active = Math.max(0, (torrent.__active || 1) - 1);
    torrent.__lastAccess = Date.now();
  };

  const stream = file.createReadStream({ start, end });
  stream.on("error", () => {
    release();
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.on("end", release);
  res.on("close", () => {
    release();
    stream.destroy();
  });
  stream.pipe(res);
}

async function handleControl(req, res, url) {
  const body = await readBody(req);

  if (url.pathname === "/room-end") {
    const dropped = destroyAll("room ended");
    return json(req, res, 200, { ok: true, dropped });
  }

  let infoHash = "";
  try {
    infoHash = String(JSON.parse(body || "{}").infoHash || "").toLowerCase();
  } catch (e) {}
  if (!infoHash) return json(req, res, 400, { ok: false, error: "missing infoHash" });

  const target = client.torrents.find(
    (t) => (t.infoHash || "").toLowerCase() === infoHash
  );
  return json(req, res, 200, { ok: true, dropped: destroyTorrent(target, "stop requested") });
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

    if (!isAllowedOrigin(req.headers.origin)) {
      return json(req, res, 403, { ok: false, error: "origin not allowed" });
    }
    if (!tokenMatches(req, url)) {
      return json(req, res, 401, { ok: false, error: "bad token" });
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
      `[sidecar] idle=${IDLE_MINUTES}m minFree=${MIN_FREE_GB}GB auth=${TOKEN ? "on" : "off"}`
    );
    if (process.send) process.send({ type: "ready", port: actual });
  };

  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, "127.0.0.1");
}

// --- shutdown ---------------------------------------------------------------

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sidecar] shutting down (${signal})`);

  const list = [...client.torrents];
  await Promise.all(
    list.map(
      (t) =>
        new Promise((resolve) => {
          const done = () => resolve();
          const timer = setTimeout(done, 1500);
          try {
            const result = t.destroy({ destroyStore: true }, () => {
              clearTimeout(timer);
              done();
            });
            if (result && typeof result.then === "function") {
              result.then(() => {
                clearTimeout(timer);
                done();
              }, done);
            }
          } catch (e) {
            clearTimeout(timer);
            done();
          }
        })
    )
  );

  try {
    fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
  } catch (e) {}

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("message", (msg) => {
  if (msg && msg.type === "shutdown") shutdown("ipc");
});

listen(BASE_PORT);
