import WebTorrent from "webtorrent";

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

// High-availability public BitTorrent trackers for accelerated peer discovery
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://explodie.org:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
];

// Map to deduplicate concurrent requests for the same torrent metadata
const pendingTorrents = new Map<string, Promise<WebTorrent.Torrent>>();

/**
 * Extracts 40-char hex or 32-char base32 infoHash from a magnet link or raw hash.
 */
export function extractInfoHash(magnetUri: string): string | null {
  if (!magnetUri) return null;
  const match = magnetUri.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  if (/^[a-fA-F0-9]{40}$/.test(magnetUri.trim())) {
    return magnetUri.trim().toLowerCase();
  }
  return null;
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
    const fileIdx = sub.indexOf("&fileIndex=");
    if (fileIdx !== -1) {
      sub = sub.slice(0, fileIdx);
    }
    try {
      return decodeURIComponent(sub);
    } catch {
      return sub;
    }
  }

  const queryTorrent = req.query?.torrent;
  if (queryTorrent) {
    return String(queryTorrent);
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

  // 1. Check existing torrents in client.torrents first
  let existing: WebTorrent.Torrent | undefined = undefined;
  if (infoHash) {
    existing = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash
    );
  }
  if (!existing) {
    existing = client.torrents.find((t) => t.magnetURI === magnetUri);
  }
  if (!existing) {
    try {
      existing = (client.get(infoHash || magnetUri) as unknown as WebTorrent.Torrent) || undefined;
    } catch {}
  }

  if (existing) {
    if (existing.ready) {
      return existing;
    }
    return new Promise((resolve) => {
      existing!.once("ready", () => resolve(existing!));
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
        ? client.torrents.find((t) => t.infoHash && t.infoHash.toLowerCase() === infoHash)
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
        if (!torrent.ready && torrent.numPeers === 0) {
          console.warn("[WebTorrent] Waiting for peers timed out for infoHash:", torrent.infoHash);
        }
      }, 45000);

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
          ? client.torrents.find((t) => t.infoHash && t.infoHash.toLowerCase() === infoHash)
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

    const fileIndexQuery = req.query?.fileIndex;
    const fileIndex = fileIndexQuery != null ? Number(fileIndexQuery) : undefined;
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
          // Seeking in middle: request in 16MB chunks for lightning-fast piece prioritization
          const MAX_CHUNK = 16 * 1024 * 1024;
          end = Math.min(start + MAX_CHUNK - 1, fileSize - 1);
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
