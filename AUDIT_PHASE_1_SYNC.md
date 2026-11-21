# Phase 1 Sync Audit: Room Synchronization & Playback Flow

**Auditor:** Principal Real-Time Systems Architect  
**Date:** 2026-11-21  
**Files Analyzed:** `server/room.ts`, `src/components/App/App.tsx`, `src/components/Controls/Controls.tsx`

---

## Executive Summary

The synchronization architecture uses a **leader-based timestamp model** with server-authoritative `videoTS` and client-reported `tsMap` (per-client offsets). The host (creatorUid) controls playback; clients passively sync to the median of `tsMap` values. While the design is fundamentally sound, several critical issues exist around **sync loops, race conditions, host lifecycle, and event mismatches**.

---

## 1. Sync Loops & Drift

### [CRITICAL] Infinite Seek Loop: Client `seeked` → `CMD:seek` → Server `REC:seek` → Client `localSeek` → `seeked`...
**Location:** `server/room.ts:947-955` (`seekVideo`) → `src/components/App/App.tsx:744-749` (`REC:seek`) → `src/components/App/App.tsx:2598-2610` (`onVideoEvent`)

**Flow:**
1. Host calls `roomSeek(time)` → emits `CMD:seek` (App.tsx:2826)
2. Server `seekVideo()` sets `videoTS = data`, broadcasts `REC:seek(data)` to **all clients including host** (room.ts:952)
3. Host receives `REC:seek`, sets `isRemoteSyncing=true`, calls `localSeek(data)` (App.tsx:745-746)
4. `localSeek` calls `Player().seekVideo(target)` (App.tsx:2714)
5. Video element fires `seeked` event → `onVideoEvent` fires (App.tsx:2601-2607)
6. **BUG:** `isRemoteSyncing` is cleared after **600ms timeout** (App.tsx:747-748), but `seeked` may fire **before** or **after** this window
7. If `seeked` fires while `isRemoteSyncing=false`, host re-emits `CMD:seek` → **loop**

**Why it happens:** The 600ms fixed timeout is a race against browser seek latency. On slow devices or heavy videos, `seeked` fires after 600ms → loop. On fast seeks, it fires before → no loop (but flaky).

**Evidence:** App.tsx:360-362 comment acknowledges this: *"the iframe's echo must not be sent back as CMD:seek or the room ping-pongs forever."*

**Fix:** Use a **seek token/sequence ID** instead of timeout. Server includes unique `seekId` in `REC:seek`; client echoes it back in `CMD:seek`; server ignores `CMD:seek` with matching `seekId` from host.

---

### [HIGH] Drift Correction Fights Buffering: Dynamic Playback Rate (0.9x–1.1x) Applied During Buffer/Stall
**Location:** `src/components/App/App.tsx:1390-1420` (`REC:tsMap` handler)

**Issue:** The `tsMap` handler adjusts `playbackRate` based on `leader - clientId` delta **every second**, even when:
- Video is buffering (`readyState < 2`)
- Video is stalled (`waiting` event)
- Network congestion causes temporary lag

**Result:** Client speeds up to 1.1x during buffer, then overshoots when buffer fills, then slows to 0.9x → **oscillation** (warble). The 0.02 debounce (App.tsx:1417) is too small for network jitter.

**Fix:** Only apply drift correction when `!video.paused && video.readyState >= 3 (HAVE_FUTURE_DATA) && !video.seeking`. Add hysteresis: require sustained delta > 1s for 3+ seconds before adjusting.

---

### [MEDIUM] `preventTSUpdate` Race on Video Change
**Location:** `server/room.ts:581-582` (`cmdHost`) vs `server/room.ts:983-986` (`setTimestamp`)

**Flow:**
1. `cmdHost` sets `preventTSUpdate = true` for 1000ms when video changes
2. During this 1s window, client `CMD:ts` updates are **ignored** for `videoTS` but still update `tsMap`
3. If host seeks during this window, their `videoTS` doesn't update but `tsMap` does
4. Other clients' `getLeaderTime()` reads stale `tsMap` including host's stale entry

**Impact:** Brief desync on video transitions (playlist next, new host).

---

## 2. Race Conditions

### [CRITICAL] Dual Host Seek / Video Change at Same Millisecond
**Location:** `server/room.ts:279-295` (`CMD:play/pause/seek/playbackRate` handlers) — **no serialization**

**Scenario:** Two users (both with `creatorUid` due to bug or admin) call `seekVideo` simultaneously:
1. User A: `seekVideo(socketA, 100)` → sets `videoTS = 100`, broadcasts `REC:seek(100)`
2. User B: `seekVideo(socketB, 200)` → sets `videoTS = 200`, broadcasts `REC:seek(200)`
3. Clients receive both; last one wins → **non-deterministic final position**

**Root Cause:** No mutex/lock around playback state mutations. JavaScript is single-threaded but async handlers can interleave if `await` is used (none here, but `validateHost` is sync).

**Fix:** Add a `playbackLock` (simple boolean) or queue playback commands. Since only one host should exist, validate `creatorUid` strictly and reject if mismatch.

---

### [HIGH] User Joins Mid-Buffer: Stale `roomVideoTS` vs Live `tsMap`
**Location:** `src/components/App/App.tsx:768-812` (`REC:host` handler) + `server/room.ts:518-529` (`getHostState`)

**Flow:**
1. Room playing at t=500s, host paused at t=480s (buffering)
2. New user joins → receives `REC:host` with `videoTS=480` (host's paused position)
3. Client starts loading video at t=480
4. Client's `tsInterval` emits `CMD:ts` with local time (~0, just started)
4. Server `tsMap` now has new user at ~0, host at 480
5. `getLeaderTime()` returns median (480) or max (480) — **correct for host**
6. But if host **resumes** before new user buffers, host's `tsMap` advances, new user's lags
7. New user's drift correction **speeds up to 1.1x** trying to catch up to host's advancing position
8. If new user buffers again, oscillation

**Fix:** In `REC:host`, include `serverTimestamp: Date.now()` and host's `tsMap` entry. Client computes `expectedTime = videoTS + (Date.now() - serverTimestamp)/1000` for initial seek.

---

### [HIGH] Playlist Auto-Advance Race: `onVideoEnded` vs Host Manual Next
**Location:** `src/components/App/App.tsx:3155-3180` (`onVideoEnded`) + `server/room.ts:762-780` (`playlistNext`)

**Scenario:**
1. Video ends → `onVideoEnded` fires → emits `CMD:playlistNext(url)` (App.tsx:3165)
2. Host **manually** clicks next at same time → `roomSeek` → `CMD:seek` + `CMD:playlistNext`
3. Server `playlistNext` validates `data === this.video` (room.ts:766-773) but **race**: both pass
4. Two `cmdHost` calls → playlist shifts twice → skips a video

**Fix:** Server-side `playlistNext` should be idempotent per `roomId` + `video` combo, or use a version counter.

---

## 3. Host & Lifecycle Bugs

### [CRITICAL] Host Disconnect: No Host Transfer, Room Orphaned
**Location:** `server/room.ts:1586-1609` (`onDisconnect`) — **no host migration logic**

**Current Behavior:**
- `creatorUid` set at room creation (room.ts:598-599), **never changes**
- If host disconnects: `roster` removes them, but `creatorUid` stays
- `validateHost()` (room.ts:239-245) checks `socket.uid === this.creatorUid` → **no one can control playback**
- Room becomes read-only until host reconnects or room destroyed

**Impact:** Entire room loses playback control. Users cannot play/pause/seek.

**Fix:** Implement host transfer:
1. On host disconnect, promote oldest subscriber or first roster member as new `creatorUid`
2. Emit `REC:host` with new controller state
3. Persist to Postgres immediately

---

### [HIGH] `terminateRoom` Cleanup Gaps
**Location:** `server/server.ts:619-665` (`terminateRoom`) + `server/room.ts:481-485` (`destroy`)

**Missing Cleanup:**
| Resource | Cleaned? | Risk |
|----------|----------|------|
| `tsInterval` | ✅ `room.destroy()` clears | — |
| Socket.IO namespace | ✅ `dropNamespace()` | — |
| Redis keys (`roomCounts:`, `roomRosters:`) | ❌ **No** | Memory leak, stale metrics |
| Postgres `room` row | ✅ `DELETE` | — |
| `vBrowser` VM | ✅ `stopVBrowserInternal()` | — |
| `roomHosts` map | ✅ `delete` | — |
| `rooms` map | ✅ `delete` | — |
| `socketIdMap`, `tsMap`, `nameMap`, `pictureMap` | ⚠️ In-memory only | If room reloaded from Postgres, stale maps |

**Critical:** `minuteMetrics()` (server.ts:1304-1357) writes `roomCounts:${roomId}` and `roomRosters:${roomId}` to Redis every 60s. **Never deleted on terminate.** Accumulates indefinitely.

---

### [HIGH] Empty Room Cleanup: `saveRooms()` Doesn't Delete Redis Keys
**Location:** `server/server.ts:1215-1256` (`saveRooms`)

**Code:** Unloads empty rooms from memory after 8h idle (line 1227), calls `room.saveRoom()` and `room.destroy()`, but **does not delete** `roomCounts:${roomId}` / `roomRosters:${roomId}` from Redis.

**Result:** Redis grows unbounded with dead room keys. `minuteMetrics` continues writing for rooms no longer in memory (skipped by `rooms.has()` check but Redis keys persist).

---

### [MEDIUM] `vBrowserQueue` Not Cleared on Room Terminate
**Location:** `server/server.ts:648-652` calls `removeTorrent` but **not** `vBrowserQueue = undefined`

**Impact:** If room recreated with same ID (unlikely but possible), stale queue could trigger spurious VM assignment.

---

## 4. State Mismatches: Server ↔ Client Events

### [CRITICAL] `REC:host` Payload Shape Mismatch
**Server emits** (`room.ts:518-529` `getHostState`):
```typescript
{
  video: string,
  videoTS: number,
  subtitle: string,
  playbackRate: number,
  paused: boolean,
  isVBrowserLarge: boolean,
  controller: string | undefined,
  loop: boolean,
}
```

**Client expects** (`App.tsx:768-812` `REC:host` handler):
```typescript
{
  video: string,
  videoTS: number,        // used as data.videoTS ?? 0
  subtitle: string,       // used as data.subtitle || ""
  playbackRate: number,   // used as data.playbackRate
  paused: boolean,        // used as data.paused
  loop: boolean,          // used as data.loop
  isVBrowserLarge: boolean, // used
  controller: string,     // used
}
```

**Mismatch:** Server sends `controller` as `string | undefined`; client treats as `string`. If `undefined`, `this.setState({ controller: undefined })` — **React warning** in dev, works in prod but inconsistent.

**Fix:** Server: `controller: this.vBrowser?.controllerClient ?? ""`

---

### [HIGH] `REC:seek` Payload: Server Sends Number, Client Expects Number ✅
**Server:** `socket.broadcast.emit("REC:seek", data)` where `data: number` (room.ts:952)  
**Client:** `socket.on("REC:seek", (data: number) => ...)` (App.tsx:744)  
✅ **Match**

---

### [HIGH] `REC:playbackRate` Payload: Server Sends Number, Client Expects Number ✅
**Server:** `io.of(this.roomId).emit("REC:playbackRate", Number(data))` (room.ts:962)  
**Client:** `socket.on("REC:playbackRate", (data: number) => ...)` (App.tsx:751)  
✅ **Match**

---

### [HIGH] `REC:subtitle` Payload: Server Sends String, Client Expects String ✅
**Server:** `io.of(this.roomId).emit("REC:subtitle", this.subtitle)` (room.ts:1354)  
**Client:** `socket.on("REC:subtitle", (data: string) => ...)` (App.tsx:757)  
✅ **Match**

---

### [HIGH] `REC:loop` Payload: Server Sends Boolean, Client Expects Boolean ✅
**Server:** `io.of(this.roomId).emit("REC:loop", data)` (room.ts:976)  
**Client:** `socket.on("REC:loop", (data: boolean) => ...)` (App.tsx:762)  
✅ **Match**

---

### [HIGH] `REC:changeController` Payload: Server Sends String, Client Expects String ✅
**Server:** `io.of(this.roomId).emit("REC:changeController", data)` (room.ts:1345)  
**Client:** `socket.on("REC:changeController", (data: string) => ...)` (App.tsx:765)  
✅ **Match**

---

### [HIGH] `REC:chat` Payload Mismatch: Server Sends `ChatMessage`, Client Expects `ChatMessage` ✅
**Server:** `addChatMessage` emits full `ChatMessage` (room.ts:602-613)  
**Client:** Receives as `ChatMessage` (App.tsx:1292) — **matches but fragile**

**Risk:** Server `ChatMessage` includes `isSub`, `replyToId`, `replyToTimestamp`, `replyToUserId`, `replyToMsg` — client doesn't use all. Adding fields is safe; removing breaks.

---

### [MEDIUM] `REC:tsMap` — Server Emits Full Map Every Second, Client Replaces Entire State
**Server:** `io.of(roomId).emit("REC:tsMap", this.tsMap)` (room.ts:112) — **every 1s**  
**Client:** `setState({ tsMap: data })` (App.tsx:1390) — full replace

**Issue:** `tsMap` grows with every connected client. With 50 users, 50 entries × 1s = 50 objects/sec broadcast. Clients re-render on every `tsMap` update (via `setState` in `REC:tsMap` handler which calls `getLeaderTime()` → `setState` indirectly via playback rate change).

**Optimization:** Only emit changed entries, or throttle to 2s. Client should memoize `getLeaderTime()`.

---

### [MEDIUM] `REC:nameMap` / `REC:pictureMap` — Full Map Replace on Every Change
**Server:** Emits full map on every `CMD:name` / `CMD:picture` (room.ts:623, 631)  
**Client:** `setState({ nameMap: data })` (App.tsx:1431-1435)

**Issue:** Same as `tsMap` — full replace triggers re-renders. With frequent name/picture changes (rare but possible), wasted renders.

---

### [LOW] Unhandled Server Events on Client
| Server Event | Emitted In | Client Handler | Status |
|--------------|------------|----------------|--------|
| `REC:addReaction` | room.ts:1089 | App.tsx:1352 | ✅ Handled |
| `REC:removeReaction` | room.ts:1116 | App.tsx:1377 | ✅ Handled |
| `REC:chatSeen` | room.ts:1661 | App.tsx:1327 | ✅ Handled |
| `REC:reaction` | room.ts:313-318 | App.tsx:1343 | ✅ Handled |
| `REC:lock` | room.ts:1364 | App.tsx:1437 | ✅ Handled |
| `roster` | room.ts:509 | App.tsx:1440 | ✅ Handled |
| `chatinit` | room.ts:1643 | App.tsx:1445 | ✅ Handled |
| `playlist` | room.ts:776, 884 | App.tsx:1448 | ✅ Handled |
| `signalSS` | room.ts:1582 | App.tsx:1451 | ✅ Handled |
| `errorMessage` | room.ts:284, etc | App.tsx:723 | ✅ Handled |
| `successMessage` | room.ts:1560 | App.tsx:729 | ✅ Handled |
| `kicked` | room.ts:1620 | App.tsx:735 | ✅ Handled |

**All server→client events appear handled.** Good.

---

### [LOW] Unhandled Client Events on Server
| Client Event | Emitted In | Server Handler | Status |
|--------------|------------|----------------|--------|
| `CMD:name` | App.tsx | room.ts:257-259 | ✅ |
| `CMD:picture` | App.tsx | room.ts:260-262 | ✅ |
| `CMD:uid` | App.tsx | room.ts:263-278 | ✅ |
| `CMD:host` | App.tsx | room.ts:279-286 | ✅ |
| `CMD:play` | App.tsx | room.ts:287-288 | ✅ |
| `CMD:pause` | App.tsx | room.ts:290-292 | ✅ |
| `CMD:seek` | App.tsx | room.ts:293-295 | ✅ |
| `CMD:playbackRate` | App.tsx | room.ts:296-298 | ✅ |
| `CMD:loop` | App.tsx | room.ts:299-301 | ✅ |
| `CMD:ts` | App.tsx | room.ts:302-304 | ✅ |
| `CMD:chat` / `CMD:chatV2` | App.tsx | room.ts:305-310 | ✅ |
| `CMD:reaction` | App.tsx | room.ts:311-319 | ✅ |
| `CMD:addReaction` | App.tsx | room.ts:320-322 | ✅ |
| `CMD:removeReaction` | App.tsx | room.ts:323-325 | ✅ |
| `CMD:joinVideo` | App.tsx | room.ts:326 | ✅ |
| `CMD:leaveVideo` | App.tsx | room.ts:327-328 | ✅ |
| `CMD:joinScreenShare` | App.tsx | room.ts:328-330 | ✅ |
| `CMD:userMute` | App.tsx | room.ts:331-333 | ✅ |
| `CMD:leaveScreenShare` | App.tsx | room.ts:334-335 | ✅ |
| `CMD:changeController` | App.tsx | room.ts:335-337 | ✅ |
| `CMD:subtitle` | App.tsx | room.ts:338-340 | ✅ |
| `CMD:lock` | App.tsx | room.ts:341-345 | ✅ |
| `CMD:askHost` | App.tsx | room.ts:346-348 | ✅ |
| `CMD:getRoomState` | App.tsx | room.ts:349-350 | ✅ |
| `CMD:setRoomState` | App.tsx | room.ts:350-352 | ✅ |
| `CMD:setRoomOwner` | App.tsx | room.ts:353-355 | ✅ |
| `CMD:playlistNext` | App.tsx | room.ts:356-358 | ✅ |
| `CMD:playlistAdd` | App.tsx | room.ts:359-361 | ✅ |
| `CMD:playlistMove` | App.tsx | room.ts:362-364 | ✅ |
| `CMD:playlistDelete` | App.tsx | room.ts:365-367 | ✅ |
| `CMD:kickUser` | App.tsx | room.ts:368-370 | ✅ |
| `CMD:deleteChatMessages` | App.tsx | room.ts:371-373 | ✅ |
| `CMD:chatSeen` | App.tsx | room.ts:374-376 | ✅ |
| `signal` | App.tsx | room.ts:378-380 | ✅ |
| `signalSS` | App.tsx | room.ts:381-383 | ✅ |

**All client→server events appear handled.** Good.

---

## Summary: Issue Rankings

| Rank | Issue | File:Line | Effort |
|------|-------|-----------|--------|
| **CRITICAL** | Infinite seek loop (timeout-based `isRemoteSyncing`) | App.tsx:360-362, 744-749, 2598-2610 | Medium |
| **CRITICAL** | No host transfer on disconnect | room.ts:1586-1609 | Medium |
| **CRITICAL** | Dual host seek race (no mutex) | room.ts:279-295 | Low |
| **HIGH** | Drift correction fights buffering | App.tsx:1390-1420 | Medium |
| **HIGH** | User joins mid-buffer: stale `videoTS` | App.tsx:768-812, room.ts:518-529 | Medium |
| **HIGH** | Playlist auto-advance race | App.tsx:3155-3180, room.ts:762-780 | Low |
| **HIGH** | `terminateRoom` doesn't clean Redis keys | server.ts:619-665, server.ts:1304-1357 | Low |
| **HIGH** | `saveRooms()` doesn't clean Redis keys | server.ts:1215-1256 | Low |
| **MEDIUM** | `preventTSUpdate` race on video change | room.ts:581-582, 983-986 | Low |
| **MEDIUM** | `REC:host` `controller` undefined vs string | room.ts:526, App.tsx:768 | Trivial |
| **MEDIUM** | `vBrowserQueue` not cleared on terminate | server.ts:648-652 | Trivial |
| **MEDIUM** | `tsMap` full-map broadcast every 1s | room.ts:112, App.tsx:1390 | Medium |
| **LOW** | `REC:nameMap`/`pictureMap` full replace | room.ts:623, 631, App.tsx:1431-1435 | Low |

---

## Recommended Fix Order

1. **Seek Loop Fix** — Add `seekId` token to `REC:seek`/`CMD:seek` (breaks infinite loop)
2. **Host Transfer** — Promote new `creatorUid` on host disconnect (restores control)
3. **Playback Mutex** — Serialize `seekVideo`/`playVideo`/`pauseVideo` (prevents dual-host race)
4. **Drift Correction Guard** — Only adjust rate when `readyState >= 3 && !seeking` (stops warble)
5. **Join-Time Sync** — Include `serverTimestamp` in `REC:host` (fixes mid-buffer join)
6. **Redis Cleanup** — Delete `roomCounts:`/`roomRosters:` on terminate & unload (stops leak)
7. **`controller` Default** — Server sends `""` not `undefined` (React hygiene)
8. **`tsMap` Throttle** — Emit every 2s or delta-only (reduces bandwidth/CPU)
9. **Playlist Idempotency** — Version check in `playlistNext` (prevents double-skip)
10. **`preventTSUpdate` Refinement** — Clear `tsMap` on video change, not just pause (cleaner sync)

---

## Appendix: Key Sync Data Flow Diagram

```
┌─────────────┐     CMD:seek(t)      ┌─────────────┐     REC:seek(t)      ┌─────────────┐
│   Host      │ ──────────────────▶  │   Server    │ ──────────────────▶  │  All Clients│
│  (creator)  │                      │  room.ts    │   (includes host!)   │  (App.tsx)  │
└─────────────┘                      └─────────────┘                      └──────┬──────┘
        ▲                                                                      │
        │                                                                      ▼
        │    CMD:ts(localTS)                                           isRemoteSyncing=true
        │    (every 1s)                                                         │
        └──────────────────────────────────────────────────────────────────────▶│
                         Server updates tsMap[clientId] = adjustedTS           │
                                         │                                      │
                                         ▼                                      │
                          ┌─────────────────────┐                             │
                          │ io.emit REC:tsMap   │◀────────────────────────────┘
                          │ (every 1s, full map)│
                          └──────────┬──────────┘
                                     │
                    getLeaderTime()  │  (median of tsMap values)
                    ◀────────────────┘
                    │
                    ▼
          Drift Correction:
          if delta > 0.5s → playbackRate = min(1.1, 1+delta/10)
          if delta < -0.5s → playbackRate = max(0.9, 1+delta/10)
          (debounced at 0.02)
```

---

*End of Phase 1 Sync Audit*