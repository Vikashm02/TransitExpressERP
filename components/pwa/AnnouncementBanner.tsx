"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  dismissAnnouncement,
  getActiveAnnouncementsForLocation,
  getDismissedAnnouncementIds,
  type Announcement,
  type AnnouncementLocation,
} from "@/components/services/announcement.service";
import { useAuth } from "@/lib/auth/AuthProvider";

function locationFromPath(pathname: string): AnnouncementLocation {
  if (pathname.startsWith("/lorry-expenses")) return "financials";
  if (pathname.startsWith("/lr")) return "lr";
  if (pathname.startsWith("/pod")) return "pod";
  if (pathname.startsWith("/delivery-challans")) return "delivery_challans";
  if (pathname === "/" || pathname === "") return "home";
  return "home";
}

export default function AnnouncementBanner() {
  const { session } = useAuth();
  const pathname = usePathname();
  const [current, setCurrent] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!session) {
      setCurrent(null);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const location = locationFromPath(pathname);
        const [active, dismissed] = await Promise.all([
          getActiveAnnouncementsForLocation(location),
          getDismissedAnnouncementIds(),
        ]);
        if (cancelled) return;

        const next =
          active.find((item) => dismissed.get(item.id) !== item.contentVersion) ?? null;
        setCurrent(next);
      } catch (error) {
        console.error(error);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [session, pathname]);

  if (!current) return null;

  async function handleDismiss() {
    if (!current) return;
    try {
      await dismissAnnouncement(current.id, current.contentVersion);
    } catch (error) {
      console.error(error);
    }
    setCurrent(null);
  }

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-primary/20 bg-primary/5">
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-base font-semibold text-foreground">{current.title}</p>
          {current.message && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.message}</p>
          )}
          {current.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.imageUrl}
              alt=""
              className="mt-2 max-h-56 w-full rounded-lg object-contain"
            />
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={handleDismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
