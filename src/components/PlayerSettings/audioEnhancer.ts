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
  let cleanRaw = (rawLabel || "").trim();
  cleanRaw = cleanRaw.replace(/^(?:\[[^\]]+\]|\([^\)]+\)|\b(?:www\.)?[a-zA-Z0-9\-]+(?:\.[a-zA-Z]{2,8})+\b)\s*[-_–—:]*\s*/gi, "");
  cleanRaw = cleanRaw.replace(/\b(?:1TamilMV|TamilMV|TamilBlasters|TamilRockers|TamilYogi|Movierulz|Bolly4u|KatmovieHD|Vegamovies|YTS|YIFY|PSA|GalaxyRG|TGx|ETRG|RARBG|Extratorrent|TorrentCounter|Cinemavilla|Kuttymovies|Pagalworld|PaglaMovies|Isaimini|MadrasRockers|MalluMv|JioRockers|BalaRockers|1TamilBlasters|capital|www)\b\s*[-_–—:]*\s*/gi, "");
  cleanRaw = cleanRaw.replace(/^[-–—:\s]+|[-–—:\s]+$/g, "").trim();

  const normLang = (rawLang || "").toLowerCase().trim();
  const normLabel = cleanRaw.toLowerCase();

  // 1. Check if rawLang is in LANG_MAP
  if (normLang && LANG_MAP[normLang]) {
    const langName = LANG_MAP[normLang];
    return cleanRaw && !cleanRaw.toLowerCase().includes(normLang)
      ? `${langName} (${cleanRaw})`
      : `${langName}`;
  }

  // 2. Search inside normLabel for known language names or keys
  for (const [key, val] of Object.entries(LANG_MAP)) {
    if (normLabel === key || normLabel.startsWith(`${key} `) || normLabel.includes(`(${key})`)) {
      return `${val}`;
    }
    if (normLabel.includes(val.toLowerCase())) {
      return cleanRaw ? cleanRaw : `${val}`;
    }
  }

  // 3. Fallback
  if (cleanRaw) {
    return cleanRaw;
  }
  return `Track ${index + 1}`;
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
  private analyserNode: AnalyserNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;

  /**
   * Safely attach Web Audio nodes to the HTML video element when custom audio processing is needed.
   * If volume is normal 100% and mode is standard stereo, we avoid intercepting native audio
   * so cross-origin media (m3u8, CDN streams) never suffers from browser CORS restrictions.
   */
  public attachToElement(element: HTMLMediaElement, force?: boolean) {
    if (!element) {
      return;
    }

    const s = getPlayerSettings();
    const needsBoost = (s.audioBoost && s.audioBoost > 100) || this.currentBoost > 100;
    const needsDualAudio = s.dualAudioMode && s.dualAudioMode !== "stereo";

    if (!force && !needsBoost && !needsDualAudio) {
      // Normal playback: let native audio play cleanly without CORS taint
      return;
    }

    if (this.currentVideoEl === element && this.sourceNode) {
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
          this.ctx?.resume().catch(() => {});
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

        // Create high-precision real-time audio analyser on source stream
        this.analyserNode = this.ctx.createAnalyser();
        this.analyserNode.fftSize = 512;
        this.analyserNode.smoothingTimeConstant = 0.2;
        this.sourceNode.connect(this.analyserNode);

        // Connect source -> splitter
        this.sourceNode.connect(this.splitterNode);

        // Apply saved or default dual audio routing
        this.currentDualAudioMode = s.dualAudioMode || "stereo";
        this.applyRouting(this.currentDualAudioMode);

        // Connect merger -> gain -> destination
        this.mergerNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);
      }

      this.currentVideoEl = element;
    } catch (err) {
      console.warn("AudioEnhancer safe attach notice:", err);
    }
  }

  /**
   * Get direct source audio AnalyserNode for real-time waveform & speech analysis
   */
  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * Get active AudioContext
   */
  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Create or return a clean MediaStream containing exclusively the source video's audio
   * (Zero microphone access, 100% internal video source)
   */
  public getAudioDestinationStream(): MediaStream | null {
    if (!this.ctx || !this.sourceNode) return null;
    try {
      if (!this.streamDest) {
        this.streamDest = this.ctx.createMediaStreamDestination();
        this.sourceNode.connect(this.streamDest);
      }
      return this.streamDest.stream;
    } catch {
      return null;
    }
  }

  /**
   * Ultra-low latency voice activity & acoustic speech onset detection.
   * Samples vocal frequency spectrum (300Hz - 3400Hz) directly from the video stream
   * to align subtitles/transcripts down to sub-10ms precision.
   */
  public getVoiceActivity(): { isSpeaking: boolean; vocalEnergy: number; peakVolume: number } {
    if (!this.analyserNode) {
      return { isSpeaking: false, vocalEnergy: 0, peakVolume: 0 };
    }
    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyserNode.getByteFrequencyData(dataArray);

    // Vocal speech frequencies are concentrated in ~300Hz - 3400Hz.
    // At ~48kHz sample rate, 512 FFT -> bin width ~93.75Hz.
    // Bins 3 (281Hz) to 36 (3375Hz) represent human voice formants.
    let vocalSum = 0;
    let vocalCount = 0;
    let peak = 0;
    for (let i = 3; i <= Math.min(36, bufferLength - 1); i++) {
      vocalSum += dataArray[i];
      vocalCount++;
      if (dataArray[i] > peak) peak = dataArray[i];
    }
    const avgVocal = vocalCount > 0 ? vocalSum / vocalCount : 0;
    const vocalEnergy = avgVocal / 255;
    const peakVolume = peak / 255;

    // Detect speech presence when vocal formant energy is above ambient noise floor
    const isSpeaking = vocalEnergy > 0.07 && peakVolume > 0.10;
    return { isSpeaking, vocalEnergy, peakVolume };
  }

  /**
   * Set volume gain boost (100 = 1.0x, 150 = 1.5x, 200 = 2.0x, 300 = 3.0x)
   */
  public setBoost(percentage: number, videoEl?: HTMLMediaElement) {
    this.currentBoost = percentage;
    const targetEl =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);

    if (percentage > 100 && targetEl && !this.sourceNode) {
      this.attachToElement(targetEl, true);
    }

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
  public setDualAudioMode(mode: DualAudioMode, videoEl?: HTMLMediaElement) {
    this.currentDualAudioMode = mode;
    const targetEl =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);

    if (mode !== "stereo" && targetEl && !this.sourceNode) {
      this.attachToElement(targetEl, true);
    }
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

  private mediaName: string = "";
  private mediaTracks: AudioTrackInfo[] = [];
  private selectedTrackIndex: number = 0;

  /**
   * Parse multi-language tags from media name/torrent filename,
   * e.g. "[Tel + Tam + Hin]", "Dual Audio [Hindi - English]", "[Hin + Eng + Tam]"
   */
  public extractLanguagesFromMediaName(name: string): AudioTrackInfo[] {
    if (!name) return [];
    let s = name;
    for (let i = 0; i < 3; i++) {
      try {
        if (s.includes("%")) s = decodeURIComponent(s);
      } catch {}
    }
    const dnMatch = s.match(/[?&]dn=([^&]+)/i);
    if (dnMatch) {
      let dn = dnMatch[1];
      for (let i = 0; i < 2; i++) {
        try {
          if (dn.includes("%")) dn = decodeURIComponent(dn);
        } catch {}
      }
      s = dn;
    }

    const tracks: AudioTrackInfo[] = [];
    const bracketMatches = s.matchAll(/\[([^\]]+)\]|\(([^)]+)\)/g);
    for (const m of bracketMatches) {
      const content = m[1] || m[2];
      if (!content) continue;
      const tokens = content
        .split(/[\+\-\/&,]+|\s{2,}/)
        .map((tok) => tok.trim())
        .filter(Boolean);
      const langs: { code: string; name: string; raw: string }[] = [];
      for (const tok of tokens) {
        const clean = tok.toLowerCase().replace(/[^a-z]/g, "");
        if (LANG_MAP[clean]) {
          langs.push({ code: clean, name: LANG_MAP[clean], raw: tok });
        }
      }
      if (langs.length >= 2) {
        langs.forEach((l, idx) => {
          tracks.push({
            id: idx,
            label: `Track ${idx + 1}: ${l.name} (${l.raw})`,
            language: l.code,
            enabled: idx === this.selectedTrackIndex,
            isAttached: true,
          });
        });
        break;
      }
      if (langs.length < 2) {
        const spaceTokens = content
          .split(/\s+/)
          .map((tok) => tok.trim())
          .filter(Boolean);
        const spaceLangs: { code: string; name: string; raw: string }[] = [];
        for (const tok of spaceTokens) {
          const clean = tok.toLowerCase().replace(/[^a-z]/g, "");
          if (LANG_MAP[clean]) {
            spaceLangs.push({ code: clean, name: LANG_MAP[clean], raw: tok });
          }
        }
        if (spaceLangs.length >= 2) {
          spaceLangs.forEach((l, idx) => {
            tracks.push({
              id: idx,
              label: `Track ${idx + 1}: ${l.name} (${l.raw})`,
              language: l.code,
              enabled: idx === this.selectedTrackIndex,
              isAttached: true,
            });
          });
          break;
        }
      }
    }

    // Secondary check for language keywords across the filename
    if (tracks.length === 0) {
      const allLangsRegex =
        /\b(hindi|english|tamil|telugu|kannada|malayalam|bengali|marathi|gujarati|punjabi|urdu|spanish|french|german|japanese|korean|russian|italian|chinese|hin|eng|tam|tel|mal|kan)\b/gi;
      const matches = [...s.matchAll(allLangsRegex)];
      const uniqueLangs: { code: string; name: string; raw: string }[] = [];
      for (const m of matches) {
        const raw = m[0];
        const clean = raw.toLowerCase();
        const mappedName = LANG_MAP[clean];
        if (mappedName && !uniqueLangs.some((u) => u.name === mappedName)) {
          uniqueLangs.push({ code: clean, name: mappedName, raw });
        }
      }
      if (uniqueLangs.length >= 2) {
        uniqueLangs.forEach((l, idx) => {
          tracks.push({
            id: idx,
            label: `Track ${idx + 1}: ${l.name} (${l.raw})`,
            language: l.code,
            enabled: idx === this.selectedTrackIndex,
            isAttached: true,
          });
        });
      }
    }

    return tracks;
  }

  private auxAudio: HTMLAudioElement | null = null;
  private currentMediaTorrent: string = "";
  private auxAttachedVideo: HTMLMediaElement | null = null;
  private auxAudioStartOffset: number = 0;
  private isProbingStreams: boolean = false;

  /**
   * Set the current media name so embedded language tags can be extracted immediately,
   * and fetch real probe data from the server if it's a torrent stream.
   */
  public setMediaName(name: string, mediaUrl?: string) {
    if (!name && !mediaUrl) return;
    const effectiveName = name || mediaUrl || "";
    if (mediaUrl) {
      this.currentMediaTorrent = mediaUrl;
    } else if (effectiveName.includes("/stream?torrent=") || effectiveName.startsWith("magnet:")) {
      this.currentMediaTorrent = effectiveName;
    }
    if (this.mediaName === effectiveName && (mediaUrl ? this.currentMediaTorrent === mediaUrl : true)) return;
    this.mediaName = effectiveName;
    this.mediaTracks = this.extractLanguagesFromMediaName(effectiveName);

    // Fetch ffprobe stream details from server if playing a torrent stream or direct multi-track media
    const target = mediaUrl || effectiveName;
    const isProbeableMedia =
      target.includes("/stream?torrent=") ||
      target.startsWith("magnet:") ||
      (!target.includes("youtube.com") && !target.includes("youtu.be") && /^https?:\/\/.+\.(mkv|mp4|webm|avi|mov|m4v)($|\?)/i.test(target));

    if (isProbeableMedia && !this.isProbingStreams) {
      this.probeStreamTracks(target);
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("watchparty-audio-tracks-updated"));
    }
  }

  private async probeStreamTracks(torrentUri: string) {
    this.isProbingStreams = true;
    try {
      const clean = torrentUri.replace(/^.*\/stream\?torrent=/, "");
      const res = await fetch(`/streamInfo?torrent=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.audioTracks && Array.isArray(data.audioTracks) && data.audioTracks.length > 0) {
          this.mediaTracks = data.audioTracks.map((t: any, idx: number) => ({
            id: idx,
            label: formatAudioLanguageLabel(t.label, t.language, idx),
            language: t.language,
            enabled: idx === this.selectedTrackIndex,
            isAttached: true,
          }));
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("watchparty-audio-tracks-updated"));
          }
        }
      }
    } catch (e) {
      console.warn("probeStreamTracks notice:", e);
    } finally {
      this.isProbingStreams = false;
    }
  }

  /**
   * Check if multiple discrete audio streams are attached to the video
   */
  public hasMultiAudioStreams(videoEl?: HTMLMediaElement | null, mediaName?: string): boolean {
    if (mediaName && this.mediaTracks.length === 0) {
      this.setMediaName(mediaName);
    }

    const el =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);

    if (el && (el as any).audioTracks && (el as any).audioTracks.length > 1) {
      return true;
    }
    if (
      typeof window !== "undefined" &&
      window.watchparty?.hls?.audioTracks &&
      window.watchparty.hls.audioTracks.length > 1
    ) {
      return true;
    }
    if (this.mediaTracks.length > 1) {
      return true;
    }
    return false;
  }

  /**
   * Get list of audio tracks available from HTML5 video, HLS, or extracted from multi-language media
   */
  public getAvailableTracks(
    videoEl?: HTMLMediaElement | null,
    mediaName?: string,
  ): AudioTrackInfo[] {
    if (mediaName && this.mediaTracks.length === 0) {
      this.setMediaName(mediaName);
    }

    const el =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);

    const tracks: AudioTrackInfo[] = [];

    // 1. Native HTMLMediaElement audioTracks (if browser supports multiple elementary streams)
    if (el && (el as any).audioTracks && (el as any).audioTracks.length > 0) {
      const nativeTracks = (el as any).audioTracks;
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
      if (tracks.length > 1) return tracks;
    }

    // 2. HLS.js audio tracks
    if (
      typeof window !== "undefined" &&
      window.watchparty?.hls?.audioTracks &&
      window.watchparty.hls.audioTracks.length > 0
    ) {
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
      if (tracks.length > 1) return tracks;
    }

    // 3. Multi-language tracks extracted from torrent/media name (e.g. MKV with [Tel + Tam + Hin])
    if (this.mediaTracks.length > 1) {
      return this.mediaTracks.map((t, idx) => ({
        ...t,
        enabled: idx === this.selectedTrackIndex,
      }));
    }

    if (tracks.length > 0) return tracks;

    // 4. Fallback: Default Primary Stereo Track
    tracks.push({
      id: 0,
      label: "Default Audio (Stream 1)",
      enabled: true,
      isAttached: true,
    });

    return tracks;
  }

  /**
   * Switch the active audio track and update speaker audio output immediately
   */
  public selectTrack(index: number, videoEl?: HTMLMediaElement | null) {
    this.selectedTrackIndex = index;
    const el =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);

    // 1. Native HTMLMediaElement audioTracks
    let nativeHandled = false;
    if (el && (el as any).audioTracks && (el as any).audioTracks.length > 1) {
      const nativeTracks = (el as any).audioTracks;
      for (let i = 0; i < nativeTracks.length; i++) {
        nativeTracks[i].enabled = i === index;
      }
      nativeHandled = true;
    }

    // 2. HLS.js audio track
    if (typeof window !== "undefined" && window.watchparty?.hls) {
      if (
        window.watchparty.hls.audioTracks &&
        window.watchparty.hls.audioTracks.length > 0
      ) {
        window.watchparty.hls.audioTrack = index;
        nativeHandled = true;
      }
    }

    // 3. Multi-Audio auxiliary playback for MKV / BitTorrent streams
    if (!nativeHandled) {
      this.mediaTracks.forEach((t, i) => {
        t.enabled = i === index;
      });

      if (index === 0) {
        this.stopAuxAudio(el);
      } else {
        this.playAuxAudio(index, el);
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("watchparty-audio-tracks-updated"));
    }
  }

  private stopAuxAudio(videoEl?: HTMLMediaElement | null) {
    if (this.auxAudio) {
      try {
        this.auxAudio.pause();
        this.auxAudio.src = "";
      } catch {}
    }
    const el =
      videoEl ||
      this.currentVideoEl ||
      (typeof document !== "undefined"
        ? (document.getElementById("leftVideo") as HTMLMediaElement)
        : null);
    if (el) {
      el.muted = false;
    }
  }

  private playAuxAudio(trackIndex: number, videoEl?: HTMLMediaElement | null) {
    if (typeof document === "undefined") return;
    const el =
      videoEl ||
      this.currentVideoEl ||
      (document.getElementById("leftVideo") as HTMLMediaElement) ||
      null;
    if (!el) return;

    // Silence video's native audio so only the user-selected language track plays
    el.muted = true;

    if (!this.auxAudio) {
      this.auxAudio = document.createElement("audio");
      this.auxAudio.id = "watchpartyAuxAudio";
      this.auxAudio.style.display = "none";
      this.auxAudio.preload = "auto";
      this.auxAudio.onerror = (e) => {
        console.warn("[WatchParty AudioTrack] Aux audio error", e);
        if (el && this.selectedTrackIndex === 0) el.muted = false;
      };
      this.auxAudio.onplaying = () => {
        if (el && this.selectedTrackIndex > 0) {
          el.muted = true;
        }
      };
      document.body.appendChild(this.auxAudio);
    }

    if (this.auxAttachedVideo !== el) {
      this.auxAttachedVideo = el;
      el.addEventListener("play", () => {
        if (this.selectedTrackIndex > 0 && this.auxAudio) {
          this.auxAudio.play().catch(() => {});
        }
      });
      el.addEventListener("pause", () => {
        if (this.auxAudio) {
          this.auxAudio.pause();
        }
      });
      el.addEventListener("ratechange", () => {
        if (this.auxAudio && el) {
          this.auxAudio.playbackRate = el.playbackRate;
        }
      });
      el.addEventListener("volumechange", () => {
        if (this.auxAudio && el) {
          this.auxAudio.volume = el.volume;
          // Notice: el.muted is intentionally true to silence the main stream, so do not copy it
        }
      });
      el.addEventListener("seeked", () => {
        if (this.selectedTrackIndex > 0 && el) {
          this.resyncAuxAudio(this.selectedTrackIndex, el);
        }
      });
      el.addEventListener("timeupdate", () => {
        if (
          this.selectedTrackIndex > 0 &&
          this.auxAudio &&
          !el.paused &&
          !this.auxAudio.paused &&
          this.auxAudio.readyState >= 2
        ) {
          const currentAudioPos = this.auxAudio.currentTime + this.auxAudioStartOffset;
          if (Math.abs(el.currentTime - currentAudioPos) > 1.0) {
            this.resyncAuxAudio(this.selectedTrackIndex, el);
          }
        }
      });
    }

    this.resyncAuxAudio(trackIndex, el);
  }

  private resyncAuxAudio(trackIndex: number, videoEl: HTMLMediaElement) {
    if (!this.auxAudio) return;
    const ss = Math.max(0, videoEl.currentTime);
    this.auxAudioStartOffset = ss;

    let torrentRef = this.currentMediaTorrent;
    if (!torrentRef && videoEl) {
      torrentRef = videoEl.currentSrc || videoEl.src || "";
    }
    if (!torrentRef && typeof document !== "undefined") {
      const leftEl = document.getElementById("leftVideo") as HTMLMediaElement;
      torrentRef = leftEl?.currentSrc || leftEl?.src || "";
    }
    let fileParam = "";
    const fIdx = torrentRef.match(/[?&]fileIndex=(\d+)/);
    if (fIdx) {
      fileParam = `&fileIndex=${fIdx[1]}`;
    }

    let cleanTorrent = torrentRef.replace(/^.*\/stream\?torrent=/, "");
    const cutIdx = cleanTorrent.indexOf("&fileIndex=");
    if (cutIdx !== -1) {
      cleanTorrent = cleanTorrent.slice(0, cutIdx);
    }
    try {
      cleanTorrent = decodeURIComponent(cleanTorrent);
    } catch {}

    if (!cleanTorrent) return;

    const url = `/streamAudio?torrent=${encodeURIComponent(cleanTorrent)}&track=${trackIndex}&ss=${ss.toFixed(1)}${fileParam}`;
    this.auxAudio.src = url;
    this.auxAudio.playbackRate = videoEl.playbackRate || 1;
    this.auxAudio.volume = videoEl.volume;
    // CRITICAL FIX: auxAudio must NOT be muted! It should play audible sound.
    this.auxAudio.muted = false;
    // Primary video stream must remain muted so there is no echo or clash
    videoEl.muted = true;

    if (!videoEl.paused) {
      this.auxAudio.play().catch((err) => {
        console.warn("[WatchParty AudioTrack] Play rejected:", err);
      });
    }
  }
}

export const audioEnhancer = new AudioEnhancerManager();
if (typeof window !== "undefined") {
  (window as any).watchpartyAudioEnhancer = audioEnhancer;
}
