import { extractInternalEntities, INTERNAL_ENTITY_KEYS } from "./whatsappAssistantOperationalLanguage.ts";
import { toolDefinitions, internalToolDefinitions, validateOperationalArguments, validateArguments, type ObjectValue, type ToolName, type SemanticOp, type SemanticDate, type NluInterpretation, nluIntentSchema, MODELS, object } from "./whatsappAssistantSchemas.ts";

export type Language = "en" | "hi" | "hinglish";
export type QueryPlan = { kind: "query"; name: ToolName; args: ObjectValue; language: Language; operational?: true };
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
const NLU_MAX_OUTPUT_TOKENS = 1200;
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
export function resolveIntent(raw: string, now = new Date(), internal = false): Intent {
  const language = detectLanguage(raw);
  const clarify = (reason: "year" | "filters" | "party_role" = "filters"): Intent => ({ kind: "clarification", language, reason });
  let source = raw.normalize("NFC").replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966)).trim();
  if (word("finance|freight|invoice|billing|payment|balance|amount|salary|sql|delete|update|insert|write|बिल|भुगतान|पैसा|रकम|मिटाओ").test(source)) return { kind: "out_of_scope", language, reason: "filters" };
  // Negation, comparisons, multiple tasks and unresolved references are not
  // approximated. Only the explicit range/age forms below are supported.
  if (word("no|not|non|except|excluding|without|बिना|before|after|less|more|over|under|older|and|or|aur|ya|nahi|nahin|mat|sirf|only|us|that|those|next|previous|कल|नहीं|मत|सिर्फ|और|या|उस|पहले|बाद").test(source)) return clarify();
  if (/[\p{Cc}\p{Cf}]/u.test(source)) return clarify();
  let internalFields: ObjectValue = {};
  if (internal) {
    try { const extracted = extractInternalEntities(source); source = extracted.source; internalFields = extracted.fields; }
    catch { return clarify(); }
  }
  // Vehicle words establish an LR movement only in this bounded internal
  // count grammar. A bare vehicle/gaadi remains out of scope.
  const vehicleCountLanguage = "(?:(?:kitna|kitne|kitni)\\s+(?:gaadi|gadi)|कितनी\\s+गाड़ी|how\\s+many\\s+vehicles?)";
  const hasVehicleCount = internal && word(vehicleCountLanguage).test(source);
  const hasLr = (internal && word("drafts?|final").test(source)) || hasVehicleCount || word("lrs?|एलआर|एल आर|lr[0-9]+").test(source);
  const hasPod = word("pods?|पीओडी|पी ओ डी").test(source);
  if (!hasLr && !hasPod) return { kind: "out_of_scope", language, reason: "filters" };
  const args: ObjectValue = { ...internalFields };
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
    if (!internal) {
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

    }
    take(word("(?:created(?:\\s+(?:at|on|time))?|creation(?:\\s+(?:date|time))?|create\\s+(?:hua|hue)|बनाए गए|बनाया गया|बने हुए)"), () => { if (created) throw new Error("duplicate_basis"); created = true; });
    // Reuse the vehicle-count grammar above, while retaining existing LR
    // count forms such as "how many draft LRs" and "count LRs".
    take(word(`(?:${vehicleCountLanguage}|how\\s+many|count|number\\s+of|kitne|kitna|kitni|कितने|कितनी|संख्या)`), () => { if (countOnly) throw new Error("duplicate_count"); countOnly = true; });
    take(word("(?:show|list|dikhao|दिखाओ|दिखाएं|दिखाएँ|सूची)"), () => { if (explicitList) throw new Error("duplicate_list"); explicitList = true; });
    take(word("(?:details?|detail\\s+batao|विवरण|जानकारी)"), () => { detail = true; });
    if (countOnly && (explicitList || detail)) return clarify();
    if (!countOnly && !detail) take(word("batao|bataye|बताओ|बताएं|बताएँ"), () => { if (explicitList) throw new Error("duplicate_list"); explicitList = true; });
    if (internal) take(word("present"), () => put("podState", "present"));
    take(word("pending|लंबित|पेंडिंग"), () => { if (pending) throw new Error("duplicate_pending"); pending = true; });
    if (pending && !hasPod) return clarify();
    take(word("(\\d{1,5})\\s*(?:days?|din|दिन)(?:\\s*(?:se|से))?"), (m) => {
      if (!pending || !hasPod) throw new Error("unsupported_age");
      put("minPendingDays", Number(m[1]));
    });
    take(word(internal ? "LR\\s*([0-9]+)(?!-[0-9])" : "LR\\s*([0-9]+)"), (m) => put("lrNumber", `LR${m[1]}`));
    take(word("[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}"), (m) => put("vehicleNumber", m[0].toUpperCase()));
    const statuses: Record<string, string> = { open: "Open", "in transit": "In Transit", delivered: "Delivered", billed: "Billed", cancelled: "Cancelled", canceled: "Cancelled", डिलीवर्ड: "Delivered", कैंसिल: "Cancelled" };
    take(word(Object.keys(statuses).join("|")), (m) => put("status", statuses[m[0].toLowerCase()]));
    take(word(internal ? "drafts?|final" : "final"), (m) => put("entryStatus", m[0].toLowerCase().replace(/s$/, "")));

    // Relative dates depend only on the trusted server clock, in IST.
    const istToday = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
    take(word("today|aaj|आज|yesterday|beete kal|बीता कल|this month|is mahine|इस महीने|last month|pichle month|pichhle month|pichhle mahine|पिछले महीने|this year|is saal|इस साल|last year|pichhle saal|पिछले साल"), (m) => {
      const token = m[0].toLowerCase();
      const today = new Date(istToday);
      const year = today.getUTCFullYear(), month = today.getUTCMonth() + 1;
      if (["today", "aaj", "आज"].includes(token)) setRange([istToday, istToday]);
      else if (["yesterday", "beete kal", "बीता कल"].includes(token)) {
        const previous = new Date(today.getTime() - DAY_MS).toISOString().slice(0, 10); setRange([previous, previous]);
      } else if (["this month", "is mahine", "इस महीने"].includes(token)) setRange(monthRange(year, month));
      else if (["last month", "pichle month", "pichhle month", "pichhle mahine", "पिछले महीने"].includes(token)) setRange(monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1));
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

    // Movement wording is consumed only after the internal LR vehicle-count
    // grammar has established scope. It is never a generic filler word.
    if (internal && countOnly && hasLr) take(word("load\\s+hua|load\\s+hue|laga\\s+tha|lagi\\s+thi|lage|lagi|laga|gaye|gaya|gayi"), () => {});
    // Words that can change semantics are deliberately NOT in this filler set.
    take(word("lrs?|pods?|एलआर|एल आर|पीओडी|पी ओ डी|please|kripya|कृपया|batao|bataye|बताओ|बताएं|बताएँ|hai|hain|tha|the|है|हैं|थे|था|ke|ka|ki|के|का|की|mein|में|se|से|tak|तक|in|on|from|to|through|for|of|the|me|mujhe|मुझे|vehicle|गाड़ी|वाहन|number|no|नंबर|status|स्टेटस|date|तारीख|total|कुल|all|sab|सभी"), () => {});
    if (internal && countOnly && hasLr) {
      take(word("(?:are\\s+there|is\\s+there)"), () => {});
    }
    if (source.replace(/[\s?,.:]/g, "")) return clarify();
    for (const [marker, key] of [["vehicle|गाड़ी|वाहन", "vehicleNumber"], ["status|स्टेटस", "status"], ["material|सामग्री", "material"], ["consignor|sender|प्रेषक", "consignor"], ["consignee|receiver|प्राप्तकर्ता", "consignee"]]) {
      if (word(marker).test(raw) && !args[key]) return clarify();
    }
    if (!internal && pending && (args.partySearch || args.material || args.status || args.lrNumber)) return clarify(args.partySearch ? "party_role" : "filters");
    if (internal && pending) {
      if (args.podState) return clarify();
      args.podState = "pending";
    }
    if (hasPod && !pending && !args.lrNumber && (!internal || !args.podState)) return clarify();
    if (args.lrNumber && !countOnly && (!explicitList || detail)) {
      if (!internal && (Object.keys(args).length !== 1 || pending)) return clarify();
      if (internal) {
        const name = hasPod ? "get_pod_detail" : "get_lr_detail";
        const complete = completeArguments(name, { ...args, countOnly: false, limit: 10, offset: 0 }, true);
        validateOperationalArguments(name, complete);
        return { kind: "query", name, args: complete, language, operational: true };
      }
      return { kind: "query", name: hasPod ? "get_pod_detail" : "get_lr_detail", args: { lrNumber: args.lrNumber }, language };
    }
    if (hasPod && !pending && (!internal || !args.podState)) return clarify();
    if (detail) return clarify();
    const name: ToolName = pending ? "search_pending_pods" : "search_lrs";
    if (!countOnly && !explicitList) return clarify();
    args.countOnly = countOnly; args.limit = 10; args.offset = 0;
    if (pending && args.minPendingDays === undefined) args.minPendingDays = 0;
    const complete = completeArguments(name, args, internal);
    internal ? validateOperationalArguments(name, complete) : validateArguments(name, complete);
    return { kind: "query", name, args: complete, language, ...(internal ? { operational: true as const } : {}) };
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
export function completeArguments(name: ToolName, args: ObjectValue, internal = false): ObjectValue {
  const definition = (internal ? internalToolDefinitions : toolDefinitions).find((t) => t.name === name)!;
  return Object.fromEntries(Object.keys(definition.parameters.properties).map((key) => [key, args[key] ?? null]));
}
export function matchesPlan(name: string, args: ObjectValue, plan: QueryPlan): boolean {
  if (name !== plan.name) return false;
  const expected = validateArguments(plan.name, plan.args);
  return Object.keys(args).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => args[key] === value);
}

/** Same strict comparison as matchesPlan; only the schema is internal-specific. */
export function matchesOperationalPlan(name: string, args: ObjectValue, plan: QueryPlan): boolean {
  if (name !== plan.name) return false;
  const expected = validateOperationalArguments(plan.name, plan.args);
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
- entryStatus is draft only when explicitly requested, otherwise null (final default).
- Explicit branch/source city/destination city/transporter labels populate their respective fields.
- Unlabelled names populate entitySearch, NOT a guessed party/material/branch role.
- Directional unlabelled references populate originSearch/destinationSearch; the server resolves party/location ambiguity.
- Explicit consignor/consignee/material/party labels populate only that named role.
- Never return database IDs. Preserve complete user entity wording, including spelling.
- Party names are raw strings from user text; do NOT normalize or match to ERP.
- If message has multiple conflicting dates, ambiguous intent, unsupported filters, or missing required fields -> needsClarification=true with category.
- lrNumber must include "LR" prefix (e.g., "LR19619").
- Operations: lr_detail (single LR), lr_count (how many), lr_list (show LRs), pod_detail (single POD), pending_pod_count (pending count), pending_pod_list (pending list).`;

  const resp = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, store: false, parallel_tool_calls: false, max_output_tokens: NLU_MAX_OUTPUT_TOKENS,
      instructions,
      input: [{ role: "user", content: [{ type: "input_text", text }] }],
      tools: [nluIntentSchema], tool_choice: { type: "function", name: "interpret_whatsapp_intent" }
    })
  });

  if (!resp.ok) {
    console.info(`[WhatsApp NLU] provider_http_error status=${resp.status}`);
    throw new Error("nlu_provider_error");
  }
  if (!resp.body) throw new Error("nlu_provider_error");
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
  if (payload.status !== "completed" || !Array.isArray(payload.output) || payload.output.length === 0) {
    const safeStatus = typeof payload.status === "string" ? payload.status : "missing";
    const outputIsArray = Array.isArray(payload.output);
    const outputCount = outputIsArray ? payload.output.length : -1;
    const incompleteReason =
      typeof object(payload.incomplete_details).reason === "string"
        ? String(object(payload.incomplete_details).reason)
        : "missing";
    const outputTypes = outputIsArray
      ? payload.output.map((item: unknown) => typeof object(item).type === "string" ? String(object(item).type) : "missing").join(",")
      : "none";
    const outputStatuses = outputIsArray
      ? payload.output.map((item: unknown) => typeof object(item).status === "string" ? String(object(item).status) : "missing").join(",")
      : "none";
    console.info(`[WhatsApp NLU] incomplete status=${safeStatus} reason=${incompleteReason} output_array=${outputIsArray} output_count=${outputCount} output_types=${outputTypes} output_statuses=${outputStatuses}`);
    throw new Error("nlu_incomplete");
  }
  const calls = payload.output.filter((item: unknown) => object(item).type === "function_call");
  if (calls.length !== 1 || payload.output.some((item: unknown) => !["function_call", "reasoning"].includes(String(object(item).type)))) throw new Error("nlu_no_call");
  const callItem = calls[0];
  if (!callItem || object(callItem).name !== "interpret_whatsapp_intent") throw new Error("nlu_no_call");
  if ((callItem.status !== undefined && callItem.status !== "completed") || typeof callItem.arguments !== "string" || callItem.arguments.length > 16384) throw new Error("nlu_no_call");
  const interpretation = JSON.parse(callItem.arguments);
  validateNluShape(interpretation, nluIntentSchema.parameters);
  return interpretation as NluInterpretation;
}

// Validate the actual response, not just the schema sent to the provider.
function validateNluShape(value: unknown, schema: ObjectValue): void {
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((branch) => { try { validateNluShape(value, object(branch)); return true; } catch { return false; } })) throw new Error("nlu_shape");
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  if (!types.includes(type) || (Array.isArray(schema.enum) && !schema.enum.includes(value))) throw new Error("nlu_shape");
  if (type === "object") {
    const obj = object(value), props = object(schema.properties);
    if (Object.keys(obj).length !== Object.keys(props).length || Object.keys(obj).some(k => !Object.hasOwn(props, k))) throw new Error("nlu_shape");
    for (const [k, v] of Object.entries(props)) validateNluShape(obj[k], object(v));
  } else if (typeof value === "string") {
    if ((typeof schema.minLength === "number" && value.length < schema.minLength) ||
        (typeof schema.maxLength === "number" && value.length > schema.maxLength) ||
        (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))) throw new Error("nlu_shape");
  } else if (typeof value === "number" && (!Number.isSafeInteger(value) || value < Number(schema.minimum) || value > Number(schema.maximum))) throw new Error("nlu_shape");
}

function validateNluCompatibility(nlu: NluInterpretation, internal = false): void {
  validateNluShape(nlu, nluIntentSchema.parameters);
  if (nlu.needsClarification) throw new Error(`nlu_clarification:${nlu.clarificationCategory}`);
  if (!nlu.operation || nlu.clarificationCategory !== null || nlu.clarificationHint !== null) throw new Error("nlu_inconsistent");
  if (!internal && (nlu.entryStatus === "draft" || [nlu.bookingBranch, nlu.fromStation, nlu.toStation, nlu.entitySearch, nlu.originSearch, nlu.destinationSearch, nlu.transporter, nlu.podState].some(v => v !== null))) throw new Error("nlu_incompatible");
  const detail = nlu.operation === "lr_detail" || nlu.operation === "pod_detail";
  const pending = nlu.operation != null && nlu.operation.startsWith("pending_pod_");
  if (!internal && detail && (!nlu.lrNumber || [nlu.date, nlu.createdDate, nlu.partySearch, nlu.consignor, nlu.consignee, nlu.vehicleNumber, nlu.material, nlu.status, nlu.entryStatus, nlu.minPendingDays].some(v => v !== null))) throw new Error("nlu_incompatible");
  if (!internal && pending && [nlu.lrNumber, nlu.partySearch, nlu.material, nlu.status, nlu.entryStatus].some(v => v !== null)) throw new Error("nlu_incompatible");
  if (!pending && nlu.podState !== "pending" && nlu.minPendingDays !== null) throw new Error("nlu_incompatible");
  if (detail && !nlu.lrNumber) throw new Error("nlu_incompatible");
  if (pending && nlu.podState === "present") throw new Error("nlu_incompatible");
  if (nlu.date && nlu.createdDate) throw new Error("nlu_incompatible");
  for (const v of [nlu.partySearch, nlu.consignor, nlu.consignee, nlu.vehicleNumber, nlu.material]) {
    if (v !== null && (!v.trim() || /[%_\\]/u.test(v))) throw new Error("nlu_entity");
  }
}

export function validateNluInterpretation(
  nlu: NluInterpretation,
  originalText: string,
  now = new Date("2000-01-01T00:00:00Z"),
  internal = false,
): void {
  validateNluCompatibility(nlu, internal);
  let source = originalText.normalize("NFC").replace(/[०-९]/g, c => String(c.charCodeAt(0) - 0x0966)).trim();

  let internalFields: ObjectValue = {};
  if (internal) {
    const extracted = extractInternalEntities(source);
    internalFields = extracted.fields;
    for (const key of INTERNAL_ENTITY_KEYS) {
      if ((extracted.fields[key] ?? null) !== nlu[key]) throw new Error("nlu_entity_provenance");
    }
    source = extracted.source;
  }

  // Reject multiple independently answerable requests before their filters can
  // be merged into one NLU plan. Apply only the existing product aliases needed
  // for deterministic clause recognition; punctuation alone is not sufficient.
  // For multi-request detection, punctuation inside quoted text is not a
  // clause separator. This preserves legitimate quoted entity values such as
  // consignor "ACC, LTD", while commas outside quotes can separate requests.
  const clauseSource = source.replace(
    /(["'])([^"'\r\n]+)\1/gu,
    (quoted) => quoted.replace(/[?!.,]/gu, " "),
  );
  const independentClauses = clauseSource
    .split(/[?!.,]+/u)
    .map(part => part.trim())
    .filter(Boolean);

  if (independentClauses.length > 1) {
    const requestClauses = independentClauses.filter(clause => {
      const normalizedClause = clause
        .replace(word("gaadi|gadi|गाड़ी"), "LR")
        .replace(word("total vehicle"), "total LR")
        .replace(word("kitni"), "kitne")
        .replace(word("lage|lge"), "");
      const clauseIntent = resolveIntent(
        normalizedClause,
        new Date("2000-01-01T00:00:00Z")
      );
      return clauseIntent.kind === "query" || clauseIntent.kind === "clarification";
    });

    if (requestClauses.length > 1) throw new Error("nlu_multiple_requests");
  }

  // Protect explicitly labelled quoted entities before source aliases run.
  // Otherwise words such as "lage", "lge" or "gaadi" inside an entity name
  // could be removed/reinterpreted and authorize a different ERP filter.
  const protectedEntities: string[] = [];
  const quotedEntity = /(?<![\p{L}\p{M}])(?:consignor|sender|प्रेषक|consignee|receiver|प्राप्तकर्ता|material|सामग्री|party|पार्टी)\s*[:=]?\s*(["'])([^"'\r\n]+)\1/giu;
  source = source.replace(quotedEntity, (whole, _quote: string, rawValue: string) => {
    const label = whole.match(/^(?:consignor|sender|प्रेषक|consignee|receiver|प्राप्तकर्ता|material|सामग्री|party|पार्टी)/iu)?.[0]?.toLowerCase();
    if (!label) throw new Error("nlu_entity_provenance");
    const value = cleanEntity(`"${rawValue}"`);
    const key = /^(?:consignor|sender|प्रेषक)$/iu.test(label) ? "consignor"
      : /^(?:consignee|receiver|प्राप्तकर्ता)$/iu.test(label) ? "consignee"
      : /^(?:material|सामग्री)$/iu.test(label) ? "material"
      : "partySearch";
    if (nlu[key] !== value) throw new Error("nlu_entity_provenance");
    const token = `NLUENTITY${protectedEntities.length}`;
    protectedEntities.push(value);
    return whole.replace(`${_quote}${rawValue}${_quote}`, `"${token}"`);
  });

  // Protect unquoted labelled entities before source aliases too. Otherwise an
  // alias word inside the entity (for example "consignor ACC lage") could be
  // removed before deterministic provenance checks and authorize a shortened
  // model-selected entity such as "ACC".
  const unquotedLabelledEntity = /(?<![\p{L}\p{M}])(consignor|sender|प्रेषक|consignee|receiver|प्राप्तकर्ता|material|सामग्री|party|पार्टी)\s*[:=]?\s*([\p{L}\p{M}][\p{L}\p{M}\p{N} .&-]*?)(?=\s+(?:ke|ka|ki|के|का|की|mein|में|se|से|for|in|on|lrs?|pods?|consignor|consignee|material|party|status|vehicle)(?![\p{L}\p{M}\p{N}_])|$|[,?])/giu;
  source = source.replace(unquotedLabelledEntity, (whole, label: string, rawValue: string) => {
    const value = cleanEntity(rawValue);
    const key = /^(?:consignor|sender|प्रेषक)$/iu.test(label) ? "consignor"
      : /^(?:consignee|receiver|प्राप्तकर्ता)$/iu.test(label) ? "consignee"
      : /^(?:material|सामग्री)$/iu.test(label) ? "material"
      : "partySearch";
    if (nlu[key] !== value) throw new Error("nlu_entity_provenance");
    const token = `NLUENTITY${protectedEntities.length}`;
    protectedEntities.push(value);
    return whole.slice(0, whole.length - rawValue.length) + `"${token}"`;
  });

  // Protect supported unlabelled party forms before aliases run.
  // This includes leading `<party> ke ...` (quoted or unquoted) and
  // `for <party>`. Alias words inside the party value must remain entity data.
  if (!internal && nlu.partySearch !== null) {
    const protectPartyValue = (rawValue: string): string => {
      const value = cleanEntity(rawValue);
      if (nlu.partySearch !== value) throw new Error("nlu_entity_provenance");
      const token = `NLUENTITY${protectedEntities.length}`;
      protectedEntities.push(value);
      return token;
    };

    // Keep the same exclusions as the deterministic leading-party grammar so
    // date/status/request words are not reclassified as party names here.
    const leadingPartyExcluded = (value: string): boolean =>
      word(`${monthPattern}|open|delivered|cancelled|canceled|billed|transit|lrs?|lr[0-9]+|pods?|vehicle|created|creation|count|show|list|kitne|is|pichhle|इस|पिछले|आज|बीता`).test(value);

    // Keep the same exclusions as deterministic `for <party>` parsing.
    const forPartyExcluded = (value: string): boolean =>
      word(`${monthPattern}|today|yesterday|this|last|lr\\s*[0-9]+`).test(value);

    const quotedLeadingParty = /^\s*(["'])([^"'\r\n]+)\1\s+(ke|ka|ki|के|का|की)(?=\s|$)/iu;
    source = source.replace(quotedLeadingParty, (whole, quote: string, rawValue: string) => {
      const value = cleanEntity(`${quote}${rawValue}${quote}`);
      if (leadingPartyExcluded(value)) return whole;
      const token = protectPartyValue(value);
      return whole.replace(`${quote}${rawValue}${quote}`, `"${token}"`);
    });

    const leadingParty = /^\s*([\p{L}\p{M}][\p{L}\p{M}\p{N} .&-]*?)\s+(ke|ka|ki|के|का|की)(?=\s|$)/iu;
    source = source.replace(leadingParty, (whole, rawValue: string) => {
      const value = cleanEntity(rawValue);
      if (leadingPartyExcluded(value)) return whole;
      const token = protectPartyValue(value);
      return whole.replace(rawValue, `"${token}"`);
    });

    const quotedForParty = /(?<![\p{L}\p{M}])for\s+(["'])([^"'\r\n]+)\1(?=\s+(?:ke|ka|ki|के|का|की|mein|में|se|से|for|in|on|lrs?|pods?|consignor|consignee|material|party|status|vehicle)(?![\p{L}\p{M}\p{N}_])|$|[,?])/giu;
    source = source.replace(quotedForParty, (whole, quote: string, rawValue: string) => {
      const value = cleanEntity(`${quote}${rawValue}${quote}`);
      if (forPartyExcluded(value)) return whole;
      const token = protectPartyValue(value);
      return whole.replace(`${quote}${rawValue}${quote}`, `"${token}"`);
    });

    const unquotedForParty = /(?<![\p{L}\p{M}])for\s+([\p{L}\p{M}][\p{L}\p{M}\p{N} .&-]*?)(?=\s+(?:ke|ka|ki|के|का|की|mein|में|se|से|for|in|on|lrs?|pods?|consignor|consignee|material|party|status|vehicle)(?![\p{L}\p{M}\p{N}_])|$|[,?])/giu;
    source = source.replace(unquotedForParty, (whole, rawValue: string) => {
      const value = cleanEntity(rawValue);
      if (forPartyExcluded(value)) return whole;
      const token = protectPartyValue(value);
      return whole.replace(rawValue, `"${token}"`);
    });
  }

  if (word("NLUDATE").test(source) || word("NLUENTITY\\d+").test(originalText)) throw new Error("nlu_unsupported");
  // These are source-only aliases, never substitutions taken from model output.
  // Unknown qualifiers remain in the input and must be consumed by resolveIntent.
  if (/[\p{Cc}\p{Cf}%_\\]/u.test(source) || word("distinct|unique|different|alag|अलग|rate|rates|amount|freight|ledger|outstanding|finance").test(source)) throw new Error("nlu_unsupported");
  source = source.replace(word("last mnth|pichle mahine"), "last month")
    .replace(word("kitni"), "kitne").replace(word("me"), "mein")
    .replace(word("bane"), "created");
  // Existing product aliases mean LR/trip count, never distinct vehicle count.
  source = source.replace(word("gaadi|gadi|गाड़ी"), "LR")
    .replace(word("total vehicle"), "total LR").replace(word(internal ? "lage|lge|lagi|gaye|gaya|gayi|laga" : "lage|lge"), internal ? "LR" : "");
  source = source.replace(/^\s*(\d+)\s+ka\s+pod\s+aya\s+kya\s*[?]?$/iu, "LR$1 POD detail")
    .replace(/\b(lr\s*\d+)\s+ka\s+kya\s+status\s+h\s*[?]?$/iu, "$1 detail");

  if (internal) {
    source = source.replace(word("trucks?|vehicles?|गाडियां|गाड़ियाँ"), "LR")
      .replace(word("drafts"), "draft LR")
      .replace(word("kitni baar|kitne baar|how many times"), "count LR")
      .replace(word("loads?|loaded|loading"), "LR")
      .replace(word("hua|hue|hui"), "");
    // A requested POD field is an exact-LR POD detail operation, never a weight
    // substituted from the LR. Any leftover qualifiers still fail closed.
    if (nlu.lrNumber && word("unloading weight|unloading date|delivery weight|delivery date").test(source)) {
      source = source.replace(word("unloading weight|unloading date|delivery weight|delivery date"), "POD detail")
        .replace(word("kya|kitna|kab|tha|thi"), "");
    }
  }
  let semantic: SemanticDate | null = null;
  const setDate = (d: SemanticDate) => { if (semantic) throw new Error("nlu_multiple_dates"); semantic = d; };
  const relatives: Record<string, SemanticDate & { kind: "relative" }> = {};
  for (const [value, forms] of Object.entries({ today: "today|aaj|आज", yesterday: "yesterday|beete kal|बीता कल", this_month: "this month|is mahine|इस महीने", last_month: "last month|pichhle mahine|पिछले महीने", this_year: "this year|is saal|इस साल", last_year: "last year|pichhle saal|पिछले साल" })) {
    for (const form of forms.split("|")) relatives[form] = { kind: "relative", value: value as Extract<SemanticDate, {kind: "relative"}>["value"] };
  }
  source = source.replace(word(Object.keys(relatives).join("|")), token => { setDate(relatives[token.toLowerCase()]); return "NLUDATE"; });
  // A placeholder prevents the source parser from requiring a clock or guessing
  // a year. Semantic equality is checked separately before this projection.
  if (!semantic) {
    const iso = [...source.matchAll(word("(\\d{4})-(\\d{2})-(\\d{2})"))];
    if (iso.length) {
      if (iso.length > 2) throw new Error("nlu_multiple_dates");
      const values = iso.map(m => day(Number(m[1]), Number(m[2]), Number(m[3])));
      if (values[0] > values[values.length - 1]) throw new Error("nlu_date");
      setDate({ kind: "exact", from: values[0], to: values.length === 2 ? values[1] : null });
      source = source.replace(word("\\d{4}-\\d{2}-\\d{2}"), "NLUDATE");
    } else {
      source = source.replace(word(`(${monthPattern})(?:\\s+((?:20|21)[0-9]{2}))?`), (_token, name, year) => {
        setDate(year ? { kind: "month_year", month: monthIndex.get(name.toLowerCase())!, year: Number(year) } : { kind: "month", month: monthIndex.get(name.toLowerCase())! });
        return "NLUDATE";
      });
    }
  }
  if (word(`${monthPattern}|(?:19|20|21)[0-9]{2}`).test(source)) throw new Error("nlu_unconsumed_date");
  source = source.replace(/NLUDATE/g, "2000-01-01");
  // Entry status is a separate semantic dimension from operational LR status.
  // Only explicit standalone "draft"/"final" wording in the user message may
  // authorize the corresponding NLU field. Do not infer it from ERP values.
  const entryStatusMatches = Array.from(
    source.matchAll(/\b(draft|final)\b/giu),
    (match) => match[1].toLowerCase(),
  );
  const distinctEntryStatusMatches = [...new Set(entryStatusMatches)];

  if (distinctEntryStatusMatches.length > 1) {
    throw new Error("nlu_entry_status_provenance");
  }

  const sourceEntryStatus =
    distinctEntryStatusMatches[0] === "draft" || distinctEntryStatusMatches[0] === "final"
      ? distinctEntryStatusMatches[0]
      : null;

  if (nlu.entryStatus !== sourceEntryStatus) {
    throw new Error("nlu_entry_status_provenance");
  }

  if (
    !internal && nlu.entryStatus !== null &&
    nlu.operation !== "lr_count" &&
    nlu.operation !== "lr_list"
  ) {
    throw new Error("nlu_incompatible");
  }

  source = source.replace(/NLUENTITY(\d+)/g, (_token, index) => {
    const value = protectedEntities[Number(index)];
    if (value === undefined) throw new Error("nlu_entity_provenance");
    return value;
  });

  const actualDate = nlu.date ?? nlu.createdDate;
  const canonical = (d: SemanticDate | null): string => {
    if (!d) return "null";
    if (d.kind === "relative") return `relative:${d.value}`;
    if (d.kind === "month") return `month:${d.month}`;
    if (d.kind === "month_year") return `month_year:${d.month}:${d.year}`;
    return `exact:${d.from}:${d.to ?? d.from}`;
  };
  const actualField = nlu.date ? "date" : nlu.createdDate ? "createdDate" : "none";
  const sourceField =
    semantic === null
      ? "none"
      : nlu.createdDate !== null && nlu.date === null
        ? "createdDate"
        : "date";

  let dateProvenanceMatched =
    actualField === sourceField &&
    canonical(actualDate) === canonical(semantic);

  if (
    !dateProvenanceMatched &&
    actualField === sourceField &&
    semantic?.kind === "relative" &&
    semantic.value === "last_month" &&
    actualDate?.kind === "month"
  ) {
    const istNow = new Date(now.getTime() + 330 * 60000);
    const currentMonth = istNow.getUTCMonth() + 1;
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    dateProvenanceMatched = actualDate.month === previousMonth;
  }

  if (!dateProvenanceMatched) {
    const actualKind = actualDate?.kind ?? "none";
    const sourceKind = semantic?.kind ?? "none";
    const relativeValueMatched =
      actualDate?.kind === "relative" && semantic?.kind === "relative"
        ? actualDate.value === semantic.value
        : null;
    console.info(
      `[WhatsApp NLU] date_provenance actual_field=${actualField} actual_kind=${actualKind} source_kind=${sourceKind} relative_value_matched=${relativeValueMatched}`
    );
    throw new Error("nlu_date_provenance");
  }
  const expected = resolveIntent(source, new Date("2000-01-01T00:00:00Z"), internal);
  if (expected.kind !== "query") throw new Error("nlu_source_unsupported");
  if (internal) Object.assign(expected.args, internalFields);
  const projected = buildQueryPlanFromNlu({ ...nlu,
    date: nlu.date ? { kind: "exact", from: "2000-01-01", to: "2000-01-01" } : null,
    createdDate: nlu.createdDate ? { kind: "exact", from: "2000-01-01", to: "2000-01-01" } : null,
  }, new Date("2000-01-01T00:00:00Z"), internal);
  const args = internal ? validateOperationalArguments(projected.name, projected.args) : validateArguments(projected.name, projected.args);
  const expectedArgs = internal ? validateOperationalArguments(expected.name, expected.args) : null;
  const matched = internal ? projected.name === expected.name && Object.keys(args).length === Object.keys(expectedArgs!).length && Object.entries(expectedArgs!).every(([k,v]) => args[k] === v) : matchesPlan(projected.name, args, expected);
  if (!matched) throw new Error("nlu_source_mismatch");
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

export function buildQueryPlanFromNlu(nlu: NluInterpretation, now: Date, internal = false): QueryPlan {
  validateNluCompatibility(nlu, internal);
  const istNow = new Date(now.getTime() + 330 * 60000);
  const args: ObjectValue = {};

  if (internal) for (const key of INTERNAL_ENTITY_KEYS) if (nlu[key]) args[key] = nlu[key];
  if (internal && nlu.podState) args.podState = nlu.podState;
  if (internal && nlu.operation!.startsWith("pending_pod_")) args.podState = "pending";
  if (nlu.lrNumber) args.lrNumber = nlu.lrNumber;
  if (nlu.partySearch) args.partySearch = nlu.partySearch;
  if (nlu.consignor) args.consignor = nlu.consignor;
  if (nlu.consignee) args.consignee = nlu.consignee;
  if (nlu.vehicleNumber) args.vehicleNumber = nlu.vehicleNumber;
  if (nlu.material) args.material = nlu.material;
  if (nlu.status) args.status = nlu.status;
  if (nlu.entryStatus) args.entryStatus = nlu.entryStatus;
  if (nlu.minPendingDays != null) args.minPendingDays = nlu.minPendingDays;

  const dateRange = resolveSemanticDate(nlu.date, istNow);
  if (dateRange) { args.lrDateFrom = dateRange.from; args.lrDateTo = dateRange.to ?? dateRange.from; }

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

  const complete = completeArguments(name, args, internal);
  internal ? validateOperationalArguments(name, complete) : validateArguments(name, complete);
  return { kind: "query", name, args: complete, language: nlu.language, ...(internal ? { operational: true as const } : {}) };
}
