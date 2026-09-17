import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type LiveBidDeadlineState = "future" | "passed" | "none";

export interface LiveBidIndicatorSnapshot {
  count: number;
  label: string | null;
  closesAtEpochMs: number | null;
  deadlineState: LiveBidDeadlineState;
}

interface NativeLiveBidIndicatorPlugin {
  sync(snapshot: LiveBidIndicatorSnapshot): Promise<void>;
  consumePendingOpen(): Promise<{ open: boolean }>;
  addListener(eventName: "openLiveBids", listenerFunc: () => void): Promise<PluginListenerHandle>;
}

const NativeLiveBidIndicator = registerPlugin<NativeLiveBidIndicatorPlugin>("NativeLiveBidIndicator");

function isSupportedNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isNativeLiveBidIndicatorAvailable(): boolean {
  return isSupportedNativeAndroid() && Capacitor.isPluginAvailable("NativeLiveBidIndicator");
}

/**
 * Native-only, isolated Live Bid status bridge. Old APKs simply have no bridge
 * and therefore retain their existing behavior without errors or fallbacks.
 */
export async function syncNativeLiveBidIndicator(snapshot: LiveBidIndicatorSnapshot): Promise<void> {
  if (!isNativeLiveBidIndicatorAvailable()) return;
  await NativeLiveBidIndicator.sync(snapshot);
}

/** Clears only the dedicated native Live Bid indicator. */
export async function clearNativeLiveBidIndicator(): Promise<void> {
  await syncNativeLiveBidIndicator({ count: 0, label: null, closesAtEpochMs: null, deadlineState: "none" });
}

/** Consumes a fixed native notification tap; no route is accepted from JavaScript. */
export async function consumePendingNativeLiveBidOpen(): Promise<boolean> {
  if (!isNativeLiveBidIndicatorAvailable()) return false;
  const result = await NativeLiveBidIndicator.consumePendingOpen();
  return result.open === true;
}

/** Subscribes only to the dedicated native indicator's fixed tap event. */
export async function addNativeLiveBidOpenListener(listener: () => void): Promise<PluginListenerHandle | null> {
  if (!isNativeLiveBidIndicatorAvailable()) return null;
  return NativeLiveBidIndicator.addListener("openLiveBids", listener);
}