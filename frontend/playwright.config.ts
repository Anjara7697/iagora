import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Le serveur de développement compile chaque page au premier accès : marge pour les navigations.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3100",
    browserName: "chromium",
    // Animations réduites : états finaux immédiats, audits d'accessibilité stables.
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: "npm run dev -- --port 3100 --hostname 127.0.0.1",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
