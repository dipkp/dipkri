import React from "react";
import {
  debounce,
  getMediaPathResults,
  getYouTubeResults,
  isHttp,
  isMagnet,
  isYouTube,
  isMovie,
  resolveMediaUrl,
} from "../../utils/utils";
import { examples } from "../../utils/examples";
import ChatVideoCard from "../ChatVideoCard/ChatVideoCard";
import { Autocomplete, type AutocompleteProps } from "@mantine/core";
import { cleanMovieTitle } from "../Controls/Controls";

type ComboBoxProps = {
  roomSetMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  roomMedia: string;
  getMediaDisplayName: (input: string) => string;
  mediaPath: string | undefined;
  disabled?: boolean;
  onOpenMovieModal?: () => void;
};

type ComboBoxState = {
  inputMedia?: string;
  items: SearchResult[];
  loading: boolean;
};

export class ComboBox extends React.Component<ComboBoxProps, ComboBoxState> {
  state: ComboBoxState = {
    inputMedia: undefined as string | undefined,
    items: [] as SearchResult[],
    loading: false,
  };

  private blurTimer: any = null;

  componentWillUnmount() {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
    }
  }

  setMediaAndClose = (value: string) => {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
    }
    const resolved = resolveMediaUrl(value);
    this.props.roomSetMedia(resolved);
    this.setState({ inputMedia: undefined, items: [] });
  };


  doSearch = async () => {
    const rawValue = this.state.inputMedia;
    this.setState({ loading: true });
    const query: string = resolveMediaUrl(rawValue || "");
    let items: SearchResult[] = [];
    if (
      query === "" ||
      // Anything that doesn't pass this check we pass to YouTube as a search query
      (query && (isHttp(query) || isMagnet(query) || isMovie(query)))
    ) {
      if (!query && this.props.mediaPath) {
        items = await getMediaPathResults(this.props.mediaPath, "");
      }
      if (query) {
        let type: SearchResult["type"] = "file";
        if (isYouTube(query)) {
          type = "youtube";
        }
        if (isMagnet(query)) {
          type = "magnet";
        }
        const clean = cleanMovieTitle(query);
        const displayName = clean.title
          ? `${clean.title}${clean.meta ? ` (${clean.meta})` : ""}`
          : (this.props.getMediaDisplayName ? this.props.getMediaDisplayName(query) : query);
        // Create entry from user input
        items = [
          {
            name: displayName,
            channel: isMovie(query)
              ? "🎬 Movie Stream"
              : isMagnet(query)
              ? "🧲 Torrent Stream"
              : "Direct Video Stream",
            type,
            url: query,
            duration: 0,
          },
        ];
      }
    } else {
      const data = await getYouTubeResults(query);
      items = data;
    }
    this.setState({
      loading: false,
      items,
    });
  };

  debouncedSearch = debounce(this.doSearch);

  onChange = (value: string) => {
    this.setState({ inputMedia: value }, this.debouncedSearch);
  };

  render() {
    const { roomMedia: currentMedia, getMediaDisplayName } = this.props;
    const renderOption: AutocompleteProps["renderOption"] = ({ option }) => {
      const video = this.state.items.find((item) => item.url === option.value);
      if (!video) return null;
      return (
        <div
          key={option.value}
          onMouseDown={(e) => {
            // Prevent input from immediately blurring before option click or + Queue fires
            e.preventDefault();
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 6px",
            borderRadius: "8px",
            gap: "8px",
          }}
        >
          <div
            style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
            onClick={() => this.setMediaAndClose(option.value)}
          >
            <ChatVideoCard
              video={video}
              index={0}
              onPlaylistAdd={this.props.playlistAdd}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                this.props.playlistAdd(option.value);
                this.setState({ inputMedia: undefined, items: [] });
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "28px",
                padding: "0 9px",
                borderRadius: "6px",
                border: "1px solid rgba(56, 189, 248, 0.45)",
                background: "rgba(56, 189, 248, 0.15)",
                color: "#38bdf8",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Add to queue"
            >
              + Queue
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                this.setMediaAndClose(option.value);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "28px",
                padding: "0 9px",
                borderRadius: "6px",
                border: "1px solid rgba(34, 197, 94, 0.45)",
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Play immediately"
            >
              ▶ Play
            </button>
          </div>
        </div>
      );
    };
    const hasInput = Boolean(this.state.inputMedia && this.state.inputMedia.trim());
    return (
      <div className="dipkri-combobox-wrapper" style={{ width: "100%", position: "relative" }}>
        <Autocomplete
          className="dipkri-media-combobox"
          maxDropdownHeight={400}
          style={{
            width: "100%",
            ["--combobox-padding-right" as any]: hasInput ? "175px" : "14px",
          }}
          disabled={this.props.disabled}
          onChange={this.onChange}
          onOptionSubmit={(val: string) => this.setMediaAndClose(val)}
          rightSectionWidth={hasInput ? 170 : undefined}
          rightSection={
            hasInput ? (
              <React.Fragment>
                {/* Desktop Action Buttons: 100% opaque solid background so no scrolled text bleeds through */}
                <div className="dipkri-combobox-desktop-actions">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (this.state.inputMedia?.trim()) {
                        const resolved = resolveMediaUrl(this.state.inputMedia.trim());
                        this.props.playlistAdd(resolved);
                        this.setState({ inputMedia: undefined, items: [] });
                      }
                    }}
                    className="dipkri-combobox-pill-queue"
                    title="Add link to queue"
                  >
                    + Queue
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (this.state.inputMedia?.trim()) {
                        this.setMediaAndClose(this.state.inputMedia.trim());
                      }
                    }}
                    className="dipkri-combobox-pill-play"
                    title="Play immediately"
                  >
                    ▶ Play
                  </button>
                </div>

                {/* Mobile Clear Button: Compact icon inside input on mobile */}
                <button
                  type="button"
                  className="dipkri-combobox-mobile-clear"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    this.setState({ inputMedia: undefined, items: [] });
                  }}
                  title="Clear input"
                >
                  ✕
                </button>
              </React.Fragment>
            ) : null
          }
          styles={{
            input: {
              padding: "0 14px",
              paddingRight: hasInput ? "175px" : "14px",
              paddingInlineEnd: hasInput ? "175px" : "14px",
              height: "42px",
              fontSize: "13.5px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              borderColor: "rgba(255, 255, 255, 0.12)",
              borderRadius: "12px",
              textOverflow: "ellipsis",
              boxSizing: "border-box",
            },
          }}
        onFocus={(e: any) => {
          this.setState(
            {
              // Display the real string value (currentMedia) when focused
              inputMedia:
                isHttp(currentMedia) || isMagnet(currentMedia) || isMovie(currentMedia)
                  ? currentMedia
                  : getMediaDisplayName(currentMedia),
            },
            () => {
              if (
                !this.state.inputMedia ||
                (this.state.inputMedia &&
                  (isHttp(this.state.inputMedia) ||
                    isMagnet(this.state.inputMedia) ||
                    isMovie(this.state.inputMedia)))
              ) {
                this.doSearch();
              }
              e.target.select();
            },
          );
        }}
        onBlur={() => {
          if (this.blurTimer) {
            clearTimeout(this.blurTimer);
          }
          this.blurTimer = setTimeout(() => {
            this.setState({
              inputMedia: undefined,
              items: [],
            });
          }, 180);
        }}
        onKeyDown={(e: any) => {
          if (e.key === "Enter") {
            if (!this.state.inputMedia?.trim()) return;
            const resolved = resolveMediaUrl(this.state.inputMedia.trim());
            if (e.shiftKey) {
              this.props.playlistAdd(resolved);
              this.setState({ inputMedia: undefined, items: [] });
              e.target.blur();
            } else {
              this.setMediaAndClose(resolved);
              e.target.blur();
            }
          }
        }}
        placeholder="Paste video URL, YouTube, magnet, stream..."
        value={
          this.state.inputMedia !== undefined
            ? this.state.inputMedia
            : getMediaDisplayName(currentMedia)
        }
        renderOption={renderOption}
        data={this.state.items.map((item) => item.url)}
        filter={({ options }) => options}
      />

        {/* Mobile Action Bar: Thumb-friendly buttons below input on mobile when user types/pastes */}
        {hasInput && (
          <div className="dipkri-combobox-mobile-actions">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (this.state.inputMedia?.trim()) {
                  const resolved = resolveMediaUrl(this.state.inputMedia.trim());
                  this.props.playlistAdd(resolved);
                  this.setState({ inputMedia: undefined, items: [] });
                }
              }}
              className="dipkri-combobox-mobile-btn-queue"
              title="Add link to playlist queue"
            >
              + Add to Queue
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (this.state.inputMedia?.trim()) {
                  this.setMediaAndClose(this.state.inputMedia.trim());
                }
              }}
              className="dipkri-combobox-mobile-btn-play"
              title="Play immediately"
            >
              ▶ Play Now
            </button>
          </div>
        )}
      </div>
    );
  }
}
