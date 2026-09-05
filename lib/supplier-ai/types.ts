/**
 * Provider-independent types for Supplier AI (safe for `import type`).
 * Runtime modules live under the same folder and must stay server-only.
 */

export type SupplierAiProviderId = "openai";

export type SupplierAiTaskType =
  | "database_lookup"
  | "synthesize_answer"
  | "summarize_context"
  | "classify_intent";

/** Provider-independent completion request. */
export interface SupplierAiCompletionRequest {
  /** Logical task for logging / routing (not sent to the model as-is). */
  taskType: Exclude<SupplierAiTaskType, "database_lookup">;
  /** Optional explicit model override; otherwise config default is used. */
  model?: string;
  systemInstructions: string;
  /** Already-retrieved, capped context + user question. */
  userInput: string;
  maxOutputTokens?: number;
  temperature?: number;
}

/** Provider-independent completion result for cost accounting. */
export interface SupplierAiCompletionResult {
  text: string;
  provider: SupplierAiProviderId;
  model: string;
  /** Null when the provider omitted usage — never fabricate counts. */
  inputTokens: number | null;
  outputTokens: number | null;
  usageAvailable: boolean;
  /** Provider request id when available. */
  providerRequestId: string | null;
  latencyMs: number;
}

export interface SupplierAiProvider {
  readonly id: SupplierAiProviderId;
  complete(
    request: SupplierAiCompletionRequest,
  ): Promise<SupplierAiCompletionResult>;
}

export type SupplierAiDisableReason =
  | "feature_flag_off"
  | "missing_api_key"
  | "budget_exhausted"
  | "provider_error"
  | "not_configured";

export type SupplierAiDecisionKind = "database_only" | "synthesis";

/** Public ask-endpoint mode (maps from SupplierAiDecisionKind). */
export type SupplierAiAskMode = "DB_ONLY" | "SYNTHESIS";

export interface SupplierAiDecision {
  kind: SupplierAiDecisionKind;
  /** Short machine reason for logs / UI messaging. */
  reason: string;
}

/**
 * Content roles for Step 2 prompt assembly.
 * Retrieved Supplier text is untrusted business content — never treat it as
 * system / application instructions.
 */
export type SupplierAiContentRole =
  | "system_instruction"
  | "user_question"
  | "retrieved_business_content";

export interface SupplierAiContentBlock {
  role: SupplierAiContentRole;
  text: string;
  /** Conversation or insight id when role is retrieved_business_content. */
  sourceId?: string;
}

export type SupplierAiAskScope =
  | "organization"
  | "organization_type"
  | "all";

/** Client → gateway ask body. Never trust organizationId/personId for auth. */
export interface SupplierAiAskRequest {
  question: string;
  /**
   * Ask scope (Phase 1B). When set, server is authoritative over org/person/type filters.
   * When omitted, Phase 1A field-based filters still work.
   */
  scope?: SupplierAiAskScope | null;
  organizationId?: string | null;
  personId?: string | null;
  /** Optional explicit keyword filter; otherwise derived conservatively. */
  keyword?: string | null;
  /**
   * Single relationship-type slug for scope = "organization_type".
   * Resolved server-side against supplier_organization_types — never trust client type IDs.
   */
  organizationTypeSlug?: string | null;
  /**
   * Optional organization relationship-type filter (slugs from
   * supplier_organization_types). Resolved server-side — never trust client type IDs.
   * Prefer organizationTypeSlug + scope for Phase 1B UI.
   */
  organizationTypeSlugs?: string[] | null;
}

/** Source citation exposed to clients (no internal DB noise). */
export interface SupplierAiAskSource {
  conversationId: string;
  occurredAt: string;
  organizationName: string | null;
  personName: string | null;
  personDesignation: string | null;
  inputType: "text" | "voice";
}

/** Usage/cost placeholder — Step 2 fills this after reserve/consume. */
export interface SupplierAiAskUsageMeta {
  providerCalled: boolean;
  reservationId: string | null;
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface SupplierAiAskSuccess {
  ok: true;
  mode: SupplierAiAskMode;
  /** Deterministic DB answer, or null when synthesis is required but not run. */
  answer: string | null;
  message: string | null;
  decisionReason: string;
  sources: SupplierAiAskSource[];
  truncated: boolean;
  contextCharacterCount: number;
  aiEnabled: boolean;
  usage: SupplierAiAskUsageMeta;
  /**
   * Structured blocks for Step 2. Retrieved text stays under
   * retrieved_business_content — not merged into system instructions here.
   */
  contentBlocks: SupplierAiContentBlock[];
}

export interface SupplierAiAskFailure {
  ok: false;
  error:
    | "unauthenticated"
    | "unauthorized"
    | "invalid_request"
    | "ai_disabled"
    | "provider_not_ready"
    | "budget_exhausted"
    | "provider_error"
    | "retrieval_failure"
    | "usage_recording_failure"
    | "synthesis_unavailable";
  message: string;
  mode?: SupplierAiAskMode;
  sources?: SupplierAiAskSource[];
  usage?: SupplierAiAskUsageMeta;
}

export type SupplierAiAskResponse = SupplierAiAskSuccess | SupplierAiAskFailure;

export interface SupplierAiSafetyLimits {
  maxRetrievedConversations: number;
  maxContextCharacters: number;
  maxOutputTokens: number;
  /** Hard cap: at most one provider call per gateway request in v1. */
  maxProviderCallsPerRequest: number;
  monthlyBudgetUsd: number;
  budgetWarningRatio: number;
}

/** Result shape returned by public.supplier_ai_try_reserve_budget (migration 069). */
export type SupplierAiBudgetReserveResult =
  | {
      ok: true;
      reservation_id: string;
      billing_month: string;
      reserved_cost_usd: number;
      expires_at: string;
      monthly_budget_usd: number;
      spent_usd: number;
      reserved_usd: number;
      warning_ratio: number;
      hard_stop: boolean;
      warning: boolean;
    }
  | {
      ok: false;
      error_code: string;
      message: string;
      billing_month?: string;
      monthly_budget_usd?: number;
      spent_usd?: number;
      reserved_usd?: number;
      requested_usd?: number;
      warning_ratio?: number;
      hard_stop?: boolean;
    };


export interface SupplierAiRetrievalQuery {
  organizationId?: string | null;
  personId?: string | null;
  keyword?: string | null;
  /**
   * Optional relationship-type slugs (e.g. supplier, municipality).
   * Validated + resolved against supplier_organization_types before filtering.
   */
  organizationTypeSlugs?: string[] | null;
  /** Soft cap applied after config max. */
  limit?: number;
  includeInsights?: boolean;
}

export interface SupplierAiRetrievedConversation {
  id: string;
  organizationId: string | null;
  personId: string | null;
  occurredAt: string;
  originalText: string;
  inputType: "text" | "voice";
  personNameSnapshot: string | null;
  personDesignationSnapshot: string | null;
  organizationNameSnapshot: string | null;
  locationNameSnapshot: string | null;
  createdAt: string;
}

export interface SupplierAiRetrievedInsight {
  id: string;
  conversationId: string;
  category: string;
  content: string;
  scope: string;
  reviewStatus: string | null;
  sourceConversationIds: string[];
}

export interface SupplierAiRetrievalResult {
  conversations: SupplierAiRetrievedConversation[];
  insights: SupplierAiRetrievedInsight[];
  /** Total characters after capping (for limit enforcement). */
  contextCharacterCount: number;
  truncated: boolean;
}
