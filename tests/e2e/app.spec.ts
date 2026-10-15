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
  await expect(page.getByRole("heading", { name: "Compare shipping rates" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imperial · lb / in", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#weight")).toHaveValue("1");
  for (const field of ["length", "width", "height"]) await expect(page.locator(`#${field}`)).toHaveValue("0");
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
    .locator("summary").filter({ hasText: /^Save profile$/ })
    .click();
  const name = `Vancouver Warehouse ${test.info().project.name}`;
  await page.getByLabel("Profile name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(page.getByText("Profile changes saved.")).toBeVisible({ timeout: 15000 });
  const profileId = await profileSelect.inputValue();
  await expect(profileSelect.locator('option[value="manage"]')).toHaveCount(0);
  await page.locator("#from-postal_code").fill("invalid");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(fromSection.getByRole("alert")).toContainText("Enter a valid Canadian postal code");
  await page.locator("#from-postal_code").fill("V6B 1A1");
  await page.locator("#from-city").fill("Burnaby");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled();
  await expect(profileSelect).toHaveValue(profileId);

  await profileSelect.selectOption("");
  await profileSelect.selectOption(profileId);
  await expect(fromSection).not.toHaveAttribute("open", "");
  await expect(fromSection.locator(":scope > summary")).toContainText(name);
  await fromSection.locator(":scope > summary").click();
  await page.locator("summary").filter({ hasText: /^Save profile$/ }).click();
  await expect(page.locator(".profile-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Set default", exact: true })
    .last()
    .click();
  await expect(page.getByRole("button", { name: "Default profile", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator("details.shipment-section").first()).not.toHaveAttribute("open", "");
  await page.locator(".section-heading").filter({ hasText: "Ship From" }).click();
  await expect(page.locator("#from-city")).toHaveValue("Burnaby");
  await page.locator("#to-city").fill("Toronto");
  await page.locator("#to-region").fill("ON");
  await page.locator("#to-postal_code").fill("M5V2T6");
  await expect(page.locator("#from-city")).toHaveValue("Burnaby");
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
    page.locator("th").filter({ hasText: "With coverage" }),
  ).toBeVisible();
  await expect(page.locator("tbody td:first-child").filter({ hasText: "Regular Parcel" })).toBeVisible();
  const pageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Copy image", exact: true }).click();
  expect((await pageDownload).suggestedFilename()).toBe("shipping-calculator.jpg");
  await expect(page.locator(".toast").filter({ hasText: "Full page downloaded" })).toBeVisible();

  await fromSection.locator(":scope > summary").click();
  await page.locator("#from-city").fill("Richmond");
  await expect(page.locator("tbody td:first-child").filter({ hasText: "Regular Parcel" })).toBeVisible();
  await expect(page.getByText("Shipment details changed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("#from-city")).toHaveValue("Burnaby");
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

test("location and time settings persist across the site and preserve manually chosen ship dates", async ({ page }) => {
  test.setTimeout(60000);
  await page.clock.setFixedTime(new Date("2026-10-14T02:15:30Z"));
  await page.goto("/sandbox/rate");
  await page.getByLabel("Email", { exact: true }).fill("e2e@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare shipping rates" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Location / time zone", { exact: true }).selectOption("America/Vancouver");
  await page.getByLabel("Date and time region", { exact: true }).selectOption("en-GB");
  await page.getByLabel("Time format", { exact: true }).selectOption("12");
  await expect(page.getByText(/Today: 13\/10\/2026/)).toContainText("07:15:30 pm");
  await page.reload();
  await expect(page.getByLabel("Location / time zone", { exact: true })).toHaveValue("America/Vancouver");
  await expect(page.getByLabel("Time format", { exact: true })).toHaveValue("12");
  await page.getByRole("link", { name: "Rates", exact: true }).click();
  await expect(page.getByLabel("Ship date", { exact: true })).toHaveValue("2026-10-13");
  await page.getByLabel("Ship date", { exact: true }).fill("2026-10-20");
  await page.evaluate(() => {
    const key = "shipping:location-time";
    const next = JSON.stringify({ timeZone: "Asia/Tokyo", locale: "en-GB", hour12: false });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  });
  await expect(page.getByRole("link", { name: "Tokyo", exact: true })).toHaveAttribute("href", "/sandbox/setting#location-time-heading");
  await expect(page.getByLabel("Ship date", { exact: true })).toHaveValue("2026-10-20");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Ship date", { exact: true })).toHaveValue("2026-10-14");
  await page.goto("/rate");
  await expect(page.getByLabel("Ship date", { exact: true })).toHaveValue("2026-10-14");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Location / time zone", { exact: true })).toHaveValue("Asia/Tokyo");
  await expect(page.getByText(/Local time: 11:15:30/)).toBeVisible({ timeout: 15000 });
});
