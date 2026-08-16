import type { MetadataRoute } from "next";

/**
 * Installable PWA manifest. Service worker is registered separately
 * (see components/pwa/PwaRegister.tsx + public/sw.js).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trans Jit ERP",
    short_name: "Trans Jit ERP",
    description: "Transjit Software — Transit Express ERP",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0B3A67",
    theme_color: "#0B3A67",
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
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
