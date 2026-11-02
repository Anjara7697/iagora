import { expect, type Locator } from "@playwright/test";

/** Choisit une option d'une liste HeroUI : par valeur (`data-value`) ou par libellé. */
export async function choose(select: Locator, option: string | { label: string }) {
  const page = select.page();
  await select.click();
  const item =
    typeof option === "string"
      ? page.locator(`[role="option"][data-value="${option}"]`)
      : page.getByRole("option", { name: option.label, exact: true });
  await item.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
