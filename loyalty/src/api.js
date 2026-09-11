const config = window.LOYALTY_CONFIG;
const requestTimeoutMs = 15000;

function configuredSupabaseUrl() {
  try {
    const url = new URL(String(config?.supabaseUrl || ""));
    const validHost = /^[a-z0-9]{20}\.supabase\.co$/i.test(url.hostname);
    if (url.protocol !== "https:" || !validHost || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}

async function secureFetch(url, options) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The service took too long to respond. Try again.");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function isConfigured() {
  return configuredSupabaseUrl() && !config.supabaseUrl.includes("YOUR-PROJECT") &&
    config?.supabaseAnonKey && !config.supabaseAnonKey.includes("YOUR-PUBLIC");
}

function functionUrl() {
  const origin = configuredSupabaseUrl();
  if (!origin || !/^[a-z0-9-]{1,63}$/i.test(String(config.functionName || ""))) throw new Error("Connect the site to Supabase in config.js first.");
  return `${origin}/functions/v1/${config.functionName}`;
}

export async function callApi(action, payload = {}, ownerToken = null) {
  if (!isConfigured()) throw new Error("Connect the site to Supabase in config.js first.");
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "apikey": config.supabaseAnonKey
  };
  if (ownerToken) headers.Authorization = `Bearer ${ownerToken}`;
  const response = await secureFetch(functionUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function ownerLogin(email, password) {
  if (!isConfigured()) throw new Error("Connect the site to Supabase in config.js first.");
  const response = await secureFetch(`${configuredSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json", "apikey": config.supabaseAnonKey },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Owner sign-in failed.");
    error.status = response.status;
    throw error;
  }
  return data.access_token;
}
