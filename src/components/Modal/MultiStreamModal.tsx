import React from "react";
import { Modal, Loader, Menu, Text, Button } from "@mantine/core";
import { IconFile, IconPlayerPlay } from "@tabler/icons-react";

export const MultiStreamModal = ({
  streams,
  setMedia,
  playlistAdd,
  resetMultiSelect,
}: {
  streams: { name: string; url: string; length: number; playFn?: () => void }[];
  setMedia: (value: string) => void;
  playlistAdd?: (value: string) => void;
  resetMultiSelect: () => void;
}) => {
  const onPlayAll = () => {
    if (streams.length > 0) {
      setMedia(streams[0].url);
      if (playlistAdd) {
        streams.slice(1).forEach((s) => playlistAdd(s.url));
      }
      resetMultiSelect();
    }
  };

  return (
    <Modal opened onClose={resetMultiSelect} centered title="Season Episodes Detected">
      {streams.length === 0 ? (
        <Loader />
      ) : (
        <>
          {streams.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <Button
                fullWidth
                variant="gradient"
                gradient={{ from: "#6366f1", to: "#06b6d4" }}
                leftSection={<IconPlayerPlay size={18} />}
                onClick={onPlayAll}
              >
                Play Ep 1 & Auto-Queue All ({streams.length} Episodes)
              </Button>
            </div>
          )}
          <Menu>
            {streams.map((file) => (
              <Menu.Item
                key={file.url}
                leftSection={<IconFile />}
                onClick={() => {
                  setMedia(file.url);
                  resetMultiSelect();
                }}
              >
                {file.name}
                <Text size="sm">{file.length.toLocaleString()} bytes</Text>
              </Menu.Item>
            ))}
          </Menu>
        </>
      )}
    </Modal>
  );
};
