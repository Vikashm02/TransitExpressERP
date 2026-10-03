# Internal WhatsApp operational query — local review boundary

This document originated as pre-production implementation preparation. The adjacent SQL
is preserved byte-for-byte as the historical review artifact described below; its original
`REVIEW ONLY / UNNUMBERED / NOT EXECUTED` header records its state at review time.
No existing migration is changed.

**Historical artifact preservation:** `database/review/whatsapp_internal_operational_query.sql` is intentionally preserved byte-for-byte as historical audit evidence; its `REVIEW ONLY / UNNUMBERED / NOT EXECUTED` header records its state at review time. After separate PostgreSQL rehearsal, explicit approval, and post-application verification, that exact SQL (from `begin;` onward) was manually applied and verified in the current production database. The numbered repository representation is now `database/migrations/107_whatsapp_internal_operational_query.sql` (executable body identical from `begin;` onward). **Do not reapply M107 to the current production database** — its three plain `CREATE FUNCTION` objects already exist there. Fresh environments apply M107 once in normal migration order after its prerequisites.

## Runtime boundary

- Existing internal sender mapping, approval, lock, exclusion, and ERP permission
  checks remain unchanged. External routing, tools, grants and RPCs are unchanged.
- The existing legacy schema stays final-only. The separate internal schema allows
  explicit draft; null continues to mean final. No default draft visibility.
- NLU returns source wording, never IDs. Complete source entities are protected
  before aliases/date canonicalization. Unknown qualifiers fail closed.
- A successful internal NLU plan executes directly, with no second model call.
  Deterministic queries retain their existing bounded mirror/strict-plan check.
- The internal operational wrapper calls one fixed RPC with a server-bound ERP
  user ID. That single request contains permission checks, resolution and at most
  one answer query. No retry or external fallback. No ERP result goes to OpenAI.
- LR count means movements, not distinct vehicle registrations. Weight uses
  lrs.loading_weight (MT), never freight/charged weight. Unloading uses only
  pods.unloading_weight; missing/zero-default legacy POD weight is not recorded.

## SQL impact and limitations

Adds only three functions with empty search paths and explicit service-role-only
execution grants. No existing function replacement, table/column/policy/index
change, mapping change, INSERT/UPDATE/DELETE, historical backfill or extension.

The empty-search-path pattern is present in M095/M096. M097-M099 were inspected
and retain the older public-inclusive path; they are unchanged. M100, M101 and M104
historical sources have been restored in this checkout and remain unchanged by M107;
no comparison of M101's restored source to an independently extracted production
definition is claimed here. All project relations and helper calls in the operational SQL
are explicitly public-qualified; CTE names are local query bindings.

Existing whatsapp_assistant_has_permission is checked independently in resolver
and answer RPC. POD requests require LR and POD permission. Resolution returns
before the answer query if any entity is missing or ambiguous; at most five real
role/name options are displayed. Internal identifiers never leave the answer RPC.

Customer IDs from M100 are used when available. Legacy internal NULL-ID rows may
still resolve by their own snapshots; this does not change external NULL-ID rules.
Material names are joined to Material Master; LR material filtering uses the
existing snapshot because this reviewed source does not establish an applied
M102 material_id baseline. Transporter and branch references use actual LR text.
There is no database branch master in the reviewed schema. No branches are coded
into NLU. No fields or behavior depend on M102/M103.

Candidate resolution is bounded to six matches (five display options) and to the
requested basic LR scope. It accepts case/punctuation differences and token order.
A matching unit can join at most two adjacent alphabetic words on either side,
so compound words can be written joined, hyphenated or spaced. Reference units
must cover the entire reference. This is not arbitrary substring matching or
unbounded removal of spaces. Only single alphabetic words permit prefixes of
four or more characters; matched alphabetic units of at least five characters
permit at most one spelling edit. Digit-bearing tokens are exact-only, including
prefixes; they cannot be joined across boundaries. Explicit vehicle suffix
resolution remains a separate exact-last-four rule. Token counts are capped at
128 candidate words / 32 reference words, in addition to character bounds.
Multiple plausible identities always clarify; there is no model-selected winner.
A location route resolves loading/delivery parties; explicitly labelled source
and destination cities request station aggregates. Bare direction can also be a
branch, and conflicting roles clarify. Unlabelled references do not default to
party. Separate explicit party search can match either party for one resolved
identity.

Consequences requiring review:

- No candidate in the requested period/status scope clarifies, including entities
  that exist in a master but have no LR evidence in that scope. It does not guess
  a mapping or issue a broad query.
- Names shared across multiple legacy snapshots or IDs can clarify conservatively.
- Fuzzy SQL and planner behavior have NOT been execution-tested. Static contract
  checks and mocked envelopes do not prove PostgreSQL correctness or permissions.
- Resolver scans, counts and sums may be expensive. LIMIT 6 caps candidate output,
  not scanned rows. DISTINCT/order and repeated candidate searches can evaluate the
  matcher many times. The bounded two-word comparison adds CPU cost; no index or
  query-plan performance claim is made without rehearsal. Both SECURITY DEFINER
  functions retain SET statement_timeout='5s'; a function-level setting must not
  be assumed to establish a reliable current-statement cancellation deadline.
  The SQL setting and HTTP abort need rehearsal; HTTP cancellation does not
  guarantee DB cancellation.
- New runtime capabilities fail unavailable if the operational RPC is absent. There
  is intentionally no fallback that could drop filters or broaden scope.
- Explicit roles currently still require unique resolver evidence. This is safer
  than guessing partial names but can clarify where an exact aggregate was meant.
- Language remains a bounded compositional grammar under strict provenance.
  Unrecognized wording, unsupported comparisons, unsafe bare months, unique-vehicle
  counts and unresolved conversational references clarify. This is not a promise
  of accepting arbitrary Hindi/English/Hinglish wording.

## Phone management deliberately isolated

M097 already provides private whatsapp_user_links (phone, ERP user, active flag,
audit fields). It has no LR/POD per-phone capability columns and grants no browser
access. StaffPermissionsDialog manages ERP module permissions, not phone mappings.
There is no existing secure internal mapping-management RPC/UI in this source.

No duplicate table, browser service-role access, mapping UI or fake scope toggles
were added. Per-phone module restrictions require a separately reviewed additive
schema/authorization contract and authenticated admin boundary that mirrors staff
management permissions and preserves M101 phone reservations. The M101 source
is now restored in this checkout and remains unchanged by this change; per-phone
management work remains explicitly separate and is not included here. Existing
mappings remain governed by existing ERP access.

## Validation meaning

Node mocked tests cover source provenance, strict schemas, trusted identity,
filter propagation, one-call behavior, ambiguity envelopes, privacy, actual POD
weight handling and unchanged webhook/external routing. The SQL test file is static:
it reads `database/review/whatsapp_internal_operational_query.sql` and
`database/migrations/107_whatsapp_internal_operational_query.sql`, verifies the
historical artifact SHA-256 is `aa27be2115fa0af0f1a3b4c8e3c1c76e68785fb2b8beb0b533ba3408138583cf`, verifies the executable `begin;` onward bodies are byte-for-byte identical, and checks security structure; its normalization regressions run an explicitly labelled JavaScript algorithm specification with structural checks for the corresponding SQL rules. It does not execute PL/pgSQL, does not prove PostgreSQL collation/engine equivalence, does not touch any database or production, and does not install dependencies. Separate isolated PostgreSQL 17.11 rehearsal was completed successfully as described below. Current integrated validation already completed: the operational SQL contract suite now has 20/20 passing tests, `production npm run build` passed, standalone `node_modules/.bin/tsc --noEmit` passed, and `git diff --check` passed.

## Continuation performance review (no SQL execution)

The resolver now materializes only the ten fields needed for candidate discovery.
Each UNION branch has an early role predicate, avoiding unrelated customer/material
branches for explicit role requests. Distinct role/ID/label/search-text tuples are
materialized before the expensive matcher. Every location/search variant and every
identity remains present; no early row cap can hide ambiguity. Final DISTINCT and
LIMIT 6 still apply after matching. These changes reduce repeated matching work,
not the size of the underlying authorized LR scope.

Repository migrations provide LR date, vehicle, status, consignor/consignee and
entry-status indexes, customer primary-key/name/city indexes, material primary-key
and name indexes, and a POD LR-number index/unique index. Existing production
catalog and M100/M101/M104 sources were reviewed during this work; no new index
was considered warranted at the current small data volume. Ordinary indexes do not automatically accelerate expressions such
as coalesce(entry_status,'final'), lower(trim(material_name)) or vehicle suffixes.

Date predicates are pushed into the LR scope before candidate matching. No-date
requests may still scan all eligible LRs. Multiple entity dimensions independently
repeat that scoped scan. POD EXISTS can use the LR-number index, but counts/sums
must still read all qualifying rows. Materialized CTEs can spill; deduplication adds
sort/hash work. No performance budget is proven without PostgreSQL EXPLAIN and
representative synthetic volume testing. Do not cap rows before ambiguity detection.

Separately reviewable index candidates (NOT included in executable SQL):

- materials on (lower(btrim(material_name))) for the current snapshot-name join.
- lrs on ((coalesce(entry_status,'final')), lr_date) for final/draft date scopes.
- lrs on ((coalesce(entry_status,'final')), created_at) for creation-date scopes.

Verify existing production indexes and representative plans before selecting any.
Each adds storage/write overhead; building against a large production table needs
its own reviewed lock/concurrent-build procedure. No index solves arbitrary bounded
fuzzy matching or full-history aggregation. A vehicle suffix index is not proposed
until its predicate can be shown to reach the base-table scan.

Isolated PostgreSQL 17.11 rehearsal completed successfully: cluster at `/tmp/transjit-whatsapp-rehearsal-pg17`, socket `/tmp/transjit-whatsapp-rehearsal-socket`, port `55439`, TCP disabled; the exact reviewed operational SQL was applied successfully locally; core behavior checks were 5/5 PASS and authorization/security runtime checks were 7/7 PASS; a representative 430-LR execution measured about 8 ms and the rehearsal fixture rollback restored the test state. This ~8 ms measurement is representative only and is not a general performance guarantee. The `statement_timeout='5s'` function setting was exercised during rehearsal but was not exhaustively proven as a hard deadline in this review. Date ranges remain ordered and input bounded, but there is no maximum requested date span; no-date/all-history requests are allowed.

The separate phone-management proposal is in whatsapp_internal_phone_management.md.
