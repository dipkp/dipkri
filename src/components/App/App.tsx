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
  isMovie,
  isMovieStream,
  parseMovieUrl,
  buildMovieEmbedUrl,
  createMovieProtocolUrl,
  type MovieServer,
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
import { RemoteAudioRenderer } from "../VideoChat/RemoteAudioRenderer";
import { getCurrentSettings } from "../Settings/LocalSettings";
import { MultiStreamModal } from "../Modal/MultiStreamModal";
import { ComboBox } from "../ComboBox/ComboBox";
import { SearchComponent } from "../SearchComponent/SearchComponent";
import { Controls } from "../Controls/Controls";
import { MovieModal } from "../MovieModal/MovieModal";
import { AppDownloadModal } from "../AppDownloadModal/AppDownloadModal";
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
import { withStreamKey, canStreamTorrents } from "../../utils/streamAuth";
import { desktopRoomEnd } from "../../utils/desktopStream";
import { buildLocalStreamUrl, getDesktopBridge } from "../../utils/desktopStream";
import { SubtitleModal, cleanMovieTitle } from "../Modal/SubtitleModal";
import { HTML } from "./HTML";
import { YouTube } from "./YouTube";
import { Movie } from "./Movie";
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
    dipkri: DipkriWindow;
  }
}

window.dipkri = {
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
  fileProgress: number;
  videoDecodeIssue: boolean;
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
  // Stream error fallback UI
  streamError: { message: string; isYouTube?: boolean; originalUrl?: string } | null;
  // Reconnection overlay state
  isReconnecting: boolean;
  reconnectReason?: string;
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
  isMovieModalOpen: boolean;
  isAppDownloadModalOpen: boolean;
  nonPlayableTorrentWeb: boolean;
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
    myName: window.localStorage.getItem("dipkri-username") ?? "",
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
    fileProgress: 0,
    videoDecodeIssue: false,
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
    isScreenShareModalOpen: false,
    isFileShareModalOpen: false,
    isSubtitleModalOpen: false,
    isMultiSelectModalOpen: false,
    isMovieModalOpen: false,
    isAppDownloadModalOpen: false,
    nonPlayableTorrentWeb: false,
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
            window.localStorage.getItem("dipkri-showchatcolumn") ?? "1",
          ),
        ),
    showPeopleColumn: false,
    // Boolean(
    //       Number(
    //         window.localStorage.getItem('dipkri-showpeoplecolumn') ?? '0',
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
    convertEnabled: window.localStorage.getItem("dipkri-convert") === "1",
    incomingReaction: null,
    audioBoost: getPlayerSettings().audioBoost || 100,
    copiedLink: false,
    streamError: null,
    isReconnecting: false,
  };
  socket: Socket = null!;
  videoChatRef = React.createRef<VideoChat>();
  mobileVideoChatRef = React.createRef<VideoChat>();

  getActiveVideoChat = (): VideoChat | null => {
    return this.videoChatRef.current || this.mobileVideoChatRef.current || null;
  };
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
  movieCurrentTime = 0;
  // True while a remote seek is being applied; the iframe's echo must not be
  // sent back as CMD:seek or the room ping-pongs forever.
  isRemoteSyncing = false;
  // Track the last seekId we sent to the server to ignore the echo
  lastSentSeekId: string | null = null;
  movieStartAt = 0;
  movieSyncKey = 0;
  YouTubeInterface: YouTube = new YouTube(null);
  HTMLInterface: HTML = new HTML("leftVideo");
  MovieInterface: Movie = new Movie("leftMovie", (target) => {
    this.syncMovieToTime(target);
  });
  Player = () => {
    if (this.usingYoutube()) {
      return this.YouTubeInterface;
    } else if (this.usingMovie()) {
      return this.MovieInterface;
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

  getDownloadPercent = () => {
    if (this.state.fileProgress > 0) {
      return Math.min(this.state.fileProgress * 100, 100);
    }
    if (this.state.total > 0) {
      return Math.min((this.state.downloaded / this.state.total) * 100, 100);
    }
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

  handleFirstInteraction = () => {
    // Clicks before any media exists (home screen, modals) must not consume the
    // unlocking gesture — otherwise the film starts muted with no way back.
    if (!this.state.roomMedia) return;
    try {
      audioEnhancer.getAudioContext()?.resume();
    } catch {}
    // Unmute regardless of what testAutoplay() reported: some browsers mute the
    // element even when the probe succeeds, which looks exactly like "no audio".
    if (this.Player().isMuted()) {
      this.localSetMute(false);
    }
    this.setState({ isAutoPlayable: true });
    // Unlocked once: stop listening so a manual mute is never overridden.
    document.removeEventListener("pointerdown", this.handleFirstInteraction, true);
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
    // Android Chrome / WebView uses webkit-prefixed fullscreen events
    (document as any).onwebkitfullscreenchange = this.onFullScreenChange;
    document.onkeydown = this.onKeydown;
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("orientationchange", this.handleResize);
    window.addEventListener("popstate", this.handlePopState);

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
    // Browsers block audio until a user gesture. Instead of a blocking overlay,
    // unmute once on the first interaction anywhere on the page.
    document.addEventListener("pointerdown", this.handleFirstInteraction, {
      capture: true,
    });
    window.addEventListener("message", this.handleMovieMessage);

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
    window.removeEventListener("message", this.handleMovieMessage);
    // Assigned as document properties in componentDidMount, so
    // removeEventListener() never removed them (they kept firing after unmount).
    document.onfullscreenchange = null;
    (document as any).onwebkitfullscreenchange = null;
    document.onkeydown = null;
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("orientationchange", this.handleResize);
    window.removeEventListener("popstate", this.handlePopState);
    if (typeof window !== "undefined") {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", this.updateViewportMetrics);
        window.visualViewport.removeEventListener("scroll", this.updateViewportMetrics);
      }
      window.removeEventListener("scroll", this.onWindowScroll);
    }
    window.clearInterval(this.heartbeat);
    window.clearInterval(this.tsInterval);
    window.clearInterval(this.progressUpdater);
    // Clean up screen/file share WebRTC connections
    this.stopPublishingLocalStream();
    try {
      this.socket?.removeAllListeners();
      this.socket?.disconnect();
    } catch {}
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
    (window as any).dipkri = (window as any).dipkri || {};
    (window as any).dipkri.socket = socket;
    (window as any).dipkri.app = this;

    // Clear any existing intervals from previous connections
    if (this.tsInterval) window.clearInterval(this.tsInterval);
    if (this.progressUpdater) window.clearInterval(this.progressUpdater);

    socket.on("connect", async () => {
      this.setState({
        state: "connected",
        overlayMsg: "",
        errorMessage: "",
        successMessage: "",
        warningMessage: "",
        // Socket.IO v4: reconnect events fire on socket.io, not socket;
        // so ensure we clear reconnect state on successful connect
        isReconnecting: false,
        reconnectReason: undefined,
      });
      // Use the Google user name, custom name, or generated name
      const googleName =
        this.context.user?.displayName ||
        this.context.user?.email?.split("@")[0];
      const customName =
        typeof window !== "undefined"
          ? window.localStorage.getItem("dipkri-custom-name")
          : null;
      const initialName =
        customName || googleName || this.state.myName || (await generateName());
      this.updateName(initialName);
      this.loadSignInData(this.context.user);
      // Re-join video chat if we were in it before the reconnection
      if (window.dipkri.ourStream) {
        socket.emit("CMD:joinVideo");
      }
    });
    socket.on("connect_error", async (err: any) => {
      console.warn("Socket connect_error (will retry):", err);
      if (err?.message === "Invalid namespace") {
        // /createRoom ignores the roomId it is given, so the old "recreate and
        // reconnect" path looped forever against a namespace that cannot come
        // back (rooms are in memory). Say so and stop retrying.
        this.setState({
          overlayMsg: "This room is no longer active. Please create a new one.",
        });
        this.socket?.disconnect();
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
        this.setState({
          isReconnecting: true,
          reconnectReason: "Disconnected from server",
          overlayMsg: "Disconnected from server.",
        });
      } else {
        // else the socket will automatically try to reconnect
        // Show prominent reconnecting overlay instead of just a toast
        this.setState({
          isReconnecting: true,
          reconnectReason: "Connection lost, attempting to reconnect...",
        });
      }
    });
    // Socket.IO v4: reconnect events fire on the Manager (socket.io), not the socket
    socket.io.on("reconnect", () => {
      this.setState({ isReconnecting: false, reconnectReason: undefined });
      this.setState({ warningMessage: "Reconnected!" });
      setTimeout(() => this.setState({ warningMessage: "" }), 2000);
    });
    socket.io.on("reconnect_attempt", (attemptNumber) => {
      this.setState({
        isReconnecting: true,
        reconnectReason: `Reconnecting... (attempt ${attemptNumber})`,
      });
    });
    socket.io.on("reconnect_failed", () => {
      this.setState({
        isReconnecting: true,
        reconnectReason: "Reconnection failed. Please refresh the page.",
      });
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
    socket.on("REC:seek", (data: { time: number; seekId?: string } | number) => {
      const time = typeof data === "number" ? data : data.time;
      const seekId = typeof data === "object" ? data.seekId : undefined;
      // Ignore the echo of our own seek
      if (seekId && seekId === this.lastSentSeekId) {
        this.lastSentSeekId = null;
        return;
      }
      this.isRemoteSyncing = true;
      this.localSeek(time);
      window.setTimeout(() => {
        this.isRemoteSyncing = false;
      }, 600);
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
      const mediaChanged = this.state.roomMedia !== currentMedia;
      this.setState(
        {
          roomMedia: currentMedia,
          detectedMediaName: mediaChanged ? "" : this.state.detectedMediaName,
          roomVideoTS: data.videoTS ?? 0,
          roomPaused: data.paused,
          roomSubtitle: data.subtitle || "",
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
          if (currentMedia && (currentMedia.includes("youtube.com") || currentMedia.includes("youtu.be"))) {
            fetch(`https://noembed.com/embed?url=${encodeURIComponent(currentMedia)}`)
              .then((r) => r.json())
              .then((d) => {
                if (d?.title && this.state.roomMedia === currentMedia) {
                  this.setState({ detectedMediaName: d.title });
                }
              })
              .catch(() => {});
          }
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
            this.HTMLInterface.clearState();
          }
          if (data.subtitle) {
            this.setState({ roomSubtitle: data.subtitle });
            this.Player().loadSubtitles(data.subtitle);
            if (this.Player() !== this.HTMLInterface) {
              this.HTMLInterface.loadSubtitles(data.subtitle);
            }
          } else {
            this.setState({ roomSubtitle: "" });
            this.HTMLInterface.loadSubtitles("");
          }

          if (
            currentMedia &&
            !data.subtitle &&
            (currentMedia.includes("/stream?torrent=") || currentMedia.startsWith("magnet:"))
          ) {
            // Auto-detect and attach embedded subtitle files for torrent streams if present
            const detectTorrentSubtitles = async () => {
              if (this.state.roomSubtitle || this.state.roomMedia !== currentMedia) return;
              const dataUrl = currentMedia.includes("/stream?")
                ? (await withStreamKey(currentMedia.replace("/stream?", "/data?")))
                : `${serverPath}/data?torrent=${encodeURIComponent(currentMedia)}`;

              for (let attempt = 0; attempt < 5; attempt++) {
                if (this.state.roomSubtitle || this.state.roomMedia !== currentMedia) return;
                try {
                  const resp = await fetch(dataUrl);
                  if (this.state.roomMedia !== currentMedia) return;
                  if (resp.ok) {
                    const meta = await resp.json();
                    if (this.state.roomMedia !== currentMedia) return;
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
                        if (this.state.roomMedia !== currentMedia) return;
                        this.setState({ roomSubtitle: subUrl });
                        this.Player().loadSubtitles(subUrl);
                        return;
                      }
                    }
                    // Check for embedded subtitle tracks inside MKV / video file via /streamInfo
                    if (!this.state.roomSubtitle && this.state.roomMedia === currentMedia) {
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
                        if (this.state.roomMedia !== currentMedia) return;
                        if (infoRes.ok) {
                          const infoData = await infoRes.json();
                          if (this.state.roomMedia !== currentMedia) return;
                          if (infoData?.subtitleTracks && Array.isArray(infoData.subtitleTracks) && infoData.subtitleTracks.length > 0) {
                            const chosenSub =
                              infoData.subtitleTracks.find((t: any) => /english|eng|\ben\b/i.test(t.label || t.language || "")) ||
                              infoData.subtitleTracks[0];
                            if (chosenSub) {
                              const subUrl = `${serverPath}/streamSubtitle?torrent=${encodeURIComponent(cleanTorrent)}&streamIndex=${chosenSub.streamIndex}${fileIndexParam}`;
                              if (this.state.roomMedia !== currentMedia) return;
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
                    if (!this.state.roomSubtitle && this.state.roomMedia === currentMedia) {
                      try {
                        const movieTitle = meta?.name || this.getMediaDisplayName(currentMedia);
                        if (movieTitle && movieTitle !== "Torrent" && movieTitle !== "Torrent Stream") {
                          const osRes = await fetch(`${serverPath}/searchSubtitles?query=${encodeURIComponent(movieTitle)}&lang=en`);
                          if (this.state.roomMedia !== currentMedia) return;
                          if (osRes.ok) {
                            const osList = await osRes.json();
                            if (this.state.roomMedia !== currentMedia) return;
                            if (Array.isArray(osList) && osList.length > 0) {
                              const firstSub = osList[0];
                              const fileId = firstSub.attributes?.files?.[0]?.file_id;
                              const downloadUrl = firstSub.attributes?.downloadUrl || "";
                              if (fileId || downloadUrl) {
                                const dlParams = new URLSearchParams();
                                if (downloadUrl) dlParams.set("downloadUrl", downloadUrl);
                                if (fileId) dlParams.set("file_id", fileId);
                                const dlResp = await fetch(`${serverPath}/downloadSubtitles?${dlParams.toString()}`);
                                if (this.state.roomMedia !== currentMedia) return;
                                if (dlResp.ok) {
                                  const dlData = await dlResp.json();
                                  if (this.state.roomMedia !== currentMedia) return;
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
            };
            detectTorrentSubtitles();
          }
          if (data.playbackRate) {
            this.Player().setPlaybackRate(data.playbackRate);
          }

          if (this.usingMovie()) {
            this.setLoadingFalse();
            this.setState({ nonPlayableMedia: false });
            return;
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
          if (window.dipkri?.hls) {
            try {
              window.dipkri.hls.destroy();
            } catch {}
            window.dipkri.hls = undefined;
          }
          if (window.dipkri?.dash) {
            try {
              window.dipkri.dash.destroy();
            } catch {}
            window.dipkri.dash = undefined;
          }

          if (isMagnet(src) || src.includes("/stream?torrent=")) {
            const bridge = getDesktopBridge();
            const isApp = Boolean(bridge?.getSidecar);
            const isAllowed = isApp || this.canStreamTorrent();

            if (!isAllowed) {
              // Non-admin visitor on web browser: suppress server torrent requests to maintain 0% server video load.
              this.setLoadingFalse();
              this.setState({
                nonPlayableTorrentWeb: true,
                isAppDownloadModalOpen: true,
              });
              return;
            }
            this.setState({ nonPlayableTorrentWeb: false });

            // Direct streaming via server endpoint (supports public BitTorrent swarms, UDP trackers, and DHT)
            let streamUrl = isMagnet(src)
              ? `${serverPath}/stream?torrent=${encodeURIComponent(src)}`
              : (src.startsWith("/stream") ? `${serverPath}${src}` : src);

            // Desktop app: the torrent runs on this machine, so the bytes come
            // from 127.0.0.1 and the server only keeps the room in sync.
            if (bridge?.getSidecar) {
              try {
                const sidecar = await bridge.getSidecar();
                if (sidecar?.ready) {
                  const local = buildLocalStreamUrl(src, sidecar);
                  if (local) streamUrl = local;
                }
              } catch {}
            }
            const leftVideo = this.HTMLInterface.getVideoEl();
            const isKnownMkv =
              src.toLowerCase().includes(".mkv") ||
              streamUrl.toLowerCase().includes(".mkv") ||
              this.state.convertEnabled;
            const shouldTryTranscode =
              isClientTranscodeSupported() && isKnownMkv;

            if (shouldTryTranscode) {
              await this.convertAndPlay(streamUrl, time);
            } else {
              if (leftVideo) {
                const onStreamError = () => {
                  if (isClientTranscodeSupported()) {
                    console.log(
                      "[Player] Direct stream error; falling back to client-side demuxer/transcoder...",
                    );
                    void this.convertAndPlay(streamUrl, time);
                  } else {
                    void this.explainStreamFailure(streamUrl);
                  }
                };
                leftVideo.addEventListener("error", onStreamError, { once: true });
              }
              await this.Player().setSrcAndTime(streamUrl, time);
              if (leftVideo && leftVideo.error && isClientTranscodeSupported()) {
                console.log("[Player] Error detected immediately; falling back to convertAndPlay...");
                void this.convertAndPlay(streamUrl, time);
              }
            }
          } else if (isDash(src)) {
            const Dash = await import("dashjs");
            window.dipkri.dash = Dash.MediaPlayer().create();
            window.dipkri.dash.on("streamInitialized", (_e: any) => {
              const isLiveStream = this.Player().getDuration() >= Infinity;
              console.log("DASH stream initialized: isLive %s", isLiveStream);
              this.setState({
                isLiveStream,
              });
            });
            window.dipkri.dash.initialize(leftVideo, src);
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
              window.dipkri.hls = hls;

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
                      window.dipkri.hls = undefined;
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
                window.dispatchEvent(new CustomEvent("dipkri-audio-tracks-updated"));
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

          // Listen for canplay or loadeddata to safely finalize time and playback state
          const finalizePlayback = () => {
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
            if (!data.paused && leftVideo && leftVideo.paused) {
              this.localPlay();
            }
          };

          if (leftVideo && leftVideo.readyState >= 2) {
            finalizePlayback();
          } else {
            leftVideo?.addEventListener("canplay", finalizePlayback, { once: true });
            leftVideo?.addEventListener("loadeddata", finalizePlayback, { once: true });
          }

          // Safety timeout: ensure loading overlay never gets permanently stuck
          window.setTimeout(() => {
            if (this.state.loading && this.state.roomMedia === currentMedia) {
              this.setLoadingFalse();
            }
          }, 3500);

          // Progress updater
          window.clearInterval(this.progressUpdater);
          this.setState({ downloaded: 0, total: 0, speed: 0, connections: 0 });
          if (currentMedia.includes("/stream?torrent=") || isMagnet(currentMedia)) {
            const progressUrl = currentMedia.includes("/stream")
              ? (currentMedia.startsWith("http") ? currentMedia.replace("/stream", "/progress") : `${serverPath}${currentMedia.replace("/stream", "/progress")}`)
              : `${serverPath}/progress?torrent=${encodeURIComponent(currentMedia)}`;
            this.progressUpdater = window.setInterval(async () => {
              try {
                const response = await fetch(progressUrl);
                const data = await response.json();
                this.setState({
                  downloaded: data.downloaded,
                  total: data.total,
                  speed: data.speed,
                  connections: data.connections,
                  fileProgress:
                    typeof data.fileProgress === "number" ? data.fileProgress : 0,
                });

                // A stream can have full metadata (duration, audio, subtitles)
                // and still render black when the browser cannot decode its
                // video codec (typically HEVC/x265 or 10-bit).
                const mediaEl = this.HTMLInterface.getVideoEl();
                if (mediaEl) {
                  const stuck =
                    mediaEl.duration > 0 &&
                    mediaEl.currentTime > 1 &&
                    mediaEl.videoWidth === 0;
                  if (stuck !== this.state.videoDecodeIssue) {
                    this.setState({ videoDecodeIssue: stuck });
                  }
                }
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
          // Guard: only adjust when video is playing, not seeking, and has sufficient buffer
          const videoEl = this.Player().getVideoEl?.();
          const isPlaying = videoEl && !videoEl.paused && !videoEl.seeking;
          const hasBuffer = videoEl && videoEl.readyState >= 3; // HAVE_FUTURE_DATA
          if (isPlaying && hasBuffer) {
            const leader = this.getLeaderTime();
            const delta = leader - data[clientId];
            let pbr = 1;
            // Symmetric drift correction with gentle nudging
            if (delta > 0.5) {
              // Client is behind leader: gently speed up (max 1.1x)
              pbr += Number((delta / 10).toFixed(2));
              pbr = Math.min(pbr, 1.1);
            } else if (delta < -0.5) {
              // Client is ahead of leader: gently slow down (min 0.9x)
              pbr += Number((delta / 10).toFixed(2));
              pbr = Math.max(pbr, 0.9);
            }
            // Debounce rate changes to avoid audio pitch flutter (warble)
            const currentPbr = this.Player().getPlaybackRate();
            if (Math.abs(currentPbr - pbr) >= 0.02) {
              this.Player().setPlaybackRate(pbr);
            }
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
              leftVideo.removeAttribute("src");
              leftVideo.src = "";
              const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
              leftVideo.srcObject = stream;
              leftVideo.playsInline = true;
              leftVideo.muted = true;
              leftVideo.play().then(() => {
                leftVideo.muted = false;
              }).catch(() => {});
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
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
        const curTime = this.usingMovie()
          ? (this.movieCurrentTime || 0)
          : this.Player().getCurrentTime();
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
          ? window.localStorage.getItem("dipkri-custom-name")
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
          onError: (e: any) => {
            const code = e?.data;
            // YouTube Player API error codes:
            // 2: Invalid parameter, 5: HTML5 player error, 100: Video not found,
            // 101: Video doesn't allow embedding, 150: Same as 101
            const errorMessages: Record<number, string> = {
              2: "Invalid YouTube URL or parameters.",
              5: "YouTube HTML5 player error. Try a different browser or video.",
              100: "Video not found or has been removed.",
              101: "This video blocks embedding. Open on YouTube or pick another.",
              150: "This video blocks embedding. Open on YouTube or pick another.",
            };
            const message = errorMessages[code] || `YouTube error (${code}). Please try a different video.`;
            this.setState({
              streamError: { message, isYouTube: true, originalUrl: this.state.roomMedia },
            });
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
              if (!this.state.roomPaused) {
                this.YouTubeInterface.playVideo();
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

  // Maps the API's refusal (400/404/429/507) to a sentence the viewer can act on.
  explainStreamFailure = async (streamUrl: string) => {
    try {
      const res = await fetch(streamUrl, { method: "HEAD", cache: "no-store" });
      if (res.ok) return;

      const message =
        res.status === 401
          ? "Please sign in with Google to watch this party."
          : res.status === 429
          ? "The server is busy right now — please try again in a minute."
          : res.status === 507
            ? "The server's storage is full, so this stream cannot start. Try another title or come back later."
            : res.status === 404
              ? "No playable video file was found in this torrent."
              : res.status === 400
                ? "This stream link is not valid."
                : "";
      if (message) {
        this.setState({ streamError: { message, isYouTube: false, originalUrl: streamUrl } });
      }
    } catch {
      // offline / aborted: the player already shows its own error state
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
          leftVideo.removeAttribute("src");
          leftVideo.src = "";
          const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
          leftVideo.srcObject = stream;
          leftVideo.playsInline = true;
          // Auto-mute initially to satisfy browser autoplay requirements, then unmute
          leftVideo.muted = true;
          leftVideo.play().then(() => {
            leftVideo.muted = false;
          }).catch((err) => {
            console.warn("Autoplay with sound failed, staying muted:", err);
          });
          this.setLoadingFalse();
          this.setState({ nonPlayableMedia: false });
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

  usingMovie = () => {
    return isMovie(this.state.roomMedia);
  };

  isAnyMovie = () => {
    return this.usingMovie() || isMovieStream(this.state.roomMedia);
  };

  usingNative = () => {
    // Anything that uses HTML Video (e.g. not YouTube, Movie iframe, or other embedded JS player)
    return !this.usingYoutube() && !this.usingMovie();
  };

  getMovieUrl = () => {
    const info = parseMovieUrl(this.state.roomMedia);
    const startAt =
      this.movieStartAt > 0
        ? this.movieStartAt
        : typeof this.state.roomVideoTS === "number" && this.state.roomVideoTS > 5
        ? this.state.roomVideoTS
        : undefined;
    return buildMovieEmbedUrl(info, startAt);
  };

  syncMovieToTime = (targetTime: number) => {
    if (!Number.isFinite(targetTime) || targetTime < 0) return;
    this.movieStartAt = Math.floor(targetTime);
    this.movieCurrentTime = targetTime;
    this.movieSyncKey = (this.movieSyncKey || 0) + 1;
    this.setState({ roomVideoTS: targetTime });
  };

  handleMovieMessage = (event: MessageEvent) => {
    if (!this.usingMovie()) return;
    try {
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {}
      }
      if (!data || typeof data !== "object") return;

      const evType = data.event || data.type;
      const curTime =
        typeof data.currentTime === "number"
          ? data.currentTime
          : typeof data.data?.currentTime === "number"
          ? data.data.currentTime
          : undefined;

      const dur =
        typeof data.duration === "number"
          ? data.duration
          : typeof data.data?.duration === "number"
          ? data.data.duration
          : undefined;

      if (typeof dur === "number" && dur > 0) {
        this.MovieInterface.duration = dur;
      }

      if (typeof curTime === "number" && !isNaN(curTime) && curTime >= 0) {
        this.movieCurrentTime = curTime;
        this.MovieInterface.currentTime = curTime;
      }

      if (evType === "pause") {
        this.MovieInterface.isPaused = true;
        if (this.haveLock() && !this.state.roomPaused) {
          this.socket.emit("CMD:pause");
          this.setState({ roomPaused: true });
        }
      } else if (evType === "play") {
        this.MovieInterface.isPaused = false;
        if (this.haveLock() && this.state.roomPaused) {
          this.socket.emit("CMD:play");
          this.setState({ roomPaused: false });
        }
      } else if (evType === "seeked" && typeof curTime === "number") {
        // A seek we applied from the host is not a user action.
        if (this.isRemoteSyncing) {
          this.isRemoteSyncing = false;
          return;
        }
        if (this.haveLock()) {
          this.socket.emit("CMD:seek", curTime);
        }
      }
    } catch {}
  };

  openMovieModal = () => {
    this.setState({ isMovieModalOpen: true });
  };

  pasteLinkFromClipboard = async () => {
    // Reads the clipboard; if it holds a playable link, start it immediately.
    // Otherwise focus the media input so the user can paste manually.
    const focusSearch = () => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder*="Enter video file URL"]',
      );
      if (input) {
        input.focus();
        input.select();
      }
    };
    try {
      const text = (await navigator.clipboard.readText())?.trim();
      if (
        text &&
        (isHttp(text) || isMagnet(text) || text.startsWith("movie://"))
      ) {
        this.roomSetMedia(text);
        return;
      }
    } catch {}
    focusSearch();
  };

  closeMovieModal = () => {
    this.setState({ isMovieModalOpen: false });
  };

  switchMovieServer = (newServer: MovieServer) => {
    const info = parseMovieUrl(this.state.roomMedia);
    if (!info) return;
    info.server = newServer;
    const newUrl = createMovieProtocolUrl(info);
    this.roomSetMedia(newUrl);
  };

  cycleNextMovieServer = () => {
    const servers: MovieServer[] = [
      "vidlink",
      "vidsrc_pm",
      "twoembed",
      "apiplayer",
    ];
    const info = parseMovieUrl(this.state.roomMedia);
    if (!info) return;
    const currentServer = info.server || "vidlink";
    const curIdx = servers.indexOf(currentServer);
    const nextServer = servers[(curIdx + 1) % servers.length];
    this.switchMovieServer(nextServer);
  };

  hasDuration = () => {
    // Youtube, link, magnet, or movie stream. Has a defined runtime (not WebRTC)
    return (
      isHttp(this.state.roomMedia) ||
      isMagnet(this.state.roomMedia) ||
      isMovie(this.state.roomMedia)
    );
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
    if (this.usingMovie()) {
      this.syncMovieToTime(target);
      return;
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
        // On Android Chrome, WebRTC shifts audio to earpiece — force back to
        // the loudspeaker as soon as the user has already interacted with the
        // page (required for setSinkId to succeed).
        const video = this.HTMLInterface.getVideoEl();
        if (video) {
          import("../VideoChat/SpeakerHelper").then(({ ensureLoudspeaker }) =>
            ensureLoudspeaker(video).catch(() => {}),
          );
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

    // For remuxed streams (MKV -> MP4 with format=mp4), we need to reload the stream with ?ss= parameter
    // since the remuxed stream has Accept-Ranges: none
    const isRemuxed = this.state.roomMedia && this.state.roomMedia.includes("format=mp4");
    if (isRemuxed) {
      // Reload the stream with ?ss= parameter
      const currentMedia = this.state.roomMedia;
      const separator = currentMedia.includes("?") ? "&" : "?";
      const newStreamUrl = `${currentMedia}${separator}ss=${target}`;

      // Emit CMD:host to server, which will broadcast REC:host to all clients
      // The REC:host handler will reload the stream with the new ss parameter
      this.socket.emit("CMD:host", newStreamUrl);
      // Don't call localSeek here - REC:host handler will handle seeking after reload
    } else {
      // Normal seek for non-remuxed streams
      this.Player().seekVideo(target);
      const seekId = this.generateSeekId();
      this.lastSentSeekId = seekId;
      const toSend = { time: this.getRoomTSToSet(target), seekId };
      this.socket.emit("CMD:seek", toSend);
      if (this.state.roomMedia && this.state.roomId) {
        this.savePlaybackTime(
          this.state.roomId,
          this.state.roomMedia,
          target,
          this.state.roomPaused,
        );
      }
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

  // Generate a unique seekId for tracking seek requests
  private generateSeekId = () => `seek-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  onFullScreenChange = () => {
    // Check both standard and webkit-prefixed (Android Chrome/WebView)
    const fs = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!fs) {
      try {
        (window.screen.orientation as any)?.unlock?.();
      } catch (_) {}
      if (window.history.state?.wp_fullscreen) {
        window.history.back();
      }
    }
    this.setState({ fullScreen: fs });
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

  handlePopState = () => {
    if (this.state.fullScreen) {
      this.exitFullScreen(false);
    }
  };

  exitFullScreen = (handleHistory: boolean = true) => {
    try {
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        const exit =
          document.exitFullscreen?.bind(document) ||
          (document as any).webkitExitFullscreen?.bind(document);
        exit?.()?.catch(() => {});
      }
    } catch (_) {}
    try {
      (window.screen.orientation as any)?.unlock?.();
    } catch (_) {}
    if (handleHistory && window.history.state?.wp_fullscreen) {
      window.history.back();
    }
    this.setState({ fullScreen: false });
  };

  enterFullScreen = (bVideoOnly: boolean = true) => {
    const videoParent = document.getElementById("leftVideoParent");
    const container = bVideoOnly ? (videoParent || document.body) : document.body;

    this.setState({ fullScreen: true });

    if (this.state.isMobileView) {
      try {
        window.history.pushState({ wp_fullscreen: true }, "");
      } catch (_) {}
      try {
        (window.screen.orientation as any)?.lock?.("landscape").catch(() => {});
      } catch (_) {}
    }

    try {
      const req =
        (container as any).requestFullscreen?.bind(container) ||
        (container as any).webkitRequestFullscreen?.bind(container);
      req?.()?.catch((err: any) => {
        console.warn("Fullscreen request handled with CSS fallback:", err);
      });
    } catch (err) {
      console.warn("enterFullScreen threw:", err);
    }
  };

  localFullScreen = (bVideoOnlyOrFs?: boolean) => {
    const isCurrentlyFs = Boolean(
      this.state.fullScreen ||
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement
    );

    if (isCurrentlyFs) {
      this.exitFullScreen();
    } else {
      const bVideoOnly = bVideoOnlyOrFs !== false;
      this.enterFullScreen(bVideoOnly);
    }
  };

  localToggleMute = () => {
    this.localSetMute(!this.Player().isMuted());
  };

  terminateRoom = () => {
    const confirmTerminate = window.confirm(
      "End this watch party for everyone? The room will be closed and removed from your active parties."
    );
    if (!confirmTerminate) return;
    const cleanId = this.state.roomId?.replace(/^\//, "");
    try {
      fetch("/terminateRoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: cleanId,
          hostToken: cleanId ? localStorage.getItem(`wp_host_${cleanId}`) || "" : "",
        }),
      }).catch(() => {});
      desktopRoomEnd(cleanId);
      localStorage.removeItem("wp_last_room");
      localStorage.removeItem("wp_active_party");
      if (cleanId) localStorage.removeItem(`wp_playback_${cleanId}`);
    } catch {}
    window.location.assign("/");
  };

  canStreamTorrent = (): boolean => {
    return canStreamTorrents(this.context?.user?.email);
  };

  roomSetMedia = (value: string) => {
    const resolved = resolveMediaUrl(value);
    if (
      (isMagnet(resolved) || resolved.includes("/stream?torrent=")) &&
      !this.canStreamTorrent()
    ) {
      this.setState({ isAppDownloadModalOpen: true });
      return;
    }
    this.socket.emit("CMD:host", resolved);
  };

  setConvertEnabled = (convertEnabled: boolean) => {
    window.localStorage.setItem(
      "dipkri-convert",
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
    window.localStorage.setItem("dipkri-username", name);
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
    if (isMovie(input)) {
      const info = parseMovieUrl(input);
      if (info) {
        if (info.type === "tv" && info.season && info.episode) {
          return `📺 ${info.title} (S${info.season} E${info.episode})`;
        }
        return `🎬 ${info.title}`;
      }
      return "🎬 Movie Stream";
    }
    // If input is YouTube, return YouTube video title if detected or input
    if (this.usingYoutube() || input.includes("youtube.com") || input.includes("youtu.be")) {
      const ytData = ((this.YouTubeInterface as any).player || (this.YouTubeInterface as any))?.getVideoData?.();
      if (ytData?.title) {
        return ytData.title;
      }
      if (
        this.state?.detectedMediaName &&
        !this.state.detectedMediaName.includes("720p") &&
        !this.state.detectedMediaName.includes("1080p") &&
        !this.state.detectedMediaName.includes("BluRay")
      ) {
        return this.state.detectedMediaName;
      }
      return input;
    }
    // Only return detectedMediaName if input is actually the torrent stream
    if (this.state?.detectedMediaName && (input.includes("/stream?torrent=") || isMagnet(input))) {
      return this.state.detectedMediaName;
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
        if (/s\d+e\d+/i.test(name)) {
          return `📺 ${name}`;
        }
        return `🎬 ${name}`;
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
    const currentVideoTime = this.usingMovie()
      ? (this.movieCurrentTime || 0)
      : this.Player().getCurrentTime();
    const isBehind =
      !this.state.isLiveStream &&
      !this.playingScreenShare() &&
      !this.playingFileShare() &&
      Boolean(this.getLeaderTime()) &&
      Number.isFinite(this.getLeaderTime()) &&
      this.getLeaderTime() > 0 &&
      this.getLeaderTime() - currentVideoTime > 10;
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
        isFullScreen={this.state.fullScreen}
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
        roomLock={this.state.roomLock}
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
        onJoinVideo={() => this.getActiveVideoChat()?.setupWebRTC()}
        onLeaveVideo={() => this.getActiveVideoChat()?.stopWebRTC()}
        onToggleVideo={() => this.getActiveVideoChat()?.toggleVideoWebRTC()}
        onToggleAudio={() => this.getActiveVideoChat()?.toggleAudioWebRTC()}
        isVideoMuted={!this.getActiveVideoChat()?.getVideoWebRTC()}
        isAudioMuted={!this.getActiveVideoChat()?.getAudioWebRTC()}
        downloaded={this.state.downloaded}
        total={this.state.total}
        speed={this.state.speed}
        connections={this.state.connections}
        convertProgress={this.state.convertProgress}
        isMovie={this.isAnyMovie()}
        movieServer={parseMovieUrl(this.state.roomMedia)?.server || "vidlink"}
        onSelectMovieServer={this.switchMovieServer}
        onOpenMovieModal={this.openMovieModal}
      />
    );
    const renderPlayerBox = (isMobileLayout: boolean) => (
      <div
        className={`${styles.playerContainer} ${
          this.state.fullScreen ? styles.playerContainerFullscreen : ""
        }`}
        id="leftVideoParent"
        style={
          this.state.fullScreen
            ? { width: "100vw", height: "100dvh", minHeight: "100dvh", maxHeight: "100dvh", borderRadius: 0 }
            : isMobileLayout
            ? { minHeight: "100%", height: "100%", borderRadius: 0 }
            : undefined
        }
      >
        {(this.state.loading ||
          !this.state.roomMedia ||
          this.state.nonPlayableMedia) &&
          !this.state.isLiveStream &&
          !this.usingMovie() && (
            <div
              id="loader"
              className={`${styles.videoContent} ${styles.flexCenter}`}
            >
              {this.state.loading && (
                <div
                  className={styles.flexCenter}
                  style={{
                    flexDirection: "column",
                    gap: 12,
                    background: "rgba(9, 10, 15, 0.75)",
                    padding: "24px 32px",
                    borderRadius: 16,
                    border: "1px solid rgba(99, 102, 241, 0.25)",
                    backdropFilter: "blur(12px)",
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
                  }}
                >
                  <Loader size="lg" color="indigo" />
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, textAlign: "center" }}>
                    {isMovieStream(this.state.roomMedia)
                      ? "🎬 Connecting to High-Speed Stream..."
                      : this.playingVBrowser()
                      ? "Launching virtual browser. This can take up to a minute."
                      : "Loading stream..."}
                  </div>
                  {isMovieStream(this.state.roomMedia) && (
                    <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center" }}>
                      Buffering HD video chunks & synchronizing room audio...
                    </div>
                  )}
                </div>
              )}
              {!this.state.loading &&
                !this.state.nonPlayableMedia &&
                this.state.roomMedia &&
                (isMagnet(this.state.roomMedia) ||
                  this.state.roomMedia.includes("torrent=")) &&
                !this.state.isLiveStream &&
                !this.state.roomPaused &&
                this.Player().getDuration() === 0 && (
                  <div className={styles.bufferingOverlay}>
                    <Loader size="md" color="indigo" />
                    <div className={styles.bufferingTitle}>Buffering pieces…</div>
                    <div className={styles.bufferingMeta}>
                      {this.state.total
                        ? `${this.getDownloadPercent().toFixed(1)}% • ${formatSpeed(this.state.speed)} • ${this.state.connections} peers`
                        : "Connecting to peers…"}
                    </div>
                    <div className={styles.bufferingHint}>
                      Slow torrent? Pick a stream with more seeders.
                    </div>
                    {this.state.total > 0 &&
                      this.state.downloaded === 0 &&
                      this.state.connections === 0 && (
                        <div
                          className={styles.bufferingHint}
                          style={{ color: "#f87171", fontWeight: 700 }}
                        >
                          No seeders responding — pick another stream.
                        </div>
                      )}
                  </div>
                )}
              {this.state.videoDecodeIssue && !this.state.roomPaused && (
                <div className={styles.bufferingOverlay}>
                  <div className={styles.bufferingTitle}>Video can't be decoded</div>
                  <div className={styles.bufferingMeta}>
                    Audio and subtitles work, but this codec (likely HEVC/x265 or
                    10-bit) has no browser decoder.
                  </div>
                  <div className={styles.bufferingHint} style={{ color: "#f87171" }}>
                    Pick a stream whose badge says x264 — those play everywhere.
                  </div>
                </div>
              )}
              {!this.state.loading && !this.state.roomMedia && (
                <Alert
                  color="yellow"
                  title="You're not watching anything!"
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        size="compact-sm"
                        color="indigo"
                        leftSection={<WPIconPlay size={14} />}
                        onClick={() => this.openMovieModal()}
                      >
                        Select Movie
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="light"
                        color="indigo"
                        leftSection={<WPIconFile size={14} />}
                        onClick={this.pasteLinkFromClipboard}
                      >
                        Paste Link
                      </Button>
                    </div>
                  </div>
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
        {this.usingMovie() && (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              minHeight: isMobileLayout ? "260px" : "480px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <iframe
              id="leftMovie"
              key={`${this.state.roomMedia}_${this.movieSyncKey}`}
              title="Movie Player"
              style={{
                width: "100%",
                height: "100%",
                flex: 1,
                minHeight: isMobileLayout ? "260px" : "480px",
                border: "none",
                borderRadius: isMobileLayout ? "0" : "12px",
                backgroundColor: "#000",
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              src={this.getMovieUrl()}
              onLoad={() => {
                this.setLoadingFalse();
                this.setState({ nonPlayableMedia: false });
              }}
            />
            {/* Audio Autoplay Unmute Helper for Web Iframes */}
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 20,
                background: "rgba(15, 23, 42, 0.85)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(99, 102, 241, 0.35)",
                borderRadius: 20,
                padding: "4px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "#cbd5e1",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              <span>🔊</span>
              <span>Click player to unmute if silent</span>
            </div>
            {/* Playback Paused Overlay */}
            {this.state.roomPaused && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  background: "rgba(10, 12, 22, 0.35)",
                  backdropFilter: "blur(2px)",
                  WebkitBackdropFilter: "blur(2px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 15,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    background: "rgba(15, 23, 42, 0.88)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(99, 102, 241, 0.4)",
                    borderRadius: 20,
                    padding: "16px 24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    boxShadow: "0 12px 36px rgba(0, 0, 0, 0.7)",
                    cursor: this.haveLock() ? "pointer" : "default",
                    pointerEvents: this.haveLock() ? "auto" : "none",
                  }}
                  onClick={this.roomTogglePlay}
                >
                  <div
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: "50%",
                      background:
                        "linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(139, 92, 246, 0.9))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 0 25px rgba(99, 102, 241, 0.6)",
                      marginBottom: 10,
                    }}
                  >
                    <WPIconPlay size={28} color="#fff" />
                  </div>
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 700,
                      letterSpacing: "-0.3px",
                    }}
                  >
                    Playback Paused
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4, textAlign: "center" }}>
                    {this.haveLock()
                      ? "Tap here to Resume room or touch player directly"
                      : "Host paused the movie"}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {false ? (
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
            onLoadedData={() => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
            }}
            onLoadedMetadata={() => {
              this.setLoadingFalse();
              this.setState({ nonPlayableMedia: false });
            }}
            onEnded={(e) => this.onVideoEnded(e.currentTarget.src)}
            playsInline
            onClick={this.roomTogglePlay}
          ></video>
        )}
        {this.state.nonPlayableTorrentWeb && (
          <div className={styles.torrentWebNoticeOverlay}>
            <div className={styles.torrentWebNoticeBox}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧲</div>
              <h3
                style={{
                  margin: "0 0 8px 0",
                  color: "#f8fafc",
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                P2P Swarm Stream Active
              </h3>
              <p
                style={{
                  margin: "0 0 16px 0",
                  color: "#94a3b8",
                  fontSize: 13,
                  lineHeight: 1.5,
                  maxWidth: 380,
                }}
              >
                High-speed torrent streaming runs directly on your device via P2P swarm.
                Download the Dipkri Android APK or Desktop App for instant zero-buffer 4K playback.
              </p>
              <button
                type="button"
                onClick={() => this.setState({ isAppDownloadModalOpen: true })}
                style={{
                  background:
                    "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(79, 70, 229, 0.4)",
                }}
              >
                Get Dipkri App
              </button>
            </div>
          </div>
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
              this.state.total || this.state.fileProgress > 0
                ? `${this.getDownloadPercent().toFixed(1)}%`
                : isMobileLayout
                  ? "Connecting..."
                  : "Connecting to peers...",
              Boolean(this.state.total) && formatSpeed(this.state.speed),
              Boolean(this.state.total) &&
                (isMobileLayout ? `${this.state.connections}p` : `${this.state.connections} peers`),
              this.state.convertProgress !== undefined &&
                (this.state.convertProgress * 100).toFixed(1) + "% conv",
            ]
              .filter(Boolean)
              .join(" • ")}
            {(() => {
              const audioStatus = audioEnhancer.getAudioDecodingStatus(this.HTMLInterface.getVideoEl());
              if (!audioStatus.hasAudio) return null;
              const isEAC = audioStatus.isTranscoding || ['eac3', 'ac3', 'dts'].includes(audioStatus.codec || '');
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 9999,
                    background: audioStatus.isDecoded
                      ? isEAC
                        ? 'rgba(16, 185, 129, 0.16)'
                        : 'rgba(56, 189, 248, 0.16)'
                      : 'rgba(234, 179, 8, 0.18)',
                    border: `1px solid ${audioStatus.isDecoded ? (isEAC ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.35)') : 'rgba(234, 179, 8, 0.4)'}`,
                    color: audioStatus.isDecoded ? (isEAC ? '#34d399' : '#38bdf8') : '#facc15',
                    fontSize: isMobileLayout ? 10 : 11,
                    fontWeight: 600,
                  }}
                  title={audioStatus.statusText}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: audioStatus.isDecoded ? (isEAC ? '#34d399' : '#38bdf8') : '#facc15',
                      boxShadow: audioStatus.isDecoded
                        ? `0 0 6px ${isEAC ? '#34d399' : '#38bdf8'}`
                        : '0 0 6px #facc15',
                    }}
                  />
                  <span>
                    {audioStatus.codec ? audioStatus.codec.toUpperCase() : 'AUDIO'}:{' '}
                    {audioStatus.isDecoded
                      ? audioStatus.isTranscoding
                        ? isMobileLayout
                          ? `Decoded ${audioStatus.decodePercent}% (+${Math.round(audioStatus.bufferedSeconds)}s)`
                          : `Decoded MP3 ${audioStatus.decodePercent}% (+${audioStatus.bufferedSeconds.toFixed(1)}s)`
                        : 'Decoded 100%'
                      : `Decoding ${audioStatus.decodePercent || 0}%...`}
                  </span>
                </span>
              );
            })()}
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
            playlistAdd={this.roomPlaylistAdd}
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
        <MovieModal
          isOpen={this.state.isMovieModalOpen}
          onClose={this.closeMovieModal}
          onPlay={this.roomSetMedia}
          onQueue={this.roomPlaylistAdd}
        />
        <AppDownloadModal
          isOpen={this.state.isAppDownloadModalOpen}
          onClose={() => this.setState({ isAppDownloadModalOpen: false })}
          mediaTitle={this.state.detectedMediaName || this.state.roomMedia}
        />
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
          onTerminate={this.terminateRoom}
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

        {/* Stream Error Fallback UI */}
        {this.state.streamError && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(9, 10, 15, 0.94)",
              backdropFilter: "blur(24px)",
              zIndex: 1000,
              padding: "24px",
            }}
          >
            <div
              style={{
                maxWidth: "520px",
                width: "100%",
                background: "rgba(15, 17, 24, 0.96)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: "16px",
                padding: "32px",
                boxShadow: "0 24px 48px rgba(0, 0, 0, 0.8)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>
                {this.state.streamError.isYouTube ? "📺" : "🎬"}
              </div>
              <h2 style={{ color: "#F0F0F5", margin: "0 0 12px", fontSize: "22px", fontWeight: 700 }}>
                {this.state.streamError.isYouTube ? "YouTube Playback Error" : "Stream Playback Error"}
              </h2>
              <p style={{ color: "rgba(240,240,245,0.8)", margin: "0 0 24px", fontSize: "15px", lineHeight: 1.5 }}>
                {this.state.streamError.message}
              </p>
              <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    this.setState({ streamError: null });
                    if (this.state.streamError?.originalUrl) {
                      this.socket?.emit("CMD:host", this.state.streamError.originalUrl);
                    }
                  }}
                  style={{
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 24px",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = "scale(1.02)"}
                  onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}
                >
                  Retry Stream
                </button>
                {this.state.streamError.isYouTube && (
                  <a
                    href={this.state.streamError.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "10px",
                      padding: "12px 24px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: "pointer",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      transition: "all 0.2s ease",
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.178 3.178 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505a3.178 3.178 0 0 0-2.122 2.136C1.046 5.083.335 8.002.335 12s.712 6.917 1.87 9.813a3.178 3.178 0 0 0 2.122 2.136c1.872.505 9.376.505 9.376.505s7.504 0 9.377-.505a3.178 3.178 0 0 0 2.122-2.136c1.158-2.896.447-5.815-.44-9.838zM12 6.865a4.97 4.97 0 0 1 1.307 3.26c-.23.614-.27 1.29-.27 2.045 0 1.823 1.384 3.432 3.088 3.6V21l5.302-3.204a.917.917 0 0 0 .697-1.406V7.158A3.66 3.66 0 0 0 12 6.865z"/></svg>
                    Open on YouTube
                  </a>
                )}
                <button
                  onClick={() => this.setState({ streamError: null })}
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "10px",
                    padding: "12px 24px",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
                  onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reconnection Overlay */}
        {this.state.isReconnecting && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(9, 10, 15, 0.92)",
              backdropFilter: "blur(24px)",
              zIndex: 2000,
              padding: "24px",
            }}
          >
            <div
              style={{
                maxWidth: "400px",
                width: "100%",
                background: "rgba(15, 17, 24, 0.96)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: "16px",
                padding: "32px",
                boxShadow: "0 24px 48px rgba(0, 0, 0, 0.8)",
                textAlign: "center",
              }}
            >
              <div style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    border: "3px solid rgba(99, 102, 241, 0.3)",
                    borderTopColor: "#6366f1",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    margin: "0 auto 16px",
                  }}
                />
              </div>
              <h2 style={{ color: "#F0F0F5", margin: "0 0 8px", fontSize: "20px", fontWeight: 700 }}>
                Reconnecting to Party
              </h2>
              <p style={{ color: "rgba(240,240,245,0.7)", margin: "0", fontSize: "14px", lineHeight: 1.5 }}>
                {this.state.reconnectReason || "Connection lost. Attempting to reconnect..."}
              </p>
            </div>
          </div>
        )}
        {this.state.state === "connected" && (
          <>
            <RemoteAudioRenderer participants={this.state.participants} />
            <FloatingWebcamBubbles
              participants={this.state.participants}
              nameMap={this.state.nameMap}
              pictureMap={this.state.pictureMap}
              socket={this.socket}
              onJoinVideo={() => this.getActiveVideoChat()?.setupWebRTC()}
              onLeaveVideo={() => this.getActiveVideoChat()?.stopWebRTC()}
              onToggleVideo={() => this.getActiveVideoChat()?.toggleVideoWebRTC()}
              onToggleAudio={() => this.getActiveVideoChat()?.toggleAudioWebRTC()}
              isVideoMuted={!this.getActiveVideoChat()?.getVideoWebRTC()}
              isAudioMuted={!this.getActiveVideoChat()?.getAudioWebRTC()}
              isFullScreen={this.state.fullScreen}
            />
          </>
        )}
        {this.state.isMobileView ? (
          <div className={styles.mobileAppContainer}>
            {/* Slim 38px Compact Mobile Header with Room Code & Sync Status */}
            {!this.state.fullScreen && (
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
                {this.state.roomId && (
                  <button
                    type="button"
                    className={styles.mobileTerminateBtn}
                    onClick={this.terminateRoom}
                    title="End this watch party"
                  >
                    <span>End</span>
                  </button>
                )}
              </div>
            </header>
            )}

            {/* Fixed 16:9 Video Player (Top pinned, zero scroll with on-video controls) */}
            <div
              className={`${styles.mobileVideoWrapper} ${
                this.state.fullScreen ? styles.mobileVideoWrapperFullscreen : ""
              } ${
                this.state.isKeyboardOpen || this.state.isTyping
                  ? styles.mobileVideoWrapperKeyboardOpen
                  : ""
              }`}
            >
              {renderPlayerBox(true)}
            </div>

            {/* Content Area for Active Tab */}
            {!this.state.fullScreen && (
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
                  roomLock={this.state.roomLock}
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
                      onOpenMovieModal={this.openMovieModal}
                    />
                    {/* Quick Action Source Cards */}
                    <div className={styles.quickSourceGrid}>
                      <button
                        type="button"
                        className={`${styles.sourceCardBtn} ${styles.sourceCardScreen}`}
                        style={{
                          background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))",
                          borderColor: "rgba(99, 102, 241, 0.45)",
                        }}
                        disabled={!this.haveLock()}
                        onClick={this.openMovieModal}
                        title="Browse & stream Movies & Series"
                      >
                        <div
                          className={styles.sourceCardIcon}
                          style={{
                            background: "rgba(99, 102, 241, 0.25)",
                            color: "#a5b4fc",
                            fontSize: "14px",
                          }}
                        >
                          🎬
                        </div>
                        <span className={styles.sourceCardTitle} style={{ color: "#c7d2fe" }}>Movies</span>
                        <span className={styles.sourceCardSub}>& Series HD</span>
                      </button>
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
                        Queue is empty
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
                      ref={this.mobileVideoChatRef}
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
                    onTerminate={this.terminateRoom}
                  />
                </div>
              )}
            </div>
            )}

            {/* Smartphone Native Bottom Navigation Bar - completely hidden while typing */}
            {!this.state.fullScreen && !this.state.isKeyboardOpen && !this.state.isTyping && (
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
                        onOpenMovieModal={this.openMovieModal}
                      />
                    </div>

                    {/* Media Actions */}
                    <div className={styles.desktopMediaActions}>
                      <button
                        type="button"
                        className={`${styles.desktopPillBtn} ${styles.desktopPillScreen}`}
                        style={{
                          background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))",
                          borderColor: "rgba(99, 102, 241, 0.5)",
                          color: "#c7d2fe",
                        }}
                        disabled={!this.haveLock()}
                        onClick={this.openMovieModal}
                        title="Search and stream Movies & Series"
                      >
                        <span style={{ fontSize: 13 }}>🎬</span>
                        <span>Movies</span>
                      </button>
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
                            "dipkri-showchatcolumn",
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
                      roomLock={this.state.roomLock}
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
