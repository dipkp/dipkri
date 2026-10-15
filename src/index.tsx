import "@mantine/core/styles.css";
import "./index.css";

import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route } from "react-router-dom";

import { App } from "./components/App/App";
import { Home } from "./components/Home/Home";
import { Privacy, Terms, FAQ } from "./components/Pages/Pages";
import { TopBar } from "./components/TopBar/TopBar";
import { Footer } from "./components/Footer/Footer";
import firebase from "firebase/compat/app";
import "firebase/auth";
import { serverPath, softWhite } from "./utils/utils";
import { Create } from "./components/Create/Create";
import { Discord } from "./components/Discord/Discord";
import config from "./config";
import { DEFAULT_STATE, MetadataContext } from "./MetadataContext";
import { createTheme, MantineProvider } from "@mantine/core";

const theme = createTheme({
  /** Your theme override here */
  white: softWhite,
});

const Debug = lazy(() => import("./components/Debug/Debug"));

const firebaseConfig = config.VITE_FIREBASE_CONFIG;
if (firebaseConfig) {
  firebase.initializeApp(JSON.parse(firebaseConfig));
}

// Redirect old-style URLs
if (window.location.hash && window.location.pathname === "/") {
  const hashRoomId = window.location.hash.substring(1);
  window.location.href = "/watch/" + hashRoomId;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn("Caught in WatchParty ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#090A0F",
            color: "#F0F0F5",
            padding: "24px",
            textAlign: "center",
            fontFamily: "Inter, sans-serif",
          }}
        >
          <h2 style={{ fontSize: "22px", marginBottom: "12px", color: "#6366f1" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#9CA3AF", maxWidth: "420px", fontSize: "14px", marginBottom: "20px" }}>
            WatchParty recovered from a display error. Tap below to resume watching.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            style={{
              padding: "10px 24px",
              background: "linear-gradient(135deg, #6366f1, #06b6d4)",
              color: "#ffffff",
              border: "none",
              borderRadius: "12px",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload Room
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

class WatchParty extends React.Component {
  public state = DEFAULT_STATE;
  async componentDidMount() {
    if (firebaseConfig) {
      firebase.auth().onAuthStateChanged(async (user: firebase.User | null) => {
        if (user) {
          // console.log(user);
          this.setState({ user });
          const token = await user.getIdToken();
          const response = await window.fetch(
            serverPath + `/metadata?uid=${user.uid}&token=${token}`,
          );
          const data = await response.json();
          this.setState({
            isSubscriber: data.isSubscriber,
            streamPath: data.streamPath,
            beta: data.beta,
          });
        }
      });
    } else {
      // Firebase isn't set up so enable subscriber features
      this.setState({
        isSubscriber: true,
      });
    }
  }
  render() {
    return (
      // <React.StrictMode>
      <MantineProvider theme={theme} forceColorScheme="dark">
        <MetadataContext.Provider value={this.state}>
          <BrowserRouter>
            <Route
              path="/"
              exact
              render={(props) => {
                return (
                  <React.Fragment>
                    <TopBar hideNewRoom />
                    <Home />
                    <Footer />
                  </React.Fragment>
                );
              }}
            />
            <Route
              path="/create"
              exact
              render={() => {
                return <Create />;
              }}
            />
            <Route
              path="/watch/:roomId"
              exact
              render={(props) => {
                return <App urlRoomId={props.match.params.roomId} />;
              }}
            />
            <Route
              path="/r/:vanity"
              exact
              render={(props) => {
                return <App vanity={props.match.params.vanity} />;
              }}
            />
            <Route path="/terms">
              <TopBar />
              <Terms />
              <Footer />
            </Route>
            <Route path="/privacy">
              <TopBar />
              <Privacy />
              <Footer />
            </Route>
            <Route path="/faq">
              <TopBar />
              <FAQ />
              <Footer />
            </Route>
            <Route path="/discord/auth" exact>
              <Discord />
            </Route>
            <Route path="/debug">
              <TopBar />
              <Suspense fallback={null}>
                <Debug />
              </Suspense>
              <Footer />
            </Route>
          </BrowserRouter>
        </MetadataContext.Provider>
      </MantineProvider>
      // </React.StrictMode>
    );
  }
}
const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <ErrorBoundary>
    <WatchParty />
  </ErrorBoundary>,
);
