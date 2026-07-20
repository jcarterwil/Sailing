/** One user-facing product change, summarized from shipped GitHub work. */
export type ChangelogEntry = {
  /** Stable id used for unread tracking. Prefer `YYYY-MM-DD-slug`. */
  id: string;
  /** Calendar date the change shipped (UTC), `YYYY-MM-DD`. */
  date: string;
  title: string;
  /** Short sailor-facing summary — not a raw PR title. */
  summary: string;
  /** Merged PR numbers this entry is based on. */
  prs: readonly number[];
};
