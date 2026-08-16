"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { savePushSubscription } from "@/components/services/notification.service";
import { useAuth } from "@/lib/auth/AuthProvider";

const DISMISS_KEY = "transjit_pwa_install_dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Install / Add-to-Home-Screen prompt + optional push permission.
 * Does not force permission on first load; only after Install / Enable.
 */
export default function PwaInstallBanner() {
  const { session, hasPermission } = useAuth();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const canUseNotifications = hasPermission("notifications", "view");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

    setStandalone(isStandalone);
    if (isStandalone) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBip);

    // iOS / unsupported browsers: show soft help after a short delay
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const timer = window.setTimeout(() => {
      if (!deferred && isIos) {
        setShowIosHelp(true);
        setVisible(true);
      } else if (!deferred) {
        setVisible(true);
      }
    }, 4000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.clearTimeout(timer);
    };
  }, [deferred]);

  async function enablePush() {
    try {
      if (!canUseNotifications) {
        toast.message("You do not have permission to receive notifications.");
        return;
      }
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        toast.message("Push notifications are not supported in this browser.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.message("Notification permission was not granted.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        toast.error("Push is not configured (missing VAPID public key).");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      if (session) await savePushSubscription(sub);
      toast.success("Notifications enabled.");
    } catch (error) {
      console.error(error);
      toast.error("Unable to enable notifications.");
    }
  }

  async function handleInstall() {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === "accepted") {
        setVisible(false);
        if (canUseNotifications) await enablePush();
      }
      return;
    }
    setShowIosHelp(true);
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (standalone || !visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-xl shadow-primary/15 sm:left-auto">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-highlight" />
      <div className="flex items-start gap-3 pt-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">Install Trans Jit ERP</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {deferred
              ? "Add the ERP to your device for quick access like an app."
              : showIosHelp
                ? "On iPhone/iPad: tap Share → Add to Home Screen."
                : "Use your browser menu → Install app / Add to Home Screen when available."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleInstall}>
              {deferred ? "Install Trans Jit ERP" : "How to install"}
            </Button>
            {session && canUseNotifications && (
              <Button size="sm" variant="outline" onClick={enablePush}>
                Enable notifications
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button type="button" aria-label="Dismiss" onClick={dismiss} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
