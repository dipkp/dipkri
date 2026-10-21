# Deploy WatchParty on a Linux VPS — from zero

Works on **Ubuntu 22.04 / 24.04**, x86 (Hetzner, DigitalOcean) or ARM (Oracle Always Free).

The app is a **single Node process**: it serves the API, the Socket.IO rooms, and the built
frontend (`express.static(BUILD_DIRECTORY)`). nginx only terminates TLS and proxies to `:8080`.

---

## 0. What you need

| Item | Notes |
|---|---|
| VPS | Oracle Always Free (`VM.Standard.A1.Flex`, 2–4 OCPU, 12–24 GB) or Hetzner CX22 (~€4) |
| OS | Ubuntu 22.04 LTS |
| Domain | optional, but needed for HTTPS |
| Ports | 22, 80, 443 open |
| Repo | this project, with the branch you want to run |

---

## 1. First login

```bash
ssh ubuntu@YOUR_SERVER_IP          # Hetzner: root@... ; Oracle: ubuntu@...
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential nginx
```

Create a non-root user for the service:

```bash
sudo adduser --system --group --home /opt/watchparty watchparty
```

---

## 2. Firewall

**Generic (Hetzner/DO):**

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

**Oracle only — two layers, both required:**

1. Console → your VCN → Security List → add ingress rules for TCP 80 and 443.
2. The Ubuntu image ships with `iptables` rules that drop everything except SSH:

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. Swap (only if RAM ≤ 2 GB)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v        # expect v22.x
```

---

## 5. FFmpeg

The repo depends on `ffmpeg-static`, but a system binary is more reliable (especially on ARM):

```bash
sudo apt install -y ffmpeg
ffmpeg -version | head -1
```

If `ffmpeg-static` misbehaves on ARM, point the app at the system binary with `FFMPEG_PATH=/usr/bin/ffmpeg`.

---

## 6. Get the code and build

```bash
sudo mkdir -p /opt/watchparty && sudo chown watchparty:watchparty /opt/watchparty
sudo -u watchparty git clone https://github.com/YOUR_USER/YOUR_REPO.git /opt/watchparty
cd /opt/watchparty
sudo -u watchparty git checkout main        # or experiment/movie-stream
sudo -u watchparty npm ci
sudo -u watchparty npm run build            # produces ./build
```

Verify the build exists:

```bash
ls build/index.html
```

---

## 7. Environment file

```bash
sudo -u watchparty tee /opt/watchparty/.env >/dev/null <<'ENV'
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# TMDB catalog (trending / search / details)
TMDB_API_KEY=YOUR_TMDB_KEY

# Media egress budget in MB — set near your host's monthly allowance
MEDIA_BANDWIDTH_BUDGET_MB=15000

# Optional integrations (leave blank if unused)
OPENSUBTITLES_KEY=
REDIS_URL=
DATABASE_URL=
ENV
sudo chmod 600 /opt/watchparty/.env
```

---

## 8. systemd service

```bash
sudo tee /etc/systemd/system/watchparty.service >/dev/null <<'UNIT'
[Unit]
Description=WatchParty
After=network.target

[Service]
Type=simple
User=watchparty
Group=watchparty
WorkingDirectory=/opt/watchparty
EnvironmentFile=/opt/watchparty/.env
ExecStart=/usr/bin/node --experimental-strip-types server/server.ts
Restart=always
RestartSec=5
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now watchparty
sudo systemctl status watchparty --no-pager
```

Smoke test before touching nginx:

```bash
curl -s localhost:8080/ping          # -> "pong"
```

---

## 9. nginx reverse proxy

```bash
sudo tee /etc/nginx/sites-available/watchparty >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN;

    client_max_body_size 25m;

    # WebSocket + media streaming
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Video range requests must not be buffered or time out
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/watchparty /etc/nginx/sites-enabled/watchparty
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 10. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN --redirect
sudo systemctl status certbot.timer     # auto-renew
```

> If you put Cloudflare in front: keep the DNS record **grey-cloud (DNS only)** for the media
> hostname. Cloudflare's free plan forbids proxying video traffic.

---

## 11. Verify the deployment

```bash
# 1) app is served
curl -sI https://YOUR_DOMAIN/ | head -3                 # 200

# 2) sockets reachable (engine.io handshake)
curl -s "https://YOUR_DOMAIN/socket.io/?EIO=4&transport=websocket" -o /dev/null -w '%{http_code}\n'

# 3) catalog
curl -s "https://YOUR_DOMAIN/api/movies/trending?type=movie" | head -c 120

# 4) range streaming (any working torrent)
curl -s -o /dev/null -D - -H 'Range: bytes=0-1023' \
  "https://YOUR_DOMAIN/stream?torrent=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel"))')&fileIndex=5" \
  | head -5                                              # expect 206 + Content-Range
```

Then open `https://YOUR_DOMAIN`, create a room, and join from a second device.

---

## 12. Updating

```bash
cd /opt/watchparty
sudo -u watchparty git pull
sudo -u watchparty npm ci
sudo -u watchparty npm run build
sudo systemctl restart watchparty
```

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Node not running | `journalctl -u watchparty -n 50` |
| Sockets disconnect every 30 s | Missing `Upgrade`/`Connection` headers | re-check the nginx block above |
| Video plays but can't seek | `proxy_buffering on` | set `proxy_buffering off` |
| Page loads, `/api/movies/*` 404 | Wrong branch/build | rebuild, confirm `build/index.html` |
| `ffmpeg: not found` | ARM binary mismatch | `apt install ffmpeg`, set `FFMPEG_PATH` |
| Oracle: nothing reachable on 80 | iptables + security list | fix both layers (§2) |
| 503 with `budget exhausted` | `MEDIA_BANDWIDTH_BUDGET_MB` reached | raise it or serve media elsewhere |

---

## 14. Notes

- **Bandwidth:** pick `MEDIA_BANDWIDTH_BUDGET_MB` close to your host's monthly allowance; the server
  returns a clear `503` once the budget is hit instead of silently blowing the plan.
- **Legal:** hosting copyrighted streams you don't have rights to violates every host's ToS and
  exposes you to DMCA takedowns and account termination. Run this on content you own, licence, or
  that is public domain / CC (e.g. Blender open movies, Internet Archive).
- **Cost:** Hetzner CX22 ≈ €4/mo with 20 TB traffic; Oracle Always Free gives 10 TB/mo for $0.
