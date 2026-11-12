import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Parcours contre le VRAI backend (AUDIT-QA-001) : aucune API simulée. L'API doit tourner sur
 * E2E_API_URL avec une base de test (voir le job `e2e-api` de la CI) et la console doit avoir été
 * construite avec NEXT_PUBLIC_API_URL pointant dessus.
 */
export default defineConfig({
  ...base,
  testDir: "./tests-api",
  fullyParallel: false,
  workers: 1,
  retries: 0,
});
