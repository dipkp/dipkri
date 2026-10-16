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
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [roomInput, setRoomInput] = useState("");
  const [userImage, setUserImage] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    if (context.user) {
      getUserImage(context.user).then((img) => {
        if (isMounted) setUserImage(img);
      });
      setError("");
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
    if (!context.user) {
      setError("Please complete Step 1 (Sign in with Google) first.");
      handleGoogleSignIn();
      return;
    }
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
    if (!context.user) {
      setError("Please complete Step 1 (Sign in with Google) first.");
      handleGoogleSignIn();
      return;
    }
    let code = roomInput.trim();
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
      window.location.assign(`/watch/${code}`);
    }
  };

  const isLoggedIn = Boolean(context.user);

  return (
    <div className={styles.homeWrapper}>
      {/* Background Ambience */}
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

        {/* ========================================================
            STEP 1: GOOGLE LOGIN
            ======================================================== */}
        <section className={styles.stepSection}>
          {!isLoggedIn ? (
            <div className={styles.stepCard}>
              <div className={styles.stepBadgeRow}>
                <span className={styles.stepBadge}>STEP 1</span>
                <span className={styles.stepStatusText}>Required</span>
              </div>
              <h2 className={styles.stepTitle}>Sign in with Google</h2>
              <p className={styles.stepSubtitle}>
                Sign in to create your private room or join friends in millisecond sync.
              </p>

              <button
                type="button"
                className={styles.googleLoginBtn}
                onClick={handleGoogleSignIn}
                disabled={isLoggingIn}
              >
                <WPIconGoogle size={20} />
                <span>{isLoggingIn ? "Connecting to Google..." : "Continue with Google"}</span>
              </button>
            </div>
          ) : (
            <div className={`${styles.stepCard} ${styles.stepCardDone}`}>
              <div className={styles.userProfileRow}>
                <Avatar
                  src={userImage}
                  size={46}
                  radius="xl"
                  className={styles.userAvatar}
                />
                <div className={styles.userInfo}>
                  <div className={styles.userBadgeLine}>
                    <span className={styles.stepDoneBadge}>✓ STEP 1 COMPLETED</span>
                  </div>
                  <div className={styles.userName}>
                    {context.user?.displayName || "Google User"}
                  </div>
                  <div className={styles.userEmail}>{context.user?.email}</div>
                </div>
                <button
                  type="button"
                  className={styles.signOutBtn}
                  onClick={handleSignOut}
                  title="Sign out of account"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ========================================================
            STEP 2: NEW ROOM & JOIN ROOM
            ======================================================== */}
        <section className={styles.stepSection}>
          <div className={styles.stepBadgeRow}>
            <span className={`${styles.stepBadge} ${isLoggedIn ? styles.stepBadgeActive : ""}`}>
              STEP 2
            </span>
            <span className={styles.stepStatusText}>
              {isLoggedIn ? "Ready to watch" : "Unlocks after Google Sign-In"}
            </span>
          </div>

          <div className={styles.actionsGrid}>
            {/* Action 1: New Room */}
            <div className={`${styles.actionCard} ${!isLoggedIn ? styles.actionCardLocked : ""}`}>
              <div className={styles.actionHeader}>
                <div className={styles.actionIconWrapper}>
                  <WPIconPlus size={22} />
                </div>
                <div>
                  <h3 className={styles.actionTitle}>New Room</h3>
                  <p className={styles.actionDesc}>
                    Start an instant synchronized room for YouTube, movies & screen shares.
                  </p>
                </div>
              </div>

              <Button
                size="lg"
                className={styles.newRoomBtn}
                onClick={handleStartInstantRoom}
                loading={isCreating}
                leftSection={<WPIconPlus size={18} />}
              >
                Create New Room
              </Button>
            </div>

            {/* Action 2: Join Room */}
            <div className={`${styles.actionCard} ${!isLoggedIn ? styles.actionCardLocked : ""}`}>
              <div className={styles.actionHeader}>
                <div className={`${styles.actionIconWrapper} ${styles.actionIconJoin}`}>
                  <WPIconLogin size={22} />
                </div>
                <div>
                  <h3 className={styles.actionTitle}>Join Room</h3>
                  <p className={styles.actionDesc}>
                    Enter a room code or paste an invite link to jump right into the party.
                  </p>
                </div>
              </div>

              <form onSubmit={handleInlineJoin} className={styles.joinForm}>
                <div className={styles.joinInputWrapper}>
                  <WPIconLink size={18} className={styles.joinInputIcon} />
                  <input
                    type="text"
                    placeholder="Enter code or paste link..."
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    className={styles.joinInput}
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  variant="light"
                  color="cyan"
                  className={styles.joinSubmitBtn}
                  leftSection={<WPIconLogin size={18} />}
                >
                  Join Room
                </Button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// Compatible export in case external references exist
export const Hero = (props: any) => null;
