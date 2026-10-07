import { supabase } from "@/lib/supabase";
import {
  parseWhatsappAccessRow,
  parseWhatsappDisableResponse,
  parseWhatsappSetPhoneResponse,
  type WhatsappAccessRow,
  type WhatsappSetPhoneResult,
} from "@/lib/whatsappAccessRules";

/**
 * Creator-managed WhatsApp Assistant access (M114).
 *
 * Calls ONLY the three public management RPCs:
 *   - whatsapp_internal_access_list
 *   - whatsapp_internal_access_set_phone
 *   - whatsapp_internal_access_disable
 *
 * It never calls the two private helpers
 * (whatsapp_internal_access_require_creator / whatsapp_internal_access_normalize_phone)
 * and never reads/writes whatsapp_user_links directly. All authorization and
 * phone normalization decisions are re-validated by the database. Responses
 * are strictly narrowed against the actual M114 contract — malformed
 * payloads fail closed with a local safe error rather than being coerced.
 */

export type { WhatsappAccessRow, WhatsappSetPhoneResult } from "@/lib/whatsappAccessRules";

/** Creator-only; throws a safe local error on malformed payloads. */
export async function listWhatsappAccess(): Promise<WhatsappAccessRow[]> {
  const { data, error } = await supabase.rpc("whatsapp_internal_access_list");
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  return data.map(parseWhatsappAccessRow);
}

/**
 * Enable or change the target's canonical WhatsApp number. The typed input is
 * submitted as-is; M114 normalizes/validates authoritatively and returns the
 * canonical +91 form. No client-side direct table write.
 */
export async function setWhatsappPhoneNumber(
  targetUserId: string,
  phoneInput: string
): Promise<WhatsappSetPhoneResult> {
  const { data, error } = await supabase.rpc("whatsapp_internal_access_set_phone", {
    p_target_user_id: targetUserId,
    p_phone_input: phoneInput,
  });
  if (error) throw error;
  return parseWhatsappSetPhoneResponse(data);
}

export async function disableWhatsappAccess(targetUserId: string): Promise<void> {
  const { data, error } = await supabase.rpc("whatsapp_internal_access_disable", {
    p_target_user_id: targetUserId,
  });
  if (error) throw error;
  parseWhatsappDisableResponse(data);
}
