import firebase from "firebase/compat/app";
import { getDesktopBridge } from "./desktopStream";
import clientConfig from "../config";

/**
 * Stream keys.
 *
 * A Firebase ID token lasts an hour, which is shorter than a film, so the
 * player trades it once for a signed key that covers the whole session. While
 * the server has no admin key it answers `{ key: "", required: false }` and the
 * URLs stay untouched.
 */

let cached: { key: string; at: number } | null = null;
const CLIENT_TTL_MS = 6 * 60 * 60 * 1000;

function authReady(timeoutMs = 5000): Promise<firebase.User | null> {
  const auth = firebase.auth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (user: firebase.User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    };
    const unsubscribe = auth.onAuthStateChanged((user) => finish(user));
    const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
  });
}

export async function getStreamKey(): Promise<string> {
  if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return cached.key;

  const user = await authReady();
  if (!user) return "";

  try {
    const idToken = await user.getIdToken();
    const res = await fetch("/streamKey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: idToken }),
    });
    if (!res.ok) return "";

    const data = await res.json();
    const key = typeof data?.key === "string" ? data.key : "";
    if (key) cached = { key, at: Date.now() };
    return key;
  } catch {
    return "";
  }
}

/** Appends `key=` when the server asked for one; a no-op otherwise. */
export async function withStreamKey(url: string): Promise<string> {
  const key = await getStreamKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}

export function forgetStreamKey(): void {
  cached = null;
}

/** Check if running inside Android APK or Electron Desktop shell with local sidecar */
export function isNativeApp(): boolean {
  return Boolean(getDesktopBridge()?.getSidecar);
}

/** Check if current user email matches configured admin list */
export function isUserAdmin(email?: string | null): boolean {
  if (!email) return false;
  const configured = clientConfig.VITE_ADMIN_EMAILS || "";
  const list = configured
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

/** Determines if the current client is allowed to stream torrents */
export function canStreamTorrents(email?: string | null): boolean {
  return true;
}

