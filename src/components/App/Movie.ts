import { Player } from "./Player";

export class Movie implements Player {
  elId: string;
  currentTime = 0;
  duration = 7200; // Default 2 hours if duration unknown from embed
  muted = false;
  volume = 1;
  playbackRate = 1;
  isPaused = false;
  onSeekCallback?: (time: number) => void;

  constructor(elId: string, onSeek?: (time: number) => void) {
    this.elId = elId;
    this.onSeekCallback = onSeek;
  }

  getIframe = (): HTMLIFrameElement | null => {
    return (document.getElementById(this.elId) as HTMLIFrameElement) || null;
  };

  postToEmbed = (data: any) => {
    try {
      const iframe = this.getIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(data, "*");
      }
    } catch {}
  };

  getCurrentTime = () => {
    return this.currentTime;
  };

  getDuration = () => {
    return this.duration;
  };

  isMuted = () => {
    return this.muted;
  };

  getPlaybackRate = () => {
    return this.playbackRate;
  };

  setPlaybackRate = (rate: number) => {
    this.playbackRate = rate;
    this.postToEmbed({ type: "SET_PLAYBACK_RATE", data: { rate } });
    this.postToEmbed({ event: "ratechange", rate });
  };

  setSrcAndTime = async (_src: string, time: number) => {
    this.currentTime = time;
    if (typeof time === "number" && time > 0 && this.onSeekCallback) {
      this.onSeekCallback(time);
    }
  };

  playVideo = async () => {
    this.isPaused = false;
    this.postToEmbed({ type: "PLAYER_PLAY" });
    this.postToEmbed({ type: "play" });
    this.postToEmbed({ event: "play" });
  };

  pauseVideo = () => {
    this.isPaused = true;
    this.postToEmbed({ type: "PLAYER_PAUSE" });
    this.postToEmbed({ type: "pause" });
    this.postToEmbed({ event: "pause" });
  };

  seekVideo = (time: number) => {
    const validTime = Math.max(0, time);
    this.currentTime = validTime;
    this.postToEmbed({ type: "PLAYER_SEEK", data: { time: validTime } });
    this.postToEmbed({ type: "seek", time: validTime });
    this.postToEmbed({ event: "seeked", currentTime: validTime });
    if (this.onSeekCallback) {
      this.onSeekCallback(validTime);
    }
  };

  shouldPlay = () => {
    return this.isPaused;
  };

  setMute = (muted: boolean) => {
    this.muted = muted;
    this.postToEmbed({ type: "SET_MUTE", data: { muted } });
    this.postToEmbed({ type: "mute", muted });
  };

  getVolume = () => {
    return this.volume;
  };

  setVolume = (volume: number) => {
    this.volume = volume;
    this.postToEmbed({ type: "SET_VOLUME", data: { volume } });
    this.postToEmbed({ type: "volume", volume });
  };

  isSubtitled = () => false;
  getSubtitleMode = (): TextTrackMode => "hidden";
  setSubtitleMode = () => {};
  isReady = () => true;
  clearState = () => {
    this.currentTime = 0;
    this.isPaused = false;
  };
  loadSubtitles = () => {};
  syncSubtitles = () => {};
  getTimeRanges = () => [{ start: 0, end: this.currentTime }];
  setLoop = () => {};
  getVideoEl = (): HTMLMediaElement => {
    return (
      (document.getElementById(this.elId) as any) ||
      document.createElement("video")
    );
  };
}
