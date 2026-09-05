import { normalizePhone, validatePin, escapeHtml, randomIdempotencyKey, parseQrPayload } from "./core.js";
import { callApi, ownerLogin, isConfigured } from "./api.js";
import { applyDocumentLanguage, getLanguage, setLanguage, t, activityName, activityLine, countLabel, eventActionLabel, formatDubaiDateTime, localizeError } from "./i18n.js";

const config = window.LOYALTY_CONFIG;
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const customerKey = "x_loyalty_customer_session";
const qrKey = "x_loyalty_qr_credential";
const lastActivityKey = "x_loyalty_last_activity";
const activities = Object.freeze([
  { slug: "laser-tag", icon: "assets/activity-icons/laser-tag.svg" },
  { slug: "bowling", icon: "assets/activity-icons/bowling.svg" },
  { slug: "escape-room", icon: "assets/activity-icons/escape-room.svg" },
  { slug: "billiard", icon: "assets/activity-icons/billiard.svg" },
  { slug: "gaming", icon: "assets/activity-icons/gaming.svg" },
  { slug: "others", icon: "assets/activity-icons/others.svg" }
]);
const bookingVenues = Object.freeze(Array.isArray(config.bookingVenues) ? config.bookingVenues : []);

let installPrompt = null;
let scannerStream = null;
let scannerTimer = null;
let scanLookupInFlight = false;
let renderGeneration = 0;
let ownerAccessToken = null;
let pendingScanToken = "";
let ownerMemberSearchState = { query: "", members: null, status: "idle" };

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function applyLanguageShell() {
  applyDocumentLanguage();
  document.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach(element => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
  const toggle = document.querySelector("#language-toggle");
  if (toggle) {
    toggle.setAttribute("aria-label", t("language.switch"));
    toggle.title = t("language.switch");
    toggle.querySelector("[data-language-label]").textContent = t("language.label");
  }
}

applyLanguageShell();
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
document.querySelector("#language-toggle")?.addEventListener("click", event => {
  setLanguage(getLanguage() === "ar" ? "en" : "ar");
  applyLanguageShell();
  render();
  window.requestAnimationFrame(() => event.currentTarget.focus());
  showToast(t("language.changed"));
});
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

function activityMeta(slug) {
  const activity = activities.find(item => item.slug === slug) || activities[0];
  return { ...activity, name: activityName(activity.slug), line: activityLine(activity.slug) };
}
function allActivities() { return activities.map(activity => activityMeta(activity.slug)); }
function activityBookingVenues(slug) {
  return bookingVenues.filter(venue => Array.isArray(venue.activitySlugs) && venue.activitySlugs.includes(slug));
}
function venueText(venue, field) {
  const localized = getLanguage() === "ar" ? venue?.[`${field}Ar`] : venue?.[field];
  return String(localized || venue?.[field] || "");
}
function venueMapUrl(venue) {
  try {
    const url = new URL(String(venue?.mapUrl || ""));
    return url.protocol === "https:" && /(^|\.)google\.com$/i.test(url.hostname) ? url.toString() : "";
  } catch { return ""; }
}
function whatsappUrl(venue, activityName = "") {
  const digits = String(venue?.whatsapp || "");
  if (!/^9715\d{8}$/.test(digits)) return "";
  const url = new URL(`https://wa.me/${digits}`);
  const venueName = venueText(venue, "name");
  const message = activityName
    ? t("booking.message.activity", { activity: activityName, venue: venueName })
    : t("booking.message.generic", { venue: venueName });
  url.searchParams.set("text", message);
  return url.toString();
}
function bookingLink(venue, label, activityName = "", className = "button whatsapp") {
  const href = whatsappUrl(venue, activityName);
  if (!href) return "";
  const accessible = t("booking.whatsappAria", { label });
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(accessible)}"><span class="chat-mark" aria-hidden="true">↗</span>${escapeHtml(label)}</a>`;
}
function safeNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function eventChange(event) {
  const rewardDelta = safeNumber(event.rewardDelta);
  if (rewardDelta) return `${rewardDelta > 0 ? "+" : "−"}${countLabel(Math.abs(rewardDelta), "reward")}`;
  const pointDelta = safeNumber(event.pointDelta);
  return pointDelta ? `${pointDelta > 0 ? "+" : "−"}${countLabel(Math.abs(pointDelta), "point")}` : "—";
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
  return isConfigured() ? "" : `<div class="notice">${escapeHtml(t("configuration.preview"))}</div>`;
}

function homeView() {
  const stamps = Array.from({ length: 10 }, (_, index) => `<span class="stamp ${index < 4 ? "earned" : ""}">${index < 4 ? "X" : index + 1}</span>`).join("");
  const activityTiles = allActivities().map(activity => `<article class="activity-tile"><img src="${activity.icon}" alt="" width="52" height="52" /><strong>${escapeHtml(activity.name)}</strong><span>${escapeHtml(activity.line)}</span></article>`).join("");
  return `<section class="hero">
    <div class="hero-copy"><p class="eyebrow">${escapeHtml(t("home.eyebrow"))}</p><h1>${escapeHtml(t("home.play"))} ${escapeHtml(t("home.score"))}<span class="headline-accent">${escapeHtml(t("home.repeat"))}</span></h1><p class="lead">${escapeHtml(t("home.lead"))}</p><div class="actions"><button class="button primary" data-route="join">${escapeHtml(t("home.getPassport"))}</button><button class="button secondary" data-route="passport">${escapeHtml(t("home.openPassport"))}</button><button class="button secondary" data-route="book">${escapeHtml(t("home.book"))}</button></div><div class="hero-meta"><span class="meta-chip">${escapeHtml(t("home.install"))}</span><span class="meta-chip">${escapeHtml(t("home.noWallet"))}</span><span class="meta-chip">${escapeHtml(t("home.privateCodes"))}</span></div></div>
    <div class="wallet-preview" aria-label="${escapeHtml(t("home.previewAria"))}"><div class="preview-orbit" aria-hidden="true"></div><div class="passport-stack"><div class="passport-shadow-card" aria-hidden="true"></div><article class="passport-card"><div class="passport-top"><img class="passport-logo" src="assets/x-group-logo.jpg" alt="X Group" width="100" height="102" /><span class="location-chip">${escapeHtml(t("home.mall"))}</span></div><div class="passport-body"><span class="passport-label">${escapeHtml(t("home.passportLabel"))}</span><h3>${escapeHtml(activityName("laser-tag"))}</h3><div class="passport-points"><strong>4</strong><span>${escapeHtml(t("home.previewPoints"))}</span></div></div><div class="stamp-grid" aria-label="${escapeHtml(t("home.stampsAria"))}">${stamps}</div><div class="passport-foot"><bdi dir="ltr">${escapeHtml(t("home.member"))}</bdi><span>${escapeHtml(t("home.tagline"))}</span></div></article></div></div>
  </section><section class="activity-showcase"><div class="section-intro"><p class="eyebrow">${escapeHtml(t("home.sixWays"))}</p><h2>${escapeHtml(t("home.scoreByActivity"))}</h2><p>${escapeHtml(t("home.activityBody"))}</p></div><div class="activity-grid">${activityTiles}</div></section>`;
}

function bookingView() {
  const venueCards = bookingVenues.map((venue, index) => {
    const callNumber = String(venue.phone || "").replace(/[^+\d]/g, "");
    const mapUrl = venueMapUrl(venue);
    const venueName = venueText(venue, "name");
    const venueCity = venueText(venue, "city") || t("common.uae");
    const venueAddress = venueText(venue, "address");
    const localizedActivities = getLanguage() === "ar" ? venue.activitiesAr : venue.activities;
    const activitiesLabel = Array.isArray(localizedActivities) ? localizedActivities.join(" · ") : "";
    const mapLink = mapUrl ? `<a class="venue-map" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t("booking.mapAria", { venue: venueName }))}">${escapeHtml(t("common.directions"))}</a>` : "";
    return `<article class="venue-card" role="listitem">
      <img class="venue-visual" src="${escapeHtml(venue.image)}" alt="" width="1200" height="800" loading="${index === 0 ? "eager" : "lazy"}" decoding="async" />
      <div class="venue-body"><span class="venue-city">${escapeHtml(venueCity)}</span><h2>${escapeHtml(venueName)}</h2><a class="venue-location" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t("booking.mapAria", { venue: venueName }))}"><span aria-hidden="true">⌖</span>${escapeHtml(venueAddress)}</a><p class="venue-activities">${escapeHtml(activitiesLabel)}</p><a class="venue-phone" href="tel:${escapeHtml(callNumber)}" aria-label="${escapeHtml(t("booking.callAria", { venue: venueName }))}"><bdi dir="ltr">${escapeHtml(venue.phone)}</bdi></a><div class="venue-actions">${bookingLink(venue, t("common.whatsapp"), "", "venue-whatsapp")}${mapLink}</div></div>
    </article>`;
  }).join("");
  return `<section class="shell booking-shell" aria-labelledby="booking-title"><div class="booking-panel"><div class="booking-head"><div><p class="eyebrow">${escapeHtml(t("booking.eyebrow"))}</p><h1 id="booking-title">${escapeHtml(t("booking.title"))}</h1></div><p>${escapeHtml(t("booking.body"))}</p></div><div class="venue-grid" role="list" aria-label="${escapeHtml(t("booking.listAria"))}">${venueCards}</div><p class="venue-scroll-hint">${escapeHtml(t("booking.scrollHint"))}</p></div></section>`;
}

function joinView() {
  return `<section class="shell narrow"><div class="panel">${configurationNotice()}<div class="panel-head"><div><p class="eyebrow">${escapeHtml(t("join.eyebrow"))}</p><h2>${escapeHtml(t("join.title"))}</h2><p class="subtle">${escapeHtml(t("join.body"))}</p></div></div><form id="join-form" class="form-grid">
    <div class="field"><label for="join-name">${escapeHtml(t("join.firstName"))}</label><input id="join-name" name="name" autocomplete="given-name" maxlength="60" required /></div>
    <div class="field"><label for="join-phone">${escapeHtml(t("join.phone"))}</label><input id="join-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X XXX XXXX" required /><span class="hint">${escapeHtml(t("join.phoneHint"))}</span></div>
    <div class="field"><label for="join-pin">${escapeHtml(t("join.pin"))}</label><input id="join-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div>
    <div class="field"><label for="join-pin-confirm">${escapeHtml(t("join.confirmPin"))}</label><input id="join-pin-confirm" name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div>
    <label class="check-row"><input name="consent" type="checkbox" required /><span>${escapeHtml(t("join.consent", { business: config.business.name }))}</span></label><p class="form-error" id="join-error" role="alert"></p><button class="button primary" type="submit">${escapeHtml(t("join.submit"))}</button>
  </form></div></section>`;
}

function loginView() {
  return `<section class="shell entry-shell"><div class="entry-grid"><div class="panel login-panel">${configurationNotice()}<div class="entry-brand"><img src="assets/x-group-logo.jpg" alt="" width="100" height="102" /><div><p class="eyebrow">${escapeHtml(t("login.eyebrow"))}</p><span>${escapeHtml(t("login.region"))}</span></div></div><h1>${escapeHtml(t("login.title"))}</h1><p class="subtle">${escapeHtml(t("login.body"))}</p><form id="customer-login" class="form-grid"><div class="field"><label for="login-phone">${escapeHtml(t("login.phone"))}</label><input id="login-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05X XXX XXXX" required /></div><div class="field"><label for="login-pin">${escapeHtml(t("login.pin"))}</label><input id="login-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" required /></div><p class="form-error" id="login-error" role="alert"></p><button class="button primary" type="submit">${escapeHtml(t("login.submit"))}</button></form><p class="hint">${escapeHtml(t("login.new"))} <button class="inline-link" data-route="join">${escapeHtml(t("login.create"))}</button> · ${escapeHtml(t("login.forgot"))} <button class="inline-link" data-route="recover">${escapeHtml(t("login.reset"))}</button></p></div><aside class="entry-visual"><img src="assets/venue-x-entertainment.jpg" alt="" width="1200" height="800" /><div class="entry-visual-copy"><p class="eyebrow">${escapeHtml(t("login.ready"))}</p><h2>${escapeHtml(t("login.bookTitle"))}</h2><p>${escapeHtml(t("login.bookBody"))}</p><button class="button booking-light" data-route="book">${escapeHtml(t("login.chooseVenue"))}</button></div></aside></div></section>`;
}

function recoverView(prefill = "") {
  return `<section class="shell narrow"><div class="panel">${configurationNotice()}<p class="eyebrow">${escapeHtml(t("recover.eyebrow"))}</p><h2>${escapeHtml(t("recover.title"))}</h2><p class="subtle">${escapeHtml(t("recover.body"))}</p><form id="recover-form" class="form-grid">
    <div class="field"><label for="recover-phone">${escapeHtml(t("recover.phone"))}</label><input id="recover-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required /></div><div class="field"><label for="recover-code">${escapeHtml(t("recover.code"))}</label><input id="recover-code" class="ltr-input" name="resetCode" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="off" spellcheck="false" required /></div><div class="field"><label for="recover-pin">${escapeHtml(t("recover.newPin"))}</label><input id="recover-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div><div class="field"><label for="recover-pin-confirm">${escapeHtml(t("recover.confirmPin"))}</label><input id="recover-pin-confirm" name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="6" required /></div><p class="form-error" id="recover-error" role="alert"></p><button class="button primary" type="submit">${escapeHtml(t("recover.submit"))}</button><button class="button secondary" type="button" data-route="login">${escapeHtml(t("recover.back"))}</button>
  </form></div></section>`;
}

function renderActivityRail(selectedSlug, balances) {
  const available = new Map((Array.isArray(balances) ? balances : []).map(balance => [balance.slug, balance]));
  return `<div class="activity-rail" aria-label="${escapeHtml(t("member.railAria"))}">${allActivities().map(activity => { const points = safeNumber(available.get(activity.slug)?.points); return `<button class="activity-choice" data-activity="${activity.slug}" aria-pressed="${activity.slug === selectedSlug}"><img src="${activity.icon}" alt="" width="42" height="42" /><span>${escapeHtml(activity.name)}</span><span>${escapeHtml(countLabel(points, "point"))}</span></button>`; }).join("")}</div>`;
}

async function memberView(selectedSlug = activities[0].slug, generation = renderGeneration) {
  const sessionToken = localStorage.getItem(customerKey);
  const qrToken = localStorage.getItem(qrKey);
  if (!sessionToken || !qrToken) { location.hash = "#/login"; return; }
  const activity = activityMeta(selectedSlug);
  app.innerHTML = `<div class="loading">${escapeHtml(t("member.loading", { activity: activity.name }))}</div>`;
  settleViewPosition();
  try {
    const data = await callApi("member-summary", { sessionToken, qrToken, activitySlug: activity.slug });
    if (generation !== renderGeneration) return;
    const selected = activityMeta(data.selectedActivity?.slug);
    const points = safeNumber(data.points);
    const threshold = Math.max(1, safeNumber(data.rewardThreshold));
    const progressValue = Math.min(threshold, points % threshold || (points > 0 ? threshold : 0));
    const venues = activityBookingVenues(selected.slug);
    const bookingLabel = t("member.book", { activity: selected.name });
    const bookingLinks = venues.map(venue => bookingLink(
      venue,
      venueText(venue, "shortName") || venueText(venue, "name"),
      selected.name,
      "passport-booking-link"
    )).join("");
    const bookingActions = bookingLinks ? `<div class="member-bookings" aria-label="${escapeHtml(bookingLabel)}"><span class="member-bookings-label">${escapeHtml(bookingLabel)}</span><div class="member-booking-links">${bookingLinks}</div></div>` : "";
    const rewardsAvailable = safeNumber(data.rewardsAvailable);
    const rewardText = getLanguage() === "ar" ? (data.rewardTextAr || data.rewardText) : data.rewardText;
    const redemptionAction = rewardsAvailable > 0 ? `<div class="redeem-customer"><button id="request-redeem" class="button reward-button" type="button">${escapeHtml(t("member.redeem"))}</button><span>${escapeHtml(t("member.redeemHint"))}</span></div>` : "";
    app.innerHTML = `<section class="shell wide"><div class="panel-head"><div><p class="eyebrow">${escapeHtml(t("login.eyebrow"))}</p><h2>${escapeHtml(t("member.welcome", { name: data.displayName }))}</h2><p class="subtle">${escapeHtml(t("member.number", { code: data.memberCode }))}</p></div><button id="customer-logout" class="button ghost">${escapeHtml(t("common.signOut"))}</button></div>${renderActivityRail(selected.slug, data.activityBalances)}<div class="member-grid">
      <article class="panel member-card activity-theme-${selected.slug}"><div class="member-card-head"><div class="member-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><span>${escapeHtml(t("member.selected"))}</span><strong>${escapeHtml(selected.name)}</strong></div></div></div><div class="points"><strong>${points}</strong><span>${escapeHtml(t("member.points"))}</span></div><progress value="${progressValue}" max="${threshold}" aria-label="${escapeHtml(t("member.progressAria", { current: progressValue, target: threshold }))}"></progress><div class="reward-row"><span>${escapeHtml(t("member.progress", { current: progressValue, target: threshold }))}</span><span>${escapeHtml(t("member.available", { count: rewardsAvailable }))}</span></div><p class="member-reward-copy">${escapeHtml(rewardText)}</p>${redemptionAction}<p class="subtle member-last-visit">${escapeHtml(t("member.lastVisit", { activity: selected.name, date: formatDubaiDateTime(data.lastScannedAt) }))}</p>${bookingActions}</article>
      <article id="member-qr-panel" class="panel qr-panel activity-theme-${selected.slug}"><div class="qr-panel-head"><div><p class="eyebrow">${escapeHtml(t("member.qrEyebrow"))}</p><h3 id="member-qr-title">${escapeHtml(t("member.qrTitle"))}</h3></div><div class="qr-brand-lockup" aria-label="${escapeHtml(`${config.business.shortName || "X Group"} · ${selected.name}`)}"><img class="qr-brand-logo" src="assets/x-group-logo.jpg" alt="X Group" width="44" height="44" /><span class="qr-brand-activity"><img src="${selected.icon}" alt="" width="28" height="28" /><strong>${escapeHtml(selected.name)}</strong></span></div></div><div class="qr-stage"><div class="qr-wrap">${data.qrSvg || ""}</div><div class="qr-stage-label"><span aria-hidden="true"></span>${escapeHtml(config.business.shortName || "X Group")} · ${escapeHtml(selected.name)}</div></div><div class="qr-meta"><span>${escapeHtml(t("member.forActivity", { activity: selected.name }))}</span><span>${escapeHtml(t("member.expires", { date: formatDubaiDateTime(data.scanTokenExpiresAt) }))}</span></div><p class="hint">${escapeHtml(t("member.qrHint"))}</p><div class="actions"><button id="refresh-code" class="button secondary">${escapeHtml(t("member.refresh"))}</button><button id="install-button" class="button ghost">${escapeHtml(t("member.install"))}</button></div></article>
    </div></section>`;
    document.querySelectorAll("[data-activity]").forEach(button => button.addEventListener("click", () => { localStorage.setItem(lastActivityKey, button.dataset.activity); location.hash = `#/member/${button.dataset.activity}`; }));
    settleViewPosition();
    document.querySelector("#refresh-code")?.addEventListener("click", event => {
      event.currentTarget.disabled = true;
      const nextGeneration = ++renderGeneration;
      memberView(selected.slug, nextGeneration);
    });
    document.querySelector("#install-button")?.addEventListener("click", installApp);
    document.querySelector("#request-redeem")?.addEventListener("click", () => {
      const qrPanel = document.querySelector("#member-qr-panel");
      qrPanel?.classList.add("redeem-ready");
      const qrTitle = document.querySelector("#member-qr-title");
      if (qrTitle) qrTitle.textContent = t("member.qrRedeemTitle");
      qrPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(t("member.redeemReady"));
    });
    document.querySelector("#customer-logout")?.addEventListener("click", () => { localStorage.removeItem(customerKey); localStorage.removeItem(qrKey); localStorage.removeItem(lastActivityKey); location.hash = "#/passport"; });
  } catch (error) {
    if (generation !== renderGeneration) return;
    const expired = /session|sign in|replaced/i.test(error.message);
    if (expired) { localStorage.removeItem(customerKey); localStorage.removeItem(qrKey); }
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">${escapeHtml(t("member.unavailable"))}</p><h2>${escapeHtml(t("member.cannotOpen"))}</h2><p>${escapeHtml(localizeError(error))}</p><div class="actions"><button class="button primary" data-route="${expired ? "passport" : `member/${activity.slug}`}">${escapeHtml(expired ? t("member.signInAgain") : t("common.retry"))}</button><button class="button secondary" data-route="book">${escapeHtml(t("home.book"))}</button></div></div></section>`;
    settleViewPosition();
  }
}

function ownerView() {
  if (ownerAccessToken) { location.hash = "#/dashboard"; return ""; }
  return `<section class="shell narrow"><div class="panel admin-panel" data-watermark="${getLanguage() === "ar" ? "إدارة" : "ADMIN"}">${configurationNotice()}<span class="admin-lock" aria-hidden="true">●</span><p class="eyebrow">${escapeHtml(t("owner.eyebrow"))}</p><h2>${escapeHtml(t("owner.title"))}</h2><p class="subtle">${escapeHtml(t("owner.body"))}</p><form id="owner-login" class="form-grid"><div class="field"><label for="owner-email">${escapeHtml(t("owner.email"))}</label><input id="owner-email" name="email" type="email" autocomplete="username" required /></div><div class="field"><label for="owner-password">${escapeHtml(t("owner.password"))}</label><input id="owner-password" name="password" type="password" autocomplete="current-password" required /></div><p class="form-error" id="owner-error" role="alert"></p><button class="button primary" type="submit">${escapeHtml(t("owner.submit"))}</button></form></div></section>`;
}

function activityBadges(balances) {
  if (!Array.isArray(balances)) return "";
  return `<div class="activity-badges">${balances.map(balance => `<span class="activity-badge" title="${escapeHtml(activityName(balance.slug))}">${escapeHtml(activityName(balance.slug, true))} <bdi dir="ltr">${safeNumber(balance.points)}</bdi></span>`).join("")}</div>`;
}
function ownerActivityCards(items) {
  const list = Array.isArray(items) ? items : [];
  return `<div class="activity-grid dashboard-activities">${list.map(item => { const meta = activityMeta(item.slug); return `<article class="activity-tile"><img src="${meta.icon}" alt="" width="52" height="52" /><strong>${escapeHtml(meta.name)}</strong><span>${escapeHtml(t("dashboard.activitySummary", { scans: countLabel(item.scans, "scan"), points: countLabel(item.pointsAwarded, "point") }))}</span></article>`; }).join("")}</div>`;
}

function phoneSearchDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
    .slice(0, 15);
}

function ownerSessionEnded(error) {
  if (error?.status !== 401 && error?.status !== 403) return false;
  ownerAccessToken = null;
  ownerMemberSearchState = { query: "", members: null, status: "idle" };
  showToast(t("dashboard.sessionExpired"));
  location.hash = "#/admin";
  return true;
}

function memberStatusLabel(value) {
  const status = String(value || "active").trim().toLowerCase();
  const key = `dashboard.status.${status}`;
  const label = t(key);
  return label === key ? status.replaceAll("_", " ") : label;
}

function memberBalanceCards(balances) {
  const list = Array.isArray(balances) ? balances : [];
  if (!list.length) return `<p class="subtle member-search-empty">${escapeHtml(t("dashboard.noBalances"))}</p>`;
  return `<div class="member-balance-grid">${list.map(balance => {
    const slug = String(balance.slug || "others");
    const configuredName = String(balance.name || "").trim();
    const localizedName = activityName(slug);
    const name = localizedName.startsWith("activity.") ? configuredName || slug : localizedName;
    return `<div class="member-balance"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(countLabel(balance.points, "point"))}</span><span>${escapeHtml(countLabel(balance.rewardsAvailable, "reward"))}</span></div>`;
  }).join("")}</div>`;
}

function memberCorrectionHistory(corrections) {
  const list = Array.isArray(corrections) ? corrections.slice(0, 5) : [];
  if (!list.length) return "";
  return `<details class="correction-history"><summary><span>${escapeHtml(t("dashboard.correctionsTitle"))}</span></summary><div class="correction-history-list">${list.map(correction => {
    const actor = String(correction.actorDisplayName || t("dashboard.unknownStaff"));
    return `<article><div><strong><bdi dir="ltr">${safeNumber(correction.beforeCount)} → ${safeNumber(correction.afterCount)}</bdi></strong><span>${escapeHtml(formatDubaiDateTime(correction.occurredAt))}</span></div><p>${escapeHtml(correction.reason || "")}</p><small>${escapeHtml(t("dashboard.correctedBy", { actor }))}</small></article>`;
  }).join("")}</div></details>`;
}

function memberSearchCard(member) {
  const customerId = String(member.customerId || "");
  const displayName = String(member.displayName || member.username || t("dashboard.unnamedMember"));
  const username = String(member.username || "").trim();
  const nameAndUsername = username && username !== displayName ? `${displayName} · ${username}` : displayName;
  const phone = String(member.phone || "").trim();
  const callablePhone = phone.replace(/[^+\d]/g, "");
  const memberCode = String(member.memberCode || "—");
  const status = String(member.status || "active").toLowerCase();
  const recordedCount = safeNumber(member.recordedScanCount);
  const effectiveCount = safeNumber(member.scanCount);
  const resetDisabled = status !== "active";
  const phoneMarkup = callablePhone
    ? `<a class="member-phone" href="tel:${escapeHtml(callablePhone)}"><bdi dir="ltr">${escapeHtml(phone)}</bdi></a>`
    : `<bdi class="member-phone" dir="ltr">—</bdi>`;
  return `<article class="member-search-card">
    <div class="member-search-head"><div><p class="member-search-code"><bdi dir="ltr">${escapeHtml(memberCode)}</bdi></p><h4>${escapeHtml(nameAndUsername)}</h4>${phoneMarkup}</div><span class="member-status ${status === "active" ? "is-active" : ""}">${escapeHtml(memberStatusLabel(status))}</span></div>
    <dl class="member-facts"><div><dt>${escapeHtml(t("dashboard.nameUsername"))}</dt><dd>${escapeHtml(nameAndUsername)}</dd></div><div><dt>${escapeHtml(t("dashboard.memberCode"))}</dt><dd><bdi dir="ltr">${escapeHtml(memberCode)}</bdi></dd></div><div><dt>${escapeHtml(t("dashboard.effectiveScans"))}</dt><dd><bdi dir="ltr">${effectiveCount}</bdi></dd></div><div><dt>${escapeHtml(t("dashboard.recordedScans"))}</dt><dd><bdi dir="ltr">${recordedCount}</bdi></dd></div><div><dt>${escapeHtml(t("dashboard.lastScan"))}</dt><dd>${escapeHtml(formatDubaiDateTime(member.lastScannedAt))}</dd></div><div><dt>${escapeHtml(t("dashboard.created"))}</dt><dd>${escapeHtml(formatDubaiDateTime(member.createdAt))}</dd></div></dl>
    <div class="member-balance-section"><h5>${escapeHtml(t("dashboard.activityBalances"))}</h5>${memberBalanceCards(member.activityBalances)}</div>
    <div class="member-search-actions"><button class="button ghost member-search-reset" type="button" data-customer-id="${escapeHtml(customerId)}"${resetDisabled ? " disabled" : ""}>${escapeHtml(t("dashboard.resetPin"))}</button>${resetDisabled ? `<p class="member-reset-help">${escapeHtml(t("dashboard.resetUnavailable"))}</p>` : ""}</div>
    ${memberCorrectionHistory(member.scanCorrections)}
    <details class="scan-correction"><summary><span>${escapeHtml(t("dashboard.correctScans"))}</span></summary><div class="scan-correction-body"><div class="correction-safety-note" role="note"><strong>${escapeHtml(t("dashboard.correctionSafetyTitle"))}</strong><span>${escapeHtml(t("dashboard.correctionNote"))}</span></div><p class="hint">${escapeHtml(t("dashboard.correctionCurrent", { effective: effectiveCount, recorded: recordedCount }))}</p><form class="compact-form scan-correction-form" data-customer-id="${escapeHtml(customerId)}" data-member-name="${escapeHtml(displayName)}" data-current-count="${effectiveCount}"><div class="field"><label>${escapeHtml(t("dashboard.correctionTarget"))}<input class="ltr-input" name="targetCount" type="number" min="0" step="1" value="${effectiveCount}" required /></label></div><div class="field"><label>${escapeHtml(t("dashboard.correctionReason"))}<textarea name="reason" dir="auto" minlength="3" maxlength="500" placeholder="${escapeHtml(t("dashboard.correctionReasonPlaceholder"))}" required></textarea></label></div><label class="check-row correction-confirm"><input name="confirmCorrection" type="checkbox" required /><span>${escapeHtml(t("dashboard.correctionConfirm"))}</span></label><p class="form-error correction-error" role="alert"></p><button class="button secondary" type="submit">${escapeHtml(t("dashboard.correctionSubmit"))}</button></form></div></details>
  </article>`;
}

function renderMemberSearchResults(options = {}) {
  const container = document.querySelector("#member-search-results");
  if (!container) return;
  if (options.loading || ownerMemberSearchState.status === "loading") {
    container.innerHTML = `<div class="member-search-feedback">${escapeHtml(t("dashboard.searching"))}</div>`;
    return;
  }
  if (!ownerMemberSearchState.query || ownerMemberSearchState.status !== "success" || !Array.isArray(ownerMemberSearchState.members)) { container.innerHTML = ""; return; }
  const members = ownerMemberSearchState.members;
  if (!members.length) {
    container.innerHTML = `<div class="member-search-feedback">${escapeHtml(t("dashboard.searchNone"))}</div>`;
    return;
  }
  container.innerHTML = `<div class="member-search-summary">${escapeHtml(t("dashboard.searchFound", { count: countLabel(members.length, "member") }))}</div><div class="member-search-grid">${members.map(memberSearchCard).join("")}</div>`;
}

async function runOwnerMemberSearch(value) {
  const form = document.querySelector("#member-search-form");
  const errorElement = document.querySelector("#member-search-error");
  const query = phoneSearchDigits(value);
  if (!form || !errorElement) return;
  errorElement.textContent = "";
  if (query.length < 4) {
    ownerMemberSearchState = { query: "", members: null, status: "idle" };
    renderMemberSearchResults();
    errorElement.textContent = t("dashboard.searchMinimum");
    form.elements.phone.focus();
    return;
  }
  ownerMemberSearchState = { query, members: null, status: "loading" };
  form.elements.phone.value = query;
  setFormBusy(form, true);
  renderMemberSearchResults({ loading: true });
  const token = ownerAccessToken;
  try {
    const data = await callApi("owner-member-search", { phone: query }, token);
    if (token !== ownerAccessToken) return;
    ownerMemberSearchState = { query, members: Array.isArray(data.members) ? data.members : [], status: "success" };
    renderMemberSearchResults();
  } catch (error) {
    if (token !== ownerAccessToken) return;
    if (ownerSessionEnded(error)) return;
    ownerMemberSearchState = { query, members: null, status: "error" };
    errorElement.textContent = localizeError(error);
    const results = document.querySelector("#member-search-results");
    if (results) results.innerHTML = "";
  } finally {
    if (form.isConnected) setFormBusy(form, false);
  }
}

async function submitScanCountCorrection(form) {
  const values = new FormData(form);
  const rawTarget = String(values.get("targetCount") || "").trim();
  const targetCount = Number(rawTarget);
  const reason = String(values.get("reason") || "").trim();
  const errorElement = form.querySelector(".correction-error");
  const currentCount = safeNumber(form.dataset.currentCount);
  const memberName = form.dataset.memberName || t("dashboard.unnamedMember");
  errorElement.textContent = "";
  if (!rawTarget || !Number.isSafeInteger(targetCount) || targetCount < 0) {
    errorElement.textContent = t("dashboard.correctionInvalidTarget");
    return;
  }
  if (reason.length < 3 || reason.length > 500) {
    errorElement.textContent = t("dashboard.correctionInvalidReason");
    return;
  }
  if (values.get("confirmCorrection") !== "on") {
    errorElement.textContent = t("dashboard.correctionConfirmRequired");
    return;
  }
  if (targetCount === currentCount) {
    errorElement.textContent = t("dashboard.correctionSame");
    return;
  }
  if (!window.confirm(t("dashboard.correctionDialog", { name: memberName, count: targetCount }))) return;
  setFormBusy(form, true);
  try {
    const token = ownerAccessToken;
    await callApi("owner-set-scan-count", { customerId: form.dataset.customerId, targetCount, reason }, token);
    if (token !== ownerAccessToken) return;
    const query = ownerMemberSearchState.query;
    let refreshError = null;
    if (query) {
      try {
        const data = await callApi("owner-member-search", { phone: query }, token);
        if (token !== ownerAccessToken) return;
        ownerMemberSearchState = { query, members: Array.isArray(data.members) ? data.members : [], status: "success" };
      } catch (error) {
        if (token !== ownerAccessToken) return;
        if (ownerSessionEnded(error)) return;
        ownerMemberSearchState = { query, members: null, status: "error" };
        refreshError = error;
      }
    }
    await render();
    if (!ownerAccessToken) return;
    showToast(t("dashboard.correctionSaved"));
    if (refreshError) {
      const searchError = document.querySelector("#member-search-error");
      if (searchError) searchError.textContent = t("dashboard.searchRefreshFailed");
    }
  } catch (error) {
    if (ownerSessionEnded(error)) return;
    errorElement.textContent = localizeError(error);
    if (form.isConnected) setFormBusy(form, false);
  }
}

function bindOwnerMemberSearch() {
  const form = document.querySelector("#member-search-form");
  const results = document.querySelector("#member-search-results");
  if (!form || !results) return;
  renderMemberSearchResults();
  form.addEventListener("submit", event => {
    event.preventDefault();
    runOwnerMemberSearch(new FormData(form).get("phone"));
  });
  results.addEventListener("click", event => {
    const resetButton = event.target.closest(".member-search-reset");
    if (resetButton) createResetCode(resetButton);
  });
  results.addEventListener("submit", event => {
    const correctionForm = event.target.closest(".scan-correction-form");
    if (!correctionForm) return;
    event.preventDefault();
    submitScanCountCorrection(correctionForm);
  });
}

async function dashboardView(generation = renderGeneration, customerOffset = 0) {
  const ownerToken = ownerAccessToken;
  if (!ownerToken) { location.hash = "#/admin"; return; }
  app.innerHTML = `<div class="loading">${escapeHtml(t("dashboard.loading"))}</div>`;
  settleViewPosition();
  try {
    const data = await callApi("owner-dashboard", { customerLimit: 250, customerOffset }, ownerToken);
    if (generation !== renderGeneration) return;
    const activitySettings = Array.isArray(data.metrics?.activityBreakdown) ? data.metrics.activityBreakdown : [];
    const defaultSetting = activitySettings[0] || { slug: activities[0].slug, pointsPerVisit: 1, rewardThreshold: 10, rewardText: "10 visits unlock a reward", rewardTextAr: "10 زيارات تمنح مكافأة" };
    const customerPage = data.customerPage || { total: (data.customers || []).length, limit: 250, offset: customerOffset, hasMore: false };
    const pageStart = (data.customers || []).length ? safeNumber(customerPage.offset) + 1 : 0;
    const pageEnd = Math.min(safeNumber(customerPage.total), safeNumber(customerPage.offset) + (data.customers || []).length);
    app.innerHTML = `<section class="shell wide"><div class="panel-head"><div><p class="eyebrow">${escapeHtml(t("dashboard.eyebrow"))}</p><h2>${escapeHtml(t("dashboard.title"))}</h2><p class="subtle">${escapeHtml(t("dashboard.body"))}</p></div><div class="actions"><button class="button primary" data-route="scanner">${escapeHtml(t("dashboard.scan"))}</button><button id="owner-logout" class="button secondary">${escapeHtml(t("common.signOut"))}</button></div></div>
      <div class="metric-grid"><div class="metric"><span>${escapeHtml(t("dashboard.activeMembers"))}</span><strong>${safeNumber(data.metrics?.customers)}</strong></div><div class="metric"><span>${escapeHtml(t("dashboard.acceptedScans"))}</span><strong>${safeNumber(data.metrics?.scans)}</strong><small>${escapeHtml(t("dashboard.recordedMetric", { count: safeNumber(data.metrics?.recordedScans ?? data.metrics?.scans) }))}</small></div><div class="metric"><span>${escapeHtml(t("dashboard.pointsAwarded"))}</span><strong>${safeNumber(data.metrics?.pointsAwarded)}</strong></div><div class="metric"><span>${escapeHtml(t("dashboard.scansToday"))}</span><strong>${safeNumber(data.metrics?.scansToday)}</strong></div></div>${ownerActivityCards(activitySettings)}
      <div class="owner-tools"><article class="tool-card member-search-tool"><h3>${escapeHtml(t("dashboard.searchTitle"))}</h3><p>${escapeHtml(t("dashboard.searchBody"))}</p><form id="member-search-form" class="member-search-form" role="search"><div class="field"><label for="member-search-phone">${escapeHtml(t("dashboard.searchPhone"))}</label><input id="member-search-phone" class="ltr-input" name="phone" type="tel" inputmode="tel" minlength="4" maxlength="24" value="${escapeHtml(ownerMemberSearchState.query)}" placeholder="${escapeHtml(t("dashboard.searchPlaceholder"))}" autocomplete="off" required /></div><button class="button primary" type="submit">${escapeHtml(t("dashboard.searchSubmit"))}</button><p class="form-error member-search-error" id="member-search-error" role="alert"></p></form><div id="member-search-results" aria-live="polite" aria-atomic="false"></div></article><article class="tool-card"><h3>${escapeHtml(t("dashboard.rules"))}</h3><p>${escapeHtml(t("dashboard.rulesBody"))}</p><form id="activity-settings" class="compact-form"><div class="field"><label for="settings-activity">${escapeHtml(t("dashboard.activity"))}</label><select id="settings-activity" name="activitySlug">${activitySettings.map(item => `<option value="${escapeHtml(item.slug)}">${escapeHtml(activityName(item.slug))}</option>`).join("")}</select></div><div class="settings-row"><div class="field"><label for="points-per-visit">${escapeHtml(t("dashboard.pointsPerVisit"))}</label><input id="points-per-visit" name="pointsPerVisit" type="number" min="1" max="20" value="${safeNumber(defaultSetting.pointsPerVisit)}" required /></div><div class="field"><label for="reward-threshold">${escapeHtml(t("dashboard.rewardTarget"))}</label><input id="reward-threshold" name="rewardThreshold" type="number" min="2" max="1000" value="${safeNumber(defaultSetting.rewardThreshold)}" required /></div></div><div class="field"><label for="reward-text">${escapeHtml(t("dashboard.rewardTextEn"))}</label><input id="reward-text" class="ltr-input" name="rewardText" maxlength="200" value="${escapeHtml(defaultSetting.rewardText)}" required /></div><div class="field"><label for="reward-text-ar">${escapeHtml(t("dashboard.rewardTextAr"))}</label><input id="reward-text-ar" class="rtl-input" name="rewardTextAr" maxlength="200" value="${escapeHtml(defaultSetting.rewardTextAr || "")}" required /></div><p class="form-error" id="settings-error" role="alert"></p><button class="button ghost" type="submit">${escapeHtml(t("dashboard.saveRules"))}</button></form></article></div>
      <div id="reset-result" aria-live="polite"></div><div class="panel"><div class="panel-head"><div><h3>${escapeHtml(t("dashboard.members"))}</h3><span class="subtle">${escapeHtml(t("dashboard.membersHint"))}</span></div><span class="hint">${escapeHtml(t("dashboard.showing", { start: pageStart, end: pageEnd, total: safeNumber(customerPage.total) }))}</span></div><div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("dashboard.thMember"))}</th><th>${escapeHtml(t("dashboard.thPhone"))}</th><th>${escapeHtml(t("dashboard.thPoints"))}</th><th>${escapeHtml(t("dashboard.thScans"))}</th><th>${escapeHtml(t("dashboard.thLast"))}</th><th>${escapeHtml(t("dashboard.thAccount"))}</th></tr></thead><tbody>${(data.customers || []).map(customer => `<tr><td>${escapeHtml(customer.displayName)}<br><bdi class="hint" dir="ltr">${escapeHtml(customer.memberCode)}</bdi></td><td><bdi dir="ltr">${escapeHtml(customer.maskedPhone)}</bdi></td><td>${activityBadges(customer.activityBalances)}</td><td>${safeNumber(customer.scanCount)}</td><td>${escapeHtml(formatDubaiDateTime(customer.lastScannedAt))}</td><td><button class="button ghost reset-pin" data-customer-id="${escapeHtml(customer.customerId)}">${escapeHtml(t("dashboard.resetPin"))}</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">${escapeHtml(t("dashboard.noMembers"))}</td></tr>`}</tbody></table></div><div class="page-controls">${safeNumber(customerPage.offset) > 0 ? `<button class="button ghost" data-route="dashboard/${Math.max(0, safeNumber(customerPage.offset) - safeNumber(customerPage.limit))}">${escapeHtml(t("dashboard.previous"))}</button>` : ""}${customerPage.hasMore ? `<button class="button ghost" data-route="dashboard/${safeNumber(customerPage.offset) + safeNumber(customerPage.limit)}">${escapeHtml(t("dashboard.next"))}</button>` : ""}</div></div>
      <div class="panel history-panel"><div class="panel-head"><div><h3>${escapeHtml(t("dashboard.history"))}</h3><span class="subtle">${escapeHtml(t("dashboard.historyHint"))}</span></div></div><div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("dashboard.thTime"))}</th><th>${escapeHtml(t("dashboard.thMember"))}</th><th>${escapeHtml(t("dashboard.thActivity"))}</th><th>${escapeHtml(t("dashboard.thEvent"))}</th><th>${escapeHtml(t("dashboard.thChange"))}</th><th>${escapeHtml(t("dashboard.thBalance"))}</th></tr></thead><tbody>${(data.recentEvents || []).map(event => `<tr><td>${escapeHtml(formatDubaiDateTime(event.occurredAt))}</td><td>${escapeHtml(event.displayName)}<br><bdi class="hint" dir="ltr">${escapeHtml(event.memberCode)}</bdi></td><td>${escapeHtml(activityName(event.activitySlug))}</td><td>${escapeHtml(eventActionLabel(event.action))}</td><td>${escapeHtml(eventChange(event))}</td><td><bdi dir="ltr">${safeNumber(event.balanceBefore)} → ${safeNumber(event.balanceAfter)}</bdi></td></tr>`).join("") || `<tr><td colspan="6" class="empty">${escapeHtml(t("dashboard.noActivity"))}</td></tr>`}</tbody></table></div></div>
      </section>`;
    settleViewPosition();
    document.querySelector("#owner-logout")?.addEventListener("click", () => { ownerAccessToken = null; ownerMemberSearchState = { query: "", members: null, status: "idle" }; location.hash = "#/"; });
    bindOwnerMemberSearch();
    document.querySelectorAll(".reset-pin").forEach(button => button.addEventListener("click", () => createResetCode(button)));
    bindActivitySettings(activitySettings);
  } catch (error) {
    if (generation !== renderGeneration) return;
    if (ownerSessionEnded(error)) return;
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">${escapeHtml(t("dashboard.unavailable"))}</p><h2>${escapeHtml(t("dashboard.sessionSaved"))}</h2><p>${escapeHtml(localizeError(error))}</p><div class="actions"><button class="button primary" data-route="dashboard">${escapeHtml(t("common.retry"))}</button><button class="button secondary" data-route="passport">${escapeHtml(t("dashboard.customerPassport"))}</button></div></div></section>`;
    settleViewPosition();
  }
}

async function createResetCode(button) {
  const result = document.querySelector("#reset-result");
  if (!result) return;
  button.disabled = true;
  try {
    const data = await callApi("owner-create-pin-reset", { customerId: button.dataset.customerId, expiresInMinutes: 15 }, ownerAccessToken);
    const qr = data.resetQrSvg ? `<div class="code-qr">${data.resetQrSvg}</div>` : "";
    result.innerHTML = `<div class="notice reset-notice"><strong>${escapeHtml(t("reset.title", { name: data.displayName }))}</strong><div class="setup-code-grid">${qr}<div><bdi class="code-display compact" dir="ltr">${escapeHtml(data.resetCode)}</bdi><span>${escapeHtml(t("reset.instructions", { date: formatDubaiDateTime(data.expiresAt) }))}</span><button class="button ghost copy-code" data-code="${escapeHtml(data.resetCode)}">${escapeHtml(t("reset.copy"))}</button></div></div></div>`;
    result.querySelector(".copy-code")?.addEventListener("click", copyCode);
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    if (ownerSessionEnded(error)) return;
    result.innerHTML = `<div class="notice">${escapeHtml(localizeError(error))}</div>`;
  }
  finally { if (button.isConnected) button.disabled = false; }
}

async function copyCode(event) {
  try {
    await navigator.clipboard.writeText(event.currentTarget.dataset.code || "");
    showToast(t("reset.copied"));
  } catch {
    showToast(t("reset.copyManual"));
  }
}

function bindActivitySettings(settings) {
  const form = document.querySelector("#activity-settings");
  const select = document.querySelector("#settings-activity");
  if (!form || !select) return;
  const populate = () => { const item = settings.find(setting => setting.slug === select.value); if (!item) return; form.elements.pointsPerVisit.value = item.pointsPerVisit; form.elements.rewardThreshold.value = item.rewardThreshold; form.elements.rewardText.value = item.rewardText; form.elements.rewardTextAr.value = item.rewardTextAr || ""; };
  select.addEventListener("change", populate);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const errorElement = document.querySelector("#settings-error");
    const values = new FormData(form);
    submit.disabled = true; errorElement.textContent = "";
    try {
      await callApi("owner-update-activity-settings", { activitySlug: values.get("activitySlug"), pointsPerVisit: Number(values.get("pointsPerVisit")), rewardThreshold: Number(values.get("rewardThreshold")), rewardText: values.get("rewardText"), rewardTextAr: values.get("rewardTextAr") }, ownerAccessToken);
      showToast(t("dashboard.rulesSaved"));
      await render();
    } catch (error) { errorElement.textContent = localizeError(error); submit.disabled = false; }
  });
}

function scannerView(prefill = "") {
  if (!ownerAccessToken) { location.hash = "#/admin"; return ""; }
  return `<section class="shell narrow"><div class="panel"><div class="panel-head"><div><p class="eyebrow">${escapeHtml(t("scanner.eyebrow"))}</p><h2>${escapeHtml(t("scanner.title"))}</h2></div><button class="text-button" data-route="dashboard">${escapeHtml(t("common.close"))}</button></div><div class="scan-box"><video id="scanner-video" class="scanner-video" playsinline muted></video><button id="start-scanner" class="button primary">${escapeHtml(t("scanner.start"))}</button><p class="hint">${escapeHtml(t("scanner.hint"))}</p><div class="field"><label for="scan-value">${escapeHtml(t("scanner.paste"))}</label><input id="scan-value" class="ltr-input" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="off" spellcheck="false" /></div><button id="lookup-code" class="button secondary">${escapeHtml(t("scanner.review"))}</button><div id="scan-result" aria-live="polite"></div></div></div></section>`;
}

function privacyView() {
  return `<section class="shell narrow"><div class="panel"><p class="eyebrow">${escapeHtml(t("privacy.eyebrow"))}</p><h2>${escapeHtml(t("privacy.title"))}</h2><p>${escapeHtml(t("privacy.p1"))}</p><p>${escapeHtml(t("privacy.p2"))}</p><p>${escapeHtml(t("privacy.p3"))}</p><button class="button secondary" data-route="passport">${escapeHtml(t("privacy.back"))}</button></div></section>`;
}

async function installApp() {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showToast(isiOS ? t("install.ios") : t("install.other"));
}

async function startScanner() {
  const video = document.querySelector("#scanner-video");
  const supportsNativeDetector = "BarcodeDetector" in window;
  const supportsFallbackDetector = typeof window.jsQR === "function";
  if (!supportsNativeDetector && !supportsFallbackDetector) { showToast(t("scanner.cameraFallback")); return; }
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
  } catch { showToast(t("scanner.cameraUnavailable")); }
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
    result.innerHTML = `<div class="loading">${escapeHtml(t("scanner.verifying"))}</div>`;
    const data = await callApi("owner-scan", { scanToken }, ownerAccessToken);
    scanLoaded = true;
    const selected = activityMeta(data.activity?.slug);
    const rewardsAvailable = safeNumber(data.rewardsAvailable);
    const redeemButton = rewardsAvailable > 0 ? `<button id="redeem-reward" class="button reward-button">${escapeHtml(t("scanner.redeem", { activity: selected.name }))}</button>` : "";
    const rewardText = getLanguage() === "ar" ? (data.rewardTextAr || data.rewardText) : data.rewardText;
    result.innerHTML = `<div class="scan-result"><span class="pill">${escapeHtml(t("scanner.recorded"))}</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(t("scanner.summary", { points: countLabel(data.points, "point"), rewards: countLabel(rewardsAvailable, "reward"), scans: countLabel(data.scanCount, "scan") }))}</span></div></div><p class="subtle">${escapeHtml(t("scanner.previous", { activity: selected.name, date: formatDubaiDateTime(data.previousScanAt) }))}</p><p>${escapeHtml(rewardText || "")} ${escapeHtml(t("scanner.confirmHint"))}</p><div class="actions"><button id="confirm-point" class="button primary">${escapeHtml(t("scanner.confirm", { activity: selected.name, points: safeNumber(data.pointsPerVisit) }))}</button>${redeemButton}<button id="cancel-scan" class="button ghost">${escapeHtml(t("scanner.cancel"))}</button></div></div>`;
    document.querySelector("#confirm-point")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try {
        const receipt = await callApi("owner-add-visit-point", { scanEventId: data.scanEventId, idempotencyKey: randomIdempotencyKey() }, ownerAccessToken);
        result.innerHTML = `<div class="scan-result"><span class="pill">${escapeHtml(t("scanner.confirmed"))}</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(t("scanner.newBalance", { points: countLabel(receipt.points, "point"), rewards: countLabel(receipt.rewardsAvailable, "reward") }))}</span></div></div><p class="hint">${escapeHtml(t("common.transaction", { id: receipt.transactionId }))}</p><button class="button primary" data-route="scanner">${escapeHtml(t("scanner.next"))}</button></div>`;
      } catch (error) { showToast(localizeError(error)); setTransactionActionsDisabled(result, false); }
    });
    document.querySelector("#redeem-reward")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try {
        const receipt = await callApi("owner-redeem-reward", { scanEventId: data.scanEventId, idempotencyKey: randomIdempotencyKey() }, ownerAccessToken);
        result.innerHTML = `<div class="scan-result"><span class="pill">${escapeHtml(t("scanner.redeemed"))}</span><h3>${escapeHtml(data.displayName)}</h3><div class="scan-activity"><img src="${selected.icon}" alt="" width="56" height="56" /><div><strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(t("scanner.remaining", { points: countLabel(receipt.points, "point"), rewards: countLabel(receipt.rewardsAvailable, "reward") }))}</span></div></div><p class="hint">${escapeHtml(t("common.transaction", { id: receipt.transactionId }))}</p><button class="button primary" data-route="scanner">${escapeHtml(t("scanner.next"))}</button></div>`;
      } catch (error) { showToast(localizeError(error)); setTransactionActionsDisabled(result, false); }
    });
    document.querySelector("#cancel-scan")?.addEventListener("click", async event => {
      setTransactionActionsDisabled(result, true);
      try { await callApi("owner-cancel-scan", { scanEventId: data.scanEventId }, ownerAccessToken); result.innerHTML = `<div class="notice">${escapeHtml(t("scanner.cancelled"))}</div>`; }
      catch (error) { showToast(localizeError(error)); setTransactionActionsDisabled(result, false); }
    });
  } catch (error) { result.innerHTML = `<div class="notice">${escapeHtml(localizeError(error))}</div>`; }
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
    try { const pin = validatePin(form.get("pin")); if (pin !== form.get("pinConfirm")) throw new Error("PINs do not match."); const data = await callApi("enroll", { displayName: form.get("name"), phone: normalizePhone(form.get("phone")), pin, consent: form.get("consent") === "on" }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = localizeError(error); setFormBusy(formElement, false); }
  });
  if (route === "login") document.querySelector("#customer-login")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#login-error"); errorElement.textContent = "";
    try { const data = await callApi("customer-login", { phone: normalizePhone(form.get("phone")), pin: validatePin(form.get("pin")) }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = localizeError(error); setFormBusy(formElement, false); }
  });
  if (route === "recover") document.querySelector("#recover-form")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#recover-error"); errorElement.textContent = "";
    try { const pin = validatePin(form.get("pin")); if (pin !== form.get("pinConfirm")) throw new Error("PINs do not match."); const data = await callApi("recover-pin", { phone: normalizePhone(form.get("phone")), resetCode: form.get("resetCode"), newPin: pin }); localStorage.setItem(customerKey, data.sessionToken); localStorage.setItem(qrKey, data.qrToken); location.hash = "#/member/laser-tag"; }
    catch (error) { errorElement.textContent = localizeError(error); setFormBusy(formElement, false); }
  });
  if (route === "owner" || route === "admin") document.querySelector("#owner-login")?.addEventListener("submit", async event => {
    event.preventDefault(); const formElement = event.currentTarget; setFormBusy(formElement, true); const form = new FormData(formElement); const errorElement = document.querySelector("#owner-error"); errorElement.textContent = "";
    try { const token = await ownerLogin(form.get("email"), form.get("password")); await callApi("owner-check", {}, token); ownerAccessToken = token; const pending = pendingScanToken; pendingScanToken = ""; location.hash = pending ? `#/scan/${pending}` : "#/dashboard"; }
    catch (error) { errorElement.textContent = localizeError(error); setFormBusy(formElement, false); }
  });
  if (route === "scanner") { document.querySelector("#start-scanner")?.addEventListener("click", startScanner); document.querySelector("#lookup-code")?.addEventListener("click", () => lookupCode(document.querySelector("#scan-value").value)); }
}

async function render() {
  stopScanner();
  const generation = ++renderGeneration;
  if (window.top !== window.self) {
    app.innerHTML = `<section class="shell narrow"><div class="panel"><p class="eyebrow">${escapeHtml(t("iframe.eyebrow"))}</p><h2>${escapeHtml(t("iframe.title"))}</h2><p>${escapeHtml(t("iframe.body"))}</p></div></section>`;
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
  if (route === "join") { app.innerHTML = joinView(); bindForms("join"); settleViewPosition(); return; }
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
