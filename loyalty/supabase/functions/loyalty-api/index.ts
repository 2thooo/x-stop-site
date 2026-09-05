import QRCode from "npm:qrcode@1.5.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function internalApiKey() {
  const managedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (managedKeys) {
    try {
      const parsed = JSON.parse(managedKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch { /* Fall through to the legacy managed key. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const SERVICE_KEY = internalApiKey();
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "http://localhost:4173";
const SITE_BASE_PATH = (Deno.env.get("SITE_BASE_PATH") || "").replace(/\/$/, "");
const COUNTRY_CODE = Deno.env.get("DEFAULT_COUNTRY_CODE") || "971";
const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 12000;
const SCAN_TOKEN_MINUTES = 5;
const DEFAULT_RESET_MINUTES = 15;
const DEFAULT_ACTIVITY = "laser-tag";
const ACTIVITY_SLUGS = new Set(["laser-tag", "bowling", "escape-room", "billiard", "gaming", "others"]);
const DUMMY_PIN_SALT = "login-timing-equalizer-v1";

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  };
  if (origin === SITE_ORIGIN) headers["Access-Control-Allow-Origin"] = SITE_ORIGIN;
  return headers;
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });
}

function normalizePhone(input: unknown) {
  let value = String(input || "").trim().replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (COUNTRY_CODE === "971") {
    if (/^05\d{8}$/.test(value)) value=`+971${value.slice(1)}`;
    else if (/^5\d{8}$/.test(value)) value=`+971${value}`;
    else if (/^9715\d{8}$/.test(value)) value=`+${value}`;
    else if (/^(?:\+971)05\d{8}$/.test(value)) value=`+971${value.slice(-9)}`;
  }
  if (value.startsWith("0")) value = `+${COUNTRY_CODE}${value.slice(1)}`;
  if (!value.startsWith("+")) value = `+${value}`;
  if (/^\+9710/.test(value)) throw new Error("INVALID_INPUT");
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error("INVALID_INPUT");
  return value;
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32) { const out = new Uint8Array(bytes); crypto.getRandomValues(out); return base64url(out); }
async function sha256(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2,"0")).join(""); }

function opaqueCode(input: unknown) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) throw new Error("INVALID_INPUT");
  return value;
}

function activitySlug(input: unknown, useDefault = true) {
  const value = String(input || (useDefault ? DEFAULT_ACTIVITY : "")).trim().toLowerCase();
  if (!ACTIVITY_SLUGS.has(value)) throw new Error("ACTIVITY_INVALID");
  return value;
}

function boundedMinutes(input: unknown, fallback: number, maximum: number) {
  const value = input === undefined || input === null || input === "" ? fallback : Number(input);
  if (!Number.isInteger(value) || value < 2 || value > maximum) throw new Error("INVALID_INPUT");
  return value;
}

function boundedInteger(input: unknown, fallback: number, minimum: number, maximum: number) {
  const value=input===undefined || input===null || input==="" ? fallback : Number(input);
  if (!Number.isInteger(value) || value<minimum || value>maximum) throw new Error("INVALID_INPUT");
  return value;
}

function validUuid(input: unknown) {
  const value = String(input || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("INVALID_INPUT");
  return value;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("INVALID_JSON");
  const reader=request.body.getReader(); const chunks: Uint8Array[]=[]; let total=0;
  while (true) {
    const {done,value}=await reader.read(); if (done) break;
    total+=value.byteLength;
    if (total>MAX_BODY_BYTES) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(total); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  let parsed: unknown;
  try { parsed=JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("INVALID_JSON"); }
  if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
  return parsed as Record<string, unknown>;
}

async function pinHash(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 310000 }, key, 256);
  return base64url(new Uint8Array(bits));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0; for (let i=0; i<a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0;
}

async function rpc(name: string, body: Record<string, unknown>) {
  if (!SERVICE_KEY) throw new Error("BACKEND_NOT_CONFIGURED");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { "Content-Type":"application/json", "apikey":SERVICE_KEY }, body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "BACKEND_ERROR");
  return data;
}

function clientAddress(request: Request) {
  const forwarded=request.headers.get("x-forwarded-for")?.split(",").map(value=>value.trim()).filter(Boolean).at(-1);
  let value=forwarded || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
  value=value.replace(/^\[([0-9a-f:]+)\](?::\d{1,5})?$/i,"$1").replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/,"$1");
  return /^[0-9a-f:.]{3,64}$/i.test(value) ? value.toLowerCase() : "unknown";
}

async function enforcePbkdfBudget(request: Request) {
  const ipHash=await sha256(`pbkdf:ip:${clientAddress(request)}`);
  const allowed=await rpc("consume_pbkdf_budget",{p_identifier_hash:ipHash});
  if (allowed!==true) throw new Error("AUTH_BLOCKED");
}

async function enforceEnrollmentBudget(request: Request) {
  const ipHash=await sha256(`enroll:ip:${clientAddress(request)}`);
  const allowed=await rpc("consume_auth_budget",{p_identifier_hash:ipHash,p_limit:20,p_window_seconds:3600});
  if (allowed!==true) throw new Error("ENROLLMENT_BLOCKED");
}

async function verifyOwner(request: Request) {
  if (!SERVICE_KEY) throw new Error("BACKEND_NOT_CONFIGURED");
  const bearer = request.headers.get("Authorization") || "";
  if (!bearer.startsWith("Bearer ") || bearer === `Bearer ${SERVICE_KEY}`) throw new Error("OWNER_REQUIRED");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { "apikey": SERVICE_KEY, "Authorization": bearer } });
  if (!response.ok) throw new Error("OWNER_REQUIRED");
  const user = await response.json();
  await rpc("owner_check", { p_actor: user.id });
  return user.id as string;
}

function publicError(error: unknown) {
  const message = String((error as Error)?.message || "");
  if (message.includes("REQUEST_TOO_LARGE")) return ["Request too large.", 413] as const;
  if (message.includes("INVALID_JSON")) return ["Send a valid JSON object.", 400] as const;
  if (message.includes("ACCOUNT_EXISTS")) return ["An account already exists for that phone number.", 409] as const;
  if (message.includes("MEMBER_CODE_UNAVAILABLE")) return ["A unique member code could not be created. Please try again.", 503] as const;
  if (message.includes("ENROLLMENT_BLOCKED")) return ["Too many new accounts were created from this connection. Try again later.", 429] as const;
  if (message.includes("AUTH_BLOCKED")) return ["Too many attempts. Try again in 15 minutes.", 429] as const;
  if (message.includes("LOGIN_FAILED")) return ["Phone number or PIN is incorrect.", 401] as const;
  if (message.includes("OWNER_REQUIRED")) return ["Owner authorization is required.", 403] as const;
  if (message.includes("SCAN_COOLDOWN")) return ["This card was scanned moments ago. Please wait before scanning again.", 429] as const;
  if (message.includes("SCAN_TOKEN_REPLACED")) return ["This scan code was refreshed and is no longer active.", 409] as const;
  if (message.includes("SCAN_TOKEN_USED")) return ["This scan code has already been used.", 409] as const;
  if (message.includes("SCAN_TOKEN_EXPIRED")) return ["This scan code expired. Ask the customer to refresh their card.", 410] as const;
  if (message.includes("SCAN_TOKEN_INVALID")) return ["This scan code is invalid.", 404] as const;
  if (message.includes("QR_INVALID")) return ["This loyalty code is invalid or has been replaced.", 404] as const;
  if (message.includes("IDEMPOTENCY_CONFLICT")) return ["That request key was already used for another scan.", 409] as const;
  if (message.includes("SCAN_ALREADY_RESOLVED")) return ["This scan has already been confirmed or cancelled.", 409] as const;
  if (message.includes("REWARD_ALREADY_REDEEMED")) return ["A reward was already redeemed for this scan.", 409] as const;
  if (message.includes("NO_REWARD_AVAILABLE")) return ["This activity has no reward available to redeem.", 409] as const;
  if (message.includes("SESSION_INVALID")) return ["Your session expired. Sign in again.", 401] as const;
  if (message.includes("RESET_INVALID")) return ["This reset code is invalid, expired, or already used.", 400] as const;
  if (message.includes("CUSTOMER_NOT_FOUND")) return ["No active customer matched that reference.", 404] as const;
  if (message.includes("CUSTOMER_INACTIVE")) return ["This customer account is not active.", 409] as const;
  if (message.includes("SCAN_INVALID")) return ["This scan is invalid or no longer available.", 404] as const;
  if (message.includes("ACTIVITY_THRESHOLD_CONFLICT")) return ["Some members already have progress at or above that threshold. Choose a higher threshold.", 409] as const;
  if (message.includes("ACTIVITY_INVALID")) return ["Choose a valid loyalty activity.", 400] as const;
  if (message.includes("ACTIVITY_SETTINGS_CHANGED")) return ["This activity's reward settings changed. Scan the refreshed customer card again.", 409] as const;
  if (message.includes("INVALID_INPUT")) return ["Check the information and try again.", 400] as const;
  return ["The request could not be completed.", 500] as const;
}

Deno.serve(async request => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: origin === SITE_ORIGIN ? 204 : 403, headers: cors(origin) });
  if (request.method !== "POST" || !request.headers.get("content-type")?.includes("application/json")) return json({error:"Invalid request."},405,origin);
  if (origin && origin !== SITE_ORIGIN) return json({error:"Origin not allowed."},403,origin);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({error:"Request too large."},413,origin);

  try {
    const body = await readJsonBody(request);
    const action = String(body.action || "");

    if (action === "enroll") {
      if (body.consent !== true || !/^\d{6}$/.test(String(body.pin || "")) || !String(body.displayName || "").trim() || String(body.displayName).length > 60) throw new Error("INVALID_INPUT");
      const phone = normalizePhone(body.phone); const pin = String(body.pin); const salt = randomToken(18);
      await enforceEnrollmentBudget(request);
      await enforcePbkdfBudget(request);
      const qrToken = randomToken(); const sessionToken = randomToken();
      const result = await rpc("enroll_customer_open", { p_phone:phone, p_display_name:String(body.displayName).trim(), p_pin_salt:salt, p_pin_hash:await pinHash(pin,salt), p_qr_hash:await sha256(qrToken), p_session_hash:await sha256(sessionToken), p_session_expiry:new Date(Date.now()+SESSION_DAYS*86400000).toISOString() });
      return json({ sessionToken, qrToken, memberCode: result[0].member_code },201,origin);
    }

    if (action === "customer-login") {
      const phone=normalizePhone(body.phone); const pin=String(body.pin || ""); if (!/^\d{6}$/.test(pin)) throw new Error("INVALID_INPUT");
      await enforcePbkdfBudget(request);
      const identifierHash=await sha256(`login:${phone}`); const allowed=await rpc("consume_auth_attempt",{p_identifier_hash:identifierHash}); if (allowed !== true) throw new Error("AUTH_BLOCKED");
      const records=await rpc("get_customer_auth_record",{p_phone:phone}); const customer=records?.[0];
      const candidateHash=await pinHash(pin,customer?.pin_salt || DUMMY_PIN_SALT);
      if (!customer || customer.status !== "active" || !safeEqual(candidateHash,customer.pin_hash)) throw new Error("LOGIN_FAILED");
      const qrToken=randomToken(); const sessionToken=randomToken();
      await rpc("rotate_customer_access_for_login",{p_customer_id:customer.customer_id,p_expected_pin_hash:customer.pin_hash,p_qr_hash:await sha256(qrToken),p_session_hash:await sha256(sessionToken),p_session_expiry:new Date(Date.now()+SESSION_DAYS*86400000).toISOString(),p_identifier_hash:identifierHash});
      return json({sessionToken,qrToken},200,origin);
    }

    if (action === "recover-pin") {
      const phone=normalizePhone(body.phone); const resetCode=opaqueCode(body.resetCode);
      const newPin=String(body.newPin || ""); if (!/^\d{6}$/.test(newPin)) throw new Error("INVALID_INPUT");
      await enforcePbkdfBudget(request);
      const identifierHash=await sha256(`recover:${phone}`);
      const allowed=await rpc("consume_auth_attempt",{p_identifier_hash:identifierHash}); if (allowed !== true) throw new Error("AUTH_BLOCKED");
      const salt=randomToken(18); const qrToken=randomToken(); const sessionToken=randomToken();
      const result=await rpc("recover_customer_pin",{
        p_phone:phone,p_code_hash:await sha256(resetCode),p_pin_salt:salt,p_pin_hash:await pinHash(newPin,salt),
        p_qr_hash:await sha256(qrToken),p_session_hash:await sha256(sessionToken),
        p_session_expiry:new Date(Date.now()+SESSION_DAYS*86400000).toISOString(),
        p_recovery_identifier_hash:identifierHash,p_login_identifier_hash:await sha256(`login:${phone}`)
      });
      return json({sessionToken,qrToken,memberCode:result[0].member_code},200,origin);
    }

    if (action === "member-summary") {
      if (!body.sessionToken || !body.qrToken) throw new Error("SESSION_INVALID");
      const selectedActivity=activitySlug(body.activitySlug); const scanToken=randomToken();
      const scanTokenExpiresAt=new Date(Date.now()+SCAN_TOKEN_MINUTES*60000).toISOString();
      const result=await rpc("member_summary_v2",{
        p_session_hash:await sha256(String(body.sessionToken)),p_qr_hash:await sha256(String(body.qrToken)),
        p_activity_slug:selectedActivity,p_scan_token_hash:await sha256(scanToken),p_scan_token_expiry:scanTokenExpiresAt
      }); const row=result[0];
      const payload=`${SITE_ORIGIN}${SITE_BASE_PATH}/#/scan/${scanToken}`;
      const qrSvg=await QRCode.toString(payload,{type:"svg",errorCorrectionLevel:"M",margin:2,color:{dark:"#650FFD",light:"#ffffff"}});
      return json({
        displayName:row.display_name,memberCode:row.member_code,
        selectedActivity:{slug:row.activity_slug,name:row.activity_name,settingsVersion:row.activity_settings_version},activityBalances:row.activity_balances,
        points:row.points,rewardsAvailable:row.rewards_available,lastScannedAt:row.last_scanned_at,
        pointsPerVisit:row.points_per_visit,rewardThreshold:row.reward_threshold,
        rewardText:row.reward_text,rewardTextAr:row.reward_text_ar,
        scanTokenExpiresAt:row.scan_token_expires_at,qrSvg
      },200,origin);
    }

    const actor=await verifyOwner(request);
    if (action === "owner-check") return json({ok:true},200,origin);
    if (action === "owner-dashboard") {
      const customerLimit=boundedInteger(body.customerLimit,250,1,500);
      const customerOffset=boundedInteger(body.customerOffset,0,0,1000000);
      return json(await rpc("owner_dashboard",{p_actor:actor,p_customer_limit:customerLimit,p_customer_offset:customerOffset}),200,origin);
    }
    if (action === "owner-update-activity-settings") {
      const selectedActivity=activitySlug(body.activitySlug,false);
      const pointsPerVisit=Number(body.pointsPerVisit); const rewardThreshold=Number(body.rewardThreshold);
      const rewardText=String(body.rewardText || "").trim();
      const rewardTextAr=String(body.rewardTextAr || "").trim();
      if (!Number.isInteger(pointsPerVisit) || pointsPerVisit<1 || pointsPerVisit>20 || !Number.isInteger(rewardThreshold) || rewardThreshold<2 || rewardThreshold>1000 || !rewardText || rewardText.length>200 || !rewardTextAr || rewardTextAr.length>200 || !/[ء-ي]/.test(rewardTextAr)) throw new Error("INVALID_INPUT");
      const result=await rpc("owner_update_activity_settings_v2",{p_actor:actor,p_activity_slug:selectedActivity,p_points_per_visit:pointsPerVisit,p_reward_threshold:rewardThreshold,p_reward_text:rewardText,p_reward_text_ar:rewardTextAr}); const row=result[0];
      return json({activity:{slug:row.activity_slug,name:row.activity_name},pointsPerVisit:row.points_per_visit,rewardThreshold:row.reward_threshold,rewardText:row.reward_text,rewardTextAr:row.reward_text_ar,settingsVersion:row.settings_version},200,origin);
    }
    if (action === "owner-create-pin-reset") {
      const customerId=body.customerId ? validUuid(body.customerId) : null;
      const phone=body.phone ? normalizePhone(body.phone) : null;
      if (!customerId && !phone) throw new Error("INVALID_INPUT");
      const minutes=boundedMinutes(body.expiresInMinutes,DEFAULT_RESET_MINUTES,60);
      const resetCode=randomToken(24); const expiresAt=new Date(Date.now()+minutes*60000).toISOString();
      const resetPayload=`${SITE_ORIGIN}${SITE_BASE_PATH}/#/recover/${resetCode}`;
      const resetQrSvg=await QRCode.toString(resetPayload,{type:"svg",errorCorrectionLevel:"M",margin:2,color:{dark:"#650FFD",light:"#ffffff"}});
      const result=await rpc("owner_create_pin_reset",{p_actor:actor,p_customer_id:customerId,p_phone:phone,p_code_hash:await sha256(resetCode),p_expires_at:expiresAt}); const row=result[0];
      return json({customerId:row.customer_id,memberCode:row.member_code,displayName:row.display_name,resetCode,resetQrSvg,expiresAt:row.expires_at},201,origin);
    }
    if (action === "owner-scan") {
      const scanToken=opaqueCode(body.scanToken || body.qrToken);
      const result=await rpc("owner_scan_v2",{p_actor:actor,p_scan_token_hash:await sha256(scanToken)}); const row=result[0];
      return json({scanEventId:row.scan_event_id,customerId:row.customer_id,displayName:row.display_name,activity:{slug:row.activity_slug,name:row.activity_name,settingsVersion:row.activity_settings_version},points:row.points,rewardsAvailable:row.rewards_available,scanCount:Number(row.scan_count),previousScanAt:row.previous_scan_at,pointsPerVisit:row.points_per_visit,rewardThreshold:row.reward_threshold,rewardText:row.reward_text,rewardTextAr:row.reward_text_ar},200,origin);
    }
    if (action === "owner-add-visit-point") {
      const result=await rpc("owner_add_visit_point",{p_actor:actor,p_scan_event_id:validUuid(body.scanEventId),p_idempotency_key:validUuid(body.idempotencyKey)}); const row=result[0];
      return json({transactionId:row.transaction_id,activity:{slug:row.activity_slug,name:row.activity_name},points:row.points,rewardsAvailable:row.rewards_available},200,origin);
    }
    if (action === "owner-redeem-reward") {
      const result=await rpc("owner_redeem_reward",{p_actor:actor,p_scan_event_id:validUuid(body.scanEventId),p_idempotency_key:validUuid(body.idempotencyKey)}); const row=result[0];
      return json({transactionId:row.transaction_id,activity:{slug:row.activity_slug,name:row.activity_name},points:row.points,rewardsAvailable:row.rewards_available},200,origin);
    }
    if (action === "owner-cancel-scan") { await rpc("owner_cancel_scan",{p_actor:actor,p_scan_event_id:validUuid(body.scanEventId)}); return json({ok:true},200,origin); }
    throw new Error("INVALID_INPUT");
  } catch (error) { const [message,status]=publicError(error); return json({error:message},status,origin); }
});
