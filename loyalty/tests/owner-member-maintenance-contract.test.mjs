import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDirectory)
  .filter(name => name.endsWith(".sql"))
  .sort()
  .map(name => `\n-- ${name}\n${readFileSync(new URL(name, migrationsDirectory), "utf8")}`)
  .join("\n");

function actionBlock(action) {
  const marker = `if (action === "${action}")`;
  const start = edge.indexOf(marker);
  assert.notEqual(start, -1, `${action} action must exist`);
  const next = edge.indexOf('\n    if (action === "', start + marker.length);
  return edge.slice(start, next === -1 ? edge.length : next);
}

function sqlFunctions() {
  const markers = [...migrations.matchAll(/create or replace function public\.(\w+)\s*\(/gi)];
  return markers.map((match, index) => ({
    name: match[1],
    body: migrations.slice(match.index, markers[index + 1]?.index ?? migrations.length),
  }));
}

function functionWith(...patterns) {
  const found = sqlFunctions().find(candidate => patterns.every(pattern => pattern.test(candidate.body)));
  assert.ok(found, `a SQL function must contain: ${patterns.map(pattern => pattern.source).join(", ")}`);
  return found;
}

function assertServiceRoleOnly(sqlFunction) {
  const escapedName = sqlFunction.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const signature = `${escapedName}\\([^;]+\\)`;
  assert.match(migrations, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated(?:, service_role)?;`, "i"));
  assert.match(migrations, new RegExp(`grant execute on function public\\.${signature} to service_role;`, "i"));
}

test("member search and scan-count correction stay behind owner authorization", () => {
  const ownerGate = edge.indexOf("const actor=await verifyOwner(request);");
  assert.notEqual(ownerGate, -1);

  for (const action of ["owner-member-search", "owner-set-scan-count"]) {
    assert.ok(edge.indexOf(`if (action === "${action}")`) > ownerGate, `${action} must run after verifyOwner`);
    assert.match(actionBlock(action), /p_actor\s*:\s*actor/);
  }

  const search = functionWith(/p_actor\s+uuid/i, /phone/i, /limit\s+20/i);
  const correction = functionWith(/p_actor\s+uuid/i, /p_target_count\s+(?:bigint|integer)/i, /p_reason\s+text/i);
  for (const sqlFunction of [search, correction]) {
    assert.match(sqlFunction.body, /public\.require_owner\(p_actor\)/i);
    assertServiceRoleOnly(sqlFunction);
  }
});

test("phone search requires four digits, normalizes UAE input, caps results, and returns full phone only to owners", () => {
  const searchAction = actionBlock("owner-member-search");
  const search = functionWith(/p_actor\s+uuid/i, /phone/i, /limit\s+20/i).body;

  assert.match(searchAction, /body\.phone/);
  assert.match(search, /'members'\s*,\s*v_members/i);
  assert.match(search, /'phone'\s*,\s*c\.phone_e164/i);
  assert.match(`${edge}\n${search}`, /replace\(\/\[?\^?\\d/i);
  assert.match(edge, /function normalizePhoneSearch[\s\S]{0,600}digits\.length\s*<\s*4/);
  for (const UAEForm of ["9710%", "05%", "5%"] ) assert.match(search, new RegExp(`'${UAEForm.replace("%", "\\%")}'`));
  assert.match(`${searchAction}\n${search}`, /(?:(?:char_)?length\([^)]*\)\s*<\s*4|(?:char_)?length\([^)]*\)\s+not\s+between\s+4)/i);
  assert.match(search, /from public\.customers[\s\S]*order by match_rank[\s\S]*limit\s+20/i);

  const publicActions = edge.slice(0, edge.indexOf("const actor=await verifyOwner(request);"));
  assert.doesNotMatch(publicActions, /phone(?:E164)?\s*:\s*row\.phone_e164/i);
});

test("scan-count correction is reasoned, nonnegative, append-only, and cannot change loyalty balances", () => {
  const correctionAction = actionBlock("owner-set-scan-count");
  const correction = functionWith(/p_actor\s+uuid/i, /p_target_count\s+(?:bigint|integer)/i, /p_reason\s+text/i).body;

  assert.match(correctionAction, /Number\(body\.targetCount\)/);
  assert.match(correctionAction, /Number\.is(?:Safe)?Integer\([^)]*targetCount[^)]*\)/);
  assert.match(correctionAction, /targetCount\s*<\s*0/);
  assert.match(correctionAction, /String\(body\.reason\s*\|\|\s*""\)\.trim\(\)/);
  assert.match(correctionAction, /reason\.length\s*<\s*[1-9]/);

  assert.match(correction, /(?:p_target_count\s*<\s*0|p_target_count\s+not\s+between\s+0)/i);
  assert.match(correction, /(?:btrim|trim)\(p_reason\)/i);
  assert.match(correction, /insert\s+into\s+public\.(?:scan_events|\w*(?:scan|correction)\w*)/i);
  assert.match(correction, /(?:correction_(?:add|remove)|scan_count_correct(?:ion|ed))/i);
  assert.match(correction, /reason/i);
  assert.match(correction, /lock table public\.scan_events in share row exclusive mode/i);
  assert.match(correction, /where c\.id\s*=\s*p_customer_id[\s\S]{0,80}for update/i);
  assert.doesNotMatch(correction, /delete\s+from/i);
  assert.doesNotMatch(correction, /(?:insert\s+into|update|delete\s+from)\s+public\.(?:loyalty_accounts|customer_loyalty)/i);
  assert.match(migrations, /delta bigint generated always as \(after_count - before_count\) stored/i);
  for (const auditField of ["recorded_scan_count", "before_count", "after_count", "reason", "actor_user_id", "actor_display_name", "branch_name", "occurred_at"]) {
    assert.match(migrations, new RegExp(`${auditField}\\s+[^,\\n]+not null`, "i"));
  }
  assert.match(migrations, /before update or delete or truncate on public\.scan_count_corrections/i);
  assert.match(migrations, /revoke all on table public\.scan_count_corrections from public, anon, authenticated, service_role;/i);

  const currentOwnerScan = sqlFunctions().filter(candidate => candidate.name === "owner_scan_v2").at(-1)?.body || "";
  assert.match(currentOwnerScan, /scan_count_corrections/i);
  assert.match(currentOwnerScan, /coalesce\(sum\(sc\.delta\),\s*0\)/i);
});

test("owner dashboard supports search, PIN reset, and confirmed scan-count correction", () => {
  assert.match(app, /owner-member-search/);
  assert.match(app, /owner-set-scan-count/);
  assert.match(app, /minlength="4"/);
  assert.match(app, /name="phone"/);
  assert.match(app, /member-search-reset/);
  assert.match(app, /if \(resetButton\) createResetCode\(resetButton\)/);
  assert.match(app, /memberCorrectionHistory\(member\.scanCorrections\)/);
  assert.match(app, /member-reset-help/);
  assert.match(app, /ownerMemberSearchState\.status !== "success"/);
  assert.match(app, /query\.length < 4[\s\S]{0,250}status: "idle"[\s\S]{0,150}renderMemberSearchResults\(\)/);
  assert.match(css, /correction-history summary[^}]*min-height:\s*44px/);
  assert.match(css, /summary::after[^}]*content:/);
  assert.match(css, /\[open\] summary::after/);
  assert.match(app, /name="targetCount"/);
  assert.match(app, /name="reason"/);
  assert.match(app, /name="targetCount"[^>]*min="0"|min="0"[^>]*name="targetCount"/);
  assert.match(app, /name="reason"[^>]*required|required[^>]*name="reason"/);

  const correctionCall = app.indexOf('callApi("owner-set-scan-count"');
  assert.notEqual(correctionCall, -1);
  const correctionFlow = app.slice(Math.max(0, correctionCall - 2500), correctionCall + 1000);
  const hasConfirmationDialog = /(?:window\.)?confirm\(/.test(correctionFlow);
  const hasRequiredConfirmationControl = /<input[^>]+type="checkbox"[^>]+required|<input[^>]+required[^>]+type="checkbox"/.test(correctionFlow);
  assert.ok(hasConfirmationDialog || hasRequiredConfirmationControl, "scan-count correction must require an explicit confirmation");
  assert.match(correctionFlow, /ownerAccessToken/);
  assert.match(correctionFlow, /customerId/);
  assert.match(correctionFlow, /targetCount/);
  assert.match(correctionFlow, /reason/);

  const searchCall = app.indexOf('callApi("owner-member-search"');
  assert.notEqual(searchCall, -1);
  assert.match(app.slice(searchCall, searchCall + 500), /ownerAccessToken/);

  for (const key of ["dashboard.searchTitle", "dashboard.searchMinimum", "dashboard.correctScans", "dashboard.correctionsTitle", "dashboard.correctionSafetyTitle", "dashboard.correctionReason", "dashboard.correctionConfirm"]) {
    assert.equal((i18n.match(new RegExp(`"${key.replace(".", "\\.")}"`, "g")) || []).length, 2, `${key} must have English and Arabic copy`);
  }
});
