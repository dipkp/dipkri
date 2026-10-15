// webcamSettings.ts - Centralized reactive settings for floating webcam bubbles
export type BubbleSize = "min" | "small" | "medium" | "max";

export const SIZE_PRESETS: Record<BubbleSize, number> = {
  min: 48,
  small: 70,
  medium: 95,
  max: 145,
};

export interface WebcamSettingsState {
  size: BubbleSize;
  dragUnlocked: boolean;
  visible: boolean;
}

export const getWebcamSettings = (): WebcamSettingsState => {
  let size: BubbleSize = "medium";
  let dragUnlocked = false;
  let visible = true;

  if (typeof window !== "undefined") {
    try {
      const savedSize = localStorage.getItem("dipkri-webcam-size") as BubbleSize;
      if (savedSize && (savedSize === "min" || savedSize === "small" || savedSize === "medium" || savedSize === "max")) {
        size = savedSize;
      }
      const savedDrag = localStorage.getItem("dipkri-webcam-drag");
      if (savedDrag === "true") {
        dragUnlocked = true;
      }
      const savedVis = localStorage.getItem("dipkri-webcam-visible");
      if (savedVis === "false") {
        visible = false;
      }
    } catch {}
  }

  return { size, dragUnlocked, visible };
};

export const setWebcamSettings = (
  partial: Partial<WebcamSettingsState>,
): WebcamSettingsState => {
  const current = getWebcamSettings();
  const next: WebcamSettingsState = { ...current, ...partial };

  if (typeof window !== "undefined") {
    try {
      if (partial.size !== undefined) {
        localStorage.setItem("dipkri-webcam-size", partial.size);
      }
      if (partial.dragUnlocked !== undefined) {
        localStorage.setItem("dipkri-webcam-drag", String(partial.dragUnlocked));
      }
      if (partial.visible !== undefined) {
        localStorage.setItem("dipkri-webcam-visible", String(partial.visible));
      }
    } catch {}

    window.dispatchEvent(
      new CustomEvent("dipkri-webcam-settings-changed", { detail: next }),
    );
  }

  return next;
};
