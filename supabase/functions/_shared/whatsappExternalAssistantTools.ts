// External-only M101 boundary. No mapping/master reads, SQL, or internal RPCs.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { WhatsappAssistantTools } from "./whatsappAssistantTools.ts";
import type { QueryPlan } from "./whatsappAssistantIntent.ts";
import { object, sanitizeResult, toolDefinitions, validateArguments, type ObjectValue, type ToolName } from "./whatsappAssistantSchemas.ts";

const EXTERNAL_NAMES: Record<ToolName, string> = {
  search_lrs: "external_search_lrs", get_lr_detail: "external_get_lr_detail",
  search_pending_pods: "external_search_pending_pods", get_pod_detail: "external_get_pod_detail",
};
const RPC_NAMES: Record<ToolName, string> = {
  search_lrs: "whatsapp_external_search_lrs", get_lr_detail: "whatsapp_external_get_lr_detail",
  search_pending_pods: "whatsapp_external_search_pending_pods", get_pod_detail: "whatsapp_external_get_pod_detail",
};
const PARAMS: Record<string, string> = {
  lrDateFrom: "p_lr_date_from", lrDateTo: "p_lr_date_to", createdAtFrom: "p_created_at_from", createdAtTo: "p_created_at_to",
  lrNumber: "p_lr_number", consignor: "p_consignor", consignee: "p_consignee", vehicleNumber: "p_vehicle_number",
  material: "p_material", minPendingDays: "p_min_pending_days", countOnly: "p_count_only", limit: "p_limit", offset: "p_offset",
};
export const externalToolDefinitions = toolDefinitions.map((definition) => {
  const properties = Object.fromEntries(Object.entries(definition.parameters.properties).filter(([key]) => key !== "partySearch" && key !== "status"));
  return {
    ...definition, name: EXTERNAL_NAMES[definition.name],
    description: definition.name === "search_lrs"
      ? "Count/list permitted final, non-cancelled LRs only. Inclusive LR dates; explicit creation timestamps use exclusive end. Exact consignor/consignee/vehicle/LR filters; literal material substring. No status or either-party filter."
      : `External permitted final non-cancelled LRs only. ${definition.description}`,
    parameters: { ...definition.parameters, properties, required: Object.keys(properties) },
  };
});

/** M101 lacks status/either-party filters: clarify, never silently omit them. */
export function externalDefinition(plan: QueryPlan) {
  if (plan.args.partySearch != null || plan.args.status != null) return null;
  return externalToolDefinitions.find((definition) => definition.name === EXTERNAL_NAMES[plan.name]) ?? null;
}

export function validateExternalArguments(name: ToolName, value: unknown): ObjectValue {
  const definition = externalToolDefinitions.find((d) => d.name === EXTERNAL_NAMES[name]);
  if (!definition) throw new Error("invalid_external_tool");
  const args = object(value), keys = Object.keys(definition.parameters.properties);
  if (Object.keys(args).length !== keys.length || Object.keys(args).some((key) => !keys.includes(key))) throw new Error("invalid_external_arguments");
  // Reuse strict calendar/type/range checks without exposing unsupported fields.
  const internal = toolDefinitions.find((d) => d.name === name)!;
  const complete = Object.fromEntries(Object.keys(internal.parameters.properties).map((key) => [key, Object.hasOwn(args, key) ? args[key] : null]));
  return validateArguments(name, complete);
}

/** Event ID is only accepted from durable inbound insertion, never model JSON.
 * Decimal strings preserve PostgreSQL bigint precision; unsafe JS numbers fail.
 */
export function trustedExternalEventId(value: unknown): number | string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n) return value;
  throw new Error("invalid_external_event");
}

export type WhatsappExternalAssistantTools = ReturnType<typeof createWhatsappExternalAssistantTools>;
export function createWhatsappExternalAssistantTools(admin: SupabaseClient, eventId: unknown) {
  const trustedId = trustedExternalEventId(eventId);
  let attempted = false;
  async function invoke(name: ToolName, input: ObjectValue, signal?: AbortSignal): Promise<ObjectValue> {
    signal?.throwIfAborted();
    if (attempted) throw new Error("external_admission_already_attempted");
    const definition = externalToolDefinitions.find((d) => d.name === EXTERNAL_NAMES[name])!;
    const keys = Object.keys(definition.parameters.properties);
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("invalid_external_arguments");
    const args = validateExternalArguments(name, Object.fromEntries(keys.map((key) => [key, input[key] ?? null])));
    const params: ObjectValue = { p_event_id: trustedId };
    for (const [key, value] of Object.entries(args)) params[PARAMS[key]] = value;
    // Reserve locally before awaiting; no retry on error/timeout/consumption denial.
    attempted = true;
    const query = admin.rpc(RPC_NAMES[name], params);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    signal?.throwIfAborted();
    if (error) throw new Error("External operational query unavailable.");
    return object(data);
  }
  return Object.freeze({
    audience: "external" as const,
    searchLrs: (input: Parameters<WhatsappAssistantTools["searchLrs"]>[0], signal?: AbortSignal) => invoke("search_lrs", input, signal),
    getLrDetail: (lrNumber: string, signal?: AbortSignal) => invoke("get_lr_detail", { lrNumber }, signal),
    searchPendingPods: (input: Parameters<WhatsappAssistantTools["searchPendingPods"]>[0], signal?: AbortSignal) => invoke("search_pending_pods", input, signal),
    getPodDetail: (lrNumber: string, signal?: AbortSignal) => invoke("get_pod_detail", { lrNumber }, signal),
  });
}

const LR_FIELDS = ["lr_number", "lr_date", "consignor", "consignee", "vehicle_number", "from_station", "to_station", "material", "pod_present", "pending_days"];
function externalRow(value: unknown): ObjectValue {
  const source = object(value);
  return Object.fromEntries(LR_FIELDS.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]));
}
/** Independent external allowlist excludes even internal status/IDs/contacts.
 * Existing sanitizer supplies pagination/evidence checks and display escaping.
 */
export function sanitizeExternalResult(name: ToolName, value: unknown, args: ObjectValue): ObjectValue {
  const source = object(value);
  const projected = name.startsWith("search_")
    ? { total_count: source.total_count, rows: Array.isArray(source.rows) ? source.rows.map(externalRow) : source.rows, pagination: source.pagination }
    : { found: source.found, ...(source.found === true ? { lr: externalRow(source.lr), pod_present: source.pod_present, pod: source.pod } : {}) };
  const clean = sanitizeResult(name, projected, args);
  if (name === "get_pod_detail" && clean.found && clean.pod_present) {
    const weight = object(source.pod).unloading_weight;
    if (weight !== null && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > Number.MAX_SAFE_INTEGER)) throw new Error("invalid_external_weight");
    object(clean.pod).unloading_weight = weight;
  }
  return clean;
}
