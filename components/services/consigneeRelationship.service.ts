import { supabase } from "@/lib/supabase";

/**
 * Consignee Relationship Intelligence — human conversation capture.
 * Separate from LR analytics (`consigneeIntelligence.service.ts` /
 * `get_consignee_intelligence`). Uses Phase 2A table + RPCs only.
 */

export type ConsigneeConversationInputType = "text" | "voice";

export interface ConsigneeConversation {
  id: number;
  customerId: number;
  customerName: string;
  customerCode: string | null;
  originalRemark: string;
  inputType: ConsigneeConversationInputType;
  createdAt: string;
  createdBy: string | null;
  createdByName: string;
  aiStatus: string;
  aiProcessedAt: string | null;
  aiCategory: string | null;
  aiSubcategory: string | null;
  aiIssueSummary: string | null;
  aiImpact: string | null;
  aiConclusion: string | null;
  aiNature: string | null;
  aiNatureConfidence: string | null;
  aiResolutionText: string | null;
  aiResolutionDate: string | null;
  followUpDueDate: string | null;
}

export interface ConsigneeConversationsResult {
  customerId: number;
  totalCount: number;
  limit: number;
  offset: number;
  conversations: ConsigneeConversation[];
}

export interface ConsigneeConversationSummaryItem {
  customerId: number;
  customerName: string;
  customerCode: string | null;
  lastConversationAt: string;
  conversationCount: number;
  lastAiConclusion: string | null;
  lastCreatedByName: string;
}

export interface CreateConsigneeConversationInput {
  customerId: number;
  customerName: string;
  customerCode?: string | null;
  originalRemark: string;
  inputType?: ConsigneeConversationInputType;
}

const TABLE = "consignee_conversations";
const TIMELINE_PAGE_SIZE = 100;

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapConversation(row: Record<string, unknown>): ConsigneeConversation {
  const inputType = row.input_type === "voice" ? "voice" : "text";

  return {
    id: asNumber(row.id),
    customerId: asNumber(row.customer_id),
    customerName: asString(row.customer_name),
    customerCode: asNullableString(row.customer_code),
    originalRemark: asString(row.original_remark),
    inputType,
    createdAt: asString(row.created_at),
    createdBy: asNullableString(row.created_by),
    createdByName: asString(row.created_by_name, "Unknown"),
    aiStatus: asString(row.ai_status, "pending"),
    aiProcessedAt: asNullableString(row.ai_processed_at),
    aiCategory: asNullableString(row.ai_category),
    aiSubcategory: asNullableString(row.ai_subcategory),
    aiIssueSummary: asNullableString(row.ai_issue_summary),
    aiImpact: asNullableString(row.ai_impact),
    aiConclusion: asNullableString(row.ai_conclusion),
    aiNature: asNullableString(row.ai_nature),
    aiNatureConfidence: asNullableString(row.ai_nature_confidence),
    aiResolutionText: asNullableString(row.ai_resolution_text),
    aiResolutionDate: asNullableString(row.ai_resolution_date),
    followUpDueDate: asNullableString(row.follow_up_due_date),
  };
}

function mapInsertedRow(
  row: Record<string, unknown>,
  createdByName: string
): ConsigneeConversation {
  return mapConversation({
    ...row,
    created_by_name: createdByName,
  });
}

/**
 * Timeline for one consignee via Phase 2A RPC.
 * RPC returns newest-first; callers that need chat order should reverse.
 */
export async function getConsigneeConversations(
  customerId: number,
  options?: { limit?: number; offset?: number }
): Promise<ConsigneeConversationsResult> {
  const limit = options?.limit ?? TIMELINE_PAGE_SIZE;
  const offset = options?.offset ?? 0;

  const { data, error } = await supabase.rpc("get_consignee_conversations", {
    p_customer_id: customerId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;

  const payload = (data ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(payload.conversations)
    ? payload.conversations
    : [];

  return {
    customerId: asNumber(payload.customer_id, customerId),
    totalCount: asNumber(payload.total_count),
    limit: asNumber(payload.limit, limit),
    offset: asNumber(payload.offset, offset),
    conversations: rawList.map((item) =>
      mapConversation(item as Record<string, unknown>)
    ),
  };
}

/** Landing-page recent activity — one row per consignee with history. */
export async function getConsigneeConversationSummary(
  limit = 50
): Promise<ConsigneeConversationSummaryItem[]> {
  const { data, error } = await supabase.rpc(
    "get_consignee_conversation_summary",
    { p_limit: limit }
  );

  if (error) throw error;

  const payload = (data ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(payload.consignees) ? payload.consignees : [];

  return rawList.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      customerId: asNumber(row.customer_id),
      customerName: asString(row.customer_name),
      customerCode: asNullableString(row.customer_code),
      lastConversationAt: asString(row.last_conversation_at),
      conversationCount: asNumber(row.conversation_count),
      lastAiConclusion: asNullableString(row.last_ai_conclusion),
      lastCreatedByName: asString(row.last_created_by_name, "Unknown"),
    };
  });
}

/**
 * Insert a human remark. Does not send created_by / created_at / AI fields —
 * migration 065 trigger owns those.
 */
export async function createConsigneeConversation(
  input: CreateConsigneeConversationInput,
  options?: { createdByName?: string }
): Promise<ConsigneeConversation> {
  const remark = input.originalRemark.trim();
  if (!remark) {
    throw new Error("Remark cannot be empty.");
  }

  if (!input.customerId || input.customerId <= 0) {
    throw new Error("A consignee must be selected.");
  }

  const customerName = input.customerName.trim();
  if (!customerName) {
    throw new Error("Consignee name is required.");
  }

  const payload = {
    customer_id: input.customerId,
    customer_name: customerName,
    customer_code: input.customerCode?.trim() || null,
    original_remark: remark,
    input_type: input.inputType === "voice" ? "voice" : "text",
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select(
      [
        "id",
        "customer_id",
        "customer_name",
        "customer_code",
        "original_remark",
        "input_type",
        "created_at",
        "created_by",
        "ai_status",
        "ai_processed_at",
        "ai_category",
        "ai_subcategory",
        "ai_issue_summary",
        "ai_impact",
        "ai_conclusion",
        "ai_nature",
        "ai_nature_confidence",
        "ai_resolution_text",
        "ai_resolution_date",
        "follow_up_due_date",
      ].join(", ")
    )
    .single();

  if (error) throw error;

  return mapInsertedRow(
    data as unknown as Record<string, unknown>,
    options?.createdByName?.trim() || "Unknown"
  );
}
