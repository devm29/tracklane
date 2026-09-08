"use client";

import { useNow } from "@/lib/clock";
import { relativeTime } from "@/lib/issues";

export function RelativeTime({ value, className }: { value: string; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={value} className={className} title={new Date(value).toLocaleString()}>
      {relativeTime(value, Math.max(now, Date.parse(value)))}
    </time>
  );
}
