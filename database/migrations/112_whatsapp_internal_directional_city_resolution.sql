-- Migration: 112_whatsapp_internal_directional_city_resolution
-- Module: independent directional city resolution and bounded continuation
-- Replaces the two operational functions after M111, removing only the unsafe
-- same-LR opposite-city candidate requirement. Adds private, short-lived state
-- for server-validated clarification choices; it stores no message text.
-- No business-data DML/backfill is performed.
-- No production database is touched by preparing this migration source.
begin;

create or replace function public.whatsapp_internal_entity_candidates(
  p_app_user_id uuid, p_role text, p_reference text, p_filters jsonb
) returns table(role text, entity_id bigint, label text)
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then raise exception 'Not permitted'; end if;
  if p_filters->>'podState' is not null and not public.whatsapp_assistant_has_permission(p_app_user_id, 'pod') then raise exception 'Not permitted'; end if;
  if p_role is null or p_role not in ('consignor','consignee','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','originCity','destinationCity','vehicleNumber','transporter')
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
    union all
    select 'consignor'::text as role, l.consignor_id as entity_id, c.name as label, c.name as search_text
    from scoped l join public.customers c
      on p_role = 'originCity' and l.consignor_id is not null and c.id = l.consignor_id
    where lower(trim(c.city)) = lower(trim(p_reference))
    union all
    select 'consignee'::text as role, l.consignee_id as entity_id, c.name as label, c.name as search_text
    from scoped l join public.customers c
      on p_role = 'destinationCity' and l.consignee_id is not null and c.id = l.consignee_id
    where lower(trim(c.city)) = lower(trim(p_reference))
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
  ), matched_candidates as materialized (
    select c.role,
      case when p_role = 'partySearch' and c.role in ('consignor','consignee') then 'partySearch' else c.role end as effective_role,
      c.entity_id, c.label, c.search_text
    from distinct_candidates c
    where (c.role = p_role
      or (p_role = 'partySearch' and c.role in ('consignor','consignee'))
      or (p_role = 'entitySearch' and c.role in ('consignor','consignee','material','bookingBranch','transporter'))
      or (p_role = 'originSearch' and c.role in ('consignor','bookingBranch'))
      or (p_role = 'destinationSearch' and c.role in ('consignee','bookingBranch'))
      or (p_role = 'originCity' and c.role = 'consignor')
      or (p_role = 'destinationCity' and c.role = 'consignee'))
      and case when p_role in ('originCity','destinationCity') then true
        when c.role = 'vehicleNumber' then
        upper(c.label) = upper(p_reference) or (p_reference ~ '^[0-9]{4}$' and right(c.label,4) = p_reference)
        else public.whatsapp_internal_name_match(c.search_text, p_reference) end
  ), stable_party_groups as materialized (
    select mc.effective_role, lower(trim(mc.label)) as normalized_label, count(distinct mc.entity_id) as stable_count,
      min(mc.entity_id) as stable_id, min(trim(mc.label)) as stable_label
    from matched_candidates mc
    where mc.role in ('consignor','consignee') and mc.entity_id is not null
    group by mc.effective_role, lower(trim(mc.label))
  ), canonical_candidates as materialized (
    select c.role, c.effective_role,
      case when c.role in ('consignor','consignee') and c.entity_id is null and g.stable_count = 1 then g.stable_id else c.entity_id end as entity_id,
      case when c.role in ('consignor','consignee','fromStation','toStation') then lower(trim(c.label)) else c.label end as grouping_key,
      case when c.role in ('consignor','consignee') and g.stable_count = 1 then g.stable_label
        when c.role in ('consignor','consignee','fromStation','toStation') then trim(c.label)
        else c.label end as display_label
    from matched_candidates c
    left join stable_party_groups g on g.effective_role=c.effective_role and g.normalized_label=lower(trim(c.label))
  ), resolved_candidates as materialized (
    select case when c.effective_role='partySearch' then 'partySearch' else c.role end as role, c.entity_id,
      min(c.display_label) as label
    from canonical_candidates c
    group by case when c.effective_role='partySearch' then 'partySearch' else c.role end, c.entity_id, c.grouping_key
  )
  select c.role, c.entity_id, c.label from resolved_candidates c
  where nullif(trim(c.label),'') is not null
  order by 1, 2, 3
  limit 6; -- six detects overflow; only five display options may leave query RPC
end;
$$;

create or replace function public.whatsapp_internal_operational_query(
  p_app_user_id uuid, p_operation text, p_filters jsonb
) returns jsonb language plpgsql stable security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  allowed text[] := array['lrDateFrom','lrDateTo','createdAtFrom','createdAtTo','consignor','consignee','vehicleNumber','countOnly','limit','offset','lrNumber','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','originCity','destinationCity','transporter','status','entryStatus','podState','minPendingDays','resolvedOriginCustomerId','resolvedDestinationCustomerId'];
  entity_keys text[] := array['consignor','consignee','partySearch','material','bookingBranch','fromStation','toStation','entitySearch','originSearch','destinationSearch','originCity','destinationCity','transporter','vehicleNumber'];
  k text; v text; v_matches jsonb; resolved jsonb := '{}'::jsonb; issues jsonb := '[]'::jsonb;
  chosen jsonb; candidate jsonb; issue_options jsonb; issue_role text;
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
    elsif k in ('limit','offset','minPendingDays','resolvedOriginCustomerId','resolvedDestinationCustomerId') then
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

  -- Private continuation IDs are accepted only when they remain members of the
  -- original authorized directional candidate set. They are never rendered.
  if p_filters->>'resolvedOriginCustomerId' is not null then
    if p_filters->>'originCity' is null then raise exception 'Invalid resolved identity'; end if;
    select to_jsonb(c) into chosen from public.whatsapp_internal_entity_candidates(
      p_app_user_id,'originCity',p_filters->>'originCity',p_filters
    ) c where c.role='consignor' and c.entity_id=(p_filters->>'resolvedOriginCustomerId')::bigint;
    if chosen is null then raise exception 'Stale resolved identity'; end if;
    resolved := resolved || jsonb_build_object('consignor',chosen);
  end if;
  if p_filters->>'resolvedDestinationCustomerId' is not null then
    if p_filters->>'destinationCity' is null then raise exception 'Invalid resolved identity'; end if;
    select to_jsonb(c) into chosen from public.whatsapp_internal_entity_candidates(
      p_app_user_id,'destinationCity',p_filters->>'destinationCity',p_filters
    ) c where c.role='consignee' and c.entity_id=(p_filters->>'resolvedDestinationCustomerId')::bigint;
    if chosen is null then raise exception 'Stale resolved identity'; end if;
    resolved := resolved || jsonb_build_object('consignee',chosen);
  end if;

  foreach k in array entity_keys loop
    v := p_filters->>k;
    if v is null then continue; end if;
    if (k='originCity' and p_filters->>'resolvedOriginCustomerId' is not null)
      or (k='destinationCity' and p_filters->>'resolvedDestinationCustomerId' is not null) then continue; end if;
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_matches
      from public.whatsapp_internal_entity_candidates(p_app_user_id,k,v,p_filters) c;
    if jsonb_array_length(v_matches) <> 1 then
      issue_options := '[]'::jsonb;
      for candidate in select value from jsonb_array_elements(v_matches) loop
        if jsonb_array_length(issue_options) < 5 then
          issue_options := issue_options || jsonb_build_array(jsonb_build_object('role',candidate->>'role','label',candidate->>'label'));
        end if;
      end loop;
      issue_role := case k when 'originCity' then 'consignor' when 'destinationCity' then 'consignee' else k end;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'field',k,'reference',v,'role',issue_role,'options',issue_options));
    else
      chosen := v_matches->0;
      if resolved ? (chosen->>'role') then
        -- Two source dimensions may not silently overwrite each other.
        if resolved->(chosen->>'role') <> chosen then
          issue_role := case k when 'originCity' then 'consignor' when 'destinationCity' then 'consignee' else k end;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'field',k,'reference',v,'role',issue_role,
            'options',jsonb_build_array(jsonb_build_object('role',chosen->>'role','label',chosen->>'label'))));
        end if;
      else resolved := resolved || jsonb_build_object(chosen->>'role',chosen); end if;
    end if;
  end loop;
  if jsonb_array_length(issues) > 0 then return jsonb_build_object('status','clarification','issues',issues); end if;
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
      and (not (resolved ? 'consignor') or case when resolved->'consignor'->>'entity_id' is not null then l.consignor_id=(resolved->'consignor'->>'entity_id')::bigint or (l.consignor_id is null and lower(trim(l.consignor))=lower(trim(resolved->'consignor'->>'label'))) else l.consignor_id is null and lower(trim(l.consignor))=lower(trim(resolved->'consignor'->>'label')) end)
      and (not (resolved ? 'consignee') or case when resolved->'consignee'->>'entity_id' is not null then l.consignee_id=(resolved->'consignee'->>'entity_id')::bigint or (l.consignee_id is null and lower(trim(l.consignee))=lower(trim(resolved->'consignee'->>'label'))) else l.consignee_id is null and lower(trim(l.consignee))=lower(trim(resolved->'consignee'->>'label')) end)
      and (not (resolved ? 'partySearch') or case when resolved->'partySearch'->>'entity_id' is not null
        then l.consignor_id=(resolved->'partySearch'->>'entity_id')::bigint or l.consignee_id=(resolved->'partySearch'->>'entity_id')::bigint or (l.consignor_id is null and lower(trim(l.consignor))=lower(trim(resolved->'partySearch'->>'label'))) or (l.consignee_id is null and lower(trim(l.consignee))=lower(trim(resolved->'partySearch'->>'label')))
        else (l.consignor_id is null and lower(trim(l.consignor))=lower(trim(resolved->'partySearch'->>'label'))) or (l.consignee_id is null and lower(trim(l.consignee))=lower(trim(resolved->'partySearch'->>'label'))) end)
      and (not (resolved ? 'material') or l.material=resolved->'material'->>'label')
      and (not (resolved ? 'bookingBranch') or l.booking_branch=resolved->'bookingBranch'->>'label')
      and (not (resolved ? 'fromStation') or lower(trim(l.from_station))=lower(trim(resolved->'fromStation'->>'label')))
      and (not (resolved ? 'toStation') or lower(trim(l.to_station))=lower(trim(resolved->'toStation'->>'label')))
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

create table public.whatsapp_internal_pending_resolutions (
  id bigint generated always as identity primary key,
  principal_kind text not null check (principal_kind = 'staff'),
  principal_id uuid not null references public.app_users(id) on delete cascade,
  sender_phone_e164 text not null check (sender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source_event_id bigint not null references public.whatsapp_inbound_events(id) on delete restrict,
  operation text not null check (operation in ('search_lrs','search_pending_pods','get_lr_detail','get_pod_detail')),
  filters jsonb not null check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 8192),
  issues jsonb not null check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) between 1 and 2),
  status text not null default 'pending' check (status in ('pending','consumed','cancelled','superseded','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  consumed_at timestamptz,
  consumed_by_event_id bigint references public.whatsapp_inbound_events(id) on delete restrict,
  check (expires_at > created_at)
);

create unique index whatsapp_internal_pending_resolution_active_unique
  on public.whatsapp_internal_pending_resolutions(principal_kind,principal_id,sender_phone_e164)
  where status='pending';

alter table public.whatsapp_internal_pending_resolutions enable row level security;
revoke all on table public.whatsapp_internal_pending_resolutions from public, anon, authenticated;
revoke all on sequence public.whatsapp_internal_pending_resolutions_id_seq from public, anon, authenticated;
grant all on table public.whatsapp_internal_pending_resolutions to service_role;
grant usage, select on sequence public.whatsapp_internal_pending_resolutions_id_seq to service_role;

create function public.whatsapp_internal_operational_begin(
  p_app_user_id uuid, p_sender_phone_e164 text, p_event_id bigint,
  p_operation text, p_filters jsonb
) returns jsonb language plpgsql volatile security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_result jsonb; v_private jsonb := '[]'::jsonb; v_issue jsonb;
  v_options jsonb; v_public_issue jsonb;
begin
  if not exists(
    select 1 from public.whatsapp_inbound_events e
    join public.whatsapp_user_links w on w.app_user_id=p_app_user_id and w.is_active
      and w.whatsapp_phone_e164=p_sender_phone_e164
    where e.id=p_event_id and e.app_user_id=p_app_user_id
      and e.sender_phone_e164=p_sender_phone_e164 and e.processing_status='authorized'
  ) then raise exception 'Not permitted'; end if;
  if not public.whatsapp_assistant_has_permission(p_app_user_id,'lr') then raise exception 'Not permitted'; end if;

  -- A new complete validated operational request supersedes older context.
  update public.whatsapp_internal_pending_resolutions set status='superseded'
  where principal_kind='staff' and principal_id=p_app_user_id
    and sender_phone_e164=p_sender_phone_e164 and status='pending';

  v_result := public.whatsapp_internal_operational_query(p_app_user_id,p_operation,p_filters);
  if v_result->>'status' <> 'clarification' then return v_result; end if;

  for v_issue in select value from jsonb_array_elements(v_result->'issues') loop
    if v_issue->>'field' not in ('originCity','destinationCity')
      or jsonb_array_length(v_issue->'options')=0 then
      return v_result;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'role',c.role,'label',c.label,'entity_id',c.entity_id) order by c.role,c.entity_id,c.label),'[]'::jsonb)
      into v_options
    from (select * from public.whatsapp_internal_entity_candidates(
      p_app_user_id,v_issue->>'field',v_issue->>'reference',p_filters) limit 5) c
    where c.entity_id is not null;
    if jsonb_array_length(v_options)=0 then return v_result; end if;
    v_private := v_private || jsonb_build_array(jsonb_build_object(
      'field',v_issue->>'field','reference',v_issue->>'reference',
      'role',v_issue->>'role','options',v_options));
  end loop;

  insert into public.whatsapp_internal_pending_resolutions(
    principal_kind,principal_id,sender_phone_e164,source_event_id,operation,filters,issues
  ) values ('staff',p_app_user_id,p_sender_phone_e164,p_event_id,p_operation,p_filters,v_private);

  v_issue := v_private->0;
  select jsonb_build_object('field',v_issue->>'field','reference',v_issue->>'reference',
    'role',v_issue->>'role','options',coalesce(jsonb_agg(jsonb_build_object(
      'role',o->>'role','label',o->>'label') order by ord),'[]'::jsonb))
    into v_public_issue
  from jsonb_array_elements(v_issue->'options') with ordinality x(o,ord);
  return jsonb_build_object('status','clarification','issues',jsonb_build_array(v_public_issue),
    'continuation_ready',true);
end;
$$;

create function public.whatsapp_internal_operational_continue(
  p_app_user_id uuid, p_sender_phone_e164 text, p_event_id bigint, p_selection text
) returns jsonb language plpgsql volatile security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_pending public.whatsapp_internal_pending_resolutions%rowtype;
  v_issue jsonb; v_option jsonb; v_matches integer; v_index integer;
  v_remaining jsonb; v_filters jsonb; v_result jsonb; v_public_issue jsonb;
begin
  if p_selection is null or length(trim(p_selection)) not between 1 and 200
    or p_selection ~ '[[:cntrl:]]' then raise exception 'Invalid selection'; end if;
  if not exists(
    select 1 from public.whatsapp_inbound_events e
    join public.whatsapp_user_links w on w.app_user_id=p_app_user_id and w.is_active
      and w.whatsapp_phone_e164=p_sender_phone_e164
    where e.id=p_event_id and e.app_user_id=p_app_user_id
      and e.sender_phone_e164=p_sender_phone_e164 and e.processing_status='authorized'
  ) or not public.whatsapp_assistant_has_permission(p_app_user_id,'lr') then
    raise exception 'Not permitted';
  end if;

  select * into v_pending from public.whatsapp_internal_pending_resolutions
  where principal_kind='staff' and principal_id=p_app_user_id
    and sender_phone_e164=p_sender_phone_e164 and status='pending'
  for update;
  if not found then return jsonb_build_object('status','no_pending'); end if;
  if v_pending.expires_at <= clock_timestamp() then
    update public.whatsapp_internal_pending_resolutions set status='expired' where id=v_pending.id;
    return jsonb_build_object('status','no_pending');
  end if;
  if lower(trim(p_selection)) in ('cancel','cancel karo','रद्द') then
    update public.whatsapp_internal_pending_resolutions set status='cancelled' where id=v_pending.id;
    return jsonb_build_object('status','cancelled');
  end if;

  v_issue := v_pending.issues->0;
  if trim(p_selection) ~ '^[1-9][0-9]*$' then
    v_index := trim(p_selection)::integer;
    if v_index between 1 and jsonb_array_length(v_issue->'options') then
      v_option := v_issue->'options'->(v_index-1);
    end if;
  else
    select count(*), (array_agg(o))[1] into v_matches,v_option
    from jsonb_array_elements(v_issue->'options') x(o)
    where lower(trim(o->>'label'))=lower(trim(p_selection));
    if v_matches <> 1 then v_option := null; end if;
  end if;

  if v_option is null then
    select jsonb_build_object('field',v_issue->>'field','reference',v_issue->>'reference',
      'role',v_issue->>'role','options',jsonb_agg(jsonb_build_object(
        'role',o->>'role','label',o->>'label') order by ord)) into v_public_issue
    from jsonb_array_elements(v_issue->'options') with ordinality x(o,ord);
    return jsonb_build_object('status','clarification','issues',jsonb_build_array(v_public_issue),
      'continuation_ready',true);
  end if;

  -- The stored ID must still be an authorized candidate now; labels alone never
  -- establish or change identity.
  if not exists(select 1 from public.whatsapp_internal_entity_candidates(
    p_app_user_id,v_issue->>'field',v_issue->>'reference',v_pending.filters) c
    where c.entity_id=(v_option->>'entity_id')::bigint and c.role=v_option->>'role') then
    update public.whatsapp_internal_pending_resolutions set status='expired' where id=v_pending.id;
    return jsonb_build_object('status','no_pending');
  end if;

  v_filters := v_pending.filters || case v_issue->>'field'
    when 'originCity' then jsonb_build_object('resolvedOriginCustomerId',(v_option->>'entity_id')::bigint)
    else jsonb_build_object('resolvedDestinationCustomerId',(v_option->>'entity_id')::bigint) end;
  v_remaining := v_pending.issues - 0;
  if jsonb_array_length(v_remaining)>0 then
    update public.whatsapp_internal_pending_resolutions
      set filters=v_filters,issues=v_remaining where id=v_pending.id;
    v_issue := v_remaining->0;
    select jsonb_build_object('field',v_issue->>'field','reference',v_issue->>'reference',
      'role',v_issue->>'role','options',jsonb_agg(jsonb_build_object(
        'role',o->>'role','label',o->>'label') order by ord)) into v_public_issue
    from jsonb_array_elements(v_issue->'options') with ordinality x(o,ord);
    return jsonb_build_object('status','clarification','issues',jsonb_build_array(v_public_issue),
      'continuation_ready',true);
  end if;

  v_result := public.whatsapp_internal_operational_query(p_app_user_id,v_pending.operation,v_filters);
  if v_result->>'status' <> 'ok' then
    update public.whatsapp_internal_pending_resolutions set status='expired' where id=v_pending.id;
    return jsonb_build_object('status','no_pending');
  end if;
  update public.whatsapp_internal_pending_resolutions set status='consumed',consumed_at=clock_timestamp(),
    consumed_by_event_id=p_event_id,filters=v_filters where id=v_pending.id;
  return v_result || jsonb_build_object('continued',true,'operation',v_pending.operation,
    'filters',v_pending.filters - array['resolvedOriginCustomerId','resolvedDestinationCustomerId']);
end;
$$;

revoke all on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_operational_query(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_operational_begin(uuid,text,bigint,text,jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_operational_continue(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) to service_role;
grant execute on function public.whatsapp_internal_operational_query(uuid,text,jsonb) to service_role;
grant execute on function public.whatsapp_internal_operational_begin(uuid,text,bigint,text,jsonb) to service_role;
grant execute on function public.whatsapp_internal_operational_continue(uuid,text,bigint,text) to service_role;

commit;
