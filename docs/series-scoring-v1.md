# Series Low Point V1 scoring contract

Status: locked app-defined contract for #91, established by #138.

Low Point V1 is a deterministic product rule, not a claim of compliance with World Sailing, a class association, a sailing instruction, or any other governing body. An organizer must publish the rules that actually govern an event. A future rules profile must use a new version instead of silently changing this contract.

## 1. Source contract

`scoreSeriesLowPointV1` accepts `unknown` and returns one of three typed states:

- `valid`, with a complete score and no issues;
- `invalid`, with bounded validation issues and no partial standings;
- `unsupported`, when the top-level contract version is not `v: 1` and `scoringVersion: low-point-v1`.

The pure engine is isomorphic. It has no database, browser, React, Node built-in, or third-party runtime dependency. Inputs are capped at 200 competitors, 100 races, 300 results per race, 20 discard thresholds, and 100 returned issues. Stable IDs are capped at 200 characters.

Every race supplies immutable source evidence:

| Field | Meaning |
|---|---|
| `analysisVersion` | race analysis revision used by the result |
| `performanceCalculationVersion` | deployed single-race calculation contract |
| `correctionsVersion` | organizer correction revision, or `null` |
| `officialResultsRevision` | official result revision scored by the series |

The engine sorts competitors by `boatId`, races by sequence then `raceId`, and result rows by boat and entry. It hashes the normalized contract with SHA-256. The resulting 64-character `sourceFingerprint` changes when any scored source or configured rule changes and is identical when only input array order changes.

## 2. Identity and result validation

Series identity is explicit:

- `competitor` must reference a registered series `boatId` and is eligible for standings;
- `guest` must not reference a registered `boatId`, may affect race scoring populations, and never receives a series standing;
- `unresolved` is a blocking validation issue.

Every included, completed race requires one explicit result per registered competitor. The engine never infers DNS. Duplicate competitor, race, sequence, entry, or per-race boat rows are invalid.

`FIN` requires a positive integer official place. DNS, DNF, OCS, RET, and DSQ require `place: null` and `tied: false`. A declared finish tie contains at least two rows at the same place, every row is marked `tied`, and the next place advances by the number of positions occupied. For example, a two-way tie at second occupies places 2 and 3, so the next finisher is fourth.

Missing, contradictory, or unresolved official truth returns issues; it never produces a plausible-looking partial table.

## 3. Race points

All calculations use integer hundredths. Floating-point scores are never used for totals, sorting, discards, or ties.

For a normal finish occupying places from `p` through `p + n - 1`:

$$
\text{base points} = \frac{p + (p+n-1)}{2}
$$

Thus a two-way tie at second gives each boat 2.50 points.

The default non-finish rules are:

| Status | Base points |
|---|---|
| DNS | entrants + 1 |
| DNF | starters + 1 |
| OCS | starters + 1 |
| RET | starters + 1 |
| DSQ | starters + 1 |

An entrant is any resolved result row in the configured population. A starter is an entrant whose status is not DNS. Guests count in both populations by default; `countGuestsInPopulation: false` explicitly excludes them. Guests still retain their official finish places, but never appear in standings.

Penalty points are nonnegative, additive after base scoring, capped at 10,000, and limited to two decimal places:

$$
\text{race points} = \text{base points} + \text{penalty points}
$$

Excluded, abandoned, and not-yet-completed races have `totalPointsHundredths: null`, an explicit reason, and no effect on totals or discards.

A valid race score also emits its entrant/starter counts and `validation: { status: "valid", issueCount: 0 }`. Invalid source data returns the top-level typed invalid outcome without partial race scores or standings.

## 4. Discards

The default schedule has no discards. An organizer may supply monotonic thresholds beginning with `{ minCompletedRaces: 0, discards: 0 }`. At a given series state, the last threshold whose completed-race count has been reached is active.

Only included, completed races marked `discardEligible` may be discarded. The active discard count cannot exceed the number of such races. Each competitor discards the highest eligible totals. If equal worst totals compete for the final discard slot, the earliest race by sequence is discarded first. Gross, discarded, and net totals remain explicit in the output.

## 5. Standings and tie evidence

Standings sort by these sporting rules in order:

1. lowest net points;
2. lexicographic comparison of kept race scores sorted best to worst;
3. latest differing scored race, comparing newest to oldest and including discarded races;
4. shared competition rank when every sporting comparison remains equal.

`boatId` is used only to make display order deterministic inside a final shared rank. It never breaks a sporting tie. Every standing contains the kept-score vector, latest-race vector, decisive stage, optional decisive race, race-level formula evidence, discard flags, and source revisions.

## 6. Golden acceptance fixture

`src/lib/analytics/series/__fixtures__/low-point-v1.ts` locks a six-competitor, seven-race series with one guest, a declared tie, all non-finish statuses, an additive penalty, an abandoned race, an excluded race, and thresholds for zero, one, and two discards. Tests additionally lock:

- order-independent output and fingerprints;
- guest population behavior;
- earliest-first equal-worst discards;
- localized correction effects;
- malformed and unresolved result rejection;
- best-kept, latest-race, and final shared-rank tie outcomes;
- exact hundredth-point formatting and a standard SHA-256 vector.

## 7. Non-goals

V1 does not define starting penalties, redress, scoring penalties expressed as percentages, average points across other races, multiple fleets/divisions, qualifying/final splits, throw-out exceptions, race committees' protest procedures, or governing-body rule precedence. Those require an explicit later contract rather than ad hoc conditionals in V1.
