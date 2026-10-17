import React, { useContext, useState } from "react";
import { Menu } from "@mantine/core";
import { Socket } from "socket.io-client";
// import styles from './UserMenu.module.css';
import { MetadataContext } from "../../MetadataContext";
import { WPIconClose, WPIconTrash, WPIconBan } from "../Icons/CustomIcons";

export const UserMenu = ({
  socket,
  userToManage,
  trigger,
  displayName,
  disabled,
  timestamp,
  isChatMessage,
}: {
  socket: Socket;
  userToManage: string;
  trigger: React.ReactNode;
  icon?: string;
  displayName?: string;
  disabled: boolean;
  timestamp?: string;
  isChatMessage?: boolean;
}) => {
  const { user } = useContext(MetadataContext);
  return (
    <Menu
      closeOnItemClick
      closeOnClickOutside
      disabled={disabled}
      trigger="click"
    >
      <Menu.Target>{trigger}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{displayName}</Menu.Label>
        {isChatMessage && (
          <Menu.Item
            leftSection={<WPIconClose size={16} />}
            onClick={async () => {
              socket.emit("CMD:deleteChatMessages", {
                author: userToManage,
                timestamp: timestamp,
              });
            }}
          >
            Delete Message
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<WPIconTrash size={16} />}
          onClick={async () => {
            socket.emit("CMD:deleteChatMessages", {
              author: userToManage,
            });
          }}
        >
          Delete User's Messages
        </Menu.Item>
        <Menu.Item
          leftSection={<WPIconBan size={16} />}
          onClick={async () => {
            socket.emit("CMD:kickUser", {
              userToBeKicked: userToManage,
            });
          }}
        >
          Kick User
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
