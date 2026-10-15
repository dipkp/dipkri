import React, { useState, useCallback, useContext } from "react";
import {
  Button,
  Modal,
  Alert,
  ActionIcon,
  Popover,
  TextInput,
  Badge,
  Switch,
  Loader,
  Divider,
  SegmentedControl,
} from "@mantine/core";
import { getCurrentSettings, updateSettings } from "./LocalSettings";
import { serverPath } from "../../utils/utils";
import { PermanentRoomModal } from "../Modal/PermanentRoomModal";
import { Socket } from "socket.io-client";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { MetadataContext } from "../../MetadataContext";
import {
  WPIconCheck,
  WPIconClose,
  WPIconHelp,
  WPIconPaint,
  WPIconSave,
  WPIconSettings,
  WPIconTrash,
} from "../Icons/CustomIcons";
import styles from "./Settings.module.css";

const defaultRoomTitleColor = "#FFFFFF";
const roomTitleMaxCharLength = 50;
const roomDescriptionMaxCharLength = 120;

interface SettingsModalProps {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  roomLock: string;
  setRoomLock: (lock: boolean) => Promise<void>;
  socket: Socket;
  roomId: string;
  owner: string | undefined;
  setOwner: (owner: string) => void;
  vanity: string | undefined;
  setVanity: (vanity: string) => void;
  inviteLink: string;
  password: string | undefined;
  setPassword: (password: string) => void;
  isChatDisabled: boolean;
  setIsChatDisabled: (disabled: boolean) => void;
  clearChat: () => void;
  roomTitle: string | undefined;
  setRoomTitle: (title: string) => void;
  roomDescription: string | undefined;
  setRoomDescription: (desc: string) => void;
  roomTitleColor: string | undefined;
  setRoomTitleColor: (color: string) => void;
  mediaPath: string | undefined;
  setMediaPath: (path: string) => void;
  inline?: boolean;
}

export const SettingsModal = ({
  modalOpen,
  setModalOpen,
  roomLock,
  setRoomLock,
  socket,
  owner,
  vanity,
  setVanity,
  inviteLink: roomLink,
  password,
  setPassword,
  isChatDisabled,
  setIsChatDisabled,
  clearChat,
  roomTitle,
  roomDescription,
  roomTitleColor,
  mediaPath,
  setMediaPath,
  inline,
}: SettingsModalProps) => {
  const { user, isSubscriber } = useContext(MetadataContext);
  const [updateTS, setUpdateTS] = useState(0);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [validVanity, setValidVanity] = useState(true);
  const [validVanityLoading, setValidVanityLoading] = useState(false);
  const [adminSettingsChanged, setAdminSettingsChanged] = useState(false);
  const [roomTitleInput, setRoomTitleInput] = useState<string | undefined>(
    undefined,
  );
  const [roomDescriptionInput, setRoomDescriptionInput] = useState<
    string | undefined
  >(undefined);
  const [roomTitleColorInput, setRoomTitleColorInput] = useState<
    string | undefined
  >("");

  const setRoomState = useCallback(
    async (data: any) => {
      socket.emit("CMD:setRoomState", {
        ...data,
      });
    },
    [socket, user],
  );

  const setRoomOwner = useCallback(
    async (data: any) => {
      socket.emit("CMD:setRoomOwner", {
        ...data,
      });
    },
    [socket, user],
  );

  const checkValidVanity = useCallback(
    async (input: string) => {
      if (!input) {
        setValidVanity(true);
        return;
      }
      setValidVanity(false);
      setValidVanityLoading(true);
      try {
        const response = await fetch(serverPath + "/resolveRoom/" + input);
        const data = await response.json();
        setValidVanityLoading(false);
        if (
          data &&
          data.vanity &&
          data.vanity !== roomLink.split("/").slice(-1)[0]
        ) {
          setValidVanity(false);
        } else {
          setValidVanity(true);
        }
      } catch (e) {
        setValidVanityLoading(false);
        setValidVanity(true);
      }
    },
    [setValidVanity, roomLink],
  );

  const disableLocking =
    !Boolean(user) || Boolean(roomLock && roomLock !== user?.uid);
  const disableOwning = !Boolean(user) || Boolean(owner && owner !== user?.uid);

  const currentColor =
    roomTitleColorInput || roomTitleColor || defaultRoomTitleColor;

  const settingsContent = (
    <div>
      {/* SECTION 1: Room Controls */}
      <div className={styles.sectionHeader}>Room Controls</div>

          <SettingRow
            toggle
            name="Lock Room"
            description="Only the person who locked the room can control the video and settings."
            checked={Boolean(roomLock)}
            disabled={disableLocking && disableOwning}
            onChange={(e) => setRoomLock(Boolean(e.currentTarget.checked))}
            label={!user ? "Requires Login" : ""}
          />

          <SettingRow
            toggle
            name="Make Room Permanent"
            description="Prevent this room from expiring after 24h of inactivity. Unlocks additional management features."
            helpIcon={
              <span
                onClick={() => setPermModalOpen(true)}
                title="View permanent room benefits"
                style={{ cursor: "pointer", display: "inline-flex" }}
              >
                <WPIconHelp size={16} color="#6366f1" />
              </span>
            }
            checked={Boolean(owner)}
            disabled={disableOwning}
            onChange={(e) => setRoomOwner({ undo: !e.currentTarget.checked })}
            label={!user ? "Requires Login" : ""}
          />

          <Divider my="md" />

          {/* SECTION 2: Local Preferences */}
          <div className={styles.sectionHeader}>Local Preferences</div>

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

          <SettingRow
            disabled={false}
            content={
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "4px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#f0f0f5" }}>
                      Webcam Bubble Size
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      Adjust the size of the floating circular video bubbles over the player.
                    </div>
                  </div>
                  <SegmentedControl
                    size="xs"
                    value={getCurrentSettings().webcamBubbleSize || localStorage.getItem("dipkri-webcam-size") || "medium"}
                    onChange={(val) => {
                      const newSize = val as "small" | "medium" | "large";
                      localStorage.setItem("dipkri-webcam-size", newSize);
                      updateSettings(
                        JSON.stringify({
                          ...getCurrentSettings(),
                          webcamBubbleSize: newSize,
                        }),
                      );
                      setUpdateTS(Date.now());
                    }}
                    data={[
                      { label: "Small (60px)", value: "small" },
                      { label: "Medium (90px)", value: "medium" },
                      { label: "Large (130px)", value: "large" },
                    ]}
                  />
                </div>
              </div>
            }
          />

          <Divider my="md" />

          {/* SECTION 3: Permanent Room Admin Settings */}
          <div className={styles.sectionHeader}>Room Administration</div>

          {!owner && (
            <Alert color="yellow" title="Permanent Room Required">
              Make this room permanent to customize room passwords, vanity URLs, custom title, and media sources.
            </Alert>
          )}

          {owner && owner !== user?.uid && (
            <Alert color="yellow" title="Owner Access Only">
              Only the creator / owner of this permanent room can modify administration settings.
            </Alert>
          )}

          {owner && owner === user?.uid && (
            <>
              {/* Room Password */}
              <SettingRow
                content={
                  <TextInput
                    label="Room Password"
                    description="Guests must enter this password to join the room. Leave empty to allow open access."
                    value={password ?? ""}
                    placeholder="Enter room password..."
                    onChange={(e) => {
                      setAdminSettingsChanged(true);
                      setPassword(e.target.value);
                    }}
                  />
                }
                disabled={false}
              />

              {/* Room Media Source URL */}
              <SettingRow
                content={
                  <TextInput
                    label="Default Media Source"
                    description="Set a custom media URL or YouTube playlist to load automatically."
                    placeholder="https://www.youtube.com/playlist?list=..."
                    value={mediaPath ?? ""}
                    onChange={(e) => {
                      setAdminSettingsChanged(true);
                      setMediaPath(e.target.value);
                    }}
                  />
                }
                disabled={false}
              />

              {/* Disable Chat Toggle */}
              <SettingRow
                toggle
                name="Disable Room Chat"
                description="Temporarily prevent guests and members from sending chat messages."
                checked={Boolean(isChatDisabled)}
                disabled={false}
                onChange={(e) => {
                  setAdminSettingsChanged(true);
                  setIsChatDisabled(Boolean(e.currentTarget.checked));
                }}
              />

              {/* Clear Chat History Card */}
              <div className={styles.dangerCard}>
                <div className={styles.settingTextWrapper}>
                  <div className={styles.settingTitle} style={{ color: "#f87171" }}>
                    <span>Clear Chat History</span>
                  </div>
                  <div className={styles.settingDesc}>
                    Permanently delete all existing chat messages for all participants.
                  </div>
                </div>
                <Button
                  color="red"
                  variant="light"
                  size="xs"
                  onClick={() => clearChat()}
                  leftSection={<WPIconTrash size={14} />}
                >
                  Clear Chat
                </Button>
              </div>

              {/* Custom Room URL */}
              <SettingRow
                disabled={false}
                content={
                  <TextInput
                    label="Custom Room Vanity URL"
                    description="Choose a custom URL path for your room (e.g., /r/my-party)."
                    value={vanity ?? ""}
                    placeholder="custom-vanity-name"
                    leftSection="/r/"
                    leftSectionWidth={42}
                    error={!validVanity ? "This vanity URL is already taken" : undefined}
                    onChange={(e: any) => {
                      setAdminSettingsChanged(true);
                      checkValidVanity(e.target.value);
                      setVanity(e.target.value);
                    }}
                  />
                }
              />

              {/* Room Title, Description & Color */}
              <SettingRow
                disabled={false}
                content={
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <TextInput
                        style={{ flex: 1 }}
                        label="Room Title"
                        description={`Custom room title displayed in the header (max ${roomTitleMaxCharLength} chars).`}
                        value={roomTitleInput ?? roomTitle ?? ""}
                        maxLength={roomTitleMaxCharLength}
                        onChange={(e) => {
                          setAdminSettingsChanged(true);
                          setRoomTitleInput(e.target.value);
                        }}
                        placeholder="My Awesome Room"
                      />

                      {/* Dedicated Color Swatch Popover */}
                      <Popover position="bottom-end" shadow="md">
                        <Popover.Target>
                          <button
                            type="button"
                            className={styles.colorSwatchBtn}
                            title="Choose Title Color"
                          >
                            <span
                              className={styles.colorDot}
                              style={{ backgroundColor: currentColor }}
                            />
                            <WPIconPaint size={14} />
                            <span>Color</span>
                          </button>
                        </Popover.Target>
                        <Popover.Dropdown>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f5" }}>
                              Pick Title Color
                            </div>
                            <HexColorPicker
                              color={currentColor}
                              onChange={(newCol) => {
                                setAdminSettingsChanged(true);
                                setRoomTitleColorInput(newCol);
                              }}
                            />
                            <HexColorInput
                              placeholder="#FFFFFF"
                              color={currentColor}
                              onChange={(newCol) => {
                                setAdminSettingsChanged(true);
                                setRoomTitleColorInput(newCol);
                              }}
                              prefixed
                              style={{
                                background: "rgba(255, 255, 255, 0.08)",
                                border: "1px solid rgba(255, 255, 255, 0.15)",
                                borderRadius: 6,
                                color: "#ffffff",
                                padding: "4px 8px",
                                fontSize: 12,
                                textAlign: "center",
                              }}
                            />
                          </div>
                        </Popover.Dropdown>
                      </Popover>
                    </div>

                    <TextInput
                      label="Room Description"
                      description={`Subtitle / topic displayed under the room title (max ${roomDescriptionMaxCharLength} chars).`}
                      value={roomDescriptionInput ?? roomDescription ?? ""}
                      maxLength={roomDescriptionMaxCharLength}
                      onChange={(e: any) => {
                        setAdminSettingsChanged(true);
                        setRoomDescriptionInput(e.target.value);
                      }}
                      placeholder="Welcome friends! Today we are watching..."
                    />
                  </div>
                }
              />

              {/* Save Settings Button */}
              <div className={styles.saveBtnContainer}>
                <Button
                  size="md"
                  disabled={!validVanity || !adminSettingsChanged}
                  onClick={() => {
                    setRoomState({
                      vanity: vanity,
                      password: password,
                      isChatDisabled: isChatDisabled,
                      roomTitle: roomTitleInput ?? roomTitle,
                      roomDescription: roomDescriptionInput ?? roomDescription,
                      roomTitleColor:
                        roomTitleColorInput ||
                        roomTitleColor ||
                        defaultRoomTitleColor,
                      mediaPath: mediaPath,
                    });
                    setAdminSettingsChanged(false);
                  }}
                  leftSection={<WPIconSave size={18} />}
                >
                  Save Settings
                </Button>
              </div>
            </>
          )}
    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlineSettingsContainer}>
        {permModalOpen && (
          <PermanentRoomModal
            closeModal={() => setPermModalOpen(false)}
          />
        )}
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
      {permModalOpen && (
        <PermanentRoomModal
          closeModal={() => setPermModalOpen(false)}
        />
      )}
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
