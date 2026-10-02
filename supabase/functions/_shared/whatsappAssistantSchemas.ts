// Model-facing contracts contain no identity, SQL, RPC selector, or credentials.
export type ObjectValue = Record<string, unknown>;
export type ToolName = "search_lrs" | "get_lr_detail" | "search_pending_pods" | "get_pod_detail";
export const MODELS = new Set(["gpt-4o-mini", "gpt-4o-mini-2024-07-18"]);

export type SemanticOp =
  | "lr_detail"
  | "lr_count"
  | "lr_list"
  | "pod_detail"
  | "pending_pod_count"
  | "pending_pod_list";

export type SemanticDate =
  | { kind: "relative"; value: "today" | "yesterday" | "this_month" | "last_month" | "this_year" | "last_year" }
  | { kind: "month"; month: number }
  | { kind: "month_year"; month: number; year: number }
  | { kind: "exact"; from: string; to: string | null };

export type NluInterpretation = {
  operation: SemanticOp | null;
  language: "en" | "hi" | "hinglish";
  lrNumber: string | null;
  date: SemanticDate | null;
  createdDate: SemanticDate | null;
  partySearch: string | null;
  consignor: string | null;
  consignee: string | null;
  vehicleNumber: string | null;
  material: string | null;
  status: "Open" | "In Transit" | "Delivered" | "Billed" | "Cancelled" | null;
  minPendingDays: number | null;
  needsClarification: boolean;
  clarificationCategory: "year" | "filters" | "party_role" | "ambiguous_date" | "unsupported" | "missing_lr" | "missing_year" | null;
  clarificationHint: string | null;
};

const semanticDateSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  anyOf: [
    { type: "object", additionalProperties: false, required: ["kind", "value"], properties: { kind: { type: "string", enum: ["relative"] }, value: { type: "string", enum: ["today", "yesterday", "this_month", "last_month", "this_year", "last_year"] } } },
    { type: "object", additionalProperties: false, required: ["kind", "month"], properties: { kind: { type: "string", enum: ["month"] }, month: { type: "integer", minimum: 1, maximum: 12 } } },
    { type: "object", additionalProperties: false, required: ["kind", "month", "year"], properties: { kind: { type: "string", enum: ["month_year"] }, month: { type: "integer", minimum: 1, maximum: 12 }, year: { type: "integer", minimum: 2000, maximum: 2199 } } },
    { type: "object", additionalProperties: false, required: ["kind", "from", "to"], properties: { kind: { type: "string", enum: ["exact"] }, from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, to: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } }
  ]
} as const;

export const nluIntentSchema = {
  type: "function",
  name: "interpret_whatsapp_intent",
  description: "Interpret the user's WhatsApp message into a structured LR/POD intent. Return needsClarification=true if ANY ambiguity.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["operation", "language", "lrNumber", "date", "createdDate", "partySearch", "consignor", "consignee", "vehicleNumber", "material", "status", "minPendingDays", "needsClarification", "clarificationCategory", "clarificationHint"],
    properties: {
      operation: { type: ["string", "null"], enum: ["lr_detail", "lr_count", "lr_list", "pod_detail", "pending_pod_count", "pending_pod_list"] },
      language: { type: "string", enum: ["en", "hi", "hinglish"] },
      lrNumber: { type: ["string", "null"], minLength: 3, maxLength: 80, pattern: "^LR\\d+$" },
      date: semanticDateSchema,
      createdDate: semanticDateSchema,
      partySearch: { type: ["string", "null"], maxLength: 200 },
      consignor: { type: ["string", "null"], maxLength: 200 },
      consignee: { type: ["string", "null"], maxLength: 200 },
      vehicleNumber: { type: ["string", "null"], maxLength: 80 },
      material: { type: ["string", "null"], maxLength: 200 },
      status: { type: ["string", "null"], enum: [null, "Open", "In Transit", "Delivered", "Billed", "Cancelled"] },
      minPendingDays: { type: ["integer", "null"], minimum: 0, maximum: 36500 },
      needsClarification: { type: "boolean" },
      clarificationCategory: { type: ["string", "null"], enum: ["year", "filters", "party_role", "ambiguous_date", "unsupported", "missing_lr", "missing_year"] },
      clarificationHint: { type: ["string", "null"], maxLength: 120 }
    }
  }
} as const;
const text = (maxLength: number) => ({ type: ["string", "null"], minLength: 1, maxLength });
const date = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const timestamp = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$" };
const common = {
  lrDateFrom: date, lrDateTo: date, createdAtFrom: timestamp, createdAtTo: timestamp,
  consignor: text(200), consignee: text(200), vehicleNumber: text(80),
  countOnly: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 20 },
  offset: { type: "integer", minimum: 0, maximum: 1_000_000 },
};
const exact = { lrNumber: { type: "string", minLength: 1, maxLength: 80 } };
const define = (name: ToolName, description: string, properties: ObjectValue) => ({
  type: "function", name, description, strict: true,
  parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
export const toolDefinitions = [
  define("search_lrs", "Count/list final LRs by LR date (inclusive). Creation time only if explicitly requested (exclusive end). Cancelled excluded unless requested. partySearch matches either party by substring; consignor/consignee/vehicle/lrNumber are exact. One page only.", {
    ...common, lrNumber: text(80), partySearch: text(200), material: text(200),
    status: { type: ["string", "null"], enum: [null, "Open", "In Transit", "Delivered", "Billed", "Cancelled"] },
  }),
  define("get_lr_detail", "Operational details for one exact LR number, including POD presence.", exact),
  define("search_pending_pods", "Final non-cancelled LRs without a POD. Inclusive minimum pending days uses existing IST age from creation time. Normal date filters use LR date. Party and vehicle filters are exact; no either-party substring filter. One page only.", {
    ...common, minPendingDays: { type: "integer", minimum: 0, maximum: 36500 },
  }),
  define("get_pod_detail", "POD presence and operational details for one exact LR; no document URLs.", exact),
];
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  return value as ObjectValue;
}
export function validateArguments(name: string, value: unknown): ObjectValue {
  const definition = toolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error("unknown_tool");
  const args = object(value);
  const props = definition.parameters.properties;
  if (Object.keys(args).length !== Object.keys(props).length || Object.keys(args).some((key) => !Object.hasOwn(props, key))) throw new Error("invalid_keys");
  const result: ObjectValue = {};
  for (const [key, rawSchema] of Object.entries(props)) {
    const schema = rawSchema as { type: string | string[]; enum?: unknown[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; pattern?: string };
    const v = args[key];
    if (v === null && Array.isArray(schema.type) && schema.type.includes("null")) continue;
    if (schema.enum && !schema.enum.includes(v)) throw new Error("invalid_enum");
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (type === "string") {
      if (typeof v !== "string" || !v.trim() || v.length > (schema.maxLength ?? 64) || (schema.pattern && !new RegExp(schema.pattern).test(v))) throw new Error("invalid_text");
      if (key.startsWith("lrDate") && (Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error("invalid_date");
      if (key.startsWith("createdAt") && (Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19))) throw new Error("invalid_timestamp");
      result[key] = v.trim();
    } else if (type === "integer") {
      if (!Number.isSafeInteger(v) || (v as number) < schema.minimum! || (v as number) > schema.maximum!) throw new Error("invalid_integer");
      result[key] = v;
    } else if (typeof v !== "boolean") throw new Error("invalid_boolean");
    else result[key] = v;
  }
  if (result.lrDateFrom && result.lrDateTo && String(result.lrDateFrom) > String(result.lrDateTo)) throw new Error("invalid_range");
  if (result.createdAtFrom && result.createdAtTo && Date.parse(String(result.createdAtFrom)) >= Date.parse(String(result.createdAtTo))) throw new Error("invalid_range");
  return result;
}

// Description fields can be shortened; identifiers must remain exact. No ERP
// value is ever used as an instruction, selector or subsequent model input.
export function displayText(value: string, maximum = 120): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[*_`~|\[\]<>]/g, (c) => ({ "*": "∗", "_": "＿", "`": "ˋ", "~": "〜", "|": "｜", "[": "［", "]": "］", "<": "＜", ">": "＞" })[c]!);
  const points = Array.from(clean);
  return points.length > maximum ? `${points.slice(0, maximum).join("")}…` : clean;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || !/^[\p{L}\p{M}\p{N} /().-]+$/u.test(value)) throw new Error("invalid_identifier");
  return value; // Do not trim, normalize, escape or truncate exact identifiers.
}
function calendar(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("invalid_calendar");
  return value;
}
function row(value: unknown): ObjectValue {
  const source = object(value);
  const clean: ObjectValue = { lr_number: identifier(source.lr_number) };
  if (source.vehicle_number !== undefined && source.vehicle_number !== null) clean.vehicle_number = identifier(source.vehicle_number);
  if (source.lr_date !== undefined) clean.lr_date = calendar(source.lr_date);
  for (const key of ["consignor", "consignee", "from_station", "to_station", "material"]) {
    const v = source[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") throw new Error("invalid_description");
    clean[key] = displayText(v);
  }
  if (source.status !== undefined && source.status !== null) {
    if (!["Open", "In Transit", "Delivered", "Billed", "Cancelled"].includes(String(source.status)) || typeof source.status !== "string") throw new Error("invalid_status");
    clean.status = source.status;
  }
  if (source.pod_present !== undefined) {
    if (typeof source.pod_present !== "boolean") throw new Error("invalid_pod");
    clean.pod_present = source.pod_present;
  }
  if (source.pending_days !== undefined) {
    if (!Number.isSafeInteger(source.pending_days) || Number(source.pending_days) < 0) throw new Error("invalid_age");
    clean.pending_days = source.pending_days;
  }
  return clean;
}
export function sanitizeResult(name: ToolName, value: unknown, args: ObjectValue): ObjectValue {
  const source = object(value);
  if (name.startsWith("search_")) {
    const p = object(source.pagination);
    if (!Number.isSafeInteger(source.total_count) || Number(source.total_count) < 0 || !Array.isArray(source.rows)) throw new Error("invalid_list");
    const count = Number(source.total_count), limit = Number(args.limit), offset = Number(args.offset);
    const expectedRows = args.countOnly ? 0 : Math.min(limit, Math.max(0, count - offset));
    if (source.rows.length !== expectedRows || source.rows.length > 20 || p.count_only !== args.countOnly || p.limit !== limit || p.offset !== offset || p.returned_count !== source.rows.length || p.has_more !== (count > offset + limit)) throw new Error("invalid_pagination");
    const rows = source.rows.map(row);
    if (new Set(rows.map((r) => r.lr_number)).size !== rows.length) throw new Error("duplicate_rows");
    if (name === "search_pending_pods" && rows.some((r) => r.pod_present !== false || !Number.isSafeInteger(r.pending_days) || Number(r.pending_days) < Number(args.minPendingDays))) throw new Error("invalid_pending_pod");
    return { total_count: count, rows, has_more: p.has_more };
  }
  if (typeof source.found !== "boolean") throw new Error("invalid_found");
  if (!source.found) return { found: false };
  const lr = row(source.lr);
  if (String(lr.lr_number).trim().toUpperCase() !== String(args.lrNumber).toUpperCase()) throw new Error("wrong_lr");
  if (name === "get_lr_detail") {
    if (typeof lr.pod_present !== "boolean") throw new Error("invalid_pod");
    return { found: true, lr };
  }
  if (typeof source.pod_present !== "boolean" || (source.pod_present ? !source.pod : source.pod !== null)) throw new Error("invalid_pod");
  const pod: ObjectValue = {};
  if (source.pod_present) {
    const raw = object(source.pod);
    pod.pod_date = calendar(raw.pod_date);
    pod.unloading_date = calendar(raw.unloading_date);
    if (typeof raw.proof_present !== "boolean") throw new Error("invalid_proof");
    pod.proof_present = raw.proof_present;
  }
  return { found: true, lr, pod_present: source.pod_present, pod: source.pod_present ? pod : null };
}
