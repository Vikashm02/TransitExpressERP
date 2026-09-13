-- Trusted LR notification details and creation events. Apply manually after review.
begin;

create or replace function public.lr_notification_changed_fields(p_old public.lrs, p_new public.lrs)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'focus', focus)), '[]'::jsonb)
  from (values
    ('lr_date','LR Date','lr',p_old.lr_date is distinct from p_new.lr_date),
    ('booking_branch','Booking Branch','lr',p_old.booking_branch is distinct from p_new.booking_branch),
    ('customer','Billing Party','party',p_old.customer is distinct from p_new.customer),
    ('billing_party','GST Payable By','party',p_old.billing_party is distinct from p_new.billing_party),
    ('consignor','Consignor','party',p_old.consignor is distinct from p_new.consignor),
    ('consignor_gst','Consignor GST','party',p_old.consignor_gst is distinct from p_new.consignor_gst),
    ('consignor_address','Consignor Address','party',p_old.consignor_address is distinct from p_new.consignor_address),
    ('consignee','Consignee','party',p_old.consignee is distinct from p_new.consignee),
    ('consignee_gst','Consignee GST','party',p_old.consignee_gst is distinct from p_new.consignee_gst),
    ('consignee_address','Consignee Address','party',p_old.consignee_address is distinct from p_new.consignee_address),
    ('vehicle_number','Vehicle Number','vehicle',p_old.vehicle_number is distinct from p_new.vehicle_number),
    ('vehicle_type','Vehicle Type','vehicle',p_old.vehicle_type is distinct from p_new.vehicle_type),
    ('transporter','Transporter','vehicle',p_old.transporter is distinct from p_new.transporter),
    ('driver_name','Driver Name','vehicle',p_old.driver_name is distinct from p_new.driver_name),
    ('driver_mobile','Driver Mobile','vehicle',p_old.driver_mobile is distinct from p_new.driver_mobile),
    ('from_station','From','vehicle',p_old.from_station is distinct from p_new.from_station),
    ('to_station','To','vehicle',p_old.to_station is distinct from p_new.to_station),
    ('material','Material','material',p_old.material is distinct from p_new.material),
    ('material_description','Material Description','material',p_old.material_description is distinct from p_new.material_description),
    ('package_type','Package Type','material',p_old.package_type is distinct from p_new.package_type),
    ('packages','Packages','material',p_old.packages is distinct from p_new.packages),
    ('loading_weight','Loading Weight','material',p_old.loading_weight is distinct from p_new.loading_weight),
    ('unloading_weight','Unloading Weight','material',p_old.unloading_weight is distinct from p_new.unloading_weight),
    ('charged_weight','Charged Weight','material',p_old.charged_weight is distinct from p_new.charged_weight),
    ('po_number','PO Number','dispatch',p_old.po_number is distinct from p_new.po_number),
    ('po_date','PO Date','dispatch',p_old.po_date is distinct from p_new.po_date),
    ('vendor_code','Vendor Code','dispatch',p_old.vendor_code is distinct from p_new.vendor_code),
    ('dc_number','DC Number','dispatch',p_old.dc_number is distinct from p_new.dc_number),
    ('dc_date','DC Date','dispatch',p_old.dc_date is distinct from p_new.dc_date),
    ('invoice_number','Invoice Number','dispatch',p_old.invoice_number is distinct from p_new.invoice_number),
    ('invoice_date','Invoice Date','dispatch',p_old.invoice_date is distinct from p_new.invoice_date),
    ('eway_bill_number','E-Way Bill Number','dispatch',p_old.eway_bill_number is distinct from p_new.eway_bill_number),
    ('remarks','Remarks','remarks',p_old.remarks is distinct from p_new.remarks)
  ) as fields(key,label,focus,changed) where changed
$$;
revoke all on function public.lr_notification_changed_fields(public.lrs, public.lrs) from public, anon, authenticated;

create or replace function public.queue_trusted_lr_updated_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rule public.notification_rules%rowtype; v_after timestamptz; v_changes jsonb; v_first jsonb; v_count integer; v_body text; v_href text;
begin
 if coalesce(current_setting('app.suppress_lr_updated_notifications',true),'off')='on' or pg_trigger_depth()>1 or auth.uid() is null or new.updated_by is distinct from auth.uid() or coalesce(new.entry_status,'final')<>'final' then return null; end if;
 if coalesce(old.entry_status,'final')='draft' then return null; end if;
 v_changes := public.lr_notification_changed_fields(old,new);
 if jsonb_array_length(v_changes)=0 then return null; end if;
 begin
  select * into v_rule from public.notification_rules where rule_key='lr.updated';
  if coalesce(v_rule.enabled,false) then
   v_after:=public.notification_rule_deliver_after(v_rule.delivery_mode,v_rule.scheduled_time,v_rule.quiet_hours_enabled,v_rule.quiet_hours_start,v_rule.quiet_hours_end,v_rule.timezone);
   v_first:=v_changes->0; v_count:=jsonb_array_length(v_changes); v_body:=v_first->>'label'||case when v_count>1 then ', +'||(v_count-1)||' more' else '' end||' updated';
   v_href:='/lr?view='||new.id::text||'&focus='||(v_first->>'focus');
   insert into public.notification_events(rule_key,title,body,href,payload,created_by,source,deliver_after) values('lr.updated','LR '||new.lr_number||' updated',v_body,v_href,jsonb_build_object('lrId',new.id::text,'lrNumber',new.lr_number,'changedFields',v_changes,'focus',v_first->>'focus'),auth.uid(),'trusted_lr_trigger',v_after);
  end if;
 exception when others then raise warning 'Trusted lr.updated notification enqueue skipped (SQLSTATE %)',SQLSTATE; end;
 return null;
end $$;

create or replace function public.queue_trusted_lr_created_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rule public.notification_rules%rowtype; v_after timestamptz; v_name text;
begin
 if coalesce(current_setting('app.suppress_lr_updated_notifications',true),'off')='on' or pg_trigger_depth()>1 or auth.uid() is null or new.created_by is distinct from auth.uid() or coalesce(new.entry_status,'final')<>'final' then return null; end if;
 begin
  select * into v_rule from public.notification_rules where rule_key='lr.created';
  if coalesce(v_rule.enabled,false) then
   select coalesce(nullif(trim(display_name),''),nullif(trim(email),''),'A staff member') into v_name from public.app_users where id=auth.uid();
   v_after:=public.notification_rule_deliver_after(v_rule.delivery_mode,v_rule.scheduled_time,v_rule.quiet_hours_enabled,v_rule.quiet_hours_start,v_rule.quiet_hours_end,v_rule.timezone);
   insert into public.notification_events(rule_key,title,body,href,payload,created_by,source,deliver_after) values('lr.created','LR '||new.lr_number||' created','Created by '||coalesce(v_name,'A staff member'),'/lr/'||new.id::text||'/print',jsonb_build_object('lrId',new.id::text,'lrNumber',new.lr_number),auth.uid(),'trusted_lr_trigger',v_after);
  end if;
 exception when others then raise warning 'Trusted lr.created notification enqueue skipped (SQLSTATE %)',SQLSTATE; end;
 return null;
end $$;
revoke all on function public.queue_trusted_lr_created_notification() from public, anon, authenticated;
drop trigger if exists trg_lrs_trusted_lr_created_notification on public.lrs;
create trigger trg_lrs_trusted_lr_created_notification after insert on public.lrs for each row execute function public.queue_trusted_lr_created_notification();
drop trigger if exists trg_lrs_trusted_lr_finalized_notification on public.lrs;
create trigger trg_lrs_trusted_lr_finalized_notification after update on public.lrs for each row when (old.entry_status = 'draft' and new.entry_status = 'final') execute function public.queue_trusted_lr_created_notification();
commit;
