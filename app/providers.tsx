"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

import { ActiveThemeProvider } from "@/components/active-theme";
import { Toaster } from "@/components/ui/sonner";
import type { ThemeConfig } from "@/lib/themes";

export function Providers({
  children,
  initialTheme
}: {
  children: ReactNode;
  initialTheme: ThemeConfig;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange>
      <ActiveThemeProvider initialTheme={initialTheme}>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </ActiveThemeProvider>
    </ThemeProvider>
  );
}
