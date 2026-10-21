import React from "react";
import { ActionIcon, Button } from "@mantine/core";
import { Socket } from "socket.io-client";

import {
  formatTimestamp,
  getOrCreateClientId,
  getColorForStringHex,
  getDefaultPicture,
  iceServers,
  softWhite,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { MetadataContext } from "../../MetadataContext";
import {
  WPIconDotsVertical,
  WPIconMicrophone,
  WPIconScreenshare,
  WPIconVideo,
  WPIconVideoOff,
  WPIconClose,
} from "../Icons/CustomIcons";

interface VideoChatProps {
  socket: Socket;
  participants: User[];
  pictureMap: StringDict;
  nameMap: StringDict;
  tsMap: NumberDict;
  rosterUpdateTS: Number;
  hide?: boolean;
  owner: string | undefined;
  getLeaderTime: () => number;
}

export class VideoChat extends React.Component<VideoChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  socket = this.props.socket;

  componentDidMount() {
    this.socket.on("signal", this.handleSignal);
    if (typeof window !== "undefined") {
      window.addEventListener("dipkri-stream-update", this.handleStreamUpdate);
    }
    if (window.dipkri.ourStream) {
      this.updateWebRTC();
    }
  }

  retryAttempts = new Map<string, number>();

  componentWillUnmount() {
    this.socket.off("signal", this.handleSignal);
    if (typeof window !== "undefined") {
      window.removeEventListener("dipkri-stream-update", this.handleStreamUpdate);
    }
    // Release camera/mic and every peer connection; otherwise the device stays
    // captured after the panel closes.
    const ourStream = window.dipkri.ourStream;
    if (ourStream) {
      ourStream.getTracks().forEach((track) => track.stop());
      window.dipkri.ourStream = undefined;
      try {
        this.socket.emit("CMD:leaveVideo");
      } catch {}
    }
    Object.keys(window.dipkri.videoPCs).forEach((key) => {
      try {
        window.dipkri.videoPCs[key].close();
      } catch {}
      delete window.dipkri.videoPCs[key];
    });
    if (window.dipkri.remoteStreams) {
      Object.keys(window.dipkri.remoteStreams).forEach((key) => {
        delete window.dipkri.remoteStreams![key];
      });
    }
  }

  handleStreamUpdate = () => {
    this.forceUpdate();
  };

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }
  }

  emitUserMute = () => {
    this.socket.emit("CMD:userMute", { isMuted: !this.getAudioWebRTC() });
  };

  handleSignal = async (data: any) => {
    const msg = data?.msg;
    const from = data?.from;
    const selfId = getOrCreateClientId();
    if (!msg || !from || from === selfId) return;

    let pc: RTCPeerConnection | undefined = window.dipkri.videoPCs[from];
    if (!pc || pc.connectionState === "closed" || pc.connectionState === "failed") {
      if (pc) {
        try {
          pc.close();
        } catch {}
        delete window.dipkri.videoPCs[from];
      }
      pc = this.createPeerConnection(from);
    }
    if (!pc) return;

    if (msg.ice !== undefined) {
      try {
        if (!msg.ice || (!msg.ice.candidate && msg.ice.candidate !== "")) {
          return;
        }
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.ice));
        } else {
          if (!(pc as any)._iceQueue) (pc as any)._iceQueue = [];
          (pc as any)._iceQueue.push(msg.ice);
        }
      } catch (e) {
        console.warn("VideoChat addIceCandidate error:", e);
      }
    } else if (msg.sdp && msg.sdp.type === "offer") {
      try {
        // Ensure our local tracks are attached so the answer includes our outgoing video/audio
        if (window.dipkri.ourStream) {
          const senders = pc.getSenders();
          window.dipkri.ourStream.getTracks().forEach((track) => {
            if (!senders.some((s) => s.track === track)) {
              try {
                pc!.addTrack(track, window.dipkri.ourStream!);
              } catch (e) {}
            }
          });
        }

        const isPolite = selfId > from;
        const isCollision = pc.signalingState !== "stable";
        if (isCollision && !isPolite) {
          console.log("Glared offer ignored from", from);
          return;
        }

        if (isCollision && isPolite) {
          try {
            await pc.setLocalDescription({ type: "rollback" } as any);
          } catch (e) {}
        }

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

        if ((pc as any)._iceQueue && (pc as any)._iceQueue.length > 0) {
          for (const cand of (pc as any)._iceQueue) {
            try {
              if (cand && (cand.candidate || cand.candidate === "")) {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              }
            } catch (e) {}
          }
          delete (pc as any)._iceQueue;
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(from, { sdp: pc.localDescription });
      } catch (err) {
        console.error("VideoChat error handling offer from", from, err);
      }
    } else if (msg.sdp && msg.sdp.type === "answer") {
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          if ((pc as any)._iceQueue && (pc as any)._iceQueue.length > 0) {
            for (const cand of (pc as any)._iceQueue) {
              try {
                if (cand && (cand.candidate || cand.candidate === "")) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                }
              } catch (e) {}
            }
            delete (pc as any)._iceQueue;
          }
        }
      } catch (err) {
        console.error("VideoChat error handling answer from", from, err);
      }
    }
  };

  setupWebRTC = async () => {
    if (window.dipkri.ourStream) {
      // Already in the call — a second join would leak the first capture.
      return;
    }
    let stream: MediaStream | undefined;
    try {
      stream = await navigator?.mediaDevices?.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (e) {
      console.warn("Camera+Mic request failed, falling back to audio only:", e);
      try {
        stream = await navigator?.mediaDevices?.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (err) {
        console.warn("Microphone request also failed:", err);
      }
    }

    if (!stream) {
      window.alert(
        "Camera and microphone are blocked. Allow access in the browser's site settings, then press Join again.",
      );
      return;
    }

    window.dipkri.ourStream = stream;
    this.socket.emit("CMD:joinVideo");
    this.emitUserMute();

    const selfId = getOrCreateClientId();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dipkri-stream-update", {
          detail: { id: selfId, stream },
        }),
      );
    }
    this.updateWebRTC();
    this.forceUpdate();
  };

  stopWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    const videoPCs = window.dipkri.videoPCs;
    if (ourStream) {
      ourStream.getTracks().forEach((track) => track.stop());
    }
    window.dipkri.ourStream = undefined;
    if (window.dipkri.remoteStreams) {
      Object.keys(window.dipkri.remoteStreams).forEach((key) => {
        const el = window.dipkri.videoRefs[key];
        if (el) el.srcObject = null;
        delete window.dipkri.remoteStreams![key];
      });
    }
    this.retryAttempts.clear();
    Object.keys(videoPCs).forEach((key) => {
      try {
        videoPCs[key].close();
      } catch {}
      delete videoPCs[key];
    });
    this.socket.emit("CMD:leaveVideo");

    const selfId = getOrCreateClientId();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dipkri-stream-update", {
          detail: { id: selfId, stream: null },
        }),
      );
    }
    this.forceUpdate();
  };

  toggleVideoWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    if (ourStream && ourStream.getVideoTracks()[0]) {
      const track = ourStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
    }
    const selfId = getOrCreateClientId();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dipkri-stream-update", {
          detail: { id: selfId, stream: ourStream },
        }),
      );
    }
    this.forceUpdate();
  };

  getVideoWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    return Boolean(ourStream && ourStream.getVideoTracks()[0]?.enabled);
  };

  toggleAudioWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    if (ourStream && ourStream.getAudioTracks()[0]) {
      const track = ourStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
    }
    this.emitUserMute();
    this.forceUpdate();
  };

  getAudioWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    return Boolean(
      ourStream &&
      ourStream.getAudioTracks()[0] &&
      ourStream.getAudioTracks()[0].enabled,
    );
  };

  createPeerConnection = (id: string): RTCPeerConnection | undefined => {
    const selfId = getOrCreateClientId();
    if (id === selfId) return undefined;
    const ourStream = window.dipkri.ourStream;
    const videoPCs = window.dipkri.videoPCs;
    const videoRefs = window.dipkri.videoRefs;

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    videoPCs[id] = pc;

    if (ourStream) {
      ourStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, ourStream);
        } catch (e) {}
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(id, {
          ice: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.ontrack = (event: RTCTrackEvent) => {
      if (!window.dipkri.remoteStreams) {
        window.dipkri.remoteStreams = {};
      }
      let stream = window.dipkri.remoteStreams[id];
      if (!stream) {
        stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream();
        window.dipkri.remoteStreams[id] = stream;
      }
      if (!stream.getTracks().includes(event.track)) {
        stream.addTrack(event.track);
      }

      if (videoRefs[id]) {
        if (videoRefs[id].srcObject !== stream) {
          videoRefs[id].srcObject = stream;
        }
        videoRefs[id].play().catch(() => {});
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("dipkri-stream-update", {
            detail: { id, stream },
          }),
        );
      }
      this.forceUpdate();
    };

    // Adding a track after the first negotiation (e.g. camera enabled after an
    // audio-only join) needs a fresh offer; without this the peer never sees video.
    pc.onnegotiationneeded = async () => {
      try {
        if (!pc.currentRemoteDescription) return; // initial offer is sent by updateWebRTC
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(id, { sdp: pc.localDescription });
      } catch (err) {
        console.warn("VideoChat renegotiation failed for", id, err);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState !== "failed") return;
      try {
        pc.close();
      } catch {}
      delete videoPCs[id];
      const attempt = (this.retryAttempts.get(id) || 0) + 1;
      this.retryAttempts.set(id, attempt);
      if (attempt > 4) return; // give up quietly rather than looping forever
      const delay = Math.min(2000 * attempt, 15000);
      setTimeout(() => this.updateWebRTC(), delay);
    };

    return pc;
  };

  updateWebRTC = () => {
    const ourStream = window.dipkri.ourStream;
    const videoPCs = window.dipkri.videoPCs;
    const videoRefs = window.dipkri.videoRefs;
    if (!ourStream) {
      return;
    }
    const selfId = getOrCreateClientId();

    const clientIds = new Set(
      this.props.participants.filter((p) => p.isVideoChat).map((p) => p.id),
    );
    Object.entries(videoPCs).forEach(([key, value]) => {
      if (!clientIds.has(key)) {
        try {
          value.close();
        } catch {}
        delete videoPCs[key];
        if (window.dipkri.remoteStreams) {
          delete window.dipkri.remoteStreams[key];
        }
      }
    });

    this.props.participants.forEach((user) => {
      const id = user.id;
      if (!user.isVideoChat || id === selfId) {
        return;
      }
      let pc: RTCPeerConnection | undefined = videoPCs[id];
      if (!pc || pc.connectionState === "closed" || pc.connectionState === "failed") {
        pc = this.createPeerConnection(id);
      } else if (ourStream && pc) {
        const senders = pc.getSenders();
        ourStream.getTracks().forEach((track) => {
          if (!senders.some((s) => s.track === track)) {
            try {
              pc!.addTrack(track, ourStream);
            } catch (e) {}
          }
        });
      }
      if (!pc) return;

      const isOfferer = selfId < id;
      if (isOfferer && pc.signalingState === "stable" && !pc.currentRemoteDescription) {
        const sendOffer = async () => {
          try {
            if (pc.signalingState !== "stable") return;
            const offer = await pc.createOffer();
            if (pc.signalingState !== "stable") return;
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { sdp: pc.localDescription });
          } catch (e) {
            console.warn("VideoChat createOffer failed for", id, e);
          }
        };
        sendOffer();
      }
    });
  };

  sendSignal = async (to: string, data: any) => {
    console.log("send", to, data);
    this.socket.emit("signal", { to, msg: data });
  };

  render() {
    const { participants, pictureMap, nameMap, tsMap, socket, owner } =
      this.props;
    const ourStream = window.dipkri.ourStream;
    const videoRefs = window.dipkri.videoRefs;
    const selfId = getOrCreateClientId();
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "10px",
          padding: "8px",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {participants.map((p) => {
          const isSelf = p.id === selfId;
          const isUserInVideo = p.isVideoChat;
          return (
            <div
              key={p.id}
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "1 / 1",
                borderRadius: "14px",
                overflow: "hidden",
                background: "#090a0f",
                border: isSelf
                  ? "2px solid rgba(99, 102, 241, 0.45)"
                  : "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
              }}
            >
              {/* Top-Right User Admin Menu */}
              <UserMenu
                displayName={nameMap[p.id] || p.id}
                disabled={!Boolean(owner && owner === this.context.user?.uid)}
                socket={socket}
                userToManage={p.id}
                trigger={
                  <WPIconDotsVertical
                    style={{
                      position: "absolute",
                      right: 6,
                      top: 6,
                      cursor: "pointer",
                      zIndex: 3,
                      color: softWhite,
                      visibility: Boolean(
                        owner && owner === this.context.user?.uid,
                      )
                        ? "visible"
                        : "hidden",
                    }}
                  />
                }
              />

              {/* Action Buttons / Track Status Badges */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  position: "absolute",
                  top: 8,
                  left: 8,
                  zIndex: 3,
                }}
              >
                {!ourStream && isSelf && (
                  <Button
                    size="compact-xs"
                    color="indigo"
                    radius="xl"
                    onClick={this.setupWebRTC}
                    leftSection={<WPIconVideo size={13} />}
                  >
                    Join
                  </Button>
                )}
                {ourStream && isSelf && (
                  <Button
                    size="compact-xs"
                    color="red"
                    radius="xl"
                    onClick={this.stopWebRTC}
                    leftSection={<WPIconClose size={13} />}
                  >
                    Leave
                  </Button>
                )}
                {ourStream && isSelf && (
                  <>
                    <ActionIcon
                      size="sm"
                      radius="xl"
                      color={this.getVideoWebRTC() ? "green" : "red"}
                      variant="filled"
                      onClick={this.toggleVideoWebRTC}
                      title={
                        this.getVideoWebRTC()
                          ? "Turn Video Off"
                          : "Turn Video On"
                      }
                    >
                      <WPIconVideo size={13} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      radius="xl"
                      color={this.getAudioWebRTC() ? "green" : "red"}
                      variant="filled"
                      onClick={this.toggleAudioWebRTC}
                      title={this.getAudioWebRTC() ? "Mute Mic" : "Unmute Mic"}
                    >
                      <WPIconMicrophone size={13} />
                    </ActionIcon>
                  </>
                )}
                {!isSelf && (
                  <>
                    {isUserInVideo && <WPIconVideo size={15} color={softWhite} />}
                    {isUserInVideo && (
                      <WPIconMicrophone
                        size={15}
                        color={p.isMuted ? "#ef4444" : "#10b981"}
                      />
                    )}
                  </>
                )}
                {p.isScreenShare && (
                  <WPIconScreenshare size={15} color="#06b6d4" />
                )}
              </div>

              {/* Bottom Name & Timestamp Overlay */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: "100%",
                  background:
                    "linear-gradient(to top, rgba(9, 10, 15, 0.95), transparent)",
                  padding: "16px 8px 6px",
                  color: softWhite,
                  fontSize: "11px",
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  zIndex: 2,
                }}
              >
                <div
                  title={nameMap[p.id] || p.id}
                  style={{
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    maxWidth: "70%",
                  }}
                >
                  {nameMap[p.id] || p.id} {isSelf ? "(You)" : ""}
                </div>
                <div
                  style={{
                    color: "rgba(255, 255, 255, 0.6)",
                    fontSize: "10px",
                  }}
                >
                  {formatTimestamp(tsMap[p.id] || 0)}
                </div>
              </div>

              {/* Live Video Element or Avatar Picture (Freeze-free) */}
              {(isSelf
                ? Boolean(ourStream && this.getVideoWebRTC())
                : Boolean(
                    isUserInVideo &&
                    window.dipkri?.remoteStreams?.[p.id]?.getVideoTracks()?.length &&
                    window.dipkri.remoteStreams[p.id].getVideoTracks()[0].enabled &&
                    window.dipkri.remoteStreams[p.id].getVideoTracks()[0].readyState === "live",
                  )) ? (
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs[p.id] = el;
                      const targetStream = isSelf
                        ? ourStream
                        : window.dipkri?.remoteStreams?.[p.id];
                      if (targetStream && el.srcObject !== targetStream) {
                        el.srcObject = targetStream;
                        el.play().catch(() => {});
                      }
                    }
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    transform: isSelf ? "scaleX(-1)" : undefined,
                  }}
                  autoPlay
                  playsInline
                  muted={isSelf}
                  data-id={p.id}
                />
              ) : (
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  <img
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                    src={
                      pictureMap[p.id] ||
                      getDefaultPicture(
                        nameMap[p.id],
                        getColorForStringHex(p.id),
                      )
                    }
                    alt={nameMap[p.id] || "User"}
                  />
                  {((isSelf && ourStream && !this.getVideoWebRTC()) ||
                    (!isSelf && isUserInVideo)) && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        background: "rgba(0, 0, 0, 0.7)",
                        backdropFilter: "blur(8px)",
                        borderRadius: "9999px",
                        padding: "5px 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        color: "#f87171",
                        fontSize: "11px",
                        fontWeight: 600,
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                      }}
                    >
                      <WPIconVideoOff size={13} />
                      <span>Camera Off</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
}
