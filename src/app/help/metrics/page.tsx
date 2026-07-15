import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  HELP_TERM_KEYS,
  helpTermAnchorId,
  listHelpTerms,
  type HelpTerm,
} from "@/content/help-registry";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Metrics glossary",
};

function TermCard({ term }: { term: HelpTerm }) {
  return (
    <article
      id={helpTermAnchorId(term.key)}
      className="scroll-mt-24 space-y-2 border-b border-border/70 py-6 last:border-b-0"
    >
      <h2 className="font-heading text-lg font-semibold tracking-tight">{term.title}</h2>
      <p className="text-sm text-pretty">{term.summary}</p>
      <p className="text-sm text-muted-foreground text-pretty">{term.body}</p>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {term.units ? (
          <div>
            <dt className="inline font-medium text-foreground">Units:</dt>{" "}
            <dd className="inline">{term.units}</dd>
          </div>
        ) : null}
        {term.frame ? (
          <div>
            <dt className="inline font-medium text-foreground">Frame:</dt>{" "}
            <dd className="inline">{term.frame}</dd>
          </div>
        ) : null}
        {term.provenance ? (
          <div>
            <dt className="inline font-medium text-foreground">Provenance:</dt>{" "}
            <dd className="inline">{term.provenance}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export default async function MetricsGlossaryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const terms = listHelpTerms();

  return (
    <AuthenticatedShell
      email={user.email ?? ""}
      displayName={profile?.display_name}
      isAdmin={profile?.is_admin ?? false}
      width="narrow"
    >
      <PageHeader
        title="Metrics glossary"
        description="Plain-language definitions for sailing metrics, Session data terms, and permissions. The same wording appears in contextual help tips across the app."
        backHref="/dashboard"
        backLabel="My Sailing"
      />

      <nav aria-label="Glossary terms" className="mt-6">
        <ul className="flex flex-wrap gap-2 text-sm">
          {HELP_TERM_KEYS.map((key) => {
            const term = terms.find((entry) => entry.key === key)!;
            return (
              <li key={key}>
                <Link
                  href={`#${helpTermAnchorId(key)}`}
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-primary underline-offset-4 hover:underline"
                >
                  {term.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-2">
        {terms.map((term) => (
          <TermCard key={term.key} term={term} />
        ))}
      </div>
    </AuthenticatedShell>
  );
}
