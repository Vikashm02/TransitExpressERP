// Controlled one-device native FCM test sender.
// Deploy only after Firebase and Supabase secrets are configured.
// This function is intentionally isolated from browser VAPID/Web Push.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { importPKCS8, SignJWT } from "npm:jose@5.10.0";

const APP_ID = "in.transjitexpresserp.app";
const PLATFORM = "android";
const TEST_SECRET_HEADER = "x-native-fcm-test-secret";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed", message: "POST is required." }, 405);
  }

  // This endpoint is server-only. Require two independent server-held values
  // before parsing the request or accessing the database.
  const testSecret = Deno.env.get("NATIVE_FCM_TEST_SECRET") ?? "";
  if (!testSecret || !constantTimeEqual(req.headers.get(TEST_SECRET_HEADER) ?? "", testSecret)) {
    return json({ ok: false, code: "forbidden", message: "Forbidden." }, 403);
  }

  if (!hasValidSecretApiKey(req)) {
    return json({ ok: false, code: "forbidden", message: "Forbidden." }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!isControlledTestRequest(body)) {
    return json({ ok: false, code: "invalid_request", message: "A single deviceTokenId UUID is required." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const serviceAccount = getServiceAccount();

  if (!supabaseUrl || !serviceRoleKey || !serviceAccount) {
    console.error("[Native FCM] required server configuration is missing");
    return json({ ok: false, code: "server_misconfigured", message: "Server configuration is incomplete." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: device, error: lookupError } = await admin
    .from("native_device_tokens")
    .select("fcm_token")
    .eq("id", body.deviceTokenId)
    .eq("active", true)
    .eq("platform", PLATFORM)
    .eq("app_id", APP_ID)
    .maybeSingle();

  if (lookupError) {
    console.error("[Native FCM] device lookup failed", { code: lookupError.code ?? null });
    return json({ ok: false, code: "device_lookup_failed", message: "Unable to load the test device." }, 500);
  }

  if (!device?.fcm_token) {
    return json({ ok: false, code: "test_device_not_found", message: "No active Android test device was found." }, 404);
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const fcmResponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          message: {
            token: device.fcm_token,
            notification: {
              title: "Transjit Express ERP test",
              body: "Native device alerts are working.",
            },
            data: { href: "/lr" },
            android: {
              priority: "high",
              notification: {
                channel_id: "transjit_erp_alerts_v1",
                sound: "transjit_koyal_notification",
                default_vibrate_timings: true,
              },
            },
          },
        }),
      }
    );

    if (!fcmResponse.ok) {
      const failure = mapFcmFailure(fcmResponse.status);
      console.error("[Native FCM] FCM request failed", { status: fcmResponse.status, code: failure.code });
      return json({ ok: false, ...failure }, fcmResponse.status >= 500 ? 502 : 400);
    }

    return json({ ok: true, sent: true });
  } catch {
    console.error("[Native FCM] token generation or FCM request failed");
    return json({ ok: false, code: "fcm_send_failed", message: "Unable to send the test notification." }, 502);
  }
});

function isControlledTestRequest(value: unknown): value is { deviceTokenId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length === 1 &&
    entries[0][0] === "deviceTokenId" &&
    typeof entries[0][1] === "string" &&
    UUID_PATTERN.test(entries[0][1])
  );
}

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return null;
    }
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    return null;
  }
}

async function getGoogleAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const key = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience(OAUTH_TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("55m")
    .sign(key);

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) throw new Error("OAuth token request failed");
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("OAuth token response was invalid");
  }
  return payload.access_token;
}

function hasValidSecretApiKey(req: Request): boolean {
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (!apiKey || apiKey.startsWith("sb_publishable_")) return false;

  const configuredKeys = getConfiguredSecretApiKeys();
  return configuredKeys.some((key) => constantTimeEqual(apiKey, key));
}

function getConfiguredSecretApiKeys(): string[] {
  const keys: string[] = [];
  const multi = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (multi) {
    try {
      const parsed = JSON.parse(multi) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.length > 0) keys.push(value);
      }
    } catch {
      // Treat malformed platform configuration as no valid key.
    }
  }

  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) keys.push(single);
  return keys;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function mapFcmFailure(status: number): { code: string; message: string } {
  if (status === 400) return { code: "fcm_invalid_request", message: "FCM rejected the test request." };
  if (status === 401 || status === 403) {
    return { code: "fcm_authorization_failed", message: "FCM authorization failed." };
  }
  if (status === 404) return { code: "fcm_target_not_found", message: "FCM did not recognize the test device." };
  if (status === 429) return { code: "fcm_rate_limited", message: "FCM temporarily rate limited the request." };
  if (status >= 500) return { code: "fcm_unavailable", message: "FCM is temporarily unavailable." };
  return { code: "fcm_send_failed", message: "FCM could not send the test notification." };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
