import { default as toWebVTT } from "srt-webvtt";
import { Player } from "./Player";

export class HTML implements Player {
  elId: string;
  constructor(elId: string) {
    this.elId = elId;
  }

  getVideoEl = (): HTMLVideoElement => {
    return document.getElementById(this.elId) as HTMLVideoElement;
  };

  getCurrentTime = () => {
    return this.getVideoEl()?.currentTime ?? 0;
  };

  getDuration = () => {
    return this.getVideoEl()?.duration ?? 0;
  };
  isMuted = () => {
    const auxAudio = typeof document !== "undefined" ? (document.getElementById("watchpartyAuxAudio") as HTMLAudioElement) : null;
    if (auxAudio && auxAudio.src && auxAudio.src !== "") {
      return auxAudio.muted;
    }
    return this.getVideoEl()?.muted ?? false;
  };

  isSubtitled = () => {
    return this.getSubtitleMode() === "showing";
  };

  getPlaybackRate = (): number => {
    return this.getVideoEl()?.playbackRate ?? 1;
  };

  setPlaybackRate = (rate: number) => {
    if (this.getVideoEl()) {
      this.getVideoEl().playbackRate = rate;
    }
  };

  setSrcAndTime = async (src: string, time: number) => {
    const leftVideo = this.getVideoEl();
    if (leftVideo) {
      let absoluteSrc = src;
      if (typeof window !== "undefined" && src) {
        try {
          absoluteSrc = new URL(src, window.location.href).href;
        } catch {}
      }
      if (leftVideo.src !== absoluteSrc && leftVideo.currentSrc !== absoluteSrc) {
        leftVideo.src = src;
      }
      if (typeof time === "number" && time > 0) {
        const applyTime = () => {
          try {
            if (Math.abs(leftVideo.currentTime - time) > 0.5) {
              leftVideo.currentTime = time;
            }
          } catch {}
        };
        if (leftVideo.readyState >= 1) {
          applyTime();
        } else {
          leftVideo.addEventListener("loadedmetadata", applyTime, { once: true });
          leftVideo.addEventListener("canplay", applyTime, { once: true });
        }
      }
    }
  };

  playVideo = async () => {
    const video = this.getVideoEl();
    if (video) {
      try {
        await video.play();
      } catch (err: any) {
        if (err?.name === "NotAllowedError") {
          try {
            video.muted = true;
            await video.play();
          } catch (e) {
            console.warn("Mobile muted fallback play error:", e);
          }
        } else {
          console.warn("HTML playVideo error:", err);
        }
      }
    }
  };

  pauseVideo = () => {
    if (this.getVideoEl()) {
      this.getVideoEl().pause();
    }
  };

  seekVideo = (time: number) => {
    const leftVideo = this.getVideoEl();
    if (leftVideo && typeof time === "number" && Number.isFinite(time)) {
      try {
        if (leftVideo.readyState >= 1) {
          leftVideo.currentTime = time;
        } else {
          leftVideo.addEventListener(
            "loadedmetadata",
            () => {
              try {
                leftVideo.currentTime = time;
              } catch {}
            },
            { once: true },
          );
        }
      } catch (e) {
        console.warn("HTML seekVideo error:", e);
      }
    }
  };

  shouldPlay = () => {
    const leftVideo = this.getVideoEl();
    return Boolean(leftVideo?.paused || leftVideo?.ended);
  };

  setMute = (muted: boolean) => {
    const auxAudio = typeof document !== "undefined" ? (document.getElementById("watchpartyAuxAudio") as HTMLAudioElement) : null;
    const hasAuxAudio = Boolean(auxAudio && auxAudio.src && auxAudio.src !== "");

    const leftVideo = this.getVideoEl();
    if (leftVideo) {
      if (hasAuxAudio) {
        // Keep main video track silenced while alternate audio track is selected
        leftVideo.muted = true;
      } else {
        leftVideo.muted = muted;
      }
    }
    const audio = document.getElementById("iPhoneAudio") as HTMLAudioElement;
    if (audio) {
      audio.muted = muted;
    }
    if (auxAudio) {
      auxAudio.muted = muted;
    }
  };

  setVolume = (volume: number) => {
    if (this.getVideoEl()) {
      this.getVideoEl().volume = volume;
    }
    const audio = document.getElementById("iPhoneAudio") as HTMLAudioElement;
    if (audio) {
      audio.volume = volume;
    }
    const auxAudio = typeof document !== "undefined" ? (document.getElementById("watchpartyAuxAudio") as HTMLAudioElement) : null;
    if (auxAudio) {
      auxAudio.volume = volume;
    }
  };

  getVolume = (): number => {
    const auxAudio = typeof document !== "undefined" ? (document.getElementById("watchpartyAuxAudio") as HTMLAudioElement) : null;
    if (auxAudio && auxAudio.src && auxAudio.src !== "") {
      return auxAudio.volume;
    }
    return this.getVideoEl()?.volume ?? 1;
  };

  private subtitleMode: TextTrackMode = "showing";

  setSubtitleMode = (
    mode?: TextTrackMode,
    trackIndexOrLang?: number | string,
  ) => {
    this.subtitleMode = mode || "hidden";
    const video = this.getVideoEl();
    if (!video || !video.textTracks) return;
    const tracks = video.textTracks;
    const targetIdx = typeof trackIndexOrLang === "number" ? trackIndexOrLang : 0;
    for (let i = 0; i < tracks.length; i++) {
      if (mode === "showing") {
        // Set to "hidden" so cues are loaded into memory for LiveCaptions to render,
        // without the browser rendering an ugly duplicate native cue overlay.
        tracks[i].mode = i === targetIdx ? "hidden" : "disabled";
      } else {
        tracks[i].mode = "disabled";
      }
    }
  };

  getSubtitleMode = (): TextTrackMode => {
    return this.subtitleMode;
  };

  isReady = () => {
    return Boolean(this.getVideoEl());
  };

  clearState = () => {
    const leftVideo = this.getVideoEl();
    if (!leftVideo) {
      return;
    }

    // Clean up any active MSE streaming engines first
    if (typeof window !== "undefined" && (window as any).watchparty) {
      if ((window as any).watchparty.hls) {
        try {
          (window as any).watchparty.hls.destroy();
        } catch {}
        (window as any).watchparty.hls = undefined;
      }
      if ((window as any).watchparty.dash) {
        try {
          (window as any).watchparty.dash.destroy();
        } catch {}
        (window as any).watchparty.dash = undefined;
      }
    }

    // Clear src and srcObject
    leftVideo.removeAttribute("src");
    leftVideo.src = "";
    leftVideo.srcObject = null;

    // Clear subtitles
    this.setSubtitleMode("hidden");
    const oldTracks = leftVideo.querySelectorAll("track");
    oldTracks.forEach((t) => t.remove());
  };

  loadSubtitles = async (src: string) => {
    const leftVideo = this.getVideoEl();
    if (!leftVideo) {
      return;
    }
    // Remove existing track elements safely
    const oldTracks = leftVideo.querySelectorAll("track");
    oldTracks.forEach((t) => t.remove());

    if (Boolean(src)) {
      let subtitleSrc = src;
      if (subtitleSrc) {
        try {
          const response = await fetch(subtitleSrc);
          const buffer = await response.arrayBuffer();
          const url = await toWebVTT(new Blob([buffer]));
          const track = document.createElement("track");
          track.kind = "captions";
          track.label = "English";
          track.srclang = "en";
          track.src = url;
          leftVideo.appendChild(track);
          // Hidden mode enables cue parsing without double-rendering native browser captions
          if (leftVideo.textTracks && leftVideo.textTracks[0]) {
            leftVideo.textTracks[0].mode = "hidden";
          }
        } catch (err) {
          console.warn("[HTML Player] Subtitle load warning:", err);
        }
      }
    }
  };

  syncSubtitles = (sharerTime: number) => {
    // When sharing, our timestamp doesn't match the subtitles so adjust them
    // For each cue, subtract the videoTS of the sharer, then add our own
    const leftVideo = this.getVideoEl();
    const track = leftVideo?.textTracks[0];
    let offset = leftVideo.currentTime - sharerTime;
    if (track && track.cues && offset) {
      for (let i = 0; i < track.cues.length; i++) {
        let cue = track?.cues?.[i] as TextTrackCue & {
          origStart: number;
          origEnd: number;
        };
        if (!cue) {
          continue;
        }
        // console.log(cue.text, offset, cue.origStart, cue.origEnd);
        // Use an undefined check: cue 0 legitimately starts at 0, and a falsy
        // check would re-base it on every sync, drifting subtitles forever.
        if (typeof cue.origStart !== "number") {
          cue.origStart = cue.startTime;
          cue.origEnd = cue.endTime;
        }
        cue.startTime = cue.origStart + offset;
        cue.endTime = cue.origEnd + offset;
      }
    }
  };

  getTimeRanges = (): { start: number; end: number }[] => {
    const leftVideo = this.getVideoEl();
    const buffers = [];
    const rangeCount = leftVideo?.buffered.length;
    for (let i = 0; i < rangeCount; i++) {
      const start = leftVideo?.buffered.start(i);
      const end = leftVideo?.buffered.end(i);
      buffers.push({ start, end });
    }
    return buffers;
  };

  setLoop = (loop: boolean): void => {
    const leftVideo = this.getVideoEl();
    if (leftVideo) {
      leftVideo.loop = loop;
    }
  };

  private currentSubtitleOffset = 0;

  setSubtitleOffset = (offsetSeconds: number): void => {
    const leftVideo = this.getVideoEl();
    if (!leftVideo || !leftVideo.textTracks) return;
    this.currentSubtitleOffset = offsetSeconds;
    for (let t = 0; t < leftVideo.textTracks.length; t++) {
      const track = leftVideo.textTracks[t];
      if (track && track.cues) {
        for (let i = 0; i < track.cues.length; i++) {
          const cue = track.cues[i] as any;
          if (cue) {
            if (typeof cue.origStart !== "number") {
              cue.origStart = cue.startTime;
              cue.origEnd = cue.endTime;
            }
            cue.startTime = cue.origStart + offsetSeconds;
            cue.endTime = cue.origEnd + offsetSeconds;
          }
        }
      }
    }
  };

  setVideoFlip = (flip: string): void => {
    const leftVideo = this.getVideoEl();
    if (leftVideo) {
      if (flip === "horizontal") {
        leftVideo.style.transform = "scaleX(-1)";
      } else if (flip === "vertical") {
        leftVideo.style.transform = "scaleY(-1)";
      } else {
        leftVideo.style.transform = "none";
      }
    }
  };

  setAspectRatio = (ratio: string): void => {
    const leftVideo = this.getVideoEl();
    if (leftVideo) {
      if (ratio === "fill") {
        leftVideo.style.objectFit = "fill";
        leftVideo.style.aspectRatio = "initial";
      } else if (ratio === "fit") {
        leftVideo.style.objectFit = "contain";
        leftVideo.style.aspectRatio = "initial";
      } else if (ratio === "16:9") {
        leftVideo.style.objectFit = "contain";
        leftVideo.style.aspectRatio = "16 / 9";
      } else if (ratio === "4:3") {
        leftVideo.style.objectFit = "contain";
        leftVideo.style.aspectRatio = "4 / 3";
      } else if (ratio === "21:9") {
        leftVideo.style.objectFit = "contain";
        leftVideo.style.aspectRatio = "21 / 9";
      } else {
        leftVideo.style.objectFit = "contain";
        leftVideo.style.aspectRatio = "initial";
      }
    }
  };
}
