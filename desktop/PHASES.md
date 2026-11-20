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

## Phase 1 — desktop shell + local streaming (done)

| Piece | File | Status |
|---|---|---|
| Local torrent sidecar (HTTP, Range) | `desktop/sidecar.mjs` | done, tested |
| Electron shell loading dipkri UI | `desktop/main.js` | done, tested |
| Bridge to the web UI | `desktop/preload.js` | done |
| Packaging config (nsis/dmg/AppImage) | `desktop/package.json` | written, not built |

### Sidecar endpoints

`/health` is open (loopback only). Every other endpoint needs the per-launch
token, either as the `x-dipkri-token` header or as `?token=...` — a `<video>`
element can only use the query form.

```
GET  /health                                  -> { ok, torrents, freeDiskGB, cacheMB }
GET  /info?torrent=<magnet>&token=...         -> { name, infoHash, files[] }
GET  /stream?torrent=<magnet>&fileIndex=N&token=...
                                              -> video bytes, Range supported
POST /stop        { infoHash }                -> destroy + delete files
POST /room-end                                -> destroy + delete everything
```

Also enforced: `Host` must be loopback (DNS rebinding), and a browser `Origin`
must be one of the app origins (`Access-Control-Allow-Origin` is never `*`).

### Env knobs

```
DIPKRI_SIDECAR_PORT   17891      first port to try; falls back if busy
DIPKRI_CACHE_DIR      %TEMP%     parent folder; the sidecar owns "<parent>/dipkri-cache"
DIPKRI_IDLE_MINUTES   30         drop a torrent after N idle minutes
DIPKRI_MIN_FREE_GB    1          refuse a stream when this device is nearly full
DIPKRI_META_TIMEOUT_MS 40000     give up when no seeder answers
DIPKRI_TOKEN          (set by main.js per launch)   required; the sidecar refuses to start without it
                                                      standalone: DIPKRI_TOKEN=dev-secret npm run sidecar
DIPKRI_APP_URL        https://dipkri.duckdns.org    page the shell loads
```

### Verified on Windows (Node 24, webtorrent 2.8.5, Electron 45)

Sintel magnet, 13 checks, all pass:

```
/health 200                        /info without token 401
/info with token 200               /stream Range 206 (2 MB, valid MP4 ftyp)
Range bytes=abc -> 416             Range bytes=999999999- -> 416
fileIndex=abc -> 400               Origin: https://evil.example -> 403
POST /room-end without token 401   POST /stop {} -> 400
/stop { infoHash } 200             cache 123.3 MB -> 0 MB, 0 files left
quit via IPC -> sidecar exit 0, cache dir removed
```

## Phase 2 — wire the UI to the sidecar

```js
const api = window.dipkriDesktop;            // undefined in a normal browser

if (!api) {
  // website: nothing changes, keep streaming from the server
  video.src = `/torrent/stream?...`;
} else {
  // desktop: the endpoint and token only exist once the sidecar is confirmed
  const { url, token, ready } = await api.getSidecar();
  if (ready) {
    video.src = `${url}/stream?torrent=${encodeURIComponent(magnet)}` +
                `&fileIndex=${i}&token=${token}`;
  }

  const res = await fetch(`${url}/room-end`, {
    method: "POST",
    headers: { "x-dipkri-token": token },
  });
  if (!res.ok) {
    console.warn("cache cleanup was refused", res.status); // 401/503: files remain
  }
}
```

- Never hardcode `17891`: the sidecar may have fallen back to another port.
- `token` must go in the query string for `<video>`, in the header for `fetch`.
- `getSidecar()` returns `ready: false` (and no token) until the child confirms.
- Web users keep the current server path; only the desktop build switches.

## Phase 3 — packaging

- `npm run dist` builds the configured target for the host platform
  (Windows → NSIS). Build the others on their own machines, or add
  `--win --mac --linux` where the toolchain allows it.
- electron-builder packs `dependencies` (webtorrent) and unpacks `*.node`.
- Auto-update later (electron-updater).

## Phase 4 — mobile

Android first (libtorrent4j + ExoPlayer), same sync protocol as desktop.
Play Store removes torrent apps, so distribution is direct APK from the site.

## Open items

- Build an actual installer and run it on a clean Windows box.
- Mobile APK hosting.
- Legal: distributing an app is more visible than a website; keep the
  catalogue metadata-only and honour takedowns.
- Dependency pins (`uint8-util` 2.2.5) exist because 2.3.2 broke magnet parsing
  in webtorrent; revisit when webtorrent ships a fix.
