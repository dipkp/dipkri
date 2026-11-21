# Phase 3 Streaming & Performance Audit: Torrent, Transcoding & Caching

**Auditor:** Senior Node.js Performance & Streaming Engineer  
**Date:** 2026-11-21  
**Files Analyzed:** `server/torrent.ts`, `src/utils/clientTranscode.ts`, `server/server.ts` (subtitle cache)

---

## Executive Summary

The streaming architecture uses a **singleton WebTorrent client** with per-torrent file selection, on-the-fly FFmpeg remuxing (MKV→MP4), audio extraction, and subtitle demuxing. While the design is sophisticated, **three critical resource leaks** exist: (1) FFmpeg child processes not killed on client abort during remux/transcode, (2) Audio cache `audioTranscodeMap` grows unbounded with no TTL/LRU, (3) Subtitle in-memory cache has flawed LRU that doesn't evict expired entries on read. Range request handling has edge-case bugs with malformed headers. Memory pressure on small disks is partially mitigated but incomplete.

---

## 1. Memory & Disk Leaks

### [CRITICAL] FFmpeg Child Processes Not Killed on Client Abort During Remux
**Location:** `server/torrent.ts:795-835` (`handleTorrentStream` → remux branch)

**Code Flow:**
```typescript
const ff = spawn(getFfmpegPath(), args);  // Line 822
if (!canReadDirect) {
  const inStream = targetFile.createReadStream();
  inStream.pipe(ff.stdin);  // Line 825
}
ff.stdout.pipe(res);  // Line 828

const cleanup = () => {
  try { ff.kill("SIGKILL"); } catch {}  // Line 829-831
};
req.on("close", cleanup);
res.on("close", cleanup);
```

**Leak Scenario:**
1. Client requests `/stream?torrent=...&format=mp4` for MKV file → triggers remux
2. FFmpeg starts, reads from `targetFile.createReadStream()` (WebTorrent internal stream)
3. Client **closes browser tab / seeks away / cancels request** → `req.on('close')` fires
4. `cleanup()` kills FFmpeg (`ff.kill("SIGKILL")`) ✅
5. **BUT** `inStream` (WebTorrent read stream) **is not destroyed** — it continues pulling pieces from swarm
6. WebTorrent keeps the torrent active, downloading pieces nobody consumes
7. If many clients start remux then abort → **swarm connections accumulate**, disk fills with partial pieces

**Missing:** `inStream.destroy()` in cleanup, and `targetFile.deselect()` to stop piece requests.

**Fix:**
```typescript
const cleanup = () => {
  try { inStream?.destroy(); } catch {}  // Destroy WebTorrent read stream
  try { ff.kill("SIGKILL"); } catch {}
  try { (targetFile as any).deselect?.(); } catch {}  // Stop piece requests
};
req.on("close", cleanup);
res.on("close", cleanup);
```

---

### [CRITICAL] FFmpeg Child Processes Not Killed on Client Abort During Audio Transcode
**Location:** `server/torrent.ts:1150-1198` (`handleTorrentAudio`)

**Code Flow:**
```typescript
const ff = spawn(getFfmpegPath(), args);  // Line 1151
// ... optional fileStream for caching ...
ff.stdout.pipe(res);  // Line 1174

const cleanup = () => {
  ff.stdout.unpipe(res);
  if (!fileStream) {  // Only kills if NOT caching to disk!
    try { ff.kill("SIGKILL"); } catch {}
  }
};
req.on("close", cleanup);
res.on("close", cleanup);
```

**Leak Scenario:**
1. Client requests `/streamAudio?track=0` from beginning (`ss=0`)
2. `ss === 0 && !audioTranscodeMap.has(cacheKey)` → **starts background cache to disk** (line 1156-1172)
3. `fileStream` created, `ff.stdout.pipe(fileStream)` (line 1164)
4. Client aborts → `cleanup()` runs, but `fileStream` exists → **FFmpeg NOT killed** (line 1179-1181)
4. FFmpeg continues transcoding **entire audio track to disk** with no consumer
5. `ff.on('close')` marks `cacheState.complete = true` (line 1168) → **cache polluted with unwanted file**

**Impact:** Disk fills with unwanted MP3 files. FFmpeg processes accumulate (one per aborted request).

**Fix:** Always kill FFmpeg on client abort. If caching, mark cache as incomplete and delete partial file:
```typescript
const cleanup = () => {
  ff.stdout.unpipe(res);
  ff.stdout.unpipe(fileStream);  // Also unpipe from file
  try { ff.kill("SIGKILL"); } catch {}
  if (fileStream) {
    fileStream.destroy();
    // Delete partial cache file
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 1000);
  }
};
```

---

### [CRITICAL] FFmpeg Child Processes Not Killed on Client Abort During Subtitle Extraction
**Location:** `server/torrent.ts:1247-1265` (`handleTorrentSubtitle`)

**Code:**
```typescript
const ff = spawn(getFfmpegPath(), args);  // Line 1247
const cleanup = () => {
  try { ff.kill("SIGKILL"); } catch {}
};
req.on("close", cleanup);
res.on("close", cleanup);
ff.stdout.pipe(res);  // Line 1261
```

**Issue:** If client aborts **before** `ff.stdout.pipe(res)` (race: `req.on('close')` fires during `spawn`), `cleanup` kills FFmpeg but **stdout may have already piped partial data** — minor. But if `spawn` succeeds and client aborts, cleanup works.

**Bigger Issue:** No cleanup for `ff.stderr` — if FFmpeg writes to stderr, buffer fills and process hangs. Add:
```typescript
ff.stderr?.on("data", () => {});  // Drain stderr to prevent buffer deadlock
```

---

### [HIGH] `audioTranscodeMap` — Unbounded Growth, No TTL/LRU Eviction
**Location:** `server/torrent.ts:39` (declaration), `1058-1198` (usage)

**Current State:**
```typescript
const audioTranscodeMap = new Map<string, AudioCacheState>();  // Line 39
// Never cleaned up. Ever.
```

**Entry Added:** Line 1158-1159 — on first request for a track with `ss=0`
```typescript
cacheState = { filePath, complete: false, process: ff };
audioTranscodeMap.set(cacheKey, cacheState);
```

**Entry Removed:** **Never.** Even after `complete = true` (line 1168), entry stays forever.

**Growth Vectors:**
- Each unique `(magnetUri, fileIndex, season, episode, track)` = new cache key
- User watches 100 different episodes → 100 cache entries → **MP3 files accumulate in `/tmp/watchparty_audio_cache/`**
- No max size, no TTL, no LRU
- Server restart clears memory but **disk files persist** (only cleaned by OS tmp cleaner)

**Fix:** Add periodic sweeper (like `sweepTorrentCache`):
```typescript
const AUDIO_CACHE_MAX_ENTRIES = 50;
const AUDIO_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

setInterval(() => {
  const now = Date.now();
  for (const [key, state] of audioTranscodeMap) {
    if (state.complete) {
      const stat = fs.statSync(state.filePath);
      if (now - stat.mtimeMs > AUDIO_CACHE_MAX_AGE_MS) {
        try { fs.unlinkSync(state.filePath); } catch {}
        audioTranscodeMap.delete(key);
      }
    } else if (!state.process?.killed) {
      // Incomplete transcode abandoned > 10 min ago
      if (state.process?.startTime && now - state.process.startTime > 10 * 60 * 1000) {
        state.process.kill("SIGKILL");
        try { fs.unlinkSync(state.filePath); } catch {}
        audioTranscodeMap.delete(key);
      }
    }
  }
  // Hard cap: delete oldest complete entries
  if (audioTranscodeMap.size > AUDIO_CACHE_MAX_ENTRIES) {
    const entries = [...audioTranscodeMap.entries()].filter(([,s]) => s.complete);
    entries.sort((a,b) => fs.statSync(a[1].filePath).mtimeMs - fs.statSync(b[1].filePath).mtimeMs);
    for (const [key, state] of entries.slice(0, entries.length - AUDIO_CACHE_MAX_ENTRIES)) {
      try { fs.unlinkSync(state.filePath); } catch {}
      audioTranscodeMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
```

---

### [HIGH] Torrent Metadata Cache (`TORRENT_META_DIR`) — No Eviction
**Location:** `server/torrent.ts:27-32`, `407-438`

**Code:** `.torrent` files saved to `os.tmpdir()/watchparty_torrent_meta/` on first metadata fetch (line 432-436). **Never deleted.**

**Growth:** Each unique torrent = 1 `.torrent` file (~50-200KB). 10,000 torrents = 500MB-2GB.

**Fix:** Extend `sweepTorrentCache()` to also clean `TORRENT_META_DIR` for torrents no longer in client:
```typescript
// In sweepTorrentCache():
const metaFiles = fs.readdirSync(TORRENT_META_DIR);
for (const file of metaFiles) {
  const hash = file.replace(".torrent", "");
  const inClient = client.torrents.some(t => t.infoHash?.toLowerCase() === hash);
  if (!inClient) {
    try { fs.unlinkSync(path.join(TORRENT_META_DIR, file)); } catch {}
  }
}
```

---

### [MEDIUM] WebTorrent Singleton — No Graceful Shutdown
**Location:** `server/torrent.ts:43-55` (`getClient`)

**Issue:** `torrentClient` created on first use, **never destroyed**. On server shutdown (SIGTERM, PM2 reload), `gracefulShutdown` in `server.ts` calls `room.destroy()` which calls `stopVBrowserInternal` and `removeTorrent`, but **does not call `torrentClient.destroy()`**.

**Impact:** On PM2 reload, old process may not release ports/connections cleanly. WebTorrent DHT/UTP sockets linger.

**Fix:** Export `destroyTorrentClient()` and call in `gracefulShutdown`:
```typescript
export function destroyTorrentClient() {
  if (torrentClient) {
    torrentClient.destroy();
    torrentClient = null;
  }
  if ((globalThis as any).__wpCacheSweeper) {
    clearInterval((globalThis as any).__wpCacheSweeper);
  }
}
```

---

## 2. Range Request Bugs

### [CRITICAL] Malformed `Range` Header → Crash (Uncaught Exception)
**Location:** `server/torrent.ts:841-866` (`handleTorrentStream` → range branch)

**Code:**
```typescript
const range = req.headers?.range;
const bytesRange = range.replace(/bytes=/, "").trim();
const [startStr, endStr] = bytesRange.split("-");
// ...
start = parseInt(startStr, 10) || 0;  // If startStr = "abc", parseInt = NaN, || 0 = 0
// ...
if (isNaN(start) || isNaN(end) || start >= fileSize || start < 0) {  // Line 863
  res.setHeader("Content-Range", `bytes */${fileSize}`);
  return res.status(416).end();
}
```

**Vulnerability:** `range = "bytes=abc-def"` → `startStr = "abc"`, `parseInt("abc", 10) = NaN`, `NaN || 0 = 0` → `start = 0`. **No crash but wrong behavior** (serves from start instead of 416).

**Worse:** `range = "bytes=0-"` (valid suffix) → `endStr = ""`, `parseInt("", 10) = NaN`, `isNaN(end) = true` → **returns 416** (should serve 0 to end).

**Worse:** `range = "bytes=-"` (invalid) → `startStr = ""`, `endStr = ""` → both NaN → 416.

**Worse:** `range = "bytes=0-,0-"` (multiple ranges) → `split("-")` = `["0", ",0", ""]` → `startStr = "0"`, `endStr = ",0"` → `parseInt(",0") = NaN` → 416.

**Fix:** Strict RFC 7233 parsing:
```typescript
function parseRangeHeader(range: string, fileSize: number): { start: number; end: number } | null {
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
  if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) return null;
  return { start, end };
}
```

---

### [HIGH] Suffix Range `bytes=-N` Not Handled Correctly
**Location:** `server/torrent.ts:848-852`

**Code:**
```typescript
if (!startStr && endStr) {
  // Suffix byte range: bytes=-500000 (last 500KB of file e.g. for MP4 moov atom)
  const suffixLength = parseInt(endStr, 10);
  start = Math.max(0, fileSize - suffixLength);
  end = fileSize - 1;
}
```

**Bug:** `bytes=-500` with `fileSize = 100` → `suffixLength = 500`, `start = Math.max(0, 100 - 500) = 0`, `end = 99` → **serves entire file** (correct per RFC: "if the last-byte-pos value is absent, or if the value is greater than or equal to the current length of the entity-body, last-byte-pos is taken to be equal to one less than the current length of the entity-body").

**But:** No `Content-Range` validation that `suffixLength > 0`. `bytes=-0` → serves entire file.

**Fix:** Add `if (suffixLength <= 0) return res.status(416).end();`

---

### [HIGH] `Content-Range` Header in Remux Branch Always `Accept-Ranges: none`
**Location:** `server/torrent.ts:796-803`

**Code:**
```typescript
if (shouldRemuxToMp4) {
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-cache",
    "Accept-Ranges": "none",  // Line 799 - DISABLES SEEKING
    ...
  });
  // ... ffmpeg remux ...
}
```

**Impact:** When remuxing MKV→MP4, **seeking is disabled** (`Accept-Ranges: none`). Player cannot seek; must download from start.

**Reason:** FFmpeg remux outputs fragmented MP4 to stdout — not seekable without re-running FFmpeg with `-ss`.

**Fix:** Implement **seek support for remux** by parsing `Range` header, passing `-ss` to FFmpeg, and returning `206 Partial Content` with correct `Content-Range`. This requires:
1. Parse `Range` header (same as non-remux branch)
2. Add `-ss <startTime>` to FFmpeg args (line 804 already does for `req.query?.ss`)
3. Set `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`

---

### [MEDIUM] No `If-Range` / `If-Match` Header Support
**Location:** All stream handlers

**Impact:** Clients that cache partial content and validate with `If-Range` (ETag/Last-Modified) will re-download full content on reconnect.

**Fix:** Generate ETag from `infoHash + fileIndex + fileSize + fileMtime`. Handle `If-Range` in all handlers.

---

### [MEDIUM] `handleTorrentAudio` Range Calculation Uses Hardcoded CBR Assumption
**Location:** `server/torrent.ts:1065`

**Code:**
```typescript
const ssByteOffset = ss > 0 ? Math.floor(ss * 24000) : 0; // CBR 192kbps = 24,000 bytes/sec
```

**Bug:** Assumes **exact CBR 192kbps**. FFmpeg `libmp3lame -b:a 192k` is **target bitrate**, not guaranteed CBR. Actual bitrate varies → `ssByteOffset` drifts → **audio seeks to wrong position**.

**Fix:** Either:
1. Use `-c:a libmp3lame -b:a 192k -abr 192k` (enforce ABR closer to CBR) + store actual duration in cache metadata, or
2. Don't support range on cached audio (return `Accept-Ranges: none` for cached), or
3. Use `ffprobe` on cached file to get exact byte offset for timestamp.

---

## 3. Subtitle Cache Leaks

### [CRITICAL] In-Memory Subtitle Cache — LRU Eviction Only on Write, Not Read
**Location:** `server/server.ts:158-183`

**Code:**
```typescript
const SUBTITLE_CACHE_MAX = Number(process.env.SUBTITLE_CACHE_MAX || 150);
const memorySubtitleCache = new Map<string, { buffer: Buffer; expiresAt: number }>();

function cacheSubtitle(hash: string, buffer: Buffer, ttlMs: number): void {
  memorySubtitleCache.delete(hash);  // Re-insert for LRU
  memorySubtitleCache.set(hash, { buffer, expiresAt: Date.now() + ttlMs });
  while (memorySubtitleCache.size > SUBTITLE_CACHE_MAX) {  // Evicts ONLY on write
    const oldest = memorySubtitleCache.keys().next().value;
    if (oldest === undefined) break;
    memorySubtitleCache.delete(oldest);
  }
}

function readSubtitle(hash: string): Buffer | undefined {
  const cached = memorySubtitleCache.get(hash);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    memorySubtitleCache.delete(hash);  // Deletes expired
    return undefined;
  }
  return cached.buffer;  // NO LRU UPDATE ON READ!
}
```

**Leak Scenario:**
1. 200 unique subtitles uploaded → cache fills to 150 (oldest 50 evicted on write)
2. Client repeatedly requests **same 10 popular subtitles** → `readSubtitle` returns buffer but **does not update LRU order**
3. 10 popular entries become "oldest" in Map iteration order
4. 140 new subtitles uploaded → **popular 10 evicted first** (wrong!)
5. Popular subtitles re-fetched from Redis (slow) or re-downloaded

**Fix:** Move accessed entry to end on read (true LRU):
```typescript
function readSubtitle(hash: string): Buffer | undefined {
  const cached = memorySubtitleCache.get(hash);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    memorySubtitleCache.delete(hash);
    return undefined;
  }
  // Move to end (most recently used)
  memorySubtitleCache.delete(hash);
  memorySubtitleCache.set(hash, cached);
  return cached.buffer;
}
```

---

### [HIGH] Subtitle Cache — No Size Limit on Individual Entries
**Location:** `server/server.ts:160`, `217`

**Code:**
```typescript
const SUBTITLE_CACHE_MAX = 150;  // Entry COUNT limit
// ...
let gzipData = gzipSync(data);  // data = raw VTT text, can be HUGE
cacheSubtitle(hash, gzipData, 24 * 60 * 60 * 1000);
```

**Risk:** Attacker POSTs 100MB VTT file → `gzipData` still large (VTT compresses well but not 1000x) → **single entry consumes 10MB+ RAM**. 150 entries = **1.5GB+** → OOM.

**Fix:** Limit entry size:
```typescript
const MAX_SUBTITLE_SIZE = 1024 * 1024; // 1MB compressed
if (gzipData.length > MAX_SUBTITLE_SIZE) {
  return res.status(413).json({ error: "Subtitle too large" });
}
```

---

### [MEDIUM] Subtitle Cache — TTL Not Enforced Proactively
**Location:** `server/server.ts:175-183`

**Code:** Expired entries only removed **on read** (`readSubtitle`). If a subtitle is cached but never requested again, it **stays in Map forever** until evicted by LRU on write.

**Impact:** Memory holds dead entries. With 150 max entries, not catastrophic but wasteful.

**Fix:** Add periodic sweeper (like torrent cache):
```typescript
setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of memorySubtitleCache) {
    if (entry.expiresAt <= now) memorySubtitleCache.delete(hash);
  }
}, 60 * 60 * 1000).unref(); // Hourly
```

---

## Summary: Issue Rankings

| Rank | Issue | File:Line | Effort |
|------|-------|-----------|--------|
| **CRITICAL** | FFmpeg not killed on abort → WebTorrent read stream leak | torrent.ts:822-835 | Medium |
| **CRITICAL** | FFmpeg not killed on abort during audio cache → disk fill | torrent.ts:1150-1198 | Medium |
| **CRITICAL** | Malformed Range header → wrong behavior (not 416) | torrent.ts:841-866 | Low |
| **CRITICAL** | Subtitle cache LRU broken on read → popular entries evicted | server.ts:175-183 | Low |
| **HIGH** | `audioTranscodeMap` unbounded, no TTL/LRU | torrent.ts:39, 1058-1198 | Medium |
| **HIGH** | Torrent metadata cache (`.torrent` files) never cleaned | torrent.ts:27-32, 407-438 | Low |
| **HIGH** | Suffix range `bytes=-N` serves entire file on small files | torrent.ts:848-852 | Low |
| **HIGH** | Remux branch disables seeking (`Accept-Ranges: none`) | torrent.ts:799 | Medium |
| **HIGH** | Subtitle cache no per-entry size limit → OOM risk | server.ts:160, 217 | Low |
| **MEDIUM** | WebTorrent singleton no graceful shutdown | torrent.ts:43-55, server.ts:1380-1408 | Low |
| **MEDIUM** | Audio cache range uses hardcoded CBR assumption | torrent.ts:1065 | Medium |
| **MEDIUM** | No `If-Range`/`If-Match` support for caching | All stream handlers | Medium |
| **MEDIUM** | Subtitle cache TTL not enforced proactively | server.ts:175-183 | Low |
| **MEDIUM** | FFmpeg stderr not drained → potential deadlock | torrent.ts:1247-1265 | Low |

---

## Recommended Fix Order

1. **FFmpeg Abort Cleanup** — Add `inStream.destroy()`, `targetFile.deselect()` in all 3 handlers (torrent.ts:829, 1176, 1248)
2. **Subtitle Cache LRU Fix** — Move entry to end on `readSubtitle` (server.ts:182)
3. **Range Header Parser** — Replace ad-hoc parsing with RFC 7233 compliant function (torrent.ts:841)
4. **Audio Cache Sweeper** — Add periodic cleanup for `audioTranscodeMap` (torrent.ts:39)
5. **Torrent Meta Sweeper** — Extend `sweepTorrentCache()` to clean `TORRENT_META_DIR`
6. **Subtitle Size Limit** — Reject >1MB compressed entries (server.ts:217)
7. **Remux Seeking** — Implement `-ss` support in remux branch (torrent.ts:795-835)
8. **Graceful Shutdown** — Export `destroyTorrentClient()`, call in `server.ts:1380`
9. **Audio Seek Accuracy** — Store actual byte offsets or disable range on cached audio
10. **Proactive TTL Sweepers** — Hourly cleanup for subtitle and audio caches

---

## Appendix: RFC 7233 Compliant Range Parser (Reference)

```typescript
function parseRangeHeader(range: string, fileSize: number): { start: number; end: number } | null {
  // Only handle single byte-range-spec (multi-range not supported)
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startStr, endStr] = match;
  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : fileSize - 1;

  // Suffix-byte-range-spec: bytes=-N
  if (!startStr && endStr) {
    const suffixLength = parseInt(endStr, 10);
    if (suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  }

  // Validate
  if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
    return null;
  }

  return { start, end };
}

// Usage in handleTorrentStream:
const range = req.headers?.range;
if (range) {
  const parsed = parseRangeHeader(range, fileSize);
  if (!parsed) {
    res.setHeader("Content-Range", `bytes */${fileSize}`);
    return res.status(416).end();
  }
  const { start, end } = parsed;
  // ... proceed with 206 response
}
```

---

*End of Phase 3 Streaming & Performance Audit*