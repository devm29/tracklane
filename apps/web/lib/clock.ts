"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const read = (): number => now;

/** One shared clock for every relative timestamp on screen, so "just now" ages without each row running a timer. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, read, read);
}
