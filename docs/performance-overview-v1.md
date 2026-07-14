# Performance Overview V1 metric contract

Status: locked contract for #66, established by #76. Later implementation may add optional fields only through a new version; it must not silently change these semantics.

## 1. Product and report scope

Performance Overview V1 describes one race. It is a deterministic factual report, separate from the Coach report. The persisted source of truth is one compact `RaceAnalysis.performance` subdocument with `v: 1`; raw tracks are loaded only for authorized visual drilldowns.

The report inventory is:

1. race, analyzed-wind, weather-context, and data-quality summary;
2. per-entry status, finish, elapsed time, race rank, and winner delta;
3. best sustained 500 m, 1,000 m, and 1,852 m intervals;
4. whole-race comparative metrics and bounded VMG distributions;
5. finite start-line analysis from gun -60 s through gun +60 s;
6. one ordered section per validated course leg;
7. deterministic, cited opportunity cards added by #89;
8. definitions, versions, coverage, provenance, warnings, and null reasons.

The ChartedSails reference is a feature inventory, not a metric oracle. In particular, V1 independently ranks every leg, never invents per-boat finishes from a fleet boundary, never combines forecast and analyzed wind, and never claims a page total that differs from the browser's rendered output.

## 2. Shared calculation rules

### 2.1 Time, sampling, gaps, and boundaries

- Source timestamps are epoch milliseconds UTC.
- Crossings, passages, and exact-distance interval endpoints use full-resolution source points and linear interpolation on one eligible source segment.
- Comparative SOG, VMG, attitude, and duration aggregates use canonical 1 Hz samples.
- A source interval with `dt > 10,000 ms` is a gap. No interpolation, path distance, duration, crossing, passage, or interval may bridge it. Exactly 10,000 ms remains eligible.
- A sample on a scope start is included; a sample on the scope end belongs to the ending scope only. A maneuver belongs to the leg containing its center `tMs`; a boundary-center event belongs to the following leg, except the final finish boundary remains in the final leg.
- Whole-race scope begins at the corrected gun. It ends at that entry's valid finish. If unresolved, non-result metrics may end at the last supported passage and must set `partial=true`.
- Leg scope is that entry's monotonic passage at the leg start through its passage at the leg end. A missing boundary makes that entry/leg unavailable without invalidating unrelated legs.
- Duration-weighted averages integrate valid values over eligible time. A logger's sample rate never changes its weight.
- Calculations retain full precision. Rounding is presentation-only and never changes ranks, ties, bins, deltas, or winners.

### 2.2 Coordinates, distance, speed, and angles

- Coordinates are WGS84 latitude/longitude degrees. Latitude is `[-90,90]`; longitude is `[-180,180]`.
- Local finite-line operations use a documented local XY projection. Long courses use existing geodesic `haversineM` and `bearingDeg` helpers.
- SOG/VMG use knots. Distance uses metres; the UI may additionally display nautical miles using `1 nm = 1,852 m`.
- Bearings and TWD are degrees true normalized to `[0,360)`. Signed TWA uses `norm180`, whose range is `(-180,180]`.
- Canonical signed TWA is `norm180(TWD - COG)`: positive is starboard tack and negative is port tack. COG is ineligible below the named minimum-making-way threshold.
- Upwind progress VMG is `SOG × cos(|TWA|)`.
- Downwind progress VMG is `-SOG × cos(|TWA|)`.
- Reach/unknown legs have direction-specific progress VMG fields `null`; they are not relabeled to fill a table.
- The sole TWD input to TWA, VMG, and course classification is corrected `RaceAnalysis.wind` at the sample timestamp. Forecast/historical weather is contextual only.

### 2.3 Straight versus maneuver samples

- A maneuver window is the existing classified tack/gybe `Maneuver.window` clipped to the eligible scope.
- Samples inside the union of assigned tack/gybe windows are `maneuver`; other valid making-way samples are `straight`.
- Overlapping maneuver windows are unioned for duration/VMG so time is never double counted.
- A maneuver is counted once by its center time. `Maneuvers` means tacks plus gybes only; unidentified turns/mark roundings are excluded.
- Whole-race counts must equal the sum of assigned leg counts plus explicit unassigned counts for tacks, gybes, and botched maneuvers.
- Straight duration, maneuver duration, and excluded/invalid duration must explain the eligible scope without overlap.

### 2.4 Null, zero, and warnings

- Every unavailable or unreliable numeric value is `null`, never `NaN`, `Infinity`, or an implicit zero.
- Every field declared by the V1 interfaces is a required JSON key. Nullable fields use an explicit `null`; omitting one is malformed V1 input rather than an alternate encoding.
- Zero is valid only when the measured/computed quantity is genuinely zero. Example: a legal-status boat still pre-start at gun +30 s may have `dmg30M=0`.
- Each null is explained by section provenance, `warningCodes`, `unavailableReason`, or a top-level warning. UI renders null as `—` plus the reason.
- A recoverable data problem returns bounded warnings and partial output. Unsupported/malformed persisted versions return an explicit parser state and do not throw into page rendering.

### 2.5 Confidence and provenance

Every persisted fact inherits a section/row `PerformanceProvenanceV1`:

| Field | Meaning |
|---|---|
| `source` | `processed-track`, `corrected-analysis`, detected geometry, organizer override, timer event, line crossing, passage approach, computed, or unavailable |
| `confidence` | `high`, `medium`, `low`, or `unavailable` |
| `inputs` | bounded stable labels/versions, never raw tracks or private identifiers |
| `coveragePct` | eligible duration divided by requested scope duration × 100; null if the scope itself is unavailable |
| `note` | optional bounded explanation; null when unnecessary |

Organizer overrides are authoritative but remain visibly distinct from evidence. Confidence describes evidence support, not whether an organizer was entitled to make the correction.

## 3. Persisted document and bounds

`PerformanceAnalysisV1` is JSON-safe and has no React, Supabase, server, storage-path, or user-identity fields.

| Field | Unit / rule | Null rule and provenance |
|---|---|---|
| `v` | literal `1` | never null |
| `metricContract` | literal `performance-overview-v1` | never null |
| `calculationVersion` | deployed pure-engine version label | never null |
| `timezone.iana` | explicit IANA zone used only for presentation | never null; legacy fallback is `UTC` |
| `timezone.source` | race metadata, weather-location, or UTC fallback | never null and visibly labeled when fallback |
| `course` | §4 | section provenance required |
| `results[]` | at most 100 current entries, stable by `entryId` | one row per current entry |
| `start` | §6 | unavailable geometry uses null fields plus provenance |
| `wholeRace[]` | §7, at most 100 | one row per eligible current entry |
| `legs[]` | at most 16, course order | no sorting by winner/direction |
| `bestIntervals[]` | one three-slot row per entry | missing target is a literal null slot |
| `distributions[]` | §9, at most 512 series | optional series may be omitted with warning |
| `warnings[]` | at most 256, messages at most 300 chars | stable codes, bounded scope |
| `provenance` | contract/calculation/wind/correction versions and constants | no raw samples |

Hard caps are exported from `constants.ts`: 100 entries, 200 characters per stable entry ID, 16 legs, 17 course points/passages per entry, 512 distribution series, 200 bins per series, 12,000 total bins, 256 warnings, and a 1 MiB UTF-8 serialized performance payload. Before persistence, optional distributions are omitted deterministically with `distribution-omitted`/`payload-limited` warnings; core course/result/start/metric facts are retained.

No persisted array is populated from an unbounded input without a named cap. Entry, leg, course-point, result, passage, best-interval, distribution, bin, warning, and provenance-input arrays all have explicit limits.

Raw-track drilldown series are not persisted. An authorized worker may return at most 2,000 display points per boat and 12,000 points per rendered chart. If the selected fleet would exceed the chart cap, every boat receives the same deterministic reduction ratio. Min/max-preserving downsampling retains the first/last valid point and local extrema; a gap marker is retained for every source gap, and a line is never drawn across one. The UI progressively mounts one start/leg drilldown rather than materializing all six pages at once.

## 4. Course geometry and passages

### 4.1 Course fields

| Field | Unit / formula | Eligibility / null / provenance |
|---|---|---|
| `course.points[].index` | zero-based ordered point | contiguous course order |
| `kind` | start, mark, finish | never inferred from display order |
| `atMs` | epoch ms UTC | null only when boundary time unavailable |
| `position` | WGS84 degrees | midpoint for a line; null when unsupported |
| `line` | two WGS84 endpoints, geodesic `lengthM`, `bearingDeg` true | start/finish line only; null for point geometry |
| `supportingEntryCount` | integer entries | 0 allowed only with low/unavailable provenance |
| `spreadM` | robust cluster spread metres | null when no cluster was calculated |
| `course.legs[].distanceM` | geodesic start-to-end distance | null when either endpoint unavailable |
| `bearingDeg` | initial geodesic bearing true | null with unavailable geometry |
| `courseTwaDeg` | `norm180(TWD - bearing)` | null without corrected TWD/bearing |
| `courseDistanceM` | sum of all non-null leg geometric distances only when every required leg is supported | null if any required leg distance is missing; never sailed distance |

The corrected two-ended start-line midpoint is the authoritative course origin. A fleet centroid at gun is low-confidence course origin only and is never promoted to a start line. Mark and finish cluster rules, outlier rejection, minimum support, and warnings are implemented by #77.

Course geometry uses one closest-approach candidate per entry. Component-wise local-XY medians are recomputed once after rejecting candidates beyond `max(150 m, 3 × MAD)`. At least two entries are required, clusters wider than 250 m are unavailable, mark-seed searches are capped at 300 m, and entry passages must approach within 75 m. These values are named exports in `constants.ts`.

### 4.2 Passage fields

`passagesByEntry[]` is stable by `entryId`; each passage is stable by `pointIndex`.

| Field | Unit / formula | Eligibility / null / provenance |
|---|---|---|
| `timeMs` | linearly interpolated epoch ms on closest eligible segment | null when no approach inside radius/window/gap rules |
| `minDistanceM` | minimum distance from eligible segment to point/finite line | null when no eligible segment |
| `source` | gun, segment approach, finite-line crossing, timer event, organizer override, unavailable | explicit |
| `confidence` | support/geometry quality | unavailable with null time |
| `warningCodes[]` | bounded stable codes | includes missing/non-monotonic passage reason |

Search windows are monotonic between neighboring fleet transition midpoints. A passage cannot precede the prior entry passage. A missing passage invalidates only leg scopes that require it.

## 5. Results, status, ranking, and delta

Finish resolution order is: organizer correction; legal corrected-finish crossing/passage; valid per-track `race_end` timer after gun; unresolved. The fleet finish boundary and final recorded point are never silently used as an entry finish.

| Field | Unit / formula | Eligibility / null / provenance |
|---|---|---|
| `status` | finished, DNS, DNF, RET, OCS, DSQ, unresolved | organizer status wins; otherwise finished requires evidence |
| `finish.timeMs` | epoch ms UTC | null finish object when absent |
| `finish.source` | organizer override, finite-line crossing, passage approach, timer event | explicit; passage approach is never labeled as a line crossing |
| `finish.distanceM` | crossing/approach evidence metres | null when not applicable to organizer/timer source |
| `elapsedMs` | `finish.timeMs - corrected gun` | null without valid finish |
| `rank` | integer displayed place | null for non-finish/unresolved |
| `tied` | true when elapsed finishes are within 500 ms and no organizer place breaks tie | never inferred from rounded display |
| `deltaMs` | `elapsedMs - minimum valid elapsedMs` | nonnegative; null for non-finish/unresolved |
| `officialPlaceOverride` | organizer integer place | null when absent; never overwrites analytical elapsed |
| `note` | bounded organizer note, max 500 chars | null when absent; not sent as metric evidence |
| `reviewRequired` | data-quality boolean | true for ambiguous/missing truth |

Organizer places occupy their explicit positive unique slots. Remaining valid finishers fill unused places by unrounded elapsed, then `entryId`. Elapsed ties inside 500 ms share rank unless explicit places break them. Presentation formats delta once as `+MM:SS`; it never produces a double sign.

## 6. Start analysis

Start analytics require the corrected gun, a finite two-ended start line, and course side from the first validated course-leg axis. Corrected TWD is a fallback only for an upwind first leg and is labeled lower confidence.

Crossing must intersect the finite segment, with 5 m endpoint tolerance. It is interpolated only on an eligible source segment. More than 2 m on course side at gun is OCS-candidate. An OCS boat must return to pre-start side then cross legally; the recross supplies its legal crossing time.

| Field | Unit / formula | Eligibility / null / provenance |
|---|---|---|
| `gunTimeMs` | epoch ms UTC | null when corrected gun unavailable |
| `line` | finite line contract | null when incomplete |
| `courseSideBearingDeg` | degrees true | null when course side unavailable |
| `windowStartMs/endMs` | gun ±60 s | null without gun |
| `entries[].status` | legal, OCS-recrossed, OCS-no-recross, no-crossing, unavailable | always explicit |
| `crossingTimeMs` | first legal post-gun crossing/recross | null without legal crossing |
| `timeToLineMs` | `crossingTimeMs - gunTimeMs` | signed; null without crossing |
| `sogAtGunKts` | linearly interpolated SOG | null across gap/outside coverage |
| `sogAtLineKts` | SOG interpolated on crossing segment | null without crossing |
| `distanceToLineAtGunM` | shortest distance to finite line | nonnegative; null without position/line |
| `signedLineSideDistanceAtGunM` | local-XY signed perpendicular distance; positive is course side | null without course-side orientation |
| `dmg30M` | course-axis progress beyond line at gun +30 s, clamped to 0 before legal crossing | zero is valid; null is unavailable |
| `vmg30Kts` | `dmg30M / 30 / 0.514444` | null when `dmg30M` unavailable |
| `rank` | unrounded legal crossing order; ties within 500 ms | null for no legal crossing |

Start rank is independent of race rank.

## 7. Whole-race and per-leg metrics

`wholeRace[]` and `legs[].metrics[]` use the same `PerformanceMetricsV1` field contract. Race result rank/delta comes from §5. Every leg ranks independently by valid unrounded leg duration; ties are within 500 ms, and delta is from that leg's actual fastest entry.

| Field | Unit / formula | Eligibility / null / provenance |
|---|---|---|
| `entryId` | stable current entry ID | never display-name identity |
| `elapsedMs` | scope end - start | null without both boundaries |
| `rank`, `deltaMs` | scope rules above | null when duration unavailable |
| `tied` | whether the entry shares its non-null rank | false when duration/rank unavailable |
| `avgSogKts` | duration-weighted mean valid 1 Hz SOG | null with no eligible duration |
| `maxSogKts` | maximum eligible unrounded SOG | null with no eligible sample |
| `sailedDistanceM` | sum eligible consecutive geodesic segments | excludes gaps/invalid fixes |
| `courseDistanceM` | validated geometric scope distance | null without geometry |
| `excessDistanceM` | `max(0, sailedDistanceM - courseDistanceM)` | null if either input unavailable |
| `courseEfficiencyPct` | `100 × courseDistanceM / sailedDistanceM` | null when denominator ≤0/missing; may be capped only in presentation, not data |
| `upwindVmg/downwindVmg.straightKts` | duration-weighted progress VMG outside maneuver union | null for wrong/unknown direction or no samples |
| `maneuverKts` | duration-weighted progress VMG inside maneuver union | same direction/null rules |
| `straightDurationSec`, `maneuverDurationSec` | eligible seconds | zero is valid when category absent |
| `avgAbsTwaDeg` | duration-weighted mean `abs(signed TWA)` | null without valid wind/COG |
| `avgAbsHeelDeg` | duration-weighted mean absolute heel | null when absent; other metrics remain valid |
| `avgSignedTrimDeg` | duration-weighted signed pitch/trim; positive bow-up | null when absent |
| `maneuvers.tacks/gybes/botched/unassigned` | classified event counts | integer, never a generic unidentified count |
| `maneuverWindowDurationSec` | unioned clipped maneuver windows | nonnegative |
| `avgVmgRetention` | duration/event-weighted valid existing retention metric | null without valid maneuvers |
| `contributingDurationSec` | union of eligible sample intervals | nonnegative |
| `sampleCount` | canonical eligible 1 Hz samples | diagnostic, not weighting |
| `excludedDurationSec` | requested scope not contributing because gap/invalid/classification rules | nonnegative |
| `partial` | true when unresolved finish or incomplete boundary limits scope | explicit |

## 8. Best-distance intervals

For target `D ∈ {500, 1000, 1852}` metres, each contiguous valid finished-race path builds cumulative geodesic distance. A two-pointer search linearly interpolates both target boundaries so evaluated path distance equals `D` within 0.01 m. Score is `averageSpeedKts = D / elapsedSeconds / 0.514444`, not mean sampled SOG.

| Field | Unit / rule | Null / provenance |
|---|---|---|
| `targetDistanceM` | exact 500, 1000, or 1852 | fixed three-slot order |
| `startTimeMs/endTimeMs` | interpolated UTC epoch ms | interval slot null if unavailable |
| `elapsedMs` | positive end-start | reject nonpositive/implausible |
| `averageSpeedKts` | formula above | full precision |
| `fleetBest` | maximum unrounded speed for that target | equal speed tie-break: earliest start, then entry ID |

Intervals cannot cross race boundaries, invalid coordinates, duplicate/backward timestamps, or gaps over 10 s.

## 9. VMG distributions

Distributions consume canonical 1 Hz progress-VMG samples. Partitions are race/leg × upwind/downwind × port/starboard × all/straight. All entries in one scope/direction use identical bin edges.

- Width is exactly 0.25 kt.
- Domain starts at 0 and ends at `min(50, ceil(fleetMax / 0.5) × 0.5)` kt.
- Values below 0 remain in `underflowSeconds`; values above 50 remain in `overflowSeconds` plus a warning.
- At least 20 eligible seconds are required. Otherwise `available=false`, quartiles are null, bins may be empty, and `unavailableReason` is required.
- `seconds` is contributing duration in the half-open bin `[lowerKts, upperKts)`, with the final upper edge inclusive.
- `densityPerKt = seconds / totalInRangeSeconds / binWidthKts`; bin density integrates to 1 over in-range mass. Under/overflow remain separately reconcilable.
- Quartiles are deterministic duration-weighted empirical Q1/median/Q3 values.

The UI may visually interpolate the persisted bins but must not replace their values with an unspecified KDE.

## 10. Timezone and presentation

All analytics remain UTC. Local timestamps use `timezone.iana`, never the server/browser default. Metadata resolution order is:

1. validated `races.timezone`;
2. validated persisted weather-location timezone;
3. `UTC` with `timezone.source="utc-fallback"` and a visible fallback label.

Validation uses `Intl.DateTimeFormat` at the race-metadata boundary. Authenticated, public, and print view models must receive the same resolved timezone. Presentation specifies the local zone abbreviation/name and offers exact UTC in accessible descriptions for corrected/official times.

Rounding defaults: elapsed/delta/time-to-line to nearest displayed second; speeds/VMG to 0.01 kt; distance to nearest metre below 10 km and appropriate nautical-mile precision above; angles to 0.1°. These defaults never feed back into calculations.

## 11. Parser states and compatibility

`parseStoredPerformance(storedAnalysis)` returns exactly one state:

- `missing`: a valid legacy outer analysis has no own `performance` property;
- `valid`: complete bounded V1;
- `unsupported`: the performance object has `v !== 1`;
- `malformed`: wrong shapes, invalid/non-finite numbers, bounds violations, non-JSON values, or payload over 1 MiB.

Parsing never throws into page rendering. Consumers do not cast JSONB directly. A legacy analysis may continue to power Replay/Coach behavior but Performance Overview shows `upgrade-required` until organizer reanalysis.

## 12. Synthetic fixture and tolerances

`src/lib/analytics/performance/__fixtures__/six-boat-five-leg.ts` generates six sanitized boats, mixed 1 Hz/2 Hz logs, a finite start line, U/D/U/D/U legs, distinct per-entry passage/finish timers, tacks/gybes, an OCS/recross, a >10 s source gap, and one boat with missing heel/trim. No `Examples/` or private race correspondence is copied.

`six-boat-five-leg.expected.json` locks structural outcomes and tolerances:

- full-resolution passage time: 1,000 ms;
- mixed-rate aggregate relative tolerance: 0.001;
- course point: 15 m; total course distance: 1 m;
- angle: 0.5°;
- exact-distance path: 0.01 m; speed: 0.001 kt;
- ranking tie threshold: 500 ms.

`valid-performance-v1.ts` is a complete bounded contract fixture for parser and downstream round-trip tests. Metric engine PRs replace representative contract values with computed goldens while preserving the locked shape/semantics.

## 13. Explicit V1 exclusions

V1 does not include:

- multi-race series/regatta scoring, Low Point, discards, tie-breaks across races, handicaps, or corrected time;
- target polars without a validated source;
- current, leeway, or water-speed conclusions without appropriate sensors/models;
- causal setup, crew, sail, or condition claims;
- automatic official race-committee certification or protest decisions;
- raw/full chart series in JSONB or raw tracks sent to an LLM;
- an LLM calculating metric values, ranks, deltas, or estimated seconds;
- a server PDF service or hard-coded physical page total;
- a second public token, correction table, or performance cache.
