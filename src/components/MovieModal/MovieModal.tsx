import React, { useState, useEffect, useRef } from "react";
import styles from "./MovieModal.module.css";
import {
  type MovieSearchResult,
  type MovieDetails,
  type MovieSeasonEpisode,
  type MovieServer,
  type MovieDirectStream,
  createMovieProtocolUrl,
  buildMovieEmbedUrl,
} from "../../utils/utils";
import { Loader } from "@mantine/core";
import firebase from "firebase/compat/app";
import { canStreamTorrents } from "../../utils/streamAuth";
import {
  tmdbDetails,
  tmdbSearch,
  tmdbSeason,
  tmdbTrending,
  tmdbFallbackAvailable,
} from "../../utils/tmdbClient";

interface MovieModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlay: (movieUrl: string) => void;
  onQueue: (movieUrl: string) => void;
  onOpenVBrowser?: (url: string) => void;
}

const SERVER_OPTIONS: Array<{ id: MovieServer; name: string; tag: string }> = [
  { id: "vidlink", name: "VidLink HD", tag: "Primary • Fast CDN • Auto Subs • Sync" },
  { id: "vidsrc_pm", name: "VidSrc PM", tag: "Reliable Mirror • Multiple Streams" },
  { id: "twoembed", name: "2Embed Multi", tag: "Direct Stream Mirror" },
  { id: "apiplayer", name: "APIPlayer", tag: "Global Mirror" },
];

// TMDB matches titles literally, so "begins batman" returns nothing. These
// helpers fire a few word-order / stopword variants and merge the hits.
const SEARCH_STOPWORDS = new Set([
  "the", "a", "an", "movie", "film", "full", "hd", "hindi", "dubbed",
  "subbed", "part", "series", "watch", "online",
]);

const normalizeForSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchVariants = (raw: string): string[] => {
  const base = raw.trim();
  const words = normalizeForSearch(raw).split(" ").filter(Boolean);
  const core = words.filter((w) => !SEARCH_STOPWORDS.has(w));
  const variants = new Set<string>();

  if (base) variants.add(base);
  if (words.length > 1) variants.add([...words].reverse().join(" "));
  if (core.length > 0 && core.join(" ") !== normalizeForSearch(base)) {
    variants.add(core.join(" "));
  }
  if (core.length > 1) {
    variants.add(`${core[core.length - 1]} ${core[0]}`);
    variants.add(core.slice(0, 2).join(" "));
  }

  return [...variants].filter(Boolean).slice(0, 4);
};

const searchRelevance = (title: string, query: string): number => {
  const hay = normalizeForSearch(title);
  const tokens = normalizeForSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.filter((token) => hay.includes(token)).length / tokens.length;
};

export const MovieModal: React.FC<MovieModalProps> = ({
  isOpen,
  onClose,
  onPlay,
  onQueue,
  onOpenVBrowser,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"trending" | "movie" | "tv">("trending");
  const [items, setItems] = useState<MovieSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Detail View State
  const [selectedMedia, setSelectedMedia] = useState<MovieDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"direct" | "web_mirror">("direct");
  const [directStreams, setDirectStreams] = useState<MovieDirectStream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [selectedStreamIndex, setSelectedStreamIndex] = useState(0);
  const [audioFilter, setAudioFilter] = useState<
    "sub" | "dub" | "dual" | "hindi"
  >("sub");
  // Quality filter: "auto" keeps the current best pick, otherwise the user pins
  // a resolution and we auto-select that tier's best-seeded stream.
  const [qualityFilter, setQualityFilter] = useState<string>("auto");
  const [detailsError, setDetailsError] = useState("");
  const lastSelectedRef = useRef<MovieSearchResult | null>(null);

  const [selectedServer, setSelectedServer] = useState<MovieServer>("vidlink");
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [episodes, setEpisodes] = useState<MovieSeasonEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const searchDebounceRef = useRef<any>(null);
  const prewarmedRef = useRef<Set<string>>(new Set());

  // Start fetching torrent metadata the moment a stream is highlighted, so the
  // player does not spend its first minute waiting for peers.
  const prewarmStream = (magnet: string) => {
    if (!magnet || prewarmedRef.current.has(magnet)) return;
    if (!canStreamTorrents(firebase.auth().currentUser?.email)) return;
    prewarmedRef.current.add(magnet);
    const url = `/stream?torrent=${encodeURIComponent(magnet)}`;
    // Metadata
    fetch(`/data?torrent=${encodeURIComponent(magnet)}`).catch(() => {});
    // Head: first megabyte for the container + first frames.
    fetch(url, { headers: { Range: "bytes=0-1048575" } })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
    // Tail: MP4 keeps its moov atom at the end, so the browser asks for it
    // before it can even know the duration. Warm it too.
    fetch(url, { headers: { Range: "bytes=-1048576" } })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  };

  // 2160p / 4K / 1080p / 720p / 480p all collapse into one comparable label.
  const qualityTier = (q?: string): string => {
    const t = (q || "").toUpperCase();
    if (t.includes("2160") || t.includes("4K")) return "4K";
    if (t.includes("1080")) return "1080p";
    if (t.includes("720")) return "720p";
    if (t.includes("480")) return "480p";
    return "HD";
  };

  const QUALITY_TIERS = ["4K", "1080p", "720p", "480p", "HD"] as const;

  const availableQualities = QUALITY_TIERS.map((tier) => ({
    tier,
    count: directStreams.filter((s) => qualityTier(s.quality) === tier).length,
  })).filter((q) => q.count > 0);

  const passesFilters = (s: MovieDirectStream) => {
    if (qualityFilter !== "auto" && qualityTier(s.quality) !== qualityFilter) {
      return false;
    }
    const t = (s.cleanTitle || "").toLowerCase();
    if (audioFilter === "hindi") {
      return /\bhindi\b|\bhin\b|hindi[\s._-]*dubbed/.test(t);
    }
    if (audioFilter === "sub") return true;
    const dual = /dual[\s._-]*audio|multi[\s._-]*audio/.test(t);
    const dub = /\bdub(bed)?\b|english[\s._-]*audio/.test(t);
    return audioFilter === "dual" ? dual : dub || dual;
  };

  const visibleStreamCount = directStreams.filter(passesFilters).length;

  // Pin a resolution and highlight that tier's best-seeded stream right away,
  // so pressing Play uses exactly what the user just picked.
  const applyQualityFilter = (tier: string) => {
    setQualityFilter(tier);
    if (tier === "auto") return;
    const candidates = directStreams
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => qualityTier(s.quality) === tier)
      .sort((a, b) => (b.s.seeders || 0) - (a.s.seeders || 0));
    if (candidates.length === 0) return;
    setSelectedStreamIndex(candidates[0].idx);
    prewarmStream(candidates[0].s.magnet);
  };

  useEffect(() => {
    if (isOpen) {
      if (items.length === 0 && !searchQuery) {
        fetchTrending();
      }
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          if (selectedMedia) {
            setSelectedMedia(null);
            setIsPreviewing(false);
          } else {
            onClose();
          }
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, selectedMedia]);

  const fetchTrending = async (type: "trending" | "movie" | "tv" = "trending") => {
    setLoading(true);
    const scope: "all" | "movie" | "tv" = type === "trending" ? "all" : type;

    try {
      const res = await fetch(`/api/movies/trending?type=${scope}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.results || []);
        setLoading(false);
        return;
      }
      throw new Error(`trending HTTP ${res.status}`);
    } catch (e) {
      console.warn("Trending via server failed, trying browser TMDB:", e);
    }

    try {
      if (!tmdbFallbackAvailable) {
        setItems([]);
        return;
      }
      const data = await tmdbTrending(scope);
      setItems(data.results || []);
    } catch (e) {
      console.error("Failed to load trending:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!val.trim()) {
      if (filterType === "trending") {
        fetchTrending();
      } else {
        setItems([]);
      }
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      executeSearch(val.trim(), filterType === "trending" ? "all" : filterType);
    }, 400);
  };

  const executeSearch = async (query: string, type: "all" | "movie" | "tv") => {
    setLoading(true);
    try {
      const variants = buildSearchVariants(query);
      const batches = await Promise.all(
        variants.map(async (variant) => {
          try {
            const res = await fetch(
              `/api/movies/search?q=${encodeURIComponent(variant)}&type=${type}`,
            );
            if (!res.ok) return [] as MovieSearchResult[];
            const data = await res.json();
            return (data.results || []) as MovieSearchResult[];
          } catch {
            return [] as MovieSearchResult[];
          }
        }),
      );

      const merged = new Map<string, MovieSearchResult>();
      batches.flat().forEach((item) => {
        merged.set(`${item.type}-${item.id}`, item);
      });

      const ranked = [...merged.values()]
        .map((item) => ({ item, score: searchRelevance(item.title, query) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.item.voteCount || 0) - (a.item.voteCount || 0),
        )
        .map(({ item }) => item);

      if (ranked.length === 0 && tmdbFallbackAvailable) {
        const fallbacks = await Promise.all(
          variants.map(async (variant) => {
            try {
              const data = await tmdbSearch(variant, type);
              return data.results || [];
            } catch {
              return [] as MovieSearchResult[];
            }
          }),
        );

        const fb = new Map<string, MovieSearchResult>();
        fallbacks.flat().forEach((item) => {
          fb.set(`${item.type}-${item.id}`, item);
        });

        setItems(
          [...fb.values()]
            .map((item) => ({ item, score: searchRelevance(item.title, query) }))
            .sort(
              (a, b) =>
                b.score - a.score ||
                (b.item.voteCount || 0) - (a.item.voteCount || 0),
            )
            .map(({ item }) => item),
        );
        return;
      }

      setItems(ranked);
    } catch (e) {
      console.error("Search failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (type: "trending" | "movie" | "tv") => {
    setFilterType(type);
    if (type === "trending") {
      setSearchQuery("");
      fetchTrending("trending");
      return;
    }
    if (searchQuery.trim()) {
      executeSearch(searchQuery.trim(), type);
    } else {
      // No active search: load that category's trending list instead of leaving
      // the previous tab's results on screen.
      fetchTrending(type);
    }
  };

  const fetchDirectStreams = async (media: MovieDetails, season = 1, episode = 1) => {
    setLoadingStreams(true);
    setQualityFilter("auto");

    try {
      let streams: MovieDirectStream[] = [];
      let imdbForFallback = media.imdbId;

      // Try the existing backend first.
      try {
        const params = new URLSearchParams({
          tmdbId: String(media.id),
          type: media.type,
          title: media.title,
        });

        if (media.imdbId) params.set("imdbId", media.imdbId);

        if (media.type === "tv") {
          params.set("season", String(season));
          params.set("episode", String(episode));
        }

        const res = await fetch(`/api/movies/streams?${params}`);

        if (res.ok) {
          const data = await res.json();
          streams = data.streams || [];
          if (!imdbForFallback && data.imdbId) imdbForFallback = data.imdbId;
        }
      } catch (error) {
        console.warn("Backend stream lookup failed:", error);
      }

      // Browser fallback if the backend returns no streams.
      if (streams.length === 0 && imdbForFallback) {
        const endpoint =
          media.type === "tv"
            ? `https://torrentio.strem.fun/stream/series/${imdbForFallback}:${season}:${episode}.json`
            : `https://torrentio.strem.fun/stream/movie/${imdbForFallback}.json`;

        const res = await fetch(endpoint);

        if (!res.ok) {
          throw new Error(`Torrentio HTTP ${res.status}`);
        }

        const data = await res.json();

        streams = (data.streams || [])
          .map((s: any, idx: number): MovieDirectStream | null => {
            if (!s.infoHash) return null;

            const combined = `${s.name || ""} ${s.title || ""}`;
            const seederMatch = (s.title || "").match(/👤\s*(\d+)/);
            const sizeMatch = (s.title || "").match(/💾\s*([\d.]+\s*[GM]B)/i);
            const qualityMatch = combined.match(/(2160p|4k|1080p|720p|480p)/i);

            const quality = qualityMatch
              ? qualityMatch[1].toUpperCase()
              : "HD";
            const seeders = seederMatch ? Number(seederMatch[1]) : 0;
            const size = sizeMatch ? sizeMatch[1] : "";

            let codec = "";
            if (/x265|hevc/i.test(combined)) codec = "HEVC";
            else if (/x264|h264|avc/i.test(combined)) codec = "x264";

            const lines = (s.title || "")
              .split("\n")
              .map((line: string) => line.trim())
              .filter(Boolean);

            const cleanTitle =
              s.behaviorHints?.filename ||
              lines.find((line: string) =>
                !line.includes("👤") && !line.includes("💾")
              ) ||
              media.title;

            const magnetParams = new URLSearchParams({
              xt: `urn:btih:${s.infoHash}`,
              dn: `${media.title} ${quality}`,
              isMovie: "1",
            });

            if (media.type === "tv") {
              magnetParams.set("season", String(season));
              magnetParams.set("episode", String(episode));
            }

            if (s.fileIdx != null) {
              magnetParams.set("fileIndex", String(s.fileIdx));
            }

            (s.sources || [])
              .filter((src: string) => typeof src === "string" && src.startsWith("tracker:"))
              .forEach((src: string) => magnetParams.append("tr", src.slice(8)));

            return {
              id: idx,
              label: `${quality}${codec ? ` ${codec}` : ""}${size ? ` • ${size}` : ""}${seeders ? ` (${seeders} seeders)` : ""}`,
              quality,
              codec,
              seeders,
              size,
              cleanTitle,
              infoHash: s.infoHash,
              fileIdx: s.fileIdx,
              magnet: `magnet:?${magnetParams.toString()}`,
            };
          })
          .filter((s: MovieDirectStream | null): s is MovieDirectStream => s !== null);

        console.info("Browser Torrentio streams:", streams.length);
      }

      setDirectStreams(streams);

      if (streams.length > 0) {
        const playable = streams.filter(
          (s) => (s.codec || "").toUpperCase() !== "HEVC",
        );
        const pool = playable.length > 0 ? playable : streams;
        const preferred =
          pool.find((s) => s.quality === "1080P" && s.seeders > 10) || pool[0];

        const bestIdx = streams.indexOf(preferred);
        setSelectedStreamIndex(bestIdx !== -1 ? bestIdx : 0);
        setPlaybackMode("direct");
      } else {
        console.warn("No direct streams found:", media.title);
      }
    } catch (error) {
      console.warn("Failed to fetch direct streams:", error);
      setDirectStreams([]);
    } finally {
      setLoadingStreams(false);
    }
  };

  const selectMediaItem = async (item: MovieSearchResult) => {
    setLoadingDetails(true);
    setDetailsError("");
    lastSelectedRef.current = item;
    setSelectedMedia(null);
    setIsPreviewing(false);
    setDirectStreams([]);
    try {
      let details: MovieDetails | null = null;

      try {
        // One retry: the VM<->TMDB link resets often, and a second attempt
        // costs nothing next to showing an empty screen.
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const res = await fetch(
            `/api/movies/details?id=${item.id}&type=${item.type}`,
          );
          if (res.ok) {
            details = await res.json();
            break;
          }
          if (attempt === 2) throw new Error(`details HTTP ${res.status}`);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } catch (serverError) {
        console.warn("Details via server failed, trying browser TMDB:", serverError);
        if (tmdbFallbackAvailable) {
          details = await tmdbDetails(item.id, item.type);
        }
      }

      if (!details) {
        setDetailsError(
          `Couldn't load "${item.title}". Tap Retry — if it keeps failing, the server can't reach TMDB right now.`,
        );
        return;
      }

      setSelectedMedia(details);
      if (details.type === "tv" && details.seasons && details.seasons.length > 0) {
        const firstSeasonNum = details.seasons[0].seasonNumber || 1;
        setSelectedSeason(firstSeasonNum);
        setSelectedEpisode(1);
        fetchSeasonEpisodes(details.id, firstSeasonNum);
        fetchDirectStreams(details, firstSeasonNum, 1);
      } else {
        fetchDirectStreams(details);
      }
    } catch (e) {
      console.error("Failed to load details:", e);
    } finally {
      setLoadingDetails(false);
    }
  };

  const fetchSeasonEpisodes = async (id: number, seasonNum: number) => {
    setLoadingEpisodes(true);
    try {
      const res = await fetch(`/api/movies/season?id=${id}&season=${seasonNum}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes || []);
        return;
      }
      throw new Error(`season HTTP ${res.status}`);
    } catch (e) {
      console.warn("Season via server failed, trying browser TMDB:", e);
      if (tmdbFallbackAvailable) {
        try {
          const data = await tmdbSeason(id, seasonNum);
          setEpisodes(data.episodes || []);
        } catch (fallbackError) {
          console.error("Failed to load season:", fallbackError);
        }
      }
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handleSeasonSelect = (seasonNum: number) => {
    setSelectedSeason(seasonNum);
    setSelectedEpisode(1);
    if (selectedMedia) {
      fetchSeasonEpisodes(selectedMedia.id, seasonNum);
      fetchDirectStreams(selectedMedia, seasonNum, 1);
    }
  };

  const handleSelectEpisode = (episodeNum: number) => {
    setSelectedEpisode(episodeNum);
    if (selectedMedia) {
      fetchDirectStreams(selectedMedia, selectedSeason, episodeNum);
    }
  };

  const handlePlaySelectedStream = (streamIdx?: number) => {
    if (!selectedMedia) return;
    const targetIdx = typeof streamIdx === "number" ? streamIdx : selectedStreamIndex;
    const stream = directStreams[targetIdx] || directStreams[0];
    if (stream && stream.magnet) {
      onPlay(stream.magnet);
      onClose();
    }
  };

  const handlePlayMedia = (season = selectedSeason, episode = selectedEpisode) => {
    if (!selectedMedia) return;

    if (playbackMode === "direct") {
      if (directStreams.length > 0) {
        const stream = directStreams[selectedStreamIndex] || directStreams[0];
        if (stream && stream.magnet) {
          onPlay(stream.magnet);
          onClose();
          return;
        }
      }
      alert("No direct streams available right now for this title.");
      return;
    }

    // Web embed mirror fallback - ONLY when explicitly in web_mirror mode!
    const protocolUrl = createMovieProtocolUrl({
      tmdbId: String(selectedMedia.id),
      type: selectedMedia.type,
      title: selectedMedia.title,
      season: selectedMedia.type === "tv" ? season : undefined,
      episode: selectedMedia.type === "tv" ? episode : undefined,
      server: selectedServer,
    });
    onPlay(protocolUrl);
    onClose();
  };

  const handleQueueMedia = (season = selectedSeason, episode = selectedEpisode) => {
    if (!selectedMedia) return;

    if (playbackMode === "direct") {
      if (directStreams.length > 0) {
        const stream = directStreams[selectedStreamIndex] || directStreams[0];
        if (stream && stream.magnet) {
          onQueue(stream.magnet);
          return;
        }
      }
    }

    const protocolUrl = createMovieProtocolUrl({
      tmdbId: String(selectedMedia.id),
      type: selectedMedia.type,
      title: selectedMedia.title,
      season: selectedMedia.type === "tv" ? season : undefined,
      episode: selectedMedia.type === "tv" ? episode : undefined,
      server: selectedServer,
    });
    onQueue(protocolUrl);
  };

  const handlePlayEpisode = async (seasonNum: number, episodeNum: number) => {
    if (!selectedMedia) return;
    setSelectedSeason(seasonNum);
    setSelectedEpisode(episodeNum);

    if (playbackMode === "direct") {
      // If directStreams are already loaded for this episode:
      if (seasonNum === selectedSeason && episodeNum === selectedEpisode && directStreams.length > 0) {
        const stream = directStreams[selectedStreamIndex] || directStreams[0];
        if (stream && stream.magnet) {
          onPlay(stream.magnet);
          onClose();
          return;
        }
      }

      setLoadingStreams(true);
      try {
        const imdbParam = selectedMedia.imdbId ? `&imdbId=${selectedMedia.imdbId}` : "";
        const tmdbParam = `&tmdbId=${selectedMedia.id}`;
        const typeParam = `&type=tv`;
        const seasonParam = `&season=${seasonNum}&episode=${episodeNum}`;
        const titleParam = `&title=${encodeURIComponent(selectedMedia.title)}`;

        const res = await fetch(
          `/api/movies/streams?${imdbParam}${tmdbParam}${typeParam}${seasonParam}${titleParam}`
        );
        if (res.ok) {
          const data = await res.json();
          const streams: MovieDirectStream[] = data.streams || [];
          setDirectStreams(streams);
          if (streams.length > 0) {
            setSelectedStreamIndex(0);
            onPlay(streams[0].magnet);
            onClose();
            return;
          } else {
            alert(`No direct streams found for Season ${seasonNum} Episode ${episodeNum}.`);
            return;
          }
        }
      } catch (e) {
        console.warn("Direct episode stream error:", e);
        alert("Failed to load direct stream. Please try again.");
        return;
      } finally {
        setLoadingStreams(false);
      }
      return;
    }

    // ONLY when user is in web_mirror mode:
    handlePlayMedia(seasonNum, episodeNum);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerLogoIcon}>🎬</div>
            <div>
              <h2 className={styles.modalTitle}>Movies & Web Series</h2>
              <p className={styles.modalSubtitle}>
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Search & Tabs (Visible when no item selected) */}
        {!selectedMedia && (
          <div className={styles.searchBarWrapper}>
            <div className={styles.searchInputRow}>
              <span className={styles.searchIcon}>🔍</span>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search any movie, TV series, anime by title..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={() => handleSearchChange("")}
                >
                  ✕
                </button>
              )}
            </div>

            <div className={styles.filterTabs}>
              <button
                type="button"
                className={`${styles.filterChip} ${filterType === "trending" ? styles.filterChipActive : ""}`}
                onClick={() => handleFilterChange("trending")}
              >
                🔥 Trending Now
              </button>
              <button
                type="button"
                className={`${styles.filterChip} ${filterType === "movie" ? styles.filterChipActive : ""}`}
                onClick={() => handleFilterChange("movie")}
              >
                🎬 Movies
              </button>
              <button
                type="button"
                className={`${styles.filterChip} ${filterType === "tv" ? styles.filterChipActive : ""}`}
                onClick={() => handleFilterChange("tv")}
              >
                📺 TV & Web Series
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className={styles.modalBody}>
          {loading || loadingDetails ? (
            <div className={styles.loadingSpinner}>
              <Loader size="md" color="indigo" />
              <span>Fetching media library...</span>
            </div>
          ) : selectedMedia ? (
            /* Selected Detail & Stream View */
            <div className={styles.detailView}>
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => {
                  setSelectedMedia(null);
                  setIsPreviewing(false);
                  setDirectStreams([]);
                }}
              >
                ← Back to catalog
              </button>

              <div className={styles.detailHero}>
                {selectedMedia.backdrop && (
                  <div
                    className={styles.detailBackdrop}
                    style={{ backgroundImage: `url(${selectedMedia.backdrop})` }}
                  />
                )}
                {selectedMedia.poster ? (
                  <img
                    src={selectedMedia.poster}
                    alt={selectedMedia.title}
                    className={styles.detailPoster}
                  />
                ) : (
                  <div className={styles.detailPoster} style={{ background: "#111" }} />
                )}

                <div className={styles.detailInfo}>
                  <h3 className={styles.detailTitle}>{selectedMedia.title}</h3>
                  {selectedMedia.tagline && (
                    <p className={styles.detailTagline}>"{selectedMedia.tagline}"</p>
                  )}

                  <div className={styles.metaRow}>
                    <span
                      className={`${styles.typeBadge} ${selectedMedia.type === "movie" ? styles.typeMovie : styles.typeTv}`}
                      style={{ position: "static" }}
                    >
                      {selectedMedia.type.toUpperCase()}
                    </span>
                    {selectedMedia.year && <span>📅 {selectedMedia.year}</span>}
                    {selectedMedia.rating > 0 && <span>⭐ {selectedMedia.rating} / 10</span>}
                    {selectedMedia.runtime ? (
                      <span>⏱️ {selectedMedia.runtime} min</span>
                    ) : selectedMedia.numberOfSeasons ? (
                      <span>📺 {selectedMedia.numberOfSeasons} Seasons</span>
                    ) : null}
                  </div>

                  {selectedMedia.genres && selectedMedia.genres.length > 0 && (
                    <div className={styles.metaRow}>
                      {selectedMedia.genres.map((g) => (
                        <span key={g} className={styles.genreChip}>
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className={styles.overviewText}>
                    {selectedMedia.overview || "No overview available for this title."}
                  </p>
                </div>
              </div>

              {/* TV Series: Season selector & Episode list (Select episode first) */}
              {selectedMedia.type === "tv" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14, marginBottom: 8 }}>
                  <div className={styles.serverSection}>
                    <h4 className={styles.sectionHeading}>
                      <span>📺 1. Select Season</span>
                    </h4>
                    <div className={styles.seasonSelector}>
                      {(selectedMedia.seasons || []).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`${styles.seasonPill} ${selectedSeason === s.seasonNumber ? styles.seasonPillActive : ""}`}
                          onClick={() => handleSeasonSelect(s.seasonNumber)}
                        >
                          {s.name} ({s.episodeCount} eps)
                        </button>
                      ))}
                    </div>
                  </div>

                  <h4 className={styles.sectionHeading} style={{ marginTop: 4 }}>
                    <span>📺 2. Select Episode (Active: Season {selectedSeason} • Episode {selectedEpisode})</span>
                  </h4>

                  {loadingEpisodes ? (
                    <div className={styles.loadingSpinner}>
                      <Loader size="sm" color="indigo" />
                      <span>Loading episodes...</span>
                    </div>
                  ) : (
                    <div className={styles.episodeGrid}>
                      {episodes.map((ep) => (
                        <div
                          key={ep.id}
                          className={`${styles.episodeCard} ${selectedEpisode === ep.episodeNumber ? styles.streamCardActive : ""}`}
                          onClick={() => handleSelectEpisode(ep.episodeNumber)}
                          style={{ cursor: "pointer" }}
                        >
                          <div className={styles.episodeLeft}>
                            {ep.still ? (
                              <img
                                src={ep.still}
                                alt={ep.name}
                                className={styles.episodeThumb}
                              />
                            ) : (
                              <div className={styles.episodeThumb} />
                            )}
                            <div className={styles.episodeInfo}>
                              <span className={styles.episodeNumber}>
                                Season {selectedSeason} • Episode {ep.episodeNumber}
                                {selectedEpisode === ep.episodeNumber ? " (Selected)" : ""}
                              </span>
                              <h5 className={styles.episodeName}>{ep.name}</h5>
                              <p className={styles.episodeOverview}>
                                {ep.overview || "No episode synopsis."}
                              </p>
                            </div>
                          </div>
                          <div className={styles.episodeActions}>
                            <button
                              type="button"
                              className={styles.episodePlayBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayEpisode(selectedSeason, ep.episodeNumber);
                              }}
                              title="Play this episode directly in room"
                            >
                              ▶ Play
                            </button>
                            <button
                              type="button"
                              className={styles.episodeQueueBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQueueMedia(selectedSeason, ep.episodeNumber);
                              }}
                              title="Add to queue"
                            >
                              + Queue
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DIRECT NATIVE PLAYER MODE */}
              {playbackMode === "direct" && (
                <div className={styles.serverSection}>
                  {availableQualities.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        margin: "4px 0 8px",
                        flexWrap: "wrap",
                      }}
                    >
                      {[
                        { tier: "auto", count: directStreams.length },
                        ...availableQualities,
                      ].map(({ tier, count }) => {
                        const active = qualityFilter === tier;
                        return (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => applyQualityFilter(tier)}
                            style={{
                              minHeight: 32,
                              minWidth: 44,
                              padding: "4px 12px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              border: active
                                ? "1px solid #06b6d4"
                                : "1px solid rgba(255,255,255,0.12)",
                              background: active
                                ? "rgba(6,182,212,0.25)"
                                : "rgba(255,255,255,0.04)",
                              color: active ? "#fff" : "#94a3b8",
                            }}
                            title={
                              tier === "auto"
                                ? "Let dipkri pick the best stream"
                                : `Show only ${tier} streams`
                            }
                          >
                            {tier === "auto" ? "Auto" : tier} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      margin: "4px 0 8px",
                      flexWrap: "wrap",
                    }}
                  >
                    {(["sub", "dub", "dual", "hindi"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAudioFilter(mode)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          border:
                            audioFilter === mode
                              ? "1px solid #6366f1"
                              : "1px solid rgba(255,255,255,0.12)",
                          background:
                            audioFilter === mode
                              ? "rgba(99,102,241,0.25)"
                              : "rgba(255,255,255,0.04)",
                          color: audioFilter === mode ? "#fff" : "#94a3b8",
                        }}
                      >
                        {mode === "sub"
                          ? "Subbed"
                          : mode === "dub"
                            ? "Dubbed"
                            : mode === "hindi"
                              ? "Hindi"
                              : "Dual Audio"}
                      </button>
                    ))}
                  </div>

                  <h4 className={styles.sectionHeading}>
                    <span>
                      ⚡ Available HD Streams ({visibleStreamCount})
                      {selectedMedia.type === "tv" ? ` — Season ${selectedSeason} Episode ${selectedEpisode}` : ""}
                    </span>
                  </h4>

                  {loadingStreams ? (
                    <div className={styles.loadingSpinner} style={{ padding: "30px 0" }}>
                      <Loader size="sm" color="indigo" />
                      <span>Loading streams…</span>
                    </div>
                  ) : directStreams.length > 0 ? (
                    <>
                      <div className={styles.streamListGrid}>
                        {directStreams
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => passesFilters(s))
                          // Best-seeded first: a 167 B/s stream should never be
                          // the default choice.
                          .sort((a, b) => (b.s.seeders || 0) - (a.s.seeders || 0))
                          .map(({ s, idx }) => {
                          const isSelected = selectedStreamIndex === idx;
                          return (
                            <div
                              key={s.id}
                              className={`${styles.streamCard} ${isSelected ? styles.streamCardActive : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={`${s.quality} stream, ${s.seeders} seeders`}
                              onClick={() => { setSelectedStreamIndex(idx); prewarmStream(s.magnet); }}
                              onDoubleClick={() => handlePlaySelectedStream(idx)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedStreamIndex(idx);
                                }
                              }}
                            >
                              <div className={styles.streamQualityRow}>
                                <span className={styles.streamQualityBadge}>
                                  {isSelected ? "✓ " : ""}
                                  {s.quality}
                                </span>
                                {s.codec && (
                                  <span
                                    className={styles.streamCodecBadge}
                                    style={{
                                      background: s.codec === "x264" ? "rgba(16, 185, 129, 0.2)" : undefined,
                                      borderColor: s.codec === "x264" ? "#10b981" : undefined,
                                      color: s.codec === "x264" ? "#6ee7b7" : undefined,
                                    }}
                                  >
                                    {s.codec === "x264" ? "x264 (Universal)" : s.codec}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className={styles.cardPlayBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlaySelectedStream(idx);
                                  }}
                                  title="Play this stream immediately in room"
                                >
                                  ▶ Play
                                </button>
                              </div>
                              <div className={styles.streamMetaRow}>
                                <span>💾 {s.size || "Direct Stream"}</span>
                                <span className={s.seeders > 50 ? styles.streamSeedersGood : styles.streamSeedersOk}>
                                  👤 {s.seeders} seeders
                                </span>
                                {(s.codec || "").toUpperCase() === "HEVC" && (
                                  <span
                                    style={{ color: "#f87171", fontWeight: 700 }}
                                    title="Chrome/Edge cannot decode HEVC — expect a black screen"
                                  >
                                    ⚠ HEVC not playable
                                  </span>
                                )}
                                {/\b(ddp|dd\+|ac3|eac3|dts)\b/i.test(s.cleanTitle || "") && (
                                  <span
                                    style={{ color: "#fbbf24", fontWeight: 700 }}
                                    title="DTS/AC3 audio cannot be decoded by browsers — video may play silent"
                                  >
                                    ⚠ audio may be silent
                                  </span>
                                )}
                              </div>
                              <span className={styles.streamReleaseTitle} title={s.cleanTitle}>
                                {s.cleanTitle}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {visibleStreamCount === 0 && (
                        <p
                          style={{
                            fontSize: 12,
                            color: "#94a3b8",
                            margin: "10px 0 0",
                          }}
                        >
                          No streams match this quality/audio filter. Pick
                          another quality or switch back to Auto.
                        </p>
                      )}

                      {/* Primary Action Row for Selected Direct Stream */}
                      <div className={styles.actionRow} style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className={styles.playRoomBtn}
                          onClick={() => handlePlaySelectedStream()}
                        >
                          ▶ Play Selected Stream in Room
                        </button>
                        <button
                          type="button"
                          className={styles.queueBtn}
                          onClick={() => handleQueueMedia(selectedSeason, selectedEpisode)}
                        >
                          + Add to Queue
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: "16px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                      No direct peer streams currently active for this specific release.
                      <br />
                    </div>
                  )}
                </div>
              )}

            </div>
          ) : detailsError ? (
            <div
              style={{
                margin: "0 16px 12px",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(248,113,113,0.45)",
                background: "rgba(248,113,113,0.12)",
                color: "#fecaca",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ flex: "1 1 220px" }}>{detailsError}</span>
              <button
                type="button"
                onClick={() => {
                  const again = lastSelectedRef.current;
                  if (again) selectMediaItem(again);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>🎬</div>
              <h3>No titles found</h3>
            </div>
          ) : (
            /* Search Results / Trending Poster Grid */
            <div className={styles.gridContainer}>
              {items.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className={styles.mediaCard}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.title} (${item.year || item.type})`}
                  onClick={() => selectMediaItem(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectMediaItem(item);
                    }
                  }}
                >
                  <div className={styles.posterWrapper}>
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className={styles.mediaPoster}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.mediaPoster} style={{ background: "#1e293b" }} />
                    )}
                    <span
                      className={`${styles.typeBadge} ${item.type === "movie" ? styles.typeMovie : styles.typeTv}`}
                    >
                      {item.type.toUpperCase()}
                    </span>
                    {item.rating > 0 && (
                      <span className={styles.ratingBadge}>⭐ {item.rating}</span>
                    )}
                  </div>
                  <div className={styles.cardInfo}>
                    <h4 className={styles.cardTitle}>{item.title}</h4>
                    <span className={styles.cardYear}>{item.year || "Release"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

