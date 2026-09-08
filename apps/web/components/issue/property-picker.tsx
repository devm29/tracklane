"use client";

import { Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PickerOption<V extends string | number | null> {
  value: V;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  hint?: string;
  shortcut?: string;
}

interface PickerProps<V extends string | number | null> {
  label: string;
  options: readonly PickerOption<V>[];
  selected: readonly V[];
  onSelect: (value: V) => void;
  children: ReactNode;
  multiple?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  /** Shown on hover for icon-only triggers, which have no visible label. */
  tooltip?: string;
}

/** Popover + searchable list, the building block for every issue property control. */
export function PropertyPicker<V extends string | number | null>({
  label,
  options,
  selected,
  onSelect,
  children,
  multiple = false,
  open,
  onOpenChange,
  align = "start",
  tooltip,
}: PickerProps<V>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean): void => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const choose = (option: PickerOption<V>): void => {
    onSelect(option.value);
    if (!multiple) setOpen(false);
  };

  // The digits shown next to options work while the picker is open, as they do in the list.
  const onShortcut = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    const option = options.find((candidate) => candidate.shortcut === event.key && !candidate.disabled);
    if (!option) return;
    event.preventDefault();
    choose(option);
  };

  const trigger = <PopoverTrigger asChild>{children}</PopoverTrigger>;

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent align={align} className="w-60 p-0" onClick={(event) => event.stopPropagation()}>
        <Command loop onKeyDown={onShortcut}>
          <CommandInput placeholder={`${label}…`} className="h-9 text-footnote" />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty className="py-4 text-center text-footnote text-muted-foreground">No matches</CommandEmpty>
            <CommandGroup className="p-0">
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={String(option.value)}
                    value={`${option.label} ${String(option.value)}`}
                    disabled={option.disabled ?? false}
                    onSelect={() => choose(option)}
                    className="h-8"
                  >
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                    {option.hint && <span className="ml-auto truncate text-caption2 text-muted-foreground">{option.hint}</span>}
                    {option.shortcut && !option.hint && (
                      <span className="ml-auto text-caption2 text-muted-foreground tabular-nums">{option.shortcut}</span>
                    )}
                    <Check
                      className={cn("size-3.5", option.shortcut || option.hint ? "ml-1" : "ml-auto", isSelected ? "opacity-100" : "opacity-0")}
                      strokeWidth={2}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
