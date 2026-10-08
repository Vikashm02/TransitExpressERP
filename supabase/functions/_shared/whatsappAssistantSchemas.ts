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
  entryStatus: "draft" | "final" | null;
  bookingBranch: string | null;
  fromStation: string | null;
  toStation: string | null;
  entitySearch: string | null;
  originSearch: string | null;
  destinationSearch: string | null;
  transporter: string | null;
  podState: "present" | "pending" | null;
  minPendingDays: number | null;
  needsClarification: boolean;
  clarificationCategory: "year" | "filters" | "party_role" | "ambiguous_date" | "unsupported" | "missing_lr" | "missing_year" | null;
  clarificationHint: string | null;
};

const semanticDateSchema = {
  anyOf: [
    { type: "null" },
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
    required: ["bookingBranch", "fromStation", "toStation", "entitySearch", "originSearch", "destinationSearch", "transporter", "podState", "operation", "language", "lrNumber", "date", "createdDate", "partySearch", "consignor", "consignee", "vehicleNumber", "material", "status", "entryStatus", "minPendingDays", "needsClarification", "clarificationCategory", "clarificationHint"],
    properties: {
      bookingBranch: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      fromStation: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      toStation: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      entitySearch: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      originSearch: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      destinationSearch: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      transporter: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      podState: { type: ["string", "null"], enum: [null, "present", "pending"] },
      operation: { type: ["string", "null"], enum: [null, "lr_detail", "lr_count", "lr_list", "pod_detail", "pending_pod_count", "pending_pod_list"] },
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
      entryStatus: { type: ["string", "null"], enum: [null, "draft", "final"] },
      minPendingDays: { type: ["integer", "null"], minimum: 0, maximum: 36500 },
      needsClarification: { type: "boolean" },
      clarificationCategory: { type: ["string", "null"], enum: [null, "year", "filters", "party_role", "ambiguous_date", "unsupported", "missing_lr", "missing_year"] },
      clarificationHint: { type: ["string", "null"], maxLength: 120 }
    }
  }
} as const;

export type StageAPeriodKind = "today" | "yesterday" | "current_month" | "previous_month" | "explicit_day";
export type StageASemanticIntent = {
  version: "stage_a_v1";
  outcome: "execute" | "clarify" | "unsupported";
  intent: "lr_vehicle_count" | null;
  countEvidence: string | null;
  movementEvidence: string | null;
  entityEvidence: string | null;
  period: { kind: StageAPeriodKind; evidence: string } | null;
  clarificationReason: "insufficient_grounding" | "ambiguous_period" | "multiple_requests" | "unsupported_capability" | null;
};

const stageAEvidence = { type: ["string", "null"], minLength: 1, maxLength: 200 } as const;
export const stageASemanticIntentSchema = {
  type: "function",
  name: "interpret_whatsapp_stage_a",
  description: "Interpret only one source-grounded LR/vehicle movement count request. Copy evidence exactly from the user message. Return clarification or unsupported when uncertain.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["version", "outcome", "intent", "countEvidence", "movementEvidence", "entityEvidence", "period", "clarificationReason"],
    properties: {
      version: { type: "string", enum: ["stage_a_v1"] },
      outcome: { type: "string", enum: ["execute", "clarify", "unsupported"] },
      intent: { type: ["string", "null"], enum: [null, "lr_vehicle_count"] },
      countEvidence: stageAEvidence,
      movementEvidence: stageAEvidence,
      entityEvidence: stageAEvidence,
      period: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: false, required: ["kind", "evidence"], properties: {
            kind: { type: "string", enum: ["today", "yesterday", "current_month", "previous_month", "explicit_day"] },
            evidence: { type: "string", minLength: 1, maxLength: 80 },
          } },
        ],
      },
      clarificationReason: { type: ["string", "null"], enum: [null, "insufficient_grounding", "ambiguous_period", "multiple_requests", "unsupported_capability"] },
    },
  },
} as const;

// Versioned proposal-only contract for the expanded semantic interpreter. It
// deliberately contains source evidence beside every executable semantic
// value; the server compiler remains the only component allowed to build RPC
// arguments. Keep the root a strict object for Responses Structured Outputs.
export type StageAV2Operation = SemanticOp;
export type StageAV2SemanticIntent = {
  version: "stage_a_v2";
  outcome: "execute" | "clarify" | "unsupported";
  operation: SemanticOp | null;
  language: "en" | "hi" | "hinglish";
  lrNumber: string | null; lrNumberEvidence: string | null;
  lrDate: SemanticDate | null; lrDateEvidence: string | null;
  createdDate: SemanticDate | null; createdDateEvidence: string | null;
  partySearch: string | null; partySearchEvidence: string | null;
  consignor: string | null; consignorEvidence: string | null;
  consignee: string | null; consigneeEvidence: string | null;
  vehicleNumber: string | null; vehicleNumberEvidence: string | null;
  material: string | null; materialEvidence: string | null;
  bookingBranch: string | null; bookingBranchEvidence: string | null;
  fromStation: string | null; fromStationEvidence: string | null;
  toStation: string | null; toStationEvidence: string | null;
  transporter: string | null; transporterEvidence: string | null;
  status: "Open" | "In Transit" | "Delivered" | "Billed" | "Cancelled" | null;
  statusEvidence: string | null;
  entryStatus: "draft" | "final" | null; entryStatusEvidence: string | null;
  podState: "present" | "pending" | null; podStateEvidence: string | null;
  minPendingDays: number | null; minPendingDaysEvidence: string | null;
  operationEvidence: string | null;
  clarificationReason: "insufficient_grounding" | "ambiguous_date" | "multiple_requests" | "unsupported_operation" | "unsupported_filter" | "ambiguous_entity" | "missing_lr_number" | null;
};

const stageAV2Evidence = { type: ["string", "null"], minLength: 1, maxLength: 200 } as const;
const stageAV2RequiredEvidence = { type: "string", minLength: 1, maxLength: 200 } as const;
const stageAV2Date = {
  anyOf: [
    { type: "null" },
    { type: "object", additionalProperties: false, required: ["kind", "value", "evidence"], properties: {
      kind: { type: "string", enum: ["relative"] }, value: { type: "string", enum: ["today", "yesterday", "this_month", "last_month", "this_year", "last_year"] }, evidence: stageAV2RequiredEvidence,
    } },
    { type: "object", additionalProperties: false, required: ["kind", "month", "evidence"], properties: {
      kind: { type: "string", enum: ["month"] }, month: { type: "integer", minimum: 1, maximum: 12 }, evidence: stageAV2RequiredEvidence,
    } },
    { type: "object", additionalProperties: false, required: ["kind", "month", "year", "evidence"], properties: {
      kind: { type: "string", enum: ["month_year"] }, month: { type: "integer", minimum: 1, maximum: 12 }, year: { type: "integer", minimum: 2000, maximum: 2199 }, evidence: stageAV2RequiredEvidence,
    } },
    { type: "object", additionalProperties: false, required: ["kind", "from", "to", "evidence"], properties: {
      kind: { type: "string", enum: ["exact"] }, from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, to: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, evidence: stageAV2RequiredEvidence,
    } },
  ],
} as const;
const stageAV2Properties = {
  version: { type: "string", enum: ["stage_a_v2"] }, outcome: { type: "string", enum: ["execute", "clarify", "unsupported"] },
  operation: { type: ["string", "null"], enum: [null, "lr_detail", "lr_count", "lr_list", "pod_detail", "pending_pod_count", "pending_pod_list"] },
  language: { type: "string", enum: ["en", "hi", "hinglish"] },
  lrNumber: { type: ["string", "null"], minLength: 3, maxLength: 80, pattern: "^LR\\d+$" }, lrNumberEvidence: stageAV2Evidence,
  lrDate: stageAV2Date, lrDateEvidence: stageAV2Evidence, createdDate: stageAV2Date, createdDateEvidence: stageAV2Evidence,
  partySearch: { type: ["string", "null"], maxLength: 200 }, partySearchEvidence: stageAV2Evidence, consignor: { type: ["string", "null"], maxLength: 200 }, consignorEvidence: stageAV2Evidence, consignee: { type: ["string", "null"], maxLength: 200 }, consigneeEvidence: stageAV2Evidence,
  vehicleNumber: { type: ["string", "null"], maxLength: 80 }, vehicleNumberEvidence: stageAV2Evidence, material: { type: ["string", "null"], maxLength: 200 }, materialEvidence: stageAV2Evidence,
  bookingBranch: { type: ["string", "null"], maxLength: 200 }, bookingBranchEvidence: stageAV2Evidence, fromStation: { type: ["string", "null"], maxLength: 200 }, fromStationEvidence: stageAV2Evidence, toStation: { type: ["string", "null"], maxLength: 200 }, toStationEvidence: stageAV2Evidence, transporter: { type: ["string", "null"], maxLength: 200 }, transporterEvidence: stageAV2Evidence,
  status: { type: ["string", "null"], enum: [null, "Open", "In Transit", "Delivered", "Billed", "Cancelled"] }, statusEvidence: stageAV2Evidence,
  entryStatus: { type: ["string", "null"], enum: [null, "draft", "final"] }, entryStatusEvidence: stageAV2Evidence,
  podState: { type: ["string", "null"], enum: [null, "present", "pending"] }, podStateEvidence: stageAV2Evidence,
  minPendingDays: { type: ["integer", "null"], minimum: 0, maximum: 36500 }, minPendingDaysEvidence: stageAV2Evidence,
  operationEvidence: stageAV2Evidence,
  clarificationReason: { type: ["string", "null"], enum: [null, "insufficient_grounding", "ambiguous_date", "multiple_requests", "unsupported_operation", "unsupported_filter", "ambiguous_entity", "missing_lr_number"] },
} as const;
export const stageAV2SemanticIntentSchema = {
  type: "function", name: "interpret_whatsapp_stage_a_v2", description: "Propose one source-grounded LR/POD operation; never return executable RPC arguments.", strict: true,
  parameters: { type: "object", additionalProperties: false, required: Object.keys(stageAV2Properties), properties: stageAV2Properties },
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
    entryStatus: { type: ["string", "null"], enum: [null, "final"] },
  }),
  define("get_lr_detail", "Operational details for one exact LR number, including POD presence.", exact),
  define("search_pending_pods", "Final non-cancelled LRs without a POD. Inclusive minimum pending days uses existing IST age from creation time. Normal date filters use LR date. Party and vehicle filters are exact; no either-party substring filter. One page only.", {
    ...common, minPendingDays: { type: "integer", minimum: 0, maximum: 36500 },
  }),
  define("get_pod_detail", "POD presence and operational details for one exact LR; no document URLs.", exact),
];
// Separate internal contract. The legacy definitions above remain the external
// wire contract and cannot gain internal-only filters or draft access.
export const operationalProperties = {
  ...common, lrNumber: text(80), partySearch: text(200), material: text(200),
  bookingBranch: text(200), fromStation: text(200), toStation: text(200),
  entitySearch: text(200), originSearch: text(200), destinationSearch: text(200),
  originCity: text(200), destinationCity: text(200), transporter: text(200),
  status: { type: ["string", "null"], enum: [null, "Open", "In Transit", "Delivered", "Billed", "Cancelled"] },
  entryStatus: { type: ["string", "null"], enum: [null, "draft", "final"] },
  podState: { type: ["string", "null"], enum: [null, "present", "pending"] },
  minPendingDays: { type: ["integer", "null"], minimum: 0, maximum: 36500 },
};
export const internalToolDefinitions = toolDefinitions.map(d => define(d.name,
  "Internal operational LR/POD query. Null entryStatus means final. Only source-validated filters; unresolved entities require unique authorized server resolution.", operationalProperties));
export function validateOperationalArguments(name: string, value: unknown): ObjectValue {
  const args = validateArguments(name, value, true);
  for (const key of ["consignor", "consignee", "partySearch", "material", "bookingBranch", "fromStation", "toStation", "entitySearch", "originSearch", "destinationSearch", "originCity", "destinationCity", "transporter", "vehicleNumber"]) {
    if (typeof args[key] === "string" && /[%_\\\p{Cc}\p{Cf}]/u.test(String(args[key]))) throw new Error("invalid_filter");
  }
  if (args.lrDateFrom && args.createdAtFrom) throw new Error("ambiguous_date_basis");
  if (name.includes("detail") && (!args.lrNumber || args.countOnly || args.offset !== 0)) throw new Error("invalid_detail");
  if (name === "search_pending_pods" && args.podState !== "pending") throw new Error("invalid_pod_state");
  if (args.minPendingDays !== undefined && args.podState !== "pending") throw new Error("invalid_age");
  if (args.podState === "pending" && args.status === "Cancelled") throw new Error("invalid_pending_status");
  return args;
}
export function validateStoredOperationalArguments(name: string, value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_object");
  const stored = value as ObjectValue;
  if (Object.keys(stored).some((key) => !Object.hasOwn(operationalProperties, key))) throw new Error("invalid_keys");
  const dense: ObjectValue = { ...stored };
  for (const [key, rawSchema] of Object.entries(operationalProperties)) {
    const schema = rawSchema as { type: string | string[] };
    if (!Object.hasOwn(dense, key) && Array.isArray(schema.type) && schema.type.includes("null")) dense[key] = null;
  }
  return validateOperationalArguments(name, dense);
}
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  return value as ObjectValue;
}
export function validateArguments(name: string, value: unknown, internal = false): ObjectValue {
  const definition = (internal ? internalToolDefinitions : toolDefinitions).find((tool) => tool.name === name);
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


const RESOLUTION_ROLES = new Set(["consignor", "consignee", "partySearch", "material", "bookingBranch", "fromStation", "toStation", "vehicleNumber", "transporter"]);
const RESOLUTION_FIELDS = new Set(["consignor", "consignee", "partySearch", "material", "bookingBranch", "fromStation", "toStation", "entitySearch", "originSearch", "destinationSearch", "originCity", "destinationCity", "transporter", "vehicleNumber"]);
function operationalWeight(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error("invalid_weight");
  return value;
}
export function sanitizeOperationalResult(name: ToolName, value: unknown, args: ObjectValue): ObjectValue {
  const envelope = object(value);
  if (envelope.status === "clarification") {
    if (!Array.isArray(envelope.issues) || !envelope.issues.length || envelope.issues.length > RESOLUTION_FIELDS.size) throw new Error("invalid_issues");
    const seen = new Set<string>();
    const issues = envelope.issues.map(v => {
      const issue = object(v);
      const field = String(issue.field), role = String(issue.role);
      const expectedRole = field === "originCity" ? "consignor" : field === "destinationCity" ? "consignee" : field;
      if (!RESOLUTION_FIELDS.has(field) || seen.has(field) || role !== expectedRole ||
          typeof issue.reference !== "string" || !issue.reference.trim() || issue.reference.length > 200 ||
          /[%_\\\p{Cc}\p{Cf}]/u.test(issue.reference) || !Array.isArray(issue.options) || issue.options.length > 5) throw new Error("invalid_issue");
      seen.add(field);
      const options = issue.options.map(v => {
        const option = object(v);
        if (!RESOLUTION_ROLES.has(String(option.role)) || typeof option.label !== "string" || !option.label.trim()) throw new Error("invalid_option");
        return { role: option.role, label: option.role === "vehicleNumber" ? identifier(option.label) : displayText(option.label, 120) };
      });
      return { field, reference: displayText(issue.reference, 120), role, options };
    });
    if (envelope.continuation_ready !== undefined && typeof envelope.continuation_ready !== "boolean") throw new Error("invalid_continuation_state");
    return envelope.continuation_ready === true ? { clarification: true, issues, continuation_ready: true } : { clarification: true, issues };
  }
  if (envelope.status !== "ok") throw new Error("invalid_operational_status");
  const source = object(envelope.result);
  const podUnknown = name === "get_lr_detail" && source.found === true && object(source.lr).pod_present === undefined;
  const result = sanitizeResult(name, podUnknown ? { ...source, lr: { ...object(source.lr), pod_present: false } } : source, args);
  if (podUnknown) delete object(result.lr).pod_present; // Never render a fabricated POD absence.
  if (source.total_loading_weight !== undefined) {
    result.total_loading_weight = operationalWeight(source.total_loading_weight);
    if (!Number.isSafeInteger(source.loading_weight_records) || Number(source.loading_weight_records) < 0 || Number(source.loading_weight_records) > Number(source.total_count)) throw new Error("invalid_weight_count");
    result.loading_weight_records = source.loading_weight_records;
  }
  if (result.found && name.includes("detail")) {
    const raw = object(source.lr), lr = object(result.lr);
    if (raw.loading_weight !== undefined) lr.loading_weight = operationalWeight(raw.loading_weight);
    if (raw.booking_branch !== undefined) {
      if (typeof raw.booking_branch !== "string") throw new Error("invalid_branch");
      lr.booking_branch = displayText(raw.booking_branch);
    }
    if (raw.entry_status !== undefined) {
      if (!["draft", "final"].includes(String(raw.entry_status))) throw new Error("invalid_entry_status");
      lr.entry_status = raw.entry_status;
    }
    if (name === "get_pod_detail" && result.pod_present) {
      object(result.pod).unloading_weight = operationalWeight(object(source.pod).unloading_weight);
    }
  }
  return result;
}
