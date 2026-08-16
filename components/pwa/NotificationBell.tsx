"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getNotificationInbox,
  markInboxRead,
  type InboxItem,
} from "@/components/services/notification.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

export default function NotificationBell() {
  const { session, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const canUseNotifications = hasPermission("notifications", "view");

  useEffect(() => {
    if (!session || !canUseNotifications) return;
    getNotificationInbox()
      .then(setItems)
      .catch((error) => console.error(error));
  }, [session, pathname, canUseNotifications]);

  const unread = useMemo(() => items.filter((item) => !item.readAt).length, [items]);

  if (!session || !canUseNotifications) return null;

  async function openItem(item: InboxItem) {
    if (!item.readAt) {
      try {
        await markInboxRead(item.id);
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row
          )
        );
      } catch (error) {
        console.error(error);
      }
    }
    setOpen(false);
    if (item.href) router.push(item.href);
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[10px] font-bold text-highlight-foreground ring-2 ring-card">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "z-[60] overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl shadow-primary/10",
            // Mobile: pin to the viewport so the panel never clips off-screen
            "fixed inset-x-3 top-[calc(3.5rem+0.25rem)] w-auto max-w-none",
            // Desktop: keep the existing bell-anchored dropdown
            "sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(22rem,calc(100vw-1.5rem))]"
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-surface-muted/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <p className="text-[11px] text-muted-foreground">
                {unread > 0 ? `${unread} unread` : "All caught up"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto overflow-x-hidden">
            {items.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "block w-full border-b border-border/60 px-3.5 py-3 text-left transition-colors hover:bg-primary/[0.04]",
                    item.readAt ? "opacity-70" : "bg-primary/[0.03]"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!item.readAt && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-highlight" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-foreground">{item.title}</p>
                      {item.body && (
                        <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                          {item.body}
                        </p>
                      )}
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
