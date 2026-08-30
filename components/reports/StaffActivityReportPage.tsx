"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import FormDatePicker from "@/components/ui/FormDatePicker";
import FormSelect from "@/components/ui/FormSelect";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getStaffUsers, type AppUserProfile } from "@/components/services/appUser.service";
import {
  formatAgeDays,
  formatDurationSeconds,
  getStaffOperationsIntelligence,
  type StaffOperationsIntelligenceResult,
  type StaffOpsModuleKey,
  type StaffOpsWindow,
} from "@/components/services/staffOperationsIntelligence.service";
import { materialColor } from "@/components/consigneeIntelligence/MaterialMixDonut";

const MODULE_OPTIONS: Array<{ label: string; value: StaffOpsModuleKey }> = [
  { label: "All", value: "all" },
  { label: "LR", value: "lr" },
  { label: "POD", value: "pod" },
  { label: "Delivery Challan", value: "dc" },
  { label: "ASN", value: "asn" },
];

const WINDOW_OPTIONS: Array<{ label: string; value: StaffOpsWindow }> = [
  { label: "90 Days", value: "90" },
  { label: "180 Days", value: "180" },
  { label: "365 Days", value: "365" },
  { label: "Custom", value: "custom" },
  { label: "All", value: "all" },
];

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function formatDisplayDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy, hh:mm a");
  } catch {
    return value;
  }
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-4 py-5 text-center shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-heading text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function MonthBars({
  months,
  valueKey,
  label,
}: {
  months: StaffOperationsIntelligenceResult["lr"] extends infer L
    ? L extends { monthly: Array<infer M> }
      ? M[]
      : never
    : never;
  valueKey: "created" | "editEvents" | "firstTimeAccuracyPct";
  label: string;
}) {
  if (!months || months.length === 0) return null;
  const values = months.map((m) => {
    const raw = m[valueKey];
    return typeof raw === "number" ? raw : 0;
  });
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-28 items-end gap-1.5">
        {months.map((month, index) => {
          const raw = month[valueKey];
          const value = typeof raw === "number" ? raw : 0;
          return (
            <div
              key={month.month}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {valueKey === "firstTimeAccuracyPct"
                  ? value
                    ? `${value.toFixed(0)}%`
                    : "—"
                  : value}
              </span>
              <div
                className="w-full max-w-8 rounded-t-sm"
                style={{
                  height: `${Math.max(3, (Math.abs(value) / max) * 80)}px`,
                  background: materialColor(index % 5),
                }}
                title={`${month.month}: ${value}`}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {month.month.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StaffActivityReportPage() {
  const { isAdmin, user } = useAuth();
  const [staffUsers, setStaffUsers] = useState<AppUserProfile[]>([]);
  const [staffUserId, setStaffUserId] = useState("");
  const [windowKey, setWindowKey] = useState<StaffOpsWindow>("90");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [moduleFilter, setModuleFilter] = useState<StaffOpsModuleKey>("lr");

  const [report, setReport] = useState<StaffOperationsIntelligenceResult | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getStaffUsers()
      .then((users) => {
        if (cancelled) return;
        const visible = isAdmin
          ? users
          : users.filter((u) => u.id === user?.id);
        setStaffUsers(visible.length > 0 ? visible : users);
        const preferred =
          (user?.id && visible.find((u) => u.id === user.id)?.id) ||
          visible[0]?.id ||
          users[0]?.id ||
          "";
        setStaffUserId(preferred);
      })
      .catch((error) => {
        console.error(error);
        toast.error("Unable to load staff members.");
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, user?.id]);

  async function handleRun() {
    if (!staffUserId) {
      toast.error("Select a staff member.");
      return;
    }

    try {
      setLoading(true);
      const data = await getStaffOperationsIntelligence({
        staffUserId,
        window: windowKey,
        fromDate: fromDate || null,
        toDate: toDate || null,
        module: moduleFilter,
      });
      setReport(data);
    } catch (error) {
      console.error(error);
      toast.error(
        "Unable to load Staff Operations Intelligence. If this persists, ensure migrations 058–059 are applied."
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const lr = report?.lr ?? null;
  const summary = lr?.summary;
  const drafts = lr?.drafts;

  const fieldBars = useMemo(() => {
    const items = lr?.fieldCorrections ?? [];
    const max = Math.max(...items.map((i) => i.editEvents), 1);
    return items.slice(0, 8).map((item, index) => ({
      ...item,
      width: Math.max(4, (item.editEvents / max) * 100),
      color: materialColor(index),
    }));
  }, [lr?.fieldCorrections]);

  const bucketEntries = useMemo(() => {
    const b = drafts?.draftAgeBuckets ?? {};
    return [
      { label: "< 1 day", value: b.lt1 ?? 0 },
      { label: "1–3 days", value: b.d1_3 ?? 0 },
      { label: "3–7 days", value: b.d3_7 ?? 0 },
      { label: "7–30 days", value: b.d7_30 ?? 0 },
      { label: "30+ days", value: b.d30plus ?? 0 },
    ];
  }, [drafts?.draftAgeBuckets]);

  const hasFieldAudit = (lr?.auditRows ?? []).some((row) => row.fieldLabel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Operations Intelligence"
        buttonText=""
        showAddButton={false}
        subtitle="Productivity, first-time accuracy, draft health, and edit audit — by the person who actually did the work."
      />

      <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-6">
        <FormSelect
          label="Staff Member"
          id="staff-ops-user"
          required
          value={staffUserId}
          onValueChange={setStaffUserId}
          disabled={usersLoading || staffUsers.length === 0}
          placeholder={usersLoading ? "Loading…" : "Select staff"}
          options={staffUsers.map((u) => ({
            label: `${u.displayName} (${u.role})`,
            value: u.id,
          }))}
          className="xl:col-span-2"
        />
        <FormSelect
          label="Period"
          id="staff-ops-window"
          value={windowKey}
          onValueChange={(v) => {
            if (
              v === "90" ||
              v === "180" ||
              v === "365" ||
              v === "custom" ||
              v === "all"
            ) {
              setWindowKey(v);
            }
          }}
          options={WINDOW_OPTIONS}
        />
        <FormSelect
          label="Module"
          id="staff-ops-module"
          value={moduleFilter}
          onValueChange={(v) => {
            if (
              v === "all" ||
              v === "lr" ||
              v === "pod" ||
              v === "dc" ||
              v === "asn"
            ) {
              setModuleFilter(v);
            }
          }}
          options={MODULE_OPTIONS}
        />
        <div className="flex items-end xl:col-span-2">
          <Button
            type="button"
            className="w-full"
            onClick={() => void handleRun()}
            disabled={loading || !staffUserId}
          >
            {loading ? "Loading…" : "Run report"}
          </Button>
        </div>
        {windowKey === "custom" ? (
          <>
            <FormDatePicker
              label="From Date"
              id="staff-ops-from"
              value={fromDate}
              onChange={setFromDate}
            />
            <FormDatePicker
              label="To Date"
              id="staff-ops-to"
              value={toDate}
              onChange={setToDate}
            />
          </>
        ) : null}
      </div>

      {!report && !loading ? (
        <p className="text-sm text-muted-foreground">
          Select staff, period, and module, then run the report.
        </p>
      ) : null}

      {report ? (
        <div className="space-y-8">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {report.staff.displayName}
            </span>
            {" · "}
            {formatDisplayDate(report.window.from)} –{" "}
            {formatDisplayDate(report.window.to)}
            {" · "}
            Module: {report.module.toUpperCase()}
          </div>

          {lr && summary && drafts ? (
            <>
              <section className="space-y-3">
                <h2 className="font-heading text-base font-semibold">
                  LR executive summary
                </h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Kpi label="Created" value={String(summary.createdCount)} />
                  <Kpi
                    label="Edit events"
                    value={String(summary.editEventsByStaff)}
                    hint="By this staff as editor"
                  />
                  <Kpi
                    label="Unique LRs edited"
                    value={String(summary.uniqueLrsEditedByStaff)}
                  />
                  <Kpi
                    label="First-time accuracy"
                    value={
                      summary.firstTimeAccuracyPct == null
                        ? "—"
                        : `${summary.firstTimeAccuracyPct.toFixed(1)}%`
                    }
                    hint="LRs created by staff that never needed correction"
                  />
                  <Kpi
                    label="Avg completion"
                    value={formatDurationSeconds(summary.avgCompletionSeconds)}
                    hint="Created → finalized (not form-open time)"
                  />
                  <Kpi
                    label="Median completion"
                    value={formatDurationSeconds(
                      summary.medianCompletionSeconds
                    )}
                  />
                  <Kpi
                    label="Pending drafts"
                    value={String(drafts.pendingDrafts)}
                    hint={
                      drafts.oldestPendingAgeDays != null
                        ? `Oldest ${formatAgeDays(drafts.oldestPendingAgeDays)}`
                        : undefined
                    }
                  />
                  <Kpi
                    label="Drafts created"
                    value={String(drafts.draftsCreated)}
                    hint={
                      drafts.draftCompletionRatePct == null
                        ? undefined
                        : `${drafts.draftCompletionRatePct.toFixed(1)}% finalized in period`
                    }
                  />
                </div>
                {summary.dashboardQualityScore != null ? (
                  <p className="text-xs text-muted-foreground">
                    Dashboard LR Quality (separate metric, edit-
                    <em>event</em> rate):{" "}
                    <span className="font-medium text-foreground">
                      {summary.dashboardQualityScore.toFixed(1)}%
                    </span>
                    . First-time accuracy uses unique corrected LRs instead.
                  </p>
                ) : null}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Productivity & quality
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Created LRs requiring correction:{" "}
                    {summary.createdLrsRequiringCorrection} · Completion range:{" "}
                    {formatDurationSeconds(summary.fastestSeconds)} –{" "}
                    {formatDurationSeconds(summary.slowestSeconds)}
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <MonthBars
                    months={lr.monthly}
                    valueKey="created"
                    label="LRs created / month"
                  />
                  <MonthBars
                    months={lr.monthly}
                    valueKey="firstTimeAccuracyPct"
                    label="First-time accuracy % / month"
                  />
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Month</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Created
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Edit events
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Unique edited
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Accuracy
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Avg completion
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lr.monthly.map((month) => (
                        <tr key={month.month} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{month.month}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {month.created}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {month.editEvents}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {month.uniqueLrsEdited}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {month.firstTimeAccuracyPct == null
                              ? "—"
                              : `${month.firstTimeAccuracyPct.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {formatDurationSeconds(month.avgCompletionSeconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Most corrected fields
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Field-level counts require migration 058 and edits after it
                    was applied. Events vs unique LRs are shown separately.
                  </p>
                </div>
                {fieldBars.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No field-level corrections in this period yet. Apply
                    migration 058, then new post-final LR edits will populate
                    this section.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {fieldBars.map((item) => {
                      const pctOfCorrected =
                        summary.createdLrsRequiringCorrection > 0
                          ? Math.round(
                              (item.uniqueLrs /
                                summary.createdLrsRequiringCorrection) *
                                100
                            )
                          : null;
                      return (
                        <div key={item.fieldKey} className="space-y-1">
                          <div className="flex justify-between gap-2 text-sm">
                            <span className="font-medium">{item.fieldLabel}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {item.editEvents} events · {item.uniqueLrs} LRs
                              {pctOfCorrected != null
                                ? ` · ${pctOfCorrected}% of corrected LRs`
                                : ""}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted/60">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${item.width}%`,
                                background: item.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Who performed edits
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Editors of LRs created by {report.staff.displayName} —
                    attribution is by actual editor, not creator
                  </p>
                </div>
                {lr.editors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tracked edit events for this staff&apos;s LRs in the
                    period.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[28rem] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Editor</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Edit events
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Unique LRs
                          </th>
                          <th className="px-3 py-2 font-medium">
                            Most common field
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lr.editors.map((editor) => (
                          <tr
                            key={editor.editedBy ?? editor.displayName}
                            className="border-b last:border-0"
                          >
                            <td className="px-3 py-2 font-medium">
                              {editor.displayName}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {editor.editEvents}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {editor.uniqueLrs}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {editor.mostCommonField ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Draft workflow health
                  </h2>
                  {drafts.approximationNote ? (
                    <p className="text-xs text-muted-foreground">
                      {drafts.approximationNote}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard
                    title="Pending drafts"
                    value={drafts.pendingDrafts}
                    icon={Activity}
                  />
                  <StatCard
                    title="Pending in period"
                    value={drafts.pendingDraftsInPeriod}
                  />
                  <StatCard
                    title="Oldest pending"
                    value={formatAgeDays(drafts.oldestPendingAgeDays)}
                    subtitle={formatDisplayDateTime(drafts.oldestPendingDraftAt)}
                  />
                  <StatCard
                    title="Finalization rate"
                    value={
                      drafts.draftCompletionRatePct == null
                        ? "—"
                        : `${drafts.draftCompletionRatePct.toFixed(1)}%`
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {bucketEntries.map((bucket) => (
                    <div
                      key={bucket.label}
                      className="rounded-lg border bg-muted/20 px-3 py-3 text-center"
                    >
                      <p className="text-[11px] text-muted-foreground">
                        {bucket.label}
                      </p>
                      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">
                        {bucket.value}
                      </p>
                    </div>
                  ))}
                </div>
                {drafts.pendingDraftRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[24rem] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Draft / LR</th>
                          <th className="px-3 py-2 font-medium">Created</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Age
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {drafts.pendingDraftRows.map((row) => (
                          <tr
                            key={`${row.lrNumber}-${row.createdAt}`}
                            className="border-b last:border-0"
                          >
                            <td className="px-3 py-2 font-medium">
                              {row.lrNumber || "—"}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {formatDisplayDateTime(row.createdAt)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatAgeDays(row.ageDays)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>

              {lr.insights.length > 0 ? (
                <section className="space-y-3">
                  <h2 className="font-heading text-base font-semibold">
                    Insights
                  </h2>
                  <ul className="space-y-2">
                    {lr.insights.map((insight) => (
                      <li
                        key={insight.id}
                        className="rounded-lg border bg-muted/20 px-3 py-2.5 text-sm leading-relaxed"
                      >
                        {insight.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    LR edit audit
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {hasFieldAudit
                      ? "Field-level old → new values from tracked edits."
                      : "Edit events are listed; field old/new values appear after migration 058 and subsequent edits."}
                  </p>
                </div>
                {lr.auditRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No edit events in this period for this staff.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {lr.auditRows.map((row, index) => (
                      <div
                        key={`${row.eventId}-${row.fieldKey ?? "event"}-${index}`}
                        className="rounded-xl border bg-card p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Edited
                          </span>
                          <span className="font-medium">{row.lrNumber}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDisplayDateTime(row.editedAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Created by{" "}
                          <span className="text-foreground">
                            {row.createdByName}
                          </span>
                          {" · "}
                          Edited by{" "}
                          <span className="text-foreground">
                            {row.editedByName}
                          </span>
                        </p>
                        {row.fieldLabel ? (
                          <div className="mt-3 grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
                            <span className="text-muted-foreground">Field</span>
                            <span className="font-medium">{row.fieldLabel}</span>
                            <span className="text-muted-foreground">Old</span>
                            <span className="break-all tabular-nums">
                              {row.oldValue || "—"}
                            </span>
                            <span className="text-muted-foreground">New</span>
                            <span className="break-all tabular-nums">
                              {row.newValue || "—"}
                            </span>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Content edit recorded (no field snapshot — pre-058
                            event or non-whitelisted-only change).
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              LR-specific intelligence is shown when Module is LR or All. Other
              modules currently show created/edited counts only.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
