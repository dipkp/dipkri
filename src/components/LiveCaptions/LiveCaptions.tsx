import React, { useEffect, useState, useRef, useCallback } from "react";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
} from "../PlayerSettings/playerSettings";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface LiveCaptionsProps {
  paused?: boolean;
  videoEl?: HTMLMediaElement | null;
  isYouTube?: boolean;
  roomSubtitle?: string;
  getYoutubeTime?: () => number;
}

/**
 * Parses timestamp string (HH:MM:SS,mmm or MM:SS.mmm) into seconds.
 */
function parseTimestamp(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Robust in-memory parser for both .srt and .vtt subtitle formats.
 * Works seamlessly across YouTube, Torrents, direct MP4, HLS, and mobile browsers.
 */
function parseSubtitleText(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  if (!content) return cues;
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split("-->");
    if (!startStr || !endStr) continue;

    const start = parseTimestamp(startStr.trim().split(" ")[0]);
    const end = parseTimestamp(endStr.trim().split(" ")[0]);
    const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l));
    const text = textLines.join(" ").replace(/<[^>]*>/g, "").trim();

    if (text && !isNaN(start) && !isNaN(end) && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/**
 * Keeps speech captions concise, readable, and strictly limited to 1-2 lines (max 6-8 words)
 * during continuous conversation so subtitles never grow into a giant paragraph.
 */
function formatRollingSpeech(finalText: string, interimText: string): string {
  const combined = interimText ? `${finalText} ${interimText}`.trim() : finalText.trim();
  if (!combined) return "";

  // 1. If sentence-ending punctuation exists (. ! ?), drop completed sentences
  const sentences = combined.split(/(?<=[.?!])\s+/).filter(Boolean);
  let active = sentences[sentences.length - 1] || combined;

  // 2. If the active clause is still long and has a comma, take the latest clause
  if (active.includes(",") && active.split(/\s+/).length > 7) {
    const clauses = active.split(/,\s+/).filter(Boolean);
    if (clauses.length > 1) {
      active = clauses[clauses.length - 1];
    }
  }

  // 3. Keep strictly the most recent 6 to 7 words for clean, cinematic subtitle delivery
  const words = active.split(/\s+/).filter(Boolean);
  if (words.length > 7) {
    active = words.slice(-6).join(" ");
  }

  return active;
}

export const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  paused = false,
  videoEl,
  isYouTube = false,
  roomSubtitle,
  getYoutubeTime,
}) => {
  const [enabled, setEnabled] = useState<boolean>(() => getPlayerSettings().liveCaptions);
  const [subtitleCue, setSubtitleCue] = useState<string>("");
  const [speechTranscript, setSpeechTranscript] = useState<string>("");
  const [interimSpeech, setInterimSpeech] = useState<string>("");

  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasErrorRef = useRef<boolean>(false);

  // Helper to reliably retrieve the current video element
  const getActiveVideo = useCallback((): HTMLMediaElement | null => {
    if (videoEl && videoEl.isConnected) return videoEl;
    if (typeof document !== "undefined") {
      return (document.getElementById("leftVideo") as HTMLMediaElement) || null;
    }
    return null;
  }, [videoEl]);

  // Sync with global player settings events (toggling live captions)
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.liveCaptions !== undefined) {
        setEnabled(detail.liveCaptions);
        if (!detail.liveCaptions) {
          setSubtitleCue("");
          setSpeechTranscript("");
          setInterimSpeech("");
        }
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Quick silence timer: fades speech subtitle cleanly after 1.4s of quiet
  const resetSpeechSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      setSpeechTranscript("");
      setInterimSpeech("");
    }, 1400);
  }, []);

  // --------------------------------------------------------------------------
  // Fetch and Parse Subtitles (.srt / .vtt) in Memory for High Reliability
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    parsedCuesRef.current = [];

    if (!roomSubtitle) {
      return;
    }

    const loadSubtitlesData = async () => {
      try {
        const resp = await fetch(roomSubtitle);
        if (!resp.ok) return;
        const text = await resp.text();
        if (!isCancelled) {
          parsedCuesRef.current = parseSubtitleText(text);
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
  // Zero-Delay Subtitle Sync Loop (YouTube + HTML5 Video)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setSubtitleCue("");
      return;
    }

    const syncSubtitles = () => {
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

      // 1. First check our parsed in-memory cues (fastest and works everywhere)
      if (parsedCuesRef.current.length > 0) {
        const matched = parsedCuesRef.current.find(
          (c) => currentTime >= c.start && currentTime <= c.end
        );
        if (matched) {
          setSubtitleCue(matched.text);
          return;
        }
      }

      // 2. Secondary check for HTML5 video textTracks (if attached natively)
      if (!isYouTube) {
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
                  texts.push(cue.text.replace(/<[^>]*>/g, "").trim());
                }
              }
              if (texts.length > 0) {
                setSubtitleCue(texts.join(" "));
                return;
              }
            }
          }
        }
      }

      // No cue at this exact second
      setSubtitleCue("");
    };

    // Run high-frequency sync loop for smooth subtitle presentation
    syncIntervalRef.current = setInterval(syncSubtitles, 120);

    const video = getActiveVideo();
    if (video && !isYouTube) {
      video.addEventListener("timeupdate", syncSubtitles);
    }

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (video && !isYouTube) {
        video.removeEventListener("timeupdate", syncSubtitles);
      }
    };
  }, [enabled, isYouTube, getYoutubeTime, getActiveVideo]);

  // --------------------------------------------------------------------------
  // Real-Time Speech Recognition (Audio English Captions)
  // Only runs when no attached subtitles exist, never on YouTube, and never shows errors
  // --------------------------------------------------------------------------
  const isSpeechSupported =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    // Never run microphone speech recognition on YouTube or when subtitles are attached or paused
    if (!enabled || !isSpeechSupported || isYouTube || paused) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      setSpeechTranscript("");
      setInterimSpeech("");
      return;
    }

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    let recognition: any = null;
    let isDisposed = false;

    try {
      recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        if (isDisposed) return;
        hasErrorRef.current = false;
      };

      recognition.onresult = (event: any) => {
        if (isDisposed) return;
        let finalChunk = "";
        let currentInterim = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalChunk += item[0].transcript;
          } else {
            currentInterim += item[0].transcript;
          }
        }

        if (finalChunk.trim()) {
          setSpeechTranscript((prev) => {
            const combined = `${prev} ${finalChunk.trim()}`.trim();
            const sentences = combined.split(/(?<=[.?!])\s+/).filter(Boolean);
            const active = sentences[sentences.length - 1] || combined;
            const words = active.split(/\s+/).filter(Boolean);
            if (words.length > 7) {
              return words.slice(-6).join(" ");
            }
            return active;
          });
        }

        setInterimSpeech(currentInterim.trim());
        resetSpeechSilenceTimer();
      };

      recognition.onerror = (_event: any) => {
        if (isDisposed) return;
        hasErrorRef.current = true;
        // Silent error handling: NEVER show error pills/popups in subtitle overlay
      };

      recognition.onend = () => {
        if (isDisposed) return;
        if (hasErrorRef.current) return;

        if (enabled && !paused && !isYouTube) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (!isDisposed && enabled && !paused && !hasErrorRef.current) {
              try {
                recognition.start();
              } catch {}
            }
          }, 400);
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
  }, [enabled, paused, isYouTube, isSpeechSupported, resetSpeechSilenceTimer]);

  if (!enabled) {
    return null;
  }

  // Format rolling speech during continuous conversations (strictly 6-7 words max)
  const rollingSpeech = formatRollingSpeech(speechTranscript, interimSpeech);
  const currentText = subtitleCue || rollingSpeech;

  // Subtitles only: render NOTHING when silent or between dialogue lines
  if (!currentText) {
    return null;
  }

  return (
    <div className={styles.captionsContainer}>
      <div className={styles.minimalSubtitle}>{currentText}</div>
    </div>
  );
};
