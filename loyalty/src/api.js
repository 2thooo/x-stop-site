const config = window.LOYALTY_CONFIG;

export function isConfigured() {
  return config?.supabaseUrl && !config.supabaseUrl.includes("YOUR-PROJECT") &&
    config?.supabaseAnonKey && !config.supabaseAnonKey.includes("YOUR-PUBLIC");
}

function functionUrl() {
  return `${config.supabaseUrl}/functions/v1/${config.functionName}`;
}

export async function callApi(action, payload = {}, ownerToken = null) {
  if (!isConfigured()) throw new Error("Connect the site to Supabase in config.js first.");
  const headers = {
    "Content-Type": "application/json",
    "apikey": config.supabaseAnonKey
  };
  if (ownerToken) headers.Authorization = `Bearer ${ownerToken}`;
  const response = await fetch(functionUrl(), {
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
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": config.supabaseAnonKey },
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
