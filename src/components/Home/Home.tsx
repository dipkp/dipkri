import React, { useContext } from "react";
import { Button, Stepper } from "@mantine/core";
import {
  WPIconScreenshare,
  WPIconFile,
  WPIconSync,
  WPIconChat,
  WPIconPlaylist,
} from "../Icons/CustomIcons";
import {
  IconBrandYoutubeFilled,
  IconLink,
  IconVideo,
} from "@tabler/icons-react";
import { NewRoomButton, JoinRoomButton } from "../TopBar/TopBar";
import styles from "./Home.module.css";
import { MetadataContext } from "../../MetadataContext";

export const Home = () => {
  const { user } = useContext(MetadataContext);
  return (
    <div>
      <div className={styles.container}>
        <Hero
          heroText={"Watch videos together in real-time sync."}
          subText={"Stream YouTube, local files, screen shares, and video links with friends. 100% free with no registration or downloads."}
          action={
            <div className={styles.heroAction} style={{ display: "flex", gap: "14px", flexWrap: "wrap", justifyContent: "center" }}>
              <NewRoomButton size="xl" />
              <JoinRoomButton size="xl" />
            </div>
          }
          image={"/screenshot4.png"}
        />
        <div className={styles.featureSection}>
          <Feature
            Icon={IconBrandYoutubeFilled}
            title={`YouTube Sync`}
            text="Search and watch YouTube videos synchronously with real-time controls."
          />
          <Feature
            Icon={WPIconScreenshare}
            title={`Screen Share`}
            text="Share your screen, browser tab, or app with crystal-clear audio."
          />
          <Feature
            Icon={WPIconFile}
            title={`Local File Stream`}
            text="Stream any video or audio file directly from your device with zero limits."
          />
          <Feature
            Icon={IconLink}
            title={`Direct URLs`}
            text="Paste any MP4, HLS, or DASH video link for everyone to watch together."
          />
        </div>

        <Hero
          heroText={"React, chat, and connect together."}
          subText={"Experience movies and streams as if you're sitting on the same couch."}
          image={"/screenshot18.png"}
          color="green"
        />
        <div className={styles.featureSection}>
          <Feature
            Icon={WPIconSync}
            title="Millisecond Sync"
            text="Play, pause, and seek stay synchronized for everyone automatically."
          />
          <Feature
            Icon={WPIconChat}
            title="Real-Time Chat"
            text="Chat, reply, and send glowing reactions that float across the screen."
          />
          <Feature
            Icon={WPIconPlaylist}
            title="Queue & Playlists"
            text="Queue up videos and let the party roll uninterrupted."
          />
          <Feature
            Icon={IconVideo}
            title="Face-to-Face"
            text="Enable webcam and voice chat to see your friends' live reactions."
          />
        </div>

        <Hero
          heroText={"Distraction-free theater mode."}
          subText={
            "Immerse yourself with glowing ambient backgrounds and dynamic lighting."
          }
          image={"/screenshot14.png"}
        />
        <div className={styles.getStartedSection}>
          <div className={styles.heroText}>Get Started with dipkri</div>
          <div className={styles.stepperWrapper}>
            <Stepper active={-1} className={styles.stepper}>
              <Stepper.Step label="Create a Room" />
              <Stepper.Step label="Invite Friends" />
              <Stepper.Step label="Choose Media" />
              <Stepper.Step label="Enjoy Together!" />
            </Stepper>
          </div>
        </div>
      </div>
    </div>
  );
};

const Feature = ({
  Icon,
  text,
  title,
}: {
  Icon: React.ComponentType<any>;
  text: string;
  title: string;
}) => {
  return (
    <div className={styles.featureCard}>
      <div className={styles.iconGlowWrapper}>
        <div className={styles.iconGlow} />
        <Icon size={48} className={styles.featureIcon} />
      </div>
      <h4 className={styles.featureTitle}>{title}</h4>
      <div className={styles.featureText}>{text}</div>
    </div>
  );
};

export const Hero = ({
  heroText,
  subText,
  subText2,
  action,
  image,
  color,
}: {
  heroText?: string;
  subText?: string;
  subText2?: string;
  action?: React.ReactNode;
  image?: string;
  color?: string;
}) => {
  return (
    <div className={`${styles.hero} ${color === "green" ? styles.green : ""}`}>
      <div
        style={{ flexDirection: color === "green" ? "row-reverse" : undefined }}
        className={styles.heroInner}
      >
        <div className={styles.heroContent}>
          <div className={styles.heroText}>{heroText}</div>
          {subText && <div className={styles.subText}>{subText}</div>}
          {subText2 && <div className={styles.subText}>{subText2}</div>}
          {action}
        </div>
        <div className={styles.heroImageWrapper}>
          <img
            alt="dipkri preview"
            className={styles.heroImage}
            src={image}
          />
        </div>
      </div>
    </div>
  );
};
