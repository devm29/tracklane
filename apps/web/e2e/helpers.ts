import { type Browser, type Page, expect } from "@playwright/test";

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId(`demo-${email}`).click();
  await page.waitForURL("**/my-issues");
  await expect(page.getByTestId("sync-indicator")).toHaveAttribute("data-connection", "live");
}

export async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

export async function openSyncInspector(page: Page): Promise<void> {
  if (await page.getByTestId("devtools").isVisible()) return;
  await page.keyboard.press("ControlOrMeta+.");
  await expect(page.getByTestId("devtools")).toBeVisible();
}

export async function renameOpenIssue(page: Page, title: string): Promise<void> {
  const input = page.getByTestId("issue-title-input");
  await input.click();
  await input.fill(title);
  await input.press("Enter");
}

export const unique = (label: string): string => `${label} ${Math.random().toString(36).slice(2, 7)}`;
