"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellPlus, Pencil, X } from "lucide-react";

import FormDialog from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BidRecord } from "@/components/services/bid.service";
import {
  cancelBidReminder,
  createBidReminder,
  formatReminderTime,
  getBidReminders,
  rescheduleBidReminder,
  type BidReminder,
} from "@/components/services/bidReminder.service";

interface BidRemindersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bid: BidRecord | null;
  /** Called after any add/reschedule/cancel so the table refreshes. */
  onChanged: () => void | Promise<void>;
}

/** ISO/timestamptz -> datetime-local value. */
function toDateTimeLocal(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local -> ISO string for storage. */
function fromDateTimeLocal(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function shortcutTime(closesAt: string, minutesBefore: number): string {
  if (!closesAt) return "";
  const d = new Date(new Date(closesAt).getTime() - minutesBefore * 60000);
  if (Number.isNaN(d.getTime())) return "";
  return toDateTimeLocal(d.toISOString());
}

const SHORTCUTS: { label: string; minutes: number }[] = [
  { label: "30m before closing", minutes: 30 },
  { label: "1h before closing", minutes: 60 },
  { label: "2h before closing", minutes: 120 },
  { label: "1d before closing", minutes: 1440 },
];

export default function BidRemindersDialog({ open, onOpenChange, bid, onChanged }: BidRemindersDialogProps) {
  const [reminders, setReminders] = useState<BidReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTime, setNewTime] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");

  useEffect(() => {
    if (open && bid) {
      setNewTime("");
      setEditingId(null);
      setEditTime("");
      void loadReminders(bid.id);
    }
  }, [open, bid]);

  async function loadReminders(bidId: string) {
    try {
      setLoading(true);
      setReminders(await getBidReminders(bidId));
    } catch (error) {
      console.error(error);
      toast.error("Unable to load reminders.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (bid) await loadReminders(bid.id);
    await onChanged();
  }

  function pastClosingWarning(timeLocal: string): string | null {
    if (!bid?.closesAt || !timeLocal) return null;
    const reminderMs = new Date(timeLocal).getTime();
    const closesMs = new Date(bid.closesAt).getTime();
    if (Number.isNaN(reminderMs) || Number.isNaN(closesMs)) return null;
    if (reminderMs <= closesMs) return null;
    return "Warning: this reminder is after the bid closing time. It stays unchanged if closing moves.";
  }

  async function handleAdd() {
    if (!bid) return;
    const iso = fromDateTimeLocal(newTime);
    if (!iso) {
      toast.error("Choose a reminder date and time.");
      return;
    }
    try {
      setSaving(true);
      await createBidReminder(bid.id, iso);
      setNewTime("");
      toast.success("Reminder set.");
      await refresh();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("duplicate") || message.includes("23505")
          ? "An active reminder already exists at that time."
          : "Unable to set reminder."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReschedule(reminder: BidReminder) {
    const iso = fromDateTimeLocal(editTime);
    if (!iso) {
      toast.error("Choose a reminder date and time.");
      return;
    }
    try {
      setSaving(true);
      await rescheduleBidReminder(reminder.id, iso);
      setEditingId(null);
      setEditTime("");
      toast.success("Reminder rescheduled.");
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to reschedule reminder.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(reminder: BidReminder) {
    try {
      setSaving(true);
      const outcome = await cancelBidReminder(reminder.id);
      toast.success(
        outcome === "cancelled"
          ? "Reminder cancelled. History preserved."
          : "Cancellation requested. An in-flight send will be stopped before delivery."
      );
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to cancel reminder.");
    } finally {
      setSaving(false);
    }
  }

  const addWarning = pastClosingWarning(newTime);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Bid Reminders"
      description={
        bid
          ? `${bid.bidReference || "Bid"} · ${bid.billingPartyName} · ${bid.consignorName} → ${bid.consigneeName}`
          : "Manage reminders for this bid."
      }
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      {bid && (
        <p className="mb-4 text-sm text-muted-foreground">
          Bid closes:{" "}
          {bid.closesAt
            ? new Date(bid.closesAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })
            : "not set"}
        </p>
      )}

      <div className="space-y-3">
        <p className="text-sm font-semibold">Existing reminders</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders yet.</p>
        ) : (
          reminders.map((reminder) => (
            <div
              key={reminder.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{formatReminderTime(reminder.remindAt)}</p>
                <p className="text-xs text-muted-foreground">{reminder.status}</p>
                {editingId === reminder.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      type="datetime-local"
                      aria-label="New reminder time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                    />
                    <Button size="sm" disabled={saving} onClick={() => handleReschedule(reminder)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {editingId === reminder.id && pastClosingWarning(editTime) ? (
                  <p className="mt-1 text-xs text-warning">{pastClosingWarning(editTime)}</p>
                ) : null}
              </div>
              {reminder.status === "Scheduled" && editingId !== reminder.id ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Reschedule"
                    disabled={saving}
                    onClick={() => {
                      setEditingId(reminder.id);
                      setEditTime(toDateTimeLocal(reminder.remindAt));
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Cancel reminder"
                    disabled={saving}
                    onClick={() => handleCancel(reminder)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
        <p className="text-sm font-semibold">Add reminder</p>
        {bid?.closesAt ? (
          <div className="flex flex-wrap gap-2">
            {SHORTCUTS.map((shortcut) => (
              <Button
                key={shortcut.label}
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setNewTime(shortcutTime(bid.closesAt, shortcut.minutes))}
              >
                {shortcut.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            aria-label="Reminder date and time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
          <Button size="sm" disabled={saving} onClick={handleAdd}>
            <BellPlus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {addWarning ? <p className="text-xs text-warning">{addWarning}</p> : null}
      </div>
    </FormDialog>
  );
}
