/**
 * OpenAI adapter — server-only, fetch-based (no browser SDK).
 * Does not call the network unless the feature flag is on and a key exists.
 */

import "server-only";

import {
  getSupplierAiDefaultModel,
  getSupplierAiRuntimeStatus,
  getSupplierAiSafetyLimits,
  getSupplierOpenAiApiKey,
} from "./config";
import type {
  SupplierAiCompletionRequest,
  SupplierAiCompletionResult,
  SupplierAiProvider,
} from "./types";

type OpenAiChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string | number | null };
};

export class SupplierAiDisabledError extends Error {
  readonly reason: "feature_flag_off" | "missing_api_key";

  constructor(reason: "feature_flag_off" | "missing_api_key", message: string) {
    super(message);
    this.name = "SupplierAiDisabledError";
    this.reason = reason;
  }
}

export class SupplierAiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierAiProviderError";
  }
}

/** Default provider timeout — must stay below reservation TTL (default 120s). */
export const SUPPLIER_AI_PROVIDER_TIMEOUT_MS = 45_000;

/** Safe error.name only — never log Error.message (may contain request details). */
function classifyFetchFailure(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "unknown";
}

function safeOpenAiErrorMeta(error: OpenAiChatResponse["error"]): {
  code?: string;
  type?: string;
} {
  if (!error || typeof error !== "object") return {};
  const meta: { code?: string; type?: string } = {};
  if (typeof error.type === "string" && error.type.trim()) {
    meta.type = error.type.trim().slice(0, 80);
  }
  if (error.code != null && String(error.code).trim()) {
    meta.code = String(error.code).trim().slice(0, 80);
  }
  return meta;
}

export class OpenAiSupplierAiProvider implements SupplierAiProvider {
  readonly id = "openai" as const;

  async complete(
    request: SupplierAiCompletionRequest,
  ): Promise<SupplierAiCompletionResult> {
    const status = getSupplierAiRuntimeStatus();
    if (!status.ready) {
      throw new SupplierAiDisabledError(status.reason, status.message);
    }

    const apiKey = getSupplierOpenAiApiKey();
    if (!apiKey) {
      throw new SupplierAiDisabledError(
        "missing_api_key",
        "OpenAI API key is not configured on the server.",
      );
    }

    const limits = getSupplierAiSafetyLimits();
    // Server-controlled model/limits only — ignore any unsafe client-driven values
    // by always clamping to config ceilings (gateway also does not accept overrides).
    const model = getSupplierAiDefaultModel();
    const maxOutputTokens = Math.min(
      request.maxOutputTokens ?? limits.maxOutputTokens,
      limits.maxOutputTokens,
    );

    const controller = new AbortController();
    const timeoutMs = SUPPLIER_AI_PROVIDER_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxOutputTokens,
          messages: [
            { role: "system", content: request.systemInstructions },
            { role: "user", content: request.userInput },
          ],
        }),
      });
    } catch (err) {
      const latencyMs = Date.now() - started;
      void latencyMs;
      if (err instanceof Error && err.name === "AbortError") {
        console.error("supplier-ai openai: timeout");
        throw new SupplierAiProviderError("OpenAI request timed out.");
      }
      console.error("supplier-ai openai: fetch_failed", {
        classification: classifyFetchFailure(err),
      });
      throw new SupplierAiProviderError("OpenAI request failed to complete.");
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - started;
    let payload: OpenAiChatResponse;
    try {
      payload = (await response.json()) as OpenAiChatResponse;
    } catch {
      console.error("supplier-ai openai: non_json", {
        status: response.status,
      });
      throw new SupplierAiProviderError(
        `OpenAI returned a non-JSON response (HTTP ${response.status}).`,
      );
    }

    if (!response.ok) {
      // Never forward provider error bodies to clients — keep message generic.
      void payload.error?.message;
      const meta = safeOpenAiErrorMeta(payload.error);
      console.error("supplier-ai openai: http_error", {
        status: response.status,
        statusText: response.statusText || undefined,
        ...meta,
      });
      throw new SupplierAiProviderError(
        `OpenAI request failed with HTTP ${response.status}.`,
      );
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      console.error("supplier-ai openai: empty_completion", {
        status: response.status,
      });
      throw new SupplierAiProviderError("OpenAI returned an empty completion.");
    }

    const hasUsage =
      typeof payload.usage?.prompt_tokens === "number" &&
      typeof payload.usage?.completion_tokens === "number";

    return {
      text,
      provider: "openai",
      model: payload.model || model,
      inputTokens: hasUsage ? payload.usage!.prompt_tokens! : null,
      outputTokens: hasUsage ? payload.usage!.completion_tokens! : null,
      usageAvailable: hasUsage,
      providerRequestId: payload.id ?? null,
      latencyMs,
    };
  }
}

let cachedProvider: OpenAiSupplierAiProvider | null = null;

export function getOpenAiSupplierAiProvider(): OpenAiSupplierAiProvider {
  if (!cachedProvider) {
    cachedProvider = new OpenAiSupplierAiProvider();
  }
  return cachedProvider;
}
