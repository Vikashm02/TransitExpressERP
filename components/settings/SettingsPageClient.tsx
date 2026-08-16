"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Megaphone, BellRing } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import FormField from "@/components/ui/FormField";
import FormSelect from "@/components/ui/FormSelect";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getNotificationRules,
  updateNotificationRule,
  NOTIFICATION_TIMEZONES,
  type NotificationRule,
} from "@/components/services/notification.service";
import {
  ANNOUNCEMENT_LOCATIONS,
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncementsAdmin,
  updateAnnouncement,
  uploadAnnouncementImage,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementLocation,
} from "@/components/services/announcement.service";

type Tab = "notifications" | "announcements";

const emptyAnnouncement: AnnouncementInput = {
  title: "",
  message: "",
  imageUrl: "",
  displayLocation: "home",
  startsAt: new Date().toISOString().slice(0, 10),
  endsAt: "",
  active: true,
};

export default function SettingsPageClient() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("notifications");
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [form, setForm] = useState<AnnouncementInput>(emptyAnnouncement);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAll();
  }, [isAdmin]);

  async function loadAll() {
    try {
      setLoading(true);
      const [ruleRows, announcementRows] = await Promise.all([
        getNotificationRules(),
        getAnnouncementsAdmin(),
      ]);
      setRules(ruleRows);
      setAnnouncements(announcementRows);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load settings. Confirm migrations 028–029 are applied.");
    } finally {
      setLoading(false);
    }
  }

  const groupedRules = useMemo(() => {
    const map = new Map<string, NotificationRule[]>();
    for (const rule of rules) {
      const list = map.get(rule.category) ?? [];
      list.push(rule);
      map.set(rule.category, list);
    }
    return Array.from(map.entries());
  }, [rules]);

  async function toggleRule(rule: NotificationRule, enabled: boolean) {
    try {
      await updateNotificationRule(rule.id, { enabled });
      setRules((prev) => prev.map((row) => (row.id === rule.id ? { ...row, enabled } : row)));
    } catch (error) {
      console.error(error);
      toast.error("Unable to update notification rule.");
    }
  }

  async function changeDelivery(rule: NotificationRule, deliveryMode: "immediate" | "scheduled") {
    try {
      await updateNotificationRule(rule.id, { deliveryMode });
      setRules((prev) =>
        prev.map((row) => (row.id === rule.id ? { ...row, deliveryMode } : row))
      );
    } catch (error) {
      console.error(error);
      toast.error("Unable to update delivery mode.");
    }
  }

  async function changeTime(rule: NotificationRule, scheduledTime: string) {
    try {
      await updateNotificationRule(rule.id, { scheduledTime });
      setRules((prev) =>
        prev.map((row) => (row.id === rule.id ? { ...row, scheduledTime } : row))
      );
    } catch (error) {
      console.error(error);
      toast.error("Unable to update scheduled time.");
    }
  }

  async function patchRule(
    rule: NotificationRule,
    patch: Partial<
      Pick<
        NotificationRule,
        | "quietHoursEnabled"
        | "quietHoursStart"
        | "quietHoursEnd"
        | "timezone"
      >
    >
  ) {
    try {
      await updateNotificationRule(rule.id, patch);
      setRules((prev) => prev.map((row) => (row.id === rule.id ? { ...row, ...patch } : row)));
    } catch (error) {
      console.error(error);
      toast.error("Unable to update quiet hours settings.");
    }
  }

  async function handleSaveAnnouncement() {
    if (!form.title.trim()) {
      toast.error("Title is required.");
      return;
    }
    try {
      setSaving(true);
      const payload: AnnouncementInput = {
        ...form,
        startsAt: form.startsAt
          ? new Date(`${form.startsAt}T00:00:00`).toISOString()
          : new Date().toISOString(),
        endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : "",
      };
      if (editingId) {
        await updateAnnouncement(editingId, payload);
        toast.success("Announcement updated.");
      } else {
        await createAnnouncement(payload);
        toast.success("Announcement created.");
      }
      setForm(emptyAnnouncement);
      setEditingId(null);
      await loadAll();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save announcement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImage(file: File | null) {
    if (!file) return;
    try {
      const url = await uploadAnnouncementImage(file);
      setForm((prev) => ({ ...prev, imageUrl: url }));
      toast.success("Image uploaded.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Image upload failed.");
    }
  }

  if (!isAdmin) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Settings are available to Administrators only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" buttonText="" showAddButton={false} />

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === "notifications" ? "default" : "outline"}
          onClick={() => setTab("notifications")}
          className="min-h-10"
        >
          <BellRing className="mr-2 h-4 w-4" />
          Notification Settings
        </Button>
        <Button
          variant={tab === "announcements" ? "default" : "outline"}
          onClick={() => setTab("announcements")}
          className="min-h-10"
        >
          <Megaphone className="mr-2 h-4 w-4" />
          Announcements
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : tab === "notifications" ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Immediate notifications are delivered immediately outside quiet hours.
            Events occurring during quiet hours are queued and delivered when quiet
            hours end. Scheduled mode still holds until the configured time and groups
            overnight items. Delivery goes to all users with an active push subscription.
          </p>
          {groupedRules.map(([category, categoryRules]) => (
            <section key={category} className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold">{category}</h3>
              <div className="space-y-3">
                {categoryRules.map((rule) => (
                  <div key={rule.id} className="space-y-3 rounded-lg border p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                      <div>
                        <p className="text-sm font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">{rule.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => toggleRule(rule, e.target.checked)}
                        />
                        {rule.enabled ? "ON" : "OFF"}
                      </label>
                      <FormSelect
                        label="Delivery mode"
                        id={`timing-${rule.id}`}
                        value={rule.deliveryMode}
                        onValueChange={(value) =>
                          changeDelivery(rule, value as "immediate" | "scheduled")
                        }
                        options={[
                          {
                            label: "Immediate (outside quiet hours)",
                            value: "immediate",
                          },
                          { label: "Scheduled", value: "scheduled" },
                        ]}
                      />
                      <FormField label="Scheduled time" htmlFor={`time-${rule.id}`}>
                        <Input
                          id={`time-${rule.id}`}
                          type="time"
                          value={rule.scheduledTime}
                          disabled={rule.deliveryMode !== "scheduled"}
                          onChange={(e) => changeTime(rule, e.target.value)}
                        />
                      </FormField>
                    </div>
                    <div className="grid grid-cols-1 gap-3 border-t pt-3 md:grid-cols-[auto_auto_auto_1fr] md:items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={rule.quietHoursEnabled}
                          onChange={(e) =>
                            patchRule(rule, { quietHoursEnabled: e.target.checked })
                          }
                        />
                        Quiet hours {rule.quietHoursEnabled ? "ON" : "OFF"}
                      </label>
                      <FormField label="Quiet hours from" htmlFor={`qh-from-${rule.id}`}>
                        <Input
                          id={`qh-from-${rule.id}`}
                          type="time"
                          value={rule.quietHoursStart}
                          disabled={!rule.quietHoursEnabled}
                          onChange={(e) =>
                            patchRule(rule, { quietHoursStart: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField label="Quiet hours until" htmlFor={`qh-until-${rule.id}`}>
                        <Input
                          id={`qh-until-${rule.id}`}
                          type="time"
                          value={rule.quietHoursEnd}
                          disabled={!rule.quietHoursEnabled}
                          onChange={(e) =>
                            patchRule(rule, { quietHoursEnd: e.target.value })
                          }
                        />
                      </FormField>
                      <FormSelect
                        label="Timezone"
                        id={`tz-${rule.id}`}
                        value={rule.timezone}
                        onValueChange={(value) => patchRule(rule, { timezone: value })}
                        options={NOTIFICATION_TIMEZONES.map((tz) => ({
                          label: tz.label,
                          value: tz.value,
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">
              {editingId ? "Edit announcement" : "Create announcement"}
            </h3>
            <FormField label="Title" htmlFor="ann-title" required>
              <Input
                id="ann-title"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </FormField>
            <FormField label="Message" htmlFor="ann-message">
              <Textarea
                id="ann-message"
                rows={4}
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
              />
            </FormField>
            <FormSelect
              label="Display location"
              id="ann-location"
              value={form.displayLocation}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  displayLocation: value as AnnouncementLocation,
                }))
              }
              options={ANNOUNCEMENT_LOCATIONS.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormDatePicker
                label="Start date"
                id="ann-start"
                value={form.startsAt.slice(0, 10)}
                onChange={(value) => setForm((prev) => ({ ...prev, startsAt: value }))}
              />
              <FormDatePicker
                label="End date"
                id="ann-end"
                value={form.endsAt ? form.endsAt.slice(0, 10) : ""}
                onChange={(value) => setForm((prev) => ({ ...prev, endsAt: value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
              />
              Active
            </label>
            <FormField label="Banner image (optional)" htmlFor="ann-image">
              <Input
                id="ann-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleImage(e.target.files?.[0] ?? null)}
              />
              {form.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="mt-2 max-h-32 rounded-md object-contain" />
              )}
            </FormField>
            <div className="flex gap-2">
              <Button onClick={handleSaveAnnouncement} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
              {editingId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyAnnouncement);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">Existing announcements</h3>
            {announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No announcements yet.</p>
            ) : (
              announcements.map((item) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.displayLocation} · {item.active ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(item.id);
                          setForm({
                            title: item.title,
                            message: item.message,
                            imageUrl: item.imageUrl,
                            displayLocation: item.displayLocation,
                            startsAt: item.startsAt.slice(0, 10),
                            endsAt: item.endsAt ? item.endsAt.slice(0, 10) : "",
                            active: item.active,
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await archiveAnnouncement(item.id);
                            toast.success("Announcement archived.");
                            await loadAll();
                          } catch (error) {
                            console.error(error);
                            toast.error("Unable to archive.");
                          }
                        }}
                      >
                        Archive
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
