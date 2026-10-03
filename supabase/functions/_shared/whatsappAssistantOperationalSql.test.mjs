// STATIC review contract only: these tests intentionally never execute SQL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
function sha256(text){ return createHash('sha256').update(text).digest('hex'); }
function executableBody(text){ const i=text.indexOf('begin;'); return i>=0 ? text.slice(i) : text; }
const reviewSql=readFileSync(new URL('../../../database/review/whatsapp_internal_operational_query.sql',import.meta.url),'utf8');
const m107Sql=readFileSync(new URL('../../../database/migrations/107_whatsapp_internal_operational_query.sql',import.meta.url),'utf8');
const sql=m107Sql;
const body=sql.replace(/--[^\n]*/g,'');
test('historical review artifact SHA-256 is aa27be2115fa0af0f1a3b4c8e3c1c76e68785fb2b8beb0b533ba3408138583cf',()=>{
  assert.equal(sha256(reviewSql),'aa27be2115fa0af0f1a3b4c8e3c1c76e68785fb2b8beb0b533ba3408138583cf');
});
test('M107 executable body identical to review artifact from first begin; through EOF',()=>{
  assert.equal(executableBody(m107Sql), executableBody(reviewSql));
});
test('review SQL adds only new names and never changes rows, old functions, policies or tables',()=>{
  assert.doesNotMatch(body,/\b(insert\s+into|update\s+public|delete\s+from|truncate|alter\s+table|drop\s+|create\s+or\s+replace|create\s+policy)\b/i);
  assert.equal((body.match(/create function public\./g)||[]).length,3);
});
test('each new SQL function has fixed search_path and service-role-only explicit privileges',()=>{
  for(const sig of ['whatsapp_internal_name_match(text,text)','whatsapp_internal_entity_candidates(uuid,text,text,jsonb)','whatsapp_internal_operational_query(uuid,text,jsonb)']){
    assert.ok(body.includes(`revoke all on function public.${sig} from public, anon, authenticated;`));
    assert.ok(body.includes(`grant execute on function public.${sig} to service_role;`));
  }
  assert.equal((body.match(/set search_path = ''/g)||[]).length,3);
});
test('resolver and query independently retain permission helper; POD operation requires POD permission',()=>{
  assert.equal((body.match(/whatsapp_assistant_has_permission\(p_app_user_id, 'lr'\)/g)||[]).length,2);
  assert.match(body,/whatsapp_assistant_has_permission\(p_app_user_id, 'pod'\)/);
  assert.match(body,/and not v_can_pod then raise exception 'Not permitted'/);
});
test('ambiguity returns before business query, with bounded real labels and no candidate IDs',()=>{
  const clarification=body.indexOf("if ambiguous then return");
  const query=body.indexOf('with filtered as materialized');
  assert.ok(clarification>0 && clarification<query);
  assert.match(body,/jsonb_array_length\(v_matches\) <> 1/);
  assert.match(body,/jsonb_array_length\(options\) < 5/);
  assert.match(body,/jsonb_build_object\('role',candidate->>'role','label',candidate->>'label'\)/);
});
test('operational fields are projected; financial data and proof URLs are not returned',()=>{
  const output=body.slice(body.indexOf('), rendered as ('));
  assert.doesNotMatch(output,/'(?:lr_id|id|consignor_id|consignee_id|proof_url|freight|rate|cost|payment|remarks|mobile|address)'\s*,/i);
  assert.match(output,/'unloading_weight',nullif\(pod.unloading_weight,0\)/);
  assert.doesNotMatch(output,/'unloading_weight',p\.loading_weight/);
});
test('SQL uses existing IST age, inclusive LR dates, exclusive creation end, final default',()=>{
  assert.match(body,/public\._overview_age_days\(l.created_at\)/);
  assert.match(body,/l.lr_date <= \(p_filters->>'lrDateTo'\)::date/);
  assert.match(body,/l.created_at < \(p_filters->>'createdAtTo'\)::timestamptz/);
  assert.match(body,/coalesce\(p_filters->>'entryStatus','final'\)/);
});

// Dependency-free executable specification, NOT PostgreSQL execution. This
// models the bounded algorithm in the review draft; structural checks below
// guard the SQL's corresponding rules. Engine/collation behavior needs rehearsal.
const words = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/ +/u);
const alpha = value => /^\p{L}+$/u.test(value);
function oneEdit(a,b) {
  if (a.length<5 || b.length<5 || !alpha(a) || !alpha(b) || Math.abs(a.length-b.length)>1) return false;
  let i=0,j=0,edits=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) {i++;j++;continue;}
    if(++edits>1) return false;
    if(a.length>=b.length) i++;
    if(b.length>=a.length) j++;
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
function specificationMatch(name,reference) {
  if(typeof name!=='string' || typeof reference!=='string' || name.length>1000 || reference.length>200) return false;
  const candidate=words(name), query=words(reference);
  if(!candidate[0] || !query[0] || candidate.length>128 || query.length>32) return false;
  const reached=new Set([0]);
  for(let i=0;i<query.length;i++) {
    if(!reached.has(i)) continue;
    for(let qn=1;qn<=2 && i+qn<=query.length;qn++) {
      const qs=query.slice(i,i+qn);
      if(qn>1 && !qs.every(alpha)) continue;
      const q=qs.join('');
      let found=false;
      for(let j=0;j<candidate.length && !found;j++) {
        for(let cn=1;cn<=2 && j+cn<=candidate.length;cn++) {
          const cs=candidate.slice(j,j+cn);
          if(cn>1 && !cs.every(alpha)) continue;
          const c=cs.join('');
          if(q===c || (qn===1 && cn===1 && q.length>=4 && alpha(q) && alpha(c) && c.startsWith(q)) || oneEdit(q,c)) {found=true;break;}
        }
      }
      if(found) reached.add(i+qn);
    }
  }
  return reached.has(query.length);
}
const resolution = (candidates,reference) => {
  const matches=candidates.filter(c=>specificationMatch(c.label,reference));
  return matches.length===1 ? {status:'unique',id:matches[0].id} : {status:'clarification'};
};
for(const reference of ['unshredded RDF','un-shredded RDF','UN SHREDDED RDF']) {
  test(`normalization specification: ${reference} resolves the unique compound material`,()=>{
    assert.deepEqual(resolution([{id:1,label:'UN-SHREDDED RDF FROM MSW'}],reference),{status:'unique',id:1});
  });
  test(`normalization specification: ${reference} still clarifies multiple candidates`,()=>{
    assert.deepEqual(resolution([{id:1,label:'UN-SHREDDED RDF FROM MSW'},{id:2,label:'UNSHREDDED RDF FROM INDUSTRIAL WASTE'}],reference),{status:'clarification'});
  });
}
test('normalization specification is generic, symmetric and tolerant of punctuation/case/word order',()=>{
  for(const [name,reference] of [
    ['North-East Logistics','northeast logistics'], ['NORTHEAST LOGISTICS','north east logistics'],
    ['North / East Logistics','LOGISTICS north.east'], ['AlphaBeta Works','alpha beta'],
    ['UNSHREDDED RDF FROM MSW','UN SHREDDED RDF'], ['UN SHREDDED RDF FROM MSW','unshredded RDF'],
  ]) assert.equal(specificationMatch(name,reference),true,`${name} / ${reference}`);
});
test('normalization specification preserves bounded spelling tolerance, no numeric fuzz/prefix/join',()=>{
  assert.equal(specificationMatch('UN-SHREDDED RDF FROM MSW','unshreded RDF'),true);
  for(const [name,reference] of [
    ['UN-SHREDDED RDF','unshrxxxed RDF'], ['Logistics','gisti'], ['Logistics','log'],
    ['Plant 12345','1234'], ['ABC12345','ABC1234'], ['ABC12345','ABC12346'], ['Plant 12 34','1234'],
    ['Plant 1234','12 34'], ['Plant A B C','ABC'],
  ]) assert.equal(specificationMatch(name,reference),false,`${name} / ${reference}`);
});
test('normalization specification never picks a winner after normalized labels collide',()=>{
  assert.deepEqual(resolution([{id:1,label:'Alpha-Beta Works'},{id:2,label:'AlphaBeta Works'}],'alpha beta'),{status:'clarification'});
  assert.deepEqual(resolution([],'unshredded RDF'),{status:'clarification'});
});
test('SQL binds bounded compound matching and exact-only numeric rules to the specification',()=>{
  assert.match(body,/q_size in 1\.\.2/);
  assert.match(body,/w_size in 1\.\.2/);
  assert.match(body,/array_length\(queries,1\) > 32/);
  assert.match(body,/array_length\(words,1\) > 128/);
  assert.match(body,/q_size = 1 and w_size = 1/);
  assert.match(body,/q ~ '\^\[\[:alpha:\]\]\+\$' and w ~ '\^\[\[:alpha:\]\]\+\$'/);
  assert.match(body,/reachable\[qi \+ q_size\] := true/);
  assert.match(body,/return reachable\[array_length\(queries,1\) \+ 1\]/);
});
test('SECURITY DEFINER functions have empty paths, qualified project relations and authorization before reads',()=>{
  const definitions=[...body.matchAll(/create function public\.(\w+)[\s\S]*?\$\$;/g)].map(m=>m[0]);
  const definers=definitions.filter(d=>/security definer/.test(d));
  assert.equal(definers.length,2);
  for(const def of definers) {
    assert.match(def,/set search_path = ''/);
    assert.doesNotMatch(def,/set search_path = .*public/);
    assert.ok(def.indexOf('public.whatsapp_assistant_has_permission')<def.indexOf('from public.'));
    assert.doesNotMatch(def,/\b(?:from|join)\s+(?:lrs|pods|customers|materials)\b/i);
    assert.doesNotMatch(def,/(?<!\.)\b(?:whatsapp_assistant_has_permission|whatsapp_internal_entity_candidates|whatsapp_internal_name_match|_overview_age_days)\(/);
  }
  assert.match(body,/^\s*begin;/);
  assert.match(body,/commit;\s*$/);
});
test('resolver narrows projections and deduplicates all identity/search variants before matching without early limits',()=>{
  const resolver=body.slice(body.indexOf('create function public.whatsapp_internal_entity_candidates'),body.indexOf('create function public.whatsapp_internal_operational_query'));
  assert.doesNotMatch(resolver,/select l\.\*/);
  assert.match(resolver,/distinct_candidates as materialized/);
  assert.match(resolver,/select distinct c\.role, c\.entity_id, c\.label, c\.search_text from candidates c/);
  assert.ok(resolver.indexOf('distinct_candidates as materialized')<resolver.indexOf('public.whatsapp_internal_name_match'));
  assert.equal((resolver.match(/\blimit\b/gi)||[]).length,1);
  assert.match(resolver,/limit 6/);
  for(const roles of ["'consignor','partySearch','entitySearch','originSearch'","'consignee','partySearch','entitySearch','destinationSearch'","'material','entitySearch'","'bookingBranch','entitySearch','originSearch','destinationSearch'","'fromStation'","'toStation'","'transporter','entitySearch'","'vehicleNumber'"]) assert.ok(resolver.includes(`where p_role in (${roles})`));
});
