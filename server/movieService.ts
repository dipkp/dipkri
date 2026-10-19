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

const PRESEEDED_IMDB: Record<string, string> = {
  // Common TV shows
  "breaking bad": "tt0903747",
  "better call saul": "tt3032476",
  "stranger things": "tt4574334",
  "game of thrones": "tt0944947",
  "peaky blinders": "tt2442560",
  "the simpsons": "tt0096697",
  "link click": "tt14976292",
  "arcane": "tt11126994",
  "rick and morty": "tt2861424",
  "the last of us": "tt3581920",
  "the boys": "tt1190634",
  "house of the dragon": "tt11198330",
  "sherlock": "tt1475582",
  "dark": "tt5753856",
  "friends": "tt0108778",
  "the office": "tt0386676",
  "chernobyl": "tt8462634",
  "fargo": "tt2802850",
  "true detective": "tt2356777",
  "dexter": "tt0773262",
  "suits": "tt1632701",
  "prison break": "tt0455275",
  "money heist": "tt6468322",
  "squid game": "tt10919420",
  "narcos": "tt2707408",
  "the walking dead": "tt1520211",
  "vikings": "tt2306299",
  "loki": "tt9140554",
  "the mandalorian": "tt8111088",
  "wednesday": "tt13443470",
  "fallout": "tt12637874",
  "tulsa king": "tt16358384",
  "bleach": "tt0434665",
  "one piece": "tt0388629",
  "attack on titan": "tt2560140",
  "death note": "tt0877057",
  "jujutsu kaisen": "tt12343534",
  "demon slayer": "tt9335498",
  "naruto": "tt0409591",
  "dragon ball z": "tt0214341",
  // Common Movies
  "fight club": "tt0137523",
  "interstellar": "tt0816692",
  "inception": "tt1375666",
  "the dark knight": "tt0468569",
  "pulp fiction": "tt0110912",
  "the matrix": "tt0133093",
  "avatar": "tt0499549",
  "gladiator": "tt0172495",
  "oppenheimer": "tt15398776",
  "barbie": "tt1517268",
  "dune": "tt1160419",
  "dune: part two": "tt15239678",
  "spider-man": "tt0145487",
  "spider-man: no way home": "tt10872600",
  "the godfather": "tt0068646",
  "the shawshank redemption": "tt0111161",
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const imdbIdMap = new Map<string, string>();

export async function resolveImdbId(
  rawTitle: string,
  type: "movie" | "tv",
  tmdbId?: string,
  providedImdbId?: string
): Promise<string> {
  if (providedImdbId && providedImdbId.startsWith("tt") && providedImdbId.length >= 7) {
    return providedImdbId;
  }

  const cleanTitle = (rawTitle || "").trim().toLowerCase();
  if (tmdbId && imdbIdMap.has(String(tmdbId))) {
    return imdbIdMap.get(String(tmdbId))!;
  }
  if (cleanTitle && PRESEEDED_IMDB[cleanTitle]) {
    const id = PRESEEDED_IMDB[cleanTitle];
    if (tmdbId) imdbIdMap.set(String(tmdbId), id);
    imdbIdMap.set(cleanTitle, id);
    return id;
  }
  if (cleanTitle && imdbIdMap.has(cleanTitle)) {
    return imdbIdMap.get(cleanTitle)!;
  }

  // Tier 1: Fast official IMDb suggestion CDN (200ms latency, zero API keys)
  if (cleanTitle) {
    try {
      const q = cleanTitle.replace(/[^a-z0-9]/g, "_");
      const letter = q[0] || "a";
      const url = `https://v3.sg.media-imdb.com/suggestion/${letter}/${encodeURIComponent(q)}.json`;
      const r = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 4000,
      });
      const items = r.data?.d || [];
      const match =
        items.find(
          (i: any) =>
            i.id?.startsWith("tt") &&
            (type === "tv" ? i.q?.includes("TV") || i.y : true)
        ) || items.find((i: any) => i.id?.startsWith("tt"));
      if (match?.id) {
        imdbIdMap.set(cleanTitle, match.id);
        if (tmdbId) imdbIdMap.set(String(tmdbId), match.id);
        return match.id;
      }
    } catch {}
  }

  // Tier 2: Stremio Cinemeta public catalog search (zero API keys)
  if (cleanTitle) {
    try {
      const cType = type === "tv" ? "series" : "movie";
      const url = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(rawTitle)}.json`;
      const r = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 4500 });
      const metas = r.data?.metas || [];
      const match =
        metas.find((m: any) => m.name.toLowerCase() === cleanTitle) ||
        metas[0];
      if (match?.id && match.id.startsWith("tt")) {
        imdbIdMap.set(cleanTitle, match.id);
        if (tmdbId) imdbIdMap.set(String(tmdbId), match.id);
        return match.id;
      }
    } catch {}
  }

  // Tier 3: TMDB external_ids API
  if (tmdbId) {
    try {
      const apiKey = config.TMDB_API_KEY;
      const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${apiKey}&append_to_response=external_ids`;
      const response = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 4000 });
      const found =
        response.data?.external_ids?.imdb_id || response.data?.imdb_id;
      if (found && typeof found === "string" && found.startsWith("tt")) {
        imdbIdMap.set(cleanTitle, found);
        imdbIdMap.set(String(tmdbId), found);
        return found;
      }
    } catch {}
  }

  return "";
}

/**
 * GET /api/movies/trending
 * Returns trending movies and TV series
 */
movieRouter.get("/trending", async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const cacheKey = `trending:${page}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const apiKey = config.TMDB_API_KEY;
    const url = `${TMDB_BASE_URL}/trending/all/day?api_key=${apiKey}&page=${page}`;
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
    const resolvedImdb = await resolveImdbId(
      base.title,
      type,
      id,
      data.external_ids?.imdb_id || data.imdb_id || undefined
    );

    const details = {
      ...base,
      genres: (data.genres || []).map((g: any) => g.name),
      tagline: data.tagline || "",
      runtime: data.runtime || (data.episode_run_time ? data.episode_run_time[0] : 0),
      status: data.status || "",
      imdbId: resolvedImdb || null,
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

    // If TV show has no seasons listed, provide default Season 1
    if (type === "tv" && details.seasons.length === 0) {
      details.seasons.push({
        id: 1,
        seasonNumber: 1,
        name: "Season 1",
        episodeCount: details.numberOfEpisodes || 10,
        poster: details.poster,
        airDate: "",
      });
    }

    setCached(cacheKey, details);
    res.json(details);
  } catch (error: any) {
    console.error("[MovieService] Details error:", error?.message || error);
    const resolvedImdb = await resolveImdbId("", type, id);
    const fallbackDetails = {
      id: Number(id) || 0,
      title: "Title",
      originalTitle: "Title",
      overview: "Select a stream to begin watching.",
      poster: null,
      backdrop: null,
      type,
      year: new Date().getFullYear().toString(),
      releaseDate: "",
      rating: 8.0,
      voteCount: 100,
      popularity: 100,
      genres: ["Action", "Drama"],
      tagline: "",
      runtime: 45,
      status: "Released",
      imdbId: resolvedImdb || null,
      numberOfSeasons: 1,
      numberOfEpisodes: 10,
      seasons: [
        {
          id: 1,
          seasonNumber: 1,
          name: "Season 1",
          episodeCount: 10,
          poster: null,
          airDate: "",
        },
      ],
    };
    res.json(fallbackDetails);
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
    let cinemetaEpisodes: any[] = [];
    try {
      const imdbId = await resolveImdbId("", "tv", id);
      if (imdbId) {
        const cRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, { timeout: 4000 });
        const videos = cRes.data?.meta?.videos || [];
        const seasonVids = videos.filter((v: any) => v.season === seasonNumber);
        if (seasonVids.length > 0) {
          cinemetaEpisodes = seasonVids.map((v: any, idx: number) => ({
            id: idx + 1,
            episodeNumber: v.episode || idx + 1,
            seasonNumber,
            name: v.name || v.title || `Episode ${v.episode || idx + 1}`,
            overview: v.overview || "",
            still: v.thumbnail || null,
            airDate: v.released || "",
            rating: 8.0,
          }));
        }
      }
    } catch {}

    const episodes = cinemetaEpisodes.length > 0 ? cinemetaEpisodes : Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      episodeNumber: i + 1,
      seasonNumber,
      name: `Episode ${i + 1}`,
      overview: `Episode ${i + 1} of Season ${seasonNumber}`,
      still: null,
      airDate: "",
      rating: 8.0,
    }));

    const payload = {
      seasonNumber,
      name: `Season ${seasonNumber}`,
      episodes,
    };
    setCached(cacheKey, payload);
    res.json(payload);
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

  // Always resolve IMDb ID using multi-tier fallback (Preseeded -> IMDb Suggest CDN -> Cinemeta -> TMDB)
  imdbId = await resolveImdbId(rawTitle, type, tmdbId, imdbId);

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

    const response = await axios.get(stremioEndpoint, {
      headers: BROWSER_HEADERS,
      timeout: 12000,
    });
    const rawStreams = response.data?.streams || [];

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
    res.json({ streams: [], error: "No direct streams available for this title" });
  }
});

