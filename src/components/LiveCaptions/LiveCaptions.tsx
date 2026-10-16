import React, { useEffect, useState, useRef, useCallback } from "react";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  setPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
} from "../PlayerSettings/playerSettings";
import { WPIconClose, WPIconCaptions, WPIconSync } from "../Icons/CustomIcons";

interface LiveCaptionsProps {
  paused?: boolean;
  videoEl?: HTMLMediaElement | null;
  isYouTube?: boolean;
}

export const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  paused = false,
  videoEl,
  isYouTube,
}) => {
  const [enabled, setEnabled] = useState<boolean>(() => getPlayerSettings().liveCaptions);
  const [transcript, setTranscript] = useState<string>("");
  const [interim, setInterim] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"network" | "permission" | "device" | "service" | null>(null);
  const [positionOffset, setPositionOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [retryKey, setRetryKey] = useState<number>(0);

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasErrorRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });

  // Check Web Speech API support
  const isSpeechSupported =
    typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Sync with global player settings events
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.liveCaptions !== undefined) {
        setEnabled(detail.liveCaptions);
        if (detail.liveCaptions) {
          hasErrorRef.current = false;
          setErrorMsg(null);
          setErrorType(null);
        }
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Reset silence timer: clear captions after 3.8 seconds of silence
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      setTranscript("");
      setInterim("");
    }, 3800);
  }, []);

  // Subtitle track fallback: if video has active subtitle cues, mirror them in the caption card
  useEffect(() => {
    if (!videoEl || !videoEl.textTracks) return;

    const handleCueChange = () => {
      for (let i = 0; i < videoEl.textTracks.length; i++) {
        const track = videoEl.textTracks[i];
        if (track.mode === "showing" && track.activeCues && track.activeCues.length > 0) {
          const cue = track.activeCues[0] as any;
          if (cue?.text) {
            setTranscript(cue.text);
            setInterim("");
            resetSilenceTimer();
            return;
          }
        }
      }
    };

    for (let i = 0; i < videoEl.textTracks.length; i++) {
      videoEl.textTracks[i].addEventListener("cuechange", handleCueChange);
    }

    return () => {
      if (videoEl && videoEl.textTracks) {
        for (let i = 0; i < videoEl.textTracks.length; i++) {
          videoEl.textTracks[i].removeEventListener("cuechange", handleCueChange);
        }
      }
    };
  }, [videoEl, resetSilenceTimer]);

  // Request mic permission cleanly if needed
  const requestAudioPermission = async () => {
    try {
      if (navigator?.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the tracks immediately after permission check
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.warn("Audio permission check:", e);
    }
  };

  // Safe retry handler
  const handleRetry = async () => {
    hasErrorRef.current = false;
    setErrorMsg(null);
    setErrorType(null);
    await requestAudioPermission();
    setRetryKey((k) => k + 1);
  };

  // Initialize and control SpeechRecognition
  useEffect(() => {
    if (!enabled || !isSpeechSupported) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
      setIsListening(false);
      setTranscript("");
      setInterim("");
      setErrorMsg(null);
      setErrorType(null);
      return;
    }

    if (paused) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
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
      recognition.lang = "en-US"; // English only audio captions

      recognition.onstart = () => {
        if (isDisposed) return;
        setIsListening(true);
        hasErrorRef.current = false;
        setErrorMsg(null);
        setErrorType(null);
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
          setTranscript((prev) => {
            const combined = `${prev} ${finalChunk.trim()}`.trim();
            const words = combined.split(" ");
            if (words.length > 18) {
              return words.slice(-16).join(" ");
            }
            return combined;
          });
        }

        setInterim(currentInterim.trim());
        resetSilenceTimer();
      };

      recognition.onerror = (event: any) => {
        if (isDisposed) return;
        console.warn("SpeechRecognition event error:", event.error);
        const err = event.error;

        if (err === "no-speech") {
          // Harmless timeout when silent; do NOT treat as fatal
          return;
        }

        if (err === "aborted") {
          // Normal manual stop or unmount
          return;
        }

        // Set error state and prevent infinite restart loop
        hasErrorRef.current = true;
        setIsListening(false);

        if (err === "network") {
          setErrorType("network");
          setErrorMsg("Speech recognition server connection issue. Please check internet or click Retry.");
        } else if (err === "not-allowed") {
          setErrorType("permission");
          setErrorMsg("Microphone permission required for audio capture. Please allow access in browser URL bar.");
        } else if (err === "audio-capture") {
          setErrorType("device");
          setErrorMsg("No microphone or audio input hardware detected on your device.");
        } else if (err === "service-not-allowed") {
          setErrorType("service");
          setErrorMsg("Speech service restricted by browser policy or network firewall.");
        } else {
          setErrorType("service");
          setErrorMsg(`Live Captions service notice: ${err}`);
        }
      };

      recognition.onend = () => {
        if (isDisposed) return;
        setIsListening(false);

        // DO NOT restart if there was a fatal/network error to prevent infinite error loops!
        if (hasErrorRef.current) {
          return;
        }

        // Only restart if still enabled, not paused, and no errors occurred
        if (enabled && !paused) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (!isDisposed && enabled && !paused && !hasErrorRef.current) {
              try {
                recognition.start();
              } catch (e) {
                console.warn("SpeechRecognition safe restart note:", e);
              }
            }
          }, 350);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err: any) {
      console.warn("Failed to initialize SpeechRecognition:", err);
      hasErrorRef.current = true;
      setErrorType("service");
      setErrorMsg("Unable to start browser Speech Recognition service.");
    }

    return () => {
      isDisposed = true;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      if (recognition) {
        try {
          recognition.abort();
        } catch {}
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [enabled, paused, isSpeechSupported, resetSilenceTimer, retryKey]);

  // Drag-to-reposition logic
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: positionOffset.x,
      initY: positionOffset.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.startX;
      const dy = moveEvent.clientY - dragStartRef.current.startY;
      setPositionOffset({
        x: dragStartRef.current.initX + dx,
        y: dragStartRef.current.initY + dy,
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!enabled) {
    return null;
  }

  const displayText = transcript || interim;

  return (
    <div
      className={styles.captionsWrapper}
      style={{
        transform: `translate(calc(-50% + ${positionOffset.x}px), ${positionOffset.y}px)`,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={styles.captionCard}>
        <div className={styles.headerRow}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={styles.liveBadge}>
              <span className={styles.pulseDot} />
              LIVE [EN]
            </span>
            <span className={styles.listeningLabel}>
              {paused
                ? "Video Paused"
                : errorMsg
                ? "Notice"
                : isListening
                ? "Transcribing English Audio..."
                : "Connecting..."}
            </span>
          </div>
          <div className={styles.actionsGroup}>
            <button
              className={styles.closeButton}
              onClick={() => setPlayerSettings({ liveCaptions: false })}
              title="Close Live Captions"
            >
              <WPIconClose size={15} />
            </button>
          </div>
        </div>

        {errorMsg ? (
          <div className={styles.errorRow}>
            <div className={styles.warningBox}>
              <span>⚠️ {errorMsg}</span>
            </div>
            <button
              className={styles.retryButton}
              onClick={handleRetry}
              title="Retry Live Captions"
            >
              Retry
            </button>
          </div>
        ) : !isSpeechSupported ? (
          <div className={styles.warningBox}>
            <span>Live Captions require Chrome, Edge, Brave, or Safari.</span>
          </div>
        ) : displayText ? (
          <div className={styles.captionText}>
            {transcript && <span>{transcript} </span>}
            {interim && <span className={styles.interimText}>{interim}</span>}
          </div>
        ) : (
          <div className={styles.placeholderText}>
            {paused
              ? "Captions will resume when video plays."
              : "Listening for English speech in audio..."}
          </div>
        )}
      </div>
    </div>
  );
};
