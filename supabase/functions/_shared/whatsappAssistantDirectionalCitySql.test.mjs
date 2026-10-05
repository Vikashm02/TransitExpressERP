import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../../database/migrations/112_whatsapp_internal_directional_city_resolution.sql', import.meta.url), 'utf8');
const executable = sql.replace(/^--.*$/gm, '');
const resolver = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_entity_candidates'), executable.indexOf('create or replace function public.whatsapp_internal_operational_query'));

test('M112 independently discovers directional stable city identities', () => {
  assert.match(resolver, /p_role = 'originCity' and l\.consignor_id is not null and c\.id = l\.consignor_id/);
  assert.match(resolver, /p_role = 'destinationCity' and l\.consignee_id is not null and c\.id = l\.consignee_id/);
  assert.equal((resolver.match(/lower\(trim\(c\.city\)\) = lower\(trim\(p_reference\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(resolver, /opposite|destinationCity' is null or exists|originCity' is null or exists/);
  assert.doesNotMatch(resolver, /originCity[^]*?l\.consignor_id is null|destinationCity[^]*?l\.consignee_id is null/);
});

test('M112 keeps stable-ID ambiguity and M109 legacy final matching', () => {
  assert.match(resolver, /group by case when c\.effective_role='partySearch'.*c\.entity_id, c\.grouping_key/s);
  assert.match(executable, /l\.consignor_id=\(resolved->'consignor'->>'entity_id'\)::bigint or \(l\.consignor_id is null and lower\(trim\(l\.consignor\)\)=lower\(trim\(resolved->'consignor'->>'label'\)\)\)/);
  assert.match(executable, /l\.consignee_id=\(resolved->'consignee'->>'entity_id'\)::bigint or \(l\.consignee_id is null and lower\(trim\(l\.consignee\)\)=lower\(trim\(resolved->'consignee'->>'label'\)\)\)/);
});

test('M112 pending state is bounded, private, ownership-bound and atomic', () => {
  assert.match(executable, /expires_at timestamptz not null default \(clock_timestamp\(\) \+ interval '10 minutes'\)/);
  assert.match(executable, /unique index whatsapp_internal_pending_resolution_active_unique/);
  assert.match(executable, /for update/);
  assert.match(executable, /consumed_by_event_id=p_event_id/);
  assert.match(executable, /e\.app_user_id=p_app_user_id[^]*e\.sender_phone_e164=p_sender_phone_e164[^]*processing_status='authorized'/);
  assert.match(executable, /w\.app_user_id=p_app_user_id and w\.is_active[^]*w\.whatsapp_phone_e164=p_sender_phone_e164/);
  assert.match(executable, /whatsapp_internal_entity_candidates\([^]*c\.entity_id=\(v_option->>'entity_id'\)::bigint/);
  assert.match(executable, /alter table public\.whatsapp_internal_pending_resolutions enable row level security/);
  assert.match(executable, /revoke all on table public\.whatsapp_internal_pending_resolutions from public, anon, authenticated/);
  assert.match(executable, /grant all on table public\.whatsapp_internal_pending_resolutions to service_role/);
});

test('M112 preserves function security and contains no business-data mutation', () => {
  assert.equal((executable.match(/security definer/g) ?? []).length, 4);
  assert.equal((executable.match(/set search_path = ''/g) ?? []).length, 4);
  assert.equal((executable.match(/set statement_timeout = '5s'/g) ?? []).length, 4);
  assert.doesNotMatch(executable, /\b(?:update|delete from|insert into)\s+public\.(?:lrs|customers|pods|materials)\b/i);
  assert.doesNotMatch(executable, /\b(?:drop|truncate)\b/i);
  for (const signature of [
    'public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb)',
    'public.whatsapp_internal_operational_query(uuid,text,jsonb)',
    'public.whatsapp_internal_operational_begin(uuid,text,bigint,text,jsonb)',
    'public.whatsapp_internal_operational_continue(uuid,text,bigint,text)',
  ]) {
    assert.ok(executable.includes(`revoke all on function ${signature} from public, anon, authenticated`));
    assert.ok(executable.includes(`grant execute on function ${signature} to service_role`));
  }
});

test('M112 stores only an allowlisted plan, private IDs and at most two directional issues', () => {
  assert.match(executable, /operation text not null check \(operation in \('search_lrs','search_pending_pods','get_lr_detail','get_pod_detail'\)\)/);
  assert.match(executable, /jsonb_array_length\(issues\) between 1 and 2/);
  assert.match(executable, /v_issue->>'field' not in \('originCity','destinationCity'\)/);
  assert.match(executable, /'continuation_ready',true/);
  assert.match(executable, /v_pending\.filters - array\['resolvedOriginCustomerId','resolvedDestinationCustomerId'\]/);
  assert.doesNotMatch(executable, /message_text|raw_payload|model_instruction|arbitrary_sql/);
});
