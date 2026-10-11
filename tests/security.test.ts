import { it, expect, vi, afterEach } from "vitest";
import { body, sameOrigin } from "../src/lib/security";
import { passwordHash, verifyPassword, apiKeyValid } from "../src/lib/auth";
afterEach(() => vi.unstubAllEnvs());
it("rejects missing/foreign Origin", () => {
  vi.stubEnv("APP_ORIGIN", "https://shipping.example.com");
  expect(() =>
    sameOrigin(new Request("https://shipping.example.com/api/v1/rates")),
  ).toThrow();
  expect(() =>
    sameOrigin(
      new Request("https://shipping.example.com/api/v1/rates", {
        headers: { Origin: "https://attacker.example" },
      }),
    ),
  ).toThrow();
  expect(() =>
    sameOrigin(
      new Request("https://shipping.example.com/api/v1/rates", {
        headers: { Origin: "https://shipping.example.com" },
      }),
    ),
  ).not.toThrow();
});
it("enforces streamed body size", async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x: "x".repeat(17000) }),
  });
  await expect(body(request)).rejects.toMatchObject({ status: 413 });
});
it("hashes passwords and compares API keys", async () => {
  const hash = await passwordHash("a private test password");
  expect(hash).not.toContain("a private");
  expect(await verifyPassword("a private test password", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
  vi.stubEnv("APP_API_KEY", "x".repeat(32));
  expect(
    apiKeyValid(
      new Request("https://example.com", {
        headers: { Authorization: `Bearer ${"x".repeat(32)}` },
      }),
    ),
  ).toBe(true);
  expect(
    apiKeyValid(
      new Request("https://example.com", {
        headers: { Authorization: "Bearer bad" },
      }),
    ),
  ).toBe(false);
});
