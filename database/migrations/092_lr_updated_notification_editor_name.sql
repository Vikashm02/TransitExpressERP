-- ==========================================================
-- Migration: 092_lr_updated_notification_editor_name
-- Module:    Trusted LR update notification — editor attribution
--
-- Problem:
--   queue_trusted_lr_created_notification() resolves the actor name
--   from public.app_users (display_name → email → 'A staff member')
--   and bakes 'Created by <name>' into the event body, but
--   queue_trusted_lr_updated_notification() only stores changed-field
--   labels, so EDITED notifications never show who edited.
--   Downstream dispatchers deliver title/body verbatim and perform
--   no actor lookup, so the name must be resolved at enqueue time.
--
-- Fix:
--   Replace queue_trusted_lr_updated_notification() ONLY, adding the
--   exact same app_users name lookup used by the created function and
--   appending 'Edited by <name>' to the existing changed-field body.
--   The authenticated UUID (auth.uid()) remains the sole authority;
--   NEW.updated_by, frontend, and payload names are never trusted.
--
-- Additive ONLY:
--   - Replaces public.queue_trusted_lr_updated_notification().
--   - Does NOT create/modify any trigger or insert path.
--   - Does NOT change LR created/deleted, POD, DC, Financials,
--     Billing, Credit/Debit Notes, ASN, or Bid notifications.
--   - Does NOT change notification_events schema, RLS, permissions,
--     Edge Functions, push/FCM/inbox delivery, or Android/APK.
--   - No historical notification backfill.
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

create or replace function public.queue_trusted_lr_updated_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rule public.notification_rules%rowtype; v_after timestamptz; v_changes jsonb; v_first jsonb; v_count integer; v_body text; v_href text; v_name text;
begin
 if coalesce(current_setting('app.suppress_lr_updated_notifications',true),'off')='on' or pg_trigger_depth()>1 or auth.uid() is null or new.updated_by is distinct from auth.uid() or coalesce(new.entry_status,'final')<>'final' then return null; end if;
 if coalesce(old.entry_status,'final')='draft' then return null; end if;
 v_changes := public.lr_notification_changed_fields(old,new);
 if jsonb_array_length(v_changes)=0 then return null; end if;
 begin
  select * into v_rule from public.notification_rules where rule_key='lr.updated';
  if coalesce(v_rule.enabled,false) then
   select coalesce(nullif(trim(display_name),''),nullif(trim(email),''),'A staff member') into v_name from public.app_users where id=auth.uid();
   v_after:=public.notification_rule_deliver_after(v_rule.delivery_mode,v_rule.scheduled_time,v_rule.quiet_hours_enabled,v_rule.quiet_hours_start,v_rule.quiet_hours_end,v_rule.timezone);
   v_first:=v_changes->0; v_count:=jsonb_array_length(v_changes); v_body:=v_first->>'label'||case when v_count>1 then ', +'||(v_count-1)||' more' else '' end||' updated';
   v_body:=v_body||chr(10)||'Edited by '||coalesce(v_name,'A staff member');
   v_href:='/lr?view='||new.id::text||'&focus='||(v_first->>'focus');
   insert into public.notification_events(rule_key,title,body,href,payload,created_by,source,deliver_after) values('lr.updated','LR '||new.lr_number||' updated',v_body,v_href,jsonb_build_object('lrId',new.id::text,'lrNumber',new.lr_number,'changedFields',v_changes,'focus',v_first->>'focus'),auth.uid(),'trusted_lr_trigger',v_after);
  end if;
 exception when others then raise warning 'Trusted lr.updated notification enqueue skipped (SQLSTATE %)',SQLSTATE; end;
 return null;
end $$;

comment on function public.queue_trusted_lr_updated_notification() is
  'Trusted LR update notification (Change 2). Unchanged guards/payload/routing; body appends the authenticated editor name resolved from app_users (display_name, email, A staff member), mirroring lr.created. Single emitter; no new trigger or insert path.';
