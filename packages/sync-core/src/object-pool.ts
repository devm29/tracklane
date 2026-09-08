import type { AnyEntity, EntityReader, ModelMap, ModelName } from "@tracklane/domain";
import { modelNames } from "@tracklane/domain";

export type EntityRecord = { [M in ModelName]: { model: M; data: ModelMap[M] } }[ModelName];

export type EntityKey = `${ModelName}:${string}`;

export function entityKey(model: ModelName, id: string): EntityKey {
  return `${model}:${id}`;
}

function splitKey(key: EntityKey): { model: ModelName; id: string } {
  const index = key.indexOf(":");
  return { model: key.slice(0, index) as ModelName, id: key.slice(index + 1) };
}

/** Pending-transaction results layered over confirmed state. `null` marks an optimistic removal. */
export type Overlay = ReadonlyMap<EntityKey, AnyEntity | null>;

type Listener = () => void;

function shallowEqual(a: AnyEntity, b: AnyEntity): boolean {
  if (a === b) return true;
  const aEntries = Object.entries(a);
  if (aEntries.length !== Object.keys(b).length) return false;
  const bRecord = b as unknown as Record<string, unknown>;
  for (const [key, value] of aEntries) {
    const other = bRecord[key];
    if (Array.isArray(value) && Array.isArray(other)) {
      if (value.length !== other.length || value.some((item, index) => item !== other[index])) return false;
    } else if (value !== other) {
      return false;
    }
  }
  return true;
}

/**
 * Holds the confirmed replica (server truth as of lastSyncId) and the view
 * that the UI reads: confirmed state with the optimistic overlay applied.
 *
 * Writes are staged and published in one `commit()`. Entities that come out
 * structurally equal keep their previous object identity, so selectors that
 * compare by reference skip re-rendering untouched rows.
 */
export class ObjectPool implements EntityReader {
  private readonly confirmed = new Map<ModelName, Map<string, AnyEntity>>();
  private readonly view = new Map<ModelName, Map<string, AnyEntity>>();
  private overlay: Overlay = new Map();
  private readonly touched = new Set<EntityKey>();
  private readonly listCache = new Map<ModelName, readonly AnyEntity[]>();
  private readonly keyListeners = new Map<EntityKey, Set<Listener>>();
  private readonly modelListeners = new Map<ModelName, Set<Listener>>();
  private readonly listeners = new Set<(changed: ReadonlySet<EntityKey>) => void>();
  private versionCounter = 0;

  constructor() {
    for (const model of modelNames) {
      this.confirmed.set(model, new Map());
      this.view.set(model, new Map());
    }
  }

  get version(): number {
    return this.versionCounter;
  }

  get<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined {
    return this.table(this.view, model).get(id) as ModelMap[M] | undefined;
  }

  getConfirmed<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined {
    return this.table(this.confirmed, model).get(id) as ModelMap[M] | undefined;
  }

  all<M extends ModelName>(model: M): readonly ModelMap[M][] {
    let cached = this.listCache.get(model);
    if (!cached) {
      cached = Object.freeze([...this.table(this.view, model).values()]);
      this.listCache.set(model, cached);
    }
    return cached as readonly ModelMap[M][];
  }

  readonly confirmedReader: EntityReader = {
    get: <M extends ModelName>(model: M, id: string) => this.getConfirmed(model, id),
  };

  size(model: ModelName): number {
    return this.table(this.view, model).size;
  }

  replaceConfirmed(records: Iterable<EntityRecord>): void {
    for (const [model, table] of this.confirmed) {
      for (const id of table.keys()) this.touched.add(entityKey(model, id));
      table.clear();
    }
    for (const record of records) this.upsertConfirmed(record);
  }

  upsertConfirmed(record: EntityRecord): void {
    this.table(this.confirmed, record.model).set(record.data.id, record.data);
    this.touched.add(entityKey(record.model, record.data.id));
  }

  removeConfirmed(model: ModelName, id: string): void {
    this.table(this.confirmed, model).delete(id);
    this.touched.add(entityKey(model, id));
  }

  setOverlay(next: Overlay): void {
    for (const key of this.overlay.keys()) this.touched.add(key);
    for (const key of next.keys()) this.touched.add(key);
    this.overlay = next;
  }

  /** Recomputes the view for staged keys and notifies subscribers of what actually changed. */
  commit(): ReadonlySet<EntityKey> {
    const changed = new Set<EntityKey>();
    for (const key of this.touched) {
      const { model, id } = splitKey(key);
      const viewTable = this.table(this.view, model);
      const previous = viewTable.get(id);
      const next = this.overlay.has(key) ? (this.overlay.get(key) ?? undefined) : this.table(this.confirmed, model).get(id);
      if (next === undefined) {
        if (previous !== undefined) {
          viewTable.delete(id);
          changed.add(key);
        }
      } else if (previous === undefined || !shallowEqual(previous, next)) {
        viewTable.set(id, next);
        changed.add(key);
      }
    }
    this.touched.clear();
    if (changed.size === 0) return changed;

    this.versionCounter += 1;
    const changedModels = new Set<ModelName>();
    for (const key of changed) changedModels.add(splitKey(key).model);
    for (const model of changedModels) this.listCache.delete(model);

    for (const key of changed) this.keyListeners.get(key)?.forEach((listener) => listener());
    for (const model of changedModels) this.modelListeners.get(model)?.forEach((listener) => listener());
    for (const listener of this.listeners) listener(changed);
    return changed;
  }

  subscribe(listener: (changed: ReadonlySet<EntityKey>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeEntity(model: ModelName, id: string, listener: Listener): () => void {
    return this.addListener(this.keyListeners, entityKey(model, id), listener);
  }

  subscribeModel(model: ModelName, listener: Listener): () => void {
    return this.addListener(this.modelListeners, model, listener);
  }

  confirmedRecords(): EntityRecord[] {
    const records: EntityRecord[] = [];
    for (const [model, table] of this.confirmed) {
      for (const data of table.values()) records.push({ model, data } as EntityRecord);
    }
    return records;
  }

  private addListener<K>(registry: Map<K, Set<Listener>>, key: K, listener: Listener): () => void {
    let set = registry.get(key);
    if (!set) {
      set = new Set();
      registry.set(key, set);
    }
    set.add(listener);
    return () => {
      const current = registry.get(key);
      current?.delete(listener);
      if (current?.size === 0) registry.delete(key);
    };
  }

  private table(source: Map<ModelName, Map<string, AnyEntity>>, model: ModelName): Map<string, AnyEntity> {
    const table = source.get(model);
    if (!table) throw new Error(`Unknown model "${model}"`);
    return table;
  }
}
