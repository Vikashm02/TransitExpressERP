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
  createSupplierAiDiagnosticId,
  logSupplierAiResponseDiagnostics,
  logSupplierAiRetrievalDiagnostics,
  logSupplierAiSynthesisDiagnostics,
} from "./diagnostics";
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
  resolveAskScopeFilters,
  SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS,
  type SupplierAiAskScope,
} from "./organization-type-filter";
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
  scope: z
    .enum(["organization", "organization_type", "all"])
    .nullable()
    .optional(),
  organizationId: z.string().trim().nullable().optional(),
  personId: z.string().trim().nullable().optional(),
  keyword: z.string().trim().max(80).nullable().optional(),
  organizationTypeSlug: z.string().trim().max(50).nullable().optional(),
  organizationTypeSlugs: z
    .array(z.string())
    .max(SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS)
    .nullable()
    .optional(),
});

export function parseSupplierAiAskRequest(body: unknown): SupplierAiAskRequest {
  const parsed = askBodySchema.safeParse(body);
  if (!parsed.success) {
    throw gatewayError("invalid_request", 400);
  }

  const organizationId = parsed.data.organizationId || null;
  const personId = parsed.data.personId || null;
  const keyword = parsed.data.keyword || null;
  const organizationTypeSlug = parsed.data.organizationTypeSlug || null;
  const scope = (parsed.data.scope ?? null) as SupplierAiAskScope | null;

  if (organizationId && !isSupplierUuid(organizationId)) {
    throw gatewayError("invalid_request", 400, "Invalid organizationId.");
  }
  if (personId && !isSupplierUuid(personId)) {
    throw gatewayError("invalid_request", 400, "Invalid personId.");
  }

  const resolved = resolveAskScopeFilters({
    scope,
    organizationId,
    personId,
    organizationTypeSlug,
    organizationTypeSlugs: parsed.data.organizationTypeSlugs,
  });
  if (!resolved.ok) {
    throw gatewayError("invalid_request", 400, resolved.message);
  }

  return {
    question: parsed.data.question,
    scope: resolved.filters.scope,
    organizationId: resolved.filters.organizationId,
    personId: resolved.filters.personId,
    keyword,
    organizationTypeSlug:
      resolved.filters.organizationTypeSlugs?.[0] ?? null,
    organizationTypeSlugs: resolved.filters.organizationTypeSlugs,
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
  diagnosticId: string;
}): Promise<SupplierAiAskResponse> {
  const conversationCount = input.retrieval.conversations.length;

  const aiEnabled = isSupplierAiFeatureEnabled();
  if (!aiEnabled) {
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: "ai_disabled",
    });
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
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: runtime.reason,
    });
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
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: "pricing_not_ready",
    });
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
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: "privileged_client_unavailable",
    });
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
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: exhausted ? "budget_exhausted" : "reserve_failed",
    });
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

  logSupplierAiSynthesisDiagnostics({
    diagnosticId: input.diagnosticId,
    scope: input.request.scope ?? null,
    questionLength: input.request.question.trim().length,
    conversationCount,
    contextCharacterCount: input.retrieval.contextCharacterCount,
    synthesisExecuting: true,
  });

  let completion;
  try {
    const provider = getSupplierAiProvider("openai");
    completion = await provider.complete({
      taskType: "synthesize_answer",
      systemInstructions: SUPPLIER_AI_SYSTEM_INSTRUCTIONS,
      userInput: buildSynthesisUserInput(
        input.request.question,
        input.retrieval,
        {
          scope: input.request.scope ?? null,
          organizationTypeSlugs: input.request.organizationTypeSlugs ?? null,
        },
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
      logSupplierAiResponseDiagnostics({
        diagnosticId: input.diagnosticId,
        success: false,
        model,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        usageAvailable: null,
        conversationCount,
        errorKind: "provider_disabled",
      });
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
    logSupplierAiResponseDiagnostics({
      diagnosticId: input.diagnosticId,
      success: false,
      model,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageAvailable: null,
      conversationCount,
      errorKind: "provider_error",
    });
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

  logSupplierAiResponseDiagnostics({
    diagnosticId: input.diagnosticId,
    success: true,
    model: completion.model || model,
    latencyMs: completion.latencyMs,
    inputTokens: completion.usageAvailable ? completion.inputTokens : null,
    outputTokens: completion.usageAvailable ? completion.outputTokens : null,
    usageAvailable: completion.usageAvailable,
    conversationCount,
    errorKind: null,
  });

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
  const diagnosticId = createSupplierAiDiagnosticId();

  await requireSupplierIntelligenceView(input.client, input.user);

  const decision = decideSupplierAiPath(input.request.question, {
    scope: input.request.scope ?? null,
  });
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
      organizationTypeSlugs: input.request.organizationTypeSlugs,
      keyword,
      includeInsights: false,
    });
  } catch (err) {
    if (err instanceof SupplierAiGatewayError) throw err;
    throw gatewayError("retrieval_failure", 500);
  }

  logSupplierAiRetrievalDiagnostics({
    diagnosticId,
    request: input.request,
    keyword,
    mode,
    decisionReason: decision.reason,
    retrieval,
  });

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
    diagnosticId,
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
