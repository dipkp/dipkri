import React, { useCallback, useContext, useState } from "react";
import { serverPath, getUserImage } from "../../utils/utils";
import { desktopRoomEnd } from "../../utils/desktopStream";
import { Avatar, Tooltip, Modal } from "@mantine/core";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import { LoginModal } from "../Modal/LoginModal";
import { ProfileModal } from "../Modal/ProfileModal";
import Announce from "../Announce/Announce";
import { MetadataContext } from "../../MetadataContext";
import {
  WPIconPlus,
  WPIconLogin,
  WPIconSync,
} from "../Icons/CustomIcons";
import { JoinRoomModal } from "../Modal/JoinRoomModal";
import styles from "./TopBar.module.css";

export async function createRoom(
  user: firebase.User | undefined,
  openNewTab: boolean | undefined,
  video: string = "",
) {
  const uid = user?.uid;
  const token = await user?.getIdToken();

  const request = () =>
    fetch(serverPath + "/createRoom", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uid,
        token,
        video,
      }),
    });

  let response: Response;
  try {
    response = await request();
  } catch {
    // A deploy or a WiFi blip drops the first attempt; one retry fixes most of
    // them and turns the rest into an honest message.
    await new Promise((r) => setTimeout(r, 800));
    try {
      response = await request();
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
  }

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {}

  // Without this guard a failed create still navigated to "/watchundefined",
  // which looks exactly like "the room was never created".
  if (!response.ok || !data || typeof data.name !== "string" || !data.name) {
    const reason =
      (data && (data.error || data.message)) ||
      `HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}`;
    throw new Error(`Room creation failed: ${reason}`);
  }

  const name: string = data.name;
  const cleanName = (name || "").replace(/^\//, "");
  // Only the creator holds this; it is required to terminate the room later.
  if (data.hostToken && cleanName) {
    localStorage.setItem(`wp_host_${cleanName}`, String(data.hostToken));
  }
  if (cleanName) {
    try {
      localStorage.setItem("wp_last_room", cleanName);
    } catch {}
  }
  if (openNewTab) {
    window.open("/watch" + name);
  } else {
    window.location.assign("/watch" + name);
  }
}

export const NewRoomButton = (props: {
  size?: string;
  openNewTab?: boolean;
}) => {
  const context = useContext(MetadataContext);
  const onClick = useCallback(async () => {
    try {
      await createRoom(context.user, props.openNewTab);
    } catch (e: any) {
      console.error("New room failed:", e);
      alert(
        e?.message || "Could not create a room right now. Please try again.",
      );
    }
  }, [context.user, props.openNewTab]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.newRoomBtn}
      title="Create a new synced watch room"
    >
      <WPIconPlus size={14} />
      <span>New Room</span>
    </button>
  );
};

export const JoinRoomButton = (props: { size?: string }) => {
  const [opened, setOpened] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpened(true)}
        className={styles.joinBtn}
        title="Join an existing room using room code or link"
      >
        <WPIconLogin size={14} />
        <span>Join</span>
      </button>
      <JoinRoomModal opened={opened} onClose={() => setOpened(false)} />
    </>
  );
};

type SignInButtonProps = {};

export class SignInButton extends React.Component<SignInButtonProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = { isLoginOpen: false, isProfileOpen: false, userImage: null };

  async componentDidUpdate(prevProps: SignInButtonProps) {
    if (this.context.user && !this.state.userImage) {
      this.setState({ userImage: await getUserImage(this.context.user) });
    }
  }

  render() {
    if (this.context.user) {
      return (
        <div style={{ display: "inline-flex", alignItems: "center" }}>
          <div
            className={styles.userAvatarRing}
            onClick={() => this.setState({ isProfileOpen: true })}
            title={this.context.user.displayName || "Account Profile"}
          >
            <Avatar
              src={this.state.userImage}
              size={26}
              radius="xl"
            />
          </div>
          {this.state.isProfileOpen && this.context.user && (
            <ProfileModal
              userImage={this.state.userImage}
              close={() => this.setState({ isProfileOpen: false })}
            />
          )}
        </div>
      );
    }
    return (
      <React.Fragment>
        {this.state.isLoginOpen && (
          <LoginModal
            closeModal={() => this.setState({ isLoginOpen: false })}
          />
        )}
        <button
          type="button"
          className={styles.signInBtn}
          onClick={() => this.setState({ isLoginOpen: true })}
        >
          <WPIconLogin size={14} />
          <span>Sign In</span>
        </button>
      </React.Fragment>
    );
  }
}

export const TopBar = (props: {
  hideNewRoom?: boolean;
  hideSignin?: boolean;
  roomTitle?: string;
  roomDescription?: string;
  roomTitleColor?: string;
  roomId?: string;
  roomLock?: string;
  participantsCount?: number;
  isBehind?: boolean;
  onSync?: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const [isEndModalOpen, setIsEndModalOpen] = useState(false);

  const copyRoomLink = useCallback(() => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const handleConfirmEndParty = () => {
    setIsEndModalOpen(false);
    const cleanId = props.roomId?.replace(/^\//, "");
    try {
      fetch("/terminateRoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: cleanId,
          hostToken: cleanId ? localStorage.getItem(`wp_host_${cleanId}`) || "" : "",
        }),
      }).catch(() => {});
      desktopRoomEnd(cleanId);
      localStorage.removeItem("wp_last_room");
      localStorage.removeItem("wp_active_party");
      if (cleanId) localStorage.removeItem(`wp_playback_${cleanId}`);
    } catch {}
    window.location.assign("/");
  };

  const displayRoomCode = props.roomId ? `#${props.roomId.replace(/^\//, "")}` : "";

  return (
    <header className={styles.topBar}>
      {/* Left: Brand Logo + Compact Room Pill */}
      <div className={styles.leftSection}>
        <a
          href="/"
          className={styles.brandLink}
          title="dipkri — Back to Home"
        >
          <img
            src="/app-logo.png"
            alt="dipkri"
            className={styles.topbarAppLogo}
          />
          <span className={styles.brandName}>dipkri</span>
        </a>

        {displayRoomCode && (
          <Tooltip label={copied ? "Link Copied!" : "Click to copy room link"} withArrow>
            <button
              type="button"
              className={`${styles.roomPill} ${copied ? styles.roomPillCopied : ""}`}
              onClick={copyRoomLink}
            >
              <span>{copied ? "Copied! ✓" : (props.roomTitle || displayRoomCode)}</span>
            </button>
          </Tooltip>
        )}
      </div>

      {/* Center: Live Sync, Lock & Participant Badges */}
      <div className={styles.centerSection}>
        {props.roomId && (
          <Tooltip
            label={props.isBehind ? "Click to jump to room leader time" : "Video is perfectly synchronized"}
            withArrow
          >
            <div
              className={`${styles.statusPill} ${props.isBehind ? styles.syncBtnClickable : ""}`}
              onClick={props.isBehind ? props.onSync : undefined}
            >
              <span className={props.isBehind ? styles.syncDotBehind : styles.syncDot} />
              <span>{props.isBehind ? "Behind • Click to Sync" : "In Sync"}</span>
            </div>
          </Tooltip>
        )}

        {props.roomLock && (
          <Tooltip label="Room is locked: only the host can change media and playback" withArrow>
            <div className={styles.statusPill}>
              <span>🔒 Host Controls</span>
            </div>
          </Tooltip>
        )}

        {props.participantsCount !== undefined && props.participantsCount > 0 && (
          <div className={styles.statusPill} title={`${props.participantsCount} members in room`}>
            <span>👥 {props.participantsCount}</span>
          </div>
        )}
      </div>

      <Announce />

      {/* Right: Quick Share + New Room + Join + Sign In */}
      <div className={styles.rightSection}>
        {props.roomId && (
          <button
            type="button"
            className={styles.shareBtn}
            onClick={copyRoomLink}
            title="Copy invite link to share with friends"
          >
            <span>{copied ? "Copied! ✓" : "Share"}</span>
          </button>
        )}
        {props.roomId && (
          <button
            type="button"
            className={styles.terminateBtn}
            onClick={() => setIsEndModalOpen(true)}
            title="End this watch party for everyone"
          >
            <span>End Party</span>
          </button>
        )}
        {!props.hideNewRoom && <JoinRoomButton size="sm" />}
        {!props.hideNewRoom && <NewRoomButton size="sm" />}
        {!props.hideSignin && <SignInButton />}
      </div>

      <Modal
        opened={isEndModalOpen}
        onClose={() => setIsEndModalOpen(false)}
        title={<span style={{ fontWeight: 600, fontSize: 15, color: "#f87171" }}>End Watch Party</span>}
        centered
        styles={{
          content: {
            backgroundColor: "#121217",
            color: "#f8fafc",
            border: "1px solid #202026",
            borderRadius: 12,
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.8)",
          },
          header: {
            backgroundColor: "#121217",
            color: "#f8fafc",
            borderBottom: "1px solid #202026",
          },
          close: {
            color: "#a1a1aa",
            "&:hover": { backgroundColor: "#1e1e26" },
          },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "#a1a1aa", lineHeight: 1.5 }}>
            End this watch party for everyone? The room will be closed and removed from your active parties.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsEndModalOpen(false)}
              style={{
                background: "#121217",
                border: "1px solid #202026",
                color: "#a1a1aa",
                padding: "7px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmEndParty}
              style={{
                background: "#ef4444",
                border: "none",
                color: "#ffffff",
                padding: "7px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "none",
                transition: "all 0.15s ease",
              }}
            >
              End Party
            </button>
          </div>
        </div>
      </Modal>
    </header>
  );
};
