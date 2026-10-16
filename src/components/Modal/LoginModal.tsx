import React from "react";
import {
  Modal,
  Button,
  Alert,
  TextInput,
  PasswordInput,
  Divider,
  SegmentedControl,
  Text,
  Anchor,
} from "@mantine/core";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import {
  IconBrandGoogleFilled,
  IconAlertCircle,
  IconCheck,
} from "@tabler/icons-react";
import config from "../../config";

function getFriendlyErrorMessage(err: any, isRegistering: boolean): string {
  if (!err) return "";
  const code = err.code || "";
  const rawMsg = err.message || "";

  switch (code) {
    case "auth/invalid-login-credentials":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return isRegistering
        ? "Could not create account with these credentials. Please check your email and password."
        : "Incorrect email or password. If you don't have an account yet, switch to 'Create Account' above or sign in with Google.";
    case "auth/email-already-in-use":
      return "An account already exists with this email address. Please switch to 'Sign In' above.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again in a few minutes or reset your password.";
    case "auth/popup-closed-by-user":
      return "";
    case "auth/unauthorized-domain":
      return "This domain/IP is not authorized for Google OAuth. Please open the app using http://localhost:8080 or add this domain in Firebase Console (Authentication > Settings > Authorized domains).";
    case "auth/operation-not-allowed":
      return "This sign-in provider is not enabled in Firebase.";
    default:
      return rawMsg.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/[^)]+\)\.?$/, "") || "An unexpected authentication error occurred.";
  }
}

export class LoginModal extends React.Component<{
  closeModal: () => void;
}> {
  public state = {
    mode: "signin" as "signin" | "create" | "reset",
    email: "",
    password: "",
    confirmPassword: "",
    error: "",
    successMsg: "",
    loading: false,
  };

  handleGoogleSignIn = async () => {
    this.setState({ loading: true, error: "", successMsg: "" });
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      this.props.closeModal();
    } catch (e: any) {
      if (e?.code !== "auth/popup-closed-by-user") {
        this.setState({ error: getFriendlyErrorMessage(e, false) });
      }
    } finally {
      this.setState({ loading: false });
    }
  };

  handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!this.state.email || !this.state.password) {
      this.setState({ error: "Please enter both email and password." });
      return;
    }
    this.setState({ loading: true, error: "", successMsg: "" });
    try {
      await firebase.auth().signInWithEmailAndPassword(this.state.email, this.state.password);
      this.props.closeModal();
    } catch (e: any) {
      this.setState({ error: getFriendlyErrorMessage(e, false) });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!this.state.email || !this.state.password) {
      this.setState({ error: "Please enter both email and password." });
      return;
    }
    if (this.state.password.length < 6) {
      this.setState({ error: "Password must be at least 6 characters long." });
      return;
    }
    if (this.state.confirmPassword && this.state.password !== this.state.confirmPassword) {
      this.setState({ error: "Passwords do not match." });
      return;
    }
    this.setState({ loading: true, error: "", successMsg: "" });
    try {
      await firebase.auth().createUserWithEmailAndPassword(this.state.email, this.state.password);
      this.props.closeModal();
    } catch (e: any) {
      this.setState({ error: getFriendlyErrorMessage(e, true) });
    } finally {
      this.setState({ loading: false });
    }
  };

  handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!this.state.email) {
      this.setState({ error: "Please enter your email address to receive reset instructions." });
      return;
    }
    this.setState({ loading: true, error: "", successMsg: "" });
    try {
      await firebase.auth().sendPasswordResetEmail(this.state.email);
      this.setState({
        successMsg: "Password reset link sent! Please check your email inbox.",
        error: "",
      });
    } catch (e: any) {
      this.setState({ error: getFriendlyErrorMessage(e, false) });
    } finally {
      this.setState({ loading: false });
    }
  };

  render() {
    const { closeModal } = this.props;
    const { mode, email, password, confirmPassword, error, successMsg, loading } = this.state;
    const enabledOptions = (config.VITE_FIREBASE_SIGNIN_METHODS || "google,email").split(",");

    return (
      <Modal
        opened
        onClose={closeModal}
        title={
          <Text fw={700} size="lg" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            {mode === "signin"
              ? "Sign In"
              : mode === "create"
              ? "Create Account"
              : "Reset Password"}
          </Text>
        }
        size={420}
        centered
        radius="lg"
        styles={{
          content: {
            background: "rgba(15, 17, 24, 0.95)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
          },
          header: {
            background: "transparent",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          },
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingTop: "8px" }}>
          {/* Segmented Control for Sign In / Create Account */}
          {mode !== "reset" ? (
            <SegmentedControl
              value={mode}
              onChange={(val) =>
                this.setState({ mode: val as "signin" | "create", error: "", successMsg: "" })
              }
              data={[
                { label: "Sign In", value: "signin" },
                { label: "Create Account", value: "create" },
              ]}
              fullWidth
              radius="md"
              size="sm"
              styles={{
                root: {
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                },
              }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Text size="sm" c="dimmed">
                Enter your email to receive a password reset link
              </Text>
              <Anchor
                size="xs"
                onClick={() => this.setState({ mode: "signin", error: "", successMsg: "" })}
                style={{ cursor: "pointer" }}
              >
                Back to Sign In
              </Anchor>
            </div>
          )}

          {/* Google Sign In Button */}
          {mode !== "reset" && enabledOptions.includes("google") && (
            <>
              <Button
                variant="default"
                fullWidth
                size="md"
                leftSection={<IconBrandGoogleFilled size={18} style={{ color: "#EA4335" }} />}
                onClick={this.handleGoogleSignIn}
                loading={loading}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "12px",
                  fontWeight: 600,
                  transition: "all 0.2s ease",
                }}
              >
                Continue with Google
              </Button>

              <Divider
                label={mode === "signin" ? "Or sign in with email" : "Or register with email"}
                labelPosition="center"
                styles={{
                  label: {
                    color: "rgba(255, 255, 255, 0.5)",
                    fontSize: "12px",
                  },
                }}
              />
            </>
          )}

          {/* Feedback alerts */}
          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              radius="md"
              styles={{
                root: {
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                },
                message: { fontSize: "13px", lineHeight: "1.4" },
              }}
            >
              {error}
            </Alert>
          )}

          {successMsg && (
            <Alert
              icon={<IconCheck size={16} />}
              color="teal"
              variant="light"
              radius="md"
              styles={{
                root: {
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                },
                message: { fontSize: "13px", lineHeight: "1.4" },
              }}
            >
              {successMsg}
            </Alert>
          )}

          {/* Forms */}
          {mode === "signin" && (
            <form
              onSubmit={this.handleEmailSignIn}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <TextInput
                label="Email"
                placeholder="name@example.com"
                type="email"
                required
                value={email}
                onChange={(e) => this.setState({ email: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <PasswordInput
                label="Password"
                placeholder="Your password"
                required
                value={password}
                onChange={(e) => this.setState({ password: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Anchor
                  size="xs"
                  c="dimmed"
                  onClick={() => this.setState({ mode: "reset", error: "", successMsg: "" })}
                  style={{ cursor: "pointer" }}
                >
                  Forgot password?
                </Anchor>
              </div>
              <Button
                type="submit"
                loading={loading}
                fullWidth
                size="md"
                style={{
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)",
                  borderRadius: "12px",
                  fontWeight: 600,
                  marginTop: "4px",
                }}
              >
                Sign In
              </Button>
            </form>
          )}

          {mode === "create" && (
            <form
              onSubmit={this.handleCreateAccount}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <TextInput
                label="Email"
                placeholder="name@example.com"
                type="email"
                required
                value={email}
                onChange={(e) => this.setState({ email: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <PasswordInput
                label="Password"
                placeholder="At least 6 characters"
                required
                value={password}
                onChange={(e) => this.setState({ password: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <PasswordInput
                label="Confirm Password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => this.setState({ confirmPassword: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <Button
                type="submit"
                loading={loading}
                fullWidth
                size="md"
                style={{
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)",
                  borderRadius: "12px",
                  fontWeight: 600,
                  marginTop: "4px",
                }}
              >
                Create Account
              </Button>
            </form>
          )}

          {mode === "reset" && (
            <form
              onSubmit={this.handleResetPassword}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <TextInput
                label="Email"
                placeholder="name@example.com"
                type="email"
                required
                value={email}
                onChange={(e) => this.setState({ email: e.target.value })}
                radius="md"
                styles={{
                  input: {
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#fff",
                  },
                }}
              />
              <Button
                type="submit"
                loading={loading}
                fullWidth
                size="md"
                style={{
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)",
                  borderRadius: "12px",
                  fontWeight: 600,
                  marginTop: "4px",
                }}
              >
                Send Reset Link
              </Button>
            </form>
          )}
        </div>
      </Modal>
    );
  }
}

// Export legacy modals for backwards compatibility if referenced anywhere
export class CreateModal extends React.Component<{ closeModal: () => void }> {
  render() {
    return <LoginModal closeModal={this.props.closeModal} />;
  }
}

export class ResetModal extends React.Component<{ closeModal: () => void }> {
  render() {
    return <LoginModal closeModal={this.props.closeModal} />;
  }
}
