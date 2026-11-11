import { expect, test } from "@playwright/test";

// AUDIT-SEC-003 : en-têtes de sécurité servis par la console, quelle que soit la page.
test("la console envoie ses en-têtes de sécurité", async ({ page }) => {
  for (const path of ["/login", "/prospects"]) {
    const response = await page.goto(path);
    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});
