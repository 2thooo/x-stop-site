import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260905160000_bilingual_reward_text.sql", import.meta.url),
  "utf8",
);
const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");

function sqlFunction(name) {
  const marker = `create or replace function public.${name}(`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be defined in the bilingual migration`);
  const next = migration.indexOf("\ncreate or replace function public.", start + marker.length);
  return migration.slice(start, next === -1 ? migration.length : next);
}

test("Arabic reward text is required, bounded and backfilled for every activity", () => {
  assert.match(migration, /add column reward_text_ar text;/);
  assert.match(migration, /alter column reward_text_ar set not null/);
  assert.match(migration, /char_length\(btrim\(reward_text_ar\)\) between 1 and 200/);
  assert.match(migration, /reward_text_ar ~ '\[ء-ي\]'/);

  for (const slug of ["laser-tag", "bowling", "escape-room", "billiard", "gaming", "others"]) {
    assert.match(migration, new RegExp(`when '${slug}' then '[^']*[\\u0600-\\u06ff][^']*'`));
  }
});

test("member summary v2 returns both reward languages at the top level and in balances", () => {
  const member = sqlFunction("member_summary_v2");
  assert.match(member, /reward_text text, reward_text_ar text/);
  assert.match(member, /'rewardText', a\.reward_text, 'rewardTextAr', a\.reward_text_ar/);
  assert.match(member, /v_activity\.reward_text,\s*v_activity\.reward_text_ar, v_balances/);

  assert.match(edge, /rpc\("member_summary_v2",/);
  assert.match(edge, /rewardText:row\.reward_text,rewardTextAr:row\.reward_text_ar/);
  assert.doesNotMatch(edge, /rpc\("member_summary",/);
});

test("owner settings require and atomically update both reward messages", () => {
  const settings = sqlFunction("owner_update_activity_settings_v2");
  assert.match(settings, /p_reward_text text, p_reward_text_ar text/);
  assert.match(settings, /length\(trim\(p_reward_text_ar\)\) not between 1 and 200/);
  assert.match(settings, /reward_text=trim\(p_reward_text\), reward_text_ar=trim\(p_reward_text_ar\)/);
  assert.equal((settings.match(/settings_version=a\.settings_version\+1/g) || []).length, 1);

  assert.match(edge, /const rewardTextAr=String\(body\.rewardTextAr \|\| ""\)\.trim\(\);/);
  assert.match(edge, /!rewardTextAr \|\| rewardTextAr\.length>200/);
  assert.match(edge, /rpc\("owner_update_activity_settings_v2",/);
  assert.match(edge, /p_reward_text_ar:rewardTextAr/);
  assert.match(edge, /rewardTextAr:row\.reward_text_ar,settingsVersion/);
  assert.match(edge, /!\/\[ء-ي\]\/\.test\(rewardTextAr\)/);
  assert.doesNotMatch(edge, /rpc\("owner_update_activity_settings",/);
  assert.match(migration, /revoke execute on function public\.owner_update_activity_settings\(uuid,text,integer,integer,text\) from service_role;/);
});

test("owner scan v2 and dashboard expose Arabic reward text", () => {
  const scan = sqlFunction("owner_scan_v2");
  const dashboard = sqlFunction("owner_dashboard");
  assert.match(scan, /reward_text text, reward_text_ar text/);
  assert.match(scan, /v_activity\.reward_text, v_activity\.reward_text_ar, v_activity\.settings_version/);
  assert.equal((dashboard.match(/'rewardTextAr',a\.reward_text_ar/g) || []).length, 2);

  assert.match(edge, /rpc\("owner_scan_v2",/);
  assert.match(edge, /rewardTextAr:row\.reward_text_ar/);
  assert.doesNotMatch(edge, /rpc\("owner_scan",/);
});

test("new RPCs are executable only by the service role", () => {
  for (const signature of [
    "member_summary_v2\\(text,text,text,text,timestamptz\\)",
    "owner_update_activity_settings_v2\\(uuid,text,integer,integer,text,text\\)",
    "owner_scan_v2\\(uuid,text\\)",
    "owner_dashboard\\(uuid,integer,integer\\)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role;`));
  }
});
