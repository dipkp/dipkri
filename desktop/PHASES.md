# dipkri app — phase plan

Goal: move torrent bytes **off the Oracle server**. The app streams locally, the
server only keeps rooms, chat and playback sync. Room ends → data is gone.

## Architecture

```
Desktop / mobile app                        Server (light)
├─ torrent client (TCP/UDP swarm)          ├─ auth, rooms, catalog
├─ local cache folder                      ├─ playback sync (WebSocket)
├─ video player                            ├─ chat, subtitles, TMDB
└─ wipe on room end / quit                 └─ zero media bytes, zero media disk
```

Why not a browser/PWA: browsers can only reach WebRTC peers. Most movie
torrents are seeded by qBittorrent/Transmission (TCP/UDP), so a browser-only
player stalls on the majority of magnets. A real app has the full swarm.

## Phase 1 — desktop shell + local streaming (in progress)

| Piece | File | Status |
|---|---|---|
| Local torrent sidecar (HTTP, Range) | `desktop/sidecar.mjs` | done, tested |
| Electron shell loading dipkri UI | `desktop/main.js` | scaffolded |
| Bridge to the web UI | `desktop/preload.js` | scaffolded |
| Packaging config (nsis/dmg/AppImage) | `desktop/package.json` | scaffolded |

Sidecar endpoints:

```
GET  /health                                  -> { ok, torrents, freeDiskGB, cacheMB }
GET  /info?torrent=<magnet>                   -> { name, infoHash, files[] }
GET  /stream?torrent=<magnet>&fileIndex=N     -> video bytes, Range supported
POST /stop        { infoHash }                -> destroy + delete files
POST /room-end                                -> destroy + delete everything
```

Safety knobs (env):

```
DIPKRI_SIDECAR_PORT   17891
DIPKRI_CACHE_DIR      %TEMP%\dipkri-cache
DIPKRI_IDLE_MINUTES   30      drop a torrent after N idle minutes
DIPKRI_MIN_FREE_GB    1       refuse a stream when this device is nearly full
```

Verified on Windows (Node 24, webtorrent 2.8.5), Sintel magnet:

```
/info        200  Sintel.mp4  129,241,752 bytes
/stream      206  6,291,456 bytes served, valid MP4 ftyp header
cache        123.3 MB buffered in %TEMP%\dipkri-cache
POST /stop   200  dropped:true  -> cacheMB 0, 0 files left
```

## Phase 2 — wire the UI to the sidecar

- Detect `window.dipkriDesktop` in the React app.
- When present, point the player at `http://127.0.0.1:17891/stream?...`
  instead of the server's `/torrent/stream`.
- Call `POST /room-end` when the room closes.
- Keep the server path as a fallback (web users unchanged).

## Phase 3 — packaging

- `npm run dist` → Windows NSIS, macOS dmg, Linux AppImage.
- Ship the sidecar inside the asar-unpacked folder.
- Auto-update later (electron-updater).

## Phase 4 — mobile

Android first (libtorrent4j + ExoPlayer), same sync protocol as desktop.
Play Store removes torrent apps, so distribution is direct APK from the site.

## Open items

- Mobile signed-off APK hosting.
- Legal: distributing an app is more visible than a website; keep the
  catalogue metadata-only and honour takedowns.
