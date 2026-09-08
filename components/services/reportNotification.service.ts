import { supabase } from "@/lib/supabase";
import {
  coerceReportEmailList,
  normalizeReportEmails,
} from "@/lib/reportEmailRecipients";
import {
  buildTransportMonthlyEmailText,
  mapTransportMonthlySummaryRpc,
  transportMonthBounds,
  type TransportMonthlySummary,
} from "@/lib/transportMonthlyReport";

export type ReportSettings = {
  reportEmailTo: string[];
  monthlyTransportEnabled: boolean;
  monthlyDay: number;
  timezone: string;
};

export type ReportDeliveryRow = {
  id: number;
  reportType: string;
  periodKey: string;
  channel: string;
  recipient: string;
  status: string;
  requestedAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  summarySnapshot: Record<string, unknown>;
};

export type NotificationCenterResult = {
  ok: boolean;
  status?: string;
  channel?: string;
  recipient?: string;
  error?: string | null;
  attempted?: number;
  succeeded?: number;
  periodKey?: string;
  periodLabel?: string;
  summary?: Record<string, unknown>;
  reason?: string;
};

function mapReportSettings(row: Record<string, unknown>): ReportSettings {
  return {
    reportEmailTo: coerceReportEmailList(row.report_email_to),
    monthlyTransportEnabled: Boolean(row.monthly_transport_enabled),
    monthlyDay: Number(row.monthly_day ?? 1),
    timezone: String(row.timezone ?? "Asia/Kolkata"),
  };
}

async function invokeNotificationCenter(
  body: Record<string, unknown>,
): Promise<NotificationCenterResult> {
  const { data, error } = await supabase.functions.invoke("notification-center", {
    body,
  });

  if (error) {
    throw new Error(error.message || "Notification center request failed");
  }

  const result = (data ?? {}) as NotificationCenterResult & { error?: string };
  if (result.error && result.ok === false) {
    return result;
  }
  return result;
}

export async function getReportSettings(): Promise<ReportSettings> {
  const { data, error } = await supabase.rpc("get_report_settings");
  if (error) throw error;
  return mapReportSettings((data ?? {}) as Record<string, unknown>);
}

export async function updateReportSettings(
  patch: Partial<
    Pick<ReportSettings, "reportEmailTo" | "monthlyTransportEnabled" | "monthlyDay">
  >,
): Promise<ReportSettings> {
  const emails = patch.reportEmailTo;
  if (emails !== undefined) {
    const normalized = normalizeReportEmails(emails);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    patch = { ...patch, reportEmailTo: normalized.emails };
  }

  const { data, error } = await supabase.rpc("update_report_settings", {
    p_payload: {
      report_email_to: patch.reportEmailTo,
      monthly_transport_enabled: patch.monthlyTransportEnabled,
      monthly_day: patch.monthlyDay,
    },
  });
  if (error) throw error;
  return mapReportSettings((data ?? {}) as Record<string, unknown>);
}

export async function getTransportMonthlySummary(
  year: number,
  month: number,
): Promise<TransportMonthlySummary> {
  const bounds = transportMonthBounds(year, month);
  const { data, error } = await supabase.rpc("get_transport_monthly_summary", {
    p_from: bounds.from,
    p_to_exclusive: bounds.toExclusive,
  });
  if (error) throw error;
  return mapTransportMonthlySummaryRpc((data ?? {}) as Record<string, unknown>);
}

export async function previewTransportReportEmail(
  year: number,
  month: number,
): Promise<{ summary: TransportMonthlySummary; emailText: string; periodLabel: string }> {
  const summary = await getTransportMonthlySummary(year, month);
  return {
    summary,
    emailText: buildTransportMonthlyEmailText(summary),
    periodLabel: summary.periodLabel,
  };
}

export async function sendTransportReportEmail(
  year: number,
  month: number,
): Promise<NotificationCenterResult> {
  return invokeNotificationCenter({
    action: "send_transport_report",
    year,
    month,
  });
}

export async function sendTestInAppNotification(input?: {
  title?: string;
  message?: string;
}): Promise<NotificationCenterResult> {
  return invokeNotificationCenter({
    action: "test_in_app",
    title: input?.title,
    message: input?.message,
  });
}

export async function sendTestPushNotification(input?: {
  title?: string;
  message?: string;
}): Promise<NotificationCenterResult> {
  return invokeNotificationCenter({
    action: "test_push",
    title: input?.title,
    message: input?.message,
  });
}

export async function sendTestEmailNotification(input?: {
  title?: string;
  message?: string;
}): Promise<NotificationCenterResult> {
  return invokeNotificationCenter({
    action: "test_email",
    title: input?.title,
    message: input?.message,
  });
}

export async function listReportDeliveries(limit = 20): Promise<ReportDeliveryRow[]> {
  const { data, error } = await supabase
    .from("report_deliveries")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      reportType: String(r.report_type ?? ""),
      periodKey: String(r.period_key ?? ""),
      channel: String(r.channel ?? ""),
      recipient: String(r.recipient ?? ""),
      status: String(r.status ?? ""),
      requestedAt: String(r.requested_at ?? ""),
      sentAt: r.sent_at ? String(r.sent_at) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      summarySnapshot: (r.summary_snapshot as Record<string, unknown>) ?? {},
    };
  });
}
