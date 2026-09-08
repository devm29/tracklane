"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export type HotkeyHandler = (event: KeyboardEvent) => void;

export function isEditableTarget(target: HTMLElement): boolean {
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditableTarget(target) || target.closest("[cmdk-root]") !== null;
}

/** Enter and Space already mean "activate" on these; a page shortcut must not steal that. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("button, a[href], summary, [role=button], [role=menuitem], [role=option], [role=tab]") !== null;
}

/** Popovers, menus and dialogs close themselves on Escape; the page underneath shouldn't also react. */
function isInsideLayer(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest("[data-radix-popper-content-wrapper], [role=dialog], [role=alertdialog], [role=menu]") !== null;
}

function matches(binding: string, event: KeyboardEvent): boolean {
  const parts = binding.toLowerCase().split("+");
  const key = parts.at(-1);
  const wantsMod = parts.includes("mod");
  const wantsShift = parts.includes("shift");
  const hasMod = event.metaKey || event.ctrlKey;
  if (wantsMod !== hasMod) return false;
  if (wantsShift && !event.shiftKey) return false;
  if (event.altKey) return false;
  const pressed = event.key === " " ? "space" : event.key.toLowerCase();
  return pressed === key;
}

/** Decides whether a binding that matched should run for this event's target. */
export function shouldHandle(binding: string, event: KeyboardEvent): boolean {
  if (binding === "escape") return !isInsideLayer(event.target);
  if (binding.includes("mod")) return true;
  if (isTypingTarget(event.target)) return false;
  if ((binding === "enter" || binding === "space") && isActivatable(event.target)) return false;
  return true;
}

/**
 * Single-key shortcuts are ignored while the user is typing and leave Enter
 * and Space to focused controls; chords with mod (⌘ / Ctrl) always fire, and
 * Escape fires unless an overlay is there to handle it.
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>, enabled = true): void {
  const latest = useRef(bindings);
  useLayoutEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      for (const [binding, handler] of Object.entries(latest.current)) {
        if (!matches(binding, event) || !shouldHandle(binding, event)) continue;
        event.preventDefault();
        handler(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
