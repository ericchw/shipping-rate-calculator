/* eslint-disable @typescript-eslint/no-require-imports -- Standalone documentation capture helper. */
// Run against an isolated server with MOCK_CARRIERS=true.
// Seed a Northstar Demo company, an admin (demo@example.invalid by default),
// enabled rating connections, and one fictional saved sandbox label.
// GUIDE_ORIGIN, GUIDE_EMAIL, GUIDE_PASSWORD and GUIDE_CHROMIUM_PATH are optional overrides.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

async function main() {
  const origin = process.env.GUIDE_ORIGIN || 'http://127.0.0.1:3100';
  const output = path.resolve('docs/images/user-guide');
  mkdirSync(output, { recursive: true });
  const frames = path.resolve('data/user-guide-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.GUIDE_CHROMIUM_PATH ? { executablePath: process.env.GUIDE_CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await page.route('**/api/v1/**', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/sandbox/api/v1/') || (request.method() === 'POST' && url.pathname.endsWith('/loomis/labels'))) {
        throw new Error('Guide capture blocks production APIs and waybill creation.');
      }
      return route.continue();
    });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const banner = document.createElement('div');
      banner.textContent = 'USER GUIDE DEMO — fictional account and addresses; sample rates';
      banner.style.cssText = 'background:#fff3cd;color:#664d03;padding:12px;text-align:center;font:14px sans-serif';
      document.body.prepend(banner);
    }));
    const capture = async (name, locator) => {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.evaluate(() => document.fonts.ready);
      if (locator) await locator.screenshot({ path: path.join(output, name), animations: 'disabled' });
      else await page.screenshot({ path: path.join(output, name), fullPage: false, animations: 'disabled' });
    };
    let frameIndex = 0;
    const frame = async label => {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.evaluate(text => {
        let caption = document.getElementById('guide-step');
        if (!caption) {
          caption = document.createElement('div'); caption.id = 'guide-step';
          caption.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:99999;background:#122e4f;color:white;padding:16px;border-radius:8px;font:20px sans-serif';
          document.body.append(caption);
        }
        caption.textContent = text;
      }, label);
      await page.screenshot({ path: path.join(frames, `${String(frameIndex++).padStart(3, '0')}.png`), animations: 'disabled' });
      await page.evaluate(() => document.getElementById('guide-step')?.remove());
    };
    await page.route('**/sandbox/api/v1/postal-suggestions?*', route => route.fulfill({ json: { country: 'CA', lookupCode: '', precision: 'area', suggestions: [], message: null } }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${origin}/sandbox/rate`);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await capture('01-sign-in.png');
    await page.getByLabel('Email', { exact: true }).fill(process.env.GUIDE_EMAIL || 'demo@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(process.env.GUIDE_PASSWORD || 'fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Compare rates', exact: true })).toBeVisible({ timeout: 30000 });
    const session = await (await page.request.get(`${origin}/sandbox/api/v1/auth/session`)).json();
    if (session.source !== 'mock') throw new Error('Guide capture requires mock rates');
    await page.goto(`${origin}/sandbox/setting?section=companies`);
    await expect(page.getByRole('heading', { name: 'Companies', exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Northstar Demo', exact: true })).toBeVisible();
    await capture('08-company-workspace.png');
    await page.getByRole('tab', { name: 'API connections', exact: true }).click();
    await expect(page.locator('.carrier-setting-card').first()).toBeVisible();
    await capture('02-carrier-settings.png');
    await capture('13-purolator-settings.png', page.locator('form.carrier-setting-card').filter({ has: page.getByRole('heading', { name: 'Purolator', exact: true }) }));
    await page.goto(`${origin}/sandbox/rate`);
    await expect(page.getByRole('button', { name: 'Compare rates', exact: true })).toBeVisible();
    await frame('1. Open the sandbox rate calculator');
    for (const section of await page.locator('details.shipment-section').all()) {
      if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
    }
    for (const [prefix, values] of Object.entries({
      from: { city: 'Vancouver', region: 'BC', postal_code: 'V6B1A1' },
      to: { city: 'Toronto', region: 'ON', postal_code: 'M5V2T6' },
    })) {
      for (const [key, value] of Object.entries(values)) await page.locator(`#${prefix}-${key}`).fill(value);
      await page.locator(`#${prefix}-city`).scrollIntoViewIfNeeded();
      await frame(prefix === 'from' ? '2. Enter the origin city, province and postal code' : '3. Enter the destination separately');
    }
    await page.locator('summary').filter({ hasText: /^Save profile$/ }).click();
    await page.getByLabel('Profile name', { exact: true }).fill('Demo warehouse');
    await capture('03-origin-profile.png', page.locator('details.shipment-section').first());
    await page.locator('summary').filter({ hasText: /^Save profile$/ }).click();
    for (const [field, value] of Object.entries({ weight: '5', length: '12', width: '8', height: '6' })) {
      await page.locator(`#${field}`).fill(value);
    }
    await page.locator('#weight').scrollIntoViewIfNeeded();
    await frame('4. Enter the package weight and dimensions in the selected units');
    await page.getByLabel('Coverage / declared value (CAD)').fill('500');
    await page.getByLabel('Signature required', { exact: true }).check();
    await frame('5. Choose signature and declared value when needed');
    for (const section of await page.locator('details.shipment-section').all()) {
      if ((await section.locator(':scope > summary').innerText()).match(/Ship From|Ship To/) && await section.getAttribute('open') !== null) await section.locator(':scope > summary').click();
    }
    await capture('04-shipment.png', page.locator('form').filter({ has: page.getByRole('button', { name: 'Compare rates', exact: true }) }));
    await page.getByRole('button', { name: 'Compare rates', exact: true }).click();
    await frame('6. Click Compare rates and wait for carrier responses');
    await expect(page.getByText('QUOTES READY', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Compare rates', exact: true })).toBeEnabled();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.getByRole('region', { name: 'Rate comparison' }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await frame('7. Compare the returned services and prices — demo rates shown');
    await page.getByRole('button', { name: 'Copy table', exact: true }).scrollIntoViewIfNeeded();
    await frame('8. Use Copy table to share the comparison');
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture('05-rate-comparison.png');
    await page.getByRole('button', { name: 'Rate logs', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.history-record').first().click();
    await expect(dialog.getByRole('heading', { name: 'Saved rate comparison', exact: true })).toBeVisible();
    await capture('09-rate-history.png');
    await dialog.getByRole('button', { name: 'Close rate logs', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile page overflows');
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture('06-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/sandbox/setting?section=users`);
    await expect(page.getByRole('heading', { name: 'Users and access', exact: true })).toBeVisible();
    await capture('07-admin-accounts.png');
    await page.goto(`${origin}/sandbox/labels`);
    await expect(page.getByRole('heading', { name: 'Generated labels', exact: true })).toBeVisible();
    await expect(page.locator('.saved-label-row')).toHaveCount(1);
    await capture('10-generated-labels.png');
    await page.goto(`${origin}/sandbox/rate`);
    await page.locator('.theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await capture('11-dark-mode.png');
    await page.locator('.appearance-controls select').selectOption('zh-TW');
    await expect(page.getByRole('heading', { name: '比較運費', exact: true })).toBeVisible();
    await capture('12-traditional-chinese.png');
    console.log('Captured thirteen screenshots and eight animation frames. Sandbox only; no waybill API called.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
