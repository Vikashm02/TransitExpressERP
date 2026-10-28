import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const m117 = read("database/migrations/117_po_usage_alerts_95_100.sql");
const sender = read("supabase/functions/process-notifications/index.ts");
const poPage = read("components/purchaseOrder/PurchaseOrderListPage.tsx");
const sqlOnly = m117.replace(/^\s*--.*$/gm, "");

test("117 adds 95% and 100% rules and markers", () => {
  assert.match(sqlOnly, /'po\.usage_95'/);
  assert.match(sqlOnly, /'po\.usage_100'/);
  assert.match(sqlOnly, /add column if not exists notified_95_at timestamptz/);
  assert.match(sqlOnly, /add column if not exists notified_100_at timestamptz/);
});

test("117 checks all four levels, highest first", () => {
  assert.match(sqlOnly, /when v_percent >= 100 then 100\s+when v_percent >= 95 then 95\s+when v_percent >= 90 then 90\s+when v_percent >= 80 then 80/);
  assert.match(sqlOnly, /v_rule_key := 'po\.usage_' \|\| v_level/);
});

test("117 never deletes data or changes PO / LR rows", () => {
  assert.doesNotMatch(sqlOnly, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|column)\b/i);
  assert.doesNotMatch(sqlOnly, /update\s+public\.(purchase_orders|lrs)\b/i);
  assert.doesNotMatch(sqlOnly, /'Inactive'/);
});

test("117 marks lower levels done so a jump sends one alert", () => {
  assert.match(sqlOnly, /notified_80_at = coalesce\(notified_80_at, now\(\)\)/);
  assert.match(sqlOnly, /notified_95_at = case when v_level >= 95/);
});

test("sender delivers every PO level separately to all staff channels", () => {
  for (const level of [80, 90, 95, 100]) assert.match(sender, new RegExp(`"po\\.usage_${level}"`));
  assert.match(sender, /PO_USAGE_RULES\.has\(ruleKey\)\s*\n?\s*\? `\$\{ruleKey\}:\$\{String\(event\.id\)\}`/);
  assert.match(sender, /from\("notification_inbox"\)\.insert\(\s*userIds\.map/);
  assert.match(sender, /await deliverNativeAndroid\(admin, event, userIds, PO_ALERTS_ANDROID_CHANNEL\)/);
  assert.match(sender, /api\.resend\.com\/emails\/batch/);
});

test("PO alert path never deletes subscriptions or tokens", () => {
  const start = sender.indexOf("async function deliverPoUsageAlert");
  const end = sender.indexOf("async function deliverNativeAndroid");
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(sender.slice(start, end), /\.delete\(/);
});

test("PO Master lands sorted by usage %, highest first", () => {
  assert.match(poPage, /\.sort\(\(a, b\) => usagePercent\(b\) - usagePercent\(a\)/);
  assert.match(poPage, /key: "usage", header: "Usage", sortable: true, sortAccessor: usagePercent/);
});

test("PO alerts use the Urgent beeps Android channel; others keep koyal", () => {
  assert.match(sender, /PO_ALERTS_ANDROID_CHANNEL = \{ id: "transjit_po_alerts_v1", sound: "transjit_po_urgent_beeps" \}/);
  assert.match(sender, /DEFAULT_ANDROID_CHANNEL = \{ id: "transjit_erp_alerts_v1", sound: "transjit_koyal_notification" \}/);
  assert.match(sender, /deliverNativeAndroid\(admin, event, userIds, PO_ALERTS_ANDROID_CHANNEL\)/);
  assert.match(sender, /deliverNativeAndroid\(admin, group\[0\], userIds, androidChannelForRule\(ruleKey\)\)/);
  assert.match(sender, /channel: \{ id: string; sound: string \} = DEFAULT_ANDROID_CHANNEL/);
});

test("Android app creates the PO channel with the bundled sound (version 8)", () => {
  const activity = read("android/app/src/main/java/in/transjitexpresserp/mobile/MainActivity.java");
  const gradle = read("android/app/build.gradle");
  assert.match(activity, /PO_ALERTS_CHANNEL_ID = "transjit_po_alerts_v1"/);
  assert.match(activity, /R\.raw\.transjit_po_urgent_beeps/);
  assert.match(gradle, /versionCode 8\b/);
  assert.ok(readFileSync(new URL("../android/app/src/main/res/raw/transjit_po_urgent_beeps.wav", import.meta.url)).length > 1000);
});

test("DC created and POD created use Bubble pop; DC and POD updated keep koyal", () => {
  const activity = read("android/app/src/main/java/in/transjitexpresserp/mobile/MainActivity.java");
  assert.match(sender, /DC_CREATED_ANDROID_CHANNEL = \{ id: "transjit_dc_created_v1", sound: "transjit_dc_bubble_pop" \}/);
  assert.match(sender, /if \(ruleKey === "dc\.created"\) return DC_CREATED_ANDROID_CHANNEL;\s*if \(ruleKey === "pod\.created"\) return POD_CREATED_ANDROID_CHANNEL;\s*return DEFAULT_ANDROID_CHANNEL;/);
  assert.match(sender, /POD_CREATED_ANDROID_CHANNEL = \{ id: "transjit_pod_created_v1", sound: "transjit_dc_bubble_pop" \}/);
  assert.match(activity, /POD_CREATED_CHANNEL_ID = "transjit_pod_created_v1"/);
  assert.match(activity, /DC_CREATED_CHANNEL_ID = "transjit_dc_created_v1"/);
  assert.match(activity, /R\.raw\.transjit_dc_bubble_pop/);
  assert.ok(readFileSync(new URL("../android/app/src/main/res/raw/transjit_dc_bubble_pop.wav", import.meta.url)).length > 1000);
});
