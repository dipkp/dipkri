import React, { useState } from "react";
import { Modal, TextInput, Button, Divider } from "@mantine/core";
import { WPIconCopy, WPIconCheck } from "../Icons/CustomIcons";

export const InviteModal = ({
  closeInviteModal,
}: {
  closeInviteModal: () => void;
}) => {
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Extract clean room code from pathname
  const pathParts = window.location.pathname.split("/");
  const roomCode = pathParts[pathParts.length - 1] || "";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 3000);
  };

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 3000);
  };

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      title="Invite Friends to Watch"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Option 1: Private Room Code */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#94a3b8" }}>
            Option 1: Share 6-Digit Room Code
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "12px",
              padding: "10px 16px",
            }}
          >
            <span
              style={{
                fontFamily: "Space Grotesk, monospace",
                fontSize: "22px",
                fontWeight: 700,
                color: "#67e8f9",
                letterSpacing: "3px",
              }}
            >
              {roomCode}
            </span>
            <Button
              size="xs"
              color={codeCopied ? "teal" : "indigo"}
              onClick={handleCopyCode}
              leftSection={codeCopied ? <WPIconCheck size={14} /> : <WPIconCopy size={14} />}
            >
              {codeCopied ? "Code Copied!" : "Copy Code"}
            </Button>
          </div>
          <div style={{ fontSize: "11.5px", color: "#64748b" }}>
            Friends can enter this 6-digit code in "Join with Code" on the home page.
          </div>
        </div>

        <Divider color="rgba(255, 255, 255, 0.08)" label="OR" labelPosition="center" />

        {/* Option 2: Direct URL */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <TextInput
            label="Option 2: Direct Room Link"
            readOnly
            value={window.location.href}
            onFocus={(e) => e.target.select()}
          />
          <Button
            fullWidth
            color={linkCopied ? "teal" : "gray"}
            variant="light"
            onClick={handleCopyInviteLink}
            leftSection={linkCopied ? <WPIconCheck size={16} /> : <WPIconCopy size={16} />}
          >
            {linkCopied ? "Link Copied to Clipboard!" : "Copy Full Link"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
