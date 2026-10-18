import React from "react";

const mdStyle: React.CSSProperties = {
  maxWidth: "100vw",
  width: "800px",
  padding: "20px",
  boxSizing: "border-box",
  color: "var(--text-primary, #f0f0f5)",
  fontFamily: "'Inter', sans-serif",
  lineHeight: 1.6,
};

export const Privacy = () => {
  return (
    <div style={mdStyle}>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
        {`
Privacy Policy
====

Rooms
----
- Rooms are temporary and expire after inactivity.
- You have the option of making a room permanent at any time.
- We do not keep logs of the media content that users watch.

Personal Information
----
- You are not required to register to use dipkri.
- If you sign in, your display name and avatar are shown only to participants in rooms you join.
- We never sell or share personal information with third parties.
- You have the right to request deletion of your user data at any time.

Cookies & Storage
----
- We use local storage purely to remember your room settings and UI preferences.

YouTube
----
- dipkri allows searching and synchronously playing YouTube videos. Google/YouTube may collect data in accordance with the Google Privacy Policy.
`}
      </pre>
    </div>
  );
};

export const Terms = () => {
  return (
    <div style={mdStyle}>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
        {`
Terms of Service
====
By using dipkri, you agree to the following terms:
- You are at least 13 years of age.
- Your room or access may be terminated if you share illegal or infringing content.
- dipkri is provided free of charge on an "as-is" and "as-available" basis.
- You use the service at your own discretion.

YouTube
----
By searching and embedding YouTube content on dipkri, you agree to the YouTube Terms of Service.
`}
      </pre>
    </div>
  );
};

export const FAQ = () => {
  return (
    <div style={mdStyle}>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
        {`
FAQ
====

What is dipkri?
----
dipkri is a real-time synchronized streaming and watch party platform. You can watch YouTube, paste video links, share your screen, or stream local files with friends in perfect synchronization.

Is dipkri free?
----
Yes! dipkri is completely free to use without paywalls or subscriptions.

How does the synchronization work?
----
When anyone in the room plays, pauses, or jumps to a different timestamp, dipkri transmits millisecond delta pulses to keep everyone on the exact same video frame.

How come I don't hear audio when screen sharing?
----
To stream audio along with your screen, select "Share Tab Audio" or "Share Entire Screen with System Audio" in modern Chromium browsers (Chrome, Edge, Brave).

Can I link directly to a video?
----
Yes! You can share a link with the video preloaded using:
/create?video=URL_HERE
`}
      </pre>
    </div>
  );
};
