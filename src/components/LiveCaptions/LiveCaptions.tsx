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
 * Sanitizes subtitle text:
 * - Strips HTML formatting (<font>, <b>, <i>, <c.yellow>, etc.)
 * - Strips ASS/SSA styling tags ({\an8}, {\pos(...)}, etc.)
 * - Decodes HTML entities (&nbsp;, &amp;, &lt;, &gt;, &quot;, &#39;)
 * - Removes directional unicode markers (&lrm;, &rlm;, \u200E, \u200F)
 * - Intelligently merges single-speaker lines split by captioners across arbitrary newlines
 *   (e.g. "Hi, uh,\nis this 3250 Brighton Beach?" -> "Hi, uh, is this 3250 Brighton Beach?"),
 *   while cleanly preserving multi-speaker dialogue lines (lines beginning with -, –, —).
 */
export function cleanSubtitleString(raw: string): string {
  if (!raw) return "";
  const decoded = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/&lrm;|&rlm;|\u200E|\u200F/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines = decoded
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return (lines[0] || "").replace(/\s+/g, " ").trim();
  }

  // Preserve multi-speaker dialogue lines (lines starting with dash or bullet)
  const isMultiSpeaker = lines.some((l) => /^[-–—•]/.test(l));
  if (isMultiSpeaker) {
    return lines
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  // Single speaker: merge arbitrary subtitle line breaks into a clean single line
  return lines.join(" ").replace(/\s+/g, " ").trim();
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
    const text = cleanSubtitleString(textLines.join("\n"));

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
  const [controlsVisible, setControlsVisible] = useState<boolean>(() => {
    if (typeof window !== "undefined" && typeof (window as any).__dipkri_controls_visible === "boolean") {
      return (window as any).__dipkri_controls_visible;
    }
    return false;
  });

  // Track controls visibility so captions stay above controls bar when shown,
  // and smoothly drop down to cinematic position when controls auto-hide.
  useEffect(() => {
    const handleControlsVis = (e: any) => {
      if (typeof e?.detail?.visible === "boolean") {
        setControlsVisible(e.detail.visible);
      }
    };
    window.addEventListener("controls-visibility", handleControlsVis);
    return () => {
      window.removeEventListener("controls-visibility", handleControlsVis);
    };
  }, []);

  // Subtitle cue text rendered from .srt/.vtt or server cues
  const [activeText, setActiveText] = useState<string>("");

  // Transient notice status pill (auto-expires)
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [hasLoadedCues, setHasLoadedCues] = useState<boolean>(false);

  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const lastCueIndexRef = useRef<number>(-1);
  const currentRenderedTextRef = useRef<string>("");
  const animFrameRef = useRef<number | null>(null);
  const autoSearchAttemptedRef = useRef<string>("");
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Show notice helper that auto-clears after given milliseconds
  const showNotice = useCallback((msg: string, durationMs: number = 3000) => {
    setSyncStatus(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      setSyncStatus("");
    }, durationMs);
  }, []);

  // Subtitles / captions are active if either:
  // 1. Live Captions / Auto Caption is ON
  // 2. A subtitle file exists in the room
  // 3. Captions mode is set to "showing"
  // 4. Subtitle cues have been discovered and loaded
  const userDisabled = !enabled && !isSubtitled;
  const isFeatureActive =
    !userDisabled &&
    Boolean(
      enabled ||
      roomSubtitle ||
      isSubtitled ||
      hasLoadedCues ||
      parsedCuesRef.current.length > 0
    );

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
        if (!detail.liveCaptions && !roomSubtitle && !isSubtitled) {
          setActiveText("");
          setSyncStatus("");
          currentRenderedTextRef.current = "";
          lastCueIndexRef.current = -1;
        } else if (detail.liveCaptions) {
          showNotice("Captions: Active", 2500);
        }
      }
      if (detail && detail.captionLanguage !== undefined) {
        setCaptionLanguage((prev) => {
          if (prev !== detail.captionLanguage) {
            parsedCuesRef.current = [];
            lastCueIndexRef.current = -1;
            autoSearchAttemptedRef.current = "";
            setActiveText("");
            currentRenderedTextRef.current = "";
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

    const handleLoadDirectSub = async (e: Event) => {
      const url = (e as CustomEvent).detail?.url;
      const label = (e as CustomEvent).detail?.label;
      if (url) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const text = await resp.text();
            const cues = parseSubtitleText(text);
            if (cues.length > 0) {
              parsedCuesRef.current = cues;
              lastCueIndexRef.current = -1;
              setHasLoadedCues(true);
              showNotice(`Subtitles: ${label || "Embedded"}`, 2500);
            }
          }
        } catch (err) {
          console.warn("[LiveCaptions] Direct sub error:", err);
        }
      }
    };

    window.addEventListener(PLAYER_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    window.addEventListener("dipkri-load-embedded-subtitle", handleLoadDirectSub);
    return () => {
      window.removeEventListener(
        PLAYER_SETTINGS_CHANGED_EVENT,
        handleSettingsChange
      );
      window.removeEventListener("dipkri-load-embedded-subtitle", handleLoadDirectSub);
    };
  }, [roomSubtitle, isSubtitled, showNotice]);

  // --------------------------------------------------------------------------
  // Media Change Cleanup: Whenever roomMedia changes, immediately wipe out all
  // cached cues, active rendered text, and auto-detect fresh subtitles for the new video!
  // --------------------------------------------------------------------------
  useEffect(() => {
    // Clear all previous video's cues and rendered captions
    parsedCuesRef.current = [];
    lastCueIndexRef.current = -1;
    currentRenderedTextRef.current = "";
    autoSearchAttemptedRef.current = "";
    setActiveText("");
    setHasLoadedCues(false);
    setSyncStatus("");

    // Clean up textTracks and track elements on video element
    const video = getActiveVideo();
    if (video) {
      const oldTracks = video.querySelectorAll("track");
      oldTracks.forEach((t) => t.remove());
      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          try {
            video.textTracks[i].mode = "disabled";
          } catch {}
        }
      }
    }

    // Clean up HLS subtitle tracks if switching away from or into new media
    const hls = (window as any).dipkri?.hls;
    if (hls && typeof hls.subtitleTrack === "number") {
      try {
        hls.subtitleTrack = -1;
      } catch {}
    }
  }, [roomMedia, getActiveVideo]);

  // --------------------------------------------------------------------------
  // Ingest Subtitles (.srt / .vtt) from roomSubtitle (e.g. Uploaded / Modal Subtitle)
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    parsedCuesRef.current = [];
    lastCueIndexRef.current = -1;
    setActiveText("");
    currentRenderedTextRef.current = "";

    if (!roomSubtitle) {
      setHasLoadedCues(false);
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
            lastCueIndexRef.current = -1;
            setHasLoadedCues(true);
            showNotice(`Loaded subtitles (${cues.length} lines)`, 2500);
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
  }, [roomSubtitle, showNotice]);

  // --------------------------------------------------------------------------
  // Auto-Scan Native HTMLMediaElement TextTracks & Embedded MKV/MP4 / HLS Cues
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isFeatureActive || isYouTube) return;

    const video = getActiveVideo();
    if (!video) return;

    const scanTracks = () => {
      // If roomSubtitle is active, prefer custom uploaded/selected roomSubtitle
      if (roomSubtitle && parsedCuesRef.current.length > 0) return;

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
                const cleaned = cleanSubtitleString(cue.text);
                if (cleaned) {
                  nativeCues.push({
                    start: cue.startTime,
                    end: cue.endTime,
                    text: cleaned,
                  });
                }
              }
            }
            if (nativeCues.length > 0) {
              parsedCuesRef.current = nativeCues.sort((a, b) => a.start - b.start);
              lastCueIndexRef.current = -1;
              setHasLoadedCues(true);
              showNotice(`Subtitles: ${track.label || track.language || "Embedded"}`, 2500);
              return;
            }
          }
        }
      }

      // 2. Scan HLS.js embedded subtitle tracks (for m3u8 streams)
      const hls = (window as any).dipkri?.hls;
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
  }, [isFeatureActive, isYouTube, getActiveVideo, captionLanguage, roomSubtitle, showNotice]);

  // --------------------------------------------------------------------------
  // Auto-Detect & Auto-Load Subtitles (HLS Manifest .m3u8, Torrents, OpenSubtitles)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!roomMedia || roomSubtitle || isYouTube) return;
    const searchKey = `${roomMedia}__${captionLanguage}`;
    if (autoSearchAttemptedRef.current === searchKey) return;
    autoSearchAttemptedRef.current = searchKey;

    let isDisposed = false;
    const cleanTitle = cleanMovieTitle(roomMedia);

    const autoLoadSubtitles = async () => {
      if (isDisposed || isYouTube) return;
      // 1. Direct HLS (.m3u8) embedded subtitle extraction
      if (roomMedia.includes(".m3u8")) {
        try {
          const fullMediaUrl = roomMedia.startsWith("http")
            ? roomMedia
            : typeof window !== "undefined"
              ? new URL(roomMedia, window.location.origin).toString()
              : roomMedia;

          const masterResp = await fetch(fullMediaUrl);
          if (masterResp.ok) {
            const masterText = await masterResp.text();
            if (masterText.includes("TYPE=SUBTITLES")) {
              const subLines = masterText
                .split("\n")
                .filter((l) => l.includes("TYPE=SUBTITLES"));

              let chosenUri: string | null = null;
              let chosenTrackName = "Captions";

              for (const line of subLines) {
                const lower = line.toLowerCase();
                const isMatch =
                  (captionLanguage === "all" && (lower.includes('language="en') || lower.includes("english"))) ||
                  (captionLanguage === "en" && (lower.includes('language="en') || lower.includes("english"))) ||
                  (captionLanguage === "hi" && (lower.includes('language="hi') || lower.includes("hindi"))) ||
                  (captionLanguage === "es" && (lower.includes('language="es') || lower.includes("spanish"))) ||
                  (captionLanguage === "fr" && (lower.includes('language="fr') || lower.includes("french"))) ||
                  (captionLanguage === "de" && (lower.includes('language="de') || lower.includes("german"))) ||
                  (captionLanguage === "ja" && (lower.includes('language="ja') || lower.includes("japanese"))) ||
                  (captionLanguage === "ar" && (lower.includes('language="ar') || lower.includes("arabic")));

                if (isMatch) {
                  const match = line.match(/URI="([^"]+)"/);
                  if (match) {
                    chosenUri = match[1];
                    const nameMatch = line.match(/NAME="([^"]+)"/);
                    if (nameMatch) chosenTrackName = nameMatch[1];
                    break;
                  }
                }
              }

              // Fallback to default or English or first subtitle track
              if (!chosenUri && subLines.length > 0) {
                const defLine =
                  subLines.find((l) => l.includes("DEFAULT=YES")) ||
                  subLines.find((l) => l.toLowerCase().includes("english") || l.toLowerCase().includes('language="en')) ||
                  subLines[0];
                const match = defLine.match(/URI="([^"]+)"/);
                if (match) {
                  chosenUri = match[1];
                  const nameMatch = defLine.match(/NAME="([^"]+)"/);
                  if (nameMatch) chosenTrackName = nameMatch[1];
                }
              }

              if (chosenUri && !isDisposed) {
                const subPlaylistUrl = new URL(chosenUri, fullMediaUrl).toString();
                const pResp = await fetch(subPlaylistUrl);
                if (pResp.ok) {
                  const pText = await pResp.text();
                  const vttLine = pText
                    .split("\n")
                    .map((l) => l.trim())
                    .find((l) => l && !l.startsWith("#"));

                  let vttUrl = subPlaylistUrl;
                  if (vttLine) {
                    vttUrl = new URL(vttLine, subPlaylistUrl).toString();
                  }

                  const vResp = await fetch(vttUrl);
                  if (vResp.ok) {
                    const vText = await vResp.text();
                    const cues = parseSubtitleText(vText);
                    if (cues.length > 0 && !isDisposed) {
                      parsedCuesRef.current = cues;
                      lastCueIndexRef.current = -1;
                      setHasLoadedCues(true);
                      showNotice(`Captions: ${chosenTrackName} (${cues.length} lines)`, 2500);
                      console.log(`[LiveCaptions] Auto-loaded ${cues.length} HLS cues for ${chosenTrackName}`);
                      return;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn("[LiveCaptions] HLS manifest subtitle extraction note:", e);
        }
      }

      // 2. Torrent / Magnet internal subtitle files (.srt/.vtt)
      if (roomMedia.includes("/stream?torrent=") || roomMedia.startsWith("magnet:")) {
        const dataUrl = roomMedia.includes("/stream?")
          ? roomMedia.replace("/stream?", "/data?")
          : `${serverPath}/data?torrent=${encodeURIComponent(roomMedia)}`;

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
                  } else if (captionLanguage === "en" || captionLanguage === "all") {
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
                        lastCueIndexRef.current = -1;
                        setHasLoadedCues(true);
                        showNotice(`Subtitles: ${subFile.name}`, 2500);
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

        // Check for embedded MKV / MP4 subtitle tracks via /streamInfo
        if (!isDisposed && parsedCuesRef.current.length === 0) {
          try {
            let fileIndexParam = "";
            const fIdxMatch = roomMedia.match(/[?&]fileIndex=(\d+)/i) || roomMedia.match(/%26fileIndex%3D(\d+)/i);
            if (fIdxMatch) {
              fileIndexParam = `&fileIndex=${fIdxMatch[1]}`;
            }
            let cleanTorrent = roomMedia.replace(/^.*\/stream\?torrent=/, "");
            const cutIdx = cleanTorrent.indexOf("&fileIndex=");
            if (cutIdx !== -1) {
              cleanTorrent = cleanTorrent.slice(0, cutIdx);
            }
            try {
              cleanTorrent = decodeURIComponent(cleanTorrent);
            } catch {}

            const infoResp = await fetch(`/streamInfo?torrent=${encodeURIComponent(cleanTorrent)}${fileIndexParam}`);
            if (infoResp.ok) {
              const infoData = await infoResp.json();
              if (infoData?.subtitleTracks && Array.isArray(infoData.subtitleTracks) && infoData.subtitleTracks.length > 0) {
                let chosenTrack = null;
                if (captionLanguage === "hi") {
                  chosenTrack = infoData.subtitleTracks.find((t: any) => /hindi|hin|\bhi\b/i.test(t.label || t.language || ""));
                } else if (captionLanguage === "es") {
                  chosenTrack = infoData.subtitleTracks.find((t: any) => /spanish|spa|\bes\b/i.test(t.label || t.language || ""));
                } else if (captionLanguage === "en" || captionLanguage === "all") {
                  chosenTrack = infoData.subtitleTracks.find((t: any) => /english|eng|\ben\b/i.test(t.label || t.language || ""));
                }
                if (!chosenTrack) {
                  chosenTrack = infoData.subtitleTracks[0];
                }

                if (chosenTrack) {
                  const subUrl = `/streamSubtitle?torrent=${encodeURIComponent(cleanTorrent)}&streamIndex=${chosenTrack.streamIndex}${fileIndexParam}`;
                  const sResp = await fetch(subUrl);
                  if (sResp.ok) {
                    const sText = await sResp.text();
                    const cues = parseSubtitleText(sText);
                    if (cues.length > 0 && !isDisposed) {
                      parsedCuesRef.current = cues;
                      lastCueIndexRef.current = -1;
                      setHasLoadedCues(true);
                      showNotice(`Subtitles: ${chosenTrack.label || "Embedded English"}`, 2500);
                      return;
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("[LiveCaptions] Embedded subtitle extraction note:", e);
          }
        }
      }

      // 3. Auto-search OpenSubtitles / Cinemeta for movies & shows
      if (!isDisposed && parsedCuesRef.current.length === 0 && cleanTitle && cleanTitle.length > 2) {
        try {
          const searchUrl = `${serverPath}/searchSubtitles?title=${encodeURIComponent(cleanTitle)}&lang=${encodeURIComponent(captionLanguage)}`;
          const searchResp = await fetch(searchUrl);
          let results: any[] = [];
          if (searchResp.ok) {
            results = await searchResp.json();
          }

          // If no results and cleanTitle contains year (e.g. "Spider Man Brand New Day (2026)"), fallback without year
          if ((!Array.isArray(results) || results.length === 0) && /\(\d{4}\)/.test(cleanTitle)) {
            const strippedTitle = cleanTitle.replace(/\s*\(\d{4}\)/g, "").trim();
            if (strippedTitle && strippedTitle !== cleanTitle) {
              const r2 = await fetch(
                `${serverPath}/searchSubtitles?title=${encodeURIComponent(strippedTitle)}&lang=${encodeURIComponent(captionLanguage)}`
              );
              if (r2.ok) {
                const j2 = await r2.json();
                if (Array.isArray(j2) && j2.length > 0) {
                  results = j2;
                }
              }
            }
          }

          if (Array.isArray(results) && results.length > 0) {
            const bestMatch = results[0];
            const downloadUrl =
              bestMatch.attributes?.downloadUrl ||
              bestMatch.downloadUrl ||
              bestMatch.url;
            const fileId =
              bestMatch.attributes?.files?.[0]?.file_id ||
              bestMatch.file_id ||
              bestMatch.id;

            if (downloadUrl || fileId) {
              const dlResp = await fetch(
                `${serverPath}/downloadSubtitles?downloadUrl=${encodeURIComponent(downloadUrl || "")}&file_id=${encodeURIComponent(fileId || "")}`
              );
              if (dlResp.ok) {
                const dlData = await dlResp.json();
                if (dlData.link) {
                  const subResp = await fetch(dlData.link);
                  if (subResp.ok) {
                    const sText = await subResp.text();
                    const cues = parseSubtitleText(sText);
                    if (cues.length > 0 && !isDisposed) {
                      parsedCuesRef.current = cues;
                      lastCueIndexRef.current = -1;
                      setHasLoadedCues(true);
                      const releaseName =
                        bestMatch.attributes?.release ||
                        bestMatch.release ||
                        cleanTitle;
                      showNotice(`Subtitles: ${releaseName}`, 2500);
                      return;
                    }
                  }
                }
              }
            }
          }
        } catch {}
      }
    };

    autoLoadSubtitles();

    return () => {
      isDisposed = true;
    };
  }, [roomMedia, roomSubtitle, captionLanguage, showNotice]);

  // --------------------------------------------------------------------------
  // Ultra-Low Latency Zero-Gap (~0.03s) 60fps/120fps Synchronized Subtitle Render Loop
  // --------------------------------------------------------------------------
  useEffect(() => {
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

        if (cues.length > 0 && !isYouTube) {
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
            matchedText = cue.text;
          }
        }

        if (isYouTube) {
          matchedText = "";
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
                    const cleaned = cleanSubtitleString(cue.text);
                    if (cleaned) {
                      texts.push(cleaned);
                    }
                  }
                }
                if (texts.length > 0) {
                  matchedText = cleanSubtitleString(texts.join("\n"));
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
  }, [paused, isYouTube, getYoutubeTime, getActiveVideo]);

  if (!isFeatureActive) {
    return null;
  }

  const currentDisplaySubtitle = activeText;

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
  const controlsClass = controlsVisible ? styles.controlsVisible : styles.controlsHidden;

  // 1. Render active live dialogue caption or recognized speech
  if (currentDisplaySubtitle) {
    return (
      <div className={`${styles.captionsContainer} ${posClass} ${controlsClass}`}>
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
      <div className={`${styles.captionsContainer} ${posClass} ${controlsClass}`}>
        <div className={styles.noticePill}>{syncStatus}</div>
      </div>
    );
  }

  return null;
};
