import { DualAudioMode, getPlayerSettings } from "./playerSettings";

const LANG_MAP: Record<string, string> = {
  hin: "Hindi",
  hi: "Hindi",
  hindi: "Hindi",
  eng: "English",
  en: "English",
  english: "English",
  tam: "Tamil",
  ta: "Tamil",
  tamil: "Tamil",
  tel: "Telugu",
  te: "Telugu",
  telugu: "Telugu",
  mal: "Malayalam",
  ml: "Malayalam",
  kan: "Kannada",
  kn: "Kannada",
  ben: "Bengali",
  bn: "Bengali",
  mar: "Marathi",
  mr: "Marathi",
  guj: "Gujarati",
  gu: "Gujarati",
  pan: "Punjabi",
  pa: "Punjabi",
  urd: "Urdu",
  ur: "Urdu",
  jpn: "Japanese",
  ja: "Japanese",
  japanese: "Japanese",
  kor: "Korean",
  ko: "Korean",
  korean: "Korean",
  chi: "Chinese",
  zho: "Chinese",
  zh: "Chinese",
  chinese: "Chinese",
  spa: "Spanish",
  es: "Spanish",
  spanish: "Spanish",
  fre: "French",
  fra: "French",
  fr: "French",
  french: "French",
  ger: "German",
  deu: "German",
  de: "German",
  german: "German",
  ita: "Italian",
  it: "Italian",
  italian: "Italian",
  rus: "Russian",
  ru: "Russian",
  russian: "Russian",
  por: "Portuguese",
  pt: "Portuguese",
  portuguese: "Portuguese",
  ara: "Arabic",
  ar: "Arabic",
  arabic: "Arabic",
};

export const formatAudioLanguageLabel = (
  rawLabel?: string,
  rawLang?: string,
  index: number = 0,
): string => {
  const normLang = (rawLang || "").toLowerCase().trim();
  const normLabel = (rawLabel || "").toLowerCase().trim();

  // 1. Check if rawLang is in LANG_MAP
  if (normLang && LANG_MAP[normLang]) {
    const langName = LANG_MAP[normLang];
    return rawLabel && rawLabel.trim() && !rawLabel.toLowerCase().includes(normLang)
      ? `${langName} - ${rawLabel}`
      : `${langName} (${rawLang})`;
  }

  // 2. Search inside rawLabel for known language names or keys
  for (const [key, val] of Object.entries(LANG_MAP)) {
    if (normLabel === key || normLabel.startsWith(`${key} `) || normLabel.includes(`(${key})`)) {
      return `${val} Audio`;
    }
    if (normLabel.includes(val.toLowerCase())) {
      return rawLabel && rawLabel.trim() ? rawLabel : `${val} Audio`;
    }
  }

  // 3. Fallback
  if (rawLabel && rawLabel.trim()) {
    return rawLabel;
  }
  return `Audio Track ${index + 1}`;
};

export interface AudioTrackInfo {
  id: string | number;
  label: string;
  language?: string;
  enabled: boolean;
  isAttached?: boolean;
}

class AudioEnhancerManager {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private mergerNode: ChannelMergerNode | null = null;
  private splitterNode: ChannelSplitterNode | null = null;
  private currentVideoEl: HTMLMediaElement | null = null;
  private isMonoMode: boolean = false;
  private currentBoost: number = 100;
  private currentDualAudioMode: DualAudioMode = "stereo";

  /**
   * Safely attach Web Audio nodes to the HTML video element once
   */
  public attachToElement(element: HTMLMediaElement) {
    if (!element || this.currentVideoEl === element) {
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }

      // Resume context on user gesture if suspended
      if (this.ctx.state === "suspended") {
        const resumeCtx = () => {
          this.ctx?.resume();
          window.removeEventListener("click", resumeCtx);
          window.removeEventListener("keydown", resumeCtx);
        };
        window.addEventListener("click", resumeCtx, { once: true });
        window.addEventListener("keydown", resumeCtx, { once: true });
      }

      // In browser, createMediaElementSource can only be called ONCE per element
      if (!this.sourceNode) {
        this.sourceNode = this.ctx.createMediaElementSource(element);
        this.splitterNode = this.ctx.createChannelSplitter(2);
        this.mergerNode = this.ctx.createChannelMerger(2);
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = this.currentBoost / 100;

        // Connect source -> splitter
        this.sourceNode.connect(this.splitterNode);

        // Apply saved or default dual audio routing
        this.currentDualAudioMode = getPlayerSettings().dualAudioMode || "stereo";
        this.applyRouting(this.currentDualAudioMode);

        // Connect merger -> gain -> destination
        this.mergerNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);
      }

      this.currentVideoEl = element;
    } catch (err) {
      console.warn("AudioEnhancer attach notice:", err);
    }
  }

  /**
   * Set volume gain boost (100 = 1.0x, 150 = 1.5x, 200 = 2.0x, 300 = 3.0x)
   */
  public setBoost(percentage: number) {
    this.currentBoost = percentage;
    const gainValue = Math.max(0.1, percentage / 100);

    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    if (this.gainNode && this.ctx) {
      try {
        this.gainNode.gain.setTargetAtTime(
          gainValue,
          this.ctx.currentTime,
          0.05,
        );
      } catch {
        this.gainNode.gain.value = gainValue;
      }
    }
  }

  /**
   * Set Dual Audio Channel Mode (Stereo, Left Channel / Audio 1, Right Channel / Audio 2)
   */
  public setDualAudioMode(mode: DualAudioMode) {
    this.currentDualAudioMode = mode;
    this.applyRouting(mode);
  }

  private applyRouting(mode: DualAudioMode) {
    if (!this.splitterNode || !this.mergerNode) return;
    try {
      this.splitterNode.disconnect();
      if (mode === "left") {
        // Dual Audio: Language 1 (Left channel routed to both L and R outputs)
        this.splitterNode.connect(this.mergerNode, 0, 0);
        this.splitterNode.connect(this.mergerNode, 0, 1);
      } else if (mode === "right") {
        // Dual Audio: Language 2 (Right channel routed to both L and R outputs)
        this.splitterNode.connect(this.mergerNode, 1, 0);
        this.splitterNode.connect(this.mergerNode, 1, 1);
      } else {
        // Normal Stereo: L->L, R->R
        this.splitterNode.connect(this.mergerNode, 0, 0);
        this.splitterNode.connect(this.mergerNode, 1, 1);
      }
    } catch (e) {
      console.warn("AudioEnhancer applyRouting error:", e);
    }
  }

  /**
   * Toggle Stereo / Mono (useful for centering dialogue on unbalanced audio)
   */
  public setAudioMode(mode: "stereo" | "mono") {
    this.isMonoMode = mode === "mono";
  }

  /**
   * Check if multiple discrete audio streams are attached to the video
   */
  public hasMultiAudioStreams(videoEl?: HTMLMediaElement | null): boolean {
    if (videoEl && (videoEl as any).audioTracks && (videoEl as any).audioTracks.length > 1) {
      return true;
    }
    if (typeof window !== "undefined" && window.watchparty?.hls?.audioTracks && window.watchparty.hls.audioTracks.length > 1) {
      return true;
    }
    return false;
  }

  /**
   * Get list of audio tracks available from HTML5 video, HLS, or YouTube
   */
  public getAvailableTracks(videoEl?: HTMLMediaElement | null): AudioTrackInfo[] {
    const tracks: AudioTrackInfo[] = [];

    // 1. Native HTMLMediaElement audioTracks
    if (videoEl && (videoEl as any).audioTracks) {
      const nativeTracks = (videoEl as any).audioTracks;
      for (let i = 0; i < nativeTracks.length; i++) {
        const t = nativeTracks[i];
        tracks.push({
          id: i,
          label: formatAudioLanguageLabel(t.label, t.language, i),
          language: t.language || undefined,
          enabled: t.enabled,
          isAttached: true,
        });
      }
      if (tracks.length > 0) return tracks;
    }

    // 2. HLS.js audio tracks
    if (typeof window !== "undefined" && window.watchparty?.hls?.audioTracks) {
      const hlsTracks = window.watchparty.hls.audioTracks;
      const currentTrack = window.watchparty.hls.audioTrack;
      hlsTracks.forEach((t, idx) => {
        tracks.push({
          id: idx,
          label: formatAudioLanguageLabel(t.name, t.lang, idx),
          language: t.lang || undefined,
          enabled: currentTrack === idx,
          isAttached: true,
        });
      });
      if (tracks.length > 0) return tracks;
    }

    // 3. Fallback: Default Primary Stereo Track
    tracks.push({
      id: 0,
      label: "Default Audio (Stream 1)",
      enabled: true,
      isAttached: true,
    });

    return tracks;
  }

  /**
   * Switch the active audio track
   */
  public selectTrack(index: number, videoEl?: HTMLMediaElement | null) {
    // 1. Native HTMLMediaElement audioTracks
    if (videoEl && (videoEl as any).audioTracks) {
      const nativeTracks = (videoEl as any).audioTracks;
      for (let i = 0; i < nativeTracks.length; i++) {
        nativeTracks[i].enabled = i === index;
      }
    }

    // 2. HLS.js audio track
    if (typeof window !== "undefined" && window.watchparty?.hls) {
      if (window.watchparty.hls.audioTracks?.length) {
        window.watchparty.hls.audioTrack = index;
      }
    }
  }
}

export const audioEnhancer = new AudioEnhancerManager();
