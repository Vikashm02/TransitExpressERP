// Private typed allowlist for future WhatsApp assistant orchestration.
// This module deliberately exports tool methods, never a service-role client
// or a generic RPC/table/query interface to an LLM-facing caller.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { validateOperationalArguments, type ToolName, type ObjectValue } from "./whatsappAssistantSchemas.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const LR_STATUS = new Set(["Open", "In Transit", "Delivered", "Billed", "Cancelled"]);
const LR_ENTRY_STATUS = new Set(["final"]);

type JsonObject = Record<string, unknown>;
type SharedFilters = {
  lrDateFrom?: string;
  lrDateTo?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  consignor?: string;
  consignee?: string;
  vehicleNumber?: string;
  countOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type WhatsappAssistantTools = ReturnType<typeof createWhatsappAssistantTools>;

export function createWhatsappAssistantTools(admin: SupabaseClient, appUserId: string) {
  if (!UUID.test(appUserId)) throw new Error("Invalid resolved WhatsApp ERP identity.");

  return Object.freeze({
    // One fixed INTERNAL RPC includes permission checks, entity resolution and
    // the answer query. No resolver retry, fallback or model-controlled identity.
    operationalQuery: async (name: ToolName, input: ObjectValue, signal?: AbortSignal): Promise<JsonObject> => {
      const args = validateOperationalArguments(name, input);
      return invoke(admin, "whatsapp_internal_operational_query", {
        p_app_user_id: appUserId, p_operation: name, p_filters: args,
      }, signal);
    },
    searchLrs: async (input: SharedFilters & {
      lrNumber?: string;
      partySearch?: string;
      material?: string;
      status?: string;
      entryStatus?: string;
    }, signal?: AbortSignal): Promise<JsonObject> => invoke(admin, "whatsapp_search_lrs", {
      p_app_user_id: appUserId,
      p_lr_date_from: date(input.lrDateFrom),
      p_lr_date_to: date(input.lrDateTo),
      p_created_at_from: timestamp(input.createdAtFrom),
      p_created_at_to: timestamp(input.createdAtTo),
      p_lr_number: text(input.lrNumber, 80),
      p_consignor: text(input.consignor, 200),
      p_consignee: text(input.consignee, 200),
      p_party_search: text(input.partySearch, 200),
      p_vehicle_number: text(input.vehicleNumber, 80),
      p_material: text(input.material, 200),
      p_status: status(input.status),
      p_entry_status: entryStatus(input.entryStatus),
      p_count_only: Boolean(input.countOnly),
      p_limit: limit(input.limit),
      p_offset: offset(input.offset),
    }, signal),

    getLrDetail: async (lrNumber: string, signal?: AbortSignal): Promise<JsonObject> => invoke(admin, "whatsapp_get_lr_detail", {
      p_app_user_id: appUserId,
      p_lr_number: requiredText(lrNumber, 80, "LR number"),
    }, signal),

    searchPendingPods: async (input: SharedFilters & { minPendingDays?: number }, signal?: AbortSignal): Promise<JsonObject> => invoke(admin, "whatsapp_search_pending_pods", {
      p_app_user_id: appUserId,
      p_min_pending_days: boundedInteger(input.minPendingDays, 0, 36500, 0),
      p_lr_date_from: date(input.lrDateFrom),
      p_lr_date_to: date(input.lrDateTo),
      p_created_at_from: timestamp(input.createdAtFrom),
      p_created_at_to: timestamp(input.createdAtTo),
      p_consignor: text(input.consignor, 200),
      p_consignee: text(input.consignee, 200),
      p_vehicle_number: text(input.vehicleNumber, 80),
      p_count_only: Boolean(input.countOnly),
      p_limit: limit(input.limit),
      p_offset: offset(input.offset),
    }, signal),

    getPodDetail: async (lrNumber: string, signal?: AbortSignal): Promise<JsonObject> => invoke(admin, "whatsapp_get_pod_detail", {
      p_app_user_id: appUserId,
      p_lr_number: requiredText(lrNumber, 80, "LR number"),
    }, signal),
  });
}

async function invoke(admin: SupabaseClient, rpc: string, args: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
  // supabase-js 2.49.1 pins postgrest-js 1.19.2, whose RPC builder inherits
  // abortSignal(). It cancels the HTTP fetch, not guaranteed PostgreSQL work.
  // Signal is trusted call metadata, never an RPC argument or model parameter.
  signal?.throwIfAborted();
  const query = admin.rpc(rpc, args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  signal?.throwIfAborted();
  if (error) throw new Error("WhatsApp operational query was not available.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid WhatsApp operational query response.");
  return data as JsonObject;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}
function requiredText(value: unknown, max: number, label: string): string {
  const normalized = text(value, max);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
function date(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value)) throw new Error("Invalid calendar date.");
  return value;
}
function timestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) throw new Error("Invalid timestamp boundary.");
  return value;
}
function status(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !LR_STATUS.has(value)) throw new Error("Invalid LR status.");
  return value;
}

function entryStatus(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !LR_ENTRY_STATUS.has(value)) throw new Error("Invalid LR entry status.");
  return value;
}
function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Invalid numeric tool argument.");
  return Math.min(maximum, Math.max(minimum, value));
}
function limit(value: unknown): number { return boundedInteger(value, 1, 20, 20); }
function offset(value: unknown): number { return boundedInteger(value, 0, 1_000_000, 0); }
