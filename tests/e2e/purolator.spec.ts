import { test, expect } from "@playwright/test";
test("Purolator settings isolate environments and enabled rates appear in the comparison table", async ({ page }) => {
  test.setTimeout(90000);
  await page.route("**/sandbox/api/v1/postal-suggestions?*", route => route.fulfill({ json: { country: "CA", lookupCode: "", precision: "area", suggestions: [], message: null } }));
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/sandbox/api/v1/auth/login", { headers: { Origin: origin }, data: { email: "e2e@example.invalid", password: "fixture-password-only", channel: "web" } })).ok()).toBeTruthy();
  await page.goto("/sandbox/rate");
  await expect(page.getByRole("checkbox", { name: "Purolator", exact: true })).toHaveCount(0);
  await page.goto("/sandbox/setting?section=companies");
  await page.getByRole("tab", { name: "API connections", exact: true }).click();
  const card = page.locator("form.carrier-setting-card").filter({ has: page.getByRole("heading", { name: "Purolator", exact: true }) });
  await expect(card.getByRole("checkbox", { name: "Enabled", exact: true })).not.toBeChecked();
  await expect(card.getByLabel("REST API key (x-api-key) (optional in UAT)", { exact: true })).toHaveValue("");
  await card.getByLabel("Client ID / key", { exact: true }).fill("synthetic-client");
  await card.getByLabel("Client secret / password", { exact: true }).fill("synthetic-secret");
  await card.getByLabel("Test sender account", { exact: true }).fill("sender-test");
  await card.getByLabel("Test receiver account (optional)", { exact: true }).fill("receiver-test");
  await card.getByLabel("Test freight account (optional)", { exact: true }).fill("freight-test");
  await card.getByRole("checkbox", { name: "Enabled", exact: true }).check();
  await card.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(card.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await expect(card.getByLabel("REST API key (x-api-key) (optional in UAT)", { exact: true })).toHaveValue("");
  await expect(card.getByLabel("Client secret / password", { exact: true })).toHaveAttribute("placeholder", "Saved — leave blank to keep");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const production = await page.request.get("/api/v1/carrier-settings");
  expect((await production.json()).settings.find((setting: { carrier: string }) => setting.carrier === "purolator")).toMatchObject({ enabled: false, configured: false, baseUrl: "https://shipapi.purolator.com" });
  await page.goto("/sandbox/rate");
  await expect(page.getByRole("checkbox", { name: "Purolator", exact: true })).toBeChecked();
  await expect(page.getByLabel("Boxes", { exact: true })).toHaveValue("1");
  await page.getByLabel("Boxes", { exact: true }).fill("3");
  await page.locator("#weight").fill("2");
  await expect(page.getByText("Total weight: 6 lb.", { exact: false })).toBeVisible();
  for (const name of ["Canada Post", "Loomis Express", "FedEx"]) await page.getByRole("checkbox", { name, exact: true }).uncheck();
  for (const prefix of ["from", "to"]) {
    await page.locator(`#${prefix}-city`).fill(prefix === "from" ? "Richmond" : "Toronto");
    await page.locator(`#${prefix}-region`).fill(prefix === "from" ? "BC" : "ON");
    await page.locator(`#${prefix}-postal_code`).fill(prefix === "from" ? "V6V2K9" : "M5V2T6");
  }
  await page.route("**/sandbox/api/v1/rates", async route => {
    const request = route.request().postDataJSON(); expect(request.carriers).toEqual(["purolator"]); expect(request.packages[0]).toMatchObject({ quantity: 3, weight: 2 });
    await route.fulfill({ json: { requestId: "puro-ui-test", quotedAt: new Date().toISOString(), mode: "sandbox", appEnvironment: "development", carrierStatuses: [{ carrier: "purolator", mode: "sandbox", source: "live_carrier", status: "success", message: null }], results: [{ carrier: "purolator", mode: "sandbox", source: "live_carrier", serviceCode: "PurolatorGround", serviceName: "Purolator Ground", variant: "courier:account", currency: "CAD", eta: { kind: "estimated_date", date: "2026-10-19", businessDays: 2 }, signature: { requested: true, available: true, includedInQuote: true }, withoutCoverage: { available: true, total: "12.60", taxIncluded: true, preTaxTotal: "12.00", breakdown: [] }, withCoverage: { available: false, total: null, taxIncluded: null, preTaxTotal: null, breakdown: [], declaredValue: null, status: "not_quoted" }, coverageDifference: null, notices: [] }] } });
  });
  await page.getByRole("button", { name: "Compare rates", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Purolator Ground" })).toBeVisible();
  await expect(page.getByText("2026-10-19 · 2 business days", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("purolator-rates.png"), fullPage: true });
});
