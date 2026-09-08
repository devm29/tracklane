import { describe, expect, it } from "vitest";
import { Backoff, PresenceCoordinator, type TabMessage } from "../src/index.js";

describe("Backoff", () => {
  it("grows exponentially, stays within jitter bounds and caps", () => {
    const backoff = new Backoff({ baseMs: 100, maxMs: 1_000, random: () => 1 });
    expect([1, 2, 3, 4, 5, 6].map(() => backoff.next())).toEqual([100, 200, 400, 800, 1_000, 1_000]);
    const low = new Backoff({ baseMs: 100, maxMs: 1_000, random: () => 0 });
    expect([low.next(), low.next()]).toEqual([50, 100]);
  });

  it("starts over after a success", () => {
    const backoff = new Backoff({ baseMs: 100, maxMs: 1_000, random: () => 1 });
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(100);
  });
});

describe("PresenceCoordinator", () => {
  it("forgets a follower tab that stopped heartbeating", async () => {
    let now = 0;
    const reports: (readonly string[])[] = [];
    const leader = new PresenceCoordinator({
      tabId: "leader",
      isLeader: () => true,
      post: (_message: TabMessage) => undefined,
      report: (issueIds) => reports.push(issueIds),
      heartbeatMs: 10,
      now: () => now,
    });
    leader.becameLeader();
    leader.receive("crashed-tab", "issue-1");
    expect(reports.at(-1)).toEqual(["issue-1"]);

    leader.start();
    now = 100;
    await new Promise((resolve) => setTimeout(resolve, 30));
    leader.stop();
    expect(reports.at(-1)).toEqual([]);
  });
});
