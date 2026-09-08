import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("keeps a text style size next to a text colour", () => {
    expect(cn("text-caption2 text-muted-foreground")).toBe("text-caption2 text-muted-foreground");
  });

  it("still lets a later size win over an earlier one", () => {
    expect(cn("text-footnote", "text-headline")).toBe("text-headline");
  });
});
