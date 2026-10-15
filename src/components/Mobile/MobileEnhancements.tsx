import React, { useState, useEffect } from "react";
import styles from "./MobileEnhancements.module.css";
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
  driftX: number;
  rotation: number;
}

const REACTION_EMOJIS = ["🔥", "❤️", "🤣", "🚀", "👏", "🍿"];

export const MobileFloatingReactions = ({
  onSendReaction,
  isBehind,
  onSync,
}: {
  onSendReaction: (emoji: string) => void;
  isBehind?: boolean;
  onSync?: () => void;
}) => {
  const [flyingEmojis, setFlyingEmojis] = useState<FlyingEmoji[]>([]);

  const [activeBtn, setActiveBtn] = useState<string | null>(null);

  // High-energy multi-emoji burst fountain
  const triggerReaction = (emoji: string) => {
    onSendReaction(emoji);
    setActiveBtn(emoji);
    setTimeout(() => setActiveBtn(null), 350);

    const burstCount = 16;
    const newBatch: FlyingEmoji[] = [];
    const baseTime = Date.now();

    for (let i = 0; i < burstCount; i++) {
      const angle = (Math.random() - 0.5) * 55;
      newBatch.push({
        id: baseTime + Math.random() + i,
        emoji,
        left: 45 + Math.random() * 48,
        size: 24 + Math.random() * 26,
        delayMs: i * 35 + Math.random() * 25,
        duration: 1.8 + Math.random() * 0.8,
        driftX: (Math.random() - 0.5) * 110,
        rotation: angle,
      });
    }

    setFlyingEmojis((prev) => [...prev.slice(-48), ...newBatch]);
  };

  // Clean up expired floating emojis
  useEffect(() => {
    if (flyingEmojis.length === 0) return;
    const timer = setTimeout(() => {
      setFlyingEmojis([]);
    }, 2800);
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
                "--drift": `${item.driftX}px`,
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
          className={styles.mobileSyncPill}
          onClick={onSync}
          title="You are behind the host! Tap to catch up."
        >
          <WPIconSync size={14} />
          <span>Tap to Sync</span>
        </button>
      )}

      {/* Quick Reaction Bar */}
      <div className={styles.floatingReactionsBar}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className={`${styles.reactionBtn} ${activeBtn === emoji ? styles.activeReactionBtn : ""}`}
            onClick={() => triggerReaction(emoji)}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
};

export const MobileTabBar = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  participantCount,
  playlistCount,
}: {
  activeTab: "chat" | "people" | "playlist";
  onTabChange: (tab: "chat" | "people" | "playlist") => void;
  onOpenSettings?: () => void;
  participantCount: number;
  playlistCount: number;
}) => {
  return (
    <div className={styles.mobileTabBar}>
      <button
        className={`${styles.mobileTab} ${activeTab === "chat" ? styles.active : ""}`}
        onClick={() => onTabChange("chat")}
      >
        <WPIconChat size={16} />
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
