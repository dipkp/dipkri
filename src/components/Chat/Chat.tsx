import React, { RefObject, useContext, useRef, useState } from "react";
import {
  HoverCard,
} from "@mantine/core";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { init } from "emoji-mart";
//@ts-expect-error
import Linkify from "react-linkify";
import { SecureLink } from "react-secure-link";
import styles from "./Chat.module.css";
import {
  WPIconReply,
  WPIconSend,
  WPIconDoubleCheck,
  WPIconClose,
  WPIconPlay,
  WPIconPlus,
} from "../Icons/CustomIcons";

import {
  formatTimestamp,
  getOrCreateClientId,
  isEmojiString,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { Socket } from "socket.io-client";
import { CSSTransition } from "react-transition-group";
import { MetadataContext } from "../../MetadataContext";

const clientId = getOrCreateClientId();

const truncateReply = (input?: string, max = 35) =>
  input && input.length > max ? `${input.slice(0, max)}...` : input || "";

// Authentic WhatsApp group contact colors
const WA_COLORS = [
  "#53bdeb", // cyan/blue
  "#06cf9c", // emerald/green
  "#eb8275", // coral/red
  "#a695e7", // purple
  "#f59e0b", // amber
  "#38bdf8", // sky
  "#ec4899", // pink
  "#10b981", // mint
];

export const getWhatsAppColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WA_COLORS[Math.abs(hash) % WA_COLORS.length];
};

export const getCleanVideoTitle = (raw?: string): string => {
  if (!raw) return "video";
  // If screenshare
  if (raw.startsWith("screenshare://")) {
    return "Screen Share";
  }
  // If YouTube
  const ytMatch = raw.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v)\/))([a-zA-Z0-9_-]{11})/i,
  );
  if (ytMatch) {
    return `YouTube (${ytMatch[1]})`;
  }
  // If Magnet
  if (raw.startsWith("magnet:")) {
    const dnMatch = raw.match(/[?&]dn=([^&]+)/i);
    if (dnMatch) {
      try {
        return decodeURIComponent(dnMatch[1]).replace(/\+/g, " ");
      } catch {
        return dnMatch[1];
      }
    }
    return "Torrent Stream";
  }
  // If standard HTTP/HTTPS link, extract filename
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const url = new URL(raw);
      const filename = url.pathname.split("/").filter(Boolean).pop();
      if (filename) {
        try {
          return decodeURIComponent(filename);
        } catch {
          return filename;
        }
      }
      return url.hostname;
    } catch {
      return raw.length > 35 ? raw.slice(0, 35) + "..." : raw;
    }
  }
  return raw;
};

const extractYouTubeId = (text?: string): string | null => {
  if (!text) return null;
  const match = text.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v)\/))([a-zA-Z0-9_-]{11})/i,
  );
  return match ? match[1] : null;
};

const formatWhatsAppTime = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

const formatWhatsAppDate = (isoString: string) => {
  try {
    const d = new Date(isoString);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return "TODAY";
    }
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return "YESTERDAY";
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
};

interface ChatProps {
  chat: ChatMessage[];
  nameMap: StringDict;
  pictureMap: StringDict;
  socket: Socket;
  scrollTimestamp: number;
  className?: string;
  getMediaDisplayName: (input?: string) => string;
  hide?: boolean;
  isChatDisabled?: boolean;
  owner: string | undefined;
  ref: RefObject<Chat>;
  videoPaused?: boolean;
  isKeyboardOpen?: boolean;
  onKeyboardToggle?: (open: boolean) => void;
}

export class Chat extends React.Component<ChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = {
    chatMsg: "",
    replyTo: undefined as
      | { id: string; timestamp: string; msg?: string }
      | undefined,
    isNearBottom: true,
    isPickerOpen: false,
    targetReactionMsg: null as { id: string; timestamp: string } | null,
    reactionMenu: {
      isOpen: false,
      selectedMsgId: "",
      selectedMsgTimestamp: "",
      yPosition: 0,
      xPosition: 0,
    },
  };
  messagesRef = React.createRef<HTMLDivElement>();
  chatInputRef = React.createRef<HTMLInputElement>();
  lastSendTime = 0;
  blurTimeout: any = null;
  isSending = false;

  async componentDidMount() {
    this.scrollToBottom();
    this.messagesRef.current?.addEventListener("scroll", this.onScroll);
    init({ data });
    if (!this.props.hide) {
      this.props.socket?.emit("CMD:chatSeen");
    }
  }

  componentWillUnmount() {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
    }
    this.messagesRef.current?.removeEventListener("scroll", this.onScroll);
  }

  componentDidUpdate(prevProps: ChatProps) {
    if (this.props.scrollTimestamp !== prevProps.scrollTimestamp) {
      if (prevProps.scrollTimestamp === 0 || this.state.isNearBottom) {
        this.scrollToBottom();
      }
    }
    if (this.props.hide !== prevProps.hide) {
      this.scrollToBottom();
      if (!this.props.hide) {
        this.props.socket?.emit("CMD:chatSeen");
      }
    }
    if (this.props.chat.length !== prevProps.chat.length && !this.props.hide) {
      this.props.socket?.emit("CMD:chatSeen");
    }
    if (!prevProps.isKeyboardOpen && this.props.isKeyboardOpen) {
      setTimeout(() => {
        this.scrollToBottom();
      }, 60);
    }
  }

  setReactionMenu = (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => {
    this.setState({
      reactionMenu: {
        isOpen,
        selectedMsgId: selectedMsgId || "",
        selectedMsgTimestamp: selectedMsgTimestamp || "",
        yPosition: yPosition || 0,
        xPosition: xPosition || 0,
      },
    });
  };

  handleReactionClick = (value: string, id?: string, timestamp?: string) => {
    const targetId = id || this.state.reactionMenu.selectedMsgId;
    const targetTimestamp = timestamp || this.state.reactionMenu.selectedMsgTimestamp;
    if (!targetId || !targetTimestamp) return;

    const msg = this.props.chat.find(
      (m) => m.id === targetId && m.timestamp === targetTimestamp,
    );
    const data = {
      value,
      msgId: targetId,
      msgTimestamp: targetTimestamp,
    };
    if (msg?.reactions?.[value]?.includes(clientId)) {
      this.props.socket.emit("CMD:removeReaction", data);
    } else {
      this.props.socket.emit("CMD:addReaction", data);
    }
  };

  updateChatMsg = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ chatMsg: e.target.value });
  };

  sendChatMsg = () => {
    const now = Date.now();
    if (now - this.lastSendTime < 180) {
      return;
    }
    this.lastSendTime = now;
    const text = this.state.chatMsg.trim();
    if (!text) {
      return;
    }
    if (this.chatTooLong()) {
      return;
    }

    this.isSending = true;
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }

    const keepKeyboardAlive = () => {
      this.chatInputRef.current?.focus();
      requestAnimationFrame(() => {
        this.chatInputRef.current?.focus();
      });
      setTimeout(() => {
        this.chatInputRef.current?.focus();
      }, 50);
      setTimeout(() => {
        this.chatInputRef.current?.focus();
      }, 150);
      setTimeout(() => {
        this.isSending = false;
      }, 350);
    };

    if (this.state.replyTo?.id && this.state.replyTo.timestamp) {
      const chatPayload: ChatPayload = {
        msg: text,
        replyToId: this.state.replyTo.id,
        replyToTimestamp: this.state.replyTo.timestamp,
      };
      this.props.socket.emit("CMD:chatV2", chatPayload);
      this.setState({ chatMsg: "", replyTo: undefined }, keepKeyboardAlive);
      keepKeyboardAlive();
      return;
    }

    this.setState({ chatMsg: "", replyTo: undefined }, keepKeyboardAlive);
    this.props.socket.emit("CMD:chat", text);
    keepKeyboardAlive();
  };

  setReplyTo = (id: string, timestamp: string, msg?: string) => {
    this.setState({ replyTo: { id, timestamp, msg } }, () => {
      setTimeout(() => {
        this.chatInputRef.current?.focus();
      }, 50);
    });
  };

  clearReplyTo = () => {
    this.setState({ replyTo: undefined });
  };

  chatTooLong = () => {
    return Boolean(this.state.chatMsg?.length > 10000);
  };

  onScroll = () => {
    this.setState({ isNearBottom: this.isChatNearBottom() });
  };

  isChatNearBottom = () => {
    return (
      this.messagesRef.current &&
      this.messagesRef.current.scrollHeight -
        this.messagesRef.current.scrollTop -
        this.messagesRef.current.offsetHeight <
        60
    );
  };

  scrollToBottom = () => {
    if (this.messagesRef.current) {
      this.messagesRef.current.scrollTop =
        this.messagesRef.current.scrollHeight;
    }
  };

  formatMessage = (cmd: string, author: string, msg?: string): React.ReactNode => {
    const cleanMedia = getCleanVideoTitle(msg);
    if (cmd === "host") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {" changed the video to "}
          <span className={styles.systemMediaName} title={msg}>
            {cleanMedia}
          </span>
        </React.Fragment>
      );
    } else if (cmd === "playlistAdd") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {" added to queue: "}
          <span className={styles.systemMediaName} title={msg}>
            {cleanMedia}
          </span>
        </React.Fragment>
      );
    } else if (cmd === "seek") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {` jumped to ${formatTimestamp(msg)}`}
        </React.Fragment>
      );
    } else if (cmd === "play") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {` resumed playback at ${formatTimestamp(msg)}`}
        </React.Fragment>
      );
    } else if (cmd === "pause") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {` paused playback at ${formatTimestamp(msg)}`}
        </React.Fragment>
      );
    } else if (cmd === "playbackRate") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {` set playback rate to ${msg === "0" ? "auto" : `${msg}x`}`}
        </React.Fragment>
      );
    } else if (cmd === "lock") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {" locked room controls"}
        </React.Fragment>
      );
    } else if (cmd === "unlock") {
      return (
        <React.Fragment>
          <span className={styles.systemAuthor}>{author}</span>
          {" unlocked room controls"}
        </React.Fragment>
      );
    } else if (cmd === "vBrowserTimeout") {
      return "The Virtual Browser shut down automatically.";
    } else if (cmd === "vBrowserAlmostTimeout") {
      return "The Virtual Browser will shut down soon.";
    }
    return (
      <React.Fragment>
        <span className={styles.systemAuthor}>{author}</span>
        {`: ${cmd}`}
      </React.Fragment>
    );
  };

  addEmoji = (emoji: any) => {
    this.setState({ chatMsg: this.state.chatMsg + emoji.native });
  };

  render() {
    let lastDate = "";

    return (
      <div
        className={`${styles.whatsappChatWrapper} ${this.props.className || ""}`}
        style={{
          display: this.props.hide ? "none" : "flex",
        }}
      >
        {/* WhatsApp Chat Message Feed */}
        <div
          className={styles.chatContainer}
          ref={this.messagesRef}
        >
          {this.props.chat.map((msg, index) => {
            const currentDate = formatWhatsAppDate(msg.timestamp);
            const showDateHeader = currentDate && currentDate !== lastDate;
            if (showDateHeader) {
              lastDate = currentDate;
            }

            return (
              <React.Fragment key={msg.timestamp + msg.id + index}>
                {showDateHeader && (
                  <div className={styles.dateSeparator}>
                    {currentDate}
                  </div>
                )}
                <ChatMessageItem
                  message={msg}
                  pictureMap={this.props.pictureMap}
                  nameMap={this.props.nameMap}
                  formatMessage={this.formatMessage}
                  owner={this.props.owner}
                  socket={this.props.socket}
                  isChatDisabled={this.props.isChatDisabled}
                  isReactionMenuOpen={
                    this.state.reactionMenu.isOpen &&
                    this.state.reactionMenu.selectedMsgId === msg.id &&
                    this.state.reactionMenu.selectedMsgTimestamp === msg.timestamp
                  }
                  setReactionMenu={this.setReactionMenu}
                  handleReactionClick={this.handleReactionClick}
                  onReply={this.setReplyTo}
                  openEmojiPicker={(id, timestamp) => {
                    this.setState({
                      isPickerOpen: true,
                      targetReactionMsg: { id, timestamp },
                      reactionMenu: { ...this.state.reactionMenu, isOpen: false },
                    });
                  }}
                />
              </React.Fragment>
            );
          })}

          {/* Floating WhatsApp Jump to Bottom Button */}
          {!this.state.isNearBottom && (
            <button
              type="button"
              className={styles.jumpToBottomBtn}
              onClick={this.scrollToBottom}
              title="Scroll to bottom"
            >
              ▼
            </button>
          )}
        </div>

        {/* Emoji Picker Popup & Outside click backdrop */}
        {this.state.isPickerOpen && (
          <>
            <div
              className={styles.reactionBackdrop}
              onClick={() =>
                this.setState({ isPickerOpen: false, targetReactionMsg: null })
              }
              onTouchStart={() =>
                this.setState({ isPickerOpen: false, targetReactionMsg: null })
              }
            />
            <div
              style={{
                position: "absolute",
                bottom: "64px",
                left: "8px",
                right: "8px",
                maxWidth: "360px",
                zIndex: 1000,
                boxShadow: "0 12px 36px rgba(0, 0, 0, 0.7)",
                borderRadius: "12px",
                overflow: "hidden",
              }}
            >
              <Picker
                data={data}
                theme="dark"
                dynamicWidth={true}
                previewPosition="none"
                skinTonePosition="search"
                navPosition="top"
                maxFrequentRows={1}
                onEmojiSelect={(emoji: any) => {
                  if (
                    this.state.targetReactionMsg?.id &&
                    this.state.targetReactionMsg?.timestamp
                  ) {
                    this.handleReactionClick(
                      emoji.native,
                      this.state.targetReactionMsg.id,
                      this.state.targetReactionMsg.timestamp,
                    );
                    this.setState({ isPickerOpen: false, targetReactionMsg: null });
                  } else {
                    this.addEmoji(emoji);
                  }
                }}
                onClickOutside={() =>
                  this.setState({ isPickerOpen: false, targetReactionMsg: null })
                }
              />
            </div>
          </>
        )}

        {/* Outside click backdrop for reaction pill */}
        {this.state.reactionMenu.isOpen && (
          <div
            className={styles.reactionBackdrop}
            onClick={() => this.setReactionMenu(false)}
            onTouchStart={() => this.setReactionMenu(false)}
          />
        )}

        {/* WhatsApp Quoted Reply Preview Bar above Composer */}
        {this.state.replyTo && (
          <div className={styles.replyPreviewBar}>
            <div className={styles.replyPreviewInfo}>
              <span className={styles.replyPreviewAuthor}>
                {this.props.nameMap[this.state.replyTo.id] || "Unknown"}
              </span>
              <span className={styles.replyPreviewSnippet}>
                {this.state.replyTo.msg || "Message"}
              </span>
            </div>
            <button
              type="button"
              className={styles.replyCloseBtn}
              onClick={this.clearReplyTo}
              title="Cancel reply"
            >
              <WPIconClose size={16} />
            </button>
          </div>
        )}

        {/* Authentic WhatsApp Composer Bar */}
        <div
          className={`${styles.whatsappComposer} ${
            this.props.isKeyboardOpen ? styles.composerKeyboardOpen : ""
          }`}
        >
          {/* Pill Message Input */}
          <div className={styles.composerInputWrapper}>
            <input
              ref={this.chatInputRef}
              className={styles.composerInput}
              value={this.state.chatMsg}
              onChange={this.updateChatMsg}
              onFocus={() => {
                if (this.blurTimeout) {
                  clearTimeout(this.blurTimeout);
                  this.blurTimeout = null;
                }
                this.props.onKeyboardToggle?.(true);
                if (typeof window !== "undefined") {
                  window.scrollTo(0, 0);
                  document.body.scrollTop = 0;
                  setTimeout(() => {
                    this.scrollToBottom();
                  }, 60);
                }
              }}
              onBlur={() => {
                if (this.isSending) {
                  this.chatInputRef.current?.focus();
                  return;
                }
                this.blurTimeout = setTimeout(() => {
                  if (document.activeElement !== this.chatInputRef.current && !this.isSending) {
                    this.props.onKeyboardToggle?.(false);
                  }
                }, 300);
                if (typeof window !== "undefined") {
                  setTimeout(() => {
                    window.scrollTo(0, 0);
                  }, 60);
                }
              }}
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  this.sendChatMsg();
                }
              }}
              disabled={this.props.isChatDisabled}
              placeholder={
                this.props.isChatDisabled
                  ? "Chat is disabled by room host"
                  : this.state.replyTo
                    ? `Reply to ${this.props.nameMap[this.state.replyTo.id] || "user"}...`
                    : "Type a message"
              }
            />
          </div>

          {/* WhatsApp Circular Green Send Button - NEVER set disabled in DOM to prevent browser cancelling touch and closing keyboard */}
          <button
            type="button"
            tabIndex={-1}
            className={`${styles.sendButton} ${
              this.state.chatMsg.trim() ? styles.sendActive : styles.sendDisabled
            }`}
            style={{
              cursor: this.state.chatMsg.trim() ? "pointer" : "default",
              pointerEvents: this.props.isChatDisabled ? "none" : "auto",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              this.sendChatMsg();
            }}
            onClick={(e) => {
              e.preventDefault();
              this.sendChatMsg();
            }}
            title="Send (Enter)"
          >
            <WPIconSend size={18} />
          </button>
        </div>
      </div>
    );
  }
}

const ChatMessageItem = ({
  message,
  nameMap,
  pictureMap,
  formatMessage,
  socket,
  owner,
  isChatDisabled,
  isReactionMenuOpen,
  setReactionMenu,
  handleReactionClick,
  onReply,
  openEmojiPicker,
}: {
  message: ChatMessage;
  nameMap: StringDict;
  pictureMap: StringDict;
  formatMessage: (cmd: string, author: string, msg?: string) => React.ReactNode;
  socket: Socket;
  owner: string | undefined;
  isChatDisabled: boolean | undefined;
  isReactionMenuOpen?: boolean;
  setReactionMenu: (
    isOpen: boolean,
    selectedMsgId?: string,
    selectedMsgTimestamp?: string,
    yPosition?: number,
    xPosition?: number,
  ) => void;
  handleReactionClick: (value: string, id?: string, timestamp?: string) => void;
  onReply: (id: string, timestamp: string, msg?: string) => void;
  openEmojiPicker?: (id: string, timestamp: string) => void;
}) => {
  const { user } = useContext(MetadataContext);
  const { id, timestamp, cmd, msg, system, isSub, reactions, videoTS, seenBy } = message;

  const [isExpanded, setIsExpanded] = useState(false);
  const CHAT_MSG_MAX_LENGTH = 180;
  const imageMsg = renderImageString(msg);
  const isSeen = Boolean(
    seenBy && Array.isArray(seenBy) && seenBy.some((uid: string) => uid !== clientId && uid !== id),
  );

  // System Message (WhatsApp Centered Pill with Actor/Author & Clean Media)
  if (cmd || system) {
    const author = id ? (nameMap[id] || id) : "System";
    return (
      <div className={styles.systemMessage}>
        {cmd ? formatMessage(cmd, author, msg) : `${author}: ${msg}`}
      </div>
    );
  }

  const isMe = id === clientId;
  const authorName = nameMap[id] || id;
  const authorColor = getWhatsAppColor(id || authorName);
  const isEmojiOnly = isEmojiString(msg);

  const isLongMessage = Boolean(
    msg && msg.length > CHAT_MSG_MAX_LENGTH && !imageMsg,
  );
  const displayedMsg =
    isLongMessage && !isExpanded && msg
      ? msg.slice(0, CHAT_MSG_MAX_LENGTH) + "..."
      : msg;

  const reactionKeys = Object.keys(reactions ?? {});
  const ytVideoId = !cmd && !system ? extractYouTubeId(msg) : null;

  // Swipe to reply and long-press to react state
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isMouseDownRef = useRef(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const startLongPress = (clientX?: number, clientY?: number) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      if (bubbleRef.current) {
        const rect = bubbleRef.current.getBoundingClientRect();
        setReactionMenu(true, id, timestamp, rect.top, clientX || rect.right);
      } else {
        setReactionMenu(true, id, timestamp, clientY, clientX);
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(30);
        } catch {}
      }
    }, 350);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isChatDisabled) return;
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    startLongPress(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;

    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      cancelLongPress();
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
      setIsSwiping(true);
      let pull = 0;
      if (deltaX > 0) {
        pull = Math.min(65, deltaX);
      } else if (isMe && deltaX < 0) {
        pull = Math.max(-65, deltaX);
      }
      setSwipeOffset(pull);
    }
  };

  const handleTouchEnd = () => {
    cancelLongPress();
    if (Math.abs(swipeOffset) >= 32) {
      onReply(id, timestamp, msg);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch {}
      }
    }
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isChatDisabled || e.button !== 0) return;
    touchStartXRef.current = e.clientX;
    touchStartYRef.current = e.clientY;
    isMouseDownRef.current = true;
    startLongPress(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current) return;
    const deltaX = e.clientX - touchStartXRef.current;
    const deltaY = e.clientY - touchStartYRef.current;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      cancelLongPress();
    }
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
      setIsSwiping(true);
      let pull = 0;
      if (deltaX > 0) {
        pull = Math.min(65, deltaX);
      } else if (isMe && deltaX < 0) {
        pull = Math.max(-65, deltaX);
      }
      setSwipeOffset(pull);
    }
  };

  const handleMouseUp = () => {
    cancelLongPress();
    if (isMouseDownRef.current && Math.abs(swipeOffset) >= 32) {
      onReply(id, timestamp, msg);
    }
    isMouseDownRef.current = false;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  return (
    <div
      id={`msg-${id}-${timestamp}`}
      className={`${styles.messageRow} ${isMe ? styles.outgoing : styles.incoming}`}
    >
      <div className={styles.bubbleWrapper}>
        {/* Swipe Reply Icon that appears when sliding message */}
        {Math.abs(swipeOffset) > 5 && (
          <div
            className={styles.swipeReplyIndicator}
            style={{
              left: swipeOffset > 0 ? "6px" : undefined,
              right: swipeOffset < 0 ? "6px" : undefined,
              opacity: Math.min(1, Math.abs(swipeOffset) / 30),
              transform: `scale(${Math.min(1, Math.max(0.4, Math.abs(swipeOffset) / 30))})`,
            }}
          >
            <WPIconReply size={16} />
          </div>
        )}

        <div
          ref={bubbleRef}
          className={`${styles.bubble} ${isMe ? styles.outgoing : styles.incoming}`}
          style={{
            transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
            transition: isSwiping ? "none" : "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease",
            touchAction: "pan-y",
            userSelect: isSwiping ? "none" : undefined,
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (bubbleRef.current) {
              const rect = bubbleRef.current.getBoundingClientRect();
              setReactionMenu(true, id, timestamp, rect.top, e.clientX);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            handleReactionClick("❤️", id, timestamp);
          }}
        >
          {/* Anchored WhatsApp Quick Reaction Pill */}
          {isReactionMenuOpen && (
            <div
              className={styles.bubbleReactionPill}
              onClick={(e) => e.stopPropagation()}
            >
              {["❤️", "👍", "😂", "😮", "😢", "🔥"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={styles.quickReactionEmoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReactionClick(emoji, id, timestamp);
                    setReactionMenu(false);
                  }}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              {openEmojiPicker && (
                <button
                  type="button"
                  className={styles.quickReactionMoreBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEmojiPicker(id, timestamp);
                  }}
                  title="More reactions"
                >
                  +
                </button>
              )}
            </div>
          )}

          {/* Sender Contact Name (for incoming messages in WhatsApp group) */}
          {!isMe && (
            <div className={styles.senderName} style={{ color: authorColor }}>
              <UserMenu
              displayName={authorName}
              timestamp={timestamp}
              socket={socket}
              userToManage={id}
              isChatMessage
              disabled={!Boolean(owner && owner === user?.uid)}
              trigger={
                <span title={isSub ? "dipkri Plus subscriber" : ""}>
                  {authorName}
                </span>
              }
            />
            {isSub && <span className={styles.subscriberBadge}>PRO</span>}
          </div>
        )}

        {/* WhatsApp Quoted Reply snippet inside bubble */}
        {(message.replyToUserId || message.replyToId) && (
          <div
            className={`${styles.replyQuote} ${isMe ? styles.outgoingQuote : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              const targetTime = message.replyToTimestamp;
              const targetId = message.replyToUserId || message.replyToId;
              if (targetTime && targetId) {
                const targetEl = document.getElementById(`msg-${targetId}-${targetTime}`);
                if (targetEl) {
                  targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }
            }}
            title="Jump to quoted message"
            style={{ cursor: "pointer" }}
          >
            <span className={styles.replyQuoteName}>
              {nameMap[message.replyToUserId || message.replyToId || ""] || "User"}
            </span>
            <span className={styles.replyQuoteText}>
              {truncateReply(message.replyToMsg, 50)}
            </span>
          </div>
        )}

        {/* Message Content */}
        <Linkify
          componentDecorator={(decoratedHref: string, decoratedText: string, key: string) => (
            <SecureLink href={decoratedHref} key={key} style={{ color: isMe ? "#a7f3d0" : "#53bdeb" }}>
              {decoratedText}
            </SecureLink>
          )}
        >
          <span className={`${styles.messageText} ${isEmojiOnly ? styles.emojiOnly : ""}`}>
            {displayedMsg}
            {isLongMessage && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className={styles.readMoreLink}
              >
                {isExpanded ? " (Show less)" : " Read more"}
              </span>
            )}
          </span>
        </Linkify>

        {imageMsg}

        {/* Rich YouTube Video Card Preview inside WhatsApp Bubble */}
        {ytVideoId && (
          <div className={styles.videoLinkPreviewCard}>
            <a
              href={`https://www.youtube.com/watch?v=${ytVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.videoLinkThumbWrapper}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={`https://img.youtube.com/vi/${ytVideoId}/mqdefault.jpg`}
                alt="YouTube Thumbnail"
                className={styles.videoLinkThumb}
                loading="lazy"
              />
              <div className={styles.videoLinkPlayBadge}>
                <WPIconPlay size={18} />
              </div>
            </a>
            <div className={styles.videoLinkMeta}>
              <div className={styles.videoLinkTitle}>YouTube Video</div>
              <div className={styles.videoLinkSub}>youtu.be/{ytVideoId}</div>
              <div className={styles.videoLinkActions}>
                <button
                  type="button"
                  className={styles.videoLinkBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    socket.emit("CMD:host", `https://www.youtube.com/watch?v=${ytVideoId}`);
                  }}
                  title="Play this video for the whole room"
                >
                  <WPIconPlay size={12} />
                  <span>Play in Room</span>
                </button>
                <button
                  type="button"
                  className={styles.videoLinkBtnSecondary}
                  onClick={(e) => {
                    e.stopPropagation();
                    socket.emit("CMD:playlistAdd", `https://www.youtube.com/watch?v=${ytVideoId}`);
                  }}
                  title="Add this video to the room playlist"
                >
                  <WPIconPlus size={12} />
                  <span>Queue</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WhatsApp Inline Metadata (Time + Double Blue Ticks for sent) */}
        <div className={styles.messageMeta}>
          <span>{formatWhatsAppTime(timestamp)}</span>
          {isMe && (
            <span
              className={isSeen ? styles.doubleTickBlue : styles.doubleTickGray}
              title={isSeen ? "Seen by others" : "Delivered"}
            >
              <WPIconDoubleCheck size={15} />
            </span>
          )}
        </div>

        {/* WhatsApp Floating Corner Reaction Pill */}
        {reactionKeys.length > 0 && (
          <div style={{ display: "flex", gap: 3, position: "absolute", bottom: -9, [isMe ? "right" : "left"]: 6 }}>
            {reactionKeys.map((key) => {
              const count = reactions?.[key]?.length || 0;
              if (count === 0) return null;
              const hasReacted = reactions?.[key]?.includes(clientId);

              return (
                <HoverCard key={key} openDelay={100}>
                  <HoverCard.Target>
                    <div
                      className={`${styles.reactionBadge} ${hasReacted ? styles.highlighted : ""}`}
                      onClick={() => handleReactionClick(key, id, timestamp)}
                    >
                      <span>{key}</span>
                      {count > 1 && <span className={styles.reactionCounter}>{count}</span>}
                    </div>
                  </HoverCard.Target>
                  <HoverCard.Dropdown className={styles.replyTooltip}>
                    {(reactions?.[key] || [])
                      .map((uId) => nameMap[uId] || "User")
                      .join(", ")}
                  </HoverCard.Dropdown>
                </HoverCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);
};

export const renderImageString = (
  input: string | undefined,
): React.ReactNode | null => {
  let regex =
    /^https?:\/\/.*\/.*\.(png|gif|webp|jpeg|jpg|heic|heif|jfif)\??.*$/gim;
  if (String(input)?.match(regex)) {
    return (
      <img
        style={{
          maxWidth: "100%",
          maxHeight: 240,
          borderRadius: 6,
          marginTop: 4,
          display: "block",
        }}
        src={input}
        alt="User uploaded media"
      />
    );
  }
  return null;
};
