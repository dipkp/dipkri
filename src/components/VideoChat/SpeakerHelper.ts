/**
 * SpeakerHelper — forces HTMLMediaElement audio output to the loudspeaker.
 *
 * On Android Chrome, starting a WebRTC call (getUserMedia + RTCPeerConnection)
 * shifts the OS audio session into "voice call" mode, routing everything
 * through the earpiece.  This module attempts to restore loudspeaker output
 * by calling setSinkId() on media elements whose audio output device label
 * explicitly contains the word "speaker".
 *
 * If no device label identifies a loudspeaker, the function returns an empty
 * string and setSinkId() is never called — the element preserves the browser's
 * existing default audio routing.  No unidentified device ID is stored.
 *
 * Limitations (documented, not worked around):
 *   • Requires a prior user gesture — Chrome rejects setSinkId otherwise.
 *   • enumerateDevices() labels are only non-empty after a getUserMedia
 *     permission grant, which we already hold once a call is active.
 *   • Some Android OEMs do not expose any audiooutput device whose label
 *     contains "speaker"; in that case the existing browser routing is kept.
 *   • This does NOT affect microphone input or WebRTC audio processing in
 *     any way — echo cancellation, noise suppression, and mic capture are
 *     untouched.
 */

let _cachedId: string | null = null;
let _resolving: Promise<string> | null = null;

/** Get the loudspeaker deviceId, searching only for devices whose label
 *  explicitly contains the word "speaker".  Returns "" if none found. */
async function getSpeakerDeviceId(): Promise<string> {
  if (_cachedId !== null) return _cachedId;
  if (_resolving) return _resolving;
  _resolving = (async () => {
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      _cachedId = "";
      return "";
    }
    // Prefer a device whose label explicitly mentions speaker/phone/loudspeaker.
    const named = devices.find(
      (d) => d.kind === "audiooutput" && d.label.toLowerCase().includes("speaker"),
    );
    if (named) {
      _cachedId = named.deviceId;
    } else {
      // No identified loudspeaker — keep empty so setSinkId is never called.
      _cachedId = "";
    }
    return _cachedId;
  })();
  return _resolving;
}

/** Clear any stale cached deviceId so a fresh enumeration runs on next use. */
export const resetSpeakerCache = (): void => {
  _cachedId = null;
  _resolving = null;
};

/** Apply the loudspeaker sink to a single media element, if one was found. */
async function applySpeakerId(
  el: HTMLAudioElement | HTMLVideoElement,
): Promise<void> {
  if (typeof el.setSinkId !== "function") return;
  try {
    const id = await getSpeakerDeviceId();
    if (!id) return; // No identified loudspeaker — skip setSinkId, keep default routing.
    await el.setSinkId(id);
  } catch {
    // setSinkId can reject if the device was removed or the browser blocks it.
    // The element keeps playing through whatever output was already selected.
  }
}

/**
 * Hook to call on every media element that starts playing while a video call
 * is active.  Returns a promise so callers can await it if they wish, but
 * does not throw on failure.
 *
 * Safe to call repeatedly — the deviceId is cached, and an empty string means
 * "skip setSinkId entirely".
 */
export const ensureLoudspeaker = async (
  el: HTMLAudioElement | HTMLVideoElement,
): Promise<void> => {
  if (!window.dipkri?.ourStream) return; // no active call → nothing to do
  await applySpeakerId(el);
};

/**
 * Pre-warm the speaker-device lookup from a user-gesture handler (e.g.
 * onClick of the "Join Video" button) so the async enumerateDevices call
 * completes before the WebRTC stream is acquired.
 */
export const warmSpeakerLookup = (): void => {
  if (_cachedId !== null || _resolving) return;
  _resolving = (async (): Promise<string> => {
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      _cachedId = "";
      return "";
    }
    const named = devices.find(
      (d) => d.kind === "audiooutput" && d.label.toLowerCase().includes("speaker"),
    );
    if (named) {
      _cachedId = named.deviceId;
    } else {
      _cachedId = "";
    }
    return _cachedId;
  })();
};