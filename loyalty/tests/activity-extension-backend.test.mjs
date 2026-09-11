import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20260911110000_add_vr_car_activities.sql", import.meta.url),
  "utf8",
);

function contrastAgainstWhite(hex) {
  const channels = hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return 1.05 / (luminance + 0.05);
}

test("Edge API accepts VR and Car and gives each a scan-safe QR color", () => {
  const slugSet = edge.match(/const ACTIVITY_SLUGS = new Set\(\[([^\]]+)\]\)/)?.[1] || "";
  const palette = edge.match(/const ACTIVITY_QR_COLORS:[\s\S]*?\n};/)?.[0] || "";

  for (const slug of ["vr", "car"]) {
    assert.match(slugSet, new RegExp(`"${slug}"`));
    const color = palette.match(new RegExp(`"${slug}": "(#[0-9A-F]{6})"`))?.[1];
    assert.ok(color, `${slug} needs a QR palette color`);
    assert.ok(contrastAgainstWhite(color) >= 4.5, `${slug} QR color must contrast strongly with white`);
  }
});

test("activity migration adds bilingual VR and Car definitions in positions 7 and 8", () => {
  assert.match(migration, /'vr',\s*'VR',\s*7,\s*1,\s*10,\s*'10 VR visits unlock a reward',\s*'[^']*[ء-ي][^']*'/s);
  assert.match(migration, /'car',\s*'Car',\s*8,\s*1,\s*10,\s*'10 Car visits unlock a reward',\s*'[^']*[ء-ي][^']*'/s);
});

test("activity migration provisions only missing ledgers and leaves balances untouched", () => {
  assert.match(migration, /insert into public\.loyalty_accounts\(customer_id, activity_id\)/);
  assert.match(migration, /cross join public\.loyalty_activities a/);
  assert.match(migration, /where a\.slug in \('vr', 'car'\)/);
  assert.match(migration, /on conflict \(customer_id, activity_id\) do nothing;/);
  assert.doesNotMatch(migration, /update public\.loyalty_accounts/i);
});

test("activity migration adds the scan-token audit lookup index", () => {
  assert.match(migration, /create index if not exists scan_events_scan_token_fk_idx\s+on public\.scan_events\(scan_token_id\)\s+where scan_token_id is not null;/s);
});
