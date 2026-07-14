"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bot, Sailboat, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/boats", label: "Boats", icon: Sailboat },
  { href: "/admin/ai", label: "AI settings", icon: Bot },
] as const;

/** Admin section navigation — a sidebar on desktop, a scroll row on mobile. */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <link.icon className="size-4" aria-hidden="true" />
            {link.label}
          </Link>
        );
      })}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground md:mt-3 md:border-t md:border-sidebar-border md:pt-4"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to app
      </Link>
    </nav>
  );
}
