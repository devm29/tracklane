import type { User } from "@tracklane/domain";
import {
  BroadcastTabChannel,
  IdbStore,
  SimulatedNetworkTransport,
  SyncClient,
  type TabMessage,
  createLeaderElector,
} from "@tracklane/sync-core";
import { SocketIoTransport } from "@tracklane/sync-core/socket-io";
import { API_URL } from "../config";
import { getToken } from "../session";

export interface WorkspaceClientHooks {
  onAuthError: () => void;
  onStoreVersionChange: () => void;
}

export function createWorkspaceClient(user: User, hooks: WorkspaceClientHooks): SyncClient {
  const scope = `tracklane:${user.workspaceId}:${user.id}`;
  const transport = new SimulatedNetworkTransport(
    new SocketIoTransport({ url: API_URL, getToken, onAuthError: hooks.onAuthError }),
  );
  const tabId = crypto.randomUUID();
  return new SyncClient({
    actor: { userId: user.id, workspaceId: user.workspaceId, role: user.role },
    store: new IdbStore({ databaseName: scope, onVersionChange: hooks.onStoreVersionChange }),
    transport,
    tabs: {
      channel: new BroadcastTabChannel<TabMessage>(scope),
      elector: createLeaderElector(scope, tabId),
    },
  });
}
