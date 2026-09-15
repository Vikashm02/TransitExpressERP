"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";

import {
  getNativeDeviceAlertsPermission,
  getSafeNativeNotificationHref,
  isNativeAndroid,
  registerNativeDeviceToken,
} from "@/components/services/nativePush.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const NATIVE_DEVICE_ALERTS_GRANTED_EVENT = "transjit-native-device-alerts-granted";

function getNotificationId(eventId: string | undefined): number {
  if (typeof eventId === "string" && /^[0-9]+$/.test(eventId)) {
    const parsed = Number(eventId);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 2147483647) {
      return parsed;
    }
  }
  const fallback = Date.now() % 2147483647;
  return fallback === 0 ? 1 : fallback;
}

async function scheduleForegroundNotification(notification: {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}) {
  if (typeof window === "undefined" || !isNativeAndroid()) return;
  if (!Capacitor.isPluginAvailable("LocalNotifications")) return;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return;

  const href = getSafeNativeNotificationHref(notification.data ?? {});
  if (!href) return;

  const eventId = notification.data?.eventId as string | undefined;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: getNotificationId(eventId),
        title: notification.title ?? "Transit Express ERP",
        body: notification.body ?? "",
        extra: { href, eventId: eventId ?? "" },
        channelId: "transjit_erp_alerts_v1",
        smallIcon: "ic_stat_transjit_notification",
      }],
    });
  } catch (error) {
    console.error("Failed to schedule foreground notification.", error);
  }
}

/**
 * The one authenticated native-push runtime. It intentionally owns listener
 * registration and token registration only; permission prompting/reminders
 * remain in NativeDeviceAlertsPermission under DashboardLayout.
 */
export default function NativePushRuntime() {
  const { session } = useAuth();
  const router = useRouter();
  const configuredUserId = useRef<string | null>(null);
  const configuringUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id ?? null;
    if (!userId || !isNativeAndroid()) return;

    let cancelled = false;
    let handles: PluginListenerHandle[] = [];

    async function configureRuntime() {
      if (configuredUserId.current === userId || configuringUserId.current === userId) return;
      configuringUserId.current = userId;

      try {
        const permission = await getNativeDeviceAlertsPermission();
        if (cancelled || permission !== "granted") return;

        const listenerPromises: Promise<PluginListenerHandle>[] = [
        PushNotifications.addListener("registration", (token) => {
          // Never log the FCM token: it is a device credential.
          console.info("[Native Push] device-token RPC attempted");
          void registerNativeDeviceToken(token.value)
            .then(() => {
              console.info("[Native Push] device-token RPC succeeded");
            })
            .catch((error: unknown) => {
              const rpcError = error as { code?: unknown; message?: unknown } | null;
              console.error("[Native Push] device-token RPC failed", {
                code: typeof rpcError?.code === "string" ? rpcError.code : null,
                message: typeof rpcError?.message === "string" ? rpcError.message : "Unknown error",
              });
            });
        }),
        PushNotifications.addListener("registrationError", () => {
          console.error("Native push registration failed");
        }),
        PushNotifications.addListener("pushNotificationReceived", (notification) => {
          void scheduleForegroundNotification(notification);
        }),
        PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const href = getSafeNativeNotificationHref(action.notification.data);
          if (href) router.push(href);
        }),
      ];

      if (Capacitor.isPluginAvailable("LocalNotifications")) {
        listenerPromises.push(
          LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
            const href = getSafeNativeNotificationHref(action.notification.extra);
            if (href) router.push(href);
          }),
        );
      }

        const nextHandles = await Promise.all(listenerPromises);
        if (cancelled) {
          await Promise.all(nextHandles.map((handle) => handle.remove()));
          return;
        }

        handles = nextHandles;
        configuredUserId.current = userId;
        await PushNotifications.register();
      } finally {
        if (configuringUserId.current === userId) {
          configuringUserId.current = null;
        }
      }
    }

    const handlePermissionGranted = () => {
      void configureRuntime().catch((error) => {
        console.error("Unable to configure native push registration", error);
      });
    };

    window.addEventListener(NATIVE_DEVICE_ALERTS_GRANTED_EVENT, handlePermissionGranted);
    handlePermissionGranted();

    return () => {
      cancelled = true;
      configuredUserId.current = null;
      configuringUserId.current = null;
      window.removeEventListener(NATIVE_DEVICE_ALERTS_GRANTED_EVENT, handlePermissionGranted);
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [router, session?.user.id]);

  return null;
}
