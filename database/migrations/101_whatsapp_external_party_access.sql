-- External WhatsApp LR/POD access. LOCAL SOURCE ONLY; manual review/application.
-- No ERP writes/backfill, internal RPC replacements, or changes to LR/POD RLS.
-- Service-only admissions require a signature-verified event inserted by the host.
-- Disabling/deleting a mapping NEVER releases its cross-system phone reservation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.whatsapp_phone_reservations (
  whatsapp_phone_e164 text primary key check (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  principal_kind text not null check (principal_kind in ('internal', 'external')),
  reserved_at timestamptz not null default now()
);

create table public.whatsapp_external_links (
  id bigint generated always as identity primary key,
  whatsapp_phone_e164 text not null check (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  scope_type text not null check (scope_type in ('billing_party', 'consignor', 'consignee')),
  billing_party_id bigint references public.billing_parties(id) on delete restrict,
  consignor_id bigint references public.customers(id) on delete restrict,
  consignee_id bigint references public.customers(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.app_users(id) on delete restrict,
  disabled_at timestamptz,
  disabled_by uuid references public.app_users(id) on delete restrict,
  replaces_link_id bigint references public.whatsapp_external_links(id) on delete restrict,
  constraint whatsapp_external_exact_scope check (
    (scope_type = 'billing_party' and billing_party_id is not null and consignor_id is null and consignee_id is null)
    or (scope_type = 'consignor' and consignor_id is not null and billing_party_id is null and consignee_id is null)
    or (scope_type = 'consignee' and consignee_id is not null and billing_party_id is null and consignor_id is null)
  ),
  constraint whatsapp_external_disable_audit check (
    (is_active and disabled_at is null and disabled_by is null)
    or (not is_active and disabled_at is not null and disabled_by is not null and disabled_at >= created_at)
  ),
  check (replaces_link_id is null or replaces_link_id <> id)
);
create unique index whatsapp_external_active_phone_idx on public.whatsapp_external_links(whatsapp_phone_e164) where is_active;
create unique index whatsapp_external_replacement_idx on public.whatsapp_external_links(replaces_link_id) where replaces_link_id is not null;
create index whatsapp_external_phone_history_idx on public.whatsapp_external_links(whatsapp_phone_e164, id desc);

-- Serialize against existing provisioners while seeding ALL internal phones,
-- including inactive links. No internal mapping row is rewritten.
lock table public.whatsapp_user_links in share row exclusive mode;
insert into public.whatsapp_phone_reservations(whatsapp_phone_e164, principal_kind)
select distinct whatsapp_phone_e164, 'internal' from public.whatsapp_user_links;

create function public.whatsapp_reserve_mapping_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_claim text;
begin
  if tg_table_schema <> 'public' then raise exception 'Invalid mapping table'; end if;
  if tg_table_name = 'whatsapp_user_links' then v_kind := 'internal';
  elsif tg_table_name = 'whatsapp_external_links' then v_kind := 'external';
  else raise exception 'Invalid mapping table'; end if;
  -- ON CONFLICT locks the unique row even when another transaction created it.
  -- A read-then-insert NOT EXISTS check alone would permit concurrent collisions.
  insert into public.whatsapp_phone_reservations as r(whatsapp_phone_e164, principal_kind)
    values(new.whatsapp_phone_e164, v_kind)
  on conflict (whatsapp_phone_e164) do update
    set principal_kind = r.principal_kind
    where r.principal_kind = excluded.principal_kind
  returning principal_kind into v_claim;
  if v_claim is null then raise exception 'Phone reserved for another identity system'; end if;
  -- Defense against inconsistent historical/privileged data as well.
  if (v_kind = 'external' and exists(select 1 from public.whatsapp_user_links where whatsapp_phone_e164 = new.whatsapp_phone_e164))
    or (v_kind = 'internal' and exists(select 1 from public.whatsapp_external_links where whatsapp_phone_e164 = new.whatsapp_phone_e164)) then
    raise exception 'Phone reserved for another identity system';
  end if;
  return new;
end;
$$;
create trigger whatsapp_internal_phone_reservation before insert or update of whatsapp_phone_e164 on public.whatsapp_user_links
for each row execute function public.whatsapp_reserve_mapping_phone();
create trigger whatsapp_external_phone_reservation before insert on public.whatsapp_external_links
for each row execute function public.whatsapp_reserve_mapping_phone();

create function public.whatsapp_external_immutable_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Disable external mappings; history is immutable'; end if;
  if not old.is_active or new.is_active
    or row(new.id,new.whatsapp_phone_e164,new.scope_type,new.billing_party_id,new.consignor_id,new.consignee_id,new.created_at,new.created_by,new.replaces_link_id)
       is distinct from row(old.id,old.whatsapp_phone_e164,old.scope_type,old.billing_party_id,old.consignor_id,old.consignee_id,old.created_at,old.created_by,old.replaces_link_id) then
    raise exception 'Only audited disabling of an active mapping is allowed';
  end if;
  return new;
end;
$$;
create trigger whatsapp_external_immutable_history before update or delete on public.whatsapp_external_links
for each row execute function public.whatsapp_external_immutable_history();

alter table public.whatsapp_inbound_events
  add column external_link_id bigint references public.whatsapp_external_links(id) on delete restrict,
  add constraint whatsapp_inbound_one_identity check (app_user_id is null or external_link_id is null);

create table public.whatsapp_external_rate_buckets (
  bucket_key text not null check (bucket_key = 'global' or bucket_key ~ '^\+[1-9][0-9]{7,14}$'),
  window_kind text not null check (window_kind in ('minute','day')),
  window_start timestamptz not null,
  used integer not null check (used > 0),
  primary key(bucket_key, window_kind, window_start)
);
create table public.whatsapp_external_admissions (
  event_id bigint primary key references public.whatsapp_inbound_events(id) on delete restrict,
  external_link_id bigint not null references public.whatsapp_external_links(id) on delete restrict,
  admitted_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at = admitted_at + interval '60 seconds'),
  check (consumed_at is null or (consumed_at >= admitted_at and consumed_at < expires_at))
);

create function public.whatsapp_external_require_admin() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists(select 1 from public.app_users u where u.id = v_actor
    and u.role in ('creator','admin') and u.approval_status = 'approved' and u.is_locked is not true) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create function public.whatsapp_external_link_create(p_phone text, p_scope_type text, p_party_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.whatsapp_external_require_admin(); v_link public.whatsapp_external_links;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_party_id is null
    or p_scope_type is null or p_scope_type not in ('billing_party','consignor','consignee') then raise exception 'Invalid mapping'; end if;
  if p_scope_type = 'billing_party' then
    perform 1 from public.billing_parties where id = p_party_id and coalesce(entry_status,'final') = 'final' for share;
  else
    perform 1 from public.customers where id = p_party_id and coalesce(entry_status,'final') = 'final' for share;
  end if;
  if not found then raise exception 'Select a finalized master record'; end if;
  insert into public.whatsapp_external_links(whatsapp_phone_e164,scope_type,billing_party_id,consignor_id,consignee_id,created_by)
  values(p_phone,p_scope_type,case when p_scope_type='billing_party' then p_party_id end,
    case when p_scope_type='consignor' then p_party_id end,case when p_scope_type='consignee' then p_party_id end,v_actor)
  returning * into v_link;
  return to_jsonb(v_link);
end;
$$;

create function public.whatsapp_external_link_disable(p_link_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.whatsapp_external_require_admin(); v_link public.whatsapp_external_links;
begin
  select * into v_link from public.whatsapp_external_links where id=p_link_id for update;
  if not found then raise exception 'Mapping not found'; end if;
  if v_link.is_active then
    update public.whatsapp_external_links set is_active=false,disabled_at=clock_timestamp(),disabled_by=v_actor
    where id=p_link_id returning * into v_link;
  end if;
  return to_jsonb(v_link);
end;
$$;

create function public.whatsapp_external_link_replace(p_link_id bigint,p_scope_type text,p_party_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.whatsapp_external_require_admin(); v_old public.whatsapp_external_links; v_new public.whatsapp_external_links;
begin
  select * into v_old from public.whatsapp_external_links where id=p_link_id for update;
  if not found or not v_old.is_active then raise exception 'Active mapping required'; end if;
  if p_party_id is null or p_scope_type is null or p_scope_type not in ('billing_party','consignor','consignee') then raise exception 'Invalid mapping'; end if;
  if p_scope_type='billing_party' then
    perform 1 from public.billing_parties where id=p_party_id and coalesce(entry_status,'final')='final' for share;
  else
    perform 1 from public.customers where id=p_party_id and coalesce(entry_status,'final')='final' for share;
  end if;
  if not found then raise exception 'Select a finalized master record'; end if;
  perform public.whatsapp_external_link_disable(p_link_id);
  insert into public.whatsapp_external_links(whatsapp_phone_e164,scope_type,billing_party_id,consignor_id,consignee_id,created_by,replaces_link_id)
  values(v_old.whatsapp_phone_e164,p_scope_type,case when p_scope_type='billing_party' then p_party_id end,
    case when p_scope_type='consignor' then p_party_id end,case when p_scope_type='consignee' then p_party_id end,v_actor,p_link_id)
  returning * into v_new;
  return to_jsonb(v_new);
end;
$$;

create function public.whatsapp_external_links_list(p_phone text default null,p_active_only boolean default true,p_before_id bigint default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.whatsapp_external_require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_active_only is null
    or (p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$') then raise exception 'Invalid list filter'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]'::jsonb) from (
    select * from public.whatsapp_external_links where (p_phone is null or whatsapp_phone_e164=p_phone)
      and (not p_active_only or is_active) and (p_before_id is null or id<p_before_id) order by id desc limit p_limit
  ) x);
end;
$$;

-- Private: share-lock a live immutable mapping through the query transaction.
-- Disable/replace serialize with this lock; an already-running query may finish
-- before disable commits. A future sender must recheck before outbound delivery.
create function public.whatsapp_external_authorize(p_link_id bigint,p_phone text)
returns public.whatsapp_external_links language plpgsql security definer set search_path = '' as $$
declare v_link public.whatsapp_external_links;
begin
  select * into v_link from public.whatsapp_external_links where id=p_link_id and is_active
    and whatsapp_phone_e164=p_phone for share;
  if not found or exists(select 1 from public.whatsapp_user_links where whatsapp_phone_e164=p_phone)
    or not exists(select 1 from public.whatsapp_phone_reservations where whatsapp_phone_e164=p_phone and principal_kind='external') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  return v_link;
end;
$$;

create function public.whatsapp_external_take_bucket(p_key text,p_kind text,p_start timestamptz,p_cap integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_used integer;
begin
  insert into public.whatsapp_external_rate_buckets as b(bucket_key,window_kind,window_start,used)
    values(p_key,p_kind,p_start,1)
  on conflict (bucket_key,window_kind,window_start) do update set used=b.used+1 where b.used<p_cap
  returning used into v_used;
  if v_used is null then raise exception 'Admission limit' using errcode='P0002'; end if;
end;
$$;

create function public.whatsapp_external_admit(p_event_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_event public.whatsapp_inbound_events; v_link public.whatsapp_external_links;
  v_now timestamptz; v_minute timestamptz; v_day timestamptz;
begin
  select * into v_event from public.whatsapp_inbound_events where id=p_event_id for update;
  if not found or v_event.processing_status <> 'received' or v_event.message_type <> 'text'
    or v_event.app_user_id is not null or v_event.external_link_id is not null
    or exists(select 1 from public.whatsapp_external_admissions where event_id=p_event_id) then return false; end if;
  select * into v_link from public.whatsapp_external_links where whatsapp_phone_e164=v_event.sender_phone_e164 and is_active;
  if not found then return false; end if;
  begin
    v_link := public.whatsapp_external_authorize(v_link.id,v_event.sender_phone_e164);
  exception when insufficient_privilege then return false;
  end;
  v_now := clock_timestamp();
  v_minute := date_trunc('minute',v_now,'UTC');
  v_day := date_trunc('day',v_now,'UTC');
  -- All increments roll back together on a rejected admission. Global buckets
  -- first in the same order serialize capacity reservations across phones.
  begin
    perform public.whatsapp_external_take_bucket('global','day',v_day,1000);
    perform public.whatsapp_external_take_bucket('global','minute',v_minute,30);
    perform public.whatsapp_external_take_bucket(v_event.sender_phone_e164,'day',v_day,100);
    perform public.whatsapp_external_take_bucket(v_event.sender_phone_e164,'minute',v_minute,5);
    -- Do not charge an expired time window after waiting on contended counters.
    if date_trunc('minute',clock_timestamp(),'UTC') <> v_minute then
      raise exception 'Admission window changed' using errcode='P0002';
    end if;
    v_now := clock_timestamp();
    insert into public.whatsapp_external_admissions(event_id,external_link_id,admitted_at,expires_at)
      values(p_event_id,v_link.id,v_now,v_now+interval '60 seconds');
    update public.whatsapp_inbound_events set external_link_id=v_link.id,processing_status='authorized' where id=p_event_id;
  exception when no_data_found then
    update public.whatsapp_inbound_events set processing_status='ignored' where id=p_event_id;
    return false;
  end;
  return true;
end;
$$;

create function public.whatsapp_external_consume(p_event_id bigint)
returns public.whatsapp_external_links language plpgsql security definer set search_path = '' as $$
declare v_event public.whatsapp_inbound_events; v_admission public.whatsapp_external_admissions; v_link public.whatsapp_external_links; v_now timestamptz;
begin
  select * into v_event from public.whatsapp_inbound_events where id=p_event_id for update;
  if not found or v_event.processing_status <> 'authorized' or v_event.app_user_id is not null or v_event.external_link_id is null then
    raise exception 'Not permitted' using errcode='42501'; end if;
  select * into v_admission from public.whatsapp_external_admissions where event_id=p_event_id for update;
  if not found or v_admission.external_link_id <> v_event.external_link_id or v_admission.consumed_at is not null then
    raise exception 'Not permitted' using errcode='42501'; end if;
  v_link := public.whatsapp_external_authorize(v_admission.external_link_id,v_event.sender_phone_e164);
  v_now := clock_timestamp();
  if v_now < v_admission.admitted_at or v_now >= v_admission.expires_at then raise exception 'Not permitted' using errcode='42501'; end if;
  update public.whatsapp_external_admissions set consumed_at=v_now where event_id=p_event_id;
  return v_link;
end;
$$;

-- Private fixed branches: never authorize by snapshots or return unscoped rows.
-- This helper is not executable by service_role; public RPCs consume admission.
create function public.whatsapp_external_scoped_lrs(p_link public.whatsapp_external_links)
returns setof public.lrs language sql stable security definer set search_path = '' as $$
  select l.* from public.lrs l where p_link.scope_type='billing_party' and l.billing_party_id=p_link.billing_party_id and l.entry_status='final' and l.status is distinct from 'Cancelled'
  union all
  select l.* from public.lrs l where p_link.scope_type='consignor' and l.consignor_id=p_link.consignor_id and l.entry_status='final' and l.status is distinct from 'Cancelled'
  union all
  select l.* from public.lrs l where p_link.scope_type='consignee' and l.consignee_id=p_link.consignee_id and l.entry_status='final' and l.status is distinct from 'Cancelled';
$$;

create function public.whatsapp_external_lr_json(p_lr public.lrs,p_pod_present boolean)
returns jsonb language sql immutable security definer set search_path = '' as $$
 select jsonb_build_object('lr_number',p_lr.lr_number,'lr_date',p_lr.lr_date,
 'consignor',p_lr.consignor,'consignee',p_lr.consignee,'vehicle_number',p_lr.vehicle_number,
 'from_station',p_lr.from_station,'to_station',p_lr.to_station,'material',p_lr.material,'pod_present',p_pod_present);
$$;

create function public.whatsapp_external_validate_filters(
 p_lr_date_from date,p_lr_date_to date,p_created_at_from timestamptz,p_created_at_to timestamptz,
 p_consignor text,p_consignee text,p_vehicle_number text,p_count_only boolean,p_limit integer,p_offset bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if (p_lr_date_from is not null and not isfinite(p_lr_date_from)) or (p_lr_date_to is not null and not isfinite(p_lr_date_to))
 or (p_created_at_from is not null and not isfinite(p_created_at_from)) or (p_created_at_to is not null and not isfinite(p_created_at_to))
 or p_lr_date_from>p_lr_date_to or p_created_at_from>=p_created_at_to
 or (p_consignor is not null and (length(trim(p_consignor))=0 or length(p_consignor)>200))
 or (p_consignee is not null and (length(trim(p_consignee))=0 or length(p_consignee)>200))
 or (p_vehicle_number is not null and (length(trim(p_vehicle_number))=0 or length(p_vehicle_number)>80))
 or p_count_only is null or p_limit is null or p_limit not between 1 and 20 or p_offset is null or p_offset not between 0 and 1000000
 then raise exception 'Invalid query filters'; end if;
end;
$$;

create function public.whatsapp_external_search_lrs(
 p_event_id bigint,
 p_lr_date_from date default null,p_lr_date_to date default null,
 p_created_at_from timestamptz default null,p_created_at_to timestamptz default null,
 p_lr_number text default null,
 p_consignor text default null,p_consignee text default null,p_vehicle_number text default null,
 p_material text default null,
 p_count_only boolean default false,p_limit integer default 20,p_offset bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.whatsapp_external_links;
begin
 perform public.whatsapp_external_validate_filters(p_lr_date_from,p_lr_date_to,p_created_at_from,p_created_at_to,
   p_consignor,p_consignee,p_vehicle_number,p_count_only,p_limit,p_offset);
 if (p_lr_number is not null and (length(trim(p_lr_number))=0 or length(p_lr_number)>80))
 or (p_material is not null and (length(trim(p_material))=0 or length(p_material)>200)) then raise exception 'Invalid query filters'; end if;
 v_link := public.whatsapp_external_consume(p_event_id);
 return (
   with scoped as materialized (select * from public.whatsapp_external_scoped_lrs(v_link)),
   filtered as materialized (
     select l.* from scoped l
     where (p_lr_date_from is null or l.lr_date>=p_lr_date_from)
       and (p_lr_date_to is null or l.lr_date<=p_lr_date_to)
       and (p_created_at_from is null or l.created_at>=p_created_at_from)
       and (p_created_at_to is null or l.created_at<p_created_at_to)
       and (p_consignor is null or upper(trim(l.consignor))=upper(trim(p_consignor)))
       and (p_consignee is null or upper(trim(l.consignee))=upper(trim(p_consignee)))
       and (p_vehicle_number is null or upper(trim(l.vehicle_number))=upper(trim(p_vehicle_number)))
       and (p_lr_number is null or upper(trim(l.lr_number))=upper(trim(p_lr_number)))
       -- strpos gives literal substring semantics: '%' and '_' cannot widen access.
       and (p_material is null or strpos(upper(l.material),upper(trim(p_material)))>0)
   ), paged as materialized (
     select l.* from filtered l where not p_count_only
     order by l.lr_date desc,l.lr_number desc,l.id desc limit p_limit offset p_offset
   )
   select jsonb_build_object('total_count',(select count(*) from filtered),'rows',coalesce((
     select jsonb_agg(public.whatsapp_external_lr_json(l::public.lrs,exists(select 1 from public.pods p where p.lr_number=l.lr_number)) order by l.lr_date desc,l.lr_number desc,l.id desc) from paged l
   ),'[]'::jsonb),'pagination',jsonb_build_object('count_only',p_count_only,'limit',p_limit,'offset',p_offset,
     'returned_count',(select count(*) from paged),'has_more',(select count(*) from filtered)>p_offset+p_limit))
 );
end;
$$;

create function public.whatsapp_external_search_pending_pods(
 p_event_id bigint,
 p_min_pending_days integer default 0,
 p_lr_date_from date default null,p_lr_date_to date default null,
 p_created_at_from timestamptz default null,p_created_at_to timestamptz default null,
 p_consignor text default null,p_consignee text default null,p_vehicle_number text default null,
 p_count_only boolean default false,p_limit integer default 20,p_offset bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.whatsapp_external_links;
begin
 perform public.whatsapp_external_validate_filters(p_lr_date_from,p_lr_date_to,p_created_at_from,p_created_at_to,
   p_consignor,p_consignee,p_vehicle_number,p_count_only,p_limit,p_offset);
 if p_min_pending_days is null or p_min_pending_days not between 0 and 36500 then raise exception 'Invalid pending days'; end if;
 v_link := public.whatsapp_external_consume(p_event_id);
 return (
   with scoped as materialized (select * from public.whatsapp_external_scoped_lrs(v_link)),
   filtered as materialized (
     select l.* from scoped l
     where (p_lr_date_from is null or l.lr_date>=p_lr_date_from)
       and (p_lr_date_to is null or l.lr_date<=p_lr_date_to)
       and (p_created_at_from is null or l.created_at>=p_created_at_from)
       and (p_created_at_to is null or l.created_at<p_created_at_to)
       and (p_consignor is null or upper(trim(l.consignor))=upper(trim(p_consignor)))
       and (p_consignee is null or upper(trim(l.consignee))=upper(trim(p_consignee)))
       and (p_vehicle_number is null or upper(trim(l.vehicle_number))=upper(trim(p_vehicle_number)))
       and not exists(select 1 from public.pods p where p.lr_number=l.lr_number)
       and public._overview_age_days(l.created_at)>=p_min_pending_days
   ), paged as materialized (
     select l.* from filtered l where not p_count_only
     order by public._overview_age_days(l.created_at) desc,l.lr_date asc,l.lr_number asc,l.id asc limit p_limit offset p_offset
   )
   select jsonb_build_object('total_count',(select count(*) from filtered),'rows',coalesce((
     select jsonb_agg(public.whatsapp_external_lr_json(l::public.lrs,false) || jsonb_build_object('pending_days',public._overview_age_days(l.created_at)) order by public._overview_age_days(l.created_at) desc,l.lr_date asc,l.lr_number asc,l.id asc) from paged l
   ),'[]'::jsonb),'pagination',jsonb_build_object('count_only',p_count_only,'limit',p_limit,'offset',p_offset,
     'returned_count',(select count(*) from paged),'has_more',(select count(*) from filtered)>p_offset+p_limit))
 );
end;
$$;

create function public.whatsapp_external_get_lr_detail(p_event_id bigint,p_lr_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.whatsapp_external_links; v_lr public.lrs; v_pod public.pods; v_present boolean;
begin
 if p_lr_number is null or length(trim(p_lr_number))=0 or length(p_lr_number)>80 then raise exception 'Invalid LR number'; end if;
 v_link := public.whatsapp_external_consume(p_event_id);
 select * into v_lr from public.whatsapp_external_scoped_lrs(v_link) l where upper(trim(l.lr_number))=upper(trim(p_lr_number));
 if not found then return jsonb_build_object('found',false); end if;
 v_present := exists(select 1 from public.pods where lr_number=v_lr.lr_number);
 return jsonb_build_object('found',true,'lr',public.whatsapp_external_lr_json(v_lr,v_present));
end;
$$;

create function public.whatsapp_external_get_pod_detail(p_event_id bigint,p_lr_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.whatsapp_external_links; v_lr public.lrs; v_pod public.pods; v_present boolean;
begin
 if p_lr_number is null or length(trim(p_lr_number))=0 or length(p_lr_number)>80 then raise exception 'Invalid LR number'; end if;
 v_link := public.whatsapp_external_consume(p_event_id);
 select * into v_lr from public.whatsapp_external_scoped_lrs(v_link) l where upper(trim(l.lr_number))=upper(trim(p_lr_number));
 if not found then return jsonb_build_object('found',false); end if;
 select * into v_pod from public.pods where lr_number=v_lr.lr_number;
 v_present := found;
 return jsonb_build_object('found',true,'lr',public.whatsapp_external_lr_json(v_lr,v_present),
   'pod_present',v_present,'pod',case when v_present then jsonb_build_object(
     'pod_date',v_pod.pod_date,'unloading_date',v_pod.unloading_date,'unloading_weight',v_pod.unloading_weight,
     'proof_present',coalesce(length(trim(v_pod.proof_url)),0)>0) else null end);
end;
$$;

-- No browser or service-role table DML for the new subsystem: RPCs only.
alter table public.whatsapp_phone_reservations enable row level security;
revoke all on table public.whatsapp_phone_reservations from public,anon,authenticated,service_role;
alter table public.whatsapp_external_links enable row level security;
revoke all on table public.whatsapp_external_links from public,anon,authenticated,service_role;
alter table public.whatsapp_external_rate_buckets enable row level security;
revoke all on table public.whatsapp_external_rate_buckets from public,anon,authenticated,service_role;
alter table public.whatsapp_external_admissions enable row level security;
revoke all on table public.whatsapp_external_admissions from public,anon,authenticated,service_role;
revoke all on sequence public.whatsapp_external_links_id_seq from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_reserve_mapping_phone() from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_immutable_history() from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_require_admin() from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_link_create(text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_link_create(text,text,bigint) to authenticated;
revoke all on function public.whatsapp_external_link_disable(bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_link_disable(bigint) to authenticated;
revoke all on function public.whatsapp_external_link_replace(bigint,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_link_replace(bigint,text,bigint) to authenticated;
revoke all on function public.whatsapp_external_links_list(text,boolean,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_links_list(text,boolean,bigint,integer) to authenticated;
revoke all on function public.whatsapp_external_authorize(bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_take_bucket(text,text,timestamptz,integer) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_admit(bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_admit(bigint) to service_role;
revoke all on function public.whatsapp_external_consume(bigint) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_scoped_lrs(public.whatsapp_external_links) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_lr_json(public.lrs,boolean) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_validate_filters(date,date,timestamptz,timestamptz,text,text,text,boolean,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function public.whatsapp_external_search_lrs(bigint,date,date,timestamptz,timestamptz,text,text,text,text,text,boolean,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_search_lrs(bigint,date,date,timestamptz,timestamptz,text,text,text,text,text,boolean,integer,bigint) to service_role;
revoke all on function public.whatsapp_external_search_pending_pods(bigint,integer,date,date,timestamptz,timestamptz,text,text,text,boolean,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_search_pending_pods(bigint,integer,date,date,timestamptz,timestamptz,text,text,text,boolean,integer,bigint) to service_role;
revoke all on function public.whatsapp_external_get_lr_detail(bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_get_lr_detail(bigint,text) to service_role;
revoke all on function public.whatsapp_external_get_pod_detail(bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_external_get_pod_detail(bigint,text) to service_role;

comment on table public.whatsapp_phone_reservations is 'Permanent internal/external phone partition. Disable/delete never releases a reservation. Reassignment requires separate review.';
comment on table public.whatsapp_external_links is 'Admin-provisioned immutable scope versions. Stable IDs only; disabled versions retained. No ERP account required.';
comment on table public.whatsapp_external_admissions is 'Single-use 60-second external operational admission; contains no messages or query results.';
comment on table public.whatsapp_external_rate_buckets is 'Fixed UTC windows: phone 5/minute,100/day; global 30/minute,1000/day. No raw content. Bounded retention maintenance can be added separately.';
commit;
