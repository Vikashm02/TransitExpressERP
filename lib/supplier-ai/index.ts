/**
 * Supplier AI server foundation (Phase 10D).
 *
 * - Provider-independent boundary (OpenAI adapter)
 * - Feature flag default OFF
 * - Authenticated gateway: JWT + has_permission + RLS retrieval
 * - SYNTHESIS: atomic budget reserve → provider → usage → consume
 * - No chat UI
 */

import "server-only";

export type {
  SupplierAiAskFailure,
  SupplierAiAskMode,
  SupplierAiAskRequest,
  SupplierAiAskResponse,
  SupplierAiAskScope,
  SupplierAiAskSource,
  SupplierAiAskSuccess,
  SupplierAiAskUsageMeta,
  SupplierAiBudgetReserveResult,
  SupplierAiCompletionRequest,
  SupplierAiCompletionResult,
  SupplierAiContentBlock,
  SupplierAiContentRole,
  SupplierAiDecision,
  SupplierAiDecisionKind,
  SupplierAiDisableReason,
  SupplierAiProvider,
  SupplierAiProviderId,
  SupplierAiRetrievalQuery,
  SupplierAiRetrievalResult,
  SupplierAiRetrievedConversation,
  SupplierAiRetrievedInsight,
  SupplierAiSafetyLimits,
  SupplierAiTaskType,
} from "./types";

export {
  SUPPLIER_AI_USER_SAFE_MESSAGES,
  getSupplierAiDefaultModel,
  getSupplierAiRuntimeStatus,
  getSupplierAiSafetyLimits,
  getSupplierOpenAiApiKey,
  isSupplierAiFeatureEnabled,
} from "./config";

export { getSupplierAiProvider } from "./provider";
export {
  OpenAiSupplierAiProvider,
  SUPPLIER_AI_PROVIDER_TIMEOUT_MS,
  SupplierAiDisabledError,
  SupplierAiProviderError,
  getOpenAiSupplierAiProvider,
} from "./openai-provider";
export { decideSupplierAiPath, decisionKindToAskMode } from "./decision";
export {
  describeAskScopeForPrompt,
  isSupplierAiAskScope,
  normalizeOrganizationTypeSlugs,
  resolveAskScopeFilters,
  SUPPLIER_AI_ASK_SCOPES,
  SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS,
  SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH,
} from "./organization-type-filter";
export {
  buildRetrievalContentBlocks,
  buildSupplierKeywordIlike,
  capRetrievedContext,
  deriveKeywordFromQuestion,
  fetchSupplierConversationsForUser,
  formatDatabaseOnlyAnswer,
  formatRetrievalForProvider,
  isSupplierUuid,
  resolveOrganizationIdsForTypeSlugs,
  resolveRetrievalLimit,
  toAskSources,
} from "./retrieval";
export {
  handleSupplierIntelligenceAsk,
  parseSupplierAiAskRequest,
  supplierAiAskErrorToResponse,
} from "./gateway";
export {
  requireSupplierIntelligenceView,
  type SupplierAiAuthContext,
} from "./auth-context";
export {
  SupplierAiGatewayError,
  SUPPLIER_AI_GATEWAY_SAFE_MESSAGES,
  gatewayError,
  type SupplierAiGatewayErrorCode,
} from "./errors";
export {
  calculateMaximumReservationUsd,
  estimateCostUsd,
  getConfiguredModelPricing,
  SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD,
} from "./pricing";
export {
  SUPPLIER_AI_SYSTEM_INSTRUCTIONS,
  buildSynthesisUserInput,
} from "./prompt";
export {
  consumeSupplierAiReservation,
  getPrivilegedSupplierAiClient,
  insertSupplierAiUsage,
  pinSupplierAiReservationForAccountingRecovery,
  releaseSupplierAiReservation,
  tryReserveSupplierAiBudget,
  SUPPLIER_AI_ACCOUNTING_RECOVERY_EXPIRES_AT,
} from "./budget";
