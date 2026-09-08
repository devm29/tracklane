import { afterEach, describe, expect, it } from "vitest";
import { shouldHandle } from "../hotkeys";

function keydown(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.querySelector<HTMLElement>("[data-target]");
  if (!element) throw new Error("no target");
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shouldHandle", () => {
  it("ignores single-key shortcuts while typing", () => {
    const input = mount(`<input data-target />`);
    expect(shouldHandle("j", keydown(input, "j"))).toBe(false);
    expect(shouldHandle("mod+k", keydown(input, "k"))).toBe(true);
  });

  it("leaves Enter and Space to a focused button or link", () => {
    const button = mount(`<button data-target>Save</button>`);
    expect(shouldHandle("enter", keydown(button, "Enter"))).toBe(false);
    expect(shouldHandle("space", keydown(button, " "))).toBe(false);
    expect(shouldHandle("j", keydown(button, "j"))).toBe(true);
    const link = mount(`<a href="/issue/1" data-target>Issue</a>`);
    expect(shouldHandle("enter", keydown(link, "Enter"))).toBe(false);
  });

  it("lets an open popover or dialog handle Escape itself", () => {
    const inPopover = mount(`<div data-radix-popper-content-wrapper><input data-target /></div>`);
    expect(shouldHandle("escape", keydown(inPopover, "Escape"))).toBe(false);
    const onPage = mount(`<main><div data-target></div></main>`);
    expect(shouldHandle("escape", keydown(onPage, "Escape"))).toBe(true);
  });
});
