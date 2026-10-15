import React from "react";
import { Modal, Table } from "@mantine/core";
import { WPIconCheck } from "../Icons/CustomIcons";

export const PermanentRoomModal = (props: { closeModal: () => void }) => {
  const { closeModal } = props;
  return (
    <Modal opened onClose={closeModal} title="Permanent Rooms">
      <div style={{ marginBottom: "14px", color: "var(--text-secondary, #94a3b8)", fontSize: "14px" }}>
        Make your rooms permanent to keep custom vanity URLs, lock passwords, and moderation settings active indefinitely.
      </div>
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th>Temporary</Table.Th>
            <Table.Th>Permanent</Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          <Table.Tr>
            <Table.Td>Expiry</Table.Td>
            <Table.Td>After 24 hours of inactivity</Table.Td>
            <Table.Td>Never</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Room Passwords</Table.Td>
            <Table.Td></Table.Td>
            <Table.Td>
              <WPIconCheck size={18} color="#10b981" />
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Disable Chat</Table.Td>
            <Table.Td></Table.Td>
            <Table.Td>
              <WPIconCheck size={18} color="#10b981" />
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Kick Users</Table.Td>
            <Table.Td></Table.Td>
            <Table.Td>
              <WPIconCheck size={18} color="#10b981" />
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>Custom Room URLs</Table.Td>
            <Table.Td></Table.Td>
            <Table.Td>
              <WPIconCheck size={18} color="#10b981" />
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Modal>
  );
};
