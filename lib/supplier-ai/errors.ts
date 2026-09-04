/**
 * Safe, non-leaking error taxonomy for the Supplier AI gateway.
 */

export type SupplierAiGatewayErrorCode =
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

export class SupplierAiGatewayError extends Error {
  readonly code: SupplierAiGatewayErrorCode;
  readonly httpStatus: number;

  constructor(code: SupplierAiGatewayErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "SupplierAiGatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const SUPPLIER_AI_GATEWAY_SAFE_MESSAGES: Record<
  SupplierAiGatewayErrorCode,
  string
> = {
  unauthenticated: "You must be signed in to use Supplier Intelligence ask.",
  unauthorized: "You do not have access to Supplier Intelligence.",
  invalid_request: "The request was invalid. Check the question and try again.",
  ai_disabled:
    "AI answers are turned off right now. Your conversations are still saved normally.",
  provider_not_ready:
    "AI answers are temporarily unavailable. Your conversations are still saved normally.",
  budget_exhausted:
    "The monthly AI budget has been reached. Your conversations are still saved; try again next month or ask an administrator.",
  provider_error:
    "AI could not complete this request. Your conversations were not changed. Try again later or use search/browse.",
  retrieval_failure:
    "Could not load Supplier conversations right now. Try again later.",
  usage_recording_failure:
    "AI could not finalize this request safely. Your conversations were not changed. Try again later.",
  synthesis_unavailable:
    "AI synthesis is not available yet. Browse conversations or try a lookup question.",
};

export function gatewayError(
  code: SupplierAiGatewayErrorCode,
  httpStatus: number,
  message?: string,
): SupplierAiGatewayError {
  return new SupplierAiGatewayError(
    code,
    message ?? SUPPLIER_AI_GATEWAY_SAFE_MESSAGES[code],
    httpStatus,
  );
}
