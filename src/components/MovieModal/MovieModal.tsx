import React, { useState, useEffect, useRef } from "react";
import styles from "./MovieModal.module.css";
import {
  type MovieSearchResult,
  type MovieDetails,
  type MovieSeasonEpisode,
  type MovieServer,
  createMovieProtocolUrl,
  buildMovieEmbedUrl,
} from "../../utils/utils";
import { Loader } from "@mantine/core";

interface MovieModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlay: (movieUrl: string) => void;
  onQueue: (movieUrl: string) => void;
}

const SERVER_OPTIONS: Array<{ id: MovieServer; name: string; tag: string }> = [
  { id: "apiplayer", name: "APIPlayer.ru", tag: "Primary / Multi-Lang" },
  { id: "nexstream", name: "NexStream", tag: "CodeSpecters HD" },
  { id: "vidsrc", name: "VidSrc", tag: "Fast HD Stream" },
  { id: "multiembed", name: "MultiEmbed", tag: "Alternative Multi" },
];

export const MovieModal: React.FC<MovieModalProps> = ({
  isOpen,
  onClose,
  onPlay,
  onQueue,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"trending" | "movie" | "tv">("trending");
  const [items, setItems] = useState<MovieSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Detail View State
  const [selectedMedia, setSelectedMedia] = useState<MovieDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectedServer, setSelectedServer] = useState<MovieServer>("apiplayer");
  const [selectedSeason, setSelectedSeason] = useState(1);
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

  const fetchTrending = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/movies/trending");
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
      fetchTrending();
    } else {
      if (searchQuery.trim()) {
        executeSearch(searchQuery.trim(), type);
      }
    }
  };

  const selectMediaItem = async (item: MovieSearchResult) => {
    setLoadingDetails(true);
    setSelectedMedia(null);
    setIsPreviewing(false);
    try {
      const res = await fetch(`/api/movies/details?id=${item.id}&type=${item.type}`);
      if (res.ok) {
        const details: MovieDetails = await res.json();
        setSelectedMedia(details);
        if (details.type === "tv" && details.seasons && details.seasons.length > 0) {
          const firstSeasonNum = details.seasons[0].seasonNumber || 1;
          setSelectedSeason(firstSeasonNum);
          fetchSeasonEpisodes(details.id, firstSeasonNum);
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
    if (selectedMedia) {
      fetchSeasonEpisodes(selectedMedia.id, seasonNum);
    }
  };

  const handlePlayMedia = (season = 1, episode = 1) => {
    if (!selectedMedia) return;
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

  const handleQueueMedia = (season = 1, episode = 1) => {
    if (!selectedMedia) return;
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

              {/* Streaming Server Selector */}
              <div className={styles.serverSection}>
                <h4 className={styles.sectionHeading}>
                  <span>⚡ Select Streaming Server</span>
                </h4>
                <div className={styles.serverList}>
                  {SERVER_OPTIONS.map((srv) => (
                    <button
                      key={srv.id}
                      type="button"
                      className={`${styles.serverButton} ${selectedServer === srv.id ? styles.serverButtonActive : ""}`}
                      onClick={() => setSelectedServer(srv.id)}
                    >
                      <span className={styles.serverName}>{srv.name}</span>
                      <span className={styles.serverBadge}>{srv.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Movie Primary Actions */}
              {selectedMedia.type === "movie" ? (
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.playRoomBtn}
                    onClick={() => handlePlayMedia()}
                  >
                    ▶ Play in Room
                  </button>
                  <button
                    type="button"
                    className={styles.queueBtn}
                    onClick={() => handleQueueMedia()}
                  >
                    + Add to Queue
                  </button>
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={() => setIsPreviewing(!isPreviewing)}
                  >
                    {isPreviewing ? "Hide Preview" : "👁️ Preview Stream"}
                  </button>
                </div>
              ) : (
                /* TV Series: Season selector & Episode list */
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className={styles.serverSection}>
                    <h4 className={styles.sectionHeading}>
                      <span>📺 Select Season</span>
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
                    <span>Episodes ({episodes.length})</span>
                  </h4>

                  {loadingEpisodes ? (
                    <div className={styles.loadingSpinner}>
                      <Loader size="sm" color="indigo" />
                      <span>Loading episodes...</span>
                    </div>
                  ) : (
                    <div className={styles.episodeGrid}>
                      {episodes.map((ep) => (
                        <div key={ep.id} className={styles.episodeCard}>
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
                              onClick={() => handlePlayMedia(selectedSeason, ep.episodeNumber)}
                              title="Play in room"
                            >
                              ▶ Play
                            </button>
                            <button
                              type="button"
                              className={styles.episodeQueueBtn}
                              onClick={() => handleQueueMedia(selectedSeason, ep.episodeNumber)}
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

              {/* In-Modal Stream Preview if enabled */}
              {isPreviewing && (
                <div className={styles.previewFrameWrapper}>
                  <iframe
                    title="Movie Preview"
                    src={buildMovieEmbedUrl({
                      tmdbId: String(selectedMedia.id),
                      type: selectedMedia.type,
                      title: selectedMedia.title,
                      season: selectedSeason,
                      episode: 1,
                      server: selectedServer,
                    })}
                    className={styles.previewFrame}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
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
                        className={styles.posterImage}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.posterPlaceholder}>
                        <span>🎬</span>
                      </div>
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
                    <h4 className={styles.cardTitle} title={item.title}>
                      {item.title}
                    </h4>
                    <div className={styles.cardMeta}>
                      <span>{item.year || "Release"}</span>
                      <span>{item.type === "tv" ? "Series" : "Movie"}</span>
                    </div>
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
