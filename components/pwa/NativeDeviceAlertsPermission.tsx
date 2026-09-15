"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  ensureNativeDeviceAlertsPermission,
  isNativeAndroid,
  markNativeDeviceAlertsReminderShown,
  openNativeDeviceAlertsSettings,
  shouldShowNativeDeviceAlertsReminder,
} from "@/components/services/nativePush.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const NATIVE_DEVICE_ALERTS_GRANTED_EVENT = "transjit-native-device-alerts-granted";

/**
 * Dashboard-only native permission and reminder UX. Listener setup and FCM
 * registration are owned by NativePushRuntime, which stays mounted on print routes.
 */
export default function NativeDeviceAlertsPermission() {
  const { session } = useAuth();
  const configuredUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !isNativeAndroid() || configuredUserId.current === userId) return;

    configuredUserId.current = userId;
    let cancelled = false;

    async function configureNativePermission() {
      try {
        const permission = await ensureNativeDeviceAlertsPermission();
        if (cancelled) return;

        if (permission === "granted") {
          window.dispatchEvent(new Event(NATIVE_DEVICE_ALERTS_GRANTED_EVENT));
          return;
        }

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
      } catch (error) {
        // Permission checks must never block normal ERP use.
        console.error("Unable to configure native notification permission", error);
      }
    }

    void configureNativePermission();

    return () => {
      cancelled = true;
      configuredUserId.current = null;
    };
  }, [session?.user.id]);

  return null;
}
