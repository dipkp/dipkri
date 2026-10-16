import React from "react";
import {
  Modal,
  Button,
  Switch,
  TextInput,
  ActionIcon,
  Loader,
} from "@mantine/core";
import { Socket } from "socket.io-client";
import { openFileSelector, serverPath } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import {
  WPIconDownload,
  WPIconSearch,
  WPIconUpload,
  WPIconClose,
  WPIconCaptions,
  WPIconCheck,
  WPIconDatabase,
} from "../Icons/CustomIcons";
import styles from "./SubtitleModal.module.css";

interface SubtitleModalProps {
  closeModal: () => void;
  roomSubtitle: string | undefined;
  haveLock: () => boolean;
  roomMedia: string;
  socket: Socket;
  getMediaDisplayName: (input: string) => string;
  setSubtitleMode: (mode?: TextTrackMode) => void;
  getSubtitleMode: () => TextTrackMode;
}

interface SubtitleResult {
  id: string;
  type: string;
  attributes: {
    release?: string;
    language?: string;
    format?: string;
    files: { file_id: string; file_name?: string }[];
    [key: string]: any;
  };
}

export function cleanMovieTitle(raw: string): string {
  if (!raw) return "";
  let name = raw.split("/").slice(-1)[0] || "";
  name = name.split("?")[0];
  name = name.replace(/\.(mp4|mkv|avi|webm|mov|flv|ts|m4v)$/i, "");
  name = name.replace(/[._]/g, " ").trim();
  return name;
}

export class SubtitleModal extends React.Component<SubtitleModalProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  state = {
    loading: false,
    downloadingId: null as string | null,
    hasSearched: false,
    searchResults: [] as SubtitleResult[],
    titleQuery: cleanMovieTitle(
      this.props.getMediaDisplayName(this.props.roomMedia),
    ),
    isShowingSubtitles: this.props.getSubtitleMode() === "showing",
    selectedLanguage: "ALL",
    showUrlInput: !!this.props.roomSubtitle,
  };

  async componentDidMount() {
    let query = this.state.titleQuery;
    if (this.props.roomMedia.includes("/stream?torrent=magnet")) {
      const re = /&fileIndex=(\d+)$/;
      const match = re.exec(this.props.roomMedia);
      if (match) {
        const fileIndex = match[1];
        if (fileIndex) {
          try {
            const response = await fetch(
              this.props.roomMedia.replace("/stream", "/data"),
            );
            const data = await response.json();
            if (data?.files?.[fileIndex]?.name) {
              query = cleanMovieTitle(data.files[fileIndex].name);
              this.setState({
                titleQuery: query,
              });
            }
          } catch (e) {
            console.warn("Failed to fetch torrent filename for subtitles:", e);
          }
        }
      }
    }
    // Auto-search immediately so subtitles appear with 0 extra clicks!
    if (query && query.trim() && query !== "Torrent" && query !== "Torrent Stream") {
      this.searchByTitle();
    }
  }

  uploadSubtitle = async () => {
    try {
      const files = await openFileSelector(".srt,.vtt");
      if (!files || files.length === 0) {
        return;
      }
      const file = files[0];
      const reader = new FileReader();
      reader.addEventListener("load", async (event) => {
        const subData = event.target?.result;
        const resp = await fetch(serverPath + "/subtitle", {
          method: "POST",
          body: subData,
          headers: { "Content-Type": "text/plain" },
        });
        const json = await resp.json();
        if (json?.hash) {
          this.props.socket.emit(
            "CMD:subtitle",
            serverPath + "/subtitle/" + json.hash,
          );
          this.props.setSubtitleMode("showing");
          this.setState({ isShowingSubtitles: true });
        }
      });
      reader.readAsText(file);
    } catch (err) {
      console.error("Subtitle upload error:", err);
    }
  };

  searchByTitle = async () => {
    if (!this.state.titleQuery.trim()) return;
    this.setState({ loading: true, hasSearched: true, selectedLanguage: "ALL" });
    try {
      const resp = await fetch(
        serverPath +
          "/searchSubtitles?title=" +
          encodeURIComponent(this.state.titleQuery.trim()),
      );
      const json = await resp.json();
      this.setState({
        searchResults: Array.isArray(json) ? json : [],
        loading: false,
      });
    } catch (e) {
      console.warn("Subtitle search by title error:", e);
      this.setState({ searchResults: [], loading: false });
    }
  };

  searchByHash = async () => {
    this.setState({ loading: true, hasSearched: true, selectedLanguage: "ALL" });
    try {
      const resp = await fetch(
        serverPath +
          "/searchSubtitles?url=" +
          encodeURIComponent(this.props.roomMedia),
      );
      const json = await resp.json();
      this.setState({
        searchResults: Array.isArray(json) ? json : [],
        loading: false,
      });
    } catch (e) {
      console.warn("Subtitle search by hash error:", e);
      this.setState({ searchResults: [], loading: false });
    }
  };

  applyOpenSubtitle = async (result: SubtitleResult) => {
    const fileId = result.attributes.files?.[0]?.file_id;
    const downloadUrl = (result.attributes as any).downloadUrl || "";
    if (!fileId && !downloadUrl) return;
    this.setState({ downloadingId: result.id });
    try {
      const q = new URLSearchParams();
      if (downloadUrl) q.set("downloadUrl", downloadUrl);
      if (fileId) q.set("file_id", fileId);
      const resp = await fetch(
        serverPath + "/downloadSubtitles?" + q.toString(),
      );
      const data = await resp.json();
      if (data?.link) {
        this.props.socket.emit("CMD:subtitle", serverPath + data.link);
        this.props.setSubtitleMode("showing");
        this.setState({ isShowingSubtitles: true });
      }
    } catch (err) {
      console.error("Failed to download subtitle:", err);
    } finally {
      this.setState({ downloadingId: null });
    }
  };

  render() {
    const { closeModal, haveLock, roomSubtitle } = this.props;
    const canControl = haveLock();

    // Compute distinct languages and counts from search results
    const languageCounts: { [code: string]: number } = {};
    for (const r of this.state.searchResults) {
      const lang = (r.attributes?.language || "EN").toUpperCase();
      languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    }
    const distinctLanguages = Object.keys(languageCounts).sort();

    // Filter results based on selected language chip
    const filteredResults =
      this.state.selectedLanguage === "ALL"
        ? this.state.searchResults
        : this.state.searchResults.filter(
            (r) =>
              (r.attributes?.language || "EN").toUpperCase() ===
              this.state.selectedLanguage,
          );

    return (
      <Modal
        opened
        onClose={closeModal}
        centered
        zIndex={2001}
        portalProps={{
          target:
            typeof document !== "undefined"
              ? (document.fullscreenElement as HTMLElement) || document.body
              : undefined,
        }}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(99, 102, 241, 0.2)",
                color: "#818cf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <WPIconCaptions size={18} />
            </div>
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              Subtitles & Captions
            </span>
          </div>
        }
        size="lg"
      >
        <div className={styles.modalContainer}>
          {/* Top Compact Toolbar: Display Toggle & Upload File */}
          <div className={styles.topToolbar}>
            <div className={styles.switchGroup}>
              <span className={styles.switchLabel}>
                <WPIconCaptions size={16} color="#818cf8" />
                Captions
              </span>
              <Switch
                size="sm"
                color="indigo"
                checked={this.state.isShowingSubtitles}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  this.props.setSubtitleMode(checked ? "showing" : "hidden");
                  this.setState({ isShowingSubtitles: checked });
                }}
              />
            </div>

            <div className={styles.toolbarActions}>
              <Button
                size="xs"
                variant="light"
                color="indigo"
                onClick={this.uploadSubtitle}
                disabled={!canControl}
                leftSection={<WPIconUpload size={14} />}
              >
                Upload .SRT
              </Button>
            </div>
          </div>

          {/* Active Subtitle Pill Banner */}
          {roomSubtitle && (
            <div className={styles.activeBanner}>
              <div className={styles.activeInfo}>
                <span className={styles.activeDot} />
                <span className={styles.activeTitle} title={roomSubtitle}>
                  Active: {cleanMovieTitle(roomSubtitle) || roomSubtitle}
                </span>
              </div>
              <ActionIcon
                size="sm"
                color="red"
                variant="subtle"
                disabled={!canControl}
                onClick={() => this.props.socket.emit("CMD:subtitle", "")}
                title="Remove current subtitle"
              >
                <WPIconClose size={14} />
              </ActionIcon>
            </div>
          )}

          {/* Search OpenSubtitles Section */}
          <div className={styles.searchSection}>
            <div className={styles.searchBarRow}>
              <TextInput
                style={{ flex: 1 }}
                placeholder="Search movie or series title..."
                value={this.state.titleQuery}
                onChange={(e) => this.setState({ titleQuery: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canControl) {
                    this.searchByTitle();
                  }
                }}
                disabled={!canControl}
              />
              <Button
                loading={this.state.loading}
                color="indigo"
                disabled={!canControl || !this.state.titleQuery.trim()}
                onClick={this.searchByTitle}
                leftSection={<WPIconSearch size={15} />}
              >
                Search
              </Button>
            </div>

            <div className={styles.searchActions}>
              <Button
                size="xs"
                loading={this.state.loading}
                color="gray"
                variant="subtle"
                disabled={!canControl}
                onClick={this.searchByHash}
                leftSection={<WPIconDatabase size={13} />}
              >
                Match by Video Hash
              </Button>
            </div>

            {/* Language Filter Chips if results are present */}
            {distinctLanguages.length > 1 && !this.state.loading && (
              <div className={styles.filterRow}>
                <button
                  type="button"
                  className={`${styles.filterChip} ${this.state.selectedLanguage === "ALL" ? styles.filterChipActive : ""}`}
                  onClick={() => this.setState({ selectedLanguage: "ALL" })}
                >
                  All <span className={styles.chipCount}>({this.state.searchResults.length})</span>
                </button>
                {distinctLanguages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`${styles.filterChip} ${this.state.selectedLanguage === lang ? styles.filterChipActive : ""}`}
                    onClick={() => this.setState({ selectedLanguage: lang })}
                  >
                    {lang} <span className={styles.chipCount}>({languageCounts[lang]})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Search Results Display Area */}
            {this.state.loading && (
              <div className={styles.emptyState}>
                <Loader size="sm" color="indigo" />
                <span>Searching subtitle databases...</span>
              </div>
            )}

            {!this.state.loading && filteredResults.length > 0 && (
              <div className={styles.resultsContainer}>
                {filteredResults.map((result) => {
                  const isDownloading = this.state.downloadingId === result.id;
                  const lang = (result.attributes?.language || "EN").toUpperCase();
                  const release =
                    result.attributes?.release ||
                    result.attributes?.files?.[0]?.file_name ||
                    "Subtitle track";
                  const downloadUrl = (result.attributes as any).downloadUrl || "";
                  const isCurrentActive =
                    roomSubtitle &&
                    (roomSubtitle.includes(result.id) ||
                      (downloadUrl && roomSubtitle.includes(downloadUrl)));

                  return (
                    <div
                      key={result.id}
                      className={`${styles.resultCard} ${isCurrentActive ? styles.resultCardActive : ""}`}
                    >
                      <div className={styles.resultInfo}>
                        <div className={styles.resultTitle} title={release}>
                          {release}
                        </div>
                        <div className={styles.resultMeta}>
                          <span className={styles.langBadge}>{lang}</span>
                          <span className={styles.formatBadge}>
                            {result.attributes?.format || "SRT"}
                          </span>
                        </div>
                      </div>

                      {isCurrentActive ? (
                        <Button
                          size="xs"
                          color="teal"
                          variant="light"
                          disabled
                          leftSection={<WPIconCheck size={14} />}
                        >
                          Active
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          color="indigo"
                          variant="filled"
                          loading={isDownloading}
                          disabled={!canControl || isDownloading}
                          onClick={() => this.applyOpenSubtitle(result)}
                          leftSection={
                            isDownloading ? undefined : (
                              <WPIconDownload size={14} />
                            )
                          }
                        >
                          Apply
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!this.state.loading &&
              this.state.hasSearched &&
              this.state.searchResults.length === 0 && (
                <div className={styles.emptyState}>
                  <span>No subtitles found. Try editing the search title above or upload an .srt file.</span>
                </div>
              )}

            {/* Collapsible Direct URL Link Input */}
            <div className={styles.urlToggleRow}>
              <button
                type="button"
                className={styles.urlToggleBtn}
                onClick={() =>
                  this.setState({ showUrlInput: !this.state.showUrlInput })
                }
              >
                {this.state.showUrlInput
                  ? "Hide Direct Subtitle URL"
                  : "+ Direct Subtitle URL"}
              </button>
            </div>

            {this.state.showUrlInput && (
              <div className={styles.urlInputRow}>
                <TextInput
                  style={{ flex: 1 }}
                  size="xs"
                  placeholder="https://.../subtitles.vtt or .srt URL"
                  value={roomSubtitle || ""}
                  disabled={!canControl}
                  onChange={(e) =>
                    this.props.socket.emit("CMD:subtitle", e.target.value)
                  }
                />
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  }
}
