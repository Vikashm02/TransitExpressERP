-- Migration: 110_whatsapp_internal_entity_candidates_ambiguity_fix
-- Module: Internal WhatsApp operational query
--
-- Qualify resolver CTE columns that collide with RETURNS TABLE output variables.
-- No behavior change, DML/backfill, or table/index/trigger/RLS/policy change.

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
  ), matched_candidates as materialized (
    select c.role,
      case when p_role = 'partySearch' and c.role in ('consignor','consignee') then 'partySearch' else c.role end as effective_role,
      c.entity_id, c.label, c.search_text
    from distinct_candidates c
    where (c.role = p_role
      or (p_role = 'partySearch' and c.role in ('consignor','consignee'))
      or (p_role = 'entitySearch' and c.role in ('consignor','consignee','material','bookingBranch','transporter'))
      or (p_role = 'originSearch' and c.role in ('consignor','bookingBranch'))
      or (p_role = 'destinationSearch' and c.role in ('consignee','bookingBranch')))
      and case when c.role = 'vehicleNumber' then
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

revoke all on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_internal_entity_candidates(uuid,text,text,jsonb) to service_role;

commit;
