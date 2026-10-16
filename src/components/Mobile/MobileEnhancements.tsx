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
  left: number; // percentage across player
  size: number;
  delayMs: number;
  duration: number;
  driftX1: number;
  driftX2: number;
  rotation1: number;
  rotation2: number;
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
  const lastIncomingTsRef = useRef<number>(0);

  // High-energy multi-emoji burst fountain
  const spawnFountain = useCallback((emoji: string) => {
    const burstCount = 20;
    const newBatch: FlyingEmoji[] = [];
    const baseTime = Date.now();

    for (let i = 0; i < burstCount; i++) {
      const rot = (Math.random() - 0.5) * 44;
      const drift = (Math.random() - 0.5) * 75;
      newBatch.push({
        id: baseTime + Math.random() + i,
        emoji,
        left: 45 + (Math.random() - 0.5) * 46,
        size: 26 + Math.random() * 24,
        delayMs: i * 35,
        duration: 2.2 + Math.random() * 0.6,
        driftX1: drift * 0.6,
        driftX2: -drift * 0.8,
        rotation1: rot,
        rotation2: -rot * 0.7,
      });
    }

    setFlyingEmojis((prev) => [...prev.slice(-50), ...newBatch]);
  }, []);

  // Trigger reaction locally for immediate feedback
  const triggerReaction = (emoji: string) => {
    onSendReaction(emoji);
    setActiveBtn(emoji);
    setTimeout(() => setActiveBtn(null), 350);
    spawnFountain(emoji);
  };

  // Synchronize reaction bursts across ALL users in the room
  useEffect(() => {
    if (incomingReaction && incomingReaction.emoji && incomingReaction.ts !== lastIncomingTsRef.current) {
      lastIncomingTsRef.current = incomingReaction.ts;
      const selfId = getOrCreateClientId();
      // If the reaction came from another person in the room, burst it immediately!
      if (!incomingReaction.senderId || incomingReaction.senderId !== selfId) {
        spawnFountain(incomingReaction.emoji);
      }
    }
  }, [incomingReaction, spawnFountain]);

  // Clean up expired floating emojis
  useEffect(() => {
    if (flyingEmojis.length === 0) return;
    const timer = setTimeout(() => {
      setFlyingEmojis([]);
    }, 3400);
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
                left: `${item.left}%`,
                fontSize: `${item.size}px`,
                animationDelay: `${item.delayMs}ms`,
                animationDuration: `${item.duration}s`,
                "--drift1": `${item.driftX1}px`,
                "--drift2": `${item.driftX2}px`,
                "--rot1": `${item.rotation1}deg`,
                "--rot2": `${item.rotation2}deg`,
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
