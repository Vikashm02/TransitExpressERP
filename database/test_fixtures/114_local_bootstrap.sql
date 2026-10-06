-- ============================================================================
-- LOCAL TEST FIXTURE — NEVER APPLY TO SUPABASE OR PRODUCTION
-- ============================================================================
-- Purpose: Minimal faithful bootstrap to compile and behaviorally test
--   database/migrations/114_whatsapp_internal_access_management.sql
--   in plain local PostgreSQL 17.11 (transjit_m114_test), without a Supabase
--   local stack.
--
-- This file is LOCAL-TEST-ONLY. It lives in database/test_fixtures/, never
-- in database/migrations/, and must never be applied to Supabase or production.
-- It reproduces only the objects that M114 directly or transitively requires,
-- using the repository's actual production definitions as the source of truth
-- (see Source lines below). All other ERP objects are omitted.
--
-- Safe for an empty disposable database only. If run against a non-empty DB
-- that already contains any of these objects, it will error or leave existing
-- rows untouched (IF NOT EXISTS / ON CONFLICT DO NOTHING). It contains no
-- DROP DATABASE, DROP SCHEMA, TRUNCATE, DELETE, or destructive DDL against
-- existing production-like tables.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Local-only Supabase compatibility
-- --------------------------------------------------------------------------
-- Production provides these via Supabase's auth schema and JWT handling.
-- Plain PostgreSQL 17.11 has no auth schema, no auth.uid(), and no anon/
-- authenticated/service_role roles. We create minimal local equivalents that
-- behave faithfully for M114 tests while remaining clearly separate from
-- production. Differences from Supabase are commented inline.

-- Roles — Source: Supabase platform (not a migration). Plain PG has only
-- `postgres`. We create them IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

-- auth schema + auth.uid() backed by transaction-local GUC test.app_user_id
-- Source: Supabase auth schema (not a migration). Production auth.uid()
-- reads the JWT's sub claim. Locally we simulate it via
--   SELECT set_config('test.app_user_id', '<uuid>', true);
--   SELECT auth.uid(); -- returns that UUID or NULL
-- Difference from Supabase: plain PG GUC is not a signed JWT and has no
-- role claim; is_privileged_creator_designation_context() (which checks
-- auth.jwt()->>'role' = 'service_role') cannot be faithfully tested here
-- and is not needed for M114 (M114 uses auth.uid() only via
-- whatsapp_internal_access_require_creator, not via is_privileged_…).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
BEGIN
  -- test.app_user_id is set per-transaction by the test harness:
  --   BEGIN; SELECT set_config('test.app_user_id', '1111…', true); SELECT auth.uid();
  -- If not set, return NULL (unauthenticated) like Supabase.
  RETURN NULLIF(current_setting('test.app_user_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Minimal auth.jwt() stub for completeness (used by M041's is_privileged_…,
-- not by M114, but prevents "function auth.jwt() does not exist" if that
-- migration is ever loaded in the same fixture DB).
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT '{}'::jsonb $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. Minimum faithful app_users structure needed by M114
-- --------------------------------------------------------------------------
-- Source: 017_add_auth_ownership_lorry_expenses.sql:28-35 (base table)
--         018_add_signup_approval.sql:46-76 (approval_status)
--         041_creator_tier1_tier2_role_hierarchy.sql:52-63 (role includes creator)
-- Columns not needed by M114 (e.g., full_access) are omitted to keep the
-- fixture minimal. Constraints/defaults that M114 relies on are preserved.
-- M114 reads: id, email, display_name, role, approval_status, is_locked
-- M114 writes: none (only reads via whatsapp_internal_access_require_creator)

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY,
  email text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('creator', 'admin', 'staff')),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Single-creator uniqueness (Source: 041:61-63)
CREATE UNIQUE INDEX IF NOT EXISTS app_users_single_creator_idx
  ON public.app_users ((1)) WHERE role = 'creator';

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Minimal RLS that does not block SECURITY DEFINER reads (M114 functions are
-- SECURITY DEFINER and read app_users as owner). Tests run as `postgres`
-- superuser, so RLS is not enforced, but we keep the policy for fidelity.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_users' AND policyname='app_users_select_authenticated') THEN
    CREATE POLICY app_users_select_authenticated ON public.app_users FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3. Minimum app_user_permissions + faithful has_permission
-- --------------------------------------------------------------------------
-- Source: 019_add_staff_permissions.sql (table), 020_fix_permission_capability_model.sql,
--         033_granular_module_actions.sql, 041:488-568 (has_permission/has_module_action)
-- M114 reads has_permission only via:
--   whatsapp_internal_access_list() → has_permission(u.id, 'lr') / 'pod'
-- We need a faithful implementation, NOT an always-true stub, otherwise
-- effective_lr/pod_access tests would be meaningless.

CREATE TABLE IF NOT EXISTS public.app_user_permissions (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  permission_level text NOT NULL DEFAULT 'none' CHECK (permission_level IN ('none','view','create_view','edit')),
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, permission_key)
);

-- Faithful local has_permission: mirrors 041:488-568 logic but without
-- full_access / is_locked handling beyond what M114 needs. For M114 tests,
-- Creator/Admin bypass is the critical path.
CREATE OR REPLACE FUNCTION public.has_permission(p_key text, p_min_level text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text; v_approval text; v_locked boolean;
BEGIN
  SELECT role, approval_status, is_locked INTO v_role, v_approval, v_locked
  FROM public.app_users WHERE id = auth.uid();
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('creator','admin') THEN RETURN true; END IF;
  IF coalesce(v_locked,false) OR coalesce(v_approval,'pending') <> 'approved' THEN RETURN false; END IF;
  -- For M114, only 'lr' and 'pod' permission_keys are ever checked.
  -- We implement the permission_level path (used by 033) and the can_* path.
  RETURN EXISTS (
    SELECT 1 FROM public.app_user_permissions
    WHERE user_id = auth.uid() AND permission_key = p_key
      AND (
        (p_min_level = 'view' AND permission_level IN ('view','create_view','edit'))
        OR (p_min_level = 'create_view' AND permission_level = 'create_view')
        OR (p_min_level = 'edit' AND permission_level = 'edit')
        OR (p_min_level = 'view' AND (can_view OR can_create OR can_edit))
        OR (p_min_level = 'create_view' AND can_create)
        OR (p_min_level = 'edit' AND can_edit)
      )
  );
END;
$$;

-- whatsapp_assistant_has_permission is the public name used by M114 and by
-- 099_whatsapp_assistant_readonly_tools.sql. In production it is an alias/wrapper
-- around has_permission. We create it as a thin wrapper for fidelity.
CREATE OR REPLACE FUNCTION public.whatsapp_assistant_has_permission(p_app_user_id uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_permission(p_key, 'view') IS TRUE
  -- Note: M114 calls has_permission(u.id, 'lr') where u.id is the target user,
  -- not auth.uid(). The production helper takes an explicit uuid. Our local
  -- has_permission reads auth.uid(), so this wrapper would be wrong for the
  -- target-user case. For M114's list() which checks has_permission(u.id, …)
  -- we need a uuid-aware version. See below.
$$;

-- Correct uuid-aware version for M114's list() (checks arbitrary u.id, not auth.uid())
DROP FUNCTION IF EXISTS public.whatsapp_assistant_has_permission(uuid,text);
CREATE OR REPLACE FUNCTION public.whatsapp_assistant_has_permission(p_app_user_id uuid, p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text; v_approval text; v_locked boolean;
BEGIN
  SELECT role, approval_status, is_locked INTO v_role, v_approval, v_locked
  FROM public.app_users WHERE id = p_app_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('creator','admin') THEN RETURN true; END IF;
  IF coalesce(v_locked,false) OR coalesce(v_approval,'pending') <> 'approved' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.app_user_permissions
    WHERE user_id = p_app_user_id AND permission_key = p_key
      AND (permission_level IN ('view','create_view','edit') OR can_view OR can_create OR can_edit)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_assistant_has_permission(uuid,text) TO anon, authenticated, service_role;

-- Minimal _overview_age_days (Source: 038_lr_finalized_at_and_edit_events.sql:226-239)
-- Used by M114's list()? No, M114 does not use _overview_age_days, but
-- whatsapp_assistant_has_permission's dependency chain for other tests does.
-- We include it for completeness if the fixture is later extended to 107.
CREATE OR REPLACE FUNCTION public._overview_age_days(p_at timestamptz) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT GREATEST(0, (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')::date - date_trunc('day', p_at AT TIME ZONE 'Asia/Kolkata')::date))::integer
$$;

-- --------------------------------------------------------------------------
-- 4. whatsapp_user_links — faithful reproduction of 097
-- --------------------------------------------------------------------------
-- Source: 097_whatsapp_assistant_foundation.sql:14-52
-- M114 reads/writes: id, app_user_id, whatsapp_phone_e164, is_active, created_at,
--                    updated_at, created_by, updated_by, plus unique indexes.

CREATE TABLE IF NOT EXISTS public.whatsapp_user_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  whatsapp_phone_e164 text NOT NULL CHECK (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_user_links_active_phone_unique
  ON public.whatsapp_user_links (whatsapp_phone_e164) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_user_links_active_app_user_unique
  ON public.whatsapp_user_links (app_user_id) WHERE is_active;

CREATE OR REPLACE FUNCTION public.set_whatsapp_user_links_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_whatsapp_user_links_updated_at ON public.whatsapp_user_links;
CREATE TRIGGER trg_whatsapp_user_links_updated_at
BEFORE UPDATE ON public.whatsapp_user_links
FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_user_links_updated_at();

ALTER TABLE public.whatsapp_user_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_user_links FROM public, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_user_links TO service_role;
REVOKE ALL ON SEQUENCE public.whatsapp_user_links_id_seq FROM public, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_user_links_id_seq TO service_role;

-- --------------------------------------------------------------------------
-- 5. whatsapp_assistant_access_exclusions — faithful reproduction of 098
-- --------------------------------------------------------------------------
-- Source: 098_whatsapp_assistant_access_exclusions.sql:12-37
-- M114 reads: app_user_id, is_active, created_at, updated_at
-- M114 never writes this table (only reads for effective_access_status).

CREATE TABLE IF NOT EXISTS public.whatsapp_assistant_access_exclusions (
  app_user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_whatsapp_assistant_access_exclusions_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_whatsapp_assistant_access_exclusions_updated_at ON public.whatsapp_assistant_access_exclusions;
CREATE TRIGGER trg_whatsapp_assistant_access_exclusions_updated_at
BEFORE UPDATE ON public.whatsapp_assistant_access_exclusions
FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_assistant_access_exclusions_updated_at();

ALTER TABLE public.whatsapp_assistant_access_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_assistant_access_exclusions FROM public, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_assistant_access_exclusions TO service_role;

-- Deliberate difference from production: do NOT copy the single seed row
-- 4a5e8b1a-430f-4cfc-9145-29d54783cf75 from 098:41-44. The fixture must start
-- with an empty exclusion list so tests can explicitly insert exclusions.

-- --------------------------------------------------------------------------
-- 6. Minimal M101 objects needed by M114
-- --------------------------------------------------------------------------
-- Source: 101_whatsapp_external_party_access.sql
-- M114 reads/writes only:
--   whatsapp_phone_reservations (whatsapp_phone_e164, principal_kind)
--   whatsapp_external_links (whatsapp_phone_e164, principal_kind check via trigger)
-- and the reservation trigger whatsapp_reserve_mapping_phone().
-- We intentionally OMIT the unrelated M101 objects:
--   whatsapp_external_links full history columns (scope_type, billing_party_id, etc.)
--   whatsapp_external_rate_buckets, whatsapp_external_admissions,
--   whatsapp_external_*_lrs, whatsapp_external_validate_filters, etc.
-- If a test needs the full external schema, load the full 101 file instead.

CREATE TABLE IF NOT EXISTS public.whatsapp_phone_reservations (
  whatsapp_phone_e164 text PRIMARY KEY CHECK (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  principal_kind text NOT NULL CHECK (principal_kind IN ('internal', 'external')),
  reserved_at timestamptz NOT NULL DEFAULT now()
);

-- Minimal whatsapp_external_links shape required by the reservation trigger's
-- second defence check (101:67-69):
--   EXISTS (SELECT 1 FROM whatsapp_external_links WHERE whatsapp_phone_e164 = new.whatsapp_phone_e164)
-- The trigger only reads whatsapp_phone_e164, so a minimal table with just that
-- column plus is_active would suffice, but we keep the real PK/CHECK for fidelity.
-- We create a minimal version with only the columns the trigger reads, plus the
-- columns that the real table would have, to avoid breaking future tests that
-- might SELECT * from it. If the full 101 is loaded, this IF NOT EXISTS will
-- leave the full table untouched.
CREATE TABLE IF NOT EXISTS public.whatsapp_external_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  whatsapp_phone_e164 text NOT NULL CHECK (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean NOT NULL DEFAULT true
);
-- The unique active-phone index is not needed for M114, but we keep the
-- reservation table's PK as the collision point.

CREATE OR REPLACE FUNCTION public.whatsapp_reserve_mapping_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text; v_claim text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN RAISE EXCEPTION 'Invalid mapping table'; END IF;
  IF TG_TABLE_NAME = 'whatsapp_user_links' THEN v_kind := 'internal';
  ELSIF TG_TABLE_NAME = 'whatsapp_external_links' THEN v_kind := 'external';
  ELSE RAISE EXCEPTION 'Invalid mapping table'; END IF;
  INSERT INTO public.whatsapp_phone_reservations AS r(whatsapp_phone_e164, principal_kind)
    VALUES (NEW.whatsapp_phone_e164, v_kind)
  ON CONFLICT (whatsapp_phone_e164) DO UPDATE
    SET principal_kind = r.principal_kind
    WHERE r.principal_kind = EXCLUDED.principal_kind
  RETURNING principal_kind INTO v_claim;
  IF v_claim IS NULL THEN RAISE EXCEPTION 'Phone reserved for another identity system'; END IF;
  IF (v_kind = 'external' AND EXISTS (SELECT 1 FROM public.whatsapp_user_links WHERE whatsapp_phone_e164 = NEW.whatsapp_phone_e164))
    OR (v_kind = 'internal' AND EXISTS (SELECT 1 FROM public.whatsapp_external_links WHERE whatsapp_phone_e164 = NEW.whatsapp_phone_e164)) THEN
    RAISE EXCEPTION 'Phone reserved for another identity system';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_internal_phone_reservation ON public.whatsapp_user_links;
CREATE TRIGGER whatsapp_internal_phone_reservation
BEFORE INSERT OR UPDATE OF whatsapp_phone_e164 ON public.whatsapp_user_links
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_reserve_mapping_phone();

DROP TRIGGER IF EXISTS whatsapp_external_phone_reservation ON public.whatsapp_external_links;
CREATE TRIGGER whatsapp_external_phone_reservation
BEFORE INSERT ON public.whatsapp_external_links
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_reserve_mapping_phone();

ALTER TABLE public.whatsapp_phone_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_phone_reservations FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.whatsapp_external_links FROM public, anon, authenticated, service_role;
GRANT ALL ON TABLE public.whatsapp_phone_reservations TO service_role;
GRANT ALL ON TABLE public.whatsapp_external_links TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_reserve_mapping_phone() FROM public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 7. Security semantics for M114 ACL testing
-- --------------------------------------------------------------------------
-- Production M114 does:
--   REVOKE ALL ON FUNCTION whatsapp_internal_access_* FROM public,anon,authenticated,service_role;
--   GRANT EXECUTE ON FUNCTION list/set_phone/disable TO authenticated;
-- The fixture does not need to test GRANTs, but we keep the functions as
-- SECURITY DEFINER with SET search_path = '' as in production. The key
-- difference from Supabase that tests must be aware of is:
--   Supabase: service_role BYPASSES RLS, authenticated is subject to RLS.
--   Local fixture: tests run as superuser postgres, which BYPASSES RLS entirely.
--   Therefore, to test RLS/permission paths faithfully, tests must SET ROLE
--   authenticated or use SET LOCAL ROLE, not rely on superuser bypass.
--   This file intentionally does not create RLS policies for app_users/
--   whatsapp_user_links beyond those above that are needed for M114.

-- End of fixture. Load order for transjit_m114_test:
--   1) CREATE EXTENSION IF NOT EXISTS pgcrypto; -- if needed for gen_random_uuid()
--   2) \i database/test_fixtures/114_local_bootstrap.sql
--   3) \i database/migrations/114_whatsapp_internal_access_management.sql
--   4) Run tests as: BEGIN; SELECT set_config('test.app_user_id', '<creator-uuid>', true); SELECT * FROM whatsapp_internal_access_list(); ROLLBACK;
