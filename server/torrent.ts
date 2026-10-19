import WebTorrent from "webtorrent";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import config from "./config.ts";
// @ts-ignore
import ffmpegStatic from "ffmpeg-static";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";

function getFfmpegPath(): string {
  return (ffmpegStatic as any)?.default || (ffmpegStatic as any) || "ffmpeg";
}

function getFfprobePath(): string {
  return (ffprobeStatic as any)?.path || (ffprobeStatic as any)?.default?.path || "ffprobe";
}

const AUDIO_CACHE_DIR = path.join(os.tmpdir(), "watchparty_audio_cache");
if (!fs.existsSync(AUDIO_CACHE_DIR)) {
  try {
    fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
  } catch {}
}

interface AudioCacheState {
  filePath: string;
  complete: boolean;
  process?: any;
}
const audioTranscodeMap = new Map<string, AudioCacheState>();

// Singleton WebTorrent client for server-side torrent streaming
let torrentClient: WebTorrent.Instance | null = null;

function getClient(): WebTorrent.Instance {
  if (!torrentClient) {
    torrentClient = new WebTorrent({
      maxConns: 120,
      dht: true,
      webSeeds: true,
    });
    torrentClient.on("error", (err: any) => {
      console.warn("[WebTorrent Server Error]:", err?.message || err);
    });
  }
  return torrentClient;
}

// High-speed, high-availability BitTorrent & WebTorrent trackers for ultra-fast peer discovery
const DEFAULT_TRACKERS = [
  // Fast UDP Tier-1 trackers
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  // High-availability HTTP/HTTPS trackers
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.tamersUnion.org:443/announce",
  // WebSocket trackers (WebTorrent / browser swarms)
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.fastcast.nz",
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
 * Extracts season number safely from query, URL, or dn parameter (e.g. S01E03, season=1).
 */
export function extractSeasonFromRequest(req: any): number | undefined {
  if (req.query?.season != null && req.query.season !== "") {
    const parsed = parseInt(String(req.query.season), 10);
    if (!isNaN(parsed)) return parsed;
  }
  const fullUrl = req.originalUrl || req.url || "";
  const match =
    fullUrl.match(/[?&]season=(\d+)/i) ||
    fullUrl.match(/%26season%3D(\d+)/i) ||
    fullUrl.match(/[sS](\d+)[eE]\d+/i) ||
    fullUrl.match(/%20S(\d+)E\d+/i) ||
    fullUrl.match(/\bS(\d+)\b/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Extracts episode number safely from query, URL, or dn parameter (e.g. S01E03, episode=3).
 */
export function extractEpisodeFromRequest(req: any): number | undefined {
  if (req.query?.episode != null && req.query.episode !== "") {
    const parsed = parseInt(String(req.query.episode), 10);
    if (!isNaN(parsed)) return parsed;
  }
  const fullUrl = req.originalUrl || req.url || "";
  const match =
    fullUrl.match(/[?&]episode=(\d+)/i) ||
    fullUrl.match(/%26episode%3D(\d+)/i) ||
    fullUrl.match(/[sS]\d+[eE](\d+)/i) ||
    fullUrl.match(/%20S\d+E(\d+)/i) ||
    fullUrl.match(/\bE(\d+)\b/i);
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
      "&season=",
      "&episode=",
      "&track=",
      "&ss=",
      "&streamIndex=",
      "%26fileIndex%3D",
      "%26season%3D",
      "%26episode%3D",
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
    const decodedCutParams = [
      "&fileIndex=",
      "&season=",
      "&episode=",
      "&track=",
      "&ss=",
      "&streamIndex=",
    ];
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
  let videoFiles = files.filter((f) =>
    videoExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
  );

  if (videoFiles.length > 0) {
    if (videoFiles.length > 1) {
      // Filter out small sample clips / trailers (< 40MB)
      const withoutSamples = videoFiles.filter((f) => {
        const lower = f.name.toLowerCase();
        return !(lower.includes("sample") || lower.includes("trailer")) || f.length > 40 * 1024 * 1024;
      });
      if (withoutSamples.length > 0) {
        videoFiles = withoutSamples;
      }
      // If multiple episodes/parts, pick Episode 1 by natural alphanumeric sorting
      videoFiles.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );
      return videoFiles[0];
    }
    return videoFiles[0];
  }

  // Fallback to largest file overall
  const sorted = [...files].sort((a, b) => b.length - a.length);
  return sorted[0];
}

/**
 * Turbo Fast-Start Booster:
 * Prioritizes the first 12 pieces (video/container headers, audio/video codecs, initial keyframes)
 * and the last 4 pieces (MP4 moov atom / indexing table) with critical priority (100).
 * This causes all connected seeders to send the startup chunks immediately, initiating playback in 1-2s!
 */
export function boostTargetFileStreaming(
  torrent: WebTorrent.Torrent,
  target: WebTorrent.TorrentFile
) {
  try {
    const startPiece = (target as any)._startPiece ?? 0;
    const endPiece = (target as any)._endPiece ?? startPiece;

    // 1. Critical priority for the first 12 pieces (~10-20 MB) so playback begins immediately
    const headEnd = Math.min(startPiece + 12, endPiece);
    try {
      (torrent as any).select(startPiece, headEnd, 100);
    } catch {}

    // 2. High priority for the last 4 pieces (container moov atom / index)
    const tailStart = Math.max(startPiece, endPiece - 4);
    try {
      (torrent as any).select(tailStart, endPiece, 90);
    } catch {}
  } catch {}
}

/**
 * Optimizes WebTorrent bandwidth & memory:
 * Deselects all other files in the torrent so WebTorrent ONLY downloads chunks for the active target file!
 */
export function selectOnlyTargetFile(
  torrent: WebTorrent.Torrent,
  target: WebTorrent.TorrentFile
): WebTorrent.TorrentFile {
  try {
    if (torrent.files && torrent.files.length > 1) {
      for (const f of torrent.files) {
        if (f !== target) {
          try { (f as any).deselect?.(); } catch {}
        }
      }
      try { (target as any).select?.(); } catch {}
    }
    // Apply turbo fast-start boost to target file
    boostTargetFileStreaming(torrent, target);
  } catch {}
  return target;
}

/**
 * Resolves the EXACT video file to stream.
 * For TV Series with season packs (containing 10-25 episodes),
 * it matches the specific Season & Episode requested via regex patterns,
 * natural index sorting, or fileIndex, and deselects all other episodes!
 */
export function resolveTargetVideoFile(
  torrent: WebTorrent.Torrent,
  req: any
): WebTorrent.TorrentFile | undefined {
  if (!torrent || !torrent.files || torrent.files.length === 0) return undefined;

  const fileIndex = extractFileIndexFromRequest(req);
  const season = extractSeasonFromRequest(req);
  const episode = extractEpisodeFromRequest(req);

  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".ts"];
  const videoFiles = torrent.files.filter((f) =>
    videoExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
  );

  // Filter out tiny sample clips or trailers (< 35MB)
  const withoutSamples = videoFiles.filter((f) => {
    const lower = f.name.toLowerCase();
    const isSample = lower.includes("sample") || lower.includes("trailer");
    const isTiny = f.length < 35 * 1024 * 1024;
    return !(isSample && isTiny);
  });
  const candidates = withoutSamples.length > 0 ? withoutSamples : videoFiles.length > 0 ? videoFiles : torrent.files;

  // 1. If an individual episode is requested (Web Series mode):
  if (episode != null && !isNaN(episode)) {
    const sStr = season != null ? String(season) : undefined;
    const epStr = String(episode);

    // Regex Pattern A: S01E03, S1E3, s01e03
    const sEpRegex = sStr
      ? new RegExp(`[sS]0?${sStr}[eE]0?${epStr}\\b`, "i")
      : new RegExp(`[eE]0?${epStr}\\b`, "i");

    // Regex Pattern B: 1x03, 1x3
    const xRegex = sStr
      ? new RegExp(`\\b0?${sStr}[xX]0?${epStr}\\b`, "i")
      : undefined;

    // Regex Pattern C: Episode 03, Ep 03, Part 03
    const epWordRegex = new RegExp(`(?:episode|ep|part)[\\s._-]*0?${epStr}\\b`, "i");

    // Regex Pattern D: standalone episode number at word boundary (e.g. "Series Name - 03 - ...")
    const standAloneNumRegex = new RegExp(`(?:^|[\\W_])0?${epStr}(?:[\\W_]|$)`, "i");

    // Search candidate video files
    for (const f of candidates) {
      const name = f.name;
      const path = (f as any).path || "";
      if (sEpRegex.test(name) || sEpRegex.test(path)) {
        return selectOnlyTargetFile(torrent, f);
      }
      if (xRegex && (xRegex.test(name) || xRegex.test(path))) {
        return selectOnlyTargetFile(torrent, f);
      }
      if (epWordRegex.test(name) || epWordRegex.test(path)) {
        return selectOnlyTargetFile(torrent, f);
      }
    }

    for (const f of candidates) {
      if (standAloneNumRegex.test(f.name)) {
        return selectOnlyTargetFile(torrent, f);
      }
    }

    // If fileIndex was specifically provided and points to a video in candidates
    if (fileIndex != null && !isNaN(fileIndex) && torrent.files[fileIndex]) {
      const f = torrent.files[fileIndex];
      const isVideo = videoExtensions.some((ext) => f.name.toLowerCase().endsWith(ext));
      if (isVideo) {
        return selectOnlyTargetFile(torrent, f);
      }
    }

    // Natural alphabetical/numeric sorted order fallback:
    // S01E01, S01E02, S01E03...
    const sorted = [...candidates].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    const targetIdx = episode - 1;
    if (targetIdx >= 0 && targetIdx < sorted.length) {
      return selectOnlyTargetFile(torrent, sorted[targetIdx]);
    }
  }

  // 2. Direct fileIndex fallback
  if (fileIndex != null && !isNaN(fileIndex) && torrent.files[fileIndex]) {
    return selectOnlyTargetFile(torrent, torrent.files[fileIndex]);
  }

  // 3. Overall best video file
  const chosen = pickBestVideoFile(torrent.files);
  return chosen ? selectOnlyTargetFile(torrent, chosen) : undefined;
}

export interface TorrentEpisodeFile {
  name: string;
  index: number;
  length: number;
  file: WebTorrent.TorrentFile;
}

export function getPlayableEpisodeFiles(
  files: WebTorrent.TorrentFile[]
): TorrentEpisodeFile[] {
  if (!files || files.length === 0) return [];

  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".ts"];
  let videoFiles = files
    .map((f, i) => ({ file: f, index: i, name: f.name, length: f.length }))
    .filter((f) => videoExtensions.some((ext) => f.name.toLowerCase().endsWith(ext)));

  // If multiple video files, filter out tiny sample clips or trailers (< 40MB)
  if (videoFiles.length > 1) {
    const withoutSamples = videoFiles.filter((f) => {
      const lower = f.name.toLowerCase();
      const isSampleName = lower.includes("sample") || lower.includes("trailer");
      const isVerySmall = f.length < 40 * 1024 * 1024;
      return !(isSampleName && isVerySmall);
    });
    if (withoutSamples.length > 0) {
      videoFiles = withoutSamples;
    }
  }

  // Natural alphabetical/numeric sort so S01E01 comes before S01E02, Episode 1 before Episode 2
  videoFiles.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );

  return videoFiles;
}

export function getMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm") || lower.endsWith(".mkv")) return "video/webm";
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
    const targetFile = resolveTargetVideoFile(torrent, req);

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
  const season = extractSeasonFromRequest(req);
  const episode = extractEpisodeFromRequest(req);
  const sEpKey = season != null && episode != null ? `_s${season}e${episode}` : "";
  const cacheKey = `${infoHash}${sEpKey}_file_${fileIndex != null ? fileIndex : "default"}`;
  if (streamInfoCache.has(cacheKey)) {
    return res.json(streamInfoCache.get(cacheKey));
  }

  try {
    const streamPort = config.PORT || process.env.PORT || 8080;
    const seasonEpParam = season != null && episode != null ? `&season=${season}&episode=${episode}` : "";
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${streamPort}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      streamUrl = `http://127.0.0.1:${streamPort}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}${seasonEpParam}`;
    }

    execFile(
      getFfprobePath(),
      [
        "-v",
        "error",
        "-probesize",
        "1000000",
        "-analyzeduration",
        "1500000",
        "-show_entries",
        "stream=index,codec_name,codec_type:stream_tags=language,title",
        "-of",
        "json",
        streamUrl,
      ],
      { timeout: 20000 },
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

  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).send("Missing torrent parameter");
  }

  const track = parseInt(req.query?.track || "0", 10);
  const ss = parseFloat(req.query?.ss || "0");
  const fileIndex = extractFileIndexFromRequest(req);
  const season = extractSeasonFromRequest(req);
  const episode = extractEpisodeFromRequest(req);
  const sEpKey = season != null && episode != null ? `_s${season}e${episode}` : "";
  const infoHash = extractInfoHash(magnetUri) || magnetUri;
  const cacheKey = `${infoHash}${sEpKey}_file_${fileIndex != null ? fileIndex : "default"}_track_${track}`;

  const cached = audioTranscodeMap.get(cacheKey);

  // 1. If transcoded to disk (either fully complete, or has cached enough bytes for requested ss),
  // serve directly from disk with instant response and fast byte offset seek support!
  if (cached && fs.existsSync(cached.filePath)) {
    const stat = fs.statSync(cached.filePath);
    const fileSize = stat.size;
    const ssByteOffset = ss > 0 ? Math.floor(ss * 24000) : 0; // CBR 192kbps = 24,000 bytes/sec

    // Serve from disk if complete, or if background transcode is already at least 5s past ss
    if (cached.complete || fileSize > ssByteOffset + 120000) {
      const range = req.headers?.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const rawStart = parseInt(parts[0], 10);
        const start = Math.min(fileSize - 1, ssByteOffset + (isNaN(rawStart) ? 0 : rawStart));
        const end = parts[1] ? Math.min(fileSize - 1, ssByteOffset + parseInt(parts[1], 10)) : fileSize - 1;
        const chunkSize = Math.max(0, end - start + 1);
        res.writeHead(206, {
          "Content-Range": `bytes ${start - ssByteOffset}-${end - ssByteOffset}/${fileSize - ssByteOffset}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "audio/mpeg",
        });
        const stream = fs.createReadStream(cached.filePath, { start, end });
        stream.pipe(res);
        req.on("close", () => stream.destroy());
      } else {
        const start = Math.min(fileSize - 1, ssByteOffset);
        const end = fileSize - 1;
        const chunkSize = Math.max(0, end - start + 1);
        res.writeHead(200, {
          "Content-Length": chunkSize,
          "Content-Type": "audio/mpeg",
          "Accept-Ranges": "bytes",
        });
        const stream = fs.createReadStream(cached.filePath, { start, end });
        stream.pipe(res);
        req.on("close", () => stream.destroy());
      }
      return;
    }
  }

  // 2. Otherwise, stream live while caching in background
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Accept-Ranges", "none");

  try {
    const streamPort = config.PORT || process.env.PORT || 8080;
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${streamPort}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      const seasonEpParam = season != null && episode != null ? `&season=${season}&episode=${episode}` : "";
      streamUrl = `http://127.0.0.1:${streamPort}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}${seasonEpParam}`;
    }

    const args: string[] = [
      "-nostdin",
      "-v",
      "error",
      "-probesize",
      "1000000",
      "-analyzeduration",
      "1000000",
      "-fflags",
      "+nobuffer+fastseek",
      "-flush_packets",
      "1",
    ];
    if (ss > 0) {
      args.push("-ss", String(ss));
    }
    args.push("-i", streamUrl);
    args.push(
      "-vn",
      "-map",
      `0:a:${track}`,
      "-c:a",
      "libmp3lame",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "-threads",
      "0",
      "-f",
      "mp3",
      "pipe:1"
    );

    const ff = spawn(getFfmpegPath(), args);

    // If starting from 0:00 and no background transcode is active, simultaneously save to cache file!
    let fileStream: fs.WriteStream | null = null;
    let cacheState: AudioCacheState | null = null;
    if (ss === 0 && !audioTranscodeMap.has(cacheKey)) {
      const filePath = path.join(AUDIO_CACHE_DIR, `${cacheKey}.mp3`);
      cacheState = { filePath, complete: false, process: ff };
      audioTranscodeMap.set(cacheKey, cacheState);
      fileStream = fs.createWriteStream(filePath);
      fileStream.on("error", (err) => {
        console.warn("[AudioCache WriteStream error]:", err?.message || err);
      });
      ff.stdout.pipe(fileStream);

      ff.on("close", (code) => {
        if (code === 0 && fs.existsSync(filePath)) {
          if (cacheState) cacheState.complete = true;
          console.log(`[AudioCache] Track fully cached to disk: ${cacheKey}`);
        }
      });
    }

    ff.stdout.pipe(res);

    const cleanup = () => {
      ff.stdout.unpipe(res);
      // If we are actively saving the full file in background, do NOT kill ff! Let it finish saving!
      if (!fileStream) {
        try { ff.kill("SIGKILL"); } catch {}
      }
    };
    req.on("close", cleanup);
    res.on("close", cleanup);

    ff.on("error", (err) => {
      console.warn("[TorrentAudio ffmpeg error]:", err?.message);
      if (!res.headersSent) res.status(500).end();
    });

    ff.stderr?.on("data", (chunk) => {
      console.warn("[TorrentAudio ffmpeg stderr]:", chunk.toString());
    });

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
  const season = extractSeasonFromRequest(req);
  const episode = extractEpisodeFromRequest(req);

  try {
    const streamPort = config.PORT || process.env.PORT || 8080;
    const seasonEpParam = season != null && episode != null ? `&season=${season}&episode=${episode}` : "";
    let streamUrl = magnetUri;
    if (magnetUri.startsWith("/")) {
      streamUrl = `http://127.0.0.1:${streamPort}${magnetUri}`;
    } else if (!magnetUri.startsWith("http://") && !magnetUri.startsWith("https://")) {
      streamUrl = `http://127.0.0.1:${streamPort}/stream?torrent=${encodeURIComponent(magnetUri)}${fileIndex != null ? `&fileIndex=${fileIndex}` : ""}${seasonEpParam}`;
    }

    const args: string[] = [
      "-nostdin",
      "-v",
      "error",
      "-probesize",
      "1000000",
      "-analyzeduration",
      "1000000",
      "-i",
      streamUrl,
      "-map",
      `0:${streamIndex}`,
      "-f",
      "webvtt",
      "pipe:1",
    ];

    const ff = spawn(getFfmpegPath(), args);
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

/**
 * GET /streamPrewarm?torrent=...&fileIndex=...&season=...&episode=...
 * Pre-warms the torrent swarm in the background before the user clicks Play!
 * Joins swarm, resolves metadata, connects to peers, and prioritizes the first chunks.
 */
export async function handleTorrentPrewarm(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const magnetUri = extractMagnetFromRequest(req);
  if (!magnetUri) {
    return res.status(400).json({ error: "Missing torrent" });
  }

  // Prewarm asynchronously in background without blocking response
  (async () => {
    try {
      const torrent = await getOrAddTorrent(magnetUri);
      const targetFile = resolveTargetVideoFile(torrent, req);
      if (targetFile) {
        boostTargetFileStreaming(torrent, targetFile);
      }
    } catch {}
  })();

  res.json({ ok: true, prewarming: true });
}
