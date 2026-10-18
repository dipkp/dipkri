import React, { useEffect, useState } from "react";
import { getOrCreateClientId } from "../../utils/utils";

export const RemoteAudioRenderer: React.FC<{
  participants: User[];
}> = ({ participants }) => {
  const [, setStreamVersion] = useState(0);
  const selfId = getOrCreateClientId();

  useEffect(() => {
    const handleStreamUpdate = () => {
      setStreamVersion((v) => v + 1);
    };
    window.addEventListener("watchparty-stream-update", handleStreamUpdate);
    const interval = setInterval(() => {
      setStreamVersion((v) => v + 1);
    }, 2000);

    return () => {
      window.removeEventListener("watchparty-stream-update", handleStreamUpdate);
      clearInterval(interval);
    };
  }, []);

  const remoteVideoUsers = (participants || []).filter(
    (p) => p.isVideoChat && p.id !== selfId,
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
        const stream = window.watchparty?.remoteStreams?.[user.id];
        return (
          <audio
            key={`remote-audio-${user.id}`}
            ref={(el) => {
              if (el && stream && el.srcObject !== stream) {
                el.srcObject = stream;
                el.play().catch(() => {
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
          />
        );
      })}
    </div>
  );
};
