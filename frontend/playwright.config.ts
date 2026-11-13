import { defineConfig } from "@playwright/test";

const production = process.env.PLAYWRIGHT_PRODUCTION === "1";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Le serveur de développement compile chaque page au premier accès : marge pour les navigations.
  expect: {
    timeout: 10_000,
    // Captures de référence (`tests/visuel.spec.ts`) : comparées au pixel près, à une marge infime près. Elles ne
    // valent que dans l'image Playwright de la CI (même navigateur, mêmes polices) : voir `ignoreSnapshots`.
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide", scale: "css" },
  },
  // Une capture rendue sur un autre système (Windows, macOS, autre version du navigateur) diffère de la référence
  // sans régression : hors CI, les comparaisons sont ignorées et le reste de chaque test s'exécute. Pour les lancer
  // ou les régénérer en local, passer par l'image de la CI : `npm run test:visual:update`.
  ignoreSnapshots: !process.env.CI,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  use: {
    baseURL: "http://localhost:3100",
    browserName: "chromium",
    // Animations réduites : états finaux immédiats, audits d'accessibilité stables.
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  // Bureau : tous les tests. Mobile et thème sombre : seulement les tests étiquetés (`{ tag: ["@mobile", "@sombre"] }`).
  projects: [
    { name: "bureau" },
    { name: "mobile", grep: /@mobile/, use: { viewport: { width: 390, height: 844 } } },
    { name: "sombre", grep: /@sombre/, use: { colorScheme: "dark" } },
  ],
  webServer: {
    // PLAYWRIGHT_PRODUCTION=1 (CI) : console déjà construite (`npm run build`) et servie comme dans l'image
    // Docker (serveur autonome, avec `public` et `.next/static` copiés à côté). Chaque page est compilée une
    // fois pour toutes : plus de dépassement de délai quand le serveur de développement compile une page au
    // premier accès pendant que deux tests tournent. En local, le serveur de développement reste le défaut.
    command: production
      ? "cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js"
      : "npm run dev -- --port 3100 --hostname 127.0.0.1",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
