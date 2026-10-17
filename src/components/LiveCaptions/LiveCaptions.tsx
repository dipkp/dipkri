import React, { useEffect, useState, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
  CaptionSize,
  CaptionColor,
  CaptionStyle,
  CaptionPosition,
} from "../PlayerSettings/playerSettings";
import { audioEnhancer } from "../PlayerSettings/audioEnhancer";
import { cleanMovieTitle } from "../Modal/SubtitleModal";
import { serverPath } from "../../utils/utils";

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface LiveCaptionsProps {
  paused?: boolean;
  videoEl?: HTMLMediaElement | null;
  isYouTube?: boolean;
  roomSubtitle?: string;
  roomMedia?: string;
  isSubtitled?: boolean;
  getYoutubeTime?: () => number;
  socket?: Socket;
}

/**
 * Parses timestamp string (HH:MM:SS,mmm or MM:SS.mmm) into seconds with microsecond precision.
 */
function parseTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length === 3) {
    return (
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Robust in-memory parser for both .srt and .vtt subtitle formats.
 * Handles UTF-8 BOM, Windows/Unix line breaks, formatting tags, and entity codes.
 */
export function parseSubtitleText(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  if (!content) return cues;

  // Strip Byte Order Mark (BOM) if present
  const cleanedContent = content.replace(/^\uFEFF/, "");
  const normalized = cleanedContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n+/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split("-->");
    if (!startStr || !endStr) continue;

    const start = parseTimestamp(startStr.trim().split(" ")[0]);
    const end = parseTimestamp(endStr.trim().split(" ")[0]);
    const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l));
    const text = textLines
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/\{[^}]*\}/g, "")
      .replace(/&lrm;|&rlm;/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    if (text && !isNaN(start) && !isNaN(end) && end > start) {
      cues.push({ start, end, text });
    }
  }

  // Ensure cues are strictly sorted by start time for O(1)/O(log N) binary search
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Ultra-fast binary search to locate cue at the target timestamp in O(log N) time.
 */
function binarySearchCue(cues: SubtitleCue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (time >= cue.start && time <= cue.end) {
      return mid;
    }
    if (time < cue.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return -1;
}

/**
 * Sub-second word progression formatter.
 * Paces words across the cue duration so text flows in real time with the speaker's cadence.
 */
function formatProgressiveSpeech(cue: SubtitleCue, currentTime: number): string {
  const duration = cue.end - cue.start;
  if (duration <= 0.8) return cue.text;

  const words = cue.text.split(" ").filter(Boolean);
  if (words.length <= 3) return cue.text;

  // Fraction of spoken dialogue completed
  const elapsed = Math.max(0, currentTime - cue.start);
  const progress = Math.min(1, elapsed / duration);

  // Progressive word reveal: always reveal at least the first 2 words immediately,
  // then reveal remaining words as time advances
  const wordCount = Math.max(2, Math.ceil(progress * words.length));
  return words.slice(0, wordCount).join(" ");
}

/**
 * Map user captionLanguage setting to standard BCP-47 SpeechRecognition language tag.
 */
function getSpeechLangCode(lang: string): string {
  switch (lang) {
    case "hi":
      return "hi-IN";
    case "es":
      return "es-ES";
    case "fr":
      return "fr-FR";
    case "de":
      return "de-DE";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "zh":
      return "zh-CN";
    case "ar":
      return "ar-SA";
    case "pt":
      return "pt-BR";
    case "ru":
      return "ru-RU";
    case "it":
      return "it-IT";
    case "all":
    case "en":
    default:
      return "en-US";
  }
}

export const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  paused = false,
  videoEl,
  isYouTube = false,
  roomSubtitle,
  roomMedia,
  isSubtitled = false,
  getYoutubeTime,
  socket,
}) => {
  const [enabled, setEnabled] = useState<boolean>(
    () => getPlayerSettings().liveCaptions
  );
  const [captionLanguage, setCaptionLanguage] = useState<string>(
    () => getPlayerSettings().captionLanguage || "en"
  );
  const [captionSize, setCaptionSize] = useState<CaptionSize>(
    () => getPlayerSettings().captionSize || "medium"
  );
  const [captionColor, setCaptionColor] = useState<CaptionColor>(
    () => getPlayerSettings().captionColor || "white"
  );
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(
    () => getPlayerSettings().captionStyle || "shadow"
  );
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(
    () => getPlayerSettings().captionPosition || "bottom"
  );

  // Subtitle cue text rendered from .srt/.vtt or server cues
  const [activeText, setActiveText] = useState<string>("");

  // Live real-time speech recognized directly in client browser
  const [speechTranscript, setSpeechTranscript] = useState<string>("");
  const [interimSpeech, setInterimSpeech] = useState<string>("");

  // Transient notice status pill (auto-expires)
  const [syncStatus, setSyncStatus] = useState<string>("");

  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const lastCueIndexRef = useRef<number>(-1);
  const currentRenderedTextRef = useRef<string>("");
  const animFrameRef = useRef<number | null>(null);
  const autoSearchAttemptedRef = useRef<string>("");
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Client-side speech recognition references
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasErrorRef = useRef<boolean>(false);

  // Show notice helper that auto-clears after given milliseconds
  const showNotice = useCallback((msg: string, durationMs: number = 3000) => {
    setSyncStatus(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      setSyncStatus("");
    }, durationMs);
  }, []);

  // Subtitles / captions are active if either:
  // 1. A subtitle file exists in the room (uploaded .srt/.vtt or torrent file)
  // 2. The user has turned "Live Audio Transcribe: ON"
  // 3. The user has turned captions mode to "showing"
  const isFeatureActive = Boolean(enabled || roomSubtitle || isSubtitled);

  // Helper to reliably retrieve the current video element
  const getActiveVideo = useCallback((): HTMLMediaElement | null => {
    if (videoEl && videoEl.isConnected) return videoEl;
    if (typeof document !== "undefined") {
      return (document.getElementById("leftVideo") as HTMLMediaElement) || null;
    }
    return null;
  }, [videoEl]);

  // Sync with global player settings events (toggling live captions on/off, changing language, styling)
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.liveCaptions !== undefined) {
        setEnabled(detail.liveCaptions);
        hasErrorRef.current = false;
        if (!detail.liveCaptions && !roomSubtitle && !isSubtitled) {
          setActiveText("");
          setSpeechTranscript("");
          setInterimSpeech("");
          setSyncStatus("");
          currentRenderedTextRef.current = "";
          lastCueIndexRef.current = -1;
        } else if (detail.liveCaptions) {
          showNotice("Live Captions: Active", 2500);
        }
      }
      if (detail && detail.captionLanguage !== undefined) {
        setCaptionLanguage((prev) => {
          if (prev !== detail.captionLanguage) {
            parsedCuesRef.current = [];
            lastCueIndexRef.current = -1;
            autoSearchAttemptedRef.current = "";
            setActiveText("");
            setSpeechTranscript("");
            setInterimSpeech("");
            currentRenderedTextRef.current = "";
            hasErrorRef.current = false;
            return detail.captionLanguage;
          }
          return prev;
        });
      }
      if (detail && detail.captionSize !== undefined) {
        setCaptionSize(detail.captionSize);
      }
      if (detail && detail.captionColor !== undefined) {
        setCaptionColor(detail.captionColor);
      }
      if (detail && detail.captionStyle !== undefined) {
        setCaptionStyle(detail.captionStyle);
      }
      if (detail && detail.captionPosition !== undefined) {
        setCaptionPosition(detail.captionPosition);
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(
        PLAYER_SETTINGS_CHANGED_EVENT,
        handleSettingsChange
      );
    };
  }, [roomSubtitle, isSubtitled, showNotice]);

  // --------------------------------------------------------------------------
  // Client-Side Real-Time Browser Speech Recognition (100% Free, Zero Server CPU)
  // --------------------------------------------------------------------------
  const resetSpeechSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      setSpeechTranscript("");
      setInterimSpeech("");
    }, 3200);
  }, []);

  useEffect(() => {
    const SpeechRecognitionClass =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!enabled || paused) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      return;
    }

    if (!SpeechRecognitionClass) {
      // Speech recognition not natively available in this browser (e.g. Firefox desktop)
      if (parsedCuesRef.current.length === 0 && !roomSubtitle) {
        showNotice("Browser speech recognition requires Chrome, Edge, Brave, or Safari", 4000);
      }
      return;
    }

    let isDisposed = false;
    let recognition: any = null;

    try {
      recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = getSpeechLangCode(captionLanguage);
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        if (isDisposed) return;
        let currentInterim = "";
        let finalChunk = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript;
          } else {
            currentInterim += res[0].transcript;
          }
        }

        if (finalChunk.trim()) {
          setSpeechTranscript((prev) => {
            const combined = `${prev} ${finalChunk.trim()}`.trim();
            const words = combined.split(" ");
            // Keep clean 1-2 line subtitle length (latest 8 to 10 words)
            if (words.length > 10) {
              return words.slice(-8).join(" ");
            }
            return combined;
          });
        }

        setInterimSpeech(currentInterim.trim());
        resetSpeechSilenceTimer();
      };

      recognition.onerror = (event: any) => {
        if (isDisposed) return;
        const err = event.error;
        if (err === "no-speech" || err === "aborted") {
          return;
        }
        if (err === "not-allowed" || err === "service-not-allowed") {
          hasErrorRef.current = true;
        }
      };

      recognition.onend = () => {
        if (isDisposed) return;
        if (hasErrorRef.current) return;

        // Clean automatic restart when still playing
        if (enabled && !paused) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (!isDisposed && enabled && !paused && !hasErrorRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          }, 300);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      hasErrorRef.current = true;
    }

    return () => {
      isDisposed = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognition) {
        try {
          recognition.abort();
        } catch {}
      }
      recognitionRef.current = null;
    };
  }, [enabled, paused, captionLanguage, resetSpeechSilenceTimer, showNotice, roomSubtitle]);

  // --------------------------------------------------------------------------
  // Socket-backed Lookahead Auto-Caption Worker (Server Groq Worker & Cache)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const handleAutoCaptions = (newCues: SubtitleCue[]) => {
      if (!Array.isArray(newCues) || newCues.length === 0) return;
      for (const cue of newCues) {
        const exists = parsedCuesRef.current.some(
          (c) => Math.abs(c.start - cue.start) < 0.25,
        );
        if (!exists) {
          parsedCuesRef.current.push(cue);
        }
      }
      parsedCuesRef.current.sort((a, b) => a.start - b.start);
      setSyncStatus("");
    };

    const handleClearAutoCaptions = () => {
      parsedCuesRef.current = [];
      lastCueIndexRef.current = -1;
      setActiveText("");
      currentRenderedTextRef.current = "";
    };

    const handleNotice = (notice: { type: string; message: string }) => {
      if (notice?.message) {
        showNotice(notice.message, 4000);
      }
    };

    socket.on("REC:autoCaptions", handleAutoCaptions);
    socket.on("REC:clearAutoCaptions", handleClearAutoCaptions);
    socket.on("REC:autoCaptionNotice", handleNotice);

    // If Live Captions is active, request server worker if available
    if (enabled && !roomSubtitle) {
      socket.emit("CMD:startAutoCaption", { lang: captionLanguage });
    }

    return () => {
      socket.off("REC:autoCaptions", handleAutoCaptions);
      socket.off("REC:clearAutoCaptions", handleClearAutoCaptions);
      socket.off("REC:autoCaptionNotice", handleNotice);
      socket.emit("CMD:stopAutoCaption");
    };
  }, [socket, enabled, roomSubtitle, captionLanguage, showNotice]);

  // --------------------------------------------------------------------------
  // Ingest Subtitles (.srt / .vtt) from roomSubtitle (e.g. Uploaded Subtitle)
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    parsedCuesRef.current = [];
    lastCueIndexRef.current = -1;

    if (!roomSubtitle) {
      return;
    }

    const loadSubtitlesData = async () => {
      try {
        const resp = await fetch(roomSubtitle);
        if (!resp.ok) return;
        const text = await resp.text();
        if (!isCancelled) {
          const cues = parseSubtitleText(text);
          if (cues.length > 0) {
            parsedCuesRef.current = cues;
            setSyncStatus("");
          }
        }
      } catch (err) {
        console.warn("[LiveCaptions] Subtitle fetch warning:", err);
      }
    };

    loadSubtitlesData();

    return () => {
      isCancelled = true;
    };
  }, [roomSubtitle]);

  // --------------------------------------------------------------------------
  // Auto-Detect & Auto-Search Subtitles for Magnet Links & Torrent Streams
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || roomSubtitle || !roomMedia) return;
    const searchKey = `${roomMedia}__${captionLanguage}`;
    if (autoSearchAttemptedRef.current === searchKey) return;
    autoSearchAttemptedRef.current = searchKey;

    let isDisposed = false;
    const cleanTitle = cleanMovieTitle(roomMedia);

    const autoDiscoverSubtitles = async () => {
      // If torrent or magnet stream, check /data?torrent=... for internal subtitle files
      if (roomMedia.includes("/stream?torrent=") || roomMedia.startsWith("magnet:")) {
        const dataUrl = roomMedia.includes("/stream?")
          ? roomMedia.replace("/stream?", "/data?")
          : `${serverPath}/data?torrent=${encodeURIComponent(roomMedia)}`;

        showNotice(`Syncing dialogue stream for "${cleanTitle || "Movie"}"...`, 3500);

        for (let i = 0; i < 4; i++) {
          if (isDisposed || parsedCuesRef.current.length > 0) return;
          try {
            const resp = await fetch(dataUrl);
            if (resp.ok) {
              const meta = await resp.json();
              if (meta?.files && Array.isArray(meta.files)) {
                const subFiles = meta.files.filter((f: any) =>
                  f.name?.toLowerCase().endsWith(".srt") || f.name?.toLowerCase().endsWith(".vtt")
                );
                if (subFiles.length > 0) {
                  let subFile = null;
                  if (captionLanguage === "hi") {
                    subFile = subFiles.find((f: any) => /hindi|hin|\.hi\./i.test(f.name));
                  } else if (captionLanguage === "es") {
                    subFile = subFiles.find((f: any) => /spanish|spa|\.es\./i.test(f.name));
                  } else if (captionLanguage === "en") {
                    subFile = subFiles.find((f: any) => /english|eng|\.en\./i.test(f.name));
                  }
                  if (!subFile) {
                    subFile = subFiles[0];
                  }

                  if (subFile) {
                    const base = roomMedia.includes("&fileIndex=")
                      ? roomMedia.split("&fileIndex=")[0]
                      : roomMedia;
                    const subUrl = `${base}&fileIndex=${subFile.index}`;
                    const sResp = await fetch(subUrl);
                    if (sResp.ok) {
                      const sText = await sResp.text();
                      const cues = parseSubtitleText(sText);
                      if (cues.length > 0 && !isDisposed) {
                        parsedCuesRef.current = cues;
                        setSyncStatus("");
                        return;
                      }
                    }
                  }
                }
              }
              if (meta?.name) break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    };

    autoDiscoverSubtitles();

    return () => {
      isDisposed = true;
    };
  }, [enabled, roomSubtitle, roomMedia, captionLanguage, showNotice]);

  // --------------------------------------------------------------------------
  // Auto-Scan Native HTMLMediaElement TextTracks & HLS.js Embedded Cues
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isFeatureActive || isYouTube) return;

    const video = getActiveVideo();
    if (!video) return;

    // Attach Web Audio nodes lazily to the video source
    audioEnhancer.attachToElement(video);

    const scanTracks = () => {
      if (parsedCuesRef.current.length > 0) return; // Already have active cues

      // 1. Scan native HTMLMediaElement textTracks prioritizing captionLanguage
      if (video.textTracks && video.textTracks.length > 0) {
        let chosenTrackIdx = -1;
        if (captionLanguage === "hi") {
          chosenTrackIdx = Array.from({ length: video.textTracks.length }).findIndex((_, idx) => {
            const t = video.textTracks[idx];
            const l = ((t.language || "") + " " + (t.label || "")).toLowerCase();
            return l.includes("hi") || l.includes("hin");
          });
        } else if (captionLanguage === "es") {
          chosenTrackIdx = Array.from({ length: video.textTracks.length }).findIndex((_, idx) => {
            const t = video.textTracks[idx];
            const l = ((t.language || "") + " " + (t.label || "")).toLowerCase();
            return l.includes("es") || l.includes("spa");
          });
        } else if (captionLanguage === "en") {
          chosenTrackIdx = Array.from({ length: video.textTracks.length }).findIndex((_, idx) => {
            const t = video.textTracks[idx];
            const l = ((t.language || "") + " " + (t.label || "")).toLowerCase();
            return l.includes("en") || l.includes("eng");
          });
        }

        const order =
          chosenTrackIdx !== -1
            ? [
                chosenTrackIdx,
                ...Array.from({ length: video.textTracks.length }, (_, i) => i).filter(
                  (i) => i !== chosenTrackIdx,
                ),
              ]
            : Array.from({ length: video.textTracks.length }, (_, i) => i);

        for (const i of order) {
          const track = video.textTracks[i];
          if (track.mode === "disabled") {
            track.mode = "hidden";
          }
          if (track.cues && track.cues.length > 0) {
            const nativeCues: SubtitleCue[] = [];
            for (let c = 0; c < track.cues.length; c++) {
              const cue = track.cues[c] as any;
              if (cue && typeof cue.startTime === "number" && cue.text) {
                nativeCues.push({
                  start: cue.startTime,
                  end: cue.endTime,
                  text: cue.text
                    .replace(/<[^>]*>/g, "")
                    .replace(/\{[^}]*\}/g, "")
                    .trim(),
                });
              }
            }
            if (nativeCues.length > 0) {
              parsedCuesRef.current = nativeCues.sort((a, b) => a.start - b.start);
              lastCueIndexRef.current = -1;
              setSyncStatus("");
              return;
            }
          }
        }
      }

      // 2. Scan HLS.js embedded subtitle tracks (for m3u8 streams)
      const hls = (window as any).watchparty?.hls;
      if (hls && hls.subtitleTracks && hls.subtitleTracks.length > 0) {
        let matchingHlsTrack = -1;
        if (captionLanguage === "hi") {
          matchingHlsTrack = hls.subtitleTracks.findIndex((t: any) =>
            (t.lang || t.name || "").toLowerCase().includes("hi")
          );
        } else if (captionLanguage === "es") {
          matchingHlsTrack = hls.subtitleTracks.findIndex((t: any) =>
            (t.lang || t.name || "").toLowerCase().includes("es") ||
            (t.lang || t.name || "").toLowerCase().includes("spa")
          );
        } else if (captionLanguage === "en") {
          matchingHlsTrack = hls.subtitleTracks.findIndex((t: any) =>
            (t.lang || t.name || "").toLowerCase().includes("en")
          );
        }
        if (matchingHlsTrack !== -1) {
          hls.subtitleTrack = matchingHlsTrack;
        } else if (hls.subtitleTrack === -1) {
          hls.subtitleTrack = 0;
        }
      }
    };

    scanTracks();
    video.addEventListener("loadedmetadata", scanTracks);
    video.addEventListener("canplay", scanTracks);

    if (video.textTracks) {
      video.textTracks.addEventListener("addtrack", scanTracks);
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].addEventListener("cuechange", scanTracks);
      }
    }

    return () => {
      video.removeEventListener("loadedmetadata", scanTracks);
      video.removeEventListener("canplay", scanTracks);
      if (video.textTracks) {
        video.textTracks.removeEventListener("addtrack", scanTracks);
      }
    };
  }, [isFeatureActive, isYouTube, getActiveVideo, captionLanguage]);

  // --------------------------------------------------------------------------
  // Ultra-Low Latency Zero-Gap (~0.03s) 60fps/120fps Synchronized Subtitle Render Loop
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isFeatureActive) {
      setActiveText("");
      currentRenderedTextRef.current = "";
      return;
    }

    let isMounted = true;

    const renderLoop = () => {
      if (!isMounted) return;

      if (!paused) {
        let currentTime = 0;
        if (isYouTube && getYoutubeTime) {
          try {
            currentTime = getYoutubeTime();
          } catch {
            currentTime = 0;
          }
        } else {
          const video = getActiveVideo();
          if (video) {
            currentTime = video.currentTime;
          }
        }

        // High-precision 30ms (0.030s) acoustic onset lead compensation
        const syncTime = currentTime + 0.030;

        let matchedText = "";
        const cues = parsedCuesRef.current;

        if (cues.length > 0) {
          const lastIdx = lastCueIndexRef.current;
          let activeIdx = -1;

          if (
            lastIdx >= 0 &&
            lastIdx < cues.length &&
            syncTime >= cues[lastIdx].start &&
            syncTime <= cues[lastIdx].end
          ) {
            activeIdx = lastIdx;
          } else if (
            lastIdx + 1 < cues.length &&
            syncTime >= cues[lastIdx + 1].start &&
            syncTime <= cues[lastIdx + 1].end
          ) {
            activeIdx = lastIdx + 1;
            lastCueIndexRef.current = activeIdx;
          } else {
            activeIdx = binarySearchCue(cues, syncTime);
            if (activeIdx !== -1) {
              lastCueIndexRef.current = activeIdx;
            }
          }

          if (activeIdx !== -1) {
            const cue = cues[activeIdx];
            matchedText = formatProgressiveSpeech(cue, syncTime);
          }
        }

        // Secondary check on active textTracks from native video
        if (!matchedText && !isYouTube) {
          const video = getActiveVideo();
          if (video && video.textTracks && video.textTracks.length > 0) {
            for (let i = 0; i < video.textTracks.length; i++) {
              const track = video.textTracks[i];
              if (track.mode === "disabled") continue;
              if (track.activeCues && track.activeCues.length > 0) {
                const texts: string[] = [];
                for (let c = 0; c < track.activeCues.length; c++) {
                  const cue = track.activeCues[c] as any;
                  if (cue?.text) {
                    texts.push(
                      cue.text
                        .replace(/<[^>]*>/g, "")
                        .replace(/\{[^}]*\}/g, "")
                        .replace(/&lrm;|&rlm;/g, "")
                        .trim()
                    );
                  }
                }
                if (texts.length > 0) {
                  matchedText = texts.join(" ");
                  break;
                }
              }
            }
          }
        }

        if (matchedText !== currentRenderedTextRef.current) {
          currentRenderedTextRef.current = matchedText;
          setActiveText(matchedText);
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isFeatureActive, paused, isYouTube, getYoutubeTime, getActiveVideo]);

  if (!isFeatureActive) {
    return null;
  }

  // Precedence: Subtitle cue text > Client speech transcript & interim speech
  const speechText = speechTranscript
    ? `${speechTranscript} ${interimSpeech}`.trim()
    : interimSpeech;

  const currentDisplaySubtitle = activeText || speechText;

  const sizeClass =
    captionSize === "small"
      ? styles.sizeSmall
      : captionSize === "large"
        ? styles.sizeLarge
        : styles.sizeMedium;

  const colorClass =
    captionColor === "yellow"
      ? styles.colorYellow
      : captionColor === "cyan"
        ? styles.colorCyan
        : captionColor === "green"
          ? styles.colorGreen
          : styles.colorWhite;

  const styleClass =
    captionStyle === "box"
      ? styles.styleBox
      : captionStyle === "outline"
        ? styles.styleOutline
        : styles.styleShadow;

  const posClass = captionPosition === "top" ? styles.positionTop : "";

  // 1. Render active live dialogue caption or recognized speech
  if (currentDisplaySubtitle) {
    return (
      <div className={`${styles.captionsContainer} ${posClass}`}>
        <div
          className={`${styles.minimalSubtitle} ${sizeClass} ${colorClass} ${styleClass}`}
        >
          {currentDisplaySubtitle}
        </div>
      </div>
    );
  }

  // 2. Render sync status notice pill only when present
  if (enabled && syncStatus && !currentDisplaySubtitle) {
    return (
      <div className={`${styles.captionsContainer} ${posClass}`}>
        <div className={styles.noticePill}>{syncStatus}</div>
      </div>
    );
  }

  return null;
};
