/**
 * POST /api/supplier/intelligence/ask
 *
 * Authenticate staff JWT → permission → RLS retrieval → decide.
 * SYNTHESIS may reserve budget then call OpenAI (only when SUPPLIER_AI_ENABLED).
 * DB_ONLY never calls provider / budget / usage.
 */

import { createUserScopedSupabaseClientFromRequest } from "@/lib/supabase/server-user";
import {
  handleSupplierIntelligenceAsk,
  parseSupplierAiAskRequest,
  supplierAiAskErrorToResponse,
} from "@/lib/supplier-ai/gateway";
import {
  gatewayError,
  SupplierAiGatewayError,
  SUPPLIER_AI_GATEWAY_SAFE_MESSAGES,
} from "@/lib/supplier-ai/errors";

export const runtime = "nodejs";

function statusForBody(body: {
  ok: boolean;
  error?: string;
}): number {
  if (body.ok) return 200;
  switch (body.error) {
    case "ai_disabled":
    case "synthesis_unavailable":
    case "provider_not_ready":
    case "budget_exhausted":
      return 200;
    case "unauthorized":
      return 403;
    case "unauthenticated":
      return 401;
    case "invalid_request":
      return 400;
    case "provider_error":
    case "usage_recording_failure":
    case "retrieval_failure":
    default:
      return 500;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await createUserScopedSupabaseClientFromRequest(request);
    if (!auth.ok) {
      if (auth.reason === "misconfigured") {
        return Response.json(
          {
            ok: false,
            error: "retrieval_failure",
            message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.retrieval_failure,
            usage: {
              providerCalled: false,
              reservationId: null,
              estimatedCostUsd: null,
              inputTokens: null,
              outputTokens: null,
            },
          },
          { status: 500 },
        );
      }
      throw gatewayError("unauthenticated", 401);
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw gatewayError("invalid_request", 400);
    }

    const askRequest = parseSupplierAiAskRequest(json);
    const result = await handleSupplierIntelligenceAsk({
      client: auth.client,
      user: auth.user,
      request: askRequest,
    });

    // Do not expose prompt-assembly contentBlocks over HTTP.
    const body =
      result.ok
        ? (() => {
            const { contentBlocks: _contentBlocks, ...publicSuccess } = result;
            void _contentBlocks;
            return publicSuccess;
          })()
        : result;

    return Response.json(body, { status: statusForBody(body) });
  } catch (err) {
    if (err instanceof SupplierAiGatewayError) {
      const mapped = supplierAiAskErrorToResponse(err);
      return Response.json(mapped.body, { status: mapped.status });
    }
    const mapped = supplierAiAskErrorToResponse(err);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
