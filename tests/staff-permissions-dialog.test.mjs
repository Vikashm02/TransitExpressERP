import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path = "components/staff/StaffPermissionsDialog.tsx";
const src = readFileSync(new URL("../" + path, import.meta.url), "utf8");

// Execute the actual handleSave from the dialog with local mocks.
function handleSave(deps) {
  const tree = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSave") found = node;
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, "handleSave");
  const js = ts.transpileModule(found.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), js + "; return handleSave;")(...Object.values(deps));
}

function deps(overrides) {
  const writes = [];
  return {
    writes,
    d: {
      user: { id: "u1", displayName: "Test", fullAccess: false },
      fullAccess: false,
      actionsMap: {},
      loading: false,
      loadFailed: false,
      PERMISSION_MODULES: [{ key: "lr" }, { key: "pod" }],
      EMPTY_MODULE_ACTIONS: { view: false },
      setSaving: () => {},
      updateAppUserFullAccess: async () => writes.push("fullAccess"),
      setUserModuleActions: async (id, key) => writes.push(key),
      toast: { success: () => {}, error: () => {} },
      onSaved: () => {},
      onOpenChange: () => {},
      getUserFacingError: (e, f) => f,
      console,
      ...overrides,
    },
  };
}

test("save writes nothing when this user's permissions failed to load", async () => {
  const { writes, d } = deps({ loadFailed: true });
  await handleSave(d)();
  assert.deepEqual(writes, []);
});

test("save writes nothing while permissions are still loading", async () => {
  const { writes, d } = deps({ loading: true });
  await handleSave(d)();
  assert.deepEqual(writes, []);
});

test("save still writes every module after a successful load", async () => {
  const { writes, d } = deps({});
  await handleSave(d)();
  assert.deepEqual(writes.sort(), ["lr", "pod"]);
});

test("opening clears the previous user's map and ignores stale responses", () => {
  assert.match(src, /setActionsMap\(\{\}\);\s*setLoadFailed\(false\);\s*setLoading\(true\);/);
  assert.match(src, /if \(!cancelled\) setActionsMap\(map\)/);
  assert.match(src, /return \(\) => \{\s*cancelled = true;\s*\};/);
  assert.match(src, /disabled=\{saving \|\| loading \|\| loadFailed\}/);
});
