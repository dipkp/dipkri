/**
 * ReDoS-safe utility functions for parsing video URLs and sanitizing media titles.
 */

/**
 * Extracts a YouTube video ID from a URL or string in linear time.
 * Returns null if no valid YouTube ID is found.
 */
export const extractYouTubeId = (text?: string): string | null => {
  if (!text || typeof text !== "string") return null;

  // Short URL: youtu.be/<id>
  const shortMatch = text.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (shortMatch) return shortMatch[1];

  // Embed or v path: youtube.com/embed/<id> or youtube.com/v/<id>
  const embedMatch = text.match(/youtube\.com\/(?:embed|v)\/([a-zA-Z0-9_-]{11})/i);
  if (embedMatch) return embedMatch[1];

  // Watch URL: youtube.com/watch?...v=<id> without recursive backtracking
  const watchMatch = text.match(/youtube\.com\/watch\?[^#\s]*[?&]v=([a-zA-Z0-9_-]{11})/i);
  if (watchMatch) return watchMatch[1];

  return null;
};

/**
 * Strips release group watermarks, tracker domains, and bracketed prefixes
 * from media titles in linear time without backtracking vulnerabilities.
 */
export const stripWebsiteWatermarks = (raw: string): string => {
  if (!raw || typeof raw !== "string") return "";
  let name = raw;

  // Strip leading brackets like [Tag] or (Tag)
  name = name.replace(/^\[[^\]]{1,80}\]\s*[-_–—:]*\s*/g, "");
  name = name.replace(/^\([^)[\]]{1,80}\)\s*[-_–—:]*\s*/g, "");

  // Strip leading web domains e.g. www.site.com or mysite.org
  name = name.replace(/^(?:www\.)?[a-zA-Z0-9-]{1,60}\.[a-zA-Z]{2,10}\s*[-_–—:]*\s*/gi, "");

  // Strip known release group / site brand tags
  const sites =
    "1TamilMV|TamilMV|TamilBlasters|TamilRockers|TamilYogi|Movierulz|Bolly4u|" +
    "KatmovieHD|Vegamovies|YTS|YIFY|PSA|GalaxyRG|TGx|ETRG|RARBG|Extratorrent|" +
    "TorrentCounter|Cinemavilla|Kuttymovies|Pagalworld|PaglaMovies|Isaimini|" +
    "MadrasRockers|MalluMv|JioRockers|BalaRockers|1TamilBlasters|capital|www";

  const siteRegex = new RegExp(`\\b(?:${sites})\\b\\s*[-_–—:]*\\s*`, "gi");
  name = name.replace(siteRegex, "");

  return name;
};
