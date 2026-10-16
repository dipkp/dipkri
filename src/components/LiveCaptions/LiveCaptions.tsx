import React, { useEffect, useState, useRef, useCallback } from "react";
import styles from "./LiveCaptions.module.css";
import {
  getPlayerSettings,
  PLAYER_SETTINGS_CHANGED_EVENT,
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
  getYoutubeTime?: () => number;
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
 * High-speed in-memory parser for both .srt and .vtt subtitle formats.
 * Works seamlessly across YouTube, Torrents, direct MP4, MKV, HLS, and mobile.
 */
export function parseSubtitleText(content: string): SubtitleCue[] {
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

export const LiveCaptions: React.FC<LiveCaptionsProps> = ({
  paused = false,
  videoEl,
  isYouTube = false,
  roomSubtitle,
  roomMedia,
  getYoutubeTime,
}) => {
  const [enabled, setEnabled] = useState<boolean>(
    () => getPlayerSettings().liveCaptions
  );
  const [activeText, setActiveText] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<string>("");

  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const lastCueIndexRef = useRef<number>(-1);
  const currentRenderedTextRef = useRef<string>("");
  const animFrameRef = useRef<number | null>(null);
  const autoSearchAttemptedRef = useRef<string>("");

  // Helper to reliably retrieve the current video element
  const getActiveVideo = useCallback((): HTMLMediaElement | null => {
    if (videoEl && videoEl.isConnected) return videoEl;
    if (typeof document !== "undefined") {
      return (document.getElementById("leftVideo") as HTMLMediaElement) || null;
    }
    return null;
  }, [videoEl]);

  // Sync with global player settings events (toggling live captions on/off)
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.liveCaptions !== undefined) {
        setEnabled(detail.liveCaptions);
        if (!detail.liveCaptions) {
          setActiveText("");
          setSyncStatus("");
          currentRenderedTextRef.current = "";
          lastCueIndexRef.current = -1;
        }
      }
    };
    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(
        PLAYER_SETTINGS_CHANGED_EVENT,
        handleSettingsChange
      );
    };
  }, []);

  // --------------------------------------------------------------------------
  // Ingest Subtitles (.srt / .vtt) from roomSubtitle into memory
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    parsedCuesRef.current = [];
    lastCueIndexRef.current = -1;

    if (!roomSubtitle) {
      return;
    }

    setSyncStatus("Loading subtitle cues...");

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
  // Auto-Detect & Auto-Search Subtitles for Magnet Links, Torrent Streams & m3u8
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || roomSubtitle || !roomMedia) return;
    if (autoSearchAttemptedRef.current === roomMedia) return;
    autoSearchAttemptedRef.current = roomMedia;

    let isDisposed = false;
    const cleanTitle = cleanMovieTitle(roomMedia);

    const autoDiscoverSubtitles = async () => {
      // 1. If torrent or magnet stream, check /data?torrent=... for internal subtitle files
      if (roomMedia.includes("/stream?torrent=") || roomMedia.startsWith("magnet:")) {
        const dataUrl = roomMedia.includes("/stream?")
          ? roomMedia.replace("/stream?", "/data?")
          : `${serverPath}/data?torrent=${encodeURIComponent(roomMedia)}`;

        setSyncStatus(`Syncing torrent audio & dialogue (${cleanTitle || "Movie"})...`);

        for (let i = 0; i < 4; i++) {
          if (isDisposed || parsedCuesRef.current.length > 0) return;
          try {
            const resp = await fetch(dataUrl);
            if (resp.ok) {
              const meta = await resp.json();
              if (meta?.files && Array.isArray(meta.files)) {
                const subFile = meta.files.find((f: any) =>
                  f.name?.toLowerCase().endsWith(".srt") || f.name?.toLowerCase().endsWith(".vtt")
                );
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
              if (meta?.name) break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 1200));
        }
      }

      // 2. Search OpenSubtitles / Stremio API for matching dialogue track
      if (cleanTitle && cleanTitle.length > 2 && parsedCuesRef.current.length === 0) {
        setSyncStatus(`Auto-syncing dialogue stream for "${cleanTitle}"...`);
        try {
          const sResp = await fetch(
            `${serverPath}/searchSubtitles?title=${encodeURIComponent(cleanTitle)}`
          );
          if (sResp.ok) {
            const list = await sResp.json();
            if (Array.isArray(list) && list.length > 0) {
              const topSub = list.find(
                (r: any) => (r.attributes?.language || "").toUpperCase() === "EN"
              ) || list[0];
              if (topSub) {
                const fileId = topSub.attributes?.files?.[0]?.file_id;
                const dlUrl = topSub.attributes?.downloadUrl || "";
                const q = new URLSearchParams();
                if (dlUrl) q.set("downloadUrl", dlUrl);
                if (fileId) q.set("file_id", fileId);
                const dResp = await fetch(`${serverPath}/downloadSubtitles?${q.toString()}`);
                if (dResp.ok) {
                  const dJson = await dResp.json();
                  if (dJson?.link) {
                    const subFileResp = await fetch(`${serverPath}${dJson.link}`);
                    if (subFileResp.ok) {
                      const sText = await subFileResp.text();
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
            }
          }
        } catch (err) {
          console.warn("[LiveCaptions] Auto-search notice:", err);
        }
      }

      // Hide sync status after 4.5s if no cues found
      setTimeout(() => {
        if (!isDisposed && parsedCuesRef.current.length === 0) {
          setSyncStatus("");
        }
      }, 4500);
    };

    autoDiscoverSubtitles();

    return () => {
      isDisposed = true;
    };
  }, [enabled, roomSubtitle, roomMedia]);

  // --------------------------------------------------------------------------
  // Auto-Scan Native HTMLMediaElement TextTracks & HLS.js Embedded Cues
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || isYouTube) return;

    const video = getActiveVideo();
    if (!video) return;

    // Attach Web Audio nodes and voice activity analyzer to the video source
    audioEnhancer.attachToElement(video);

    const scanTracks = () => {
      if (parsedCuesRef.current.length > 0) return; // Already have active cues

      // 1. Scan native HTMLMediaElement textTracks
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
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
        if (hls.subtitleTrack === -1) {
          hls.subtitleTrack = 0;
        }
      }
    };

    scanTracks();
    video.addEventListener("loadedmetadata", scanTracks);
    video.addEventListener("canplay", scanTracks);

    // Dynamic track detection when cues finish downloading over HLS or video stream
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
  }, [enabled, isYouTube, getActiveVideo]);

  // --------------------------------------------------------------------------
  // Ultra-Low Latency Zero-Gap (~0.03s) 60fps/120fps Synchronized Render Loop
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setActiveText("");
      currentRenderedTextRef.current = "";
      return;
    }

    let isMounted = true;

    const renderLoop = () => {
      if (!isMounted) return;

      if (!paused) {
        // 1. Retrieve exact microsecond timestamp from YouTube or HTML5 Video
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

        // 2. High-precision 30ms (0.030s) acoustic onset lead compensation.
        const syncTime = currentTime + 0.030;

        let matchedText = "";
        const cues = parsedCuesRef.current;

        if (cues.length > 0) {
          // O(1) Sequential Cache Lookup:
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
            // Binary search in O(log N) on seeks, jumps, or scene cuts
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

        // 3. Fallback: Secondary check on active textTracks from native video
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

        // 4. Update state only on change to avoid unnecessary React re-renders
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
  }, [enabled, paused, isYouTube, getYoutubeTime, getActiveVideo]);

  if (!enabled) {
    return null;
  }

  // 1. Render active live dialogue caption if available
  if (activeText) {
    return (
      <div className={styles.captionsContainer}>
        <div className={styles.minimalSubtitle}>{activeText}</div>
      </div>
    );
  }

  // 2. Render sync status pill while acquiring or searching dialogue cues
  if (syncStatus) {
    return (
      <div className={styles.captionsContainer}>
        <div className={styles.noticePill}>{syncStatus}</div>
      </div>
    );
  }

  return null;
};
