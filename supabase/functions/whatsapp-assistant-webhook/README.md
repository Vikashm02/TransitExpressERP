# WhatsApp assistant webhook foundation

This public Meta callback must be deployed with Supabase platform JWT verification disabled; request authenticity is enforced in `index.ts` before any JSON parsing or database access.

Required server-side secrets (set only in the Supabase Edge Function environment):

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Meta GET webhook verification token.
- `WHATSAPP_META_APP_SECRET` — Meta app secret used to verify the `X-Hub-Signature-256` HMAC of POST raw bodies.
- `SUPABASE_URL` (or `SUPABASE_PROJECT_URL`) and `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`) — server-only Supabase credentials.

Do not put these values in source control, browser code, or a WhatsApp payload. This foundation deliberately does not invoke AI, read LR/POD data, or send WhatsApp replies.


Meta message-ID replay/idempotency protection is already durable through `whatsapp_inbound_events.meta_message_id`. Rate and abuse controls are intentionally deferred to the future authorized assistant-processing layer, where they can account for conversational context and verified ERP identity. Before production-scale use, `whatsapp_inbound_events` requires an explicit retention and cleanup policy.
