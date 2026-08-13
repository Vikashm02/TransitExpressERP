import type { MetadataRoute } from "next";

/**
 * Minimal web app manifest for Chrome "Install app" branding.
 * No service worker / offline behaviour — icons + identity only.
 * Name/description match existing root metadata in app/layout.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Transjit Software",
    short_name: "Transjit Software",
    description: "Transjit Software — Transit Express ERP",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
