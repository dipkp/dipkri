import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import styles from "./FloatingWebcamBubbles.module.css";
import {
  getOrCreateClientId,
  getDefaultPicture,
  getColorForStringHex,
} from "../../utils/utils";
import { WPIconClose } from "../Icons/CustomIcons";
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconVideo,
  IconVideoOff,
  IconPin,
  IconArrowsMove,
} from "@tabler/icons-react";
import {
  BubbleSize,
  SIZE_PRESETS,
  getWebcamSettings,
  setWebcamSettings,
} from "./webcamSettings";

// Stream-driven video element with freeze prevention
const BubbleVideoElement = ({
  stream,
  isSelf,
  avatarUrl,
  name,
  isVideoOff,
}: {
  stream: MediaStream | null;
  isSelf?: boolean;
  avatarUrl?: string;
  name?: string;
  isVideoOff?: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasLiveVideo, setHasLiveVideo] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !stream || isVideoOff) {
      setHasLiveVideo(false);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    const video = videoRef.current;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    const checkTrack = () => {
      const videoTrack = stream.getVideoTracks()[0];
      const isLive = Boolean(videoTrack && videoTrack.enabled && !isVideoOff);
      setHasLiveVideo(isLive);
      if (!isLive && videoRef.current) {
        videoRef.current.srcObject = null;
      } else if (isLive && videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
    };

    checkTrack();
    const interval = setInterval(checkTrack, 400);

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("mute", checkTrack);
      videoTrack.addEventListener("unmute", checkTrack);
      videoTrack.addEventListener("ended", checkTrack);
    }

    video.play().catch(() => {
      // If unmuted autoplay fails due to browser policy, auto-mute so video plays smoothly
      video.muted = true;
      video.play().catch(() => {});
    });

    return () => {
      clearInterval(interval);
      if (videoTrack) {
        videoTrack.removeEventListener("mute", checkTrack);
        videoTrack.removeEventListener("unmute", checkTrack);
        videoTrack.removeEventListener("ended", checkTrack);
      }
    };
  }, [stream, isVideoOff]);

  const showVideo = hasLiveVideo && !isVideoOff;

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={styles.bubbleVideo}
        style={{
          opacity: showVideo ? 1 : 0,
          pointerEvents: showVideo ? "auto" : "none",
          transform: isSelf ? "scaleX(-1)" : undefined,
          transition: "opacity 180ms ease",
        }}
      />
      {!showVideo && (
        <img
          src={avatarUrl}
          alt={name || "User"}
          className={styles.avatarFallback}
        />
      )}
    </>
  );
};

export interface FloatingWebcamBubblesProps {
  participants: User[];
  nameMap: StringDict;
  pictureMap: StringDict;
  socket?: any;
  onJoinVideo?: () => void;
  onLeaveVideo?: () => void;
  onToggleVideo?: () => void;
  onToggleAudio?: () => void;
  isVideoMuted?: boolean;
  isAudioMuted?: boolean;
  isFullScreen?: boolean;
}

export const FloatingWebcamBubbles: React.FC<FloatingWebcamBubblesProps> = ({
  participants,
  nameMap,
  pictureMap,
  socket,
  onJoinVideo,
  onLeaveVideo,
  onToggleVideo,
  onToggleAudio,
  isVideoMuted,
  isAudioMuted,
  isFullScreen,
}) => {
  const selfId = getOrCreateClientId();

  // Track fullscreen element so bubbles always portal into document.fullscreenElement when in fullscreen mode
  const [fullscreenEl, setFullscreenEl] = useState<Element | null>(() =>
    typeof document !== "undefined"
      ? document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        null
      : null,
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenEl(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          null,
      );
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
    };
  }, [isFullScreen]);

  // Load initial settings from centralized store
  const [sizePreset, setSizePreset] = useState<BubbleSize>(
    () => getWebcamSettings().size,
  );
  const [isDragUnlocked, setIsDragUnlocked] = useState<boolean>(
    () => getWebcamSettings().dragUnlocked,
  );
  const [isVisible, setIsVisible] = useState<boolean>(
    () => getWebcamSettings().visible,
  );

  // Local track state for instant UI responsiveness
  const [selfAudioMuted, setSelfAudioMuted] = useState(Boolean(isAudioMuted));
  const [selfVideoMuted, setSelfVideoMuted] = useState(Boolean(isVideoMuted));

  // State: Show self quick controls (activated by tap, long-press, or desktop hover)
  const [showSelfControls, setShowSelfControls] = useState(false);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  // Pinned user state (single friend pin)
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);

  // Position state (pixels from top-right)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem("dipkri-webcam-pos");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return { x: 16, y: 70 };
  });

  // Clamps coordinates when rotated into landscape mode so bubbles never disappear off-screen
  useEffect(() => {
    const clampToViewport = () => {
      if (typeof window === "undefined") return;
      const diameter = SIZE_PRESETS[sizePreset] || SIZE_PRESETS.medium;
      const isLandscape = window.innerWidth > window.innerHeight;
      const maxRight = Math.max(8, window.innerWidth - (diameter + 16));
      // In mobile landscape (height <= 520px), ensure bubbles stay visible within the short viewport
      const maxTop = Math.max(8, window.innerHeight - (diameter + 16));

      setPosition((prev) => {
        const nextX = Math.max(8, Math.min(maxRight, prev.x));
        const nextY = Math.max(8, Math.min(maxTop, prev.y));
        if (nextX !== prev.x || nextY !== prev.y) {
          try {
            localStorage.setItem(
              "dipkri-webcam-pos",
              JSON.stringify({ x: nextX, y: nextY }),
            );
          } catch {}
          return { x: nextX, y: nextY };
        }
        return prev;
      });
    };

    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    window.addEventListener("orientationchange", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      window.removeEventListener("orientationchange", clampToViewport);
    };
  }, [sizePreset]);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    startX: number;
    startY: number;
  }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });

  // Sync track state if props change
  useEffect(() => {
    if (typeof isAudioMuted === "boolean") {
      setSelfAudioMuted(isAudioMuted);
    }
  }, [isAudioMuted]);

  useEffect(() => {
    if (typeof isVideoMuted === "boolean") {
      setSelfVideoMuted(isVideoMuted);
    }
  }, [isVideoMuted]);

  // Listen for real-time setting updates
  useEffect(() => {
    const handleSettingsChange = (e: any) => {
      if (e?.detail) {
        if (e.detail.size) setSizePreset(e.detail.size);
        if (typeof e.detail.dragUnlocked === "boolean") {
          setIsDragUnlocked(e.detail.dragUnlocked);
        }
        if (typeof e.detail.visible === "boolean") {
          setIsVisible(e.detail.visible);
        }
      }
    };

    window.addEventListener(
      "dipkri-webcam-settings-changed",
      handleSettingsChange,
    );
    window.addEventListener("storage", () => {
      const current = getWebcamSettings();
      setSizePreset(current.size);
      setIsDragUnlocked(current.dragUnlocked);
      setIsVisible(current.visible);
    });

    return () => {
      window.removeEventListener(
        "dipkri-webcam-settings-changed",
        handleSettingsChange,
      );
    };
  }, []);

  // Filter video chat users
  const videoUsers = participants.filter((p) => p.isVideoChat);

  // Drag handlers with full viewport bounds
  const handleDragStart = (clientX: number, clientY: number) => {
    if (!isDragUnlocked) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      startX: position.x,
      startY: position.y,
    };
  };

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const deltaX = clientX - dragStartRef.current.mouseX;
    const deltaY = clientY - dragStartRef.current.mouseY;

    // Constrain within screen bounds so bubbles float anywhere
    const maxRight = typeof window !== "undefined" ? window.innerWidth - 65 : 400;
    const maxTop = typeof window !== "undefined" ? window.innerHeight - 85 : 800;

    const newX = Math.max(8, Math.min(maxRight, dragStartRef.current.startX - deltaX));
    const newY = Math.max(8, Math.min(maxTop, dragStartRef.current.startY + deltaY));

    setPosition({ x: newX, y: newY });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      localStorage.setItem("dipkri-webcam-pos", JSON.stringify(position));
    } catch {}
  }, [position]);

  // Window drag listeners
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
    const onMouseUp = () => handleDragEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = () => handleDragEnd();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  // Lock dragging directly from banner button
  const handleLockPosition = () => {
    setIsDragUnlocked(false);
    setWebcamSettings({ dragUnlocked: false });
  };

  // Direct WebRTC Track Operations (Guaranteed to work without double-toggling)
  const handleToggleAudio = () => {
    const ourStream = window.watchparty?.ourStream;
    let newMuted = !selfAudioMuted;
    if (onToggleAudio) {
      try {
        onToggleAudio();
      } catch (e) {
        console.warn(e);
      }
    } else if (ourStream && ourStream.getAudioTracks()[0]) {
      const track = ourStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      newMuted = !track.enabled;
    }
    setTimeout(() => {
      const track = window.watchparty?.ourStream?.getAudioTracks()[0];
      const actualMuted = track ? !track.enabled : newMuted;
      setSelfAudioMuted(actualMuted);
      socket?.emit("CMD:userMute", { isMuted: actualMuted });
    }, 40);
  };

  const handleToggleVideo = () => {
    const ourStream = window.watchparty?.ourStream;
    let newMuted = !selfVideoMuted;
    if (onToggleVideo) {
      try {
        onToggleVideo();
      } catch (e) {
        console.warn(e);
      }
    } else if (ourStream && ourStream.getVideoTracks()[0]) {
      const track = ourStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      newMuted = !track.enabled;
    }
    setTimeout(() => {
      const track = window.watchparty?.ourStream?.getVideoTracks()[0];
      const actualMuted = track ? !track.enabled : newMuted;
      setSelfVideoMuted(actualMuted);
    }, 40);
  };

  const handleLeaveVideo = () => {
    const ourStream = window.watchparty?.ourStream;
    const videoPCs = window.watchparty?.videoPCs;
    if (ourStream) {
      ourStream.getTracks().forEach((track) => track.stop());
      window.watchparty.ourStream = undefined;
    }
    if (videoPCs) {
      Object.keys(videoPCs).forEach((k) => {
        try {
          videoPCs[k].close();
        } catch {}
        delete videoPCs[k];
      });
    }
    socket?.emit("CMD:leaveVideo");

    if (onLeaveVideo) {
      try {
        onLeaveVideo();
      } catch (e) {
        console.warn(e);
      }
    }
    setShowSelfControls(false);
  };

  // Helper to open self controls and auto-hide after 5s of inactivity
  const triggerSelfControls = () => {
    setShowSelfControls((prev) => {
      const next = !prev;
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (next) {
        controlsTimerRef.current = setTimeout(() => {
          setShowSelfControls(false);
        }, 5000);
      }
      return next;
    });
  };

  // If user disabled floating bubbles in settings or no one is in video chat
  if (!isVisible || videoUsers.length === 0) {
    return null;
  }

  const diameter = SIZE_PRESETS[sizePreset] || SIZE_PRESETS.medium;

  // Resolve ordering: pinned user first
  let usersToRender = [...videoUsers];
  if (pinnedUserId) {
    usersToRender.sort((a, b) =>
      a.id === pinnedUserId ? -1 : b.id === pinnedUserId ? 1 : 0,
    );
  }

  // Get stream for user with multiple resilient fallbacks
  const getUserStream = (userId: string): MediaStream | null => {
    if (typeof window === "undefined" || !window.watchparty) return null;
    if (userId === selfId) {
      return window.watchparty.ourStream || null;
    }
    // 1. Persistent remote streams dictionary (always survives tab switches and orientation changes)
    if (window.watchparty.remoteStreams?.[userId]) {
      return window.watchparty.remoteStreams[userId];
    }
    // 2. Video reference srcObject
    const ref = window.watchparty.videoRefs?.[userId];
    if (ref && ref.srcObject instanceof MediaStream) {
      return ref.srcObject;
    }
    // 3. Active RTCPeerConnection receivers
    const pc = window.watchparty.videoPCs?.[userId] as any;
    if (pc) {
      if (typeof pc.getReceivers === "function") {
        const tracks = pc.getReceivers().map((r: any) => r.track).filter(Boolean);
        if (tracks.length > 0) {
          const stream = new MediaStream(tracks);
          if (!window.watchparty.remoteStreams) window.watchparty.remoteStreams = {};
          window.watchparty.remoteStreams[userId] = stream;
          return stream;
        }
      }
      if (typeof pc.getRemoteStreams === "function") {
        const streams = pc.getRemoteStreams();
        if (streams && streams.length > 0) return streams[0];
      }
    }
    return null;
  };

  const targetContainer =
    fullscreenEl ||
    (typeof document !== "undefined"
      ? document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        document.body
      : null);

  if (!targetContainer) {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      className={styles.floatingContainer}
      style={{
        right: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* Drag Mode Banner: ONLY rendered when "Unlock Dragging" is turned ON in Settings */}
      {isDragUnlocked && (
        <div
          className={styles.dragModeBanner}
          onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
          onTouchStart={(e) => {
            if (e.touches[0]) {
              handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
          title="Drag to reposition webcam bubbles"
        >
          <div className={styles.dragHandleIcon}>
            <IconArrowsMove size={13} />
          </div>
          <span>Drag Anywhere</span>
          <button
            type="button"
            className={styles.lockBtn}
            onClick={handleLockPosition}
            title="Lock bubbles in place and hide drag controls"
          >
            Lock
          </button>
        </div>
      )}

      {/* Pure Circular Video Bubbles Cluster - Zero Clutter */}
      <div
        className={`${styles.bubblesCluster} ${isDragUnlocked ? styles.dragActiveCluster : ""}`}
        onMouseDown={(e) => {
          if (isDragUnlocked) {
            handleDragStart(e.clientX, e.clientY);
          }
        }}
        onTouchStart={(e) => {
          if (isDragUnlocked && e.touches[0]) {
            handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
      >
        {usersToRender.map((user) => {
          const isSelf = user.id === selfId;
          const isPinned = user.id === pinnedUserId;
          const stream = getUserStream(user.id);
          const displayName = nameMap[user.id] || (isSelf ? "You" : "Friend");
          const avatar =
            pictureMap[user.id] ||
            getDefaultPicture(displayName, getColorForStringHex(user.id));
          const isMuted = isSelf ? selfAudioMuted : user.isMuted;
          const bubbleWidth = isPinned ? diameter * 1.25 : diameter;

          return (
            <div
              key={user.id}
              className={styles.bubbleItem}
              style={{
                width: `${bubbleWidth}px`,
                height: `${bubbleWidth}px`,
              }}
              onClick={() => {
                if (isDragUnlocked) return;
                if (isSelf) {
                  triggerSelfControls();
                } else {
                  setPinnedUserId(isPinned ? null : user.id);
                }
              }}
              onTouchStart={() => {
                if (isSelf) {
                  isLongPressRef.current = false;
                  longPressTimerRef.current = setTimeout(() => {
                    isLongPressRef.current = true;
                    triggerSelfControls();
                  }, 300);
                }
              }}
              onTouchEnd={() => {
                if (longPressTimerRef.current) {
                  clearTimeout(longPressTimerRef.current);
                }
              }}
              title={
                isSelf
                  ? "You (Tap or hold for Mic/Video/Leave options)"
                  : `${displayName}${isPinned ? " (Pinned)" : " - Click to pin"}`
              }
            >
              <div
                className={`${styles.videoCircle} ${
                  isPinned
                    ? styles.pinnedRing
                    : !isMuted
                      ? styles.speakingRing
                      : styles.mutedRing
                }`}
              >
                <BubbleVideoElement
                  stream={stream}
                  isSelf={isSelf}
                  avatarUrl={avatar}
                  name={displayName}
                  isVideoOff={
                    isSelf
                      ? selfVideoMuted ||
                        !Boolean(
                          window.watchparty?.ourStream?.getVideoTracks()[0]?.enabled,
                        )
                      : !user.isVideoChat
                  }
                />
              </div>

              {/* Pin Badge */}
              {isPinned && (
                <div className={styles.pinBadge} title="Pinned Friend">
                  <IconPin size={11} />
                </div>
              )}

              {/* Mic Muted Badge */}
              {isMuted && (
                <div className={styles.micBadge} title="Microphone Muted">
                  <IconMicrophoneOff size={10} />
                </div>
              )}

              {/* Name Tag Tooltip on Hover */}
              <div className={styles.nameTag}>
                {displayName} {isPinned ? "(Pinned)" : ""}
              </div>

              {/* In-Bubble Quick Controls for Self (Working on Click, Tap, & Long-Press) */}
              {isSelf && (
                <div
                  className={`${styles.selfOverlay} ${
                    showSelfControls ? styles.selfOverlayActive : ""
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 1. Mute / Unmute Mic Button */}
                  <button
                    type="button"
                    className={`${styles.quickActionBtn} ${
                      selfAudioMuted ? styles.actionMuted : styles.actionActive
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleAudio();
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleToggleAudio();
                    }}
                    title={selfAudioMuted ? "Unmute Mic" : "Mute Mic"}
                  >
                    {selfAudioMuted ? (
                      <IconMicrophoneOff size={13} />
                    ) : (
                      <IconMicrophone size={13} />
                    )}
                  </button>

                  {/* 2. Video Camera On / Off Button */}
                  <button
                    type="button"
                    className={`${styles.quickActionBtn} ${
                      selfVideoMuted ? styles.actionMuted : styles.actionActive
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleVideo();
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleToggleVideo();
                    }}
                    title={selfVideoMuted ? "Start Camera" : "Stop Camera"}
                  >
                    {selfVideoMuted ? (
                      <IconVideoOff size={13} />
                    ) : (
                      <IconVideo size={13} />
                    )}
                  </button>

                  {/* 3. Leave Video Call Button */}
                  <button
                    type="button"
                    className={`${styles.quickActionBtn} ${styles.actionDanger}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLeaveVideo();
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleLeaveVideo();
                    }}
                    title="Leave Video Call"
                  >
                    <WPIconClose size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>,
    targetContainer,
  );
};
