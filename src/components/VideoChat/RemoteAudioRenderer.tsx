import React, { useEffect, useRef, useState } from "react";
import { getOrCreateClientId } from "../../utils/utils";
import { ensureLoudspeaker } from "./SpeakerHelper";

/**
 * Plays remote call audio and routes it through a Web Audio graph.
 *
 * Why: Android Chrome routes plain WebRTC audio through the "voice call" stream,
 * which comes out of the earpiece, and HTMLMediaElement.setSinkId() is not
 * available there. Feeding the same MediaStream into an AudioContext puts it on
 * the media stream instead, so it plays through the loudspeaker.
 *
 * The hidden <audio> element stays as a fallback for browsers where the context
 * cannot start yet (autoplay policy) — it is muted whenever the context runs so
 * the voice is never doubled.
 */
export const RemoteAudioRenderer: React.FC<{
  participants: User[];
}> = ({ participants }) => {
  const [, setStreamVersion] = useState(0);
  const [ctxRunning, setCtxRunning] = useState(false);
  const selfId = getOrCreateClientId();

  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  const ensureContext = (): AudioContext => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  };

  // Keep re-rendering so newly arrived streams get picked up.
  useEffect(() => {
    const handleStreamUpdate = () => {
      setStreamVersion((v) => v + 1);
    };
    window.addEventListener("dipkri-stream-update", handleStreamUpdate);
    const interval = setInterval(() => {
      setStreamVersion((v) => v + 1);
    }, 2000);

    return () => {
      window.removeEventListener("dipkri-stream-update", handleStreamUpdate);
      clearInterval(interval);
    };
  }, []);

  // Browsers start an AudioContext suspended; resume it on the first gesture.
  useEffect(() => {
    const unlock = async () => {
      try {
        const ctx = ensureContext();
        await ctx.resume();
        setCtxRunning(ctx.state === "running");
      } catch {
        setCtxRunning(false);
      }
    };

    if (ctxRef.current?.state === "running") {
      setCtxRunning(true);
    }

    document.addEventListener("pointerdown", unlock);
    document.addEventListener("touchstart", unlock);
    document.addEventListener("keydown", unlock);

    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  const remoteVideoUsers = (participants || []).filter(
    (p) => p.isVideoChat && p.id !== selfId,
  );

  // Wire every remote stream into the context once it is running.
  useEffect(() => {
    if (!ctxRunning) return;
    const ctx = ensureContext();
    const nodes = nodesRef.current;
    const activeIds = new Set(remoteVideoUsers.map((u) => u.id));

    for (const user of remoteVideoUsers) {
      const stream = window.dipkri?.remoteStreams?.[user.id];
      if (!stream || nodes.has(user.id)) continue;
      try {
        const source = ctx.createMediaStreamSource(stream);
        source.connect(ctx.destination);
        nodes.set(user.id, source);
      } catch (e) {
        console.warn("Remote audio routing failed:", e);
      }
    }

    // Drop nodes for people who left.
    for (const [id, node] of nodes) {
      if (!activeIds.has(id)) {
        try {
          node.disconnect();
        } catch {}
        nodes.delete(id);
      }
    }
  });

  // Tear everything down when the call UI unmounts.
  useEffect(
    () => () => {
      nodesRef.current.forEach((node) => {
        try {
          node.disconnect();
        } catch {}
      });
      nodesRef.current.clear();
      try {
        ctxRef.current?.close();
      } catch {}
      ctxRef.current = null;
    },
    [],
  );

  return (
    <div
      style={{
        position: "fixed",
        top: -9999,
        left: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
        zIndex: -1,
      }}
      aria-hidden="true"
    >
      {remoteVideoUsers.map((user) => {
        const stream = window.dipkri?.remoteStreams?.[user.id];
        return (
          <audio
            key={`remote-audio-${user.id}`}
            ref={(el) => {
              if (el && stream && el.srcObject !== stream) {
                el.srcObject = stream;
                el.play().then(() => {
                  // Desktop bonus: some browsers can target the speaker directly.
                  ensureLoudspeaker(el).catch(() => {});
                }).catch(() => {
                  const unlock = () => {
                    el.play().catch(() => {});
                    document.removeEventListener("click", unlock);
                    document.removeEventListener("touchstart", unlock);
                  };
                  document.addEventListener("click", unlock, { once: true });
                  document.addEventListener("touchstart", unlock, { once: true });
                });
              }
            }}
            autoPlay
            playsInline
            // Context carries the sound once running; avoid double audio.
            muted={ctxRunning}
          />
        );
      })}
    </div>
  );
};
