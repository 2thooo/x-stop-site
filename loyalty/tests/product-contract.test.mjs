import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const configExample = readFileSync(new URL("../config.example.js", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260905151500_random_member_codes.sql", import.meta.url), "utf8");

function configuredVenues(source = config) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return JSON.parse(JSON.stringify(context.window.LOYALTY_CONFIG.bookingVenues));
}

function venueSlugsFor(activitySlug, source = config) {
  return configuredVenues(source)
    .filter(venue => venue.activitySlugs.includes(activitySlug))
    .map(venue => venue.slug);
}

test("customer registration does not request or send a join code", () => {
  assert.doesNotMatch(app, /join-code|inviteCode|create-invite/);
  assert.match(i18n, /Your unique member code is created automatically/);
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
  assert.match(i18n, /"common\.directions": "Directions"/);
  assert.match(app, /venueMapUrl/);
});

test("activity bookings follow the approved venue availability matrix", () => {
  assert.deepEqual(configuredVenues(configExample), configuredVenues());
  assert.deepEqual(venueSlugsFor("bowling"), ["x-entertainment", "master-bowling"]);
  assert.deepEqual(venueSlugsFor("laser-tag"), ["x-entertainment"]);
  assert.deepEqual(venueSlugsFor("escape-room"), ["x-entertainment"]);
  assert.deepEqual(venueSlugsFor("gaming"), ["x-entertainment"]);
  assert.deepEqual(venueSlugsFor("others"), ["x-entertainment"]);
  assert.deepEqual(venueSlugsFor("billiard"), ["x-entertainment", "expert-billiards"]);

  const venues = configuredVenues();
  const expert = venues.find(venue => venue.slug === "expert-billiards");
  assert.equal(expert.activitySlugs.some(slug => ["bowling", "escape-room", "laser-tag"].includes(slug)), false);
  assert.equal(venues.every(venue => venue.activities.length === venue.activitiesAr.length), true);
  assert.match(app, /function activityBookingVenues\(slug\)/);
  assert.match(app, /venues\.map\(venue => bookingLink/);
});

test("compact booking cards remain in a side-by-side mobile rail", () => {
  assert.match(styles, /grid-template-columns:\s*repeat\(3/);
  assert.match(styles, /grid-auto-flow:\s*column/);
  assert.match(styles, /scroll-snap-type:\s*x mandatory/);
  assert.match(styles, /\.venue-visual\s*\{[^}]*height:\s*118px/s);
});

test("English and Arabic can be toggled without changing routes", () => {
  assert.match(index, /id="language-toggle"/);
  assert.match(app, /x_loyalty_language|setLanguage\(/);
  assert.match(i18n, /جواز الأنشطة/);
  assert.match(styles, /html\[lang="ar"\]/);
  assert.match(styles, /font-family:\s*"Tajawal"/);
});

test("customer reward action only prepares an admin-confirmed scan", () => {
  assert.match(app, /id="request-redeem"/);
  assert.match(app, /member\.redeemHint/);
  assert.match(app, /owner-redeem-reward/);
  assert.doesNotMatch(app, /request-redeem[\s\S]{0,300}owner-redeem-reward/);
});
