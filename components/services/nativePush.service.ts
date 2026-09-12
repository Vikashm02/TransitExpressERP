import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase";

export const TRANSJIT_ALERTS_CHANNEL_ID = "transjit_erp_alerts_v1";
const TRANSJIT_ALERTS_SOUND = "transjit_koyal_notification";
const AUTO_PERMISSION_REQUESTED_KEY = "transjit_native_alerts_permission_requested_v1";
const REMINDER_SHOWN_AT_KEY = "transjit_native_alerts_reminder_shown_at_v1";
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface NativeNotificationSettingsPlugin {
  open(): Promise<void>;
}

const NativeNotificationSettings = registerPlugin<NativeNotificationSettingsPlugin>(
  "NativeNotificationSettings"
);

export type NativeDeviceAlertsPermission = "granted" | "prompt" | "denied" | "not-native";

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Keeps native FCM registration isolated from browser VAPID subscriptions.
 * The database RPC derives the user from the authenticated Supabase session;
 * no caller can submit a user id.
 */
export async function registerNativeDeviceToken(fcmToken: string): Promise<void> {
  const { error } = await supabase.rpc("register_native_device_token", {
    p_fcm_token: fcmToken,
    p_platform: "android",
    p_app_id: "in.transjitexpresserp.app",
  });

  if (error) throw error;
}

/** Only accept internal ERP paths from future native notification payloads. */
export function getSafeNativeNotificationHref(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const href = (data as Record<string, unknown>).href;
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) {
    return null;
  }
  return value;
}

function normalizePermission(permission: string): NativeDeviceAlertsPermission {
  if (permission === "granted") return "granted";
  // Android reports this only before it has shown the system prompt. A
  // rationale state means it was previously declined, so do not re-prompt.
  if (permission === "prompt") return "prompt";
  return "denied";
}

function wasAutoPermissionRequested(): boolean {
  try {
    return window.localStorage.getItem(AUTO_PERMISSION_REQUESTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAutoPermissionRequested(): void {
  try {
    window.localStorage.setItem(AUTO_PERMISSION_REQUESTED_KEY, "1");
  } catch {
    // Android's own permission state still prevents repeated prompts when
    // browser storage is unavailable.
  }
}

export function shouldShowNativeDeviceAlertsReminder(now = Date.now()): boolean {
  try {
    const lastShownAt = Number(window.localStorage.getItem(REMINDER_SHOWN_AT_KEY));
    return !Number.isFinite(lastShownAt) || now - lastShownAt >= REMINDER_INTERVAL_MS;
  } catch {
    return false;
  }
}

export function markNativeDeviceAlertsReminderShown(now = Date.now()): void {
  try {
    window.localStorage.setItem(REMINDER_SHOWN_AT_KEY, String(now));
  } catch {
    // If storage is unavailable, avoid showing a reminder repeatedly.
  }
}

/** Opens Android's notification settings for this ERP app. */
export async function openNativeDeviceAlertsSettings(): Promise<void> {
  if (!isNativeAndroid()) return;
  await NativeNotificationSettings.open();
}

/**
 * Creates the versioned native-alert channel and reads its Android permission.
 * This deliberately does not register for FCM or handle device tokens.
 */
export async function getNativeDeviceAlertsPermission(): Promise<NativeDeviceAlertsPermission> {
  if (!isNativeAndroid()) {
    return "not-native";
  }

  await PushNotifications.createChannel({
    id: TRANSJIT_ALERTS_CHANNEL_ID,
    name: "Transit Express Alerts",
    description: "Important Transit Express ERP alerts.",
    importance: 4,
    sound: TRANSJIT_ALERTS_SOUND,
    vibration: true,
  });

  const permission = await PushNotifications.checkPermissions();
  return normalizePermission(permission.receive);
}

/**
 * Runs only after an authenticated Android session exists. It requests the
 * Android system permission once, and only while Android reports its initial
 * prompt state. Declined permissions are left for the user to change in
 * Android Settings.
 */
export async function ensureNativeDeviceAlertsPermission(): Promise<NativeDeviceAlertsPermission> {
  const permission = await getNativeDeviceAlertsPermission();
  if (permission !== "prompt" || wasAutoPermissionRequested()) {
    return permission;
  }

  markAutoPermissionRequested();
  const requested = await PushNotifications.requestPermissions();
  return normalizePermission(requested.receive);
}
