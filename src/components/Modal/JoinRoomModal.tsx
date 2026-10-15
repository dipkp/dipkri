import React, { useState } from "react";
import { Modal, TextInput, Button } from "@mantine/core";
import { WPIconLogin } from "../Icons/CustomIcons";

export const JoinRoomModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  const [roomCode, setRoomCode] = useState("");

  const handleJoin = () => {
    let code = roomCode.trim();
    if (!code) return;

    // Support entering full URLs like https://.../watch/room-name or /r/vanity
    if (code.includes("/watch/")) {
      code = code.split("/watch/")[1];
    } else if (code.includes("/r/")) {
      const vanity = code.split("/r/")[1];
      window.location.assign(`/r/${vanity}`);
      return;
    } else if (code.startsWith("/")) {
      code = code.replace(/^\//, "");
    }

    // Remove any trailing query parameters or slashes
    code = code.split("?")[0].replace(/\/+$/, "");

    // If it's a numeric code with spaces or hyphens (e.g. "748 291" or "748-291"), normalize to digits
    if (/^\d[\d\s-]+\d$/.test(code)) {
      code = code.replace(/[\s-]+/g, "");
    }

    if (code) {
      window.location.assign(`/watch/${code}`);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="md"
      title="Join Room with Code"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
          Enter the 6-digit room code or link shared by a friend to join their watch party.
        </p>
        <TextInput
          placeholder="e.g. 748291 or room link"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleJoin();
            }
          }}
          autoFocus
        />
        <Button
          fullWidth
          color="indigo"
          onClick={handleJoin}
          disabled={!roomCode.trim()}
          leftSection={<WPIconLogin size={18} />}
        >
          Join Room
        </Button>
      </div>
    </Modal>
  );
};
