import React, { useState } from "react";
import { Modal, TextInput, Button } from "@mantine/core";
import { WPIconCopy, WPIconCheck } from "../Icons/CustomIcons";

export const InviteModal = ({
  closeInviteModal,
}: {
  closeInviteModal: () => void;
}) => {
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 3000);
  };

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      title="Invite friends to this room"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <TextInput
          label="Share this link:"
          readOnly
          value={window.location.href}
          onFocus={(e) => e.target.select()}
        />
        <Button
          fullWidth
          color={inviteLinkCopied ? "teal" : "indigo"}
          onClick={handleCopyInviteLink}
          leftSection={inviteLinkCopied ? <WPIconCheck size={16} /> : <WPIconCopy size={16} />}
        >
          {inviteLinkCopied ? "Link Copied to Clipboard!" : "Copy Room Link"}
        </Button>
      </div>
    </Modal>
  );
};
