import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../../database/migrations/115_whatsapp_internal_stage_b_source_aware_count.sql', import.meta.url), 'utf8');
const executable = sql.replace(/^--.*$/gm, '');
const m116 = readFileSync(new URL('../../../database/migrations/116_whatsapp_stage_b_core_acl_hardening.sql', import.meta.url), 'utf8');
const m116Executable = m116.replace(/^--.*$/gm, '');

const core = executable.slice(
  executable.indexOf('create function public.whatsapp_internal_stage_b_lr_vehicle_count_v2'),
  executable.indexOf('-- Webhook entry point.'),
);
const begin = executable.slice(
  executable.indexOf('create function public.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2'),
  executable.indexOf('revoke all on function public.whatsapp_internal_stage_b_lr_vehicle_count_v2'),
);

test('M115 adds two versioned Stage-B functions without replacing legacy entry points', () => {
  assert.match(core, /create function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(\s*p_app_user_id uuid,\s*p_source text,\s*p_semantics jsonb/s);
  assert.match(begin, /create function public\.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2\(\s*p_app_user_id uuid,\s*p_sender_phone_e164 text,\s*p_event_id bigint,\s*p_source text,\s*p_semantics jsonb/s);
  assert.doesNotMatch(executable, /create or replace function public\.whatsapp_internal_operational_(?:query|begin)\b/);
  assert.doesNotMatch(executable, /create function public\.whatsapp_internal_operational_(?:query|begin)\b/);
});

test('M115 is a bounded fixed count-only service-role contract', () => {
  assert.equal((executable.match(/security definer/g) ?? []).length, 2);
  assert.equal((executable.match(/language plpgsql volatile security definer/g) ?? []).length, 2);
  assert.equal((executable.match(/set search_path = ''/g) ?? []).length, 2);
  assert.equal((executable.match(/set statement_timeout = '5s'/g) ?? []).length, 2);
  assert.match(core, /octet_length\(p_source\) not between 1 and 1024/);
  assert.match(core, /v_token_count not between 1 and 48/);
  assert.match(core, /v_i \+ 11/);
  assert.match(core, /select count\(\*\) into v_total/);
  assert.match(core, /coalesce\(l\.entry_status,'final'\)='final'/);
  assert.match(core, /coalesce\(l\.status,''\) <> 'Cancelled'/);
  assert.match(core, /'operation','lr_vehicle_count','total_count',v_total/);
  assert.doesNotMatch(core, /execute\s+immediate|format\s*\(/i);
  assert.doesNotMatch(core, /order by .*p_|limit .*p_|offset .*p_/i);
});

test('M115 authorizes before protected reads and binds the webhook event', () => {
  const auth = core.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')");
  const reads = core.indexOf('from public.lrs l join public.customers c');
  assert.ok(auth >= 0 && reads > auth);
  assert.match(begin, /public\.whatsapp_inbound_events e/);
  assert.match(begin, /public\.whatsapp_user_links w/);
  assert.match(begin, /e\.app_user_id=p_app_user_id[^]*e\.sender_phone_e164=p_sender_phone_e164[^]*processing_status='authorized'/);
  assert.match(begin, /w\.whatsapp_phone_e164=p_sender_phone_e164/);
  assert.match(begin, /whatsapp_assistant_has_permission\(p_app_user_id,'lr'\)/);
});

test('M115 uses only the historical LR-linked stable-ID universe, never unrestricted Customer Master', () => {
  const universe = core.slice(core.indexOf('historical_representations as materialized'), core.indexOf('), matched as materialized'));
  assert.match(universe, /from public\.lrs l join public\.customers c on c\.id=l\.consignor_id/);
  assert.match(universe, /from public\.lrs l join public\.customers c on c\.id=l\.consignee_id/);
  assert.match(universe, /l\.consignor_id is not null/);
  assert.match(universe, /l\.consignee_id is not null/);
  assert.doesNotMatch(universe, /from public\.customers c\s+where/i);
  assert.doesNotMatch(universe, /lr_date|podState|minPendingDays|created_at|status\s*=/i);
  assert.match(core, /NULL-only snapshots invent none/);
});

test('M115 classifies complete server-owned semantic intervals before matching', () => {
  const classified = core.slice(core.indexOf('classified_spans as materialized'), core.indexOf('), matched as materialized'));
  assert.match(classified, /is_reserved_semantic/);
  assert.match(classified, /'how many','number of','count','total'/);
  assert.match(classified, /'load hua','load hui','load hue'/);
  assert.match(classified, /'last month','last mnth',\s*'previous month'/);
  assert.match(classified, /lower\(trim\(regexp_replace\(s\.source_text, '\[\^A-Za-z0-9\]\+', ' ', 'g'\)\)\)/);
  assert.doesNotMatch(classified, /periodEvidence|countEvidence|movementEvidence/);
});

test('M115 uses strict full normalized equality for reserved intervals and M107 only otherwise', () => {
  const matched = core.slice(core.indexOf('classified_spans as materialized'), core.indexOf('), identity_bounds as materialized'));
  assert.match(matched, /case when s\.is_reserved_semantic then/);
  assert.match(matched, /lower\(trim\(regexp_replace\(h\.representation, '\[\^A-Za-z0-9\]\+', ' ', 'g'\)\)\) = s\.normalized_text/);
  assert.match(matched, /else public\.whatsapp_internal_name_match\(h\.representation,s\.source_text\)/);
  assert.doesNotMatch(matched, /left\(|starts_with|substring|similar to|<@|levenshtein/);
  assert.ok(matched.indexOf('is_reserved_semantic') < matched.indexOf('whatsapp_internal_name_match'));
});

test('M115 preserves date-like-company overlap policy and semantic collision regressions', () => {
  for (const source of [
    'last month total vehicles for ACC Wadi',
    'how many vehicles for Last Month Transport',
    'how many vehicles for Previous Month Logistics',
    'last month total vehicles for Last Month Transport',
  ]) assert.match(source.toLowerCase(), /(?:last|previous) month/);
  assert.match(core, /v_period_overlaps_entity/);
  assert.match(core, /if v_period_overlaps_entity <> 0 then/);
  assert.match(core, /v_count_evidence|v_movement_evidence/);
});

test('M115 keeps full longer semantic-word company spans on normal discovery path', () => {
  for (const source of ['Total Transport','Vehicle Logistics','How Many Transport']) {
    assert.doesNotMatch(source.toLowerCase(), /^(?:how many|number of|count|total|vehicle|vehicles|load hua|load hui|load hue|last month|previous month)$/);
  }
  assert.match(core, /else public\.whatsapp_internal_name_match\(h\.representation,s\.source_text\)/);
  assert.match(core, /limit 6 -- retain at most six identities/);
});

test('M115 requires exactly one stable identity and rejects unsafe source interpretation before final count', () => {
  assert.match(core, /jsonb_array_length\(v_identities\) <> 1/);
  assert.match(core, /has_disjoint_spans/);
  assert.match(core, /identity_bounds as materialized/);
  assert.match(core, /from matched m join identity_bounds p on p\.entity_id=m\.entity_id and p\.max_tokens=m\.token_count/);
  assert.match(core, /from maximal a join maximal b/);
  assert.match(core, /maximal_span_count/);
  assert.match(core, /v_count_end >= v_entity_start/);
  assert.match(core, /Every lexical token must be explained/);
  assert.match(core, /'for','to','ka','ki','k','ke liye','k liye','me','mein'/);
  assert.doesNotMatch(core, /'the','of','and','or','also','then'/);
  assert.match(core, /v_previous_end = 0/);
  assert.match(core, /v_gap_words <> ''/);
});

test('M115 retains at most six identities and fails closed on a seventh identity', () => {
  assert.match(core, /count\(\*\) over\(\) as identity_count/);
  assert.match(core, /limit 6 -- retain at most six identities/);
  assert.match(core, /coalesce\(bool_or\(identity_count > 6\),false\)/);
  assert.match(core, /if v_identity_overflow or jsonb_array_length\(v_identities\) <> 1 then/);
  assert.doesNotMatch(core, /limit 7/);
});

test('M115 treats every recognized Stage-B date phrase inside an entity as an ambiguity', () => {
  const dateAliases = ['last month', 'previous month', 'this month', 'today', 'yesterday', 'pichle mahine'];
  for (const alias of dateAliases) assert.ok(core.includes(`'${alias}'`), `missing date detector alias: ${alias}`);
  assert.match(core, /v_period_overlaps_entity/);
  assert.match(core, /where \(value->>'finish'\)::integer >= v_entity_start and \(value->>'start'\)::integer <= v_entity_end/);
  assert.match(core, /if v_period_overlaps_entity <> 0 then/);
  // Static tripwires for the production-shaped source forms. PostgreSQL
  // execution remains a Gate-D responsibility.
  for (const source of ['how many vehicles for Last Month Transport', 'how many vehicles for Previous Month Logistics']) {
    assert.match(source.toLowerCase(), /(?:last|previous) month/);
  }
});

test('M115 source-span JSON shape exactly matches jsonb_to_recordset fields', () => {
  assert.match(core, /'start_pos',v_span_start,'finish_pos',v_span_end,'token_count',v_j-v_i\+1,\s*'source_text',substring/s);
  assert.match(core, /jsonb_to_recordset\(v_entity_spans\) as s\(start_pos integer, finish_pos integer, token_count integer, source_text text\)/);
});

test('M115 independently verifies semantic evidence, period provenance and parenthesis safety', () => {
  assert.match(core, /v_count_hits <> 1 or v_movement_hits <> 1/);
  assert.match(core, /v_period_kind is not null and v_period_hits <> 1/);
  assert.match(core, /v_period_kind is null and v_index <> 0/);
  assert.match(core, /v_char='\('/);
  assert.match(core, /v_parenthesis_depth <> 0/);
  assert.match(core, /v_parenthesis_has_content/);
  assert.match(core, /non-ASCII text \(including Devanagari\)/);
});

test('M115 is read-only and explicitly private to service_role', () => {
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+(?:table|index|trigger|policy)|drop\s+)/i);
  for (const signature of [
    'public.whatsapp_internal_stage_b_lr_vehicle_count_v2(uuid,text,jsonb)',
    'public.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2(uuid,text,bigint,text,jsonb)',
  ]) {
    assert.ok(executable.includes(`revoke all on function ${signature} from public, anon, authenticated`));
  }
  assert.doesNotMatch(executable, /grant execute on function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(uuid,text,jsonb\) to service_role/);
  assert.match(executable, /grant execute on function public\.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2\(uuid,text,bigint,text,jsonb\) to service_role/);
  assert.equal((executable.match(/grant execute on function/g) ?? []).length, 1);
  assert.doesNotMatch(executable, /message_text|raw_payload|model_instruction|execute immediate/i);
});

test('M116 records the explicit core service_role ACL correction without changing defaults or begin access', () => {
  assert.match(m116Executable, /begin;[\s\S]*revoke execute\s+on function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(uuid,text,jsonb\)\s+from service_role;[\s\S]*commit;/i);
  assert.doesNotMatch(m116Executable, /grant execute/i);
  assert.doesNotMatch(m116Executable, /alter default privileges|default privileges/i);
  assert.doesNotMatch(m116Executable, /whatsapp_internal_stage_b_lr_vehicle_count_begin_v2/);
  assert.doesNotMatch(m116Executable, /create or replace function|create function|alter function|drop function/i);
  assert.doesNotMatch(m116Executable, /insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+(?:table|index|trigger|policy)|drop\s+/i);
});

test('M115 plus M116 explicitly preserve the intended ACL boundary', () => {
  assert.match(executable, /revoke all on function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(uuid,text,jsonb\) from public, anon, authenticated/);
  assert.match(executable, /grant execute on function public\.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2\(uuid,text,bigint,text,jsonb\) to service_role/);
  assert.match(m116Executable, /revoke execute\s+on function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(uuid,text,jsonb\)\s+from service_role/i);
  assert.doesNotMatch(m116Executable, /grant execute on function public\.whatsapp_internal_stage_b_lr_vehicle_count_v2\(uuid,text,jsonb\)/i);
});
