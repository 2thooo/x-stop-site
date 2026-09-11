export function normalizePhone(input, countryCode = "971") {
  let value = String(input || "").trim().replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (countryCode === "971") {
    if (/^05\d{8}$/.test(value)) value = `+971${value.slice(1)}`;
    else if (/^5\d{8}$/.test(value)) value = `+971${value}`;
    else if (/^9715\d{8}$/.test(value)) value = `+${value}`;
    else if (/^(?:\+971)05\d{8}$/.test(value)) value = `+971${value.slice(-9)}`;
  }
  if (value.startsWith("0")) value = `+${countryCode}${value.slice(1)}`;
  if (!value.startsWith("+")) value = `+${value}`;
  if (/^\+9710/.test(value)) throw new Error("Enter a valid UAE mobile number without the domestic zero after +971.");
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error("Enter a valid phone number including country code.");
  return value;
}

export function validatePin(pin) {
  if (!/^\d{6}$/.test(String(pin || ""))) throw new Error("PIN must contain exactly 6 digits.");
  return String(pin);
}

export function validateNewPin(pin) {
  const value = validatePin(pin);
  const repeated = new Set(value).size === 1;
  const sequential = "0123456789".includes(value) || "9876543210".includes(value);
  const common = new Set(["121212", "112233", "123123", "654654", "000001", "999999"]);
  if (repeated || sequential || common.has(value)) throw new Error("Choose a less predictable 6-digit PIN.");
  return value;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

export function formatDubaiTime(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-AE", {
    timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short"
  }).format(new Date(value));
}

export function randomIdempotencyKey() {
  return crypto.randomUUID();
}

export function parseQrPayload(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("loyalty:v1:")) return raw.slice("loyalty:v1:".length);
  const fragmentMatch = raw.match(/#\/scan\/([A-Za-z0-9_-]{40,})/);
  if (fragmentMatch) return fragmentMatch[1];
  if (/^[A-Za-z0-9_-]{40,}$/.test(raw)) return raw;
  throw new Error("This is not a valid loyalty QR code.");
}
