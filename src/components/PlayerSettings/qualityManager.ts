// qualityManager.ts - Video playback resolution and quality switcher for HLS, DASH, YouTube, and HTML5 video

export interface QualityOption {
  key: string; // "auto" | "1080p" | "720p" | "480p" | "360p"
  label: string;
  badge?: string;
}

export const QUALITY_PRESETS: QualityOption[] = [
  { key: "auto", label: "Auto", badge: "Adaptive" },
  { key: "1080p", label: "1080p", badge: "Full HD" },
  { key: "720p", label: "720p", badge: "HD" },
  { key: "480p", label: "480p", badge: "SD" },
  { key: "360p", label: "360p", badge: "Data Saver" },
];

class QualityManager {
  /**
   * Apply video playback quality across the active player engine
   */
  public applyQuality(quality: string, isYouTube?: boolean) {
    // 1. YouTube IFrame API
    if (isYouTube && typeof window !== "undefined" && (window as any).dipkriYTPlayer) {
      try {
        const yt = (window as any).dipkriYTPlayer;
        const ytQualityMap: Record<string, string> = {
          auto: "auto",
          "1080p": "hd1080",
          "720p": "hd720",
          "480p": "large",
          "360p": "medium",
        };
        const target = ytQualityMap[quality] || "auto";
        if (typeof yt.setPlaybackQuality === "function") {
          yt.setPlaybackQuality(target);
        }
      } catch (e) {
        console.warn("YouTube setPlaybackQuality failed:", e);
      }
      return;
    }

    // 2. HLS.js adaptive stream
    if (typeof window !== "undefined" && window.dipkri?.hls) {
      try {
        const hls = window.dipkri.hls;
        if (quality === "auto") {
          hls.currentLevel = -1; // Auto level
        } else {
          const targetH = parseInt(quality, 10);
          const levels = hls.levels || [];
          let bestIdx = -1;
          let minDiff = Infinity;
          levels.forEach((lvl, idx) => {
            const h = lvl.height || 0;
            const diff = Math.abs(h - targetH);
            if (diff < minDiff) {
              minDiff = diff;
              bestIdx = idx;
            }
          });
          if (bestIdx !== -1) {
            hls.currentLevel = bestIdx;
          }
        }
      } catch (e) {
        console.warn("HLS setLevel failed:", e);
      }
      return;
    }

    // 3. Dash.js adaptive stream
    if (typeof window !== "undefined" && window.dipkri?.dash) {
      try {
        const dash = window.dipkri.dash as any;
        if (quality === "auto") {
          dash.updateSettings?.({
            streaming: { abr: { autoSwitchBitrate: { video: true } } },
          });
        } else {
          dash.updateSettings?.({
            streaming: { abr: { autoSwitchBitrate: { video: false } } },
          });
          const targetH = parseInt(quality, 10);
          const bitrates = dash.getBitrateInfoListFor?.("video") || [];
          let bestIdx = 0;
          let minDiff = Infinity;
          bitrates.forEach((b: any, idx: number) => {
            const h = b.height || 0;
            const diff = Math.abs(h - targetH);
            if (diff < minDiff) {
              minDiff = diff;
              bestIdx = idx;
            }
          });
          dash.setQualityFor?.("video", bestIdx);
        }
      } catch (e) {
        console.warn("Dash setQuality failed:", e);
      }
      return;
    }

    // 4. HTML5 Video Element (MP4 / WebM / Torrent)
    const videoEl = document.getElementById("leftVideo") as HTMLVideoElement;
    if (videoEl) {
      // For direct video, apply optimized image rendering and scaling profile
      if (quality === "1080p") {
        videoEl.style.imageRendering = "auto";
      } else if (quality === "360p" || quality === "480p") {
        videoEl.style.imageRendering = "smooth";
      } else {
        videoEl.style.imageRendering = "auto";
      }
    }
  }
}

export const qualityManager = new QualityManager();
