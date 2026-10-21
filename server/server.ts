import config from "./config.ts";
import fs from "node:fs";
import express, { type Response } from "express";
import bodyParser from "body-parser";
import compression from "compression";
import cors from "cors";
import https from "node:https";
import http from "node:http";
import { Server } from "socket.io";
import { searchYoutube, youtubePlaylist } from "./utils/youtube.ts";
import { Room } from "./room.ts";
import { redis, redisCount } from "./utils/redis.ts";
import {
  getCustomerByUid,
  createSelfServicePortal,
  getIsSubscriberByUid,
  stripe,
} from "./utils/stripe.ts";
import { deleteUser, validateUserToken } from "./utils/firebase.ts";
import path from "node:path";
import { getStartOfDay } from "./utils/time.ts";
import { getSessionLimitSeconds } from "./vm/utils.ts";
import { postgres, insertObject, upsertObject } from "./utils/postgres.ts";
import axios, { isAxiosError } from "axios";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolveShard } from "./utils/resolveShard.ts";
import { makeRoomName, makeUserName } from "./utils/moniker.ts";
import { getStats } from "./utils/getStats.ts";
import {
  handleTorrentData,
  handleTorrentProgress,
  handleTorrentStream,
  handleTorrentAudio,
  handleTorrentInfo,
  handleTorrentSubtitle,
} from "./torrent.ts";
import { movieRouter } from "./movieService.ts";

if (process.env.NODE_ENV === "development") {
  axios.interceptors.request.use(
    (config) => {
      // console.log(config);
      return config;
    },
    (error) => {
      console.error(error);
    },
  );
}

const releaseInterval = 5 * 60 * 1000;
const app = express();
let server = null as https.Server | http.Server | null;
if (config.SSL_KEY_FILE && config.SSL_CRT_FILE) {
  const key = fs.readFileSync(config.SSL_KEY_FILE);
  const cert = fs.readFileSync(config.SSL_CRT_FILE);
  server = https.createServer({ key: key, cert: cert }, app);
} else {
  server = new http.Server(app);
}
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException Prevented Server Crash]:", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.warn("[UnhandledRejection Prevented Server Crash]:", reason);
});

server?.listen(config.PORT, config.HOST);

const io = new Server(server, { cors: {}, transports: ["websocket"] });
io.engine.use(async (req: any, res: Response, next: () => void) => {
  const roomId = req._query.roomId;
  if (!roomId) {
    return next();
  }
  // Attempt to ensure the room being connected to is loaded in memory
  // If it doesn't exist, we may fail later with "invalid namespace"
  const shard = resolveShard(roomId);
  const key = "/" + roomId;
  // Check to make sure this shard should load this room
  const isCorrectShard = !config.SHARD || shard === Number(config.SHARD);
  // Get the room data from postgres (never let a DB hiccup hang the handshake)
  let persistedRoom: PersistentRoom | undefined;
  try {
    persistedRoom = (
      await postgres?.query<PersistentRoom>(
        `SELECT * from room where "roomId" = $1`,
        [key],
      )
    )?.rows?.[0];
  } catch (e: any) {
    console.warn("[WARNING]: room preload query failed: %s", e?.message ?? e);
  }
  // Ensure the room namespace is always initialized so clients never get "Invalid namespace"
  if (isCorrectShard && !rooms.has(key)) {
    const data = persistedRoom?.data
      ? JSON.stringify(persistedRoom.data)
      : undefined;
    const room = new Room(io, key, data);
    rooms.set(key, room);
    console.log(
      "loading/recovering room %s into memory on shard %s",
      roomId,
      config.SHARD,
    );
  }
  next();
});

const rooms = new Map<string, Room>();
// Following functions iterate over in-memory rooms. They are async, and a
// rejected promise from a bare setInterval callback is an unhandled rejection
// (Node 22 exits the process), so always catch.
const runSafely = (fn: () => unknown, label: string) => {
  Promise.resolve()
    .then(fn)
    .catch((e: any) =>
      console.warn(`[WARNING]: ${label} failed: %s`, e?.message ?? e),
    );
};
setInterval(() => runSafely(minuteMetrics, "minuteMetrics"), 60 * 1000);
setInterval(() => runSafely(release, "release"), releaseInterval);
setInterval(() => runSafely(saveRooms, "saveRooms"), 1000);
if (process.env.NODE_ENV === "development") {
  try {
    import("./vmWorker.ts");
    // import('./syncSubs.ts');
    // import('./timeSeries.ts');
  } catch (e) {
    console.error(e);
  }
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "text/plain", limit: 1000000 }));
app.use("/api/movies", movieRouter);

app.get("/ping", (_req, res) => {
  res.json("pong");
});

// In-memory fallback cache for subtitles when Redis is not available
const memorySubtitleCache = new Map<string, { buffer: Buffer; expiresAt: number }>();

// Data's already compressed so go before the compression middleware
app.get("/subtitle/:hash", async (req, res) => {
  const hash = req.params.hash;
  const key = "subtitle:" + hash;
  let buf = await redis?.getBuffer(key);
  if (!buf) {
    const cached = memorySubtitleCache.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      buf = cached.buffer;
    }
  }
  if (!buf) {
    res.status(404).end("not found");
    return;
  }
  await redis?.expire(key, 24 * 60 * 60);
  res.setHeader("Content-Encoding", "gzip");
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.end(buf);
});

app.use(compression());

app.post("/subtitle", async (req, res) => {
  const data = req.body;
  if (!data) {
    res.status(400).json({ error: "no subtitle data" });
    return;
  }
  // calculate hash, gzip and save
  const hash = crypto
    .createHash("sha256")
    .update(data, "utf8")
    .digest()
    .toString("hex");
  let gzipData = gzipSync(data);
  if (redis) {
    await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
  } else {
    memorySubtitleCache.set(hash, {
      buffer: gzipData,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  }
  redisCount("subUploads");
  res.json({ hash });
});

app.get("/downloadSubtitles", async (req, res) => {
  try {
    const downloadUrl = (req.query.downloadUrl || req.query.url) ? String(req.query.downloadUrl || req.query.url) : "";
    const fileId = req.query.file_id ? String(req.query.file_id) : "";

    let directDownloadLink = downloadUrl;

    // If official OpenSubtitles file_id and key are available and no direct url
    if (!directDownloadLink && fileId && config.OPENSUBTITLES_KEY) {
      try {
        const urlResp = await axios<{ link: string }>({
          url: "https://api.opensubtitles.com/api/v1/download",
          method: "POST",
          headers: {
            "User-Agent": "dipkri v1",
            "Api-Key": config.OPENSUBTITLES_KEY,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          data: { file_id: fileId },
          timeout: 6000,
        });
        directDownloadLink = urlResp.data?.link;
      } catch (err: any) {
        console.warn("Official OpenSubtitles download failed:", err.message);
      }
    }

    if (!directDownloadLink) {
      res.status(400).json({ error: "No download URL available" });
      return;
    }

    // Fetch subtitle text from directDownloadLink
    const subResp = await axios.get(directDownloadLink, {
      responseType: "arraybuffer",
      timeout: 10000,
    });
    const rawBuffer = Buffer.from(subResp.data);
    const rawText = rawBuffer.toString("utf8");

    // Convert standard SRT to WebVTT format so all HTML5 video players can parse it
    let vttText = rawText;
    if (!rawText.trim().startsWith("WEBVTT")) {
      vttText = "WEBVTT\n\n" + rawText.replace(/\r\n|\r/g, "\n").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    }

    const gzipData = gzipSync(Buffer.from(vttText, "utf8"));
    const hash = crypto
      .createHash("sha256")
      .update(gzipData)
      .digest()
      .toString("hex");

    if (redis) {
      await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
    } else {
      memorySubtitleCache.set(hash, {
        buffer: gzipData,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
    }

    redisCount("subDownloadsOS");
    res.json({ url: "/subtitle/" + hash, link: "/subtitle/" + hash });
  } catch (e: any) {
    if (isAxiosError(e)) {
      console.warn("downloadSubtitles error:", e.message);
    }
    res.status(500).json({ error: "Failed to download subtitle" });
  }
});

app.get("/searchSubtitles", async (req, res) => {
  try {
    let title = req.query.title
      ? String(req.query.title).trim()
      : req.query.query
        ? String(req.query.query).trim()
        : "";
    const url = req.query.url ? String(req.query.url).trim() : "";
    const reqLang = req.query.lang ? String(req.query.lang).trim() : "en";
    const subLangs = reqLang === "all" ? "en,hi,es" : reqLang === "hi" ? "hi,en" : reqLang;

    if (!title && url) {
      const dnMatch = url.match(/[?&]dn=([^&]+)/i);
      if (dnMatch) {
        try {
          title = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
        } catch {}
      }
      if (!title) {
        try {
          const u = new URL(url, "http://127.0.0.1");
          const p = u.pathname.split("/").filter(Boolean).pop();
          if (p && p !== "stream") {
            title = decodeURIComponent(p);
          }
        } catch {}
      }
    }

    // 1. Try official OpenSubtitles API if key configured
    if (config.OPENSUBTITLES_KEY) {
      try {
        let subUrl = "";
        if (url) {
          const startResp = await axios({
            method: "get",
            url: url,
            headers: { Range: "bytes=0-65535" },
            responseType: "arraybuffer",
            timeout: 5000,
          });
          const start = startResp.data;
          const size = Number(startResp.headers["content-range"]?.split("/")[1]);
          const endResp = await axios({
            method: "get",
            url: url,
            headers: { Range: `bytes=${size - 65536}-` },
            responseType: "arraybuffer",
            timeout: 5000,
          });
          const end = endResp.data;
          let hash = computeOpenSubtitlesHash(start, end, size);
          subUrl = `https://api.opensubtitles.com/api/v1/subtitles?moviehash=${hash}&languages=${encodeURIComponent(subLangs)}`;
        } else if (title) {
          subUrl = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(title)}&languages=${encodeURIComponent(subLangs)}`;
        }
        if (subUrl) {
          const response = await axios.get(subUrl, {
            headers: {
              "User-Agent": "dipkri v1",
              "Api-Key": config.OPENSUBTITLES_KEY,
            },
            timeout: 5000,
          });
          if (response.data?.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
            const mappedOfficial = response.data.data.map((item: any) => {
              const rel = item.attributes?.release || item.attributes?.files?.[0]?.file_name || "Subtitle Track";
              const lang = (item.attributes?.language || "EN").toUpperCase();
              const fid = item.attributes?.files?.[0]?.file_id;
              const directUrl = item.attributes?.downloadUrl || item.url || "";
              return {
                id: String(item.id || fid),
                type: "subtitle",
                name: rel,
                title: rel,
                release: rel,
                lang,
                language: lang,
                format: (item.attributes?.format || "SRT").toUpperCase(),
                file_id: fid,
                url: directUrl,
                downloadUrl: directUrl,
                attributes: {
                  ...item.attributes,
                  release: rel,
                  language: lang,
                  format: item.attributes?.format || "SRT",
                },
              };
            });
            redisCount("subSearchesOS");
            res.json(mappedOfficial);
            return;
          }
        }
      } catch (e: any) {
        console.warn("Official OpenSubtitles search error:", e.message);
      }
    }

    // 2. High-reliability fallback using Cinemeta + Stremio OpenSubtitles v3
    if (title) {
      let imdbId = "";
      try {
        let cleanTitle = title.replace(/\.(mp4|mkv|avi|webm|mov|flv|ts)$/i, "");
        // Strip pirate sites, domains, release group watermarks e.g. www.1TamilMV.capital, TamilBlasters, etc.
        cleanTitle = cleanTitle.replace(/^(?:\[[^\]]+\]|\([^\)]+\)|\b(?:www\.)?[a-zA-Z0-9\-]+(?:\.[a-zA-Z]{2,8})+\b)\s*[-_–—:]*\s*/gi, "");
        cleanTitle = cleanTitle.replace(/\b(?:1TamilMV|TamilMV|TamilBlasters|TamilRockers|TamilYogi|Movierulz|Bolly4u|KatmovieHD|Vegamovies|YTS|YIFY|PSA|GalaxyRG|TGx|ETRG|RARBG|Extratorrent|TorrentCounter|Cinemavilla|Kuttymovies|Pagalworld|PaglaMovies|Isaimini|MadrasRockers|MalluMv|JioRockers|BalaRockers|1TamilBlasters|capital)\b\s*[-_–—:]*\s*/gi, "");
        cleanTitle = cleanTitle.replace(/[\._\-]/g, " ").replace(/\s+/g, " ").trim();

        const yearMatch = cleanTitle.match(/[\(\[]?\b(19\d\d|20\d\d)\b[\)\]]?/);
        if (yearMatch && typeof yearMatch.index === "number") {
          cleanTitle = cleanTitle.slice(0, yearMatch.index + yearMatch[0].length).trim();
        }

        const movieSearch = await axios.get(
          `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleanTitle)}.json`,
          { timeout: 5000 }
        );
        imdbId = movieSearch.data?.metas?.[0]?.imdb_id || movieSearch.data?.metas?.[0]?.id || "";
        if (!imdbId) {
          const seriesSearch = await axios.get(
            `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(cleanTitle)}.json`,
            { timeout: 5000 }
          );
          imdbId = seriesSearch.data?.metas?.[0]?.imdb_id || seriesSearch.data?.metas?.[0]?.id || "";
        }
      } catch (err: any) {
        console.warn("Cinemeta lookup error:", err.message);
      }

      if (imdbId) {
        try {
          const subsResp = await axios.get(
            `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`,
            { timeout: 7000 }
          );
          const list = subsResp.data?.subtitles || [];
          if (Array.isArray(list) && list.length > 0) {
            const sortedList = [...list].sort((a: any, b: any) => {
              if (reqLang === "all") return 0;
              const aLang = (a.lang || "").toLowerCase();
              const bLang = (b.lang || "").toLowerCase();
              const isMatch = (l: string) => {
                if (reqLang === "hi") return l === "hin" || l === "hi";
                if (reqLang === "es") return l === "spa" || l === "es";
                if (reqLang === "en") return l === "eng" || l === "en";
                return l === reqLang.toLowerCase();
              };
              const matchA = isMatch(aLang);
              const matchB = isMatch(bLang);
              if (matchA && !matchB) return -1;
              if (!matchA && matchB) return 1;
              return 0;
            });
            const mapped = sortedList.slice(0, 35).map((sub: any) => {
              const releaseName = sub.subtitleFileName || sub.movieReleaseName || "Subtitle Track";
              const langCode = (sub.lang || "en").toUpperCase();
              return {
                id: String(sub.id),
                type: "subtitle",
                name: releaseName,
                title: releaseName,
                release: releaseName,
                lang: langCode,
                language: langCode,
                format: "SRT",
                url: sub.url,
                downloadUrl: sub.url,
                attributes: {
                  release: releaseName,
                  language: langCode,
                  format: "SRT",
                  files: [{ file_id: String(sub.id), file_name: sub.subtitleFileName || releaseName }],
                  downloadUrl: sub.url,
                },
              };
            });
            redisCount("subSearchesOS");
            res.json(mapped);
            return;
          }
        } catch (subErr: any) {
          console.warn("Stremio OpenSubtitles error:", subErr.message);
        }
      }
    }

    res.json([]);
  } catch (e: any) {
    console.error("searchSubtitles error:", e.message);
    res.json([]);
  }
});

app.get("/stats", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY) {
    const stats = await getStats();
    res.json(stats);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.get("/health/:metric", async (req, res) => {
  const vmManagerStats = (
    await axios.get("http://localhost:" + config.VMWORKER_PORT + "/stats")
  ).data;
  const result = vmManagerStats[req.params.metric]?.availableVBrowsers?.length;
  res.status(result ? 200 : 500).json(result);
});

app.get("/timeSeries", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY && redis) {
    const timeSeriesData = await redis.lrange("timeSeries", 0, -1);
    const timeSeries = timeSeriesData.map((entry) => JSON.parse(entry));
    res.json(timeSeries);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.get("/youtube", async (req, res) => {
  if (typeof req.query.q === "string") {
    try {
      redisCount("youtubeSearch");
      const items = await searchYoutube(req.query.q);
      res.json(items);
    } catch {
      res.status(500).json({ error: "youtube error" });
    }
  } else {
    res.status(500).json({ error: "query must be a string" });
  }
});

app.get("/youtubePlaylist/:playlistId", async (req, res) => {
  try {
    const items = await youtubePlaylist(req.params.playlistId);
    res.json(items);
  } catch {
    res.status(500).json({ error: "youtube error" });
  }
});

app.post("/createRoom", async (req, res) => {
  const genName = () => "/" + makeRoomName(config.SHARD);
  let name = genName();
  console.log("createRoom: ", name);
  const newRoom = new Room(io, name);
  if (postgres) {
    const now = new Date();
    const roomObj = {
      roomId: newRoom.roomId,
      lastUpdateTime: now,
      creationTime: now,
    };
    try {
      await insertObject(postgres, "room", roomObj);
    } catch (e) {
      redisCount("createRoomError");
      throw e;
    }
  }
  const decoded = await validateUserToken(req.body?.uid, req.body?.token);
  newRoom.creator = decoded?.email;
  const preload = (req.body?.video || "").slice(0, 20000);
  if (preload) {
    redisCount("createRoomPreload");
    newRoom.video = preload;
    newRoom.paused = true;
    await newRoom.saveRoom();
  }
  const prePlaylist = Array.isArray(req.body?.playlist) && req.body?.playlist;
  if (prePlaylist) {
    for (let item of req.body.playlist) {
      newRoom.playlistAdd(null, item);
    }
  }
  rooms.set(name, newRoom);
  res.json({ name });
});

app.post("/terminateRoom", async (req, res) => {
  const roomId = req.body?.roomId;
  if (!roomId) {
    res.status(400).json({ error: "Missing roomId" });
    return;
  }
  const cleanId = String(roomId).replace(/^\//, "");
  const key = "/" + cleanId;
  const room = rooms.get(key);
  if (room) {
    try {
      console.log("[TERMINATE_ROOM] Terminating room %s", key);
      try {
        io.of(key).emit("REC:chat", {
          system: true,
          text: "This watch party has been terminated by the host.",
        });
        io.of(key).disconnectSockets(true);
      } catch {}
      room.destroy();
      rooms.delete(key);
      io._nsps.delete(key);
      if (postgres) {
        await postgres.query(`DELETE FROM room WHERE "roomId" = $1`, [key]).catch(() => {});
      }
    } catch (e) {
      console.warn("Failed to terminate room %s:", key, e);
    }
  }
  res.json({ success: true, terminated: cleanId });
});

app.post("/checkoutSub", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  // Don't let a user subscribe twice
  if (postgres) {
    const { rows } = await postgres.query(
      "SELECT 1 FROM subscriber WHERE uid = $1 AND status = 'active'",
      [decoded.uid],
    );
    if (rows.length) {
      res.status(400).json({ error: "already subscribed" });
      return;
    }
  }
  // Reuse the existing customer for this user, or create one tagged with their UID
  // so we can find it later even if their email changes
  const customer =
    (await getCustomerByUid(decoded.uid)) ??
    (await stripe.customers.create({
      email: decoded.email,
      metadata: { firebaseUid: decoded.uid },
    }));
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: decoded.uid,
    customer: customer.id,
    line_items: [
      {
        price:
          config.NODE_ENV === "development"
            ? "price_HNGtabCzD5qyfd"
            : "price_HNDBoPDI7yYRi9",
        quantity: 1,
      },
    ],
    // Redirect back to the user's room, passed in the body
    success_url: req.body.return_url,
    cancel_url: req.body.return_url,
  });
  res.json({ url: session.url });
});

app.post("/manageSub", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  const customer = await getCustomerByUid(decoded.uid);
  if (!customer) {
    res.status(400).json({ error: "customer not found" });
    return;
  }
  const session = await createSelfServicePortal(
    customer.id,
    req.body?.return_url,
  );
  res.json(session);
});

app.delete("/deleteAccount", async (req, res) => {
  // TODO pass this in req.query instead
  const decoded = await validateUserToken(req.body?.uid, req.body?.token);
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (postgres) {
    // Delete rooms
    await postgres.query("DELETE FROM room WHERE owner = $1", [decoded.uid]);
    // Delete linked accounts
    await postgres.query("DELETE FROM link_account WHERE uid = $1", [
      decoded.uid,
    ]);
  }
  await deleteUser(decoded.uid);
  redisCount("deleteAccount");
  res.json({});
});

app.get("/metadata", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  let isSubscriber = await getIsSubscriberByUid(decoded?.uid);
  // Has the user ever been a subscriber?
  // const customer = await getCustomerByUid(decoded.uid);
  const isFreePoolFull = false;
  const beta =
    decoded?.email != null &&
    Boolean(config.BETA_USER_EMAILS.split(",").includes(decoded?.email));
  const streamPath = config.STREAM_PATH || "";
  // log metrics but don't wait for it (an unhandled rejection would crash the process)
  if (postgres && decoded?.uid) {
    upsertObject(
      postgres,
      "active_user",
      { uid: decoded?.uid, lastActiveTime: new Date() },
      { uid: true },
    ).catch((e: any) =>
      console.warn("[WARNING]: active_user upsert failed: %s", e?.message ?? e),
    );
  }
  res.json({
    isSubscriber,
    isFreePoolFull,
    beta,
    streamPath,
  });
});

// Direct torrent streaming endpoints for BitTorrent magnet links
app.get("/data", handleTorrentData);
app.get("/stream", handleTorrentStream);
app.get("/progress", handleTorrentProgress);
app.get("/streamAudio", handleTorrentAudio);
app.get("/streamInfo", handleTorrentInfo);
app.get("/streamSubtitle", handleTorrentSubtitle);

app.get("/resolveRoom/:vanity", async (req, res) => {
  const vanity = req.params.vanity;
  const result = await postgres?.query(
    `SELECT "roomId", vanity from room WHERE LOWER(vanity) = $1`,
    [vanity?.toLowerCase() ?? ""],
  );
  // console.log(vanity, result.rows);
  // We also use this for checking name availability, so just return null if it doesn't exist (http 200)
  res.json(result?.rows[0] ?? null);
});

app.get("/roomData/:roomId", async (req, res) => {
  // Returns the room data given a room ID
  // Only return data if the room doesn't have a password
  // If it does, we could accept it as a URL parameter but for now just don't support
  const result = await postgres?.query(
    `SELECT data from room WHERE "roomId" = $1 and password IS NULL`,
    ["/" + req.params.roomId],
  );
  res.json(result?.rows[0]?.data);
});

app.get("/resolveShard/:roomId", async (req, res) => {
  const shardNum = resolveShard(req.params.roomId);
  res.send(String(config.SHARD ? shardNum : ""));
});

app.get("/linkAccount", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (!postgres) {
    res.status(400).json({ error: "invalid database client" });
    return;
  }
  // Get the linked accounts for the user
  let linkAccounts: LinkAccount[] = [];
  if (decoded?.uid && postgres) {
    const { rows } = await postgres.query(
      "SELECT kind, accountid, accountname, discriminator FROM link_account WHERE uid = $1",
      [decoded?.uid],
    );
    linkAccounts = rows;
  }
  res.json(linkAccounts);
});

app.post("/linkAccount", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (!postgres) {
    res.status(400).json({ error: "invalid database client" });
    return;
  }
  const kind = req.body?.kind;
  if (kind === "discord") {
    const tokenType = req.body?.tokenType;
    const accessToken = req.body.accessToken;
    // Get the token and verify the user
    const response = await axios.get("https://discord.com/api/users/@me", {
      headers: {
        authorization: `${tokenType} ${accessToken}`,
      },
    });
    const accountid = response.data.id;
    const accountname = response.data.username;
    const discriminator = response.data.discriminator;
    // Store the user id, username, discriminator
    await upsertObject(
      postgres,
      "link_account",
      {
        accountid: accountid,
        accountname: accountname,
        discriminator: discriminator,
        uid: decoded.uid,
        kind: kind,
      },
      { uid: true, kind: true },
    );
    res.json({});
  } else {
    res.status(400).json({ error: "unsupported kind" });
  }
});

app.delete("/linkAccount", async (req, res) => {
  // TODO read from req.query instead
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (!postgres) {
    res.status(400).json({ error: "invalid database client" });
    return;
  }
  await postgres.query(
    "DELETE FROM link_account WHERE uid = $1 AND kind = $2",
    [decoded.uid, req.body.kind],
  );
  res.json({});
});

app.get("/generateName", async (req, res) => {
  res.send(makeUserName());
});

// Proxy video segments
app.get("/proxy/*splat", async (req, res) => {
  redisCount("proxyReqs");
  try {
    const parsed = new URL("http://localhost" + req.url);
    const pathname = parsed.pathname.slice("/proxy".length);
    const host = parsed.searchParams.get("host");
    if (pathname.endsWith("index-dvr.m3u8")) {
      // VOD
      // https://d2vjef5jvl6bfs.cloudfront.net/3012391a6c3e84c79ef6_gamesdonequick_41198403369_1681059003/chunked/index-dvr.m3u8
      const resp = await axios.get("https://" + host + pathname);
      const re2 = /(.*.ts)/g;
      let repl = resp.data.replaceAll(re2, `$1?host=${host}`);
      // Mark this as a VOD
      repl += "#EXT-X-ENDLIST";
      res.send(repl);
    } else if (pathname.endsWith(".m3u8")) {
      // Stream
      // https://video-weaver.sea02.hls.ttvnw.net/v1/playlist/CrQEgv7Mz6nnsfJH3XtVQxeYXk8mViy1zNGWglcybvxZsI1rv3iLnjAnnqwCiVXCJ-DdD27J6RuFrLy7YUYwHUCKazIKICIupUCn9UXtaBYhBM5JIYqg9dz6NWYrCWU9HZJj2TGROv9mAOKuTR51YS82hdYL4PFZa3xxWXhgDsxXQHNDB03kY6S0aG0-EVva1xYrn5Ge6IAXRwug9QDGlb-ydtF3BtYppoTklVI7CVLySPPwbbt5Ow1JXdnKhLSwQEs4bh3BLwMnRBwUFI5nmE18BLYbkMOUivgYP5SSMgnGGlSkJO-iJNPWvepunEgyBUzB_7L-b1keTcV-Qak9IcWIITIWbRvmg6qB3ZSuWdcJgWKmdXdIn4qoRM4o16G1_0N_WRqPtMQFo0hmTlAVmHrzRArJQmaSgqAxZxRbFMd9RFeX6qjP9NtwguPbSeStdVbQxMNC34iavYUIxo8Ug812BHsG7J_kIlof2zkIqkEbP3oV3UkSByIo7xh9EEVargjaGDuQRt8zPQ6-fNBWJJe9F6IFu7lXBPIJ016lopyfcvTWjbLbBHsVkg6vG-3UISh0nud7KB5g5ipQePhtcFSI5hvjlfX1DAVHEpTWXkvlnL4wNqEqpBYL2btSXYeE1Cb-RAvrAT0s61usERcL2eI-S5aTcSO8_hxQ2afC7c9vlypOWgP6p6XNpViZHXmdXv4t-d68Z-MpLtSU7VbB3pRWnSswFFyA3W39ITic4lb97Djp3wHhGgz0Sy8aDb9r0tnphIYgASoJdXMtZWFzdC0yMKQG.m3u8
      // Extract the edge URL host and add it to URL so proxy can fetch
      const resp = await axios.get("https://" + host + pathname);
      // const re = /https:\/\/(.*)\/v1\/segment\/(.*)/g;
      // const match = re.exec(resp.data);
      // const edgehost = match?.[1];
      // const repl = resp.data.replaceAll(
      //   re,
      //   `/proxy/v1/segment/$2?host=${edgehost}`,
      // );
      const repl = resp.data;
      res.send(repl);
    } else if (pathname.endsWith(".ts")) {
      // Segment
      const resp = await axios.get("https://" + host + pathname, {
        responseType: "arraybuffer",
      });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": resp.data.length,
        "Transfer-Encoding": "chunked",
      });
      res.write(resp.data);
      res.end();
    } else {
      res.status(404);
      res.end();
    }
  } catch (e) {
    // console.log(e);
    console.log("proxy failed: %s", req.url);
  }
});

// Universal stream CORS proxy for external HLS/M3U8 streams requiring custom headers
app.get("/stream-proxy", async (req, res) => {
  try {
    const rawUrl = req.query.url ? String(req.query.url).trim() : "";
    if (!rawUrl || (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))) {
      res.status(400).send("Invalid target URL");
      return;
    }

    let customHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    };

    if (req.query.headers) {
      try {
        const parsed = JSON.parse(String(req.query.headers));
        if (typeof parsed === "object" && parsed !== null) {
          customHeaders = { ...customHeaders, ...parsed };
        }
      } catch {}
    }

    if (req.query.referer) {
      customHeaders["Referer"] = String(req.query.referer);
    }
    if (req.query.origin) {
      customHeaders["Origin"] = String(req.query.origin);
    }

    const resp = await axios.get(rawUrl, {
      headers: customHeaders,
      responseType: "arraybuffer",
      timeout: 12000,
      validateStatus: () => true,
    });

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "*");

    const contentType = resp.headers["content-type"] || "";

    if (
      contentType.includes("mpegurl") ||
      contentType.includes("application/x-mpegURL") ||
      rawUrl.includes(".m3u8") ||
      contentType.includes("text/plain")
    ) {
      const text = Buffer.from(resp.data).toString("utf-8");
      if (text.trim().startsWith("#EXTM3U")) {
        const lines = text.split("\n");
        const rewritten = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/g, (_match, uriVal) => {
              const abs = new URL(uriVal, rawUrl).toString();
              const proxied = `/stream-proxy?url=${encodeURIComponent(abs)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
              return `URI="${proxied}"`;
            });
          }

          const abs = new URL(trimmed, rawUrl).toString();
          return `/stream-proxy?url=${encodeURIComponent(abs)}&headers=${encodeURIComponent(JSON.stringify(customHeaders))}`;
        });

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.send(rewritten.join("\n"));
        return;
      }
    }

    if (contentType) {
      res.set("Content-Type", contentType);
    }
    res.send(resp.data);
  } catch (err: any) {
    console.warn("stream-proxy error:", err?.message || err);
    res.status(502).send("Upstream stream error");
  }
});

app.get("/favicon.ico", (_req, res) => {
  res.set("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(
    path.resolve(
      import.meta.dirname + `/../${config.BUILD_DIRECTORY}/favicon.ico`,
    ),
  );
});
app.get("/favicon.svg", (_req, res) => {
  res.set("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(
    path.resolve(
      import.meta.dirname + `/../${config.BUILD_DIRECTORY}/favicon.svg`,
    ),
  );
});

app.use(express.static(config.BUILD_DIRECTORY));
// Send index.html for all other requests (SPA) with no-cache so users always receive latest bundle
app.use("/*splat", (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(
    path.resolve(
      import.meta.dirname + `/../${config.BUILD_DIRECTORY}/index.html`,
    ),
  );
});

async function saveRooms() {
  // Unload rooms that are empty and idle
  // Frees up some JS memory space when process is long-running
  // On reconnect, we'll attempt to reload the room
  let saveCount = 0;
  let skipCount = 0;
  const start = Date.now();
  await Promise.all(
    Array.from(rooms.entries()).map(async ([key, room]) => {
      if (
        room.roster.length === 0 &&
        !room.vBrowser &&
        Number(room.lastUpdateTime) < Date.now() - 8 * 60 * 60 * 1000
      ) {
        console.log(
          "freeing room %s from memory on shard %s",
          key,
          config.SHARD,
        );
        await room.saveRoom();
        room.destroy();
        rooms.delete(key);
        saveCount += 1;
        // Unregister the namespace to avoid dupes on reload
        io._nsps.delete(key);
      } else if (room.roster.length) {
        room.lastUpdateTime = new Date();
        await room.saveRoom();
        saveCount += 1;
      } else {
        skipCount += 1;
      }
    }),
  );
  const end = Date.now();
  console.log(
    "[SAVEROOMS] %s saved in %sms, %s skipped",
    saveCount,
    end - start,
    skipCount,
  );
}

async function release() {
  // Reset VMs in rooms that are:
  // older than the session limit
  // assigned to a room with no users
  const roomArr = Array.from(rooms.values());
  console.log("[RELEASE] %s rooms in batch", roomArr.length);
  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.assignTime) {
      const maxTime = getSessionLimitSeconds(room.vBrowser.large) * 1000;
      const elapsed = Date.now() - room.vBrowser.assignTime;
      const ttl = maxTime - elapsed;
      const isTimedOut = ttl && ttl < releaseInterval;
      const isAlmostTimedOut = ttl && ttl < releaseInterval * 2;
      const isRoomEmpty = room.roster.length === 0;
      const isRoomIdle =
        Date.now() - Number(room.lastUpdateTime) > 5 * 60 * 1000;
      if (isTimedOut || (isRoomEmpty && isRoomIdle)) {
        console.log("[RELEASE] VM in room:", room.roomId);
        room.stopVBrowserInternal();
        if (isTimedOut) {
          room.addChatMessage(null, {
            id: "",
            system: true,
            cmd: "vBrowserTimeout",
            msg: "",
          });
          redisCount("vBrowserTerminateTimeout");
        } else if (isRoomEmpty) {
          redisCount("vBrowserTerminateEmpty");
        }
      } else if (isAlmostTimedOut) {
        room.addChatMessage(null, {
          id: "",
          system: true,
          cmd: "vBrowserAlmostTimeout",
          msg: "",
        });
      }
    }
    // We want to spread out the jobs over about half the release interval
    // This gives other jobs some CPU time
    const waitTime = releaseInterval / 2 / roomArr.length;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

async function minuteMetrics() {
  const roomArr = Array.from(rooms.values());
  let vbWaiting = 0;
  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.id) {
      // Update the heartbeat
      await postgres?.query(
        `UPDATE vbrowser SET "heartbeatTime" = NOW() WHERE "roomId" = $1 and vmid = $2`,
        [room.roomId, room.vBrowser.id],
      );

      const expireTime = getStartOfDay() / 1000 + 86400;
      if (room.vBrowser?.creatorClientID) {
        await redis?.zincrby(
          "vBrowserClientIDMinutes",
          1,
          room.vBrowser.creatorClientID,
        );
        await redis?.expireat("vBrowserClientIDMinutes", expireTime);
      }
      if (room.vBrowser?.creatorUID) {
        await redis?.zincrby(
          "vBrowserUIDMinutes",
          1,
          room.vBrowser?.creatorUID,
        );
        await redis?.expireat("vBrowserUIDMinutes", expireTime);
      }
    }
    const users = room.roster.length;
    if (users) {
      await redis?.setex(`roomCounts:${room.roomId}`, 120, users);
      await redis?.setex(
        `roomRosters:${room.roomId}`,
        120,
        JSON.stringify(room.getRosterForStats()),
      );
    }
    vbWaiting += room.vBrowserQueue ? 1 : 0;
  }
  // Report shard metrics
  const obj: ShardMetric = {
    uptime: process.uptime(),
    mem: process.memoryUsage().rss,
    roomCount: rooms.size,
    users: io.engine.clientsCount,
    vbWaiting,
  };
  await redis?.setex(
    `shardMetrics:${config.SHARD ?? 0}`,
    120,
    JSON.stringify(obj),
  );
}

function computeOpenSubtitlesHash(first: Buffer, last: Buffer, size: number) {
  // console.log(first.length, last.length, size);
  let temp = BigInt(size);
  process(first);
  process(last);

  temp = temp & BigInt("0xffffffffffffffff");
  return temp.toString(16).padStart(16, "0");

  function process(chunk: Buffer) {
    for (let i = 0; i < chunk.length; i += 8) {
      const long = chunk.readBigUInt64LE(i);
      temp += long;
    }
  }
}
