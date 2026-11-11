import { defineConfig } from "@playwright/test";

const production = process.env.PLAYWRIGHT_PRODUCTION === "1";

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
    // PLAYWRIGHT_PRODUCTION=1 (CI) : console déjà construite (`npm run build`), servie par `next start`.
    // Chaque page est compilée une fois pour toutes : plus de dépassement de délai quand le serveur de
    // développement compile une page au premier accès pendant que deux tests tournent. En local, le serveur
    // de développement reste le défaut (pas de build à refaire après chaque modification).
    command: production
      ? "npm run start -- --port 3100 --hostname 127.0.0.1"
      : "npm run dev -- --port 3100 --hostname 127.0.0.1",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
