/**
 * Supplier Intelligence ask gateway — Step 2.
 *
 * DB_ONLY: RLS retrieval + deterministic answer (no AI / budget / usage).
 * SYNTHESIS: enable → configure → max-cost reserve → provider → usage → consume.
 */

import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupplierIntelligenceView } from "./auth-context";
import {
  consumeSupplierAiReservation,
  getPrivilegedSupplierAiClient,
  insertSupplierAiUsage,
  pinSupplierAiReservationForAccountingRecovery,
  releaseSupplierAiReservation,
  tryReserveSupplierAiBudget,
} from "./budget";
import {
  getSupplierAiDefaultModel,
  getSupplierAiRuntimeStatus,
  isSupplierAiFeatureEnabled,
  SUPPLIER_AI_USER_SAFE_MESSAGES,
} from "./config";
import { decideSupplierAiPath, decisionKindToAskMode } from "./decision";
import {
  gatewayError,
  SupplierAiGatewayError,
  SUPPLIER_AI_GATEWAY_SAFE_MESSAGES,
} from "./errors";
import { getSupplierAiProvider } from "./provider";
import {
  SupplierAiDisabledError,
  SupplierAiProviderError,
} from "./openai-provider";
import { calculateMaximumReservationUsd, estimateCostUsd } from "./pricing";
import {
  SUPPLIER_AI_SYSTEM_INSTRUCTIONS,
  buildSynthesisUserInput,
} from "./prompt";
import {
  buildRetrievalContentBlocks,
  deriveKeywordFromQuestion,
  fetchSupplierConversationsForUser,
  formatDatabaseOnlyAnswer,
  isSupplierUuid,
  toAskSources,
} from "./retrieval";
import type {
  SupplierAiAskRequest,
  SupplierAiAskResponse,
  SupplierAiAskUsageMeta,
  SupplierAiRetrievalResult,
} from "./types";

const EMPTY_USAGE: SupplierAiAskUsageMeta = {
  providerCalled: false,
  reservationId: null,
  estimatedCostUsd: null,
  inputTokens: null,
  outputTokens: null,
};

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  organizationId: z.string().trim().nullable().optional(),
  personId: z.string().trim().nullable().optional(),
  keyword: z.string().trim().max(80).nullable().optional(),
});

export function parseSupplierAiAskRequest(body: unknown): SupplierAiAskRequest {
  const parsed = askBodySchema.safeParse(body);
  if (!parsed.success) {
    throw gatewayError("invalid_request", 400);
  }

  const organizationId = parsed.data.organizationId || null;
  const personId = parsed.data.personId || null;
  const keyword = parsed.data.keyword || null;

  if (organizationId && !isSupplierUuid(organizationId)) {
    throw gatewayError("invalid_request", 400, "Invalid organizationId.");
  }
  if (personId && !isSupplierUuid(personId)) {
    throw gatewayError("invalid_request", 400, "Invalid personId.");
  }

  return {
    question: parsed.data.question,
    organizationId,
    personId,
    keyword,
  };
}

function resolveOrganizationIdForUsage(
  request: SupplierAiAskRequest,
  retrieval: SupplierAiRetrievalResult,
): string | null {
  if (request.organizationId) return request.organizationId;
  const ids = new Set(
    retrieval.conversations
      .map((row) => row.organizationId)
      .filter((id): id is string => Boolean(id)),
  );
  if (ids.size === 1) return [...ids][0] ?? null;
  return null;
}

async function runSynthesisPath(input: {
  userId: string;
  request: SupplierAiAskRequest;
  retrieval: SupplierAiRetrievalResult;
  decisionReason: string;
  sources: ReturnType<typeof toAskSources>;
  contentBlocks: ReturnType<typeof buildRetrievalContentBlocks>;
}): Promise<SupplierAiAskResponse> {
  const aiEnabled = isSupplierAiFeatureEnabled();
  if (!aiEnabled) {
    return {
      ok: false,
      error: "ai_disabled",
      message: SUPPLIER_AI_USER_SAFE_MESSAGES.feature_flag_off,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: { ...EMPTY_USAGE },
    };
  }

  const runtime = getSupplierAiRuntimeStatus();
  if (!runtime.ready) {
    return {
      ok: false,
      error: "provider_not_ready",
      message:
        runtime.reason === "missing_api_key"
          ? SUPPLIER_AI_USER_SAFE_MESSAGES.missing_api_key
          : SUPPLIER_AI_USER_SAFE_MESSAGES.feature_flag_off,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: { ...EMPTY_USAGE },
    };
  }

  const model = getSupplierAiDefaultModel();
  const maxReserve = calculateMaximumReservationUsd({
    model,
    contextCharacterCount: input.retrieval.contextCharacterCount,
  });
  if (!maxReserve.ok) {
    return {
      ok: false,
      error: "provider_not_ready",
      message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.provider_not_ready,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: { ...EMPTY_USAGE },
    };
  }

  const privileged = await getPrivilegedSupplierAiClient();
  if (!privileged.ok) {
    return {
      ok: false,
      error: "provider_not_ready",
      message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.provider_not_ready,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: { ...EMPTY_USAGE },
    };
  }

  // CRITICAL: reserve BEFORE any provider call.
  const reservation = await tryReserveSupplierAiBudget({
    client: privileged.client,
    userId: input.userId,
    reservedCostUsd: maxReserve.maxCostUsd,
    ttlSeconds: 120,
  });

  if (!reservation.ok) {
    const exhausted =
      reservation.error_code === "budget_exhausted" ||
      reservation.error_code === "invalid_amount";
    return {
      ok: false,
      error: exhausted ? "budget_exhausted" : "provider_not_ready",
      message: exhausted
        ? SUPPLIER_AI_USER_SAFE_MESSAGES.budget_exhausted
        : SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.provider_not_ready,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: { ...EMPTY_USAGE },
    };
  }

  const reservationId = reservation.reservation_id;
  const billingMonth = reservation.billing_month;

  let completion;
  try {
    const provider = getSupplierAiProvider("openai");
    completion = await provider.complete({
      taskType: "synthesize_answer",
      systemInstructions: SUPPLIER_AI_SYSTEM_INSTRUCTIONS,
      userInput: buildSynthesisUserInput(
        input.request.question,
        input.retrieval,
      ),
      // Server ceiling only — provider also clamps.
      maxOutputTokens: undefined,
      temperature: 0.2,
    });
  } catch (err) {
    await releaseSupplierAiReservation({
      client: privileged.client,
      reservationId,
    });

    if (err instanceof SupplierAiDisabledError) {
      return {
        ok: false,
        error: "provider_not_ready",
        message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.provider_not_ready,
        mode: "SYNTHESIS",
        sources: input.sources,
        usage: {
          providerCalled: false,
          reservationId,
          estimatedCostUsd: null,
          inputTokens: null,
          outputTokens: null,
        },
      };
    }

    void (err instanceof SupplierAiProviderError);
    return {
      ok: false,
      error: "provider_error",
      message: SUPPLIER_AI_USER_SAFE_MESSAGES.provider_error,
      mode: "SYNTHESIS",
      sources: input.sources,
      usage: {
        providerCalled: true,
        reservationId,
        estimatedCostUsd: null,
        inputTokens: null,
        outputTokens: null,
      },
    };
  }

  const usageAvailable = completion.usageAvailable;
  const inputTokens = usageAvailable ? (completion.inputTokens ?? 0) : 0;
  const outputTokens = usageAvailable ? (completion.outputTokens ?? 0) : 0;

  let estimatedCostUsd: number;
  let errorCode: string | null = null;
  if (usageAvailable) {
    estimatedCostUsd = estimateCostUsd({
      inputTokens,
      outputTokens,
      pricing: maxReserve.pricing,
    });
  } else {
    // Do not fabricate token counts. Charge the reserved max and mark unknown usage.
    estimatedCostUsd = reservation.reserved_cost_usd;
    errorCode = "usage_unavailable";
  }

  const organizationId = resolveOrganizationIdForUsage(
    input.request,
    input.retrieval,
  );
  const usageModel = completion.model || model;

  const usageInsert = await insertSupplierAiUsage({
    client: privileged.client,
    row: {
      billingMonth,
      userId: input.userId,
      organizationId,
      taskType: "synthesize_answer",
      provider: completion.provider,
      model: usageModel,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      success: true,
      errorCode,
      providerRequestId: completion.providerRequestId,
      latencyMs: completion.latencyMs,
    },
  });

  let finalUsageId: string | null = usageInsert.ok ? usageInsert.usageId : null;
  let finalEstimatedCostUsd = estimatedCostUsd;
  let finalInputTokensForMeta: number | null = usageAvailable ? inputTokens : null;
  let finalOutputTokensForMeta: number | null = usageAvailable ? outputTokens : null;

  if (!usageInsert.ok) {
    // Paid provider call succeeded — never release. Attempt failsafe ledger row.
    // Failsafe charges reserved_cost_usd (conservative). Do not retry OpenAI.
    const failsafeTokensIn = usageAvailable ? inputTokens : 0;
    const failsafeTokensOut = usageAvailable ? outputTokens : 0;
    const failsafe = await insertSupplierAiUsage({
      client: privileged.client,
      row: {
        billingMonth,
        userId: input.userId,
        organizationId,
        taskType: "synthesize_answer",
        provider: completion.provider,
        model: usageModel,
        inputTokens: failsafeTokensIn,
        outputTokens: failsafeTokensOut,
        estimatedCostUsd: reservation.reserved_cost_usd,
        success: true,
        errorCode: "usage_insert_retry",
        providerRequestId: completion.providerRequestId,
        latencyMs: completion.latencyMs,
      },
    });

    if (!failsafe.ok) {
      // Both ledger writes failed after a paid provider call.
      // Do NOT release. Do NOT retry OpenAI. Pin expiry so 069 ordinary TTL
      // cannot silently expire the hold (held amount remains budget protection).
      await pinSupplierAiReservationForAccountingRecovery({
        client: privileged.client,
        reservationId,
      });
      return {
        ok: false,
        error: "usage_recording_failure",
        message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.usage_recording_failure,
        mode: "SYNTHESIS",
        sources: input.sources,
        usage: {
          providerCalled: true,
          reservationId,
          estimatedCostUsd: null,
          inputTokens: usageAvailable ? inputTokens : null,
          outputTokens: usageAvailable ? outputTokens : null,
        },
      };
    }

    finalUsageId = failsafe.usageId;
    finalEstimatedCostUsd = reservation.reserved_cost_usd;
    finalInputTokensForMeta = usageAvailable ? inputTokens : null;
    finalOutputTokensForMeta = usageAvailable ? outputTokens : null;
  }

  const consumed = await consumeSupplierAiReservation({
    client: privileged.client,
    reservationId,
    usageId: finalUsageId!,
  });

  if (!consumed.ok) {
    // Usage row exists; reservation may TTL-expire. Answer is still valid.
    // Prefer returning the answer — budget is at worst temporarily double-held.
  }

  return {
    ok: true,
    mode: "SYNTHESIS",
    answer: completion.text,
    message: null,
    decisionReason: input.decisionReason,
    sources: input.sources,
    truncated: input.retrieval.truncated,
    contextCharacterCount: input.retrieval.contextCharacterCount,
    aiEnabled: true,
    usage: {
      providerCalled: true,
      reservationId,
      estimatedCostUsd: finalEstimatedCostUsd,
      inputTokens: finalInputTokensForMeta,
      outputTokens: finalOutputTokensForMeta,
    },
    contentBlocks: input.contentBlocks,
  };
}

/**
 * Core ask handler.
 * DB_ONLY never calls provider/budget.
 * SYNTHESIS reserves before provider.
 */
export async function handleSupplierIntelligenceAsk(input: {
  client: SupabaseClient;
  user: User;
  request: SupplierAiAskRequest;
}): Promise<SupplierAiAskResponse> {
  await requireSupplierIntelligenceView(input.client, input.user);

  const decision = decideSupplierAiPath(input.request.question);
  const mode = decisionKindToAskMode(decision.kind);
  const aiEnabled = isSupplierAiFeatureEnabled();

  const keyword =
    input.request.keyword?.trim() ||
    (!input.request.organizationId && !input.request.personId
      ? deriveKeywordFromQuestion(input.request.question)
      : null);

  let retrieval: SupplierAiRetrievalResult;
  try {
    retrieval = await fetchSupplierConversationsForUser(input.client, {
      organizationId: input.request.organizationId,
      personId: input.request.personId,
      keyword,
      includeInsights: false,
    });
  } catch (err) {
    if (err instanceof SupplierAiGatewayError) throw err;
    throw gatewayError("retrieval_failure", 500);
  }

  const sources = toAskSources(retrieval.conversations);
  const contentBlocks = buildRetrievalContentBlocks(
    input.request.question,
    retrieval,
  );

  if (mode === "DB_ONLY") {
    return {
      ok: true,
      mode,
      answer: formatDatabaseOnlyAnswer(input.request.question, retrieval),
      message: null,
      decisionReason: decision.reason,
      sources,
      truncated: retrieval.truncated,
      contextCharacterCount: retrieval.contextCharacterCount,
      aiEnabled,
      usage: { ...EMPTY_USAGE },
      contentBlocks,
    };
  }

  return runSynthesisPath({
    userId: input.user.id,
    request: input.request,
    retrieval,
    decisionReason: decision.reason,
    sources,
    contentBlocks,
  });
}

export function supplierAiAskErrorToResponse(
  err: unknown,
): { status: number; body: SupplierAiAskResponse } {
  if (err instanceof SupplierAiGatewayError) {
    return {
      status: err.httpStatus,
      body: {
        ok: false,
        error: err.code,
        message: err.message,
        usage: { ...EMPTY_USAGE },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: "retrieval_failure",
      message: SUPPLIER_AI_GATEWAY_SAFE_MESSAGES.retrieval_failure,
      usage: { ...EMPTY_USAGE },
    },
  };
}
