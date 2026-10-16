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
 */
export async function getOrAddTorrent(magnetUri: string): Promise<WebTorrent.Torrent> {
  const client = getClient();
  const existing = (await client.get(magnetUri)) as WebTorrent.Torrent | undefined;
  if (existing) {
    if (existing.ready) {
      return existing;
    }
    return new Promise((resolve) => {
      existing.once("ready", () => resolve(existing));
    });
  }

  if (pendingTorrents.has(magnetUri)) {
    return pendingTorrents.get(magnetUri)!;
  }

  const promise = new Promise<WebTorrent.Torrent>((resolve, reject) => {
    try {
      const torrent = client.add(magnetUri, {
        announce: DEFAULT_TRACKERS,
        destroyStoreOnDestroy: true,
      });

      const timeout = setTimeout(() => {
        pendingTorrents.delete(magnetUri);
        if (!torrent.ready && torrent.numPeers === 0) {
          console.warn("[WebTorrent] Waiting for peers timed out for infoHash:", torrent.infoHash);
        }
      }, 35000);

      torrent.on("ready", () => {
        clearTimeout(timeout);
        pendingTorrents.delete(magnetUri);
        resolve(torrent);
      });

      torrent.on("error", (err) => {
        clearTimeout(timeout);
        pendingTorrents.delete(magnetUri);
        reject(err);
      });
    } catch (err) {
      pendingTorrents.delete(magnetUri);
      reject(err);
    }
  });

  pendingTorrents.set(magnetUri, promise);
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
  const torrent = (await client.get(magnetUri)) as WebTorrent.Torrent | undefined;
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
      return res.status(404).send("No video file found in torrent");
    }

    const fileSize = targetFile.length;
    const range = req.headers?.range;
    const contentType = getMimeType(targetFile.name);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
      });

      const stream = targetFile.createReadStream({ start, end });
      req.on("close", () => {
        (stream as any)?.destroy?.();
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });

      const stream = targetFile.createReadStream();
      req.on("close", () => {
        (stream as any)?.destroy?.();
      });
      stream.pipe(res);
    }
  } catch (err: any) {
    console.error("[Torrent Stream Error]:", err?.message || err);
    if (!res.headersSent) {
      res.status(500).send("Torrent streaming error: " + (err?.message || "unknown"));
    }
  }
}
