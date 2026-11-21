import React, { useEffect } from "react";
import { WPIconDownload, WPIconMonitor } from "../Icons/CustomIcons";
import styles from "./AppDownloadModal.module.css";

export interface AppDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: "torrent_gate" | "general" | "host_prompt";
  mediaTitle?: string;
}

const AndroidIcon: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-4.84l1.3-1.3a.49.49 0 0 0 0-.7.49.49 0 0 0-.7 0l-1.47 1.47C13.8 2.24 12.93 2 12 2s-1.8.24-2.66.63L7.87 1.16a.49.49 0 0 0-.7 0 .49.49 0 0 0 0 .7l1.3 1.3C6.63 4.26 5.5 6.01 5.5 8h13c0-1.99-1.13-3.74-2.97-4.84zM9 6c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" />
  </svg>
);

export const AppDownloadModal: React.FC<AppDownloadModalProps> = ({
  isOpen,
  onClose,
  reason = "torrent_gate",
  mediaTitle,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalCard} role="dialog" aria-modal="true">
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div className={styles.modalHeader}>
          <div className={styles.badgePill}>
            <span>⚡ Zero Server Lag • 100% P2P Swarm</span>
          </div>
          <h2 className={styles.modalTitle}>
            {reason === "torrent_gate" ? "Stream in Dipkri App" : "Get the Dipkri App"}
          </h2>
          <p className={styles.modalSubtitle}>
            {mediaTitle ? (
              <>
                <strong style={{ color: "#e2e8f0" }}>{mediaTitle}</strong> is a high-speed torrent stream.
                {" "}
              </>
            ) : null}
            To protect your privacy, avoid buffering, and stream in native 4K, torrent playback
            runs directly on your device via P2P swarm.
          </p>
        </div>

        <div className={styles.downloadGrid}>
          {/* Card 1: Android APK */}
          <div
            className={`${styles.downloadCard} ${
              isAndroid ? styles.downloadCardPrimary : ""
            }`}
          >
            <div>
              <div className={styles.cardTop}>
                <div className={styles.cardIcon}>
                  <AndroidIcon size={24} />
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardPlatform}>Dipkri for Android</span>
                  <span className={styles.cardBadge}>
                    {isAndroid ? "⚡ Best for your device" : "Direct APK Install"}
                  </span>
                </div>
              </div>

              <ul className={styles.cardFeatures}>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  Native libtorrent4j P2P engine
                </li>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  Zero server bandwidth & no lag
                </li>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  Background audio & PIP support
                </li>
              </ul>
            </div>

            <a
              href="/download/android"
              className={`${styles.downloadButton} ${
                !isAndroid ? styles.downloadButtonSecondary : ""
              }`}
              download
            >
              <WPIconDownload size={16} />
              <span>Download APK</span>
            </a>
          </div>

          {/* Card 2: Desktop App */}
          <div
            className={`${styles.downloadCard} ${
              !isAndroid ? styles.downloadCardPrimary : ""
            }`}
          >
            <div>
              <div className={styles.cardTop}>
                <div className={styles.cardIcon}>
                  <WPIconMonitor size={22} />
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardPlatform}>Dipkri for Desktop</span>
                  <span className={styles.cardBadge}>
                    {!isAndroid ? "⚡ Best for your device" : "Windows & macOS"}
                  </span>
                </div>
              </div>

              <ul className={styles.cardFeatures}>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  WebTorrent Sidecar on 127.0.0.1
                </li>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  Hardware-accelerated 4K/HDR
                </li>
                <li className={styles.cardFeatureItem}>
                  <span className={styles.cardFeatureDot} />
                  Multi-track audio & auto-subtitles
                </li>
              </ul>
            </div>

            <a
              href="/download/desktop"
              className={`${styles.downloadButton} ${
                isAndroid ? styles.downloadButtonSecondary : ""
              }`}
              download
            >
              <WPIconDownload size={16} />
              <span>Download Desktop</span>
            </a>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <div className={styles.infoNotice}>
            <span className={styles.infoHighlight}>Web Browser Notice:</span> Room chat, YouTube, and standard web links work directly in your browser. Torrent streams require the Dipkri App so video bytes never burden our servers.
          </div>
        </div>
      </div>
    </div>
  );
};
