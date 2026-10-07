-- ==========================================================
-- Migration: 115_whatsapp_internal_stage_b_source_aware_count
-- Module: WhatsApp Assistant — versioned source-aware Stage-B LR count
--
-- This forward-only migration adds a narrow, fixed LR vehicle-count path for
-- a future trusted webhook caller.  It does not replace M112/M113 functions,
-- does not change tables, RLS, policies, triggers, or existing grants, and
-- performs no business-data DML/backfill.  M115 is intentionally not wired
-- into the current application by this migration.
--
-- The supplied source is server-owned provenance for what the authenticated
-- sender submitted, but remains untrusted bounded data.  It is never stored,
-- returned, logged, used as SQL syntax, or used as an authorization input.
-- ==========================================================
begin;

-- Fixed internal operation only.  The caller may supply semantic evidence,
-- never an entity ID/span, operation, filters, SQL, sort, or pagination.
create function public.whatsapp_internal_stage_b_lr_vehicle_count_v2(
  p_app_user_id uuid,
  p_source text,
  p_semantics jsonb
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_source text;
  v_tokens text[];
  v_starts integer[];
  v_token_count integer;
  v_i integer;
  v_j integer;
  v_span_text text;
  v_span_start integer;
  v_span_end integer;
  v_span_tokens integer;
  v_entity_spans jsonb := '[]'::jsonb;
  v_period_spans jsonb := '[]'::jsonb;
  v_identities jsonb := '[]'::jsonb;
  v_selected jsonb;
  v_count_evidence text;
  v_movement_evidence text;
  v_period_kind text;
  v_period_evidence text;
  v_count_hits integer := 0;
  v_movement_hits integer := 0;
  v_period_hits integer := 0;
  v_period_overlaps_entity integer := 0;
  v_identity_overflow boolean := false;
  v_count_start integer;
  v_count_end integer;
  v_movement_start integer;
  v_movement_end integer;
  v_period_start integer;
  v_period_end integer;
  v_entity_start integer;
  v_entity_end integer;
  v_entity_id bigint;
  v_entity_label text;
  v_date_from date := null;
  v_date_to date := null;
  v_ist_today date;
  v_total bigint;
  v_span jsonb;
  v_previous_end integer := 0;
  v_gap text;
  v_gap_words text;
  v_coverage jsonb;
  v_item jsonb;
  v_parenthesis_depth integer := 0;
  v_parenthesis_has_content boolean := false;
  v_char text;
  v_index integer;
begin
  -- Validate untrusted inputs before any expensive work.  The source contract
  -- is English/Roman Hinglish only; non-ASCII text (including Devanagari) is
  -- outside this deliberately narrow Stage-B capability.
  if p_source is null or octet_length(p_source) not between 1 and 1024
    or p_source ~ '[[:cntrl:]]'
    or p_source ~ '[^A-Za-z0-9[:space:](),.?/!''-]' then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;
  v_source := btrim(p_source);
  if v_source = '' then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- Authorization precedes every Customer Master/LR business read.
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then
    raise exception 'Not permitted';
  end if;

  if jsonb_typeof(p_semantics) is distinct from 'object'
    or p_semantics - array['countEvidence','movementEvidence','periodKind','periodEvidence'] <> '{}'::jsonb
    or not (p_semantics ? 'countEvidence' and p_semantics ? 'movementEvidence'
      and p_semantics ? 'periodKind' and p_semantics ? 'periodEvidence')
    or jsonb_typeof(p_semantics->'countEvidence') <> 'string'
    or jsonb_typeof(p_semantics->'movementEvidence') <> 'string'
    or jsonb_typeof(p_semantics->'periodKind') not in ('string','null')
    or jsonb_typeof(p_semantics->'periodEvidence') not in ('string','null')
    or (p_semantics->>'periodKind' is null) <> (p_semantics->>'periodEvidence' is null) then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  v_count_evidence := lower(trim(p_semantics->>'countEvidence'));
  v_movement_evidence := lower(trim(p_semantics->>'movementEvidence'));
  v_period_kind := p_semantics->>'periodKind';
  v_period_evidence := lower(trim(p_semantics->>'periodEvidence'));
  if length(v_count_evidence) not between 1 and 80
    or length(v_movement_evidence) not between 1 and 80
    or (v_period_evidence is not null and length(v_period_evidence) not between 1 and 80)
    or v_count_evidence !~ '^[a-z0-9 ]+$'
    or v_movement_evidence !~ '^[a-z0-9 ]+$'
    or (v_period_evidence is not null and v_period_evidence !~ '^[a-z0-9 ]+$')
    or v_count_evidence not in ('how many','total','number of','count','kitna','kitni','kitne','kitha')
    or v_movement_evidence not in ('lr','lrs','vehicle','vehicles','gaadi','gadi','gari','loaded','load hua','load hui','load hue','lode hua','lode hui','lode hue','laga','lagi','lage')
    or (v_period_kind is not null and not (
      (v_period_kind='today' and v_period_evidence in ('today','aaj'))
      or (v_period_kind='yesterday' and v_period_evidence='yesterday')
      or (v_period_kind='current_month' and v_period_evidence in ('this month','ye month','is month','iss month','is mahine','iss mahine','ye mahina'))
      or (v_period_kind='previous_month' and v_period_evidence in ('last month','last mnth','previous month','pichle month','pichhle month','pichle mahine','pichhle mahine','pichla mahina'))
    )) then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- SQL is authoritative for the v55 parenthesis invariant: balanced,
  -- single-level, and each group contains at least one letter or digit.
  for v_index in 1..char_length(v_source) loop
    v_char := substr(v_source,v_index,1);
    if v_char='(' then
      if v_parenthesis_depth <> 0 then
        return jsonb_build_object('status','clarification','reason','unsupported_request');
      end if;
      v_parenthesis_depth := 1;
      v_parenthesis_has_content := false;
    elsif v_char=')' then
      if v_parenthesis_depth <> 1 or not v_parenthesis_has_content then
        return jsonb_build_object('status','clarification','reason','unsupported_request');
      end if;
      v_parenthesis_depth := 0;
    elsif v_parenthesis_depth = 1 and v_char ~ '[A-Za-z0-9]' then
      v_parenthesis_has_content := true;
    end if;
  end loop;
  if v_parenthesis_depth <> 0 then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- Token positions are calculated once from the complete source.  They are
  -- used for bounded evidence verification and set-based entity discovery.
  select array_agg(lower(token) order by ord), array_agg(start_pos order by ord)
    into v_tokens, v_starts
  from (
    select ord, m[2] as token,
      sum(length(coalesce(m[1],'')) + length(m[2])) over(order by ord) - length(m[2]) + 1 as start_pos
    from regexp_matches(v_source, '(^|[^A-Za-z0-9]+)([A-Za-z0-9]+)', 'g') with ordinality as x(m,ord)
  ) tokens;
  v_token_count := coalesce(array_length(v_tokens,1),0);
  if v_token_count not between 1 and 48 then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- Enumerate at most 462 contiguous 2..12-token source intervals.  No
  -- grammar is removed before matching; these intervals are actual source.
  for v_i in 1..v_token_count loop
    for v_j in (v_i + 1)..least(v_i + 11,v_token_count) loop
      v_span_start := v_starts[v_i];
      v_span_end := v_starts[v_j] + length(v_tokens[v_j]) - 1;
      v_entity_spans := v_entity_spans || jsonb_build_array(jsonb_build_object(
        'start_pos',v_span_start,'finish_pos',v_span_end,'token_count',v_j-v_i+1,
        'source_text',substring(v_source from v_span_start for v_span_end-v_span_start+1)
      ));
    end loop;
  end loop;

  -- The semantic model supplies evidence text, never positions.  Source token
  -- intervals independently prove each evidence occurrence and all date words.
  for v_i in 1..v_token_count loop
    for v_j in v_i..least(v_i + 2,v_token_count) loop
      v_span_text := array_to_string(v_tokens[v_i:v_j],' ');
      v_span_start := v_starts[v_i];
      v_span_end := v_starts[v_j] + length(v_tokens[v_j]) - 1;
      if v_span_text=v_count_evidence then
        v_count_hits := v_count_hits + 1; v_count_start := v_span_start; v_count_end := v_span_end;
      end if;
      if v_span_text=v_movement_evidence then
        v_movement_hits := v_movement_hits + 1; v_movement_start := v_span_start; v_movement_end := v_span_end;
      end if;
      if v_span_text in ('today','aaj','yesterday','this month','ye month','is month','iss month','is mahine','iss mahine','ye mahina','last month','last mnth','previous month','pichle month','pichhle month','pichle mahine','pichhle mahine','pichla mahina') then
        v_period_spans := v_period_spans || jsonb_build_array(jsonb_build_object('start',v_span_start,'finish',v_span_end,'text',v_span_text));
        if v_period_evidence is not null and v_span_text=v_period_evidence then
          v_period_hits := v_period_hits + 1; v_period_start := v_span_start; v_period_end := v_span_end;
        end if;
      end if;
    end loop;
  end loop;
  if v_count_hits <> 1 or v_movement_hits <> 1
    or (v_period_kind is not null and v_period_hits <> 1) then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- One set-based historical LR universe: stable non-NULL party IDs only.
  -- It deliberately has no requested-period/status/POD/pending filters and
  -- never scans arbitrary Customer Master rows.  Snapshot aliases are usable
  -- only for an already LR-linked stable ID; NULL-only snapshots invent none.
  with spans as materialized (
    select * from jsonb_to_recordset(v_entity_spans) as s(start_pos integer, finish_pos integer, token_count integer, source_text text)
  ), historical_representations as materialized (
    select distinct l.consignor_id as entity_id, c.name as canonical_label, c.name as representation
    from public.lrs l join public.customers c on c.id=l.consignor_id
    where coalesce(l.entry_status,'final')='final' and l.consignor_id is not null and nullif(trim(c.name),'') is not null
    union
    select distinct l.consignor_id, c.name, l.consignor
    from public.lrs l join public.customers c on c.id=l.consignor_id
    where coalesce(l.entry_status,'final')='final' and l.consignor_id is not null
      and nullif(trim(c.name),'') is not null and nullif(trim(l.consignor),'') is not null
    union
    select distinct l.consignee_id, c.name, c.name
    from public.lrs l join public.customers c on c.id=l.consignee_id
    where coalesce(l.entry_status,'final')='final' and l.consignee_id is not null and nullif(trim(c.name),'') is not null
    union
    select distinct l.consignee_id, c.name, l.consignee
    from public.lrs l join public.customers c on c.id=l.consignee_id
    where coalesce(l.entry_status,'final')='final' and l.consignee_id is not null
      and nullif(trim(c.name),'') is not null and nullif(trim(l.consignee),'') is not null
  ), classified_spans as materialized (
    select s.*,
      lower(trim(regexp_replace(s.source_text, '[^A-Za-z0-9]+', ' ', 'g'))) as normalized_text,
      lower(trim(regexp_replace(s.source_text, '[^A-Za-z0-9]+', ' ', 'g'))) in (
        'how many','number of','count','total','kitna','kitni','kitne','kitha',
        'lr','lrs','vehicle','vehicles','gaadi','gadi','gari','loaded',
        'load hua','load hui','load hue','lode hua','lode hui','lode hue',
        'laga','lagi','lage',
        'today','aaj','yesterday','this month','ye month','is month','iss month',
        'is mahine','iss mahine','ye mahina','last month','last mnth',
        'previous month','pichle month','pichhle month','pichle mahine',
        'pichhle mahine','pichla mahina'
      ) as is_reserved_semantic
    from spans s
  ), matched as materialized (
    select distinct h.entity_id, h.canonical_label, s.start_pos, s.finish_pos, s.token_count
    from historical_representations h cross join classified_spans s
    where case when s.is_reserved_semantic then
      lower(trim(regexp_replace(h.representation, '[^A-Za-z0-9]+', ' ', 'g'))) = s.normalized_text
      else public.whatsapp_internal_name_match(h.representation,s.source_text)
    end
  ), identity_bounds as materialized (
    select m.entity_id, min(m.canonical_label) as label, max(m.token_count) as max_tokens
    from matched m group by m.entity_id
  ), maximal as materialized (
    select m.entity_id,m.start_pos,m.finish_pos,m.token_count
    from matched m join identity_bounds p on p.entity_id=m.entity_id and p.max_tokens=m.token_count
  ), per_identity as materialized (
    select p.entity_id, p.label, p.max_tokens,
      exists(select 1 from maximal a join maximal b on a.entity_id=p.entity_id and b.entity_id=p.entity_id
        and (a.finish_pos < b.start_pos or b.finish_pos < a.start_pos)) as has_disjoint_spans
    from identity_bounds p
  ), summaries_all as materialized (
    select p.entity_id,p.label,p.has_disjoint_spans,count(distinct (m.start_pos,m.finish_pos)) as maximal_span_count,
      min(m.start_pos) as start_pos,min(m.finish_pos) as finish_pos
    from per_identity p join maximal m on m.entity_id=p.entity_id
    group by p.entity_id,p.label,p.has_disjoint_spans
  ), summaries as (
    select summaries_all.*, count(*) over() as identity_count
    from summaries_all
    order by entity_id
    limit 6 -- retain at most six identities; identity_count is the overflow sentinel.
  )
  select coalesce(jsonb_agg(jsonb_build_object('entity_id',entity_id,'label',label,
    'has_disjoint_spans',has_disjoint_spans,'maximal_span_count',maximal_span_count,
    'start',start_pos,'finish',finish_pos) order by entity_id),'[]'::jsonb)
    , coalesce(bool_or(identity_count > 6),false)
    into v_identities, v_identity_overflow
  from summaries;

  -- Zero/multiple/overflow identities and disjoint/equal-maximal aliases all
  -- clarify before a final LR count.  No candidate labels or IDs are returned.
  if v_identity_overflow or jsonb_array_length(v_identities) <> 1 then
    return jsonb_build_object('status','clarification','reason','company_required');
  end if;
  v_selected := v_identities->0;
  if coalesce((v_selected->>'has_disjoint_spans')::boolean,false)
    or coalesce((v_selected->>'maximal_span_count')::integer,0) <> 1 then
    return jsonb_build_object('status','clarification','reason','company_required');
  end if;
  v_entity_id := (v_selected->>'entity_id')::bigint;
  v_entity_label := v_selected->>'label';
  v_entity_start := (v_selected->>'start')::integer;
  v_entity_end := (v_selected->>'finish')::integer;

  -- Any recognized Stage-B date phrase inside the selected entity is ambiguous:
  -- it cannot be silently ignored or used as reporting-period evidence.
  select count(*) into v_period_overlaps_entity from jsonb_array_elements(v_period_spans) x(value)
    where (value->>'finish')::integer >= v_entity_start and (value->>'start')::integer <= v_entity_end;
  if v_period_overlaps_entity <> 0 then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- Semantic evidence cannot overlap each other or the selected identity.
  if v_count_end >= v_movement_start and v_movement_end >= v_count_start
    or v_count_end >= v_entity_start and v_entity_end >= v_count_start
    or v_movement_end >= v_entity_start and v_entity_end >= v_movement_start
    or (v_period_kind is not null and (
      v_period_end >= v_entity_start and v_entity_end >= v_period_start
      or v_period_end >= v_count_start and v_count_end >= v_period_start
      or v_period_end >= v_movement_start and v_movement_end >= v_period_start
    )) then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;
  select count(*) into v_index from jsonb_array_elements(v_period_spans) x(value)
    where (value->>'finish')::integer < v_entity_start or (value->>'start')::integer > v_entity_end;
  if (v_period_kind is null and v_index <> 0) or (v_period_kind is not null and v_index <> 1) then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  -- Every lexical token must be explained.  Residual relation words are only
  -- accepted in interior gaps after discovery; they never create boundaries.
  v_coverage := jsonb_build_array(
    jsonb_build_object('start',v_entity_start,'finish',v_entity_end),
    jsonb_build_object('start',v_count_start,'finish',v_count_end),
    jsonb_build_object('start',v_movement_start,'finish',v_movement_end)
  ) || case when v_period_kind is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('start',v_period_start,'finish',v_period_end)) end;
  for v_item in select value from jsonb_array_elements(v_coverage) order by (value->>'start')::integer loop
    if (v_item->>'start')::integer < v_previous_end + 1 then
      return jsonb_build_object('status','clarification','reason','unsupported_request');
    end if;
    v_gap := substring(v_source from v_previous_end + 1 for (v_item->>'start')::integer - v_previous_end - 1);
    v_gap_words := array_to_string(array(select lower(x[1]) from regexp_matches(v_gap,'[A-Za-z0-9]+','g') x),' ');
    if v_previous_end = 0 or v_gap_words = '' then
      if v_gap !~ '^[[:space:](),.?/!-]*$' then return jsonb_build_object('status','clarification','reason','unsupported_request'); end if;
    elsif v_gap_words not in ('for','to','ka','ki','k','ke liye','k liye','me','mein') then
      return jsonb_build_object('status','clarification','reason','unsupported_request');
    end if;
    v_previous_end := (v_item->>'finish')::integer;
  end loop;
  v_gap := substring(v_source from v_previous_end + 1);
  v_gap_words := array_to_string(array(select lower(x[1]) from regexp_matches(v_gap,'[A-Za-z0-9]+','g') x),' ');
  if v_gap_words <> '' or v_gap !~ '^[[:space:](),.?/!-]*$' then
    return jsonb_build_object('status','clarification','reason','unsupported_request');
  end if;

  v_ist_today := (timezone('Asia/Kolkata',clock_timestamp()))::date;
  if v_period_kind='today' then v_date_from := v_ist_today; v_date_to := v_ist_today;
  elsif v_period_kind='yesterday' then v_date_from := v_ist_today - 1; v_date_to := v_ist_today - 1;
  elsif v_period_kind='current_month' then v_date_from := date_trunc('month',v_ist_today)::date; v_date_to := (date_trunc('month',v_ist_today) + interval '1 month - 1 day')::date;
  elsif v_period_kind='previous_month' then v_date_from := (date_trunc('month',v_ist_today) - interval '1 month')::date; v_date_to := date_trunc('month',v_ist_today)::date - 1;
  end if;

  -- Final read-only fixed count.  M109's stable-ID + canonical NULL-snapshot
  -- compatibility is applied only after a stable identity is established.
  select count(*) into v_total
  from public.lrs l
  where coalesce(l.entry_status,'final')='final'
    and coalesce(l.status,'') <> 'Cancelled'
    and (v_date_from is null or l.lr_date >= v_date_from)
    and (v_date_to is null or l.lr_date <= v_date_to)
    and (
      l.consignor_id=v_entity_id or l.consignee_id=v_entity_id
      or (l.consignor_id is null and lower(trim(l.consignor))=lower(trim(v_entity_label)))
      or (l.consignee_id is null and lower(trim(l.consignee))=lower(trim(v_entity_label)))
    );
  return jsonb_build_object('status','answered','operation','lr_vehicle_count','total_count',v_total);
end;
$$;

-- Webhook entry point.  It reuses M112's trusted event/user/phone binding and
-- has no pending-state or other write side effect.
create function public.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2(
  p_app_user_id uuid,
  p_sender_phone_e164 text,
  p_event_id bigint,
  p_source text,
  p_semantics jsonb
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not exists(
    select 1 from public.whatsapp_inbound_events e
    join public.whatsapp_user_links w on w.app_user_id=p_app_user_id and w.is_active
      and w.whatsapp_phone_e164=p_sender_phone_e164
    where e.id=p_event_id and e.app_user_id=p_app_user_id
      and e.sender_phone_e164=p_sender_phone_e164 and e.processing_status='authorized'
  ) then
    raise exception 'Not permitted';
  end if;
  if not public.whatsapp_assistant_has_permission(p_app_user_id,'lr') then
    raise exception 'Not permitted';
  end if;
  return public.whatsapp_internal_stage_b_lr_vehicle_count_v2(p_app_user_id,p_source,p_semantics);
end;
$$;

revoke all on function public.whatsapp_internal_stage_b_lr_vehicle_count_v2(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2(uuid,text,bigint,text,jsonb) from public, anon, authenticated;
-- The unbound core is intentionally not callable by service_role.  The fixed
-- begin entry point runs it under its definer after event/user/phone binding.
grant execute on function public.whatsapp_internal_stage_b_lr_vehicle_count_begin_v2(uuid,text,bigint,text,jsonb) to service_role;

commit;
