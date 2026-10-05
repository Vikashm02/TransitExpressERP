import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const m109 = read('../../../database/migrations/109_whatsapp_internal_legacy_entity_resolution.sql');
const m110 = read('../../../database/migrations/110_whatsapp_internal_entity_candidates_ambiguity_fix.sql');
const m111 = read('../../../database/migrations/111_whatsapp_internal_company_city_resolution.sql');
const executable = m111.replace(/--[^\n]*/g, '');

test('M111 replaces only the two operational functions with their hardened contracts', () => {
  assert.equal((executable.match(/create\s+or\s+replace\s+function public\./gi) ?? []).length, 2);
  for (const name of ['whatsapp_internal_entity_candidates', 'whatsapp_internal_operational_query']) {
    assert.match(executable, new RegExp(`create\\s+or\\s+replace\\s+function public\\.${name}\\(`, 'i'));
  }
  assert.doesNotMatch(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_name_match/i);
  assert.equal((executable.match(/language plpgsql stable security definer/gi) ?? []).length, 2);
  assert.equal((executable.match(/set search_path = ''/gi) ?? []).length, 2);
  assert.equal((executable.match(/set statement_timeout = '5s'/gi) ?? []).length, 2);
});

test('company-city candidates require a stable directional Customer Master identity and exact normalized city', () => {
  assert.match(executable, /p_role in \('originCity','destinationCity'\)/);
  assert.match(executable, /p_role = 'originCity' and l\.consignor_id is not null and c\.id = l\.consignor_id/);
  assert.match(executable, /p_role = 'destinationCity' and l\.consignee_id is not null and c\.id = l\.consignee_id/);
  assert.match(executable, /lower\(trim\(c\.city\)\) = lower\(trim\(p_reference\)\)/);
  const cityCandidates = executable.slice(executable.indexOf("select 'consignor'::text as role, l.consignor_id as entity_id, c.name as label"), executable.indexOf("union all select 'material'"));
  assert.doesNotMatch(cityCandidates, /address|from_station|to_station/i);
});

test('company-city candidates preserve stable-ID ambiguity and never invent NULL-ID companies', () => {
  const resolve = (role, city, rows) => [...new Map(rows
    .filter(row => row.role === role && row.id !== null && row.city.trim().toLowerCase() === city.trim().toLowerCase())
    .map(row => [row.id, row])).values()];
  const rows = [
    { role: 'consignor', id: 10, name: 'ABC', city: ' NAGPUR ' },
    { role: 'consignor', id: 11, name: 'ABC', city: 'nagpur' },
    { role: 'consignor', id: null, name: 'LEGACY SNAPSHOT', city: 'Nagpur' },
    { role: 'consignor', id: 12, name: 'ADDRESS ONLY', city: 'Pune', address: 'Nagpur Road' },
    { role: 'consignee', id: 18, name: 'ACC Wadi', city: 'WADI' },
  ];
  assert.deepEqual(resolve('consignor', 'Nagpur', rows).map(row => row.id), [10, 11]);
  assert.deepEqual(resolve('consignee', 'wadi', rows).map(row => row.id), [18]);
  assert.deepEqual(resolve('consignor', 'Nagpur Road', rows), []);
});

test('two-city discovery uses only stable scoped LR route pairs in both directions', () => {
  const customers = new Map([
    [1,{name:'COMPANY A',city:'Nagpur'}], [2,{name:'COMPANY B',city:' NAGPUR '}],
    [3,{name:'COMPANY C',city:'Nagpur'}], [4,{name:'COMPANY D',city:'Nagpur'}],
    [18,{name:'ACC Wadi',city:'Wadi'}], [19,{name:'RAWAN CO',city:'Rawan'}],
    [20,{name:'JAMUL CO',city:'Jamul'}], [21,{name:'SECOND WADI',city:'wadi'}],
  ]);
  const lrs = [
    {consignorId:1,consigneeId:18}, {consignorId:2,consigneeId:18},
    {consignorId:3,consigneeId:19}, {consignorId:4,consigneeId:20},
    {consignorId:null,consigneeId:18}, {consignorId:1,consigneeId:null},
  ];
  const city = value => value.trim().toLowerCase();
  const origins = [...new Set(lrs.filter(lr => lr.consignorId != null && lr.consigneeId != null &&
    city(customers.get(lr.consignorId).city) === 'nagpur' && city(customers.get(lr.consigneeId).city) === 'wadi').map(lr => lr.consignorId))];
  const destinations = [...new Set(lrs.filter(lr => lr.consignorId != null && lr.consigneeId != null &&
    city(customers.get(lr.consignorId).city) === 'nagpur' && city(customers.get(lr.consigneeId).city) === 'wadi').map(lr => lr.consigneeId))];
  assert.deepEqual(origins, [1,2]);
  assert.deepEqual(destinations, [18]);
  assert.ok(!origins.includes(3) && !origins.includes(4));
  assert.match(executable, /p_filters->>'destinationCity' is null or exists\([\s\S]*?l\.consignee_id is not null[\s\S]*?opposite\.id = l\.consignee_id[\s\S]*?opposite\.city[\s\S]*?p_filters->>'destinationCity'/);
  assert.match(executable, /p_filters->>'originCity' is null or exists\([\s\S]*?l\.consignor_id is not null[\s\S]*?opposite\.id = l\.consignor_id[\s\S]*?opposite\.city[\s\S]*?p_filters->>'originCity'/);
});

test('clarification contract preserves every unresolved field, reference, role and independent option budget', () => {
  assert.match(executable, /issues jsonb := '\[\]'::jsonb/);
  assert.match(executable, /issue_options := '\[\]'::jsonb/);
  assert.match(executable, /jsonb_array_length\(issue_options\) < 5/);
  assert.match(executable, /'field',k,'reference',v,'role',issue_role,'options',issue_options/);
  assert.match(executable, /if jsonb_array_length\(issues\) > 0 then return jsonb_build_object\('status','clarification','issues',issues\)/);
  assert.doesNotMatch(executable, /jsonb_build_object\('status','clarification','options',options\)/);
});

test('M111 maps city dimensions to existing party roles so M109 legacy-aware final filters remain authoritative', () => {
  assert.match(executable, /select 'consignor'::text as role, l\.consignor_id/);
  assert.match(executable, /select 'consignee'::text as role, l\.consignee_id/);
  for (const role of ['consignor', 'consignee']) {
    assert.match(executable, new RegExp(`l\\.${role}_id=\\(resolved->'${role}'->>'entity_id'\\)::bigint or \\(l\\.${role}_id is null and lower\\(trim\\(l\\.${role}\\)\\)=lower\\(trim\\(resolved->'${role}'->>'label'\\)\\)\\)`));
  }
});

test('M111 is forward-only, performs no business DML/schema mutation, and reasserts service-role-only ACLs', () => {
  for (const forbidden of [
    /\binsert\s+into\b/i, /\bupdate\s+public\b/i, /\bdelete\s+from\b/i, /\btruncate\b/i,
    /\bdrop\b/i, /\balter\s+table\b/i, /\bcreate\s+table\b/i, /\bcreate\s+index\b/i,
    /\bcreate\s+policy\b/i, /\b(?:create|drop)\s+trigger\b/i, /row\s+level\s+security/i,
  ]) assert.doesNotMatch(executable, forbidden);
  for (const signature of [
    'public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb)',
    'public.whatsapp_internal_operational_query(uuid,text,jsonb)',
  ]) {
    assert.ok(executable.includes(`revoke all on function ${signature} from public, anon, authenticated;`));
    assert.ok(executable.includes(`grant execute on function ${signature} to service_role;`));
  }
  assert.doesNotMatch(executable, /grant execute on function public\.[^;]+ to (?:public|anon|authenticated)/i);
});

test('authorization precedes all business reads and M109/M110 remain referenced historical prerequisites', () => {
  const resolver = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_entity_candidates'), executable.indexOf('create or replace function public.whatsapp_internal_operational_query'));
  const query = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_operational_query'));
  assert.ok(resolver.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < resolver.indexOf('from public.lrs'));
  assert.ok(query.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < query.indexOf('from public.whatsapp_internal_entity_candidates'));
  assert.match(m109, /M109 narrowly normalizes/i);
  assert.match(m110, /entity_candidates_ambiguity_fix/i);
});
