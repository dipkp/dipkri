# dipkri — senior review (server + client)

Date: 2026-11-20 · Branch: `sec/api-hardening` · Reviewer: code read + live probes
Scope: `server/` (Express 5, Socket.IO, WebTorrent), `src/` (React/Vite), production behaviour.

Already fixed this week, **not** repeated below: wildcard CORS, unvalidated torrent
parameter, missing rate limits, port 8080 exposed, ReDoS in title cleanup,
missing security headers, unbounded temp cache on the server.

---

## 1. Critical

### 1.1 Anyone can terminate anyone's room
`server/server.ts:574-596`

```ts
app.post("/terminateRoom", async (req, res) => {
  const roomId = req.body?.roomId;      // no auth, no ownership check
  ...
  room.destroy(); rooms.delete(key);
```

The room code is visible to every viewer, so any viewer (or anyone who guesses a
6-digit code) can end the party for everybody. Rate limiting (30/5 min per IP)
slows it but does not stop it.

**Fix:** store the creator token when the room is created and require it here, or
sign a host token and check it. One `if` line plus a stored secret.

### 1.2 Unlimited rooms → OOM on a 1 GB box
`server/server.ts:571` (`rooms.set`), `server/room.ts:100` (1 s interval per room)

Nothing caps `rooms.size`. Each room holds a 1 s `setInterval`, a Socket.IO
namespace and a roster. A script that POSTs `/createRoom` (30/5 min per IP, but
many IPs) grows memory until the process dies and every room drops.

**Fix:** hard cap (e.g. 200 rooms), reject with 503, and evict rooms with no
sockets for N minutes. `/stats` already exposes `roomCount` (`server.ts:1162`) —
use the same counter for the cap.

## 2. High

### 2.1 Subtitle cache never shrinks
`server/server.ts:145, 198, 264`

`memorySubtitleCache` is a plain `Map` with a `set` but no `delete`, `clear` or
size limit. `POST /subtitle` accepts up to 1 MB of raw body per call
(`bodyParser.raw({ limit: 1000000 })`), so ~900 calls fill the VM's RAM and the
process is killed. The 60/min limit helps, but it is per IP.

**Fix:** cap entries (e.g. 200) with LRU + TTL, or store subtitles on disk.

### 2.2 Torrent endpoints still anonymous
`server/server.ts:716-721`

`/data`, `/stream`, `/streamAudio`, `/streamInfo`, `/streamSubtitle` accept a
magnet from anyone. They are rate limited now, but a single IP can still make the
server join a swarm, burn bandwidth and fill the disk (the 3 GB reserve only
kicks in late).

**Fix:** require a Firebase ID token (admin SDK is not configured yet, so this
needs `FIREBASE_ADMIN_SDK_CONFIG`) or a short-lived signed room token issued at
room join. Then the limit is per user, not per IP.

### 2.3 Socket.IO private API in the room lifecycle
`server/server.ts:595`

```ts
io._nsps.delete(key);   // private map
```

`_nsps` is internal. A Socket.IO upgrade silently changes it and every terminated
room leaks its namespace (memory + handlers). Also `io.of(key)` on every connect
creates namespaces that are only removed here.

**Fix:** track namespace refcounts yourself, or call the documented
`io.of(name).disconnectSockets(true)` and let Socket.IO own the map.

## 3. Medium

### 3.1 The UI never shows the new API errors
`src/` — no reference to `429` or `507`

The server now answers `429` (rate limit), `507` (disk full) and `400`
(invalid magnet). The client only has generic `.catch(() => {})` in several
places (`MovieModal.tsx:121-130`, `Home.tsx:71`, `VideoChat.tsx:378`). A user who
hits a limit or a full disk sees the player stall with no explanation.

**Fix:** one error surface: read `res.status` / `res.json().error` and show a
toast ("Server is busy, retry in a minute" / "Server storage is full").

### 3.2 Restart drops every room with no warning
Rooms live only in memory (`rooms` map); there is no database (`DATABASE_URL`
empty) and no drain step. A deploy or crash ends every party instantly.

**Fix:** on `SIGTERM`, emit a system chat message + `REC:end` before exit, and
show a "host is restarting" state on the client. Cheap and honest.

### 3.3 First load is heavy
Latest build: `index 1.59 MB`, `mediabunny 1.15 MB`, `dash.all 989 KB`,
`hls 522 KB` (uncompressed).

Mobile users on 3G wait seconds before the room UI paints.

**Fix:** lazy-load the player stack (`React.lazy`) behind the first play click;
most visitors land on Home and never need dash/hls.

### 3.4 No retention policy for logs
`~/.pm2/logs/watchparty-*.log` grow forever and contain client IPs and magnet
names. On a 45 GB disk that is also a slow disk leak.

**Fix:** `pm2 install pm2-logrotate` (10 MB, keep 7) and stop logging magnets in
production.

## 4. What is already solid

- `room.destroy()` clears its interval (`server/room.ts:463-467`) — no timer leak per room.
- Torrent cache sweeper evicts idle torrents and respects an active stream (`server/torrent.ts:95-140`).
- Rate limiter, CORS allowlist, magnet-only validation and security headers are live
  and verified against production.
- Client has no `dangerouslySetInnerHTML` and no token in `localStorage`.

## 5. Suggested order

1. 1.1 room ownership (30 min) — directly user-facing abuse.
2. 1.2 room cap (30 min) — protects the box.
3. 2.1 subtitle cache bound (30 min) — protects the box.
4. 3.1 error surface (1 h) — makes the new limits understandable.
5. 2.2 stream auth (half day) — needs the Firebase admin key.

---

## 6. Status (2026-11-20, branch `sec/api-hardening`)

| Item | Status |
|---|---|
| 1.1 host-only termination | fixed, live (403 without the host token) |
| 1.2 room cap | fixed, live (MAX_ROOMS=200 -> 503) |
| 2.1 subtitle cache bound | fixed, live (LRU 150 + 24 h TTL) |
| 2.3 private socket.io namespace | guarded in `dropNamespace()`, logs instead of throwing |
| 3.1 UI error surface | fixed, live (player explains 400/404/429/507) |
| 3.2 restart drops rooms | fixed: SIGTERM/SIGINT now tells every room and exits cleanly |
| 3.4 log retention | fixed: pm2-logrotate, 10 MB x 7, compressed |
| 2.2 stream auth per user | **implemented, off**: `/streamKey` + HMAC guard; switches on automatically when FIREBASE_ADMIN_SDK_CONFIG is set |
| 3.3 bundle size | **partly**: dashjs is type-only now; a vendor split was measured and reverted (it grew the initial payload), route-level splitting is the next step |
