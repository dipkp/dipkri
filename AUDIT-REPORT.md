# dipkri — Error Audit & Fix Report

Date: 2026-10-18 · Scope: full codebase (server, client core logic, UI/UX desktop + mobile)

## Verification (measured, not assumed)

| Check | Before | After |
|---|---|---|
| `npm run typecheck` (client) | 22 errors | **0 errors** |
| `npm run typecheckServer` | 0 errors | **0 errors** |
| `npm run build` (vite) | passes | **passes** (25 s, chunk-size warnings only) |
| Server boot (`npm run start`) | — | **HTTP 200** on `localhost:8080/` |
| `GET /stream-proxy?url=not-a-url` | — | **400**, graceful (no crash/hang) |

## P0 — crash / data-integrity fixes

1. **Reaction handlers crash on prototype keys** — `server/room.ts` (`addReaction`, `removeReaction`).
   A reaction value of `"constructor"` (or `__proto__`) resolved to a non-array on the reactions
   dictionary, so `.includes()` / `.filter()` threw inside a synchronous socket listener → uncaught
   exception. Fixed with a prototype-key guard in both handlers.

2. **`CMD:host` unhandled rejection** — `server/room.ts`.
   `startHosting()` is async and was fire-and-forget; its Reddit `axios.get()` has no try/catch.
   On Node 22 an unhandled rejection terminates the process. Fixed: `.catch()` at the call site
   with a user-facing error message.

3. **`/metadata` unawaited DB write** — `server/server.ts`.
   `upsertObject(active_user)` was neither awaited nor caught → one DB error = process exit on the
   hottest path. Fixed with `.catch()` logging.

4. **Engine middleware could hang the socket handshake** — `server/server.ts`.
   The async `io.engine.use` middleware awaited Postgres before `next()` with no try/catch: a DB
   error both hung the handshake and produced an unhandled rejection. Fixed with try/catch (always
   reaches `next()`).

5. **Bare async `setInterval` calls** — `server/server.ts`.
   `minuteMetrics`, `release`, `saveRooms` are async and were passed directly to `setInterval`; any
   rejection crashed the process. Fixed with a `runSafely()` wrapper that catches and logs.

## P1 — functional fixes

6. **Playback persistence was dead code** — `src/components/App/App.tsx` (11 sites).
   The class never declared or assigned `this.roomId`; the value only exists as `this.state.roomId`.
   Every save/restore of playback position passed `undefined`, so resume-on-refresh never worked.
   Fixed at all 11 sites.

7. **Media sidebar tab showed a blank panel** — `App.tsx`.
   The Media button set `desktopSidebarTab: "media"`, a value no panel renders (the queue panel
   checks `"playlist"`), hiding even chat. Fixed: the tab now activates `"playlist"`.

8. **Search box threw a ReferenceError** — `src/components/ComboBox/ComboBox.tsx`.
   `doSearch()` referenced an undeclared `value` variable on every keystroke/focus, so the
   autocomplete never populated. Fixed to the intended empty-query check.

9. **1 s sync interval leaked per join** — `App.tsx`.
   The `CMD:ts` heartbeat interval was never stored nor cleared; every room change added another
   permanent timer. Fixed: stored in `tsInterval`, cleared before re-arming and on unmount.

10. **Document key handlers survived unmount** — `App.tsx`.
    `document.onkeydown` / `document.onfullscreenchange` were assigned as properties but removed
    with `removeEventListener`, which never removes property handlers. Fixed: set to `null` on
    unmount.

11. **Seek without the room lock desynced viewers** — `App.tsx`.
    `roomSeek()` seeked locally and emitted `CMD:seek`, which the server rejects without the lock;
    the viewer stayed offset. Fixed with a `haveLock()` guard.

12. **Subtitle track selection always chose track 0** — `App.tsx`.
    Controls calls `localSetSubtitleMode(mode, lang, trackIndex)`, but the adapter accepted only two
    parameters, silently dropping `trackIndex`. Fixed: the adapter now accepts and prefers the
    explicit track index.

13. **Subtitle cues drifted forever** — `src/components/App/HTML.ts`.
    `if (!cue.origStart)` re-based any cue that legitimately starts at 0 on every sync, compounding
    the offset. Fixed with an undefined check.

14. **`playsInline` type errors** — `HTML.ts`: `getVideoEl()` now returns `HTMLVideoElement`
    (the element is `<video id="leftVideo">`), matching its actual contract.

15. **`VideoChat.tsx`** — peer connection typed as `RTCPeerConnection | undefined` (matches the
    on-demand creation path; guards already existed).

16. **`FloatingWebcamBubbles.tsx`** — drag-start ref typed nullable (code assigns `null`; guards
    already existed).

## P2 / UI fixes

17. **Webcam bubbles blocked the whole UI** — `FloatingWebcamBubbles.module.css`.
    `z-index: 9999999 !important` sat above modals and the top bar, swallowing clicks. Now 120
    (above app chrome ≈100, below Mantine modals ≈200).

18. **Legal/FAQ pages clipped on phones** — `src/components/Pages/Pages.tsx`.
    `width: 800px` + `padding: 20px` in content-box mode overflowed the viewport. Added
    `boxSizing: "border-box"`.

## Found but NOT fixed (verified evidence, deferred)

- `App.tsx` ≈ l. 900: the `canplay` listener is added per media load and never removed → stale
  closures can seek the next video to an old timestamp. Needs a stored-handler refactor.
- `Controls.tsx` l. 950 (play/pause) and l. 1852 (fullscreen): clickable `div`s without
  `role`/`tabIndex`/`onKeyDown` — keyboard users cannot control playback.
- `Controls.tsx` l. 973: mobile action row packs 28 px controls with 3 px gaps (mistaps).
- `Chat.tsx` l. 431: no empty state — a fresh room shows a blank chat panel.
- `LiveCaptions.tsx` l. 854: cleanup misses `cuechange` and HLS handlers.
- `HTML.ts`: HLS `startLoad` retry path can loop; object URLs not revoked; stale `srcObject`.
- `App.tsx`: `key={controlsTimestamp}` forces remounts; YouTube timer not cancellable; torrent
  subtitle race.
- `audioEnhancer.attachToElement` re-attach behaviour unverified (needs a browser).

## Tooling note

The workspace write guard rejects any file whose content contains credential-shaped lines
(pre-existing passphrase/token type declarations). `App.tsx`, `server/room.ts` and
`server/server.ts` were therefore un-writable by the edit tools; their fixes were packaged as
`fixes.patch` (validated with `git apply --check`) and applied after explicit approval.

Scratch artifacts (safe to delete): `app-fixes.patch`, `fixes.patch`,
`dev/make_app_patch.py`, `dev/make_fixes_patch.py`.
