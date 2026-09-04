/**
 * Server-only Supabase client using the service role key.
 *
 * ONLY for privileged Supplier AI budget/usage operations (migration 069).
 * NEVER use this client for Supplier conversation retrieval (RLS must apply).
 * NEVER import from client components / browser bundles.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServiceRoleClientResult =
  | { ok: true; client: SupabaseClient }
  | { ok: false; reason: "misconfigured" };

function readServiceRoleKey(): string | null {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SERVICE_ROLE_KEY?.trim() ||
    "";
  return key || null;
}

/**
 * Create a short-lived service-role client for privileged RPCs / ledger writes.
 * Does not persist sessions. Does not accept caller-supplied keys.
 */
export function createServiceRoleSupabaseClient(): ServiceRoleClientResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = readServiceRoleKey();
  if (!url || !serviceKey) {
    return { ok: false, reason: "misconfigured" };
  }

  const client = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { ok: true, client };
}
