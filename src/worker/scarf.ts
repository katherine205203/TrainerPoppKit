import { z } from "zod";
import {
  isValidScarfAnswer,
  publicScarfQuestions,
  SCARF_DOMAIN_CODES,
  SCARF_DOMAIN_NAMES,
  SCARF_INSTRUMENT_KEY,
  SCARF_INSTRUMENT_VERSION,
  SCARF_QUESTION_COUNT,
  SCARF_SCORING_VERSION,
  descendingMidranks,
  meanScarfProfiles,
  scoreScarfAnswers,
  validateScarfAnswers,
  type ScarfAnswers,
  type ScarfDomainCode,
  type ScarfDomainScores,
} from "../domain/scarf-assessment";
import { randomToken, sha256 } from "./security";

export interface ScarfEnv { DB?: D1Database }
export interface ScarfParticipant { id: string; activity_id: string; team_id: string | null }

const DIMENSION_LABELS = SCARF_DOMAIN_CODES.map((code) => ({ code, name: SCARF_DOMAIN_NAMES[code] }));
const ReleaseBody = z.object({}).strict();
const ResetBody = z.object({ reason: z.string().trim().max(240).optional().default("") });
const SessionPresenterStateBody = z.object({
  revealed: z.boolean(),
  teamName: z.string().trim().max(80).nullable(),
  layer: z.enum(["reaction", "priority"]),
});
const ProgressBody = z.object({ generation: z.number().int().min(1), currentQuestion: z.number().int().min(1).max(30), viewState: z.enum(["welcome", "question", "transition", "completed"]) });
const AnswerBody = z.object({
  generation: z.number().int().min(1),
  revision: z.number().int().min(1).max(10000),
  answer: z.unknown(),
  currentQuestion: z.number().int().min(1).max(30),
});
const SubmitBody = z.object({ generation: z.number().int().min(1), idempotencyKey: z.string().uuid() });

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Referrer-Policy", "same-origin");
  result.set("X-Frame-Options", "DENY");
  return new Response(JSON.stringify(data), { status, headers: result });
}

function fail(message: string, status: number, code?: string): Response {
  return json(code ? { error: message, code } : { error: message }, status);
}

async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 16_384) return null;
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function database(env: ScarfEnv): D1Database | null { return env.DB ?? null; }
function newId(): string { return crypto.randomUUID(); }

type ScarfActivityRow = {
  id: string; session_id: string | null; title: string; state: string; tool_id: string;
  require_name: number; allow_teams: number; join_pin: string | null; session_name: string | null;
  instrument_key: string; instrument_version: string; scoring_version: string; locale: string;
  content_hash: string; release_mode: "immediate" | "trainer_released"; results_released_at: string | null;
  release_locked_at: string | null; team_mode: string; revealed: number; comparison_basis: string;
  selected_team_id: string | null; show_names: number; prompt_index: number; scarf_layer: "reaction" | "priority";
};

async function activityWithConfig(db: D1Database, activityId: string): Promise<ScarfActivityRow | null> {
  return db.prepare(`
    SELECT a.id, a.session_id, a.title, a.state, a.tool_id, a.require_name, a.allow_teams, a.join_pin,
      s.name AS session_name, cfg.instrument_key, cfg.instrument_version, cfg.scoring_version, cfg.locale,
      cfg.content_hash, cfg.release_mode, cfg.results_released_at, cfg.release_locked_at, cfg.team_mode,
      ps.revealed, ps.comparison_basis, ps.selected_team_id, ps.show_names, ps.prompt_index, ps.scarf_layer
    FROM activities a
    JOIN scarf_activity_configs cfg ON cfg.activity_id = a.id
    LEFT JOIN sessions s ON s.id = a.session_id
    LEFT JOIN presentation_state ps ON ps.activity_id = a.id
    WHERE a.id = ? AND a.tool_id = 'scarf-assessment'
  `).bind(activityId).first<ScarfActivityRow>();
}

async function audit(db: D1Database, activityId: string, actorType: "owner" | "participant" | "system", actorId: string | null, action: string, targetId: string | null, reason = "", metadata: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO scarf_audit_events (id, activity_id, actor_type, actor_id, action, target_id, reason, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId(), activityId, actorType, actorId, action, targetId, reason, JSON.stringify(metadata)).run();
}

export async function createScarfParticipation(db: D1Database, activityId: string, participantId: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO scarf_participations (participant_id, activity_id)
      VALUES (?, ?) ON CONFLICT(participant_id) DO NOTHING`).bind(participantId, activityId),
    db.prepare(`UPDATE scarf_activity_configs SET release_locked_at = COALESCE(release_locked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ?`).bind(activityId),
  ]);
}

export async function scarfOwnerActivity(db: D1Database, activityId: string) {
  const activity = await activityWithConfig(db, activityId);
  if (!activity) return null;
  const teams = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at").bind(activityId).all<{ id: string; name: string }>();
  const counts = await db.prepare(`
    SELECT COUNT(*) AS joined,
      SUM(CASE WHEN sp.status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN sp.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN sp.status = 'in_progress' AND EXISTS(
        SELECT 1 FROM scarf_answers sa WHERE sa.participant_id = sp.participant_id AND sa.generation = sp.generation
      ) THEN 1 ELSE 0 END) AS saved_drafts
    FROM participants p JOIN scarf_participations sp ON sp.participant_id = p.id WHERE p.activity_id = ?
  `).bind(activityId).first<{ joined: number; submitted: number | null; in_progress: number | null; saved_drafts: number | null }>();
  const participants = await db.prepare(`
    SELECT p.id, p.display_name, p.role, p.team_id, t.name AS team_name, p.consent_named_results,
      sp.status AS submission_status, sp.submitted_at, sp.generation, sp.current_question, sp.view_state,
      (SELECT COUNT(*) FROM scarf_answers sa WHERE sa.participant_id = sp.participant_id AND sa.generation = sp.generation) AS answered_count,
      r.reaction_json, r.priority_json
    FROM participants p JOIN scarf_participations sp ON sp.participant_id = p.id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN scarf_results r ON r.participant_id = sp.participant_id AND r.generation = sp.generation
    WHERE p.activity_id = ? ORDER BY p.joined_at
  `).bind(activityId).all();
  return {
    activity: {
      id: activity.id, session_id: activity.session_id, session_name: activity.session_name, title: activity.title,
      tool_id: activity.tool_id, state: activity.state, join_pin: activity.join_pin,
      require_name: activity.require_name, allow_teams: activity.allow_teams,
      instrument_version: activity.instrument_version, scoring_version: activity.scoring_version,
    },
    config: {
      instrumentKey: activity.instrument_key, instrumentVersion: activity.instrument_version,
      scoringVersion: activity.scoring_version, locale: activity.locale, releaseMode: activity.release_mode,
      resultsReleasedAt: activity.results_released_at, releaseLockedAt: activity.release_locked_at,
      teamMode: activity.team_mode, experimental: true,
    },
    teams: teams.results,
    counts: { joined: Number(counts?.joined ?? 0), submitted: Number(counts?.submitted ?? 0), inProgress: Number(counts?.in_progress ?? 0), savedDrafts: Number(counts?.saved_drafts ?? 0) },
    participants: participants.results,
    presentation: {
      revealed: activity.revealed, comparison_basis: activity.comparison_basis,
      selected_team_id: activity.selected_team_id, show_names: activity.show_names,
      scarf_layer: activity.scarf_layer,
    },
  };
}

type AnalyticsRow = {
  activity_id: string; activity_title: string; activity_updated_at: string; activity_created_at: string; session_id: string | null;
  session_identity_id: string | null; participant_id: string; display_name: string; team_id: string | null;
  team_name: string | null; consent_named_results: number; status: "in_progress" | "submitted";
  generation: number; current_question: number; answered_count: number; submitted_at: string | null;
  instrument_version: string; scoring_version: string; reaction_json: string | null; priority_json: string | null;
  tradeoff_json: string | null; ranking_json: string | null;
  integrated_needs_index_json: string | null; integrated_needs_rank_json: string | null; scoring_metadata_json: string | null;
};

type DecodedScarfScores = {
  reaction: ScarfDomainScores; priority: ScarfDomainScores;
  tradeoff: ScarfDomainScores | null; ranking: ScarfDomainScores | null;
  integratedNeedsIndex: ScarfDomainScores | null; integratedNeedsRank: ScarfDomainScores | null;
};

function decodeScores(row: AnalyticsRow): DecodedScarfScores | null {
  if (!row.reaction_json || !row.priority_json) return null;
  try {
    return {
      reaction: JSON.parse(row.reaction_json) as ScarfDomainScores,
      priority: JSON.parse(row.priority_json) as ScarfDomainScores,
      tradeoff: row.tradeoff_json ? JSON.parse(row.tradeoff_json) as ScarfDomainScores : null,
      ranking: row.ranking_json ? JSON.parse(row.ranking_json) as ScarfDomainScores : null,
      integratedNeedsIndex: row.integrated_needs_index_json ? JSON.parse(row.integrated_needs_index_json) as ScarfDomainScores : null,
      integratedNeedsRank: row.integrated_needs_rank_json ? JSON.parse(row.integrated_needs_rank_json) as ScarfDomainScores : null,
    };
  }
  catch { return null; }
}

function latestPerIdentity(rows: AnalyticsRow[], bySubmissionTime: boolean): AnalyticsRow[] {
  const latest = new Map<string, AnalyticsRow>();
  for (const row of rows) {
    const key = row.session_identity_id ?? row.participant_id;
    const current = latest.get(key);
    const leftDate = bySubmissionTime ? row.submitted_at ?? "" : row.activity_updated_at;
    const rightDate = current ? (bySubmissionTime ? current.submitted_at ?? "" : current.activity_updated_at) : "";
    const leftOrder = `${leftDate}|${row.activity_created_at}|${row.activity_id}`;
    const rightOrder = current ? `${rightDate}|${current.activity_created_at}|${current.activity_id}` : "";
    if (!current || leftOrder.localeCompare(rightOrder) > 0) latest.set(key, row);
  }
  return [...latest.values()];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function metricSummary(rows: Array<{ scores: ScarfDomainScores }>) {
  return Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => {
    const values = rows.map((row) => row.scores[code]).filter(Number.isFinite);
    return [code, {
      name: SCARF_DOMAIN_NAMES[code], n: values.length,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      median: median(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
      distribution: values,
    }];
  })) as Record<ScarfDomainCode, { name: string; n: number; mean: number | null; median: number | null; min: number | null; max: number | null; distribution: number[] }>;
}

function toAnalyticsParticipant(row: AnalyticsRow) {
  const result = decodeScores(row);
  return {
    id: row.participant_id, displayName: row.display_name, teamId: row.team_id, teamName: row.team_name,
    status: row.status, generation: row.generation, currentQuestion: row.current_question, answeredCount: Number(row.answered_count ?? 0),
    submittedAt: row.submitted_at, instrumentVersion: row.instrument_version, scoringVersion: row.scoring_version,
    reaction: result?.reaction ?? null, priority: result?.priority ?? null,
    tradeoff: result?.tradeoff ?? null, ranking: result?.ranking ?? null,
    integratedNeedsIndex: result?.integratedNeedsIndex ?? null, integratedNeedsRank: result?.integratedNeedsRank ?? null,
  };
}

async function loadAnalyticsRows(db: D1Database, scope: "activity" | "session", scopeId: string, onlyReleased = false): Promise<AnalyticsRow[]> {
  const scopeColumn = scope === "activity" ? "a.id" : "a.session_id";
  const releasedFilter = onlyReleased ? "AND (cfg.release_mode = 'immediate' OR cfg.results_released_at IS NOT NULL)" : "";
  const { results } = await db.prepare(`
    SELECT a.id AS activity_id, a.title AS activity_title, COALESCE(r.submitted_at, sp.updated_at) AS activity_updated_at, a.created_at AS activity_created_at, a.session_id,
      p.session_identity_id, p.id AS participant_id, p.display_name, p.team_id, t.name AS team_name, p.consent_named_results,
      sp.status, sp.generation, sp.current_question,
      (SELECT COUNT(*) FROM scarf_answers sa WHERE sa.participant_id = sp.participant_id AND sa.generation = sp.generation) AS answered_count,
      r.submitted_at, cfg.instrument_version, cfg.scoring_version, r.reaction_json, r.priority_json,
      r.tradeoff_json, r.ranking_json, r.integrated_needs_index_json, r.integrated_needs_rank_json, r.scoring_metadata_json
    FROM activities a JOIN scarf_activity_configs cfg ON cfg.activity_id = a.id
    JOIN scarf_participations sp ON sp.activity_id = a.id
    JOIN participants p ON p.id = sp.participant_id AND p.activity_id = a.id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN scarf_results r ON r.participant_id = sp.participant_id AND r.generation = sp.generation
    WHERE ${scopeColumn} = ? AND a.tool_id = 'scarf-assessment' ${releasedFilter}
    ORDER BY COALESCE(r.submitted_at, sp.updated_at) DESC
  `).bind(scopeId).all<AnalyticsRow>();
  return results;
}

export async function getScarfAnalytics(db: D1Database, scope: "activity" | "session", scopeId: string, teamName?: string | null, instrumentVersion?: string | null, scoringVersion?: string | null, onlyReleased = false) {
  const allRows = await loadAnalyticsRows(db, scope, scopeId, onlyReleased);
  const versions = [...new Map(allRows.map((row) => [`${row.instrument_version}|${row.scoring_version}`, { instrumentVersion: row.instrument_version, scoringVersion: row.scoring_version }])).values()];
  const chosen = versions.find((item) => item.instrumentVersion === instrumentVersion && item.scoringVersion === scoringVersion)
    ?? versions.find((item) => item.instrumentVersion === SCARF_INSTRUMENT_VERSION && item.scoringVersion === SCARF_SCORING_VERSION)
    ?? versions[0] ?? { instrumentVersion: SCARF_INSTRUMENT_VERSION, scoringVersion: SCARF_SCORING_VERSION };
  const versionRows = allRows.filter((row) => row.instrument_version === chosen.instrumentVersion && row.scoring_version === chosen.scoringVersion);
  const participantRows = scope === "session" ? latestPerIdentity(versionRows, false) : versionRows;
  const submittedRows = participantRows.filter((row) => row.status === "submitted" && decodeScores(row));
  const dedupedSubmitted = scope === "session" ? latestPerIdentity(submittedRows, true) : submittedRows;
  const selectedRows = teamName ? dedupedSubmitted.filter((row) => (row.team_name ?? "Unassigned") === teamName) : dedupedSubmitted;
  const cohortRows = dedupedSubmitted.map((row) => ({ row, scores: decodeScores(row)! }));
  const resultRows = selectedRows.map((row) => ({ row, scores: decodeScores(row)! }));
  const needsCohort = cohortRows.filter((item): item is typeof item & { scores: DecodedScarfScores & { integratedNeedsIndex: ScarfDomainScores; integratedNeedsRank: ScarfDomainScores } } =>
    Boolean(item.scores.integratedNeedsIndex && item.scores.integratedNeedsRank));
  const selectedNeeds = resultRows.filter((item) => Boolean(item.scores.integratedNeedsIndex && item.scores.integratedNeedsRank));
  const classMean = meanScarfProfiles(needsCohort.map((item) => item.scores.integratedNeedsIndex));
  const classRanks = classMean ? descendingMidranks(classMean) : null;
  const safeParticipants = participantRows.map(toAnalyticsParticipant);
  const teamGroups = new Map<string, typeof cohortRows>();
  for (const entry of cohortRows) {
    const name = entry.row.team_name ?? "Unassigned";
    const group = teamGroups.get(name) ?? [];
    group.push(entry);
    teamGroups.set(name, group);
  }
  const teamSummaries = [...teamGroups.entries()].map(([name, group]) => {
    const profiles = group.flatMap((item) => item.scores.integratedNeedsIndex ? [item.scores.integratedNeedsIndex] : []);
    const needsIndex = meanScarfProfiles(profiles);
    const needsRank = needsIndex ? descendingMidranks(needsIndex) : null;
    const classDelta = needsIndex && classMean ? Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, needsIndex[code] - classMean[code]])) as ScarfDomainScores : null;
    return {
      name, count: group.length, needsCount: profiles.length,
      reaction: metricSummary(group.map((item) => ({ scores: item.scores.reaction }))),
      priority: metricSummary(group.map((item) => ({ scores: item.scores.priority }))),
      needs: metricSummary(profiles.map((scores) => ({ scores }))), needsIndex, needsRank, classDelta,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const activityCounts = new Map<string, number>();
  for (const row of dedupedSubmitted) activityCounts.set(row.activity_id, (activityCounts.get(row.activity_id) ?? 0) + 1);
  return {
    scope, scopeId,
    instrument: { key: SCARF_INSTRUMENT_KEY, version: chosen.instrumentVersion, scoringVersion: chosen.scoringVersion, locale: "en", status: "experimental_not_validated" },
    availableVersions: versions,
    excludedIncompatibleActivityCount: scope === "session" ? new Set(allRows.map((row) => row.activity_id)).size - new Set(versionRows.map((row) => row.activity_id)).size : 0,
    counts: {
      joined: participantRows.length,
      inProgress: participantRows.filter((row) => row.status === "in_progress").length,
      completed: dedupedSubmitted.length,
      completionRate: participantRows.length ? dedupedSubmitted.length / participantRows.length : 0,
      contributing: selectedRows.length,
    },
      means: {
        reaction: metricSummary(resultRows.map((item) => ({ scores: item.scores.reaction }))),
        priority: metricSummary(resultRows.map((item) => ({ scores: item.scores.priority }))),
        tradeoff: metricSummary(resultRows.flatMap((item) => item.scores.tradeoff ? [{ scores: item.scores.tradeoff }] : [])),
        ranking: metricSummary(resultRows.flatMap((item) => item.scores.ranking ? [{ scores: item.scores.ranking }] : [])),
        needs: metricSummary(selectedNeeds.flatMap((item) => item.scores.integratedNeedsIndex ? [{ scores: item.scores.integratedNeedsIndex }] : [])),
      },
    teams: teamSummaries,
    activities: [...activityCounts.entries()].map(([id, submittedCount]) => ({ id, submittedCount })),
    participants: safeParticipants,
    submitted: resultRows.map(({ row, scores }) => ({ ...toAnalyticsParticipant(row), reaction: scores.reaction, priority: scores.priority,
      tradeoff: scores.tradeoff, ranking: scores.ranking, integratedNeedsIndex: scores.integratedNeedsIndex, integratedNeedsRank: scores.integratedNeedsRank,
      classDelta: scores.integratedNeedsIndex && classMean ? Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, scores.integratedNeedsIndex![code] - classMean[code]])) as ScarfDomainScores : null })),
    heatmap: {
      available: chosen.scoringVersion === SCARF_SCORING_VERSION && needsCohort.length > 0,
      classCount: needsCohort.length,
      classMean,
      classRank: classRanks,
      comparisonAvailable: needsCohort.length >= 5,
      participants: selectedNeeds.map(({ row, scores }) => ({ id: row.participant_id, displayName: row.display_name, teamName: row.team_name ?? "Unassigned",
        needsIndex: scores.integratedNeedsIndex, needsRank: scores.integratedNeedsRank,
        classDelta: classMean ? Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, scores.integratedNeedsIndex![code] - classMean[code]])) as ScarfDomainScores : null })),
      teams: teamSummaries.filter((team) => team.needsIndex && team.needsRank).map((team) => ({
        name: team.name, count: team.needsCount, needsIndex: team.needsIndex, needsRank: team.needsRank, classDelta: team.classDelta,
      })),
    },
    warning: "Exploratory self-reflection indices only; not validated, norm-referenced, or a measure of competence.",
  };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function scarfExportRows(report: Awaited<ReturnType<typeof getScarfAnalytics>>) {
  const header = ["participant", "team", "status", "instrument_version", "scoring_version",
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} reaction intensity`),
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} driver priority`),
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} integrated needs index`),
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} integrated needs rank`),
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} tradeoff preference`),
    ...SCARF_DOMAIN_CODES.map((code) => `${SCARF_DOMAIN_NAMES[code]} three-way ranking`), "submitted_at"];
  const rows = report.submitted.map((person) => [person.displayName, person.teamName ?? "Unassigned", person.status, person.instrumentVersion, person.scoringVersion,
    ...SCARF_DOMAIN_CODES.map((code) => person.reaction?.[code] ?? ""),
    ...SCARF_DOMAIN_CODES.map((code) => person.priority?.[code] ?? ""),
    ...SCARF_DOMAIN_CODES.map((code) => person.integratedNeedsIndex?.[code] ?? ""),
    ...SCARF_DOMAIN_CODES.map((code) => person.integratedNeedsRank?.[code] ?? ""),
    ...SCARF_DOMAIN_CODES.map((code) => person.tradeoff?.[code] ?? ""),
    ...SCARF_DOMAIN_CODES.map((code) => person.ranking?.[code] ?? ""), person.submittedAt]);
  return [header, ...rows];
}

export async function scarfOwnerRoute(request: Request, env: ScarfEnv, url: URL): Promise<Response> {
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);

  const activityRoute = url.pathname.match(/^\/api\/owner\/scarf\/activities\/([0-9a-f-]+)(?:\/(analytics|release|presenter-session|export\.csv|participants\/([0-9a-f-]+)\/reset))?$/i);
  if (activityRoute) {
    const activityId = activityRoute[1]!;
    const action = activityRoute[2];
    const activity = await activityWithConfig(db, activityId);
    if (!activity) return fail("SCARF activity not found.", 404);
    if (request.method === "GET" && !action) return json(await scarfOwnerActivity(db, activityId));
    if (request.method === "GET" && action === "analytics") {
      const team = url.searchParams.get("team") || null;
      const result = await getScarfAnalytics(db, "activity", activityId, team, activity.instrument_version, activity.scoring_version);
      return json(result);
    }
    if (request.method === "POST" && action === "release") {
      const data = await body(request, ReleaseBody);
      if (!data) return fail("Invalid release request.", 400);
      if (activity.release_mode === "immediate") return fail("This activity releases each participant’s result immediately.", 409);
      await db.prepare(`UPDATE scarf_activity_configs SET results_released_at = COALESCE(results_released_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE activity_id = ?`)
        .bind(activityId).run();
      await audit(db, activityId, "owner", null, "results_released", null);
      return json({ released: true, resultsReleasedAt: (await activityWithConfig(db, activityId))?.results_released_at ?? null });
    }
    if (request.method === "POST" && action === "presenter-session") {
      const token = randomToken();
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      await db.prepare("INSERT INTO scarf_presenter_sessions (token_hash, activity_id, expires_at) VALUES (?, ?, ?)")
        .bind(await sha256(token), activityId, expiresAt).run();
      await audit(db, activityId, "owner", null, "presenter_session_created", null);
      return json({ path: `/presenter#${token}`, expiresAt });
    }
    if (request.method === "GET" && action === "export.csv") {
      const report = await getScarfAnalytics(db, "activity", activityId, null, activity.instrument_version, activity.scoring_version);
      const text = scarfExportRows(report).map((row) => row.map(csvCell).join(",")).join("\r\n");
      return new Response(text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="scarf-${activityId}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const resetRoute = action?.match(/^participants\/([0-9a-f-]+)\/reset$/i);
    if (request.method === "POST" && resetRoute) {
      const data = await body(request, ResetBody);
      if (!data) return fail("Invalid reset request.", 400);
      if (activity.state === "archived") return fail("Archived activities are read-only. Reopen the activity before resetting a participant.", 409);
      const participantId = resetRoute[1]!;
      const progress = await db.prepare("SELECT generation, status FROM scarf_participations WHERE participant_id = ? AND activity_id = ?")
        .bind(participantId, activityId).first<{ generation: number; status: string }>();
      if (!progress) return fail("Participant was not found in this activity.", 404);
      const nextGeneration = Number(progress.generation) + 1;
      await db.batch([
        db.prepare(`UPDATE scarf_participations SET status = 'in_progress', generation = ?, current_question = 1, view_state = 'welcome', submitted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE participant_id = ? AND activity_id = ? AND generation = ?`).bind(nextGeneration, participantId, activityId, progress.generation),
        db.prepare("DELETE FROM scarf_answers WHERE participant_id = ?").bind(participantId),
        db.prepare("DELETE FROM scarf_results WHERE participant_id = ?").bind(participantId),
        db.prepare(`INSERT INTO scarf_audit_events (id, activity_id, actor_type, actor_id, action, target_id, reason, metadata_json)
          VALUES (?, ?, 'owner', NULL, 'participant_reset', ?, ?, ?)`)
          .bind(newId(), activityId, participantId, data.reason, JSON.stringify({ previousGeneration: progress.generation, generation: nextGeneration })),
      ]);
      return json({ reset: true, generation: nextGeneration });
    }
    return fail("SCARF owner API route not found.", 404);
  }

  const sessionRoute = url.pathname.match(/^\/api\/owner\/scarf\/sessions\/([0-9a-f-]+)(?:\/(analytics|presenter-session|presenter-state|export\.csv))?$/i);
  if (sessionRoute) {
    const sessionId = sessionRoute[1]!;
    const action = sessionRoute[2];
    const session = await db.prepare("SELECT id, name FROM sessions WHERE id = ?").bind(sessionId).first<{ id: string; name: string }>();
    if (!session) return fail("Session not found.", 404);
    if (request.method === "GET" && action === "export.csv") {
      const report = await getScarfAnalytics(db, "session", sessionId);
      const text = scarfExportRows(report).map((row) => row.map(csvCell).join(",")).join("\r\n");
      return new Response(text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="scarf-session-${sessionId}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.method === "GET" && action === "presenter-state") {
      const state = await db.prepare("SELECT revealed, selected_team_name, scarf_layer, updated_at FROM scarf_session_presentation_state WHERE session_id = ?")
        .bind(sessionId).first<{ revealed: number; selected_team_name: string | null; scarf_layer: "reaction" | "priority"; updated_at: string }>();
      return json(state ?? { revealed: 0, selected_team_name: null, scarf_layer: "reaction", updated_at: null });
    }
    if (request.method === "GET" && action === "analytics") {
      return json(await getScarfAnalytics(db, "session", sessionId,
        url.searchParams.get("team") || null,
        url.searchParams.get("instrumentVersion"), url.searchParams.get("scoringVersion")));
    }
    if (request.method === "POST" && action === "presenter-state") {
      const data = await body(request, SessionPresenterStateBody);
      if (!data) return fail("Invalid session presenter settings.", 400);
      const report = await getScarfAnalytics(db, "session", sessionId, null, null, null, true);
      if (data.teamName && !report.teams.some((team) => team.name === data.teamName)) return fail("That team is not part of the released session results.", 400);
      await db.prepare(`INSERT INTO scarf_session_presentation_state (session_id, revealed, selected_team_name, scarf_layer)
        VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET revealed = excluded.revealed,
        selected_team_name = excluded.selected_team_name, scarf_layer = excluded.scarf_layer, updated_at = CURRENT_TIMESTAMP`)
        .bind(sessionId, data.revealed ? 1 : 0, data.teamName || null, data.layer).run();
      const activity = await db.prepare("SELECT id FROM activities WHERE session_id = ? AND tool_id = 'scarf-assessment' ORDER BY created_at DESC LIMIT 1")
        .bind(sessionId).first<{ id: string }>();
      if (activity) await audit(db, activity.id, "owner", null, "session_presenter_state_changed", null, "", { revealed: data.revealed, teamName: data.teamName, layer: data.layer });
      return json({ updated: true });
    }
    if (request.method === "POST" && action === "presenter-session") {
      const hasScarf = await db.prepare("SELECT id FROM activities WHERE session_id = ? AND tool_id = 'scarf-assessment' LIMIT 1").bind(sessionId).first();
      if (!hasScarf) return fail("This session has no SCARF activity to present.", 409);
      const token = randomToken();
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      await db.prepare("INSERT INTO scarf_presenter_sessions (token_hash, activity_id, session_id, expires_at) VALUES (?, NULL, ?, ?)")
        .bind(await sha256(token), sessionId, expiresAt).run();
      const activity = await db.prepare("SELECT id FROM activities WHERE session_id = ? AND tool_id = 'scarf-assessment' ORDER BY created_at DESC LIMIT 1")
        .bind(sessionId).first<{ id: string }>();
      if (activity) await audit(db, activity.id, "owner", null, "session_presenter_session_created", null);
      return json({ path: `/presenter#${token}`, expiresAt, title: session.name });
    }
    return fail("SCARF owner API route not found.", 404);
  }
  return fail("SCARF owner API route not found.", 404);
}

async function currentParticipation(db: D1Database, participant: ScarfParticipant) {
  const row = await db.prepare(`
    SELECT a.title, a.state, a.result_policy, cfg.instrument_version, cfg.scoring_version, cfg.locale,
      cfg.release_mode, cfg.results_released_at, cfg.content_hash, sp.status, sp.generation,
      sp.current_question, sp.view_state, sp.submitted_at, p.display_name
    FROM activities a JOIN scarf_activity_configs cfg ON cfg.activity_id = a.id
    JOIN scarf_participations sp ON sp.activity_id = a.id AND sp.participant_id = ?
    JOIN participants p ON p.id = sp.participant_id
    WHERE a.id = ? AND a.tool_id = 'scarf-assessment'
  `).bind(participant.id, participant.activity_id).first<{
    title: string; state: string; result_policy: string; instrument_version: string; scoring_version: string; locale: string;
    release_mode: string; results_released_at: string | null; content_hash: string; status: string; generation: number;
    current_question: number; view_state: string; submitted_at: string | null; display_name: string;
  }>();
  return row;
}

export async function scarfParticipantRoute(request: Request, env: ScarfEnv, url: URL, participant: ScarfParticipant): Promise<Response> {
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);
  const current = await currentParticipation(db, participant);
  if (!current) return fail("This activity does not have a SCARF Assessment.", 404);
  if (request.method === "GET" && url.pathname === "/api/guest/scarf/current") {
    if (current.status === "submitted") {
      return json({
        activity: { id: participant.activity_id, title: current.title, state: current.state, releaseMode: current.release_mode,
          resultsReleased: current.release_mode === "immediate" || Boolean(current.results_released_at) },
        participant: { displayName: current.display_name },
        instrument: { version: current.instrument_version, scoringVersion: current.scoring_version, status: "experimental_not_validated" },
        progress: { generation: current.generation, currentQuestion: 30, viewState: "completed", status: "submitted", answeredCount: SCARF_QUESTION_COUNT },
        items: [], answers: {}, revisions: {}, disclosure: "Experimental self-reflection instrument; not a validated psychological assessment.",
      });
    }
    const saved = await db.prepare("SELECT question_id, answer_json, revision FROM scarf_answers WHERE participant_id = ? AND generation = ?")
      .bind(participant.id, current.generation).all<{ question_id: string; answer_json: string; revision: number }>();
    const answers: Record<string, unknown> = {};
    const revisions: Record<string, number> = {};
    for (const answer of saved.results) {
      try { answers[answer.question_id] = JSON.parse(answer.answer_json) as unknown; revisions[answer.question_id] = answer.revision; } catch { /* A corrupt row remains unavailable and is rejected on submit. */ }
    }
    return json({
      activity: { id: participant.activity_id, title: current.title, state: current.state, releaseMode: current.release_mode,
        resultsReleased: current.release_mode === "immediate" || Boolean(current.results_released_at) },
      participant: { displayName: current.display_name },
      instrument: { version: current.instrument_version, scoringVersion: current.scoring_version, status: "experimental_not_validated" },
      progress: { generation: current.generation, currentQuestion: current.current_question, viewState: current.view_state, status: current.status, answeredCount: Object.keys(answers).length },
      items: publicScarfQuestions(), answers, revisions,
      disclosure: "Your named results are visible to the trainer. Presenter Mode shows protected group summaries only. This is an experimental self-reflection tool, not a validated psychological assessment.",
    });
  }

  const answerRoute = url.pathname.match(/^\/api\/guest\/scarf\/answers\/(Q\d{2})$/i);
  if (request.method === "PUT" && answerRoute) {
    const questionId = answerRoute[1]!.toUpperCase();
    const data = await body(request, AnswerBody);
    if (!data || !isValidScarfAnswer(questionId, data.answer)) return fail("That response is not valid for this question.", 400, "INVALID_ANSWER");
    const answers = await db.prepare(`SELECT question_id, answer_json FROM scarf_answers WHERE participant_id = ? AND generation = ? AND question_id != ?`)
      .bind(participant.id, data.generation, questionId).all<{ question_id: string; answer_json: string }>();
    const currentAnswers: Record<string, unknown> = {};
    for (const entry of answers.results) { try { currentAnswers[entry.question_id] = JSON.parse(entry.answer_json) as unknown; } catch { /* skipped; completion validation rejects it */ } }
    currentAnswers[questionId] = data.answer;
    if (Object.keys(currentAnswers).length === SCARF_QUESTION_COUNT && !validateScarfAnswers(currentAnswers, true)) return fail("Saved answers need to be corrected before continuing.", 409);
    const activity = await db.prepare("SELECT state FROM activities WHERE id = ? AND tool_id = 'scarf-assessment'")
      .bind(participant.activity_id).first<{ state: string }>();
    if (data.generation !== Number(current.generation)) return fail("This response was reset. Refresh your activity to continue.", 409, "GENERATION_MISMATCH");
    if (current.status === "submitted") return fail("Your assessment is complete. Ask your trainer if you need it reset.", 409, "ALREADY_SUBMITTED");
    if (activity?.state !== "open") return fail("This activity is not accepting answer changes right now.", 409, "ACTIVITY_NOT_OPEN");
    await db.batch([
      db.prepare(`INSERT INTO scarf_answers (participant_id, generation, question_id, answer_json, revision)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM scarf_participations sp JOIN activities a ON a.id = sp.activity_id
          WHERE sp.participant_id = ? AND sp.generation = ? AND sp.status = 'in_progress' AND a.state = 'open'
        )
        ON CONFLICT(participant_id, generation, question_id) DO UPDATE SET
          answer_json = excluded.answer_json, revision = excluded.revision, updated_at = CURRENT_TIMESTAMP
        WHERE excluded.revision > scarf_answers.revision`)
        .bind(participant.id, data.generation, questionId, JSON.stringify(data.answer), data.revision, participant.id, data.generation),
      db.prepare(`UPDATE scarf_participations SET current_question = ?, view_state = 'question', updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = ? AND generation = ? AND status = 'in_progress'
          AND EXISTS (SELECT 1 FROM activities WHERE id = activity_id AND state = 'open')`)
        .bind(data.currentQuestion, participant.id, data.generation),
    ]);
    const after = await db.prepare("SELECT generation, status FROM scarf_participations WHERE participant_id = ?").bind(participant.id).first<{ generation: number; status: string }>();
    const activityAfter = await db.prepare("SELECT state FROM activities WHERE id = ?").bind(participant.activity_id).first<{ state: string }>();
    if (Number(after?.generation) !== data.generation) return fail("This response was reset. Refresh your activity to continue.", 409, "GENERATION_MISMATCH");
    if (after?.status !== "in_progress" || activityAfter?.state !== "open") return fail("This activity is not accepting answer changes right now.", 409, "ACTIVITY_NOT_OPEN");
    const row = await db.prepare("SELECT revision FROM scarf_answers WHERE participant_id = ? AND generation = ? AND question_id = ?")
      .bind(participant.id, data.generation, questionId).first<{ revision: number }>();
    await audit(db, participant.activity_id, "participant", participant.id, "answer_saved", participant.id, "", { questionId, generation: data.generation, revision: row?.revision });
    return json({ saved: true, generation: data.generation, revision: Number(row?.revision ?? data.revision) });
  }

  if (request.method === "PUT" && url.pathname === "/api/guest/scarf/progress") {
    const data = await body(request, ProgressBody);
    if (!data) return fail("Progress could not be saved.", 400);
    if (data.generation !== Number(current.generation)) return fail("This response was reset. Refresh your activity to continue.", 409, "GENERATION_MISMATCH");
    const updated = await db.prepare(`UPDATE scarf_participations SET current_question = ?, view_state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE participant_id = ? AND activity_id = ? AND generation = ? AND status = 'in_progress'
        AND EXISTS (SELECT 1 FROM activities WHERE id = activity_id AND state = 'open')`)
      .bind(data.currentQuestion, data.viewState, participant.id, participant.activity_id, data.generation).run();
    if (Number(updated.meta.changes ?? 0) === 0) return fail("Progress cannot be changed while this activity is paused, closed, or complete.", 409, "ACTIVITY_NOT_OPEN");
    return json({ saved: true, currentQuestion: data.currentQuestion, viewState: data.viewState });
  }

  if (request.method === "POST" && url.pathname === "/api/guest/scarf/submit") {
    const data = await body(request, SubmitBody);
    if (!data) return fail("Could not submit your assessment.", 400);
    if (data.generation !== Number(current.generation)) return fail("This response was reset. Refresh your activity to continue.", 409, "GENERATION_MISMATCH");
    const stored = await db.prepare("SELECT question_id, answer_json FROM scarf_answers WHERE participant_id = ? AND generation = ?")
      .bind(participant.id, data.generation).all<{ question_id: string; answer_json: string }>();
    const answers: Record<string, unknown> = {};
    for (const row of stored.results) { try { answers[row.question_id] = JSON.parse(row.answer_json) as unknown; } catch { /* invalid data rejected below */ } }
    if (!validateScarfAnswers(answers, true)) {
      const missing = SCARF_QUESTION_COUNT - Object.keys(answers).length;
      return fail(missing > 0 ? `Answer all 30 questions before submitting. ${missing} remain.` : "One or more saved answers are invalid. Review them before submitting.", 400, "INCOMPLETE_ASSESSMENT");
    }
    const scores = scoreScarfAnswers(answers as ScarfAnswers);
    const answerHash = await sha256(JSON.stringify(Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)))));
    const existing = await db.prepare("SELECT answer_hash, idempotency_key, reaction_json, priority_json, generation FROM scarf_results WHERE participant_id = ? AND generation = ?")
      .bind(participant.id, data.generation).first<{ answer_hash: string; idempotency_key: string; reaction_json: string; priority_json: string; generation: number }>();
    if (current.status === "submitted" && existing) {
      if (existing.answer_hash === answerHash || existing.idempotency_key === data.idempotencyKey) return json({ submitted: true, alreadySubmitted: true, generation: data.generation });
      return fail("This assessment has already been submitted. Ask your trainer if it needs to be reset.", 409, "ALREADY_SUBMITTED");
    }
    const activity = await db.prepare("SELECT state FROM activities WHERE id = ? AND tool_id = 'scarf-assessment'")
      .bind(participant.activity_id).first<{ state: string }>();
    if (activity?.state !== "open") return fail("This activity is not accepting submissions right now.", 409, "ACTIVITY_NOT_OPEN");
    const scoringV11 = current.scoring_version === SCARF_SCORING_VERSION;
    const scoreMetadata = scoringV11 ? JSON.stringify({
      algorithm: "integrated-needs-midrank-equal-section-v1.1.0",
      instrumentVersion: current.instrument_version,
      scoringVersion: current.scoring_version,
      sourceGeneration: data.generation,
      tieTolerance: 1e-9,
      sectionWeights: { reaction: 1 / 3, tradeoff: 1 / 3, ranking: 1 / 3 },
    }) : null;
    await db.batch([
      db.prepare(`UPDATE scarf_participations SET status = 'submitted', view_state = 'completed', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE participant_id = ? AND generation = ? AND status = 'in_progress'
          AND EXISTS (SELECT 1 FROM activities WHERE id = activity_id AND state = 'open')`).bind(participant.id, data.generation),
      db.prepare(`INSERT INTO scarf_results (participant_id, generation, instrument_version, scoring_version, reaction_json, priority_json,
          tradeoff_json, ranking_json, integrated_needs_index_json, integrated_needs_rank_json, scoring_metadata_json, answer_hash, idempotency_key)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM scarf_participations sp JOIN activities a ON a.id = sp.activity_id
          WHERE sp.participant_id = ? AND sp.generation = ? AND sp.status = 'submitted' AND a.state = 'open'
        ) ON CONFLICT(participant_id, generation) DO NOTHING`)
        .bind(participant.id, data.generation, current.instrument_version, current.scoring_version,
          JSON.stringify(scores.reaction), JSON.stringify(scores.priority),
          scoringV11 ? JSON.stringify(scores.tradeoff) : null,
          scoringV11 ? JSON.stringify(scores.ranking) : null,
          scoringV11 ? JSON.stringify(scores.integratedNeedsIndex) : null,
          scoringV11 ? JSON.stringify(scores.integratedNeedsRank) : null,
          scoreMetadata, answerHash, data.idempotencyKey, participant.id, data.generation),
      db.prepare(`INSERT INTO scarf_audit_events (id, activity_id, actor_type, actor_id, action, target_id, metadata_json)
        SELECT ?, ?, 'participant', ?, 'assessment_submitted', ?, ? WHERE EXISTS (
          SELECT 1 FROM scarf_results WHERE participant_id = ? AND generation = ? AND answer_hash = ?
        )`).bind(newId(), participant.activity_id, participant.id, participant.id, JSON.stringify({ generation: data.generation }), participant.id, data.generation, answerHash),
    ]);
    const final = await db.prepare("SELECT status, generation FROM scarf_participations WHERE participant_id = ?").bind(participant.id).first<{ status: string; generation: number }>();
    const result = await db.prepare("SELECT answer_hash FROM scarf_results WHERE participant_id = ? AND generation = ?")
      .bind(participant.id, data.generation).first<{ answer_hash: string }>();
    if (Number(final?.generation) !== data.generation) return fail("This response was reset before submission completed. Refresh to continue.", 409, "GENERATION_MISMATCH");
    if (final?.status !== "submitted" || !result) return fail("This activity stopped accepting responses. Your saved answers remain available to your trainer.", 409, "ACTIVITY_NOT_OPEN");
    if (result.answer_hash !== answerHash) return fail("A different submission was already saved. Refresh to view its status.", 409, "SUBMISSION_CONFLICT");
    await db.prepare("UPDATE scarf_activity_configs SET release_locked_at = COALESCE(release_locked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE activity_id = ?")
      .bind(participant.activity_id).run();
    return json({ submitted: true, alreadySubmitted: Boolean(existing), generation: data.generation, resultAvailable: current.release_mode === "immediate" || Boolean(current.results_released_at) });
  }

  if (request.method === "GET" && url.pathname === "/api/guest/scarf/results") {
    if (current.status !== "submitted") return json({ visible: false, reason: "not-submitted" });
    const released = current.release_mode === "immediate" || Boolean(current.results_released_at);
    if (!released) return fail("Results aren’t available yet. Your trainer will release them when ready.", 403, "RESULTS_NOT_RELEASED");
    const result = await db.prepare(`SELECT instrument_version, scoring_version, reaction_json, priority_json,
        integrated_needs_index_json, integrated_needs_rank_json, submitted_at
      FROM scarf_results WHERE participant_id = ? AND generation = ?`).bind(participant.id, current.generation)
      .first<{ instrument_version: string; scoring_version: string; reaction_json: string; priority_json: string;
        integrated_needs_index_json: string | null; integrated_needs_rank_json: string | null; submitted_at: string }>();
    if (!result) return fail("Your result is not available right now.", 404);
    return json({ visible: true, reaction: JSON.parse(result.reaction_json) as ScarfDomainScores, priority: JSON.parse(result.priority_json) as ScarfDomainScores,
      integratedNeedsIndex: result.integrated_needs_index_json ? JSON.parse(result.integrated_needs_index_json) as ScarfDomainScores : null,
      integratedNeedsRank: result.integrated_needs_rank_json ? JSON.parse(result.integrated_needs_rank_json) as ScarfDomainScores : null,
      dimensions: DIMENSION_LABELS, instrumentVersion: result.instrument_version, scoringVersion: result.scoring_version,
      submittedAt: result.submitted_at, insightVersion: "en-reflection-v1", experimental: true,
      disclosure: "These exploratory indices reflect your responses in this activity. They are not validated, norm-referenced, or a measure of competence." });
  }
  return fail("SCARF participant route not found.", 404);
}

type PresenterTeamSummary = { name: string; count: number; needsIndex: ScarfDomainScores; needsRank: ScarfDomainScores; classDelta: ScarfDomainScores };
type PresenterNeedsSummary = {
  suppressed: boolean; count: number | null; classMean: ScarfDomainScores | null;
  teams: PresenterTeamSummary[]; teamBreakdownSuppressed: boolean; message?: string;
};

function presenterNeedsSummary(profiles: Array<{ teamName: string; needsIndex: ScarfDomainScores }>): PresenterNeedsSummary {
  const classMean = meanScarfProfiles(profiles.map((profile) => profile.needsIndex));
  if (!classMean || profiles.length < 5) return {
    suppressed: true, count: null, classMean: null, teams: [], teamBreakdownSuppressed: true,
    message: "At least five compatible, released submissions are needed before results can be shown.",
  };
  const groups = new Map<string, ScarfDomainScores[]>();
  for (const profile of profiles) {
    const group = groups.get(profile.teamName) ?? [];
    group.push(profile.needsIndex);
    groups.set(profile.teamName, group);
  }
  const teamBreakdownSuppressed = [...groups.values()].some((group) => group.length < 5);
  const teams = teamBreakdownSuppressed ? [] : [...groups.entries()].map(([name, values]) => {
    const needsIndex = meanScarfProfiles(values)!;
    return {
      name,
      count: values.length,
      needsIndex,
      needsRank: descendingMidranks(needsIndex),
      classDelta: Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, needsIndex[code] - classMean[code]])) as ScarfDomainScores,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    suppressed: false, count: profiles.length, classMean, teams, teamBreakdownSuppressed,
    ...(teamBreakdownSuppressed ? { message: "Team comparisons are hidden because at least one group is too small to display safely." } : {}),
  };
}

async function presenterAggregate(db: D1Database, activityId: string): Promise<PresenterNeedsSummary> {
  const rows = await db.prepare(`SELECT COALESCE(t.name, 'Unassigned') AS team_name, r.integrated_needs_index_json
    FROM scarf_participations sp JOIN participants p ON p.id = sp.participant_id
    LEFT JOIN teams t ON t.id = p.team_id
    JOIN scarf_results r ON r.participant_id = sp.participant_id AND r.generation = sp.generation
    WHERE sp.activity_id = ? AND sp.status = 'submitted' AND r.scoring_version = ?
      AND r.integrated_needs_index_json IS NOT NULL`)
    .bind(activityId, SCARF_SCORING_VERSION)
    .all<{ team_name: string; integrated_needs_index_json: string }>();
  const profiles: Array<{ teamName: string; needsIndex: ScarfDomainScores }> = [];
  for (const row of rows.results) {
    try { profiles.push({ teamName: row.team_name, needsIndex: JSON.parse(row.integrated_needs_index_json) as ScarfDomainScores }); }
    catch { /* Corrupt stored scores never enter a public aggregate. */ }
  }
  return presenterNeedsSummary(profiles);
}

async function sessionPresenterAggregate(db: D1Database, sessionId: string): Promise<PresenterNeedsSummary> {
  // Named rows are used only inside this authenticated Worker call. The public
  // response is shaped into class/team means here and never includes individuals.
  const report = await getScarfAnalytics(db, "session", sessionId, null, null, null, true);
  if (report.instrument.scoringVersion !== SCARF_SCORING_VERSION || !report.heatmap.available) {
    return { suppressed: true, count: null, classMean: null, teams: [], teamBreakdownSuppressed: true,
      message: "No compatible, released Integrated Needs Profile is available for this session yet." };
  }
  const count = report.heatmap.classCount;
  const classMean = report.heatmap.classMean;
  if (!classMean || count < 5) return { suppressed: true, count: null, classMean: null, teams: [], teamBreakdownSuppressed: true,
    message: "At least five compatible, released submissions are needed before results can be shown." };
  const teamRows = report.heatmap.teams as PresenterTeamSummary[];
  const teamBreakdownSuppressed = teamRows.some((team) => team.count < 5);
  return {
    suppressed: false, count, classMean,
    teams: teamBreakdownSuppressed ? [] : teamRows,
    teamBreakdownSuppressed,
    ...(teamBreakdownSuppressed ? { message: "Team comparisons are hidden because at least one group is too small to display safely." } : {}),
  };
}

export async function scarfPresenterRoute(request: Request, env: ScarfEnv, token: string | null): Promise<Response | null> {
  if (request.method !== "GET") return fail("Presenter endpoint is read-only.", 405);
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const session = await db.prepare(`SELECT ps.activity_id, ps.session_id, ps.expires_at, ps.revoked_at,
      COALESCE(a.title, workshop.name) AS title, COALESCE(a.state, 'session') AS state,
      cfg.release_mode, cfg.results_released_at,
      CASE WHEN ps.session_id IS NULL THEN present.revealed ELSE session_present.revealed END AS revealed,
      present.selected_team_id, team.name AS team_name,
      session_present.selected_team_name, COALESCE(present.scarf_layer, session_present.scarf_layer, 'reaction') AS scarf_layer
    FROM scarf_presenter_sessions ps
    LEFT JOIN activities a ON a.id = ps.activity_id
    LEFT JOIN sessions workshop ON workshop.id = ps.session_id
    LEFT JOIN scarf_activity_configs cfg ON cfg.activity_id = a.id
    LEFT JOIN presentation_state present ON present.activity_id = a.id
    LEFT JOIN teams team ON team.id = present.selected_team_id
    LEFT JOIN scarf_session_presentation_state session_present ON session_present.session_id = ps.session_id
    WHERE ps.token_hash = ?`).bind(await sha256(token)).first<{
    activity_id: string | null; session_id: string | null; expires_at: string; revoked_at: string | null; title: string; state: string;
    release_mode: string | null; results_released_at: string | null; revealed: number | null; selected_team_id: string | null;
    team_name: string | null; selected_team_name: string | null; scarf_layer: "reaction" | "priority";
  }>();
  if (!session) return null;
  if (session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return fail("Presenter link has expired. Ask your trainer to open a new screen.", 404);
  const released = session.session_id !== null || session.release_mode === "immediate" || Boolean(session.results_released_at);
  if (!session.revealed || !released) return json({ kind: "scarf-aggregate", revealed: false, title: session.title, state: session.state });
  const aggregate = session.session_id
    ? await sessionPresenterAggregate(db, session.session_id)
    : await presenterAggregate(db, session.activity_id!);
  const presentation = { layer: "integrated-needs", comparisonBasis: "Personal Pattern or Compared to Class", teamName: "All teams" };
  return json({ kind: "scarf-aggregate", revealed: true, activity: { title: session.title, state: session.state }, presentation,
    heatmap: aggregate,
    dimensions: DIMENSION_LABELS,
    disclosure: `${session.session_id ? "Integrated Needs Profiles for compatible, released activities in this session" : "Integrated Needs Profile for this activity"}. Exploratory relative preference indices; not validated, norm-referenced, or a measure of competence. Individual names and scores are never shown.` });
}
