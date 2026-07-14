"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Boxes, LayoutDashboard, Loader2, LogOut, Shield, Waves } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/boats", label: "My boats", icon: Boxes },
] as const;

/** Persistent top navigation for authenticated pages. */
export function AppNav({
  email,
  displayName,
  isAdmin = false,
}: {
  email: string;
  displayName?: string | null;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const initials = (displayName || email).slice(0, 2).toUpperCase();

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-6 sm:px-10 lg:px-12">
        <Link
          href="/dashboard"
          className="mr-2 inline-flex items-center gap-2 font-heading font-semibold"
        >
          <Waves className="size-5 text-primary" aria-hidden="true" />
          <span>Sailing</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Button
                key={item.href}
                asChild
                variant={active ? "secondary" : "ghost"}
                size="sm"
              >
                <Link href={item.href}>
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="Account menu"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate">{displayName || "Account"}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/boats">
                  <Boxes className="size-4" aria-hidden="true" /> My boats
                </Link>
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem asChild>
                  <Link href="/admin/users">
                    <Shield className="size-4" aria-hidden="true" /> Admin
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={signingOut}
                onSelect={(event) => {
                  event.preventDefault();
                  void signOut();
                }}
              >
                {signingOut ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="size-4" aria-hidden="true" />
                )}
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
