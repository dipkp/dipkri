import { MediaPlayerClass } from "dashjs";
import { Player } from "./Player";

export class YouTube implements Player {
  watchPartyYTPlayer: YT.Player | null;
  constructor(watchPartyYTPlayer: YT.Player | null) {
    this.watchPartyYTPlayer = watchPartyYTPlayer;
  }
  clearDashState = () => {};
  setDashState = (player: MediaPlayerClass) => {};

  getCurrentTime = () => {
    return this.watchPartyYTPlayer?.getCurrentTime() ?? 0;
  };

  getDuration = () => {
    return this.watchPartyYTPlayer?.getDuration() ?? 0;
  };

  isMuted = () => {
    return this.watchPartyYTPlayer?.isMuted() ?? false;
  };

  isSubtitled = (): boolean => {
    // This actually isn't accurate after subtitles have been toggled off because track doesn't update
    // try {
    //   const current = this.watchPartyYTPlayer?.getOption('captions', 'track');
    //   return Boolean(current && current.languageCode);
    // } catch (e) {
    //   console.warn(e);
    //   return false;
    // }
    return false;
  };

  getPlaybackRate = (): number => {
    return this.watchPartyYTPlayer?.getPlaybackRate() ?? 1;
  };

  setPlaybackRate = (rate: number) => {
    this.watchPartyYTPlayer?.setPlaybackRate(rate);
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
    this.watchPartyYTPlayer?.cueVideoById(targetId, time || 0);
    // this.watchPartyYTPlayer?.cuePlaylist({listType: 'playlist', list: 'OLAK5uy_mtoaOGQksRdPbwlNtQ9IiK67wir5QqyIc'});
  };

  playVideo = async () => {
    setTimeout(() => {
      console.log("play yt");
      this.watchPartyYTPlayer?.playVideo();
      if (typeof this.pendingTime === "number" && this.pendingTime > 0) {
        try {
          const cur = this.watchPartyYTPlayer?.getCurrentTime() ?? 0;
          if (Math.abs(cur - this.pendingTime) > 1.5) {
            this.watchPartyYTPlayer?.seekTo(this.pendingTime, true);
          }
        } catch {}
      }
    }, 200);
  };

  pauseVideo = () => {
    this.watchPartyYTPlayer?.pauseVideo();
  };

  seekVideo = (time: number) => {
    if (typeof time === "number" && time >= 0) {
      this.pendingTime = time;
    }
    this.watchPartyYTPlayer?.seekTo(time, true);
  };

  shouldPlay = () => {
    return (
      this.watchPartyYTPlayer?.getPlayerState() ===
        window.YT?.PlayerState.PAUSED ||
      this.getCurrentTime() === this.getDuration()
    );
  };

  setMute = (muted: boolean) => {
    if (muted) {
      this.watchPartyYTPlayer?.mute();
    } else {
      this.watchPartyYTPlayer?.unMute();
    }
  };

  setVolume = (volume: number) => {
    this.watchPartyYTPlayer?.setVolume(volume * 100);
  };

  getVolume = (): number => {
    const volume = this.watchPartyYTPlayer?.getVolume();
    return (volume ?? 0) / 100;
  };

  private subtitleMode: TextTrackMode = "hidden";

  setSubtitleMode = (mode?: TextTrackMode, langOrIndex?: string | number) => {
    try {
      const player = this.watchPartyYTPlayer as any;
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
    return Boolean(this.watchPartyYTPlayer);
  };

  stopVideo = () => {
    this.watchPartyYTPlayer?.stopVideo();
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
          (this.watchPartyYTPlayer?.getVideoLoadedFraction() ?? 0) *
          this.getDuration(),
      },
    ];
  };

  setLoop = (loop: boolean): void => {
    this.watchPartyYTPlayer?.setLoop(loop);
  };

  getVideoEl = (): HTMLMediaElement => {
    return document.getElementById("leftYt") as HTMLMediaElement;
  };
}
