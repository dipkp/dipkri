import firebase from "firebase/compat/app";
import "firebase/compat/auth";

export interface GoogleAuthResult {
  user: firebase.User | null;
  error?: string;
}

/**
 * Universal Google Sign-In handler supporting:
 * 1. Capacitor native platforms (via @capacitor-firebase/authentication or @codetrix-studio/capacitor-google-auth)
 * 2. Native dipkri Android WebView bridge (window.dipkriAndroid)
 * 3. Standard Web browsers (signInWithPopup with graceful fallback to signInWithRedirect)
 */
export async function performGoogleSignIn(): Promise<firebase.User | null> {
  const win = window as any;

  // 1. Check for Capacitor native environment
  if (win?.Capacitor?.isNativePlatform?.()) {
    try {
      let idToken: string | null = null;

      // Option A: @capacitor-firebase/authentication plugin
      if (win?.Capacitor?.Plugins?.FirebaseAuthentication?.signInWithGoogle) {
        const result = await win.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle();
        idToken = result?.credential?.idToken || result?.idToken || null;
      }
      // Option B: @codetrix-studio/capacitor-google-auth plugin
      else if (win?.Capacitor?.Plugins?.GoogleAuth?.signIn) {
        const result = await win.Capacitor.Plugins.GoogleAuth.signIn();
        idToken = result?.authentication?.idToken || result?.idToken || null;
      }

      if (idToken) {
        const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
        const userCredential = await firebase.auth().signInWithCredential(credential);
        return userCredential.user;
      }
    } catch (capErr: any) {
      console.warn("Capacitor native Google Auth failed, falling back:", capErr);
      if (capErr?.message && !capErr.message.includes("cancelled") && !capErr.message.includes("canceled")) {
        throw new Error(capErr.message || "Native Android Google Sign-In failed.");
      }
      throw capErr;
    }
  }

  // 2. Check for dipkri native Android bridge (MainActivity.kt)
  if (win?.dipkriAndroid?.signInWithGoogle) {
    try {
      const idToken = await new Promise<string>((resolve, reject) => {
        // Register a one-time callback for native Android
        win._onDipkriGoogleAuthSuccess = (token: string) => {
          delete win._onDipkriGoogleAuthSuccess;
          delete win._onDipkriGoogleAuthFailure;
          resolve(token);
        };
        win._onDipkriGoogleAuthFailure = (err: string) => {
          delete win._onDipkriGoogleAuthSuccess;
          delete win._onDipkriGoogleAuthFailure;
          reject(new Error(err || "Google Sign-In was cancelled or failed."));
        };
        win.dipkriAndroid.signInWithGoogle();
      });

      if (idToken) {
        const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
        const userCredential = await firebase.auth().signInWithCredential(credential);
        return userCredential.user;
      }
    } catch (nativeErr: any) {
      console.warn("dipkriAndroid native sign-in failed:", nativeErr);
      throw nativeErr;
    }
  }

  // 3. Web Browser standard flow (signInWithPopup)
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");

  try {
    const result = await firebase.auth().signInWithPopup(provider);
    return result.user;
  } catch (popupErr: any) {
    // If popup is blocked by browser/WebView, try redirect fallback
    if (popupErr?.code === "auth/popup-blocked" || popupErr?.code === "auth/cancelled-popup-request") {
      console.log("Popup blocked; attempting signInWithRedirect...");
      await firebase.auth().signInWithRedirect(provider);
      return null;
    }
    throw popupErr;
  }
}
