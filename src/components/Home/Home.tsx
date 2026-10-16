import React, { useContext, useState, useId } from "react";
import { Button } from "@mantine/core";
import { MetadataContext } from "../../MetadataContext";
import { createRoom } from "../TopBar/TopBar";
import { JoinRoomModal } from "../Modal/JoinRoomModal";
import {
  WPIconPlus,
  WPIconLogin,
  WPIconPlay,
  WPIconPause,
  WPIconSync,
  WPIconScreenshare,
  WPIconFile,
  WPIconChat,
  WPIconPeople,
  WPIconPlaylist,
  WPIconMagnet,
  WPIconLink,
  WPIconCheck,
  WPIconYouTube,
  WPIconReaction,
  WPIconSpeed,
  WPIconCaptions,
  WPIconFullscreen,
  WPIconChevronRight,
  DipkriLogo,
  WPIconMonitor,
  WPIconVBrowser,
} from "../Icons/CustomIcons";
import {
  IconVideo,
  IconSparkles,
  IconBolt,
  IconShieldCheck,
  IconDeviceTv,
  IconDevices,
} from "@tabler/icons-react";
import styles from "./Home.module.css";

export const Home = () => {
  const context = useContext(MetadataContext);
  const [isCreating, setIsCreating] = useState(false);
  const [roomInput, setRoomInput] = useState("");
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [activeShowcaseTab, setActiveShowcaseTab] = useState<"youtube" | "screen" | "file">("youtube");
  const [isPlayingDemo, setIsPlayingDemo] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleStartInstantRoom = async () => {
    setIsCreating(true);
    try {
      await createRoom(context.user, false);
    } catch (e) {
      console.error("Failed to create room:", e);
      setIsCreating(false);
    }
  };

  const handleInlineJoin = (e: React.FormEvent) => {
    e.preventDefault();
    let code = roomInput.trim();
    if (!code) {
      setIsJoinModalOpen(true);
      return;
    }
    if (code.includes("/watch/")) {
      code = code.split("/watch/")[1];
    } else if (code.includes("/r/")) {
      const vanity = code.split("/r/")[1];
      window.location.assign(`/r/${vanity}`);
      return;
    } else if (code.startsWith("/")) {
      code = code.replace(/^\//, "");
    }
    code = code.split("?")[0].replace(/\/+$/, "");
    if (/^\d[\d\s-]+\d$/.test(code)) {
      code = code.replace(/[\s-]+/g, "");
    }
    if (code) {
      window.location.assign(`/watch/${code}`);
    }
  };

  const showcaseData = {
    youtube: {
      title: "YouTube 4K Sync & Queue",
      badge: "LIVE SYNC",
      image: "/screenshot4.png",
      tagline: "Synchronized YouTube search, shared queue & 4K streams",
      chat1: "That scene transition was legendary 🔥",
      chat2: "Queueing the next video right now! 🎬",
    },
    screen: {
      title: "60 FPS Screen & Audio Share",
      badge: "60 FPS STREAM",
      image: "/screenshot18.png",
      tagline: "Stream games, browser tabs, or desktop with low-latency stereo sound",
      chat1: "Wait, drop the clutch on turn 3! 🏎️",
      chat2: "Zero input lag, looking super crisp!",
    },
    file: {
      title: "Direct Local File Stream (P2P)",
      badge: "WEBRTC DIRECT",
      image: "/screenshot14.png",
      tagline: "Stream large 4K movies directly from your PC without cloud uploads",
      chat1: "Audio boost at 150% sounds cinematic 🍿",
      chat2: "Subtitles synced right on point 👍",
    },
  };

  const currentShowcase = showcaseData[activeShowcaseTab];

  const faqs = [
    {
      q: "Do my friends need to create an account to join?",
      a: "No! dipkri is 100% frictionless. You can create a room with one tap, copy the link or 6-digit code, and your friends can immediately join from any desktop or mobile browser with zero sign-ups or downloads.",
    },
    {
      q: "How does local file streaming work without uploading?",
      a: "dipkri utilizes ultra-fast peer-to-peer WebRTC connections. When you select a video file on your computer, it streams directly to your friends' browsers without uploading the file to any third-party server. There are zero file size limits!",
    },
    {
      q: "Does dipkri work on mobile phones (Android & iPhone)?",
      a: "Yes! dipkri is built mobile-first. It includes a pinned 16:9 vertical video player, custom double-tap seek gestures, and a WhatsApp-style live chat that stays frozen open while typing without jerky jumps.",
    },
    {
      q: "What video formats and platforms are supported?",
      a: "dipkri supports YouTube (search, queue, live streams), local files (MP4, MKV, WebM, AVI), screen sharing with audio, direct URLs (MP4, HLS .m3u8, DASH .mpd), WebTorrent magnets, and remote Virtual Browsers.",
    },
    {
      q: "Can we use webcams and voice chat while watching?",
      a: "Yes! dipkri features floating, draggable webcam bubbles with active speaker rings. You can move bubbles anywhere on screen, adjust bubble sizes, and hear each other with crystal-clear voice chat.",
    },
  ];

  return (
    <div className={styles.homeWrapper}>
      {/* Dynamic Ambient Background Glows */}
      <div className={styles.ambientBackground}>
        <div className={styles.glowOrb1} />
        <div className={styles.glowOrb2} />
        <div className={styles.glowOrb3} />
        <div className={styles.gridOverlay} />
      </div>

      <div className={styles.container}>
        {/* ========================================================
            HERO SECTION
            ======================================================== */}
        <section className={styles.heroSection}>
          {/* Animated Badge Pill */}
          <div className={styles.badgePill}>
            <span className={styles.badgePulseDot} />
            <IconSparkles size={14} className={styles.badgeIcon} />
            <span className={styles.badgeText}>Real-Time Synchronized Streaming • 100% Free</span>
          </div>

          {/* Hero Headline */}
          <h1 className={styles.heroHeadline}>
            Stream Anything Together. <br />
            <span className={styles.heroGradientText}>In Millisecond Sync.</span>
          </h1>

          {/* Hero Subtitle */}
          <p className={styles.heroSubtitle}>
            Watch YouTube, 4K movies, local videos, screen shares, and live streams with friends.
            Complete with floating webcam bubbles, WhatsApp-style live chat, and zero latency.
          </p>

          {/* Hero Action Bar */}
          <div className={styles.heroActionArea}>
            <Button
              size="lg"
              className={styles.primaryCtaBtn}
              onClick={handleStartInstantRoom}
              loading={isCreating}
              leftSection={<WPIconPlus size={20} />}
            >
              Start Instant Room
            </Button>

            {/* Inline Quick Join Form */}
            <form onSubmit={handleInlineJoin} className={styles.inlineJoinForm}>
              <div className={styles.joinInputWrapper}>
                <WPIconLink size={18} className={styles.joinInputIcon} />
                <input
                  type="text"
                  placeholder="Enter room code or link..."
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  className={styles.joinInput}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" variant="light" color="cyan" className={styles.joinSubmitBtn}>
                Join Room
              </Button>
            </form>
          </div>

          {/* Trust Badges */}
          <div className={styles.trustBadges}>
            <div className={styles.trustItem}>
              <WPIconCheck size={16} color="#10b981" />
              <span>No Sign-Up Required</span>
            </div>
            <div className={styles.trustItem}>
              <WPIconCheck size={16} color="#10b981" />
              <span>Native 4K & 60 FPS</span>
            </div>
            <div className={styles.trustItem}>
              <WPIconCheck size={16} color="#10b981" />
              <span>Ultra-Low Latency</span>
            </div>
            <div className={styles.trustItem}>
              <WPIconCheck size={16} color="#10b981" />
              <span>Free Forever</span>
            </div>
          </div>

          {/* ========================================================
              INTERACTIVE LIVE PLAYER SHOWCASE (Centerpiece)
              ======================================================== */}
          <div className={styles.showcaseContainer}>
            {/* Source Switcher Tabs */}
            <div className={styles.showcaseTabs}>
              <button
                type="button"
                className={`${styles.showcaseTab} ${activeShowcaseTab === "youtube" ? styles.activeTab : ""}`}
                onClick={() => setActiveShowcaseTab("youtube")}
              >
                <WPIconYouTube size={18} />
                <span>YouTube 4K & Queue</span>
              </button>
              <button
                type="button"
                className={`${styles.showcaseTab} ${activeShowcaseTab === "screen" ? styles.activeTab : ""}`}
                onClick={() => setActiveShowcaseTab("screen")}
              >
                <WPIconScreenshare size={18} />
                <span>60 FPS Screen Share</span>
              </button>
              <button
                type="button"
                className={`${styles.showcaseTab} ${activeShowcaseTab === "file" ? styles.activeTab : ""}`}
                onClick={() => setActiveShowcaseTab("file")}
              >
                <WPIconFile size={18} />
                <span>Local Files & Torrents</span>
              </button>
            </div>

            {/* Mock Video Window Frame */}
            <div className={styles.mockPlayerFrame}>
              {/* Window Title Bar */}
              <div className={styles.mockWindowHeader}>
                <div className={styles.windowDots}>
                  <span className={`${styles.dot} ${styles.dotRed}`} />
                  <span className={`${styles.dot} ${styles.dotYellow}`} />
                  <span className={`${styles.dot} ${styles.dotGreen}`} />
                </div>
                <div className={styles.mockRoomTitle}>
                  <DipkriLogo size={16} />
                  <span>dipkri room • {currentShowcase.title}</span>
                </div>
                <div className={styles.mockSyncBadge}>
                  <span className={styles.syncGlowDot} />
                  <span>0ms delay</span>
                </div>
              </div>

              {/* Video Screen Content */}
              <div className={styles.mockScreen}>
                <img
                  src={currentShowcase.image}
                  alt={currentShowcase.title}
                  className={styles.mockScreenImage}
                />
                <div className={styles.mockScreenGlow} />

                {/* Floating Webcam Bubbles */}
                <div className={styles.mockWebcamBubbles}>
                  <div className={`${styles.mockBubble} ${styles.bubbleActive}`}>
                    <span className={styles.bubbleSpeakingRing} />
                    <span className={styles.bubbleInitial}>A</span>
                    <span className={styles.bubbleLabel}>Alex</span>
                  </div>
                  <div className={styles.mockBubble}>
                    <span className={styles.bubbleInitial} style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}>S</span>
                    <span className={styles.bubbleLabel}>Sarah</span>
                  </div>
                  <div className={styles.mockBubble}>
                    <span className={styles.bubbleInitial} style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>Y</span>
                    <span className={styles.bubbleLabel}>You</span>
                  </div>
                </div>

                {/* Floating Live Chat Overlay */}
                <div className={styles.mockChatOverlay}>
                  <div className={styles.mockChatPill}>
                    <span className={styles.chatAuthor}>Alex:</span>
                    <span>{currentShowcase.chat1}</span>
                  </div>
                  <div className={styles.mockChatPill}>
                    <span className={styles.chatAuthor} style={{ color: "#38bdf8" }}>Sarah:</span>
                    <span>{currentShowcase.chat2}</span>
                  </div>
                </div>

                {/* Floating Flying Reactions */}
                <div className={styles.flyingReactions}>
                  <span className={`${styles.flyingEmoji} ${styles.emoji1}`}>❤️</span>
                  <span className={`${styles.flyingEmoji} ${styles.emoji2}`}>🔥</span>
                  <span className={`${styles.flyingEmoji} ${styles.emoji3}`}>🍿</span>
                  <span className={`${styles.flyingEmoji} ${styles.emoji4}`}>😂</span>
                </div>

                {/* Interactive Player Controls Bar */}
                <div className={styles.mockControlsBar}>
                  <div className={styles.mockControlsLeft}>
                    <button
                      type="button"
                      className={styles.mockPlayBtn}
                      onClick={() => setIsPlayingDemo(!isPlayingDemo)}
                      title={isPlayingDemo ? "Pause" : "Play"}
                    >
                      {isPlayingDemo ? <WPIconPause size={18} /> : <WPIconPlay size={18} />}
                    </button>
                    <span className={styles.mockTimeText}>01:24:18 / 02:15:00</span>
                  </div>

                  <div className={styles.mockProgressBar}>
                    <div className={styles.mockProgressFilled} />
                    <div className={styles.mockProgressScrubber} />
                  </div>

                  <div className={styles.mockControlsRight}>
                    <div className={styles.mockActionIcon} title="Synced">
                      <WPIconSync size={16} />
                    </div>
                    <div className={styles.mockSpeedBadge}>1.0x</div>
                    <div className={styles.mockActionIcon} title="Captions">
                      <WPIconCaptions size={16} />
                    </div>
                    <div className={styles.mockActionIcon} title="Fullscreen">
                      <WPIconFullscreen size={16} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================
            UNIVERSAL MEDIA ENGINE (6 Supported Media Bento Cards)
            ======================================================== */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTag}>
              <IconSparkles size={14} />
              <span>Universal Media Engine</span>
            </div>
            <h2 className={styles.sectionTitle}>Stream What You Love. Anywhere.</h2>
            <p className={styles.sectionSubtitle}>
              Whether it is a YouTube rabbit hole, a local 4K movie file, or a Discord-style screen share, dipkri plays it in absolute unison.
            </p>
          </div>

          <div className={styles.mediaGrid}>
            {/* Card 1: YouTube */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(239, 68, 68, 0.15)", color: "#ef4444" }}>
                <WPIconYouTube size={28} />
              </div>
              <h3 className={styles.mediaTitle}>YouTube 4K & Queue</h3>
              <p className={styles.mediaText}>
                Search millions of videos, stream 4K content, and build shared collaborative playlists that keep playing seamlessly.
              </p>
              <div className={styles.mediaTags}>
                <span>Synced Playlists</span>
                <span>Live Streams</span>
                <span>Autoplay</span>
              </div>
            </div>

            {/* Card 2: Screen Sharing */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(99, 102, 241, 0.15)", color: "#818cf8" }}>
                <WPIconScreenshare size={28} />
              </div>
              <h3 className={styles.mediaTitle}>60 FPS Screen Share</h3>
              <p className={styles.mediaText}>
                Broadcast your desktop, game window, or browser tab with pristine stereo system audio and zero screen stutter.
              </p>
              <div className={styles.mediaTags}>
                <span>System Audio</span>
                <span>60 FPS</span>
                <span>Low Latency</span>
              </div>
            </div>

            {/* Card 3: Local Files */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}>
                <WPIconFile size={28} />
              </div>
              <h3 className={styles.mediaTitle}>P2P Local File Stream</h3>
              <p className={styles.mediaText}>
                Drop any MP4, MKV, or AVI file straight from your computer. Streams direct peer-to-peer with zero upload limits or server storage.
              </p>
              <div className={styles.mediaTags}>
                <span>Peer-to-Peer</span>
                <span>Zero File Limits</span>
                <span>Multi-Audio</span>
              </div>
            </div>

            {/* Card 4: Direct URLs */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(6, 182, 212, 0.15)", color: "#22d3ee" }}>
                <WPIconLink size={28} />
              </div>
              <h3 className={styles.mediaTitle}>Direct URLs & HLS/DASH</h3>
              <p className={styles.mediaText}>
                Paste any direct MP4 link or adaptive live stream (.m3u8, .mpd). Automatically negotiates optimal bitrate for every viewer.
              </p>
              <div className={styles.mediaTags}>
                <span>HLS (.m3u8)</span>
                <span>MPEG-DASH</span>
                <span>MP4 / WebM</span>
              </div>
            </div>

            {/* Card 5: Magnet Links */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" }}>
                <WPIconMagnet size={28} />
              </div>
              <h3 className={styles.mediaTitle}>Torrents & Magnets</h3>
              <p className={styles.mediaText}>
                Directly stream video torrents in your browser with automatic subtitle fetching and swarm-assisted high-speed buffer.
              </p>
              <div className={styles.mediaTags}>
                <span>WebTorrent</span>
                <span>Auto-Subtitles</span>
                <span>No Download</span>
              </div>
            </div>

            {/* Card 6: Virtual Browser */}
            <div className={styles.mediaCard}>
              <div className={styles.mediaIconWrapper} style={{ background: "rgba(236, 72, 153, 0.15)", color: "#f472b6" }}>
                <WPIconVBrowser size={28} />
              </div>
              <h3 className={styles.mediaTitle}>Shared Virtual Browser</h3>
              <p className={styles.mediaText}>
                Spin up a cloud browser instance to browse and watch subscription platforms together with full shared control.
              </p>
              <div className={styles.mediaTags}>
                <span>Cloud Instance</span>
                <span>Shared Control</span>
                <span>Bypass Blocks</span>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================
            EXPERIENCE BENTO GRID (Why dipkri is Unmatched)
            ======================================================== */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTag}>
              <IconBolt size={14} />
              <span>Next-Gen Architecture</span>
            </div>
            <h2 className={styles.sectionTitle}>Crafted For Real Connection</h2>
            <p className={styles.sectionSubtitle}>
              Every detail is engineered so you feel like you are sitting right beside your friends on the couch.
            </p>
          </div>

          <div className={styles.bentoGrid}>
            {/* Bento 1: Millisecond Synchronizer (Wide) */}
            <div className={`${styles.bentoCard} ${styles.bentoWide}`}>
              <div className={styles.bentoContent}>
                <div className={styles.bentoIcon} style={{ background: "rgba(99, 102, 241, 0.2)", color: "#818cf8" }}>
                  <WPIconSync size={24} />
                </div>
                <h3 className={styles.bentoTitle}>True Millisecond Clock Sync</h3>
                <p className={styles.bentoText}>
                  Our custom drift-correction algorithm checks playback deltas continuously. If someone lags or pauses, everyone stays on the exact same second with auto catch-up.
                </p>
                <div className={styles.syncVisual}>
                  <div className={styles.syncNode}>
                    <span className={styles.nodeHost}>Host</span>
                    <span className={styles.nodeTime}>01:42.50</span>
                  </div>
                  <div className={styles.syncBeam}>
                    <span className={styles.beamPulse} />
                    <span className={styles.beamLabel}>0.02s sync</span>
                  </div>
                  <div className={styles.syncNode}>
                    <span className={styles.nodePeer}>You</span>
                    <span className={styles.nodeTime}>01:42.50</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bento 2: Floating Webcam Bubbles */}
            <div className={styles.bentoCard}>
              <div className={styles.bentoContent}>
                <div className={styles.bentoIcon} style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399" }}>
                  <IconVideo size={24} />
                </div>
                <h3 className={styles.bentoTitle}>Floating Webcam Bubbles</h3>
                <p className={styles.bentoText}>
                  Live video chat overlaid directly on the stream. Drag bubbles anywhere, adjust bubble sizes, and see real-time speaking rings.
                </p>
              </div>
            </div>

            {/* Bento 3: WhatsApp-Style Live Chat */}
            <div className={styles.bentoCard}>
              <div className={styles.bentoContent}>
                <div className={styles.bentoIcon} style={{ background: "rgba(6, 182, 212, 0.2)", color: "#22d3ee" }}>
                  <WPIconChat size={24} />
                </div>
                <h3 className={styles.bentoTitle}>WhatsApp-Style Chat</h3>
                <p className={styles.bentoText}>
                  Swipe to quote-reply, send emoji reactions, and read automated voice transcripts. Built with zero keyboard collapse on phones.
                </p>
              </div>
            </div>

            {/* Bento 4: Mobile-First Engineering (Wide) */}
            <div className={`${styles.bentoCard} ${styles.bentoWide}`}>
              <div className={styles.bentoContent}>
                <div className={styles.bentoIcon} style={{ background: "rgba(244, 114, 182, 0.2)", color: "#f472b6" }}>
                  <IconDevices size={24} />
                </div>
                <h3 className={styles.bentoTitle}>Engineered for Mobile & Desktop</h3>
                <p className={styles.bentoText}>
                  Vertical mobile phones lock a crisp 16:9 video player at the top while letting you chat continuously without closing the keyboard. Rotate to landscape for full-bleed theater mode!
                </p>
                <div className={styles.devicePills}>
                  <span>Android & iOS</span>
                  <span>macOS & Windows</span>
                  <span>Linux & ChromeOS</span>
                  <span>No App Required</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================
            COMPARISON MATRIX (dipkri vs Others)
            ======================================================== */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTag}>
              <IconShieldCheck size={14} />
              <span>Head-To-Head</span>
            </div>
            <h2 className={styles.sectionTitle}>Why dipkri Outshines the Rest</h2>
            <p className={styles.sectionSubtitle}>
              See how dipkri stacks up against Discord screenshare, extensions, and video call apps.
            </p>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.compareTable}>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th className={styles.highlightCol}>dipkri</th>
                  <th>Discord Screenshare</th>
                  <th>Teleparty (Ext)</th>
                  <th>Zoom / Meets</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Instant Web Join (No App)</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> 1-Click Link</td>
                  <td>❌ Requires App</td>
                  <td>⚠️ Chrome Ext Only</td>
                  <td>❌ App Required</td>
                </tr>
                <tr>
                  <td>4K 60fps Native Streams</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> Full 4K Native</td>
                  <td>❌ 720p (Nitro Needed)</td>
                  <td>⚠️ Compressed</td>
                  <td>❌ 720p Max</td>
                </tr>
                <tr>
                  <td>P2P Local File Streaming</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> Direct WebRTC</td>
                  <td>❌ Laggy Screen Grab</td>
                  <td>❌ Not Supported</td>
                  <td>❌ Choppy</td>
                </tr>
                <tr>
                  <td>Stereo Shared Audio Quality</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> Studio Stereo</td>
                  <td>⚠️ Voice Ducking</td>
                  <td>❌ Audio Sync Lag</td>
                  <td>❌ Mono Audio</td>
                </tr>
                <tr>
                  <td>Vertical Mobile Mode</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> Pinned 16:9 + Chat</td>
                  <td>❌ Small Clunky UI</td>
                  <td>❌ Desktop Only</td>
                  <td>⚠️ Video Hides Chat</td>
                </tr>
                <tr>
                  <td>Price & Limitations</td>
                  <td className={styles.highlightCol}><WPIconCheck size={18} color="#10b981" /> 100% Free Forever</td>
                  <td>⚠️ Nitro Paywall</td>
                  <td>⚠️ Paid Subscriptions</td>
                  <td>⚠️ 40-Min Limits</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ========================================================
            HOW IT WORKS (3 Simple Steps)
            ======================================================== */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTag}>
              <IconDeviceTv size={14} />
              <span>Simple & Instant</span>
            </div>
            <h2 className={styles.sectionTitle}>Get Started in 30 Seconds</h2>
            <p className={styles.sectionSubtitle}>
              No sign-ups, no software to install, no passwords.
            </p>
          </div>

          <div className={styles.stepsGrid}>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>01</div>
              <h3 className={styles.stepTitle}>Create a Room</h3>
              <p className={styles.stepText}>
                Tap the "Start Instant Room" button. Your private, encrypted watch room is spun up immediately.
              </p>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>02</div>
              <h3 className={styles.stepTitle}>Invite Your Friends</h3>
              <p className={styles.stepText}>
                Share your room URL or 6-digit code. Friends open it on any browser, tap join, and are right in.
              </p>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>03</div>
              <h3 className={styles.stepTitle}>Stream & Enjoy</h3>
              <p className={styles.stepText}>
                Pick a YouTube video, drop a movie file, or share your screen. Chat, react, and watch in sync!
              </p>
            </div>
          </div>
        </section>

        {/* ========================================================
            INTERACTIVE FAQ ACCORDION
            ======================================================== */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTag}>
              <IconSparkles size={14} />
              <span>Questions & Answers</span>
            </div>
            <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          </div>

          <div className={styles.faqList}>
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className={`${styles.faqCard} ${isOpen ? styles.faqCardOpen : ""}`}
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                >
                  <div className={styles.faqQuestion}>
                    <span>{faq.q}</span>
                    <WPIconChevronRight
                      size={18}
                      className={`${styles.faqChevron} ${isOpen ? styles.faqChevronOpen : ""}`}
                    />
                  </div>
                  {isOpen && <p className={styles.faqAnswer}>{faq.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* ========================================================
            FINAL CALL-TO-ACTION (CTA) BANNER
            ======================================================== */}
        <section className={styles.finalCtaSection}>
          <div className={styles.finalCtaCard}>
            <div className={styles.finalCtaGlow} />
            <div className={styles.finalCtaContent}>
              <div className={styles.badgePill} style={{ marginBottom: "16px" }}>
                <span className={styles.badgePulseDot} />
                <span>Ready to Watch?</span>
              </div>
              <h2 className={styles.finalCtaTitle}>
                Start Your Watch Party Now
              </h2>
              <p className={styles.finalCtaSubtitle}>
                Create your private room in 2 seconds. Free forever with zero registration or downloads.
              </p>
              <div className={styles.finalCtaButtons}>
                <Button
                  size="xl"
                  className={styles.primaryCtaBtn}
                  onClick={handleStartInstantRoom}
                  loading={isCreating}
                  leftSection={<WPIconPlus size={22} />}
                >
                  Start Instant Room
                </Button>
                <Button
                  size="xl"
                  variant="light"
                  color="cyan"
                  className={styles.secondaryCtaBtn}
                  onClick={() => setIsJoinModalOpen(true)}
                  leftSection={<WPIconLogin size={20} />}
                >
                  Join with Code
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Modal for Joining with Code */}
      <JoinRoomModal opened={isJoinModalOpen} onClose={() => setIsJoinModalOpen(false)} />
    </div>
  );
};

// Compatible export in case external references exist
export const Hero = (props: any) => null;
