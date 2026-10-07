-- ==========================================================
-- Migration: 116_whatsapp_stage_b_core_acl_hardening
-- Purpose: Record the explicit service_role denial for the unbound M115 core.
-- This forward-only correction does not alter function bodies or defaults.
-- ==========================================================

begin;

revoke execute
on function public.whatsapp_internal_stage_b_lr_vehicle_count_v2(uuid,text,jsonb)
from service_role;

commit;
