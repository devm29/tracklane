"use client";

import { User, Workspace } from "@tracklane/domain";
import { useSyncExternalStore } from "react";
import { z } from "zod";

const STORAGE_KEY = "tracklane.session";

const StoredSession = z.object({ token: z.string().min(1), user: User, workspace: Workspace });
export type Session = z.infer<typeof StoredSession>;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSession: Session | null = null;

function read(): Session | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  try {
    cachedSession = raw ? StoredSession.parse(JSON.parse(raw)) : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function saveSession(session: Session): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  notify();
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  notify();
}

export function getToken(): string | null {
  return read()?.token ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** `undefined` while rendering on the server, `null` when signed out. */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore<Session | null | undefined>(subscribe, read, () => undefined);
}
