/**
 * Historical LR bulk — atomicity + validation invariants (no live DB).
 *
 * Run: node --experimental-strip-types lib/historicalLrBulkAtomicity.node.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeLrBulkNumberInput,
  validateHistoricalLrCreateNumber,
} from "./historicalLrBulkNumber.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function main() {
  const migration = read("database/migrations/070_create_historical_lr_bulk.sql");
  const dialog = read("components/lr/LRBulkUploadDialog.tsx");
  const service = read("components/services/lr.service.ts");
  const listPage = read("components/lr/LRListPage.tsx");

  // --- Migration: function + security ---
  assert.match(migration, /create or replace function public\.create_historical_lr_bulk\(p_rows jsonb\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /grant execute on function public\.create_historical_lr_bulk\(jsonb\) to authenticated/);
  assert.match(migration, /revoke all on function public\.create_historical_lr_bulk\(jsonb\) from anon/);
  assert.match(migration, /has_permission\('lr', 'create_view'\)/);

  // --- Must NOT advance sequence (ignore comment mentions) ---
  const migrationBody = migration.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(migrationBody, /allocate_next_lr_number\s*\(/);
  assert.doesNotMatch(
    migrationBody,
    /update\s+public\.company_settings[\s\S]*lr_running_number\s*=/i,
  );
  assert.match(migration, /lr_running_number_unchanged/);
  assert.match(migration, /for share/i);

  // --- Validation rules present ---
  assert.match(migration, /already exists in the system/);
  assert.match(migration, /duplicated in the uploaded file/);
  assert.match(migration, /must be older than the current running LR number/);
  assert.match(migration, /LR Number is required/);
  assert.match(migration, /unique_violation/);

  // --- Atomic insert: no EXCEPTION WHEN OTHERS that swallows without re-raise ---
  assert.match(migration, /insert into public\.lrs/);
  assert.match(migration, /entry_status[\s\S]*'final'/);
  // Exception handlers must re-raise
  assert.match(migration, /when unique_violation then[\s\S]*raise exception/);
  assert.match(migration, /when others then[\s\S]*raise exception/);
  assert.doesNotMatch(migration, /when others then\s+null\s*;/i);

  // --- Dialog: single RPC path, no compensation loop ---
  const dialogCode = dialog.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(dialog, /createHistoricalLrBulk/);
  assert.doesNotMatch(dialogCode, /\bcreateLR\s*\(/);
  assert.doesNotMatch(dialogCode, /rollbackUploadBatch/);
  assert.doesNotMatch(dialogCode, /for\s*\(\s*const row of rows\s*\)/);
  assert.match(dialog, /No LR records were imported/);

  // --- Service exports atomic RPC wrapper ---
  assert.match(service, /export async function createHistoricalLrBulk/);
  assert.match(service, /create_historical_lr_bulk/);
  assert.doesNotMatch(
    service.slice(service.indexOf("createHistoricalLrBulk")),
    /allocateNextLrNumber/,
  );

  // --- Manual creation still allocates (unchanged) ---
  assert.match(listPage, /allocateNextLrNumber/);

  // --- Helper semantics (TEST 1–5 style) ---
  const cfg = { prefix: "LR", prefixLength: 5, runningNumber: 19310 };
  const existing = new Set(["lr19305"]);

  {
    const n = normalizeLrBulkNumberInput("19301", cfg);
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.equal(n.formatted, "LR19301");
      assert.equal(
        validateHistoricalLrCreateNumber({
          numeric: n.numeric,
          formatted: n.formatted,
          runningNumber: cfg.runningNumber,
          existingLrNumbersLower: existing,
        }),
        null,
      );
    }
  }

  {
    const n = normalizeLrBulkNumberInput("19305", cfg);
    assert.equal(n.ok, true);
    if (n.ok) {
      const err = validateHistoricalLrCreateNumber({
        numeric: n.numeric,
        formatted: n.formatted,
        runningNumber: cfg.runningNumber,
        existingLrNumbersLower: existing,
      });
      assert.match(String(err), /already exists/);
    }
  }

  {
    const n = normalizeLrBulkNumberInput("19311", cfg);
    assert.equal(n.ok, true);
    if (n.ok) {
      const err = validateHistoricalLrCreateNumber({
        numeric: n.numeric,
        formatted: n.formatted,
        runningNumber: cfg.runningNumber,
        existingLrNumbersLower: new Set(),
      });
      assert.match(String(err), /not allowed in historical bulk upload/);
    }
  }

  {
    const n = normalizeLrBulkNumberInput("", cfg);
    assert.equal(n.ok, false);
  }

  {
    const n = normalizeLrBulkNumberInput("LR19302", cfg);
    assert.equal(n.ok, true);
    if (n.ok) assert.equal(n.formatted, "LR19302");
  }

  console.log("historicalLrBulkAtomicity.node.mjs: all assertions passed");
}

main();
