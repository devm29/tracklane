import { afterEach, describe, expect, it } from "vitest";
import {
  type ElectionMessage,
  HeartbeatElector,
  MemoryStore,
  MemoryTabHub,
  SyncClient,
  type TabMessage,
} from "../src/index.js";
import type { Transaction } from "@tracklane/domain";
import { InMemorySyncServer, ScriptedTransport, sequentialIds, smallWorkspace } from "../src/testing/index.js";
import { must, waitFor } from "./helpers.js";

const fixture = smallWorkspace();
const ada = must(fixture.users[0], "ada");
const issue = must(fixture.issues[0], "issue");

const running: SyncClient[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((client) => client.stop()));
});

/** A store whose outbox writes land late, like a busy IndexedDB. */
class SlowOutboxStore extends MemoryStore {
  override async putTransaction(tx: Transaction): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60));
    await super.putTransaction(tx);
  }
}

function browser(store: MemoryStore = new MemoryStore()) {
  const server = new InMemorySyncServer(structuredClone(fixture));
  const tabs = new MemoryTabHub<TabMessage>();
  const elections = new MemoryTabHub<ElectionMessage>();
  let idBase = 1;
  const openTab = async (tabId: string): Promise<SyncClient> => {
    const client = new SyncClient({
      actor: server.actorFor(ada.id),
      store,
      transport: new ScriptedTransport(server, ada.id, "auto"),
      tabs: {
        channel: tabs.channel(),
        elector: new HeartbeatElector(elections.channel(), { tabId, heartbeatMs: 20, timeoutMs: 80, claimWindowMs: 15 }),
      },
      newId: sequentialIds(1_000_000 * idBase++),
      retryDelayMs: 10,
    });
    running.push(client);
    await client.start();
    return client;
  };
  return { server, openTab };
}

describe("cross-tab coordination", () => {
  it("elects one leader and lets followers write through it", async () => {
    const { server, openTab } = browser();
    const first = await openTab("a");
    await waitFor(() => first.getStatus().role === "leader" && first.getStatus().connection === "live");

    const second = await openTab("b");
    await waitFor(() => second.pool.size("issue") === fixture.issues.length);
    expect(second.getStatus().role).toBe("follower");
    await waitFor(() => second.getStatus().connection === "live");

    second.updateIssue(issue.id, { title: "Written by a follower" });
    expect(second.pool.get("issue", issue.id)?.title).toBe("Written by a follower");

    await waitFor(() => server.get("issue", issue.id)?.title === "Written by a follower");
    await waitFor(() => second.getStatus().pending.length === 0 && first.getStatus().pending.length === 0);
    expect(first.pool.get("issue", issue.id)?.title).toBe("Written by a follower");
    expect(second.getStatus().lastSyncId).toBe(server.lastSyncId);
  });

  it("hands the socket to a follower when the leader tab closes", async () => {
    const { server, openTab } = browser();
    const first = await openTab("a");
    await waitFor(() => first.getStatus().connection === "live");
    const second = await openTab("b");
    await waitFor(() => second.getStatus().bootstrapped);

    await first.stop();
    await waitFor(() => second.getStatus().role === "leader" && second.getStatus().connection === "live");

    second.updateIssue(issue.id, { priority: 2 });
    await waitFor(() => server.get("issue", issue.id)?.priority === 2);
  });

  it("queues work offline and drains the persisted outbox on reconnect", async () => {
    const { server, openTab } = browser();
    const leader = await openTab("a");
    await waitFor(() => leader.getStatus().connection === "live");
    const follower = await openTab("b");
    await waitFor(() => follower.getStatus().connection === "live");

    follower.setNetworkEnabled(false);
    await waitFor(() => leader.getStatus().connection === "offline" && follower.getStatus().connection === "offline");

    leader.updateIssue(issue.id, { title: "Offline edit" });
    follower.addComment({ issueId: issue.id, body: "Written on a plane" });
    await waitFor(() => leader.getStatus().pending.length === 2);
    expect(server.get("issue", issue.id)?.title).toBe(issue.title);

    leader.setNetworkEnabled(true);
    await waitFor(() => leader.getStatus().pending.length === 0 && follower.getStatus().pending.length === 0);
    expect(server.get("issue", issue.id)?.title).toBe("Offline edit");
    expect(server.visibleEntities(ada.id, "comment")).toHaveLength(1);
  });

  it("rolls back an optimistic change the server rejects", async () => {
    const { server, openTab } = browser();
    const tab = await openTab("a");
    await waitFor(() => tab.getStatus().connection === "live");
    const rejections: string[] = [];
    tab.onEvent((event) => {
      if (event.type === "rejected") rejections.push(event.code);
    });

    tab.setNetworkEnabled(false);
    tab.updateIssue(issue.id, { status: "in_progress" });
    expect(tab.pool.get("issue", issue.id)?.status).toBe("in_progress");
    // A teammate cancels the issue first, so the queued move becomes Canceled -> In Progress, which the workflow forbids.
    server.push(ada.id, [
      { clientTxId: crypto.randomUUID(), createdAt: new Date().toISOString(), mutation: { kind: "issue.update", id: issue.id, patch: { status: "canceled" } } },
    ]);
    tab.setNetworkEnabled(true);

    await waitFor(() => tab.getStatus().pending.length === 0);
    expect(rejections).toEqual(["invalid_transition"]);
    expect(tab.pool.get("issue", issue.id)?.status).toBe("canceled");
  });

  it("keeps a follower's write that is still being persisted when it takes over as leader", async () => {
    const { server, openTab } = browser(new SlowOutboxStore());
    const first = await openTab("a");
    await waitFor(() => first.getStatus().connection === "live");
    const second = await openTab("b");
    await waitFor(() => second.getStatus().connection === "live" && second.getStatus().bootstrapped);

    second.updateIssue(issue.id, { title: "Written during the handoff" });
    await first.stop();

    await waitFor(() => second.getStatus().role === "leader");
    expect(second.pool.get("issue", issue.id)?.title).toBe("Written during the handoff");
    await waitFor(() => server.get("issue", issue.id)?.title === "Written during the handoff");
    await waitFor(() => second.getStatus().pending.length === 0);
  });
});
