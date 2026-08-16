-- ==========================================================
-- Migration: 030_notification_permission
-- Module:    Staff permissions — Notifications feature key
--
-- Additive only. Does NOT alter ERP business tables, notification
-- rules, quiet hours, PWA, or announcements.
--
-- Permission key: `notifications`
-- Client mirror: lib/permissions.ts (PERMISSION_MODULES)
-- Check via existing hasPermission('notifications', 'view')
--
-- Does NOT grant /settings or notification administration.
-- Those remain Admin-only (role = admin).
--
-- Backward compatibility: existing approved staff receive
-- permission_level = 'view' so notifications are not accidentally
-- disabled. New staff still default to no row (= none) until an
-- Admin grants access (or Full Access). Admins always bypass.
-- ==========================================================

insert into public.app_user_permissions (user_id, permission_key, permission_level)
select u.id, 'notifications', 'view'
from public.app_users u
where coalesce(u.approval_status, 'approved') = 'approved'
  and coalesce(u.is_locked, false) = false
on conflict (user_id, permission_key) do nothing;
