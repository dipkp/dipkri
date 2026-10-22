import { Router, type Request, type Response } from "express";
import axios from "axios";
import config from "./config.ts";

export const movieRouter = Router();

// In-memory cache with 15-minute expiration to reduce external API latency
interface CacheEntry {
  data: any;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(key: string) {
  const item = cache.get(key);
  if (item && item.expires > Date.now()) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key: string, data: any) {
  if (cache.size > 2000) {
    // Purge oldest entries if cache grows too large
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function formatTmdbItem(item: any, explicitType?: "movie" | "tv") {
  const mediaType = item.media_type || explicitType || (item.first_air_date ? "tv" : "movie");
  return {
    id: item.id,
    title: item.title || item.name || "Untitled",
    originalTitle: item.original_title || item.original_name,
    overview: item.overview || "",
    poster: item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${item.backdrop_path}` : null,
    type: mediaType as "movie" | "tv",
    year: (item.release_date || item.first_air_date || "").slice(0, 4),
    releaseDate: item.release_date || item.first_air_date || "",
    rating: item.vote_average ? Number(item.vote_average.toFixed(1)) : 0,
    voteCount: item.vote_count || 0,
    popularity: item.popularity || 0,
  };
}

/**
 * GET /api/movies/trending
 * Returns trending movies and TV series
 */
movieRouter.get("/trending", async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const rawType =
    typeof req.query.type === "string" ? req.query.type.toLowerCase() : "all";
  const type: "all" | "movie" | "tv" =
    rawType === "movie" || rawType === "tv" ? rawType : "all";
  const cacheKey = `trending:${type}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const apiKey = config.TMDB_API_KEY;
    const url = `${TMDB_BASE_URL}/trending/${type}/day?api_key=${apiKey}&page=${page}`;
    const response = await axios.get(url, { timeout: 8000 });
    const rawResults = response.data?.results || [];

    const items = rawResults
      .filter((item: any) => item.media_type === "movie" || item.media_type === "tv")
      .map((item: any) => formatTmdbItem(item));

    const payload = {
      results: items,
      page: response.data.page || 1,
      totalPages: response.data.total_pages || 1,
      totalResults: response.data.total_results || items.length,
    };

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (error: any) {
    console.error("[MovieService] Trending error:", error?.message || error);
    res.status(500).json({ error: "Failed to fetch trending movies" });
  }
});

/**
 * GET /api/movies/search?q={query}&type={all|movie|tv}&page={page}
 * Multi-search or type-specific search
 */
movieRouter.get("/search", async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = (typeof req.query.type === "string" ? req.query.type.toLowerCase() : "all") as "all" | "movie" | "tv";
  const page = Number(req.query.page) || 1;

  if (!query) {
    res.json({ results: [], page: 1, totalPages: 0, totalResults: 0 });
    return;
  }

  const cacheKey = `search:${type}:${query}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const apiKey = config.TMDB_API_KEY;
    let endpoint = "/search/multi";
    if (type === "movie") endpoint = "/search/movie";
    if (type === "tv") endpoint = "/search/tv";

    const url = `${TMDB_BASE_URL}${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}&page=${page}&include_adult=false`;
    const response = await axios.get(url, { timeout: 8000 });
    const rawResults = response.data?.results || [];

    const items = rawResults
      .filter((item: any) => {
        const itemType = item.media_type || (type !== "all" ? type : null);
        return itemType === "movie" || itemType === "tv";
      })
      .map((item: any) => formatTmdbItem(item, type !== "all" ? type : undefined));

    const payload = {
      results: items,
      page: response.data.page || 1,
      totalPages: response.data.total_pages || 1,
      totalResults: response.data.total_results || items.length,
    };

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (error: any) {
    console.error("[MovieService] Search error:", error?.message || error);
    res.status(500).json({ error: "Failed to search movies" });
  }
});

/**
 * GET /api/movies/details?id={id}&type={movie|tv}
 * Returns full details, synopsis, runtime/episodes, and seasons list for TV shows
 */
movieRouter.get("/details", async (req: Request, res: Response) => {
  const id = req.query.id ? String(req.query.id).trim() : "";
  const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";

  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  const cacheKey = `details:${type}:${id}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const apiKey = config.TMDB_API_KEY;
    const url = `${TMDB_BASE_URL}/${type}/${id}?api_key=${apiKey}&append_to_response=external_ids`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    const base = formatTmdbItem(data, type);
    const details = {
      ...base,
      genres: (data.genres || []).map((g: any) => g.name),
      tagline: data.tagline || "",
      runtime: data.runtime || (data.episode_run_time ? data.episode_run_time[0] : 0),
      status: data.status || "",
      imdbId: data.external_ids?.imdb_id || data.imdb_id || null,
      numberOfSeasons: data.number_of_seasons || (type === "tv" ? 1 : 0),
      numberOfEpisodes: data.number_of_episodes || 0,
      seasons: (data.seasons || [])
        .filter((s: any) => s.season_number > 0) // exclude specials/season 0 by default
        .map((s: any) => ({
          id: s.id,
          seasonNumber: s.season_number,
          name: s.name || `Season ${s.season_number}`,
          episodeCount: s.episode_count || 0,
          poster: s.poster_path ? `${TMDB_IMAGE_BASE}/w500${s.poster_path}` : null,
          airDate: s.air_date || "",
        })),
    };

    setCached(cacheKey, details);
    res.json(details);
  } catch (error: any) {
    console.error("[MovieService] Details error:", error?.message || error);
    res.status(500).json({ error: "Failed to fetch media details" });
  }
});

/**
 * GET /api/movies/season?id={id}&season={seasonNumber}
 * Returns episodes for a given TV show season
 */
movieRouter.get("/season", async (req: Request, res: Response) => {
  const id = req.query.id ? String(req.query.id).trim() : "";
  const seasonNumber = Number(req.query.season) || 1;

  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  const cacheKey = `season:${id}:${seasonNumber}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const apiKey = config.TMDB_API_KEY;
    const url = `${TMDB_BASE_URL}/tv/${id}/season/${seasonNumber}?api_key=${apiKey}`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    const episodes = (data.episodes || []).map((ep: any) => ({
      id: ep.id,
      episodeNumber: ep.episode_number,
      seasonNumber: ep.season_number || seasonNumber,
      name: ep.name || `Episode ${ep.episode_number}`,
      overview: ep.overview || "",
      still: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : null,
      airDate: ep.air_date || "",
      rating: ep.vote_average ? Number(ep.vote_average.toFixed(1)) : 0,
    }));

    const payload = {
      seasonNumber,
      name: data.name || `Season ${seasonNumber}`,
      episodes,
    };

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (error: any) {
    console.error("[MovieService] Season error:", error?.message || error);
    res.status(500).json({ error: "Failed to fetch season episodes" });
  }
});

/**
 * GET /api/movies/streams?imdbId={imdbId}&tmdbId={tmdbId}&type={movie|tv}&season={season}&episode={episode}&title={title}
 * Returns decentralized high-speed BitTorrent/WebTorrent streams for native HTML5 playback.
 */
movieRouter.get("/streams", async (req: Request, res: Response) => {
  let imdbId = typeof req.query.imdbId === "string" ? req.query.imdbId.trim() : "";
  const tmdbId = typeof req.query.tmdbId === "string" ? req.query.tmdbId.trim() : "";
  const type = (req.query.type === "tv" ? "tv" : "movie") as "movie" | "tv";
  const season = Number(req.query.season) || 1;
  const episode = Number(req.query.episode) || 1;
  const rawTitle = typeof req.query.title === "string" ? req.query.title.trim() : "";

  // If no imdbId, attempt auto-resolution from TMDB
  if (!imdbId && tmdbId) {
    try {
      const apiKey = config.TMDB_API_KEY;
      const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${apiKey}&append_to_response=external_ids`;
      const response = await axios.get(url, { timeout: 6000 });
      imdbId = response.data?.external_ids?.imdb_id || response.data?.imdb_id || "";
    } catch (e: any) {
      console.warn("[MovieService] Failed to resolve IMDb ID from TMDB:", e?.message || e);
    }
  }

  if (!imdbId) {
    res.json({ streams: [], error: "No IMDb ID found for this title" });
    return;
  }

  const cacheKey = `streams:${type}:${imdbId}:${season}:${episode}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const stremioEndpoint =
      type === "tv"
        ? `https://torrentio.strem.fun/stream/series/${imdbId}:${season}:${episode}.json`
        : `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;

    // Torrentio is often slow on a cold lookup. Retry once instead of handing
    // the modal an empty list that looks like "no streams".
    let response: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await axios.get(stremioEndpoint, { timeout: 20000 });
        break;
      } catch (err: any) {
        if (attempt === 1) throw err;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    const rawStreams = response?.data?.streams || [];

    const formatted = rawStreams.map((s: any, idx: number) => {
      const titleStr = s.title || "";
      const nameStr = s.name || "";
      const combined = `${nameStr} ${titleStr}`;

      const seederMatch = titleStr.match(/👤\s*(\d+)/);
      const sizeMatch = titleStr.match(/💾\s*([\d.]+\s*[GM]B)/i);
      const seeders = seederMatch ? parseInt(seederMatch[1], 10) : 0;
      const size = sizeMatch ? sizeMatch[1] : "";

      const qualityMatch = combined.match(/(2160p|4k|1080p|720p|480p)/i);
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "HD";

      // Detect video codec / rip type
      let codec = "";
      if (/x265|hevc/i.test(combined)) codec = "HEVC";
      else if (/x264|h264|avc/i.test(combined)) codec = "x264";

      // Clean release title for display
      const titleLines = titleStr.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const episodeFile = s.behaviorHints?.filename || (titleLines.length > 1 && !titleLines[1].includes("👤") ? titleLines[1] : "");
      const cleanTitle = (type === "tv" && episodeFile) ? episodeFile : (titleLines[0] || "Stream");

      // Collect announce trackers
      const trackers = (s.sources || [])
        .filter((src: string) => src.startsWith("tracker:"))
        .map((src: string) => src.replace("tracker:", ""));
      const trackerQuery =
        trackers.length > 0
          ? "&tr=" + trackers.map((t: string) => encodeURIComponent(t)).join("&tr=")
          : "";

      // Media title for display in player
      const displayTitle = rawTitle || "Movie";
      const seasonEpSuffix = type === "tv" && season && episode ? ` S${season}E${episode}` : "";
      const dn = encodeURIComponent(`${displayTitle}${seasonEpSuffix} ${quality}`);

      const seasonParam = type === "tv" && season ? `&season=${season}` : "";
      const episodeParam = type === "tv" && episode ? `&episode=${episode}` : "";
      const fileIndexParam = s.fileIdx != null ? `&fileIndex=${s.fileIdx}` : "";
      const magnet = `magnet:?xt=urn:btih:${s.infoHash}&dn=${dn}&isMovie=1${seasonParam}${episodeParam}${fileIndexParam}${trackerQuery}`;

      const episodeBadge = type === "tv" && season && episode ? `📺 S${season}:E${episode} • ` : "";
      const label = `${episodeBadge}${quality}${codec ? ` ${codec}` : ""}${size ? ` • ${size}` : ""}${seeders > 0 ? ` (${seeders} seeders)` : ""}`;

      return {
        id: idx,
        label,
        quality,
        codec,
        seeders,
        size,
        cleanTitle,
        infoHash: s.infoHash,
        fileIdx: s.fileIdx,
        magnet,
      };
    });

    // Sort: boost x264/h264 streams by +60 virtual seeders so universally playable codecs rank first,
    // while keeping massive swarms accessible.
    formatted.sort((a: any, b: any) => {
      const aCompat = a.codec === "x264" ? 60 : 0;
      const bCompat = b.codec === "x264" ? 60 : 0;
      return (b.seeders + bCompat) - (a.seeders + aCompat);
    });

    // Keep top 20 best streams
    const result = {
      imdbId,
      streams: formatted.slice(0, 20),
    };

    setCached(cacheKey, result);
    res.json(result);
  } catch (error: any) {
    console.error("[MovieService] Streams fetch error:", error?.message || error);
    // Return the resolved IMDb id so the browser can retry the indexer from its
    // own IP (datacenter hosts such as Oracle are blocked by Cloudflare).
    res.json({
      streams: [],
      imdbId: imdbId || null,
      error: "No direct streams available for this title",
    });
  }
});

