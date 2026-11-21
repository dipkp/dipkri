"use strict";

/**
 * Which popups may open inside the app.
 *
 * Firebase `signInWithPopup` does not open accounts.google.com directly: it
 * opens `<project>.firebaseapp.com/__/auth/handler`, which then navigates to
 * Google. Blocking that host breaks Google sign-in, so exactly one auth domain
 * is allowed, plus the identity provider pages themselves.
 *
 * Deliberately not wildcards: anyone can host a site on *.web.app or
 * *.firebaseapp.com, and sites.google.com is user content.
 */

const IDENTITY_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);

function normaliseHost(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch (e) {
    return "";
  }
}

function isAllowedPopup(rawUrl, appOrigin, authDomain) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (e) {
    return false;
  }

  if (url.origin === appOrigin) return true;
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (IDENTITY_HOSTS.has(host)) return true;

  const allowedAuth = normaliseHost(authDomain);
  return Boolean(allowedAuth) && host === allowedAuth;
}

module.exports = { isAllowedPopup, normaliseHost, IDENTITY_HOSTS };
