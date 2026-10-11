import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/v1/health",
    reuseExistingServer: false,
    env: {
      APP_ENV: "development",
      APP_ORIGIN: "http://127.0.0.1:3000",
      MOCK_CARRIERS: "true",
      DATABASE_PROVIDER: "sqlite",
      DATABASE_URL: "file:./data/e2e.db",
    },
  },
  globalSetup: "./tests/e2e/setup.ts",
});
