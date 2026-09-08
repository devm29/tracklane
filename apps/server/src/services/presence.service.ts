import type { Redis } from "ioredis";

export interface PresenceMember {
  userId: string;
  connectionId: string;
}

/**
 * Who is looking at an issue right now. Entries carry an expiry so a crashed
 * server or a tab that stopped heartbeating disappears on its own.
 */
export interface PresenceStore {
  touch(issueId: string, member: PresenceMember, ttlMs: number): Promise<string[]>;
  remove(issueId: string, member: PresenceMember): Promise<string[]>;
  viewers(issueId: string): Promise<string[]>;
}

const memberKey = (member: PresenceMember): string => `${member.userId}|${member.connectionId}`;
const uniqueUsers = (members: string[]): string[] => [...new Set(members.map((member) => member.split("|")[0] ?? ""))].filter(Boolean).sort();

/** Sorted set per issue, scored by expiry time; the key itself also expires once nobody refreshes it. */
export class RedisPresenceStore implements PresenceStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "tracklane:presence",
  ) {}

  async touch(issueId: string, member: PresenceMember, ttlMs: number): Promise<string[]> {
    const key = this.key(issueId);
    const now = Date.now();
    const result = await this.redis
      .multi()
      .zadd(key, now + ttlMs, memberKey(member))
      .zremrangebyscore(key, "-inf", now)
      .pexpire(key, ttlMs * 2)
      .zrange(key, 0, -1)
      .exec();
    return uniqueUsers(this.lastRange(result));
  }

  async remove(issueId: string, member: PresenceMember): Promise<string[]> {
    const key = this.key(issueId);
    const result = await this.redis
      .multi()
      .zrem(key, memberKey(member))
      .zremrangebyscore(key, "-inf", Date.now())
      .zrange(key, 0, -1)
      .exec();
    return uniqueUsers(this.lastRange(result));
  }

  async viewers(issueId: string): Promise<string[]> {
    const key = this.key(issueId);
    await this.redis.zremrangebyscore(key, "-inf", Date.now());
    return uniqueUsers(await this.redis.zrange(key, 0, -1));
  }

  private key(issueId: string): string {
    return `${this.prefix}:${issueId}`;
  }

  private lastRange(result: [error: Error | null, value: unknown][] | null): string[] {
    const last = result?.at(-1);
    if (!last || last[0]) throw last?.[0] ?? new Error("Presence transaction failed");
    const value = last[1];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
}

export class MemoryPresenceStore implements PresenceStore {
  private readonly issues = new Map<string, Map<string, number>>();

  async touch(issueId: string, member: PresenceMember, ttlMs: number): Promise<string[]> {
    const members = this.issues.get(issueId) ?? new Map<string, number>();
    members.set(memberKey(member), Date.now() + ttlMs);
    this.issues.set(issueId, members);
    return this.viewers(issueId);
  }

  async remove(issueId: string, member: PresenceMember): Promise<string[]> {
    this.issues.get(issueId)?.delete(memberKey(member));
    return this.viewers(issueId);
  }

  async viewers(issueId: string): Promise<string[]> {
    await Promise.resolve();
    const members = this.issues.get(issueId);
    if (!members) return [];
    const now = Date.now();
    for (const [key, expiresAt] of members) if (expiresAt <= now) members.delete(key);
    return uniqueUsers([...members.keys()]);
  }
}
