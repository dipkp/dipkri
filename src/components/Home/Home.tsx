import React, { useContext, useState, useEffect } from "react";
import { Button, Avatar } from "@mantine/core";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import { MetadataContext } from "../../MetadataContext";
import { createRoom } from "../TopBar/TopBar";
import { getUserImage } from "../../utils/utils";
import {
  WPIconPlus,
  WPIconLogin,
  WPIconLink,
  WPIconGoogle,
} from "../Icons/CustomIcons";
import styles from "./Home.module.css";

export const Home = () => {
  const context = useContext(MetadataContext);
  const [authResolved, setAuthResolved] = useState(
    Boolean(context.user || firebase.auth().currentUser)
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [roomInput, setRoomInput] = useState("");
  const [userImage, setUserImage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lastRoom, setLastRoom] = useState<string | null>(() => {
    try {
      return localStorage.getItem("wp_last_room");
    } catch {
      return null;
    }
  });
  const [activeParty, setActiveParty] = useState<{
    roomId: string;
    roomTitle?: string;
    mediaTitle?: string;
    savedTime?: number;
    paused?: boolean;
    updatedAt?: number;
  } | null>(() => {
    try {
      const raw = localStorage.getItem("wp_active_party");
      if (raw) return JSON.parse(raw);
    } catch {
      return null;
    }
    return null;
  });

  const formatPlaybackTime = (sec?: number) => {
    if (!sec || sec <= 0) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    }
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const handleTerminateParty = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetRoom = lastRoom || activeParty?.roomId;
    if (!targetRoom) return;

    try {
      fetch("/terminateRoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: targetRoom }),
      }).catch(() => {});
    } catch {}

    try {
      localStorage.removeItem("wp_last_room");
      localStorage.removeItem("wp_active_party");
      localStorage.removeItem(`wp_playback_${targetRoom}`);
    } catch {}
    setLastRoom(null);
    setActiveParty(null);
  };

  // Listen to auth state to resolve initial session without screen flicker
  useEffect(() => {
    let isMounted = true;
    try {
      setLastRoom(localStorage.getItem("wp_last_room"));
      const raw = localStorage.getItem("wp_active_party");
      if (raw) setActiveParty(JSON.parse(raw));
    } catch {}
    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
      if (!isMounted) return;
      setAuthResolved(true);
      if (user) {
        getUserImage(user).then((img) => {
          if (isMounted) setUserImage(img);
        });
        setError("");
      } else {
        setUserImage(null);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Update user avatar whenever context.user updates
  useEffect(() => {
    let isMounted = true;
    if (context.user) {
      getUserImage(context.user).then((img) => {
        if (isMounted) setUserImage(img);
      });
    } else {
      setUserImage(null);
    }
    return () => {
      isMounted = false;
    };
  }, [context.user]);

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setError("");
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
    } catch (err: any) {
      if (err?.code !== "auth/popup-closed-by-user") {
        console.error("Google sign-in error:", err);
        if (err?.code === "auth/unauthorized-domain") {
          setError(
            "This domain is not authorized in Firebase Console. Add it in Firebase Console > Authentication > Settings > Authorized domains.",
          );
        } else {
          setError(err?.message || "Failed to sign in with Google. Please try again.");
        }
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await firebase.auth().signOut();
    } catch (err) {
      console.error("Sign-out error:", err);
    }
  };

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
    if (!code && lastRoom) {
      code = lastRoom;
    }
    if (!code) return;
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
      try {
        localStorage.setItem("wp_last_room", code);
      } catch {}
      window.location.assign(`/watch/${code}`);
    }
  };

  const isLoggedIn = Boolean(context.user);

  return (
    <div className={styles.homeWrapper}>
      <div className={styles.ambientBackground}>
        <div className={styles.glowOrbCenter} />
        <div className={styles.gridOverlay} />
      </div>

      <div className={styles.container}>
        {/* Brand Art Centerpiece */}
        <div className={styles.brandArtContainer}>
          <div className={styles.artGlowEffect} />
          <img
            src="/dypkri-art.png"
            alt="Dypkri"
            className={styles.brandArtImage}
          />
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className={styles.errorAlert}>
            <span>{error}</span>
            <button
              type="button"
              className={styles.errorCloseBtn}
              onClick={() => setError("")}
            >
              ✕
            </button>
          </div>
        )}

        {/* 1. User Status or Google Sign-In Bar (ID / Account FIRST) */}
        {isLoggedIn ? (
          <div className={styles.userBar}>
            <div className={styles.userProfileRow}>
              <Avatar
                src={userImage}
                size={36}
                radius="xl"
                className={styles.userAvatar}
              />
              <div className={styles.userInfo}>
                <div className={styles.userName}>
                  {context.user?.displayName || "Google User"}
                </div>
                <div className={styles.userEmail}>{context.user?.email}</div>
              </div>
              <button
                type="button"
                className={styles.signOutBtn}
                onClick={handleSignOut}
                title="Sign out of Google"
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.googleBanner}>
            <div className={styles.googleBannerTitle}>
              Sign in to sync your rooms
            </div>
            <button
              type="button"
              className={`${styles.googleLoginBtn} ${styles.googleBannerBtn}`}
              onClick={handleGoogleSignIn}
              disabled={isLoggingIn}
            >
              <WPIconGoogle size={18} />
              <span>{isLoggingIn ? "Connecting..." : "Continue with Google"}</span>
            </button>
          </div>
        )}

        {/* 2. Active Watch Party Card - Persists permanently until user explicitly terminates it */}
        {(lastRoom || activeParty?.roomId) && (
          <div className={styles.activePartyCard}>
            <div className={styles.activePartyHeader}>
              <div className={styles.activePartyTitleRow}>
                <div className={styles.activePartyLiveDot} />
                <span className={styles.activePartyTitle}>
                  Active party:{" "}
                  <strong className={styles.activePartyRoomNumber}>
                    #{lastRoom || activeParty?.roomId}
                  </strong>
                </span>
                <span className={styles.activePartyLiveBadge}>
                  Live
                </span>
              </div>

              {activeParty?.mediaTitle && (
                <div
                  className={styles.activePartyMediaTitle}
                  title={activeParty.mediaTitle}
                >
                  🎬 {activeParty.mediaTitle}
                  {activeParty.savedTime && activeParty.savedTime > 0 ? (
                    <span className={styles.activePartySavedTime}>
                      ({formatPlaybackTime(activeParty.savedTime)})
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            <div className={styles.activePartyActions}>
              <Button
                size="xs"
                variant="gradient"
                gradient={{ from: "indigo", to: "cyan" }}
                onClick={() => window.location.assign("/watch/" + (lastRoom || activeParty?.roomId))}
                className={styles.activePartyResumeBtn}
              >
                Resume
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={handleTerminateParty}
                className={styles.activePartyTerminateBtn}
                title="End this watch party"
              >
                End
              </Button>
            </div>
          </div>
        )}

        {/* The Action Cards: New Room & Join Room - Side by Side & Minimalist */}
        <div className={styles.actionsGrid}>
          {/* Card 1: New Room */}
          <div className={styles.actionCard}>
            <div className={styles.actionHeader}>
              <div className={styles.actionIconWrapper}>
                <WPIconPlus size={18} />
              </div>
              <h3 className={styles.actionTitle}>New Room</h3>
            </div>

            <Button
              size="md"
              className={styles.newRoomBtn}
              onClick={handleStartInstantRoom}
              loading={isCreating}
              leftSection={<WPIconPlus size={16} />}
            >
              Create Room
            </Button>
          </div>

          {/* Card 2: Join Room */}
          <div className={styles.actionCard}>
            <div className={styles.actionHeader}>
              <div className={`${styles.actionIconWrapper} ${styles.actionIconJoin}`}>
                <WPIconLink size={18} />
              </div>
              <h3 className={styles.actionTitle}>Join Room</h3>
            </div>

            <form onSubmit={handleInlineJoin} className={styles.joinForm}>
              <div className={styles.joinInputWrapper}>
                <input
                  type="text"
                  className={styles.joinInput}
                  placeholder="Room code or link"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                />
                <button
                  type="submit"
                  className={styles.joinSubmitBtn}
                  disabled={!roomInput.trim()}
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

// Compatible export in case external references exist
export const Hero = (props: any) => null;
