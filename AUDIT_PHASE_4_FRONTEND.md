# Phase 4 Frontend & WebRTC Audit: React, WebRTC, Mobile & Desktop Integration

**Auditor:** Senior Frontend & WebRTC Engineer  
**Date:** 2026-11-21  
**Files Analyzed:** `src/components/App/App.tsx`, `src/components/VideoChat/VideoChat.tsx`, `src/components/VideoChat/FloatingWebcamBubbles.tsx`, `src/components/Chat/Chat.tsx`, `src/components/Controls/Controls.tsx`, `desktop/main.js`, `desktop/sidecar.mjs`, `android/app/src/main/java/org/dipkri/app/*.kt`

---

## Executive Summary

The frontend uses **class-based React components** (not hooks) with Socket.IO for real-time sync, WebRTC mesh for video chat/screen share, and a sophisticated player abstraction (`HTML`, `YouTube`, `Movie` interfaces). While feature-rich, **critical WebRTC resource leaks** exist: peer connections, media tracks, and ICE listeners are not fully cleaned up on disconnect/toggle. React 18 patterns are violated (missing `useEffect` cleanup equivalents in class components, stale closures in playback callbacks). Mobile UX has gaps (keyboard handling, safe areas). Desktop/Android sidecars are well-isolated but have cleanup edge cases.

---

## 1. WebRTC Cleanup Issues

### [CRITICAL] `VideoChat` — Peer Connections Not Cleaned Up When Remote Peer Leaves Video Chat
**Location:** `src/components/VideoChat/VideoChat.tsx:430-443` (`updateWebRTC`)

**Code:**
```typescript
Object.entries(videoPCs).forEach(([key, value]) => {
  if (!clientIds.has(key)) {  // Remote peer no longer in video chat
    try { value.close(); } catch {}
    delete videoPCs[key];
    if (window.dipkri.remoteStreams) {
      delete window.dipkri.remoteStreams[key];
    }
  }
});
```

**Issue:** When a remote peer leaves (`CMD:leaveVideo`), their `isVideoChat` becomes `false`, so `updateWebRTC` closes the `RTCPeerConnection` ✅. **But** the remote peer's `MediaStream` tracks are **not stopped** — `remoteStreams[key]` is deleted but the stream's tracks keep running. If the remote peer re-joins, a new PC is created but the old stream's tracks may still be live.

**Missing:** Call `stream.getTracks().forEach(t => t.stop())` before deleting `remoteStreams[key]`.

---

### [CRITICAL] `VideoChat` — ICE Candidate Listener Not Removed on PC Close
**Location:** `src/components/VideoChat/VideoChat.tsx:353-359` (`createPeerConnection`)

**Code:**
```typescript
pc.onicecandidate = (event) => {
  if (event.candidate) {
    this.sendSignal(id, { ice: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
  }
};
```

**Issue:** When `pc.close()` is called (lines 107, 277, 379, 436), the `onicecandidate` handler **remains attached**. If the closed PC somehow fires an ICE event (race during close), `sendSignal` is called on a dead socket → memory leak + potential error.

**Fix:** Set `pc.onicecandidate = null` before `pc.close()`.

---

### [CRITICAL] `VideoChat` — `onnegotiationneeded` Handler Fires After PC Close
**Location:** `src/components/VideoChat/VideoChat.tsx:393-403`

**Code:**
```typescript
pc.onnegotiationneeded = async () => {
  try {
    if (!pc.currentRemoteDescription) return;
    if (pc.signalingState !== "stable") return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(id, { sdp: pc.localDescription });
  } catch (err) { console.warn(...); }
};
```

**Issue:** If `pc.close()` is called while `onnegotiationneeded` is pending or firing, the handler runs on a closed PC → `createOffer()` throws. The `try/catch` catches it but **doesn't prevent the leak** — the handler stays attached.

**Fix:** Check `pc.connectionState === "closed"` at start of handler.

---

### [CRITICAL] `FloatingWebcamBubbles` — Duplicate WebRTC Cleanup Logic, Inconsistent with `VideoChat`
**Location:** `src/components/VideoChat/FloatingWebcamBubbles.tsx:443-468` (`handleLeaveVideo`)

**Code:**
```typescript
const handleLeaveVideo = () => {
  const ourStream = window.dipkri?.ourStream;
  const videoPCs = window.dipkri?.videoPCs;
  if (ourStream) {
    ourStream.getTracks().forEach((track) => track.stop());
    window.dipkri.ourStream = undefined;
  }
  if (videoPCs) {
    Object.keys(videoPCs).forEach((k) => {
      try { videoPCs[k].close(); } catch {}
      delete videoPCs[k];
    });
  }
  socket?.emit("CMD:leaveVideo");
  // ...
};
```

**Issue:** This **duplicates** `VideoChat.stopWebRTC()` (lines 257-292) but **misses**:
- `resetSpeakerCache()` (line 266 in VideoChat)
- `remoteStreams` cleanup (lines 267-272)
- `retryAttempts.clear()` (line 274)
- `dipkri-stream-update` dispatch (lines 283-290)

**Result:** Two components manage same global state (`window.dipkri`) → race conditions, incomplete cleanup.

**Fix:** Centralize WebRTC lifecycle in one place (e.g., `VideoChat` class), have `FloatingWebcamBubbles` call its methods via prop callbacks.

---

### [HIGH] `VideoChat` — `oniceconnectionstatechange` Retry Creates New PC Without Cleaning Old One Fully
**Location:** `src/components/VideoChat/VideoChat.tsx:405-416`

**Code:**
```typescript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState !== "failed") return;
  try { pc.close(); } catch {}
  delete videoPCs[id];
  const attempt = (this.retryAttempts.get(id) || 0) + 1;
  this.retryAttempts.set(id, attempt);
  if (attempt > 4) return;
  const delay = Math.min(2000 * attempt, 15000);
  setTimeout(() => this.updateWebRTC(), delay);
};
```

**Issue:** On ICE failure, `pc.close()` is called but:
1. `remoteStreams[id]` not cleaned up
2. `videoRefs[id]` not nulled
3. `sendSignal` may have pending ICE candidates in `_iceQueue`
4. `setTimeout` captures `this` (class method) — **stale closure** if component unmounts before timeout fires

**Fix:** Extract cleanup to shared method; clear timeout on unmount.

---

### [HIGH] `App.tsx` — `setupRTCConnections` Creates Peer Connections Without Tracking for Cleanup
**Location:** `src/components/App/App.tsx:2373-2480` (`setupRTCConnections`)

**Code:** Creates `publisherConns` Map for screen/file share WebRTC, but **no cleanup** when:
- Sharer stops (`CMD:leaveScreenShare` received via `signalSS`)
- Room changes media type (e.g., screen share → video)
- Component unmounts

**Missing:** `componentWillUnmount` equivalent to close all `publisherConns`, `consumerConn`, stop `localStreamToPublish` tracks.

---

### [HIGH] `App.tsx` — `stopPublishingLocalStream` Doesn't Close `publisherConns` / `consumerConn`
**Location:** `src/components/App/App.tsx:2342-2371`

**Code:**
```typescript
stopPublishingLocalStream = async () => {
  this.stopConvert();
  if (this.localStreamToPublish) {
    this.socket.emit("CMD:leaveScreenShare");
    this.localSetMute(false);
  }
  this.localStreamToPublish &&
    this.localStreamToPublish.getTracks().forEach((track) => {
      track.stop();
    });
  this.localStreamToPublish = undefined;
  this.isLocalStreamAFile = false;
  // ... mediasoup cleanup ...
};
```

**Missing:** 
```typescript
// Close all publisher peer connections
Object.values(this.publisherConns).forEach(pc => {
  try { pc.close(); } catch {}
});
this.publisherConns = {};

// Close consumer connection
if (this.consumerConn) {
  try { this.consumerConn.close(); } catch {}
  this.consumerConn = undefined;
}
```

---

### [MEDIUM] `VideoChat` — `retryAttempts` Map Never Cleared on Unmount
**Location:** `src/components/VideoChat/VideoChat.tsx:53`, `componentWillUnmount` (lines 55-81)

**Code:** `retryAttempts = new Map<string, number>()` (line 53) but `componentWillUnmount` doesn't clear it.

**Impact:** Memory leak if component remounts (Map retains old entries).

---

## 2. React 18 & Router 5 Issues

### [CRITICAL] `App.tsx` — `componentDidMount` Socket Listeners Not All Cleaned Up
**Location:** `src/components/App/App.tsx:536-612` (`componentDidMount`) vs `componentWillUnmount` (lines 586-612)

**Socket Listeners Registered (partial):**
```typescript
socket.on("connect", ...)
socket.on("connect_error", ...)
socket.on("disconnect", ...)
socket.on("errorMessage", ...)
socket.on("successMessage", ...)
socket.on("kicked", ...)
socket.on("REC:play", ...)
socket.on("REC:pause", ...)
socket.on("REC:seek", ...)
socket.on("REC:playbackRate", ...)
socket.on("REC:subtitle", ...)
socket.on("REC:loop", ...)
socket.on("REC:changeController", ...)
socket.on("REC:host", ...)
socket.on("REC:chat", ...)
socket.on("REC:chatSeen", ...)
socket.on("REC:reaction", ...)
socket.on("REC:addReaction", ...)
socket.on("REC:removeReaction", ...)
socket.on("REC:tsMap", ...)
socket.on("REC:nameMap", ...)
socket.on("REC:pictureMap", ...)
socket.on("REC:lock", ...)
socket.on("roster", ...)
socket.on("chatinit", ...)
socket.on("playlist", ...)
socket.on("signalSS", ...)
socket.on("REC:getRoomState", ...)
```

**Cleaned Up in `componentWillUnmount`:** Only `this.socket?.disconnect()` (line 610). **No `socket.off()` calls.**

**Impact:** If `App` remounts (React 18 strict mode double-mount in dev, or navigation), **old socket listeners remain attached** → duplicate handlers, memory leaks, state corruption.

**Fix:** Store listener references and call `socket.off(event, handler)` in `componentWillUnmount`, OR use a single `socket.onAny`/`offAny` pattern.

---

### [CRITICAL] `App.tsx` — `tsInterval` and `progressUpdater` Intervals Not Cleared on Socket Reconnect
**Location:** `src/components/App/App.tsx:1561-1580` (interval setup in `init`)

**Code:**
```typescript
this.tsInterval = window.setInterval(() => { ... }, 1000);
this.progressUpdater = window.setInterval(async () => { ... }, 1000);
```

**Issue:** `init()` is called on mount **and** on reconnect (via `join()` → `socket.on("connect", ...)` line 671). Each reconnect creates **new intervals** without clearing old ones → multiple intervals firing simultaneously.

**Fix:** Clear intervals at start of `init()`:
```typescript
if (this.tsInterval) window.clearInterval(this.tsInterval);
if (this.progressUpdater) window.clearInterval(this.progressUpdater);
```

---

### [HIGH] `App.tsx` — Stale Closure in `onVideoEvent` Handler (seeked → CMD:seek)
**Location:** `src/components/App/App.tsx:2598-2610`

**Code:**
```typescript
const onVideoEvent = (evType: string) => {
  try {
    const curTime = this.Player().getCurrentTime();
    if (evType === "seeked" && typeof curTime === "number") {
      if (this.isRemoteSyncing) { ...; return; }
      if (this.haveLock()) {
        this.socket.emit("CMD:seek", curTime);  // STALE: this.socket from old reconnect
      }
    }
  } catch {}
};
```

**Issue:** `onVideoEvent` is attached to video element (likely via `Player` interface). On reconnect, `this.socket` is **replaced** (line 667) but the event listener still references **old socket** from previous `init()` call. `CMD:seek` emitted on dead socket → silently dropped.

**Fix:** Use `this.socket` reference that updates (it does, it's a class property), but ensure old video element listeners are removed on media change. The `REC:host` handler calls `Player().clearState()` (line 838) but doesn't explicitly remove `onVideoEvent` listener.

---

### [HIGH] `Chat.tsx` — `componentDidUpdate` Emits `CMD:chatSeen` on Every Prop Change
**Location:** `src/components/Chat/Chat.tsx:185-199`

**Code:**
```typescript
componentDidUpdate(prevProps: ChatProps) {
  if (this.props.scrollTimestamp !== prevProps.scrollTimestamp) { ... }
  if (this.props.hide !== prevProps.hide) { ...; this.props.socket?.emit("CMD:chatSeen"); }
  if (this.props.chat.length !== prevProps.chat.length && !this.props.hide) {
    this.props.socket?.emit("CMD:chatSeen");  // FIRES ON EVERY NEW MESSAGE
  }
  if (!prevProps.isKeyboardOpen && this.props.isKeyboardOpen) { ... }
}
```

**Issue:** Every incoming chat message triggers `CMD:chatSeen` → **spams server** with seen receipts. Should only emit when user actually views chat (tab active, scrolled to bottom).

**Fix:** Track `hasUserSeenChat` locally; emit only on transition `false → true`.

---

### [HIGH] `FloatingWebcamBubbles.tsx` — `useEffect` with 1.5s Polling Interval Never Cleared Properly
**Location:** `src/components/VideoChat/FloatingWebcamBubbles.tsx:299-312`

**Code:**
```typescript
useEffect(() => {
  const handleStreamUpdate = () => { setStreamVersion(v => v + 1); };
  window.addEventListener("dipkri-stream-update", handleStreamUpdate);
  const interval = setInterval(() => { setStreamVersion(v => v + 1); }, 1500);
  return () => {
    window.removeEventListener("dipkri-stream-update", handleStreamUpdate);
    clearInterval(interval);
  };
}, []);
```

**Issue:** The `setInterval` forces re-render **every 1.5s** for all bubble components (up to 10+ users) → **unnecessary re-renders**. The `dipkri-stream-update` event already triggers updates.

**Fix:** Remove the interval; rely solely on the event.

---

### [MEDIUM] `VideoChat.tsx` — `forceUpdate()` Called Excessively
**Location:** Multiple: lines 84, 254, 291, 308, 323, 388, 480

**Code:** `this.forceUpdate()` called in `handleStreamUpdate`, `setupWebRTC`, `stopWebRTC`, `toggleVideoWebRTC`, `toggleAudioWebRTC`, `ontrack`, `updateWebRTC`.

**Issue:** `forceUpdate` bypasses `shouldComponentUpdate` → **full subtree re-render** on every track event, ICE candidate, negotiation. With 5+ peers, this causes **jank**.

**Fix:** Use `setState` with minimal state (e.g., `streamVersion` counter) instead of `forceUpdate`.

---

### [MEDIUM] `Chat.tsx` — `Linkify` Component Re-renders on Every Message
**Location:** `src/components/Chat/Chat.tsx:997-1020` (`ChatMessageItem` render)

**Code:** `<Linkify>` wraps every message. Each message gets its own `Linkify` instance with regex parsing.

**Issue:** With 100 messages, 100 `Linkify` components → **heavy render cost**. Regex runs on every render.

**Fix:** Memoize parsed links; use `React.memo` for `ChatMessageItem`; parse URLs once on message receipt.

---

### [MEDIUM] React Router v5 — No `useNavigate`/`useLocation` Hooks, Uses Class Context
**Location:** `src/components/App/App.tsx` — uses `window.history` directly (lines 1721, 1732, 2883)

**Code:**
```typescript
window.history.replaceState("", "", this.getInviteLink(data.vanity));
window.history.back();
```

**Issue:** React Router v5 provides hooks for navigation; direct `window.history` manipulation **bypasses Router** → router state desync, back button issues.

**Fix:** Migrate to `useNavigate`/`useLocation` (requires converting to function components) or use `withRouter` HOC.

---

## 3. UI/UX Gaps

### [CRITICAL] No Error State for Failed Stream Load (Torrent/HTTP/HLS/DASH)
**Location:** `src/components/App/App.tsx:1049-1208` (`REC:host` handler)

**Code:** Multiple streaming paths (torrent, HLS, DASH, direct, remux) with `catch` blocks that call `explainStreamFailure` (line 1814) or `showError`. **But:**
- `explainStreamFailure` only handles specific HTTP status codes (401, 429, 507, 404, 400)
- **No generic "stream failed" UI** for network errors, CORS, codec not supported
- `videoDecodeIssue` state (line 1279) detects black video but **no UI to offer fallback** (transcode, different quality)

**User Experience:** Video shows black screen or spinner forever; user doesn't know why or what to do.

**Fix:** Add `<ErrorFallback>` component with retry, "Try Transcode", "Report Issue" actions.

---

### [HIGH] YouTube Embed Blocked — No Graceful Fallback UI
**Location:** `src/components/App/App.tsx:1641-1648` (YouTube `onError`)

**Code:**
```typescript
onError: (e: any) => {
  const code = e?.data;
  if (code === 101 || code === 150) {
    this.setState({
      overlayMsg: "This YouTube video blocks embedding. Open it on YouTube, or paste a different link.",
    });
  }
}
```

**Issue:** Only handles codes 101/150. **Other errors** (150=embed blocked, 101=video not found, 2=invalid param, 5=HTML5 player error) show **no message**. YouTube player just shows black.

**Fix:** Handle all YT error codes; show thumbnail + "Open on YouTube" link.

---

### [HIGH] Socket Disconnected — No Prominent Reconnection UI
**Location:** `src/components/App/App.tsx:713-722`

**Code:**
```typescript
socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    this.setState({ overlayMsg: "Disconnected from server." });
  } else {
    this.setState({ warningMessage: "Reconnecting..." });
  }
});
```

**Issue:** `warningMessage` is a small toast; `overlayMsg` only on server-initiated disconnect. **No full-screen "Reconnecting..." with spinner** during automatic reconnect. User sees frozen video, no indication.

**Fix:** Show modal overlay with spinner, "Reconnecting...", cancel button.

---

### [HIGH] Mobile: Virtual Keyboard Overlaps Chat Input (iOS Safari)
**Location:** `src/components/App/App.tsx:501-528` (`updateViewportMetrics`), `src/components/Chat/Chat.tsx:590-618` (input focus)

**Code:** `updateViewportMetrics` sets CSS vars for `--visual-viewport-height` and `--keyboard-height`. Chat input `onFocus` calls `window.scrollTo(0, 0)`.

**Issue:** iOS Safari **does not fire `visualViewport` resize** consistently when keyboard opens. `window.scrollTo(0,0)` fights with browser's own scroll-to-input behavior → input jumps, sometimes hidden behind keyboard.

**Fix:** Use `visualViewport` API properly; add `inputmode="text"` and `autocomplete="off"`; test on real iOS.

---

### [HIGH] Mobile: No Safe Area Insets for Notched Devices
**Location:** `src/components/VideoChat/FloatingWebcamBubbles.tsx:209-241` (`clampToViewport`)

**Code:** Clamps position to `window.innerWidth/Height` but **ignores `env(safe-area-inset-*)`**.

**Issue:** On iPhone X+/Android notched phones, bubbles can render under notch/home indicator.

**Fix:** Use `padding: env(safe-area-inset-top) env(safe-area-inset-right) ...` in container styles.

---

### [MEDIUM] Dead Controls: "Play in Room" Button in Chat YouTube Card Doesn't Check Host Permissions
**Location:** `src/components/Chat/Chat.tsx:1048-1059`

**Code:**
```typescript
<button onClick={(e) => {
  e.stopPropagation();
  socket.emit("CMD:host", `https://www.youtube.com/watch?v=${ytVideoId}`);
}} title="Play this video for the whole room">
```

**Issue:** Any user can click "Play in Room" → emits `CMD:host`. Server validates host (room.ts:279), but **client doesn't disable button** for non-hosts → confusing UX (click does nothing, no feedback).

**Fix:** Disable button if `!haveLock()`; show tooltip "Only host can change video".

---

### [MEDIUM] No Empty State for Chat (New Room, No Messages)
**Location:** `src/components/Chat/Chat.tsx:430-488` (render)

**Code:** Renders empty `<div className={styles.chatContainer}>` when `this.props.chat.length === 0`.

**Issue:** No "No messages yet. Start the conversation!" placeholder.

---

### [MEDIUM] FloatingWebcamBubbles — No "No Camera" Placeholder When User Has No Video Track
**Location:** `src/components/VideoChat/FloatingWebcamBubbles.tsx:630-642` (`isVideoOff` logic)

**Code:** Checks `selfVideoMuted || !ourStream?.getVideoTracks()[0]?.enabled` but **doesn't handle** case where `getUserMedia` returned audio-only (no video track at all).

**Issue:** User joins audio-only → bubble shows broken video element or blank.

**Fix:** Check `ourStream?.getVideoTracks().length === 0` → show "Audio Only" badge.

---

## 4. Desktop & Android Integration

### [HIGH] Desktop Sidecar — Cache Not Cleaned on Abnormal Exit (Crash/Kill)
**Location:** `desktop/main.js:214-262` (`stopSidecar`), `desktop/sidecar.mjs:629-660`

**Code:** `stopSidecar()` sends `shutdown` IPC, waits for `cleanup` message, then kills after 12s. **But** if Electron crashes (SIGKILL, power loss), sidecar process **orphaned** — its `process.on('exit')` handler not registered to clean cache.

**Sidecar** cleans cache on boot (line 86-88) but **not on signal**:
```typescript
process.on("SIGTERM", () => { shuttingDown = true; void destroyAll("sigterm").then(() => process.exit(0)); });
process.on("SIGINT", () => { shuttingDown = true; void destroyAll("sigint").then(() => process.exit(0)); });
```

**Missing:** These handlers **not registered** in sidecar.mjs.

**Fix:** Add signal handlers in sidecar.mjs; register `process.on('exit', cleanup)`.

---

### [HIGH] Desktop — `mainWindow.webContents.once("did-finish-load")` Misses Navigation
**Location:** `desktop/main.js:183-185`

**Code:**
```typescript
mainWindow.webContents.once("did-finish-load", () => {
  if (sidecarReady) sendToWindow("dipkri:sidecar-port", sidecarPort);
});
```

**Issue:** `once` only fires on **initial load**. If user navigates within app (SPA routing), sidecar port not re-sent. If sidecar restarts, new port not sent.

**Fix:** Use `did-navigate-in-page` or send port on every `dipkri:sidecar` IPC request (already done in handler line 201-210).

---

### [MEDIUM] Android — `LocalHttpServer` Uses One Thread Per Connection (No Pool)
**Location:** `android/app/src/main/java/org/dipkri/app/LocalHttpServer.kt:39-59`

**Code:**
```kotlin
thread(name = "dipkri-http", isDaemon = true) {
  while (running.get()) {
    val client = server.accept()
    if (active.incrementAndGet() > MAX_CONNECTIONS) { ... }
    thread(name = "dipkri-conn", isDaemon = true) { handle(client) }
  }
}
```

**Issue:** Creates **new thread per connection** (capped at 8). ExoPlayer opens 2 connections for seeking → 2 threads. Under load, thread creation overhead.

**Fix:** Use `Executors.newFixedThreadPool(8)` or Kotlin coroutines.

---

### [MEDIUM] Android — `TorrentService` Cache Cleared on Every `onDestroy` (Including Config Changes)
**Location:** `android/app/src/main/java/org/dipkri/app/TorrentService.kt:63-76`

**Code:**
```kotlin
override fun onDestroy() {
  server?.stop()
  engine.stopAll()
  clearCache()  // DELETES ALL TORRENT DATA
  ...
}
```

**Issue:** `onDestroy` called on **config changes** (rotation, multi-window) if service not foreground properly. `clearCache()` deletes torrent files → **playback interrupted** on rotation.

**Fix:** Only clear cache on explicit `/room-end` or app uninstall; use `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` to survive config changes.

---

### [MEDIUM] Android — WebView `evaluateJavascript` Bridge Injected on Every Page Load
**Location:** `android/app/src/main/java/org/dipkri/app/MainActivity.kt:176-191` (`installBridge`)

**Code:** `installBridge` called in `onPageStarted` AND `onPageFinished` → **injected twice** per navigation.

**Issue:** Duplicate `window.dipkriDesktop` definition (harmless but wasteful). If page navigates to non-app URL, bridge still injected (line 146 checks but `installBridge` still called).

**Fix:** Only inject on `onPageFinished` for app-origin URLs.

---

## Summary: Issue Rankings

| Rank | Issue | File:Line | Effort |
|------|-------|-----------|--------|
| **CRITICAL** | Peer connections not cleaned when remote peer leaves | VideoChat.tsx:430-443 | Medium |
| **CRITICAL** | ICE listener not removed on PC close | VideoChat.tsx:353-359 | Low |
| **CRITICAL** | `onnegotiationneeded` fires after PC close | VideoChat.tsx:393-403 | Low |
| **CRITICAL** | Duplicate WebRTC cleanup in FloatingWebcamBubbles | FloatingWebcamBubbles.tsx:443-468 | Medium |
| **CRITICAL** | Socket listeners not removed on unmount | App.tsx:536-612 | Medium |
| **CRITICAL** | `tsInterval`/`progressUpdater` leak on reconnect | App.tsx:1561-1580 | Low |
| **CRITICAL** | No error UI for failed stream load | App.tsx:1049-1208 | Medium |
| **HIGH** | Stale socket closure in `onVideoEvent` | App.tsx:2598-2610 | Low |
| **HIGH** | `Chat` spams `CMD:chatSeen` on every message | Chat.tsx:185-199 | Low |
| **HIGH** | `setupRTCConnections` no cleanup for publisherConns | App.tsx:2373-2480 | Medium |
| **HIGH** | `stopPublishingLocalStream` doesn't close WebRTC PCs | App.tsx:2342-2371 | Low |
| **HIGH** | YouTube embed blocked — no fallback for all codes | App.tsx:1641-1648 | Low |
| **HIGH** | Socket disconnect — no prominent reconnect UI | App.tsx:713-722 | Low |
| **HIGH** | Mobile keyboard overlaps chat input (iOS) | App.tsx:501-528, Chat.tsx:590-618 | Medium |
| **HIGH** | Desktop sidecar cache not cleaned on crash | main.js:214-262, sidecar.mjs:629-660 | Medium |
| **HIGH** | Android `onDestroy` clears cache on config change | TorrentService.kt:63-76 | Low |
| **MEDIUM** | `forceUpdate()` overuse in VideoChat | VideoChat.tsx:84,254,291... | Medium |
| **MEDIUM** | `Linkify` re-parses URLs on every render | Chat.tsx:997-1020 | Low |
| **MEDIUM** | FloatingWebcamBubbles 1.5s polling interval | FloatingWebcamBubbles.tsx:299-312 | Low |
| **MEDIUM** | No safe area insets for notched phones | FloatingWebcamBubbles.tsx:209-241 | Low |
| **MEDIUM** | "Play in Room" button enabled for non-hosts | Chat.tsx:1048-1059 | Low |
| **MEDIUM** | Android thread-per-connection (no pool) | LocalHttpServer.kt:39-59 | Medium |
| **MEDIUM** | WebView bridge injected twice per navigation | MainActivity.kt:176-191 | Low |

---

## Recommended Fix Order

1. **Socket Listener Cleanup** — Add `socket.off()` for all events in `componentWillUnmount` (App.tsx:586)
2. **Interval Leak Fix** — Clear `tsInterval`/`progressUpdater` at start of `init()` (App.tsx:1561)
3. **WebRTC Cleanup Centralization** — Move all PC/track cleanup to `VideoChat` methods; have `FloatingWebcamBubbles` call them
4. **ICE/Negotiation Handlers** — Nullify `onicecandidate`, `onnegotiationneeded`, `oniceconnectionstatechange` before `pc.close()`
5. **Stale Socket in `onVideoEvent`** — Remove video event listeners on media change (`REC:host` handler)
6. **Stream Error UI** — Add `<ErrorFallback>` component with retry/transcode options
7. **Chat `CMD:chatSeen` Spam** — Only emit when user actually views chat
8. **Mobile Keyboard/Notch Fixes** — Proper `visualViewport` handling + safe area CSS
9. **Desktop Sidecar Signal Handlers** — Add `SIGTERM`/`SIGINT` cleanup in sidecar.mjs
10. **Android Config Change Cache** — Only clear cache on explicit room end, not `onDestroy`

---

## Appendix: WebRTC Cleanup Pattern (Reference)

```typescript
// Shared cleanup method in VideoChat class
private cleanupPeerConnection(id: string) {
  const pc = window.dipkri.videoPCs[id];
  if (pc) {
    // Nullify all handlers FIRST
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onnegotiationneeded = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    
    // Stop all transceivers/senders
    pc.getSenders().forEach(sender => {
      try { sender.track?.stop(); } catch {}
    });
    pc.getReceivers().forEach(receiver => {
      try { receiver.track?.stop(); } catch {}
    });
    
    // Close PC
    try { pc.close(); } catch {}
    delete window.dipkri.videoPCs[id];
  }
  
  // Clean remote stream
  const stream = window.dipkri.remoteStreams?.[id];
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    delete window.dipkri.remoteStreams[id];
  }
  
  // Clean video ref
  if (window.dipkri.videoRefs[id]) {
    window.dipkri.videoRefs[id].srcObject = null;
    delete window.dipkri.videoRefs[id];
  }
  
  // Clear retry state
  this.retryAttempts.delete(id);
}

// In componentWillUnmount:
Object.keys(window.dipkri.videoPCs).forEach(id => this.cleanupPeerConnection(id));
```

---

*End of Phase 4 Frontend & WebRTC Audit*