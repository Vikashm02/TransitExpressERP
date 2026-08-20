"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wires already-installed `next-themes` to existing `.dark` CSS tokens.
 * No new theme library. Preference storage is handled via next-themes
 * (localStorage) and Profile preferences UI.
 */
export default function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="transjit.profile.theme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
