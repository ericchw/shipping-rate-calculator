import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
test("sandbox banner, retained quote snapshots, copy toasts and full-page JPG download", async ({ page }) => {
  test.setTimeout(60000);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await page.route("**/sandbox/api/v1/postal-suggestions?*", (route) => route.fulfill({ json: { country: "CA", lookupCode: new URL(route.request().url()).searchParams.get("postalCode")!.slice(0, 3), precision: "area", suggestions: [], message: null } }));
  expect((await page.request.post("/sandbox/api/v1/auth/login", { headers: { Origin: origin }, data: { email: "e2e@example.invalid", password: "fixture-password-only", channel: "web" } })).ok()).toBeTruthy();
  for (const [carrier, baseUrl] of Object.entries({ canada_post: "https://ct.soa-gw.canadapost.ca", fedex: "https://apis-sandbox.fedex.com", loomis: "https://sandbox.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/" })) {
    expect((await page.request.put(`/sandbox/api/v1/carrier-settings/sandbox/${carrier}`, { headers: { Origin: origin }, data: { enabled: true, baseUrl, fields: {} } })).ok()).toBeTruthy();
  }
  await page.goto("/sandbox/rate");
  await expect(page.locator(".sandbox-environment-banner")).toHaveText("SANDBOX Environment");
  const banner = await page.locator(".sandbox-environment-banner").boundingBox();
  expect(banner!.y).toBe(0);
  expect(banner!.width).toBe(await page.evaluate(() => innerWidth));
  for (const prefix of ["from", "to"]) {
    await page.locator(`#${prefix}-city`).fill("Vancouver");
    await page.locator(`#${prefix}-region`).fill("BC");
    await page.locator(`#${prefix}-postal_code`).fill("V6B1A1");
  }
  await page.getByRole("button", { name: "Compare rates", exact: true }).click();
  await expect(page.getByText("QUOTES READY", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare rates", exact: true })).toBeEnabled();
  const table = page.locator('section[aria-label="Rate comparison"] tbody');
  const original = await table.innerText();
  await page.locator("#to-city").fill("Victoria");
  await page.locator("#weight").fill("5");
  await page.getByLabel("Coverage / declared value (CAD)").fill("150");
  await page.getByLabel("Signature required", { exact: true }).uncheck();
  expect(await table.innerText()).toBe(original);
  await expect(page.getByText("Shipment details changed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Generate 4 sandbox labels/)).toHaveCount(0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy table", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Table copied:" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Ship To: BC · Vancouver · V6B1A1");
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain("Victoria");
  await expect(page.locator("p.subtle[role=status]")).toHaveCount(0);
  await page.locator(".toast").filter({ hasText: "Table copied:" }).getByRole("button", { name: "Dismiss notification" }).click();
  const pageHeight = await page.locator("[data-page-capture]").evaluate((element) => element.scrollHeight);
  const signature = await page.getByLabel("Signature required", { exact: true }).evaluate((input) => {
    const rect = input.getBoundingClientRect();
    const root = document.querySelector("[data-page-capture]")!.getBoundingClientRect();
    return { x: rect.x - root.x, y: rect.y - root.y, width: rect.width, height: rect.height, pageWidth: root.width };
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Copy image", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("shipping-calculator.jpg");
  const target = test.info().outputPath("full-page.jpg");
  await file.saveAs(target);
  const jpg = readFileSync(target);
  expect(jpg.subarray(0, 2).toString("hex")).toBe("ffd8");
  const image = await page.evaluate(async ({ base64, signature }) => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const scale = image.width / signature.pageWidth;
    const pixels = context.getImageData(Math.round(signature.x * scale), Math.round(signature.y * scale), Math.max(1, Math.round(signature.width * scale)), Math.max(1, Math.round(signature.height * scale))).data;
    let red = 0; for (let i = 0; i < pixels.length; i += 4) red += pixels[i];
    return { width: image.width, height: image.height, bannerPixel: [...context.getImageData(10, 10, 1, 1).data], checkboxRed: red / (pixels.length / 4) };
  }, { base64: jpg.toString("base64"), signature });
  expect(image.height).toBeGreaterThanOrEqual(pageHeight);
  expect(image.bannerPixel[0]).toBeGreaterThan(180);
  expect(image.bannerPixel[2]).toBeLessThan(150);
  expect(image.checkboxRed).toBeGreaterThan(180);
  await expect(page.locator(".toast").filter({ hasText: "Full page downloaded" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("sandbox-rates.png"), fullPage: true });
  await page.goto("/rate");
  await expect(page.getByRole("heading", { name: "Compare shipping rates" })).toBeVisible();
  await expect(page.locator(".sandbox-environment-banner")).toHaveCount(0);
});
