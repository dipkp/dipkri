import React, { useState } from "react";
import { Modal, Button, Switch } from "@mantine/core";
import { isClientTranscodeSupported } from "../../utils/clientTranscode";
import { WPIconFile } from "../Icons/CustomIcons";
import styles from "./SourceModal.module.css";

export const FileShareModal = (props: {
  closeModal: () => void;
  startFileShare: (
    useMediaSoup: boolean,
    options?: { convert?: boolean },
  ) => void;
}) => {
  const { closeModal } = props;
  const [convert, setConvert] = useState(false);
  const canConvert = isClientTranscodeSupported();

  return (
    <Modal
      opened
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
              background: "rgba(139, 92, 246, 0.2)",
              color: "#c084fc",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WPIconFile size={18} />
          </div>
          <span className={styles.modalHeaderTitle}>Share a Local Media File</span>
        </div>
      }
    >
      <div className={styles.modalWrapper}>
        <div className={styles.optionControl} style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#f0f0f5" }}>Hardware Transcode</div>
              <div style={{ fontSize: "11.5px", color: "#94a3b8" }}>
                {canConvert
                  ? "Auto-converts MKV/AVI via local GPU/CPU"
                  : "Browser WebCodecs not supported"}
              </div>
            </div>
            <Switch
              disabled={!canConvert}
              checked={convert}
              onChange={(e) => setConvert(e.currentTarget.checked)}
              color="violet"
            />
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <p style={{ color: "#94a3b8", fontSize: "14px", lineHeight: "1.6", margin: "0 0 20px 0" }}>
            Select any video or audio file on your device to stream synchronously with everyone in the room.
          </p>
          <Button
            size="md"
            fullWidth
            variant="filled"
            color="violet"
            onClick={() => {
              props.startFileShare(false, { convert });
              props.closeModal();
            }}
          >
            Select & Share File
          </Button>
        </div>
      </div>
    </Modal>
  );
};
