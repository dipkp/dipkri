import { DualAudioMode, getPlayerSettings } from "./playerSettings";

export interface AudioTrackInfo {
  id: string | number;
  label: string;
  language?: string;
  enabled: boolean;
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
          label: t.label || t.language || `Audio Track ${i + 1}`,
          language: t.language || undefined,
          enabled: t.enabled,
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
          label: t.name || t.lang || `Audio Track ${idx + 1}`,
          language: t.lang || undefined,
          enabled: currentTrack === idx,
        });
      });
      if (tracks.length > 0) return tracks;
    }

    // 3. Fallback: Default Primary Stereo Track
    tracks.push({
      id: 0,
      label: "Stereo (Default Audio)",
      enabled: true,
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
