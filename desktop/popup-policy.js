"use strict";

/**
 * Which popups may open inside the app.
 *
 * Firebase `signInWithPopup` does not open accounts.google.com directly: it
 * opens `<project>.firebaseapp.com/__/auth/handler`, which then navigates to
 * Google. Blocking that host breaks Google sign-in, so the auth domains are
 * allowed together with the app origin and the OAuth providers themselves.
 */

const OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "accounts.youtube.com",
  "appleid.apple.com",
  "auth.openai.com",
]);

const AUTH_DOMAIN_SUFFIXES = [".firebaseapp.com", ".web.app", ".firebase.com"];

function isAllowedPopup(rawUrl, appOrigin) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (e) {
    return false;
  }

  if (url.origin === appOrigin) return true;
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (OAUTH_HOSTS.has(host)) return true;
  if (AUTH_DOMAIN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  // Google's own consent/redirect chain.
  if (host === "google.com" || host.endsWith(".google.com")) return true;

  return false;
}

module.exports = { isAllowedPopup, OAUTH_HOSTS, AUTH_DOMAIN_SUFFIXES };
