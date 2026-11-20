import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Dependency-free API hardening.
 *
 * Everything here works with `node --experimental-strip-types` and needs no new
 * npm package, so it can be deployed without touching node_modules.
 */

const DEFAULT_ORIGINS = [
  "https://dipkri.duckdns.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins(): Set<string> {
  const extra = String(process.env.SEC_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

const ORIGINS = allowedOrigins();

/** Only our own site may call the API from a browser. */
export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) return callback(null, true); // curl, native clients, same-origin
  callback(null, ORIGINS.has(origin.replace(/\/$/, "")));
}

/** Cheap, safe headers. No CSP: the SPA loads YouTube frames and TMDB images. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.removeHeader("X-Powered-By");
  next();
}

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref?.();

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Allowed requests per key per window. */
  limit: number;
  /** Bucket name, so different routes do not share a counter. */
  name: string;
}

/**
 * Fixed-window in-memory limiter. Good enough for a single process; swap the
 * store for Redis when the app runs on several nodes.
 */
export function rateLimit({ windowMs, limit, name }: RateLimitOptions) {
  return function limiter(req: Request, res: Response, next: NextFunction): void {
    if (req.method === "OPTIONS") return next();

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(limit - 1));
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "too many requests", retryAfter });
      return;
    }

    next();
  };
}

const MAGNET_RE = /^magnet:\?[^#\s]*xt=urn:btih:[a-z0-9]{32,40}/i;

/** WebTorrent also accepts http(s) URLs and file paths; only magnets may pass. */
export function isMagnet(value: unknown): boolean {
  return typeof value === "string" && MAGNET_RE.test(value.trim());
}

/** Never leak stack traces to clients. */
export function apiErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode || 500);
  if (status >= 500) console.error("[api] unhandled:", err?.message || err);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? "internal error" : err?.message || "bad request",
  });
}

export const RATE_LIMITS = {
  global: { name: "global", limit: 1200, windowMs: 5 * 60_000 },
  stream: { name: "stream", limit: 900, windowMs: 60_000 },
  rooms: { name: "rooms", limit: 30, windowMs: 5 * 60_000 },
  subtitles: { name: "subtitles", limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateLimitOptions>;

// --- stream keys -------------------------------------------------------------
// A Firebase ID token lives one hour, which is shorter than a film. Instead the
// player proves who it is once and gets a signed key for the session.

const STREAM_SECRET =
  process.env.SEC_STREAM_SECRET || crypto.randomBytes(32).toString("hex");
const STREAM_KEY_TTL_MS = Number(process.env.SEC_STREAM_KEY_TTL_MS || 12 * 3600_000);

export function mintStreamKey(uid: string): string {
  const payload = `${uid}.${Date.now() + STREAM_KEY_TTL_MS}`;
  const sig = crypto.createHmac("sha256", STREAM_SECRET).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyStreamKey(value: unknown): string | null {
  const raw = String(value || "");
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = crypto.createHmac("sha256", STREAM_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [uid, exp] = payload.split(".");
  if (!uid || !Number(exp) || Number(exp) < Date.now()) return null;
  return uid;
}

/** No-op while no identity provider is configured, so playback never breaks. */
export function streamKeyGuard(enabled: boolean) {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (!enabled) return next();
    const value = (req.query?.key as string) || req.headers["x-stream-key"];
    if (verifyStreamKey(value)) return next();
    res.status(401).json({ error: "stream key required" });
  };
}
