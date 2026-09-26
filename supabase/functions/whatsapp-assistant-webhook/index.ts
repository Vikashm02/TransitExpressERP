// Meta WhatsApp webhook foundation only.
// It verifies Meta requests, records minimal replay/rate-limit metadata, and
// resolves an explicitly linked, approved ERP user. It never reads ERP data,
// invokes AI, sends a WhatsApp response, or logs raw payload/message content.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const E164_PHONE = /^\+[1-9][0-9]{7,14}$/;

type InboundMessage = { id: string; from: string; type: string; timestamp: string | undefined };
type LinkedUser = {
  app_user_id: string;
  app_users: { id: string; approval_status: string | null; is_locked: boolean | null } | null;
};

Deno.serve(async (req) => {
  if (req.method === "GET") return handleVerification(req);
  if (req.method !== "POST") return response(405, { ok: false, code: "method_not_allowed" });

  const appSecret = Deno.env.get("WHATSAPP_META_APP_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!appSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("[WhatsApp assistant webhook] required server configuration is missing");
    return response(500, { ok: false, code: "server_misconfigured" });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!(await hasValidMetaSignature(rawBody, signature, appSecret))) {
    console.warn("[WhatsApp assistant webhook] rejected request with invalid signature");
    return response(401, { ok: false, code: "invalid_signature" });
  }

  const payload = parseObject(rawBody);
  if (!payload) return response(400, { ok: false, code: "invalid_payload" });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  for (const message of extractInboundMessages(payload)) await processInboundMessage(admin, message);

  // Meta expects a quick acknowledgement. There is intentionally no reply or
  // downstream assistant/tool invocation in this foundation phase.
  return response(200, { ok: true });
});

async function handleVerification(req: Request): Promise<Response> {
  const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
  if (!verifyToken) {
    console.error("[WhatsApp assistant webhook] verification token is not configured");
    return response(500, { ok: false, code: "server_misconfigured" });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge || !(await constantTimeSecretEqual(token ?? "", verifyToken))) {
    return response(403, { ok: false, code: "verification_failed" });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function processInboundMessage(admin: SupabaseClient, message: InboundMessage): Promise<void> {
  const senderPhone = normalizeMetaPhone(message.from);
  if (!senderPhone) {
    console.warn("[WhatsApp assistant webhook] ignored message with invalid sender metadata");
    return;
  }

  const { data: inserted, error: insertError } = await admin
    .from("whatsapp_inbound_events")
    .insert({ meta_message_id: message.id, sender_phone_e164: senderPhone, message_type: message.type, meta_timestamp: unixSecondsToIso(message.timestamp) })
    .select("id")
    .maybeSingle();
  if (insertError) {
    if (insertError.code === "23505") return; // Durable replay protection.
    console.error("[WhatsApp assistant webhook] inbound metadata persistence failed", { code: insertError.code ?? "unknown" });
    return;
  }
  if (!inserted) return;


  const linkedUser = await resolveLinkedApprovedUser(admin, senderPhone);
  if (!linkedUser) {
    await updateInboundStatus(admin, inserted.id, "unauthorized");
    return;
  }
  await updateInboundStatus(admin, inserted.id, "authorized", linkedUser);
  // Future tools receive only this resolved ERP identity, never a caller-selected user.
}


async function resolveLinkedApprovedUser(admin: SupabaseClient, senderPhone: string): Promise<string | null> {
  const { data, error } = await admin
    .from("whatsapp_user_links")
    .select("app_user_id, app_users!whatsapp_user_links_app_user_id_fkey(id, approval_status, is_locked)")
    .eq("whatsapp_phone_e164", senderPhone)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[WhatsApp assistant webhook] link lookup failed", { code: error.code ?? "unknown" });
    return null;
  }
  const link = data as unknown as LinkedUser;
  const user = link.app_users;
  if (!user || user.id !== link.app_user_id || user.approval_status !== "approved" || user.is_locked === true) return null;

  const { data: exclusion, error: exclusionError } = await admin
    .from("whatsapp_assistant_access_exclusions")
    .select("app_user_id")
    .eq("app_user_id", link.app_user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (exclusionError) {
    console.error("[WhatsApp assistant webhook] exclusion lookup failed", { code: exclusionError.code ?? "unknown" });
    return null; // Fail closed when an explicit-access control cannot be checked.
  }
  if (exclusion) return null;

  return link.app_user_id;
}

async function updateInboundStatus(
  admin: SupabaseClient,
  eventId: number,
  status: "authorized" | "unauthorized",
  appUserId?: string,
): Promise<void> {
  const update: { processing_status: string; app_user_id?: string } = { processing_status: status };
  if (appUserId) update.app_user_id = appUserId;
  const { error } = await admin.from("whatsapp_inbound_events").update(update).eq("id", eventId);
  if (error) console.error("[WhatsApp assistant webhook] inbound status update failed", { code: error.code ?? "unknown" });
}

function extractInboundMessages(payload: Record<string, unknown>): InboundMessage[] {
  const messages: InboundMessage[] = [];
  for (const entry of arrayValue(payload.entry)) {
    for (const change of arrayValue(objectValue(entry)?.changes)) {
      const value = objectValue(objectValue(change)?.value);
      for (const rawMessage of arrayValue(value?.messages)) {
        const message = objectValue(rawMessage);
        const id = stringValue(message?.id);
        const from = stringValue(message?.from);
        const type = stringValue(message?.type);
        if (id && from && type && id.length <= 512 && type.length <= 64) messages.push({ id, from, type, timestamp: stringValue(message?.timestamp) });
      }
    }
  }
  return messages;
}

function normalizeMetaPhone(value: string): string | null {
  const normalized = `+${value.replace(/\D/g, "")}`;
  return E164_PHONE.test(normalized) ? normalized : null;
}

function unixSecondsToIso(value: string | undefined): string | null {
  if (!value || !/^\d{1,12}$/.test(value)) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function hasValidMetaSignature(rawBody: string, suppliedSignature: string | null, appSecret: string): Promise<boolean> {
  if (!suppliedSignature?.startsWith("sha256=")) return false;
  return constantTimeEqualText(suppliedSignature, `sha256=${await hmacSha256Hex(appSecret, rawBody)}`);
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeSecretEqual(left: string, right: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return constantTimeEqualBytes(await digest(left), await digest(right));
}
function constantTimeEqualText(left: string, right: string): boolean { return constantTimeEqualBytes(new TextEncoder().encode(left), new TextEncoder().encode(right)); }
function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
function parseObject(value: string): Record<string, unknown> | null { try { return objectValue(JSON.parse(value)); } catch { return null; } }
function objectValue(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function response(status: number, body: Record<string, unknown>): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
