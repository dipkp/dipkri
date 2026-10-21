# Virtual Browser — setup & operation

VBrowser exists for one reason: **an embed you cannot control still has to stay in sync.**
Instead of every viewer loading their own iframe, one real browser runs in a container and is
streamed over WebRTC. There is exactly one player and one playhead — sync is structural.

This is separate from the Movies → torrent / native player path. Nothing here touches it.

---

## 1. How it fits together

```
Host clicks "Launch VBrowser" (Movies → Web Embed Mirrors)
   └─ App → CMD:startVBrowser
        └─ server/room.ts → server/vm/* (docker | hetzner | digitalocean | scaleway)
             └─ container: neko + chromium  → WebRTC stream
                  └─ every room member watches the same browser
```

Relevant code:

| Piece | File |
|---|---|
| VM providers | `server/vm/docker.ts`, `hetzner.ts`, `digitalocean.ts`, `scaleway.ts` |
| Orchestration worker | `server/vmWorker.ts` (port `VMWORKER_PORT`, default 3100) |
| Room commands | `server/room.ts` → `startVBrowser`, `stopVBrowser` |
| Client | `src/components/VBrowser/VBrowser.tsx`, `src/components/Modal/VBrowserModal.tsx` |
| Movie modal entry | Movies → Web Embed Mirrors → *Launch VBrowser (copies URL)* |

---

## 2. Requirements

| Item | Value |
|---|---|
| Docker host reachable over SSH | local Docker Desktop (dev) or a small VPS (prod) |
| RAM per session | ~1–2 GB standard, ~4 GB HD |
| vCPU per session | 1+ (H.264 encoding is the cost) |
| TCP port | `5100` (neko web UI) |
| UDP ports | `59000-59100` (WebRTC media) |
| Session lifetime | env `VBROWSER_SESSION_SECONDS` (default 10800 s), `VBROWSER_SESSION_SECONDS_LARGE` (86400 s) |

---

## 3. Local test (Windows / Docker Desktop)

```bash
# 1) start a throwaway neko container with the project's built-in script
npm run testvBrowser

# 2) point the app at local Docker — add to .env
DOCKER_VM_HOST=localhost

# 3) run the server in development (vmWorker is imported automatically)
npm run dev
```

Open the app → Movies & Web Series → pick a title → **Web Embed Mirrors** →
**Launch VBrowser (copies URL)** → choose Standard/HD.

When the session window appears: **click inside it, press Ctrl+V, then Enter.** The URL was copied
to your clipboard on launch, so the embed opens inside the shared browser.

---

## 4. Production host (Hetzner / DigitalOcean / Scaleway)

```bash
# on the Docker host
sudo apt update && sudo apt install -y docker.io
sudo usermod -aG docker "$USER"
sudo ufw allow 5100/tcp
sudo ufw allow 59000:59100/udp
```

On the **app** server, configure these variables in `.env` (names only here — set the values in your
secret store, never in git):

- `DOCKER_VM_HOST` — the host's IP
- `DOCKER_VM_HOST_SSH_USER` — usually `root`
- `DOCKER_VM_HOST_SSH_KEY_BASE64` — base64 of the private key that can SSH to that host

Generate the base64 on your machine:

```bash
base64 -w0 ~/.ssh/id_ed25519     # paste the output into the variable above
```

Then restart the service:

```bash
sudo systemctl restart watchparty
```

Sizing guide: a **4 GB / 2 vCPU** box comfortably runs one standard session; **8 GB / 4 vCPU** runs
two or three. Each session keeps its container until the session timer expires.

---

## 5. Verifying it works

1. `curl -s localhost:3100/stats` on the app host → should list available VBrowsers.
2. Launch from the movie modal → the room switches to `vbrowser://<pass>@<host>`.
3. Join from a second device → both see the identical screen and audio.
4. Press pause/skip **inside** the virtual browser → both devices follow exactly.

---

## 6. Known limits (test before you promise)

| Issue | Detail |
|---|---|
| **Datacenter IPs get challenged** | Cloudflare-protected embeds often return "Just a moment…" or 403 to a VPS IP. Neko will not solve the challenge. Test the exact domain from that host first. |
| **DRM will not play** | Netflix / Prime / Disney+ need Widevine; neko has none. |
| **Audio needs one click** | Browser autoplay policy — the viewer must click inside the stream once. |
| **Host-only control** | By design: only the person driving the virtual browser can pause/seek. Viewers adjust their own volume. |
| **Container cost** | Each active session holds RAM for its whole lifetime; cap it with `VBROWSER_SESSION_SECONDS`. |
| **Not on Render free** | No Docker-in-Docker, 512 MB RAM. The Docker host is mandatory; Render only signals. |

---

## 7. Bandwidth note

Video flows **from the Docker host to each viewer** over WebRTC — not through your app server.
That means Render's monthly media budget stays untouched by VBrowser sessions, but the Docker
host's own traffic bill is real: roughly 2–4 Mbps per viewer at 720p30.

Size the host's traffic allowance accordingly, and keep `MEDIA_BANDWIDTH_BUDGET_MB` for the
torrent/native path only.
