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
          Enter a room code or link shared by a friend to join their watch party.
        </p>
        <TextInput
          placeholder="e.g. blue-happy-panda or room code"
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
