// Read-only master lists for the owner's Google Sheet (XLOOKUP of names).
//
// GET with header `x-sheet-token: <MASTERS_SHEET_TOKEN>` → JSON with the
// Customer Master and Billing Party Master (selected columns only). The
// token is a Supabase function secret set by the owner; it is never stored
// in this repo. Nothing is ever written. Platform JWT verification is off
// (config.toml) because the caller is a Google Apps Script, not a user.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Constant-time compare, so the token cannot be guessed by timing. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);

  const expected = Deno.env.get("MASTERS_SHEET_TOKEN") ?? "";
  if (expected.length < 32) return json({ error: "Sheet access is not set up yet." }, 503);
  if (!sameSecret(req.headers.get("x-sheet-token") ?? "", expected)) return json({ error: "Not allowed." }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const [customers, billingParties] = await Promise.all([
    supabase.from("customers").select("code, name, city, gst, status, entry_status").order("code"),
    supabase
      .from("billing_parties")
      .select("code, name, short_code, city, gst, po_number, vendor_code, payment_cycle_days, status, entry_status")
      .order("code"),
  ]);
  if (customers.error || billingParties.error) return json({ error: "Could not read the masters." }, 500);

  return json({
    refreshedAt: new Date().toISOString(),
    customers: customers.data,
    billingParties: billingParties.data,
  });
});
