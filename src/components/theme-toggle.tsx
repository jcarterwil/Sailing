"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/** Light/dark toggle. Icons swap via CSS `dark:` variants, so no hydration flash. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
    </Button>
  );
}
