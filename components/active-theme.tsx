"use client";

import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_THEME, type ThemeConfig } from "@/lib/themes";

function setThemeCookie(key: string, value: string | null) {
  if (typeof window === "undefined") return;

  if (!value) {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax; ${window.location.protocol === "https:" ? "Secure;" : ""}`;
  } else {
    document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax; ${window.location.protocol === "https:" ? "Secure;" : ""}`;
  }
}

type ThemeContextType = {
  theme: ThemeConfig;
  setTheme: (theme: ThemeConfig) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ActiveThemeProvider({
  children,
  initialTheme
}: {
  children: ReactNode;
  initialTheme?: ThemeConfig;
}) {
  const [theme, setTheme] = useState<ThemeConfig>(() =>
    initialTheme ? initialTheme : DEFAULT_THEME
  );

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (theme.preset !== DEFAULT_THEME.preset) {
      setThemeCookie("theme_preset", theme.preset);
      root.setAttribute("data-theme-preset", theme.preset);
      body.setAttribute("data-theme-preset", theme.preset);
    } else {
      setThemeCookie("theme_preset", null);
      root.removeAttribute("data-theme-preset");
      body.removeAttribute("data-theme-preset");
    }

    if (theme.radius !== DEFAULT_THEME.radius) {
      setThemeCookie("theme_radius", theme.radius);
      root.setAttribute("data-theme-radius", theme.radius);
      body.setAttribute("data-theme-radius", theme.radius);
    } else {
      setThemeCookie("theme_radius", null);
      root.removeAttribute("data-theme-radius");
      body.removeAttribute("data-theme-radius");
    }

    if (theme.scale !== DEFAULT_THEME.scale) {
      setThemeCookie("theme_scale", theme.scale);
      root.setAttribute("data-theme-scale", theme.scale);
      body.setAttribute("data-theme-scale", theme.scale);
    } else {
      setThemeCookie("theme_scale", null);
      root.removeAttribute("data-theme-scale");
      body.removeAttribute("data-theme-scale");
    }

    setThemeCookie("theme_content_layout", theme.contentLayout);
    root.setAttribute("data-theme-content-layout", theme.contentLayout);
    body.setAttribute("data-theme-content-layout", theme.contentLayout);
  }, [theme.preset, theme.radius, theme.scale, theme.contentLayout]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useThemeConfig() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useThemeConfig must be used within an ActiveThemeProvider");
  }
  return context;
}
