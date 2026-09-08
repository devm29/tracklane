import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The Apple text styles from globals.css are font sizes; without this, tailwind-merge reads
// `text-footnote` as a colour and drops it whenever a `text-muted-foreground` comes along.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption2", "caption", "footnote", "body-sm", "subhead", "headline", "title3", "title2", "title1"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
