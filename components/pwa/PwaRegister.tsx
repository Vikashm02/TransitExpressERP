"use client";

import { useEffect } from "react";

/** Registers the PWA service worker once on the client. */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        console.error("[pwa] SW registration failed", error);
      }
    };

    void register();
  }, []);

  return null;
}
