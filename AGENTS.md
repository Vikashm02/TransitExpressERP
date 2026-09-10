<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Production ERP rules

- This is a production transportation ERP. Preserve existing architecture and behavior unless the task explicitly requires a change.
- Never modify unrelated working-tree changes or untracked files.
- Never delete, clean up, revert, overwrite, or commit pre-existing user work unless explicitly instructed.
- Database/schema changes require explicit approval. Do not automatically apply Supabase migrations or modify production data.
- For Supabase migrations, prepare/review the SQL and let the user manually apply it unless explicitly instructed otherwise.
- Never deploy to production unless explicitly instructed.
- Never expose, print, commit, or modify secrets or environment credentials.
- Authentication, RLS, permissions, service-role usage, numbering logic, financial calculations, LR data, billing data, and audit history are high-risk areas. Flag implications before making changes.
- Prefer the smallest safe implementation over broad refactoring.
- Before modifying code, inspect the relevant existing implementation and reuse established project patterns.
- After code changes, run appropriate TypeScript/build checks when practical and report the results.
- Do not commit or push unless explicitly instructed.
- If requirements are ambiguous in a way that could affect business data or production behavior, ask before implementing.
