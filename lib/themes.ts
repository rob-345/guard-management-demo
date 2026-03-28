export const THEME_PRESETS = [
  "default",
  "underground",
  "rose-garden",
  "lake-view",
  "sunset-glow",
  "forest-whisper",
  "ocean-breeze",
  "lavender-dream"
] as const;

export const THEME_RADII = ["default", "none", "sm", "md", "lg", "xl"] as const;

export const THEME_SCALES = ["none", "sm", "lg"] as const;

export const THEME_CONTENT_LAYOUTS = ["full", "centered"] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export type ThemeRadius = (typeof THEME_RADII)[number];

export type ThemeScale = (typeof THEME_SCALES)[number];

export type ThemeContentLayout = (typeof THEME_CONTENT_LAYOUTS)[number];

export type ThemeConfig = {
  preset: ThemePreset;
  radius: ThemeRadius;
  scale: ThemeScale;
  contentLayout: ThemeContentLayout;
};

export type ThemeType = ThemeConfig;

export const DEFAULT_THEME: ThemeConfig = {
  preset: "default",
  radius: "default",
  scale: "none",
  contentLayout: "full"
};

export const THEMES = [
  {
    name: "Default",
    value: "default",
    colors: ["oklch(0.33 0 0)"]
  },
  {
    name: "Underground",
    value: "underground",
    colors: ["oklch(0.5315 0.0694 156.19)"]
  },
  {
    name: "Rose Garden",
    value: "rose-garden",
    colors: ["oklch(0.5827 0.2418 12.23)"]
  },
  {
    name: "Lake View",
    value: "lake-view",
    colors: ["oklch(0.765 0.177 163.22)"]
  },
  {
    name: "Sunset Glow",
    value: "sunset-glow",
    colors: ["oklch(0.5827 0.2187 36.98)"]
  },
  {
    name: "Forest Whisper",
    value: "forest-whisper",
    colors: ["oklch(0.5276 0.1072 182.22)"]
  },
  {
    name: "Ocean Breeze",
    value: "ocean-breeze",
    colors: ["oklch(0.59 0.20 277.12)"]
  },
  {
    name: "Lavender Dream",
    value: "lavender-dream",
    colors: ["oklch(0.71 0.16 293.54)"]
  }
];
