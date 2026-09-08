"use client";

import type { ModelMap, ModelName } from "@tracklane/domain";
import type { ObjectPool, SyncStatus } from "@tracklane/sync-core";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useSyncClient } from "./provider";

export function useEntity<M extends ModelName>(model: M, id: string | null | undefined): ModelMap[M] | undefined {
  const { pool } = useSyncClient();
  const subscribe = useCallback(
    (listener: () => void) => (id ? pool.subscribeEntity(model, id, listener) : () => {}),
    [pool, model, id],
  );
  const read = useCallback(() => (id ? pool.get(model, id) : undefined), [pool, model, id]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useCollection<M extends ModelName>(model: M): readonly ModelMap[M][] {
  const { pool } = useSyncClient();
  const subscribe = useCallback((listener: () => void) => pool.subscribeModel(model, listener), [pool, model]);
  const read = useCallback(() => pool.all(model), [pool, model]);
  return useSyncExternalStore(subscribe, read, read);
}

export function shallowEqualArrays<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
}

/** Callers pass array literals; keep the first one until the contents actually change so subscriptions stay put. */
function useStableArray<T>(values: readonly T[]): readonly T[] {
  const [stable, setStable] = useState(values);
  if (!shallowEqualArrays(stable, values)) {
    setStable(values);
    return values;
  }
  return stable;
}

/**
 * Derives a value from the replica and only re-renders when the derived value
 * changes under `isEqual`. Lists select ids, so an edit to one issue re-renders
 * that row (which subscribes to its own entity) and not the list.
 */
export function useSelector<T>(
  models: readonly ModelName[],
  select: (pool: ObjectPool) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { pool } = useSyncClient();
  const cache = useRef<{ version: number; select: typeof select; value: T } | null>(null);
  const watched = useStableArray(models);

  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = watched.map((model) => pool.subscribeModel(model, listener));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    [pool, watched],
  );

  const read = (): T => {
    const cached = cache.current;
    if (cached && cached.version === pool.version && cached.select === select) return cached.value;
    const next = select(pool);
    const value = cached && isEqual(cached.value, next) ? cached.value : next;
    cache.current = { version: pool.version, select, value };
    return value;
  };

  return useSyncExternalStore(subscribe, read, read);
}

export function useSyncStatus(): SyncStatus {
  const client = useSyncClient();
  const subscribe = useCallback((listener: () => void) => client.subscribeStatus(listener), [client]);
  const read = useCallback(() => client.getStatus(), [client]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useViewers(issueId: string): readonly string[] {
  const client = useSyncClient();
  const subscribe = useCallback((listener: () => void) => client.subscribePresence(listener), [client]);
  const read = useCallback(() => client.getViewers(issueId), [client, issueId]);
  return useSyncExternalStore(subscribe, read, read);
}
