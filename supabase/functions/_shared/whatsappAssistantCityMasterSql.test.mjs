import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const m112 = read('../../../database/migrations/112_whatsapp_internal_directional_city_resolution.sql');
const m113 = read('../../../database/migrations/113_whatsapp_internal_city_master_resolution.sql');
const executable = m113.replace(/^--.*$/gm, '');
const resolver = executable.slice(executable.indexOf('create or replace function public.whatsapp_internal_entity_candidates'), executable.indexOf('revoke all on function'));

const normalizeCity = value => String(value).trim().toLowerCase();
function cityCandidates(role, reference, customers) {
  const outputRole = role === 'originCity' ? 'consignor' : 'consignee';
  return customers
    .filter(customer => customer.entryStatus !== 'draft' && normalizeCity(customer.city) === normalizeCity(reference))
    .map(customer => ({ role: outputRole, entityId: customer.id, label: customer.name }))
    .sort((a, b) => a.entityId - b.entityId);
}

test('M113 replaces only the complete entity candidate resolver', () => {
  assert.equal((executable.match(/create or replace function/g) ?? []).length, 1);
  assert.match(executable, /create or replace function public\.whatsapp_internal_entity_candidates\(\s*p_app_user_id uuid, p_role text, p_reference text, p_filters jsonb/);
  assert.doesNotMatch(executable, /whatsapp_internal_operational_(?:query|begin|continue)\s*\(/);
  assert.doesNotMatch(executable, /create\s+(?:table|index|trigger|policy)|alter\s+table|drop\s+|truncate\s+/i);
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update|delete\s+from)\b/i);
});

test('M113 city branches use finalized Customer Master identities independent of scoped LRs', () => {
  const cityStart = resolver.indexOf("select 'consignor'::text as role, c.id as entity_id");
  const cityEnd = resolver.indexOf("union all select 'material'", cityStart);
  const cityBranches = resolver.slice(cityStart, cityEnd);
  assert.ok(cityStart >= 0 && cityEnd > cityStart);
  assert.match(cityBranches, /from public\.customers c[\s\S]*p_role = 'originCity'/);
  assert.match(cityBranches, /select 'consignee'::text as role, c\.id as entity_id[\s\S]*from public\.customers c[\s\S]*p_role = 'destinationCity'/);
  assert.equal((cityBranches.match(/coalesce\(c\.entry_status,'final'\) = 'final'/g) ?? []).length, 2);
  assert.equal((cityBranches.match(/lower\(trim\(c\.city\)\) = lower\(trim\(p_reference\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(cityBranches, /\bscoped\b|public\.lrs|lrDate|createdAt|entryStatus|lrNumber|podState|minPendingDays|from_station|to_station|address|consignor_id|consignee_id/);
  assert.doesNotMatch(cityBranches, /c\.status\s*=\s*'Active'/);
});

test('three finalized Nagpur masters remain candidates despite September and lifetime LR activity', () => {
  const customers = [
    { id: 19, name: 'M/S SUSBDE LOC NAGPUR PVT LTD', city: 'Nagpur', entryStatus: 'final' },
    { id: 38, name: 'M/S BHUMI GREEN ENERGY ENVIROCARE LLP UNIT - NAGPUR', city: ' NAGPUR ', entryStatus: 'final' },
    { id: 74, name: 'M/S ZIGMA GLOBAL ENVIRON SOLUTION PVT LTD- NAGPUR', city: 'nagpur', entryStatus: 'final' },
    { id: 18, name: 'M/S ACC LIMITED WADI WORK (ADANI CEMENT)', city: 'Wadi', entryStatus: 'final' },
  ];
  const septemberLrs = [{ consignorId: 19, consigneeId: 18, lrDate: '2026-09-10', status: 'Open', podPresent: false }];
  assert.deepEqual(cityCandidates('originCity', 'NAGPUR', customers).map(row => row.entityId), [19, 38, 74]);
  assert.equal(septemberLrs.filter(lr => lr.consignorId === 38).length, 0);
  assert.equal(septemberLrs.filter(lr => lr.consignorId === 74).length, 0, 'newly finalized zero-history master remains a candidate');
  assert.deepEqual(cityCandidates('destinationCity', 'wadi', customers).map(row => row.entityId), [18]);
  const selectedZeroActivity = 74;
  assert.equal(septemberLrs.filter(lr => lr.consignorId === selectedZeroActivity && lr.consigneeId === 18).length, 0);
});

test('draft rows are excluded, duplicate names keep stable IDs, and NULL snapshots invent nothing', () => {
  const customers = [
    { id: 10, name: 'ABC', city: 'Nagpur', entryStatus: 'final' },
    { id: 11, name: 'ABC', city: ' nagpur ', entryStatus: 'final' },
    { id: 12, name: 'DRAFT COMPANY', city: 'Nagpur', entryStatus: 'draft' },
  ];
  const legacyLrs = [{ consignorId: null, consignor: 'LEGACY NAGPUR SNAPSHOT', lrDate: '2026-09-01' }];
  assert.deepEqual(cityCandidates('originCity', 'Nagpur', customers).map(row => [row.entityId, row.label]), [[10, 'ABC'], [11, 'ABC']]);
  assert.equal(legacyLrs[0].consignorId, null);
  assert.ok(!cityCandidates('originCity', 'Nagpur', customers).some(row => row.label === legacyLrs[0].consignor));
});

test('reporting filters cannot change Customer Master city candidates', () => {
  const customers = [
    { id: 1, name: 'A', city: 'Nagpur', entryStatus: 'final' },
    { id: 2, name: 'B', city: 'Nagpur', entryStatus: 'final' },
    { id: 3, name: 'C', city: 'Nagpur', entryStatus: 'final' },
  ];
  const baseline = cityCandidates('originCity', 'Nagpur', customers);
  for (const ignoredReportingFilters of [
    { lrDateFrom: '2026-09-01', lrDateTo: '2026-09-30' },
    { createdAtFrom: '2026-09-01T00:00:00Z', createdAtTo: '2026-10-01T00:00:00Z' },
    { entryStatus: 'draft', lrNumber: 'LR99999', status: 'Cancelled' },
    { podState: 'pending', minPendingDays: 999 },
  ]) {
    assert.deepEqual(cityCandidates('originCity', 'Nagpur', customers, ignoredReportingFilters), baseline);
  }
});

test('both-city ambiguity resolves sequentially by number or exact displayed name and can finish at zero', () => {
  const origins = [
    { role: 'consignor', entityId: 19, label: 'NAGPUR A' },
    { role: 'consignor', entityId: 38, label: 'NAGPUR B' },
    { role: 'consignor', entityId: 74, label: 'NAGPUR C' },
  ];
  const destinations = [
    { role: 'consignee', entityId: 18, label: 'WADI A' },
    { role: 'consignee', entityId: 81, label: 'WADI B' },
  ];
  const choose = (options, reply) => {
    if (/^[1-9][0-9]*$/.test(reply)) return options[Number(reply) - 1] ?? null;
    const matches = options.filter(option => option.label.trim().toLowerCase() === reply.trim().toLowerCase());
    return matches.length === 1 ? matches[0] : null;
  };
  const selectedOrigin = choose(origins, '3');
  assert.deepEqual(selectedOrigin, origins[2]);
  const selectedDestination = choose(destinations, 'WADI A');
  assert.deepEqual(selectedDestination, destinations[0]);
  const septemberLrs = [{ consignorId: 19, consigneeId: 18, lrDate: '2026-09-10' }];
  assert.equal(septemberLrs.filter(lr => lr.consignorId === selectedOrigin.entityId && lr.consigneeId === selectedDestination.entityId).length, 0);
});

test('M113 preserves every non-city resolver byte from M112', () => {
  const resolverOf = sql => sql.slice(sql.indexOf('create or replace function public.whatsapp_internal_entity_candidates'), sql.indexOf('create or replace function public.whatsapp_internal_operational_query') >= 0 ? sql.indexOf('create or replace function public.whatsapp_internal_operational_query') : sql.indexOf('revoke all on function'));
  const oldResolver = resolverOf(m112);
  const newResolver = resolverOf(m113);
  const oldCity = oldResolver.slice(oldResolver.indexOf("select 'consignor'::text as role, l.consignor_id as entity_id, c.name as label"), oldResolver.indexOf("union all select 'material'"));
  const newCity = newResolver.slice(newResolver.indexOf("select 'consignor'::text as role, c.id as entity_id"), newResolver.indexOf("union all select 'material'"));
  assert.equal(newResolver.replace(newCity, '<CITY_BRANCHES>'), oldResolver.replace(oldCity, '<CITY_BRANCHES>'));
});

test('M113 preserves authorization, volatility, fixed settings and service-role-only ACL', () => {
  assert.match(resolver, /language plpgsql stable security definer/);
  assert.match(resolver, /set search_path = ''/);
  assert.match(resolver, /set statement_timeout = '5s'/);
  assert.ok(resolver.indexOf("whatsapp_assistant_has_permission(p_app_user_id, 'lr')") < resolver.indexOf('from public.customers c'));
  assert.match(resolver, /p_filters->>'podState' is not null and not public\.whatsapp_assistant_has_permission\(p_app_user_id, 'pod'\)/);
  assert.match(executable, /revoke all on function public\.whatsapp_internal_entity_candidates\(uuid,text,text,jsonb\) from public, anon, authenticated/);
  assert.match(executable, /grant execute on function public\.whatsapp_internal_entity_candidates\(uuid,text,text,jsonb\) to service_role/);
  assert.equal((executable.match(/grant execute on function/g) ?? []).length, 1);
});
