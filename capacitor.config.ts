import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "in.transjitexpresserp.mobile",
  appName: "Transjit Express ERP",
  webDir: "www",
  server: {
    url: "https://transjitexpresserp.in",
    cleartext: false,
    allowNavigation: ["transjitexpresserp.in"],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["sound", "alert", "banner", "list"],
    },
  },
};

export default config;
