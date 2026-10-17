import { spawn } from "node:child_process";
import { Server, Socket } from "socket.io";
import config from "./config.ts";

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export class RoomTranscriber {
  private roomId: string;
  private io: Server;
  private videoUrl: string = "";
  private currentLang: string = "en";
  private activeUsers: Set<string> = new Set();
  private cachedCues: SubtitleCue[] = [];
  private isProcessing: boolean = false;
  private lastSliceEnd: number = 0;
  private loopTimer: NodeJS.Timeout | null = null;
  private seekDebounceTimer: NodeJS.Timeout | null = null;
  private getRoomVideoTS: () => number;
  private isRoomPaused: () => boolean;

  constructor(
    io: Server,
    roomId: string,
    getVideoTS: () => number,
    getPaused: () => boolean,
  ) {
    this.io = io;
    this.roomId = roomId;
    this.getRoomVideoTS = getVideoTS;
    this.isRoomPaused = getPaused;
  }

  public setVideo(url: string) {
    if (this.videoUrl !== url) {
      this.videoUrl = url;
      this.cachedCues = [];
      this.lastSliceEnd = 0;
      this.io.of(this.roomId).emit("REC:clearAutoCaptions");
      if (
        this.activeUsers.size > 0 &&
        !this.isRoomPaused() &&
        !url.startsWith("magnet:") &&
        !url.includes("/stream?torrent=") &&
        !url.includes("youtube.com") &&
        !url.includes("youtu.be")
      ) {
        this.triggerLookahead();
      }
    }
  }

  public setLanguage(lang: string) {
    if (this.currentLang !== lang) {
      this.currentLang = lang;
      // If language changed, clear cache for current movie to re-transcribe in new language
      this.cachedCues = [];
      this.lastSliceEnd = 0;
      this.io.of(this.roomId).emit("REC:clearAutoCaptions");
      if (
        this.activeUsers.size > 0 &&
        !this.isRoomPaused() &&
        !this.videoUrl.startsWith("magnet:") &&
        !this.videoUrl.includes("/stream?torrent=") &&
        !this.videoUrl.includes("youtube.com") &&
        !this.videoUrl.includes("youtu.be")
      ) {
        this.triggerLookahead();
      }
    }
  }

  public userJoinedAutoCaption(socket: Socket, lang?: string) {
    this.activeUsers.add(socket.id);
    if (lang) {
      this.currentLang = lang;
    }

    // Send all existing cumulative cached cues immediately for 0.00s instant render
    if (this.cachedCues.length > 0) {
      socket.emit("REC:autoCaptions", this.cachedCues);
    }

    // If this is the first user enabling Auto Caption in the room, start the lookahead worker
    if (this.activeUsers.size === 1) {
      this.startLoop();
    }
  }

  public userLeftAutoCaption(socketId: string) {
    this.activeUsers.delete(socketId);
    // If no user in the room wants auto-captions, stop the worker to save CPU and API quota
    if (this.activeUsers.size === 0) {
      this.stopLoop();
    }
  }

  public onPlay() {
    if (this.activeUsers.size > 0) {
      this.startLoop();
    }
  }

  public onPause() {
    this.stopLoop();
  }

  public onSeek(newTS: number) {
    if (this.seekDebounceTimer) {
      clearTimeout(this.seekDebounceTimer);
    }

    if (
      !this.videoUrl ||
      this.videoUrl.startsWith("magnet:") ||
      this.videoUrl.includes("/stream?torrent=") ||
      this.videoUrl.includes("youtube.com") ||
      this.videoUrl.includes("youtu.be")
    ) {
      return;
    }

    // 1. Check if the newly sought timestamp is already inside our in-memory cache
    const hasCachedCoverage = this.cachedCues.some(
      (c) => c.start >= newTS && c.start <= newTS + 25,
    );
    if (hasCachedCoverage) {
      // Instant cache hit! No FFmpeg, no Groq API call needed.
      return;
    }

    // 2. Debounce by 1 second during rapid scrubbing/skipping
    this.seekDebounceTimer = setTimeout(() => {
      if (this.activeUsers.size > 0 && !this.isRoomPaused()) {
        this.fetchLookaheadSlice(newTS);
      }
    }, 1000);
  }

  private startLoop() {
    if (this.loopTimer) return;
    this.triggerLookahead();
    // Run lookahead check every 20 seconds
    this.loopTimer = setInterval(() => {
      this.triggerLookahead();
    }, 20000);
  }

  private stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private triggerLookahead() {
    if (
      this.isProcessing ||
      !this.videoUrl ||
      this.isRoomPaused() ||
      this.activeUsers.size === 0 ||
      this.videoUrl.startsWith("magnet:") ||
      this.videoUrl.includes("/stream?torrent=") ||
      this.videoUrl.includes("youtube.com") ||
      this.videoUrl.includes("youtu.be")
    ) {
      return;
    }
    const currentTS = Math.max(0, this.getRoomVideoTS());
    // If we have already sliced ahead of current time + 25s, wait for playback to advance
    if (this.lastSliceEnd > currentTS + 25) {
      return;
    }
    const startSec = Math.max(0, Math.floor(currentTS));
    this.fetchLookaheadSlice(startSec);
  }

  private async fetchLookaheadSlice(startSec: number) {
    if (
      this.isProcessing ||
      !this.videoUrl ||
      this.activeUsers.size === 0 ||
      this.videoUrl.startsWith("magnet:") ||
      this.videoUrl.includes("/stream?torrent=") ||
      this.videoUrl.includes("youtube.com") ||
      this.videoUrl.includes("youtu.be")
    ) {
      return;
    }
    this.isProcessing = true;

    try {
      const apiKey = config.GROQ_API_KEY || process.env.GROQ_API_KEY;
      if (!apiKey) {
        return;
      }

      const durationSec = 30; // 30-second lookahead slice
      const audioBuffer = await this.extractAudioSlice(
        this.videoUrl,
        startSec,
        durationSec,
      );

      if (audioBuffer && audioBuffer.length > 1000) {
        const newCues = await this.transcribeWithGroq(
          audioBuffer,
          startSec,
          this.currentLang,
          apiKey,
        );

        if (newCues && newCues.length > 0) {
          // Merge new cues into cumulative cache without duplicates
          for (const cue of newCues) {
            const exists = this.cachedCues.some(
              (c) => Math.abs(c.start - cue.start) < 0.25,
            );
            if (!exists) {
              this.cachedCues.push(cue);
            }
          }
          this.cachedCues.sort((a, b) => a.start - b.start);
          this.lastSliceEnd = startSec + durationSec;

          // Broadcast newly transcribed cues to all clients in the room!
          this.io.of(this.roomId).emit("REC:autoCaptions", newCues);
        }
      }
    } catch (err: any) {
      console.warn(`[AutoCaption Room ${this.roomId}] Slice error:`, err?.message || err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fast keyframe audio extraction via FFmpeg into a 32kbps mono MP3 buffer (takes ~150ms)
   */
  private extractAudioSlice(
    url: string,
    startSec: number,
    durationSec: number,
  ): Promise<Buffer> {
    return new Promise((resolve) => {
      // If torrent stream, replace localhost or proxy if needed
      let targetUrl = url;
      if (targetUrl.startsWith("/")) {
        targetUrl = `http://127.0.0.1:${config.PORT}${targetUrl}`;
      }

      const args = [
        "-ss",
        String(startSec),
        "-i",
        targetUrl,
        "-t",
        String(durationSec),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "32k",
        "-f",
        "mp3",
        "pipe:1",
      ];

      const ffmpeg = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      const killTimeout = setTimeout(() => {
        try {
          ffmpeg.kill("SIGKILL");
        } catch {}
        resolve(Buffer.concat(chunks));
      }, 7000);

      ffmpeg.on("close", () => {
        clearTimeout(killTimeout);
        resolve(Buffer.concat(chunks));
      });

      ffmpeg.on("error", (e) => {
        clearTimeout(killTimeout);
        console.warn("[AutoCaption] FFmpeg process warning:", e.message);
        resolve(Buffer.concat(chunks));
      });
    });
  }

  /**
   * Post audio slice to Groq Whisper-Large-v3 API
   */
  private async transcribeWithGroq(
    audioBuffer: Buffer,
    startSec: number,
    lang: string,
    apiKey: string,
  ): Promise<SubtitleCue[]> {
    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer as any], { type: "audio/mpeg" });
      formData.append("file", blob, "slice.mp3");
      formData.append("model", "whisper-large-v3");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      if (lang && lang !== "all") {
        formData.append("language", lang);
      }

      const resp = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[AutoCaption] Groq API warning (${resp.status}):`, errText);
        return [];
      }

      const data: any = await resp.json();
      const cues: SubtitleCue[] = [];

      if (data?.segments && Array.isArray(data.segments)) {
        for (const seg of data.segments) {
          if (seg.text && typeof seg.start === "number" && typeof seg.end === "number") {
            const cleanText = seg.text.trim();
            if (cleanText) {
              cues.push({
                start: Math.round((startSec + seg.start) * 1000) / 1000,
                end: Math.round((startSec + seg.end) * 1000) / 1000,
                text: cleanText,
              });
            }
          }
        }
      } else if (data?.text?.trim()) {
        cues.push({
          start: startSec,
          end: startSec + 30,
          text: data.text.trim(),
        });
      }

      return cues;
    } catch (e: any) {
      console.warn("[AutoCaption] Groq transcription error:", e.message);
      return [];
    }
  }

  public destroy() {
    this.stopLoop();
    if (this.seekDebounceTimer) {
      clearTimeout(this.seekDebounceTimer);
    }
    this.activeUsers.clear();
    this.cachedCues = [];
  }
}

class AutoCaptionManager {
  private transcribers: Map<string, RoomTranscriber> = new Map();

  public getOrCreate(
    io: Server,
    roomId: string,
    getVideoTS: () => number,
    getPaused: () => boolean,
  ): RoomTranscriber {
    let transcriber = this.transcribers.get(roomId);
    if (!transcriber) {
      transcriber = new RoomTranscriber(io, roomId, getVideoTS, getPaused);
      this.transcribers.set(roomId, transcriber);
    }
    return transcriber;
  }

  public remove(roomId: string) {
    const t = this.transcribers.get(roomId);
    if (t) {
      t.destroy();
      this.transcribers.delete(roomId);
    }
  }
}

export const autoCaptionManager = new AutoCaptionManager();
