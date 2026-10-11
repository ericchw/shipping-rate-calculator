import { test, expect } from "@playwright/test";
test("calculator hydrates and leaves the initial loading screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sandbox/rate");
  await expect(page).toHaveTitle("Shipping Rate Calculator");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a stalled session request shows an error instead of loading forever", async ({ page }) => {
  await page.route("**/api/v1/auth/session", () => {});
  await page.goto("/sandbox/rate");
  await expect(page.getByRole("alert").filter({ hasText: "The server took too long" })).toContainText(
    "The server took too long to respond",
    { timeout: 20000 },
  );
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("profile persistence, independent addresses, unit conversion and mock comparisons", async ({
  page,
}) => {
  await page.goto("/sandbox/rate");
  await page.getByLabel("Email", { exact: true }).fill("e2e@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-password-only");
  const profilesLoaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/ship-from-profiles"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await profilesLoaded;
  await expect(page.getByText("MOCK FIXTURES", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imperial · lb / in", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const field of ["weight", "length", "width", "height"]) await expect(page.locator(`#${field}`)).toHaveValue("0");
  await page.locator("#weight").fill("");
  await expect(page.locator("#weight")).toHaveValue("");
  await page.getByRole("button", { name: "Metric · kg / cm", exact: true }).click();
  await expect(page.locator("#weight")).toHaveValue("");
  await page.getByRole("button", { name: "Imperial · lb / in", exact: true }).click();
  const fromSection = page.locator("details.shipment-section").first();
  const profileSelect = page.getByLabel("Saved Ship From Profile");
  if ((await fromSection.getAttribute("open")) === null)
    await fromSection.locator(":scope > summary").click();
  await profileSelect.selectOption("");
  await page.locator("#from-city").fill("Vancouver");
  await page.locator("#from-region").fill("BC");
  await page.locator("#from-postal_code").fill("V6B 1A1");
  await page
    .getByText("Save or manage origin profiles", { exact: true })
    .click();
  const name = `Vancouver Warehouse ${test.info().project.name}`;
  await page.getByLabel("Profile name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Save as profile", exact: true })
    .click();
  await expect(page.getByText("Profile changes saved.")).toBeVisible();
  const profileId = await profileSelect.inputValue();
  await profileSelect.selectOption("");
  await profileSelect.selectOption(profileId);
  await expect(fromSection).not.toHaveAttribute("open", "");
  await expect(fromSection.locator(":scope > summary")).toContainText(name);
  await fromSection.locator(":scope > summary").click();
  await page.getByText("Save or manage origin profiles", { exact: true }).click();
  await expect(page.locator(".profile-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update profile", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Set default", exact: true })
    .last()
    .click();
  await expect(page.getByRole("button", { name: "Default profile", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator("details.shipment-section").first()).not.toHaveAttribute("open", "");
  await page.locator(".section-heading").filter({ hasText: "Ship From" }).click();
  await expect(page.locator("#from-city")).toHaveValue("Vancouver");
  await page.locator("#to-city").fill("Toronto");
  await page.locator("#to-region").fill("ON");
  await page.locator("#to-postal_code").fill("M5V2T6");
  await expect(page.locator("#from-city")).toHaveValue("Vancouver");
  for (const [field, value] of Object.entries({ weight: "5", length: "12", width: "8", height: "6" })) await page.locator(`#${field}`).fill(value);
  await page.getByRole("button", { name: "Metric · kg / cm", exact: true }).click();
  await expect(page.locator("#weight")).toHaveValue("2.27");
  await page.getByRole("button", { name: "Imperial · lb / in", exact: true }).click();
  await expect(page.locator("#weight")).toHaveValue("5.01");
  await page.getByRole("button", { name: "Metric · kg / cm", exact: true }).click();
  await expect(page.locator("#length")).toHaveValue("30.48");
  await page.getByLabel("Signature required", { exact: true }).check();
  await page.getByLabel("Coverage / declared value (CAD)").fill("500");
  for (const section of await page.locator("details.shipment-section").all())
    await section.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Compare rates", exact: true })
    .click();
  await expect(page.getByText("QUOTES READY", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "With coverage", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody").getByText("Regular Parcel", { exact: true })).toBeVisible();
  await fromSection.locator(":scope > summary").click();
  await page.locator("#from-city").fill("Richmond");
  await expect(page.locator("tbody").getByText("Regular Parcel", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#from-city")).toHaveValue("Vancouver");
});
test("rates, profiles and carrier settings require authentication", async ({
  request,
}) => {
  expect((await request.post("/api/v1/rates", { data: {} })).status()).toBe(
    401,
  );
  expect((await request.get("/api/v1/ship-from-profiles")).status()).toBe(401);
  expect((await request.get("/api/v1/carriers?mode=production")).status()).toBe(
    401,
  );
});
