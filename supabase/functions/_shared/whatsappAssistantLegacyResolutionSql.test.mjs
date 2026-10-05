import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../../../database/migrations/109_whatsapp_internal_legacy_entity_resolution.sql', import.meta.url);
const sql = readFileSync(path, 'utf8');
const executable = sql.replace(/--[^\n]*/g, '');
const key = value => value.toLowerCase().trim();
const partyRole = (requested, role) => requested === 'partySearch' && ['consignor', 'consignee'].includes(role) ? 'partySearch' : role;
function canonicalize(requested, candidates) {
  const matched = candidates.map(c => ({ ...c, effective: partyRole(requested, c.role), grouping: ['consignor','consignee','fromStation','toStation'].includes(c.role) ? key(c.label) : c.label }));
  const groups = new Map();
  for (const c of matched) if (['consignor','consignee'].includes(c.role) && c.id != null) {
    const k = `${c.effective}\0${key(c.label)}`;
    const group = groups.get(k) ?? new Set(); group.add(c.id); groups.set(k, group);
  }
  return matched.map(c => {
    const ids = groups.get(`${c.effective}\0${key(c.label)}`);
    return { ...c, id: c.id == null && ids?.size === 1 ? [...ids][0] : c.id };
  }).reduce((out, c) => {
    const k = `${c.effective}\0${c.id}\0${c.grouping}`;
    if (!out.some(x => x.k === k)) out.push({ k, role: c.effective, id: c.id, label: ['consignor','consignee','fromStation','toStation'].includes(c.role) ? c.label.trim() : c.label });
    return out;
  }, []);
}

test('M109 replaces only the two operational functions and preserves the hardened function contract', () => {
  assert.match(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_entity_candidates\(/i);
  assert.match(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_operational_query\(/i);
  assert.equal((executable.match(/create\s+or\s+replace\s+function public\./gi)||[]).length, 2);
  const stableDeclarations = [...executable.matchAll(/create\s+or\s+replace\s+function public\.(\w+)\([\s\S]*?\)\s+returns[\s\S]*?\blanguage\s+\w+\s+stable\b/gi)].map(match => match[1]);
  assert.deepEqual(stableDeclarations.sort(), ['whatsapp_internal_entity_candidates', 'whatsapp_internal_operational_query']);
  assert.equal(stableDeclarations.length, 2);
  assert.doesNotMatch(executable, /create\s+or\s+replace\s+function public\.whatsapp_internal_name_match/i);
  for (const forbidden of [/\binsert\s+into\b/i,/\bupdate\s+public\b/i,/\bdelete\s+from\b/i,/\btruncate\b/i,/\bdrop\b/i,/\balter\s+table\b/i,/\bcreate\s+table\b/i,/\bcreate\s+index\b/i,/\bcreate\s+policy\b/i,/\b(?:create|drop)\s+trigger\b/i,/\b(?:alter|drop)\s+policy\b/i,/row\s+level\s+security/i]) assert.doesNotMatch(executable, forbidden);
  assert.equal((executable.match(/security definer/g)||[]).length, 2);
  assert.equal((executable.match(/set search_path = ''/g)||[]).length, 2);
  assert.equal((executable.match(/set statement_timeout = '5s'/g)||[]).length, 2);
  for (const sig of ['whatsapp_internal_entity_candidates(uuid,text,text,jsonb)','whatsapp_internal_operational_query(uuid,text,jsonb)']) {
    assert.ok(executable.includes(`revoke all on function public.${sig} from public, anon, authenticated;`));
    assert.ok(executable.includes(`grant execute on function public.${sig} to service_role;`));
  }
  assert.equal((executable.match(/revoke all on function public\./gi)||[]).length, 2);
  assert.equal((executable.match(/grant execute on function public\./gi)||[]).length, 2);
  assert.doesNotMatch(executable, /grant execute on function public\.[^;]+ to (?:public|anon|authenticated)/i);
});

test('M109 remains match-first, authorized before reads, bounded, and ambiguity-first', () => {
  const resolver = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_entity_candidates'), executable.indexOf('create or replace function public.whatsapp_internal_operational_query'));
  assert.ok(resolver.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < resolver.indexOf('from public.lrs'));
  for (const cte of ['candidates as materialized','distinct_candidates as materialized','matched_candidates as materialized','stable_party_groups as materialized','canonical_candidates as materialized','resolved_candidates as materialized']) assert.ok(resolver.includes(cte));
  assert.ok(resolver.indexOf('public.whatsapp_internal_name_match') < resolver.indexOf('stable_party_groups as materialized'));
  assert.match(resolver, /c\.search_text/);
  assert.equal((resolver.match(/\blimit\b/gi)||[]).length, 1);
  const query = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_operational_query'));
  assert.ok(query.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < query.indexOf('from public.whatsapp_internal_entity_candidates'));
  assert.ok(query.indexOf("if ambiguous then return") < query.indexOf('with filtered as materialized'));
  assert.match(query, /p_filters - allowed <> '\{\}'::jsonb/);
  assert.match(query, /p_operation in \('search_pending_pods','get_pod_detail'\) or p_filters->>'podState' is not null/);
  assert.match(query, /and not v_can_pod then raise exception 'Not permitted'/);
});

test('station equivalence is narrow and compatible with final filtering', () => {
  assert.deepEqual(new Set(['NAGPUR','NAGPUR ','nagpur',' NAGPUR'].map(key)).size, 1);
  assert.notEqual(key('NAG PUR'), key('NAGPUR'));
  assert.notEqual(key('NAG-PUR'), key('NAGPUR'));
  const query = executable.slice(executable.indexOf('with filtered as materialized'));
  assert.match(query, /lower\(trim\(l\.from_station\)\)=lower\(trim\(resolved->'fromStation'->>'label'\)\)/);
  assert.match(query, /lower\(trim\(l\.to_station\)\)=lower\(trim\(resolved->'toStation'->>'label'\)\)/);
  assert.equal(['NAGPUR','NAGPUR '].filter(v => key(v) === key('nagpur')).length, 2);
});

test('only party and station roles receive normalized grouping keys', () => {
  assert.match(executable, /when c\.role in \('consignor','consignee','fromStation','toStation'\) then lower\(trim\(c\.label\)\) else c\.label end as grouping_key/);
  assert.equal(canonicalize('transporter', [{role:'transporter',id:null,label:'ABC LOGISTICS'},{role:'transporter',id:null,label:'abc logistics'}]).length, 2);
  assert.equal(canonicalize('bookingBranch', [{role:'bookingBranch',id:null,label:'Shahabad'},{role:'bookingBranch',id:null,label:'SHAHABAD'}]).length, 2);
  assert.equal(canonicalize('material', [{role:'material',id:1,label:'RDF'},{role:'material',id:1,label:'rdf '}]).length, 2);
  assert.equal(canonicalize('vehicleNumber', [{role:'vehicleNumber',id:null,label:'KA01AB1'},{role:'vehicleNumber',id:null,label:'ka01ab1 '}]).length, 2);
  for (const field of ['material','booking_branch','transporter','vehicle_number']) assert.match(executable, new RegExp(`l\\.${field}=resolved->'(?:material|bookingBranch|transporter|vehicleNumber)'->>'label'`));
});

test('direct party and partySearch canonicalization preserve stable identity ambiguity', () => {
  assert.deepEqual(canonicalize('consignee', [{role:'consignee',id:null,label:' ABC '},{role:'consignee',id:10,label:'ABC'}]).map(x=>x.id), [10]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignor',id:null,label:'ABC'},{role:'consignee',id:10,label:' ABC '}]).map(x=>x.id), [10]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignee',id:null,label:'ABC'},{role:'consignor',id:10,label:' ABC '}]).map(x=>x.id), [10]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignor',id:10,label:'ABC'},{role:'consignee',id:10,label:'ABC'}]).map(x=>x.id), [10]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignor',id:10,label:'ABC'},{role:'consignee',id:11,label:'ABC'},{role:'consignee',id:null,label:'ABC'}]).map(x=>x.id).sort(), [10,11,null]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignor',id:10,label:'ABC'},{role:'consignee',id:11,label:'ABC'}]).map(x=>x.id).sort(), [10,11]);
  assert.deepEqual(canonicalize('partySearch', [{role:'consignor',id:10,label:'ABC'},{role:'consignor',id:11,label:'ABC'}]).map(x=>x.id).sort(), [10,11]);
  assert.deepEqual(canonicalize('consignor', [{role:'consignor',id:234,label:'M/S ZIGMA'},{role:'consignor',id:242,label:'m/s zigma'}]).map(x=>x.id).sort((a,b)=>a-b), [234,242]);
});

test('ACC and NAGPUR production-shaped semantic fixtures preserve narrow legacy equivalence', () => {
  const acc=[...Array.from({length:26},()=>({role:'consignee',id:null,label:'M/S ACC LIMITED WADI WORK (ADANI CEMENT)'})),...Array.from({length:5},()=>({role:'consignee',id:18,label:'M/S ACC LIMITED WADI WORK (ADANI CEMENT)'}))];
  assert.deepEqual(canonicalize('consignee',acc).map(x=>x.id),[18]);
  const selected=[...acc,{role:'consignee',id:19,label:'M/S ACC LIMITED WADI WORK (ADANI CEMENT)'}].filter(r=>r.id===18 || (r.id===null && key(r.label)===key('M/S ACC LIMITED WADI WORK (ADANI CEMENT)')));
  assert.equal(selected.length,31);
  assert.ok(!selected.some(r=>r.id===19));
  const nagpur=[...Array.from({length:74},()=> 'NAGPUR'),...Array.from({length:12},()=> 'NAGPUR ')];
  assert.equal(new Set(nagpur.map(key)).size,1);
  assert.equal(nagpur.filter(v=>key(v)===key('nagpur')).length,86);
});

test('legacy-only direct and partySearch filters exclude matching non-NULL identities', () => {
  const rows=[{side:'consignor',id:null,label:' ABC '},{side:'consignee',id:null,label:'ABC'},{side:'consignee',id:10,label:'ABC'}];
  assert.deepEqual(rows.filter(r=>r.side==='consignor' && r.id===null && key(r.label)===key('ABC')).map(r=>r.id),[null]);
  assert.deepEqual(rows.filter(r=>r.id===null && key(r.label)===key('ABC')).map(r=>r.id),[null,null]);
});

test('party filters include only exact stable IDs plus NULL legacy snapshots and partySearch remains OR', () => {
  for (const column of ['consignor','consignee']) assert.match(executable, new RegExp(`l\\.${column}_id=\\(resolved->'${column}'->>'entity_id'\\)::bigint or \\(l\\.${column}_id is null and lower\\(trim\\(l\\.${column}\\)\\)=lower\\(trim\\(resolved->'${column}'->>'label'\\)\\)\\)`));
  assert.match(executable, /l\.consignor_id=\(resolved->'partySearch'->>'entity_id'\)::bigint or l\.consignee_id=\(resolved->'partySearch'->>'entity_id'\)::bigint/);
  assert.match(executable, /l\.consignor_id is null and lower\(trim\(l\.consignor\)\)=lower\(trim\(resolved->'partySearch'->>'label'\)\)/);
  assert.match(executable, /l\.consignee_id is null and lower\(trim\(l\.consignee\)\)=lower\(trim\(resolved->'partySearch'->>'label'\)\)/);
  const rows=[{id:null,label:' ABC '},{id:10,label:'ABC'},{id:11,label:'ABC'}];
  assert.deepEqual(rows.filter(r=>r.id===10 || (r.id===null && key(r.label)===key('ABC'))).map(r=>r.id),[null,10]);
});

test('M107 remains historical and untouched by the M109 contract', () => {
  const m107=readFileSync(new URL('../../../database/migrations/107_whatsapp_internal_operational_query.sql', import.meta.url),'utf8');
  assert.match(m107,/DO NOT reapply M107/);
  assert.doesNotMatch(m107,/create or replace function public\.whatsapp_internal_entity_candidates/i);
});
