export type AppMode = "sandbox" | "production";
export type AppPage = "labels" | "home" | "rate" | "setting" | "docs" | "admin" | "login";
export const areaPrefix = (mode: AppMode) => mode === "sandbox" ? "/sandbox" : "";
export const pagePath = (mode: AppMode, page: AppPage) => `${areaPrefix(mode)}/${page}`;
export const apiPath = (mode: AppMode, path: string) => `${areaPrefix(mode)}/api/v1/${path}`;
export function requestMode(url: string): AppMode {
  return new URL(url).pathname.startsWith("/sandbox/api/v1/") ? "sandbox" : "production";
}
export function safeReturnPath(mode: AppMode, candidate: string | null) {
  if (candidate && new RegExp(`^${areaPrefix(mode)}/labels/[0-9a-f-]{36}$`, "i").test(candidate)) return candidate;
  return ["home", "rate", "setting", "docs", "admin", "labels"].map((page) => pagePath(mode, page as AppPage)).includes(candidate ?? "")
    ? candidate! : pagePath(mode, "home");
}

export function browserUser<T extends { channel?: string; webAccess?: boolean }>(user: T | null): T | null {
  return user && user.channel !== "api" && user.webAccess !== false ? user : null;
}
