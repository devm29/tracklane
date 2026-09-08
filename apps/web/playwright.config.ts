import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3110";

// Expects MongoDB (replica set) and Redis to be running and seeded: `pnpm db:up && pnpm seed`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  ...(process.env.E2E_EXTERNAL_SERVERS
    ? {}
    : {
        webServer: [
          {
            command: "pnpm --filter @tracklane/server start",
            cwd: "../..",
            url: "http://localhost:8110/healthz",
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: "pnpm start",
            url: `${baseURL}/login`,
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ],
      }),
});
