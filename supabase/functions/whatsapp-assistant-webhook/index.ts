// Verified inbound text -> isolated internal/external tools; no outbound send.
// Only replay/access metadata is persisted. Text and generated replies are
// transient; neither is logged, returned to Meta, or written to the database.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { LIMITS, runWhatsappAssistant } from "../_shared/whatsappAssistant.ts";
import { createWhatsappExternalAssistantTools, trustedExternalEventId } from "../_shared/whatsappExternalAssistantTools.ts";
import { createWhatsappAssistantTools } from "../_shared/whatsappAssistantTools.ts";

type WebhookDependencies = {
  env: (name: string) => string | undefined;
  createAdmin: (url: string, key: string) => SupabaseClient;
  // Trusted runtime/test seams only; none can be supplied by a webhook payload.
  waitUntil?: (work: Promise<void>) => void;
  assistant?: typeof runWhatsappAssistant;
};

const E164_PHONE = /^\+[1-9][0-9]{7,14}$/;

type InboundMessage = { id: string; from: string; type: string; timestamp: string | undefined; text?: string };
type LinkedUser = {
  app_user_id: string;
  app_users: { id: string; approval_status: string | null; is_locked: boolean | null } | null;
};

export function createWebhookHandler(dependencies: WebhookDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "GET") return handleVerification(req, dependencies.env);
    if (req.method !== "POST") return response(405, { ok: false, code: "method_not_allowed" });

    const appSecret = dependencies.env("WHATSAPP_META_APP_SECRET") ?? "";
    const supabaseUrl = dependencies.env("SUPABASE_URL") ?? dependencies.env("SUPABASE_PROJECT_URL") ?? "";
    const serviceRoleKey = dependencies.env("SUPABASE_SERVICE_ROLE_KEY") ?? dependencies.env("SERVICE_ROLE_KEY") ?? "";
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

    try {
      const admin = dependencies.createAdmin(supabaseUrl, serviceRoleKey);
      for (const message of extractInboundMessages(payload)) {
        try { await processInboundMessage(admin, message, dependencies); }
        catch { /* Fail closed for this message; never log exception details. */ }
      }
    } catch { /* A signed, valid envelope is safely acknowledged even on failure. */ }
    // Internal checks finish before acknowledgement. External admission and AI
    // run only in registered background work; neither blocks acknowledgement.
    return response(200, { ok: true });
  };
}

async function handleVerification(req: Request, env: WebhookDependencies["env"]): Promise<Response> {
  const verifyToken = env("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
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

async function processInboundMessage(admin: SupabaseClient, message: InboundMessage, dependencies: WebhookDependencies): Promise<void> {
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
    console.error("[WhatsApp assistant webhook] inbound metadata persistence failed");
    return;
  }
  if (!inserted) return;


  // Presence includes inactive links. Only a definite absence permits the
  // external path; errors and malformed responses cannot become fallback.
  const internalPresent = await hasAnyInternalMapping(admin, senderPhone);
  if (internalPresent === null) {
    await updateInboundStatus(admin, inserted.id, "unauthorized");
    return;
  }
  if (!internalPresent) {
    await processExternalMessage(admin, inserted.id, message, dependencies);
    return;
  }
  const linkedUser = await resolveLinkedApprovedUser(admin, senderPhone);
  if (!linkedUser) {
    await updateInboundStatus(admin, inserted.id, "unauthorized");
    return;
  }
  if (message.type !== "text" || typeof message.text !== "string" || !message.text.trim() || message.text.length > LIMITS.input) {
    await updateInboundStatus(admin, inserted.id, "ignored", linkedUser);
    return;
  }
  if (!(await updateInboundStatus(admin, inserted.id, "authorized", linkedUser))) return;
  if (dependencies.env("WHATSAPP_ASSISTANT_ENABLED") !== "true" || !dependencies.waitUntil) return;

  // Background only after durable admission. A rejected registration must not
  // start an untracked assistant invocation. The resolved identity is closed
  // over server-side; no identity is read from text, query parameters or AI.
  const text = message.text;
  let registered = false;
  const work = Promise.resolve().then(async () => {
    if (!registered) return;
    try {
      await (dependencies.assistant ?? runWhatsappAssistant)(text, {
        tools: createWhatsappAssistantTools(admin, linkedUser),
        env: dependencies.env,
      });
      // Intentionally discard the result. No outbound transport or persistence.
    } catch { /* Includes unexpected assistant errors; no log or retry. */ }
  });
  dependencies.waitUntil(work);
  registered = true;
}


async function hasAnyInternalMapping(admin: SupabaseClient, senderPhone: string): Promise<boolean | null> {
  const { data, error } = await admin.from("whatsapp_user_links")
    .select("id").eq("whatsapp_phone_e164", senderPhone).limit(1).maybeSingle();
  if (error) return null;
  if (data === null) return false;
  return data && typeof data === "object" && data.id != null ? true : null;
}

async function processExternalMessage(admin: SupabaseClient, insertedId: unknown, message: InboundMessage, dependencies: WebhookDependencies): Promise<void> {
  const eventId = trustedExternalEventId(insertedId);
  if (message.type !== "text" || typeof message.text !== "string" || !message.text.trim() || message.text.length > LIMITS.input
    || dependencies.env("WHATSAPP_ASSISTANT_ENABLED") !== "true"
    || dependencies.env("WHATSAPP_EXTERNAL_ASSISTANT_ENABLED") !== "true" || !dependencies.waitUntil) {
    await admin.from("whatsapp_inbound_events").update({ processing_status: "ignored" }).eq("id", eventId);
    return;
  }
  const text = message.text;
  let registered = false;
  const work = Promise.resolve().then(async () => {
    if (!registered) return;
    try {
      // M101 owns mapping/scope/rate checks and external attribution. No table
      // lookup, name matching, alternate RPC or admission retry is permitted.
      const admitted = await admitExternalEvent(admin, eventId);
      if (admitted !== true) {
        if (admitted === false) {
          // Preserve M101's 'ignored' rate-limit status and any committed
          // attribution. An uncertain RPC error is never rewritten/retried.
          await admin.from("whatsapp_inbound_events").update({ processing_status: "unauthorized" })
            .eq("id", eventId).eq("processing_status", "received");
        }
        return;
      }
      await (dependencies.assistant ?? runWhatsappAssistant)(text, {
        tools: createWhatsappExternalAssistantTools(admin, eventId), env: dependencies.env,
      });
      // Transient reply is deliberately discarded; no Meta delivery or logging.
    } catch { /* Fail closed without exposing provider/DB details or retrying. */ }
  });
  dependencies.waitUntil(work);
  registered = true;
}

async function admitExternalEvent(admin: SupabaseClient, eventId: number | string): Promise<boolean | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<boolean | null> => {
      const { data, error } = await admin.rpc("whatsapp_external_admit", { p_event_id: eventId }).abortSignal(controller.signal);
      if (controller.signal.aborted || error || typeof data !== "boolean") return null;
      return data;
    };
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    });
    return await Promise.race([work(), timeout]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}


async function resolveLinkedApprovedUser(admin: SupabaseClient, senderPhone: string): Promise<string | null> {
  const { data, error } = await admin
    .from("whatsapp_user_links")
    .select("app_user_id, app_users!whatsapp_user_links_app_user_id_fkey(id, approval_status, is_locked)")
    .eq("whatsapp_phone_e164", senderPhone)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[WhatsApp assistant webhook] link lookup failed");
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
    console.error("[WhatsApp assistant webhook] exclusion lookup failed");
    return null; // Fail closed when an explicit-access control cannot be checked.
  }
  if (exclusion) return null;

  return link.app_user_id;
}

async function updateInboundStatus(
  admin: SupabaseClient,
  eventId: number,
  status: "authorized" | "unauthorized" | "ignored",
  appUserId?: string,
): Promise<boolean> {
  const update: { processing_status: string; app_user_id?: string } = { processing_status: status };
  if (appUserId) update.app_user_id = appUserId;
  const { error } = await admin.from("whatsapp_inbound_events").update(update).eq("id", eventId);
  if (error) console.error("[WhatsApp assistant webhook] inbound status update failed");
  return !error;
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
        if (id && from && type && id.length <= 512 && type.length <= 64) {
          // Called only after signature verification. Never truncate a query:
          // oversized/empty/non-string bodies are ignored before core invocation.
          const body = type === "text" ? stringValue(objectValue(message?.text)?.body) : undefined;
          const text = body && body.length <= LIMITS.input && body.trim() ? body : undefined;
          messages.push({ id, from, type, timestamp: stringValue(message?.timestamp), text });
        }
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

// Lazy runtime bootstrap keeps tests offline and avoids serving during imports.
// Missing background support fails closed: admission still works, AI is skipped.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const runtime = globalThis as unknown as {
    Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown };
    EdgeRuntime?: { waitUntil(work: Promise<void>): void };
  };
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  runtime.Deno.serve(createWebhookHandler({
    env: (name) => runtime.Deno.env.get(name),
    createAdmin: (url, key) => createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
    waitUntil: runtime.EdgeRuntime ? (work) => runtime.EdgeRuntime!.waitUntil(work) : undefined,
  }));
}
