/**
 * Permission gate for Supplier AI gateway — uses DB has_permission via user JWT.
 */

import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { gatewayError } from "./errors";

export interface SupplierAiAuthContext {
  userId: string;
  user: User;
  client: SupabaseClient;
}

/**
 * Enforce supplier_intelligence:view using public.has_permission (RLS/auth.uid()).
 * Admin / full_access bypass behavior stays in the database function — not reimplemented here.
 */
export async function requireSupplierIntelligenceView(
  client: SupabaseClient,
  user: User,
): Promise<SupplierAiAuthContext> {
  const { data, error } = await client.rpc("has_permission", {
    p_key: "supplier_intelligence",
    p_min_level: "view",
  });

  if (error) {
    // Do not leak RPC/SQL detail to clients.
    throw gatewayError("unauthorized", 403);
  }

  if (data !== true) {
    throw gatewayError("unauthorized", 403);
  }

  return {
    userId: user.id,
    user,
    client,
  };
}
