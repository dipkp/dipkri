import React, { useState } from "react";
import {
  Modal,
  Switch,
  SegmentedControl,
  Badge,
  TextInput,
  Button,
} from "@mantine/core";
import { getCurrentSettings, updateSettings } from "./LocalSettings";
import {
  getWebcamSettings,
  setWebcamSettings,
  BubbleSize,
} from "../VideoChat/webcamSettings";
import { Socket } from "socket.io-client";
import {
  WPIconSettings,
  WPIconTrash,
  WPIconCaptions,
  WPIconMonitor,
  WPIconVolumeOn,
} from "../Icons/CustomIcons";
import {
  getPlayerSettings,
  setPlayerSettings,
} from "../PlayerSettings/playerSettings";
import { audioEnhancer } from "../PlayerSettings/audioEnhancer";
import { qualityManager } from "../PlayerSettings/qualityManager";
import styles from "./Settings.module.css";

interface SettingsModalProps {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  roomLock?: string;
  setRoomLock?: (lock: boolean) => Promise<void>;
  socket?: Socket;
  roomId?: string;
  owner?: string | undefined;
  setOwner?: (owner: string) => void;
  vanity?: string | undefined;
  setVanity?: (vanity: string) => void;
  inviteLink?: string;
  password?: string | undefined;
  setPassword?: (password: string) => void;
  isChatDisabled?: boolean;
  setIsChatDisabled?: (disabled: boolean) => void;
  clearChat?: () => void;
  roomTitle?: string | undefined;
  setRoomTitle?: (title: string) => void;
  roomDescription?: string | undefined;
  setRoomDescription?: (desc: string) => void;
  roomTitleColor?: string | undefined;
  setRoomTitleColor?: (color: string) => void;
  mediaPath?: string | undefined;
  setMediaPath?: (path: string) => void;
  inline?: boolean;
}

export const SettingsModal = ({
  modalOpen,
  setModalOpen,
  inline,
  password,
  setPassword,
  isChatDisabled,
  setIsChatDisabled,
  clearChat,
  roomTitle,
  setRoomTitle,
  roomDescription,
  setRoomDescription,
}: SettingsModalProps) => {
  const [updateTS, setUpdateTS] = useState(0);

  const settingsContent = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. Room Details & Customization (Title, Description, Password) */}
      {(setRoomTitle || setRoomDescription || setPassword) && (
        <>
          <div className={styles.sectionHeader}>Room Details & Password</div>
          <div className={styles.settingCard}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
              {setRoomTitle && (
                <TextInput
                  label="Room Title"
                  placeholder="e.g. Movie Night"
                  value={roomTitle || ""}
                  onChange={(e) => setRoomTitle(e.target.value)}
                />
              )}
              {setRoomDescription && (
                <TextInput
                  label="Room Description"
                  placeholder="e.g. Streaming our favorite shows together"
                  value={roomDescription || ""}
                  onChange={(e) => setRoomDescription(e.target.value)}
                />
              )}
              {setPassword && (
                <TextInput
                  label="Room Password"
                  placeholder="Leave empty for public access"
                  value={password || ""}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* 2. Chat & Moderation */}
      {(setIsChatDisabled || clearChat) && (
        <>
          <div className={styles.sectionHeader}>Chat & Moderation</div>
          {setIsChatDisabled && (
            <SettingRow
              toggle
              name="Disable Chat Messages"
              description="Prevent room participants from sending text chat messages."
              checked={Boolean(isChatDisabled)}
              disabled={false}
              onChange={(e) => setIsChatDisabled(e.currentTarget.checked)}
            />
          )}
          {clearChat && (
            <div className={styles.settingCard}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  width: "100%",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5" }}>
                    Clear Chat History
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                    Erase all messages from the chat box for all participants.
                  </div>
                </div>
                <Button
                  color="red"
                  variant="light"
                  size="xs"
                  onClick={clearChat}
                  leftSection={<WPIconTrash size={14} />}
                >
                  Clear Chat
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 3. Preferences & Webcams */}
      <div className={styles.sectionHeader}>Preferences & Controls</div>

          <SettingRow
            toggle
            updateTS={updateTS}
            name="Disable Chat Notification Sound"
            description="Mute chime sounds when new messages arrive while viewing another tab or window."
            checked={Boolean(getCurrentSettings().disableChatSound)}
            disabled={false}
            onChange={(e) => {
              updateSettings(
                JSON.stringify({
                  ...getCurrentSettings(),
                  disableChatSound: e.currentTarget.checked,
                }),
              );
              setUpdateTS(Date.now());
            }}
          />

          {/* Live Audio Transcription */}
          <SettingRow
            toggle
            updateTS={updateTS}
            name="Live Audio Transcription"
            description="High-speed real-time speech-to-text. Automatically transcribes dialogue and live audio with low latency synchronized to the video."
            label="Live Transcribe"
            checked={Boolean(getPlayerSettings().liveCaptions)}
            disabled={false}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setPlayerSettings({ liveCaptions: checked });
              setUpdateTS(Date.now());
            }}
          />

          {/* Player Quality & Audio Controls Card */}
          <SettingRow
            disabled={false}
            content={
              <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", padding: "4px 0" }}>
                {/* 1. Video Playback Quality */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ maxWidth: "340px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5", display: "flex", alignItems: "center", gap: 6 }}>
                      <WPIconMonitor size={16} color="#6366f1" />
                      Video Quality
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Select playback streaming resolution (Auto adaptive or fixed HD/SD).
                    </div>
                  </div>
                  <SegmentedControl
                    size="xs"
                    value={getPlayerSettings().quality}
                    onChange={(val) => {
                      setPlayerSettings({ quality: val });
                      qualityManager.applyQuality(val);
                      setUpdateTS(Date.now());
                    }}
                    data={[
                      { label: "Auto", value: "auto" },
                      { label: "1080p", value: "1080p" },
                      { label: "720p", value: "720p" },
                      { label: "480p", value: "480p" },
                      { label: "360p", value: "360p" },
                    ]}
                  />
                </div>

                {/* 2. Audio Volume Boost */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ maxWidth: "340px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5", display: "flex", alignItems: "center", gap: 6 }}>
                      <WPIconVolumeOn size={16} color="#34d399" />
                      Audio Boost & Voice Clarity
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Amplify quiet audio and enhance spoken dialogue volume beyond 100%.
                    </div>
                  </div>
                  <SegmentedControl
                    size="xs"
                    value={String(getPlayerSettings().audioBoost)}
                    onChange={(val) => {
                      const boostNum = Number(val) || 100;
                      setPlayerSettings({ audioBoost: boostNum });
                      audioEnhancer.setBoost(boostNum);
                      setUpdateTS(Date.now());
                    }}
                    data={[
                      { label: "100%", value: "100" },
                      { label: "150% Voice", value: "150" },
                      { label: "200% High", value: "200" },
                      { label: "300% Max", value: "300" },
                    ]}
                  />
                </div>
              </div>
            }
          />

          {/* SECTION 2.5: Floating Webcam Bubbles Controls */}
          <SettingRow
            disabled={false}
            content={
              <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", padding: "4px 0" }}>
                {/* 1. Drag Unlock Option */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ maxWidth: "380px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5" }}>
                      Unlock Bubble Dragging
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Turn on to drag and reposition webcam bubbles anywhere over the video. Turn off to lock position and eliminate all drag icons.
                    </div>
                  </div>
                  <Switch
                    size="md"
                    color="indigo"
                    checked={getWebcamSettings().dragUnlocked}
                    onChange={(e) => {
                      const next = e.currentTarget.checked;
                      setWebcamSettings({ dragUnlocked: next });
                      updateSettings(
                        JSON.stringify({
                          ...getCurrentSettings(),
                          webcamDragUnlocked: next,
                        }),
                      );
                      setUpdateTS(Date.now());
                    }}
                  />
                </div>

                {/* 2. Bubble Size Option (Min / Small / Medium / Max) */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5" }}>
                      Webcam Bubble Size
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Adjust circular video head diameter (Minimum to Maximum).
                    </div>
                  </div>
                  <SegmentedControl
                    size="xs"
                    value={getWebcamSettings().size}
                    onChange={(val) => {
                      const newSize = val as BubbleSize;
                      setWebcamSettings({ size: newSize });
                      updateSettings(
                        JSON.stringify({
                          ...getCurrentSettings(),
                          webcamBubbleSize: newSize,
                        }),
                      );
                      setUpdateTS(Date.now());
                    }}
                    data={[
                      { label: "Min (48px)", value: "min" },
                      { label: "Small (70px)", value: "small" },
                      { label: "Medium (95px)", value: "medium" },
                      { label: "Max (145px)", value: "max" },
                    ]}
                  />
                </div>

                {/* 3. Show / Hide Floating Bubbles */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ maxWidth: "380px" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5" }}>
                      Show Floating Webcams
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Display participant video bubbles floating over the video player.
                    </div>
                  </div>
                  <Switch
                    size="md"
                    color="indigo"
                    checked={getWebcamSettings().visible}
                    onChange={(e) => {
                      const next = e.currentTarget.checked;
                      setWebcamSettings({ visible: next });
                      updateSettings(
                        JSON.stringify({
                          ...getCurrentSettings(),
                          webcamBubblesVisible: next,
                        }),
                      );
                      setUpdateTS(Date.now());
                    }}
                  />
                </div>
              </div>
            }
          />

    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlineSettingsContainer}>
        <div className={styles.inlineHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <WPIconSettings size={20} color="#6366f1" />
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#f0f0f5" }}>
              Room Settings
            </span>
          </div>
        </div>
        {settingsContent}
      </div>
    );
  }

  return (
    <>
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        centered
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <WPIconSettings size={20} color="#6366f1" />
            <span>Room Settings</span>
          </div>
        }
        size="lg"
      >
        {settingsContent}
      </Modal>
    </>
  );
};

const SettingRow = ({
  name,
  description,
  checked,
  disabled,
  onChange,
  content,
  subOnly,
  helpIcon,
  toggle,
  label,
}: {
  name?: string;
  description?: React.ReactNode;
  checked?: boolean;
  disabled: boolean;
  updateTS?: number;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  content?: React.ReactNode;
  subOnly?: boolean;
  helpIcon?: React.ReactNode;
  toggle?: boolean;
  label?: string;
}) => {
  return (
    <div className={styles.settingCard}>
      {toggle ? (
        <div className={styles.toggleRow}>
          <div className={styles.settingTextWrapper}>
            <div className={styles.settingTitle}>
              <span>{name}</span>
              {helpIcon}
              {label && (
                <Badge size="xs" color="red" variant="filled">
                  {label}
                </Badge>
              )}
            </div>
            {description && <div className={styles.settingDesc}>{description}</div>}
          </div>
          <Switch
            size="md"
            checked={checked}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      ) : (
        <div style={{ width: "100%" }}>
          {content}
        </div>
      )}
    </div>
  );
};
