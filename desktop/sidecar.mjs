"use strict";

/**
 * dipkri local torrent sidecar (Phase 1)
 *
 * The whole point of the desktop app: torrent bytes never touch our server.
 * This process runs on the user's machine, streams from the swarm straight to
 * 127.0.0.1, and deletes the data when the room ends or the app quits.
 *
 *   GET /health
 *   GET /info?torrent=<magnet>              -> metadata + file list
 *   GET /stream?torrent=<magnet>&fileIndex=N -> video bytes (Range supported)
 *   POST /stop        { infoHash }          -> drop torrent + delete its files
 *   POST /room-end                          -> drop every torrent (room closed)
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import WebTorrent from "webtorrent";

const PORT = Number(process.env.DIPKRI_SIDECAR_PORT || 17891);

// All torrent data lives here and nowhere else, so "room over" == wipe folder.
const CACHE_ROOT =
  process.env.DIPKRI_CACHE_DIR || path.join(os.tmpdir(), "dipkri-cache");
const IDLE_MINUTES = Number(process.env.DIPKRI_IDLE_MINUTES || 30);
const MIN_FREE_GB = Number(process.env.DIPKRI_MIN_FREE_GB || 1);

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];

// A previous run may have crashed mid-playback: start from a clean slate.
try {
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({ maxConns: 80 });
const metaCache = new Map();

client.on("error", (err) => console.warn("[sidecar] client error:", err && err.message));

function freeDiskGB() {
  try {
    const statfs = fs.statfsSync;
    if (typeof statfs === "function") {
      const s = statfs(CACHE_ROOT);
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

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function videoFiles(torrent) {
  const isVideo = (f) => /\.(mp4|mkv|webm|avi|m4v|mov)$/i.test(f.name || "");
  return (torrent.files || [])
    .map((f, index) => ({ index, name: f.name, length: f.length }))
    .filter((f) => isVideo(f))
    .sort((a, b) => b.length - a.length);
}

function pickFile(torrent, fileIndex) {
  const files = torrent.files || [];
  if (Number.isInteger(fileIndex) && files[fileIndex]) return files[fileIndex];
  const videos = videoFiles(torrent);
  if (videos.length > 0) return files[videos[0].index];
  return files[0];
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

function addTorrent(magnet) {
  const known = findLoaded(magnet);
  if (known) {
    known.__lastAccess = Date.now();
    if (known.ready) return Promise.resolve(known);
    return new Promise((resolve, reject) => {
      known.once("ready", () => {
        known.__lastAccess = Date.now();
        resolve(known);
      });
      known.once("error", reject);
    });
  }
  if (metaCache.has(magnet)) return metaCache.get(magnet);

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
      if (dup) return resolve(dup);
      return reject(err);
    }
    torrent.__lastAccess = Date.now();

    const timer = setTimeout(() => {
      metaCache.delete(magnet);
      try {
        torrent.destroy({ destroyStore: true });
      } catch (e) {}
      reject(new Error("No seeders responded in 40s"));
    }, 40000);

    torrent.once("ready", () => {
      clearTimeout(timer);
      metaCache.delete(magnet);
      resolve(torrent);
    });
    torrent.once("error", (err) => {
      clearTimeout(timer);
      metaCache.delete(magnet);
      reject(err);
    });
  });

  metaCache.set(magnet, promise);
  return promise;
}

function destroyTorrent(torrent, reason) {
  if (!torrent) return false;
  console.log(`[sidecar] dropping ${torrent.infoHash || torrent.magnetURI} (${reason})`);
  try {
    torrent.destroy({ destroyStore: true });
  } catch (e) {}
  return true;
}

// Idle sweeper: nothing should stay on disk after a room is over.
setInterval(() => {
  const cutoff = Date.now() - IDLE_MINUTES * 60000;
  for (const t of [...client.torrents]) {
    if ((t.__lastAccess || 0) < cutoff) destroyTorrent(t, "idle");
  }
}, 60000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  if (url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      torrents: client.torrents.length,
      freeDiskGB: Number(freeDiskGB().toFixed(1)),
      cacheDir: CACHE_ROOT,
      cacheMB: Number(cacheSizeMB().toFixed(1)),
    });
  }

  if (url.pathname === "/info") {
    const magnet = url.searchParams.get("torrent") || "";
    if (!magnet) return json(res, 400, { ok: false, error: "missing torrent" });
    try {
      const torrent = await addTorrent(magnet);
      return json(res, 200, {
        ok: true,
        infoHash: torrent.infoHash,
        name: torrent.name,
        files: videoFiles(torrent),
      });
    } catch (e) {
      return json(res, 502, { ok: false, error: e.message });
    }
  }

  if (url.pathname === "/stream") {
    const magnet = url.searchParams.get("torrent") || "";
    const fileIndex = Number(url.searchParams.get("fileIndex"));
    if (!magnet) return json(res, 400, { ok: false, error: "missing torrent" });

    if (freeDiskGB() < MIN_FREE_GB) {
      return json(res, 507, { ok: false, error: "Not enough free disk space on this device" });
    }

    let torrent;
    try {
      torrent = await addTorrent(magnet);
    } catch (e) {
      return json(res, 502, { ok: false, error: e.message });
    }

    torrent.__lastAccess = Date.now();
    const file = pickFile(torrent, fileIndex);
    if (!file) return json(res, 404, { ok: false, error: "no playable file" });

    const size = file.length;
    const range = req.headers.range;
    let start = 0;
    let end = size - 1;

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1]) start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
        if (!m[1] && m[2]) {
          start = Math.max(0, size - Number(m[2]));
          end = size - 1;
        }
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*",
      });
    } else {
      res.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": size,
        "Content-Type": "video/mp4",
        "Access-Control-Allow-Origin": "*",
      });
    }

    const stream = file.createReadStream({ start, end });
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
    return;
  }

  if (req.method === "POST" && (url.pathname === "/stop" || url.pathname === "/room-end")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/room-end") {
        const n = client.torrents.length;
        for (const t of [...client.torrents]) destroyTorrent(t, "room ended");
        return json(res, 200, { ok: true, dropped: n });
      }
      let infoHash = "";
      try {
        infoHash = (JSON.parse(body || "{}").infoHash || "").toLowerCase();
      } catch (e) {}
      const target = client.torrents.find((t) => (t.infoHash || "").toLowerCase() === infoHash);
      return json(res, 200, { ok: true, dropped: destroyTorrent(target, "stop requested") });
    });
    return;
  }

  return json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sidecar] listening on http://127.0.0.1:${PORT}`);
  console.log(`[sidecar] idle=${IDLE_MINUTES}m minFree=${MIN_FREE_GB}GB`);
});

function shutdown() {
  for (const t of [...client.torrents]) destroyTorrent(t, "app quit");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
