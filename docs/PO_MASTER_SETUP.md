# PO Master

This change is not a production deployment. Review and manually apply
`database/migrations/073_purchase_order_master.sql` before deploying this UI.
Do not run all local migrations: unrelated, untracked migration files exist.

## Behaviour

- Store billing party, PO number, issue date, allotted metric tons and manual Active/Inactive status.
- One active PO auto-fills a new LR's PO number and date; multiple active POs require selection.
- Inactive POs never appear in the selection list. An existing LR retains its saved PO snapshot.
- No active PO: retain the existing manual entry capability; no automatic PO is invented.
- Used weight is computed from linked, final, non-cancelled LRs across all staff.
  Drafts and cancelled LRs do not count. Edits/cancellation update the aggregate automatically.
- Yellow at 80% through 90%; red strictly above 90%. Over-allocation is allowed and never changes status.
- The migration does not backfill historical LR links or alter existing numbering/financial functions.
- PO number and billing party cannot change once the PO is linked to an LR. Deactivate obsolete POs.
- PO master edits and LR PO snapshot changes are recorded in an append-only audit table.

## Permissions and rollout

1. Review the new tables, LR columns/triggers and RPCs against the actual production schema.
   Dependencies include existing permission helpers (041) and numbered draft creation (062).
2. Have the user apply only the approved SQL. No production data has been queried or changed by this task.
3. Grant staff PO Master View/Create/Edit access through the existing Staff permissions screen.
   Existing admin/full-access behaviour is reused. No staff permissions are auto-granted.
4. Deploy only with explicit production authorization. Deploying the UI before SQL is applied
   will make new PO queries/saves unavailable, including PO verification on new LR finalization.
5. Validate one active PO, multiple active POs, inactive PO on a resumed draft, cancel/restore,
   and staff with LR access but no PO Master access in a non-production environment first.

The PO list RPC intentionally returns complete aggregate weight even for staff who cannot read
all LR rows. It returns no individual LR data. LR lookup exposes only active PO identity/date
and requires LR create/edit permission. No service-role client is used in the UI.

## Local validation

Run `node --experimental-strip-types --test tests/purchase-orders.test.mjs` with Node 22 or later.
For the SQL checks, install `@electric-sql/pglite` in a temporary directory and set
`PO_TEST_PGLITE_PATH` to its absolute `dist/index.js` path. No project dependency changes are needed.
The SQL tests use an in-memory database with fixture auth/RLS and a fixture number allocator;
they do not connect to Supabase or certify the deployed production schema.
