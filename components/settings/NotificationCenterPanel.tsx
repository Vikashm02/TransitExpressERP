"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormField from "@/components/ui/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatWeightMt,
  type TransportMonthlySummary,
} from "@/lib/transportMonthlyReport";
import {
  getReportSettings,
  listReportDeliveries,
  previewTransportReportEmail,
  sendTestEmailNotification,
  sendTestInAppNotification,
  sendTestPushNotification,
  sendTransportReportEmail,
  updateReportSettings,
  type ReportDeliveryRow,
  type ReportSettings,
} from "@/components/services/reportNotification.service";
import { normalizeReportEmails } from "@/lib/reportEmailRecipients";

/**
 * Admin-only Notification Center panel: test channels + August Transport report.
 * Mounted inside Settings (creator/admin gate already applied by parent).
 */
export default function NotificationCenterPanel() {
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [emailsDraft, setEmailsDraft] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<TransportMonthlySummary | null>(null);
  const [emailText, setEmailText] = useState("");
  const [deliveries, setDeliveries] = useState<ReportDeliveryRow[]>([]);
  const [testTitle, setTestTitle] = useState("Transjit test notification");
  const [testMessage, setTestMessage] = useState(
    "This is a manual test from Settings → Notification Center.",
  );

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [s, d] = await Promise.all([getReportSettings(), listReportDeliveries(15)]);
      setSettings(s);
      setEmailsDraft(s.reportEmailTo);
      setMonthlyEnabled(s.monthlyTransportEnabled);
      setDeliveries(d);
    } catch (error) {
      console.error(error);
      toast.error(
        "Unable to load report settings. Confirm migrations 071 and 072 are applied.",
      );
    } finally {
      setLoading(false);
    }
  }

  function addEmail() {
    const candidate = newEmail.trim();
    if (!candidate) {
      toast.error("Enter an email address to add.");
      return;
    }
    const next = normalizeReportEmails([...emailsDraft, candidate]);
    if (!next.ok) {
      toast.error(next.error);
      return;
    }
    setEmailsDraft(next.emails);
    setNewEmail("");
  }

  function removeEmail(index: number) {
    setEmailsDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveSettings() {
    try {
      setBusy("settings");
      const next = await updateReportSettings({
        reportEmailTo: emailsDraft,
        monthlyTransportEnabled: monthlyEnabled,
        monthlyDay: settings?.monthlyDay ?? 1,
      });
      setSettings(next);
      setEmailsDraft(next.reportEmailTo);
      setMonthlyEnabled(next.monthlyTransportEnabled);
      toast.success("Report settings saved.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(kind: "in_app" | "push" | "email") {
    try {
      setBusy(kind);
      const payload = { title: testTitle.trim(), message: testMessage.trim() };
      const result =
        kind === "in_app"
          ? await sendTestInAppNotification(payload)
          : kind === "push"
            ? await sendTestPushNotification(payload)
            : await sendTestEmailNotification(payload);

      if (result.ok) {
        toast.success(
          `${kind === "in_app" ? "In-app" : kind === "push" ? "Push" : "Email"} test: ${result.status ?? "ok"}`,
        );
      } else {
        toast.error(result.error || `${kind} test failed (${result.status ?? "failed"})`);
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Test failed.");
    } finally {
      setBusy(null);
    }
  }

  async function generateAugustPreview() {
    try {
      setBusy("preview");
      const result = await previewTransportReportEmail(2026, 8);
      setPreview(result.summary);
      setEmailText(result.emailText);
      toast.success("August 2026 report generated from database.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to generate report.");
    } finally {
      setBusy(null);
    }
  }

  async function sendAugustEmail() {
    try {
      setBusy("send");
      const result = await sendTransportReportEmail(2026, 8);
      if (result.ok && result.status === "sent") {
        toast.success(`August 2026 report emailed to ${result.recipient ?? "recipient"}.`);
      } else if (result.status === "skipped") {
        toast.message("Automated send already recorded for this period (manual retest still available).");
      } else {
        toast.error(result.error || "Report email failed.");
      }
      const d = await listReportDeliveries(15);
      setDeliveries(d);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Report email failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading notification center...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Central test tools and Transport monthly email reporting. Push reuses the existing Web Push
        stack. Email uses Resend (server-side). Keep monthly automation OFF until the August test
        succeeds.
      </p>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Report recipients</h3>
        {emailsDraft.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipients configured yet.</p>
        ) : (
          <ul className="space-y-2">
            {emailsDraft.map((email, index) => (
              <li
                key={`${email}-${index}`}
                className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
              >
                <span className="truncate">{email}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeEmail(index)}
                  disabled={busy === "settings"}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <FormField label="Add email address" htmlFor="report-email-add">
          <div className="flex flex-wrap gap-2">
            <Input
              id="report-email-add"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="ops@example.com"
              className="min-w-[16rem] flex-1"
            />
            <Button type="button" variant="outline" onClick={addEmail}>
              Add
            </Button>
          </div>
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={monthlyEnabled}
            onChange={(e) => setMonthlyEnabled(e.target.checked)}
          />
          Enable monthly automation (previous month, day {settings?.monthlyDay ?? 1})
        </label>
        <Button onClick={() => void saveSettings()} disabled={busy === "settings"}>
          {busy === "settings" ? "Saving..." : "Save report settings"}
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Send test notification</h3>
        <FormField label="Title" htmlFor="test-title">
          <Input
            id="test-title"
            value={testTitle}
            onChange={(e) => setTestTitle(e.target.value)}
          />
        </FormField>
        <FormField label="Message" htmlFor="test-message">
          <Textarea
            id="test-message"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            rows={3}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void runTest("in_app")}
          >
            {busy === "in_app" ? "Sending..." : "Test in-app"}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void runTest("push")}
          >
            {busy === "push" ? "Sending..." : "Test push"}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void runTest("email")}
          >
            {busy === "email" ? "Sending..." : "Test email"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Push requires a registered browser/PWA subscription. Email uses the report recipients above
          and Resend secrets on the Edge Function.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">August 2026 Transport report</h3>
        <p className="text-xs text-muted-foreground">
          Period: lr_date ≥ 2026-08-01 and &lt; 2026-09-01 · final · not Cancelled · Unique Vehicles =
          distinct non-blank vehicle_number.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => void generateAugustPreview()}>
            {busy === "preview" ? "Generating..." : "Generate August 2026 Report"}
          </Button>
          <Button disabled={!!busy} onClick={() => void sendAugustEmail()}>
            {busy === "send" ? "Sending..." : "Send Test Email (August 2026)"}
          </Button>
        </div>

        {preview ? (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">TRANSPORT MONTHLY SUMMARY — {preview.periodLabel}</p>
            <p>Total LRs: {preview.totalLrs}</p>
            <p>Total Loading Weight: {formatWeightMt(preview.totalLoadingWeight)}</p>
            <p>Unique Vehicles: {preview.uniqueVehicles}</p>
            <div className="pt-2">
              <p className="font-medium">Top Consignees</p>
              <ol className="list-decimal space-y-1 pl-5">
                {preview.topConsignees.map((row) => (
                  <li key={row.consignee}>
                    {row.consignee} — {formatWeightMt(row.loadingWeight)} ({row.lrCount} LR
                    {row.lrCount === 1 ? "" : "s"})
                  </li>
                ))}
              </ol>
            </div>
            {emailText ? (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                {emailText}
              </pre>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Recent report deliveries</h3>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {deliveries.map((row) => (
              <li key={row.id} className="rounded border p-2">
                <p className="font-medium">
                  {row.periodKey} · {row.channel} · {row.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.recipient || "(no recipient)"} · requested {row.requestedAt}
                  {row.sentAt ? ` · sent ${row.sentAt}` : ""}
                </p>
                {row.errorMessage ? (
                  <p className="text-xs text-destructive">{row.errorMessage}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
