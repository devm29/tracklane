import { MemoryStore, SyncClient } from "@tracklane/sync-core";
import { InMemorySyncServer, ScriptedTransport, smallWorkspace } from "@tracklane/sync-core/testing";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSelector } from "../sync/hooks";
import { SyncClientBoundary } from "../sync/provider";

const fixture = smallWorkspace();
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture is missing data");
  return value;
}
const ada = must(fixture.users[0]);
const first = must(fixture.issues[0]);
const second = must(fixture.issues[1]);

async function liveClient(): Promise<SyncClient> {
  const server = new InMemorySyncServer(structuredClone(fixture));
  const client = new SyncClient({ actor: server.actorFor(ada.id), store: new MemoryStore(), transport: new ScriptedTransport(server, ada.id, "auto") });
  await client.start();
  for (let attempt = 0; attempt < 200 && client.getStatus().connection !== "live"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return client;
}

afterEach(() => cleanup());

describe("useSelector", () => {
  it("re-renders only when the selected value changes", async () => {
    const client = await liveClient();
    let renders = 0;
    function FirstTitle() {
      renders += 1;
      const title = useSelector(["issue"], (pool) => pool.get("issue", first.id)?.title);
      return <span data-testid="title">{title}</span>;
    }
    const view = render(
      <SyncClientBoundary client={client}>
        <FirstTitle />
      </SyncClientBoundary>,
    );
    expect(view.getByTestId("title").textContent).toBe(first.title);
    const baseline = renders;

    act(() => client.updateIssue(second.id, { title: "Someone else's issue" }));
    expect(renders).toBe(baseline);

    act(() => client.updateIssue(first.id, { title: "Renamed" }));
    expect(view.getByTestId("title").textContent).toBe("Renamed");
    expect(renders).toBe(baseline + 1);
    await client.stop();
  });

  it("keeps one subscription across renders that pass a new array literal", async () => {
    const client = await liveClient();
    let subscriptions = 0;
    const original = client.pool.subscribeModel.bind(client.pool);
    client.pool.subscribeModel = (model, listener) => {
      subscriptions += 1;
      return original(model, listener);
    };
    function Count({ tick }: { tick: number }) {
      const count = useSelector(["issue", "comment"], (pool) => pool.all("issue").length);
      return <span data-tick={tick}>{count}</span>;
    }
    const view = render(
      <SyncClientBoundary client={client}>
        <Count tick={0} />
      </SyncClientBoundary>,
    );
    const afterMount = subscriptions;
    view.rerender(
      <SyncClientBoundary client={client}>
        <Count tick={1} />
      </SyncClientBoundary>,
    );
    expect(subscriptions).toBe(afterMount);
    await client.stop();
  });
});
