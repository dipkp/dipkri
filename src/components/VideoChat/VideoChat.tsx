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
  }

  componentWillUnmount() {
    this.socket.off("signal", this.handleSignal);
  }

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }
  }

  emitUserMute = () => {
    this.socket.emit("CMD:userMute", { isMuted: !this.getAudioWebRTC() });
  };

  handleSignal = async (data: any) => {
    // Handle messages received from signaling server
    const msg = data.msg;
    const from = data.from;
    const selfId = getOrCreateClientId();
    if (from === selfId) return;

    let pc = window.watchparty.videoPCs[from];
    // If we haven't created a peer connection for this sender yet, create it on-demand
    if (!pc) {
      pc = this.createPeerConnection(from);
    }
    if (!pc) {
      return;
    }
    console.log("recv signal", from, data);
    if (msg.ice !== undefined) {
      try {
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
        // If our PC is stale or failed, replace it with a fresh one before handling the offer
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          pc.close();
          delete window.watchparty.videoPCs[from];
          pc = this.createPeerConnection(from);
          if (!pc) return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

        // Flush any queued ICE candidates
        if ((pc as any)._iceQueue) {
          for (const cand of (pc as any)._iceQueue) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {}
          }
          delete (pc as any)._iceQueue;
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(from, { sdp: pc.localDescription });
      } catch (err) {
        console.error("VideoChat error handling offer:", err);
      }
    } else if (msg.sdp && msg.sdp.type === "answer") {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        if ((pc as any)._iceQueue) {
          for (const cand of (pc as any)._iceQueue) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {}
          }
          delete (pc as any)._iceQueue;
        }
      } catch (err) {
        console.error("VideoChat error handling answer:", err);
      }
    }
  };

  setupWebRTC = async () => {
    // Set up our own video
    // Create default stream
    let black = ({ width = 640, height = 480 } = {}) => {
      let canvas: any = Object.assign(document.createElement("canvas"), {
        width,
        height,
      });
      canvas.getContext("2d")?.fillRect(0, 0, width, height);
      let stream = canvas.captureStream();
      return Object.assign(stream.getVideoTracks()[0], { enabled: false });
    };
    let stream = new MediaStream([black()]);

    try {
      stream = await navigator?.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
    } catch (e) {
      console.warn(e);
      try {
        console.log("attempt audio only stream");
        stream = await navigator?.mediaDevices?.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (e) {
        console.warn(e);
      }
    }
    window.watchparty.ourStream = stream;
    // alert server we've joined video chat
    this.socket.emit("CMD:joinVideo");
    this.emitUserMute();
  };

  stopWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    ourStream &&
      ourStream.getTracks().forEach((track) => {
        track.stop();
      });
    window.watchparty.ourStream = undefined;
    Object.keys(videoPCs).forEach((key) => {
      videoPCs[key].close();
      delete videoPCs[key];
    });
    this.socket.emit("CMD:leaveVideo");
  };

  toggleVideoWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    if (ourStream && ourStream.getVideoTracks()[0]) {
      ourStream.getVideoTracks()[0].enabled =
        !ourStream.getVideoTracks()[0]?.enabled;
    }
    this.forceUpdate();
  };

  getVideoWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    return ourStream && ourStream.getVideoTracks()[0]?.enabled;
  };

  toggleAudioWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    if (ourStream && ourStream.getAudioTracks()[0]) {
      ourStream.getAudioTracks()[0].enabled =
        !ourStream.getAudioTracks()[0]?.enabled;
    }
    this.emitUserMute();
    this.forceUpdate();
  };

  getAudioWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    return (
      ourStream &&
      ourStream.getAudioTracks()[0] &&
      ourStream.getAudioTracks()[0].enabled
    );
  };

  createPeerConnection = (id: string): RTCPeerConnection | undefined => {
    const selfId = getOrCreateClientId();
    if (id === selfId) return undefined;
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    const videoRefs = window.watchparty.videoRefs;

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    videoPCs[id] = pc;

    // Add our own video/audio tracks as outgoing stream
    if (ourStream) {
      ourStream.getTracks().forEach((track) => {
        pc.addTrack(track, ourStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(id, { ice: event.candidate });
      }
    };

    pc.ontrack = (event: RTCTrackEvent) => {
      const stream = event.streams[0];
      if (!window.watchparty.remoteStreams) {
        window.watchparty.remoteStreams = {};
      }
      window.watchparty.remoteStreams[id] = stream;
      if (videoRefs[id]) {
        videoRefs[id].srcObject = stream;
        videoRefs[id].play().catch(() => {});
      }
      this.forceUpdate();
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        pc.close();
        delete videoPCs[id];
        this.updateWebRTC();
      }
    };

    return pc;
  };

  updateWebRTC = () => {
    const ourStream = window.watchparty.ourStream;
    const videoPCs = window.watchparty.videoPCs;
    const videoRefs = window.watchparty.videoRefs;
    if (!ourStream) {
      // We haven't started video chat, exit
      return;
    }
    const selfId = getOrCreateClientId();

    // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
    // This allows them to rejoin later
    const clientIds = new Set(
      this.props.participants.filter((p) => p.isVideoChat).map((p) => p.id),
    );
    Object.entries(videoPCs).forEach(([key, value]) => {
      if (!clientIds.has(key)) {
        value.close();
        delete videoPCs[key];
        if (window.watchparty.remoteStreams) {
          delete window.watchparty.remoteStreams[key];
        }
      }
    });

    this.props.participants.forEach((user) => {
      const id = user.id;
      if (!user.isVideoChat || videoPCs[id]) {
        // User isn't in video chat, or we already have a connection to them
        return;
      }
      if (id === selfId) {
        videoPCs[id] = new RTCPeerConnection();
        if (videoRefs[id]) {
          videoRefs[id].srcObject = ourStream;
        }
      } else {
        const pc = this.createPeerConnection(id);
        if (!pc) return;

        // For each pair, have the lexicographically smaller ID be the offerer
        const isOfferer = selfId < id;
        if (isOfferer) {
          const createAndSendOffer = async () => {
            try {
              if (pc.signalingState === "closed") return;
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              this.sendSignal(id, { sdp: pc.localDescription });
            } catch (e) {
              console.warn("VideoChat createOffer failed for", id, e);
            }
          };
          pc.onnegotiationneeded = createAndSendOffer;
          // Trigger offer creation immediately to ensure fast WebRTC connection
          createAndSendOffer();
        }
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
    const ourStream = window.watchparty.ourStream;
    const videoRefs = window.watchparty.videoRefs;
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
                : Boolean(isUserInVideo && (window.watchparty?.remoteStreams?.[p.id] || ourStream))) ? (
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs[p.id] = el;
                      const targetStream = isSelf
                        ? ourStream
                        : window.watchparty?.remoteStreams?.[p.id];
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
                  {isSelf && ourStream && !this.getVideoWebRTC() && (
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
