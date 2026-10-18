import type MediasoupClient from "mediasoup-client";
import React from "react";
import { Alert, Loader, Menu, Overlay, Select, Title } from "@mantine/core";
import io, { Socket } from "socket.io-client";
import {
  formatSpeed,
  iceServers,
  isMobile,
  serverPath,
  testAutoplay,
  openFileSelector,
  getOrCreateClientId,
  getOrCreateSessionId,
  calculateMedian,
  getUserImage,
  isYouTube,
  isMagnet,
  isHttp,
  isHls,
  isScreenShare,
  isFileShare,
  isDirectVideoUrl,
  pickSingleLargeFile,
  isVBrowser,
  isDash,
  resolveMediaUrl,
  VIDEO_MAX_HEIGHT_CSS,
  softWhite,
  getSavedPasswords,
} from "../../utils/utils";
import { generateName } from "../../utils/generateName";
import { Chat } from "../Chat/Chat";
import { TopBar } from "../TopBar/TopBar";
import { VBrowser } from "../VBrowser/VBrowser";
import { VideoChat } from "../VideoChat/VideoChat";
import { FloatingWebcamBubbles } from "../VideoChat/FloatingWebcamBubbles";
import { getCurrentSettings } from "../Settings/LocalSettings";
import { MultiStreamModal } from "../Modal/MultiStreamModal";
import { ComboBox } from "../ComboBox/ComboBox";
import { SearchComponent } from "../SearchComponent/SearchComponent";
import { Controls } from "../Controls/Controls";
import { SettingsModal } from "../Settings/SettingsModal";
import { ErrorModal } from "../Modal/ErrorModal";
import { PasswordModal } from "../Modal/PasswordModal";
import { ScreenShareModal } from "../Modal/ScreenShareModal";
import { FileShareModal } from "../Modal/FileShareModal";
import {
  ClientTranscoder,
  isClientTranscodeSupported,
} from "../../utils/clientTranscode";
import firebase from "firebase/compat/app";
import { SubtitleModal, cleanMovieTitle } from "../Modal/SubtitleModal";
import { HTML } from "./HTML";
import { YouTube } from "./YouTube";
import styles from "./App.module.css";
import config from "../../config";
import { MetadataContext } from "../../MetadataContext";
import ChatVideoCard from "../ChatVideoCard/ChatVideoCard";
import {
  ActionIcon,
  Badge,
  TextInput,
  Button,
  Switch,
  Tooltip,
} from "@mantine/core";
import {
  WPIconSignal,
  WPIconChevronLeft,
  WPIconChevronRight,
  WPIconFile,
  WPIconKeyboard,
  WPIconPlaylist,
  WPIconScreenshare,
  WPIconSettings,
  WPIconUser,
  WPIconMonitor,
  WPIconPeople,
  WPIconVolumeOn,
  WPIconVolumeOff,
  WPIconClose,
  WPIconChat,
  WPIconPlay,
  WPIconTrash,
  WPIconArrowUp,
  DipkriLogo,
} from "../Icons/CustomIcons";
import {
  MobileFloatingReactions,
  MobileTabBar,
} from "../Mobile/MobileEnhancements";
import { LiveCaptions } from "../LiveCaptions/LiveCaptions";
import { audioEnhancer } from "../PlayerSettings/audioEnhancer";
import { getPlayerSettings, setPlayerSettings } from "../PlayerSettings/playerSettings";
import { InviteButton } from "../InviteButton/InviteButton";
import type WebTorrent from "webtorrent";
import type Hls from "hls.js";
import { type MediaPlayerClass } from "dashjs";
import { type Torrent } from "webtorrent";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: any;
    YT: YT.JsApi;
    watchparty: {
      ourStream: MediaStream | undefined;
      videoRefs: HTMLVideoElementDict;
      videoPCs: PCDict;
      remoteStreams?: { [key: string]: MediaStream };
      webtorrent?: WebTorrent.Instance;
      hls?: Hls;
      dash?: MediaPlayerClass;
    };
  }
}

window.watchparty = {
  ourStream: undefined,
  videoRefs: {},
  videoPCs: {},
  remoteStreams: {},
};

const clientId = getOrCreateClientId();

interface AppProps {
  vanity?: string;
  urlRoomId?: string;
}

interface AppState {
  state: "starting" | "connected";
  roomMedia: string;
  detectedMediaName?: string;
  roomVideoTS?: number;
  roomSubtitle: string;
  roomPaused: boolean;
  roomLoop: boolean;
  participants: User[];
  rosterUpdateTS: Number;
  chat: ChatMessage[];
  playlist: PlaylistVideo[];
  tsMap: NumberDict;
  nameMap: StringDict;
  pictureMap: StringDict;
  myName: string;
  myPicture: string;
  loading: boolean;
  scrollTimestamp: number;
  unreadCount: number;
  fullScreen: boolean;
  controlsTimestamp: number;
  watchOptions: SearchResult[];
  isVBrowser: boolean;
  isAutoPlayable: boolean;
  downloaded: number;
  total: number;
  speed: number;
  connections: number;
  fileSelection: {
    name: string;
    url: string;
    length: number;
    playFn?: () => void;
  }[];
  overlayMsg: string;
  isErrorAuth: boolean;
  settings: Settings;
  vBrowserResolution: string;
  vBrowserQuality: string;
  isVBrowserLarge: boolean;
  nonPlayableMedia: boolean;
  currentTab: string;
  isSubscribeModalOpen: boolean;
  isVBrowserModalOpen: boolean;
  isScreenShareModalOpen: boolean;
  isFileShareModalOpen: boolean;
  isSubtitleModalOpen: boolean;
  isMultiSelectModalOpen: boolean;
  roomLock: string;
  controller?: string;
  savedPasswords: StringDict;
  roomId: string;
  errorMessage: string;
  successMessage: string;
  warningMessage: string;
  isChatDisabled: boolean;
  showChatColumn: boolean;
  showPeopleColumn: boolean;
  owner: string | undefined;
  vanity: string | undefined;
  password: string | undefined;
  inviteLink: string;
  roomTitle: string | undefined;
  roomDescription: string | undefined;
  roomTitleColor: string | undefined;
  mediaPath: string | undefined;
  roomPlaybackRate: number;
  isLiveStream: boolean;
  settingsModalOpen: boolean;
  convertProgress: number | undefined;
  convertEnabled: boolean;
  isMobileView: boolean;
  isKeyboardOpen: boolean;
  isTyping: boolean;
  incomingReaction: { emoji: string; ts: number; senderId?: string } | null;
  desktopSidebarTab?: "chat" | "people" | "playlist" | "settings";
  audioBoost: number;
  copiedLink: boolean;
  quickQueueUrl: string;
}

const checkIsMobileDevice = () => {
  if (typeof window === "undefined") return false;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("view") === "mobile") return true;
    if (urlParams.get("view") === "desktop") return false;

    const isMobileUA =
      typeof navigator !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
        navigator.userAgent,
      );
    const isLandscapePhone = window.matchMedia(
      "(max-width: 950px) and (max-height: 520px)",
    ).matches;
    return (
      window.innerWidth <= 768 ||
      (typeof window.screen !== "undefined" && window.screen.width <= 768) ||
      isLandscapePhone ||
      isMobile() ||
      Boolean(isMobileUA)
    );
  } catch {
    return window.innerWidth <= 768 || isMobile();
  }
};

export class App extends React.Component<AppProps, AppState> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  state: AppState = {
    state: "starting",
    isMobileView: checkIsMobileDevice(),
    isKeyboardOpen: false,
    isTyping: false,
    desktopSidebarTab: "chat",
    roomMedia: "",
    detectedMediaName: "",
    roomVideoTS: 0,
    roomPaused: false,
    roomSubtitle: "",
    roomLoop: false,
    participants: [],
    rosterUpdateTS: Date.now(),
    chat: [],
    playlist: [],
    quickQueueUrl: "",
    tsMap: {},
    nameMap: {},
    pictureMap: {},
    myName: window.localStorage.getItem("watchparty-username") ?? "",
    myPicture: "",
    loading: true,
    scrollTimestamp: 0,
    unreadCount: 0,
    fullScreen: false,
    controlsTimestamp: 0,
    watchOptions: [],
    isVBrowser: false,
    isAutoPlayable: true,
    downloaded: 0,
    total: 0,
    speed: 0,
    connections: 0,
    fileSelection: [],
    overlayMsg: "",
    isErrorAuth: false,
    settings: {},
    vBrowserResolution: "1280x720@30",
    vBrowserQuality: "1",
    isVBrowserLarge: false,
    nonPlayableMedia: false,
    currentTab:
      new URLSearchParams(window.location.search).get("tab") ?? "chat",
    isSubscribeModalOpen: false,
    isVBrowserModalOpen: false,
    isScreenShareModalOpen: false,
    isFileShareModalOpen: false,
    isSubtitleModalOpen: false,
    isMultiSelectModalOpen: false,
    roomLock: "",
    controller: "",
    roomId: "",
    savedPasswords: {},
    errorMessage: "",
    successMessage: "",
    warningMessage: "",
    isChatDisabled: false,
    showChatColumn: isMobile()
      ? true
      : Boolean(
          Number(
            window.localStorage.getItem("watchparty-showchatcolumn") ?? "1",
          ),
        ),
    showPeopleColumn: false,
    // Boolean(
    //       Number(
    //         window.localStorage.getItem('watchparty-showpeoplecolumn') ?? '0',
    //       ),
    //     ),
    owner: undefined,
    vanity: undefined,
    password: undefined,
    inviteLink: "",
    roomTitle: "",
    roomDescription: "",
    roomTitleColor: "",
    mediaPath: undefined,
    roomPlaybackRate: 0,
    isLiveStream: false,
    settingsModalOpen: false,
    convertProgress: undefined,
    convertEnabled: window.localStorage.getItem("watchparty-convert") === "1",
    incomingReaction: null,
    audioBoost: getPlayerSettings().audioBoost || 100,
    copiedLink: false,
  };
  socket: Socket = null!;
  videoChatRef = React.createRef<VideoChat>();
  mediasoupPubSocket: Socket | null = null;
  mediasoupSubSocket: Socket | null = null;
  ytDebounce = true;
  localStreamToPublish?: MediaStream;
  isLocalStreamAFile = false;
  transcoder?: ClientTranscoder;
  publisherConns: PCDict = {};
  consumerConn?: RTCPeerConnection;
  progressUpdater?: number;
  heartbeat: number | undefined = undefined;
  tsInterval: number | undefined = undefined;
  YouTubeInterface: YouTube = new YouTube(null);
  HTMLInterface: HTML = new HTML("leftVideo");
  Player = () => {
    if (this.usingYoutube()) {
      return this.YouTubeInterface;
    } else {
      return this.HTMLInterface;
    }
  };

  chatRef = React.createRef<Chat>();

  savePlaybackTime = (
    roomId: string,
    media: string,
    time: number,
    paused: boolean,
  ) => {
    if (!roomId || !media || typeof time !== "number" || time <= 0) return;
    try {
      const cleanRoomId = roomId.replace(/^\//, "");
      const payload = JSON.stringify({
        media,
        time,
        paused,
        updatedAt: Date.now(),
      });
      sessionStorage.setItem(`wp_playback_${cleanRoomId}`, payload);
      localStorage.setItem(`wp_playback_${cleanRoomId}`, payload);
      localStorage.setItem("wp_last_room", cleanRoomId);

      let mediaTitle = this.state.roomTitle || "";
      if (!mediaTitle && media) {
        if (media.startsWith("magnet:")) {
          const dnMatch = media.match(/[?&]dn=([^&]+)/);
          if (dnMatch) {
            mediaTitle = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
          }
        } else if (media.includes("youtube.com") || media.includes("youtu.be")) {
          mediaTitle = "YouTube Video";
        } else {
          try {
            const urlObj = new URL(media);
            const pathParts = urlObj.pathname.split("/").filter(Boolean);
            if (pathParts.length > 0) {
              mediaTitle = decodeURIComponent(pathParts[pathParts.length - 1]);
            }
          } catch {}
        }
      }

      const activeParty = {
        roomId: cleanRoomId,
        roomTitle: this.state.roomTitle || undefined,
        mediaTitle: mediaTitle || undefined,
        savedTime: Math.floor(time || 0),
        paused: Boolean(paused),
        updatedAt: Date.now(),
      };
      localStorage.setItem("wp_active_party", JSON.stringify(activeParty));
    } catch {}
  };

  getSavedPlaybackTime = (roomId: string, media?: string): number => {
    if (!roomId) return 0;
    try {
      const cleanRoomId = roomId.replace(/^\//, "");
      const raw =
        sessionStorage.getItem(`wp_playback_${cleanRoomId}`) ||
        localStorage.getItem(`wp_playback_${cleanRoomId}`);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      if (media && data.media && data.media !== media) {
        return 0;
      }
      if (typeof data.time === "number" && data.time > 0) {
        if (!data.updatedAt || Date.now() - data.updatedAt < 48 * 60 * 60 * 1000) {
          return data.time;
        }
      }
    } catch {}
    return 0;
  };

  handleBeforeUnload = () => {
    if (this.state.roomMedia && this.state.roomId) {
      const curTime = this.Player().getCurrentTime();
      if (curTime > 0) {
        this.savePlaybackTime(
          this.state.roomId,
          this.state.roomMedia,
          curTime,
          this.state.roomPaused,
        );
      }
    }
  };

  handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.handleBeforeUnload();
    }
  };

  initialScreenHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  updateViewportMetrics = () => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const heightDiff = this.initialScreenHeight - height;
    const isKeyboardOpen = heightDiff > 120 || this.state.isTyping;
    const keyboardHeight = Math.max(0, heightDiff);

    document.documentElement.style.setProperty(
      "--visual-viewport-height",
      `${height}px`,
    );
    document.documentElement.style.setProperty(
      "--keyboard-height",
      `${keyboardHeight}px`,
    );

    // Force scroll position to 0 on mobile to guarantee video never leaves frame
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }

    if (this.state.isKeyboardOpen !== isKeyboardOpen) {
      this.setState({ isKeyboardOpen });
    }
  };

  onWindowScroll = () => {
    if (this.state.isMobileView && window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  };

  async componentDidMount() {
    document.onfullscreenchange = this.onFullScreenChange;
    document.onkeydown = this.onKeydown;
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.handleResize);

    this.updateViewportMetrics();
    if (typeof window !== "undefined") {
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", this.updateViewportMetrics);
        window.visualViewport.addEventListener("scroll", this.updateViewportMetrics);
      }
      window.addEventListener("scroll", this.onWindowScroll);
    }

    // Send heartbeat to the server
    this.heartbeat = window.setInterval(
      () => {
        fetch(serverPath + "/ping");
      },
      10 * 60 * 1000,
    );

    window.addEventListener("beforeunload", this.handleBeforeUnload);
    window.addEventListener("pagehide", this.handleBeforeUnload);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    const canAutoplay = await testAutoplay();
    this.setState({ isAutoPlayable: canAutoplay });
    this.loadSettings();
    this.loadYouTube();
    this.init();
    if (config.VITE_FIREBASE_CONFIG) {
      firebase.auth().onAuthStateChanged(async (user: firebase.User | null) => {
        if (user) {
          this.loadSignInData(user);
        }
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    window.removeEventListener("pagehide", this.handleBeforeUnload);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    // Assigned as document properties in componentDidMount, so
    // removeEventListener() never removed them (they kept firing after unmount).
    document.onfullscreenchange = null;
    document.onkeydown = null;
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("orientationchange", this.handleResize);
    if (typeof window !== "undefined") {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", this.updateViewportMetrics);
        window.visualViewport.removeEventListener("scroll", this.updateViewportMetrics);
      }
      window.removeEventListener("scroll", this.onWindowScroll);
    }
    window.clearInterval(this.heartbeat);
    window.clearInterval(this.tsInterval);
  }

  handleResize = () => {
    const isMobileView = checkIsMobileDevice();
    if (isMobileView !== this.state.isMobileView) {
      this.setState({ isMobileView });
    }
    this.updateViewportMetrics();
  };

  init = async () => {
    let roomId = "/" + this.props.urlRoomId;
    // if a vanity name, resolve the url to a room id
    if (this.props.vanity) {
      const resp = await fetch(
        serverPath + "/resolveRoom/" + this.props.vanity,
      );
      if (!resp.ok) {
        this.setState({ overlayMsg: "Couldn't load this room." });
        return;
      }
      const data = await resp.json();
      if (!data?.roomId) {
        this.setState({ overlayMsg: "Couldn't load this room." });
        return;
      }
      roomId = data.roomId;
    }
    const cleanRoomId = roomId.replace(/^\//, "");
    if (cleanRoomId) {
      try {
        localStorage.setItem("wp_last_room", cleanRoomId);
      } catch {}
    }
    this.setState({ roomId }, () => {
      this.join(roomId);
    });
  };

  join = async (roomId: string) => {
    const password = getSavedPasswords()[roomId] ?? "";
    const response = await fetch(serverPath + "/resolveShard" + roomId);
    const shard = Number(await response.text()) || "";
    const socket = io(serverPath + roomId, {
      transports: ["websocket"],
      query: {
        clientId,
        password,
        shard,
        roomId: roomId.slice(1),
      },
      auth: {
        sessionId: getOrCreateSessionId(),
      },
    });
    this.socket = socket;
    (window as any).watchparty = (window as any).watchparty || {};
    (window as any).watchparty.socket = socket;
    (window as any).watchparty.app = this;
    socket.on("connect", async () => {
      this.setState({
        state: "connected",
        overlayMsg: "",
        errorMessage: "",
        successMessage: "",
        warningMessage: "",
      });
      // Use the Google user name, custom name, or generated name
      const googleName =
        this.context.user?.displayName ||
        this.context.user?.email?.split("@")[0];
      const customName =
        typeof window !== "undefined"
          ? window.localStorage.getItem("watchparty-custom-name")
          : null;
      const initialName =
        customName || googleName || this.state.myName || (await generateName());
      this.updateName(initialName);
      this.loadSignInData(this.context.user);
      // Re-join video chat if we were in it before the reconnection
      if (window.watchparty.ourStream) {
        socket.emit("CMD:joinVideo");
      }
    });
    socket.on("connect_error", (err: any) => {
      console.warn("Socket connect_error (will retry):", err);
      if (err?.message === "Invalid namespace") {
        this.setState({ overlayMsg: "Couldn't load this room." });
      } else if (err?.message === "password") {
        this.setState({ isErrorAuth: true });
      } else {
        // Socket.io automatically reconnects; show non-blocking notice rather than blocking modal
        this.setState({ warningMessage: "Connecting to server..." });
      }
    });
    socket.on("disconnect", (reason) => {
      if (reason === "io server disconnect") {
        // the disconnection was initiated by the server, you need to reconnect manually
        this.setState({ overlayMsg: "Disconnected from server." });
      } else {
        // else the socket will automatically try to reconnect
        // Use the alert pill since it's less disruptive
        this.setState({ warningMessage: "Reconnecting..." });
      }
    });
    socket.on("errorMessage", (err: string) => {
      this.setState({ errorMessage: err });
      setTimeout(() => {
        this.setState({ errorMessage: "" });
      }, 3000);
    });
    socket.on("successMessage", (success: string) => {
      this.setState({ successMessage: success });
      setTimeout(() => {
        this.setState({ successMessage: "" });
      }, 3000);
    });
    socket.on("kicked", () => {
      window.location.assign("/");
    });
    socket.on("REC:play", () => {
      this.localPlay();
    });
    socket.on("REC:pause", () => {
      this.localPause();
    });
    socket.on("REC:seek", (data: number) => {
      this.localSeek(data);
    });
    socket.on("REC:playbackRate", (data: number) => {
      this.setState({ roomPlaybackRate: data });
      if (data > 0) {
        this.Player().setPlaybackRate(data);
      }
    });
    socket.on("REC:subtitle", (data: string) => {
      this.setState({ roomSubtitle: data }, () => {
        this.Player().loadSubtitles(data);
      });
    });
    socket.on("REC:loop", (data: boolean) => {
      this.setState({ roomLoop: data });
    });
    socket.on("REC:changeController", (data: string) => {
      this.setState({ controller: data });
    });
    socket.on("REC:host", async (data: HostState) => {
      let currentMedia = resolveMediaUrl(data.video || "");
      if (this.playingScreenShare() && !isScreenShare(currentMedia)) {
        this.stopPublishingLocalStream();
      }
      if (this.playingFileShare() && !isFileShare(currentMedia)) {
        this.stopPublishingLocalStream();
      }
      if (this.playingVBrowser() && !isVBrowser(currentMedia)) {
        this.stopVBrowser();
      }
      if (this.playingScreenShare() && isScreenShare(currentMedia)) {
        // Ignore, it's probably a reconnection
        return;
      }
      if (this.playingFileShare() && isFileShare(currentMedia)) {
        // Ignore, it's probably a reconnection
        return;
      }
      if (
        this.playingVBrowser() &&
        this.getVBrowserHost() &&
        isVBrowser(currentMedia)
      ) {
        // Ignore, it's probably a reconnection
        return;
      }
      this.setState(
        {
          roomMedia: currentMedia,
          roomVideoTS: data.videoTS ?? 0,
          roomPaused: data.paused,
          roomSubtitle: data.subtitle,
          roomLoop: data.loop,
          roomPlaybackRate: data.playbackRate,
          loading: Boolean(data.video),
          nonPlayableMedia: false,
          isVBrowserLarge: data.isVBrowserLarge,
          vBrowserResolution: "1280x720@30",
          vBrowserQuality: "1",
          controller: data.controller,
          isLiveStream: false,
        },
        async () => {
          const displayName = this.getMediaDisplayName(currentMedia);
          audioEnhancer.setMediaName(displayName || currentMedia, currentMedia);
          const leftVideo = this.HTMLInterface.getVideoEl();

          // Stop all players
          // Unless the user is sharing a file, because we play it in leftVideo and capture stream
          if (!this.isLocalStreamAFile) {
            this.stopConvert();
            this.HTMLInterface.pauseVideo();
          }
          this.YouTubeInterface.stopVideo();

          if (!this.isLocalStreamAFile) {
            this.Player().clearState();
          }
          if (data.subtitle) {
            this.setState({ roomSubtitle: data.subtitle });
            this.Player().loadSubtitles(data.subtitle);
          } else if (currentMedia && !data.subtitle) {
            // Auto-detect and attach embedded subtitle files for torrent streams if present
            const detectTorrentSubtitles = async () => {
              if (this.state.roomSubtitle) return;
              if (currentMedia.includes("/stream?torrent=") || currentMedia.startsWith("magnet:")) {
                const dataUrl = currentMedia.includes("/stream?")
                  ? currentMedia.replace("/stream?", "/data?")
                  : `${serverPath}/data?torrent=${encodeURIComponent(currentMedia)}`;

                for (let attempt = 0; attempt < 5; attempt++) {
                  if (this.state.roomSubtitle) return;
                  try {
                    const resp = await fetch(dataUrl);
                    if (resp.ok) {
                      const meta = await resp.json();
                      if (meta?.name) {
                        this.setState({ detectedMediaName: meta.name });
                        audioEnhancer.setMediaName(meta.name, currentMedia);
                      }
                      if (meta?.files && Array.isArray(meta.files)) {
                        const subFile = meta.files.find((f: any) =>
                          f.name?.toLowerCase().endsWith(".srt") || f.name?.toLowerCase().endsWith(".vtt")
                        );
                        if (subFile) {
                          const base = currentMedia.includes("&fileIndex=")
                            ? currentMedia.split("&fileIndex=")[0]
                            : currentMedia;
                          const subUrl = `${base}&fileIndex=${subFile.index}`;
                          this.setState({ roomSubtitle: subUrl });
                          this.Player().loadSubtitles(subUrl);
                          return;
                        }
                      }
                      // Check for embedded subtitle tracks inside MKV / video file via /streamInfo
                      if (!this.state.roomSubtitle) {
                        try {
                          let fileIndexParam = "";
                          const fIdxMatch = currentMedia.match(/[?&]fileIndex=(\d+)/i) || currentMedia.match(/%26fileIndex%3D(\d+)/i);
                          if (fIdxMatch) {
                            fileIndexParam = `&fileIndex=${fIdxMatch[1]}`;
                          }
                          let cleanTorrent = currentMedia.replace(/^.*\/stream\?torrent=/, "");
                          const cutIdx = cleanTorrent.indexOf("&fileIndex=");
                          if (cutIdx !== -1) {
                            cleanTorrent = cleanTorrent.slice(0, cutIdx);
                          }
                          try {
                            cleanTorrent = decodeURIComponent(cleanTorrent);
                          } catch {}

                          const infoRes = await fetch(`${serverPath}/streamInfo?torrent=${encodeURIComponent(cleanTorrent)}${fileIndexParam}`);
                          if (infoRes.ok) {
                            const infoData = await infoRes.json();
                            if (infoData?.subtitleTracks && Array.isArray(infoData.subtitleTracks) && infoData.subtitleTracks.length > 0) {
                              const chosenSub =
                                infoData.subtitleTracks.find((t: any) => /english|eng|\ben\b/i.test(t.label || t.language || "")) ||
                                infoData.subtitleTracks[0];
                              if (chosenSub) {
                                const subUrl = `${serverPath}/streamSubtitle?torrent=${encodeURIComponent(cleanTorrent)}&streamIndex=${chosenSub.streamIndex}${fileIndexParam}`;
                                this.setState({ roomSubtitle: subUrl });
                                this.Player().loadSubtitles(subUrl);
                                return;
                              }
                            }
                          }
                        } catch (subErr) {
                          console.warn("[Embedded Subtitle notice]:", subErr);
                        }
                      }

                      // If no embedded subtitle file found, automatically search OpenSubtitles!
                      if (!this.state.roomSubtitle) {
                        try {
                          const movieTitle = meta?.name || this.getMediaDisplayName(currentMedia);
                          if (movieTitle && movieTitle !== "Torrent" && movieTitle !== "Torrent Stream") {
                            const osRes = await fetch(`${serverPath}/searchSubtitles?query=${encodeURIComponent(movieTitle)}&lang=en`);
                            if (osRes.ok) {
                              const osList = await osRes.json();
                              if (Array.isArray(osList) && osList.length > 0) {
                                const firstSub = osList[0];
                                const fileId = firstSub.attributes?.files?.[0]?.file_id;
                                const downloadUrl = firstSub.attributes?.downloadUrl || "";
                                if (fileId || downloadUrl) {
                                  const dlParams = new URLSearchParams();
                                  if (downloadUrl) dlParams.set("downloadUrl", downloadUrl);
                                  if (fileId) dlParams.set("file_id", fileId);
                                  const dlResp = await fetch(`${serverPath}/downloadSubtitles?${dlParams.toString()}`);
                                  if (dlResp.ok) {
                                    const dlData = await dlResp.json();
                                    if (dlData?.link) {
                                      const fullSubLink = serverPath + dlData.link;
                                      this.setState({ roomSubtitle: fullSubLink });
                                      this.Player().loadSubtitles(fullSubLink);
                                      return;
                                    }
                                  }
                                }
                              }
                            }
                          }
                        } catch (osErr) {
                          console.warn("[OpenSubtitles Automation notice]:", osErr);
                        }
                      }
                      if (meta?.name) break;
                    }
                  } catch {}
                  await new Promise((r) => setTimeout(r, 1200));
                }
              }
            };
            detectTorrentSubtitles();
          }
          if (data.playbackRate) {
            this.Player().setPlaybackRate(data.playbackRate);
          }

          if (
            this.playingScreenShare() ||
            this.playingFileShare() ||
            this.playingVBrowser()
          ) {
            console.log(
              "exiting REC:host since we are using webRTC (fileshare, screenshare, or vbrowser). Check setupRTCConnections()",
            );
            if (!(this.playingVBrowser() && !this.getVBrowserHost())) {
              // Remove the loader unless we're waiting for a vbrowser
              this.setLoadingFalse();
            }
            if (this.playingScreenShare() || this.playingFileShare()) {
              this.setupRTCConnections();
            }
            return;
          }
          if (
            !this.playingScreenShare() &&
            !this.playingFileShare() &&
            this.consumerConn
          ) {
            try {
              this.consumerConn.close();
            } catch {}
            this.consumerConn = undefined;
            const leftVideo = this.HTMLInterface.getVideoEl();
            if (leftVideo && leftVideo.srcObject) {
              leftVideo.srcObject = null;
            }
          }
          if (this.usingYoutube() && !this.YouTubeInterface.isReady()) {
            console.log(
              "YT player not ready, onReady callback will retry when it is",
            );
            return;
          }
          const src = resolveMediaUrl(data.video);
          let time = data.videoTS ?? 0;
          if (time <= 0 && src) {
            const savedTime = this.getSavedPlaybackTime(this.state.roomId, src);
            if (savedTime > 0) {
              time = savedTime;
              try {
                this.socket.emit("CMD:seek", this.getRoomTSToSet(savedTime));
              } catch {}
            }
          }

          // Clean up any lingering Hls/Dash instances from previous stream
          if (window.watchparty?.hls) {
            try {
              window.watchparty.hls.destroy();
            } catch {}
            window.watchparty.hls = undefined;
          }
          if (window.watchparty?.dash) {
            try {
              window.watchparty.dash.destroy();
            } catch {}
            window.watchparty.dash = undefined;
          }

          if (isMagnet(src) || src.includes("/stream?torrent=")) {
            // Direct streaming via server endpoint (supports public BitTorrent swarms, UDP trackers, and DHT)
            const streamUrl = isMagnet(src)
              ? `/stream?torrent=${encodeURIComponent(src)}`
              : src;
            await this.Player().setSrcAndTime(streamUrl, time);
          } else if (isDash(src)) {
            const Dash = await import("dashjs");
            window.watchparty.dash = Dash.MediaPlayer().create();
            window.watchparty.dash.on("streamInitialized", (_e: any) => {
              const isLiveStream = this.Player().getDuration() >= Infinity;
              console.log("DASH stream initialized: isLive %s", isLiveStream);
              this.setState({
                isLiveStream,
              });
            });
            window.watchparty.dash.initialize(leftVideo, src);
          } else if (isHls(src) && window.MediaSource) {
            // Prefer using hls.js if MediaSource Extensions are supported
            const Hls = (await import("hls.js")).default;
            if (Hls.isSupported()) {
              if (leftVideo) {
                leftVideo.removeAttribute("src");
                leftVideo.src = "";
                leftVideo.load();
              }
              const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
              });
              window.watchparty.hls = hls;

              hls.on(Hls.Events.ERROR, (_e: any, hlsData: any) => {
                if (hlsData.fatal) {
                  switch (hlsData.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      console.warn("[HLS] Network error, recovering...", hlsData);
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.warn("[HLS] Media error, recovering...", hlsData);
                      hls.recoverMediaError();
                      break;
                    default:
                      console.warn("[HLS] Fatal error, destroying instance:", hlsData);
                      hls.destroy();
                      window.watchparty.hls = undefined;
                      if (leftVideo && leftVideo.canPlayType("application/vnd.apple.mpegurl")) {
                        leftVideo.src = src;
                      } else {
                        if (leftVideo) {
                          leftVideo.src = src;
                        }
                        this.setLoadingFalse();
                      }
                      break;
                  }
                }
              });

              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.setLoadingFalse();
                this.setState({ nonPlayableMedia: false });
                if (time > 0 && leftVideo) {
                  try {
                    leftVideo.currentTime = time;
                  } catch {}
                }
                if (!data.paused) {
                  this.localPlay();
                }
              });

              hls.on(Hls.Events.LEVEL_LOADED, (_, lvlData: any) => {
                const isLiveStream = lvlData?.details?.live;
                this.setState({ isLiveStream });
                console.log("HLS level loaded: isLive %s", isLiveStream);
              });

              hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
                window.dispatchEvent(new CustomEvent("watchparty-audio-tracks-updated"));
              });

              hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_: any, data: any) => {
                if (typeof data?.id === "number") {
                  setPlayerSettings({ audioTrack: data.id });
                }
              });

              hls.loadSource(src);
              hls.attachMedia(leftVideo);
            } else if (leftVideo && leftVideo.canPlayType("application/vnd.apple.mpegurl")) {
              await this.Player().setSrcAndTime(src, time);
            }
          } else if (
            this.state.convertEnabled &&
            isClientTranscodeSupported() &&
            isDirectVideoUrl(src)
          ) {
            await this.convertAndPlay(src, time);
          } else {
            await this.Player().setSrcAndTime(src, time);
          }

          // Listen for canplay to safely finalize time and playback state
          leftVideo?.addEventListener(
            "canplay",
            () => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });

              // Restore playback position on refresh or load
              let ts = typeof time === "number" && time > 0 ? time : undefined;
              if (ts === undefined) {
                const savedTime = this.getSavedPlaybackTime(this.state.roomId, src);
                if (savedTime > 0) {
                  ts = savedTime;
                }
              }
              const leader = this.getLeaderTime();
              if (leader > 0) {
                ts = leader;
              }
              if (ts !== undefined && ts > 0) {
                this.localSeek(ts);
              }
              if (data.playbackRate) {
                this.Player().setPlaybackRate(data.playbackRate);
              }
              if (!data.paused && leftVideo.paused) {
                this.localPlay();
              }
            },
            { once: true },
          );

          // Progress updater
          window.clearInterval(this.progressUpdater);
          this.setState({ downloaded: 0, total: 0, speed: 0, connections: 0 });
          if (currentMedia.includes("/stream?torrent=") || isMagnet(currentMedia)) {
            const progressUrl = currentMedia.includes("/stream")
              ? currentMedia.replace("/stream", "/progress")
              : `/progress?torrent=${encodeURIComponent(currentMedia)}`;
            this.progressUpdater = window.setInterval(async () => {
              try {
                const response = await fetch(progressUrl);
                const data = await response.json();
                this.setState({
                  downloaded: data.downloaded,
                  total: data.total,
                  speed: data.speed,
                  connections: data.connections,
                });
              } catch {
                // ignore
              }
            }, 1000);
          }
        },
      );
    });
    socket.on("REC:chat", (data: ChatMessage) => {
      if (
        !getCurrentSettings().disableChatSound &&
        !data.system &&
        ((document.visibilityState && document.visibilityState !== "visible") ||
          this.state.currentTab !== "chat")
      ) {
        new Audio("/clearly.mp3").play();
      }
      this.state.chat.push(data);
      if (this.state.chat.length > 100) {
        this.state.chat.shift();
      }

      const REACTION_EMOJIS = ["🔥", "❤️", "🤣", "🚀", "👏", "🍿"];
      const trimmed = (data.msg || "").trim();
      const isReaction = REACTION_EMOJIS.includes(trimmed);

      const isChatVisible =
        this.state.currentTab === "chat" &&
        (this.state.isMobileView || this.state.showChatColumn);

      if (isChatVisible) {
        socket.emit("CMD:chatSeen");
      }

      this.setState({
        chat: [...this.state.chat],
        scrollTimestamp: Date.now(),
        unreadCount: isChatVisible ? 0 : this.state.unreadCount + 1,
        incomingReaction: isReaction
          ? { emoji: trimmed, ts: Date.now(), senderId: data.id }
          : this.state.incomingReaction,
      });
    });
    socket.on("REC:chatSeen", ({ seenBy }: { seenBy: string }) => {
      let updated = false;
      const newChat = this.state.chat.map((msg) => {
        if (msg.id !== seenBy) {
          const seen = msg.seenBy || [];
          if (!seen.includes(seenBy)) {
            updated = true;
            return { ...msg, seenBy: [...seen, seenBy] };
          }
        }
        return msg;
      });
      if (updated) {
        this.setState({ chat: newChat });
      }
    });
    socket.on("REC:reaction", (data: { emoji: string; senderId?: string; ts?: number }) => {
      this.setState({
        incomingReaction: {
          emoji: data.emoji,
          ts: data.ts || Date.now(),
          senderId: data.senderId,
        },
      });
    });
    socket.on("REC:addReaction", (data: Reaction) => {
      const { chat } = this.state;
      const msgIndex = chat.findIndex(
        (m) => m.id === data.msgId && m.timestamp === data.msgTimestamp,
      );
      if (msgIndex === -1) {
        return;
      }
      const msg = chat[msgIndex];
      msg.reactions = msg.reactions || {};
      msg.reactions[data.value] = msg.reactions[data.value] || [];
      if (!msg.reactions[data.value].includes(data.user)) {
        msg.reactions[data.value].push(data.user);
      }
      this.setState({ chat: [...chat] }, () => {
        // if we add a reaction to the last message we need to scroll down
        // or else the reaction icon might be hidden
        if (
          msgIndex === chat.length - 1 &&
          this.chatRef.current?.state.isNearBottom
        ) {
          this.chatRef.current?.scrollToBottom();
        }
      });
    });
    socket.on("REC:removeReaction", (data: Reaction) => {
      const { chat } = this.state;
      const msg = chat.find(
        (m) => m.id === data.msgId && m.timestamp === data.msgTimestamp,
      );
      if (!msg || !msg.reactions?.[data.value]) {
        return;
      }
      msg.reactions[data.value] = msg.reactions[data.value].filter(
        (id) => id !== data.user,
      );
      this.setState({ chat: [...chat] });
    });
    socket.on("REC:tsMap", (data: NumberDict) => {
      this.setState({ tsMap: data }, () => {
        // Dynamic playback rate based on timestamps
        // Disable for sharing types where the users can have different timestamps
        // e.g. screenshare, fileshare, .m3u8 HLS streams
        // Also not necessary for WebRTC sharing since it should be close to realtime
        if (
          !this.state.roomPaused &&
          !this.state.isLiveStream &&
          this.hasDuration() &&
          this.state.roomPlaybackRate === 0
        ) {
          const leader = this.getLeaderTime();
          const delta = leader - data[clientId];
          // Set leader pbr to 1
          let pbr = 1;
          // Add .01 pbr for each 100ms delay
          if (delta > 0.5) {
            pbr += Number((delta / 10).toFixed(2));
            pbr = Math.min(pbr, 1.1);
          }
          // console.log(delta, pbr);
          if (this.Player().getPlaybackRate() !== pbr) {
            this.Player().setPlaybackRate(pbr);
          }
        }
        if (this.state.roomSubtitle) {
          const sharer = this.state.participants.find((p) => p.isScreenShare);
          if (sharer && sharer.id !== clientId) {
            // Sync only if someone is sharing and it's not us
            const sharerTime = this.state.tsMap[sharer.id];
            this.Player().syncSubtitles(sharerTime);
          }
        }
      });
    });
    socket.on("REC:nameMap", (data: StringDict) => {
      this.setState({ nameMap: data });
    });
    socket.on("REC:pictureMap", (data: StringDict) => {
      this.setState({ pictureMap: data });
    });
    socket.on("REC:lock", (data: string) => {
      this.setState({ roomLock: data });
    });
    socket.on("roster", (data: User[]) => {
      this.setState({ participants: data, rosterUpdateTS: Date.now() }, () => {
        this.setupRTCConnections();
      });
    });
    socket.on("chatinit", (data: ChatMessage[]) => {
      this.setState({ chat: data, scrollTimestamp: Date.now() });
    });
    socket.on("playlist", (data: PlaylistVideo[]) => {
      this.setState({ playlist: data });
    });
    socket.on(
      "signalSS",
      async (data: {
        msg: { ice: any; sdp: any };
        from: string;
        sharer: boolean;
      }) => {
        config.NODE_ENV === "development" && console.log("signalSS:", data);
        const msg = data.msg;
        const from = data.from;
        const selfId = getOrCreateClientId();
        if (from === selfId) return; // Prevent self-signaling loopback

        // Determine whether the message came from the sharer or the sharee
        let pc = (
          data.sharer ? this.consumerConn : this.publisherConns[from]
        ) as RTCPeerConnection | undefined;

        // If the sharer contacted us (watcher) but consumerConn wasn't created yet, create it on-demand
        if (data.sharer && !pc) {
          pc = new RTCPeerConnection({ iceServers: iceServers() });
          this.consumerConn = pc;
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              this.sendSignalSS(from, { ice: event.candidate });
            }
          };
          pc.ontrack = (event: RTCTrackEvent) => {
            const leftVideo = this.HTMLInterface.getVideoEl();
            if (leftVideo) {
              leftVideo.src = "";
              leftVideo.srcObject = event.streams[0];
              leftVideo.playsInline = true;
              leftVideo.muted = true;
              leftVideo.play().then(() => {
                leftVideo.muted = false;
              }).catch(() => {});
              this.setLoadingFalse();
            }
          };
        }

        if (!pc) {
          console.warn("No peer connection ready for signalSS from", from);
          return;
        }

        if (msg.ice !== undefined) {
          try {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.ice));
            } else {
              if (!(pc as any)._iceQueue) (pc as any)._iceQueue = [];
              (pc as any)._iceQueue.push(msg.ice);
            }
          } catch (err) {
            console.warn("addIceCandidate failed in signalSS:", err);
          }
        } else if (msg.sdp && msg.sdp.type === "offer") {
          try {
            const _sdp = msg.sdp.sdp
              .split("\n")
              .filter((line: string) => {
                return line.trim() !== "a=extmap-allow-mixed";
              })
              .join("\n");
            msg.sdp.sdp = _sdp;
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

            // Flush any buffered ICE candidates
            if ((pc as any)._iceQueue) {
              for (const cand of (pc as any)._iceQueue) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {}
              }
              delete (pc as any)._iceQueue;
            }

            const answer = await pc.createAnswer();
            answer.sdp = answer.sdp?.replace(
              "useinbandfec=1",
              "useinbandfec=1; stereo=1; maxaveragebitrate=510000",
            );
            //@ts-expect-error
            const isChromium = Boolean(window.chrome);
            if (isChromium) {
              answer.sdp = answer.sdp
                ?.replace("opus/48000/2", "multiopus/48000/6")
                .replace(
                  "useinbandfec=1",
                  "channel_mapping=0,4,1,2,3,5; num_streams=4; coupled_streams=2;maxaveragebitrate=510000;minptime=10;useinbandfec=1",
                );
            }
            await pc.setLocalDescription(answer);
            this.sendSignalSS(from, { sdp: pc.localDescription }, !data.sharer);
          } catch (err) {
            console.error("Error handling offer in signalSS:", err);
          }
        } else if (msg.sdp && msg.sdp.type === "answer") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            if ((pc as any)._iceQueue) {
              for (const cand of (pc as any)._iceQueue) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {}
              }
              delete (pc as any)._iceQueue;
            }
          } catch (err) {
            console.error("Error handling answer in signalSS:", err);
          }
        }
      },
    );
    socket.on("REC:getRoomState", this.handleRoomState);
    if (this.tsInterval) {
      window.clearInterval(this.tsInterval);
    }
    this.tsInterval = window.setInterval(() => {
      if (this.state.roomMedia) {
        const curTime = this.Player().getCurrentTime();
        const toSend = this.getRoomTSToSet(curTime);
        this.socket.emit("CMD:ts", toSend);
        if (curTime > 0 && this.state.roomId) {
          this.savePlaybackTime(
            this.state.roomId,
            this.state.roomMedia,
            curTime,
            this.state.roomPaused,
          );
        }
      }
    }, 1000);
  };

  setFileSelection = (
    data: { name: string; url: string; length: number; playFn?: () => void }[],
  ) => {
    this.setState({ fileSelection: data });
  };

  setMultiSelectModal = (isMultiSelectModalOpen: boolean) => {
    this.setState({ isMultiSelectModalOpen });
  };

  resetMultiSelect = () => {
    this.setState({ isMultiSelectModalOpen: false, fileSelection: [] });
  };

  loadSettings = async () => {
    // Load settings from localstorage
    let settings = getCurrentSettings();
    this.setState({ settings });
  };

  loadSignInData = async (user: firebase.User | undefined) => {
    if (user && this.socket) {
      const googleName = user.displayName || user.email?.split("@")[0];
      const customName =
        typeof window !== "undefined"
          ? window.localStorage.getItem("watchparty-custom-name")
          : null;
      const activeName = customName || googleName;
      if (activeName) {
        this.updateName(activeName);
      }
      const userImage = await getUserImage(user);
      if (userImage) {
        this.updatePicture(userImage);
      }
      this.updateUid(user);
    }
  };

  loadYouTube = () => {
    // This code loads the IFrame Player API code asynchronously.
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.append(tag);
    window.onYouTubeIframeAPIReady = () => {
      // Note: this fails silently if the element is not available
      const ytPlayer = new window.YT.Player("leftYt", {
        events: {
          onReady: () => {
            console.log("yt onReady");
            this.YouTubeInterface = new YouTube(ytPlayer);
            this.setState({ loading: false });
            // We might have failed to play YT originally, ask for the current video again
            if (this.usingYoutube()) {
              console.log("requesting host data again after ytReady");
              this.socket.emit("CMD:askHost");
            }
          },
          onStateChange: (e) => {
            if (
              this.usingYoutube() &&
              e.data === window.YT?.PlayerState?.CUED
            ) {
              this.setState({ loading: false });
              const pending = (this.YouTubeInterface as any).pendingTime;
              const leader = this.getLeaderTime();
              const target =
                typeof pending === "number" && pending > 0
                  ? pending
                  : leader > 0
                    ? leader
                    : 0;
              if (target > 0) {
                this.YouTubeInterface.seekVideo(target);
              }
            }
            if (
              this.usingYoutube() &&
              e.data === window.YT?.PlayerState?.PLAYING
            ) {
              const pending = (this.YouTubeInterface as any).pendingTime;
              if (typeof pending === "number" && pending > 0) {
                const cur = this.YouTubeInterface.getCurrentTime();
                if (Math.abs(cur - pending) > 2) {
                  this.YouTubeInterface.seekVideo(pending);
                }
                (this.YouTubeInterface as any).pendingTime = undefined;
              }
            }
            if (
              this.usingYoutube() &&
              e.data === window.YT?.PlayerState?.ENDED
            ) {
              console.log(e.data, e.target.getVideoUrl());
              this.onVideoEnded(e.target.getVideoUrl());
            }
            if (
              this.ytDebounce &&
              ((e.data === window.YT?.PlayerState?.PLAYING &&
                this.state.roomPaused) ||
                (e.data === window.YT?.PlayerState?.PAUSED &&
                  !this.state.roomPaused))
            ) {
              this.ytDebounce = false;
              if (e.data === window.YT?.PlayerState?.PLAYING) {
                this.socket.emit("CMD:play");
                this.localPlay();
              } else {
                this.socket.emit("CMD:pause");
                this.localPause();
              }
              window.setTimeout(() => (this.ytDebounce = true), 500);
            }
          },
        },
      });
    };
  };

  // Functions for managing room settings
  getInviteLink = (vanity: string) => {
    if (vanity) {
      return `${window.location.origin}/r/${vanity}`;
    }
    return `${window.location.origin}/watch${this.state.roomId}`;
  };

  handleRoomState = (data: any) => {
    this.setOwner(data.owner);
    this.setVanity(data.vanity);
    this.setPassword(data.password);
    this.setInviteLink(this.getInviteLink(data.vanity));
    this.setIsChatDisabled(data.isChatDisabled);
    this.setRoomTitle(data.roomTitle);
    this.setRoomDescription(data.roomDescription);
    this.setRoomTitleColor(data.roomTitleColor);
    this.setMediaPath(data.mediaPath);
    window.history.replaceState("", "", this.getInviteLink(data.vanity));
  };

  setOwner = (owner: string) => {
    this.setState({ owner });
  };
  setVanity = (vanity: string | undefined) => {
    this.setState({ vanity });
  };
  setPassword = (password: string | undefined) => {
    this.setState({ password });
  };
  setInviteLink = (inviteLink: string) => {
    this.setState({ inviteLink });
  };
  setRoomTitle = (roomTitle: string | undefined) => {
    this.setState({ roomTitle });
  };
  setRoomDescription = (roomDescription: string | undefined) => {
    this.setState({ roomDescription });
  };
  setRoomTitleColor = (roomTitleColor: string | undefined) => {
    this.setState({ roomTitleColor });
  };
  setMediaPath = (mediaPath: string | undefined) => {
    this.setState({ mediaPath });
  };

  setRoomLock = async (locked: boolean) => {
    this.socket.emit("CMD:lock", { locked });
  };

  haveLock = () => {
    if (!this.state.roomLock) {
      return true;
    }
    return this.context.user?.uid === this.state.roomLock;
  };

  setIsChatDisabled = (val: boolean) => this.setState({ isChatDisabled: val });

  clearChat = async () => {
    this.socket.emit("CMD:deleteChatMessages", {});
  };

  showError = (message: string) => {
    this.setState({ errorMessage: message });
    setTimeout(() => {
      this.setState({ errorMessage: "" });
    }, 3000);
  };

  // Stops client-side conversion (if running) and releases its resources
  stopConvert = () => {
    this.transcoder?.stop();
    this.transcoder = undefined;
    if (this.state.convertProgress !== undefined) {
      this.setState({ convertProgress: undefined });
    }
  };

  createTranscoder = (
    source: File | string,
    video: HTMLMediaElement,
    startTime: number,
    onError: (err: Error) => void,
  ) => {
    const transcoder = new ClientTranscoder({
      source,
      video,
      startTime,
      onProgress: (fraction) => {
        if (this.transcoder === transcoder) {
          this.setState({ convertProgress: fraction });
        }
      },
      onError,
    });
    this.transcoder = transcoder;
    this.setState({ convertProgress: 0 });
    return transcoder;
  };

  // Plays a media URL in this browser after converting it with WebCodecs (see clientTranscode.ts), for formats the
  // browser can't play natively. Only affects this client: the room's media URL is unchanged.
  convertAndPlay = async (src: string, time: number) => {
    const video = this.HTMLInterface.getVideoEl();
    const transcoder = this.createTranscoder(src, video, time, (err) => {
      // Conversion failed while playing. Carry on without it.
      this.showError(
        `Conversion failed: ${err.message}. Playing without conversion.`,
      );
      this.stopConvert();
      this.Player().setSrcAndTime(src, video.currentTime);
    });
    try {
      await transcoder.start();
    } catch (err) {
      console.error(err);
      if (this.transcoder === transcoder) {
        // Typically a CORS restriction or a link that isn't a media file
        this.stopConvert();
        const reason =
          err instanceof Error ? err.message : "Unable to convert this video";
        this.showError(`${reason}. Playing without conversion.`);
        await this.Player().setSrcAndTime(src, time);
      }
    }
  };

  // Shares a file from this device. With convert, the file is first transcoded in this browser using WebCodecs
  // into a format browsers can play (see clientTranscode.ts), then shared the same way as an unconverted file.
  startFileShare = async (
    useMediaSoup: boolean,
    options?: { convert?: boolean },
  ) => {
    const files = await openFileSelector();
    if (!files) {
      return;
    }
    const file = files[0];
    if (options?.convert && !isClientTranscodeSupported()) {
      this.showError("Your browser doesn't support converting videos");
      return;
    }
    this.stopConvert();
    this.Player().clearState();
    const leftVideo = this.HTMLInterface.getVideoEl();
    if (options?.convert) {
      const transcoder = this.createTranscoder(file, leftVideo, 0, (err) => {
        // Conversion failed mid-share
        this.showError(`Conversion failed: ${err.message}`);
        this.stopPublishingLocalStream();
      });
      try {
        await transcoder.start();
      } catch (err) {
        console.error(err);
        if (this.transcoder === transcoder) {
          this.stopConvert();
          this.showError(
            err instanceof Error ? err.message : "Unable to convert this file",
          );
        }
        return;
      }
      if (this.transcoder !== transcoder) {
        // Cancelled while starting up
        return;
      }
    } else {
      leftVideo.src = URL.createObjectURL(file);
    }
    if (leftVideo) {
      audioEnhancer.attachToElement(leftVideo);
      const s = getPlayerSettings();
      if (s.audioBoost) {
        audioEnhancer.setBoost(s.audioBoost);
      }
    }
    leftVideo.play().catch(() => {});
    const captureStreamFn =
      (leftVideo as any)?.captureStream ||
      (leftVideo as any)?.mozCaptureStream;
    if (captureStreamFn) {
      this.localStreamToPublish = captureStreamFn.call(leftVideo);
    }
    this.isLocalStreamAFile = true;
    if (this.localStreamToPublish) {
      this.socket.emit("CMD:joinScreenShare", {
        file: true,
        mediasoup: useMediaSoup,
      });
    } else {
      this.setState({
        errorMessage:
          "Your browser does not support capturing local video streams directly. Please use Chrome, Edge, or Firefox.",
      });
      setTimeout(() => this.setState({ errorMessage: "" }), 5000);
    }
  };

  startScreenShare = async (useMediaSoup: boolean) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      this.setState({
        errorMessage:
          "Screen sharing is supported on desktop browsers. Mobile devices (Android & iOS) do not allow web browsers to record phone screens.",
      });
      setTimeout(() => this.setState({ errorMessage: "" }), 5000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        //@ts-expect-error
        video: { height: 720, logicalSurface: true },
        audio: {
          autoGainControl: false,
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      this.localStreamToPublish = stream;
      this.isLocalStreamAFile = false;
      // Immediately preview local screen stream in leftVideo for the host
      const leftVideo = this.HTMLInterface.getVideoEl();
      if (leftVideo) {
        leftVideo.src = "";
        leftVideo.srcObject = stream;
        leftVideo.playsInline = true;
        leftVideo.muted = true;
        leftVideo.play().catch(() => {});
        this.setLoadingFalse();
      }
      this.socket.emit("CMD:joinScreenShare", {
        file: false,
        mediasoup: useMediaSoup,
      });
    } catch (err: any) {
      console.warn("Screen share cancelled or failed:", err);
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        this.setState({
          errorMessage:
            "Screen sharing failed or is unsupported on this mobile browser. For sharing videos on mobile, use File Share or paste video URLs.",
        });
        setTimeout(() => this.setState({ errorMessage: "" }), 5000);
      }
    }
  };

  // Share the video to mediasoup
  publishMediasoup = async (mediasoupURL: string) => {
    const localStream = this.localStreamToPublish;
    let device: MediasoupClient.types.Device = null as any;
    let producerTransport: MediasoupClient.types.Transport = null as any;

    // =========== socket.io ==========
    const connectSocket = (mediasoupURL: string) => {
      return new Promise<void>((resolve, reject) => {
        this.mediasoupPubSocket = io(mediasoupURL, {
          transports: ["websocket"],
        });

        const socket = this.mediasoupPubSocket;
        socket?.on("connect", function () {
          console.log("PUBLISH: connected to socket.io");
          resolve();
        });
        socket?.on("error", function (err) {
          console.error("PUBLISH: socket.io ERROR:", err);
          reject(err);
        });
      });
    };

    const sendRequest = (type: string, data: any) => {
      return new Promise<any>((resolve, reject) => {
        const socket = this.mediasoupPubSocket;
        socket?.emit(type, data, (err: any, response: any) => {
          if (!err) {
            // Success response, so pass the mediasoup response to the local Room.
            resolve(response);
          } else {
            reject(err);
          }
        });
      });
    };

    async function publish() {
      // --- get transport info ---
      console.log("PUBLISH: --- createProducerTransport --");
      const params = await sendRequest("createProducerTransport", {});
      console.log("PUBLISH: transport params:", params);
      producerTransport = device.createSendTransport(params);
      console.log("PUBLISH: createSendTransport:", producerTransport);

      // --- join & start publish --
      producerTransport.on(
        "connect",
        async (
          {
            dtlsParameters,
          }: { dtlsParameters: MediasoupClient.types.DtlsParameters },
          callback: () => void,
          errback: (error: Error) => void,
        ) => {
          console.log("PUBLISH: --transport connect");
          sendRequest("connectProducerTransport", {
            dtlsParameters: dtlsParameters,
          })
            .then(callback)
            .catch(errback);
        },
      );

      producerTransport.on(
        "produce",
        async (
          {
            kind,
            rtpParameters,
          }: {
            kind: string;
            rtpParameters: MediasoupClient.types.RtpParameters;
          },
          callback: ({ id }: { id: string }) => void,
          errback: (error: Error) => void,
        ) => {
          console.log("PUBLISH: --transport produce");
          try {
            const { id } = await sendRequest("produce", {
              transportId: producerTransport.id,
              kind,
              rtpParameters,
            });
            callback({ id });
          } catch (err: any) {
            errback(err);
          }
        },
      );

      // producerTransport.on('connectionstatechange', (state: string) => {
      //   switch (state) {
      //     case 'connecting':
      //       console.log('PUBLISH: connecting');
      //       break;

      //     case 'connected':
      //       console.log('PUBLISH: connected');
      //       break;

      //     case 'failed':
      //       console.log('PUBLISH: failed');
      //       producerTransport.close();
      //       break;

      //     default:
      //       break;
      //   }
      // });

      const videoTrack = localStream?.getVideoTracks()[0];
      if (videoTrack) {
        const trackParams = { track: videoTrack };
        await producerTransport.produce(trackParams);
      }
      const audioTrack = localStream?.getAudioTracks()[0];
      if (audioTrack) {
        const trackParams = { track: audioTrack };
        await producerTransport.produce(trackParams);
      }
    }

    async function loadDevice(
      routerRtpCapabilities: MediasoupClient.types.RtpCapabilities,
    ) {
      const { Device } = await import("mediasoup-client");
      device = new Device();
      await device.load({ routerRtpCapabilities });
    }

    await connectSocket(mediasoupURL);
    // --- get capabilities --
    const data = await sendRequest("getRouterRtpCapabilities", {});
    console.log("PUBLISH: getRouterRtpCapabilities:", data);
    await loadDevice(data);
    await publish();
  };

  // Play the video from MediaSoup
  subscribeMediasoup = async (mediaSoupURL: string) => {
    let device: MediasoupClient.types.Device = null as any;
    let consumerTransport: MediasoupClient.types.Transport = null as any;
    // =========== socket.io ==========

    const connectSocket = () => {
      return new Promise<void>((resolve, reject) => {
        this.mediasoupSubSocket = io(mediaSoupURL, {
          transports: ["websocket"],
        });
        const socket = this.mediasoupSubSocket;
        socket?.on("connect", function () {
          console.log("SUBSCRIBE: connected to socket.io");
          resolve();
        });
        socket?.on("error", function (err) {
          console.error("SUBSCRIBE: socket.io ERROR:", err);
          reject(err);
        });
        socket?.on("newProducer", async function (message) {
          console.log("SUBSCRIBE: socket.io newProducer:", message);
          if (consumerTransport) {
            // start consume
            if (message.kind === "video") {
              await consumeAndResume(message.kind);
            } else if (message.kind === "audio") {
              await consumeAndResume(message.kind);
            }
          }
        });

        // socket?.on('producerClosed', function (message) {
        //   console.log('socket.io producerClosed:', message);
        //   const localId = message.localId;
        //   const remoteId = message.remoteId;
        //   const kind = message.kind;
        //   if (kind === 'video') {
        //     if (videoConsumer) {
        //       videoConsumer.close();
        //       videoConsumer = null;
        //     }
        //   } else if (kind === 'audio') {
        //     if (audioConsumer) {
        //       audioConsumer.close();
        //       audioConsumer = null;
        //     }
        //   }
        // });
      });
    };

    const sendRequest = (type: string, data: any) => {
      return new Promise<any>((resolve, reject) => {
        const socket = this.mediasoupSubSocket;
        socket?.emit(type, data, (err: Error, response: any) => {
          if (!err) {
            // Success response, so pass the mediasoup response to the local Room.
            resolve(response);
          } else {
            reject(err);
          }
        });
      });
    };

    // =========== media handling ==========
    const addRemoteTrack = (track: MediaStreamTrack) => {
      let video = this.HTMLInterface.getVideoEl();
      if (video.srcObject) {
        // Track already exists, add it
        (video.srcObject as MediaStream).addTrack(track);
      } else {
        const mediaStream = new MediaStream();
        mediaStream.addTrack(track);
        video.srcObject = mediaStream;
      }
      this.localPlay();
    };

    async function consumeAndResume(kind: string) {
      const consumer = await consume(consumerTransport, kind);
      if (consumer) {
        console.log("SUBSCRIBE: -- track exist, consumer ready. kind=" + kind);
        if (kind === "video") {
          console.log("SUBSCRIBE: -- resume kind=" + kind);
          sendRequest("resume", { kind: kind })
            .then(() => {
              console.log("SUBSCRIBE: resume OK");
              return consumer;
            })
            .catch((err) => {
              console.error("SUBSCRIBE: resume ERROR:", err);
              return consumer;
            });
        } else {
          console.log("SUBSCRIBE: -- do not resume kind=" + kind);
        }
      } else {
        console.log("SUBSCRIBE: -- no consumer yet. kind=" + kind);
        return null;
      }
    }

    async function loadDevice(
      routerRtpCapabilities: MediasoupClient.types.RtpCapabilities,
    ) {
      try {
        const { Device } = await import("mediasoup-client");
        device = new Device();
        await device.load({ routerRtpCapabilities });
      } catch (error: any) {
        if (error.name === "UnsupportedError") {
          console.error("browser not supported");
        }
      }
    }

    async function consume(
      transport: MediasoupClient.types.Transport,
      trackKind: string,
    ) {
      console.log("SUBSCRIBE: --start of consume --kind=" + trackKind);
      const { rtpCapabilities } = device;
      const data = await sendRequest("consume", {
        rtpCapabilities: rtpCapabilities,
        kind: trackKind,
      }).catch((err) => {
        console.error("SUBSCRIBE: ERROR:", err);
      });
      const { producerId, id, kind, rtpParameters } = data;

      if (producerId) {
        let codecOptions = {};
        const consumer = await transport.consume({
          id,
          producerId,
          kind,
          rtpParameters,
          //@ts-expect-error
          codecOptions,
        });

        addRemoteTrack(consumer.track);
        console.log("SUBSCRIBE: --end of consume");
        return consumer;
      } else {
        console.warn("SUBSCRIBE: ---remote producer NOT READY");
        return null;
      }
    }

    async function subscribe() {
      console.log("SUBSCRIBE: ---createConsumerTransport --");
      const params = await sendRequest("createConsumerTransport", {});
      console.log("SUBSCRIBE: transport params:", params);
      consumerTransport = device.createRecvTransport(params);
      console.log("SUBSCRIBE: createConsumerTransport:", consumerTransport);

      // --- join & start watching
      consumerTransport.on(
        "connect",
        async (
          {
            dtlsParameters,
          }: { dtlsParameters: MediasoupClient.types.DtlsParameters },
          callback: () => void,
          errback: (err: Error) => void,
        ) => {
          console.log("SUBSCRIBE: ---consumer transport connect");
          sendRequest("connectConsumerTransport", {
            dtlsParameters: dtlsParameters,
          })
            .then(callback)
            .catch(errback);
        },
      );

      // consumerTransport.on('connectionstatechange', (state: string) => {
      //   switch (state) {
      //     case 'connecting':
      //       console.log('SUBSCRIBE: connecting');
      //       break;

      //     case 'connected':
      //       console.log('SUBSCRIBE: connected');
      //       break;

      //     case 'failed':
      //       console.log('SUBSCRIBE: failed');
      //       consumerTransport.close();
      //       break;

      //     default:
      //       break;
      //   }
      // });

      await consumeAndResume("video");
      await consumeAndResume("audio");
    }

    // Clear the srcobject so we load our stream when received
    const leftVideo = this.HTMLInterface.getVideoEl();
    leftVideo.srcObject = null;
    await connectSocket();
    // --- get capabilities --
    const data = await sendRequest("getRouterRtpCapabilities", {});
    console.log("getRouterRtpCapabilities:", data);
    await loadDevice(data);
    await subscribe();
  };

  stopPublishingLocalStream = async () => {
    this.stopConvert();
    if (this.localStreamToPublish) {
      this.socket.emit("CMD:leaveScreenShare");
      // We don't actually need to unmute if it's a fileshare but this is fine
      this.localSetMute(false);
    }
    this.localStreamToPublish &&
      this.localStreamToPublish.getTracks().forEach((track) => {
        track.stop();
      });
    this.localStreamToPublish = undefined;
    if (this.consumerConn) {
      this.consumerConn.close();
      this.consumerConn = undefined;
    }
    Object.values(this.publisherConns).forEach((pc) => {
      pc.close();
    });
    this.publisherConns = {};
    this.isLocalStreamAFile = false;
    if (this.mediasoupPubSocket) {
      this.mediasoupPubSocket.close();
      this.mediasoupPubSocket = null;
    }
    if (this.mediasoupSubSocket) {
      this.mediasoupSubSocket.close();
      this.mediasoupSubSocket = null;
    }
  };

  setupRTCConnections = async () => {
    if (!this.playingScreenShare() && !this.playingFileShare()) {
      return;
    }
    const sharer = this.state.participants.find((p) => p.isScreenShare);
    const selfId = getOrCreateClientId();
    const localTrack = this.localStreamToPublish?.getVideoTracks()[0];
    if (localTrack && !localTrack.onended) {
      // Stop sharing if the local stream stops
      localTrack.onended = () => this.stopPublishingLocalStream();
    }
    if (this.state.roomMedia.includes("@")) {
      let prefix = "screenshare://";
      if (this.playingFileShare()) {
        prefix = "fileshare://";
      }
      const unprefixed = this.state.roomMedia.replace(prefix, "");
      const mediasoupURL = unprefixed.split("@")[1];
      if (sharer?.id === selfId && this.mediasoupPubSocket == null) {
        await this.publishMediasoup(mediasoupURL);
      }
      // If we're not sharing a file, also start watching
      // avoid duplicate watching if the socket already exists
      if (!this.isLocalStreamAFile && this.mediasoupSubSocket == null) {
        await this.subscribeMediasoup(mediasoupURL);
      }
      return;
    }

    // We're the sharer, create a connection to each other member
    if (sharer?.id === selfId) {
      // For desktop screenshare, preview local stream immediately on the host player
      if (!this.isLocalStreamAFile && this.localStreamToPublish) {
        const leftVideo = this.HTMLInterface.getVideoEl();
        if (leftVideo && leftVideo.srcObject !== this.localStreamToPublish) {
          leftVideo.src = "";
          leftVideo.srcObject = this.localStreamToPublish;
          leftVideo.playsInline = true;
          leftVideo.muted = true;
          leftVideo.play().catch(() => {});
          this.setLoadingFalse();
        }
      }

      // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
      // This allows them to rejoin later
      const clientIds = new Set(this.state.participants.map((p) => p.id));
      Object.entries(this.publisherConns).forEach(([key, value]) => {
        if (!clientIds.has(key)) {
          value.close();
          delete this.publisherConns[key];
        }
      });

      this.state.participants.forEach((user) => {
        const id = user.id;
        if (id === selfId) {
          // Never establish publisher WebRTC connection to self
          return;
        }
        if (!this.publisherConns[id]) {
          // Set up the RTCPeerConnection for sharing media to each member
          const pc = new RTCPeerConnection({ iceServers: iceServers() });
          this.publisherConns[id] = pc;
          pc.onicecandidate = (event) => {
            // We generated an ICE candidate, send it to peer
            if (event.candidate) {
              this.sendSignalSS(id, { ice: event.candidate }, true);
            }
          };
          this.localStreamToPublish?.getTracks().forEach((track) => {
            if (this.localStreamToPublish != null) {
              pc.addTrack(track, this.localStreamToPublish);
            }
          });
          const createAndSendOffer = async () => {
            try {
              if (pc.signalingState === "closed") return;
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              this.sendSignalSS(id, { sdp: pc.localDescription }, true);
            } catch (err) {
              console.warn("Failed to create offer for peer:", id, err);
            }
          };
          pc.onnegotiationneeded = createAndSendOffer;
          // Trigger offer creation immediately to ensure delivery
          createAndSendOffer();
        }
      });
    }
    // We're a watcher, establish connection to sharer
    // Only if we are not the sharer ourselves and not sharing local file
    if (sharer && sharer.id !== selfId && !this.consumerConn && !this.isLocalStreamAFile) {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      this.consumerConn = pc;
      pc.onicecandidate = (event) => {
        // We generated an ICE candidate, send it to sharer
        if (event.candidate) {
          this.sendSignalSS(sharer.id, { ice: event.candidate });
        }
      };
      pc.ontrack = (event: RTCTrackEvent) => {
        // Mount the stream from sharer
        const leftVideo = this.HTMLInterface.getVideoEl();
        if (leftVideo) {
          leftVideo.src = "";
          leftVideo.srcObject = event.streams[0];
          leftVideo.playsInline = true;
          // Auto-mute initially to satisfy browser autoplay requirements, then unmute
          leftVideo.muted = true;
          leftVideo.play().then(() => {
            leftVideo.muted = false;
          }).catch((err) => {
            console.warn("Autoplay with sound failed, staying muted:", err);
          });
          this.setLoadingFalse();
        }
      };
    }
  };

  startVBrowser = async (options: { size: string }) => {
    this.socket.emit("CMD:startVBrowser", { options });
  };

  stopVBrowser = async () => {
    this.socket.emit("CMD:stopVBrowser");
  };

  changeController = async (value: string | null) => {
    // console.log(data);
    this.socket.emit("CMD:changeController", value);
  };

  sendSignalSS = async (to: string, data: any, sharer?: boolean) => {
    // console.log('sendSS', to, data);
    this.socket.emit("signalSS", { to, msg: data, sharer });
  };

  usingYoutube = () => {
    return isYouTube(this.state.roomMedia);
  };

  usingNative = () => {
    // Anything that uses HTML Video (e.g. not YouTube, Vimeo, or other embedded JS player)
    return !this.usingYoutube();
  };

  hasDuration = () => {
    // Youtube, link, or magnet, etc. Has a defined runtime (not WebRTC)
    return isHttp(this.state.roomMedia) || isMagnet(this.state.roomMedia);
  };

  playingScreenShare = () => {
    return isScreenShare(this.state.roomMedia);
  };

  playingFileShare = () => {
    return isFileShare(this.state.roomMedia);
  };

  playingVBrowser = () => {
    return isVBrowser(this.state.roomMedia);
  };

  getVBrowserPass = () => {
    return this.state.roomMedia.replace("vbrowser://", "").split("@")[0];
  };

  getVBrowserHost = () => {
    return this.state.roomMedia.replace("vbrowser://", "").split("@")[1];
  };

  isPauseDisabled = () => {
    return this.playingScreenShare() || this.playingVBrowser();
  };

  localSeek = (customTime?: number) => {
    // Jump to the leader's position, or a custom one
    let target = customTime ?? this.getLeaderTime();
    // For live this is the offset from the leading edge (negative)
    if (this.state.isLiveStream) {
      target = this.Player().getDuration() + (customTime ?? 0);
    }
    if (target >= 0 && target < Infinity) {
      console.log("syncing self to leader or custom:", target);
      this.Player().seekVideo(target);
    }
  };

  localPlay = async () => {
    if (!this.state.roomMedia) {
      return;
    }
    const canAutoplay = this.state.isAutoPlayable || (await testAutoplay());
    this.setState(
      { roomPaused: false, isAutoPlayable: canAutoplay },
      async () => {
        if (
          !this.state.isAutoPlayable ||
          (this.localStreamToPublish && !this.isLocalStreamAFile)
        ) {
          console.log("auto-muting to allow autoplay or screenshare host");
          this.localSetMute(true);
        } else {
          this.localSetMute(false);
        }
        try {
          await this.Player().playVideo();
        } catch (e: any) {
          console.warn("playVideo notice:", e?.name, e?.message);
          if (e?.name === "NotAllowedError") {
            // Autoplay with sound was blocked by browser policy; mute and retry playback
            this.localSetMute(true);
            try {
              await this.Player().playVideo();
            } catch {}
          }
        }
      },
    );
  };

  localPause = () => {
    this.setState({ roomPaused: true }, async () => {
      this.Player().pauseVideo();
    });
  };

  localSetMute = (muted: boolean) => {
    this.Player().setMute(muted);
    this.refreshControls();
  };

  localSetVolume = (volume: number) => {
    this.Player().setVolume(volume);
    this.refreshControls();
  };

  localSubtitleModal = () => {
    // Native player uses subtitle modal.
    if (this.usingNative()) {
      this.setState({ isSubtitleModalOpen: true });
    }
  };

  roomSetPlaybackRate = (rate: number) => {
    // emit an event to the server
    this.socket.emit("CMD:playbackRate", rate);
  };

  roomSetLoop = (loop: boolean) => {
    this.socket.emit("CMD:loop", loop);
  };

  roomTogglePlay = () => {
    if (!this.haveLock()) {
      return;
    }
    if (this.isPauseDisabled()) {
      return;
    }
    const shouldPlay = this.Player().shouldPlay();
    if (shouldPlay) {
      this.socket.emit("CMD:play");
      this.localPlay();
    } else {
      this.socket.emit("CMD:pause");
      this.localPause();
      if (this.state.roomMedia && this.state.roomId) {
        this.savePlaybackTime(
          this.state.roomId,
          this.state.roomMedia,
          this.Player().getCurrentTime(),
          true,
        );
      }
    }
  };

  roomSeek = (time: number) => {
    if (!this.haveLock()) {
      // The server rejects CMD:seek without the lock; a local seek would desync us.
      return;
    }
    let target = time;
    target = Math.max(target, 0);
    this.Player().seekVideo(target);
    const toSend = this.getRoomTSToSet(target);
    this.socket.emit("CMD:seek", toSend);
    if (this.state.roomMedia && this.state.roomId) {
      this.savePlaybackTime(
        this.state.roomId,
        this.state.roomMedia,
        target,
        this.state.roomPaused,
      );
    }
  };

  getRoomTSToSet = (time: number) => {
    let target = time;
    // In live case, can't just send video time because clients may have different durations
    // Take the passed time and compute the offset from the end time (negative)
    // Each client should use this value to compute the time to set when starting playback
    if (this.state.isLiveStream) {
      target = time - this.Player().getDuration();
    }
    // Otherwise just return the time
    return target;
  };

  onFullScreenChange = () => {
    this.setState({ fullScreen: Boolean(document.fullscreenElement) });
    setTimeout(() => this.chatRef.current?.scrollToBottom(), 100);
  };

  onKeydown = (e: any) => {
    if (!document.activeElement || document.activeElement.tagName === "BODY") {
      if (e.key === " ") {
        e.preventDefault();
        this.roomTogglePlay();
      } else if (e.key === "ArrowRight") {
        this.roomSeek(this.Player().getCurrentTime() + 10);
      } else if (e.key === "ArrowLeft") {
        this.roomSeek(this.Player().getCurrentTime() - 10);
      } else if (e.key === "t") {
        this.localFullScreen(false);
      } else if (e.key === "f") {
        this.localFullScreen(true);
      } else if (e.key === "m") {
        this.localToggleMute();
      }
    }
  };

  localFullScreen = async (bVideoOnly: boolean) => {
    try {
      // If bVideoOnly is true, target leftVideoParent so custom controls, drawer, ripples, and overlays stay in fullscreen
      let container: HTMLElement | null = document.body;
      const videoParent = document.getElementById("leftVideoParent");
      if (bVideoOnly) {
        container = videoParent || document.body;
      }
      if (!container) {
        container = (document.getElementById("leftVideo") as HTMLElement) || document.body;
      }
      if (!container) return;

      const videoEl = this.Player().getVideoEl();
      if (
        !container.requestFullscreen &&
        //@ts-expect-error
        container.webkitEnterFullScreen
      ) {
        // e.g. iPhone doesn't allow requestFullscreen on div
        //@ts-expect-error
        container.webkitEnterFullscreen();
        return;
      } else if (!container.requestFullscreen && videoEl && (videoEl as any).webkitEnterFullscreen) {
        (videoEl as any).webkitEnterFullscreen();
        return;
      }

      if (!document.fullscreenElement) {
        // not currently in fullscreen
        await container.requestFullscreen().catch((err) => {
          console.warn("Fullscreen request error handled:", err);
        });
      } else {
        // e.g. switching from video fullscreen to theater mode or vice versa
        const bChangeElements = document.fullscreenElement !== container;
        await document.exitFullscreen().catch((err) => {
          console.warn("Exit fullscreen error handled:", err);
        });
        if (bChangeElements && container) {
          await container.requestFullscreen().catch((err) => {
            console.warn("Change fullscreen error handled:", err);
          });
        }
      }
    } catch (err) {
      console.warn("localFullScreen error handled:", err);
    }
  };

  localToggleMute = () => {
    this.localSetMute(!this.Player().isMuted());
  };

  roomSetMedia = (value: string) => {
    const resolved = resolveMediaUrl(value);
    this.socket.emit("CMD:host", resolved);
  };

  setConvertEnabled = (convertEnabled: boolean) => {
    window.localStorage.setItem(
      "watchparty-convert",
      convertEnabled ? "1" : "0",
    );
    this.setState({ convertEnabled });
  };

  roomPlaylistPlay = (index: number) => {
    this.roomSetMedia(this.state.playlist[index]?.url);
    this.roomPlaylistDelete(index);
  };

  roomPlaylistAdd = (value: string) => {
    this.socket.emit("CMD:playlistAdd", value);
  };

  roomPlaylistMove = (index: number, toIndex: number) => {
    this.socket.emit("CMD:playlistMove", { index, toIndex });
  };

  roomPlaylistDelete = (index: number) => {
    this.socket.emit("CMD:playlistDelete", index);
  };

  updateName = (name: string) => {
    this.setState({ myName: name });
    this.socket.emit("CMD:name", name);
    window.localStorage.setItem("watchparty-username", name);
  };

  updatePicture = (url: string) => {
    this.setState({ myPicture: url });
    this.socket.emit("CMD:picture", url);
  };

  updateUid = async (user: firebase.User) => {
    const uid = user.uid;
    const token = await user.getIdToken();
    this.socket.emit("CMD:uid", { uid, token });
  };

  getMediaDisplayName = (input?: string) => {
    if (!input) {
      return "";
    }
    if (this.state?.detectedMediaName) {
      return this.state.detectedMediaName;
    }
    // Show the whole URL for youtube
    if (this.usingYoutube()) {
      return input;
    }
    if (input.startsWith("screenshare://")) {
      const sharer = this.state.participants.find((user) => user.isScreenShare);
      return this.state.nameMap[sharer?.id ?? ""] + "'s screen";
    }
    if (input.startsWith("fileshare://")) {
      const sharer = this.state.participants.find((user) => user.isScreenShare);
      return this.state.nameMap[sharer?.id ?? ""] + "'s file";
    }
    if (input.startsWith("vbrowser://")) {
      return "Virtual Browser" + (this.state.isVBrowserLarge ? "+" : "");
    }
    const dnMatch = input.match(/[?&]dn=([^&]+)/i);
    if (dnMatch) {
      try {
        let name = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
        if (name.includes("%")) {
          try { name = decodeURIComponent(name); } catch {}
        }
        return name;
      } catch {}
    }
    if (isMagnet(input)) {
      const magnetParsed = new URLSearchParams(input.replace(/^magnet:\?/, ""));
      const dn = magnetParsed.get("dn");
      const index = magnetParsed.get("fileIndex");
      return (
        (dn ? decodeURIComponent(dn.replace(/\+/g, " ")) : "Torrent") +
        (index != null ? ` (file ${index})` : "")
      );
    }
    if (input.includes("/stream?torrent=")) {
      try {
        const search = new URL(
          input,
          typeof window !== "undefined" ? window.location.origin : "http://localhost",
        ).search;
        const searchParsed = new URLSearchParams(search);
        const magnetUrl = searchParsed.get("torrent") ?? "";
        const magnetParsed = new URLSearchParams(magnetUrl.replace(/^magnet:\?/, ""));
        const dn = magnetParsed.get("dn") ?? searchParsed.get("dn");
        const index = searchParsed.get("fileIndex");
        if (dn) {
          return decodeURIComponent(dn.replace(/\+/g, " ")) + (index != null ? ` (file ${index})` : "");
        }
      } catch {}
    }
    if (input.includes("/proxy")) {
      const urlParsed = new URLSearchParams(input);
      const displayName = urlParsed.get("displayName");
      if (displayName) {
        return displayName;
      }
    }
    return input;
  };

  setLoadingFalse = () => {
    this.setState({ loading: false });
  };

  getLeaderTime = () => {
    const values = Object.values(this.state.tsMap).filter(Number.isFinite);
    if (!values.length) {
      if (
        typeof this.state.roomVideoTS === "number" &&
        this.state.roomVideoTS > 0
      ) {
        return this.state.roomVideoTS;
      }
      const saved = this.getSavedPlaybackTime(
        this.state.roomId,
        this.state.roomMedia,
      );
      if (saved > 0) {
        return saved;
      }
      return 0;
    }
    if (this.state.participants.length > 2) {
      return calculateMedian(values);
    }
    return Math.max(...values);
  };

  onVideoEnded = (url: string) => {
    this.localPause();
    // check if looping is on, if so set time back to 0 and restart
    if (this.state.roomLoop) {
      this.localSeek(0);
      this.localPlay();
      return;
    }
    if (this.state.playlist.length) {
      // Pass the url of the video at the time this video was started
      this.socket.emit("CMD:playlistNext", url);
      return;
    }
    // Play next fileIndex
    const re = /&fileIndex=(\d+)$/;
    const match = re.exec(this.state.roomMedia);
    if (match) {
      const fileIndex = match[1];
      const nextNum = Number(fileIndex) + 1;
      const nextUrl = this.state.roomMedia.replace(
        /&fileIndex=(\d+)$/,
        `&fileIndex=${nextNum}`,
      );
      this.roomSetMedia(nextUrl);
    }
  };

  refreshControls = () => {
    this.setState({ controlsTimestamp: Date.now() });
  };

  setSettingsModalOpen = (settingsModalOpen: boolean) => {
    this.setState({ settingsModalOpen });
  };

  cycleAudioBoost = () => {
    const current = this.state.audioBoost || 100;
    const next = current === 100 ? 150 : current === 150 ? 200 : 100;
    this.setState({ audioBoost: next });
    setPlayerSettings({ audioBoost: next });
    audioEnhancer.setBoost(next);
  };

  copyRoomLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      this.setState({ copiedLink: true });
      setTimeout(() => this.setState({ copiedLink: false }), 2000);
    }
  };

  render() {
    const sharer = this.state.participants.find((p) => p.isScreenShare);
    const playlist = this.state.playlist;
    const isBehind =
      !this.state.isLiveStream &&
      !this.playingScreenShare() &&
      !this.playingFileShare() &&
      Boolean(this.getLeaderTime()) &&
      Number.isFinite(this.getLeaderTime()) &&
      this.getLeaderTime() > 0 &&
      this.getLeaderTime() - this.Player().getCurrentTime() > 10;
    const onSyncAction = () => {
      if (this.state.isLiveStream) {
        this.roomSeek(this.Player().getDuration());
      } else {
        this.localSeek();
      }
    };
    const controls = (
      <Controls
        key={this.state.roomMedia || "controls"}
        video={this.state.roomMedia}
        paused={this.state.roomPaused}
        roomPlaybackRate={this.state.roomPlaybackRate}
        isLiveStream={this.state.isLiveStream}
        muted={this.Player().isMuted()}
        volume={this.Player().getVolume()}
        subtitled={this.Player().isSubtitled()}
        currentTime={this.Player().getCurrentTime()}
        duration={this.Player().getDuration()}
        disabled={!this.haveLock()}
        leaderTime={this.hasDuration() ? this.getLeaderTime() : undefined}
        isPauseDisabled={this.isPauseDisabled()}
        playbackRate={this.Player().getPlaybackRate()}
        isYouTube={this.usingYoutube()}
        timeRanges={this.Player().getTimeRanges()}
        loop={this.state.roomLoop}
        roomSetLoop={this.roomSetLoop}
        roomTogglePlay={this.roomTogglePlay}
        roomSeek={this.roomSeek}
        roomSetPlaybackRate={this.roomSetPlaybackRate}
        localFullScreen={this.localFullScreen}
        localToggleMute={this.localToggleMute}
        localSubtitleModal={this.localSubtitleModal}
        localSetVolume={this.localSetVolume}
        localSeek={this.localSeek}
        localSetSubtitleMode={(
          mode?: TextTrackMode,
          trackIndexOrLang?: number | string,
          trackIndex?: number,
        ) => {
          this.Player().setSubtitleMode(
            mode,
            trackIndex ?? trackIndexOrLang,
          );
          this.setState({ controlsTimestamp: Date.now() });
        }}
        roomPlaylistPlay={this.roomPlaylistPlay}
        playlist={this.state.playlist}
        chat={this.state.chat}
        nameMap={this.state.nameMap}
        pictureMap={this.state.pictureMap}
        socket={this.socket}
        getMediaDisplayName={this.getMediaDisplayName}
        isChatDisabled={this.state.isChatDisabled}
        owner={this.state.owner}
        chatRef={this.chatRef}
        onOpenSettings={() => this.setState({ settingsModalOpen: true })}
        showChatColumn={this.state.showChatColumn}
        isMobileView={this.state.isMobileView}
        clientId={clientId}
        myName={this.state.myName}
        roomSubtitle={this.state.roomSubtitle}
        unreadCount={this.state.unreadCount}
        onClearUnread={() => this.setState({ unreadCount: 0 })}
        participants={this.state.participants}
        onJoinVideo={() => this.videoChatRef.current?.setupWebRTC()}
        onLeaveVideo={() => this.videoChatRef.current?.stopWebRTC()}
        onToggleVideo={() => this.videoChatRef.current?.toggleVideoWebRTC()}
        onToggleAudio={() => this.videoChatRef.current?.toggleAudioWebRTC()}
        isVideoMuted={!this.videoChatRef.current?.getVideoWebRTC()}
        isAudioMuted={!this.videoChatRef.current?.getAudioWebRTC()}
        downloaded={this.state.downloaded}
        total={this.state.total}
        speed={this.state.speed}
        connections={this.state.connections}
        convertProgress={this.state.convertProgress}
      />
    );
    const renderPlayerBox = (isMobileLayout: boolean) => (
      <div
        className={styles.playerContainer}
        id="leftVideoParent"
        style={
          isMobileLayout
            ? { minHeight: "100%", height: "100%", borderRadius: 0 }
            : undefined
        }
      >
        {!this.state.isAutoPlayable && this.state.roomMedia && !this.state.roomPaused && this.Player().isMuted() && (
          <div
            className={styles.unmuteOverlay}
            onClick={() => {
              this.setState({ isAutoPlayable: true });
              this.localSetMute(false);
              this.localSetVolume(1);
              this.Player().playVideo().catch(() => {});
            }}
            onTouchEnd={() => {
              this.setState({ isAutoPlayable: true });
              this.localSetMute(false);
              this.localSetVolume(1);
              this.Player().playVideo().catch(() => {});
            }}
          >
            <div className={styles.unmuteCardWrapper}>
              <div className={styles.unmutePulseRing} />
              <div className={styles.unmutePulseRing2} />
              <div className={styles.unmuteButtonPill}>
                <div className={styles.unmuteIconBox}>
                  <WPIconVolumeOff size={isMobileLayout ? 20 : 24} />
                </div>
                <div className={styles.unmuteContent}>
                  <div className={styles.unmuteTitle}>
                    <span>{isMobileLayout ? "Tap to Unmute" : "Click to Unmute"}</span>
                    <div className={styles.unmuteSoundWaves}>
                      <span className={styles.unmuteWaveBar} />
                      <span className={styles.unmuteWaveBar} />
                      <span className={styles.unmuteWaveBar} />
                      <span className={styles.unmuteWaveBar} />
                    </div>
                  </div>
                  <div className={styles.unmuteSubtext}>
                    Click anywhere to enable audio
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {(this.state.loading ||
          !this.state.roomMedia ||
          this.state.nonPlayableMedia) &&
          !this.state.isLiveStream && (
            <div
              id="loader"
              className={`${styles.videoContent} ${styles.flexCenter}`}
            >
              {this.state.loading && (
                <div
                  className={styles.flexCenter}
                  style={{
                    flexDirection: "column",
                  }}
                >
                  <Loader />
                  <div>
                    {this.playingVBrowser()
                      ? "Launching virtual browser. This can take up to a minute."
                      : ""}
                  </div>
                </div>
              )}
              {!this.state.loading && !this.state.roomMedia && (
                <Alert
                  color="yellow"
                  title="You're not watching anything!"
                >
                  {isMobileLayout
                    ? "Tap Media tab below to select a video."
                    : "Pick something to watch above."}
                </Alert>
              )}
              {!this.state.loading &&
                this.state.nonPlayableMedia && (
                  <Alert
                    color="red"
                    title="It doesn't look like this is a media file!"
                  >
                    Maybe you meant to launch a VBrowser if you're
                    trying to visit a web page?
                  </Alert>
                )}
            </div>
          )}
        <iframe
          style={{
            display:
              this.usingYoutube() && !this.state.loading
                ? "block"
                : "none",
          }}
          title="YouTube"
          id="leftYt"
          className={styles.videoContent}
          allowFullScreen
          frameBorder="0"
          allow="autoplay; encrypted-media"
          src="https://www.youtube.com/embed/?enablejsapi=1&controls=0&rel=0"
        />
        {this.playingVBrowser() &&
        this.getVBrowserPass() &&
        this.getVBrowserHost() ? (
          <VBrowser
            username={clientId}
            password={this.getVBrowserPass()}
            hostname={this.getVBrowserHost()}
            controlling={this.state.controller === clientId}
            resolution={this.state.vBrowserResolution}
            quality={this.state.vBrowserQuality}
            doPlay={this.localPlay}
            setResolution={(data: string) =>
              this.setState({ vBrowserResolution: data })
            }
            setQuality={(data: string) => {
              this.setState({ vBrowserQuality: data });
            }}
            isMobile={isMobile()}
          />
        ) : (
          <video
            style={{
              display: this.usingNative() ? "block" : "none",
              width: "100%",
              maxHeight: isMobileLayout ? "100%" : VIDEO_MAX_HEIGHT_CSS,
            }}
            id="leftVideo"
            crossOrigin="anonymous"
            preload="auto"
            onPlay={(e) => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
              audioEnhancer.attachToElement(e.currentTarget);
              const s = getPlayerSettings();
              if (s.audioBoost) {
                audioEnhancer.setBoost(s.audioBoost);
              }
            }}
            onCanPlay={() => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
            }}
            onPlaying={() => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
            }}
            onEnded={(e) => this.onVideoEnded(e.currentTarget.src)}
            playsInline
            onClick={this.roomTogglePlay}
          ></video>
        )}
        {Boolean(
          this.state.total ||
          this.state.convertProgress !== undefined ||
          (this.state.roomMedia && (isMagnet(this.state.roomMedia) || this.state.roomMedia.includes("torrent=")))
        ) &&
          getPlayerSettings().showStatsOverlay !== false && (
          <div className={styles.torrentStatsBadge}>
            <span style={{ fontSize: 13 }}>🧲</span>
            {[
              this.state.total
                ? Math.min(
                    (this.state.downloaded / this.state.total) * 100,
                    100,
                  ).toFixed(1) + "% downloaded"
                : "Connecting to peers...",
              Boolean(this.state.total) && formatSpeed(this.state.speed),
              Boolean(this.state.total) &&
                this.state.connections + " peers",
              this.state.convertProgress !== undefined &&
                (this.state.convertProgress * 100).toFixed(1) + "% converted",
            ]
              .filter(Boolean)
              .join(" • ")}
          </div>
        )}
        {this.state.roomMedia && controls}
        <LiveCaptions
          paused={this.state.roomPaused}
          videoEl={this.HTMLInterface.getVideoEl()}
          isYouTube={this.usingYoutube()}
          roomSubtitle={this.state.roomSubtitle}
          roomMedia={this.state.roomMedia}
          isSubtitled={this.Player().isSubtitled()}
          getYoutubeTime={() => this.YouTubeInterface.getCurrentTime()}
          socket={this.socket}
        />
        <MobileFloatingReactions
          hide={Boolean(this.state.settingsModalOpen)}
          onSendReaction={(emoji: string) => {
            this.socket?.emit("CMD:reaction", emoji);
            this.socket?.emit("CMD:chat", emoji);
          }}
          incomingReaction={this.state.incomingReaction}
          isBehind={isBehind}
          onSync={onSyncAction}
        />
      </div>
    );
    return (
      <React.Fragment>
        {this.state.isMultiSelectModalOpen && (
          <MultiStreamModal
            streams={this.state.fileSelection}
            setMedia={this.roomSetMedia}
            resetMultiSelect={this.resetMultiSelect}
          />
        )}
        {this.state.isScreenShareModalOpen && (
          <ScreenShareModal
            closeModal={() => this.setState({ isScreenShareModalOpen: false })}
            startScreenShare={this.startScreenShare}
          />
        )}
        {this.state.isFileShareModalOpen && (
          <FileShareModal
            closeModal={() => this.setState({ isFileShareModalOpen: false })}
            startFileShare={this.startFileShare}
          />
        )}
        {this.state.isSubtitleModalOpen && (
          <SubtitleModal
            closeModal={() => this.setState({ isSubtitleModalOpen: false })}
            socket={this.socket}
            roomSubtitle={this.state.roomSubtitle}
            roomMedia={this.state.roomMedia}
            haveLock={this.haveLock}
            getMediaDisplayName={this.getMediaDisplayName}
            setSubtitleMode={this.Player().setSubtitleMode}
            getSubtitleMode={this.Player().getSubtitleMode}
          />
        )}
        {this.state.state === "starting" && (
          <Overlay className={styles.flexCenter}>
            <Title order={2}>Loading...</Title>
          </Overlay>
        )}
        {this.state.overlayMsg && <ErrorModal error={this.state.overlayMsg} />}
        {this.state.isErrorAuth && <PasswordModal roomId={this.state.roomId} />}
        <SettingsModal
          modalOpen={this.state.settingsModalOpen}
          setModalOpen={this.setSettingsModalOpen}
          roomLock={this.state.roomLock}
          setRoomLock={this.setRoomLock}
          socket={this.socket}
          roomId={this.state.roomId}
          isChatDisabled={this.state.isChatDisabled}
          setIsChatDisabled={this.setIsChatDisabled}
          owner={this.state.owner}
          setOwner={this.setOwner}
          vanity={this.state.vanity}
          setVanity={this.setVanity}
          inviteLink={this.state.inviteLink}
          password={this.state.password}
          setPassword={this.setPassword}
          clearChat={this.clearChat}
          roomTitle={this.state.roomTitle}
          setRoomTitle={this.setRoomTitle}
          roomDescription={this.state.roomDescription}
          setRoomDescription={this.setRoomDescription}
          roomTitleColor={this.state.roomTitleColor}
          setRoomTitleColor={this.setRoomTitleColor}
          mediaPath={this.state.mediaPath}
          setMediaPath={this.setMediaPath}
          myName={this.state.myName}
          updateName={this.updateName}
        />
        {this.state.errorMessage && (
          <Alert
            title="Error"
            color="red"
            style={{
              position: "fixed",
              bottom: "10px",
              right: "10px",
              zIndex: 1000,
            }}
          >
            {this.state.errorMessage}
          </Alert>
        )}
        {this.state.successMessage && (
          <Alert
            title="Success"
            color="green"
            style={{
              position: "fixed",
              bottom: "10px",
              right: "10px",
              zIndex: 1000,
            }}
          >
            {this.state.successMessage}
          </Alert>
        )}
        {this.state.warningMessage && (
          <Alert
            color="yellow"
            // header={this.state.warningMessage}
            style={{
              position: "fixed",
              top: "10px",
              left: "50%",
              transform: "translate(-50%, 0)",
              zIndex: 1000,
            }}
          >
            {this.state.warningMessage}
          </Alert>
        )}
        {this.state.state === "connected" && (
          <FloatingWebcamBubbles
            participants={this.state.participants}
            nameMap={this.state.nameMap}
            pictureMap={this.state.pictureMap}
            socket={this.socket}
            onJoinVideo={() => this.videoChatRef.current?.setupWebRTC()}
            onLeaveVideo={() => this.videoChatRef.current?.stopWebRTC()}
            onToggleVideo={() => this.videoChatRef.current?.toggleVideoWebRTC()}
            onToggleAudio={() => this.videoChatRef.current?.toggleAudioWebRTC()}
            isVideoMuted={!this.videoChatRef.current?.getVideoWebRTC()}
            isAudioMuted={!this.videoChatRef.current?.getAudioWebRTC()}
            isFullScreen={this.state.fullScreen}
          />
        )}
        {this.state.isMobileView ? (
          <div className={styles.mobileAppContainer}>
            {/* Slim 38px Compact Mobile Header with Room Code & Sync Status */}
            <header
              className={`${styles.mobileHeader} ${
                this.state.isKeyboardOpen || this.state.isTyping
                  ? styles.mobileHeaderKeyboardOpen
                  : ""
              }`}
            >
              <div className={styles.mobileBrand} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <a
                  href="/"
                  style={{ display: "flex", alignItems: "center", textDecoration: "none" }}
                  title="Dypkri Home"
                >
                  <img
                    src="/dypkri-art.png"
                    alt="Dypkri"
                    style={{ height: "22px", width: "auto", objectFit: "contain", display: "block" }}
                  />
                </a>
                {this.state.roomId && (
                  <button
                    type="button"
                    className={styles.mobileRoomPill}
                    onClick={this.copyRoomLink}
                    title="Tap to copy room link"
                  >
                    <span>{this.state.copiedLink ? "Copied! ✓" : (this.state.roomTitle || `#${this.state.roomId.replace(/^\//, "")}`)}</span>
                  </button>
                )}
              </div>

              <div className={styles.mobileHeaderActions}>
                {this.state.roomId && (
                  <div
                    className={isBehind ? styles.mobileSyncDotBehind : styles.mobileSyncDot}
                    onClick={isBehind ? onSyncAction : undefined}
                    title={isBehind ? "Behind • Tap to sync" : "In Sync"}
                    style={{ cursor: isBehind ? "pointer" : "default" }}
                  />
                )}
                {this.state.roomLock && (
                  <span title="Locked by Host" style={{ fontSize: "11px" }}>🔒</span>
                )}
                {this.state.participants.length > 0 && (
                  <div className={styles.mobileViewerBadge} title={`${this.state.participants.length} viewers in room`}>
                    <span>👥 {this.state.participants.length}</span>
                  </div>
                )}
                {this.state.roomId && (
                  <button
                    type="button"
                    className={styles.mobileShareBtn}
                    onClick={this.copyRoomLink}
                    title="Share room link"
                  >
                    <span>{this.state.copiedLink ? "✓" : "Share"}</span>
                  </button>
                )}
              </div>
            </header>

            {/* Fixed 16:9 Video Player (Top pinned, zero scroll with on-video controls) */}
            <div
              className={`${styles.mobileVideoWrapper} ${
                this.state.isKeyboardOpen || this.state.isTyping
                  ? styles.mobileVideoWrapperKeyboardOpen
                  : ""
              }`}
            >
              {renderPlayerBox(true)}
            </div>

            {/* Content Area for Active Tab */}
            <div className={styles.mobileContentArea}>
              {/* TAB 1: CHAT */}
              <div
                style={{
                  display: this.state.currentTab === "chat" ? "flex" : "none",
                  flexDirection: "column",
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                }}
              >
                <Chat
                  chat={this.state.chat}
                  nameMap={this.state.nameMap}
                  pictureMap={this.state.pictureMap}
                  socket={this.socket}
                  scrollTimestamp={this.state.scrollTimestamp}
                  getMediaDisplayName={this.getMediaDisplayName}
                  isChatDisabled={this.state.isChatDisabled}
                  owner={this.state.owner}
                  ref={this.chatRef}
                  hide={this.state.currentTab !== "chat"}
                  videoPaused={this.state.roomPaused}
                  isKeyboardOpen={this.state.isKeyboardOpen || this.state.isTyping}
                  onKeyboardToggle={(open) => {
                    this.setState({ isTyping: open, isKeyboardOpen: open });
                  }}
                />
              </div>

              {/* TAB 2: MEDIA & QUEUE */}
              {this.state.currentTab === "media" && (
                <div className={styles.mobileScrollPanel}>
                  {/* Card 1: Select Media / Sources */}
                  <div className={styles.mobileCard}>
                    <div className={styles.panelSectionTitle}>
                      <span>Media Source</span>
                      {isClientTranscodeSupported() && (
                        <Switch
                          size="xs"
                          label="Convert"
                          checked={this.state.convertEnabled}
                          onChange={(e) =>
                            this.setConvertEnabled(e.currentTarget.checked)
                          }
                        />
                      )}
                    </div>
                    <ComboBox
                      roomSetMedia={this.roomSetMedia}
                      playlistAdd={this.roomPlaylistAdd}
                      roomMedia={this.state.roomMedia}
                      getMediaDisplayName={this.getMediaDisplayName}
                      mediaPath={this.state.mediaPath}
                      disabled={!this.haveLock()}
                    />
                    {/* Quick Action Source Cards */}
                    <div className={styles.quickSourceGrid}>
                      {!this.localStreamToPublish && !sharer ? (
                        <button
                          type="button"
                          className={`${styles.sourceCardBtn} ${styles.sourceCardScreen}`}
                          disabled={!this.haveLock()}
                          onClick={() => this.startScreenShare(false)}
                          title="Share screen or browser tab"
                        >
                          <div className={styles.sourceCardIcon}>
                            <WPIconScreenshare size={18} />
                          </div>
                          <span className={styles.sourceCardTitle}>Screen</span>
                          <span className={styles.sourceCardSub}>Display/Tab</span>
                        </button>
                      ) : this.localStreamToPublish ? (
                        <button
                          type="button"
                          className={`${styles.sourceCardBtn} ${styles.sourceCardStop}`}
                          onClick={this.stopPublishingLocalStream}
                          title="Stop sharing your screen"
                        >
                          <div className={styles.sourceCardIcon}>
                            <WPIconClose size={18} />
                          </div>
                          <span className={styles.sourceCardTitle} style={{ color: "#f87171" }}>Stop</span>
                          <span className={styles.sourceCardSub}>Screen</span>
                        </button>
                      ) : null}

                      {!this.localStreamToPublish && !sharer && (
                        <button
                          type="button"
                          className={`${styles.sourceCardBtn} ${styles.sourceCardFile}`}
                          disabled={!this.haveLock()}
                          onClick={() => this.setState({ isFileShareModalOpen: true })}
                          title="Share local video or audio file"
                        >
                          <div className={styles.sourceCardIcon}>
                            <WPIconFile size={18} />
                          </div>
                          <span className={styles.sourceCardTitle}>File Share</span>
                          <span className={styles.sourceCardSub}>Local Video</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card 2: Playlist & Queue */}
                  <div className={styles.mobileCard}>
                    <div className={styles.panelSectionTitle}>
                      <span>Up Next & Playlist</span>
                      <Badge size="sm" variant="filled" color="indigo">
                        {playlist.length}
                      </Badge>
                    </div>

                    <div className={styles.queueAddBox} style={{ marginTop: 8 }}>
                      <input
                        type="text"
                        placeholder="Paste YouTube, magnet, or video URL..."
                        className={styles.queueAddInput}
                        value={this.state.quickQueueUrl}
                        onChange={(e) => this.setState({ quickQueueUrl: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && this.state.quickQueueUrl?.trim()) {
                            this.roomPlaylistAdd(this.state.quickQueueUrl.trim());
                            this.setState({ quickQueueUrl: "" });
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.queueAddBtn}
                        disabled={!this.state.quickQueueUrl?.trim() || !this.haveLock()}
                        onClick={() => {
                          if (this.state.quickQueueUrl?.trim()) {
                            this.roomPlaylistAdd(this.state.quickQueueUrl.trim());
                            this.setState({ quickQueueUrl: "" });
                          }
                        }}
                        title="Add to queue"
                      >
                        + Add
                      </button>
                    </div>
                    {playlist.length === 0 ? (
                      <div className={styles.emptyQueueNotice}>
                        No videos in queue. Enter a link above to add items!
                      </div>
                    ) : (
                      <div className={styles.queueList}>
                        {playlist.map((item: PlaylistVideo, index: number) => {
                          if (Boolean(item.img)) {
                            item.type = "youtube";
                          }
                          return (
                            <ChatVideoCard
                              key={index}
                              video={item}
                              index={index}
                              controls
                              onPlay={this.roomPlaylistPlay}
                              onPlayNext={(index) => {
                                this.roomPlaylistMove(index, 0);
                              }}
                              onRemove={(index) => {
                                this.roomPlaylistDelete(index);
                              }}
                              disabled={!this.haveLock()}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: PEOPLE & VOICE */}
              <div
                className={styles.mobileScrollPanel}
                style={{
                  display: this.state.currentTab === "people" ? "flex" : "none",
                  flexDirection: "column",
                }}
              >
                {/* Voice & Video Chat */}
                {this.state.state === "connected" && (
                  <div className={styles.mobileCard}>
                    <div className={styles.panelSectionTitle}>
                      <span>
                        Voice & Webcams ({this.state.participants.length})
                      </span>
                    </div>
                    <VideoChat
                      ref={this.videoChatRef}
                      socket={this.socket}
                      participants={this.state.participants}
                      nameMap={this.state.nameMap}
                      pictureMap={this.state.pictureMap}
                      tsMap={this.state.tsMap}
                      rosterUpdateTS={this.state.rosterUpdateTS}
                      owner={this.state.owner}
                      getLeaderTime={this.getLeaderTime}
                    />
                  </div>
                )}

                {/* Invite & Share Room */}
                <div className={styles.mobileCard}>
                  <div className={styles.panelSectionTitle}>
                    <span>Invite Friends</span>
                  </div>
                  <InviteButton fullWidth label="Share Room Link" />
                </div>
              </div>

              {/* TAB 4: SETTINGS (INLINE TAB - NO OVERLAY) */}
              {this.state.currentTab === "settings" && (
                <div className={styles.mobileScrollPanel}>
                  <SettingsModal
                    inline
                    modalOpen={true}
                    setModalOpen={() => {}}
                    roomLock={this.state.roomLock}
                    setRoomLock={this.setRoomLock}
                    socket={this.socket}
                    roomId={this.state.roomId}
                    owner={this.state.owner}
                    setOwner={this.setOwner}
                    vanity={this.state.vanity}
                    setVanity={this.setVanity}
                    inviteLink={this.state.inviteLink}
                    password={this.state.password}
                    setPassword={this.setPassword}
                    isChatDisabled={this.state.isChatDisabled}
                    setIsChatDisabled={this.setIsChatDisabled}
                    clearChat={this.clearChat}
                    roomTitle={this.state.roomTitle}
                    setRoomTitle={this.setRoomTitle}
                    roomDescription={this.state.roomDescription}
                    setRoomDescription={this.setRoomDescription}
                    roomTitleColor={this.state.roomTitleColor}
                    setRoomTitleColor={this.setRoomTitleColor}
                    mediaPath={this.state.mediaPath}
                    setMediaPath={this.setMediaPath}
                    myName={this.state.myName}
                    updateName={this.updateName}
                  />
                </div>
              )}
            </div>

            {/* Smartphone Native Bottom Navigation Bar - completely hidden while typing */}
            {!this.state.isKeyboardOpen && !this.state.isTyping && (
              <nav className={styles.mobileBottomNav}>
              {/* 1. Chat */}
              <button
                type="button"
                className={`${styles.bottomNavTab} ${
                  this.state.currentTab === "chat" ? styles.activeTab : ""
                }`}
                onClick={() => {
                  this.setState({ currentTab: "chat", unreadCount: 0 });
                  this.socket?.emit("CMD:chatSeen");
                }}
              >
                <div className={styles.tabIconWrapper}>
                  <WPIconChat size={18} />
                  {this.state.unreadCount > 0 && this.state.currentTab !== "chat" && (
                    <span className={styles.bottomNavBadge}>
                      {this.state.unreadCount > 99 ? "99+" : this.state.unreadCount}
                    </span>
                  )}
                </div>
                <span className={styles.tabLabel}>Chat</span>
              </button>

              {/* 2. People */}
              <button
                type="button"
                className={`${styles.bottomNavTab} ${
                  this.state.currentTab === "people" ? styles.activeTab : ""
                }`}
                onClick={() => this.setState({ currentTab: "people" })}
              >
                <div className={styles.tabIconWrapper}>
                  <WPIconPeople size={18} />
                  {this.state.participants.length > 0 && (
                    <span className={styles.bottomNavBadge}>
                      {this.state.participants.length}
                    </span>
                  )}
                </div>
                <span className={styles.tabLabel}>People</span>
              </button>

              {/* 3. Media */}
              <button
                type="button"
                className={`${styles.bottomNavTab} ${
                  this.state.currentTab === "media" ? styles.activeTab : ""
                }`}
                onClick={() => this.setState({ currentTab: "media" })}
              >
                <div className={styles.tabIconWrapper}>
                  <WPIconPlaylist size={18} />
                  {playlist.length > 0 && (
                    <span className={styles.bottomNavBadge}>{playlist.length}</span>
                  )}
                </div>
                <span className={styles.tabLabel}>Media</span>
              </button>

              {/* 4. Settings */}
              <button
                type="button"
                className={`${styles.bottomNavTab} ${
                  this.state.currentTab === "settings" ? styles.activeTab : ""
                }`}
                onClick={() => this.setState({ currentTab: "settings" })}
                title="Settings"
              >
                <div className={styles.tabIconWrapper}>
                  <WPIconSettings size={18} />
                </div>
                <span className={styles.tabLabel}>Settings</span>
              </button>
            </nav>
            )}
          </div>
        ) : (
          <React.Fragment>
            {!this.state.fullScreen && (
              <TopBar
                roomTitle={this.state.roomTitle}
                roomDescription={this.state.roomDescription}
                roomTitleColor={this.state.roomTitleColor}
                roomId={this.state.roomId}
                roomLock={this.state.roomLock}
                participantsCount={this.state.participants.length}
                isBehind={isBehind}
                onSync={onSyncAction}
              />
            )}
            <div
              className={styles.desktopLayoutWrapper}
              style={
                this.state.fullScreen
                  ? { height: "100vh", maxHeight: "100vh", padding: 0 }
                  : undefined
              }
            >
              {/* Left Column: Cinema Media Stage */}
              <div className={styles.desktopStageColumn}>
                {/* Cinema Media Bar */}
                {!this.state.fullScreen && (
                  <div className={styles.desktopMediaBar}>
                    {/* Media Search / Link Input */}
                    <div className={styles.desktopSearchWrapper}>
                      <ComboBox
                        roomSetMedia={this.roomSetMedia}
                        playlistAdd={this.roomPlaylistAdd}
                        roomMedia={this.state.roomMedia}
                        getMediaDisplayName={this.getMediaDisplayName}
                        mediaPath={this.state.mediaPath}
                        disabled={!this.haveLock()}
                      />
                    </div>

                    {/* Media Actions */}
                    <div className={styles.desktopMediaActions}>
                      {this.localStreamToPublish ? (
                        <button
                          type="button"
                          className={`${styles.desktopPillBtn} ${styles.desktopPillStop}`}
                          onClick={this.stopPublishingLocalStream}
                          title="Stop sharing your screen or stream"
                        >
                          <WPIconClose size={15} />
                          <span>Stop Share</span>
                        </button>
                      ) : (
                        !sharer && (
                          <button
                            type="button"
                            className={`${styles.desktopPillBtn} ${styles.desktopPillScreen}`}
                            disabled={!this.haveLock()}
                            onClick={() => this.startScreenShare(false)}
                            title="Share your screen with room"
                          >
                            <WPIconScreenshare size={15} />
                            <span>Screenshare</span>
                          </button>
                        )
                      )}

                      {!this.localStreamToPublish && !sharer && (
                        <button
                          type="button"
                          className={`${styles.desktopPillBtn} ${styles.desktopPillFile}`}
                          disabled={!this.haveLock()}
                          onClick={() => this.setState({ isFileShareModalOpen: true })}
                          title="Stream a local video file from your computer"
                        >
                          <WPIconFile size={15} />
                          <span>File</span>
                        </button>
                      )}

                      {Boolean(this.context.streamPath) && (
                        <SearchComponent
                          setMedia={this.roomSetMedia}
                          playlistAdd={this.roomPlaylistAdd}
                          type={"stream"}
                          setShowMultiSelect={this.setMultiSelectModal}
                          setFileSelection={this.setFileSelection}
                          disabled={!this.haveLock()}
                        />
                      )}

                      {/* Playlist Quick Switch / Badge */}
                      <button
                        type="button"
                        className={`${styles.desktopPillBtn} ${
                          this.state.desktopSidebarTab === "playlist" && this.state.showChatColumn
                            ? styles.desktopPillActive
                            : ""
                        }`}
                        onClick={() => {
                          this.setState({
                            showChatColumn: true,
                            desktopSidebarTab: "playlist",
                          });
                        }}
                        title="View & manage video queue"
                      >
                        <WPIconPlaylist size={15} />
                        <span>Queue</span>
                        {playlist.length > 0 && (
                          <span className={styles.desktopPillBadge}>
                            {playlist.length}
                          </span>
                        )}
                      </button>

                      {/* Audio Boost Toggle */}
                      <button
                        type="button"
                        className={`${styles.desktopPillBtn} ${
                          (this.state.audioBoost || 100) > 100
                            ? styles.desktopPillActive
                            : ""
                        }`}
                        onClick={this.cycleAudioBoost}
                        title="Boost dialogue and movie audio (1x, 1.5x, 2x)"
                      >
                        <WPIconVolumeOn size={14} />
                        <span>Boost {this.state.audioBoost === 150 ? "1.5x" : this.state.audioBoost === 200 ? "2x" : "1x"}</span>
                      </button>

                      {/* Optional Transcoder Switch */}
                      {isClientTranscodeSupported() && (
                        <div className={styles.desktopConvertSwitch}>
                          <Tooltip
                            multiline
                            w={260}
                            refProp="rootRef"
                            label="Convert audio/video in real-time if codec is unsupported"
                          >
                            <Switch
                              size="xs"
                              label="Convert"
                              checked={this.state.convertEnabled}
                              onChange={(e) =>
                                this.setConvertEnabled(e.currentTarget.checked)
                              }
                            />
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Player Stage with Theater Toggle Pill */}
                <div className={styles.desktopPlayerStage}>
                  {renderPlayerBox(false)}

                  {/* Floating Cinema Theater Pill */}
                  {!this.state.fullScreen && (
                    <div className={styles.desktopTheaterPill}>
                      <button
                        type="button"
                        className={styles.desktopTheaterBtn}
                        onClick={() => {
                          const newVal = !this.state.showChatColumn;
                          this.setState({
                            showChatColumn: newVal,
                            unreadCount: newVal ? 0 : this.state.unreadCount,
                          });
                          window.localStorage.setItem(
                            "watchparty-showchatcolumn",
                            Number(newVal).toString(),
                          );
                        }}
                        title={
                          this.state.showChatColumn
                            ? "Expand video to Cinema Theater mode"
                            : "Restore sidebar console"
                        }
                      >
                        {this.state.showChatColumn ? (
                          <WPIconChevronRight size={18} />
                        ) : this.state.unreadCount > 0 ? (
                          <div className={styles.theaterUnreadDot} />
                        ) : (
                          <WPIconChevronLeft size={18} />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Desktop Command Center Sidebar (340px Compact) */}
              <div
                className={styles.desktopSidebarColumn}
                style={{
                  width: this.state.showChatColumn ? 340 : 0,
                  maxWidth: this.state.showChatColumn ? 340 : 0,
                  opacity: this.state.showChatColumn ? 1 : 0,
                  pointerEvents: this.state.showChatColumn ? "auto" : "none",
                  borderWidth: this.state.showChatColumn ? 1 : 0,
                  padding: this.state.showChatColumn ? undefined : 0,
                }}
              >
                {/* Sidebar Header: Nickname Display + Invite */}
                <div className={styles.desktopSidebarHeader}>
                  <div
                    className={styles.desktopUserPill}
                    title={`Signed in as ${this.state.myName}`}
                  >
                    <div className={styles.desktopUserAvatar}>
                      {this.state.myPicture ? (
                        <img
                          src={this.state.myPicture}
                          alt={this.state.myName}
                        />
                      ) : (
                        <WPIconUser size={13} />
                      )}
                    </div>
                    <span className={styles.desktopUserNameText}>
                      {this.state.myName}
                    </span>
                  </div>
                  <InviteButton />
                </div>

                {/* Sidebar Navigation Tabs: Chat, People, Media, Settings */}
                <div className={styles.desktopSidebarNav}>
                  <button
                    type="button"
                    className={`${styles.desktopNavTab} ${
                      (this.state.desktopSidebarTab ?? "chat") === "chat"
                        ? styles.desktopNavTabActive
                        : ""
                    }`}
                    onClick={() => {
                      this.setState({
                        desktopSidebarTab: "chat",
                        unreadCount: 0,
                      });
                    }}
                  >
                    <WPIconChat size={15} />
                    <span>Chat</span>
                    {(this.state.desktopSidebarTab ?? "chat") !== "chat" &&
                      this.state.unreadCount > 0 && (
                        <span className={styles.desktopNavBadge}>
                          {this.state.unreadCount}
                        </span>
                      )}
                  </button>

                  <button
                    type="button"
                    className={`${styles.desktopNavTab} ${
                      this.state.desktopSidebarTab === "people"
                        ? styles.desktopNavTabActive
                        : ""
                    }`}
                    onClick={() => {
                      this.setState({ desktopSidebarTab: "people" });
                    }}
                  >
                    <WPIconPeople size={15} />
                    <span>People</span>
                    <span className={styles.desktopNavCount}>
                      {this.state.participants.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`${styles.desktopNavTab} ${
                      this.state.desktopSidebarTab === "playlist"
                        ? styles.desktopNavTabActive
                        : ""
                    }`}
                    onClick={() => {
                      this.setState({ desktopSidebarTab: "playlist" });
                    }}
                  >
                    <WPIconPlaylist size={15} />
                    <span>Media</span>
                    {playlist.length > 0 && (
                      <span className={styles.desktopNavCount}>
                        {playlist.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    className={`${styles.desktopNavTab} ${
                      this.state.desktopSidebarTab === "settings"
                        ? styles.desktopNavTabActive
                        : ""
                    }`}
                    onClick={() => {
                      this.setState({ desktopSidebarTab: "settings" });
                    }}
                  >
                    <WPIconSettings size={15} />
                    <span>Settings</span>
                  </button>
                </div>

                {/* Sidebar Body */}
                <div className={styles.desktopSidebarBody}>
                  {/* TAB 1: Chat */}
                  <div
                    style={{
                      display:
                        (this.state.desktopSidebarTab ?? "chat") === "chat"
                          ? "flex"
                          : "none",
                      flexDirection: "column",
                      height: "100%",
                      width: "100%",
                    }}
                  >
                    <Chat
                      chat={this.state.chat}
                      nameMap={this.state.nameMap}
                      pictureMap={this.state.pictureMap}
                      socket={this.socket}
                      scrollTimestamp={this.state.scrollTimestamp}
                      getMediaDisplayName={this.getMediaDisplayName}
                      isChatDisabled={this.state.isChatDisabled}
                      owner={this.state.owner}
                      ref={this.chatRef}
                      hide={!this.state.showChatColumn}
                      videoPaused={this.state.roomPaused}
                    />
                  </div>

                  {/* TAB 2: People & WebRTC Voice/Video */}
                  <div
                    style={{
                      display:
                        this.state.desktopSidebarTab === "people"
                          ? "flex"
                          : "none",
                      flexDirection: "column",
                      height: "100%",
                      width: "100%",
                      overflowY: "auto",
                      padding: "10px",
                      gap: "10px",
                    }}
                  >
                    {this.state.state === "connected" && (
                      <VideoChat
                        ref={this.videoChatRef}
                        socket={this.socket}
                        participants={this.state.participants}
                        nameMap={this.state.nameMap}
                        pictureMap={this.state.pictureMap}
                        tsMap={this.state.tsMap}
                        rosterUpdateTS={this.state.rosterUpdateTS}
                        owner={this.state.owner}
                        getLeaderTime={this.getLeaderTime}
                      />
                    )}
                  </div>

                  {/* TAB 3: Video Queue / Playlist */}
                  <div
                    style={{
                      display:
                        this.state.desktopSidebarTab === "playlist"
                          ? "flex"
                          : "none",
                      flexDirection: "column",
                      height: "100%",
                      width: "100%",
                      overflowY: "auto",
                      padding: "12px",
                      gap: "8px",
                    }}
                  >
                    <div className={styles.desktopQueueHeader}>
                      <span>Upcoming Videos ({playlist.length})</span>
                      {playlist.length > 0 && (
                        <button
                          type="button"
                          className={styles.queueClearBtn}
                          disabled={!this.haveLock()}
                          onClick={() => {
                            for (let i = playlist.length - 1; i >= 0; i--) {
                              this.roomPlaylistDelete(i);
                            }
                          }}
                          title="Clear all videos from playlist"
                        >
                          Clear All
                        </button>
                      )}
                    </div>

                    <div className={styles.queueAddBox}>
                      <input
                        type="text"
                        placeholder="Paste YouTube, magnet, or video URL..."
                        className={styles.queueAddInput}
                        value={this.state.quickQueueUrl}
                        onChange={(e) => this.setState({ quickQueueUrl: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && this.state.quickQueueUrl?.trim()) {
                            this.roomPlaylistAdd(this.state.quickQueueUrl.trim());
                            this.setState({ quickQueueUrl: "" });
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.queueAddBtn}
                        disabled={!this.state.quickQueueUrl?.trim() || !this.haveLock()}
                        onClick={() => {
                          if (this.state.quickQueueUrl?.trim()) {
                            this.roomPlaylistAdd(this.state.quickQueueUrl.trim());
                            this.setState({ quickQueueUrl: "" });
                          }
                        }}
                        title="Add to queue"
                      >
                        + Add
                      </button>
                    </div>

                    {playlist.length === 0 ? (
                      <div className={styles.desktopEmptyQueue}>
                        <div className={styles.emptyQueueIcon}>
                          <WPIconPlaylist size={36} />
                        </div>
                        <div className={styles.emptyQueueTitle}>
                          Queue is Empty
                        </div>
                        <div className={styles.emptyQueueSub}>
                          Paste any YouTube link, magnet, or video URL in the search bar above to queue videos.
                        </div>
                      </div>
                    ) : (
                      playlist.map((item: PlaylistVideo, index: number) => {
                        if (Boolean(item.img)) {
                          item.type = "youtube";
                        }
                        return (
                          <div key={index} className={styles.desktopQueueItem}>
                            <ChatVideoCard
                              video={item}
                              index={index}
                              controls
                              onPlay={this.roomPlaylistPlay}
                              onPlayNext={(idx) => {
                                this.roomPlaylistMove(idx, 0);
                              }}
                              onRemove={(idx) => {
                                this.roomPlaylistDelete(idx);
                              }}
                              disabled={!this.haveLock()}
                            />
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* TAB 4: Room & Video Settings */}
                  <div
                    style={{
                      display:
                        this.state.desktopSidebarTab === "settings"
                          ? "flex"
                          : "none",
                      flexDirection: "column",
                      height: "100%",
                      width: "100%",
                      overflowY: "auto",
                      padding: "10px",
                    }}
                  >
                    <SettingsModal
                      inline
                      modalOpen={true}
                      setModalOpen={() => {}}
                      roomLock={this.state.roomLock}
                      setRoomLock={this.setRoomLock}
                      socket={this.socket}
                      roomId={this.state.roomId}
                      owner={this.state.owner}
                      setOwner={this.setOwner}
                      vanity={this.state.vanity}
                      setVanity={this.setVanity}
                      inviteLink={this.state.inviteLink}
                      password={this.state.password}
                      setPassword={this.setPassword}
                      isChatDisabled={this.state.isChatDisabled}
                      setIsChatDisabled={this.setIsChatDisabled}
                      clearChat={this.clearChat}
                      roomTitle={this.state.roomTitle}
                      setRoomTitle={this.setRoomTitle}
                      roomDescription={this.state.roomDescription}
                      setRoomDescription={this.setRoomDescription}
                      roomTitleColor={this.state.roomTitleColor}
                      setRoomTitleColor={this.setRoomTitleColor}
                      mediaPath={this.state.mediaPath}
                      setMediaPath={this.setMediaPath}
                      myName={this.state.myName}
                      updateName={this.updateName}
                    />
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>
      )}
    </React.Fragment>
    );
  }
}
