# Phase 2 Security Audit: Server, Security, Config & Utilities

**Auditor:** Senior Application Security Engineer  
**Date:** 2026-11-21  
**Files Analyzed:** `server/server.ts`, `server/security.ts`, `server/config.ts`, `server/utils/postgres.ts`, `server/utils/redis.ts`, `server/utils/stripe.ts`, `server/utils/firebase.ts`, `server/utils/regex.ts`

---

## Executive Summary

The codebase has **multiple critical vulnerabilities** around SSRF/open proxy, authentication bypasses, and Express 5 middleware issues. The `/stream-proxy` and `/proxy/*` endpoints are **unrestricted open proxies** that can hit internal metadata services, Redis, Postgres, and cloud provider APIs. Rate limiting is in-memory only (bypassed by multi-IP). Auth checks have gaps allowing non-host room termination and state modification. SQL injection risk exists in dynamic query builders.

---

## 1. SSRF & Open Proxy Abuse

### [CRITICAL] `/stream-proxy` — Unrestricted SSRF to Internal Services
**Location:** `server/server.ts:1102-1183`

**Vulnerability:** The endpoint accepts any `url` parameter and **fetches it server-side** with zero validation:
```typescript
const rawUrl = req.query.url ? String(req.query.url).trim() : "";
// No allowlist, no blocklist, no IP validation
const resp = await axios.get(rawUrl, { headers: customHeaders, responseType: "arraybuffer", timeout: 12000 });
```

**Attack Vectors:**
| Target | Impact |
|--------|--------|
| `http://169.254.169.254/latest/meta-data/` | AWS/GCP/Azure instance metadata (IAM roles, SSH keys) |
| `http://127.0.0.1:6379` | Redis (if no auth) — `FLUSHALL`, `CONFIG SET` |
| `http://127.0.0.1:5432` | Postgres (if no auth) — arbitrary queries |
| `http://localhost:3100` | Internal VM worker admin endpoints |
| `http://localhost:8080/stats?key=...` | Internal stats endpoint |
| `file:///etc/passwd` | Local file read (if axios follows file://) |
| `http://internal-service:port` | Lateral movement in VPC |

**Bandwidth Abuse:** Attacker can proxy large files (ISOs, video) through your server — **unmetered egress**.

**Fix Required:**
1. Block RFC1918, loopback, link-local, multicast IPs via `dns.lookup` + IP range check
2. Allowlist known streaming domains (YouTube, CDN hostnames) or require admin key
3. Add per-IP bandwidth quota (bytes/sec)
4. Strip `headers` param — attacker can inject arbitrary headers to bypass WAFs

---

### [CRITICAL] `/proxy/*` — Path Traversal + SSRF via `host` Param
**Location:** `server/server.ts:1049-1099`

**Vulnerability:** User controls both `pathname` and `host` query param:
```typescript
const pathname = parsed.pathname.slice("/proxy".length);
const host = parsed.searchParams.get("host");
const resp = await axios.get("https://" + host + pathname);
```

**Exploits:**
1. **SSRF:** `GET /proxy/..%2F..%2F..%2Fetc%2Fpasswd?host=127.0.0.1:6379` → path traversal + internal Redis
2. **Header Injection:** `host=evil.com%0d%0aX-Injected:1` → CRLF injection into axios request (if not sanitized)
3. **Open Redirect:** `host=attacker.com` → your server proxies attacker content with your IP

**Fix Required:**
1. Validate `host` against allowlist (Twitch, known CDNs)
2. Reject `pathname` containing `..` or URL-encoded variants
3. Use `new URL(pathname, "https://" + host)` to resolve safely

---

### [HIGH] `resolveMediaUrl` — Recursive Proxy Chaining
**Location:** `server/utils/regex.ts:17-92` → called from `server.ts:642` (`startHosting`)

**Flow:** User provides URL → `resolveMediaUrl` extracts nested `url=` param → **rewrites to `/stream-proxy?url=...`** (line 83)

**Abuse:** Attacker crafts URL: `https://evil.com/video.m3u8?url=http://169.254.169.254/meta-data/iam/security-credentials/role`
→ Server fetches metadata credentials via `/stream-proxy`

**Fix:** In `resolveMediaUrl`, validate extracted URL against blocklist **before** rewriting to `/stream-proxy`.

---

### [MEDIUM] No Rate Limit on `/stream-proxy` or `/proxy/*`
**Location:** `server/server.ts:1102-1183`, `1049-1099` — **no `rateLimit()` middleware applied**

**Impact:** Single IP can proxy terabytes. Combine with SSRF → **amplification attack** against internal services.

---

## 2. Auth & Host Bypass

### [CRITICAL] `/terminateRoom` — Host Token Not Cryptographically Bound to Room
**Location:** `server/server.ts:619-665`

**Code:**
```typescript
const expectedHost = roomHosts.get(key);  // In-memory Map
const providedHost = String(req.body?.hostToken || "");
if (room && expectedHost && providedHost !== expectedHost) {
  res.status(403).json({ error: "only the host can terminate this room" });
  return;
}
```

**Issues:**
1. `roomHosts` is **in-memory only** — lost on restart, PM2 reload, or multi-shard deployment
2. `hostToken` = `crypto.randomBytes(24).toString("hex")` (room.ts:613) — **no roomId binding**, no expiry
3. If attacker obtains token (log leak, referral header), they can terminate **any room** on that shard
4. No signature verification — token is just a shared secret

**Fix:** Use signed JWT: `mintStreamKey(uid + ":" + roomId)` with short TTL, verify via `verifyStreamKey`.

---

### [CRITICAL] `/createRoom` — Capacity Check Race + Auth Bypass
**Location:** `server/server.ts:565-617`

**Race Condition:**
```typescript
const decodedEarly = await validateUserToken(req.body?.uid, req.body?.token);  // Line 572
if (rooms.size >= MAX_ROOMS) {  // Line 577 — CHECK
  res.status(503).json({ error: "Server is at capacity" });
  return;
}
// ... validation passes ...
const newRoom = new Room(io, name);  // Line 582 — USE
rooms.set(name, newRoom);  // Line 614
```

**Exploit:** Burst 100 concurrent `/createRoom` requests → all pass `rooms.size >= MAX_ROOMS` check (since `rooms.set` hasn't happened) → **exceed capacity**.

**Auth Bypass:** If `FIREBASE_ADMIN_SDK_CONFIG` not set, `decodedEarly` is `undefined` but check at line 573-575 only runs **if config exists**:
```typescript
if (config.FIREBASE_ADMIN_SDK_CONFIG && !decodedEarly) {  // Line 573
  res.status(401).json({ error: "Please sign in to start a party." });
  return;
}
```
→ **No auth required** when Firebase not configured.

---

### [HIGH] `/streamKey` — Admin Bypass via `X-Forwarded-For` Spoofing
**Location:** `server/server.ts:867-907`

**Code:**
```typescript
const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
```
**With `app.set("trust proxy", "loopback")` (line 145)**, `req.ip` comes from `X-Forwarded-For` header.

**Exploit:** Attacker sends `X-Forwarded-For: 127.0.0.1` → `isLocalhost = true` → **gets stream key without auth** (line 877).

**Fix:** Only trust `X-Forwarded-For` from known nginx IPs, or check `req.socket.remoteAddress` directly for localhost.

---

### [HIGH] `/stats` & `/timeSeries` — Static Key in Config, No Rotation
**Location:** `server/server.ts:504-529`, `server/config.ts:45`

**Code:**
```typescript
if (req.query.key && req.query.key === config.STATS_KEY)  // Line 505
```
- `STATIC_KEY` in `.env` — if leaked (logs, GitHub), **permanent access**
- No rate limit on these endpoints
- `/timeSeries` exposes all room metrics, user counts, timestamps

**Fix:** HMAC-signed tokens with expiry, or mTLS for admin endpoints.

---

### [MEDIUM] `CMD:lock` / `CMD:setRoomState` — Owner Check Uses Async `validateOwner` Without Await in Middleware
**Location:** `server/room.ts:341-345`, `350-352`

**Code:**
```typescript
socket.on("CMD:lock", async (data: unknown) => {
  const hasLock = validateLock();
  const isOwner = await validateOwner();  // Async!
  (hasLock || isOwner) && this.lockRoom(socket, data);
});
```
**Issue:** `validateOwner()` queries Postgres. If **two concurrent `CMD:lock`** from different users, both `await` resolve before either writes → **last write wins**, no serialization.

**Fix:** Use per-room mutex for owner-only operations.

---

## 3. Express 5 & Middleware Bugs

### [CRITICAL] Async Route Handlers — Uncaught Rejections Crash Process (Node 22+)
**Location:** Throughout `server/server.ts` — **no `.catch()` on async handlers**

**Examples:**
```typescript
app.post("/createRoom", rateLimit(RATE_LIMITS.rooms), async (req, res) => {  // Line 565
  // ... await validateUserToken ...
  // If validateUserToken throws → unhandled rejection → process.exit() in Node 22
});
app.post("/checkoutSub", async (req, res) => {  // Line 667
  // ... await stripe.checkout.sessions.create ...
});
app.get("/searchSubtitles", async (req, res) => {  // Line 297
  // ... multiple axios calls ...
});
```

**Express 5** does **not** auto-catch async errors. Must wrap:
```typescript
app.post("/createRoom", rateLimit(RATE_LIMITS.rooms), asyncHandler(async (req, res) => { ... }));
// or
app.post("/createRoom", rateLimit(RATE_LIMITS.rooms), (req, res, next) => {
  Promise.resolve(handler(req, res)).catch(next);
});
```

**Current mitigation:** `process.on("unhandledRejection", ...)` (line 75-77) logs but **does not prevent crash in Node 22+**.

---

### [CRITICAL] `rateLimit` — In-Memory Only, Bypassed by IP Rotation
**Location:** `server/security.ts:72-102`

**Issues:**
1. `buckets` Map is **per-process** — useless in multi-shard (each shard has own counter)
2. Key = `name:ip` — attacker rotates IPs (VPN, proxy, IPv6 /64) → **unlimited requests**
3. No Redis-backed store despite Redis available
4. `global` limit: 1200 req/5min = **4 req/sec** — too high for auth endpoints

**Critical bypass:** `/createRoom` uses `RATE_LIMITS.rooms` (30/5min) but **check happens AFTER rate limit** (line 565), so attacker can still burst.

---

### [HIGH] CORS — `origin: corsOrigin` Function Allows `undefined` Origin
**Location:** `server/security.ts:28-34`, `server/server.ts:148`

**Code:**
```typescript
export function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);  // Line 32 — ALLOWS NO ORIGIN
  callback(null, ORIGINS.has(origin.replace(/\/$/, "")));
}
```
```typescript
app.use(cors({ origin: corsOrigin, methods: ["GET", "POST", "OPTIONS"] }));  // Line 148
```

**Impact:** Requests with **no `Origin` header** (curl, native apps, server-to-server) pass CORS → **CSRF risk** for state-changing endpoints (`/createRoom`, `/terminateRoom`, `/checkoutSub`).

**Fix:** Require `Origin` header for mutating endpoints, or use CSRF tokens.

---

### [HIGH] `/subtitle/:hash` — No Input Validation on Hash, Path Traversal Risk
**Location:** `server/server.ts:186-201`

**Code:**
```typescript
app.get("/subtitle/:hash", async (req, res) => {
  const hash = req.params.hash;  // No validation!
  const key = "subtitle:" + hash;
  let buf = await redis?.getBuffer(key);
  // ...
});
```

**Risk:** If `hash` = `../../etc/passwd` and Redis key lookup fails → falls back to `memorySubtitleCache` (Map) → no traversal, but **if Redis key pattern used elsewhere** (e.g., `KEYS subtitle:*`), could enumerate.

**Fix:** Validate `hash` = `^[a-f0-9]{64}$` (SHA256 hex).

---

### [HIGH] Stripe Checkout — `return_url` User-Controlled, No Validation
**Location:** `server/server.ts:695-712`, `729-733`

**Code:**
```typescript
success_url: req.body.return_url,  // Line 709
cancel_url: req.body.return_url,   // Line 710
```
```typescript
const session = await createSelfServicePortal(customer.id, req.body?.return_url);  // Line 731
```

**Risk:** Attacker sets `return_url=https://evil.com/steal?session_id={CHECKOUT_SESSION_ID}` → Stripe redirects with session ID in URL → **session fixation / token leak**.

**Fix:** Validate `return_url` against allowlist (your domains only).

---

### [MEDIUM] `bodyParser.raw({ type: "text/plain", limit: 1000000 })` — 1MB Raw Body on All Routes
**Location:** `server/server.ts:151`

**Impact:** All routes accept 1MB raw text → **DoS via large bodies** on endpoints that don't need it.

**Fix:** Apply only to specific routes (e.g., `/subtitle` POST).

---

### [MEDIUM] Missing Security Headers
**Location:** `server/security.ts:37-45`

**Missing:**
- `Content-Security-Policy` — critical for XSS mitigation (YouTube iframe, TMDB images)
- `Strict-Transport-Security` — if HTTPS
- `Cross-Origin-Resource-Policy` — for media endpoints
- `Cross-Origin-Embedder-Policy` — for COOP/COEP isolation

---

## 4. Secret & Data Exposure

### [CRITICAL] Hardcoded TMDB API Key in Config
**Location:** `server/config.ts:66`

**Code:**
```typescript
TMDB_API_KEY: "4e44d9029b1270a757cddc766a1bcb63",  // HARDCODED SECRET
```

**Impact:** This key is **public in repo history**. Anyone can use your quota, get you banned, or trace usage to your account.

**Fix:** Remove default, require `process.env.TMDB_API_KEY` only.

---

### [CRITICAL] `STREAM_SECRET` Falls Back to Random Bytes — Breaks Key Rotation
**Location:** `server/security.ts:137-139`

**Code:**
```typescript
const STREAM_SECRET =
  process.env.SEC_STREAM_SECRET || crypto.randomBytes(32).toString("hex");
```

**Issue:** On every restart (deploy, crash, PM2 reload), **new random secret** → **all existing stream keys invalidated** → users kicked mid-film.

**Fix:** Require `SEC_STREAM_SECRET` in env; fail startup if missing.

---

### [HIGH] `STRIPE_SECRET_KEY` Defaults to Empty String — Silent Fail
**Location:** `server/config.ts:19`

**Code:**
```typescript
STRIPE_SECRET_KEY: "",  // Empty default
```
**In `stripe.ts:4`:** `new Stripe(config.STRIPE_SECRET_KEY, ...)` — Stripe throws on empty key but **only at first API call**, not startup.

**Fix:** Validate required keys at startup:
```typescript
if (!config.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY required");
```

---

### [HIGH] SQL Injection Risk in Dynamic Query Builders
**Location:** `server/utils/postgres.ts:30-87`

**Code:**
```typescript
// updateObject - table name interpolated directly
let query = `UPDATE ${table} SET ${columns.map((c, i) => `"${c}" = $${i + 1}`).join(",")}
  WHERE "${Object.keys(condition)[0]}" = $${Object.keys(object).length + 1}`;

// insertObject - table name interpolated
let query = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) ...`;

// upsertObject - table name + conflict columns interpolated
let query = `INSERT INTO ${table} ... ON CONFLICT (${Object.keys(conflict).map((k) => `"${k}"`).join(",")}) ...`;
```

**Risk:** `table` and column names come from **caller-controlled strings** (e.g., `room.ts:591` calls `insertObject(postgres, "room", roomObj)` — hardcoded "room" is safe, but **pattern is dangerous**).

**Fix:** Use allowlist for table names; never interpolate identifiers. Use `pg-format` or query builder.

---

### [HIGH] Firebase Admin SDK Config Parsed Without Validation
**Location:** `server/utils/firebase.ts:4-11`

**Code:**
```typescript
if (config.FIREBASE_ADMIN_SDK_CONFIG) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(config.FIREBASE_ADMIN_SDK_CONFIG)),
    ...
  });
}
```

**Risk:** Malformed JSON → `SyntaxError` at startup → **process crash**. No try/catch.

**Fix:** Wrap in try/catch; log error, continue without Firebase.

---

### [MEDIUM] Error Stack Traces Logged to Console (Not Returned to Client ✅)
**Location:** `server/security.ts:112-124` (`apiErrorHandler`)

**Good:** Client receives `"internal error"` for 5xx, not stack trace.

**But:** `console.error("[api] unhandled:", err?.message || err)` — **full error object logged** including stack. If logs shipped to third party (Datadog, Sentry), **secrets in error messages** (e.g., Stripe error with API key) could leak.

**Fix:** Sanitize errors before logging; use structured logger.

---

### [MEDIUM] Redis Connection String in Config — No TLS Verification
**Location:** `server/utils/redis.ts:6-8`

**Code:**
```typescript
if (config.REDIS_URL) {
  redis = new Redis(config.REDIS_URL);  // No tls options
}
```

**Risk:** If `REDIS_URL=redis://user:pass@host:6379` (no TLS), **credentials sent in cleartext** on network.

**Fix:** Require `rediss://` (TLS) or validate `config.REDIS_URL.startsWith("rediss://")`.

---

### [MEDIUM] Postgres SSL `rejectUnauthorized: false` — MITM Vulnerable
**Location:** `server/utils/postgres.ts:8`, `24`

**Code:**
```typescript
ssl: { rejectUnauthorized: false },
```

**Risk:** Accepts **any certificate** — vulnerable to MITM on untrusted networks.

**Fix:** Use `rejectUnauthorized: true` with CA cert, or at minimum validate hostname.

---

## Summary: Issue Rankings

| Rank | Issue | File:Line | Effort |
|------|-------|-----------|--------|
| **CRITICAL** | `/stream-proxy` unrestricted SSRF | server.ts:1102-1183 | High |
| **CRITICAL** | `/proxy/*` SSRF + path traversal | server.ts:1049-1099 | High |
| **CRITICAL** | `/terminateRoom` host token not bound to room | server.ts:619-665, room.ts:613 | Medium |
| **CRITICAL** | `/createRoom` capacity race + auth bypass | server.ts:565-617 | Medium |
| **CRITICAL** | Async handlers uncaught → Node 22 crash | server.ts:565, 667, 297, etc. | Low |
| **CRITICAL** | Hardcoded TMDB API key | config.ts:66 | Trivial |
| **CRITICAL** | `STREAM_SECRET` random fallback breaks keys | security.ts:137-139 | Trivial |
| **HIGH** | `/streamKey` localhost bypass via X-Forwarded-For | server.ts:867-907 | Low |
| **HIGH** | Rate limit in-memory, IP rotation bypass | security.ts:72-102 | Medium |
| **HIGH** | CORS allows no-origin → CSRF risk | security.ts:32, server.ts:148 | Low |
| **HIGH** | Stripe `return_url` user-controlled | server.ts:709-710, 731 | Low |
| **HIGH** | SQL injection pattern in query builders | postgres.ts:30-87 | Medium |
| **HIGH** | Firebase config parse crash on bad JSON | firebase.ts:4-11 | Low |
| **HIGH** | Postgres SSL `rejectUnauthorized: false` | postgres.ts:8, 24 | Low |
| **HIGH** | Redis plaintext credentials | redis.ts:6-8 | Low |
| **MEDIUM** | `resolveMediaUrl` recursive proxy chaining | regex.ts:83, server.ts:642 | Medium |
| **MEDIUM** | No rate limit on proxy endpoints | server.ts:1049, 1102 | Low |
| **MEDIUM** | `/subtitle/:hash` no validation | server.ts:186-201 | Trivial |
| **MEDIUM** | 1MB raw body parser on all routes | server.ts:151 | Low |
| **MEDIUM** | Missing CSP, HSTS, COEP headers | security.ts:37-45 | Medium |
| **MEDIUM** | Error logging may leak secrets | security.ts:120 | Low |

---

## Recommended Fix Order

1. **SSRF Blocklist** — Add IP validation middleware for `/stream-proxy` and `/proxy/*` (critical, stops RCE)
2. **Async Wrapper** — Add `asyncHandler` wrapper to all async routes (prevents Node 22 crashes)
3. **Hardcoded Secrets** — Remove TMDB key default, require `SEC_STREAM_SECRET` (trivial, high impact)
4. **Host Token** — Replace `roomHosts` Map with signed JWT bound to `roomId` + `uid`
5. **Rate Limit** — Migrate to Redis-backed store with per-IP + per-route limits
6. **CORS Fix** — Require `Origin` header for mutating endpoints
7. **Stripe Validation** — Allowlist `return_url` domains
8. **SQL Safety** — Allowlist table names in `postgres.ts` utilities
9. **SSL Hardening** — Enable `rejectUnauthorized: true` for Postgres/Redis
10. **Security Headers** — Add CSP (allow YouTube, TMDB), HSTS, COEP

---

## Appendix: SSRF Blocklist Implementation (Reference)

```typescript
// Add to security.ts
import { lookup } from "node:dns/promises";

const BLOCKED_RANGES = [
  /^127\./,           // Loopback
  /^10\./,            // RFC1918 Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // RFC1918 Class B
  /^192\.168\./,      // RFC1918 Class C
  /^169\.254\./,      // Link-local (metadata)
  /^::1$/,            // IPv6 loopback
  /^fe80::/,          // IPv6 link-local
  /^fd[0-9a-f]{2}:/,  // IPv6 ULA
];

async function isBlockedHost(hostname: string): Promise<boolean> {
  try {
    const { address } = await lookup(hostname, { family: 4 });
    return BLOCKED_RANGES.some(re => re.test(address));
  } catch {
    return true; // Fail closed
  }
}

// In /stream-proxy and /proxy/* handlers:
if (await isBlockedHost(parsedUrl.hostname)) {
  return res.status(403).json({ error: "Blocked destination" });
}
```

---

*End of Phase 2 Security Audit*