import { type ObjectValue, type StageAPeriodKind, type StageASemanticIntent, type StageAV2SemanticIntent, stageAV2SemanticIntentSchema, validateOperationalArguments } from "./whatsappAssistantSchemas.ts";

export type StageACompileResult =
  | { ok: true; args: ObjectValue }
  | { ok: false; reason: "filters" | "year" };
export type StageACompileDiagnostic =
  | "invalid_shape_or_version" | "non_execute_outcome" | "wrong_intent"
  | "missing_count_evidence" | "missing_movement_evidence" | "missing_entity_evidence"
  | "nonnull_clarification_reason" | "entity_occurrence" | "entity_word_count"
  | "entity_semantic_collision" | "entity_coordination" | "count_occurrence"
  | "movement_occurrence" | "count_concept" | "movement_concept" | "period_count"
  | "period_claim_missing" | "period_kind_mismatch" | "period_evidence_mismatch"
  | "unexpected_period" | "coverage" | "left_entity_boundary" | "right_entity_boundary"
  | "operational_args";

const DAY_MS = 86_400_000;
const GLUE = new Set(["for", "to", "in", "of", "the", "ka", "ki", "ke", "k", "liye", "me", "mein", "se", "ko"]);
// These are deliberately narrower than GLUE.  A neutral residual token may be
// harmless away from an entity, but it is not proof that it may be discarded at
// an entity edge.  The compiler only accepts these short relation phrases as a
// structural entity boundary; whitespace is never one.
const ENTITY_BOUNDARIES = new Set(["for", "to", "went to", "ka", "ki", "k", "ke liye", "k liye", "me", "mein", "में"]);
const COUNT = ["how many", "total", "number of", "count", "kitna", "kitni", "kitne", "kitha"];
const MOVEMENT = ["lrs", "lr", "vehicles", "vehicle", "gaadi", "gadi", "gari", "loaded", "load hua", "load hui", "load hue", "lode hua", "lode hui", "lode hue", "laga", "lagi", "lage"];
const CURRENT = ["this month", "ye month", "is month", "iss month", "is mahine", "iss mahine", "ye mahina"];
const PREVIOUS = ["last month", "last mnth", "pichle month", "pichhle month", "pichle mahine", "pichhle mahine", "pichla mahina"];
const TODAY = ["today", "aaj"];
const YESTERDAY = ["yesterday"];
const semanticTerms = [...COUNT, ...MOVEMENT, ...CURRENT, ...PREVIOUS, ...TODAY, ...YESTERDAY];
const LEGACY_QUALIFIERS = new Set(["created", "delivered", "open", "cancelled", "draft", "final", "consignor", "consignee", "party", "material", "pending", "pod", "booking", "branch", "baar", "bane", "this", "mnth", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

function esc(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function boundary(value: string): RegExp { return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${esc(value)}(?![\\p{L}\\p{M}\\p{N}_])`, "giu"); }
function matchesConcept(value: string, terms: string[]): boolean {
  return terms.some(term => boundary(term).test(value));
}
function occurrences(source: string, evidence: string): number[] {
  const found: number[] = [];
  let index = source.indexOf(evidence);
  while (index !== -1) { found.push(index); index = source.indexOf(evidence, index + Math.max(1, evidence.length)); }
  return found;
}
function words(value: string): string[] { return value.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []; }
function day(year: number, month: number, date: number): string | null {
  const text = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  if (year < 1900 || year > 2199 || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) return null;
  return text;
}
function monthRange(year: number, month: number): [string, string] | null {
  const from = day(year, month, 1);
  const to = day(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return from && to ? [from, to] : null;
}
function istDay(now: Date): string { return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10); }
function periodMatches(source: string, entity: [number, number]): { kind: StageAPeriodKind; evidence: string; start: number; end: number }[] {
  const matches: { kind: StageAPeriodKind; evidence: string; start: number; end: number }[] = [];
  const add = (kind: StageAPeriodKind, terms: string[]) => terms.forEach(term => {
    for (const m of source.matchAll(boundary(term))) {
      const start = m.index ?? 0, end = start + m[0].length;
      if (end <= entity[0] || start >= entity[1]) matches.push({ kind, evidence: m[0], start, end });
    }
  });
  add("today", TODAY); add("yesterday", YESTERDAY); add("current_month", CURRENT); add("previous_month", PREVIOUS);
  for (const m of source.matchAll(/(?<![\p{L}\p{M}\p{N}_])(\d{4}-\d{2}-\d{2})(?![\p{L}\p{M}\p{N}_])/gu)) {
    const start = m.index ?? 0, end = start + m[0].length;
    if (end <= entity[0] || start >= entity[1]) matches.push({ kind: "explicit_day", evidence: m[0], start, end });
  }
  return matches;
}
function dateRange(kind: StageAPeriodKind, evidence: string, now: Date): [string, string] | null {
  const today = istDay(now), date = new Date(`${today}T00:00:00.000Z`), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  if (kind === "today") return [today, today];
  if (kind === "yesterday") { const previous = new Date(date.getTime() - DAY_MS).toISOString().slice(0, 10); return [previous, previous]; }
  if (kind === "current_month") return monthRange(year, month);
  if (kind === "previous_month") return monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const valid = /^\d{4}-\d{2}-\d{2}$/u.test(evidence) ? day(Number(evidence.slice(0, 4)), Number(evidence.slice(5, 7)), Number(evidence.slice(8, 10))) : null;
  return valid ? [valid, valid] : null;
}
function isSafeGap(value: string): boolean {
  const tokens = words(value.toLocaleLowerCase("en-US"));
  return tokens.every(token => GLUE.has(token));
}
function isEntityBoundaryGap(value: string): boolean {
  const normalized = words(value.toLocaleLowerCase("en-US")).join(" ");
  return ENTITY_BOUNDARIES.has(normalized);
}
function hasUnprotectedCoordination(value: string): boolean {
  let depth = 0, quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === "(") { depth += 1; continue; }
    if (character === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && character === "&") return true;
  }
  const outsideParentheses = value.replace(/\([^()]*\)/gu, " ");
  return /(?<![\p{L}\p{M}\p{N}_])(?:and|or)(?![\p{L}\p{M}\p{N}_])/iu.test(outsideParentheses);
}
function completeCoverage(source: string, spans: [number, number][]): boolean {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  if (sorted.some((span, i) => span[0] >= span[1] || (i > 0 && span[0] < sorted[i - 1][1]))) return false;
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (!isSafeGap(source.slice(cursor, start))) return false;
    cursor = end;
  }
  return isSafeGap(source.slice(cursor));
}
function denseArgs(entitySearch: string, range: [string, string] | null): ObjectValue {
  return {
    lrDateFrom: range?.[0] ?? null, lrDateTo: range?.[1] ?? null,
    createdAtFrom: null, createdAtTo: null, consignor: null, consignee: null,
    vehicleNumber: null, countOnly: true, limit: 1, offset: 0,
    lrNumber: null, partySearch: null, material: null, bookingBranch: null,
    fromStation: null, toStation: null, entitySearch, originSearch: null,
    destinationSearch: null, originCity: null, destinationCity: null, transporter: null,
    status: null, entryStatus: null, podState: null, minPendingDays: null,
  };
}

/** A deliberately coarse admission check chooses the Stage-A transport without
 * parsing sentence structure. The compiler remains the execution gate. */
export function mayUseStageASemanticIntent(message: string): boolean {
  const source = message.normalize("NFC").toLocaleLowerCase("en-US");
  if (!matchesConcept(source, COUNT) || !matchesConcept(source, MOVEMENT)) return false;
  let remainderSource = source;
  for (const term of semanticTerms) remainderSource = remainderSource.replace(boundary(term), " ");
  const remainder = words(remainderSource).filter(token => !GLUE.has(token));
  return remainder.length >= 2 && remainder.every(token => !LEGACY_QUALIFIERS.has(token) && !/[\p{N}]/u.test(token));
}

/** The semantic model proposes only source text and enums. This compiler owns
 * all executable arguments and rejects any omission or unexplained content. */
export function compileStageASemanticIntent(raw: unknown, message: string, now: Date, onDiagnostic?: (category: StageACompileDiagnostic) => void): StageACompileResult {
  const reject = (category: StageACompileDiagnostic): StageACompileResult => { onDiagnostic?.(category); return { ok: false, reason: "filters" }; };
  const nlu = raw as StageASemanticIntent;
  if (!nlu || typeof nlu !== "object" || nlu.version !== "stage_a_v1") return reject("invalid_shape_or_version");
  if (nlu.outcome !== "execute") return reject("non_execute_outcome");
  if (nlu.intent !== "lr_vehicle_count") return reject("wrong_intent");
  if (!nlu.countEvidence) return reject("missing_count_evidence");
  if (!nlu.movementEvidence) return reject("missing_movement_evidence");
  if (!nlu.entityEvidence) return reject("missing_entity_evidence");
  if (nlu.clarificationReason !== null) return reject("nonnull_clarification_reason");
  const source = message.normalize("NFC").trim();
  const entityHits = occurrences(source, nlu.entityEvidence);
  if (entityHits.length !== 1) return reject("entity_occurrence");
  if (words(nlu.entityEvidence).length < 2) return reject("entity_word_count");
  if (matchesConcept(nlu.entityEvidence, semanticTerms)) return reject("entity_semantic_collision");
  if (hasUnprotectedCoordination(nlu.entityEvidence)) return reject("entity_coordination");
  const entity: [number, number] = [entityHits[0], entityHits[0] + nlu.entityEvidence.length];
  const outside = (evidence: string): [number, number] | null => {
    const hits = occurrences(source, evidence).filter(start => start + evidence.length <= entity[0] || start >= entity[1]);
    return hits.length === 1 ? [hits[0], hits[0] + evidence.length] : null;
  };
  const count = outside(nlu.countEvidence), movement = outside(nlu.movementEvidence);
  if (!count) return reject("count_occurrence");
  if (!movement) return reject("movement_occurrence");
  if (!matchesConcept(nlu.countEvidence, COUNT)) return reject("count_concept");
  if (!matchesConcept(nlu.movementEvidence, MOVEMENT)) return reject("movement_concept");
  const periods = periodMatches(source, entity);
  let range: [string, string] | null = null, periodSpan: [number, number] | null = null;
  if (periods.length > 1) return reject("period_count");
  if (periods.length === 1) {
    const claimed = nlu.period;
    const found = periods[0];
    if (!claimed) return reject("period_claim_missing");
    if (claimed.kind !== found.kind) return reject("period_kind_mismatch");
    if (claimed.evidence !== found.evidence) return reject("period_evidence_mismatch");
    range = dateRange(found.kind, found.evidence, now);
    if (!range) return { ok: false, reason: "year" };
    periodSpan = [found.start, found.end];
  } else if (nlu.period !== null) return reject("unexpected_period");
  const spans: [number, number][] = [entity, count, movement];
  if (periodSpan) spans.push(periodSpan);
  if (!completeCoverage(source, spans)) return reject("coverage");
  const nonEntitySpans = spans.filter(([start, end]) => start !== entity[0] || end !== entity[1]).sort((a, b) => a[0] - b[0]);
  const before = [...nonEntitySpans].reverse().find(([, end]) => end <= entity[0]);
  const after = nonEntitySpans.find(([start]) => start >= entity[1]);
  // Every non-empty edge adjacent to the selected entity needs explicit
  // structural evidence. This prevents the model from stealing semantic/date
  // words from a longer company reference or silently dropping "The"/"of".
  const leftGap = source.slice(before?.[1] ?? 0, entity[0]);
  const rightGap = source.slice(entity[1], after?.[0] ?? source.length);
  if (entity[0] !== 0 && !isEntityBoundaryGap(leftGap)) return reject("left_entity_boundary");
  if (entity[1] !== source.length && !isEntityBoundaryGap(rightGap)) return reject("right_entity_boundary");
  try {
    const args = denseArgs(source.slice(...entity), range);
    validateOperationalArguments("search_lrs", args);
    return { ok: true, args };
  }
  catch { return reject("operational_args"); }
}

export type StageAV2CompileResult =
  | { ok: true; name: "search_lrs" | "get_lr_detail" | "search_pending_pods" | "get_pod_detail"; args: ObjectValue }
  | { ok: false; reason: string };

const V2_FILTERS: [keyof StageAV2SemanticIntent, keyof StageAV2SemanticIntent][] = [
  ["lrNumber", "lrNumberEvidence"], ["partySearch", "partySearchEvidence"], ["consignor", "consignorEvidence"],
  ["consignee", "consigneeEvidence"], ["vehicleNumber", "vehicleNumberEvidence"], ["material", "materialEvidence"],
  ["bookingBranch", "bookingBranchEvidence"], ["fromStation", "fromStationEvidence"], ["toStation", "toStationEvidence"],
  ["transporter", "transporterEvidence"], ["status", "statusEvidence"], ["entryStatus", "entryStatusEvidence"],
  ["podState", "podStateEvidence"], ["minPendingDays", "minPendingDaysEvidence"],
];
const V2_CONSTRAINTS = [
  /\b(?:draft|final)\b/iu, /\b(?:pending|pod|पीओडी)\b/iu, /\b(?:open|delivered|billed|cancelled|cancelled|in\s+transit)\b/iu,
  /\b(?:branch|from|to|se|mein|में|material|consignor|consignee|party|vehicle|transporter)\b/iu,
  /\b\d{1,5}\s*(?:days?|din|दिन)\b/iu,
];
const V2_UNSUPPORTED = /\b(?:finance|freight|rate|rates|cost|payment|ledger|outstanding|salary|sql|delete|update|insert|write|before|after|less|more|over|under|except|excluding|without|only)\b/iu;

function v2EvidenceCount(source: string, evidence: string): number {
  let count = 0, at = source.indexOf(evidence);
  while (at >= 0) { count++; at = source.indexOf(evidence, at + Math.max(1, evidence.length)); }
  return count;
}
function v2ProtectedSource(source: string, proposal: StageAV2SemanticIntent): string | null {
  const spans: [number, number][] = [];
  for (const [key, evidenceKey] of V2_FILTERS) {
    if (!["partySearch", "consignor", "consignee", "material", "bookingBranch", "fromStation", "toStation", "transporter"].includes(String(key))) continue;
    if (proposal[key] === null) continue;
    const evidence = proposal[evidenceKey];
    if (typeof evidence !== "string" || v2EvidenceCount(source, evidence) !== 1) return null;
    const start = source.indexOf(evidence); spans.push([start, start + evidence.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((s, i) => i > 0 && s[0] < spans[i - 1][1])) return null;
  const chars = [...source];
  for (const [start, end] of spans) for (let i = start; i < end; i++) chars[i] = " ";
  return chars.join("");
}
function v2UnlabelledParty(source: string): string | null {
  const forMatch = source.match(/\bfor\s+([\p{L}\p{M}][\p{L}\p{M}\p{N} .&()\/-]*?)(?=\s+(?:today|aaj|yesterday|last\s+month|this\s+month|ke|ka|ki|mein|in|on)\b|[?,.!]|$)/iu);
  if (forMatch?.[1] && !/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/iu.test(forMatch[1].trim())) return forMatch[1].trim();
  const leading = source.match(/^\s*([\p{L}\p{M}][\p{L}\p{M}\p{N} .&()\/-]*?)\s+(?:ke|ka|ki|के|का|की)\b/iu);
  if (leading?.[1] && !/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/iu.test(leading[1].trim())) return leading[1].trim();
  return null;
}
function v2HasUnboundBusinessSpan(source: string, operationEvidence: string, dateEvidence: string | null, hasEntity: boolean): boolean {
  if (hasEntity) return false;
  const start = source.indexOf(operationEvidence) + operationEvidence.length;
  const end = dateEvidence ? source.indexOf(dateEvidence, start) : source.length;
  if (start < operationEvidence.length || end < 0) return false;
  const middle = source.slice(start, end).toLocaleLowerCase("en-US").replace(/[\p{P}\s]+/gu, " ").trim();
  if (!middle) return false;
  const harmless = new Set(["are", "is", "there", "were", "was", "created", "bane", "bana", "hue", "hua", "ke", "ka", "ki", "mein", "me", "in", "for", "the"]);
  return words(middle).some(token => !harmless.has(token));
}
function v2DateValue(date: StageAV2SemanticIntent["lrDate"]): ObjectValue | null {
  if (!date) return null;
  const copy = { ...date } as ObjectValue;
  delete copy.evidence;
  return copy;
}
function v2Has(source: string, expression: RegExp): boolean { return expression.test(source); }
function validateV2Shape(value: unknown, schema: ObjectValue): boolean {
  if (schema.anyOf) return (schema.anyOf as ObjectValue[]).some(branch => validateV2Shape(value, branch));
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  if (!types.includes(actual)) return false;
  if (schema.enum && !(schema.enum as unknown[]).some(v => Object.is(v, value))) return false;
  if (actual === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (actual === "integer" && ((typeof schema.minimum === "number" && value < schema.minimum) || (typeof schema.maximum === "number" && value > schema.maximum))) return false;
  if (actual === "object") {
    const objectValue = value as Record<string, unknown>;
    const properties = schema.properties as ObjectValue;
    if ((schema.required as string[] ?? []).some(key => !Object.hasOwn(objectValue, key))) return false;
    if (schema.additionalProperties === false && Object.keys(objectValue).some(key => !Object.hasOwn(properties, key))) return false;
    for (const [key, child] of Object.entries(properties)) if (!validateV2Shape(objectValue[key], child as ObjectValue)) return false;
  }
  return true;
}
function v2OperationCompatible(operation: string, source: string, evidence: string): boolean {
  const hasCount = /(?:\b(?:how\s+many|count|total|number\s+of|kitne|kitni|kitna)\b|कितने|कितनी|कितना)/iu.test(source);
  const hasList = /\b(?:show|list|display|dikhao|dikhाओ)\b/iu.test(source);
  const hasDetail = /\b(?:detail|details|विवरण)\b/iu.test(source);
  const hasPending = /\b(?:pending\s+pods?|pod\s+pending|लंबित\s+पीओडी)\b/iu.test(source);
  const hasPod = /\b(?:pods?|पीओडी)\b/iu.test(source);
  const hasMovement = /(?:\b(?:lr|lrs|vehicle|vehicles|gaadi|gadi|गाड़ी)\b|\bLR\d+\b)/iu.test(source);
  const evidenceHas = (re: RegExp) => re.test(evidence);
  if (operation === "lr_count") return hasCount && hasMovement && !hasPending && evidenceHas(/(?:\b(?:how\s+many|count|total|number\s+of|kitne|kitni|kitna)\b|कितने|कितनी|कितना)/iu);
  if (operation === "lr_list") return hasList && hasMovement && !hasPending && evidenceHas(/\b(?:show|list|display|dikhao|dikhाओ)\b/iu);
  if (operation === "lr_detail") return hasDetail && hasMovement && !hasPending && evidenceHas(/\b(?:detail|details|विवरण)\b/iu);
  if (operation === "pending_pod_count") return hasCount && hasPending && evidenceHas(/\b(?:how\s+many|count|total|number\s+of|kitne|kitni|kitna)\b/iu);
  if (operation === "pending_pod_list") return hasList && hasPending && evidenceHas(/\b(?:show|list|display|dikhao|dikhाओ)\b/iu);
  if (operation === "pod_detail") return hasDetail && hasPod && evidenceHas(/\b(?:detail|details|विवरण)\b/iu);
  return false;
}

/**
 * Compile the proposal-only Stage-A v2 contract. This intentionally checks
 * high-risk semantic anchors rather than attempting to consume every grammar
 * token. It never performs I/O and never accepts model-selected RPC/identity
 * fields.
 */
export function compileStageAV2SemanticIntent(raw: unknown, message: string, now: Date): StageAV2CompileResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "shape" };
  const p = raw as StageAV2SemanticIntent;
  const expectedKeys = Object.keys(stageAV2SemanticIntentSchema.parameters.properties);
  if (Object.keys(p).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(p, key))) return { ok: false, reason: "shape" };
  if (!validateV2Shape(raw, stageAV2SemanticIntentSchema.parameters)) return { ok: false, reason: "shape" };
  if (p.version !== "stage_a_v2" || !["execute", "clarify", "unsupported"].includes(p.outcome)) return { ok: false, reason: "shape" };
  if (p.outcome !== "execute") return { ok: false, reason: p.clarificationReason ?? "clarification" };
  if (!p.operation || !p.operationEvidence || p.clarificationReason !== null) return { ok: false, reason: "operation" };
  if (!["lr_count", "lr_list", "lr_detail", "pending_pod_count", "pending_pod_list", "pod_detail"].includes(p.operation)) return { ok: false, reason: "unsupported_operation" };
  const source = message.normalize("NFC").trim();
  if (v2EvidenceCount(source, p.operationEvidence) !== 1) return { ok: false, reason: "operation_evidence" };
  if (!v2OperationCompatible(p.operation, source, p.operationEvidence)) return { ok: false, reason: "operation_evidence" };
  if (p.lrDate && p.createdDate) return { ok: false, reason: "ambiguous_date_basis" };
  for (const [valueKey, evidenceKey] of V2_FILTERS) {
    const value = p[valueKey], evidence = p[evidenceKey];
    if (value === null) { if (evidence !== null) return { ok: false, reason: "evidence_without_value" }; continue; }
    if (typeof value !== "string" && typeof value !== "number") return { ok: false, reason: "filter_shape" };
    if (typeof evidence !== "string" || !evidence || v2EvidenceCount(source, evidence) !== 1) return { ok: false, reason: "filter_evidence" };
    if (typeof value === "string" && value !== evidence && value !== evidence.trim()) return { ok: false, reason: "filter_rewrite" };
    if (valueKey === "lrNumber" && !/^LR\d+$/u.test(String(value))) return { ok: false, reason: "lr_number" };
  }
  const anchorSource = v2ProtectedSource(source, p);
  if (anchorSource === null) return { ok: false, reason: "entity_span" };
  if (v2UnlabelledParty(source) && p.partySearch !== v2UnlabelledParty(source)) return { ok: false, reason: "unlabelled_entity" };
  const dateEvidence = p.lrDate?.evidence ?? p.createdDate?.evidence ?? null;
  if (v2HasUnboundBusinessSpan(source, p.operationEvidence, dateEvidence, Boolean(p.partySearch || p.consignor || p.consignee || p.material || p.bookingBranch || p.fromStation || p.toStation || p.transporter || p.vehicleNumber))) return { ok: false, reason: "unlabelled_entity" };
  const independentOperations = (anchorSource.match(/\b(?:how\s+many|count|total|show|list|details?|pending\s+pods?|pod\s+details?)\b/giu) ?? []).length;
  if (independentOperations > 1 && /\b(?:and|aur|और)\b/iu.test(anchorSource)) return { ok: false, reason: "multiple_requests" };
  if (/\b(?:ignore\s+(?:all\s+)?previous\s+instructions?|system\s+message|assistant\s+follow|developer\s+message|do\s+not\s+use\s+the\s+user)\b/iu.test(source)) return { ok: false, reason: "instruction_content" };
  if (V2_UNSUPPORTED.test(anchorSource)) return { ok: false, reason: "unsupported_constraint" };
  const dateAnchor = /(?:\b(?:today|aaj|आज|yesterday|last\s+month|pichle\s+(?:mahine|month)|इस\s+महीने|this\s+month|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b)/iu.test(anchorSource);
  if (dateAnchor && !p.lrDate && !p.createdDate) return { ok: false, reason: "omitted_date" };
  for (const [dateKey, evidenceKey] of [["lrDate", "lrDateEvidence"], ["createdDate", "createdDateEvidence"]] as const) {
    const date = p[dateKey], evidence = p[evidenceKey];
    if (!date) { if (evidence !== null) return { ok: false, reason: "date_evidence" }; continue; }
    if (!evidence || typeof evidence !== "string" || v2EvidenceCount(source, evidence) !== 1 || date.evidence !== evidence) return { ok: false, reason: "date_evidence" };
    if (!["relative", "month", "month_year", "exact"].includes(String(date.kind))) return { ok: false, reason: "date_shape" };
    if (date.kind === "relative" && !["today", "yesterday", "this_month", "last_month", "this_year", "last_year"].includes(String(date.value))) return { ok: false, reason: "date_shape" };
    if ((date.kind === "month" || date.kind === "month_year") && (!Number.isInteger(date.month) || date.month < 1 || date.month > 12)) return { ok: false, reason: "date_shape" };
    if (date.kind === "month_year" && (!Number.isInteger(date.year) || date.year < 2000 || date.year > 2199)) return { ok: false, reason: "date_shape" };
    if (date.kind === "exact" && (!/^\d{4}-\d{2}-\d{2}$/u.test(date.from) || (date.to !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(date.to)))) return { ok: false, reason: "date_shape" };
  }
  const hasCreationLanguage = /\b(?:created|creation|bane|बने|बनाए|बनाए\s+गए|बना)\b/iu.test(anchorSource);
  if (hasCreationLanguage !== Boolean(p.createdDate)) return { ok: false, reason: "date_basis" };
  if (p.entryStatus === null && /\b(?:draft|final)\b/iu.test(anchorSource)) return { ok: false, reason: "entry_status" };
  if (p.podState === null && /\b(?:pending\s+pod|pod\s+pending|लंबित\s+पीओडी)\b/iu.test(anchorSource)) return { ok: false, reason: "pod_state" };
  if (p.minPendingDays !== null && p.podState !== "pending") return { ok: false, reason: "pending_age" };
  if (/\bfrom\b/iu.test(anchorSource) && p.fromStation === null) return { ok: false, reason: "omitted_from_station" };
  if (/\bto\b/iu.test(anchorSource) && p.toStation === null) return { ok: false, reason: "omitted_to_station" };
  if (/\bbranch\b/iu.test(anchorSource) && p.bookingBranch === null) return { ok: false, reason: "omitted_branch" };
  if (/\b(?:material|consignor|consignee|transporter|vehicle)\b/iu.test(anchorSource) && !V2_FILTERS.some(([key]) => ["material", "consignor", "consignee", "transporter", "vehicleNumber"].includes(String(key)) && p[key] !== null)) return { ok: false, reason: "omitted_filter" };
  if (/\b(?:pending\s+pod|pod\s+pending|लंबित\s+पीओडी)\b/iu.test(anchorSource) && p.podState !== "pending") return { ok: false, reason: "omitted_pod_state" };
  if (/\b\d{1,5}\s*(?:days?|din|दिन)\b/iu.test(anchorSource) && p.minPendingDays === null) return { ok: false, reason: "omitted_pending_age" };
  if (/\b(?:draft|final)\b/iu.test(anchorSource) && p.entryStatus === null) return { ok: false, reason: "omitted_entry_status" };
  if (/\b(?:open|delivered|billed|cancelled|canceled|in\s+transit)\b/iu.test(anchorSource) && p.status === null) return { ok: false, reason: "omitted_status" };
  if (V2_CONSTRAINTS.some(re => v2Has(source, re)) && !V2_FILTERS.some(([key]) => p[key] !== null) && !p.lrDate && !p.createdDate) return { ok: false, reason: "omitted_constraint" };

  const date = v2DateValue(p.lrDate), created = v2DateValue(p.createdDate);
  const resolveDate = (d: ObjectValue | null): [string, string] | null => {
    if (!d) return null;
    if (d.kind === "relative" && (d.value === "this_year" || d.value === "last_year")) {
      const istYear = Number(istDay(now).slice(0, 4)) + (d.value === "last_year" ? -1 : 0);
      return [`${istYear}-01-01`, `${istYear}-12-31`];
    }
    if (d.kind === "month_year") return monthRange(d.year, d.month);
    if (d.kind === "month") {
      const year = Number(istDay(now).slice(0, 4));
      return monthRange(d.month <= Number(istDay(now).slice(5, 7)) ? year : year - 1, d.month);
    }
    const kind = d.kind === "relative" ? ({ today: "today", yesterday: "yesterday", this_month: "current_month", last_month: "previous_month" } as Record<string, string>)[String(d.value)] : d.kind as string;
    const range = dateRange(kind as StageAPeriodKind, String((p.lrDate ?? p.createdDate)?.evidence ?? ""), now);
    return range;
  };
  const lrRange = resolveDate(date), createdRange = resolveDate(created);
  if ((p.lrDate && !lrRange) || (p.createdDate && !createdRange)) return { ok: false, reason: "invalid_date" };
  const args: ObjectValue = {
    lrDateFrom: lrRange?.[0] ?? null, lrDateTo: lrRange?.[1] ?? null,
    createdAtFrom: createdRange ? new Date(`${createdRange[0]}T00:00:00+05:30`).toISOString() : null,
    createdAtTo: createdRange ? new Date(Date.parse(`${createdRange[1]}T00:00:00+05:30`) + DAY_MS).toISOString() : null,
    countOnly: ["lr_count", "pending_pod_count"].includes(p.operation), limit: 10, offset: 0,
    lrNumber: p.lrNumber, partySearch: p.partySearch, consignor: p.consignor, consignee: p.consignee,
    vehicleNumber: p.vehicleNumber, material: p.material, bookingBranch: p.bookingBranch,
    fromStation: p.fromStation, toStation: p.toStation, transporter: p.transporter,
    entitySearch: null, originSearch: null, destinationSearch: null, originCity: null, destinationCity: null,
    status: p.status, entryStatus: p.entryStatus, podState: p.podState,
    minPendingDays: p.minPendingDays,
  };
  const name = p.operation === "lr_detail" ? "get_lr_detail" : p.operation === "pod_detail" ? "get_pod_detail" : p.operation.startsWith("pending_pod_") ? "search_pending_pods" : "search_lrs";
  if (["get_lr_detail", "get_pod_detail"].includes(name) && V2_FILTERS.some(([key]) => !["lrNumber"].includes(String(key)) && p[key] !== null)) return { ok: false, reason: "detail_filter" };
  if (["lr_detail", "pod_detail"].includes(p.operation) && !p.lrNumber) return { ok: false, reason: "missing_lr_number" };
  if (p.operation.startsWith("pending_pod_") && p.podState !== "pending") return { ok: false, reason: "pending_state" };
  if (name === "search_pending_pods" && args.minPendingDays === null) args.minPendingDays = 0;
  try { validateOperationalArguments(name, args); } catch { return { ok: false, reason: "operational_args" }; }
  return { ok: true, name: name as StageAV2CompileResult["name"], args };
}
