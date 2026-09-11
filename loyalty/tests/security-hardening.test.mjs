import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/loyalty-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260905215000_session_scan_token_hardening.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");

test("customer bearer credentials migrate out of persistent localStorage", () => {
  assert.match(app, /window\.sessionStorage\.getItem\(key\)/);
  assert.match(app, /migrateLegacyCustomerCredentials\(\)/);
  assert.match(app, /window\.localStorage\.removeItem\(key\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\((?:customerKey|qrKey)/);
  assert.match(app, /callApi\("customer-logout"/);
});

test("staff access locks on public navigation, inactivity, backgrounding, and page exit", () => {
  assert.match(app, /if \(!privilegedRoutes\.has\(route\)[^\n]+clearOwnerAccess\(\)/);
  assert.match(app, /ownerIdleLimitMs = 10 \* 60 \* 1000/);
  assert.match(app, /ownerBackgroundLimitMs = 60 \* 1000/);
  assert.match(app, /addEventListener\("pagehide",[\s\S]{0,250}clearOwnerAccess\(\)/);
  assert.match(app, /ownerMemberSearchState = \{ query: "", members: null, status: "idle" \}/);
});

test("customer sign-out and unknown routes render immediately", () => {
  assert.match(app, /clearCustomerAccess\(true\);\s*navigateTo\("passport"\)/);
  assert.match(app, /if \(!views\[route\]\) \{ history\.replaceState\([^}]+return render\(\); \}/);
  assert.match(app, /const toggleButton = event\.currentTarget/);
  assert.match(app, /requestAnimationFrame\(\(\) => toggleButton\.focus\(\)\)/);
});

test("camera startup is single-flight and every late stream is stopped", () => {
  assert.match(app, /if \(!video \|\| scannerStarting \|\| scannerStream\) return/);
  assert.match(app, /const attempt = \+\+scannerGeneration/);
  assert.match(app, /attempt !== scannerGeneration \|\| !video\.isConnected[\s\S]{0,120}stream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(app, /if \(scannerDetectionInFlight \|\| attempt !== scannerGeneration\) return/);
  assert.match(app, /catch \{\s*stopScanner\(\);\s*showToast\(t\("scanner\.cameraUnavailable"\)\)/);
  assert.match(app, /video\.pause\(\);\s*video\.srcObject = null/);
  assert.match(app, /async function lookupCode\(raw\)[\s\S]{0,180}stopScanner\(\)/);
});

test("service worker only owns its caches and only caches allowlisted shell files", () => {
  assert.match(worker, /CACHE_PREFIX = "x-group-passport-"/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE/);
  assert.match(worker, /SHELL_PATHS\.has\(url\.pathname\)/);
  assert.match(worker, /response\.ok && response\.type === "basic"/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request/);
});

test("Edge API validates media type and action before owner verification", () => {
  assert.match(edge, /mediaType !== "application\/json"[^\n]+415/);
  assert.match(edge, /void reader\.cancel\(\)\.catch/);
  assert.doesNotMatch(edge, /await reader\.cancel\(\)/);
  const allowlist = edge.indexOf("if (!PUBLIC_ACTIONS.has(action) && !OWNER_ACTIONS.has(action))");
  const ownerGate = edge.indexOf("const actor=await verifyOwner(request);");
  assert.ok(allowlist > 0 && allowlist < ownerGate);
  assert.match(edge, /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
  for (const header of ["Referrer-Policy", "Permissions-Policy", "Content-Security-Policy", "X-Content-Type-Options", "Cache-Control"]) assert.match(edge, new RegExp(`"${header}"`));
});

test("passport refresh is throttled and rotates a bounded token row", () => {
  assert.match(edge, /enforceMemberSummaryBudget\(request,sessionToken\)/);
  assert.match(edge, /p_limit:120,p_window_seconds:60/);
  assert.match(edge, /p_limit:30,p_window_seconds:60/);
  assert.match(edge, /rateLimitHash[\s\S]{0,500}HMAC/);
  assert.match(edge, /rpc\("member_summary_v3"/);
  assert.match(migration, /set token_hash=p_scan_token_hash/);
  assert.match(migration, /not exists\(select 1 from public\.scan_events e where e\.scan_token_id=old\.id\)/);
  assert.match(migration, /limit 250/);
});

test("owner member search has a keyed server-side request budget", () => {
  assert.match(edge, /owner-search:\$\{actor\}:\$\{clientAddress\(request\)\}/);
  assert.match(edge, /p_limit:60,p_window_seconds:60/);
  assert.match(edge, /owner-member-search"\) \{\s*await enforceOwnerSearchBudget\(request,actor\)/);
  assert.match(edge, /OWNER_SEARCH_BLOCKED[^\n]+Too many member searches/);
});

test("customer sessions are short-lived, idle-bound, and server-revocable", () => {
  assert.match(edge, /const SESSION_HOURS = 24/);
  assert.match(edge, /SESSION_HOURS\*3600000/g);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /create or replace function public\.logout_customer/);
  assert.match(migration, /update public\.customer_sessions s set revoked_at=now\(\)/);
  assert.match(migration, /update public\.qr_credentials q set status='revoked'/);
  assert.match(migration, /update public\.scan_tokens t set revoked_at=now\(\)/);
});

test("untrusted QR SVG is rendered as an inert image, not live HTML", () => {
  assert.match(app, /function svgImageMarkup/);
  assert.match(app, /data:image\/svg\+xml;base64/);
  assert.match(app, /svgImageMarkup\(data\.qrSvg/);
  assert.match(app, /svgImageMarkup\(data\.resetQrSvg/);
  assert.doesNotMatch(app, /\$\{data\.(?:qrSvg|resetQrSvg) \|\| ""\}/);
});

test("browser requests omit credentials, redirects, referrers, and caches", () => {
  assert.match(api, /cache: "no-store"/);
  assert.match(api, /credentials: "omit"/);
  assert.match(api, /redirect: "error"/);
  assert.match(api, /referrerPolicy: "no-referrer"/);
  assert.match(api, /controller\.abort\(\)/);
  assert.match(api, /\^\[a-z0-9\]\{20\}\\\.supabase\\\.co\$/);
});

test("CSP pins the production project and GitHub Actions are commit-pinned", () => {
  assert.match(index, /connect-src 'self' https:\/\/cfaxlqlbjyffmkxvddhy\.supabase\.co/);
  assert.doesNotMatch(index, /https:\/\/\*\.supabase\.co/);
  for (const directive of ["font-src 'self'", "script-src-attr 'none'", "style-src-attr 'none'", "frame-src 'none'", "base-uri 'none'"]) assert.match(index, new RegExp(directive));
  for (const workflow of [ci, deploy]) {
    for (const line of workflow.split(/\r?\n/).filter(value => value.includes("uses: actions/"))) {
      assert.match(line, /uses: actions\/[a-z-]+@[0-9a-f]{40}(?:\s+#\s+v\d+)?$/);
    }
  }
});

test("enrollment hides account existence and rejects unsafe names or weak new PINs", () => {
  assert.match(edge, /normalizeDisplayName/);
  assert.match(edge, /\[\\p\{Cc\}\\p\{Cf\}<>&\]/);
  assert.match(edge, /validNewPin\(body\.pin\)/);
  assert.match(edge, /validNewPin\(body\.newPin\)/);
  assert.match(edge, /ACCOUNT_EXISTS[^\n]+Check the information or sign in/);
  assert.doesNotMatch(edge, /An account already exists for that phone number/);
});
