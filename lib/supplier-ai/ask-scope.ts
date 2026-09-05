/**
 * Ask scope helpers — re-exports from the pure filter module.
 * Kept as a stable import path for gateway / prompt / tests.
 */

export {
  SUPPLIER_AI_ASK_SCOPES,
  describeAskScopeForPrompt,
  isSupplierAiAskScope,
  resolveAskScopeFilters,
  type ResolvedAskScopeFilters,
  type ResolveAskScopeResult,
  type SupplierAiAskScope,
} from "./organization-type-filter";
