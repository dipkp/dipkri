// playerSettings.ts - Centralized reactive settings for Live Captions, Video Quality, and Audio Tracks/Boost
import { getCurrentSettings, updateSettings } from "../Settings/LocalSettings";

export type DualAudioMode = "stereo" | "left" | "right";
export type CaptionSize = "small" | "medium" | "large";
export type CaptionColor = "white" | "yellow" | "cyan" | "green";
export type CaptionStyle = "shadow" | "box" | "outline";
export type CaptionPosition = "bottom" | "top";

export interface PlayerSettingsState {
  liveCaptions: boolean;
  captionLanguage: string; // "en" | "hi" | "es" | "all"
  captionSize: CaptionSize; // "small" | "medium" | "large"
  captionColor: CaptionColor; // "white" | "yellow" | "cyan" | "green"
  captionStyle: CaptionStyle; // "shadow" | "box" | "outline"
  captionPosition: CaptionPosition; // "bottom" | "top"
  quality: string; // "auto" | "1080p" | "720p" | "480p" | "360p"
  audioTrack: number; // 0, 1, 2...
  audioBoost: number; // 100, 150, 200, 300 (%)
  dualAudioMode: DualAudioMode; // "stereo" | "left" | "right"
  audioMode: "stereo" | "mono";
  showStatsOverlay: boolean;
}

export const PLAYER_SETTINGS_CHANGED_EVENT = "dipkri-player-settings-changed";

export const getPlayerSettings = (): PlayerSettingsState => {
  let liveCaptions = true;
  let captionLanguage = "en";
  let captionSize: CaptionSize = "medium";
  let captionColor: CaptionColor = "white";
  let captionStyle: CaptionStyle = "shadow";
  let captionPosition: CaptionPosition = "bottom";
  let quality = "auto";
  let audioTrack = 0;
  let audioBoost = 100;
  let dualAudioMode: DualAudioMode = "stereo";
  let audioMode: "stereo" | "mono" = "stereo";
  let showStatsOverlay = true;

  if (typeof window !== "undefined") {
    try {
      const local = getCurrentSettings();
      if (local.liveCaptions !== undefined) {
        liveCaptions = Boolean(local.liveCaptions);
      } else {
        const savedLC = localStorage.getItem("dipkri-live-captions");
        if (savedLC !== null) {
          liveCaptions = savedLC === "true";
        }
      }

      const savedLang = localStorage.getItem("dipkri-caption-language");
      if (savedLang) captionLanguage = savedLang;

      const savedSize = localStorage.getItem("dipkri-caption-size") as CaptionSize | null;
      if (savedSize === "small" || savedSize === "medium" || savedSize === "large") {
        captionSize = savedSize;
      }

      const savedColor = localStorage.getItem("dipkri-caption-color") as CaptionColor | null;
      if (savedColor === "white" || savedColor === "yellow" || savedColor === "cyan" || savedColor === "green") {
        captionColor = savedColor;
      }

      const savedStyle = localStorage.getItem("dipkri-caption-style") as CaptionStyle | null;
      if (savedStyle === "shadow" || savedStyle === "box" || savedStyle === "outline") {
        captionStyle = savedStyle;
      }

      const savedPos = localStorage.getItem("dipkri-caption-position") as CaptionPosition | null;
      if (savedPos === "bottom" || savedPos === "top") {
        captionPosition = savedPos;
      }

      if (local.playbackQuality) {
        quality = local.playbackQuality;
      } else {
        const savedQ = localStorage.getItem("dipkri-playback-quality");
        if (savedQ) quality = savedQ;
      }

      if (local.audioBoost) {
        audioBoost = local.audioBoost;
      } else {
        const savedB = localStorage.getItem("dipkri-audio-boost");
        if (savedB) audioBoost = Number(savedB) || 100;
      }

      const savedDual = localStorage.getItem("dipkri-dual-audio-mode");
      if (savedDual === "left" || savedDual === "right" || savedDual === "stereo") {
        dualAudioMode = savedDual;
      }

      if (local.audioMode) {
        audioMode = local.audioMode;
      } else {
        const savedM = localStorage.getItem("dipkri-audio-mode");
        if (savedM === "mono") audioMode = "mono";
      }

      const savedStats = localStorage.getItem("dipkri-stats-overlay");
      if (savedStats === "false") showStatsOverlay = false;

      const savedT = localStorage.getItem("dipkri-audio-track");
      if (savedT) audioTrack = Number(savedT) || 0;
    } catch {}
  }

  return {
    liveCaptions,
    captionLanguage,
    captionSize,
    captionColor,
    captionStyle,
    captionPosition,
    quality,
    audioTrack,
    audioBoost,
    dualAudioMode,
    audioMode,
    showStatsOverlay,
  };
};

export const setPlayerSettings = (
  partial: Partial<PlayerSettingsState>,
): PlayerSettingsState => {
  const current = getPlayerSettings();
  const next: PlayerSettingsState = { ...current, ...partial };

  if (typeof window !== "undefined") {
    try {
      if (partial.showStatsOverlay !== undefined) {
        localStorage.setItem("dipkri-stats-overlay", String(partial.showStatsOverlay));
      }
      if (partial.liveCaptions !== undefined) {
        localStorage.setItem("dipkri-live-captions", String(partial.liveCaptions));
      }
      if (partial.captionLanguage !== undefined) {
        localStorage.setItem("dipkri-caption-language", partial.captionLanguage);
      }
      if (partial.captionSize !== undefined) {
        localStorage.setItem("dipkri-caption-size", partial.captionSize);
      }
      if (partial.captionColor !== undefined) {
        localStorage.setItem("dipkri-caption-color", partial.captionColor);
      }
      if (partial.captionStyle !== undefined) {
        localStorage.setItem("dipkri-caption-style", partial.captionStyle);
      }
      if (partial.captionPosition !== undefined) {
        localStorage.setItem("dipkri-caption-position", partial.captionPosition);
      }
      if (partial.quality !== undefined) {
        localStorage.setItem("dipkri-playback-quality", partial.quality);
      }
      if (partial.audioTrack !== undefined) {
        localStorage.setItem("dipkri-audio-track", String(partial.audioTrack));
      }
      if (partial.audioBoost !== undefined) {
        localStorage.setItem("dipkri-audio-boost", String(partial.audioBoost));
      }
      if (partial.dualAudioMode !== undefined) {
        localStorage.setItem("dipkri-dual-audio-mode", partial.dualAudioMode);
      }
      if (partial.audioMode !== undefined) {
        localStorage.setItem("dipkri-audio-mode", partial.audioMode);
      }

      // Sync to LocalSettings
      const local = getCurrentSettings();
      updateSettings(
        JSON.stringify({
          ...local,
          liveCaptions: next.liveCaptions,
          captionLanguage: next.captionLanguage,
          playbackQuality: next.quality,
          audioBoost: next.audioBoost,
          audioMode: next.audioMode,
        }),
      );
    } catch {}

    window.dispatchEvent(
      new CustomEvent(PLAYER_SETTINGS_CHANGED_EVENT, { detail: next }),
    );
  }

  return next;
};
