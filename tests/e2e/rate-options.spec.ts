import { test, expect } from "@playwright/test";
test("rates hide disabled carriers and preserve zero dimensions while omitting them from carrier requests", async ({ page }) => {
  test.setTimeout(60000);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await page.route("**/sandbox/api/v1/postal-suggestions?*", (route) => route.fulfill({ json: { country: "CA", lookupCode: "V6B", precision: "area", suggestions: [], message: null } }));
  expect((await page.request.post("/sandbox/api/v1/auth/login", { headers: { Origin: origin }, data: { email: "e2e@example.invalid", password: "fixture-password-only", channel: "web" } })).ok()).toBeTruthy();
  const disable = async (carrier: string, baseUrl: string) => {
    const response = await page.request.put(`/sandbox/api/v1/carrier-settings/sandbox/${carrier}`, { headers: { Origin: origin }, data: { enabled: false, baseUrl, fields: {} } });
    expect(response.ok()).toBeTruthy();
  };
  await disable("fedex", "https://apis-sandbox.fedex.com");
  await page.goto("/sandbox/rate");
  await expect(page.getByRole("checkbox", { name: "Canada Post", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Loomis Express", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "FedEx", exact: true })).toHaveCount(0);
  await expect(page.locator("#weight")).toHaveValue("1");
  for (const field of ["length", "width", "height"]) await expect(page.locator(`#${field}`)).toHaveValue("0");
  for (const prefix of ["from", "to"]) {
    await page.locator(`#${prefix}-city`).fill("Vancouver");
    await page.locator(`#${prefix}-region`).fill("BC");
    await page.locator(`#${prefix}-postal_code`).fill("V6B1A1");
  }
  const sent: { carriers: string[]; packages: { length: number; width: number; height: number }[] }[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/v1/rates") && request.method() === "POST") sent.push(request.postDataJSON()); });
  await page.getByRole("button", { name: "Compare rates", exact: true }).click();
  await expect(page.getByText("QUOTES READY", { exact: true })).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent.flatMap((request) => request.carriers).sort()).toEqual(["canada_post", "loomis"]);
  for (const request of sent) expect(request.packages[0]).toMatchObject({ length: 0, width: 0, height: 0 });
  for (const field of ["length", "width", "height"]) await expect(page.locator(`#${field}`)).toHaveValue("0");
  await page.locator("#length").fill("1");
  await page.getByRole("button", { name: "Compare rates", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter all three dimensions" })).toBeVisible();
  expect(sent).toHaveLength(2);
  await disable("canada_post", "https://ct.soa-gw.canadapost.ca");
  await disable("loomis", "https://sandbox.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByText("No carriers enabled for your company group.", { exact: false })).toBeVisible();
  await expect(page.locator(".quote-carriers input[type=checkbox]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare rates", exact: true })).toBeDisabled();
});
