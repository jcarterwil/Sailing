/**
 * Shared help copy for inline HelpTip tooltips and the /help/metrics glossary.
 * Keep summaries short; put nuance in `body`. Wording here is the single source of truth.
 */

export const HELP_PROVENANCE = [
  "measured",
  "derived",
  "user-entered",
  "system",
] as const;

export type HelpProvenance = (typeof HELP_PROVENANCE)[number];

export const HELP_TERM_KEYS = [
  "sog",
  "cog",
  "hdg",
  "twd",
  "tws",
  "vmg",
  "courseEfficiency",
  "straight",
  "maneuver",
  "analyzedWind",
  "analyzedWeather",
  "confidence",
  "provenance",
  "coverage",
  "replaceTrack",
  "vkxCsv",
  "publicShare",
  "viewer",
  "editor",
  "review",
  "reanalyze",
  "sessionType",
  "timezone",
] as const;

export type HelpTermKey = (typeof HELP_TERM_KEYS)[number];

export type HelpTerm = {
  key: HelpTermKey;
  title: string;
  /** One or two sentences for tooltip / popover summary. */
  summary: string;
  /** Longer glossary explanation (examples and nuance). */
  body: string;
  /** Units shown to users, when applicable. */
  units?: string;
  /** Reference frame (e.g. true north, analyzed wind). */
  frame?: string;
  provenance?: HelpProvenance;
};

export const HELP_REGISTRY: Record<HelpTermKey, HelpTerm> = {
  sog: {
    key: "sog",
    title: "SOG",
    summary:
      "Speed over ground from the GPS track, in knots. It is measured boat speed across the earth, not through the water.",
    body: "SOG comes from valid processed track samples. Missing or rejected samples stay blank (an em dash), never numeric zero. Use SOG to compare raw pace; use VMG when you care about progress relative to the wind.",
    units: "knots (kt)",
    frame: "ground track",
    provenance: "measured",
  },
  cog: {
    key: "cog",
    title: "COG",
    summary:
      "Course over ground — the direction the boat is moving across the earth, in degrees true.",
    body: "COG is derived from successive GPS positions. At very low speed it is unreliable and may be suppressed. It is not the same as compass heading (HDG).",
    units: "degrees true (°)",
    frame: "true north",
    provenance: "derived",
  },
  hdg: {
    key: "hdg",
    title: "HDG",
    summary:
      "Heading — the direction the bow points, in degrees true, when the instrument reports it.",
    body: "HDG comes from the device attitude or compass channel in a VKX log when available. CSV imports often lack heading. HDG can differ from COG when the boat slides or crabs.",
    units: "degrees true (°)",
    frame: "true north",
    provenance: "measured",
  },
  twd: {
    key: "twd",
    title: "TWD",
    summary:
      "True wind direction — the compass direction the wind is coming from, in degrees true.",
    body: "Analyzed TWD is the canonical wind direction used for VMG and ladder geometry. Organizers can override it on Review with a manual value. Always read TWD as the from direction (meteorological convention).",
    units: "degrees true (°)",
    frame: "true north; wind-from",
    provenance: "derived",
  },
  tws: {
    key: "tws",
    title: "TWS",
    summary:
      "True wind speed in knots. Analyzed TWS may be a single value or a bounded range.",
    body: "TWS is part of the analyzed wind used for performance metrics. Manual Review overrides can set a single speed or min/max band. Weather-context wind from Open-Meteo is reported separately and must not be confused with analyzed TWS.",
    units: "knots (kt)",
    frame: "true wind",
    provenance: "derived",
  },
  vmg: {
    key: "vmg",
    title: "VMG",
    summary:
      "Velocity made good — speed toward or away from the wind, in knots, using analyzed wind.",
    body: "VMG is derived as SOG × cos(TWA), where TWA uses the canonical analyzed wind direction. Positive VMG means progress toward the wind (upwind). It describes association with wind geometry, not a causal claim about tactics. Practice sessions without race-relative context do not invent zero VMG race metrics.",
    units: "knots (kt)",
    frame: "relative to analyzed true wind",
    provenance: "derived",
  },
  courseEfficiency: {
    key: "courseEfficiency",
    title: "Course efficiency",
    summary:
      "How directly the boat covered the course: course distance divided by sailed distance, as a percent.",
    body: "Efficiency near 100% means little extra distance versus the geometric course. Lower values mean more sailing distance (tacks, curves, or detours). Missing course geometry leaves the value blank rather than zero.",
    units: "percent (%)",
    frame: "course distance ÷ sailed distance",
    provenance: "derived",
  },
  straight: {
    key: "straight",
    title: "Straight",
    summary:
      "Samples taken outside bounded maneuver windows — steady sailing between tacks and gybes.",
    body: "Straight VMG averages use track segments that are not inside a detected maneuver. Compare straight and maneuver columns to see pace while settled versus while turning. Definitions follow the shared maneuver classifier, not hand labels.",
    units: "knots (kt) when applied to VMG",
    frame: "non-maneuver samples vs analyzed wind",
    provenance: "derived",
  },
  maneuver: {
    key: "maneuver",
    title: "Maneuver",
    summary:
      "A detected tack or gybe window, including the turn and nearby settle time.",
    body: "Maneuver VMG averages only samples inside those windows. Counts of tacks, gybes, and botched maneuvers come from the same classifier. Treat associations carefully — a maneuver metric alone does not establish that a timing mistake decided place.",
    units: "count, or knots (kt) for maneuver VMG",
    frame: "bounded maneuver windows",
    provenance: "derived",
  },
  analyzedWind: {
    key: "analyzedWind",
    title: "Analyzed wind",
    summary:
      "The canonical TWD/TWS used for VMG, ladder, and performance math for this Session.",
    body: "Analyzed wind is derived from fleet tracks and optional instrument wind, unless an organizer sets a manual override on Review. It is the performance input of record. Open-Meteo weather context is separate and must not replace analyzed wind in metric formulas.",
    units: "degrees true and knots",
    frame: "Session analysis",
    provenance: "derived",
  },
  analyzedWeather: {
    key: "analyzedWeather",
    title: "Analyzed weather",
    summary:
      "Saved Open-Meteo weather context for the Session — background conditions, not the VMG wind input.",
    body: "Weather evidence (wind bands, conditions, hourly series) is reported beside performance so you can recall the day. It does not drive VMG. When evidence is missing, the UI says so instead of inventing zeros.",
    units: "knots and degrees when present",
    frame: "Open-Meteo context at Session time",
    provenance: "system",
  },
  confidence: {
    key: "confidence",
    title: "Confidence",
    summary:
      "How strongly the system trusts a derived wind or quality label for this Session.",
    body: "Confidence is a qualitative label on analyzed wind or related quality fields. Low confidence means treat downstream VMG and ladder numbers cautiously. It is not a win probability and does not imply causation.",
    provenance: "derived",
  },
  provenance: {
    key: "provenance",
    title: "Provenance",
    summary:
      "Where a value came from — measured on the boat, derived in analysis, entered by a user, or fetched by the system.",
    body: "Provenance labels keep measured GPS, derived metrics, organizer overrides, and external weather from being mixed up. When you see a source chip (for example sensor vs estimate vs manual), that is provenance for the value beside it.",
    provenance: "system",
  },
  coverage: {
    key: "coverage",
    title: "Coverage",
    summary:
      "How completely a boat’s track supports a metric — partial coverage means some samples were missing or rejected.",
    body: "Partial coverage and warning codes appear under boat names in fleet tables. Gaps, teleports, or failed processing reduce coverage. Missing metrics stay blank; Practice race-relative metrics that do not apply are omitted, not shown as zero.",
    provenance: "system",
  },
  replaceTrack: {
    key: "replaceTrack",
    title: "Replace track",
    summary:
      "Upload a new VKX or CSV file for a boat that already has a track, replacing the previous file.",
    body: "Replace keeps the same entry and boat identity while swapping the underlying track. Processing runs again; prior analysis may become stale until Reanalyze. Required file-type and size limits still apply and stay visible in the upload UI.",
    provenance: "user-entered",
  },
  vkxCsv: {
    key: "vkxCsv",
    title: "VKX and CSV",
    summary:
      "Accepted track formats: Vakaros .vkx logs and supported GPS .csv exports.",
    body: "VKX carries high-rate GPS plus optional attitude, timer, and wind rows. Supported CSV must include timestamps and positions the parser understands. File-type, count, and size limits stay visible on the upload and import screens — help text does not replace those rules.",
    provenance: "user-entered",
  },
  publicShare: {
    key: "publicShare",
    title: "Public share",
    summary:
      "A link that lets anyone open the Session replay and coach report without signing in.",
    body: "Turning the public share off invalidates the URL immediately. Share links are for viewing published Session surfaces, not for editing boats or crew. Keep the link private if the Session should stay within the club.",
    provenance: "user-entered",
  },
  viewer: {
    key: "viewer",
    title: "Viewer",
    summary: "Boat crew role with read-only access to the boat and its Sessions.",
    body: "Viewers can open shared boat context they are invited to, but cannot upload tracks or change boat data. Use Editor when someone needs to contribute files or edits.",
    provenance: "user-entered",
  },
  editor: {
    key: "editor",
    title: "Editor",
    summary:
      "Boat crew role that can upload tracks and edit boat data for Sessions on that boat.",
    body: "Editors help maintain the boat’s library without taking ownership. Ownership and organizer powers on a Race remain separate from boat crew roles.",
    provenance: "user-entered",
  },
  review: {
    key: "review",
    title: "Review",
    summary:
      "Organizer tools to inspect wind, course, and results before locking analysis for a Race.",
    body: "Review lets you preview corrections (manual wind, exclusions, course, results) and then apply them. It is available for Race Sessions with processed tracks. Practice workflows skip Race-relative review surfaces that do not apply.",
    provenance: "user-entered",
  },
  reanalyze: {
    key: "reanalyze",
    title: "Reanalyze",
    summary:
      "Re-run Session analysis from current processed tracks and corrections.",
    body: "Use Reanalyze after replacing a track, changing corrections, or when analysis is marked stale. It requires processed tracks for the entries in scope. It refreshes derived metrics; it does not by itself change uploaded files.",
    provenance: "system",
  },
  sessionType: {
    key: "sessionType",
    title: "Session type",
    summary:
      "Race is a multi-boat Session with join codes and fleet tools; Practice is a private single-boat Session.",
    body: "Choose Race when you need fleet tracks, sharing, and race-relative review. Choose Practice for solo training on one boat. Metrics that only make sense in a Race are omitted on Practice instead of shown as zero.",
    provenance: "user-entered",
  },
  timezone: {
    key: "timezone",
    title: "Timezone",
    summary:
      "IANA timezone for the Session’s local date and time (for example America/Detroit).",
    body: "Local wall time plus timezone define when the Session happened. Ambiguous daylight-saving times are rejected. The browser suggests a zone; change it if the Session was sailed elsewhere.",
    frame: "IANA tz database",
    provenance: "user-entered",
  },
};

export function getHelpTerm(key: HelpTermKey): HelpTerm {
  return HELP_REGISTRY[key];
}

export function listHelpTerms(): HelpTerm[] {
  return HELP_TERM_KEYS.map((key) => HELP_REGISTRY[key]);
}

export function helpTermAnchorId(key: HelpTermKey): string {
  return `help-${key}`;
}

export function helpGlossaryHref(key?: HelpTermKey): string {
  return key ? `/help/metrics#${helpTermAnchorId(key)}` : "/help/metrics";
}
