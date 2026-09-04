/**
 * Privileged Supplier AI budget + usage ledger operations (migration 069).
 * Uses service_role only. Never used for Supplier conversation retrieval.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/server-service-role";
import type {
  SupplierAiBudgetReserveResult,
  SupplierAiProviderId,
} from "./types";

export interface SupplierAiUsageInsertInput {
  billingMonth: string;
  userId: string;
  organizationId: string | null;
  taskType: string;
  provider: SupplierAiProviderId | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  success: boolean;
  errorCode: string | null;
  providerRequestId: string | null;
  latencyMs: number | null;
}

function asReserveResult(raw: unknown): SupplierAiBudgetReserveResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      error_code: "invalid_response",
      message: "Budget reservation returned an unexpected payload.",
    };
  }
  const row = raw as Record<string, unknown>;
  if (row.ok === true && typeof row.reservation_id === "string") {
    return {
      ok: true,
      reservation_id: row.reservation_id,
      billing_month: String(row.billing_month ?? ""),
      reserved_cost_usd: Number(row.reserved_cost_usd ?? 0),
      expires_at: String(row.expires_at ?? ""),
      monthly_budget_usd: Number(row.monthly_budget_usd ?? 0),
      spent_usd: Number(row.spent_usd ?? 0),
      reserved_usd: Number(row.reserved_usd ?? 0),
      warning_ratio: Number(row.warning_ratio ?? 0),
      hard_stop: Boolean(row.hard_stop),
      warning: Boolean(row.warning),
    };
  }
  return {
    ok: false,
    error_code: String(row.error_code ?? "budget_exhausted"),
    message: String(row.message ?? "Budget reservation failed."),
    billing_month:
      row.billing_month != null ? String(row.billing_month) : undefined,
    monthly_budget_usd:
      row.monthly_budget_usd != null
        ? Number(row.monthly_budget_usd)
        : undefined,
    spent_usd: row.spent_usd != null ? Number(row.spent_usd) : undefined,
    reserved_usd:
      row.reserved_usd != null ? Number(row.reserved_usd) : undefined,
    requested_usd:
      row.requested_usd != null ? Number(row.requested_usd) : undefined,
    warning_ratio:
      row.warning_ratio != null ? Number(row.warning_ratio) : undefined,
    hard_stop: row.hard_stop != null ? Boolean(row.hard_stop) : undefined,
  };
}

export async function getPrivilegedSupplierAiClient(): Promise<
  | { ok: true; client: SupabaseClient }
  | { ok: false; reason: "misconfigured" }
> {
  return createServiceRoleSupabaseClient();
}

/** Atomic budget hold. Must succeed before any provider call. */
export async function tryReserveSupplierAiBudget(input: {
  client: SupabaseClient;
  userId: string;
  reservedCostUsd: number;
  ttlSeconds?: number;
}): Promise<SupplierAiBudgetReserveResult> {
  const { data, error } = await input.client.rpc(
    "supplier_ai_try_reserve_budget",
    {
      p_user_id: input.userId,
      p_reserved_cost_usd: input.reservedCostUsd,
      p_billing_month: null,
      p_ttl_seconds: input.ttlSeconds ?? 120,
    },
  );

  if (error) {
    return {
      ok: false,
      error_code: "reservation_rpc_failed",
      message: "Budget reservation failed.",
    };
  }

  return asReserveResult(data);
}

export async function consumeSupplierAiReservation(input: {
  client: SupabaseClient;
  reservationId: string;
  usageId: string;
}): Promise<{ ok: true } | { ok: false }> {
  const { data, error } = await input.client.rpc(
    "supplier_ai_consume_reservation",
    {
      p_reservation_id: input.reservationId,
      p_usage_id: input.usageId,
    },
  );
  if (error) return { ok: false };
  if (data && typeof data === "object" && (data as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  // Some deployments may return void/null on success — treat non-error as ok
  // only when explicit ok:false is absent.
  if (data && typeof data === "object" && (data as { ok?: unknown }).ok === false) {
    return { ok: false };
  }
  return error ? { ok: false } : { ok: true };
}

export async function releaseSupplierAiReservation(input: {
  client: SupabaseClient;
  reservationId: string;
}): Promise<{ ok: true } | { ok: false }> {
  const { data, error } = await input.client.rpc(
    "supplier_ai_release_reservation",
    {
      p_reservation_id: input.reservationId,
    },
  );
  if (error) return { ok: false };
  if (data && typeof data === "object" && (data as { ok?: unknown }).ok === false) {
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Far-future expiry used when a paid provider call succeeded but both usage
 * ledger writes failed. Keeps status='reserved' so:
 * - supplier_ai_expire_stale_reservations will not ordinary-expire it
 * - reserved_cost_usd continues to count in hard-budget "held"
 *
 * This is an accounting-recovery pin using existing 069 columns only
 * (no new status / no migration). Not a release and not a consume.
 */
export const SUPPLIER_AI_ACCOUNTING_RECOVERY_EXPIRES_AT =
  "2099-12-31T00:00:00.000Z";

/**
 * Pin a reserved hold after paid provider success when usage writes fail.
 * Must never be used to release budget. Service-role only.
 */
export async function pinSupplierAiReservationForAccountingRecovery(input: {
  client: SupabaseClient;
  reservationId: string;
}): Promise<{ ok: true; expiresAt: string } | { ok: false }> {
  const { data, error } = await input.client
    .from("supplier_ai_budget_reservations")
    .update({
      expires_at: SUPPLIER_AI_ACCOUNTING_RECOVERY_EXPIRES_AT,
    })
    .eq("id", input.reservationId)
    .eq("status", "reserved")
    .select("id, expires_at, status")
    .maybeSingle();

  if (error || !data?.id || data.status !== "reserved") {
    return { ok: false };
  }

  return {
    ok: true,
    expiresAt: String(data.expires_at ?? SUPPLIER_AI_ACCOUNTING_RECOVERY_EXPIRES_AT),
  };
}

/** Append-only usage ledger write. Never stores prompts/completions/keys. */
export async function insertSupplierAiUsage(input: {
  client: SupabaseClient;
  row: SupplierAiUsageInsertInput;
}): Promise<{ ok: true; usageId: string } | { ok: false }> {
  const { data, error } = await input.client
    .from("supplier_ai_usage")
    .insert({
      billing_month: input.row.billingMonth,
      user_id: input.row.userId,
      organization_id: input.row.organizationId,
      task_type: input.row.taskType,
      provider: input.row.provider,
      model: input.row.model,
      input_tokens: input.row.inputTokens,
      output_tokens: input.row.outputTokens,
      estimated_cost_usd: input.row.estimatedCostUsd,
      currency: "USD",
      success: input.row.success,
      error_code: input.row.errorCode,
      provider_request_id: input.row.providerRequestId,
      latency_ms: input.row.latencyMs,
    })
    .select("id")
    .single();

  if (error || !data?.id) return { ok: false };
  return { ok: true, usageId: String(data.id) };
}
