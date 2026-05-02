import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const usingLocalDevServer = baseURL.startsWith('http://localhost:5173');

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(usingLocalDevServer
    ? {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            ...(process.env.VITE_SUPABASE_URL
              ? { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL }
              : {}),
            ...(process.env.VITE_SUPABASE_ANON_KEY
              ? { VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY }
              : {}),
          },
        },
      }
    : {}),
});
