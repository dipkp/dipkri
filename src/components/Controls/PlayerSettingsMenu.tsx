import React, { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
import { serverPath, formatSpeed } from "../../utils/utils";
import { cleanMovieTitle } from "./Controls";
import {
  WPIconSpeedGauge,
  WPIconAspectRatio,
  WPIconVideoFlip,
  WPIconSliders,
  WPIconSubtitleBubble,
  WPIconOpenSubtitle,
  WPIconVolumeOn,
  WPIconQuality,
  WPIconChevronRight,
  WPIconChevronLeft,
  WPIconCheck,
  WPIconDownload,
  WPIconSearch,
  WPIconUpload,
  WPIconVideo,
} from "../Icons/CustomIcons";
import {
  getWebcamSettings,
  setWebcamSettings,
  BubbleSize,
  WebcamSettingsState,
} from "../VideoChat/webcamSettings";
import styles from "./PlayerSettingsMenu.module.css";

export type SubmenuType =
  | "main"
  | "speed"
  | "aspect"
  | "flip"
  | "subtitle"
  | "opensubtitle"
  | "quality"
  | "audio"
  | "bubbles"
  | "torrent";

export interface SubtitleTrackItem {
  index: number;
  label: string;
  active: boolean;
  language?: string;
}

export interface PlayerSettingsMenuProps {
  onClose: () => void;
  isBottomSheet?: boolean;
  // Play Speed
  playbackRate: number;
  onSetPlaybackRate: (rate: number) => void;
  // Aspect Ratio
  aspectRatio: string;
  onSetAspectRatio: (ratio: string) => void;
  // Video Flip
  videoFlip: string;
  onSetVideoFlip: (flip: string) => void;
  // Subtitle Offset
  subtitleOffset: number;
  onSetSubtitleOffset: (offset: number) => void;
  // Subtitles
  subtitled: boolean;
  onToggleSubtitles: (show: boolean) => void;
  onUploadSubtitle: () => void;
  subtitleTracks: SubtitleTrackItem[];
  onSelectSubtitleTrack: (index: number) => void;
  currentSubtitleLabel?: string;
  // Audio Boost
  audioBoost: number; // 1 to 4
  onSetAudioBoost: (boost: number) => void;
  // Quality
  quality: string;
  onSetQuality: (q: string) => void;
  availableQualities?: { key: string; label: string; active?: boolean }[];
  // Audio Track
  audioTracks?: { id: string | number; label: string; language?: string }[];
  currentAudioTrack?: number;
  onSelectAudioTrack?: (index: number) => void;
  // OpenSubtitle search
  roomMedia?: string;
  socket?: Socket;
  // Torrent & Video Source Metadata
  isYouTube?: boolean;
  downloaded?: number;
  total?: number;
  speed?: number;
  connections?: number;
  convertProgress?: number;
  showStatsOverlay?: boolean;
  onToggleStatsOverlay?: () => void;
}

export const PlayerSettingsMenu: React.FC<PlayerSettingsMenuProps> = ({
  onClose,
  isBottomSheet = false,
  playbackRate,
  onSetPlaybackRate,
  aspectRatio,
  onSetAspectRatio,
  videoFlip,
  onSetVideoFlip,
  subtitleOffset,
  onSetSubtitleOffset,
  subtitled,
  onToggleSubtitles,
  onUploadSubtitle,
  subtitleTracks,
  onSelectSubtitleTrack,
  currentSubtitleLabel,
  audioBoost,
  onSetAudioBoost,
  quality,
  onSetQuality,
  availableQualities,
  audioTracks,
  currentAudioTrack,
  onSelectAudioTrack,
  roomMedia = "",
  socket,
  isYouTube = false,
  downloaded = 0,
  total = 0,
  speed = 0,
  connections = 0,
  convertProgress,
  showStatsOverlay = true,
  onToggleStatsOverlay,
}) => {
  const [currentMenu, setCurrentMenu] = useState<SubmenuType>("main");

  // Reactive floating webcam state
  const [webcamState, setWebcamState] = useState<WebcamSettingsState>(getWebcamSettings);

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail) setWebcamState(e.detail);
      else setWebcamState(getWebcamSettings());
    };
    window.addEventListener("dipkri-webcam-settings-changed", handler);
    return () => window.removeEventListener("dipkri-webcam-settings-changed", handler);
  }, []);

  // OpenSubtitle search state
  const [openSubSearch, setOpenSubSearch] = useState("");
  const [openSubResults, setOpenSubResults] = useState<any[]>([]);
  const [searchingOpenSub, setSearchingOpenSub] = useState(false);
  const [downloadingSubId, setDownloadingSubId] = useState<string | null>(null);

  // Speed label helper
  const getSpeedLabel = (rate: number): string => {
    if (rate === 1) return "Normal";
    return `${rate}x`;
  };

  // Aspect ratio label helper
  const getAspectLabel = (ratio: string): string => {
    switch (ratio) {
      case "16:9":
        return "16:9";
      case "4:3":
        return "4:3";
      case "21:9":
        return "21:9";
      case "fill":
        return "Fill";
      case "fit":
        return "Fit";
      default:
        return "Default";
    }
  };

  // Flip label helper
  const getFlipLabel = (flip: string): string => {
    switch (flip) {
      case "horizontal":
        return "Horizontal";
      case "vertical":
        return "Vertical";
      default:
        return "Normal";
    }
  };

  // Quality label helper
  const getQualityLabel = (q: string): string => {
    switch (q.toLowerCase()) {
      case "op":
      case "source":
        return "OP";
      case "auto":
        return "Auto";
      default:
        return q.toUpperCase();
    }
  };

  // Check if source media supports multiple qualities (adaptive) or is fixed
  const hasMultipleQualities = Boolean(
    isYouTube ||
    (typeof window !== "undefined" && (window as any).watchparty?.hls?.levels && (window as any).watchparty.hls.levels.length > 1) ||
    (typeof window !== "undefined" && (window as any).watchparty?.dash) ||
    (roomMedia && (roomMedia.includes(".m3u8") || roomMedia.includes(".mpd"))) ||
    (availableQualities && availableQualities.length > 1)
  );

  // Check if media is a torrent or magnet stream
  const isTorrentMedia = Boolean(
    (roomMedia && (roomMedia.includes("torrent=") || roomMedia.startsWith("magnet:"))) ||
    Boolean(total || convertProgress !== undefined)
  );

  // Perform search on OpenSubtitles
  const performOpenSubSearch = async (queryText?: string) => {
    let q = (queryText !== undefined ? queryText : openSubSearch).trim();
    if (!q && roomMedia) {
      const parsed = cleanMovieTitle(roomMedia);
      q = parsed.title || roomMedia;
      setOpenSubSearch(q);
    }
    setSearchingOpenSub(true);
    try {
      let url = "";
      if (q) {
        url = `${serverPath}/searchSubtitles?query=${encodeURIComponent(q)}`;
      } else if (roomMedia) {
        url = `${serverPath}/searchSubtitles?url=${encodeURIComponent(roomMedia)}`;
      }
      if (url) {
        const res = await fetch(url);
        const data = await res.json();
        setOpenSubResults(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.warn("OpenSubtitle search failed:", e);
    } finally {
      setSearchingOpenSub(false);
    }
  };

  // Download and activate selected subtitle from OpenSubtitles
  const downloadOpenSub = async (sub: any) => {
    if (!sub) return;
    const downloadTarget =
      sub.downloadUrl ||
      sub.url ||
      sub.attributes?.downloadUrl ||
      "";
    const fileId =
      sub.file_id ||
      sub.attributes?.files?.[0]?.file_id ||
      "";

    if (!downloadTarget && !fileId) return;

    const subKey = sub.id || downloadTarget || String(fileId);
    setDownloadingSubId(subKey);
    try {
      let queryParam = "";
      if (downloadTarget) {
        queryParam = `url=${encodeURIComponent(downloadTarget)}`;
      } else if (fileId) {
        queryParam = `file_id=${encodeURIComponent(fileId)}`;
      }
      const res = await fetch(`${serverPath}/downloadSubtitles?${queryParam}`);
      const data = await res.json();
      const subUrl = data?.url || data?.link;
      if (subUrl) {
        if (socket) {
          socket.emit("CMD:subtitle", subUrl);
        }
        onToggleSubtitles(true);
        onClose();
      }
    } catch (e) {
      console.warn("Download OpenSubtitles error:", e);
    } finally {
      setDownloadingSubId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // 1. VIDEO BUBBLES SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "bubbles") {
    const bubbleSizes: { key: BubbleSize; label: string; desc: string }[] = [
      { key: "min", label: "Min", desc: "48px" },
      { key: "small", label: "Small", desc: "70px" },
      { key: "medium", label: "Medium", desc: "95px" },
      { key: "max", label: "Max", desc: "145px" },
    ];

    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Video Bubbles</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {/* Row 1: Floating Bubbles Visibility Toggle */}
          <div
            className={styles.menuRow}
            onClick={() => setWebcamSettings({ visible: !webcamState.visible })}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconVideo size={18} />
              </div>
              <span className={styles.rowLabel}>Display Bubbles</span>
            </div>
            <div className={styles.switchWrapper}>
              <span className={styles.switchStatusText}>
                {webcamState.visible ? "Show" : "Hide"}
              </span>
              <div
                className={`${styles.iosSwitch} ${webcamState.visible ? styles.iosSwitchActive : ""}`}
              >
                <div className={styles.iosSwitchThumb} />
              </div>
            </div>
          </div>

          {/* Row 2: Direct Dragging Lock/Unlock */}
          <div
            className={styles.menuRow}
            onClick={() => setWebcamSettings({ dragUnlocked: !webcamState.dragUnlocked })}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconSliders size={18} />
              </div>
              <span className={styles.rowLabel}>Direct Dragging</span>
            </div>
            <div className={styles.switchWrapper}>
              <span className={styles.switchStatusText}>
                {webcamState.dragUnlocked ? "On" : "Off"}
              </span>
              <div
                className={`${styles.iosSwitch} ${webcamState.dragUnlocked ? styles.iosSwitchActive : ""}`}
              >
                <div className={styles.iosSwitchThumb} />
              </div>
            </div>
          </div>

          <div className={styles.menuDivider} />
          <div className={styles.menuSectionTitle}>Bubble Size</div>

          {bubbleSizes.map((item) => {
            const isSelected = webcamState.size === item.key;
            return (
              <div
                key={item.key}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => setWebcamSettings({ size: item.key })}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>
                  {item.label} ({item.desc})
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2. TORRENT & MAGNET SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "torrent") {
    const percent = total ? Math.min((downloaded / total) * 100, 100).toFixed(1) : undefined;
    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Torrent & Magnet</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {/* Row 1: On-Screen Badge */}
          {onToggleStatsOverlay && (
            <div
              className={styles.menuRow}
              onClick={onToggleStatsOverlay}
            >
              <div className={styles.rowLeft}>
                <div className={styles.rowIcon}>
                  <WPIconSliders size={18} />
                </div>
                <span className={styles.rowLabel}>On-Screen Badge</span>
              </div>
              <div className={styles.switchWrapper}>
                <span className={styles.switchStatusText}>
                  {showStatsOverlay !== false ? "Show" : "Hide"}
                </span>
                <div
                  className={`${styles.iosSwitch} ${showStatsOverlay !== false ? styles.iosSwitchActive : ""}`}
                >
                  <div className={styles.iosSwitchThumb} />
                </div>
              </div>
            </div>
          )}

          <div className={styles.menuSectionTitle}>Torrent Info</div>
          <div className={styles.statsCard}>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Downloaded:</span>
              <span className={styles.statsValue}>
                {percent ? `${percent}%` : "Connecting to peers..."}
              </span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Speed:</span>
              <span className={styles.statsValue}>{formatSpeed(speed || 0)}</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Peers:</span>
              <span className={styles.statsValue}>{connections || 0} connections</span>
            </div>
            {convertProgress !== undefined && (
              <div className={styles.statsRow}>
                <span className={styles.statsLabel}>Transcode:</span>
                <span className={styles.statsValue}>{(convertProgress * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 3. SUBTITLE SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "subtitle") {
    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Subtitle</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {/* Row 1: Display with iOS Toggle Switch */}
          <div
            className={styles.menuRow}
            onClick={() => onToggleSubtitles(!subtitled)}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconSliders size={18} />
              </div>
              <span className={styles.rowLabel}>Display</span>
            </div>

            <div className={styles.switchWrapper}>
              <span className={styles.switchStatusText}>
                {subtitled ? "Show" : "Hide"}
              </span>
              <div
                className={`${styles.iosSwitch} ${subtitled ? styles.iosSwitchActive : ""}`}
              >
                <div className={styles.iosSwitchThumb} />
              </div>
            </div>
          </div>

          {/* Row 2: Upload Subtitle */}
          <div
            className={styles.menuRow}
            onClick={() => {
              onUploadSubtitle();
              onClose();
            }}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconUpload size={18} />
              </div>
              <span className={styles.rowLabel}>Upload Subtitle</span>
            </div>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>

          {/* Row 3: Auto-Search OpenSubtitles */}
          <div
            className={styles.menuRow}
            onClick={() => {
              const detected = cleanMovieTitle(roomMedia || currentSubtitleLabel || "").title || roomMedia;
              if (detected) setOpenSubSearch(detected);
              setCurrentMenu("opensubtitle");
              performOpenSubSearch(detected);
            }}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconOpenSubtitle size={18} />
              </div>
              <span className={styles.rowLabel}>Auto-Search OpenSubtitles</span>
            </div>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>

          {/* Divider */}
          <div className={styles.menuDivider} />

          {/* Subtitle Tracks List */}
          {subtitleTracks.length > 0 ? (
            subtitleTracks.map((track) => {
              const isSelected = track.active && subtitled;
              return (
                <div
                  key={track.index}
                  className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                  onClick={() => {
                    onSelectSubtitleTrack(track.index);
                    onToggleSubtitles(true);
                  }}
                >
                  <div className={styles.optionCheckWrapper}>
                    {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                  </div>
                  <span className={styles.optionText}>{track.label}</span>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyHint}>
              No embedded subtitle tracks detected. Use "Upload Subtitle" or "OpenSubtitle".
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 4. PLAY SPEED SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "speed") {
    const speedOptions = [
      { value: 0.25, label: "0.25x" },
      { value: 0.5, label: "0.5x" },
      { value: 0.75, label: "0.75x" },
      { value: 1.0, label: "Normal" },
      { value: 1.25, label: "1.25x" },
      { value: 1.5, label: "1.5x" },
      { value: 1.75, label: "1.75x" },
      { value: 2.0, label: "2x" },
    ];

    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Play Speed</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {speedOptions.map((opt) => {
            const isSelected = playbackRate === opt.value;
            return (
              <div
                key={opt.value}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => {
                  onSetPlaybackRate(opt.value);
                  setCurrentMenu("main");
                }}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 5. ASPECT RATIO SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "aspect") {
    const aspectOptions = [
      { key: "default", label: "Default" },
      { key: "16:9", label: "16:9" },
      { key: "4:3", label: "4:3" },
      { key: "21:9", label: "21:9" },
      { key: "fit", label: "Fit" },
      { key: "fill", label: "Fill" },
    ];

    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Aspect Ratio</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {aspectOptions.map((opt) => {
            const isSelected = aspectRatio === opt.key;
            return (
              <div
                key={opt.key}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => {
                  onSetAspectRatio(opt.key);
                  setCurrentMenu("main");
                }}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 6. OPENSUBTITLE SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "opensubtitle") {
    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>OpenSubtitle</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.searchBox}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search movie title..."
            value={openSubSearch}
            onChange={(e) => setOpenSubSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") performOpenSubSearch();
            }}
          />
          <button
            type="button"
            className={styles.searchBtn}
            onClick={() => performOpenSubSearch()}
            disabled={searchingOpenSub}
          >
            {searchingOpenSub ? "..." : <WPIconSearch size={14} />}
          </button>
        </div>

        <div className={styles.menuList}>
          {searchingOpenSub ? (
            <div className={styles.emptyHint}>Searching online database...</div>
          ) : openSubResults.length > 0 ? (
            openSubResults.map((sub, idx) => {
              const subRelease =
                sub.name ||
                sub.title ||
                sub.attributes?.release ||
                sub.attributes?.files?.[0]?.file_name ||
                `Subtitle #${idx + 1}`;
              const subLang = (
                sub.lang ||
                sub.language ||
                sub.attributes?.language ||
                "EN"
              ).toUpperCase();
              const subFormat = (
                sub.format ||
                sub.attributes?.format ||
                "SRT"
              ).toUpperCase();
              const subKey = sub.id || sub.downloadUrl || sub.url || String(sub.attributes?.files?.[0]?.file_id || idx);
              const isDownloading = downloadingSubId === subKey;

              return (
                <div
                  key={subKey}
                  className={styles.optionRow}
                  onClick={() => downloadOpenSub(sub)}
                  title={subRelease}
                >
                  <div className={styles.optionCheckWrapper}>
                    {isDownloading ? (
                      <span style={{ fontSize: 11, color: "#38bdf8", fontWeight: 700 }}>...</span>
                    ) : (
                      <WPIconDownload size={16} />
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 4 }}>
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#f8fafc",
                        lineHeight: 1.2,
                      }}
                    >
                      {subRelease}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={styles.subLangBadge}>{subLang}</span>
                      <span className={styles.subFormatBadge}>{subFormat}</span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyHint}>
              No subtitles found. Try typing movie title above.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 7. VIDEO FLIP SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "flip") {
    const flipOptions = [
      { key: "normal", label: "Normal" },
      { key: "horizontal", label: "Horizontal" },
      { key: "vertical", label: "Vertical" },
    ];

    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Video Flip</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {flipOptions.map((opt) => {
            const isSelected = videoFlip === opt.key;
            return (
              <div
                key={opt.key}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => {
                  onSetVideoFlip(opt.key);
                  setCurrentMenu("main");
                }}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 8. QUALITY SUBMENU (Adaptive Sources only)
  // ---------------------------------------------------------------------------
  if (currentMenu === "quality") {
    const qualityPresets = availableQualities && availableQualities.length > 0
      ? availableQualities
      : [
          { key: "auto", label: "Auto" },
          { key: "1080p", label: "1080p" },
          { key: "720p", label: "720p" },
          { key: "480p", label: "480p" },
          { key: "360p", label: "360p" },
        ];

    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Quality</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {qualityPresets.map((opt) => {
            const isSelected = quality.toLowerCase() === opt.key.toLowerCase();
            return (
              <div
                key={opt.key}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => {
                  onSetQuality(opt.key);
                  setCurrentMenu("main");
                }}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>{opt.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 9. AUDIO LANGUAGE SUBMENU
  // ---------------------------------------------------------------------------
  if (currentMenu === "audio") {
    return (
      <div
        className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.bottomSheetGrabHandle} />
        <div className={styles.menuHeader} onClick={() => setCurrentMenu("main")}>
          <div className={styles.backIcon}>
            <WPIconChevronLeft size={18} />
          </div>
          <span className={styles.menuTitle}>Audio Language</span>
          <button
            type="button"
            className={styles.bottomSheetCloseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.menuList}>
          {(audioTracks || []).map((t, idx) => {
            const isSelected = (currentAudioTrack ?? 0) === idx;
            return (
              <div
                key={t.id}
                className={`${styles.optionRow} ${isSelected ? styles.optionActive : ""}`}
                onClick={() => {
                  onSelectAudioTrack?.(idx);
                  setCurrentMenu("main");
                }}
              >
                <div className={styles.optionCheckWrapper}>
                  {isSelected && <WPIconCheck size={18} color="#38bdf8" />}
                </div>
                <span className={styles.optionText}>{t.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 10. MAIN SETTINGS MENU
  // ---------------------------------------------------------------------------
  return (
    <div
      className={`${styles.menuContainer} ${isBottomSheet ? styles.menuContainerBottomSheet : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.bottomSheetGrabHandle} />
      <div className={styles.bottomSheetTitleRow}>
        <span className={styles.bottomSheetTitle}>Playback Settings</span>
        <button
          type="button"
          className={styles.bottomSheetCloseBtn}
          onClick={onClose}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>
      <div className={styles.menuList}>
        {/* Item 1: Play Speed */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("speed")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconSpeedGauge size={18} />
            </div>
            <span className={styles.rowLabel}>Play Speed</span>
          </div>
          <div className={styles.rowRight}>
            <span className={styles.rowValue}>{getSpeedLabel(playbackRate)}</span>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 2: Aspect Ratio */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("aspect")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconAspectRatio size={18} />
            </div>
            <span className={styles.rowLabel}>Aspect Ratio</span>
          </div>
          <div className={styles.rowRight}>
            <span className={styles.rowValue}>{getAspectLabel(aspectRatio)}</span>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 3: Video Flip */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("flip")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconVideoFlip size={18} />
            </div>
            <span className={styles.rowLabel}>Video Flip</span>
          </div>
          <div className={styles.rowRight}>
            <span className={styles.rowValue}>{getFlipLabel(videoFlip)}</span>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 4: Subtitle Offset (Inline Slider) */}
        <div className={styles.menuRow}>
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconSliders size={18} />
            </div>
            <span className={styles.rowLabel}>Subtitle Offset</span>
          </div>

          <div className={styles.sliderControlWrapper}>
            <span className={styles.sliderValueText}>
              {subtitleOffset > 0 ? `+${subtitleOffset.toFixed(1)}s` : `${subtitleOffset.toFixed(1)}s`}
            </span>
            <input
              type="range"
              min="-10"
              max="10"
              step="0.5"
              className={styles.customSlider}
              value={subtitleOffset}
              onChange={(e) => onSetSubtitleOffset(parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* Item 5: Subtitle */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("subtitle")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconSubtitleBubble size={18} />
            </div>
            <span className={styles.rowLabel}>Subtitle</span>
          </div>
          <div className={styles.rowRight}>
            {currentSubtitleLabel && (
              <span
                className={styles.rowValue}
                style={{
                  maxWidth: 95,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "inline-block",
                }}
                title={currentSubtitleLabel}
              >
                {currentSubtitleLabel}
              </span>
            )}
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 6: OpenSubtitle */}
        <div
          className={styles.menuRow}
          onClick={() => {
            const detected = cleanMovieTitle(roomMedia || currentSubtitleLabel || "").title || roomMedia;
            if (detected) setOpenSubSearch(detected);
            setCurrentMenu("opensubtitle");
            performOpenSubSearch(detected);
          }}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconOpenSubtitle size={18} />
            </div>
            <span className={styles.rowLabel}>OpenSubtitle</span>
          </div>
          <div className={styles.rowRight}>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 7: Audio Boost (Inline Slider: 1x to 4x) */}
        <div className={styles.menuRow}>
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconVolumeOn size={18} />
            </div>
            <span className={styles.rowLabel}>Audio Boost</span>
          </div>

          <div className={styles.sliderControlWrapper}>
            <span className={styles.sliderValueText}>
              {`${Math.round(audioBoost)}x`}
            </span>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              className={styles.customSlider}
              value={audioBoost}
              onChange={(e) => onSetAudioBoost(parseInt(e.target.value, 10))}
            />
          </div>
        </div>

        {/* Item 8: Video Bubbles */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("bubbles")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconVideo size={18} />
            </div>
            <span className={styles.rowLabel}>Video Bubbles</span>
          </div>
          <div className={styles.rowRight}>
            <span className={styles.rowValue}>
              {webcamState.visible
                ? webcamState.size.charAt(0).toUpperCase() + webcamState.size.slice(1)
                : "Hidden"}
            </span>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>

        {/* Item 9: Torrent & Magnet Stats (Only if media is a torrent or magnet stream) */}
        {isTorrentMedia && (
          <div
            className={styles.menuRow}
            onClick={() => setCurrentMenu("torrent")}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <span style={{ fontSize: 16 }}>🧲</span>
              </div>
              <span className={styles.rowLabel}>Torrent & Magnet</span>
            </div>
            <div className={styles.rowRight}>
              <span className={styles.rowValue}>
                {total ? `${Math.min((downloaded / total) * 100, 100).toFixed(0)}%` : "Active"}
              </span>
              <div className={styles.chevronIcon}>
                <WPIconChevronRight size={16} />
              </div>
            </div>
          </div>
        )}

        {/* Item 10: Quality (Only if media source supports adaptive quality / multiple renditions) */}
        {hasMultipleQualities && (
          <div
            className={styles.menuRow}
            onClick={() => setCurrentMenu("quality")}
          >
            <div className={styles.rowLeft}>
              <div className={styles.rowIcon}>
                <WPIconQuality size={18} />
              </div>
              <span className={styles.rowLabel}>Quality</span>
            </div>
            <div className={styles.rowRight}>
              <span className={styles.rowValue}>{getQualityLabel(quality)}</span>
              <div className={styles.chevronIcon}>
                <WPIconChevronRight size={16} />
              </div>
            </div>
          </div>
        )}

        {/* Item 11: Audio Language */}
        <div
          className={styles.menuRow}
          onClick={() => setCurrentMenu("audio")}
        >
          <div className={styles.rowLeft}>
            <div className={styles.rowIcon}>
              <WPIconVolumeOn size={18} />
            </div>
            <span className={styles.rowLabel}>Audio Language</span>
          </div>
          <div className={styles.rowRight}>
            <span
              className={styles.rowValue}
              style={{
                maxWidth: 130,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "inline-block",
                textAlign: "right",
              }}
              title={
                audioTracks && audioTracks[currentAudioTrack ?? 0]?.label
                  ? audioTracks[currentAudioTrack ?? 0].label
                  : "Default Audio"
              }
            >
              {audioTracks && audioTracks[currentAudioTrack ?? 0]?.label
                ? audioTracks[currentAudioTrack ?? 0].label
                : "Default Audio"}
            </span>
            <div className={styles.chevronIcon}>
              <WPIconChevronRight size={16} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};