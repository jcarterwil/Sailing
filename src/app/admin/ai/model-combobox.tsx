"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AiModelOption } from "@/lib/ai/settings";

/** Keep the rendered list bounded so a 200-model catalog stays responsive. */
const MAX_VISIBLE = 100;

/** Case-insensitive match on slug and display name. Empty query returns all. */
export function filterModelOptions(
  options: AiModelOption[],
  query: string,
): AiModelOption[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter(
        (option) =>
          option.id.toLowerCase().includes(needle) ||
          option.displayName.toLowerCase().includes(needle),
      )
    : options;
  return matches.slice(0, MAX_VISIBLE);
}

/**
 * A searchable model picker that still accepts free text — a valid slug the
 * live catalog happens not to list must remain typeable. Replaces the native
 * <datalist>, which showed no visible list until the field was cleared.
 */
export function ModelCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: AiModelOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  // While open, filter by what's typed; the field itself always shows `value`.
  const visible = useMemo(
    () => filterModelOptions(options, open ? query : ""),
    [options, open, query],
  );

  function commit(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) {
        setOpen(true);
        return;
      }
      event.preventDefault();
      setActive((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = visible.length;
        if (count === 0) return 0;
        return (current + delta + count) % count;
      });
      return;
    }
    if (event.key === "Enter" && open && visible[active]) {
      event.preventDefault();
      commit(visible[active].id);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          // Delay so a click on an option registers before we close.
          closeTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />
      {open && visible.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-md"
        >
          {visible.map((option, index) => {
            const selected = option.id === value;
            return (
              <li
                key={option.id}
                role="option"
                aria-selected={selected}
                // mousedown fires before blur, so the click is not swallowed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(option.id);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5",
                  index === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.id}</span>
                  {option.displayName !== option.id && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.displayName}
                    </span>
                  )}
                </span>
                {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
