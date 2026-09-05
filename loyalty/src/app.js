import { normalizePhone, validatePin, escapeHtml, formatDubaiTime, randomIdempotencyKey, parseQrPayload } from "./core.js";
import { callApi, ownerLogin, isConfigured } from "./api.js";

const config = window.LOYALTY_CONFIG;
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const customerKey = "x_loyalty_customer_session";
const qrKey = "x_loyalty_qr_credential";
const lastActivityKey = "x_loyalty_last_activity";
const activities = Object.freeze([
  { slug: "laser-tag", name: "Laser Tag", icon: "assets/activity-icons/laser-tag.svg", line: "Aim. Tag. Score.", venueSlug: "x-entertainment" },
  { slug: "bowling", name: "Bowling", icon: "assets/activity-icons/bowling.svg", line: "Roll toward rewards.", venueSlug: "master-bowling" },
  { slug: "escape-room", name: "Escape Room", icon: "assets/activity-icons/escape-room.svg", line: "Solve it together.", venueSlug: "x-entertainment" },
  { slug: "billiard", name: "Billiard", icon: "assets/activity-icons/billiard.svg", line: "Every frame counts.", venueSlug: "expert-billiards" },
  { slug: "gaming", name: "PC & PlayStation", icon: "assets/activity-icons/gaming.svg", line: "Level up every session.", venueSlug: "x-entertainment" },
  { slug: "others", name: "Others", icon: "assets/activity-icons/others.svg", line: "More ways to play.", venueSlug: "x-entertainment" }
]);
const bookingVenues = Object.freeze(Array.isArray(config.bookingVenues) ? config.bookingVenues : []);

let installPrompt = null;
let scannerStream = null;
let scannerTimer = null;
let scanLookupInFlight = false;
let renderGeneration = 0;
let ownerAccessToken = null;
let pendingScanToken = "";

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

document.title = `${config.business.groupName || config.business.shortName} Activity Passport`;
document.querySelectorAll("[data-business-name]").forEach(element => { element.textContent = config.business.name; });
const addressElement = document.querySelector("[data-business-address]");
if (addressElement) addressElement.textContent = config.business.address;
const phoneElement = document.querySelector("[data-business-phone]");
if (phoneElement) {
  phoneElement.textContent = config.business.phone;
  phoneElement.href = `tel:${config.business.phone.replace(/[^+\d]/g, "")}`;
}

window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; });
window.addEventListener("hashchange", render);
document.querySelector(".skip-link")?.addEventListener("click", event => {
  event.preventDefault();
  app.focus({ preventScroll: true });
  app.scrollIntoView({ block: "start" });
});
document.addEventListener("click", event => {
  const route = event.target.closest("[data-route]")?.dataset.route;
  if (route) {
    const nextHash = `#/${route}`;
    if (location.hash === nextHash) render();
    else location.hash = nextHash;
  }
});
if ("serviceWorker" in navigator) {
  const localPreview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const workerUrl = localPreview ? "./sw.js" : `${config.basePath || ""}/sw.js`;
  navigator.serviceWorker.register(workerUrl).catch(() => {});
}

function activityMeta(slug) { return activities.find(activity => activity.slug === slug) || activities[0]; }
function bookingVenue(slug) { return bookingVenues.find(venue => venue.slug === slug) || null; }
function whatsappUrl(venue, activityName = "") {
  const digits = String(venue?.whatsapp || "");
  if (!/^9715\d{8}$/.test(digits)) return "";
  const url = new URL(`https://wa.me/${digits}`);
  const message = activityName
    ? `I want to book ${activityName} at ${venue.name}. Please share the available times.`
    : `I want to book an experience at ${venue.name}. Please share the available times.`;
  url.searchParams.set("text", message);
  return url.toString();
}
function bookingLink(venue, label, activityName = "", className = "button whatsapp") {
  const href = whatsappUrl(venue, activityName);
  if (!href) return "";
  const accessible = `${label} on WhatsApp (opens in a new tab)`;
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(accessible)}"><span class="chat-mark" aria-hidden="true">↗</span>${escapeHtml(label)}</a>`;
}
function safeNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function eventChange(event) {
  const rewardDelta = safeNumber(event.rewardDelta);
  if (rewardDelta) return `${rewardDelta > 0 ? "+" : ""}${rewardDelta} reward`;
  const pointDelta = safeNumber(event.pointDelta);
  return pointDelta ? `${pointDelta > 0 ? "+" : ""}${pointDelta} point${Math.abs(pointDelta) === 1 ? "" : "s"}` : "—";
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3600);
}
function setFormBusy(form, busy) {
  form.setAttribute("aria-busy", String(busy));
  form.querySelectorAll("button[type=submit]").forEach(button => { button.disabled = busy; });
}
function settleViewPosition() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    app.focus({ preventScroll: true });
  });
}
function configurationNotice() {
  return isConfigured() ? "" : `<div class="notice">Design preview only. Add the Supabase project URL and public publishable key in <strong>config.js</strong> to activate secure membership and scanning.</div>`;
}

function homeView() {
  const stamps = Array.from({ length: 10 }, (_, index) => `<span class="stamp ${index < 4 ? "earned" : ""}">${index < 4 ? "X" : index + 1}</span>`).join("");
  const activityTiles = activities.map(activity => `<article class="activity-tile"><img src="${activity.icon}" alt="" width="52" height="52" /><strong>${activity.name}</strong><span>${activity.line}</span></article>`).join("");
  return `<section class="hero">
    <div class="hero-copy"><p class="eyebrow">X Group · Activity Passport</p><h1>Play. Score.<span class="headline-accent">Repeat.</span></h1><p class="lead">One passport for six ways to play. Earn a separate balance for Laser Tag, Bowling, Escape Room, Billiard, PC & PlayStation, and more.</p><div class="actions"><button class="button primary" data-route="join">Get my passport</button><button class="button secondary" data-route="passport">Open my passport</button><button class="button secondary" data-route="book">Book an experience</button></div><div class="hero-meta"><span class="meta-chip">Installs on your home screen</span><span class="meta-chip">No native wallet required</span><span class="meta-chip">Private one-time scan codes</span></div></div>
    <div class="wallet-preview" aria-label="Laser Tag loyalty passport preview"><div class="preview-orbit" aria-hidden="true"></div><div class="passport-stack"><div class="passport-shadow-card" aria-hidden="true"></div><article class="passport-card"><div class="passport-top"><img class="passport-logo" src="assets/x-group-logo.jpg" alt="X Group" width="100" height="102" /><span class="location-chip">RAK Mall</span></div><div class="passport-body"><span class="passport-label">Activity passport</span><h3>Laser Tag</h3><div class="passport-points"><strong>4</strong><span>of 10 points</span></div></div><div class="stamp-grid" aria-label="Four of ten example stamps earned">${stamps}</div><div class="passport-foot"><span>Member · X-0001</span><span>Your play, rewarded.</span></div></article></div></div>
  </section><section class="activity-showcase"><div class="section-intro"><p class="eyebrow">Six ways to earn</p><h2>Your score lives with the activity.</h2><p>Each activity has its own points, reward target and scan history—so a Bowling visit never becomes a Laser Tag stamp.</p></div><div class="activity-grid">${activityTiles}</div></section>`;
}

function bookingView() {
  const venueCards = bookingVenues.map((venue, index) => {
    const callNumber = String(venue.phone || "").replace(/[^+\d]/g, "");
    const activityChips = venue.activities.map(activity => `<span>${escapeHtml(activity)}</span>`).join("");
    return `<article class="venue-card">
      <img class="venue-visual" src="${escapeHtml(venue.image)}" alt="" width="1200" height="800" loading="eager" />
      <div class="venue-body"><span class="venue-number">Venue 0${index + 1}</span><h3>${escapeHtml(venue.name)}</h3><p class="venue-location"><span aria-hidden="true">⌖</span>${escapeHtml(venue.address)}</p><div class="venue-activities" aria-label="Activities">${activityChips}</div><span class="venue-phone">${escapeHtml(venue.phone)}</span><div class="venue-actions">${bookingLink(venue, "Book on WhatsApp", "", "venue-whatsapp")}<a class="venue-call" href="tel:${escapeHtml(callNumber)}" aria-label="Call ${escapeHtml(venue.name)}">Call</a><a class="venue-map" href="${escapeHtml(venue.mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(venue.name)} in Google Maps">Map</a></div></div>
    </article>`;
  }).join("");
  return `<section class="shell booking-shell"><div class="booking-head"><div><p class="eyebrow">Book · Call · Find us</p><h2>Choose your venue.</h2><p class="subtle">One tap opens a ready WhatsApp message. Each card also has its direct call and map.</p></div><div class="booking-note"><span>Quick booking</span><strong>No form. No account.</strong></div></div><div class="venue-grid">${venueCards}</div></section>`;
}

function joinView(prefill = "") {
  return `<section class="shell narrow"><div class="panel">${configurationNotice()}<div class="panel-head"><div><p class="eyebrow">New player</p><h2>Create your X Passport.</h2><p class="subtle">Ask the X Entertainment team for a one-time join code, then choose your own six-digit PIN.</p></div></div><form id="join-form" class="form-grid">
    <div class="field"><label for="join-name">First name</label><input id="join-name" name="name" autocomplete="given-name" maxlength="60" required /></div>
    <div class="field"><label for="join-phone">UAE mobile number</label><input id="join-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X XXX XXXX" required /><span class="hint">Used to reopen your passport. It is never shown inside your QR code.</span></div>
    <div class="field"><label for="join-code">One-time join code</label><input id="join-code" name="inviteCode" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="off" spellcheck="false" required /><span class="hint">A team member creates this code after checking you in person.</span></div>
    <div class="field"><label for="join-pin">Choose a 6-digit PIN</label><input id="join-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div>
    <div class="field"><label for="join-pin-confirm">Confirm PIN</label><input id="join-pin-confirm" name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div>
    <label class="check-row"><input name="consent" type="checkbox" required /><span>I agree that ${escapeHtml(config.business.name)} may store my phone number and activity visit history to operate this loyalty program.</span></label><p class="form-error" id="join-error" role="alert"></p><button class="button primary" type="submit">Create my passport</button>
  </form></div></section>`;
}

function loginView() {
  return `<section class="shell entry-shell"><div class="entry-grid"><div class="panel login-panel">${configurationNotice()}<div class="entry-brand"><img src="assets/x-group-logo.jpg" alt="" width="100" height="102" /><div><p class="eyebrow">X Group Activity Passport</p><span>RAK · Sharjah</span></div></div><h1>Open your passport.</h1><p class="subtle">Your activity points and one-time loyalty QR are one quick sign-in away.</p><form id="customer-login" class="form-grid"><div class="field"><label for="login-phone">Mobile number</label><input id="login-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X XXX XXXX" required /></div><div class="field"><label for="login-pin">6-digit PIN</label><input id="login-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" required /></div><p class="form-error" id="login-error" role="alert"></p><button class="button primary" type="submit">Open my passport</button></form><p class="hint">New here? <button class="inline-link" data-route="join">Create a passport</button> · Forgot your PIN? <button class="inline-link" data-route="recover">Reset PIN</button></p></div><aside class="entry-visual"><img src="assets/venue-x-entertainment.jpg" alt="" width="1200" height="800" /><div class="entry-visual-copy"><p class="eyebrow">Ready to play?</p><h2>Book in seconds.</h2><p>WhatsApp, phone and directions for every venue.</p><button class="button booking-light" data-route="book">Choose a venue</button></div></aside></div></section>`;
}

function recoverView(prefill = "") {
  return `<section class="shell narrow"><div class="panel">${configurationNotice()}<p class="eyebrow">PIN recovery</p><h2>Choose a new PIN.</h2><p class="subtle">First ask a team member to verify you and create a one-time reset code. The team never sees the new PIN you choose here.</p><form id="recover-form" class="form-grid">
    <div class="field"><label for="recover-phone">Mobile number</label><input id="recover-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required /></div><div class="field"><label for="recover-code">One-time reset code</label><input id="recover-code" name="resetCode" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="off" spellcheck="false" required /></div><div class="field"><label for="recover-pin">New 6-digit PIN</label><input id="recover-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div><div class="field"><label for="recover-pin-confirm">Confirm new PIN</label><input id="recover-pin-confirm" name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div><p class="form-error" id="recover-error" role="alert"></p><button class="button primary" type="submit">Replace my PIN</button><button class="button secondary" type="button" data-route="login">Back to sign in</button>
  </form></div></section>`;
}

function renderActivityRail(selectedSlug, balances) {
  const available = new Map((Array.isArray(balances) ? balances : []).map(balance => [balance.slug, balance]));
  return `<div class="activity-rail" aria-label="Choose loyalty activity">${activities.map(activity => { const points = safeNumber(available.get(activity.slug)?.points); return `<button class="activity-choice" data-activity="${activity.slug}" aria-pressed="${activity.slug === selectedSlug}"><img src="${activity.icon}" alt="" width="42" height="42" /><span>${activity.name}</span><span>${points} pt${points === 1 ? "" : "s"}</span></button>`; }).join("")}</div>`;
}

async function memberView(selectedSlug = activities[0].slug, generation = renderGeneration) {
  const sessionToken = localStorage.getItem(customerKey);
  const qrToken = localStorage.getItem(qrKey);
  if (!sessionToken || !qrToken) { location.hash = "#/login"; return; }
  const activity = activityMeta(selectedSlug);
  app.innerHTML = `<div class="loading">Opening your ${escapeHtml(activity.name)} passport…</div>`;
  settleViewPosition();
  try {
    const data = await callApi("member-summary", { sessionToken, qrToken, activitySlug: activity.slug });
    if (generation !== renderGeneration) return;
    const selected = activityMeta(data.selectedActivity?.slug);
    const points = safeNumber(data.points);
    const threshold = Math.max(1, safeNumber(data.rewardThreshold));
    const progressValue = Math.min(threshold, points % threshold || (points > 0 ? threshold : 0));
    const venue = bookingVenue(selected.venueSlug);
    app.innerHTML = `<section class="shell wide"><div class="panel-head"><div><p class="eyebrow">X Group Activity Passport</p><h2>Welcome, ${escapeHtml(data.displayName)}.</h2><p class="subtle">Member ${escapeHtml(data.memberCode)}</p></div><button id="customer-logout" class="button ghost">Sign out</button></div>${renderActivityRail(selected.slug, data.activityBalances)}<div class="member-grid">
      <article class="panel member-card"><div class="member-card-head"><div class="member-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><span>Selected activity</span><strong>${escapeHtml(data.selectedActivity?.name || selected.name)}</strong></div></div><span class="location-chip">${escapeHtml(venue?.name || config.business.branch)}</span></div><div class="points"><strong>${points}</strong><span>activity points</span></div><progress value="${progressValue}" max="${threshold}" aria-label="${progressValue} of ${threshold} points toward the next reward"></progress><div class="reward-row"><span>${progressValue} / ${threshold} to next reward</span><span>${safeNumber(data.rewardsAvailable)} available</span></div><p>${escapeHtml(data.rewardText)}</p><p class="subtle">Last ${escapeHtml(selected.name)} visit: ${escapeHtml(formatDubaiTime(data.lastScannedAt))}</p>${bookingLink(venue, `Book ${selected.name}`, selected.name)}</article>
      <article class="panel qr-panel"><div><p class="eyebrow">One-time play code</p><h3>Show this to the team.</h3></div><div class="qr-wrap">${data.qrSvg || ""}</div><div class="qr-meta"><span>For ${escapeHtml(selected.name)}</span><span>Expires ${escapeHtml(formatDubaiTime(data.scanTokenExpiresAt))}</span></div><p class="hint">This code is activity-specific, expires after five minutes and can be accepted only once. Refresh it if the team asks for a new code.</p><div class="actions"><button id="refresh-code" class="button secondary">Refresh code</button><button id="install-button" class="button ghost">Add to home screen</button></div></article>
    </div></section>`;
    document.querySelectorAll("[data-activity]").forEach(button => button.addEventListener("click", () => { localStorage.setItem(lastActivityKey, button.dataset.activity); location.hash = `#/member/${button.dataset.activity}`; }));
    settleViewPosition();
    document.querySelector("#refresh-code")?.addEventListener("click", event => {
      event.currentTarget.disabled = true;
      const nextGeneration = ++renderGeneration;
      memberView(selected.slug, nextGeneration);
    });
    document.querySelector("#install-button")?.addEventListener("click", installApp);
    document.querySelector("#customer-logout")?.addEventListener("click", () => { localStorage.removeItem(customerKey); localStorage.removeItem(qrKey); localStorage.removeItem(lastActivityKey); location.hash = "#/passport"; });
  } catch (error) {
    if (generation !== renderGeneration) return;
    const expired = /session|sign in|replaced/i.test(error.message);
    if (expired) { localStorage.removeItem(customerKey); localStorage.removeItem(qrKey); }
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">Passport unavailable</p><h2>We could not open this card.</h2><p>${escapeHtml(error.message)}</p><div class="actions"><button class="button primary" data-route="${expired ? "passport" : `member/${activity.slug}`}">${expired ? "Sign in again" : "Try again"}</button><button class="button secondary" data-route="book">Book an experience</button></div></div></section>`;
    settleViewPosition();
  }
}

function ownerView() {
  if (ownerAccessToken) { location.hash = "#/dashboard"; return ""; }
  return `<section class="shell narrow"><div class="panel admin-panel">${configurationNotice()}<span class="admin-lock" aria-hidden="true">●</span><p class="eyebrow">X Group Admin</p><h2>Secure staff access.</h2><p class="subtle">The dashboard, scanner and point controls require an active admin email and password.</p><form id="owner-login" class="form-grid"><div class="field"><label for="owner-email">Admin email</label><input id="owner-email" name="email" type="email" autocomplete="username" required /></div><div class="field"><label for="owner-password">Password</label><input id="owner-password" name="password" type="password" autocomplete="current-password" required /></div><p class="form-error" id="owner-error" role="alert"></p><button class="button primary" type="submit">Open admin dashboard</button></form></div></section>`;
}

function activityBadges(balances) {
  if (!Array.isArray(balances)) return "";
  return `<div class="activity-badges">${balances.map(balance => `<span class="activity-badge" title="${escapeHtml(balance.name)}">${escapeHtml(activityMeta(balance.slug).name.replace("PlayStation", "PS"))} ${safeNumber(balance.points)}</span>`).join("")}</div>`;
}
function ownerActivityCards(items) {
  const list = Array.isArray(items) ? items : [];
  return `<div class="activity-grid dashboard-activities">${list.map(item => { const meta = activityMeta(item.slug); return `<article class="activity-tile"><img src="${meta.icon}" alt="" width="52" height="52" /><strong>${escapeHtml(item.name)}</strong><span>${safeNumber(item.scans)} scans · ${safeNumber(item.pointsAwarded)} points</span></article>`; }).join("")}</div>`;
}

async function dashboardView(generation = renderGeneration, customerOffset = 0) {
  const ownerToken = ownerAccessToken;
  if (!ownerToken) { location.hash = "#/admin"; return; }
  app.innerHTML = `<div class="loading">Loading the team dashboard…</div>`;
  settleViewPosition();
  try {
    const data = await callApi("owner-dashboard", { customerLimit: 250, customerOffset }, ownerToken);
    if (generation !== renderGeneration) return;
    const activitySettings = Array.isArray(data.metrics?.activityBreakdown) ? data.metrics.activityBreakdown : [];
    const defaultSetting = activitySettings[0] || { slug: activities[0].slug, pointsPerVisit: 1, rewardThreshold: 10, rewardText: "10 visits unlock a reward" };
    const customerPage = data.customerPage || { total: (data.customers || []).length, limit: 250, offset: customerOffset, hasMore: false };
    const pageStart = (data.customers || []).length ? safeNumber(customerPage.offset) + 1 : 0;
    const pageEnd = Math.min(safeNumber(customerPage.total), safeNumber(customerPage.offset) + (data.customers || []).length);
    app.innerHTML = `<section class="shell wide"><div class="panel-head"><div><p class="eyebrow">Team dashboard</p><h2>Play, verified.</h2><p class="subtle">Scans and confirmed points stay separate in the audit history.</p></div><div class="actions"><button class="button primary" data-route="scanner">Scan a passport</button><button id="owner-logout" class="button secondary">Sign out</button></div></div>
      <div class="metric-grid"><div class="metric"><span>Active members</span><strong>${safeNumber(data.metrics?.customers)}</strong></div><div class="metric"><span>Accepted scans</span><strong>${safeNumber(data.metrics?.scans)}</strong></div><div class="metric"><span>Points awarded</span><strong>${safeNumber(data.metrics?.pointsAwarded)}</strong></div><div class="metric"><span>Scans today</span><strong>${safeNumber(data.metrics?.scansToday)}</strong></div></div>${ownerActivityCards(activitySettings)}
      <div class="owner-tools"><article class="tool-card"><h3>Create a join code</h3><p>Generate a one-use code after checking the new member in person. It expires in 24 hours.</p><button id="create-invite" class="button secondary">Create code</button><div id="invite-result" aria-live="polite"></div></article>
      <article class="tool-card"><h3>Activity reward rules</h3><p>Each activity can award a different number of points and use a different reward target.</p><form id="activity-settings" class="compact-form"><div class="field"><label for="settings-activity">Activity</label><select id="settings-activity" name="activitySlug">${activitySettings.map(item => `<option value="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</option>`).join("")}</select></div><div class="settings-row"><div class="field"><label for="points-per-visit">Points per visit</label><input id="points-per-visit" name="pointsPerVisit" type="number" min="1" max="20" value="${safeNumber(defaultSetting.pointsPerVisit)}" required /></div><div class="field"><label for="reward-threshold">Reward target</label><input id="reward-threshold" name="rewardThreshold" type="number" min="2" max="1000" value="${safeNumber(defaultSetting.rewardThreshold)}" required /></div></div><div class="field"><label for="reward-text">Reward message</label><input id="reward-text" name="rewardText" maxlength="200" value="${escapeHtml(defaultSetting.rewardText)}" required /></div><p class="form-error" id="settings-error" role="alert"></p><button class="button ghost" type="submit">Save activity rules</button></form></article></div>
      <div id="reset-result" aria-live="polite"></div><div class="panel"><div class="panel-head"><div><h3>Members</h3><span class="subtle">Phone numbers are masked; use in-person verification before creating a reset code.</span></div><span class="hint">Showing ${pageStart}–${pageEnd} of ${safeNumber(customerPage.total)}</span></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>Phone</th><th>Activity points</th><th>Scans</th><th>Last scan</th><th>Account</th></tr></thead><tbody>${(data.customers || []).map(customer => `<tr><td>${escapeHtml(customer.displayName)}<br><span class="hint">${escapeHtml(customer.memberCode)}</span></td><td>${escapeHtml(customer.maskedPhone)}</td><td>${activityBadges(customer.activityBalances)}</td><td>${safeNumber(customer.scanCount)}</td><td>${escapeHtml(formatDubaiTime(customer.lastScannedAt))}</td><td><button class="button ghost reset-pin" data-customer-id="${escapeHtml(customer.customerId)}">Reset PIN</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No members yet.</td></tr>`}</tbody></table></div><div class="page-controls">${safeNumber(customerPage.offset) > 0 ? `<button class="button ghost" data-route="dashboard/${Math.max(0, safeNumber(customerPage.offset) - safeNumber(customerPage.limit))}">Previous members</button>` : ""}${customerPage.hasMore ? `<button class="button ghost" data-route="dashboard/${safeNumber(customerPage.offset) + safeNumber(customerPage.limit)}">Next members</button>` : ""}</div></div>
      <div class="panel history-panel"><div class="panel-head"><div><h3>Scan, point and reward history</h3><span class="subtle">Up to 1,000 recent accepted events in Dubai time. The database retains the complete history.</span></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Member</th><th>Activity</th><th>Event</th><th>Change</th><th>Balance</th></tr></thead><tbody>${(data.recentEvents || []).map(event => `<tr><td>${escapeHtml(formatDubaiTime(event.occurredAt))}</td><td>${escapeHtml(event.displayName)}<br><span class="hint">${escapeHtml(event.memberCode)}</span></td><td>${escapeHtml(event.activityName)}</td><td>${escapeHtml(String(event.action || "").replaceAll("_", " "))}</td><td>${escapeHtml(eventChange(event))}</td><td>${safeNumber(event.balanceBefore)} → ${safeNumber(event.balanceAfter)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No activity yet.</td></tr>`}</tbody></table></div></div>
    </section>`;
    settleViewPosition();
    document.querySelector("#owner-logout")?.addEventListener("click", () => { ownerAccessToken = null; location.hash = "#/"; });
    document.querySelector("#create-invite")?.addEventListener("click", createInvite);
    document.querySelectorAll(".reset-pin").forEach(button => button.addEventListener("click", () => createResetCode(button)));
    bindActivitySettings(activitySettings);
  } catch (error) {
    if (generation !== renderGeneration) return;
    if (error.status === 401 || error.status === 403) {
      ownerAccessToken = null;
      showToast("Your staff session expired. Sign in again.");
      location.hash = "#/admin";
      return;
    }
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">Dashboard unavailable</p><h2>Your session is still saved.</h2><p>${escapeHtml(error.message)}</p><div class="actions"><button class="button primary" data-route="dashboard">Retry</button><button class="button secondary" data-route="passport">Customer passport</button></div></div></section>`;
    settleViewPosition();
  }
}

async function createInvite(event) {
  const button = event.currentTarget;
  const result = document.querySelector("#invite-result");
  button.disabled = true;
  try {
    const data = await callApi("owner-create-enrollment-invite", { expiresInMinutes: 1440 }, ownerAccessToken);
    const qr = data.inviteQrSvg ? `<div class="code-qr">${data.inviteQrSvg}</div>` : "";
    result.innerHTML = `<div class="setup-code-grid">${qr}<div><p class="code-display compact">${escapeHtml(data.inviteCode)}</p><p class="hint">Let the verified customer scan this enrollment QR, or copy the code. It is shown only here and expires ${escapeHtml(formatDubaiTime(data.expiresAt))}.</p><button class="button ghost copy-code" data-code="${escapeHtml(data.inviteCode)}">Copy join code</button></div></div>`;
    result.querySelector(".copy-code")?.addEventListener("click", copyCode);
  } catch (error) { result.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
  finally { button.disabled = false; }
}

async function createResetCode(button) {
  const result = document.querySelector("#reset-result");
  button.disabled = true;
  try {
    const data = await callApi("owner-create-pin-reset", { customerId: button.dataset.customerId, expiresInMinutes: 15 }, ownerAccessToken);
    const qr = data.resetQrSvg ? `<div class="code-qr">${data.resetQrSvg}</div>` : "";
    result.innerHTML = `<div class="notice reset-notice"><strong>Reset code for ${escapeHtml(data.displayName)}</strong><div class="setup-code-grid">${qr}<div><span class="code-display compact">${escapeHtml(data.resetCode)}</span><span>Let this verified member scan the recovery QR, or give the code directly. It expires ${escapeHtml(formatDubaiTime(data.expiresAt))}.</span><button class="button ghost copy-code" data-code="${escapeHtml(data.resetCode)}">Copy reset code</button></div></div></div>`;
    result.querySelector(".copy-code")?.addEventListener("click", copyCode);
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) { result.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
  finally { button.disabled = false; }
}

async function copyCode(event) {
  try {
    await navigator.clipboard.writeText(event.currentTarget.dataset.code || "");
    showToast("One-time code copied.");
  } catch {
    showToast("Select and copy the displayed code manually.");
  }
}

function bindActivitySettings(settings) {
  const form = document.querySelector("#activity-settings");
  const select = document.querySelector("#settings-activity");
  if (!form || !select) return;
  const populate = () => { const item = settings.find(setting => setting.slug === select.value); if (!item) return; form.elements.pointsPerVisit.value = item.pointsPerVisit; form.elements.rewardThreshold.value = item.rewardThreshold; form.elements.rewardText.value = item.rewardText; };
  select.addEventListener("change", populate);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const errorElement = document.querySelector("#settings-error");
    const values = new FormData(form);
    submit.disabled = true; errorElement.textContent = "";
    try {
      await callApi("owner-update-activity-settings", { activitySlug: values.get("activitySlug"), pointsPerVisit: Number(values.get("pointsPerVisit")), rewardThreshold: Number(values.get("rewardThreshold")), rewardText: values.get("rewardText") }, ownerAccessToken);
      showToast("Activity reward rules saved.");
      await render();
    } catch (error) { errorElement.textContent = error.message; submit.disabled = false; }
  });
}

function scannerView(prefill = "") {
  if (!ownerAccessToken) { location.hash = "#/admin"; return ""; }
  return `<section class="shell narrow"><div class="panel"><div class="panel-head"><div><p class="eyebrow">Team scanner</p><h2>Scan. Review. Confirm.</h2></div><button class="text-button" data-route="dashboard">Close</button></div><div class="scan-box"><video id="scanner-video" class="scanner-video" playsinline muted></video><button id="start-scanner" class="button primary">Start camera scanner</button><p class="hint">The built-in scanner works on iPhone, Samsung and other modern phones. The member must select the activity before showing the code. The normal phone Camera app is a backup, but a newly opened tab may ask staff to sign in again.</p><div class="field"><label for="scan-value">Or paste a one-time scan code</label><input id="scan-value" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="off" spellcheck="false" /></div><button id="lookup-code" class="button secondary">Review visit</button><div id="scan-result" aria-live="polite"></div></div></div></section>`;
}

function privacyView() {
  return `<section class="shell narrow"><div class="panel"><p class="eyebrow">Privacy</p><h2>Only what the program needs.</h2><p>X Group Passport uses your name, phone number, PIN-derived security data, separate activity balances and visit history to operate the loyalty program. PINs are processed into one-way security hashes and are not stored in readable form.</p><p>The QR contains a random, activity-specific scan token—not your phone number or balance. A new token expires after five minutes and can be accepted only once.</p><p>Enrollment and PIN recovery require a one-time code from staff after an in-person check. The website does not send an SMS or independently prove ownership of the entered phone number. Ask the venue about correction, deactivation or deletion requests and any records it must retain.</p><button class="button secondary" data-route="passport">Back to passport</button></div></section>`;
}

async function installApp() {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showToast(isiOS ? "On iPhone: tap Share, then Add to Home Screen." : "Open your browser menu and choose Install app or Add to Home screen.");
}

async function startScanner() {
  const video = document.querySelector("#scanner-video");
  const supportsNativeDetector = "BarcodeDetector" in window;
  const supportsFallbackDetector = typeof window.jsQR === "function";
  if (!supportsNativeDetector && !supportsFallbackDetector) { showToast("Use the phone Camera app to open the member's QR, or paste the code below."); return; }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = scannerStream; await video.play();
    const detector = supportsNativeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    const canvas = supportsFallbackDetector ? document.createElement("canvas") : null;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    scannerTimer = window.setInterval(async () => {
      try {
        let rawValue = "";
        if (detector) {
          const codes = await detector.detect(video);
          rawValue = codes[0]?.rawValue || "";
        } else if (context && video.readyState >= 2) {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (width && height) {
            canvas.width = width; canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const frame = context.getImageData(0, 0, width, height);
            rawValue = window.jsQR(frame.data, width, height, { inversionAttempts: "attemptBoth" })?.data || "";
          }
        }
        if (rawValue) { stopScanner(); await lookupCode(rawValue); }
      } catch {}
    }, 650);
  } catch { showToast("Camera access was unavailable. Use the phone Camera app or paste the code."); }
}
function stopScanner() {
  if (scannerTimer) window.clearInterval(scannerTimer);
  scannerTimer = null;
  scannerStream?.getTracks().forEach(track => track.stop());
  scannerStream = null;
}

async function lookupCode(raw) {
  const result = document.querySelector("#scan-result");
  if (!result || scanLookupInFlight) return;
  scanLookupInFlight = true;
  let scanLoaded = false;
  const lookupButton = document.querySelector("#lookup-code");
  const cameraButton = document.querySelector("#start-scanner");
  if (lookupButton) lookupButton.disabled = true;
  if (cameraButton) cameraButton.disabled = true;
  try {
    const scanToken = parseQrPayload(raw);
    result.innerHTML = `<div class="loading">Verifying the one-time code…</div>`;
    const data = await callApi("owner-scan", { scanToken }, ownerAccessToken);
    scanLoaded = true;
    const selected = activityMeta(data.activity?.slug);
    const rewardsAvailable = safeNumber(data.rewardsAvailable);
    const redeemButton = rewardsAvailable > 0 ? `<button id="redeem-reward" class="button secondary">Redeem 1 ${escapeHtml(selected.name)} reward</button>` : "";
    result.innerHTML = `<div class="scan-result"><span class="pill">SCAN RECORDED</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(data.activity?.name || selected.name)}</strong><span>${safeNumber(data.points)} points · ${rewardsAvailable} rewards · ${safeNumber(data.scanCount)} lifetime scans</span></div></div><p class="subtle">Previous ${escapeHtml(selected.name)} scan: ${escapeHtml(formatDubaiTime(data.previousScanAt))}</p><p>${escapeHtml(data.rewardText || "")} Confirm only after checking the member and activity shown above.</p><div class="actions"><button id="confirm-point" class="button primary">Confirm ${escapeHtml(selected.name)} +${safeNumber(data.pointsPerVisit)}</button>${redeemButton}<button id="cancel-scan" class="button ghost">No transaction</button></div></div>`;
    document.querySelector("#confirm-point")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try {
        const receipt = await callApi("owner-add-visit-point", { scanEventId: data.scanEventId, idempotencyKey: randomIdempotencyKey() }, ownerAccessToken);
        result.innerHTML = `<div class="scan-result"><span class="pill">POINTS CONFIRMED</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(receipt.activity?.name || selected.name)}</strong><span>New balance: ${safeNumber(receipt.points)} points · ${safeNumber(receipt.rewardsAvailable)} rewards available</span></div></div><p class="hint">Transaction ${escapeHtml(receipt.transactionId)}</p><button class="button primary" data-route="scanner">Scan next passport</button></div>`;
      } catch (error) { showToast(error.message); setTransactionActionsDisabled(result, false); }
    });
    document.querySelector("#redeem-reward")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try {
        const receipt = await callApi("owner-redeem-reward", { scanEventId: data.scanEventId, idempotencyKey: randomIdempotencyKey() }, ownerAccessToken);
        result.innerHTML = `<div class="scan-result"><span class="pill">REWARD REDEEMED</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(receipt.activity?.name || selected.name)}</strong><span>${safeNumber(receipt.points)} points · ${safeNumber(receipt.rewardsAvailable)} rewards remain</span></div></div><p class="hint">Transaction ${escapeHtml(receipt.transactionId)}</p><button class="button primary" data-route="scanner">Scan next passport</button></div>`;
      } catch (error) { showToast(error.message); setTransactionActionsDisabled(result, false); }
    });
    document.querySelector("#cancel-scan")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try { await callApi("owner-cancel-scan", { scanEventId: data.scanEventId }, ownerAccessToken); result.innerHTML = `<div class="notice">The scan remains in the audit history; no points were added.</div>`; }
      catch (error) { showToast(error.message); setTransactionActionsDisabled(result, false); }
    });
  } catch (error) { result.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
  finally {
    scanLookupInFlight = false;
    if (!scanLoaded) {
      if (lookupButton?.isConnected) lookupButton.disabled = false;
      if (cameraButton?.isConnected) cameraButton.disabled = false;
    }
  }
}

function setTransactionActionsDisabled(container, disabled) {
  container.querySelectorAll("#confirm-point, #redeem-reward, #cancel-scan").forEach(button => { button.disabled = disabled; });
}

function bindForms(route) {
  if (route === "join") document.querySelector("#join-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#join-error"); errorElement.textContent = "";
    try { const pin = validatePin(form.get("pin")); if (pin !== form.get("pinConfirm")) throw new Error("PINs do not match."); const data = await callApi("enroll", { displayName: form.get("name"), phone: normalizePhone(form.get("phone")), pin, inviteCode: form.get("inviteCode"), consent: form.get("consent") === "on" }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = error.message; setFormBusy(formElement, false); }
  });
  if (route === "login") document.querySelector("#customer-login")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#login-error"); errorElement.textContent = "";
    try { const data = await callApi("customer-login", { phone: normalizePhone(form.get("phone")), pin: validatePin(form.get("pin")) }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = error.message; setFormBusy(formElement, false); }
  });
  if (route === "recover") document.querySelector("#recover-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#recover-error"); errorElement.textContent = "";
    try { const pin = validatePin(form.get("pin")); if (pin !== form.get("pinConfirm")) throw new Error("PINs do not match."); const data = await callApi("recover-pin", { phone: normalizePhone(form.get("phone")), resetCode: form.get("resetCode"), newPin: pin }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = error.message; setFormBusy(formElement, false); }
  });
  if (route === "owner" || route === "admin") document.querySelector("#owner-login")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#owner-error"); errorElement.textContent = "";
    try { const token = await ownerLogin(form.get("email"), form.get("password")); await callApi("owner-check", {}, token); ownerAccessToken = token; const pending = pendingScanToken; pendingScanToken = ""; location.hash = pending ? `#/scan/${pending}` : "#/dashboard"; }
    catch (error) { errorElement.textContent = error.message; setFormBusy(formElement, false); }
  });
  if (route === "scanner") { document.querySelector("#start-scanner")?.addEventListener("click", startScanner); document.querySelector("#lookup-code")?.addEventListener("click", () => lookupCode(document.querySelector("#scan-value").value)); }
}

async function render() {
  stopScanner();
  const generation = ++renderGeneration;
  if (window.top !== window.self) {
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">Direct access required</p><h2>Open X Group Passport in its own tab.</h2><p>For your security, registration, passport and team controls are disabled when this site is embedded inside another page.</p></div></section>`;
    settleViewPosition();
    return;
  }
  let path = location.hash.replace(/^#\//, "");
  if (!path || path === "home") {
    history.replaceState(null, "", "#/passport");
    path = "passport";
  }
  const [route, token] = path.split("/");
  if (route === "passport") {
    const hasPassport = localStorage.getItem(customerKey) && localStorage.getItem(qrKey);
    if (hasPassport) return memberView(activityMeta(localStorage.getItem(lastActivityKey)).slug, generation);
    app.innerHTML = loginView(); bindForms("login"); settleViewPosition(); return;
  }
  if (route === "join") { app.innerHTML = joinView(token || ""); bindForms("join"); settleViewPosition(); return; }
  if (route === "recover") { app.innerHTML = recoverView(token || ""); bindForms("recover"); settleViewPosition(); return; }
  if (route === "member") return memberView(activityMeta(token).slug, generation);
  if (route === "dashboard") return dashboardView(generation, /^\d+$/.test(token || "") ? Number(token) : 0);
  if (route === "scan") {
    if (!ownerAccessToken) { pendingScanToken = token || ""; location.hash = "#/admin"; return; }
    app.innerHTML = scannerView(token || ""); bindForms("scanner"); settleViewPosition(); if (token) lookupCode(token); return;
  }
  const views = { about: homeView, book: bookingView, login: loginView, owner: ownerView, admin: ownerView, scanner: scannerView, privacy: privacyView };
  if (!views[route]) { history.replaceState(null, "", "#/passport"); app.innerHTML = loginView(); bindForms("login"); settleViewPosition(); return; }
  app.innerHTML = views[route]();
  bindForms(route);
  settleViewPosition();
}

render();
