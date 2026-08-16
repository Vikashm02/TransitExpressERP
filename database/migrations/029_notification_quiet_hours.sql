-- ==========================================================
-- Migration: 029_notification_quiet_hours
-- Module:    Notification quiet hours (delivery timing only)
--
-- Additive only. Adds quiet-hours columns to notification_rules.
-- Does NOT modify ERP business tables, notification rule keys,
-- delivery_mode, or scheduled_time behavior.
--
-- Apply manually in Supabase SQL Editor when ready.
-- Default quiet hours: 22:00 → 06:00 Asia/Kolkata
-- (allowed immediate window: 06:00 → 22:00)
-- ==========================================================

alter table public.notification_rules
  add column if not exists quiet_hours_enabled boolean not null default true;

alter table public.notification_rules
  add column if not exists quiet_hours_start text not null default '22:00';

alter table public.notification_rules
  add column if not exists quiet_hours_end text not null default '06:00';

alter table public.notification_rules
  add column if not exists timezone text not null default 'Asia/Kolkata';
