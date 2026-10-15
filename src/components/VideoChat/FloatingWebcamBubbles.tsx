import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./FloatingWebcamBubbles.module.css";
import {
  getOrCreateClientId,
  getDefaultPicture,
  getColorForStringHex,
} from "../../utils/utils";
import {
  WPIconClose,
  WPIconUser,
  WPIconChevronLeft,
  WPIconChevronRight,
} from "../Icons/CustomIcons";
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconVideo,
  IconVideoOff,
  IconPin,
  IconPinned,
  IconArrowsMove,
  IconMinus,
} from "@tabler/icons-react";

export type BubbleSize = "small" | "medium" | "large";

const SIZE_PRESETS: Record<BubbleSize, number> = {
  small: 60,
  medium: 90,
  large: 130,
};

// Stream-driven video element
const BubbleVideoElement = ({
  stream,
  isSelf,
  avatarUrl,
  name,
}: {
  stream: MediaStream | null;
  isSelf?: boolean;
  avatarUrl?: string;
  name?: string;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasLiveVideo, setHasLiveVideo] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !stream) {
      setHasLiveVideo(false);
      return;
    }
    const video = videoRef.current;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    const checkTrack = () => {
      const videoTrack = stream.getVideoTracks()[0];
      setHasLiveVideo(Boolean(videoTrack && videoTrack.enabled));
    };

    checkTrack();
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("mute", checkTrack);
      videoTrack.addEventListener("unmute", checkTrack);
      videoTrack.addEventListener("ended", checkTrack);
    }

    video.play().catch(() => {});

    return () => {
      if (videoTrack) {
        videoTrack.removeEventListener("mute", checkTrack);
        videoTrack.removeEventListener("unmute", checkTrack);
        videoTrack.removeEventListener("ended", checkTrack);
      }
    };
  }, [stream]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={styles.bubbleVideo}
        style={{
          display: hasLiveVideo ? "block" : "none",
          transform: isSelf ? "scaleX(-1)" : undefined,
        }}
      />
      {!hasLiveVideo && (
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
}) => {
  const selfId = getOrCreateClientId();

  // Load saved size from localStorage or default to medium
  const [sizePreset, setSizePreset] = useState<BubbleSize>(() => {
    try {
      const saved = localStorage.getItem("dipkri-webcam-size");
      if (saved === "small" || saved === "medium" || saved === "large") {
        return saved;
      }
    } catch {}
    return "medium";
  });

  // State: Pinned user ID (single person focus)
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  // State: Minimized pill mode
  const [isMinimized, setIsMinimized] = useState(false);
  // State: Focused single-user only vs all
  const [focusMode, setFocusMode] = useState<"all" | "pinned-only">("all");

  // Draggable position coordinates (x, y in pixels from top-right by default)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem("dipkri-webcam-pos");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return { x: 20, y: 70 }; // default top-right offset
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });

  // Save size changes
  const changeSize = (newSize: BubbleSize) => {
    setSizePreset(newSize);
    try {
      localStorage.setItem("dipkri-webcam-size", newSize);
    } catch {}
  };

  const cycleSize = () => {
    if (sizePreset === "small") changeSize("medium");
    else if (sizePreset === "medium") changeSize("large");
    else changeSize("small");
  };

  // Filter video chat users
  const videoUsers = participants.filter((p) => p.isVideoChat);
  const isSelfInVideo = Boolean(videoUsers.find((p) => p.id === selfId));

  // Drag handlers
  const handleDragStart = (clientX: number, clientY: number) => {
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

    const newX = Math.max(10, dragStartRef.current.startX - deltaX);
    const newY = Math.max(10, dragStartRef.current.startY + deltaY);

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

  // If no one is in video chat, don't show the bubbles
  if (videoUsers.length === 0) {
    return null;
  }

  const diameter = SIZE_PRESETS[sizePreset];

  // Resolve which users to render based on Pin and Focus Mode
  let usersToRender = [...videoUsers];
  if (pinnedUserId && focusMode === "pinned-only") {
    const pinnedUser = videoUsers.find((u) => u.id === pinnedUserId);
    if (pinnedUser) {
      usersToRender = [pinnedUser];
    }
  } else if (pinnedUserId) {
    // Put pinned user first
    usersToRender.sort((a, b) => (a.id === pinnedUserId ? -1 : b.id === pinnedUserId ? 1 : 0));
  }

  // Get stream for user
  const getUserStream = (userId: string): MediaStream | null => {
    if (typeof window === "undefined" || !window.watchparty) return null;
    if (userId === selfId) {
      return window.watchparty.ourStream || null;
    }
    const ref = window.watchparty.videoRefs?.[userId];
    if (ref && ref.srcObject instanceof MediaStream) {
      return ref.srcObject;
    }
    const pc = window.watchparty.videoPCs?.[userId] as any;
    if (pc && typeof pc.getRemoteStreams === "function") {
      const streams = pc.getRemoteStreams();
      if (streams && streams.length > 0) return streams[0];
    }
    return null;
  };

  return (
    <div
      className={styles.floatingContainer}
      style={{
        right: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* Minimized Pill */}
      {isMinimized ? (
        <div
          className={styles.minimizedPill}
          onClick={() => setIsMinimized(false)}
          title="Click to expand webcam bubbles"
        >
          <div className={styles.liveCallDot} />
          <span>{videoUsers.length} in Call</span>
        </div>
      ) : (
        <>
          {/* Draggable Toolbar */}
          <div
            className={styles.floatingToolbar}
            onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              if (e.touches[0]) {
                handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
          >
            <div className={styles.dragHandle} title="Drag bubbles anywhere">
              <IconArrowsMove size={13} />
            </div>

            {/* Quick Size Cycler: S / M / L */}
            <button
              type="button"
              className={styles.toolBtn}
              onClick={cycleSize}
              title={`Bubble Size: ${sizePreset.toUpperCase()} (Click to toggle)`}
            >
              {sizePreset === "small" ? "S" : sizePreset === "medium" ? "M" : "L"}
            </button>

            {/* Pin Toggle */}
            {pinnedUserId && (
              <button
                type="button"
                className={`${styles.toolBtn} ${focusMode === "pinned-only" ? styles.activeToolBtn : ""}`}
                onClick={() =>
                  setFocusMode((prev) => (prev === "all" ? "pinned-only" : "all"))
                }
                title={focusMode === "pinned-only" ? "Show All Friends" : "Focus Only Pinned Friend"}
              >
                {focusMode === "pinned-only" ? "Show All" : "1 Pin"}
              </button>
            )}

            {/* Join Call Quick Pill if self not in call */}
            {!isSelfInVideo && onJoinVideo && (
              <button
                type="button"
                className={styles.joinCallBtn}
                onClick={onJoinVideo}
                title="Join Video Call"
              >
                <IconVideo size={13} />
                <span>Join</span>
              </button>
            )}

            {/* Minimize Pill Button */}
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => setIsMinimized(true)}
              title="Minimize to small pill"
            >
              <IconMinus size={13} />
            </button>
          </div>

          {/* Bubbles Cluster */}
          <div className={styles.bubblesCluster}>
            {usersToRender.map((user) => {
              const isSelf = user.id === selfId;
              const isPinned = user.id === pinnedUserId;
              const stream = getUserStream(user.id);
              const displayName = nameMap[user.id] || (isSelf ? "You" : "Friend");
              const avatar =
                pictureMap[user.id] ||
                getDefaultPicture(displayName, getColorForStringHex(user.id));
              const isMuted = user.isMuted;

              return (
                <div
                  key={user.id}
                  className={styles.bubbleItem}
                  style={{
                    width: `${isPinned && focusMode === "pinned-only" ? diameter * 1.3 : diameter}px`,
                    height: `${isPinned && focusMode === "pinned-only" ? diameter * 1.3 : diameter}px`,
                  }}
                  onClick={() => {
                    // Tap to pin/unpin
                    if (isPinned) {
                      setPinnedUserId(null);
                      setFocusMode("all");
                    } else {
                      setPinnedUserId(user.id);
                    }
                  }}
                  title={`${displayName} - Click to ${isPinned ? "unpin" : "pin"}`}
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
                    />
                  </div>

                  {/* Pin Badge */}
                  {isPinned && (
                    <div className={styles.pinBadge} title="Pinned Friend">
                      <IconPin size={12} />
                    </div>
                  )}

                  {/* Mic Muted Badge */}
                  {isMuted && (
                    <div className={styles.micBadge} title="Microphone Muted">
                      <IconMicrophoneOff size={11} />
                    </div>
                  )}

                  {/* Name Tag Tooltip */}
                  <div className={styles.nameTag}>
                    {displayName} {isPinned ? "(Pinned)" : ""}
                  </div>

                  {/* In-Bubble Quick Controls for Self */}
                  {isSelf && (
                    <div
                      className={styles.selfOverlay}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onToggleAudio && (
                        <button
                          type="button"
                          className={styles.quickActionBtn}
                          onClick={onToggleAudio}
                          title={isAudioMuted ? "Unmute Mic" : "Mute Mic"}
                        >
                          {isAudioMuted ? <IconMicrophoneOff size={13} /> : <IconMicrophone size={13} />}
                        </button>
                      )}
                      {onToggleVideo && (
                        <button
                          type="button"
                          className={styles.quickActionBtn}
                          onClick={onToggleVideo}
                          title={isVideoMuted ? "Start Camera" : "Stop Camera"}
                        >
                          {isVideoMuted ? <IconVideoOff size={13} /> : <IconVideo size={13} />}
                        </button>
                      )}
                      {onLeaveVideo && (
                        <button
                          type="button"
                          className={styles.quickActionBtn}
                          onClick={onLeaveVideo}
                          style={{ background: "rgba(239, 68, 68, 0.85)" }}
                          title="Leave Video Call"
                        >
                          <WPIconClose size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
