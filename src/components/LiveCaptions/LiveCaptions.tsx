import React, { useEffect, useState, useRef, useCallback } from "react";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  setPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
} from "../PlayerSettings/playerSettings";
import { WPIconClose, WPIconCaptions } from "../Icons/CustomIcons";

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
  const [positionOffset, setPositionOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
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
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Reset silence timer: clear captions after 3.5 seconds of silence
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      setTranscript("");
      setInterim("");
    }, 3800);
  }, []);

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
      return;
    }

    if (paused) {
      // Pause speech recognition while video is paused
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

    let recognition: any;
    try {
      recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = "en-US"; // English only audio captions

      recognition.onstart = () => {
        setIsListening(true);
        setErrorMsg(null);
      };

      recognition.onresult = (event: any) => {
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
            // Keep the last 15-20 words for clean closed caption display
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
        console.warn("SpeechRecognition event error:", event.error);
        if (event.error === "not-allowed") {
          setErrorMsg("Audio input access required. Click to enable mic/loopback.");
          setIsListening(false);
        } else if (event.error === "network") {
          // Retry automatically after network hiccup
          setTimeout(() => {
            if (enabled && !paused) {
              try {
                recognition.start();
              } catch {}
            }
          }, 1000);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        // If enabled and still watching, automatically keep listening
        if (enabled && !paused) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err: any) {
      console.warn("Failed to initialize SpeechRecognition:", err);
      setErrorMsg("Failed to start Live Captions");
    }

    return () => {
      if (recognition) {
        try {
          recognition.abort();
        } catch {}
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [enabled, paused, isSpeechSupported, resetSilenceTimer]);

  // Drag-to-reposition logic
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag on card body, not buttons
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
          <div className={styles.warningBox}>
            <span>⚠️ {errorMsg}</span>
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
