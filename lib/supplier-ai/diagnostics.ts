/**
 * P0 observability helpers for Supplier AI ask/retrieval.
 * Logs SAFE metadata only — never conversation bodies, prompts, or secrets.
 */

import "server-only";

import { randomBytes } from "node:crypto";

import type {
  SupplierAiAskRequest,
  SupplierAiAskScope,
  SupplierAiRetrievalResult,
  SupplierAiRetrievedConversation,
} from "./types";

const PREFIX_RETRIEVAL = "supplier-ai retrieval:";
const PREFIX_SYNTHESIS = "supplier-ai synthesis:";
const PREFIX_RESPONSE = "supplier-ai response:";

/** Short non-sensitive correlation id for a single ask request (logs only). */
export function createSupplierAiDiagnosticId(): string {
  return randomBytes(6).toString("hex");
}

function truncateKeyword(keyword: string | null | undefined): string | null {
  if (keyword == null) return null;
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  // Keyword is already capped (~80); still clamp for log safety.
  return trimmed.slice(0, 80);
}

export type SupplierAiRetrievedEvidenceMeta = {
  conversationId: string;
  organizationId: string | null;
  organizationName: string | null;
  personId: string | null;
  personName: string | null;
  inputType: "text" | "voice";
  occurredAt: string;
  characterCount: number;
};

export function summarizeRetrievedEvidence(
  conversations: SupplierAiRetrievedConversation[],
): SupplierAiRetrievedEvidenceMeta[] {
  return conversations.map((row) => ({
    conversationId: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationNameSnapshot,
    personId: row.personId,
    personName: row.personNameSnapshot,
    inputType: row.inputType,
    occurredAt: row.occurredAt,
    characterCount: row.originalText.length,
  }));
}

export function logSupplierAiRetrievalDiagnostics(input: {
  diagnosticId: string;
  request: SupplierAiAskRequest;
  keyword: string | null;
  mode: "DB_ONLY" | "SYNTHESIS";
  decisionReason: string;
  retrieval: SupplierAiRetrievalResult;
}): void {
  const evidence = summarizeRetrievedEvidence(input.retrieval.conversations);
  const payload = {
    diagnosticId: input.diagnosticId,
    scope: (input.request.scope ?? null) as SupplierAiAskScope | null,
    organizationFilter: Boolean(input.request.organizationId),
    personFilter: Boolean(input.request.personId),
    organizationTypeFilter: Boolean(
      input.request.organizationTypeSlugs &&
        input.request.organizationTypeSlugs.length > 0,
    ),
    organizationId: input.request.organizationId ?? null,
    personId: input.request.personId ?? null,
    organizationTypeSlugs: input.request.organizationTypeSlugs ?? null,
    keyword: truncateKeyword(input.keyword),
    mode: input.mode,
    decisionReason: input.decisionReason,
    conversationCount: evidence.length,
    contextCharacterCount: input.retrieval.contextCharacterCount,
    truncated: input.retrieval.truncated,
    evidence,
  };

  console.info(PREFIX_RETRIEVAL, JSON.stringify(payload));
}

export function logSupplierAiSynthesisDiagnostics(input: {
  diagnosticId: string;
  scope: SupplierAiAskScope | null;
  questionLength: number;
  conversationCount: number;
  contextCharacterCount: number;
  synthesisExecuting: boolean;
}): void {
  const payload = {
    diagnosticId: input.diagnosticId,
    scope: input.scope,
    questionLength: input.questionLength,
    conversationCount: input.conversationCount,
    contextCharacterCount: input.contextCharacterCount,
    evidenceNonZero: input.conversationCount > 0,
    synthesisExecuting: input.synthesisExecuting,
  };

  console.info(PREFIX_SYNTHESIS, JSON.stringify(payload));
}

export function logSupplierAiResponseDiagnostics(input: {
  diagnosticId: string;
  success: boolean;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageAvailable: boolean | null;
  conversationCount: number;
  errorKind?: string | null;
}): void {
  const payload = {
    diagnosticId: input.diagnosticId,
    success: input.success,
    model: input.model,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    usageAvailable: input.usageAvailable,
    conversationCount: input.conversationCount,
    evidenceNonZero: input.conversationCount > 0,
    errorKind: input.errorKind ?? null,
  };

  console.info(PREFIX_RESPONSE, JSON.stringify(payload));
}
