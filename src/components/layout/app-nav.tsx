"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BookOpenText,
  Boxes,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Shield,
  Waves,
  type LucideIcon,
} from "lucide-react";

import {
  APP_NAV_ITEMS,
  isAppNavItemActive,
  type AppNavIcon,
} from "@/components/layout/app-nav-model";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

const NAV_ICONS = {
  dashboard: LayoutDashboard,
  boats: Boxes,
} satisfies Record<AppNavIcon, LucideIcon>;

function PrimaryNavItems({
  pathname,
  mobile = false,
  onNavigate,
}: {
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return APP_NAV_ITEMS.map((item) => {
    const active = isAppNavItemActive(pathname, item);
    const Icon = NAV_ICONS[item.icon];

    return (
      <Button
        key={item.id}
        asChild
        variant={active ? "secondary" : "ghost"}
        size={mobile ? "lg" : "sm"}
        className={mobile ? "min-h-11 w-full justify-start px-4" : "min-h-11 px-3"}
      >
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      </Button>
    );
  });
}

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
  const [mobileOpen, setMobileOpen] = useState(false);
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
      <div className="mx-auto flex h-14 w-full max-w-7xl min-w-0 items-center gap-1 px-4 sm:gap-2 sm:px-10 lg:px-12">
        <Link
          href="/dashboard"
          className="mr-1 inline-flex min-h-11 min-w-11 items-center gap-2 font-heading font-semibold sm:mr-2"
        >
          <Waves className="size-5 text-primary" aria-hidden="true" />
          <span>Sailing</span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary navigation">
          <PrimaryNavItems pathname={pathname} />
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                className="min-h-11 min-w-11 px-2 sm:hidden"
                aria-label="Open primary navigation"
              >
                <Menu className="size-5" aria-hidden="true" />
                <span className="text-xs">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0"
            >
              <SheetHeader className="border-b border-border/70 pr-16">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Move between your sailing workspace and boats.</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1 p-4" aria-label="Mobile primary navigation">
                <PrimaryNavItems
                  pathname={pathname}
                  mobile
                  onNavigate={() => setMobileOpen(false)}
                />
              </nav>
            </SheetContent>
          </Sheet>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 rounded-full"
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
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/boats">
                  <Boxes className="size-4" aria-hidden="true" /> My boats
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/help/metrics">
                  <BookOpenText className="size-4" aria-hidden="true" /> Metrics glossary
                </Link>
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem asChild className="min-h-11">
                  <Link href="/admin/users">
                    <Shield className="size-4" aria-hidden="true" /> Admin
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11"
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
