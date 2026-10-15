# dipkri

> Real-time synchronized streaming, watch party, screen sharing, and video chat platform.

**dipkri** is a 100% free, minimalist, real-time synchronized media platform. Watch YouTube videos, paste direct video links, share your screen, stream local files from your device, and hang out with video/voice chat and WhatsApp-style floating reactions—all in frame-accurate synchronization with zero registration required.

---

## Features

- **Frame-Accurate Playback Sync**: Real-time play, pause, and seek synchronization across all room participants.
- **Direct P2P Screen Share**: Share your screen, specific app window, or browser tab with system audio in crystal clarity.
- **Direct Local File Streaming**: Play any video file (`.mp4`, `.mkv`, `.webm`, `.avi`) directly from your machine. Friends receive the live synchronized stream peer-to-peer without uploading files to a cloud server.
- **YouTube & Direct URLs**: Synchronously watch YouTube videos or paste direct `.mp4`, `.m3u8` (HLS), or `.mpd` (DASH) video streams.
- **Real-Time Text Chat & Reactions**: Floating emoji reactions, reply composer, system alerts, and chat moderation.
- **Peer-to-Peer Video & Voice Chat**: Integrated webcam and microphone mesh powered by WebRTC and Google STUN.
- **Zero Paywalls**: Completely free, self-hosted, with no subscription tiers or paywalls.

---

## 1-Click Free Deployment on Render

This repository includes a [`render.yaml`](./render.yaml) blueprint ready for zero-cost deployment on [Render.com](https://render.com):

1. Push this project to your GitHub repository.
2. Sign in to [Render.com](https://render.com) using your GitHub account.
3. Click **New +** > **Blueprint**.
4. Select your `dipkri` repository.
5. Render will automatically detect `render.yaml`, configure the build (`npm install && npm run build`), and deploy your web service on a free `https://your-service.onrender.com` domain with free SSL/HTTPS enabled.

---

## Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18+ or 20+ recommended)
- `npm`

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Build the production React frontend
npm run buildReact

# 3. Start the server
npm start
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Environment Variables (Optional)

| Variable | Description |
| :--- | :--- |
| `PORT` | Port for the HTTP/WebSocket server (defaults to `8080`). |
| `NODE_ENV` | Set to `production` when running on a cloud host. |
| `YOUTUBE_API_KEY` | Optional Google API key for YouTube video search within the room. |
| `OPENSUBTITLES_KEY` | Optional API key for subtitle searches via OpenSubtitles.com. |
| `REDIS_URL` | Optional Redis connection string for persistent room state across server restarts. |

---

## License
MIT
