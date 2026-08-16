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
        size="sm"
        className="relative"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border bg-card shadow-lg">
          <div className="border-b px-3 py-2 text-sm font-semibold">Notifications</div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className={`block w-full border-b px-3 py-2 text-left hover:bg-muted/50 ${
                    item.readAt ? "opacity-70" : ""
                  }`}
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.body && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
