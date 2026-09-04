/**
 * Provider registry — OpenAI only for now; boundary is replaceable later.
 */

import "server-only";

import { getOpenAiSupplierAiProvider } from "./openai-provider";
import type { SupplierAiProvider, SupplierAiProviderId } from "./types";

export function getSupplierAiProvider(
  id: SupplierAiProviderId = "openai",
): SupplierAiProvider {
  switch (id) {
    case "openai":
      return getOpenAiSupplierAiProvider();
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unsupported Supplier AI provider: ${String(_exhaustive)}`);
    }
  }
}
