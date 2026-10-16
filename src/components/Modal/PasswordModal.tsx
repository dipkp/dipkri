import React, { useCallback } from "react";
import { Modal, PasswordInput, Button } from "@mantine/core";
import { addAndSavePassword } from "../../utils/utils";

export const PasswordModal = ({ roomId }: { roomId: string }) => {
  const setPassword = useCallback(() => {
    const password = (
      document.getElementById("roomPassword") as HTMLInputElement
    )?.value;
    if (password) {
      addAndSavePassword(roomId, password);
      window.location.reload();
    }
  }, [roomId]);

  return (
    <Modal
      onClose={() => {}}
      withCloseButton={false}
      opened
      centered
      size="md"
      title="This room requires a password"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <PasswordInput
          id="roomPassword"
          placeholder="Enter room password..."
          onKeyDown={(e: any) => e.key === "Enter" && setPassword()}
          autoFocus
        />
        <Button fullWidth color="indigo" onClick={setPassword}>
          Enter Room
        </Button>
      </div>
    </Modal>
  );
};
