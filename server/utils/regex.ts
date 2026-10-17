/** This regex searches for YouTube Video IDs from a YouTube URL */
/** example: */
/** YOUTUBE_VIDEO_ID_REGEX.exec('https://youtube.com/?v=14634524364) */
/** will return the id 14634524364 in the first exec group [1] */
export const YOUTUBE_VIDEO_ID_REGEX =
  /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;

/** These regexes allow us to find hours, minutes and seconds from a ISO 8601 time string */
export const PT_HOURS_REGEX = /(\d{1,2})H/;
export const PT_MINUTES_REGEX = /(\d{1,2})M/;
export const PT_SECONDS_REGEX = /(\d{1,2})S/;

/**
 * Unwraps nested proxy stream URLs (such as proxy.valhallastream.com/m3u8?url=... or cors proxies)
 * into their underlying direct playable media stream URLs.
 */
export function resolveMediaUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  let trimmed = rawUrl.trim();

  // Decode common HTML entities like &amp; into &
  if (trimmed.includes("&amp;")) {
    trimmed = trimmed.replace(/&amp;/g, "&");
  }

  // If already magnet, youtube, or local relative stream, return as is
  if (
    trimmed.startsWith("magnet:") ||
    trimmed.startsWith("/stream?") ||
    trimmed.includes("youtube.com") ||
    trimmed.includes("youtu.be")
  ) {
    return trimmed;
  }

  // Check for embedded target stream URL in query parameters
  try {
    const parsed = new URL(trimmed);
    const candidateKeys = [
      "url",
      "src",
      "stream",
      "stream_url",
      "file",
      "file_url",
      "link",
      "target",
      "m3u8",
      "video",
      "uri",
    ];

    for (const key of candidateKeys) {
      const val = parsed.searchParams.get(key);
      if (val) {
        let candidate = val.trim();
        if (candidate.includes("&amp;")) {
          candidate = candidate.replace(/&amp;/g, "&");
        }
        if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
          return candidate;
        }
      }
    }
  } catch {}

  return trimmed;
}
