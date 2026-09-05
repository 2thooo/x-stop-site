import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260905151500_random_member_codes.sql", import.meta.url), "utf8");

test("customer registration does not request or send a join code", () => {
  assert.doesNotMatch(app, /join-code|inviteCode|create-invite/);
  assert.match(app, /Your unique member code is created automatically/);
  assert.doesNotMatch(edge, /owner-create-enrollment-invite|p_invite_hash/);
});

test("member codes are random, non-enumerable and collision guarded", () => {
  assert.match(migration, /gen_random_bytes\(8\)/);
  assert.match(migration, /v_attempt >= 5/);
  assert.match(migration, /unique_violation/);
  assert.match(edge, /enroll_customer_open/);
});

test("booking exposes three verified Google Maps destinations", () => {
  assert.equal((config.match(/https:\/\/www\.google\.com\/maps\?cid=/g) || []).length, 3);
  assert.match(app, />Directions<\/a>/);
  assert.match(app, /venueMapUrl/);
});

test("compact booking cards remain in a side-by-side mobile rail", () => {
  assert.match(styles, /grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /grid-auto-flow:\s*column/);
  assert.match(styles, /scroll-snap-type:\s*x mandatory/);
  assert.match(styles, /\.venue-visual\s*\{[^}]*height:\s*118px/s);
});
