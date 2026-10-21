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

  const [selectedServer, setSelectedServer] = useState<MovieServer>("vidlink");
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [episodes, setEpisodes] = useState<MovieSeasonEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const searchDebounceRef = useRef<any>(null);

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
    try {
      const res = await fetch(
        `/api/movies/trending?type=${type === "trending" ? "all" : type}`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.results || []);
      }
    } catch (e) {
      console.error("Failed to load trending:", e);
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
      const res = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}&type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.results || []);
      }
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
    try {
      const imdbParam = media.imdbId ? `&imdbId=${media.imdbId}` : "";
      const tmdbParam = `&tmdbId=${media.id}`;
      const typeParam = `&type=${media.type}`;
      const seasonParam = media.type === "tv" ? `&season=${season}&episode=${episode}` : "";
      const titleParam = `&title=${encodeURIComponent(media.title)}`;

      const res = await fetch(
        `/api/movies/streams?${imdbParam}${tmdbParam}${typeParam}${seasonParam}${titleParam}`
      );
      if (res.ok) {
        const data = await res.json();
        const streams: MovieDirectStream[] = data.streams || [];
        setDirectStreams(streams);
        if (streams.length > 0) {
          // Pre-select 1080p stream with highest seeders, or first stream
          const bestIdx = streams.findIndex((s) => s.quality === "1080P" && s.seeders > 10);
          setSelectedStreamIndex(bestIdx !== -1 ? bestIdx : 0);
          setPlaybackMode("direct");
        } else {
          // No direct streams for this title
        }
      }
    } catch (e) {
      console.warn("Failed to fetch direct streams:", e);
      setDirectStreams([]);
    } finally {
      setLoadingStreams(false);
    }
  };

  const selectMediaItem = async (item: MovieSearchResult) => {
    setLoadingDetails(true);
    setSelectedMedia(null);
    setIsPreviewing(false);
    setDirectStreams([]);
    try {
      const res = await fetch(`/api/movies/details?id=${item.id}&type=${item.type}`);
      if (res.ok) {
        const details: MovieDetails = await res.json();
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
      }
    } catch (e) {
      console.error("Failed to load season:", e);
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
                Stream & synchronize HD movies, anime, and TV shows directly in room
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
                  <div className={styles.audioGuaranteeBanner}>
                    <span className={styles.audioGuaranteeIcon}>🔊</span>
                    <span>
                      <strong>100% Working Audio & Sync:</strong> Plays via WatchParty native HTML5 engine.
                      Full volume controls, up to 200% AudioBoost, skip buttons, and instant timeline seeking!
                    </span>
                  </div>

                  <h4 className={styles.sectionHeading}>
                    <span>
                      ⚡ Available HD Streams ({directStreams.length})
                      {selectedMedia.type === "tv" ? ` — Season ${selectedSeason} Episode ${selectedEpisode}` : ""}
                    </span>
                  </h4>

                  {loadingStreams ? (
                    <div className={styles.loadingSpinner} style={{ padding: "30px 0" }}>
                      <Loader size="sm" color="indigo" />
                      <span>Finding high-speed HD streams...</span>
                    </div>
                  ) : directStreams.length > 0 ? (
                    <>
                      <div className={styles.streamListGrid}>
                        {directStreams.map((s, idx) => {
                          const isSelected = selectedStreamIndex === idx;
                          return (
                            <div
                              key={s.id}
                              className={`${styles.streamCard} ${isSelected ? styles.streamCardActive : ""}`}
                              onClick={() => setSelectedStreamIndex(idx)}
                              onDoubleClick={() => handlePlaySelectedStream(idx)}
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
                              </div>
                              <span className={styles.streamReleaseTitle} title={s.cleanTitle}>
                                {s.cleanTitle}
                              </span>
                            </div>
                          );
                        })}
                      </div>

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
          ) : items.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>🎬</div>
              <h3>No titles found</h3>
              <p>Try searching with a different movie or web series name</p>
            </div>
          ) : (
            /* Search Results / Trending Poster Grid */
            <div className={styles.gridContainer}>
              {items.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className={styles.mediaCard}
                  onClick={() => selectMediaItem(item)}
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
