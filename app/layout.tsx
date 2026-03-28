import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { fontVariables } from "@/lib/fonts";
import {
  DEFAULT_THEME,
  THEME_CONTENT_LAYOUTS,
  THEME_PRESETS,
  THEME_RADII,
  THEME_SCALES,
  type ThemeConfig
} from "@/lib/themes";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guard Management Demo",
  description: "A guard operations dashboard for managing sites, terminals, shifts, and events"
};

function pickThemeValue(value: string | undefined, allowed: readonly string[], fallback: string) {
  if (!value) return fallback;
  return allowed.includes(value) ? value : fallback;
}

async function getInitialTheme(): Promise<ThemeConfig> {
  const cookieStore = await cookies();

  return {
    preset: pickThemeValue(
      cookieStore.get("theme_preset")?.value,
      THEME_PRESETS,
      DEFAULT_THEME.preset
    ) as ThemeConfig["preset"],
    radius: pickThemeValue(
      cookieStore.get("theme_radius")?.value,
      THEME_RADII,
      DEFAULT_THEME.radius
    ) as ThemeConfig["radius"],
    scale: pickThemeValue(
      cookieStore.get("theme_scale")?.value,
      THEME_SCALES,
      DEFAULT_THEME.scale
    ) as ThemeConfig["scale"],
    contentLayout: pickThemeValue(
      cookieStore.get("theme_content_layout")?.value,
      THEME_CONTENT_LAYOUTS,
      DEFAULT_THEME.contentLayout
    ) as ThemeConfig["contentLayout"]
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const initialTheme = await getInitialTheme();
  const sharedThemeAttributes = {
    "data-theme-preset":
      initialTheme.preset === DEFAULT_THEME.preset ? undefined : initialTheme.preset,
    "data-theme-radius":
      initialTheme.radius === DEFAULT_THEME.radius ? undefined : initialTheme.radius,
    "data-theme-scale":
      initialTheme.scale === DEFAULT_THEME.scale ? undefined : initialTheme.scale,
    "data-theme-content-layout": initialTheme.contentLayout
  };

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={fontVariables}
      {...sharedThemeAttributes}>
      <body
        className="group/layout min-h-svh bg-background font-sans text-foreground antialiased"
        {...sharedThemeAttributes}>
        <Providers initialTheme={initialTheme}>{children}</Providers>
      </body>
    </html>
  );
}
