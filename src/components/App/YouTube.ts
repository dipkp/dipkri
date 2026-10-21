import { MediaPlayerClass } from "dashjs";
import { Player } from "./Player";

export class YouTube implements Player {
  dipkriYTPlayer: YT.Player | null;
  constructor(dipkriYTPlayer: YT.Player | null) {
    this.dipkriYTPlayer = dipkriYTPlayer;
  }
  clearDashState = () => {};
  setDashState = (player: MediaPlayerClass) => {};

  getCurrentTime = () => {
    return this.dipkriYTPlayer?.getCurrentTime() ?? 0;
  };

  getDuration = () => {
    return this.dipkriYTPlayer?.getDuration() ?? 0;
  };

  isMuted = () => {
    return this.dipkriYTPlayer?.isMuted() ?? false;
  };

  isSubtitled = (): boolean => {
    return this.subtitleMode === "showing";
  };

  getPlaybackRate = (): number => {
    return this.dipkriYTPlayer?.getPlaybackRate() ?? 1;
  };

  setPlaybackRate = (rate: number) => {
    this.dipkriYTPlayer?.setPlaybackRate(rate);
  };

  pendingTime?: number;

  setSrcAndTime = async (src: string, time: number) => {
    let url = new window.URL(src);
    // Standard link https://www.youtube.com/watch?v=ID
    let videoId = new URLSearchParams(url.search).get("v");
    // Link shortener https://youtu.be/ID
    let altVideoId = src.split("/").slice(-1)[0].split("?")[0];
    const targetId = videoId || altVideoId;
    if (typeof time === "number" && time > 0) {
      this.pendingTime = time;
    }
    this.dipkriYTPlayer?.cueVideoById(targetId, time || 0);
    // this.dipkriYTPlayer?.cuePlaylist({listType: 'playlist', list: 'OLAK5uy_mtoaOGQksRdPbwlNtQ9IiK67wir5QqyIc'});
  };

  playVideo = async () => {
    setTimeout(() => {
      console.log("play yt");
      this.dipkriYTPlayer?.playVideo();
      if (typeof this.pendingTime === "number" && this.pendingTime > 0) {
        try {
          const cur = this.dipkriYTPlayer?.getCurrentTime() ?? 0;
          if (Math.abs(cur - this.pendingTime) > 1.5) {
            this.dipkriYTPlayer?.seekTo(this.pendingTime, true);
          }
        } catch {}
      }
    }, 200);
  };

  pauseVideo = () => {
    this.dipkriYTPlayer?.pauseVideo();
  };

  seekVideo = (time: number) => {
    if (typeof time === "number" && time >= 0) {
      this.pendingTime = time;
    }
    this.dipkriYTPlayer?.seekTo(time, true);
  };

  shouldPlay = () => {
    return (
      this.dipkriYTPlayer?.getPlayerState() ===
        window.YT?.PlayerState.PAUSED ||
      this.getCurrentTime() === this.getDuration()
    );
  };

  setMute = (muted: boolean) => {
    if (muted) {
      this.dipkriYTPlayer?.mute();
    } else {
      this.dipkriYTPlayer?.unMute();
    }
  };

  setVolume = (volume: number) => {
    this.dipkriYTPlayer?.setVolume(volume * 100);
  };

  getVolume = (): number => {
    const volume = this.dipkriYTPlayer?.getVolume();
    return (volume ?? 0) / 100;
  };

  private subtitleMode: TextTrackMode = "hidden";

  setSubtitleMode = (mode?: TextTrackMode, langOrIndex?: string | number) => {
    try {
      const player = this.dipkriYTPlayer as any;
      if (!player) return;
      if (mode === "showing") {
        this.subtitleMode = "showing";
        if (typeof player.loadModule === "function") {
          player.loadModule("captions");
        }
        const lang = typeof langOrIndex === "string" ? langOrIndex : "en";
        if (typeof player.setOption === "function") {
          player.setOption("captions", "reload", true);
          player.setOption("captions", "track", { languageCode: lang });
        }
      } else if (mode === "hidden") {
        this.subtitleMode = "hidden";
        if (typeof player.unloadModule === "function") {
          player.unloadModule("captions");
        } else if (typeof player.setOption === "function") {
          player.setOption("captions", "track", {});
        }
      }
    } catch (err) {
      console.warn("YouTube subtitle toggle warning:", err);
    }
  };

  getSubtitleMode = () => {
    return this.subtitleMode;
  };

  isReady = () => {
    return Boolean(this.dipkriYTPlayer);
  };

  stopVideo = () => {
    this.dipkriYTPlayer?.stopVideo();
  };

  clearState = () => {
    return;
  };

  loadSubtitles = async (src: string) => {
    return;
  };

  syncSubtitles = (sharerTime: number) => {
    return;
  };

  getTimeRanges = (): { start: number; end: number }[] => {
    return [
      {
        start: 0,
        end:
          (this.dipkriYTPlayer?.getVideoLoadedFraction() ?? 0) *
          this.getDuration(),
      },
    ];
  };

  setLoop = (loop: boolean): void => {
    this.dipkriYTPlayer?.setLoop(loop);
  };

  getVideoEl = (): HTMLMediaElement => {
    return document.getElementById("leftYt") as HTMLMediaElement;
  };
}
