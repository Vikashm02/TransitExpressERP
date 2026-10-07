import { RELATIVE_MONTH_PHRASE_PATTERN } from "./whatsappAssistantDateLanguage.ts";

// Composable source grammar for INTERNAL entities. No database identity, master
// spelling, branch name, or example sentence is embedded here. Model-selected
// roles are compared with this source evidence before any resolver is invoked.
export const INTERNAL_ENTITY_KEYS = ["consignor", "consignee", "partySearch", "material", "bookingBranch", "fromStation", "toStation", "entitySearch", "originSearch", "destinationSearch", "transporter", "vehicleNumber"] as const;
// Reused by the parser after entity extraction and by the bounded directional
// suffix boundary below. New movement wording must be reviewed in one place.
export const VEHICLE_COUNT_MOVEMENT_PATTERN = "(?:was|were)\\s+loaded|loaded\\s+(?:hua|hue|hui)|loaded|went|(?:load|lode)\\s+(?:hua|hue|hui)|load|lode|laga\\s+tha|lagi\\s+thi|lage|lagi|laga|gaye|gaya|gayi|लगी|लगा|गई";
export const VEHICLE_COUNT_WORD_PATTERN = "kitna|kitne|kitni|kitha";
export const VEHICLE_WORD_PATTERN = "gaadi|gadi|gari";
// A bare `kal` is never a date. Only a complete count with an explicit
// past/completed movement predicate can establish yesterday.
export const PAST_KAL_MOVEMENT_PATTERN = `kal\\s+(?:${VEHICLE_COUNT_WORD_PATTERN})\\s+(?:${VEHICLE_WORD_PATTERN})\\s+(?:(?:load|lode)\\s+(?:hua|hue|hui)|loaded(?:\\s+(?:hua|hue|hui))?)`;
const boundary = `[\\p{L}\\p{M}\\p{N}_]`;
const token = (s: string) => new RegExp(`(?<!${boundary})(?:${s})(?!${boundary})`, "giu");
const acceptedDirectionalConjunction = `(?:k|ke)\\s+liye`;
const fallbackSafetyDirectionalConjunction = `(?:k|ke)[\\s./,&:;_\\-]*liye`;
export function hasDirectionalMarkerForFallbackSafety(value: string): boolean {
  return token(fallbackSafetyDirectionalConjunction).test(value);
}
const labels: Record<string, string> = {
  "consignor|sender|loading party|प्रेषक": "consignor",
  "consignee|receiver|delivery party|प्राप्तकर्ता": "consignee",
  "party|पार्टी": "partySearch", "material|सामग्री": "material",
  "booking branch|branch|शाखा": "bookingBranch",
  "from station|source city|source|origin city": "fromStation",
  "to station|destination city|destination": "toStation",
  "transporter|vendor": "transporter",
};
const stops = `k|ke|ka|ki|liye|mein|me|se|to|for|in|on|from|के|का|की|में|से|तक|lrs?|pods?|gaadi|gadi|gari|truck|vehicle|kitne|kitni|kitna|kitha|how|count|show|list|dikhao|batao|pending|present|drafts?|final|status|created|creation|last|this|today|yesterday|consignor|consignee|material|party|branch|booking|source|destination|transporter|vendor|कितने|कितनी|गाड़ी`;
const entity = `("[^"\\r\\n]+"|'[^'\\r\\n]+'|[\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N} .&/-]*?)`;
// A suffix directional span must begin at a plausible entity, not at the
// count phrase that can naturally precede it in Hinglish word order.
const directionalEntity = `(?!(?:${VEHICLE_COUNT_WORD_PATTERN}|कितने|कितनी|${VEHICLE_WORD_PATTERN}|truck|vehicle|गाड़ी|वाहन|how|count)(?!${boundary}))${entity}`;
const dateMask = "\uE000";
const end = `(?=\\s+(?:${stops})(?!${boundary})|\\s*${dateMask}|$|[,?!])`;
// The generic entity boundary remains narrow. This is used only after an
// explicit directional suffix and permits reviewed movement predicates.
const directionalMovementEnd = `(?=\\s+(?:${VEHICLE_COUNT_MOVEMENT_PATTERN})(?!${boundary})|\\s+abhi\\s+tak\\s+(?:${VEHICLE_COUNT_WORD_PATTERN})\\s+(?:${VEHICLE_WORD_PATTERN})\\s+(?:laga|lagi|load|lode|loaded)(?!${boundary})|\\s+(?:${stops})(?!${boundary})|\\s*${dateMask}|$|[,?!])`;
function clean(raw: string): string {
  const value = raw.replace(/^["']|["']$/g, "").trim();
  if (!value || value.length > 200 || /[%_\\\p{Cc}\p{Cf}]/u.test(value)) throw new Error("nlu_entity");
  return value;
}
export function extractInternalEntities(input: string): { source: string; fields: Record<string, string> } {
  let source = input;
  const fields: Record<string, string> = {};
  const unlabelled = (raw: string) => {
    const value = clean(raw);
    if (/^kal$/iu.test(value)) return false;
    return !new RegExp(`^(?:${stops}|abhi\\s+tak|total|open|delivered|cancelled|canceled|billed|us|that|those|all|sab)(?!${boundary})`, "iu").test(value);
  };
  const put = (key: string, value: string) => {
    if (Object.hasOwn(fields, key)) throw new Error("duplicate_entity");
    fields[key] = clean(value);
  };
  // Labels are evidence of role, not mere proximity of a model-chosen value.
  for (const [label, key] of Object.entries(labels)) {
    source = source.replace(new RegExp(`(?<!${boundary})(?:${label})\\s*[:=]?\\s*${entity}${end}`, "giu"), (whole, value) => {
      if (new RegExp(`^(?:${stops})(?!${boundary})`, "iu").test(value)) return whole;
      put(key, value); return " ".repeat(whole.length);
    });
  }
  source = source.replace(token("[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}"), value => { put("vehicleNumber", value.toUpperCase()); return " ".repeat(value.length); });
  source = source.replace(/\b(?:vehicle\s+(\d{4})|(\d{4})\s+(?:gaadi|gadi|vehicle))\b/giu, (whole,a,b) => { put("vehicleNumber",a ?? b); return " ".repeat(whole.length); });
  // "X ke account mein" is a generic LR reference ONLY inside this complete,
  // past-tense movement count. It never establishes a party role or billing query.
  source = source.replace(new RegExp(`^\\s*${entity}\\s+ke\\s+account\\s+mein(?=\\s+${PAST_KAL_MOVEMENT_PATTERN}(?!${boundary}))`, "iu"), (whole, value) => {
    if (!unlabelled(value) || token(`${RELATIVE_MONTH_PHRASE_PATTERN}|today|yesterday|aaj|kal|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}`).test(value)) return whole;
    put("entitySearch", value); return " ".repeat(whole.length);
  });
  // An explicit `station` suffix is the only concise physical-route grammar.
  // Keep station snapshots separate from Customer Master city identity.
  const stationName = `([\\p{L}\\p{M}][\\p{L}\\p{M}\\p{N} .&/-]*?)`;
  source = source.replace(new RegExp(`^\\s*(?:from\\s+)?${stationName}\\s+station\\s+(?:se|से|to)\\s+${stationName}\\s+station(?=\\s|$|[,?!])`, "giu"), (whole, a, b) => {
    put("fromStation", a); put("toStation", b); return " ".repeat(whole.length);
  });
  // A bare single-token route is company-location grammar. It is resolved only
  // against stable directional Customer Master identities with an exact city.
  // Multi-word references continue through the existing party-route resolver.
  const station = `([\\p{L}\\p{M}][\\p{L}\\p{M}\\p{N}&/-]*)`;
  source = source.replace(new RegExp(`^\\s*(?:from\\s+)?${station}\\s+(?:se|से|to)\\s+(?!(?:kitna|kitne|kitni|how|count|gaadi|gadi|lrs?|vehicles?)(?!${boundary}))${station}(?=\\s|$|[,?!])`, "giu"), (whole, a, b) => {
    put("originCity", a); put("destinationCity", b); return " ".repeat(whole.length);
  });
  // At the beginning of a directional reference, "ye mahina X" can be either
  // a date followed by X or the start of a company name. Never drop the prefix.
  if (/^\s*ye\s+mahina\s+[\p{L}\p{M}][\p{L}\p{M}\p{N} .&/-]*?\s+(?:(?:k|ke)\s+liye|ka\s+(?:kitna|kitni|kitha)\s+(?:(?:gaadi|gadi|gari)\s+)?(?:load|lode|loaded))\b/iu.test(source)) throw new Error("ambiguous_date_entity");
  // Do not reinterpret a suffix after a completed movement as a company name
  // beginning with "load hua" (or a trailing fragment of that predicate).
  if (token(`(?:${VEHICLE_COUNT_WORD_PATTERN})\\s+(?:${VEHICLE_WORD_PATTERN})\\s+(?:load|lode|loaded)\\s+(?:hua|hue|hui)\\s+${entity}\\s+${acceptedDirectionalConjunction}`).test(source)) throw new Error("ambiguous_directional_entity");
  // Mask date phrases only in the scan, retaining them verbatim in the source.
  // This allows '<date> <entity> ke ...' without consuming the date as a name.
  const pastKal = token(PAST_KAL_MOVEMENT_PATTERN).test(source);
  let scan = source.replace(token(`${RELATIVE_MONTH_PHRASE_PATTERN}|today|yesterday|aaj|आज|beete kal|बीता कल|${pastKal ? "kal|" : ""}last (?:mnth|year)|this (?:mnth|year)|(?:pichle|pichhle) saal|is saal|इस साल|(?:पिछले) साल|(?:जनवरी|फरवरी|फ़रवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?: \\d{4})?|\\d{4}-\\d{2}-\\d{2}`), s => dateMask.repeat(s.length));
  // Successful extraction deliberately accepts only the reviewed whitespace
  // grammar below. This broader, token-bounded marker is fallback safety only:
  // plausible separator variants must not be swallowed by generic entitySearch.
  const hasDirectionalMarker = hasDirectionalMarkerForFallbackSafety(scan);
  const consume = (pattern: RegExp, callback: (...values: string[]) => void | false) => {
    const matches = [...scan.matchAll(pattern)];
    for (const m of matches) {
      // Never let an entity span consume a masked date (or any hidden source).
      if (m[0].split("").some((_c, j) => scan[m.index! + j] === " " && /\S/u.test(source[m.index! + j] ?? ""))) continue;
      // Pure numeric references belong to LR/vehicle grammars, not parties.
      if (m.slice(1).some(v => /^(?:\d+|LR\s*\d+)$/iu.test(v?.trim() ?? ""))) continue;
      if (callback(...m.slice(1)) === false) continue;
      source = source.slice(0, m.index) + " ".repeat(m[0].length) + source.slice(m.index! + m[0].length);
    }
    scan = scan.split("").map((c, i) => source[i] === " " ? " " : c).join("");
  };
  // A suffix branch label is as explicit as a prefix label.
  consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:booking\\s+)?branch(?!${boundary})(?:\\s+(?:se|से))?`, "giu"), v => put("bookingBranch", v));
  consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:transporter|vendor)(?!${boundary})`, "giu"), v => put("transporter", v));
  // "X k/ke liye" is destination-party grammar, not an unlabelled party
  // search. Keep the postposition out of the value sent to the resolver.
  consume(new RegExp(`(?:^|(?<=\\s))${directionalEntity}\\s+${acceptedDirectionalConjunction}${directionalMovementEnd}`, "giu"), v => put("consignee", v));
  consume(new RegExp(`(?:^|(?<=\\s))${directionalEntity}\\s+के\\s+लिए${directionalMovementEnd}`, "giu"), v => put("consignee", v));
  // The reviewed "X ka kitna [gaadi] load hua" is a distinct, bounded
  // consignee construction. Generic "X ka" continues to be unresolved.
  consume(new RegExp(`(?:^|(?<=\\s))${directionalEntity}\\s+ka(?=\\s+(?:${VEHICLE_COUNT_WORD_PATTERN})\\s+(?:(?:${VEHICLE_WORD_PATTERN})\\s+)?(?:load|lode|loaded)\\s+(?:hua|hue|hui)(?!${boundary}))`, "giu"), v => put("consignee", v));
  // A movement explicitly going to an entity establishes destination-side
  // direction before generic X-to-Y route grammar can inspect the phrase.
  consume(new RegExp(`(?<!${boundary})(?:went|go|going)\\s+to\\s+${entity}${end}`, "giu"), v => { if (!unlabelled(v)) return false; put("destinationSearch", v); });
  // Directional references are unresolved party/location/branch references.
  // Only explicitly labelled source/destination cities request aggregation.
  consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:se|से|to)\\s+${entity}${end}`, "giu"), (a,b) => { if (new RegExp(`^(?:${stops})(?!${boundary})`, "iu").test(b)) return false; put("originSearch",a); put("destinationSearch",b); });
  consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:jane\\s+wali|jaane\\s+wali|जाने\\s+वाली)${end}`, "giu"), v => put("destinationSearch",v));
  consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:se|से)(?=\\s+(?:kitne|kitni|how|count|gaadi|gadi|lrs?|truck|कितने|कितनी))`, "giu"), v => put("originSearch",v));
  const hasDirectionalEntity = () => ["consignor", "consignee", "partySearch", "originSearch", "destinationSearch", "originCity", "destinationCity"]
    .some(key => Object.hasOwn(fields, key));
  // A directional marker may not fall back to generic entitySearch merely
  // because unsupported residual words prevented directional extraction.
  if (!hasDirectionalMarker && !hasDirectionalEntity()) {
    // English in/for wording establishes a generic entity reference. A movement
    // explicitly going to an entity establishes destination-side direction.
    consume(new RegExp(`(?<!${boundary})(?:in|for)\\s+${entity}${end}`, "giu"), v => { if (!unlabelled(v)) return false; put("entitySearch", v); });
    consume(new RegExp(`(?:^|(?<=\\s))${entity}\\s+(?:ke|ka|ki|mein|me|में|के|का|की)(?=\\s+(?:ke|ka|ki|के|का|की|kitne|kitni|kitna|pending|pods?|lrs?|gaadi|gadi|count|show|list|dikhao|कितने|कितनी))`, "giu"), v => { if (!unlabelled(v)) return false; put("entitySearch",v); });
    consume(new RegExp(`(?:^|(?<=\\s))${entity}(?=\\s+(?:kitna|kitni|kitne)(?!${boundary}))`, "giu"), v => { if (!unlabelled(v)) return false; put("entitySearch",v); });
  }
  return { source, fields };
}
