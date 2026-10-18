import WebTorrent from "webtorrent";
import { spawn, execFile } from "node:child_process";
import config from "./config.ts";

// Singleton WebTorrent client for server-side torrent streaming
let torrentClient: WebTorrent.Instance | null = null;

function getClient(): WebTorrent.Instance {
  if (!torrentClient) {
    torrentClient = new WebTorrent({
      maxConns: 55,
    });
    torrentClient.on("error", (err: any) => {
      console.warn("[WebTorrent Server Error]:", err?.message || err);
    });
  }
  return torrentClient;
}

// High-availability BitTorrent and WebTorrent trackers for accelerated peer discovery
const DEFAULT_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
];

// Map to deduplicate concurrent requests for the same torrent metadata
const pendingTorrents = new Map<string, Promise<WebTorrent.Torrent>>();

/**
 * Extracts 40-char hex or 32-char base32 infoHash from a magnet link or raw hash.
 */
export function extractInfoHash(magnetUri: string): string | null {
  if (!magnetUri) return null;
  let decoded = magnetUri;
  for (let i = 0; i < 3; i++) {
    if (decoded.includes("%")) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  const match = decoded.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  const hexMatch = decoded.match(/(?:^|[=/?&])([a-fA-F0-9]{40})(?:[&/?#]|$)/);
  if (hexMatch) {
    return hexMatch[1].toLowerCase();
  }
  if (/^[a-fA-F0-9]{40}$/.test(decoded.trim())) {
    return decoded.trim().toLowerCase();
  }
  return null;
}

/**
 * Extracts fileIndex parameter safely from query, raw URL, or encoded params.
 */
export function extractFileIndexFromRequest(req: any): number | undefined {
  if (req.query?.fileIndex != null && req.query.fileIndex !== "") {
    const parsed = parseInt(String(req.query.fileIndex), 10);
    if (!isNaN(parsed)) return parsed;
  }
  const fullUrl = req.originalUrl || req.url || "";
  const match = fullUrl.match(/[?&]fileIndex=(\d+)/i) || fullUrl.match(/%26fileIndex%3D(\d+)/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Extracts the full magnet link from the request query or raw URL,
 * safely preserving all tracker parameters even if unencoded.
 */
export function extractMagnetFromRequest(req: any): string {
  const fullUrl = req.originalUrl || req.url || "";
  const idx = fullUrl.indexOf("torrent=");
  if (idx !== -1) {
    let sub = fullUrl.slice(idx + 8);
    const cutParams = [
      "&fileIndex=",
      "&track=",
      "&ss=",
      "&streamIndex=",
      "%26fileIndex%3D",
      "%26track%3D",
      "%26ss%3D",
      "%26streamIndex%3D",
    ];
    let minIdx = -1;
    for (const param of cutParams) {
      const pIdx = sub.indexOf(param);
      if (pIdx !== -1 && (minIdx === -1 || pIdx < minIdx)) {
        minIdx = pIdx;
      }
    }
    if (minIdx !== -1) {
      sub = sub.slice(0, minIdx);
    }
    for (let i = 0; i < 3; i++) {
      if (sub.includes("%")) {
        try {
          sub = decodeURIComponent(sub);
        } catch {
          break;
        }
      } else {
        break;
      }
    }
    const decodedCutParams = ["&fileIndex=", "&track=", "&ss=", "&streamIndex="];
    for (const param of decodedCutParams) {
      const pIdx = sub.indexOf(param);
      if (pIdx !== -1) {
        sub = sub.slice(0, pIdx);
      }
    }
    if (sub.includes("torrent=")) {
      const nested = sub.indexOf("torrent=");
      sub = sub.slice(nested + 8);
      try { sub = decodeURIComponent(sub); } catch {}
    }
    return sub;
  }

  const queryTorrent = req.query?.torrent;
  if (queryTorrent) {
    let sub = String(queryTorrent);
    for (let i = 0; i < 3; i++) {
      if (sub.includes("%")) {
        try {
          sub = decodeURIComponent(sub);
        } catch {
          break;
        }
      } else {
        break;
      }
    }
    const decodedCutParams = ["&fileIndex=", "&track=", "&ss=", "&streamIndex="];
    for (const param of decodedCutParams) {
      const pIdx = sub.indexOf(param);
      if (pIdx !== -1) {
        sub = sub.slice(0, pIdx);
      }
    }
    return sub;
  }
  return "";
}

/**
 * Retrieves an existing torrent from the client or adds a new one.
 * Resolves once the torrent metadata ('ready' event) is available.
 * Handles duplicate add race conditions smoothly without throwing 500 errors.
 */
export async function getOrAddTorrent(magnetUri: string): Promise<WebTorrent.Torrent> {
  const client = getClient();
  const infoHash = extractInfoHash(magnetUri);

  // 1. Check existing torrents in client.torrents synchronously
  let existing: WebTorrent.Torrent | undefined = undefined;
  if (infoHash) {
    existing = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase()
    );
  }
  if (!existing) {
    existing = client.torrents.find((t) => t.magnetURI === magnetUri);
  }

  if (existing) {
    if (existing.ready) {
      return existing;
    }
    return new Promise((resolve, reject) => {
      existing!.once("ready", () => resolve(existing!));
      existing!.once("error", (err) => reject(err));
    });
  }

  // 2. Check pending promises by infoHash or magnetUri
  const cacheKey = infoHash || magnetUri;
  if (pendingTorrents.has(cacheKey)) {
    return pendingTorrents.get(cacheKey)!;
  }

  // 3. Add torrent safely
  const promise = new Promise<WebTorrent.Torrent>((resolve, reject) => {
    try {
      // Re-check right before adding in case of concurrent execution
      const doubleCheck = infoHash
        ? client.torrents.find((t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase())
        : client.torrents.find((t) => t.magnetURI === magnetUri);

      if (doubleCheck) {
        pendingTorrents.delete(cacheKey);
        if (doubleCheck.ready) {
          return resolve(doubleCheck);
        }
        return doubleCheck.once("ready", () => resolve(doubleCheck));
      }

      const torrent = client.add(magnetUri, {
        announce: DEFAULT_TRACKERS,
        destroyStoreOnDestroy: true,
      });

      const timeout = setTimeout(() => {
        pendingTorrents.delete(cacheKey);
        if (!torrent.ready) {
          reject(new Error("Torrent metadata lookup timed out. No active seeders responded."));
        }
      }, 35000);

      torrent.once("ready", () => {
        clearTimeout(timeout);
        pendingTorrents.delete(cacheKey);
        resolve(torrent);
      });

      torrent.once("error", (err) => {
        clearTimeout(timeout);
        pendingTorrents.delete(cacheKey);
        reject(err);
      });
    } catch (err: any) {
      pendingTorrents.delete(cacheKey);
      // Gracefully recover if duplicate torrent was added
      if (err?.message?.includes("duplicate") || err?.message?.includes("already exists")) {
        const found = infoHash
          ? client.torrents.find((t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase())
          : client.torrents.find((t) => t.magnetURI === magnetUri);
        if (found) {
          if (found.ready) return resolve(found);
          return found.once("ready", () => resolve(found));
        }
      }
      reject(err);
    }
  });

  pendingTorrents.set(cacheKey, promise);
  return promise;
}

/**
 * Automatically chooses the primary video file in a multi-file torrent.
 */
export function pickBestVideoFile(
  files: WebTorrent.TorrentFile[]
): WebTorrent.TorrentFile | undefined {
  if (!files || files.length === 0) return undefined;

  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".ts"];
  const videoFiles = files.filter((f) =>
    videoExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
  );

  if (videoFiles.length > 0) {
    // Sort descending by size to get the main feature film / episode
    videoFiles.sort((a, b) => b.length - a.length);
    return videoFiles[0];
  }

  // Fallback to largest file overall
  const sorted = [...files].sort((a, b) => b.length - a.length);
  return sorted[0];
}

export function getMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".vtt")) return "text/vtt";
  if (lower.endsWith(".srt")) return "text/plain";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return "video/mp4";
}

/**
 * GET /data?torrent=...
 * Returns torrent name, infoHash, and list of files with lengths and indexes.
 */
export async function handleTorrentData(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).json({ error: "Missing torrent query parameter" });
  }

  try {
    const torrent = await getOrAddTorrent(magnetUri);
    return res.json({
      name: torrent.name,
      infoHash: torrent.infoHash,
      files: torrent.files.map((f, i) => ({
        name: f.name,
        length: f.length,
        index: i,
      })),
    });
  } catch (err: any) {
    console.error("[Torrent Data Error]:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to load torrent metadata" });
  }
}

/**
 * GET /progress?torrent=...
 * Returns real-time download statistics (speed, progress, peer connections).
 */
export async function handleTorrentProgress(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).json({ error: "Missing torrent query parameter" });
  }

  const client = getClient();
  const infoHash = extractInfoHash(magnetUri);
  const torrent = infoHash
    ? client.torrents.find((t) => t.infoHash && t.infoHash.toLowerCase() === infoHash)
    : client.torrents.find((t) => t.magnetURI === magnetUri);

  if (!torrent) {
    return res.json({
      downloaded: 0,
      total: 0,
      speed: 0,
      connections: 0,
      progress: 0,
    });
  }

  return res.json({
    downloaded: torrent.downloaded,
    total: torrent.length,
    speed: torrent.downloadSpeed,
    connections: torrent.numPeers,
    progress: torrent.progress,
  });
}

/**
 * GET /stream?torrent=...&fileIndex=...
 * Streams the torrent's video directly over HTTP with full Range / seek support.
 * Optimized for jumping into the middle of the video without server errors.
 */
export async function handleTorrentStream(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).send("Missing torrent parameter");
  }

  try {
    const torrent = await getOrAddTorrent(magnetUri);
    let targetFile: WebTorrent.TorrentFile | undefined;

    const fileIndex = extractFileIndexFromRequest(req);
    if (fileIndex != null && !isNaN(fileIndex) && torrent.files[fileIndex]) {
      targetFile = torrent.files[fileIndex];
    } else {
      targetFile = pickBestVideoFile(torrent.files);
    }

    if (!targetFile) {
      return res.status(404).send("No playable file found in torrent");
    }

    const fileSize = targetFile.length;
    const range = req.headers?.range;
    const contentType = getMimeType(targetFile.name);

    if (range) {
      let start: number;
      let end: number;

      const bytesRange = range.replace(/bytes=/, "").trim();
      const [startStr, endStr] = bytesRange.split("-");

      if (!startStr && endStr) {
        // Suffix byte range: bytes=-500000 (last 500KB of file e.g. for MP4 moov atom)
        const suffixLength = parseInt(endStr, 10);
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
      } else {
        start = parseInt(startStr, 10) || 0;
        if (endStr) {
          end = parseInt(endStr, 10);
        } else {
          end = fileSize - 1;
        }
      }

      // Check range validity according to RFC 7233
      if (isNaN(start) || isNaN(end) || start >= fileSize || start < 0) {
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        return res.status(416).end();
      }

      end = Math.min(end, fileSize - 1);
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      const stream = targetFile.createReadStream({ start, end });

      stream.on("error", (err: any) => {
        // Handle read stream errors or socket aborts cleanly without crashing
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      });

      const cleanup = () => {
        try {
          (stream as any)?.destroy?.();
        } catch {}
      };

      req.on("close", cleanup);
      res.on("close", cleanup);

      stream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });

      const stream = targetFile.createReadStream();

      stream.on("error", (err: any) => {
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      });

      const cleanup = () => {
        try {
          (stream as any)?.destroy?.();
        } catch {}
      };

      req.on("close", cleanup);
      res.on("close", cleanup);

      stream.pipe(res);
    }
  } catch (err: any) {
    console.error("[Torrent Stream Error]:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).send("Torrent streaming error: " + (err?.message || "unknown"));
    }
  }
}

const streamInfoCache = new Map<string, any>();

/**
 * GET /streamInfo?torrent=...
 * Probes the actual stream tracks (audio languages, codecs, subtitle streams) using ffprobe.
 */
export async function handleTorrentInfo(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).json({ error: "Missing torrent parameter" });
  }

  const infoHash = extractInfoHash(magnetUri) || magnetUri;
  const fileIndex = extractFileIndexFromRequest(req);
  const cacheKey = `${infoHash}_file_${fileIndex != null ? fileIndex : "default"}`;
  if (streamInfoCache.has(cacheKey)) {
    return res.json(streamInfoCache.get(cacheKey));
  }

  try {
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}`;
    }

    execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=index,codec_name,codec_type:stream_tags=language,title",
        "-of",
        "json",
        streamUrl,
      ],
      { timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout) {
          return res.json({ audioTracks: [], subtitleTracks: [] });
        }
        try {
          const parsed = JSON.parse(stdout);
          const streams: any[] = parsed.streams || [];
          const audioStreams = streams.filter((s) => s.codec_type === "audio");
          const subStreams = streams.filter((s) => s.codec_type === "subtitle");

          const audioTracks = audioStreams.map((s, idx) => ({
            id: idx,
            streamIndex: s.index,
            language: s.tags?.language || undefined,
            label: s.tags?.title || s.tags?.language || `Track ${idx + 1}`,
            codec: s.codec_name,
          }));

          const subtitleTracks = subStreams.map((s, idx) => ({
            id: idx,
            streamIndex: s.index,
            language: s.tags?.language || undefined,
            label: s.tags?.title || s.tags?.language || `Subtitle ${idx + 1}`,
            codec: s.codec_name,
          }));

          const result = { audioTracks, subtitleTracks };
          if (audioTracks.length > 0 || subtitleTracks.length > 0) {
            streamInfoCache.set(cacheKey, result);
          }
          return res.json(result);
        } catch {
          return res.json({ audioTracks: [], subtitleTracks: [] });
        }
      }
    );
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Probe error" });
  }
}

/**
 * GET /streamAudio?torrent=...&track=0&ss=0
 * Streams a discrete extracted audio track on-the-fly using ffmpeg in MP3 format for universal browser playback.
 */
export async function handleTorrentAudio(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Accept-Ranges", "none");

  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).send("Missing torrent parameter");
  }

  const track = parseInt(req.query?.track || "0", 10);
  const ss = parseFloat(req.query?.ss || "0");
  const fileIndex = extractFileIndexFromRequest(req);

  try {
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}`;
    }

    const args: string[] = ["-nostdin", "-v", "error"];
    if (ss > 0) {
      args.push("-ss", String(ss));
    }
    args.push("-i", streamUrl);
    args.push("-vn", "-map", `0:a:${track}`, "-c:a", "libmp3lame", "-ac", "2", "-b:a", "192k", "-f", "mp3", "pipe:1");

    const ff = spawn("ffmpeg", args);
    const cleanup = () => { try { ff.kill("SIGKILL"); } catch {} };
    req.on("close", cleanup);
    res.on("close", cleanup);

    ff.on("error", (err) => {
      console.warn("[TorrentAudio ffmpeg error]:", err?.message);
      if (!res.headersSent) res.status(500).end();
    });

    ff.stderr?.on("data", (chunk) => {
      console.warn("[TorrentAudio ffmpeg stderr]:", chunk.toString());
    });

    ff.stdout.pipe(res);
  } catch (err: any) {
    console.error("[TorrentAudio handler error]:", err?.message);
    if (!res.headersSent) res.status(500).end();
  }
}

/**
 * GET /streamSubtitle?torrent=...&streamIndex=...
 * Extracts embedded subtitle tracks to WebVTT format on demand.
 */
export async function handleTorrentSubtitle(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");

  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).send("Missing torrent parameter");
  }

  const streamIndex = parseInt(req.query?.streamIndex || "0", 10);
  const fileIndex = extractFileIndexFromRequest(req);

  try {
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      streamUrl = `http://127.0.0.1:${process.env.PORT || 8080}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}`;
    }

    const args: string[] = [
      "-nostdin",
      "-v",
      "error",
      "-i",
      streamUrl,
      "-map",
      `0:${streamIndex}`,
      "-f",
      "webvtt",
      "pipe:1",
    ];

    const ff = spawn("ffmpeg", args);
    const cleanup = () => {
      try {
        ff.kill("SIGKILL");
      } catch {}
    };
    req.on("close", cleanup);
    res.on("close", cleanup);

    ff.on("error", (err) => {
      console.warn("[TorrentSubtitle ffmpeg error]:", err?.message);
      if (!res.headersSent) res.status(500).end();
    });

    ff.stdout.pipe(res);
  } catch (err: any) {
    console.error("[TorrentSubtitle handler error]:", err?.message);
    if (!res.headersSent) res.status(500).end();
  }
}
