import { afterEach, expect, it, vi } from "vitest";
import { clientApi } from "../src/lib/client-api";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("redirects expired sessions to the matching login and preserves the current page", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/sandbox/rate", assign } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Sign in to continue" } }), { status: 401 })));
  await expect(clientApi("sandbox", "rates", "POST", {})).rejects.toThrow("Sign in");
  expect(assign).toHaveBeenCalledWith("/sandbox/login?next=%2Fsandbox%2Frate");
});
it("keeps incorrect login credentials on the login form", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/login", assign } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid email or password" } }), { status: 401 })));
  await expect(clientApi("production", "auth/login", "POST", {})).rejects.toThrow("Invalid email");
  expect(assign).not.toHaveBeenCalled();
});

it("keeps the connection-check timeout when an administrator selects a company group", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success" }))));
  await clientApi("sandbox", "carrier-settings/sandbox/loomis/test?groupId=company", "POST");
  expect(timeout).toHaveBeenCalledWith(45000);
});
