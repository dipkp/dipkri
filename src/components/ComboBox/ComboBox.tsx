import React from "react";
import {
  debounce,
  getMediaPathResults,
  getYouTubeResults,
  isHttp,
  isMagnet,
  isYouTube,
  resolveMediaUrl,
} from "../../utils/utils";
import { examples } from "../../utils/examples";
import ChatVideoCard from "../ChatVideoCard/ChatVideoCard";
import { Autocomplete, type AutocompleteProps } from "@mantine/core";

type ComboBoxProps = {
  roomSetMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  roomMedia: string;
  getMediaDisplayName: (input: string) => string;
  mediaPath: string | undefined;
  disabled?: boolean;
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
      (query && (isHttp(query) || isMagnet(query)))
    ) {
      if (!value && this.props.mediaPath) {
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
        // Create entry from user input
        items = [
          {
            name: query,
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
      return (
        <div
          key={option.value}
          onMouseDown={(e) => {
            // Prevent input from immediately blurring before option click or + Queue fires
            e.preventDefault();
          }}
          onClick={(e) => this.setMediaAndClose(option.value)}
          style={{ width: "100%" }}
        >
          {video && (
            <ChatVideoCard
              video={video}
              index={0}
              onPlaylistAdd={this.props.playlistAdd}
            />
          )}
        </div>
      );
    };
    return (
      <Autocomplete
        maxDropdownHeight={400}
        style={{ width: "100%" }}
        disabled={this.props.disabled}
        onChange={this.onChange}
        styles={{
          input: {
            padding: "0 14px",
            height: "42px",
            fontSize: "14px",
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
                isHttp(currentMedia) || isMagnet(currentMedia)
                  ? currentMedia
                  : getMediaDisplayName(currentMedia),
            },
            () => {
              if (
                !this.state.inputMedia ||
                (this.state.inputMedia &&
                  (isHttp(this.state.inputMedia) ||
                    isMagnet(this.state.inputMedia)))
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
            this.setMediaAndClose(this.state.inputMedia ?? "");
            e.target.blur();
          }
        }}
        placeholder="Enter video file URL, magnet link, YouTube link, or YouTube search term"
        value={
          this.state.inputMedia !== undefined
            ? this.state.inputMedia
            : getMediaDisplayName(currentMedia)
        }
        renderOption={renderOption}
        data={this.state.items.map((item) => item.url)}
        filter={({ options }) => options}
      />
    );
  }
}
