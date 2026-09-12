"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { toast } from "sonner";

import {
  ensureNativeDeviceAlertsPermission,
  getSafeNativeNotificationHref,
  isNativeAndroid,
  markNativeDeviceAlertsReminderShown,
  openNativeDeviceAlertsSettings,
  registerNativeDeviceToken,
  shouldShowNativeDeviceAlertsReminder,
} from "@/components/services/nativePush.service";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Requests Android's notification permission only after an authenticated ERP
 * session is available. It has no browser behavior and never registers FCM.
 */
export default function NativeDeviceAlertsPermission() {
  const { session } = useAuth();
  const router = useRouter();
  const configuredUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !isNativeAndroid() || configuredUserId.current === userId) return;

    configuredUserId.current = userId;
    let cancelled = false;
    let handles: PluginListenerHandle[] = [];

    async function configureNativeRegistration() {
      try {
        const permission = await ensureNativeDeviceAlertsPermission();
        if (cancelled) return;

        if (permission !== "granted") {
          if (!shouldShowNativeDeviceAlertsReminder()) return;

          markNativeDeviceAlertsReminderShown();
          toast.message("Notifications are important for Transit Express ERP alerts.", {
            action: {
              label: "Enable notifications",
              onClick: () => {
                void openNativeDeviceAlertsSettings().catch((error) => {
                  console.error("Unable to open Android notification settings", error);
                  toast.error("Unable to open Android notification settings.");
                });
              },
            },
          });
          return;
        }

        const nextHandles = await Promise.all([
          PushNotifications.addListener("registration", (token) => {
            // Do not log the token: it is a device credential.
            console.info("[Native Push] device-token RPC attempted");
            void registerNativeDeviceToken(token.value)
              .then(() => {
                console.info("[Native Push] device-token RPC succeeded");
              })
              .catch((error: unknown) => {
                const rpcError = error as { code?: unknown; message?: unknown } | null;
                console.error("[Native Push] device-token RPC failed", {
                  code: typeof rpcError?.code === "string" ? rpcError.code : null,
                  message:
                    typeof rpcError?.message === "string" ? rpcError.message : "Unknown error",
                });
              });
          }),
          PushNotifications.addListener("registrationError", () => {
            console.error("Native push registration failed");
          }),
          PushNotifications.addListener("pushNotificationReceived", () => {
            // Phase 1 deliberately adds no foreground-notification UI.
          }),
          PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            const href = getSafeNativeNotificationHref(action.notification.data);
            if (href) router.push(href);
          }),
        ]);

        if (cancelled) {
          await Promise.all(nextHandles.map((handle) => handle.remove()));
          return;
        }

        handles = nextHandles;
        await PushNotifications.register();
      } catch (error) {
        // Registration failure must never block normal ERP use.
        console.error("Unable to configure native push registration", error);
      }
    }

    void configureNativeRegistration();

    return () => {
      cancelled = true;
      configuredUserId.current = null;
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [router, session?.user.id]);

  return null;
}
