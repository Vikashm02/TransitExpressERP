import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const m109 = read('../../../database/migrations/109_whatsapp_internal_legacy_entity_resolution.sql');
const m110 = read('../../../database/migrations/110_whatsapp_internal_entity_candidates_ambiguity_fix.sql');
const executable = m110.replace(/--[^\n]*/g, '');
const resolver = sql => {
  const start = sql.indexOf('create or replace function public.whatsapp_internal_entity_candidates');
  const end = sql.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start, 'resolver definition must be complete');
  return sql.slice(start, end + 3);
};

test('M109 remains byte-identical historical migration', () => {
  assert.equal(createHash('sha256').update(m109).digest('hex'), '852e9b5fc58858aa663f4adc2923a4069877a987465830b54c50fc041dd4e120');
});

test('M110 replaces only the entity candidate resolver', () => {
  assert.equal((executable.match(/create\s+or\s+replace\s+function public\./gi) ?? []).length, 1);
  assert.match(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_entity_candidates\(\s*p_app_user_id uuid, p_role text, p_reference text, p_filters jsonb\s*\)/i);
  assert.doesNotMatch(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_operational_query/i);
  assert.doesNotMatch(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_name_match/i);
  assert.match(executable, /^\s*begin;/i);
  assert.match(executable, /commit;\s*$/i);
});

test('M110 preserves resolver execution and security contract', () => {
  const definition = resolver(m110);
  assert.match(definition, /returns table\(role text, entity_id bigint, label text\)/i);
  assert.match(definition, /language plpgsql stable security definer/i);
  assert.match(definition, /set search_path = ''/i);
  assert.match(definition, /set statement_timeout = '5s'/i);
  assert.ok(definition.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < definition.indexOf('from public.lrs'));
  assert.match(definition, /limit 6;/i);
});

test('M110 has no data, schema, trigger, RLS, or policy mutation', () => {
  for (const forbidden of [
    /\binsert\s+into\b/i, /\bupdate\s+public\b/i, /\bdelete\s+from\b/i, /\btruncate\b/i,
    /\bdrop\b/i, /\balter\s+table\b/i, /\bcreate\s+table\b/i, /\bcreate\s+index\b/i,
    /\bcreate\s+policy\b/i, /\b(?:create|drop)\s+trigger\b/i, /\b(?:alter|drop)\s+policy\b/i,
    /row\s+level\s+security/i,
  ]) assert.doesNotMatch(executable, forbidden);
});

test('M110 reasserts the exact resolver ACL only', () => {
  const signature = 'public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb)';
  assert.ok(executable.includes(`revoke all on function ${signature} from public, anon, authenticated;`));
  assert.ok(executable.includes(`grant execute on function ${signature} to service_role;`));
  assert.equal((executable.match(/revoke all on function public\./gi) ?? []).length, 1);
  assert.equal((executable.match(/grant execute on function public\./gi) ?? []).length, 1);
  assert.doesNotMatch(executable, /grant execute on function public\.[^;]+ to (?:public|anon|authenticated)/i);
});

test('stable_party_groups explicitly qualifies every colliding output-variable name', () => {
  const definition = resolver(m110);
  const start = definition.indexOf('stable_party_groups as materialized');
  const end = definition.indexOf('canonical_candidates as materialized', start);
  const stableGroups = definition.slice(start, end);
  assert.match(stableGroups, /select mc\.effective_role, lower\(trim\(mc\.label\)\)/);
  assert.match(stableGroups, /count\(distinct mc\.entity_id\)/);
  assert.match(stableGroups, /min\(mc\.entity_id\)/);
  assert.match(stableGroups, /min\(trim\(mc\.label\)\)/);
  assert.match(stableGroups, /from matched_candidates mc/);
  assert.match(stableGroups, /where mc\.role in/);
  assert.match(stableGroups, /mc\.entity_id is not null/);
  assert.match(stableGroups, /group by mc\.effective_role, lower\(trim\(mc\.label\)\)/);
  assert.doesNotMatch(stableGroups, /select\s+effective_role\b/i);
  assert.doesNotMatch(stableGroups, /(?<!\.)\blower\(trim\(label\)\)/i);
  assert.doesNotMatch(stableGroups, /(?<!\.)\bcount\(distinct entity_id\)/i);
});

test('resolver body has no unqualified role, entity_id, or label references', () => {
  const definition = resolver(m110);
  const body = definition.slice(definition.indexOf('as $$') + 5, definition.lastIndexOf('$$;'))
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\bas\s+(?:role|entity_id|label)\b/gi, 'as output_alias');
  assert.deepEqual(body.match(/(?<![.\w])(?:role|entity_id|label)(?!\w)/gi) ?? [], []);
});

test('M110 resolver is byte-equivalent to M109 after removing only mc qualifications', () => {
  const normalizedM110 = resolver(m110)
    .replace(/\bmc\.(effective_role|label|entity_id|role)\b/g, '$1')
    .replace(/from matched_candidates mc/g, 'from matched_candidates');
  assert.equal(normalizedM110, resolver(m109));
});
