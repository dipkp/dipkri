import React, { useState, useEffect, useRef, useCallback } from "react";
import styles from "./MobileEnhancements.module.css";
import { getOrCreateClientId } from "../../utils/utils";
import {
  WPIconChat,
  WPIconPeople,
  WPIconPlaylist,
  WPIconSync,
  WPIconSettings,
} from "../Icons/CustomIcons";

interface FlyingEmoji {
  id: number;
  emoji: string;
  right: number; // pixels from right edge
  size: number;
  delayMs: number;
  duration: number;
  drift1: number;
  drift2: number;
  rotation: number;
}

const REACTION_EMOJIS = ["🔥", "❤️", "🤣", "🚀", "👏", "🍿"];

export const MobileFloatingReactions = ({
  onSendReaction,
  incomingReaction,
  isBehind,
  onSync,
  hide,
}: {
  onSendReaction: (emoji: string) => void;
  incomingReaction?: { emoji: string; ts: number; senderId?: string } | null;
  isBehind?: boolean;
  onSync?: () => void;
  hide?: boolean;
}) => {
  const [flyingEmojis, setFlyingEmojis] = useState<FlyingEmoji[]>([]);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const lastLocalClickTsRef = useRef<number>(0);
  const lastIncomingTsRef = useRef<number>(0);

  // High-energy multi-emoji burst fountain ("lot of likes" animation)
  const spawnFountain = useCallback((emoji: string) => {
    const burstCount = 28;
    const newBatch: FlyingEmoji[] = [];
    const baseTime = Date.now();

    for (let i = 0; i < burstCount; i++) {
      const rot = (Math.random() - 0.5) * 36;
      const drift = (Math.random() - 0.5) * 80;
      newBatch.push({
        id: baseTime + Math.random() + i,
        emoji,
        right: 15 + Math.random() * 95,
        size: 24 + Math.random() * 26,
        delayMs: Math.round(i * 26 + Math.random() * 22),
        duration: +(1.9 + Math.random() * 0.7).toFixed(2),
        drift1: +(drift * 0.7).toFixed(1),
        drift2: +(-drift * 0.9).toFixed(1),
        rotation: +rot.toFixed(1),
      });
    }

    setFlyingEmojis((prev) => [...prev.slice(-60), ...newBatch]);
  }, []);

  // Trigger reaction locally for immediate feedback
  const triggerReaction = (emoji: string) => {
    lastLocalClickTsRef.current = Date.now();
    onSendReaction(emoji);
    setActiveBtn(emoji);
    setTimeout(() => setActiveBtn(null), 350);
    spawnFountain(emoji);
  };

  // Synchronize reaction bursts across ALL users in the room
  useEffect(() => {
    if (incomingReaction && incomingReaction.emoji && incomingReaction.ts !== lastIncomingTsRef.current) {
      lastIncomingTsRef.current = incomingReaction.ts;
      // If we just clicked locally within 280ms, we already spawned it locally
      if (Date.now() - lastLocalClickTsRef.current > 280) {
        spawnFountain(incomingReaction.emoji);
      }
    }
  }, [incomingReaction, spawnFountain]);

  // Clean up expired floating emojis
  useEffect(() => {
    if (flyingEmojis.length === 0) return;
    const timer = setTimeout(() => {
      setFlyingEmojis([]);
    }, 3200);
    return () => clearTimeout(timer);
  }, [flyingEmojis]);

  return (
    <>
      {/* Floating flying emoji fountain burst on screen */}
      <div className={styles.emojiBurstContainer}>
        {flyingEmojis.map((item) => (
          <div
            key={item.id}
            className={styles.floatingEmoji}
            style={
              {
                right: `${item.right}px`,
                fontSize: `${item.size}px`,
                animationDelay: `${item.delayMs}ms`,
                animationDuration: `${item.duration}s`,
                "--drift1": `${item.drift1}px`,
                "--drift2": `${item.drift2}px`,
                "--rot": `${item.rotation}deg`,
              } as React.CSSProperties
            }
          >
            {item.emoji}
          </div>
        ))}
      </div>

      {/* Floating Quick Resync Pill when behind */}
      {isBehind && onSync && (
        <button
          type="button"
          className={styles.mobileSyncPill}
          onClick={(e) => {
            e.stopPropagation();
            onSync();
          }}
          title="You are behind the host! Tap to catch up."
        >
          <WPIconSync size={14} />
          <span>Tap to Sync</span>
        </button>
      )}

      {/* Quick Reaction Bar */}
      {!hide && (
        <div
          className={styles.floatingReactionsBar}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`${styles.reactionBtn} ${activeBtn === emoji ? styles.activeReactionBtn : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerReaction(emoji);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

export const MobileTabBar = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  participantCount,
  playlistCount,
  unreadCount,
}: {
  activeTab: "chat" | "people" | "playlist";
  onTabChange: (tab: "chat" | "people" | "playlist") => void;
  onOpenSettings?: () => void;
  participantCount: number;
  playlistCount: number;
  unreadCount?: number;
}) => {
  return (
    <div className={styles.mobileTabBar}>
      <button
        className={`${styles.mobileTab} ${activeTab === "chat" ? styles.active : ""}`}
        onClick={() => onTabChange("chat")}
      >
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <WPIconChat size={16} />
          {Boolean(unreadCount && unreadCount > 0 && activeTab !== "chat") && (
            <span className={styles.notificationBadge}>
              {(unreadCount ?? 0) > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <span>Chat</span>
      </button>
      <button
        className={`${styles.mobileTab} ${activeTab === "people" ? styles.active : ""}`}
        onClick={() => onTabChange("people")}
      >
        <WPIconPeople size={16} />
        <span>People ({participantCount})</span>
      </button>
      <button
        className={`${styles.mobileTab} ${activeTab === "playlist" ? styles.active : ""}`}
        onClick={() => onTabChange("playlist")}
      >
        <WPIconPlaylist size={16} />
        <span>Queue ({playlistCount})</span>
      </button>
      {onOpenSettings && (
        <button
          className={styles.mobileTab}
          onClick={onOpenSettings}
          title="Room & Local Settings"
        >
          <WPIconSettings size={16} />
          <span>Settings</span>
        </button>
      )}
    </div>
  );
};
