import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Parcours contre le VRAI backend (AUDIT-QA-001) : aucune API simulée. L'API doit tourner sur
 * E2E_API_URL avec une base de test (voir le job `e2e-api` de la CI) et la console doit avoir été
 * construite avec NEXT_PUBLIC_API_URL pointant dessus.
 */
export default defineConfig({
  ...base,
  // Même site que l'API (127.0.0.1:8000) : le témoin de session `SameSite=Strict` est envoyé, comme
  // en production où Caddy sert la console et l'API sur le même domaine.
  use: { ...base.use, baseURL: "http://127.0.0.1:3100" },
  testDir: "./tests-api",
  fullyParallel: false,
  workers: 1,
  retries: 0,
});
