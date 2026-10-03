-- REVIEW ONLY. UNNUMBERED. NOT EXECUTED. NOT A DEPLOYABLE MIGRATION APPROVAL.
-- Prerequisites: M097-M100 and existing _overview_age_days(timestamptz).
-- Adds three service-role-only functions. Changes no existing object, table,
-- RLS policy, grant, mapping, row or historical record. No backfill/DML.
-- Requires a separate PostgreSQL rehearsal and approval before any application.
-- No pg_trgm/fuzzystrmatch extension or new dependency is required.
-- Candidate names are drawn only from operational LRs in the requested basic
-- scope; no customer contacts, master records, IDs or URLs leave the RPC.
-- Booking branches are text in ERP (no branch master table). Resolution uses
-- observed LR branches, never a hard-coded list. A branch with no matching LR
-- evidence clarifies. M102/M103 and material_id are deliberately not required.

begin;

create function public.whatsapp_internal_name_match(p_name text, p_reference text)
returns boolean language plpgsql immutable security invoker
set search_path = ''
as $$
declare
  words text[]; queries text[]; reachable boolean[];
  q text; w text; a text; b text; i integer; j integer;
  qi integer; wi integer; q_size integer; w_size integer;
  edits integer; matched boolean;
begin
  if p_name is null or p_reference is null or length(p_reference) > 200
    or length(p_name) > 1000 then return false; end if;
  -- Punctuation is a word boundary, not permission to search arbitrary substrings.
  words := regexp_split_to_array(trim(regexp_replace(lower(p_name), '[^[:alnum:]]+', ' ', 'g')), ' +');
  queries := regexp_split_to_array(trim(regexp_replace(lower(p_reference), '[^[:alnum:]]+', ' ', 'g')), ' +');
  if words[1] = '' or queries[1] = '' or array_length(words,1) > 128
    or array_length(queries,1) > 32 then return false; end if;
  reachable := array_fill(false, array[array_length(queries,1) + 1]);
  reachable[1] := true;
  -- A reference must be fully covered by matching units. Each unit has at most
  -- two adjacent alphabetic words on each side, permitting joined/split spelling
  -- without an unbounded concatenation or a mid-word substring search. Reference
  -- units may occur in different order in the candidate, as before.
  for qi in 1..array_length(queries,1) loop
    if not reachable[qi] then continue; end if;
    for q_size in 1..2 loop
      if qi + q_size - 1 > array_length(queries,1) then exit; end if;
      q := queries[qi];
      if q_size = 2 then
        if q !~ '^[[:alpha:]]+$' or queries[qi+1] !~ '^[[:alpha:]]+$' then continue; end if;
        q := q || queries[qi+1];
      end if;
      matched := false;
      for wi in 1..array_length(words,1) loop
        for w_size in 1..2 loop
          if wi + w_size - 1 > array_length(words,1) then exit; end if;
          w := words[wi];
          if w_size = 2 then
            if w !~ '^[[:alpha:]]+$' or words[wi+1] !~ '^[[:alpha:]]+$' then continue; end if;
            w := w || words[wi+1];
          end if;
          if q = w then matched := true;
          elsif q_size = 1 and w_size = 1 and length(q) >= 4
            and q ~ '^[[:alpha:]]+$' and w ~ '^[[:alpha:]]+$'
            and left(w,length(q)) = q then matched := true;
          -- At most one spelling edit per matched unit, alphabetic words only.
          -- Numeric/alphanumeric tokens require exact equality, not even prefix
          -- matching. Explicit four-digit vehicle suffix resolution is separate.
          elsif length(q) >= 5 and length(w) >= 5 and abs(length(q)-length(w)) <= 1
            and q ~ '^[[:alpha:]]+$' and w ~ '^[[:alpha:]]+$' then
            a := q; b := w; i := 1; j := 1; edits := 0;
            while i <= length(a) and j <= length(b) loop
              if substr(a,i,1) = substr(b,j,1) then i := i+1; j := j+1;
              else
                edits := edits+1;
                if edits > 1 then exit; end if;
                if length(a) >= length(b) then i := i+1; end if;
                if length(b) >= length(a) then j := j+1; end if;
              end if;
            end loop;
            edits := edits + (length(a)-i+1) + (length(b)-j+1);
            if edits <= 1 then matched := true; end if;
          end if;
          if matched then exit; end if;
        end loop;
        if matched then exit; end if;
      end loop;
      if matched then reachable[qi + q_size] := true; end if;
    end loop;
  end loop;
  return reachable[array_length(queries,1) + 1];
end;
$$;

-- Empty search_path follows the hardened project pattern (M095/M096).
-- All project relations and helper calls are explicitly schema-qualified.
-- Separate authorization on the resolver even when invoked from the query.
-- Multiple candidate identities/roles ALWAYS clarify, even if one scores better.
create function public.whatsapp_internal_entity_candidates(
  p_app_user_id uuid, p_role text, p_reference text, p_filters jsonb
) returns table(role text, entity_id bigint, label text)
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then raise exception 'Not permitted'; end if;
  if p_filters->>'podState' is not null and not public.whatsapp_assistant_has_permission(p_app_user_id, 'pod') then raise exception 'Not permitted'; end if;
  if p_role is null or p_role not in ('consignor','consignee','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','vehicleNumber','transporter')
    or p_reference is null or length(trim(p_reference)) not between 1 and 200
    or p_reference ~ '[%_\\]' then raise exception 'Invalid resolver request'; end if;
  return query
  with scoped as materialized (
    select l.consignor_id, l.consignee_id, l.consignor, l.consignee,
      l.from_station, l.to_station, l.material, l.booking_branch, l.transporter, l.vehicle_number
    from public.lrs l
    where coalesce(l.entry_status,'final') = coalesce(p_filters->>'entryStatus','final')
      and (p_filters->>'lrDateFrom' is null or l.lr_date >= (p_filters->>'lrDateFrom')::date)
      and (p_filters->>'lrDateTo' is null or l.lr_date <= (p_filters->>'lrDateTo')::date)
      and (p_filters->>'createdAtFrom' is null or l.created_at >= (p_filters->>'createdAtFrom')::timestamptz)
      and (p_filters->>'createdAtTo' is null or l.created_at < (p_filters->>'createdAtTo')::timestamptz)
      and (p_filters->>'lrNumber' is null or upper(trim(l.lr_number)) = upper(p_filters->>'lrNumber'))
      and (p_filters->>'status' is null or l.status = p_filters->>'status')
      and (p_filters->>'podState' is null
        or (p_filters->>'podState'='present' and exists(select 1 from public.pods p where p.lr_number=l.lr_number))
        or (p_filters->>'podState'='pending' and coalesce(l.status,'')<>'Cancelled' and not exists(select 1 from public.pods p where p.lr_number=l.lr_number)))
      and (p_filters->>'minPendingDays' is null or public._overview_age_days(l.created_at)>=(p_filters->>'minPendingDays')::integer)
  ), candidates as (
    select 'consignor'::text as role, l.consignor_id as entity_id,
      coalesce(c.name,nullif(l.consignor,'')) as label,
      coalesce(c.name,l.consignor) || ' ' || coalesce(c.city,'') || ' ' || coalesce(l.from_station,'') as search_text
    from scoped l left join public.customers c on c.id = l.consignor_id
    where p_role in ('consignor','partySearch','entitySearch','originSearch')
    union all
    select 'consignee', l.consignee_id, coalesce(c.name,nullif(l.consignee,'')),
      coalesce(c.name,l.consignee) || ' ' || coalesce(c.city,'') || ' ' || coalesce(l.to_station,'')
    from scoped l left join public.customers c on c.id = l.consignee_id
    where p_role in ('consignee','partySearch','entitySearch','destinationSearch')
    union all select 'material', m.id, l.material, coalesce(m.material_name,l.material) from scoped l
      left join public.materials m on lower(trim(m.material_name))=lower(trim(l.material))
      where p_role in ('material','entitySearch')
    union all select 'bookingBranch', null::bigint, l.booking_branch, l.booking_branch from scoped l
      where p_role in ('bookingBranch','entitySearch','originSearch','destinationSearch')
    union all select 'fromStation', null::bigint, l.from_station, l.from_station from scoped l
      where p_role in ('fromStation')
    union all select 'toStation', null::bigint, l.to_station, l.to_station from scoped l
      where p_role in ('toStation')
    union all select 'transporter', null::bigint, l.transporter, l.transporter from scoped l
      where p_role in ('transporter','entitySearch')
    union all select 'vehicleNumber', null::bigint, l.vehicle_number, l.vehicle_number from scoped l
      where p_role in ('vehicleNumber')
  ), distinct_candidates as materialized (
    -- Match each distinct identity/location representation once, not once per LR.
    -- Keep every search_text: deduplicating labels alone could hide city evidence.
    -- Never limit here: all identities must participate in ambiguity detection.
    select distinct c.role, c.entity_id, c.label, c.search_text from candidates c
    where nullif(trim(c.label),'') is not null
  )
  select distinct case when p_role='partySearch' then 'partySearch' else c.role end, c.entity_id, c.label from distinct_candidates c
  where nullif(trim(c.label),'') is not null
    and (c.role = p_role
      or (p_role = 'partySearch' and c.role in ('consignor','consignee'))
      or (p_role = 'entitySearch' and c.role in ('consignor','consignee','material','bookingBranch','transporter'))
      or (p_role = 'originSearch' and c.role in ('consignor','bookingBranch'))
      or (p_role = 'destinationSearch' and c.role in ('consignee','bookingBranch')))
    and case when c.role = 'vehicleNumber' then
      upper(c.label) = upper(p_reference) or (p_reference ~ '^[0-9]{4}$' and right(c.label,4) = p_reference)
      else public.whatsapp_internal_name_match(c.search_text, p_reference) end
  order by 1, 2, 3
  limit 6; -- six detects overflow; only five display options may leave query RPC
end;
$$;

create function public.whatsapp_internal_operational_query(
  p_app_user_id uuid, p_operation text, p_filters jsonb
) returns jsonb language plpgsql stable security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  allowed text[] := array['lrDateFrom','lrDateTo','createdAtFrom','createdAtTo','consignor','consignee','vehicleNumber','countOnly','limit','offset','lrNumber','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','transporter','status','entryStatus','podState','minPendingDays'];
  entity_keys text[] := array['consignor','consignee','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','transporter','vehicleNumber'];
  k text; v text; v_matches jsonb; resolved jsonb := '{}'::jsonb; options jsonb := '[]'::jsonb;
  chosen jsonb; candidate jsonb; ambiguous boolean := false;
  v_can_pod boolean; v_count boolean; v_limit integer; v_offset bigint; v_result jsonb;
begin
  -- Authorization always precedes resolver/master/LR/POD access.
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then raise exception 'Not permitted'; end if;
  v_can_pod := public.whatsapp_assistant_has_permission(p_app_user_id, 'pod');
  if p_operation is null or p_operation not in ('search_lrs','search_pending_pods','get_lr_detail','get_pod_detail')
    or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>8192
    or p_filters - allowed <> '{}'::jsonb then raise exception 'Invalid operational query'; end if;
  if (p_operation in ('search_pending_pods','get_pod_detail') or p_filters->>'podState' is not null)
    and not v_can_pod then raise exception 'Not permitted'; end if;
  foreach k in array allowed loop
    if not (p_filters ? k) or p_filters->k = 'null'::jsonb then continue; end if;
    if k in ('countOnly') then
      if jsonb_typeof(p_filters->k) <> 'boolean' then raise exception 'Invalid boolean'; end if;
    elsif k in ('limit','offset','minPendingDays') then
      if jsonb_typeof(p_filters->k) <> 'number' or (p_filters->>k) !~ '^[0-9]+$' then raise exception 'Invalid number'; end if;
    else
      if jsonb_typeof(p_filters->k) <> 'string' or length(trim(p_filters->>k)) not between 1 and 200
        or (p_filters->>k) ~ '[%_\\]' then raise exception 'Invalid filter'; end if;
    end if;
  end loop;
  v_count := (p_filters->>'countOnly')::boolean;
  v_limit := (p_filters->>'limit')::integer; v_offset := (p_filters->>'offset')::bigint;
  if v_count is null or v_limit is null or v_limit not between 1 and 20 or v_offset is null or v_offset not between 0 and 1000000
    or (p_filters->>'minPendingDays')::integer not between 0 and 36500
    or coalesce(p_filters->>'entryStatus','final') not in ('draft','final')
    or coalesce(p_filters->>'podState','pending') not in ('present','pending')
    or coalesce(p_filters->>'status','Open') not in ('Open','In Transit','Delivered','Billed','Cancelled') then raise exception 'Invalid bounds'; end if;
  if (p_filters->>'lrDateFrom')::date > (p_filters->>'lrDateTo')::date
    or (p_filters->>'createdAtFrom')::timestamptz >= (p_filters->>'createdAtTo')::timestamptz
    or (p_filters->>'lrDateFrom' is not null and p_filters->>'createdAtFrom' is not null)
    or (p_operation like 'get_%' and (p_filters->>'lrNumber' is null or v_count or v_offset <> 0))
    or (p_operation = 'search_pending_pods' and (p_filters->>'podState') is distinct from 'pending')
    or (p_filters->>'minPendingDays' is not null and (p_filters->>'podState') is distinct from 'pending')
    or (p_filters->>'podState' = 'pending' and p_filters->>'status' = 'Cancelled') then raise exception 'Incompatible filters'; end if;

  foreach k in array entity_keys loop
    v := p_filters->>k;
    if v is null then continue; end if;
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_matches
      from public.whatsapp_internal_entity_candidates(p_app_user_id,k,v,p_filters) c;
    if jsonb_array_length(v_matches) <> 1 then
      ambiguous := true;
      for candidate in select value from jsonb_array_elements(v_matches) loop
        if jsonb_array_length(options) < 5 then
          options := options || jsonb_build_array(jsonb_build_object('role',candidate->>'role','label',candidate->>'label'));
        end if;
      end loop;
    else
      chosen := v_matches->0;
      if resolved ? (chosen->>'role') then
        -- Two source dimensions may not silently overwrite each other.
        if resolved->(chosen->>'role') <> chosen then ambiguous := true; end if;
      else resolved := resolved || jsonb_build_object(chosen->>'role',chosen); end if;
    end if;
  end loop;
  if ambiguous then return jsonb_build_object('status','clarification','options',options); end if;
  -- No business count/list/detail executes before ALL resolutions succeed.
  with filtered as materialized (
    select l.*, case when v_can_pod then exists(select 1 from public.pods p where p.lr_number=l.lr_number) else null end as has_pod,
      public._overview_age_days(l.created_at) as age_days
    from public.lrs l
    where coalesce(l.entry_status,'final')=coalesce(p_filters->>'entryStatus','final')
      and (p_filters->>'status' is null or l.status=p_filters->>'status')
      and (p_filters->>'status' is not null or p_operation like 'get_%' or coalesce(l.status,'')<>'Cancelled')
      and (p_filters->>'lrNumber' is null or upper(trim(l.lr_number))=upper(p_filters->>'lrNumber'))
      and (p_filters->>'lrDateFrom' is null or l.lr_date >= (p_filters->>'lrDateFrom')::date)
      and (p_filters->>'lrDateTo' is null or l.lr_date <= (p_filters->>'lrDateTo')::date)
      and (p_filters->>'createdAtFrom' is null or l.created_at >= (p_filters->>'createdAtFrom')::timestamptz)
      and (p_filters->>'createdAtTo' is null or l.created_at < (p_filters->>'createdAtTo')::timestamptz)
      and (not (resolved ? 'consignor') or case when resolved->'consignor'->>'entity_id' is not null then l.consignor_id=(resolved->'consignor'->>'entity_id')::bigint else l.consignor=resolved->'consignor'->>'label' end)
      and (not (resolved ? 'consignee') or case when resolved->'consignee'->>'entity_id' is not null then l.consignee_id=(resolved->'consignee'->>'entity_id')::bigint else l.consignee=resolved->'consignee'->>'label' end)
      and (not (resolved ? 'partySearch') or case when resolved->'partySearch'->>'entity_id' is not null
        then l.consignor_id=(resolved->'partySearch'->>'entity_id')::bigint or l.consignee_id=(resolved->'partySearch'->>'entity_id')::bigint
        else l.consignor=resolved->'partySearch'->>'label' or l.consignee=resolved->'partySearch'->>'label' end)
      and (not (resolved ? 'material') or l.material=resolved->'material'->>'label')
      and (not (resolved ? 'bookingBranch') or l.booking_branch=resolved->'bookingBranch'->>'label')
      and (not (resolved ? 'fromStation') or l.from_station=resolved->'fromStation'->>'label')
      and (not (resolved ? 'toStation') or l.to_station=resolved->'toStation'->>'label')
      and (not (resolved ? 'vehicleNumber') or l.vehicle_number=resolved->'vehicleNumber'->>'label')
      and (not (resolved ? 'transporter') or l.transporter=resolved->'transporter'->>'label')
  ), eligible as materialized (
    select * from filtered f where
      (p_filters->>'podState' is null or (p_filters->>'podState'='present' and f.has_pod) or (p_filters->>'podState'='pending' and not f.has_pod and coalesce(f.status,'')<>'Cancelled'))
      and (p_filters->>'minPendingDays' is null or f.age_days >= (p_filters->>'minPendingDays')::integer)
  ), totals as (
    select count(*) as n, sum(nullif(loading_weight,0)) as total_weight, count(nullif(loading_weight,0)) as weight_records from eligible
  ), page as (
    select * from eligible order by lr_date desc, lr_number, id
    limit (case when p_operation like 'get_%' then 1 when v_count then 0 else v_limit end) offset v_offset
  ), rendered as (
    select p.lr_number, p.lr_date, p.id,
      jsonb_strip_nulls(jsonb_build_object('lr_number',p.lr_number,'lr_date',p.lr_date,
        'consignor',p.consignor,'consignee',p.consignee,'vehicle_number',p.vehicle_number,
        'from_station',p.from_station,'to_station',p.to_station,'material',p.material,
        'booking_branch',p.booking_branch,'entry_status',coalesce(p.entry_status,'final'),
        'status',p.status,'pod_present',p.has_pod,'pending_days',p.age_days,'loading_weight',p.loading_weight)) as lr
    from page p
  )
  select case when p_operation like 'get_%' then
    coalesce((select case when p_operation='get_pod_detail' then
      jsonb_build_object('found',true,'lr',r.lr,'pod_present',coalesce((r.lr->>'pod_present')::boolean,false),
        'pod',(select jsonb_build_object('pod_date',pod.pod_date,'unloading_date',pod.unloading_date,
          'unloading_weight',nullif(pod.unloading_weight,0),'proof_present',coalesce(nullif(trim(pod.proof_url),''),'')<>'')
          from public.pods pod where pod.lr_number=r.lr_number order by pod.pod_date desc, pod.id desc limit 1))
      else jsonb_build_object('found',true,'lr',r.lr) end from rendered r),jsonb_build_object('found',false))
    else jsonb_build_object('total_count',t.n,'total_loading_weight',t.total_weight,'loading_weight_records',t.weight_records,
      'rows',coalesce((select jsonb_agg(r.lr order by r.lr_date desc,r.lr_number,r.id) from rendered r),'[]'::jsonb),
      'pagination',jsonb_build_object('count_only',v_count,'limit',v_limit,'offset',v_offset,
        'returned_count',(select count(*) from rendered),'has_more',t.n>v_offset+v_limit)) end
    into v_result from totals t;
  return jsonb_build_object('status','ok','result',v_result);
end;
$$;

revoke all on function public.whatsapp_internal_name_match(text,text) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_operational_query(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_internal_name_match(text,text) to service_role;
grant execute on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) to service_role;
grant execute on function public.whatsapp_internal_operational_query(uuid,text,jsonb) to service_role;
commit;
