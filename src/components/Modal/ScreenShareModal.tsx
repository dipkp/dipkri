import React from "react";
import { Modal, Button } from "@mantine/core";
import { WPIconScreenshare } from "../Icons/CustomIcons";
import styles from "./SourceModal.module.css";

export const ScreenShareModal = ({
  closeModal,
  startScreenShare,
}: {
  closeModal: () => void;
  startScreenShare: (useMediaSoup: boolean) => void;
}) => {
  return (
    <Modal
      opened={true}
      onClose={closeModal}
      centered
      size="md"
      title={
        <div className={styles.modalHeader}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(59, 130, 246, 0.2)",
              color: "#60a5fa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WPIconScreenshare size={18} />
          </div>
          <span className={styles.modalHeaderTitle}>Share Your Screen</span>
        </div>
      }
    >
      <div className={styles.modalWrapper}>
        <div style={{ textAlign: "center", padding: "12px 6px" }}>
          <p style={{ color: "#94a3b8", fontSize: "14px", lineHeight: "1.6", margin: "0 0 20px 0" }}>
            Share your entire screen, application window, or browser tab with full audio synchronization for everyone in the room.
          </p>
          <Button
            size="md"
            fullWidth
            variant="filled"
            color="blue"
            onClick={() => {
              startScreenShare(false);
              closeModal();
            }}
          >
            Start Screen Share
          </Button>
        </div>
      </div>
    </Modal>
  );
};
