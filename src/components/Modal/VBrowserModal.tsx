import React from "react";
import { Modal, Button, Alert, Select, Avatar } from "@mantine/core";
import { SignInButton } from "../TopBar/TopBar";
import { serverPath } from "../../utils/utils";
import config from "../../config";
import { MetadataContext } from "../../MetadataContext";
import { WPIconVBrowser } from "../Icons/CustomIcons";
import { IconHourglass } from "@tabler/icons-react";
import styles from "./SourceModal.module.css";

export class VBrowserModal extends React.Component<{
  closeModal: () => void;
  startVBrowser: (options: { size: string; region: string }) => void;
}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  state = {
    isFreePoolFull: false,
    region: "any",
  };

  async componentDidMount() {
    try {
      const resp = await fetch(serverPath + "/metadata");
      const metadata = await resp.json();
      this.setState({ isFreePoolFull: metadata.isFreePoolFull });
    } catch (e) {
      console.warn("Failed to fetch metadata:", e);
    }
  }

  render() {
    const regionOptions = [
      {
        label: "Any available",
        value: "any",
        image: { avatar: false, src: "" },
      },
      {
        label: "US East",
        value: "US",
        image: { avatar: false, src: "/flag-united-states.png" },
      },
      {
        label: "US West",
        value: "USW",
        image: { avatar: false, src: "/flag-united-states.png" },
      },
      {
        label: "Europe",
        value: "EU",
        image: { avatar: false, src: "/flag-european-union.png" },
      },
    ];
    const { closeModal, startVBrowser } = this.props;

    const LaunchButton = ({ large }: { large: boolean }) => {
      return (
        <Button
          variant={large ? "gradient" : "filled"}
          gradient={large ? { from: "indigo", to: "cyan" } : undefined}
          color={large ? undefined : "teal"}
          onClick={async () => {
            startVBrowser({
              size: large ? "large" : "",
              region: this.state.region === "any" ? "" : this.state.region,
            });
            closeModal();
          }}
        >
          {large ? "Launch HD VBrowser" : "Launch Standard VBrowser"}
        </Button>
      );
    };

    const vmPoolFullMessage = (
      <Alert
        color="red"
        icon={<IconHourglass />}
        title="No VBrowsers Available"
        styles={{ root: { padding: "8px 12px", fontSize: "12px" } }}
      >
        Instances are currently occupied. Please check back in a few moments.
      </Alert>
    );

    const canLaunch = this.context.user || !config.VITE_FIREBASE_CONFIG;

    return (
      <Modal
        opened
        onClose={closeModal}
        centered
        size="lg"
        title={
          <div className={styles.modalHeader}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <WPIconVBrowser size={18} />
            </div>
            <span className={styles.modalHeaderTitle}>Launch Virtual Browser</span>
          </div>
        }
      >
        <div className={styles.modalWrapper}>
          <div className={styles.optionControl}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#f0f0f5" }}>Server Region</div>
              </div>
              <div style={{ minWidth: 160 }}>
                <Select
                  size="xs"
                  onChange={(value) => this.setState({ region: value || "any" })}
                  value={this.state.region}
                  data={regionOptions}
                  renderOption={({ option }: { option: any }) => (
                    <div
                      key={option.value}
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        fontSize: "12px",
                      }}
                    >
                      {option.image?.src && <Avatar size="xs" radius="xs" src={option.image.src} />}
                      {option.label}
                    </div>
                  )}
                />
              </div>
            </div>
          </div>

          <div className={styles.cardsContainer}>
            {/* Card 1: Standard Tier */}
            <div className={styles.planCard}>
              <div>
                <div className={styles.cardHeader}>
                  <span className={styles.planTitle}>Standard VBrowser</span>
                  <span className={`${styles.planBadge} ${styles.badgeFree}`}>720p HD</span>
                </div>
                <div className={styles.featureList}>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Max Resolution</span>
                    <span className={styles.featureValue}>720p HD</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Cloud Specs</span>
                    <span className={styles.featureValue}>Standard CPU/RAM</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Session Length</span>
                    <span className={styles.featureValue}>3 hours</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Max Viewers</span>
                    <span className={styles.featureValue}>Up to 15 viewers</span>
                  </div>
                </div>
              </div>

              <div className={styles.cardAction}>
                {canLaunch ? (
                  this.state.isFreePoolFull ? (
                    vmPoolFullMessage
                  ) : (
                    <LaunchButton large={false} />
                  )
                ) : (
                  <SignInButton />
                )}
              </div>
            </div>

            {/* Card 2: HD Tier */}
            <div className={`${styles.planCard} ${styles.planCardPlus}`}>
              <div>
                <div className={styles.cardHeader}>
                  <span className={styles.planTitle}>HD VBrowser</span>
                  <span className={`${styles.planBadge} ${styles.badgePlus}`}>1080p FHD</span>
                </div>
                <div className={styles.featureList}>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Max Resolution</span>
                    <span className={styles.featureValue} style={{ color: "#38bdf8" }}>1080p Full HD</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Cloud Specs</span>
                    <span className={styles.featureValue} style={{ color: "#a5b4fc" }}>Dedicated Extra RAM</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Session Length</span>
                    <span className={styles.featureValue} style={{ color: "#34d399" }}>Extended Session</span>
                  </div>
                  <div className={styles.featureRow}>
                    <span className={styles.featureLabel}>Max Viewers</span>
                    <span className={styles.featureValue} style={{ color: "#f59e0b" }}>Up to 30 viewers</span>
                  </div>
                </div>
              </div>

              <div className={styles.cardAction}>
                {canLaunch ? (
                  <LaunchButton large />
                ) : (
                  <SignInButton />
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    );
  }
}
