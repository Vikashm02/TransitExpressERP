import { type ObjectValue, type StageAPeriodKind, type StageASemanticIntent, validateOperationalArguments } from "./whatsappAssistantSchemas.ts";

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
