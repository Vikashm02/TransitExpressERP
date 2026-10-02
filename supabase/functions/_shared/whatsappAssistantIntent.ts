import { toolDefinitions, validateArguments, type ObjectValue, type ToolName, type SemanticOp, type SemanticDate, type NluInterpretation, nluIntentSchema, MODELS, object } from "./whatsappAssistantSchemas.ts";

export type Language = "en" | "hi" | "hinglish";
export type QueryPlan = { kind: "query"; name: ToolName; args: ObjectValue; language: Language };
export type Intent = QueryPlan | { kind: "clarification" | "out_of_scope"; language: Language; reason: "year" | "filters" | "party_role" };
const MONTHS = [
  ["january", "jan", "जनवरी"], ["february", "feb", "फरवरी", "फ़रवरी"],
  ["march", "mar", "मार्च"], ["april", "apr", "अप्रैल"], ["may", "मई"],
  ["june", "jun", "जून"], ["july", "jul", "जुलाई"], ["august", "aug", "अगस्त"],
  ["september", "sept", "sep", "सितंबर", "सितम्बर"], ["october", "oct", "अक्टूबर"],
  ["november", "nov", "नवंबर", "नवम्बर"], ["december", "dec", "दिसंबर", "दिसम्बर"],
];
const monthIndex = new Map(MONTHS.flatMap((names, i) => names.map((name) => [name, i + 1] as const)));
const monthPattern = MONTHS.flat().join("|");
const word = (pattern: string, flags = "giu") => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])`, flags);
const DAY_MS = 86400000;
function day(year: number, month: number, date: number): string {
  if (year < 1900 || year > 2199) throw new Error("date");
  const s = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error("date");
  return s;
}
function monthRange(year: number, month: number): [string, string] {
  return [day(year, month, 1), day(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())];
}
export function detectLanguage(text: string): Language {
  if (/[\u0900-\u097f]/u.test(text)) return "hi";
  return /\b(ka|ke|ki|kitne|kitna|batao|bataye|dikhao|din|hain|hai|mein|se)\b/i.test(text) ? "hinglish" : "en";
}

/** Conservative, fully consumed grammar: unknown qualifiers never disappear.
 * No model-generated field is accepted as provenance. New language forms need
 * deterministic rules and tests here, not a fallback to model-selected filters.
 * Unqualified month names deliberately require a year; no implicit current year.
 */
export function resolveIntent(raw: string, now = new Date()): Intent {
  const language = detectLanguage(raw);
  const clarify = (reason: "year" | "filters" | "party_role" = "filters"): Intent => ({ kind: "clarification", language, reason });
  let source = raw.normalize("NFC").replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966)).trim();
  if (word("finance|freight|invoice|billing|payment|balance|amount|salary|sql|delete|update|insert|write|बिल|भुगतान|पैसा|रकम|मिटाओ").test(source)) return { kind: "out_of_scope", language, reason: "filters" };
  // Negation, comparisons, multiple tasks and unresolved references are not
  // approximated. Only the explicit range/age forms below are supported.
  if (word("no|not|non|except|excluding|without|बिना|before|after|less|more|over|under|older|and|or|aur|ya|nahi|nahin|mat|sirf|only|us|that|those|next|previous|कल|नहीं|मत|सिर्फ|और|या|उस|पहले|बाद").test(source)) return clarify();
  if (/[\p{Cc}\p{Cf}]/u.test(source)) return clarify();
  const hasLr = word("lrs?|एलआर|एल आर|lr[0-9]+").test(source);
  const hasPod = word("pods?|पीओडी|पी ओ डी").test(source);
  if (!hasLr && !hasPod) return { kind: "out_of_scope", language, reason: "filters" };
  const args: ObjectValue = {};
  let countOnly = false, explicitList = false, detail = false, created = false, pending = false;
  let range: [string, string] | undefined;
  // Consumption preserves all non-matching text so an unsupported filter cannot
  // silently broaden a query. Duplicate semantic fields are rejected too.
  const take = (regex: RegExp, consume: (match: RegExpExecArray) => void) => {
    const matches = [...source.matchAll(regex)];
    for (const m of matches) consume(m);
    source = source.replace(regex, (matched) => " ".repeat(matched.length));
  };
  const put = (key: string, value: unknown) => {
    if (Object.hasOwn(args, key)) throw new Error("duplicate_filter");
    args[key] = value;
  };
  const setRange = (value: [string, string]) => {
    if (range || value[0] > value[1]) throw new Error("ambiguous_range");
    range = value;
  };
  try {
    // Explicit role labels support natural single/multi-word names. Delimiters
    // terminate entities; any remaining words must still pass the grammar.
    const entity = `("[^"\\r\\n]+"|'[^'\\r\\n]+'|[\\p{L}\\p{M}][\\p{L}\\p{M}\\p{N} .&-]*?)`;
    const end = `(?=\\s+(?:ke|ka|ki|के|का|की|mein|में|se|से|for|in|on|lrs?|pods?|consignor|consignee|material|party|status|vehicle)(?![\\p{L}\\p{M}\\p{N}_])|$|[,?])`;
    take(new RegExp(`(?<![\\p{L}\\p{M}])(?:consignor|sender|प्रेषक)\\s*[:=]?\\s*${entity}${end}`, "giu"), (m) => put("consignor", cleanEntity(m[1])));
    take(new RegExp(`(?<![\\p{L}\\p{M}])(?:consignee|receiver|प्राप्तकर्ता)\\s*[:=]?\\s*${entity}${end}`, "giu"), (m) => put("consignee", cleanEntity(m[1])));
    take(new RegExp(`(?<![\\p{L}\\p{M}])(?:material|सामग्री)\\s*[:=]?\\s*${entity}${end}`, "giu"), (m) => put("material", cleanEntity(m[1])));
    take(new RegExp(`(?<![\\p{L}\\p{M}])(?:party|पार्टी)\\s*[:=]?\\s*${entity}${end}`, "giu"), (m) => put("partySearch", cleanEntity(m[1])));
    // Unlabelled "for ACC" is a party only when it cannot be a date phrase.
    const forPattern = new RegExp(`(?<![\\p{L}\\p{M}])for\\s+${entity}${end}`, "giu");
    source = source.replace(forPattern, (whole, value: string) => {
      if (word(`${monthPattern}|today|yesterday|this|last|lr\\s*[0-9]+`).test(value)) return whole;
      put("partySearch", cleanEntity(value));
      return " ";
    });
    // A leading "ACC ke ..." is a party, but "August ke ..." is a date.
    const prefix = new RegExp(`^\\s*${entity}\\s+(?:ke|ka|ki|के|का|की)(?=\\s|$)`, "iu");
    source = source.replace(prefix, (whole, value: string) => {
      if (word(`${monthPattern}|open|delivered|cancelled|canceled|billed|transit|lrs?|lr[0-9]+|pods?|vehicle|created|creation|count|show|list|kitne|is|pichhle|इस|पिछले|आज|बीता`).test(value)) return whole;
      put("partySearch", cleanEntity(value));
      return " ";
    });

    take(word("(?:created(?:\\s+(?:at|on|time))?|creation(?:\\s+(?:date|time))?|create\\s+(?:hua|hue)|बनाए गए|बनाया गया|बने हुए)"), () => { if (created) throw new Error("duplicate_basis"); created = true; });
    take(word("(?:how\\s+many|count|number\\s+of|kitne|kitna|कितने|कितनी|संख्या)"), () => { countOnly = true; });
    take(word("(?:show|list|dikhao|दिखाओ|दिखाएं|दिखाएँ|सूची)"), () => { explicitList = true; });
    take(word("(?:details?|detail\\s+batao|विवरण|जानकारी)"), () => { detail = true; });
    if (countOnly && (explicitList || detail)) return clarify();
    if (!countOnly && !detail && word("batao|bataye|बताओ|बताएं|बताएँ").test(source)) explicitList = true;
    take(word("pending|लंबित|पेंडिंग"), () => { if (pending) throw new Error("duplicate_pending"); pending = true; });
    if (pending && !hasPod) return clarify();
    take(word("(\\d{1,5})\\s*(?:days?|din|दिन)(?:\\s*(?:se|से))?"), (m) => {
      if (!pending || !hasPod) throw new Error("unsupported_age");
      put("minPendingDays", Number(m[1]));
    });
    take(word("LR\\s*([0-9]+)"), (m) => put("lrNumber", `LR${m[1]}`));
    take(word("[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}"), (m) => put("vehicleNumber", m[0].toUpperCase()));
    const statuses: Record<string, string> = { open: "Open", "in transit": "In Transit", delivered: "Delivered", billed: "Billed", cancelled: "Cancelled", canceled: "Cancelled", डिलीवर्ड: "Delivered", कैंसिल: "Cancelled" };
    take(word(Object.keys(statuses).join("|")), (m) => put("status", statuses[m[0].toLowerCase()]));

    // Relative dates depend only on the trusted server clock, in IST.
    const istToday = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
    take(word("today|aaj|आज|yesterday|beete kal|बीता कल|this month|is mahine|इस महीने|last month|pichhle mahine|पिछले महीने|this year|is saal|इस साल|last year|pichhle saal|पिछले साल"), (m) => {
      const token = m[0].toLowerCase();
      const today = new Date(istToday);
      const year = today.getUTCFullYear(), month = today.getUTCMonth() + 1;
      if (["today", "aaj", "आज"].includes(token)) setRange([istToday, istToday]);
      else if (["yesterday", "beete kal", "बीता कल"].includes(token)) {
        const previous = new Date(today.getTime() - DAY_MS).toISOString().slice(0, 10); setRange([previous, previous]);
      } else if (["this month", "is mahine", "इस महीने"].includes(token)) setRange(monthRange(year, month));
      else if (["last month", "pichhle mahine", "पिछले महीने"].includes(token)) setRange(monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1));
      else { const y = ["this year", "is saal", "इस साल"].includes(token) ? year : year - 1; setRange([day(y, 1, 1), day(y, 12, 31)]); }
    });
    const dates: { value: string; index: number }[] = [];
    take(word("(\\d{4})-(\\d{2})-(\\d{2})"), (m) => dates.push({ value: day(Number(m[1]), Number(m[2]), Number(m[3])), index: m.index }));
    take(word("(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})"), (m) => dates.push({ value: day(Number(m[3]), Number(m[2]), Number(m[1])), index: m.index }));
    take(word(`(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})`), (m) => dates.push({ value: day(Number(m[3]), monthIndex.get(m[2].toLowerCase())!, Number(m[1])), index: m.index }));
    if (dates.length) {
      if (dates.length > 2 || (dates.length === 2 && !word("to|through|se|से|तक").test(source))) return clarify();
      dates.sort((a, b) => a.index - b.index);
      setRange([dates[0].value, dates[dates.length - 1].value]);
    }
    const months: number[] = [];
    take(word(monthPattern), (m) => months.push(monthIndex.get(m[0].toLowerCase())!));
    const years: number[] = [];
    take(word("(?:19|20|21)[0-9]{2}"), (m) => years.push(Number(m[0])));
    if (months.length) {
      if (!years.length) return clarify("year");
      if (months.length !== 1 || years.length !== 1) return clarify();
      setRange(monthRange(years[0], months[0]));
    } else if (years.length) {
      if (years.length !== 1) return clarify();
      setRange([day(years[0], 1, 1), day(years[0], 12, 31)]);
    }
    if (range && dates.length !== 2 && word("from|to|through|se|से|tak|तक").test(source)) return clarify();
    if (created && !range) return clarify();
    if (range) {
      if (created) {
        // Calendar end is inclusive in user text; RPC end is exclusive.
        args.createdAtFrom = new Date(`${range[0]}T00:00:00+05:30`).toISOString();
        args.createdAtTo = new Date(Date.parse(`${range[1]}T00:00:00+05:30`) + DAY_MS).toISOString();
      } else { args.lrDateFrom = range[0]; args.lrDateTo = range[1]; }
    }

    // Words that can change semantics are deliberately NOT in this filler set.
    take(word("lrs?|pods?|एलआर|एल आर|पीओडी|पी ओ डी|please|kripya|कृपया|batao|bataye|बताओ|बताएं|बताएँ|hai|hain|tha|the|है|हैं|थे|था|ke|ka|ki|के|का|की|mein|में|se|से|tak|तक|in|on|from|to|through|for|of|the|me|mujhe|मुझे|vehicle|गाड़ी|वाहन|number|no|नंबर|status|स्टेटस|date|तारीख|total|कुल|all|sab|सभी"), () => {});
    if (source.replace(/[\s?,.:]/g, "")) return clarify();
    for (const [marker, key] of [["vehicle|गाड़ी|वाहन", "vehicleNumber"], ["status|स्टेटस", "status"], ["material|सामग्री", "material"], ["consignor|sender|प्रेषक", "consignor"], ["consignee|receiver|प्राप्तकर्ता", "consignee"]]) {
      if (word(marker).test(raw) && !args[key]) return clarify();
    }
    if (pending && (args.partySearch || args.material || args.status || args.lrNumber)) return clarify(args.partySearch ? "party_role" : "filters");
    if (hasPod && !pending && !args.lrNumber) return clarify();
    if (args.lrNumber && !countOnly && (!explicitList || detail)) {
      if (Object.keys(args).length !== 1 || pending) return clarify();
      return { kind: "query", name: hasPod ? "get_pod_detail" : "get_lr_detail", args: { lrNumber: args.lrNumber }, language };
    }
    if (hasPod && !pending) return clarify();
    if (detail) return clarify();
    const name: ToolName = pending ? "search_pending_pods" : "search_lrs";
    if (!countOnly && !explicitList) return clarify();
    args.countOnly = countOnly; args.limit = 10; args.offset = 0;
    if (pending && args.minPendingDays === undefined) args.minPendingDays = 0;
    const complete = completeArguments(name, args);
    validateArguments(name, complete);
    return { kind: "query", name, args: complete, language };
  } catch { return clarify(); }
}
function cleanEntity(value: string): string {
  const quoted = /^["']/.test(value);
  // Without quotes a word such as "delivered" may be a status qualifier,
  // not part of the party. Do not silently reinterpret that ambiguity.
  if (!quoted && word(`${monthPattern}|open|in transit|delivered|billed|cancelled|canceled|created|creation|today|yesterday|all|sab|सभी|इस|पिछले`).test(value)) throw new Error("ambiguous_entity");
  const clean = value.replace(/^["']|["']$/g, "").trim();
  // SQL ILIKE wildcards would broaden substring searches; do not approximate.
  if (!clean || clean.length > 200 || word("lrs?|pods?|pending|details?|count|kitne|please|kripya|mujhe|मुझे|कृपया|दिखाओ|कितने").test(clean) || /[%_\\]/.test(clean)) throw new Error("entity");
  return clean;
}
export function completeArguments(name: ToolName, args: ObjectValue): ObjectValue {
  const definition = toolDefinitions.find((t) => t.name === name)!;
  return Object.fromEntries(Object.keys(definition.parameters.properties).map((key) => [key, args[key] ?? null]));
}
export function matchesPlan(name: string, args: ObjectValue, plan: QueryPlan): boolean {
  if (name !== plan.name) return false;
  const expected = validateArguments(plan.name, plan.args);
  return Object.keys(args).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => args[key] === value);
}

type Env = (name: string) => string | undefined;

export async function interpretIntentNLU(text: string, language: Language, now: Date, fetchImpl: typeof fetch, env: Env): Promise<NluInterpretation> {
  const key = env("OPENAI_API_KEY");
  const model = env("WHATSAPP_NLU_MODEL")?.trim() || "gpt-4o-mini";
  if (!key || !MODELS.has(model)) throw new Error("nlu_unavailable");

  const istNow = new Date(now.getTime() + 330 * 60000);
  const istDate = istNow.toISOString().slice(0, 10);

  const instructions = `Interpret the user's WhatsApp message into a structured LR/POD intent.
Current IST date: ${istDate}
Language hint: ${language}

Rules:
- Output ONLY the function call with structured intent.
- Use semantic date kinds; NEVER calculate exact dates.
- For bare month names (e.g., "september", "sep"), use {kind:"month", month:9}.
- For month+year (e.g., "september 2026"), use {kind:"month_year", month:9, year:2026}.
- Party names are raw strings from user text; do NOT normalize or match to ERP.
- If message has multiple conflicting dates, ambiguous intent, unsupported filters, or missing required fields -> needsClarification=true with category.
- lrNumber must include "LR" prefix (e.g., "LR19619").
- Operations: lr_detail (single LR), lr_count (how many), lr_list (show LRs), pod_detail (single POD), pending_pod_count (pending count), pending_pod_list (pending list).`;

  const resp = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, store: false, parallel_tool_calls: false, max_output_tokens: 500,
      instructions,
      input: [{ role: "user", content: [{ type: "input_text", text }] }],
      tools: [nluIntentSchema], tool_choice: { type: "function", name: "interpret_whatsapp_intent" }
    })
  });

  if (!resp.ok || !resp.body) throw new Error("nlu_provider_error");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, rawText = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 65536) throw new Error("nlu_provider_limit");
    rawText += decoder.decode(part.value, { stream: true });
  }
  await reader.cancel();
  const payload = JSON.parse(rawText + decoder.decode());
  if (payload.status !== "completed" || !Array.isArray(payload.output) || payload.output.length === 0) throw new Error("nlu_incomplete");
  const callItem = payload.output.find((item: unknown) => object(item).type === "function_call");
  if (!callItem || object(callItem).name !== "interpret_whatsapp_intent") throw new Error("nlu_no_call");
  return JSON.parse(String(object(callItem).arguments)) as NluInterpretation;
}

export function validateNluInterpretation(nlu: NluInterpretation, originalText: string): void {
  const allowedKeys = new Set([
    "operation", "language", "lrNumber", "date", "createdDate", "partySearch",
    "consignor", "consignee", "vehicleNumber", "material", "status",
    "minPendingDays", "needsClarification", "clarificationCategory", "clarificationHint",
  ]);
  if (Object.keys(object(nlu)).length !== allowedKeys.size || Object.keys(object(nlu)).some((key) => !allowedKeys.has(key))) {
    throw new Error("nlu_invalid_keys");
  }
  const allowedOperations = new Set<SemanticOp>([
    "lr_detail", "lr_count", "lr_list", "pod_detail", "pending_pod_count", "pending_pod_list",
  ]);
  if (nlu.operation !== null && !allowedOperations.has(nlu.operation)) throw new Error("nlu_invalid_operation");
  if (nlu.needsClarification) throw new Error(`nlu_clarification:${nlu.clarificationCategory}`);
  if (!nlu.operation) throw new Error("nlu_missing_operation");
  if (nlu.lrNumber && !/^LR\d+$/.test(nlu.lrNumber)) throw new Error("nlu_invalid_lrNumber");
  if (nlu.lrNumber) {
    const digits = nlu.lrNumber.slice(2);
    const normalizedOriginal = originalText.toLowerCase().replace(/[^0-9]/g, "");
    if (!normalizedOriginal.includes(digits)) throw new Error("nlu_lr_not_in_source");
  }
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, " ");
  const userNorm = normalize(originalText);
  for (const key of ["partySearch", "consignor", "consignee"] as const) {
    const val = nlu[key];
    if (val && !userNorm.includes(normalize(val))) throw new Error(`nlu_party_not_in_source:${key}`);
  }
  for (const key of ["vehicleNumber", "material"] as const) {
    const val = nlu[key];
    if (val && !userNorm.includes(normalize(val))) throw new Error(`nlu_literal_not_in_source:${key}`);
  }
  if (["lr_detail", "pod_detail"].includes(nlu.operation) && !nlu.lrNumber) throw new Error("nlu_missing_lrNumber");
  if (nlu.lrNumber && (nlu.date || nlu.partySearch || nlu.consignor || nlu.consignee || nlu.vehicleNumber || nlu.material || nlu.status || nlu.minPendingDays != null)) throw new Error("nlu_invalid: lrNumber with extra filters");
  if (["pending_pod_count", "pending_pod_list"].includes(nlu.operation) && nlu.status) throw new Error("nlu_invalid: pending POD cannot have status");
}

export function resolveSemanticDate(d: SemanticDate | null, istNow: Date, isCreation = false): { from: string; to: string | null } | null {
  if (!d) return null;
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth() + 1;
  if (d.kind === "relative") {
    switch (d.value) {
      case "today": return { from: istNow.toISOString().slice(0, 10), to: null };
      case "yesterday": {
        const prev = new Date(istNow.getTime() - 86400000).toISOString().slice(0, 10);
        return { from: prev, to: null };
      }
      case "this_month": return { from: day(year, month, 1), to: day(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
      case "last_month": {
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
        return { from: day(prevYear, prevMonth, 1), to: day(prevYear, prevMonth, lastDay) };
      }
      case "this_year": return { from: day(year, 1, 1), to: day(year, 12, 31) };
      case "last_year": return { from: day(year - 1, 1, 1), to: day(year - 1, 12, 31) };
    }
  } else if (d.kind === "month") {
    const targetYear = d.month <= month ? year : year - 1;
    return { from: day(targetYear, d.month, 1), to: day(targetYear, d.month, new Date(Date.UTC(targetYear, d.month, 0)).getUTCDate()) };
  } else if (d.kind === "month_year") {
    return { from: day(d.year, d.month, 1), to: day(d.year, d.month, new Date(Date.UTC(d.year, d.month, 0)).getUTCDate()) };
  } else if (d.kind === "exact") {
    return { from: d.from, to: d.to };
  }
  return null;
}

export function buildQueryPlanFromNlu(nlu: NluInterpretation, now: Date): QueryPlan {
  const istNow = new Date(now.getTime() + 330 * 60000);
  const args: ObjectValue = {};

  if (nlu.lrNumber) args.lrNumber = nlu.lrNumber;
  if (nlu.partySearch) args.partySearch = nlu.partySearch;
  if (nlu.consignor) args.consignor = nlu.consignor;
  if (nlu.consignee) args.consignee = nlu.consignee;
  if (nlu.vehicleNumber) args.vehicleNumber = nlu.vehicleNumber;
  if (nlu.material) args.material = nlu.material;
  if (nlu.status) args.status = nlu.status;
  if (nlu.minPendingDays != null) args.minPendingDays = nlu.minPendingDays;

  const dateRange = resolveSemanticDate(nlu.date, istNow);
  if (dateRange) { args.lrDateFrom = dateRange.from; if (dateRange.to) args.lrDateTo = dateRange.to; }

  const createdRange = resolveSemanticDate(nlu.createdDate, istNow, true);
  if (createdRange) {
    args.createdAtFrom = new Date(`${createdRange.from}T00:00:00+05:30`).toISOString();
    const inclusiveEnd = createdRange.to ?? createdRange.from;
    args.createdAtTo = new Date(Date.parse(`${inclusiveEnd}T00:00:00+05:30`) + DAY_MS).toISOString();
  }

  const opMap: Record<SemanticOp, { name: ToolName; countOnly: boolean }> = {
    lr_detail: { name: "get_lr_detail", countOnly: false },
    lr_count: { name: "search_lrs", countOnly: true },
    lr_list: { name: "search_lrs", countOnly: false },
    pod_detail: { name: "get_pod_detail", countOnly: false },
    pending_pod_count: { name: "search_pending_pods", countOnly: true },
    pending_pod_list: { name: "search_pending_pods", countOnly: false },
  };
  const { name, countOnly } = opMap[nlu.operation!];
  args.countOnly = countOnly;
  args.limit = 10; args.offset = 0;
  if (name === "search_pending_pods" && args.minPendingDays == null) args.minPendingDays = 0;

  if (["get_lr_detail", "get_pod_detail"].includes(name)) {
    if (!nlu.lrNumber) throw new Error("nlu_missing_lrNumber");
    args.lrNumber = nlu.lrNumber;
  }

  return { kind: "query", name, args: completeArguments(name, args), language: nlu.language };
}
