import { describe, expect, it } from "vitest";
import { type ElectionMessage, HeartbeatElector, MemoryTabHub } from "../src/index.js";
import { waitFor } from "./helpers.js";

function electors(count: number) {
  const hub = new MemoryTabHub<ElectionMessage>();
  return Array.from({ length: count }, (_, index) => {
    const elector = new HeartbeatElector(hub.channel(), {
      tabId: `tab-${index}`,
      heartbeatMs: 20,
      timeoutMs: 80,
      claimWindowMs: 15,
    });
    elector.start(() => {});
    return elector;
  });
}

describe("HeartbeatElector", () => {
  it("settles on exactly one leader", async () => {
    const tabs = electors(4);
    await waitFor(() => tabs.filter((tab) => tab.isLeader).length === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tabs.filter((tab) => tab.isLeader)).toHaveLength(1);
    tabs.forEach((tab) => tab.stop());
  });

  it("re-elects when the leader goes away", async () => {
    const tabs = electors(3);
    await waitFor(() => tabs.some((tab) => tab.isLeader));
    const leader = tabs.find((tab) => tab.isLeader);
    leader?.stop();
    const rest = tabs.filter((tab) => tab !== leader);
    await waitFor(() => rest.filter((tab) => tab.isLeader).length === 1);
    rest.forEach((tab) => tab.stop());
  });
});
