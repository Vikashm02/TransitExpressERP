/**
 * Server-only Supplier AI configuration.
 * Defaults are safe: AI off unless explicitly enabled + key present.
 */

import "server-only";

import type { SupplierAiSafetyLimits } from "./types";

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Master kill switch. Default OFF. */
export function isSupplierAiFeatureEnabled(): boolean {
  return readBool("SUPPLIER_AI_ENABLED", false);
}

/**
 * Server-only OpenAI key. Never use NEXT_PUBLIC_*.
 * Absent key => AI unavailable; app must still build and capture work.
 */
export function getSupplierOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.SUPPLIER_OPENAI_API_KEY?.trim();
  return key ? key : null;
}

export function getSupplierAiDefaultModel(): string {
  return (
    process.env.SUPPLIER_AI_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

/**
 * Conservative safety limits. Override via env without code changes.
 * Durable monthly hard-stop is enforced by migration 069
 * (supplier_ai_try_reserve_budget) — not by process memory.
 * SUPPLIER_AI_MONTHLY_BUDGET_USD is an ops hint; DB settings are authoritative
 * after 069 is applied and seeded/updated.
 */
export function getSupplierAiSafetyLimits(): SupplierAiSafetyLimits {
  return {
    maxRetrievedConversations: readInt("SUPPLIER_AI_MAX_CONVERSATIONS", 12, 1, 50),
    maxContextCharacters: readInt("SUPPLIER_AI_MAX_CONTEXT_CHARS", 12_000, 1_000, 80_000),
    maxOutputTokens: readInt("SUPPLIER_AI_MAX_OUTPUT_TOKENS", 800, 64, 4_000),
    maxProviderCallsPerRequest: 1,
    monthlyBudgetUsd: readFloat("SUPPLIER_AI_MONTHLY_BUDGET_USD", 10, 0, 10_000),
    budgetWarningRatio: readFloat("SUPPLIER_AI_BUDGET_WARNING_RATIO", 0.8, 0.1, 0.99),
  };
}

export type SupplierAiRuntimeStatus =
  | { ready: true }
  | {
      ready: false;
      reason: "feature_flag_off" | "missing_api_key";
      message: string;
    };

/** Whether the gateway may attempt a provider call (ignores DB budget). */
export function getSupplierAiRuntimeStatus(): SupplierAiRuntimeStatus {
  if (!isSupplierAiFeatureEnabled()) {
    return {
      ready: false,
      reason: "feature_flag_off",
      message:
        "Supplier AI is disabled. Conversation capture continues without AI.",
    };
  }
  if (!getSupplierOpenAiApiKey()) {
    return {
      ready: false,
      reason: "missing_api_key",
      message:
        "Supplier AI is enabled but no server API key is configured. Conversation capture continues without AI.",
    };
  }
  return { ready: true };
}

export const SUPPLIER_AI_USER_SAFE_MESSAGES = {
  feature_flag_off:
    "AI answers are turned off right now. Your conversations are still saved normally.",
  missing_api_key:
    "AI answers are temporarily unavailable. Your conversations are still saved normally.",
  budget_exhausted:
    "The monthly AI budget has been reached. Your conversations are still saved; try again next month or ask an administrator.",
  provider_error:
    "AI could not complete this request. Your conversations were not changed. Try again later or use search/browse.",
  not_configured:
    "AI is not configured yet. Your conversations are still saved normally.",
} as const;
