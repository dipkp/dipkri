import React, { useId } from "react";

export interface WPIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<SVGSVGElement>) => void;
  title?: string;
  disabled?: boolean;
}

interface BaseIconProps extends WPIconProps {
  children?: React.ReactNode;
}

export const WPIconBase = React.forwardRef<SVGSVGElement, BaseIconProps>(
  (
    {
      size = 24,
      color = "currentColor",
      strokeWidth = 1.8,
      className = "",
      style,
      onClick,
      title,
      disabled = false,
      children,
      ...rest
    },
    ref
  ) => {
    const combinedStyle: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      verticalAlign: "middle",
      flexShrink: 0,
      color,
      ...(disabled
        ? { opacity: 0.45, cursor: "not-allowed", pointerEvents: "none" }
        : {}),
      ...style,
    };

    const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    };

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={combinedStyle}
        onClick={handleClick}
        aria-hidden={title ? undefined : true}
        role="img"
        {...rest}
      >
        {title && <title>{title}</title>}
        {children}
      </svg>
    );
  }
);
WPIconBase.displayName = "WPIconBase";

// 1. WPIconPlay - Sleek modern rounded equilateral play icon
export const WPIconPlay = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => {
    const rawId = useId();
    const gradId = `wp-play-grad-${rawId.replace(/[:]/g, "")}`;
    return (
      <WPIconBase ref={ref} {...props}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <path
          d="M7.8 5.4c0-.94 1.02-1.53 1.83-1.05l10.2 6.1c.8.48.8 1.63 0 2.1l-10.2 6.1c-.81.48-1.83-.11-1.83-1.05V5.4z"
          fill={`url(#${gradId})`}
          stroke="none"
        />
      </WPIconBase>
    );
  }
);
WPIconPlay.displayName = "WPIconPlay";

// 2. WPIconPause - Two smooth rounded capsule bars
export const WPIconPause = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} {...props}>
      <rect
        x="6"
        y="4.5"
        width="4"
        height="15"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="14"
        y="4.5"
        width="4"
        height="15"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconPause.displayName = "WPIconPause";

// 3. WPIconSkipForward - Modern media player next track icon (Triangle + Stop Bar)
export const WPIconSkipForward = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} {...props}>
      <path
        d="M6 5.8c0-.78.85-1.27 1.52-.87l8.2 4.9c.67.4.67 1.34 0 1.74l-8.2 4.9c-.67.4-1.52-.09-1.52-.87V5.8z"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="17.2"
        y="5"
        width="2.5"
        height="14"
        rx="1.25"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconSkipForward.displayName = "WPIconSkipForward";

// 4. WPIconSkipBackward - Modern media player prev track icon (Stop Bar + Triangle)
export const WPIconSkipBackward = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} {...props}>
      <rect
        x="4.3"
        y="5"
        width="2.5"
        height="14"
        rx="1.25"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M18 5.8c0-.78-.85-1.27-1.52-.87l-8.2 4.9c-.67.4-.67 1.34 0 1.74l8.2 4.9c.67.4 1.52-.09 1.52-.87V5.8z"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconSkipBackward.displayName = "WPIconSkipBackward";

// 5. WPIconRewind10 - 10-second rewind circular icon with "10" badge
export const WPIconRewind10 = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      {/* Curved rewind arc */}
      <path
        d="M12 4.5A8 8 0 1 0 20 12"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Arrow head pointing counter-clockwise */}
      <polyline
        points="12 2 12 5 15 5"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 10 text rendered as crisp paths */}
      {/* Digit '1' */}
      <path
        d="M9 10.2l1.2-.7v5"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Digit '0' */}
      <rect
        x="12.5"
        y="9.5"
        width="3"
        height="5"
        rx="1.5"
        strokeWidth="1.7"
      />
    </WPIconBase>
  )
);
WPIconRewind10.displayName = "WPIconRewind10";

// 6. WPIconForward10 - 10-second forward circular icon with "10" badge
export const WPIconForward10 = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      {/* Curved forward arc */}
      <path
        d="M12 4.5A8 8 0 1 1 4 12"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Arrow head pointing clockwise */}
      <polyline
        points="12 2 12 5 9 5"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Digit '1' */}
      <path
        d="M9 10.2l1.2-.7v5"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Digit '0' */}
      <rect
        x="12.5"
        y="9.5"
        width="3"
        height="5"
        rx="1.5"
        strokeWidth="1.7"
      />
    </WPIconBase>
  )
);
WPIconForward10.displayName = "WPIconForward10";

// 7. WPIconSync - Circular dual-arc refresh with orbital glowing node
export const WPIconSync = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </WPIconBase>
  )
);
WPIconSync.displayName = "WPIconSync";

// 8. WPIconLoop - Smooth infinity loop with direction
export const WPIconLoop = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M18.18 8.18a4.5 4.5 0 0 0-6.36 0L12 8.36l-.18-.18a4.5 4.5 0 1 0-6.36 6.36L12 21.08l6.36-6.36a4.5 4.5 0 0 0 0-6.36z"
        stroke="none"
      />
      <path
        d="M6.5 15.5A4 4 0 0 1 6.5 7.5c2 0 3.5 1.5 5.5 4.5 2 3 3.5 4.5 5.5 4.5a4 4 0 0 0 0-8c-2 0-3.5 1.5-5.5 4.5"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconLoop.displayName = "WPIconLoop";

// 9. WPIconCaptions - Sleek closed captions rounded badge
export const WPIconCaptions = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3.5"
        strokeWidth="1.8"
      />
      {/* First 'C' */}
      <path
        d="M10 9.8a2.2 2.2 0 0 0-2 0 2 2 0 0 0 0 4.4 2.2 2.2 0 0 0 2 0"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Second 'C' */}
      <path
        d="M16 9.8a2.2 2.2 0 0 0-2 0 2 2 0 0 0 0 4.4 2.2 2.2 0 0 0 2 0"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconCaptions.displayName = "WPIconCaptions";

// 10. WPIconPictureInPicture - Dual screen PiP icon
export const WPIconPictureInPicture = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      {/* Main outer screen */}
      <rect
        x="3"
        y="4"
        width="18"
        height="14"
        rx="3"
        strokeWidth="1.8"
      />
      {/* Floating inner screen */}
      <rect
        x="12"
        y="11"
        width="7"
        height="5"
        rx="1.5"
        fill="currentColor"
        stroke="none"
        opacity="0.85"
      />
    </WPIconBase>
  )
);
WPIconPictureInPicture.displayName = "WPIconPictureInPicture";

// 11. WPIconSpeed - Speedometer gauge icon for playback rate
export const WPIconSpeed = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M4.5 17.5A9 9 0 1 1 19.5 17.5"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none" />
      <path
        d="M13.4 12.6l3.6-3.6"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconSpeed.displayName = "WPIconSpeed";

// 12. WPIconTheater - Ultra-wide 21:9 cinematic screen
export const WPIconTheater = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="2.5"
        y="6"
        width="19"
        height="12"
        rx="2.5"
        strokeWidth="1.8"
      />
      <line x1="7" y1="6" x2="7" y2="18" strokeWidth="1.6" opacity="0.5" />
      <line x1="17" y1="6" x2="17" y2="18" strokeWidth="1.6" opacity="0.5" />
    </WPIconBase>
  )
);
WPIconTheater.displayName = "WPIconTheater";

// 13. WPIconFullscreen - 4 corner brackets expanding outward
export const WPIconFullscreen = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M4 9V5a1 1 0 0 1 1-1h4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 9V5a1 1 0 0 0-1-1h-4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4 15v4a1 1 0 0 0 1 1h4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 15v4a1 1 0 0 1-1 1h-4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconFullscreen.displayName = "WPIconFullscreen";

// 14. WPIconFullscreenExit - 4 corner brackets contracting inward
export const WPIconFullscreenExit = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M9 4v4a1 1 0 0 1-1 1H4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15 4v4a1 1 0 0 0 1 1h4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 20v-4a1 1 0 0 0-1-1H4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15 20v-4a1 1 0 0 1 1-1h4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconFullscreenExit.displayName = "WPIconFullscreenExit";

// 15. WPIconVolumeOn - Speaker horn + dual acoustic sound waves
export const WPIconVolumeOn = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M15.5 8.5a5 5 0 0 1 0 7"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M18.8 5.5a9.5 9.5 0 0 1 0 13"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconVolumeOn.displayName = "WPIconVolumeOn";

// 16. WPIconVolumeLow - Speaker horn + single acoustic sound wave
export const WPIconVolumeLow = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M15.5 8.5a5 5 0 0 1 0 7"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconVolumeLow.displayName = "WPIconVolumeLow";

// 17. WPIconVolumeOff - Speaker horn + crisp diagonal mute slash
export const WPIconVolumeOff = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z"
        fill="currentColor"
        stroke="none"
      />
      <line
        x1="16"
        y1="9"
        x2="22"
        y2="15"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="9"
        x2="16"
        y2="15"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconVolumeOff.displayName = "WPIconVolumeOff";

// 18. WPIconChat - Modern speech bubble with 3 subtle rounded message dots
export const WPIconChat = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M20.5 12a8.5 8.5 0 0 1-12.8 7.3L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </WPIconBase>
  )
);
WPIconChat.displayName = "WPIconChat";

// 19. WPIconPeople - Two overlapping stylized silhouettes
export const WPIconPeople = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="9" cy="8" r="3.5" strokeWidth="1.8" />
      <path
        d="M3 18.5a6 6 0 0 1 12 0"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 5.5a3.2 3.2 0 0 1 0 6.4"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.5 14.5a5.5 5.5 0 0 1 3.5 4"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconPeople.displayName = "WPIconPeople";

// 20. WPIconUser - Single clean avatar silhouette
export const WPIconUser = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="7.5" r="4" strokeWidth="1.8" />
      <path
        d="M5 19.5a7 7 0 0 1 14 0"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconUser.displayName = "WPIconUser";

// 21. WPIconSettings - Sleek 6-cog mechanical gear
export const WPIconSettings = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconSettings.displayName = "WPIconSettings";

// 22. WPIconPlus - Rounded plus icon
export const WPIconPlus = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" strokeWidth="2" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconPlus.displayName = "WPIconPlus";

// 23. WPIconLogin - Person entering door
export const WPIconLogin = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <polyline
        points="10 16 14 12 10 8"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="14" y1="12" x2="3" y2="12" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconLogin.displayName = "WPIconLogin";

// 24. WPIconInvite - Sleek paper airplane
export const WPIconInvite = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M21.5 2.5L10 14M21.5 2.5L14.5 21.5L10 14M21.5 2.5L2.5 9.5L10 14"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconInvite.displayName = "WPIconInvite";

// 25. WPIconPlaylist - Stacked tracks with miniature play arrow
export const WPIconPlaylist = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <line x1="3" y1="6" x2="14" y2="6" strokeWidth="1.9" strokeLinecap="round" />
      <line x1="3" y1="12" x2="11" y2="12" strokeWidth="1.9" strokeLinecap="round" />
      <line x1="3" y1="18" x2="14" y2="18" strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M16 9.5l5 3-5 3v-6z"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconPlaylist.displayName = "WPIconPlaylist";

// 26. WPIconScreenshare - Monitor with upward broadcast arrow
export const WPIconScreenshare = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2.5"
        strokeWidth="1.8"
      />
      <line x1="8" y1="20" x2="16" y2="20" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="20" strokeWidth="1.8" strokeLinecap="round" />
      <polyline
        points="9 10 12 7 15 10"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" y1="7" x2="12" y2="13" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconScreenshare.displayName = "WPIconScreenshare";

// 27. WPIconVBrowser - Virtual browser globe inside screen
export const WPIconVBrowser = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="3"
        y="3"
        width="18"
        height="14"
        rx="2.5"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="4.5" strokeWidth="1.6" />
      <path
        d="M12 5.5c-1.5 2-2 3.5-2 4.5s.5 2.5 2 4.5c1.5-2 2-3.5 2-4.5s-.5-2.5-2-4.5z"
        strokeWidth="1.5"
      />
      <line x1="7.7" y1="10" x2="16.3" y2="10" strokeWidth="1.5" />
      <line x1="8" y1="20" x2="16" y2="20" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="20" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconVBrowser.displayName = "WPIconVBrowser";

// 28. WPIconFile - Document with folded corner
export const WPIconFile = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M14 3v4a1 1 0 0 0 1 1h4"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconFile.displayName = "WPIconFile";

// 29. WPIconClose - Crisp rounded X
export const WPIconClose = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2" strokeLinecap="round" />
      <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconClose.displayName = "WPIconClose";

// 30. WPIconChevronLeft - Smooth left chevron
export const WPIconChevronLeft = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <polyline
        points="15 18 9 12 15 6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconChevronLeft.displayName = "WPIconChevronLeft";

// 31. WPIconChevronRight - Smooth right chevron
export const WPIconChevronRight = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <polyline
        points="9 18 15 12 9 6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconChevronRight.displayName = "WPIconChevronRight";

// 32. WPIconTrash - Clean wastebasket with handle
export const WPIconTrash = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <polyline
        points="3 6 5 6 21 6"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="10" y1="11" x2="10" y2="17" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="11" x2="14" y2="17" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconTrash.displayName = "WPIconTrash";

// 33. WPIconReaction - Joyful emoji face with sparkle
export const WPIconReaction = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
      <path
        d="M8 14.5c1 1.5 2.5 2 4 2s3-.5 4-2"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line x1="8.5" y1="9.5" x2="9.5" y2="9.5" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="14.5" y1="9.5" x2="15.5" y2="9.5" strokeWidth="2.2" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconReaction.displayName = "WPIconReaction";

// 34. WPIconReply - Sweeping reply arrow
export const WPIconReply = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <polyline
        points="9 14 4 9 9 4"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 20v-7a4 4 0 0 0-4-4H4"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconReply.displayName = "WPIconReply";

// 35. WPIconKeyboard - Keyboard with keys and spacebar
export const WPIconKeyboard = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="3"
        strokeWidth="1.8"
      />
      <circle cx="7" cy="9" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="17" cy="9" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="7" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <line x1="10" y1="15.5" x2="14" y2="15.5" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconKeyboard.displayName = "WPIconKeyboard";

// 36. WPIconSignal - 4 ascending cellular / signal bars
export const WPIconSignal = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="currentColor" stroke="none" {...props}>
      <rect x="4" y="15" width="2.5" height="5" rx="1" />
      <rect x="9" y="11" width="2.5" height="9" rx="1" />
      <rect x="14" y="7" width="2.5" height="13" rx="1" />
      <rect x="19" y="3" width="2.5" height="17" rx="1" />
    </WPIconBase>
  )
);
WPIconSignal.displayName = "WPIconSignal";

// 37. WPIconMonitor - Screen with sleek stand
export const WPIconMonitor = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2.5"
        strokeWidth="1.8"
      />
      <line x1="8" y1="20" x2="16" y2="20" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12" y2="20" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconMonitor.displayName = "WPIconMonitor";

// 38. WPIconCheck - Clean checkmark
export const WPIconCheck = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <polyline
        points="20 6 9 17 4 12"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconCheck.displayName = "WPIconCheck";

// 39. WPIconLock - Padlock with arched shackle
export const WPIconLock = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="4"
        y="10"
        width="16"
        height="11"
        rx="2.5"
        strokeWidth="1.8"
      />
      <path
        d="M7 10V7a5 5 0 0 1 10 0v3"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
    </WPIconBase>
  )
);
WPIconLock.displayName = "WPIconLock";

// 40. WPIconCopy - Two overlapping documents
export const WPIconCopy = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <rect
        x="8.5"
        y="8.5"
        width="11"
        height="11"
        rx="2.5"
        strokeWidth="1.8"
      />
      <path
        d="M5 15.5H4.5A2 2 0 0 1 2.5 13.5V4.5A2 2 0 0 1 4.5 2.5h9a2 2 0 0 1 2 2V5"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconCopy.displayName = "WPIconCopy";

// 41. WPIconLink - Chain link
export const WPIconLink = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </WPIconBase>
  )
);
WPIconLink.displayName = "WPIconLink";

// 42. WPIconArrowUp - Clean upward pointing arrow
export const WPIconArrowUp = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <line x1="12" y1="19" x2="12" y2="5" strokeWidth="2" strokeLinecap="round" />
      <polyline
        points="5 12 12 5 19 12"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconArrowUp.displayName = "WPIconArrowUp";

// 43. WPIconMagnet - Magnet icon
export const WPIconMagnet = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M4 4v7a8 8 0 0 0 16 0V4"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line x1="4" y1="9" x2="8.5" y2="9" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15.5" y1="9" x2="20" y2="9" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconMagnet.displayName = "WPIconMagnet";

// 44. WPIconYouTube - Clean YouTube badge with play triangle
export const WPIconYouTube = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M21.5 7.2a2.8 2.8 0 0 0-2-2C17.7 4.7 12 4.7 12 4.7s-5.7 0-7.5.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .5 4.8 2.8 2.8 0 0 0 2 2c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a2.8 2.8 0 0 0 2-2 29 29 0 0 0 .5-4.8 29 29 0 0 0-.5-4.8z"
        strokeWidth="1.8"
      />
      <polygon
        points="10 15 15 12 10 9 10 15"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconYouTube.displayName = "WPIconYouTube";

// 45. WPIconDiscord - Stylized controller/Discord mascot
export const WPIconDiscord = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="currentColor" stroke="none" {...props}>
      <path d="M19.3 5.4A15.8 15.8 0 0 0 15.3 4a11 11 0 0 0-.5 1.1 14.8 14.8 0 0 0-5.6 0A10.8 10.8 0 0 0 8.7 4a15.9 15.9 0 0 0-4 1.4C2.1 9.3 1.4 17 2.1 19.8a16 16 0 0 0 4.9 2.5 12 12 0 0 0 1.1-1.7 10.3 10.3 0 0 1-1.7-.8c.1-.1.3-.2.4-.3a11.3 11.3 0 0 0 10.4 0c.1.1.3.2.4.3a10.3 10.3 0 0 1-1.7.8c.3.6.7 1.2 1.1 1.7a16 16 0 0 0 4.9-2.5c.8-3.4.1-10.8-2.6-14.4zM8.5 15.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
    </WPIconBase>
  )
);
WPIconDiscord.displayName = "WPIconDiscord";

// 46. WPIconGitHub - Clean Octocat silhouette
export const WPIconGitHub = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="currentColor" stroke="none" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
    </WPIconBase>
  )
);
WPIconGitHub.displayName = "WPIconGitHub";

// 47. WPIconDatabase - Stacked cylinder server database
export const WPIconDatabase = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" strokeWidth="1.8" />
      <path
        d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"
        strokeWidth="1.8"
      />
      <path
        d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"
        strokeWidth="1.8"
      />
    </WPIconBase>
  )
);
WPIconDatabase.displayName = "WPIconDatabase";

// 48. WPIconSend - Paper airplane send icon (WhatsApp style)
export const WPIconSend = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.49-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"
        fill="currentColor"
        stroke="none"
      />
    </WPIconBase>
  )
);
WPIconSend.displayName = "WPIconSend";

// 49. WPIconDoubleCheck - WhatsApp signature double tick checkmarks
export const WPIconDoubleCheck = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path
        d="M1.5 12.5L5.5 16.5L14.5 7.5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 12.5L11.5 15.5L20.5 6.5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </WPIconBase>
  )
);
WPIconDoubleCheck.displayName = "WPIconDoubleCheck";

// 50. WPIconDownload - Tray with downward arrow
export const WPIconDownload = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 10 12 15 17 10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="15" x2="12" y2="3" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconDownload.displayName = "WPIconDownload";

// 51. WPIconUpload - Tray with upward arrow
export const WPIconUpload = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 8 12 3 7 8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="3" x2="12" y2="15" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconUpload.displayName = "WPIconUpload";

// 52. WPIconSearch - Magnifying glass
export const WPIconSearch = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="11" cy="11" r="7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconSearch.displayName = "WPIconSearch";

// 53. WPIconHelp - Rounded question mark
export const WPIconHelp = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="10" strokeWidth="1.8" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconHelp.displayName = "WPIconHelp";

// 54. WPIconSave - Modern save / floppy disk icon
export const WPIconSave = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 21 17 13 7 13 7 21" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 3 7 8 15 8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </WPIconBase>
  )
);
WPIconSave.displayName = "WPIconSave";

// 55. WPIconPaint - Artist palette / color picker
export const WPIconPaint = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path d="M12 3a9 9 0 0 0-9 9c0 3.6 2.4 6.6 6 8.2.4.2.8-.1.8-.5v-1.2c0-.6.4-1 1-1h1.5c3.6 0 6.5-2.9 6.5-6.5C21 6.8 17 3 12 3z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    </WPIconBase>
  )
);
WPIconPaint.displayName = "WPIconPaint";

// 56. WPIconClipboard - Clipboard / paste icon
export const WPIconClipboard = React.forwardRef<SVGSVGElement, WPIconProps>(
  (props, ref) => (
    <WPIconBase ref={ref} fill="none" stroke="currentColor" {...props}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h4" strokeWidth="1.8" strokeLinecap="round" />
    </WPIconBase>
  )
);
WPIconClipboard.displayName = "WPIconClipboard";

// 57. DipkriLogo - Official Dipkri Popcorn Brand Mark
export const DipkriLogo = React.forwardRef<
  SVGSVGElement,
  { size?: number | string; className?: string; style?: React.CSSProperties }
>(({ size = 28, className = "", style }, ref) => {
  return (
    <svg
      ref={ref}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        overflow: "visible",
        flexShrink: 0,
        filter: "drop-shadow(0 2px 8px rgba(245, 158, 11, 0.45))",
        ...style,
      }}
    >
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="24"
      >
        🍿
      </text>
    </svg>
  );
});
DipkriLogo.displayName = "DipkriLogo";

