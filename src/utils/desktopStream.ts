/**
 * Desktop shell helpers.
 *
 * The Electron app runs a local torrent sidecar, so the same web build can
 * stream from 127.0.0.1 instead of the server. Everything here is a pure
 * function so it can be tested without Electron.
 */

export interface DesktopBridge {
  isDesktop?: boolean;
  getSidecar?: () => Promise<{ url: string; token: string; ready: boolean }>;
}

export function getDesktopBridge(): DesktopBridge | undefined {
  const candidate = (globalThis as any)?.dipkriDesktop;
  return candidate && typeof candidate.getSidecar === "function" ? candidate : undefined;
}

/** Pulls the magnet and file index out of whatever the room stored. */
export function parseTorrentSource(src: string): { magnet: string; fileIndex?: string } | null {
  const value = String(src || "");
  if (value.startsWith("magnet:")) return { magnet: value };

  const marker = "/stream?torrent=";
  const at = value.indexOf(marker);
  if (at === -1) return null;

  const rest = value.slice(at + marker.length);
  const [rawMagnet, ...params] = rest.split("&");
  const magnet = decodeURIComponent(rawMagnet);
  if (!magnet.startsWith("magnet:")) return null;

  const indexParam = params.find((p) => p.startsWith("fileIndex="));
  return {
    magnet,
    fileIndex: indexParam ? indexParam.slice("fileIndex=".length) : undefined,
  };
}

/** Builds the local sidecar URL, or null when the source is not a torrent. */
export function buildLocalStreamUrl(
  src: string,
  sidecar: { url: string; token: string },
): string | null {
  if (!sidecar?.url) return null;
  const parsed = parseTorrentSource(src);
  if (!parsed) return null;

  const query = new URLSearchParams({ torrent: parsed.magnet, token: sidecar.token });
  if (parsed.fileIndex) query.set("fileIndex", parsed.fileIndex);
  return `${sidecar.url}/stream?${query.toString()}`;
}

export function desktopRoomEnd(roomId?: string): void {
  const bridge = getDesktopBridge();
  if (!bridge?.getSidecar) return;
  void bridge
    .getSidecar()
    .then(({ url, token }) => {
      if (!url) return;
      return fetch(`${url}/room-end`, {
        method: "POST",
        headers: { "x-dipkri-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
    })
    .catch(() => {});
}
