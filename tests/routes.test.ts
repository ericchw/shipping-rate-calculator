import { describe, expect, it } from "vitest";
import { apiPath, pagePath, requestMode, safeReturnPath } from "../src/lib/app-routes";
describe("production and sandbox routes", () => {
  it("keeps production at the root and sandbox under its own prefix", () => {
    expect(pagePath("production", "login")).toBe("/login");
    expect(pagePath("production", "rate")).toBe("/rate");
    expect(pagePath("sandbox", "setting")).toBe("/sandbox/setting");
    expect(apiPath("sandbox", "rates")).toBe("/sandbox/api/v1/rates");
    expect(requestMode("http://localhost:3000/api/v1/rates")).toBe("production");
    expect(requestMode("http://localhost:3000/sandbox/api/v1/rates")).toBe("sandbox");
  });
  it("allows only protected return pages in the same environment", () => {
    expect(safeReturnPath("production", "/rate")).toBe("/rate");
    expect(safeReturnPath("sandbox", "/sandbox/setting")).toBe("/sandbox/setting");
    for (const path of ["https://evil.test", "//evil.test", "/sandbox/rate", "/login", "/rate?next=//evil.test"])
      expect(safeReturnPath("production", path)).toBe("/home");
    expect(safeReturnPath("sandbox", "/rate")).toBe("/sandbox/home");
  });
});

import { browserUser } from "../src/lib/app-routes";
it("keeps API-only sessions on the browser login page", () => {
  expect(browserUser({ channel: "api", webAccess: true })).toBeNull();
  expect(browserUser({ channel: "web", webAccess: false })).toBeNull();
  expect(browserUser({ channel: "web", webAccess: true })).toEqual({ channel: "web", webAccess: true });
});
