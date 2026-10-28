import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests de la interfaz. Levantan su propio servidor en modo mock, en RAM y con
 * embeddings hash (sin red ni API keys) en puertos distintos de `pnpm dev`.
 */
const API_PORT = 3101;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] },
  },
  projects: [
    {
      name: "escritorio",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "movil", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @lethetown/server start",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        LLM_PROVIDER: "mock",
        DATABASE_URL: "",
        EMBEDDINGS: "hash",
        SIM_SEED: "7",
        SIM_SPEED: "60",
        ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
        DEV_ADMIN_PASSWORD: "e2e-admin-password",
      },
    },
    {
      command: `pnpm --filter @lethetown/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(API_PORT) },
    },
  ],
});
