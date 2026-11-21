import type {
  MovieDetails,
  MovieSearchResult,
  MovieSeasonEpisode,
} from "./utils";

/**
 * Browser-side TMDB fallback.
 *
 * The Oracle VM's egress to api.themoviedb.org (CloudFront) gets reset most of
 * the time, so /api/movies/* answers 500 for search, trending and details.
 * Reading TMDB straight from the viewer's browser uses their own IP instead --
 * the same trick the app already relies on for Torrentio.
 *
 * The key lives in .env.local (VITE_TMDB_KEY) and is never committed.
 */
const TMDB_KEY = (import.meta.env.VITE_TMDB_KEY as string | undefined) || "";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

export const tmdbFallbackAvailable = Boolean(TMDB_KEY);

const img = (path?: string | null, size = "w500") =>
  path ? `${IMG_BASE}/${size}${path}` : null;

async function tmdbGet(path: string, params: Record<string, string> = {}) {
  if (!TMDB_KEY) throw new Error("TMDB key not configured");

  const search = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "en-US",
    ...params,
  });
  const res = await fetch(`${TMDB_BASE}${path}?${search.toString()}`);
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

const mapResult = (d: any, type: "movie" | "tv"): MovieSearchResult => ({
  id: d.id,
  title: (type === "movie" ? d.title : d.name) || "",
  originalTitle: d.original_title || d.original_name || "",
  overview: d.overview || "",
  poster: img(d.poster_path),
  backdrop: img(d.backdrop_path, "w1280"),
  type,
  year: String(d.release_date || d.first_air_date || "").slice(0, 4),
  releaseDate: d.release_date || d.first_air_date || "",
  rating: d.vote_average || 0,
  voteCount: d.vote_count || 0,
  popularity: d.popularity || 0,
});

const byPopularity = (a: MovieSearchResult, b: MovieSearchResult) =>
  (b.popularity || 0) - (a.popularity || 0);

export async function tmdbDetails(
  id: number,
  type: "movie" | "tv",
): Promise<MovieDetails> {
  const d = await tmdbGet(`/${type}/${id}`, {
    append_to_response: "external_ids",
  });

  return {
    ...mapResult(d, type),
    genres: (d.genres || []).map((g: any) => g.name),
    tagline: d.tagline || "",
    runtime: d.runtime || (d.episode_run_time ? d.episode_run_time[0] : 0),
    status: d.status || "",
    imdbId: d.external_ids?.imdb_id || d.imdb_id || null,
    numberOfSeasons: d.number_of_seasons || (type === "tv" ? 1 : 0),
    numberOfEpisodes: d.number_of_episodes || 0,
    seasons: (d.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({
        id: s.id,
        seasonNumber: s.season_number,
        name: s.name || `Season ${s.season_number}`,
        episodeCount: s.episode_count || 0,
        poster: img(s.poster_path),
        airDate: s.air_date || "",
      })),
  };
}

export async function tmdbSeason(
  id: number,
  season: number,
): Promise<{ episodes: MovieSeasonEpisode[] }> {
  const d = await tmdbGet(`/tv/${id}/season/${season}`);

  return {
    episodes: (d.episodes || []).map((e: any) => ({
      id: e.id,
      episodeNumber: e.episode_number,
      seasonNumber: e.season_number,
      name: e.name || `Episode ${e.episode_number}`,
      overview: e.overview || "",
      still: img(e.still_path, "w300"),
      airDate: e.air_date || "",
      rating: e.vote_average || 0,
    })),
  };
}

export async function tmdbTrending(
  scope: "all" | "movie" | "tv",
): Promise<{ results: MovieSearchResult[] }> {
  if (scope === "all") {
    const [movies, shows] = await Promise.all([
      tmdbGet("/trending/movie/week"),
      tmdbGet("/trending/tv/week"),
    ]);
    const merged = [
      ...(movies.results || []).map((x: any) => mapResult(x, "movie")),
      ...(shows.results || []).map((x: any) => mapResult(x, "tv")),
    ]
      .sort(byPopularity)
      .slice(0, 20);
    return { results: merged };
  }

  const d = await tmdbGet(`/trending/${scope}/week`);
  return { results: (d.results || []).map((x: any) => mapResult(x, scope)) };
}

export async function tmdbSearch(
  query: string,
  type: "all" | "movie" | "tv",
): Promise<{ results: MovieSearchResult[] }> {
  if (type === "all") {
    const d = await tmdbGet("/search/multi", { query, include_adult: "false" });
    return {
      results: (d.results || [])
        .filter((x: any) => x.media_type === "movie" || x.media_type === "tv")
        .map((x: any) => mapResult(x, x.media_type)),
    };
  }

  const d = await tmdbGet(`/search/${type}`, { query, include_adult: "false" });
  return { results: (d.results || []).map((x: any) => mapResult(x, type)) };
}
