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

test("wallet information is not displayed in the customer interface", () => {
  assert.doesNotMatch(app, /home\.noWallet|Apple Wallet|Samsung Wallet|Add to Wallet/i);
  assert.doesNotMatch(i18n, /home\.noWallet|Apple Wallet|Samsung Wallet|Add to Wallet/i);
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
  assert.deepEqual(venueSlugsFor("billiard"), ["x-entertainment", "master-bowling", "expert-billiards"]);

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

test("passport keeps the activity QR branded, compact and scan-safe", () => {
  const memberStart = app.indexOf("async function memberView");
  const memberEnd = app.indexOf("function ownerView", memberStart);
  const member = app.slice(memberStart, memberEnd);

  assert.doesNotMatch(member, /location-chip/);
  assert.match(member, /passport-booking-link/);
  assert.match(member, /activity-theme-\$\{selected\.slug\}/);
  assert.match(member, /class="qr-brand-logo"[^>]*src="assets\/x-group-logo\.jpg"/);
  assert.match(member, /class="qr-brand-activity"/);
  assert.match(member, /class="qr-wrap">\$\{data\.qrSvg \|\| ""\}<\/div>/);
  assert.match(styles, /\.qr-wrap\s*\{[^}]*background:\s*white/s);
  assert.match(styles, /\.activity-theme-billiard\s*\{/);
  assert.match(styles, /\.passport-booking-link\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /@media \(max-width:\s*900px\)[\s\S]*\.member-grid \.qr-panel\s*\{\s*order:\s*-1;/);
  assert.doesNotMatch(styles, /\.member-card\s*\{[^}]*min-height:\s*430px/s);
  assert.match(edge, /const ACTIVITY_QR_COLORS:[\s\S]*"billiard": "#0D6B4C"/);
  assert.match(edge, /QRCode\.toString\(payload,[^\n]*errorCorrectionLevel:"M",margin:4[^\n]*ACTIVITY_QR_COLORS\[selectedActivity\]/);

  const colorBlock = edge.match(/const ACTIVITY_QR_COLORS:[\s\S]*?\n};/)?.[0] || "";
  const colors = [...colorBlock.matchAll(/#[0-9A-F]{6}/g)].map(match => match[0]);
  assert.equal(colors.length, 6);
  for (const color of colors) {
    const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    const contrastAgainstWhite = 1.05 / (luminance + .05);
    assert.ok(contrastAgainstWhite >= 4.5, `${color} must retain strong contrast against the white QR background`);
  }
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
