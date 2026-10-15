import React, { useState, useEffect, useRef, useCallback } from "react";
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
    return { x: 20, y: 70 };
  });

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

  // Listen for real-time setting updates dispatched from SettingsModal or Controls
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
  const isSelfInVideo = Boolean(videoUsers.find((p) => p.id === selfId));

  // Drag handlers
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

  // Lock dragging directly from banner button
  const handleLockPosition = () => {
    setIsDragUnlocked(false);
    setWebcamSettings({ dragUnlocked: false });
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
          <span>Drag to Move</span>
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
          const isMuted = user.isMuted;
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
                // If dragging is unlocked, avoid accidental pin toggle on drag
                if (isDragUnlocked) return;
                // Pin / unpin on click
                setPinnedUserId(isPinned ? null : user.id);
              }}
              title={`${displayName}${isPinned ? " (Pinned)" : " - Click to pin"}`}
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

              {/* In-Bubble Quick Controls for Self - Only visible on hover */}
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
                      {isAudioMuted ? (
                        <IconMicrophoneOff size={12} />
                      ) : (
                        <IconMicrophone size={12} />
                      )}
                    </button>
                  )}
                  {onToggleVideo && (
                    <button
                      type="button"
                      className={styles.quickActionBtn}
                      onClick={onToggleVideo}
                      title={isVideoMuted ? "Start Camera" : "Stop Camera"}
                    >
                      {isVideoMuted ? (
                        <IconVideoOff size={12} />
                      ) : (
                        <IconVideo size={12} />
                      )}
                    </button>
                  )}
                  {onLeaveVideo && (
                    <button
                      type="button"
                      className={styles.quickActionBtn}
                      onClick={onLeaveVideo}
                      style={{ background: "rgba(239, 68, 68, 0.9)" }}
                      title="Leave Video Call"
                    >
                      <WPIconClose size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
