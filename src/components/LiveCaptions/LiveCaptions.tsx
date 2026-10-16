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
    const text = textLines
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/\{[^}]*\}/g, "")
      .replace(/&lrm;|&rlm;/g, "")
      .trim();

    if (text && !isNaN(start) && !isNaN(end) && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/**
 * Real-time fast speech stream formatter.
 * Transcribes live incoming audio with ultra-low latency,
 * keeping text strictly to 5-7 words so it stays synchronized with the speaker.
 */
function formatLiveSpeech(finalText: string, interimText: string): string {
  const active = interimText.trim() || finalText.trim();
  if (!active) return "";

  const cleaned = active
    .replace(/<[^>]*>/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/&lrm;|&rlm;/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // If punctuation exists, focus on active clause
  const clauses = cleaned.split(/(?<=[.?!,])\s+/).filter(Boolean);
  const latest = clauses[clauses.length - 1] || cleaned;

  const words = latest.split(" ").filter(Boolean);
  if (words.length > 7) {
    return words.slice(-6).join(" ");
  }
  return latest;
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

  // Quick silence timer: fades speech subtitle cleanly after 1s of quiet
  const resetSpeechSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      setSpeechTranscript("");
      setInterimSpeech("");
    }, 1000);
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
    syncIntervalRef.current = setInterval(syncSubtitles, 80);

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
  // Real-Time High-Speed Speech Recognition (Mic / Audio Transcribe)
  // Low-latency, unbroken auto-restart, and zero error banners
  // --------------------------------------------------------------------------
  const isSpeechSupported =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (!enabled || !isSpeechSupported || paused) {
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

    const startRecognition = () => {
      if (isDisposed) return;
      try {
        recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = "en-US";

        recognition.onstart = () => {
          if (isDisposed) return;
        };

        recognition.onresult = (event: any) => {
          if (isDisposed) return;
          let latestFinal = "";
          let latestInterim = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const item = event.results[i];
            if (item.isFinal) {
              latestFinal = item[0].transcript;
            } else {
              latestInterim += item[0].transcript;
            }
          }

          if (latestFinal.trim()) {
            setSpeechTranscript(latestFinal.trim());
          }
          setInterimSpeech(latestInterim.trim());
          resetSpeechSilenceTimer();
        };

        recognition.onerror = (event: any) => {
          if (isDisposed) return;
          const err = event?.error;
          // "no-speech" and "aborted" are standard lifecycle events, not fatal errors
          if (err === "no-speech" || err === "aborted") {
            return;
          }
          // On transient network or audio capture glitches, retry in 800ms
          setTimeout(() => {
            if (!isDisposed && enabled && !paused) {
              try {
                recognition?.start();
              } catch {}
            }
          }, 800);
        };

        recognition.onend = () => {
          if (isDisposed) return;
          // Lightning-fast restart within 60ms for unbroken live audio transcription
          if (enabled && !paused) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (!isDisposed && enabled && !paused) {
                try {
                  recognition?.start();
                } catch {}
              }
            }, 60);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        setTimeout(() => {
          if (!isDisposed && enabled && !paused) {
            startRecognition();
          }
        }, 1000);
      }
    };

    // Ensure audio permission is active for speech recognition
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
          startRecognition();
        })
        .catch(() => {
          startRecognition();
        });
    } else {
      startRecognition();
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
  }, [enabled, paused, isSpeechSupported, resetSpeechSilenceTimer]);

  if (!enabled) {
    return null;
  }

  // Format real-time live speech with low latency
  const liveSpeech = formatLiveSpeech(speechTranscript, interimSpeech);
  const currentText = subtitleCue || liveSpeech;

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
