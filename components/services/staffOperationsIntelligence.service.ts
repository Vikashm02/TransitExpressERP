import { supabase } from "@/lib/supabase";

export type StaffOpsWindow = "90" | "180" | "365" | "custom" | "all";
export type StaffOpsModuleKey = "all" | "lr" | "pod" | "dc" | "asn";

export interface StaffOpsModuleRow {
  module: string;
  moduleKey: Exclude<StaffOpsModuleKey, "all">;
  createdCount: number;
  editedCount: number;
}

export interface StaffOpsLrSummary {
  createdCount: number;
  editEventsByStaff: number;
  uniqueLrsEditedByStaff: number;
  createdLrsRequiringCorrection: number;
  firstTimeAccuracyPct: number | null;
  dashboardQualityScore: number | null;
  completedCount: number;
  avgCompletionSeconds: number | null;
  medianCompletionSeconds: number | null;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
}

export interface StaffOpsDrafts {
  draftsCreated: number;
  pendingDrafts: number;
  pendingDraftsInPeriod: number;
  oldestPendingDraftAt: string | null;
  oldestPendingAgeDays: number | null;
  draftCompletionRatePct: number | null;
  draftAgeBuckets: Record<string, number>;
  pendingDraftRows: Array<{
    lrNumber: string;
    createdAt: string;
    ageDays: number;
  }>;
  approximationNote: string | null;
}

export interface StaffOpsFieldCorrection {
  fieldKey: string;
  fieldLabel: string;
  editEvents: number;
  uniqueLrs: number;
}

export interface StaffOpsEditor {
  editedBy: string | null;
  displayName: string;
  editEvents: number;
  uniqueLrs: number;
  mostCommonField: string | null;
}

export interface StaffOpsMonth {
  month: string;
  created: number;
  editEvents: number;
  uniqueLrsEdited: number;
  createdRequiringCorrection: number;
  firstTimeAccuracyPct: number | null;
  avgCompletionSeconds: number | null;
  draftsCreated: number;
}

export interface StaffOpsInsight {
  id: string;
  message: string;
}

export interface StaffOpsAuditRow {
  eventId: number;
  lrId: string;
  lrNumber: string;
  createdByName: string;
  editedByName: string;
  editedAt: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface StaffOperationsIntelligenceResult {
  staff: { id: string; displayName: string };
  window: {
    key: string;
    from: string | null;
    to: string | null;
    timezone: string;
  };
  module: StaffOpsModuleKey | string;
  activityModules: StaffOpsModuleRow[];
  lr: {
    summary: StaffOpsLrSummary;
    drafts: StaffOpsDrafts;
    fieldCorrections: StaffOpsFieldCorrection[];
    editors: StaffOpsEditor[];
    monthly: StaffOpsMonth[];
    insights: StaffOpsInsight[];
    auditRows: StaffOpsAuditRow[];
  } | null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${String(r).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

export function formatAgeDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/**
 * Staff Operations Intelligence (migration 059).
 * Field-level audit rows require migration 058 applied + subsequent edits.
 */
export async function getStaffOperationsIntelligence(options: {
  staffUserId: string;
  window?: StaffOpsWindow;
  fromDate?: string | null;
  toDate?: string | null;
  module?: StaffOpsModuleKey;
}): Promise<StaffOperationsIntelligenceResult> {
  const windowKey = options.window ?? "90";
  const moduleKey = options.module ?? "lr";

  const { data, error } = await supabase.rpc("get_staff_operations_intelligence", {
    p_staff: options.staffUserId,
    p_window: windowKey,
    p_from: windowKey === "custom" ? options.fromDate || null : null,
    p_to: windowKey === "custom" ? options.toDate || null : null,
    p_module: moduleKey,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Staff operations intelligence returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const staff = (raw.staff ?? {}) as Record<string, unknown>;
  const win = (raw.window ?? {}) as Record<string, unknown>;
  const modulesRaw = Array.isArray(raw.activity_modules) ? raw.activity_modules : [];
  const lrRaw =
    raw.lr && typeof raw.lr === "object"
      ? (raw.lr as Record<string, unknown>)
      : null;

  const summaryRaw = (lrRaw?.summary ?? {}) as Record<string, unknown>;
  const draftsRaw = (lrRaw?.drafts ?? {}) as Record<string, unknown>;
  const bucketsRaw =
    draftsRaw.draft_age_buckets && typeof draftsRaw.draft_age_buckets === "object"
      ? (draftsRaw.draft_age_buckets as Record<string, unknown>)
      : {};

  return {
    staff: {
      id: asString(staff.id) || options.staffUserId,
      displayName: asString(staff.display_name) || "Staff",
    },
    window: {
      key: asString(win.key) || windowKey,
      from: asNullableString(win.from),
      to: asNullableString(win.to),
      timezone: asString(win.timezone) || "Asia/Kolkata",
    },
    module: asString(raw.module) || moduleKey,
    activityModules: modulesRaw.map((item) => {
      const row = item as Record<string, unknown>;
      const key = asString(row.module) as Exclude<StaffOpsModuleKey, "all">;
      return {
        module: asString(row.label) || key.toUpperCase(),
        moduleKey: key,
        createdCount: asNumber(row.created_count),
        editedCount: asNumber(row.edited_count),
      };
    }),
    lr: lrRaw
      ? {
          summary: {
            createdCount: asNumber(summaryRaw.created_count),
            editEventsByStaff: asNumber(summaryRaw.edit_events_by_staff),
            uniqueLrsEditedByStaff: asNumber(summaryRaw.unique_lrs_edited_by_staff),
            createdLrsRequiringCorrection: asNumber(
              summaryRaw.created_lrs_requiring_correction
            ),
            firstTimeAccuracyPct: asNullableNumber(
              summaryRaw.first_time_accuracy_pct
            ),
            dashboardQualityScore: asNullableNumber(
              summaryRaw.dashboard_quality_score
            ),
            completedCount: asNumber(summaryRaw.completed_count),
            avgCompletionSeconds: asNullableNumber(
              summaryRaw.avg_completion_seconds
            ),
            medianCompletionSeconds: asNullableNumber(
              summaryRaw.median_completion_seconds
            ),
            fastestSeconds: asNullableNumber(summaryRaw.fastest_seconds),
            slowestSeconds: asNullableNumber(summaryRaw.slowest_seconds),
          },
          drafts: {
            draftsCreated: asNumber(draftsRaw.drafts_created),
            pendingDrafts: asNumber(draftsRaw.pending_drafts),
            pendingDraftsInPeriod: asNumber(draftsRaw.pending_drafts_in_period),
            oldestPendingDraftAt: asNullableString(
              draftsRaw.oldest_pending_draft_at
            ),
            oldestPendingAgeDays: asNullableNumber(
              draftsRaw.oldest_pending_age_days
            ),
            draftCompletionRatePct: asNullableNumber(
              draftsRaw.draft_completion_rate_pct
            ),
            draftAgeBuckets: {
              lt1: asNumber(bucketsRaw.under_1_day),
              d1_3: asNumber(bucketsRaw.days_1_3),
              d3_7: asNumber(bucketsRaw.days_3_7),
              d7_30: asNumber(bucketsRaw.days_7_30),
              d30plus: asNumber(bucketsRaw.days_30_plus),
            },
            pendingDraftRows: (
              Array.isArray(draftsRaw.pending_draft_rows)
                ? draftsRaw.pending_draft_rows
                : []
            ).map((item) => {
              const row = item as Record<string, unknown>;
              return {
                lrNumber: asString(row.lr_number),
                createdAt: asString(row.created_at),
                ageDays: asNumber(row.age_days),
              };
            }),
            approximationNote: asNullableString(draftsRaw.approximation_note),
          },
          fieldCorrections: (
            Array.isArray(lrRaw.field_corrections) ? lrRaw.field_corrections : []
          ).map((item) => {
            const row = item as Record<string, unknown>;
            return {
              fieldKey: asString(row.field_key),
              fieldLabel: asString(row.field_label),
              editEvents: asNumber(row.edit_events ?? row.events),
              uniqueLrs: asNumber(row.unique_lrs ?? row.unique_lr_ids),
            };
          }),
          editors: (Array.isArray(lrRaw.editors) ? lrRaw.editors : []).map(
            (item) => {
              const row = item as Record<string, unknown>;
              return {
                editedBy: asNullableString(row.edited_by),
                displayName: asString(row.display_name),
                editEvents: asNumber(row.edit_events ?? row.events),
                uniqueLrs: asNumber(row.unique_lrs),
                mostCommonField: asNullableString(row.most_common_field),
              };
            }
          ),
          monthly: (Array.isArray(lrRaw.monthly) ? lrRaw.monthly : []).map(
            (item) => {
              const row = item as Record<string, unknown>;
              return {
                month: asString(row.month),
                created: asNumber(row.created),
                editEvents: asNumber(row.edit_events),
                uniqueLrsEdited: asNumber(row.unique_lrs_edited),
                createdRequiringCorrection: asNumber(
                  row.created_requiring_correction ??
                    row.created_lrs_requiring_correction
                ),
                firstTimeAccuracyPct: asNullableNumber(
                  row.first_time_accuracy_pct
                ),
                avgCompletionSeconds: asNullableNumber(
                  row.avg_completion_seconds
                ),
                draftsCreated: asNumber(row.drafts_created),
              };
            }
          ),
          insights: (Array.isArray(lrRaw.insights) ? lrRaw.insights : []).map(
            (item, index) => {
              if (typeof item === "string") {
                return { id: `insight_${index + 1}`, message: item };
              }
              const row = item as Record<string, unknown>;
              return {
                id: asString(row.id) || `insight_${index + 1}`,
                message: asString(row.message),
              };
            }
          ),
          auditRows: (
            Array.isArray(lrRaw.audit_rows) ? lrRaw.audit_rows : []
          ).map((item) => {
            const row = item as Record<string, unknown>;
            return {
              eventId: asNumber(row.event_id),
              lrId: asString(row.lr_id),
              lrNumber: asString(row.lr_number),
              createdByName: asString(row.created_by_name),
              editedByName: asString(row.edited_by_name),
              editedAt: asString(row.edited_at),
              fieldKey: asNullableString(row.field_key),
              fieldLabel: asNullableString(row.field_label),
              oldValue: asNullableString(row.old_value),
              newValue: asNullableString(row.new_value),
            };
          }),
        }
      : null,
      };
}
