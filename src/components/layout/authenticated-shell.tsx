import type { ReactNode } from "react";

import { AppNav } from "@/components/layout/app-nav";
import {
  PageShell,
  type PageShellWidth,
} from "@/components/layout/page-shell";

/** Shared frame for standard authenticated product pages. */
export function AuthenticatedShell({
  children,
  email,
  displayName,
  isAdmin = false,
  width = "default",
  className,
}: {
  children: ReactNode;
  email: string;
  displayName?: string | null;
  isAdmin?: boolean;
  width?: PageShellWidth;
  className?: string;
}) {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <AppNav email={email} displayName={displayName} isAdmin={isAdmin} />
      <PageShell width={width} className={className}>
        {children}
      </PageShell>
    </div>
  );
}
