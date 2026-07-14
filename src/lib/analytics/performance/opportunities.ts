import {
  MIN_MAKING_WAY_SOG_KTS,
  PERFORMANCE_KNOT_TO_MPS,
  PERFORMANCE_MARK_RECOVERY_MIN_SAMPLES,
  PERFORMANCE_MARK_RECOVERY_WINDOW_SECONDS,
  PERFORMANCE_OPPORTUNITY_ASYMMETRY_KTS,
  PERFORMANCE_OPPORTUNITY_CONSISTENCY_IQR_KTS,
  PERFORMANCE_OPPORTUNITY_MAX_OBSERVATIONS,
  PERFORMANCE_OPPORTUNITY_MAX_PRIMARY,
  PERFORMANCE_OPPORTUNITY_MAX_SUPPRESSED,
  PERFORMANCE_OPPORTUNITY_MIN_SECONDS,
  PERFORMANCE_OPPORTUNITY_MIN_VMG_KTS,
  PERFORMANCE_OPPORTUNITY_TIE_KTS,
} from "@/lib/analytics/constants";
import { columnLength, epochAt, finite, mean } from "@/lib/analytics/internal";
import { resamplePerformanceInterval } from "@/lib/analytics/performance/samples";
import type {
  PerformanceAnalysisV1,
  PerformanceDistributionV1,
  PerformanceEntryOpportunitiesV1,
  PerformanceMetricsV1,
  PerformanceOpportunitiesV1,
  PerformanceOpportunityCategory,
  PerformanceOpportunitySuppressionV1,
  PerformanceOpportunityV1,
  PerformanceStartEntryV1,
} from "@/lib/analytics/performance/types";
import type { ProcessedTrack, RaceAnalysis } from "@/lib/analytics/types";

const NON_ADDITIVE_CAVEAT = "Non-additive estimate; do not sum it with other opportunity cards.";

export interface OpportunityDetectorResult {
  opportunity: PerformanceOpportunityV1 | null;
  suppression: PerformanceOpportunitySuppressionV1 | null;
}

export interface MarkRecoveryEvidence {
  entryId: string;
  legIndex: number;
  markIndex: number;
  preAverageSogKts: number | null;
  postAverageSogKts: number | null;
  preSampleCount: number;
  postSampleCount: number;
  sourceGap: boolean;
}

function rounded(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function suppression(
  category: PerformanceOpportunityCategory,
  reason: string,
  legIndex?: number,
): PerformanceOpportunitySuppressionV1 {
  return { category, ...(legIndex === undefined ? {} : { legIndex }), reason };
}

function card(input: Omit<PerformanceOpportunityV1, "priority">): PerformanceOpportunityV1 {
  return { ...input, priority: 0 };
}

function result(
  category: PerformanceOpportunityCategory,
  opportunity: PerformanceOpportunityV1 | null,
  reason: string,
  legIndex?: number,
): OpportunityDetectorResult {
  return opportunity
    ? { opportunity, suppression: null }
    : { opportunity: null, suppression: suppression(category, reason, legIndex) };
}

/** Compare legal line arrival and 30-second made-good evidence without combining them. */
export function detectStartOpportunity(
  own: PerformanceStartEntryV1,
  fleet: readonly PerformanceStartEntryV1[],
): OpportunityDetectorResult {
  const category = "start" as const;
  if (own.warningCodes.includes("source-gap")) {
    return result(category, null, "A source gap intersects the start evidence.");
  }
  const benchmarks = fleet
    .filter((entry) => entry.status === "legal" && !entry.warningCodes.includes("source-gap") &&
      finite(entry.timeToLineMs) && entry.timeToLineMs >= 0)
    .map((entry) => entry.timeToLineMs!);
  if (!finite(own.timeToLineMs) || benchmarks.length === 0) {
    return result(category, null, "A legal crossing time and fleet legal-start benchmark are required.");
  }
  const benchmarkMs = Math.min(...benchmarks);
  const benchmarkDmg30M = Math.max(...fleet.flatMap((entry) =>
    entry.status === "legal" && !entry.warningCodes.includes("source-gap") && finite(entry.dmg30M)
      ? [entry.dmg30M]
      : []));
  const estimatedSeconds = Math.max(0, (own.timeToLineMs - benchmarkMs) / 1_000);
  if (estimatedSeconds < PERFORMANCE_OPPORTUNITY_MIN_SECONDS) {
    return result(category, null, "Line-arrival difference is tied or below the materiality threshold.");
  }
  return result(category, card({
    code: "start-line-arrival",
    scope: { entryId: own.entryId },
    category,
    headline: "Start line arrival trailed the best legal start",
    estimatedSeconds: rounded(estimatedSeconds),
    benchmark: { kind: "fleet_best", value: rounded(benchmarkMs / 1_000), unit: "s after gun" },
    evidence: [
      { label: "Own line arrival", value: rounded(own.timeToLineMs / 1_000), unit: "s after gun" },
      ...(own.dmg30M === null ? [] : [{ label: "Own DMG at 30 s", value: rounded(own.dmg30M), unit: "m" }]),
      ...(Number.isFinite(benchmarkDmg30M) ? [{ label: "Fleet-best DMG at 30 s", value: rounded(benchmarkDmg30M), unit: "m" }] : []),
    ],
    assumptions: [`Start status is ${own.status}; the estimate uses legal line-arrival timing only.`],
    caveats: [NON_ADDITIVE_CAVEAT, "DMG30 is supporting evidence and is not added to the estimate."],
  }), "", undefined);
}

function directionalMetric(metric: PerformanceMetricsV1, legType: string) {
  return legType === "upwind"
    ? metric.upwindVmg
    : legType === "downwind"
      ? metric.downwindVmg
      : null;
}

/** Apply distance × (1/own VMG − 1/benchmark VMG) with knots converted to m/s. */
export function detectStraightVmgOpportunity(input: {
  entryId: string;
  legIndex: number;
  legType: string;
  distanceM: number | null;
  own: PerformanceMetricsV1;
  fleet: readonly PerformanceMetricsV1[];
}): OpportunityDetectorResult {
  const category = "straight_vmg" as const;
  if (input.own.partial || input.own.warningCodes.includes("source-gap")) {
    return result(category, null, "A source gap or partial leg makes straight-VMG comparison ineligible.", input.legIndex);
  }
  const ownVmg = directionalMetric(input.own, input.legType)?.straightKts ?? null;
  const fleetVmgs = input.fleet.flatMap((metric) => {
    if (metric.partial || metric.warningCodes.includes("source-gap")) return [];
    const value = directionalMetric(metric, input.legType)?.straightKts;
    return finite(value) && value >= PERFORMANCE_OPPORTUNITY_MIN_VMG_KTS ? [value] : [];
  });
  if (!finite(input.distanceM) || input.distanceM <= 0 || !finite(ownVmg) ||
      ownVmg < PERFORMANCE_OPPORTUNITY_MIN_VMG_KTS || fleetVmgs.length === 0) {
    return result(category, null, "Comparable leg distance and straight-line VMG evidence are required.", input.legIndex);
  }
  const benchmarkVmg = Math.max(...fleetVmgs);
  if (benchmarkVmg - ownVmg <= PERFORMANCE_OPPORTUNITY_TIE_KTS) {
    return result(category, null, "Straight-line VMG is tied with the fleet benchmark.", input.legIndex);
  }
  const estimatedSeconds = input.distanceM * (
    1 / (ownVmg * PERFORMANCE_KNOT_TO_MPS) -
    1 / (benchmarkVmg * PERFORMANCE_KNOT_TO_MPS)
  );
  if (estimatedSeconds < PERFORMANCE_OPPORTUNITY_MIN_SECONDS) {
    return result(category, null, "Straight-line VMG estimate is below the materiality threshold.", input.legIndex);
  }
  return result(category, card({
    code: `leg-${input.legIndex + 1}-straight-vmg`,
    scope: { entryId: input.entryId, legIndex: input.legIndex },
    category,
    headline: `Leg ${input.legIndex + 1} straight-line VMG gap`,
    estimatedSeconds: rounded(estimatedSeconds),
    benchmark: { kind: "fleet_best", value: rounded(benchmarkVmg), unit: "kt VMG" },
    evidence: [
      { label: "Own straight VMG", value: rounded(ownVmg), unit: "kt" },
      { label: "Leg distance", value: rounded(input.distanceM, 1), unit: "m" },
    ],
    assumptions: ["The fleet-best straight VMG is treated as achievable for this same leg and direction."],
    caveats: [NON_ADDITIVE_CAVEAT, "This is a pace-equivalent estimate, not a causal attribution."],
  }), "", input.legIndex);
}

/** Compare maneuver-window progress with the same boat's straight-line baseline. */
export function detectManeuverOpportunity(input: {
  entryId: string;
  legIndex: number;
  legType: string;
  metric: PerformanceMetricsV1;
}): OpportunityDetectorResult {
  const category = "maneuver" as const;
  if (input.metric.partial || input.metric.warningCodes.includes("source-gap")) {
    return result(category, null, "A source gap or partial leg intersects maneuver evidence.", input.legIndex);
  }
  const directional = directionalMetric(input.metric, input.legType);
  if (!directional || !finite(directional.straightKts) || !finite(directional.maneuverKts) ||
      directional.straightKts < PERFORMANCE_OPPORTUNITY_MIN_VMG_KTS ||
      directional.maneuverDurationSec < 5) {
    return result(category, null, "At least five maneuver seconds and a valid own straight baseline are required.", input.legIndex);
  }
  const estimatedSeconds = directional.maneuverDurationSec * Math.max(
    0,
    1 - directional.maneuverKts / directional.straightKts,
  );
  if (estimatedSeconds < PERFORMANCE_OPPORTUNITY_MIN_SECONDS) {
    return result(category, null, "Maneuver-window progress matched the own straight baseline or was immaterial.", input.legIndex);
  }
  return result(category, card({
    code: `leg-${input.legIndex + 1}-maneuver-progress`,
    scope: { entryId: input.entryId, legIndex: input.legIndex },
    category,
    headline: `Leg ${input.legIndex + 1} maneuver-window progress gap`,
    estimatedSeconds: rounded(estimatedSeconds),
    benchmark: { kind: "own_baseline", value: rounded(directional.straightKts), unit: "kt VMG" },
    evidence: [
      { label: "Maneuver VMG", value: rounded(directional.maneuverKts), unit: "kt" },
      { label: "Maneuver exposure", value: rounded(directional.maneuverDurationSec, 1), unit: "s" },
    ],
    assumptions: ["The same boat's straight-line VMG is the counterfactual progress baseline."],
    caveats: [NON_ADDITIVE_CAVEAT, "Maneuver windows are disjoint from straight-VMG samples."],
  }), "", input.legIndex);
}

/** Convert geometric excess distance using the best same-leg average speed. */
export function detectDistanceOpportunity(input: {
  entryId: string;
  legIndex: number;
  own: PerformanceMetricsV1;
  fleet: readonly PerformanceMetricsV1[];
}): OpportunityDetectorResult {
  const category = "distance" as const;
  if (input.own.partial || input.own.warningCodes.includes("source-gap")) {
    return result(category, null, "A source gap or partial leg makes excess-distance comparison ineligible.", input.legIndex);
  }
  const benchmarkSpeeds = input.fleet.flatMap((metric) =>
    !metric.partial && !metric.warningCodes.includes("source-gap") &&
    finite(metric.avgSogKts) && metric.avgSogKts >= PERFORMANCE_OPPORTUNITY_MIN_VMG_KTS
      ? [metric.avgSogKts]
      : []);
  if (!finite(input.own.excessDistanceM) || input.own.excessDistanceM <= 0 || benchmarkSpeeds.length === 0) {
    return result(category, null, "Positive excess distance and a same-leg fleet speed benchmark are required.", input.legIndex);
  }
  const benchmarkSpeed = Math.max(...benchmarkSpeeds);
  const estimatedSeconds = input.own.excessDistanceM / (benchmarkSpeed * PERFORMANCE_KNOT_TO_MPS);
  if (estimatedSeconds < PERFORMANCE_OPPORTUNITY_MIN_SECONDS) {
    return result(category, null, "Excess-distance estimate is below the materiality threshold.", input.legIndex);
  }
  return result(category, card({
    code: `leg-${input.legIndex + 1}-excess-distance`,
    scope: { entryId: input.entryId, legIndex: input.legIndex },
    category,
    headline: `Leg ${input.legIndex + 1} excess-distance equivalent`,
    estimatedSeconds: rounded(estimatedSeconds),
    benchmark: { kind: "fleet_best", value: rounded(benchmarkSpeed), unit: "kt SOG" },
    evidence: [{ label: "Excess distance", value: rounded(input.own.excessDistanceM, 1), unit: "m" }],
    assumptions: ["Excess distance is converted at the best same-leg average SOG."],
    caveats: [NON_ADDITIVE_CAVEAT, "Geometry can overlap with pace effects; this is not a separate total."],
  }), "", input.legIndex);
}

/** Compare bounded speed windows around a mark; label recovery, never cause. */
export function detectMarkRecoveryOpportunity(
  evidence: MarkRecoveryEvidence,
): OpportunityDetectorResult {
  const category = "mark_recovery" as const;
  if (evidence.sourceGap) {
    return result(category, null, "A source gap intersects the bounded mark-recovery windows.", evidence.legIndex);
  }
  if (evidence.preSampleCount < PERFORMANCE_MARK_RECOVERY_MIN_SAMPLES ||
      evidence.postSampleCount < PERFORMANCE_MARK_RECOVERY_MIN_SAMPLES ||
      !finite(evidence.preAverageSogKts) || !finite(evidence.postAverageSogKts) ||
      evidence.preAverageSogKts < MIN_MAKING_WAY_SOG_KTS) {
    return result(category, null, "Pre- and post-mark windows need adequate making-way samples.", evidence.legIndex);
  }
  const estimatedSeconds = PERFORMANCE_MARK_RECOVERY_WINDOW_SECONDS * Math.max(
    0,
    1 - evidence.postAverageSogKts / evidence.preAverageSogKts,
  );
  if (estimatedSeconds < PERFORMANCE_OPPORTUNITY_MIN_SECONDS) {
    return result(category, null, "Post-mark speed matched the pre-mark window or was immaterial.", evidence.legIndex);
  }
  return result(category, card({
    code: `mark-${evidence.markIndex}-recovery`,
    scope: { entryId: evidence.entryId, legIndex: evidence.legIndex },
    category,
    headline: `Mark ${evidence.markIndex} recovery window`,
    estimatedSeconds: rounded(estimatedSeconds),
    benchmark: { kind: "own_baseline", value: rounded(evidence.preAverageSogKts), unit: "kt SOG" },
    evidence: [
      { label: "Pre-mark average", value: rounded(evidence.preAverageSogKts), unit: "kt" },
      { label: "Post-mark average", value: rounded(evidence.postAverageSogKts), unit: "kt" },
    ],
    assumptions: [`Both windows are ${PERFORMANCE_MARK_RECOVERY_WINDOW_SECONDS} seconds around the recorded passage.`],
    caveats: [NON_ADDITIVE_CAVEAT, "This labels a recovery pattern, not its cause."],
  }), "", evidence.legIndex);
}

function preferredRaceDistribution(
  distributions: readonly PerformanceDistributionV1[],
  entryId: string,
  direction: "upwind" | "downwind",
  tack: "port" | "starboard",
): PerformanceDistributionV1 | null {
  const matches = distributions.filter((row) =>
    row.entryId === entryId && row.scope === "race" && row.legIndex === null &&
    row.direction === direction && row.tack === tack && row.available);
  return matches.find((row) => row.selection === "straight") ?? matches[0] ?? null;
}

/** Report material port/starboard medians only when both exposures are valid. */
export function detectSymmetryObservation(
  entryId: string,
  distributions: readonly PerformanceDistributionV1[],
): OpportunityDetectorResult {
  const category = "symmetry" as const;
  const gapRows = distributions.filter((row) => row.entryId === entryId &&
    row.unavailableReason?.toLowerCase().includes("gap"));
  const candidates = (["upwind", "downwind"] as const).flatMap((direction) => {
    const port = preferredRaceDistribution(distributions, entryId, direction, "port");
    const starboard = preferredRaceDistribution(distributions, entryId, direction, "starboard");
    if (!port || !starboard || !finite(port.medianKts) || !finite(starboard.medianKts)) return [];
    return [{ direction, port, starboard, difference: Math.abs(port.medianKts - starboard.medianKts) }];
  });
  if (candidates.length === 0) {
    return result(category, null, gapRows.length > 0
      ? "A source gap prevents comparable port/starboard exposure."
      : "Both port and starboard distributions need adequate exposure.");
  }
  const strongest = [...candidates].sort((left, right) =>
    right.difference - left.difference || left.direction.localeCompare(right.direction))[0];
  if (strongest.difference < PERFORMANCE_OPPORTUNITY_ASYMMETRY_KTS) {
    return result(category, null, "Port/starboard median difference is below the observation threshold.");
  }
  const faster = strongest.port.medianKts! >= strongest.starboard.medianKts! ? "port" : "starboard";
  return result(category, card({
    code: `${strongest.direction}-tack-symmetry`,
    scope: { entryId },
    category,
    headline: `${strongest.direction} port/starboard VMG asymmetry`,
    estimatedSeconds: null,
    benchmark: { kind: "own_baseline", value: rounded(strongest.difference), unit: "kt median difference" },
    evidence: [
      { label: "Port median", value: rounded(strongest.port.medianKts!), unit: "kt" },
      { label: "Starboard median", value: rounded(strongest.starboard.medianKts!), unit: "kt" },
      { label: "Port exposure", value: rounded(strongest.port.totalEligibleSeconds, 1), unit: "s" },
      { label: "Starboard exposure", value: rounded(strongest.starboard.totalEligibleSeconds, 1), unit: "s" },
    ],
    assumptions: [`${faster} is the faster observed tack in the persisted distribution.`],
    caveats: ["No seconds estimate is emitted because equivalent tack exposure is not established."],
  }), "");
}

/** Surface wide own distributions without claiming that lower variance is faster. */
export function detectConsistencyObservation(
  entryId: string,
  distributions: readonly PerformanceDistributionV1[],
): OpportunityDetectorResult {
  const category = "consistency" as const;
  const gapRows = distributions.filter((row) => row.entryId === entryId &&
    row.unavailableReason?.toLowerCase().includes("gap"));
  const candidates = distributions.flatMap((row) =>
    row.entryId === entryId && row.scope === "race" && row.legIndex === null && row.available &&
    row.selection === "straight" && finite(row.q1Kts) && finite(row.medianKts) && finite(row.q3Kts)
      ? [{ row, iqr: row.q3Kts - row.q1Kts }]
      : []);
  if (candidates.length === 0) {
    return result(category, null, gapRows.length > 0
      ? "A source gap prevents a valid straight-line distribution."
      : "A valid straight-line distribution is required.");
  }
  const widest = [...candidates].sort((left, right) =>
    right.iqr - left.iqr || left.row.direction.localeCompare(right.row.direction) ||
    left.row.tack.localeCompare(right.row.tack))[0];
  if (widest.iqr < PERFORMANCE_OPPORTUNITY_CONSISTENCY_IQR_KTS) {
    return result(category, null, "Straight-line VMG IQR is below the observation threshold.");
  }
  return result(category, card({
    code: `${widest.row.direction}-${widest.row.tack}-consistency`,
    scope: { entryId },
    category,
    headline: `${widest.row.direction} ${widest.row.tack} VMG spread`,
    estimatedSeconds: null,
    benchmark: { kind: "own_baseline", value: rounded(widest.row.medianKts!), unit: "kt median VMG" },
    evidence: [
      { label: "Q1", value: rounded(widest.row.q1Kts!), unit: "kt" },
      { label: "Q3", value: rounded(widest.row.q3Kts!), unit: "kt" },
      { label: "IQR", value: rounded(widest.iqr), unit: "kt" },
    ],
    assumptions: ["IQR describes the middle half of persisted straight-line VMG samples."],
    caveats: ["Lower variance is not assumed to be faster; no seconds estimate is emitted."],
  }), "");
}

function validTimestampCount(track: ProcessedTrack): number {
  let count = 0;
  for (let index = 0; index < columnLength(track); index++) {
    if (finite(epochAt(track, index))) count++;
  }
  return count;
}

function canonicalTrackMap(tracks: readonly ProcessedTrack[]): Map<string, ProcessedTrack> {
  const selected = new Map<string, { track: ProcessedTrack; count: number }>();
  for (const track of tracks) {
    const count = validTimestampCount(track);
    const current = selected.get(track.entryId);
    if (!current || count > current.count ||
        (count === current.count && JSON.stringify(track) < JSON.stringify(current.track))) {
      selected.set(track.entryId, { track, count });
    }
  }
  return new Map([...selected].map(([entryId, selectedTrack]) => [entryId, selectedTrack.track]));
}

/** Build compact mark-window evidence from raw tracks before only facts are persisted. */
export function buildMarkRecoveryEvidence(input: {
  entryIds: readonly string[];
  tracks: readonly ProcessedTrack[];
  analysis: RaceAnalysis;
  performance: Pick<PerformanceAnalysisV1, "course">;
}): MarkRecoveryEvidence[] {
  const trackByEntryId = canonicalTrackMap(input.tracks);
  const analysisByEntryId = new Map(input.analysis.perEntry.map((entry) => [entry.entryId, entry]));
  const evidence: MarkRecoveryEvidence[] = [];
  const windowMs = PERFORMANCE_MARK_RECOVERY_WINDOW_SECONDS * 1_000;
  for (const entryId of [...input.entryIds].sort()) {
    const track = trackByEntryId.get(entryId);
    const entryAnalysis = analysisByEntryId.get(entryId);
    const passages = input.performance.course.passagesByEntry.find((row) => row.entryId === entryId)?.passages ?? [];
    for (const point of input.performance.course.points.filter((coursePoint) => coursePoint.kind === "mark")) {
      const passage = passages.find((row) => row.pointIndex === point.index);
      const legIndex = Math.min(point.index, Math.max(0, input.performance.course.legs.length - 1));
      if (!track || !entryAnalysis || !finite(passage?.timeMs)) {
        evidence.push({
          entryId,
          legIndex,
          markIndex: point.index,
          preAverageSogKts: null,
          postAverageSogKts: null,
          preSampleCount: 0,
          postSampleCount: 0,
          sourceGap: false,
        });
        continue;
      }
      const pre = resamplePerformanceInterval(
        track,
        input.analysis.wind,
        passage.timeMs! - windowMs,
        passage.timeMs!,
        entryAnalysis.maneuvers,
      );
      const post = resamplePerformanceInterval(
        track,
        input.analysis.wind,
        passage.timeMs!,
        passage.timeMs! + windowMs,
        entryAnalysis.maneuvers,
      );
      const preValues = pre.samples.flatMap((sample) =>
        finite(sample.sogKts) && sample.sogKts >= MIN_MAKING_WAY_SOG_KTS ? [sample.sogKts] : []);
      const postValues = post.samples.flatMap((sample) =>
        finite(sample.sogKts) && sample.sogKts >= MIN_MAKING_WAY_SOG_KTS ? [sample.sogKts] : []);
      evidence.push({
        entryId,
        legIndex,
        markIndex: point.index,
        preAverageSogKts: preValues.length > 0 ? mean(preValues) : null,
        postAverageSogKts: postValues.length > 0 ? mean(postValues) : null,
        preSampleCount: preValues.length,
        postSampleCount: postValues.length,
        sourceGap: pre.sourceGapCount > 0 || post.sourceGapCount > 0,
      });
    }
  }
  return evidence;
}

function rankPrimary(
  candidates: PerformanceOpportunityV1[],
  suppressed: PerformanceOpportunitySuppressionV1[],
): PerformanceOpportunityV1[] {
  const ranked = [...candidates].sort((left, right) =>
    right.estimatedSeconds! - left.estimatedSeconds! ||
    right.evidence.length - left.evidence.length ||
    left.category.localeCompare(right.category) || left.code.localeCompare(right.code));
  for (const omitted of ranked.slice(PERFORMANCE_OPPORTUNITY_MAX_PRIMARY)) {
    suppressed.push(suppression(
      omitted.category,
      "Eligible candidate was omitted by the bounded top-three ranking.",
      omitted.scope.legIndex,
    ));
  }
  return ranked.slice(0, PERFORMANCE_OPPORTUNITY_MAX_PRIMARY)
    .map((opportunity, index) => ({ ...opportunity, priority: index + 1 }));
}

/** Assemble the bounded deterministic set; it deliberately emits no total time lost. */
export function analyzePerformanceOpportunities(input: {
  entryIds: readonly string[];
  performance: Omit<PerformanceAnalysisV1, "opportunities">;
  markRecoveryEvidence?: readonly MarkRecoveryEvidence[];
}): PerformanceOpportunitiesV1 {
  const entries: PerformanceEntryOpportunitiesV1[] = [...input.entryIds].sort().map((entryId) => {
    const primaryCandidates: PerformanceOpportunityV1[] = [];
    const observations: PerformanceOpportunityV1[] = [];
    const suppressed: PerformanceOpportunitySuppressionV1[] = [];
    const collect = (detected: OpportunityDetectorResult, target = primaryCandidates) => {
      if (detected.opportunity) target.push(detected.opportunity);
      if (detected.suppression) suppressed.push(detected.suppression);
    };
    const ownStart = input.performance.start.entries.find((entry) => entry.entryId === entryId);
    if (ownStart) collect(detectStartOpportunity(ownStart, input.performance.start.entries));
    else suppressed.push(suppression("start", "Entry start evidence is unavailable."));
    for (const leg of input.performance.legs) {
      const own = leg.metrics.find((metric) => metric.entryId === entryId);
      if (!own) {
        suppressed.push(suppression("straight_vmg", "Entry leg metrics are unavailable.", leg.index));
        suppressed.push(suppression("maneuver", "Entry leg metrics are unavailable.", leg.index));
        suppressed.push(suppression("distance", "Entry leg metrics are unavailable.", leg.index));
        continue;
      }
      collect(detectStraightVmgOpportunity({
        entryId,
        legIndex: leg.index,
        legType: leg.type,
        distanceM: input.performance.course.legs[leg.index]?.distanceM ?? null,
        own,
        fleet: leg.metrics,
      }));
      collect(detectManeuverOpportunity({ entryId, legIndex: leg.index, legType: leg.type, metric: own }));
      collect(detectDistanceOpportunity({ entryId, legIndex: leg.index, own, fleet: leg.metrics }));
    }
    const markEvidence = input.markRecoveryEvidence?.filter((row) => row.entryId === entryId) ?? [];
    if (markEvidence.length === 0) {
      suppressed.push(suppression("mark_recovery", "No bounded mark-recovery evidence is available."));
    } else {
      markEvidence.forEach((evidence) => collect(detectMarkRecoveryOpportunity(evidence)));
    }
    collect(detectSymmetryObservation(entryId, input.performance.distributions), observations);
    collect(detectConsistencyObservation(entryId, input.performance.distributions), observations);
    const rankedObservations = observations
      .sort((left, right) => left.category.localeCompare(right.category) || left.code.localeCompare(right.code))
      .slice(0, PERFORMANCE_OPPORTUNITY_MAX_OBSERVATIONS)
      .map((opportunity, index) => ({ ...opportunity, priority: index + 1 }));
    return {
      entryId,
      primary: rankPrimary(primaryCandidates, suppressed),
      observations: rankedObservations,
      suppressed: suppressed.slice(0, PERFORMANCE_OPPORTUNITY_MAX_SUPPRESSED),
    };
  });
  return {
    v: 1,
    contract: "performance-opportunities-v1",
    entries,
    constants: {
      maxPrimaryPerEntry: PERFORMANCE_OPPORTUNITY_MAX_PRIMARY,
      maxObservationsPerEntry: PERFORMANCE_OPPORTUNITY_MAX_OBSERVATIONS,
      minimumMaterialSeconds: PERFORMANCE_OPPORTUNITY_MIN_SECONDS,
      markRecoveryWindowSeconds: PERFORMANCE_MARK_RECOVERY_WINDOW_SECONDS,
    },
  };
}
