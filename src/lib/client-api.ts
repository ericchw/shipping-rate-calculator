import { apiPath, pagePath, type AppMode } from "./app-routes";
export function redirectToLogin(mode: AppMode) {
  if (window.location.pathname !== pagePath(mode, "login"))
    window.location.assign(`${pagePath(mode, "login")}?next=${encodeURIComponent(window.location.pathname)}`);
}
export async function clientApi(mode: AppMode, path: string, method = "GET", value?: unknown) {
  const route = path.split("?")[0];
  const response = await fetch(apiPath(mode, path), {
    method, headers: value === undefined ? {} : { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(route === "loomis/labels" || route === "rates" || route.endsWith("/test") ? 45000 : 15000),
  });
  if (response.status === 401 && path !== "auth/login") redirectToLogin(mode);
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.details?.length
    ? data.error.details.map((detail: { path: string[]; message: string }) => `${detail.path.join(".")}: ${detail.message}`).join("; ")
    : data.error?.message ?? "Request failed");
  return data;
}
