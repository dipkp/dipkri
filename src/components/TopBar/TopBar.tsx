import React, { useCallback, useContext } from "react";
import { serverPath, getUserImage, softWhite } from "../../utils/utils";
import { ActionIcon, Avatar, Button, Menu, Text } from "@mantine/core";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import { LoginModal } from "../Modal/LoginModal";
import { ProfileModal } from "../Modal/ProfileModal";
import Announce from "../Announce/Announce";
import { InviteButton } from "../InviteButton/InviteButton";
import appStyles from "../App/App.module.css";
import { MetadataContext } from "../../MetadataContext";
import config from "../../config";
import {
  WPIconPlus,
  WPIconDatabase,
  WPIconLogin,
  WPIconTrash,
  WPIconDiscord,
  WPIconGitHub,
  DipkriLogo,
} from "../Icons/CustomIcons";
import { JoinRoomModal } from "../Modal/JoinRoomModal";
import styles from "./TopBar.module.css";

export async function createRoom(
  user: firebase.User | undefined,
  openNewTab: boolean | undefined,
  video: string = "",
) {
  const uid = user?.uid;
  const token = await user?.getIdToken();
  const response = await fetch(serverPath + "/createRoom", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      token,
      video,
    }),
  });
  const data = await response.json();
  const { name } = data;
  if (openNewTab) {
    window.open("/watch" + name);
  } else {
    window.location.assign("/watch" + name);
  }
}

export const NewRoomButton = (props: {
  size?: string;
  openNewTab?: boolean;
}) => {
  const context = useContext(MetadataContext);
  const onClick = useCallback(async () => {
    await createRoom(context.user, props.openNewTab);
  }, [context.user, props.openNewTab]);
  return (
    <Button
      size={props.size}
      onClick={onClick}
      leftSection={<WPIconPlus size={20} />}
      className={styles.newRoomButton}
    >
      New Room
    </Button>
  );
};

export const JoinRoomButton = (props: { size?: string }) => {
  const [opened, setOpened] = React.useState(false);
  return (
    <>
      <Button
        size={props.size}
        variant="light"
        color="cyan"
        onClick={() => setOpened(true)}
        leftSection={<WPIconLogin size={18} />}
        style={{ borderRadius: "12px", fontWeight: 600 }}
      >
        Join with Code
      </Button>
      <JoinRoomModal opened={opened} onClose={() => setOpened(false)} />
    </>
  );
};

type SignInButtonProps = {};

export class SignInButton extends React.Component<SignInButtonProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = { isLoginOpen: false, isProfileOpen: false, userImage: null };

  async componentDidUpdate(prevProps: SignInButtonProps) {
    if (this.context.user && !this.state.userImage) {
      this.setState({ userImage: await getUserImage(this.context.user) });
    }
  }

  render() {
    if (this.context.user) {
      return (
        <div
          style={{
            margin: "4px",
            minWidth: "40px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Avatar
            src={this.state.userImage}
            onClick={() => this.setState({ isProfileOpen: true })}
            style={{
              cursor: "pointer",
              borderRadius: "50%",
              border: "2px solid rgba(99, 102, 241, 0.4)",
              boxShadow: "0 0 12px rgba(99, 102, 241, 0.25)",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
            }}
          />
          {this.state.isProfileOpen && this.context.user && (
            <ProfileModal
              userImage={this.state.userImage}
              close={() => this.setState({ isProfileOpen: false })}
            />
          )}
        </div>
      );
    }
    return (
      <React.Fragment>
        {this.state.isLoginOpen && (
          <LoginModal
            closeModal={() => this.setState({ isLoginOpen: false })}
          />
        )}
        <Button
          className={styles.signInButton}
          leftSection={<WPIconLogin size={18} />}
          onClick={() => this.setState({ isLoginOpen: true })}
        >
          Sign in
        </Button>
      </React.Fragment>
    );
  }
}

export class ListRoomsButton extends React.Component<{}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = { rooms: [] as PersistentRoom[] };

  componentDidMount() {
    this.refreshRooms();
  }

  refreshRooms = async () => {
    if (this.context.user) {
      const token = await this.context.user.getIdToken();
      const response = await fetch(
        serverPath + `/listRooms?uid=${this.context.user?.uid}&token=${token}`,
      );
      this.setState({ rooms: await response.json() });
    }
  };

  deleteRoom = async (roomId: string) => {
    if (this.context.user) {
      const token = await this.context.user.getIdToken();
      await fetch(
        serverPath +
          `/deleteRoom?uid=${this.context.user?.uid}&token=${token}&roomId=${roomId}`,
        { method: "DELETE" },
      );
      this.setState({
        rooms: this.state.rooms.filter((room) => room.roomId !== roomId),
      });
      this.refreshRooms();
    }
  };

  render() {
    return (
      <Menu>
        <Menu.Target>
          <Button
            className={styles.myRoomsButton}
            onClick={this.refreshRooms}
            leftSection={<WPIconDatabase size={18} />}
          >
            My rooms
          </Button>
        </Menu.Target>
        <Menu.Dropdown className={styles.menuDropdown}>
          {this.state.rooms.length === 0 && (
            <Menu.Item disabled>You have no permanent rooms.</Menu.Item>
          )}
          {this.state.rooms.map((room: any) => {
            return (
              <Menu.Item
                key={room.roomId}
                component="a"
                href={
                  room.vanity ? "/r/" + room.vanity : "/watch" + room.roomId
                }
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div>
                    <Text>
                      {room.vanity
                        ? `/r/${room.vanity}`
                        : `/watch${room.roomId}`}
                    </Text>
                    <Text size="xs" c="grey">
                      {room.roomId}
                    </Text>
                  </div>
                  <div style={{ marginLeft: "auto", paddingLeft: "20px" }}>
                    <ActionIcon
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        e.preventDefault();
                        this.deleteRoom(room.roomId);
                      }}
                      color="red"
                      variant="subtle"
                    >
                      <WPIconTrash size={16} />
                    </ActionIcon>
                  </div>
                </div>
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
    );
  }
}

export const TopBar = (props: {
  hideNewRoom?: boolean;
  hideSignin?: boolean;
  hideMyRooms?: boolean;
  roomTitle?: string;
  roomDescription?: string;
  roomTitleColor?: string;
}) => {
  const context = useContext(MetadataContext);
  return (
    <React.Fragment>
      <div
        className={styles.topBar}
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(9, 10, 15, 0.85)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          padding: "8px 16px",
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <a
            href="/"
            className={styles.brandLink}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              textDecoration: "none",
            }}
          >
            <DipkriLogo size={28} />
            {!props.roomTitle && !props.roomDescription && (
              <span className={styles.logo}>dipkri</span>
            )}
          </a>
          {(props.roomTitle || props.roomDescription) && (
            <div className={styles.roomTitleContainer}>
              <div
                className={styles.roomTitle}
                style={
                  props.roomTitleColor
                    ? {
                        background: "none",
                        WebkitTextFillColor: props.roomTitleColor,
                        color: props.roomTitleColor,
                      }
                    : undefined
                }
              >
                {props.roomTitle?.toUpperCase()}
              </div>
              {props.roomDescription && (
                <Text size="sm" className={styles.roomDescription}>
                  {props.roomDescription}
                </Text>
              )}
            </div>
          )}
        </div>
        <Announce />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {!props.hideNewRoom && <JoinRoomButton size="sm" />}
          {!props.hideNewRoom && <NewRoomButton size="sm" />}
          {!props.hideSignin && <SignInButton />}
        </div>
      </div>
    </React.Fragment>
  );
};
