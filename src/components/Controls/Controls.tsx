import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Badge, Menu, Progress } from "@mantine/core";
import {
  formatTimestamp,
  getDefaultPicture,
  getColorForStringHex,
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
} from "../Icons/CustomIcons";
import {
  IconVideo,
  IconVideoOff,
  IconMicrophone,
  IconMicrophoneOff,
} from "@tabler/icons-react";
import {
  getWebcamSettings,
  setWebcamSettings,
  BubbleSize,
} from "../VideoChat/webcamSettings";
import { Chat } from "../Chat/Chat";

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
  localSetSubtitleMode: (mode: TextTrackMode, lang?: string) => void;
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

  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
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

  // Auto-hide controls logic
  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    if (!paused && !isMenuOpen) {
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
      }, 3500);
    }
  }, [paused, isMenuOpen]);

  useEffect(() => {
    if (paused) {
      setVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    } else {
      resetHideTimer();
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [paused, resetHideTimer]);

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
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const max = rect.width;
    const pct = Math.max(0, Math.min(1, x / max));
    const target = getStart() + pct * getLength();
    setHoverState({ hoverTimestamp: target, hoverPos: pct });
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

  // Gesture handler on video container:
  // Double-tap left (< 32%) -> -10s
  // Double-tap right (> 68%) -> +10s
  // Double-tap center (32% - 68%) -> Toggle Play/Pause
  // Single-tap -> toggle controls overlay visibility
  const handleVideoGesture = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    try {
      if (!e) return;
      if (typeof e.stopPropagation === "function") {
        e.stopPropagation();
      }
      const targetEl = e.currentTarget;
      if (!targetEl || typeof targetEl.getBoundingClientRect !== "function") return;

      const rect = targetEl.getBoundingClientRect();
      if (!rect || rect.width <= 10 || rect.height <= 10) return;

      let clientX: number | undefined = undefined;
      const anyEvent = e as any;
      if (anyEvent.touches && anyEvent.touches.length > 0 && typeof anyEvent.touches[0].clientX === "number") {
        clientX = anyEvent.touches[0].clientX;
      } else if (anyEvent.changedTouches && anyEvent.changedTouches.length > 0 && typeof anyEvent.changedTouches[0].clientX === "number") {
        clientX = anyEvent.changedTouches[0].clientX;
      } else if (typeof anyEvent.clientX === "number") {
        clientX = anyEvent.clientX;
      }

      if (typeof clientX !== "number" || !Number.isFinite(clientX)) return;

      const relativeX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const now = Date.now();
      const timeDiff = now - lastTapRef.current.time;

      if (timeDiff > 40 && timeDiff < 340) {
        // Double tap detected!
        if (relativeX < 0.32) {
          handleSeekDelta(-10);
          triggerRipple("rewind");
        } else if (relativeX > 0.68) {
          handleSeekDelta(10);
          triggerRipple("forward");
        } else {
          const nextPaused = !paused;
          roomTogglePlay();
          triggerRipple(nextPaused ? "pause" : "play");
        }
        lastTapRef.current = { time: 0, x: 0 };
      } else {
        // Single tap -> toggle controls overlay
        lastTapRef.current = { time: now, x: relativeX };
        setVisible((prev) => !prev);
        resetHideTimer();
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

  const isControlsVisible = visible || paused;

  return (
    <div
      className={styles.playerOverlayWrapper}
      onClick={handleVideoGesture}
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
    >
      {/* Top-Left Corner Smart Sync Option */}
      <button
        type="button"
        className={`${styles.cornerSyncBtn} ${isBehind ? styles.behind : ""} ${isControlsVisible ? styles.visible : styles.hidden}`}
        title={isBehind ? `Behind by ${behindTime.toFixed(1)}s - Tap to catch up` : "In sync with room"}
        onClick={(e) => {
          e.stopPropagation();
          if (isLiveStream) {
            roomSeek(props.duration);
          } else {
            localSeek();
          }
          resetHideTimer();
        }}
      >
        <WPIconSync size={13} />
        <span>{isBehind ? `Sync (-${behindTime.toFixed(0)}s)` : "Sync"}</span>
      </button>

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
              <IconVideo size={16} />
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
                  <IconVideo size={16} />
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
                    {props.isVideoMuted ? <IconVideoOff size={14} /> : <IconVideo size={14} />}
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
                    {props.isAudioMuted ? <IconMicrophoneOff size={14} /> : <IconMicrophone size={14} />}
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
                        <IconVideo size={12} color="#10b981" />
                        <IconMicrophone size={12} color={p.isMuted ? "#ef4444" : "#10b981"} />
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
        className={`${styles.controlsContainer} ${isControlsVisible ? styles.visible : styles.hidden}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Row 1: Interactive Scrubber Timeline */}
        <div className={styles.timelineRow}>
          <span className={styles.timeText}>
            {formatTimestamp(getCurrent(), isLiveStream ? zeroTime : undefined)}
          </span>

          <div
            className={styles.progressWrapper}
            onMouseOver={onMouseOver}
            onMouseOut={onMouseOut}
            onMouseMove={onMouseMove}
          >
            <Progress.Root
              radius="xl"
              className={styles.progressBar}
              onClick={(e: any) => {
                if (!disabled) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const max = rect.width;
                  const pct = Math.max(0, Math.min(1, x / max));
                  const target = getLength() * pct;
                  roomSeek(target);
                  resetHideTimer();
                }
              }}
            >
              <Progress.Section
                className={styles.progressSection}
                style={{ pointerEvents: "none", zIndex: 1 }}
                value={getPercent() * 100}
              />
              {buffers}

              {/* Progress glowing scrubber thumb */}
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
            </Progress.Root>
          </div>

          <span className={styles.timeText}>{formatTimestamp(getEnd())}</span>

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
            <div
              className={styles.action}
              onClick={() => {
                roomTogglePlay();
                resetHideTimer();
              }}
              title={paused ? "Play" : "Pause"}
            >
              {paused ? <WPIconPlay size={22} /> : <WPIconPause size={22} />}
            </div>

            {/* Skip to next queue item (if queue active) */}
            {playlist.length > 0 && (
              <div
                className={styles.action}
                title="Next video in queue"
                onClick={() => roomPlaylistPlay(0)}
              >
                <WPIconSkipForward size={20} />
              </div>
            )}

            {/* Volume Control & Expandable Slider */}
            <div className={styles.volumeGroup}>
              <div
                className={styles.action}
                onClick={() => {
                  props.localToggleMute();
                  resetHideTimer();
                }}
                title={props.muted ? "Unmute" : "Mute"}
              >
                {props.muted || props.volume === 0 ? (
                  <WPIconVolumeOff size={20} />
                ) : props.volume < 0.4 ? (
                  <WPIconVolumeLow size={20} />
                ) : (
                  <WPIconVolumeOn size={20} />
                )}
              </div>
              <div className={styles.volumeSliderWrapper}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
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
                  aria-label="Volume Slider"
                />
              </div>
            </div>
          </div>

          {/* Right Actions */}
          <div className={styles.actionsRight}>
            {/* Quick In-Bar Sync Button */}
            <div
              className={`${styles.action} ${isBehind ? styles.syncBehind : ""}`}
              onClick={() => {
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
            </div>

            {/* Playback Speed Menu */}
            <Menu
              disabled={disabled}
              position="top-end"
              withinPortal={true}
              portalProps={{
                target:
                  typeof document !== "undefined"
                    ? (document.fullscreenElement as HTMLElement) || document.body
                    : undefined,
              }}
              onOpen={() => setIsMenuOpen(true)}
              onClose={() => {
                setIsMenuOpen(false);
                resetHideTimer();
              }}
            >
              <Menu.Target>
                <div className={styles.speedButton} title="Playback Speed">
                  <WPIconSpeed size={16} />
                  <span>{props.playbackRate ? `${props.playbackRate.toFixed(2).replace(/\.00$/, "")}x` : "1x"}</span>
                </div>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Playback Speed</Menu.Label>
                {[
                  { key: "0.25", text: "0.25x", value: 0.25 },
                  { key: "0.5", text: "0.5x", value: 0.5 },
                  { key: "0.75", text: "0.75x", value: 0.75 },
                  { key: "1", text: "1.0x (Normal)", value: 1 },
                  { key: "1.25", text: "1.25x", value: 1.25 },
                  { key: "1.5", text: "1.5x", value: 1.5 },
                  { key: "1.75", text: "1.75x", value: 1.75 },
                  { key: "2", text: "2.0x", value: 2 },
                  { key: "3", text: "3.0x", value: 3 },
                ].map((item) => (
                  <Menu.Item
                    key={item.key}
                    onClick={() => roomSetPlaybackRate(item.value)}
                    rightSection={
                      roomPlaybackRate === item.value ? (
                        <WPIconCheck size={16} color="#6366f1" />
                      ) : null
                    }
                  >
                    {item.text}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>

            {/* Closed Captions / Subtitles Menu (Both YouTube and Native videos, visible in fullscreen and landscape) */}
            <Menu
              position="top-end"
              withinPortal={true}
              portalProps={{
                target:
                  typeof document !== "undefined"
                    ? (document.fullscreenElement as HTMLElement) || document.body
                    : undefined,
              }}
              onOpen={() => setIsMenuOpen(true)}
              onClose={() => {
                setIsMenuOpen(false);
                resetHideTimer();
              }}
            >
              <Menu.Target>
                <div
                  className={`${styles.action} ${subtitled ? styles.activeFeature : ""}`}
                  title="Subtitles / Captions"
                >
                  <WPIconCaptions size={20} />
                </div>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Captions & Subtitles</Menu.Label>
                {props.isYouTube ? (
                  [
                    { key: "hidden", text: "Off", value: "hidden" },
                    { key: "en", text: "English", value: "showing" },
                    { key: "es", text: "Spanish", value: "showing" },
                  ].map((item) => (
                    <Menu.Item
                      key={item.key}
                      onClick={() =>
                        props.localSetSubtitleMode(
                          item.value as TextTrackMode,
                          item.key,
                        )
                      }
                      rightSection={
                        (subtitled && item.key !== "hidden") || (!subtitled && item.key === "hidden") ? (
                          <WPIconCheck size={16} color="#6366f1" />
                        ) : null
                      }
                    >
                      {item.text}
                    </Menu.Item>
                  ))
                ) : (
                  <>
                    <Menu.Item
                      onClick={() => props.localSetSubtitleMode("hidden")}
                      rightSection={!subtitled ? <WPIconCheck size={16} color="#6366f1" /> : null}
                    >
                      Captions: Off
                    </Menu.Item>
                    <Menu.Item
                      onClick={() => props.localSetSubtitleMode("showing")}
                      rightSection={subtitled ? <WPIconCheck size={16} color="#6366f1" /> : null}
                    >
                      Captions: On {props.roomSubtitle ? "(Room File)" : "(Track)"}
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<WPIconCaptions size={16} />}
                      onClick={localSubtitleModal}
                    >
                      Search & Upload Subtitles...
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>

            {/* Picture-in-Picture (Hidden in Fullscreen or Landscape) */}
            {isPipSupported && !isFullscreen && !isLandscapeMobile && (
              <div
                className={`${styles.action} ${isPipActive ? styles.activeFeature : ""}`}
                onClick={togglePictureInPicture}
                title={isPipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
              >
                <WPIconPictureInPicture size={20} />
              </div>
            )}

            {/* Theater Mode (Desktop only, hidden in true fullscreen) */}
            {!isFullscreen && !props.isMobileView && (
              <div
                className={`${styles.action} ${styles.desktopOnlyBtn}`}
                onClick={() => localFullScreen(false)}
                title="Theater Mode"
              >
                <WPIconTheater size={20} />
              </div>
            )}

            {/* In-Video Floating Chat Button */}
            {canShowInVideoChat && (
              <div
                className={`${styles.action} ${styles.fullscreenChatBtn} ${isChatDrawerOpen ? styles.activeFeature : ""}`}
                onClick={() => {
                  setIsChatDrawerOpen((prev) => {
                    const next = !prev;
                    if (next && props.onClearUnread) {
                      props.onClearUnread();
                    }
                    return next;
                  });
                }}
                title={isChatDrawerOpen ? "Close Chat" : "Open Chat"}
                style={{ position: "relative" }}
              >
                <WPIconChat size={20} />
                {Boolean(props.unreadCount && props.unreadCount > 0 && !isChatDrawerOpen) && (
                  <span className={styles.chatBadge}>
                    {(props.unreadCount ?? 0) > 99 ? "99+" : props.unreadCount}
                  </span>
                )}
              </div>
            )}

            {/* In-Video Voice & Webcams Button (Available in Full-Bleed / Landscape / Fullscreen) */}
            {Boolean(isFullBleedVideo || props.participants) && (
              <div
                className={`${styles.action} ${styles.fullscreenChatBtn} ${isVideoDrawerOpen ? styles.activeFeature : ""}`}
                onClick={() => {
                  setIsVideoDrawerOpen((prev) => !prev);
                  if (!isVideoDrawerOpen) {
                    setIsChatDrawerOpen(false);
                  }
                }}
                title={isVideoDrawerOpen ? "Close Webcams" : "Voice & Webcams"}
                style={{ position: "relative" }}
              >
                <IconVideo size={20} color={hasOurStream ? "#10b981" : undefined} />
                {videoUsersCount > 0 && (
                  <span className={styles.chatBadge} style={{ background: "#10b981" }}>
                    {videoUsersCount}
                  </span>
                )}
              </div>
            )}

            {/* Player Settings Menu: Webcam Bubbles Drag, Size & Preferences */}
            <Menu
              position="top-end"
              withinPortal={true}
              portalProps={{
                target:
                  typeof document !== "undefined"
                    ? (document.fullscreenElement as HTMLElement) || document.body
                    : undefined,
              }}
              onOpen={() => setIsMenuOpen(true)}
              onClose={() => {
                setIsMenuOpen(false);
                resetHideTimer();
              }}
            >
              <Menu.Target>
                <div
                  className={`${styles.action} ${webcamState.dragUnlocked ? styles.activeFeature : ""}`}
                  title="Player & Webcam Settings"
                >
                  <WPIconSettings size={20} />
                </div>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Webcam Bubbles</Menu.Label>
                {/* 1. Drag Unlock Toggle */}
                <Menu.Item
                  onClick={() => {
                    setWebcamSettings({ dragUnlocked: !webcamState.dragUnlocked });
                  }}
                  rightSection={
                    webcamState.dragUnlocked ? (
                      <WPIconCheck size={16} color="#6366f1" />
                    ) : null
                  }
                >
                  {webcamState.dragUnlocked ? "Dragging: Unlocked (Movable)" : "Dragging: Locked (Clean Video)"}
                </Menu.Item>

                {/* 2. Size presets */}
                <Menu.Divider />
                <Menu.Label>Bubble Size</Menu.Label>
                {[
                  { key: "min", label: "Minimum (48px)" },
                  { key: "small", label: "Small (70px)" },
                  { key: "medium", label: "Medium (95px)" },
                  { key: "max", label: "Maximum (145px)" },
                ].map((item) => (
                  <Menu.Item
                    key={item.key}
                    onClick={() => {
                      setWebcamSettings({ size: item.key as BubbleSize });
                    }}
                    rightSection={
                      webcamState.size === item.key ? (
                        <WPIconCheck size={16} color="#6366f1" />
                      ) : null
                    }
                  >
                    {item.label}
                  </Menu.Item>
                ))}

                <Menu.Divider />
                {/* 3. Show / Hide Bubbles */}
                <Menu.Item
                  onClick={() => {
                    setWebcamSettings({ visible: !webcamState.visible });
                  }}
                  rightSection={
                    webcamState.visible ? (
                      <WPIconCheck size={16} color="#6366f1" />
                    ) : null
                  }
                >
                  {webcamState.visible ? "Webcam Bubbles: Visible" : "Webcam Bubbles: Hidden"}
                </Menu.Item>

                {/* 4. Link to all room settings */}
                {props.onOpenSettings && (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<WPIconSettings size={16} />}
                      onClick={props.onOpenSettings}
                    >
                      All Room Settings...
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>

            {/* Fullscreen Toggle */}
            <div
              className={styles.action}
              onClick={() => localFullScreen(!isFullscreen)}
              title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}
            >
              {isFullscreen ? (
                <WPIconFullscreenExit size={20} />
              ) : (
                <WPIconFullscreen size={20} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
