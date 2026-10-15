import React, { useState } from "react";
import { ActionIcon, Button } from "@mantine/core";
import { InviteModal } from "../Modal/InviteModal";
import { WPIconInvite } from "../Icons/CustomIcons";

export interface InviteButtonProps {
  fullWidth?: boolean;
  label?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

export const InviteButton: React.FC<InviteButtonProps> = ({
  fullWidth,
  label,
  size = "md",
  className,
}) => {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  return (
    <>
      {inviteModalOpen && (
        <InviteModal closeInviteModal={() => setInviteModalOpen(false)} />
      )}
      {label || fullWidth ? (
        <Button
          fullWidth={fullWidth}
          size={size}
          className={className}
          leftSection={<WPIconInvite size={18} />}
          style={{
            background:
              "linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(6, 182, 212, 0.9))",
            color: "#ffffff",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
            fontWeight: 600,
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onClick={() => setInviteModalOpen(true)}
        >
          {label || "Share Room Link"}
        </Button>
      ) : (
        <ActionIcon
          size="36px"
          className={className}
          style={{
            background:
              "linear-gradient(135deg, rgba(99, 102, 241, 0.85), rgba(6, 182, 212, 0.85))",
            color: "#ffffff",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 2px 8px rgba(99, 102, 241, 0.3)",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          title="Invite friends"
          onClick={() => setInviteModalOpen(true)}
        >
          <WPIconInvite size={18} />
        </ActionIcon>
      )}
    </>
  );
};
