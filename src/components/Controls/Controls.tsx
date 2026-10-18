import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Badge, Menu, Progress } from "@mantine/core";
import {
  formatTimestamp,
  getDefaultPicture,
  getColorForStringHex,
  formatSpeed,
  serverPath,
} from "../../utils/utils";
import styles from "./Controls.module.css";
import {
  WPIconPlay,
  WPIconPause,
  WPIconRewind10,
  WPIconForward10,
  WPIconSkipForward,
  WPIconCaptions,
  WPIconTheater,
  WPIconFullscreen,
  WPIconFullscreenExit,
  WPIconPictureInPicture,
  WPIconSync,
  WPIconSpeed,
  WPIconCheck,
  WPIconChat,
  WPIconClose,
  WPIconSettings,
  WPIconVolumeOn,
  WPIconVolumeLow,
  WPIconVolumeOff,
  WPIconMonitor,
  WPIconSearch,
  WPIconVideo,
  WPIconVideoOff,
  WPIconMicrophone,
  WPIconMicrophoneOff,
  WPIconLock,
  WPIconLockOpen,
} from "../Icons/CustomIcons";
import {
  getWebcamSettings,
  setWebcamSettings,
  BubbleSize,
} from "../VideoChat/webcamSettings";
import {
  getPlayerSettings,
  setPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
  PlayerSettingsState,
  CaptionSize,
  CaptionColor,
  CaptionStyle,
  CaptionPosition,
} from "../PlayerSettings/playerSettings";
import { qualityManager, QUALITY_PRESETS } from "../PlayerSettings/qualityManager";
import { audioEnhancer } from "../PlayerSettings/audioEnhancer";
import { Chat } from "../Chat/Chat";
import { PlayerSettingsMenu } from "./PlayerSettingsMenu";

export const cleanMovieTitle = (raw: string): { title: string; meta: string } => {
  if (!raw) return { title: "", meta: "" };
  let name = raw;
  const dnMatch = name.match(/[?&]dn=([^&]+)/i);
  if (dnMatch) {
    try {
      name = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
      if (name.includes("%")) {
        try { name = decodeURIComponent(name); } catch {}
      }
    } catch {}
  } else if (name.startsWith("magnet:")) {
    const match = name.match(/dn=([^&]+)/i);
    if (match) {
      name = decodeURIComponent(match[1].replace(/\+/g, " "));
    }
  } else if (name.startsWith("http://") || name.startsWith("https://") || name.startsWith("/")) {
    try {
      const u = new URL(name, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const torrentParam = u.searchParams.get("torrent");
      if (torrentParam) {
        const tDn = torrentParam.match(/[?&]dn=([^&]+)/i);
        if (tDn) {
          name = decodeURIComponent(tDn[1].replace(/\+/g, " "));
        }
      } else {
        const last = u.pathname.split("/").filter(Boolean).pop();
        if (last && last !== "stream") {
          name = decodeURIComponent(last);
        }
      }
    } catch {}
  }
  name = name.replace(/\.(mkv|mp4|webm|avi|mov|flv|m4v|ts)$/i, "");

  // Strip website watermarks / domains e.g. www.1TamilMV.capital, [1TamilMV.org], etc.
  name = name.replace(/^(?:\[[^\]]+\]|\([^\)]+\)|\b(?:www\.)?[a-zA-Z0-9\-]+(?:\.[a-zA-Z]{2,8})+\b)\s*[-_–—:]*\s*/gi, "");
  name = name.replace(/\b(?:1TamilMV|TamilMV|TamilBlasters|TamilRockers|TamilYogi|Movierulz|Bolly4u|KatmovieHD|Vegamovies|YTS|YIFY|PSA|GalaxyRG|TGx|ETRG|RARBG|Extratorrent|TorrentCounter|Cinemavilla|Kuttymovies|Pagalworld|PaglaMovies|Isaimini|MadrasRockers|MalluMv|JioRockers|BalaRockers|1TamilBlasters|capital)\b\s*[-_–—:]*\s*/gi, "");

  name = name.replace(/[\._\-]/g, " ").replace(/\s+/g, " ").trim();

  const yearMatch = name.match(/[\(\[]?\b(19\d\d|20\d\d)\b[\)\]]?/);
  if (yearMatch && typeof yearMatch.index === "number") {
    const endIdx = yearMatch.index + yearMatch[0].length;
    const titlePart = name.slice(0, endIdx).trim();
    const metaPart = name.slice(endIdx).replace(/^[\)\]\s\-_.]+/, "").trim();
    return { title: titlePart, meta: metaPart };
  }
  return { title: name.trim(), meta: "" };
};

interface ControlsProps {
  duration: number;
  video: string;
  paused: boolean;
  muted: boolean;
  volume: number;
  subtitled: boolean;
  currentTime: number;
  disabled?: boolean;
  leaderTime?: number;
  isPauseDisabled?: boolean;
  playbackRate: number;
  roomPlaybackRate: number;
  isYouTube: boolean;
  isLiveStream: boolean;
  timeRanges: { start: number; end: number }[];
  loop: boolean;
  roomTogglePlay: () => void;
  roomSeek: (time: number) => void;
  roomSetPlaybackRate: (rate: number) => void;
  roomSetLoop: (loop: boolean) => void;
  localFullScreen: (fs: boolean) => void;
  localToggleMute: () => void;
  localSubtitleModal: () => void;
  localSeek: () => void;
  localSetVolume: (volume: number) => void;
  localSetSubtitleMode: (
    mode: TextTrackMode,
    lang?: string,
    trackIndex?: number,
  ) => void;
  roomPlaylistPlay: (index: number) => void;
  playlist: PlaylistVideo[];
  chat?: ChatMessage[];
  nameMap?: StringDict;
  pictureMap?: StringDict;
  socket?: any;
  getMediaDisplayName?: (input?: string) => string;
  isChatDisabled?: boolean;
  owner?: string | undefined;
  chatRef?: React.RefObject<Chat>;
  onOpenSettings?: () => void;
  showChatColumn?: boolean;
  isMobileView?: boolean;
  clientId?: string;
  myName?: string;
  roomSubtitle?: string;
  unreadCount?: number;
  onClearUnread?: () => void;
  participants?: User[];
  onJoinVideo?: () => void;
  onLeaveVideo?: () => void;
  onToggleVideo?: () => void;
  onToggleAudio?: () => void;
  isVideoMuted?: boolean;
  isAudioMuted?: boolean;
  downloaded?: number;
  total?: number;
  speed?: number;
  connections?: number;
  convertProgress?: number;
}

export const Controls = (props: ControlsProps) => {
  const [hoverState, setHoverState] = useState({
    hoverTimestamp: 0,
    hoverPos: 0,
  });
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [visible, setVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [isLandscapeMobile, setIsLandscapeMobile] = useState(false);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const [isPipActive, setIsPipActive] = useState(Boolean(document.pictureInPictureElement));
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [doubleTapRipple, setDoubleTapRipple] = useState<"rewind" | "forward" | "play" | "pause" | null>(null);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [isVideoDrawerOpen, setIsVideoDrawerOpen] = useState(false);
  const [activeStripMsg, setActiveStripMsg] = useState<ChatMessage | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [webcamState, setWebcamState] = useState(() => getWebcamSettings());

  const videoUsersCount = (props.participants || []).filter((p) => p.isVideoChat).length;
  const hasOurStream = Boolean(typeof window !== "undefined" && window.watchparty?.ourStream);

  useEffect(() => {
    const handleWebcamChange = (e: any) => {
      if (e?.detail) {
        setWebcamState((prev) => ({ ...prev, ...e.detail }));
      }
    };
    window.addEventListener("dipkri-webcam-settings-changed", handleWebcamChange);
    return () => {
      window.removeEventListener("dipkri-webcam-settings-changed", handleWebcamChange);
    };
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        (window as any).__watchparty_controls_visible = visible;
      }
      window.dispatchEvent(
        new CustomEvent("controls-visibility", { detail: { visible } })
      );
    } catch {}
  }, [visible]);

  const [aspectRatio, setAspectRatio] = useState<string>("default");
  const [videoFlip, setVideoFlip] = useState<string>("normal");
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const [isScreenLocked, setIsScreenLocked] = useState<boolean>(false);
  const [showLockOnly, setShowLockOnly] = useState<boolean>(false);
  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isPlayerSettingsOpen, setIsPlayerSettingsOpen] = useState<boolean>(false);
  const [audioBoost, setAudioBoost] = useState<number>(1);
  const [selectedQuality, setSelectedQuality] = useState<string>("auto");

  const isPlayerSettingsOpenRef = useRef(isPlayerSettingsOpen);
  isPlayerSettingsOpenRef.current = isPlayerSettingsOpen;

  // Real video transform (flip)
  useEffect(() => {
    const leftVideo = document.getElementById("leftVideo") as HTMLVideoElement | null;
    if (!leftVideo) return;
    if (videoFlip === "horizontal") {
      leftVideo.style.transform = "scaleX(-1)";
    } else if (videoFlip === "vertical") {
      leftVideo.style.transform = "scaleY(-1)";
    } else {
      leftVideo.style.transform = "none";
    }
  }, [videoFlip]);

  // Real aspect ratio
  useEffect(() => {
    const leftVideo = document.getElementById("leftVideo") as HTMLVideoElement | null;
    if (!leftVideo) return;
    if (aspectRatio === "fill") {
      leftVideo.style.objectFit = "cover";
      leftVideo.style.aspectRatio = "initial";
      leftVideo.style.width = "100%";
      leftVideo.style.height = "100%";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    } else if (aspectRatio === "fit") {
      leftVideo.style.objectFit = "contain";
      leftVideo.style.aspectRatio = "initial";
      leftVideo.style.width = "100%";
      leftVideo.style.height = "100%";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    } else if (aspectRatio === "16:9") {
      leftVideo.style.objectFit = "fill";
      leftVideo.style.aspectRatio = "16 / 9";
      leftVideo.style.width = "100%";
      leftVideo.style.height = "auto";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    } else if (aspectRatio === "4:3") {
      leftVideo.style.objectFit = "fill";
      leftVideo.style.aspectRatio = "4 / 3";
      leftVideo.style.width = "auto";
      leftVideo.style.height = "100%";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    } else if (aspectRatio === "21:9") {
      leftVideo.style.objectFit = "fill";
      leftVideo.style.aspectRatio = "21 / 9";
      leftVideo.style.width = "100%";
      leftVideo.style.height = "auto";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    } else {
      leftVideo.style.objectFit = "contain";
      leftVideo.style.aspectRatio = "initial";
      leftVideo.style.width = "100%";
      leftVideo.style.height = "auto";
      leftVideo.style.maxHeight = "100%";
      leftVideo.style.margin = "0 auto";
    }
  }, [aspectRatio]);

  // Real subtitle offset
  useEffect(() => {
    const leftVideo = document.getElementById("leftVideo") as HTMLVideoElement | null;
    if (!leftVideo || !leftVideo.textTracks) return;
    for (let t = 0; t < leftVideo.textTracks.length; t++) {
      const track = leftVideo.textTracks[t];
      if (track && track.cues) {
        for (let i = 0; i < track.cues.length; i++) {
          const cue = track.cues[i] as any;
          if (cue) {
            if (typeof cue.origStart !== "number") {
              cue.origStart = cue.startTime;
              cue.origEnd = cue.endTime;
            }
            cue.startTime = cue.origStart + subtitleOffset;
            cue.endTime = cue.origEnd + subtitleOffset;
          }
        }
      }
    }
  }, [subtitleOffset]);

  const [playerSettingsState, setPlayerSettingsState] = useState<PlayerSettingsState>(() => getPlayerSettings());
  const [settingsTab, setSettingsTab] = useState<"audio" | "subtitles" | "quality" | "more">("audio");

  useEffect(() => {
    const handlePlayerSettingsChange = (e: any) => {
      if (e?.detail) {
        setPlayerSettingsState((prev) => ({ ...prev, ...e.detail }));
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handlePlayerSettingsChange);
    return () => {
      window.removeEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handlePlayerSettingsChange);
    };
  }, []);

  const [audioTracksRevision, setAudioTracksRevision] = useState(0);

  useEffect(() => {
    const handleAudioTracksUpdate = () => {
      setAudioTracksRevision((v) => v + 1);
    };
    window.addEventListener("watchparty-audio-tracks-updated", handleAudioTracksUpdate);
    window.addEventListener("watchparty-subtitles-updated", handleAudioTracksUpdate);
    const video = document.getElementById("leftVideo") as HTMLVideoElement | null;
    if (video) {
      video.addEventListener("loadedmetadata", handleAudioTracksUpdate);
    }
    return () => {
      window.removeEventListener("watchparty-audio-tracks-updated", handleAudioTracksUpdate);
      window.removeEventListener("watchparty-subtitles-updated", handleAudioTracksUpdate);
      if (video) {
        video.removeEventListener("loadedmetadata", handleAudioTracksUpdate);
      }
    };
  }, [props.video]);

  const currentMediaTitle = useMemo(() => {
    return props.getMediaDisplayName
      ? props.getMediaDisplayName(props.video)
      : props.video || "";
  }, [props.video, props.getMediaDisplayName]);

  useEffect(() => {
    if (currentMediaTitle || props.video) {
      audioEnhancer.setMediaName(currentMediaTitle || props.video || "", props.video);
    }
  }, [currentMediaTitle, props.video]);

  const audioTracks = useMemo(() => {
    return audioEnhancer.getAvailableTracks(
      typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null,
      currentMediaTitle || props.video,
    );
  }, [
    props.video,
    currentMediaTitle,
    isMenuOpen,
    audioTracksRevision,
    playerSettingsState.audioTrack,
  ]);

  const hasMultipleAudioTracks = useMemo(() => {
    return audioEnhancer.hasMultiAudioStreams(
      typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null,
      currentMediaTitle || props.video,
    );
  }, [props.video, currentMediaTitle, isMenuOpen, audioTracksRevision]);

  const attachedSubtitleTracks = useMemo(() => {
    if (typeof document === "undefined") return [];
    const video = document.getElementById("leftVideo") as HTMLVideoElement;
    const tracks: { index: number; label: string; language?: string; active: boolean; url?: string }[] = [];
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const t = video.textTracks[i];
        tracks.push({
          index: i,
          label: t.label || t.language || `Subtitle Track ${i + 1}`,
          language: t.language || undefined,
          active: t.mode === "showing",
        });
      }
    }

    // Include embedded MKV / MP4 subtitle streams detected by audioEnhancer
    const embeddedSubs = audioEnhancer.getAvailableSubtitleTracks();
    if (embeddedSubs && embeddedSubs.length > 0 && props.video) {
      let fileParam = "";
      const fIdx = props.video.match(/[?&]fileIndex=(\d+)/i) || props.video.match(/%26fileIndex%3D(\d+)/i);
      if (fIdx) {
        fileParam = `&fileIndex=${fIdx[1]}`;
      }
      let cleanTorrent = props.video.replace(/^.*\/stream\?torrent=/, "");
      const cutIdx = cleanTorrent.indexOf("&fileIndex=");
      if (cutIdx !== -1) {
        cleanTorrent = cleanTorrent.slice(0, cutIdx);
      }
      try {
        cleanTorrent = decodeURIComponent(cleanTorrent);
      } catch {}

      embeddedSubs.forEach((sub: any, i: number) => {
        const subUrl = `${serverPath}/streamSubtitle?torrent=${encodeURIComponent(cleanTorrent)}&streamIndex=${sub.streamIndex}${fileParam}`;
        const isActive = props.roomSubtitle === subUrl;
        tracks.push({
          index: 100 + i,
          label: `${sub.label || sub.language || `Subtitle ${i + 1}`} (Embedded)`,
          language: sub.language,
          active: isActive,
          url: subUrl,
        });
      });
    }

    return tracks;
  }, [props.video, props.subtitled, props.roomSubtitle, isMenuOpen, audioTracksRevision]);

  const nativeResolution = useMemo(() => {
    if (typeof document === "undefined") return "";
    const video = document.getElementById("leftVideo") as HTMLVideoElement;
    if (!video || !video.videoWidth) return "";
    return `${video.videoWidth}x${video.videoHeight}`;
  }, [props.video, isMenuOpen]);

  const hasAdaptiveQuality = useMemo(() => {
    if (props.isYouTube) return true;
    if (typeof window !== "undefined") {
      const hlsLevels = ((window as any).watchparty?.hls?.levels?.length ?? 0) > 1;
      const dashLevels = (((window as any).watchparty?.dash as any)?.getBitrateInfoListFor?.("video")?.length ?? 0) > 1;
      return hlsLevels || dashLevels;
    }
    return false;
  }, [props.isYouTube, isMenuOpen, props.video]);

  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const lastTouchTimeRef = useRef<number>(0);
  const rippleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stripTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastChatLenRef = useRef(props.chat?.length || 0);
  const internalChatRef = useRef<Chat>(null);

  const {
    roomTogglePlay,
    roomSeek,
    localFullScreen,
    localSubtitleModal,
    localSeek,
    currentTime,
    leaderTime,
    disabled,
    subtitled,
    paused,
    isLiveStream,
    playlist,
    roomPlaylistPlay,
    timeRanges,
    roomSetPlaybackRate,
    roomPlaybackRate,
    nameMap,
  } = props;

  // Auto-hide controls logic (default 6500ms for generous comfortable touch interaction)
  const isMenuOpenRef = useRef(isMenuOpen);
  isMenuOpenRef.current = isMenuOpen;
  const isDrawerOpenRef = useRef(isChatDrawerOpen || isVideoDrawerOpen);
  isDrawerOpenRef.current = isChatDrawerOpen || isVideoDrawerOpen;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const scheduleHide = useCallback((delay = 3500) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    // Don't auto-hide when paused, or while a dropdown menu, video/chat drawer, or settings menu is open
    if (pausedRef.current || isMenuOpenRef.current || isDrawerOpenRef.current || isPlayerSettingsOpenRef.current) {
      setVisible(true);
      return;
    }
    hideTimerRef.current = setTimeout(() => {
      if (!pausedRef.current && !isMenuOpenRef.current && !isDrawerOpenRef.current && !isPlayerSettingsOpenRef.current) {
        setVisible(false);
      }
    }, delay);
  }, []);

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    scheduleHide(pausedRef.current ? 8000 : 3500);
  }, [scheduleHide]);

  // Global activity listener on window / player
  useEffect(() => {
    resetHideTimer();

    const onUserActivity = () => {
      resetHideTimer();
    };

    window.addEventListener("mousemove", onUserActivity, { passive: true });
    window.addEventListener("keydown", onUserActivity, { passive: true });

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      window.removeEventListener("mousemove", onUserActivity);
      window.removeEventListener("keydown", onUserActivity);
    };
  }, [resetHideTimer]);

  useEffect(() => {
    if (isMenuOpen || isChatDrawerOpen || isVideoDrawerOpen || paused) {
      setVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    } else {
      scheduleHide(3500);
    }
  }, [isMenuOpen, isChatDrawerOpen, isVideoDrawerOpen, paused, scheduleHide]);

  // Universal mobile/tablet & desktop landscape detection listener
  useEffect(() => {
    const checkLandscape = () => {
      if (typeof window === "undefined") return;
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileDevice = Boolean(
        props.isMobileView ||
        window.innerHeight <= 680 ||
        window.innerWidth <= 1024 ||
        /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      );
      const isLand = isLandscape && (isMobileDevice || window.matchMedia("(orientation: landscape)").matches);
      setIsLandscapeMobile(isLand);
      setIsPortraitMobile(Boolean(isMobileDevice && !isLandscape));
    };
    checkLandscape();
    window.addEventListener("resize", checkLandscape);
    window.addEventListener("orientationchange", checkLandscape);
    return () => {
      window.removeEventListener("resize", checkLandscape);
      window.removeEventListener("orientationchange", checkLandscape);
    };
  }, [props.isMobileView]);

  // Fullscreen and PiP state listeners
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setIsChatDrawerOpen(false);
      }
    };
    const handlePipChange = () => {
      setIsPipActive(Boolean(document.pictureInPictureElement));
    };

    if (document.pictureInPictureEnabled && !props.isYouTube) {
      setIsPipSupported(true);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("enterpictureinpicture", handlePipChange);
    document.addEventListener("leavepictureinpicture", handlePipChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("enterpictureinpicture", handlePipChange);
      document.removeEventListener("leavepictureinpicture", handlePipChange);
    };
  }, [props.isYouTube]);

  // True full-bleed video mode (either HTML5 fullscreen element or mobile rotated to landscape)
  const isFullBleedVideo = Boolean(
    (isFullscreen && document.fullscreenElement !== document.body) ||
    isLandscapeMobile
  );

  // In-video floating chat button: available in full-bleed video OR on desktop when page chat column is collapsed
  const canShowInVideoChat = Boolean(props.chat) && (isFullBleedVideo || (!props.isMobileView && !props.showChatColumn));

  // Direct socket listener for instant 0-latency simultaneous display on video alongside chat box
  useEffect(() => {
    if (!props.socket) return;
    const handleIncomingChat = (data: ChatMessage) => {
      if (!data || data.cmd || data.system || !data.msg) return;
      setActiveStripMsg(data);
      if (stripTimerRef.current) {
        clearTimeout(stripTimerRef.current);
      }
      stripTimerRef.current = setTimeout(() => {
        setActiveStripMsg(null);
      }, 8000);
    };

    props.socket.on("REC:chat", handleIncomingChat);
    return () => {
      props.socket.off("REC:chat", handleIncomingChat);
    };
  }, [props.socket]);

  // Fallback listener on props.chat updates
  useEffect(() => {
    if (!props.chat || props.chat.length === 0) return;
    const validMsgs = props.chat.filter((m) => !m.cmd && !m.system && m.msg);
    if (validMsgs.length === 0) return;

    const latest = validMsgs[validMsgs.length - 1];
    const currentLen = props.chat.length;

    // Trigger immediately when any new message arrives
    if (currentLen > lastChatLenRef.current) {
      setActiveStripMsg(latest);
      if (stripTimerRef.current) {
        clearTimeout(stripTimerRef.current);
      }
      stripTimerRef.current = setTimeout(() => {
        setActiveStripMsg(null);
      }, 8000);
    }
    lastChatLenRef.current = currentLen;
  }, [props.chat]);

  const getEnd = () => props.duration;
  const getStart = () => 0;
  const getLength = () => Math.max(getEnd() - getStart(), 0.001);
  const getCurrent = () => props.currentTime;
  const getPercent = () => Math.min(Math.max((getCurrent() - getStart()) / getLength(), 0), 1);
  const zeroTime = useMemo(
    () => Math.floor(Date.now() / 1000) - props.duration,
    [props.video, Boolean(props.duration)],
  );

  const onMouseOver = () => {
    setShowTimestamp(true);
  };
  const onMouseOut = () => {
    setShowTimestamp(false);
  };
  const onMouseMove = (e: any) => {
    try {
      const rect = e.currentTarget?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      let clientX = e.clientX;
      if (typeof clientX !== "number" && e.touches?.[0]) clientX = e.touches[0].clientX;
      if (typeof clientX !== "number" && e.changedTouches?.[0]) clientX = e.changedTouches[0].clientX;
      if (typeof clientX !== "number" || !Number.isFinite(clientX)) return;

      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const len = getLength();
      if (!Number.isFinite(len) || len <= 0) return;
      const target = getStart() + pct * len;
      if (Number.isFinite(target)) {
        setHoverState({ hoverTimestamp: target, hoverPos: pct });
      }
    } catch {}
  };

  // Quick 10s seek
  const handleSeekDelta = (deltaSeconds: number) => {
    if (disabled) return;
    const end = Number.isFinite(getEnd()) ? getEnd() : 0;
    const curr = Number.isFinite(getCurrent()) ? getCurrent() : 0;
    const newTarget = Math.max(0, Math.min(end, curr + deltaSeconds));
    if (Number.isFinite(newTarget)) {
      roomSeek(newTarget);
    }
    resetHideTimer();
  };

  // Trigger ripple feedback
  const triggerRipple = (direction: "rewind" | "forward" | "play" | "pause") => {
    setDoubleTapRipple(direction);
    if (rippleTimerRef.current) {
      clearTimeout(rippleTimerRef.current);
    }
    rippleTimerRef.current = setTimeout(() => {
      setDoubleTapRipple(null);
    }, 700);
  };

  const controlsOpenedAtRef = useRef<number>(Date.now());

  // Gesture handler on video container:
  // Double-tap left (< 35%) -> -10s
  // Double-tap right (> 65%) -> +10s
  // Double-tap center -> Toggle Play/Pause
  // Single-tap -> toggle controls overlay visibility safely without accidental vanishing
  const handleVideoGesture = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    try {
      if (!e) return;

      // Ignore synthetic click event generated by touch devices within 750ms of a touch event
      if (e.type === "click" && Date.now() - lastTouchTimeRef.current < 750) {
        return;
      }
      if (e.type === "touchend") {
        lastTouchTimeRef.current = Date.now();
      }

      // If screen is locked, do not trigger any gestures on the video canvas,
      // but briefly reveal the lock button so user can tap it to unlock!
      if (isScreenLocked) {
        setShowLockOnly(true);
        if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
        lockTimerRef.current = setTimeout(() => {
          setShowLockOnly(false);
        }, 3000);
        return;
      }

      // CRITICAL: If tapping controls, buttons, drawer, or open menus, NEVER handle as background video gesture!
      const targetEl = (e.target as HTMLElement) || null;
      if (
        targetEl &&
        (targetEl.closest(`.${styles.controlsContainer}`) ||
          targetEl.closest(`.${styles.cornerSyncBtn}`) ||
          targetEl.closest(`.${styles.fullscreenChatDrawer}`) ||
          targetEl.closest(`.${styles.fullscreenChatBackdrop}`) ||
          targetEl.closest(`.${styles.centerControlsRow}`) ||
          targetEl.closest(`.${styles.screenLockBtn}`) ||
          targetEl.closest(`.${styles.videoTitleOverlay}`) ||
          targetEl.closest(`.${styles.settingsPopupWrapper}`) ||
          targetEl.closest(`.${styles.settingsBackdrop}`) ||
          targetEl.closest("[class*='topRightControlsContainer']") ||
          targetEl.closest("[class*='floatingReactionsBar']") ||
          targetEl.closest("[class*='reactionBtn']") ||
          targetEl.closest(".mantine-Menu-dropdown") ||
          targetEl.closest(".mantine-Menu-item"))
      ) {
        return;
      }
      if (isMenuOpenRef.current || isDrawerOpenRef.current || isPlayerSettingsOpenRef.current) {
        return;
      }

      // Prevent default on handled touchend so mobile browsers do not fire synthetic mousemove/click
      if (e.type === "touchend" && typeof e.preventDefault === "function") {
        e.preventDefault();
      }
      if (typeof e.stopPropagation === "function") {
        e.stopPropagation();
      }

      const containerEl = e.currentTarget;
      if (!containerEl || typeof containerEl.getBoundingClientRect !== "function") return;

      const rect = containerEl.getBoundingClientRect();
      if (!rect || rect.width <= 10 || rect.height <= 10) return;

      let clientX: number | undefined = undefined;
      const anyEvent = e as any;
      if (anyEvent.changedTouches && anyEvent.changedTouches.length > 0 && typeof anyEvent.changedTouches[0].clientX === "number") {
        clientX = anyEvent.changedTouches[0].clientX;
      } else if (anyEvent.touches && anyEvent.touches.length > 0 && typeof anyEvent.touches[0].clientX === "number") {
        clientX = anyEvent.touches[0].clientX;
      } else if (typeof anyEvent.clientX === "number") {
        clientX = anyEvent.clientX;
      }

      if (typeof clientX !== "number" || !Number.isFinite(clientX)) return;

      const relativeX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const now = Date.now();
      const timeDiff = now - lastTapRef.current.time;

      if (timeDiff > 100 && timeDiff < 380) {
        // Double tap detected!
        if (relativeX < 0.35) {
          handleSeekDelta(-10);
          triggerRipple("rewind");
        } else if (relativeX > 0.65) {
          handleSeekDelta(10);
          triggerRipple("forward");
        } else {
          roomTogglePlay();
          triggerRipple(paused ? "play" : "pause");
        }
        lastTapRef.current = { time: 0, x: 0 };
        scheduleHide(3500);
      } else {
        // Single tap -> toggle controls overlay
        lastTapRef.current = { time: now, x: relativeX };
        setVisible((prev) => {
          if (!prev) {
            // Tapping to show controls: stay visible for 3.5s so user can comfortably use all buttons
            controlsOpenedAtRef.current = Date.now();
            scheduleHide(3500);
            return true;
          } else {
            // If currently paused, keep controls visible so user can see playback controls and progress bar
            if (pausedRef.current) {
              return true;
            }
            // If controls were shown very recently (< 700ms), KEEP THEM VISIBLE! (Never vanish in a flash)
            if (Date.now() - controlsOpenedAtRef.current < 700) {
              scheduleHide(3500);
              return true;
            }
            // Deliberate tap on empty background video while playing -> dismiss
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            return false;
          }
        });
      }
    } catch (err) {
      console.warn("Video gesture handling error:", err);
    }
  };

  // Picture in Picture toggle
  const togglePictureInPicture = async () => {
    const videoEl = document.getElementById("leftVideo") as HTMLVideoElement | null;
    if (!videoEl) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        await videoEl.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch (err) {
      console.warn("Picture-in-Picture error:", err);
    }
  };

  const isWebRTC = Boolean(props.video && (props.video.startsWith("screenshare://") || props.video.startsWith("fileshare://")));
  const behindThreshold = 5;
  const isBehind =
    !isLiveStream &&
    !isWebRTC &&
    leaderTime !== undefined &&
    Number.isFinite(leaderTime) &&
    leaderTime > 0 &&
    Number.isFinite(currentTime) &&
    leaderTime - currentTime > behindThreshold;
  const behindTime = isBehind ? Math.max(0, leaderTime - currentTime) : 0;

  // Buffer range bars
  const buffers = timeRanges.map(({ start, end }) => {
    const buffStartPct = (start / getLength()) * 100;
    const buffLengthPct = ((end - start) / getLength()) * 100;
    return (
      <div
        key={start}
        style={{
          position: "absolute",
          height: "100%",
          backgroundColor: "rgba(255, 255, 255, 0.22)",
          borderRadius: "9999px",
          left: buffStartPct + "%",
          width: buffLengthPct + "%",
          bottom: 0,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    );
  });

  const isControlsVisible = visible;

  return (
    <div
      className={`${styles.playerOverlayWrapper} ${isControlsVisible ? styles.controlsVisible : styles.controlsHidden}`}
      onClick={handleVideoGesture}
      onTouchEnd={handleVideoGesture}
      onMouseMove={resetHideTimer}
    >

      {/* Screen Lock Toggle Button (Available in Fullscreen & Mobile Landscape) */}
      {isFullBleedVideo && (
        <button
          type="button"
          className={`${styles.screenLockBtn} ${isScreenLocked ? styles.screenLockBtnLocked : ""} ${(isControlsVisible || showLockOnly) ? styles.screenLockBtnVisible : styles.screenLockBtnHidden}`}
          title={isScreenLocked ? "Unlock Screen Controls" : "Lock Screen Controls"}
          onClick={(e) => {
            e.stopPropagation();
            const nextLocked = !isScreenLocked;
            setIsScreenLocked(nextLocked);
            if (nextLocked) {
              // Clicked lock: briefly show locked feedback for 1.2s then fade out
              setShowLockOnly(true);
              setVisible(false);
              if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
              lockTimerRef.current = setTimeout(() => {
                setShowLockOnly(false);
              }, 1200);
            } else {
              // Unlocked: restore controls
              setShowLockOnly(false);
              setVisible(true);
              resetHideTimer();
            }
          }}
        >
          {isScreenLocked ? (
            <WPIconLock size={19} color="#ffffff" />
          ) : (
            <WPIconLockOpen size={19} color="#ffffff" />
          )}
        </button>
      )}

      {/* Video Title Overlay (Top-Left Position in Fullscreen / Mobile Landscape) */}
      {isFullBleedVideo && !isScreenLocked && isControlsVisible && (
        <div className={styles.videoTitleOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.videoTitleMain}>
            {cleanMovieTitle(currentMediaTitle).title || currentMediaTitle || "WatchParty"}
          </div>
          {cleanMovieTitle(currentMediaTitle).meta && (
            <div className={styles.videoTitleSub}>
              {cleanMovieTitle(currentMediaTitle).meta}
            </div>
          )}
        </div>
      )}

      {/* Double tap ripple indicators (Left -10s, Right +10s, Center Play/Pause) */}
      {doubleTapRipple === "rewind" && (
        <div className={`${styles.seekRipple} ${styles.seekRippleLeft}`}>
          <div className={styles.rippleContent}>
            <WPIconRewind10 size={36} />
            <span className={styles.rippleText}>-10s</span>
          </div>
        </div>
      )}
      {doubleTapRipple === "forward" && (
        <div className={`${styles.seekRipple} ${styles.seekRippleRight}`}>
          <div className={styles.rippleContent}>
            <WPIconForward10 size={36} />
            <span className={styles.rippleText}>+10s</span>
          </div>
        </div>
      )}
      {(doubleTapRipple === "play" || doubleTapRipple === "pause") && (
        <div className={styles.seekRippleCenter}>
          <div className={styles.centerRippleCircle}>
            {doubleTapRipple === "play" ? (
              <WPIconPlay size={34} />
            ) : (
              <WPIconPause size={34} />
            )}
            <span className={styles.rippleText}>
              {doubleTapRipple === "play" ? "Play" : "Pause"}
            </span>
          </div>
        </div>
      )}

      {/* Live In-Video Message Overlay (Simultaneous with Chat Box, Instant, Transparent Background, Crisp White Font with Shadow) */}
      {activeStripMsg && (
        <div
          className={`${styles.fullscreenMsgStrip} ${isControlsVisible ? styles.msgStripControlsVisible : styles.msgStripControlsHidden} ${(isChatDrawerOpen || isVideoDrawerOpen) ? styles.drawerOpen : ""}`}
        >
          <div
            key={activeStripMsg.id + activeStripMsg.timestamp}
            className={styles.fullscreenMsgItem}
          >
            <span className={styles.fullscreenMsgAuthor}>
              {nameMap?.[activeStripMsg.id] || "Friend"}:
            </span>
            <span className={styles.fullscreenMsgBody}>
              {activeStripMsg.msg}
            </span>
          </div>
        </div>
      )}

      {/* Floating Chat Drawer Backdrop (tap outside drawer to dismiss) */}
      {isChatDrawerOpen && (
        <div
          className={styles.fullscreenChatBackdrop}
          onClick={(e) => {
            e.stopPropagation();
            setIsChatDrawerOpen(false);
          }}
        />
      )}

      {/* Floating Chat Drawer */}
      {isChatDrawerOpen && props.chat && props.nameMap && (
        <div
          className={styles.fullscreenChatDrawer}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.fullscreenChatHeader}>
            <div className={styles.drawerTitleGroup}>
              <WPIconChat size={16} />
              <span>Live Chat</span>
            </div>
            <button
              type="button"
              className={styles.drawerCloseBtn}
              onClick={() => setIsChatDrawerOpen(false)}
              title="Close chat"
            >
              <WPIconClose size={18} />
            </button>
          </div>
          <div className={styles.fullscreenChatContent}>
            <Chat
              className={styles.inDrawerChat}
              chat={props.chat}
              nameMap={props.nameMap}
              pictureMap={props.pictureMap || {}}
              socket={props.socket}
              scrollTimestamp={Date.now()}
              getMediaDisplayName={props.getMediaDisplayName || ((s) => s || "")}
              isChatDisabled={props.isChatDisabled}
              owner={props.owner}
              ref={internalChatRef}
              videoPaused={paused}
            />
          </div>
        </div>
      )}

      {/* Floating Webcams & Voice Drawer Backdrop */}
      {isVideoDrawerOpen && (
        <div
          className={styles.fullscreenChatBackdrop}
          onClick={(e) => {
            e.stopPropagation();
            setIsVideoDrawerOpen(false);
          }}
        />
      )}

      {/* Floating Webcams & Voice Drawer (For Landscape & Fullscreen Mode) */}
      {isVideoDrawerOpen && (
        <div
          className={styles.fullscreenChatDrawer}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.fullscreenChatHeader}>
            <div className={styles.drawerTitleGroup} style={{ color: "#10b981" }}>
              <WPIconVideo size={16} />
              <span>Voice & Webcams ({videoUsersCount})</span>
            </div>
            <button
              type="button"
              className={styles.drawerCloseBtn}
              onClick={() => setIsVideoDrawerOpen(false)}
              title="Close drawer"
            >
              <WPIconClose size={18} />
            </button>
          </div>
          <div
            className={styles.fullscreenChatContent}
            style={{ padding: "14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {/* Quick Call Action Bar */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {!hasOurStream ? (
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "9px 14px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    border: "none",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    boxShadow: "0 4px 14px rgba(16, 185, 129, 0.4)",
                  }}
                  onClick={() => props.onJoinVideo && props.onJoinVideo()}
                >
                  <WPIconVideo size={16} />
                  <span>Join Video Call</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: props.isVideoMuted ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)",
                      border: props.isVideoMuted ? "1px solid rgba(239, 68, 68, 0.5)" : "1px solid rgba(16, 185, 129, 0.5)",
                      color: props.isVideoMuted ? "#f87171" : "#34d399",
                      fontWeight: 700,
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "5px",
                    }}
                    onClick={() => props.onToggleVideo && props.onToggleVideo()}
                  >
                    {props.isVideoMuted ? <WPIconVideoOff size={14} /> : <WPIconVideo size={14} />}
                    <span>{props.isVideoMuted ? "Cam Off" : "Cam On"}</span>
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: props.isAudioMuted ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)",
                      border: props.isAudioMuted ? "1px solid rgba(239, 68, 68, 0.5)" : "1px solid rgba(16, 185, 129, 0.5)",
                      color: props.isAudioMuted ? "#f87171" : "#34d399",
                      fontWeight: 700,
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "5px",
                    }}
                    onClick={() => props.onToggleAudio && props.onToggleAudio()}
                  >
                    {props.isAudioMuted ? <WPIconMicrophoneOff size={14} /> : <WPIconMicrophone size={14} />}
                    <span>{props.isAudioMuted ? "Muted" : "Unmuted"}</span>
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: "8px 12px",
                      borderRadius: "10px",
                      background: "rgba(239, 68, 68, 0.2)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      color: "#ef4444",
                      fontWeight: 700,
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    onClick={() => props.onLeaveVideo && props.onLeaveVideo()}
                  >
                    Leave
                  </button>
                </>
              )}
            </div>

            {/* List of active participants */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
              {props.participants?.map((p) => {
                const isSelf = p.id === props.clientId;
                const displayName = props.nameMap?.[p.id] || (isSelf ? "You" : "User");
                const avatar = props.pictureMap?.[p.id] || getDefaultPicture(displayName, getColorForStringHex(p.id));
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "10px 8px",
                      borderRadius: "10px",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: p.isVideoChat ? "1.5px solid rgba(16, 185, 129, 0.5)" : "1px solid rgba(255, 255, 255, 0.07)",
                      textAlign: "center",
                      position: "relative",
                    }}
                  >
                    <img
                      src={avatar}
                      alt={displayName}
                      style={{ width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover" }}
                    />
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "#f0f0f5",
                        maxWidth: "90%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {displayName} {isSelf ? "(You)" : ""}
                    </div>
                    {p.isVideoChat && (
                      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        <WPIconVideo size={12} color="#10b981" />
                        <WPIconMicrophone size={12} color={p.isMuted ? "#ef4444" : "#10b981"} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls Bar (Streamlined: Scrubber + Play/Pause + Speed + Captions + PiP + Theater + Chat + Fullscreen) */}
      <div
        className={`${styles.controlsContainer} ${(isControlsVisible && !isScreenLocked) ? styles.visible : styles.hidden}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          e.stopPropagation();
          resetHideTimer();
        }}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Row 1: Interactive Scrubber Timeline */}
        <div className={styles.timelineRow}>
          <span className={styles.timeText}>
            {formatTimestamp(getCurrent(), isLiveStream ? zeroTime : undefined) || "00:00"}
          </span>

          <div
            className={styles.progressWrapper}
            onMouseOver={onMouseOver}
            onMouseOut={onMouseOut}
            onMouseMove={onMouseMove}
            onClick={(e: any) => {
              e.stopPropagation();
              if (disabled) return;
              try {
                const rect = e.currentTarget?.getBoundingClientRect();
                if (!rect || rect.width <= 0) return;
                const clientX = e.clientX;
                if (typeof clientX !== "number" || !Number.isFinite(clientX)) return;

                const x = clientX - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                const len = getLength();
                if (!Number.isFinite(len) || len <= 0) return;
                const target = len * pct;
                if (Number.isFinite(target)) {
                  roomSeek(target);
                  resetHideTimer();
                }
              } catch (err) {
                console.warn("Seek error:", err);
              }
            }}
            onTouchStart={(e: any) => {
              e.stopPropagation();
              if (disabled) return;
              try {
                const rect = e.currentTarget?.getBoundingClientRect();
                if (!rect || rect.width <= 0) return;
                const touch = e.touches?.[0] || e.changedTouches?.[0];
                if (!touch || typeof touch.clientX !== "number") return;

                const x = touch.clientX - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                const len = getLength();
                if (!Number.isFinite(len) || len <= 0) return;
                const target = len * pct;
                if (Number.isFinite(target)) {
                  roomSeek(target);
                  resetHideTimer();
                }
              } catch (err) {
                console.warn("Touch seek error:", err);
              }
            }}
            onTouchMove={(e: any) => {
              e.stopPropagation();
              if (disabled) return;
              try {
                const rect = e.currentTarget?.getBoundingClientRect();
                if (!rect || rect.width <= 0) return;
                const touch = e.touches?.[0] || e.changedTouches?.[0];
                if (!touch || typeof touch.clientX !== "number") return;

                const x = touch.clientX - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                const len = getLength();
                if (!Number.isFinite(len) || len <= 0) return;
                const target = len * pct;
                if (Number.isFinite(target)) {
                  roomSeek(target);
                  resetHideTimer();
                }
              } catch (err) {
                console.warn("Touch drag seek error:", err);
              }
            }}
            onTouchEnd={(e: any) => {
              e.stopPropagation();
              resetHideTimer();
            }}
          >
            <Progress.Root
              radius="xl"
              className={styles.progressBar}
            >
              <Progress.Section
                className={styles.progressSection}
                style={{ pointerEvents: "none", zIndex: 1 }}
                value={getPercent() * 100}
              />
              {buffers}
            </Progress.Root>

            {/* Progress glowing scrubber thumb (placed on progressWrapper to prevent Mantine overflow:hidden clipping) */}
            <div
              className={styles.scrubberThumb}
              style={{ left: `${getPercent() * 100}%` }}
            />

            {/* Hover preview timestamp tooltip */}
            {getLength() < Infinity && showTimestamp && (
              <div
                className={styles.hoverTooltip}
                style={{
                  left: `clamp(28px, ${hoverState.hoverPos * 100}%, calc(100% - 28px))`,
                }}
              >
                {formatTimestamp(
                  hoverState.hoverTimestamp,
                  isLiveStream ? zeroTime : undefined,
                )}
              </div>
            )}
          </div>

          {!isLiveStream && (
            <span className={styles.timeText}>
              {formatTimestamp(getEnd()) || "00:00"}
            </span>
          )}

          {isLiveStream && (
            <Badge size="xs" color="red" className={styles.liveBadge}>
              LIVE
            </Badge>
          )}
        </div>

        {/* Row 2: Streamlined Action Buttons */}
        <div className={styles.actionsRow}>
          {/* Left Actions: Play/Pause, Next Video in Queue, and Volume */}
          <div className={styles.actionsLeft}>
            {/* Play/Pause Button */}
            <button
              type="button"
              className={styles.action}
              onClick={(e) => {
                e.stopPropagation();
                roomTogglePlay();
                resetHideTimer();
              }}
              title={paused ? "Play" : "Pause"}
            >
              {paused ? <WPIconPlay size={22} /> : <WPIconPause size={22} />}
            </button>

            {/* Skip to next queue item (if queue active) */}
            {playlist.length > 0 && (
              <button
                type="button"
                className={styles.action}
                title="Next video in queue"
                onClick={(e) => {
                  e.stopPropagation();
                  roomPlaylistPlay(0);
                  resetHideTimer();
                }}
              >
                <WPIconSkipForward size={20} />
              </button>
            )}

            {/* Volume & Mute Control */}
            <div className={styles.volumeContainer}>
              <button
                type="button"
                className={styles.action}
                onClick={(e) => {
                  e.stopPropagation();
                  props.localToggleMute();
                  resetHideTimer();
                }}
                title={props.muted || props.volume === 0 ? "Unmute" : "Mute"}
              >
                {props.muted || props.volume === 0 ? (
                  <WPIconVolumeOff size={20} />
                ) : props.volume < 0.5 ? (
                  <WPIconVolumeLow size={20} />
                ) : (
                  <WPIconVolumeOn size={20} />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={props.muted ? 0 : props.volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  props.localSetVolume(val);
                  if (props.muted && val > 0) {
                    props.localToggleMute();
                  }
                  resetHideTimer();
                }}
                className={styles.volumeSlider}
                title={`Volume: ${Math.round((props.muted ? 0 : props.volume) * 100)}%`}
              />
            </div>
          </div>

          {/* Right Actions */}
          <div className={styles.actionsRight}>
            {/* Quick In-Bar Sync Button */}
            <button
              type="button"
              className={`${styles.action} ${isBehind ? styles.syncBehind : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isLiveStream) {
                  roomSeek(props.duration);
                } else {
                  localSeek();
                }
                resetHideTimer();
              }}
              title={isBehind ? `Behind by ${behindTime.toFixed(1)}s - Tap to catch up` : "In sync with room"}
            >
              <WPIconSync size={18} />
            </button>

            {/* Picture-in-Picture (Hidden on Mobile to preserve uncluttered touch targets) */}
            {isPipSupported && !isFullscreen && !isLandscapeMobile && !props.isMobileView && (
              <button
                type="button"
                className={`${styles.action} ${isPipActive ? styles.activeFeature : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePictureInPicture();
                  resetHideTimer();
                }}
                title={isPipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
              >
                <WPIconPictureInPicture size={20} filled={isPipActive} />
              </button>
            )}

            {/* Theater Mode (Desktop only, hidden in true fullscreen) */}
            {!isFullscreen && !props.isMobileView && (
              <button
                type="button"
                className={`${styles.action} ${styles.desktopOnlyBtn}`}
                onClick={(e) => {
                  e.stopPropagation();
                  localFullScreen(false);
                  resetHideTimer();
                }}
                title="Theater Mode"
              >
                <WPIconTheater size={20} />
              </button>
            )}

            {/* In-Video Floating Chat Button */}
            {canShowInVideoChat && (
              <button
                type="button"
                className={`${styles.action} ${styles.fullscreenChatBtn} ${isChatDrawerOpen ? styles.activeFeature : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsChatDrawerOpen((prev) => {
                    const next = !prev;
                    if (next && props.onClearUnread) {
                      props.onClearUnread();
                    }
                    return next;
                  });
                  resetHideTimer();
                }}
                title={isChatDrawerOpen ? "Close Chat" : "Open Chat"}
                style={{ position: "relative" }}
              >
                <WPIconChat size={20} filled={isChatDrawerOpen} />
                {Boolean(props.unreadCount && props.unreadCount > 0 && !isChatDrawerOpen) && (
                  <span className={styles.chatBadge}>
                    {(props.unreadCount ?? 0) > 99 ? "99+" : props.unreadCount}
                  </span>
                )}
              </button>
            )}

            {/* In-Video Voice & Webcams Button (Available in Full-Bleed / Landscape / Fullscreen, or Desktop) */}
            {Boolean(isFullBleedVideo || (!props.isMobileView && props.participants)) && (
              <button
                type="button"
                className={`${styles.action} ${styles.fullscreenChatBtn} ${isVideoDrawerOpen ? styles.activeFeature : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsVideoDrawerOpen((prev) => !prev);
                  if (!isVideoDrawerOpen) {
                    setIsChatDrawerOpen(false);
                  }
                  resetHideTimer();
                }}
                title={isVideoDrawerOpen ? "Close Webcams" : "Voice & Webcams"}
                style={{ position: "relative" }}
              >
                <WPIconVideo size={20} filled={isVideoDrawerOpen} />
                {videoUsersCount > 0 && (
                  <span className={styles.chatBadge}>
                    {videoUsersCount}
                  </span>
                )}
              </button>
            )}

            {/* Player Settings Menu Trigger */}
            <button
              type="button"
              className={`${styles.action} ${isPlayerSettingsOpen ? styles.activeFeature : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsPlayerSettingsOpen((prev) => !prev);
                resetHideTimer();
              }}
              title="Player Settings"
            >
              <WPIconSettings size={20} />
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              className={styles.action}
              onClick={(e) => {
                e.stopPropagation();
                localFullScreen(!isFullscreen);
                resetHideTimer();
              }}
              title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}
            >
              {isFullscreen ? (
                <WPIconFullscreenExit size={20} />
              ) : (
                <WPIconFullscreen size={20} />
              )}
            </button>
          </div>
        </div>
      </div>
    
      {/* Floating Settings Menu Popup (Images 2, 3, 4, 5) with Blue Theme (#38bdf8) */}
      {isPlayerSettingsOpen && (
        <>
          <div
            className={`${styles.settingsBackdrop} ${isPortraitMobile ? styles.settingsBackdropMobilePortrait : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsPlayerSettingsOpen(false);
              resetHideTimer();
            }}
          />
          <div
            className={`${styles.settingsPopupWrapper} ${isPortraitMobile ? styles.settingsPopupWrapperMobilePortrait : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <PlayerSettingsMenu
              isBottomSheet={isPortraitMobile}
              onClose={() => {
                setIsPlayerSettingsOpen(false);
                resetHideTimer();
              }}
              playbackRate={props.playbackRate || 1}
              onSetPlaybackRate={(rate) => {
                roomSetPlaybackRate(rate);
                resetHideTimer();
              }}
              aspectRatio={aspectRatio}
              onSetAspectRatio={(ratio) => {
                setAspectRatio(ratio);
                resetHideTimer();
              }}
              videoFlip={videoFlip}
              onSetVideoFlip={(flip) => {
                setVideoFlip(flip);
                resetHideTimer();
              }}
              subtitleOffset={subtitleOffset}
              onSetSubtitleOffset={(offset) => {
                setSubtitleOffset(offset);
                resetHideTimer();
              }}
              subtitled={subtitled}
              onToggleSubtitles={(show) => {
                props.localSetSubtitleMode(show ? "showing" : "hidden");
                setPlayerSettings({ liveCaptions: show });
                resetHideTimer();
              }}
              onUploadSubtitle={() => {
                localSubtitleModal();
                setIsPlayerSettingsOpen(false);
              }}
              subtitleTracks={attachedSubtitleTracks}
              onSelectSubtitleTrack={(idx) => {
                if (idx >= 100) {
                  const embeddedTrack = attachedSubtitleTracks.find((t) => t.index === idx);
                  if (embeddedTrack && (embeddedTrack as any).url) {
                    props.socket?.emit("CMD:subtitle", (embeddedTrack as any).url);
                    window.dispatchEvent(
                      new CustomEvent("watchparty-load-embedded-subtitle", {
                        detail: { url: (embeddedTrack as any).url, label: embeddedTrack.label },
                      })
                    );
                  }
                } else {
                  props.localSetSubtitleMode("showing", undefined, idx);
                }
                resetHideTimer();
              }}
              currentSubtitleLabel={
                attachedSubtitleTracks.find((t) => t.active)?.label ||
                (props.roomSubtitle ? "Room Sub" : undefined)
              }
              audioBoost={audioBoost}
              onSetAudioBoost={(boost) => {
                setAudioBoost(boost);
                const videoEl = document.getElementById("leftVideo") as HTMLMediaElement | null;
                audioEnhancer.setBoost(boost * 100, videoEl || undefined);
                resetHideTimer();
              }}
              quality={selectedQuality}
              onSetQuality={(q) => {
                setSelectedQuality(q);
                qualityManager.applyQuality(q, props.isYouTube);
                resetHideTimer();
              }}
              audioTracks={audioTracks}
              currentAudioTrack={playerSettingsState.audioTrack ?? 0}
              onSelectAudioTrack={(idx) => {
                setPlayerSettings({ audioTrack: idx });
                audioEnhancer.selectTrack(
                  idx,
                  document.getElementById("leftVideo") as HTMLMediaElement,
                );
                resetHideTimer();
              }}
              roomMedia={props.video}
              socket={props.socket}
              isYouTube={props.isYouTube}
              downloaded={props.downloaded}
              total={props.total}
              speed={props.speed}
              connections={props.connections}
              convertProgress={props.convertProgress}
              showStatsOverlay={playerSettingsState.showStatsOverlay}
              onToggleStatsOverlay={() => {
                setPlayerSettings({ showStatsOverlay: !playerSettingsState.showStatsOverlay });
                resetHideTimer();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
