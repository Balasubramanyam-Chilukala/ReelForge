/** Caption style presets — shared by the MCP tools, the backend auto-caption generator,
 * and (via names) the UI. Pure data + a small builder. */

import type { TextStyle } from "./schema.js";

export type CaptionPreset =
  | "clean"
  | "bold"
  | "cinematic"
  | "wordHighlight"
  | "social"
  | "podcast"
  | "minimalWhite";

export const CAPTION_PRESETS: Record<CaptionPreset, TextStyle> = {
  clean: { fontFamily: "Inter", fontSize: 64, color: "#ffffff", shadow: true, preset: "clean" },
  bold: { fontFamily: "Inter", fontSize: 86, color: "#ffffff", bold: true, outlineColor: "#000000", outlineWidth: 6, preset: "bold" },
  cinematic: { fontFamily: "Georgia", fontSize: 56, color: "#f5f5f5", shadow: true, preset: "cinematic" },
  wordHighlight: { fontFamily: "Inter", fontSize: 80, color: "#ffffff", bold: true, highlightColor: "#ffd60a", preset: "wordHighlight" },
  social: { fontFamily: "Inter", fontSize: 84, color: "#ffffff", bold: true, background: "#000000", preset: "social" },
  podcast: { fontFamily: "Inter", fontSize: 60, color: "#ffffff", outlineColor: "#111111", outlineWidth: 3, preset: "podcast" },
  minimalWhite: { fontFamily: "Helvetica", fontSize: 58, color: "#ffffff", shadow: true, preset: "minimalWhite" },
};

export const CAPTION_PRESET_NAMES = Object.keys(CAPTION_PRESETS) as CaptionPreset[];

export function captionStyle(preset: CaptionPreset = "clean", overrides: Partial<TextStyle> = {}): TextStyle {
  return { ...CAPTION_PRESETS[preset], ...overrides };
}
