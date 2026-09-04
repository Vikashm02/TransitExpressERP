/**
 * Explicit Supplier AI model pricing (USD per 1M tokens).
 * Unknown models FAIL CLOSED — never invent rates at request time.
 */

import "server-only";

import { getSupplierAiDefaultModel, getSupplierAiSafetyLimits } from "./config";

export interface SupplierAiModelPricing {
  model: string;
  /** USD per 1,000,000 input tokens */
  inputUsdPer1MTokens: number;
  /** USD per 1,000,000 output tokens */
  outputUsdPer1MTokens: number;
}

/**
 * Fixed overhead tokens for system instructions + user framing wrappers.
 * Used only as a billing reservation ceiling component — not a tokenizer estimate.
 */
export const SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD = 2_500;

/**
 * Allowlisted configured rates only.
 * Ops may override both rates via env (applies to the configured default model).
 */
const CONFIGURED_OPENAI_PRICING: Record<
  string,
  { inputUsdPer1MTokens: number; outputUsdPer1MTokens: number }
> = {
  "gpt-4o-mini": {
    inputUsdPer1MTokens: 0.15,
    outputUsdPer1MTokens: 0.6,
  },
  "gpt-4o": {
    inputUsdPer1MTokens: 2.5,
    outputUsdPer1MTokens: 10,
  },
};

/** Env rates must be finite and strictly > 0 (zero rejected). */
function readPositiveFloatEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || !(parsed > 0)) return null;
  return parsed;
}

/** Resolve pricing for a model, or null if not configured (fail closed). */
export function getConfiguredModelPricing(
  model: string,
): SupplierAiModelPricing | null {
  const normalized = model.trim();
  if (!normalized) return null;

  const envInput = readPositiveFloatEnv("SUPPLIER_AI_USD_PER_1M_INPUT_TOKENS");
  const envOutput = readPositiveFloatEnv("SUPPLIER_AI_USD_PER_1M_OUTPUT_TOKENS");
  if (envInput != null && envOutput != null) {
    return {
      model: normalized,
      inputUsdPer1MTokens: envInput,
      outputUsdPer1MTokens: envOutput,
    };
  }

  const known = CONFIGURED_OPENAI_PRICING[normalized];
  if (!known) return null;

  return {
    model: normalized,
    inputUsdPer1MTokens: known.inputUsdPer1MTokens,
    outputUsdPer1MTokens: known.outputUsdPer1MTokens,
  };
}

export function estimateCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
  pricing: SupplierAiModelPricing;
}): number {
  const inputCost =
    (Math.max(0, input.inputTokens) / 1_000_000) *
    input.pricing.inputUsdPer1MTokens;
  const outputCost =
    (Math.max(0, input.outputTokens) / 1_000_000) *
    input.pricing.outputUsdPer1MTokens;
  // Match numeric(12,6) scale used by migration 069.
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Maximum USD reservation for one SYNTHESIS provider call.
 *
 * This is a CONSERVATIVE BILLING RESERVATION CEILING for hard-budget safety —
 * NOT an average tokenizer estimate.
 *
 * Worst-case input tokens assume denser scripts (e.g. Hindi/Devanagari/CJK)
 * can approach ~1 token per character of retrieved context, plus framing overhead.
 * Never use a chars/2 (Latin-average) heuristic here.
 */
export function calculateMaximumReservationUsd(input?: {
  model?: string;
  contextCharacterCount?: number;
}):
  | { ok: true; model: string; maxCostUsd: number; pricing: SupplierAiModelPricing }
  | { ok: false; reason: "pricing_not_configured" } {
  const model = (input?.model?.trim() || getSupplierAiDefaultModel()).trim();
  const pricing = getConfiguredModelPricing(model);
  if (!pricing) {
    return { ok: false, reason: "pricing_not_configured" };
  }

  const limits = getSupplierAiSafetyLimits();
  const contextChars = Math.min(
    Math.max(input?.contextCharacterCount ?? limits.maxContextCharacters, 0),
    limits.maxContextCharacters,
  );

  // Conservative ceiling: 1 token per context character + framing/system overhead.
  const maxInputTokens =
    contextChars + SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD;
  const maxOutputTokens = limits.maxOutputTokens;

  const maxCostUsd = estimateCostUsd({
    inputTokens: maxInputTokens,
    outputTokens: maxOutputTokens,
    pricing,
  });

  // Reservation must be > 0 (DB constraint). Floor tiny positive estimates.
  const reserved = Math.max(maxCostUsd, 0.000001);

  return { ok: true, model, maxCostUsd: reserved, pricing };
}
