import { expect, test } from "@playwright/test";
import { openAs, openSyncInspector, renameOpenIssue, unique } from "./helpers";

const ISSUE = "Replica drifts after the laptop sleeps";

test("teammates see each other's edits and presence in real time", async ({ browser }) => {
  const maya = await openAs(browser, "maya@lumen.dev");
  const jonas = await openAs(browser, "jonas@lumen.dev");

  await maya.goto("/team/ENG");
  await maya.getByTestId("issue-row").filter({ hasText: ISSUE }).first().click();
  await expect(maya.getByTestId("issue-title-input")).toHaveValue(new RegExp(ISSUE));
  const issueUrl = maya.url();

  await jonas.goto(issueUrl);
  await expect(maya.getByTestId("presence")).toBeVisible();
  await expect(maya.getByTestId("presence")).toHaveAttribute("aria-label", /Jonas Weber/);

  const title = unique(`${ISSUE} (live)`);
  await renameOpenIssue(maya, title);
  await expect(jonas.getByTestId("issue-title-input")).toHaveValue(title);
});

test("offline edits queue in the outbox and sync on reconnect", async ({ browser }) => {
  const maya = await openAs(browser, "maya@lumen.dev");
  const jonas = await openAs(browser, "jonas@lumen.dev");
  await maya.goto("/team/ENG");
  await maya.getByTestId("issue-row").filter({ hasText: ISSUE }).first().click();
  await expect(maya.getByTestId("issue-title-input")).toHaveValue(new RegExp(ISSUE));
  await jonas.goto(maya.url());
  await expect(jonas.getByTestId("issue-title-input")).toHaveValue(new RegExp(ISSUE));

  await openSyncInspector(maya);
  await maya.getByTestId("devtools-offline").click();
  await expect(maya.getByTestId("sync-indicator")).toHaveAttribute("data-connection", "offline");

  const title = unique(`${ISSUE} (offline)`);
  await renameOpenIssue(maya, title);
  // Still in Maya's outbox means the server has never seen it, so Jonas can't have it either.
  await expect(maya.getByTestId("devtools-pending")).toContainText("update title");
  await expect(jonas.getByTestId("issue-title-input")).not.toHaveValue(title);

  await maya.getByTestId("devtools-offline").click();
  await expect(maya.getByTestId("devtools-pending")).toContainText("Nothing waiting");
  await expect(jonas.getByTestId("issue-title-input")).toHaveValue(title);
});

test("tabs elect one leader and followers write through it", async ({ browser }) => {
  const leader = await openAs(browser, "priya@lumen.dev");
  await leader.goto("/team/ENG");
  const follower = await leader.context().newPage();
  await follower.goto("/team/ENG");
  await openSyncInspector(leader);
  await openSyncInspector(follower);
  await expect(leader.getByTestId("devtools-role")).toHaveText("leader");
  await expect(follower.getByTestId("devtools-role")).toHaveText("follower");

  const elena = await openAs(browser, "elena@lumen.dev");
  await elena.goto("/team/ENG");

  await follower.getByTestId("issue-row").filter({ hasText: "IndexedDB quota" }).first().click();
  const title = unique("IndexedDB quota exceeded (from a follower tab)");
  await renameOpenIssue(follower, title);

  await expect(leader.getByTestId("issue-title").filter({ hasText: title })).toBeVisible();
  await expect(elena.getByTestId("issue-title").filter({ hasText: title })).toBeVisible();
  await expect(follower.getByTestId("devtools-pending")).toContainText("Nothing waiting");
  const leaderSyncId = await leader.getByTestId("devtools-last-sync-id").innerText();
  await expect(follower.getByTestId("devtools-last-sync-id")).toHaveText(leaderSyncId);
});

test("the board refuses moves the workflow does not allow", async ({ browser }) => {
  const page = await openAs(browser, "jonas@lumen.dev");
  await page.goto("/team/ENG/board");
  const card = page.getByTestId("board-card").filter({ hasText: "Virtualize the issue list" });
  const done = page.getByTestId("board-column-done");
  await card.hover();
  await page.mouse.down();
  const box = await done.boundingBox();
  if (!box) throw new Error("done column not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText("Can't move from Backlog to Done")).toBeVisible();
  await expect(page.getByTestId("board-column-backlog")).toContainText("Virtualize the issue list");
});
