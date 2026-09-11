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

/**
 * Requests Android's notification permission only after an authenticated ERP
 * session is available. It has no browser behavior and never registers FCM.
 */
export default function NativeDeviceAlertsPermission() {
  const { session } = useAuth();
  const checkedUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !isNativeAndroid() || checkedUserId.current === userId) return;

    checkedUserId.current = userId;
    void ensureNativeDeviceAlertsPermission()
      .then((permission) => {
        if (permission === "granted" || !shouldShowNativeDeviceAlertsReminder()) return;

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
      })
      .catch((error) => {
        console.error("Unable to check Android notification permission", error);
      });
  }, [session]);

  return null;
}
