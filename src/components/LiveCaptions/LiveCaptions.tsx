import React, { useEffect, useState, useRef, useCallback } from "react";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
} from "../PlayerSettings/playerSettings";

interface LiveCaptionsProps {
  paused?: boolean;
  videoEl?: HTMLMediaElement | null;
  isYouTube?: boolean;
}

/**
 * Keeps speech captions concise, readable, and strictly limited to 1-2 lines (max 6-8 words)
 * during continuous conversation so subtitles never grow into a giant paragraph.
 */
function formatRollingSpeech(finalText: string, interimText: string): string {
  const combined = interimText ? `${finalText} ${interimText}`.trim() : finalText.trim();
  if (!combined) return "";

  // 1. If sentence-ending punctuation exists (. ! ?), drop completed sentences
  // and focus exclusively on the active incoming sentence/clause!
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
}) => {
  const [enabled, setEnabled] = useState<boolean>(() => getPlayerSettings().liveCaptions);
  const [subtitleCue, setSubtitleCue] = useState<string>("");
  const [speechTranscript, setSpeechTranscript] = useState<string>("");
  const [interimSpeech, setInterimSpeech] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasErrorRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);

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
          setNotice("");
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
  // Attached Subtitle / TextTracks Instant Sync (Zero Gap / Zero Delay)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setSubtitleCue("");
      return;
    }

    const checkCues = () => {
      const video = getActiveVideo();
      if (!video || !video.textTracks || video.textTracks.length === 0) {
        setSubtitleCue("");
        return;
      }

      const currentTime = video.currentTime;
      let matchedText = "";

      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.mode === "disabled") continue;

        // 1. Direct activeCues check
        if (track.activeCues && track.activeCues.length > 0) {
          const texts: string[] = [];
          for (let c = 0; c < track.activeCues.length; c++) {
            const cue = track.activeCues[c] as any;
            if (cue?.text) {
              texts.push(cue.text.replace(/<[^>]*>/g, "").trim());
            }
          }
          if (texts.length > 0) {
            matchedText = texts.join(" ");
            break;
          }
        }

        // 2. Direct time range verification fallback
        if (!matchedText && track.cues && track.cues.length > 0) {
          for (let c = 0; c < track.cues.length; c++) {
            const cue = track.cues[c] as any;
            if (cue && currentTime >= cue.startTime && currentTime <= cue.endTime) {
              if (cue.text) {
                matchedText = cue.text.replace(/<[^>]*>/g, "").trim();
                break;
              }
            }
          }
          if (matchedText) break;
        }
      }

      // Keep subtitle cues strictly to at most 2 clean lines
      if (matchedText) {
        const lines = matchedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        matchedText = lines.slice(-2).join("\n");
      }

      setSubtitleCue(matchedText);
    };

    const video = getActiveVideo();
    if (!video) return;

    checkCues();

    video.addEventListener("timeupdate", checkCues);
    video.addEventListener("seeked", checkCues);
    video.addEventListener("seeking", checkCues);
    video.addEventListener("play", checkCues);
    video.addEventListener("pause", checkCues);
    video.addEventListener("ratechange", checkCues);

    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].addEventListener("cuechange", checkCues);
    }

    const handleAddTrack = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].removeEventListener("cuechange", checkCues);
        video.textTracks[i].addEventListener("cuechange", checkCues);
      }
      checkCues();
    };

    if (video.textTracks.addEventListener) {
      video.textTracks.addEventListener("addtrack", handleAddTrack);
    }

    return () => {
      if (video) {
        video.removeEventListener("timeupdate", checkCues);
        video.removeEventListener("seeked", checkCues);
        video.removeEventListener("seeking", checkCues);
        video.removeEventListener("play", checkCues);
        video.removeEventListener("pause", checkCues);
        video.removeEventListener("ratechange", checkCues);

        if (video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].removeEventListener("cuechange", checkCues);
          }
          if (video.textTracks.removeEventListener) {
            video.textTracks.removeEventListener("addtrack", handleAddTrack);
          }
        }
      }
    };
  }, [enabled, getActiveVideo]);

  // --------------------------------------------------------------------------
  // Real-Time Speech Recognition (Audio English Captions)
  // --------------------------------------------------------------------------
  const isSpeechSupported =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (!enabled || !isSpeechSupported) {
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

    if (paused) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
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
            // Drop completed sentences so continuous speech doesn't accumulate
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

      recognition.onerror = (event: any) => {
        if (isDisposed) return;
        const err = event.error;
        if (err === "no-speech" || err === "aborted") {
          return;
        }
        hasErrorRef.current = true;
        if (err === "network") {
          // If video already has subtitle tracks, don't show network speech warning
          if (!subtitleCue) {
            if (retryCountRef.current < 2) {
              retryCountRef.current += 1;
              setTimeout(() => {
                if (!isDisposed && enabled && !paused) {
                  hasErrorRef.current = false;
                  try {
                    recognition.start();
                  } catch {}
                }
              }, 4000);
            } else {
              setNotice("Speech server unreachable. Try attached subtitles or allow mic in browser.");
              setTimeout(() => {
                if (!isDisposed) setNotice("");
              }, 5000);
            }
          }
        } else if (err === "not-allowed") {
          setNotice("Microphone permission required for speech captions.");
          setTimeout(() => {
            if (!isDisposed) setNotice("");
          }, 5000);
        }
      };

      recognition.onend = () => {
        if (isDisposed) return;
        if (hasErrorRef.current) return;

        // Restart cleanly when video is still playing
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
    };
  }, [enabled, paused, isSpeechSupported, resetSpeechSilenceTimer, subtitleCue]);

  if (!enabled) {
    return null;
  }

  // Format rolling speech during continuous conversations (strictly 6-7 words max)
  const rollingSpeech = formatRollingSpeech(speechTranscript, interimSpeech);
  const currentText = subtitleCue || rollingSpeech;

  // Subtitles only: render NOTHING when silent or between dialogue lines
  if (!currentText && !notice) {
    return null;
  }

  return (
    <div className={styles.captionsContainer}>
      {currentText ? (
        <div className={styles.minimalSubtitle}>{currentText}</div>
      ) : notice ? (
        <div className={styles.noticePill}>{notice}</div>
      ) : null}
    </div>
  );
};
