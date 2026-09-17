"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  LIVE_BID_STATE_CHANGED_EVENT,
  getLiveBidIndicatorSummary,
} from "@/components/services/bid.service";
import {
  addNativeLiveBidOpenListener,
  clearNativeLiveBidIndicator,
  consumePendingNativeLiveBidOpen,
  isNativeLiveBidIndicatorAvailable,
  syncNativeLiveBidIndicator,
} from "@/components/services/nativeLiveBidIndicator.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const LIVE_BIDS_ROUTE = "/bids?liveOnly=1";

/**
 * Separate from NativePushRuntime: synchronizes one native status notification
 * from already-authorized Bid data and never registers devices, handles FCM,
 * or sends a notification through any delivery system.
 */
export default function NativeLiveBidIndicatorRuntime() {
  const { session, hasPermission, loading, profileLoading } = useAuth();
  const router = useRouter();
  const requestInFlight = useRef(false);
  const pendingOpenQueue = useRef<Promise<void>>(Promise.resolve());
  const canViewBids = hasPermission("bids", "view");
  const userId = session?.user.id ?? null;
  const authResolved = !loading && !profileLoading;
  const canOpenLiveBids = authResolved && Boolean(userId) && canViewBids;

  const openLiveBids = useCallback(() => {
    router.push(LIVE_BIDS_ROUTE);
  }, [router]);

  const consumePendingOpen = useCallback(async (shouldNavigate: () => boolean) => {
    const task = pendingOpenQueue.current
      .catch(() => undefined)
      .then(async () => {
        const pending = await consumePendingNativeLiveBidOpen();
        if (pending && shouldNavigate()) openLiveBids();
      });
    pendingOpenQueue.current = task;
    await task;
  }, [openLiveBids]);

  const synchronize = useCallback(async () => {
    if (!isNativeLiveBidIndicatorAvailable()) return;
    if (!authResolved) return;
    if (!userId || !canViewBids) {
      await clearNativeLiveBidIndicator();
      return;
    }
    if (requestInFlight.current) return;

    requestInFlight.current = true;
    try {
      await syncNativeLiveBidIndicator(await getLiveBidIndicatorSummary());
    } catch (error) {
      // Keep the last native status visible on a transient read failure; a
      // later focus, visibility, or Bid-save refresh will reconcile it.
      console.error("Unable to synchronize the Live Bid indicator", error);
    } finally {
      requestInFlight.current = false;
    }
  }, [authResolved, canViewBids, userId]);

  useEffect(() => {
    const initialSync = window.setTimeout(() => void synchronize(), 0);
    return () => window.clearTimeout(initialSync);
  }, [synchronize]);

  useEffect(() => {
    if (!isNativeLiveBidIndicatorAvailable() || !canOpenLiveBids) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    const refreshAfterBidChange = () => void synchronize();

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener(LIVE_BID_STATE_CHANGED_EVENT, refreshAfterBidChange);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener(LIVE_BID_STATE_CHANGED_EVENT, refreshAfterBidChange);
    };
  }, [canOpenLiveBids, synchronize]);

  useEffect(() => {
    let disposed = false;
    let listener: Awaited<ReturnType<typeof addNativeLiveBidOpenListener>> = null;

    async function configureTapRouting() {
      if (!isNativeLiveBidIndicatorAvailable() || !authResolved) return;
      if (!canOpenLiveBids) {
        // Once authorization is conclusively denied, discard a stale native
        // tap so it cannot navigate after a later account/session change.
        await consumePendingOpen(() => false);
        return;
      }

      listener = await addNativeLiveBidOpenListener(() => {
        if (!disposed) void consumePendingOpen(() => !disposed && canOpenLiveBids);
      });
      if (disposed) {
        await listener?.remove();
        return;
      }
      await consumePendingOpen(() => !disposed && canOpenLiveBids);
    }

    void configureTapRouting().catch((error) => {
      console.error("Unable to configure Live Bid indicator tap routing", error);
    });

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, [authResolved, canOpenLiveBids, consumePendingOpen]);

  return null;
}