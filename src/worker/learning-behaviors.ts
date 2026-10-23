import { z } from "zod";
import {
  LEARNING_BEHAVIORS,
  LBR_NA_LABEL,
  LBR_SCALE,
  LBR_TOOL_ID,
  isLbrRating,
  summarizeGroupSelf,
  summarizePeerRounds,
  meanParticipantPeerMeans,
  type BehaviorKey,
  type LbrBehaviorCopy,
  type LbrRating,
} from "../domain/learning-behaviors";
import { sha256 } from "./security";

export interface LearningBehaviorsEnv { DB?: D1Database }
export interface LearningBehaviorsParticipant { id: string; activity_id: string; team_id: string | null; display_name: string }

const behaviorSchema = z.object({
  key: z.string(), number: z.number().int(), name: z.string(), shortName: z.string(),
  description: z.string().max(400), example: z.string().max(400), reflectionPrompt: z.string().max(300),
});
const behaviorListSchema = z.array(behaviorSchema).length(6);
const createSchema = z.object({
  title: z.string().trim().min(1).max(100), sessionId: z.string().uuid().nullable().optional(),
  intro: z.string().trim().max(1000).optional().default(""), behaviors: behaviorListSchema.optional(),
  allowTeams: z.boolean().default(false), teamNames: z.array(z.string().trim().min(1).max(50)).max(12).default([]),
});
const configSchema = z.object({
  title: z.string().trim().min(1).max(100), intro: z.string().trim().max(1000), behaviors: behaviorListSchema,
});
const draftSchema = z.object({ rating: z.union([z.number().int().min(1).max(5), z.literal("NA"), z.null()]).optional(), evidence: z.string().max(1000).optional(), stepIndex: z.number().int().min(1).max(6).optional() }).refine((value) => value.rating !== undefined || value.evidence !== undefined || value.stepIndex !== undefined);
const roundCreateSchema = z.object({ clientKey: z.string().uuid() });
const roundSubmitSchema = z.object({ answers: z.record(z.string(), z.unknown()) });
const noteSchema = z.object({ text: z.string().max(2000), revision: z.number().int().min(1) });
const textSchema = z.object({ text: z.string().max(4000), revision: z.number().int().min(1) });
const phaseSchema = z.object({ phase: z.enum(["FEEDBACK_COLLECTION", "MY_REFLECTION", "MY_ACTIONS"]) });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
  } });
}
function fail(message: string, status: number, code?: string) { return json(code ? { error: message, code } : { error: message }, status); }
async function readBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 32_768) return null;
  try { const value = schema.safeParse(await request.json()); return value.success ? value.data : null; } catch { return null; }
}
function dbFor(env: LearningBehaviorsEnv) { return env.DB ?? null; }
function newId() { return crypto.randomUUID(); }

function normalizeBehaviorCopy(input?: z.infer<typeof behaviorListSchema>): LbrBehaviorCopy[] | null {
  if (input && input.some((item, index) => item.key !== LEARNING_BEHAVIORS[index]?.key || item.number !== index + 1 || item.name !== LEARNING_BEHAVIORS[index]?.name || item.shortName !== LEARNING_BEHAVIORS[index]?.shortName)) return null;
  return LEARNING_BEHAVIORS.map((base, index) => {
    const item = input?.[index];
    return {
      ...base,
      description: item?.description.trim() || base.description,
      example: item?.example.trim() || base.example,
      reflectionPrompt: item?.reflectionPrompt.trim() || base.reflectionPrompt,
    };
  });
}

async function getLbrActivity(db: D1Database, activityId: string) {
  return db.prepare(`SELECT a.id, a.session_id, a.title, a.tool_id, a.state, a.require_name, a.allow_teams,
    a.join_pin, a.presenter_token_hash, s.name AS session_name, cfg.intro, cfg.behaviors_json, cfg.content_frozen_at, cfg.revision
    FROM activities a JOIN lbr_activity_configs cfg ON cfg.activity_id = a.id
    LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id = ? AND a.tool_id = ?`).bind(activityId, LBR_TOOL_ID)
    .first<{ id: string; session_id: string | null; title: string; tool_id: string; state: string; require_name: number; allow_teams: number; join_pin: string | null; presenter_token_hash: string | null; session_name: string | null; intro: string; behaviors_json: string; content_frozen_at: string | null; revision: number }>();
}

async function defaultActivityPayload(db: D1Database, activityId: string) {
  const activity = await getLbrActivity(db, activityId);
  if (!activity) return null;
  const behaviors = JSON.parse(activity.behaviors_json) as LbrBehaviorCopy[];
  const teams = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at").bind(activityId).all<{ id: string; name: string }>();
  return { activity: { id: activity.id, sessionId: activity.session_id, sessionName: activity.session_name, title: activity.title, state: activity.state, joinPin: activity.join_pin, allowTeams: Boolean(activity.allow_teams), contentFrozen: Boolean(activity.content_frozen_at), contentFrozenAt: activity.content_frozen_at }, intro: activity.intro, behaviors, teams: teams.results };
}

async function ensureProgress(db: D1Database, activityId: string, participantId: string) {
  await db.prepare(`INSERT INTO lbr_progress (activity_id, participant_id) VALUES (?, ?) ON CONFLICT(activity_id,participant_id) DO NOTHING`)
    .bind(activityId, participantId).run();
}

function mapRating(rating: number | "NA" | null | undefined) {
  return { rating: typeof rating === "number" ? rating : null, is_na: rating === "NA" ? 1 : 0 };
}
function decodeAnswer(row: { behavior_key: string; rating: number | null; is_na: number; evidence_text?: string }) {
  return { behaviorKey: row.behavior_key as BehaviorKey, rating: row.is_na ? "NA" as const : row.rating, ...(row.evidence_text === undefined ? {} : { evidence: row.evidence_text }) };
}

async function ownState(db: D1Database, participant: LearningBehaviorsParticipant) {
  const activity = await getLbrActivity(db, participant.activity_id);
  if (!activity) return null;
  const progress = await db.prepare(`SELECT current_phase, started_at, last_step_index, self_locked_at, feedback_phase_left_at,
    reflection_entered_at, actions_entered_at, ever_completed_at, reflection_text, actions_text, revision
    FROM lbr_progress WHERE activity_id = ? AND participant_id = ?`).bind(participant.activity_id, participant.id)
    .first<{ current_phase: string; started_at: string | null; last_step_index: number; self_locked_at: string | null; feedback_phase_left_at: string | null; reflection_entered_at: string | null; actions_entered_at: string | null; ever_completed_at: string | null; reflection_text: string; actions_text: string; revision: number }>();
  const self = await db.prepare("SELECT behavior_key, rating, is_na, evidence_text, revision FROM lbr_self_answers WHERE activity_id = ? AND participant_id = ? ORDER BY behavior_key")
    .bind(participant.activity_id, participant.id).all<{ behavior_key: string; rating: number | null; is_na: number; evidence_text: string; revision: number }>();
  const rounds = await db.prepare(`SELECT r.id, r.status, r.submitted_at, n.note_text, n.revision AS note_revision
    FROM lbr_peer_rounds r LEFT JOIN lbr_quick_notes n ON n.round_id = r.id
    WHERE r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED' ORDER BY r.created_at`)
    .bind(participant.activity_id, participant.id).all<{ id: string; status: string; submitted_at: string | null; note_text: string | null; note_revision: number | null }>();
  const peerAnswers = await db.prepare(`SELECT pa.round_id, pa.behavior_key, pa.rating, pa.is_na FROM lbr_peer_answers pa
    JOIN lbr_peer_rounds r ON r.id = pa.round_id WHERE r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED'`)
    .bind(participant.activity_id, participant.id).all<{ round_id: string; behavior_key: string; rating: number | null; is_na: number }>();
  const roundsWithAnswers = rounds.results.map((round) => ({ ...round,
    answers: peerAnswers.results.filter((answer) => answer.round_id === round.id).map((answer) => decodeAnswer(answer)),
  }));
  const peerMaps = roundsWithAnswers.map((round) => Object.fromEntries(round.answers.map((answer) => [answer.behaviorKey, answer.rating])) as Record<BehaviorKey, Exclude<LbrRating, null>>);
  const peerStats = summarizePeerRounds(peerMaps);
  const scale = LBR_SCALE.map(({ value, label }) => ({ value, label }));
  return {
    activity: { id: activity.id, title: activity.title, state: activity.state, sessionName: activity.session_name },
    participant: { displayName: participant.display_name }, behaviors: JSON.parse(activity.behaviors_json) as LbrBehaviorCopy[],
    intro: activity.intro,
    progress: progress ?? { current_phase: "SELF_DRAFT", started_at: null, last_step_index: 1, self_locked_at: null, feedback_phase_left_at: null, reflection_entered_at: null, actions_entered_at: null, ever_completed_at: null, reflection_text: "", actions_text: "", revision: 1 },
    selfAnswers: self.results.map((answer) => ({ ...decodeAnswer(answer), revision: answer.revision })),
    peerRounds: roundsWithAnswers.map((round, index) => ({ roundId: round.id, roundNumber: index + 1, submittedAt: round.submitted_at,
      note: round.note_text ?? "", noteRevision: round.note_revision ?? 1, answers: round.answers })),
    peerSubmissionCount: rounds.results.length, peerStats, scale, naLabel: LBR_NA_LABEL,
  };
}

async function participantIsOpen(db: D1Database, activityId: string) {
  return Boolean(await db.prepare("SELECT id FROM activities WHERE id = ? AND tool_id = ? AND state = 'open'").bind(activityId, LBR_TOOL_ID).first());
}

async function ownerList(db: D1Database) {
  const { results } = await db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin, s.name AS session_name,
    (SELECT COUNT(*) FROM participants p WHERE p.activity_id = a.id) AS participant_count,
    (SELECT COUNT(*) FROM lbr_progress p WHERE p.activity_id = a.id AND p.self_locked_at IS NOT NULL) AS self_locked_count,
    (SELECT COUNT(*) FROM lbr_peer_rounds r WHERE r.activity_id = a.id AND r.status = 'SUBMITTED') AS peer_submission_count
    FROM activities a JOIN lbr_activity_configs cfg ON cfg.activity_id = a.id
    LEFT JOIN sessions s ON s.id = a.session_id ORDER BY a.updated_at DESC`).all();
  return { activities: results };
}

async function ownerLive(db: D1Database, activityId: string) {
  const base = await defaultActivityPayload(db, activityId);
  if (!base) return null;
  const counts = await db.prepare(`SELECT COUNT(*) AS joined,
    SUM(CASE WHEN p.started_at IS NOT NULL THEN 1 ELSE 0 END) AS started,
    SUM(CASE WHEN p.self_locked_at IS NOT NULL THEN 1 ELSE 0 END) AS self_locked,
    SUM(CASE WHEN p.current_phase IN ('MY_REFLECTION','MY_ACTIONS','COMPLETED') THEN 1 ELSE 0 END) AS feedback_phase_left,
    SUM(CASE WHEN p.reflection_entered_at IS NOT NULL THEN 1 ELSE 0 END) AS reflection_entered,
    SUM(CASE WHEN p.actions_entered_at IS NOT NULL THEN 1 ELSE 0 END) AS actions_entered,
    SUM(CASE WHEN p.ever_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN length(trim(p.actions_text)) > 0 THEN 1 ELSE 0 END) AS action_recorded,
    (SELECT COUNT(*) FROM lbr_peer_rounds r WHERE r.activity_id = ? AND r.status = 'SUBMITTED') AS peer_submissions
    FROM participants x LEFT JOIN lbr_progress p ON p.activity_id = x.activity_id AND p.participant_id = x.id WHERE x.activity_id = ?`)
    .bind(activityId, activityId).first<Record<string, number | null>>();
  const { results } = await db.prepare(`SELECT x.id, x.display_name, x.role, x.team_id, t.name AS team_name, x.joined_at, x.last_seen_at,
    p.current_phase, p.started_at, p.self_locked_at, p.feedback_phase_left_at, p.reflection_entered_at, p.ever_completed_at,
    CASE WHEN length(trim(COALESCE(p.actions_text,''))) > 0 THEN 1 ELSE 0 END AS action_recorded,
    (SELECT COUNT(*) FROM lbr_peer_rounds r WHERE r.activity_id = x.activity_id AND r.participant_id = x.id AND r.status = 'SUBMITTED') AS peer_submissions
    FROM participants x LEFT JOIN teams t ON t.id = x.team_id
    LEFT JOIN lbr_progress p ON p.activity_id = x.activity_id AND p.participant_id = x.id
    WHERE x.activity_id = ? ORDER BY x.joined_at`)
    .bind(activityId).all();
  return { ...base, counts: Object.fromEntries(Object.entries(counts ?? {}).map(([key, value]) => [key, Number(value ?? 0)])), participants: results };
}

async function ownerAnalytics(db: D1Database, activityId: string, selectedTeam: string | null) {
  const base = await defaultActivityPayload(db, activityId);
  if (!base) return null;
  if (selectedTeam && !base.teams.some((team) => team.id === selectedTeam)) return null;
  const { results: participantRows } = await db.prepare(`SELECT p.id, p.display_name, p.team_id, t.name AS team_name,
    pr.current_phase, pr.started_at, pr.self_locked_at, pr.ever_completed_at,
    pr.reflection_text, pr.actions_text, pr.revision
    FROM participants p LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN lbr_progress pr ON pr.activity_id = p.activity_id AND pr.participant_id = p.id
    WHERE p.activity_id = ? AND (? IS NULL OR p.team_id = ?) ORDER BY p.joined_at`)
    .bind(activityId, selectedTeam, selectedTeam).all<{ id: string; display_name: string; team_id: string | null; team_name: string | null; current_phase: string | null; started_at: string | null; self_locked_at: string | null; ever_completed_at: string | null; reflection_text: string | null; actions_text: string | null; revision: number | null }>();
  const { results: selfRows } = await db.prepare(`SELECT a.participant_id, a.behavior_key, a.rating, a.is_na
    FROM lbr_self_answers a JOIN participants p ON p.id = a.participant_id
    WHERE a.activity_id = ? AND (? IS NULL OR p.team_id = ?)`)
    .bind(activityId, selectedTeam, selectedTeam).all<{ participant_id: string; behavior_key: string; rating: number | null; is_na: number }>();
  const { results: peerRows } = await db.prepare(`SELECT r.id AS round_id, r.participant_id, a.behavior_key, a.rating, a.is_na
    FROM lbr_peer_rounds r JOIN lbr_peer_answers a ON a.round_id = r.id JOIN participants p ON p.id = r.participant_id
    WHERE r.activity_id = ? AND r.status = 'SUBMITTED' AND (? IS NULL OR p.team_id = ?)`)
    .bind(activityId, selectedTeam, selectedTeam).all<{ round_id: string; participant_id: string; behavior_key: string; rating: number | null; is_na: number }>();
  const { results: roundCounts } = await db.prepare(`SELECT r.participant_id, COUNT(*) AS count FROM lbr_peer_rounds r
    JOIN participants p ON p.id = r.participant_id WHERE r.activity_id = ? AND r.status = 'SUBMITTED' AND (? IS NULL OR p.team_id = ?) GROUP BY r.participant_id`)
    .bind(activityId, selectedTeam, selectedTeam).all<{ participant_id: string; count: number }>();

  const selfByOwner = new Map<string, Record<string, LbrRating>>();
  for (const row of selfRows) {
    const answers = selfByOwner.get(row.participant_id) ?? {};
    answers[row.behavior_key] = row.is_na ? "NA" : row.rating;
    selfByOwner.set(row.participant_id, answers);
  }
  const roundsByOwner = new Map<string, Map<string, Record<string, LbrRating>>>();
  for (const row of peerRows) {
    const ownerRounds = roundsByOwner.get(row.participant_id) ?? new Map<string, Record<string, LbrRating>>();
    const answers = ownerRounds.get(row.round_id) ?? {};
    answers[row.behavior_key] = row.is_na ? "NA" : row.rating;
    ownerRounds.set(row.round_id, answers);
    roundsByOwner.set(row.participant_id, ownerRounds);
  }
  const selfStats = summarizeGroupSelf(participantRows.map((owner) => ({
    locked: Boolean(owner.self_locked_at), answers: (selfByOwner.get(owner.id) ?? {}) as Partial<Record<BehaviorKey, LbrRating>>,
  })));
  const owners = participantRows.map((row) => {
    const rounds = [...(roundsByOwner.get(row.id)?.values() ?? [])].filter((round) => LEARNING_BEHAVIORS.every((behavior) => round[behavior.key] !== undefined))
      .map((round) => round as Record<BehaviorKey, Exclude<LbrRating, null>>);
    const peerStats = summarizePeerRounds(rounds);
    return {
      participantId: row.id, displayName: row.display_name, teamId: row.team_id, teamName: row.team_name,
      phase: row.current_phase ?? "NOT_STARTED", started: Boolean(row.started_at), selfLocked: Boolean(row.self_locked_at),
      completedAt: row.ever_completed_at, actionRecorded: Boolean(row.actions_text?.trim()), peerSubmissionCount: Number(roundCounts.find((count) => count.participant_id === row.id)?.count ?? 0),
      self: Object.fromEntries(LEARNING_BEHAVIORS.map((behavior) => [behavior.key, (selfByOwner.get(row.id) ?? {})[behavior.key] ?? null])), peer: peerStats,
    };
  });
  const behaviorSummary = Object.fromEntries(LEARNING_BEHAVIORS.map(({ key, name }) => {
    const selfValues = owners.filter((owner) => owner.selfLocked).map((owner) => owner.self[key] as LbrRating);
    const self = summarizeGroupSelf(owners.map((owner) => ({ locked: owner.selfLocked, answers: owner.self as Partial<Record<BehaviorKey, LbrRating>> }))).behaviors[key];
    const peerOwnerSummaries = owners.map((owner) => owner.peer[key]);
    const peer = meanParticipantPeerMeans(peerOwnerSummaries);
    const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((value) => [value, selfValues.filter((rating) => rating === value).length]));
    return [key, { key, name, self, peer, distribution }];
  }));
  const teams = base.teams.map((team) => {
    const teamOwners = owners.filter((owner) => owner.teamId === team.id);
    const group = summarizeGroupSelf(teamOwners.map((owner) => ({ locked: owner.selfLocked, answers: owner.self as Partial<Record<BehaviorKey, LbrRating>> })));
    return { teamId: team.id, teamName: team.name, participantCount: teamOwners.length, lockedCount: group.lockedCount, behaviors: group.behaviors };
  });
  return { activity: base.activity, behaviors: LEARNING_BEHAVIORS.map((behavior) => behavior), teams, filterTeamId: selectedTeam,
    counts: { joined: participantRows.length, selfLocked: selfStats.lockedCount, completed: owners.filter((owner) => owner.completedAt).length,
      peerSubmissions: owners.reduce((sum, owner) => sum + owner.peerSubmissionCount, 0) },
    summary: behaviorSummary, participants: owners };
}

async function ownerParticipantDetail(db: D1Database, activityId: string, participantId: string) {
  const { results: rows } = await db.prepare(`SELECT p.id, p.display_name, p.role, p.team_id, t.name AS team_name, p.joined_at, p.last_seen_at,
    pr.current_phase, pr.started_at, pr.self_locked_at, pr.feedback_phase_left_at, pr.reflection_entered_at,
    pr.actions_entered_at, pr.ever_completed_at, pr.reflection_text, pr.actions_text
    FROM participants p LEFT JOIN teams t ON t.id = p.team_id LEFT JOIN lbr_progress pr ON pr.activity_id = p.activity_id AND pr.participant_id = p.id
    WHERE p.activity_id = ? AND p.id = ?`).bind(activityId, participantId).all<Record<string, unknown>>();
  if (!rows.length) return null;
  const self = await db.prepare("SELECT behavior_key, rating, is_na, evidence_text FROM lbr_self_answers WHERE activity_id = ? AND participant_id = ? ORDER BY behavior_key")
    .bind(activityId, participantId).all<{ behavior_key: string; rating: number | null; is_na: number; evidence_text: string }>();
  const { results: rounds } = await db.prepare(`SELECT r.id, r.submitted_at, n.note_text FROM lbr_peer_rounds r
    LEFT JOIN lbr_quick_notes n ON n.round_id = r.id WHERE r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED' ORDER BY r.created_at`)
    .bind(activityId, participantId).all<{ id: string; submitted_at: string | null; note_text: string | null }>();
  const peer = await db.prepare(`SELECT a.round_id, a.behavior_key, a.rating, a.is_na FROM lbr_peer_answers a
    JOIN lbr_peer_rounds r ON r.id = a.round_id WHERE r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED'`)
    .bind(activityId, participantId).all<{ round_id: string; behavior_key: string; rating: number | null; is_na: number }>();
  const peerRounds = rounds.map((round, index) => ({ roundNumber: index + 1, submittedAt: round.submitted_at, note: round.note_text ?? "",
    answers: peer.results.filter((answer) => answer.round_id === round.id).map((answer) => decodeAnswer(answer)) }));
  const peerMeans = summarizePeerRounds(peerRounds.map((round) => Object.fromEntries(round.answers.map((answer) => [answer.behaviorKey, answer.rating])) as Record<BehaviorKey, Exclude<LbrRating, null>>));
  return { participant: rows[0], behaviors: LEARNING_BEHAVIORS.map(({ key, name }) => {
    const selfAnswer = self.results.find((answer) => answer.behavior_key === key);
    return { key, name, self: selfAnswer ? (selfAnswer.is_na ? "NA" : selfAnswer.rating) : null,
      evidence: selfAnswer?.evidence_text ?? "", peer: peerMeans[key] };
  }), peerRounds, peerSubmissionCount: rounds.length };
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
async function ownerCsv(db: D1Database, activityId: string) {
  const analytics = await ownerAnalytics(db, activityId, null);
  if (!analytics) return null;
  const detail = await Promise.all(analytics.participants.map((owner) => ownerParticipantDetail(db, activityId, owner.participantId)));
  const headers = ["participant", "team", "phase", "self_locked", ...LEARNING_BEHAVIORS.flatMap((behavior) => [`self_${behavior.key}`, `peer_mean_${behavior.key}`, `peer_valid_n_${behavior.key}`, `self_evidence_${behavior.key}`]), "peer_submission_count", "quick_notes", "reflection", "actions", "completed_at"];
  const rows = detail.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => {
    const participant = item.participant as Record<string, unknown>;
    const behaviorColumns = item.behaviors.flatMap((behavior) => [behavior.self ?? "", behavior.peer.mean ?? "", behavior.peer.validN, behavior.evidence]);
    const notes = item.peerRounds.map((round) => `Feedback ${round.roundNumber}: ${round.note}`).filter((note) => !note.endsWith(": ")).join(" | ");
    return [participant.display_name, participant.team_name ?? "", participant.current_phase ?? "NOT_STARTED", participant.self_locked_at ?? "", ...behaviorColumns, item.peerSubmissionCount, notes, participant.reflection_text ?? "", participant.actions_text ?? "", participant.ever_completed_at ?? ""];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function learningBehaviorsOwnerRoute(request: Request, env: LearningBehaviorsEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/owner/learning-behaviors")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  if (request.method === "GET" && url.pathname === "/api/owner/learning-behaviors") return json(await ownerList(db));
  if (request.method === "POST" && url.pathname === "/api/owner/learning-behaviors") {
    const data = await readBody(request, createSchema);
    if (!data || (!data.allowTeams && data.teamNames.length)) return fail("Check the activity name and team settings.", 400);
    if (data.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(data.sessionId).first()) return fail("Session not found.", 404);
    const behaviors = normalizeBehaviorCopy(data.behaviors);
    if (!behaviors) return fail("Behavior keys, names and order are fixed.", 400);
    const activityId = newId();
    const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO activities (id,session_id,title,tool_id,state,result_policy,require_name,allow_teams,instrument_version,scoring_version)
      VALUES (?,?,?,?,'draft','confirmation',1,?,'lbr-v1.0','lbr-v1.0')`).bind(activityId, data.sessionId ?? null, data.title, LBR_TOOL_ID, data.allowTeams ? 1 : 0),
    db.prepare("INSERT INTO lbr_activity_configs (activity_id,intro,behaviors_json) VALUES (?,?,?)").bind(activityId, data.intro, JSON.stringify(behaviors)),
    db.prepare("INSERT INTO presentation_state (activity_id) VALUES (?)").bind(activityId)];
    for (const name of data.teamNames) statements.push(db.prepare("INSERT INTO teams (id,activity_id,name) VALUES (?,?,?)").bind(newId(), activityId, name));
    await db.batch(statements);
    return json({ activityId }, 201);
  }
  const match = url.pathname.match(/^\/api\/owner\/learning-behaviors\/([0-9a-f-]+)(?:\/(live|analytics|participants\/([0-9a-f-]+)|export))?$/i);
  if (!match) return fail("Learning Behaviors Reflection route not found.", 404);
  const activityId = match[1]!;
  const action = match[2];
  const activity = await getLbrActivity(db, activityId);
  if (!activity) return fail("Learning Behaviors Reflection activity not found.", 404);
  if (request.method === "GET" && action === "live") return json(await ownerLive(db, activityId));
  if (request.method === "GET" && action === "analytics") {
    const teamId = url.searchParams.get("teamId");
    const data = await ownerAnalytics(db, activityId, teamId || null);
    return data ? json(data) : fail("Team not found for this activity.", 404);
  }
  if (request.method === "GET" && action?.startsWith("participants/")) {
    const data = await ownerParticipantDetail(db, activityId, match[3]!);
    return data ? json(data) : fail("Participant not found.", 404);
  }
  if (request.method === "GET" && action === "export") {
    const csv = await ownerCsv(db, activityId);
    if (csv === null) return fail("Activity not found.", 404);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="learning-behaviors-${activityId.slice(0, 8)}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (request.method === "GET" && !action) return json(await defaultActivityPayload(db, activityId));
  if (request.method === "PATCH" && !action) {
    const data = await readBody(request, configSchema);
    if (!data) return fail("Check the activity name and behavior descriptions.", 400);
    const behaviors = normalizeBehaviorCopy(data.behaviors);
    if (!behaviors) return fail("Behavior names, keys and order are fixed.", 400);
    if (!['draft', 'open'].includes(activity.state) || activity.content_frozen_at) return fail("Activity content is locked after the first participant response.", 409, "CONTENT_FROZEN");
    const update = await db.prepare(`UPDATE lbr_activity_configs SET intro = ?, behaviors_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND content_frozen_at IS NULL AND NOT EXISTS (SELECT 1 FROM lbr_self_answers WHERE activity_id = ?)
      AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state IN ('draft','open'))`)
      .bind(data.intro, JSON.stringify(behaviors), activityId, activityId, activityId).run();
    if (Number(update.meta.changes ?? 0) !== 1) return fail("Activity content is locked after the first participant response.", 409, "CONTENT_FROZEN");
    await db.prepare(`UPDATE activities SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND state IN ('draft','open') AND NOT EXISTS (SELECT 1 FROM lbr_self_answers WHERE activity_id = ?)`)
      .bind(data.title, activityId, activityId).run();
    return json({ saved: true });
  }
  return fail("Learning Behaviors Reflection route not found.", 404);
}

export async function learningBehaviorsParticipantRoute(request: Request, env: LearningBehaviorsEnv, url: URL, participant: LearningBehaviorsParticipant): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/guest/lbr/")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  if (!await getLbrActivity(db, participant.activity_id)) return fail("Learning Behaviors Reflection activity not found.", 404);
  if (request.method === "GET" && url.pathname === "/api/guest/lbr/me") return json(await ownState(db, participant));
  if (request.method === "POST" && url.pathname === "/api/guest/lbr/me/start") {
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    await ensureProgress(db, participant.activity_id, participant.id);
    await db.prepare(`UPDATE lbr_progress SET started_at = COALESCE(started_at,CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND participant_id = ?`).bind(participant.activity_id, participant.id).run();
    return json({ started: true });
  }
  if (request.method === "PATCH" && url.pathname.startsWith("/api/guest/lbr/me/self/")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-1) ?? "") as BehaviorKey;
    if (!LEARNING_BEHAVIORS.some((behavior) => behavior.key === key)) return fail("Behavior not found.", 404);
    const data = await readBody(request, draftSchema);
    if (!data) return fail("Choose a valid rating or save a shorter note.", 400);
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    await ensureProgress(db, participant.activity_id, participant.id);
    const startState = await db.prepare("SELECT started_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?")
      .bind(participant.activity_id, participant.id).first<{ started_at: string | null }>();
    if (!startState?.started_at && data.rating !== undefined) return fail("Start the activity before saving Self ratings.", 409, "NOT_STARTED");
    const current = await db.prepare("SELECT rating,is_na,evidence_text FROM lbr_self_answers WHERE activity_id = ? AND participant_id = ? AND behavior_key = ?")
      .bind(participant.activity_id, participant.id, key).first<{ rating: number | null; is_na: number; evidence_text: string }>();
    const progress = await db.prepare("SELECT self_locked_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ self_locked_at: string | null }>();
    if (progress?.self_locked_at && data.rating !== undefined) return fail("Your Self rating is locked. It cannot be changed.", 409, "SELF_LOCKED");
    const previousRating: LbrRating = current?.is_na ? "NA" : current?.rating ?? null;
    const rating: LbrRating = data.rating === undefined ? previousRating : data.rating;
    const mapped = mapRating(rating);
    const evidence = data.evidence ?? current?.evidence_text ?? "";
    if (!current && progress?.self_locked_at) return fail("Your Self ratings are locked.", 409, "SELF_LOCKED");
    try {
      await db.prepare(`INSERT INTO lbr_self_answers (activity_id,participant_id,behavior_key,rating,is_na,evidence_text)
        VALUES (?,?,?,?,?,?) ON CONFLICT(activity_id,participant_id,behavior_key) DO UPDATE SET
        rating = excluded.rating, is_na = excluded.is_na, evidence_text = excluded.evidence_text,
        revision = lbr_self_answers.revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM activities a JOIN lbr_progress p ON p.activity_id = a.id
          WHERE a.id = ? AND a.state = 'open' AND p.participant_id = ? AND (p.self_locked_at IS NULL OR ? = 0))`)
        .bind(participant.activity_id, participant.id, key, mapped.rating, mapped.is_na, evidence, participant.activity_id, participant.id, data.rating === undefined ? 0 : 1).run();
    } catch { return fail("Your Self rating is locked or this activity has closed.", 409, "WRITE_REJECTED"); }
    if (data.stepIndex !== undefined) await db.prepare(`UPDATE lbr_progress SET last_step_index = ?, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND participant_id = ? AND self_locked_at IS NULL AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(data.stepIndex, participant.activity_id, participant.id, participant.activity_id).run();
    return json({ saved: true });
  }
  if (request.method === "POST" && url.pathname === "/api/guest/lbr/me/lock-self") {
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const started = await db.prepare("SELECT started_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?")
      .bind(participant.activity_id, participant.id).first<{ started_at: string | null }>();
    if (!started?.started_at) return fail("Start the activity before locking Self ratings.", 409, "NOT_STARTED");
    const complete = await db.prepare(`SELECT COUNT(*) AS count FROM lbr_self_answers WHERE activity_id = ? AND participant_id = ?
      AND (rating BETWEEN 1 AND 5 OR is_na = 1)`).bind(participant.activity_id, participant.id).first<{ count: number }>();
    if (Number(complete?.count ?? 0) !== LEARNING_BEHAVIORS.length) return fail("Choose a rating or N/A for all six behaviors before continuing.", 409, "SELF_INCOMPLETE");
    await db.prepare(`UPDATE lbr_progress SET self_locked_at = COALESCE(self_locked_at,CURRENT_TIMESTAMP), current_phase = 'FEEDBACK_COLLECTION',
      updated_at = CURRENT_TIMESTAMP WHERE activity_id = ? AND participant_id = ? AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(participant.activity_id, participant.id, participant.activity_id).run();
    const progress = await db.prepare("SELECT self_locked_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ self_locked_at: string | null }>();
    return progress?.self_locked_at ? json({ locked: true }) : fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
  }
  if (request.method === "POST" && url.pathname === "/api/guest/lbr/me/phase") {
    const data = await readBody(request, phaseSchema);
    if (!data) return fail("Choose a valid activity step.", 400);
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const progress = await db.prepare("SELECT self_locked_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ self_locked_at: string | null }>();
    if (!progress?.self_locked_at) return fail("Complete and lock your Self ratings first.", 409, "SELF_NOT_LOCKED");
    const leftFeedback = data.phase !== "FEEDBACK_COLLECTION";
    await db.prepare(`UPDATE lbr_progress SET current_phase = ?,
      feedback_phase_left_at = CASE WHEN ? THEN COALESCE(feedback_phase_left_at,CURRENT_TIMESTAMP) ELSE feedback_phase_left_at END,
      reflection_entered_at = CASE WHEN ? = 'MY_REFLECTION' THEN COALESCE(reflection_entered_at,CURRENT_TIMESTAMP) ELSE reflection_entered_at END,
      actions_entered_at = CASE WHEN ? = 'MY_ACTIONS' THEN COALESCE(actions_entered_at,CURRENT_TIMESTAMP) ELSE actions_entered_at END,
      revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE activity_id = ? AND participant_id = ?`)
      .bind(data.phase, leftFeedback ? 1 : 0, data.phase, data.phase, participant.activity_id, participant.id).run();
    return json({ phase: data.phase });
  }
  if (request.method === "POST" && url.pathname === "/api/guest/lbr/me/peer-rounds") {
    const data = await readBody(request, roundCreateSchema);
    if (!data) return fail("Could not start a peer rating. Try again.", 400);
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const progress = await db.prepare("SELECT self_locked_at FROM lbr_progress WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ self_locked_at: string | null }>();
    if (!progress?.self_locked_at) return fail("Lock your Self ratings before asking for feedback.", 409, "SELF_NOT_LOCKED");
    const roundId = newId();
    await db.prepare(`INSERT INTO lbr_peer_rounds (id,activity_id,participant_id,client_key)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')
      ON CONFLICT(activity_id,participant_id,client_key) DO NOTHING`)
      .bind(roundId, participant.activity_id, participant.id, data.clientKey, participant.activity_id).run();
    const round = await db.prepare("SELECT id,status FROM lbr_peer_rounds WHERE activity_id = ? AND participant_id = ? AND client_key = ?")
      .bind(participant.activity_id, participant.id, data.clientKey).first<{ id: string; status: string }>();
    return round ? json({ roundId: round.id, status: round.status }) : fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
  }
  const formMatch = url.pathname.match(/^\/api\/guest\/lbr\/peer-rounds\/([0-9a-f-]+)\/form$/i);
  if (request.method === "GET" && formMatch) {
    const round = await db.prepare("SELECT id,status FROM lbr_peer_rounds WHERE id = ? AND activity_id = ? AND participant_id = ?")
      .bind(formMatch[1], participant.activity_id, participant.id).first<{ id: string; status: string }>();
    if (!round) return fail("Peer rating form not found.", 404);
    const activity = await getLbrActivity(db, participant.activity_id);
    if (!activity) return fail("Activity not found.", 404);
    const behaviors = (JSON.parse(activity.behaviors_json) as LbrBehaviorCopy[]).map(({ key, number, name, shortName, description }) => ({ key, number, name, shortName, description }));
    return json({ roundId: round.id, status: round.status, behaviors, scale: LBR_SCALE, naLabel: LBR_NA_LABEL });
  }
  const submitMatch = url.pathname.match(/^\/api\/guest\/lbr\/peer-rounds\/([0-9a-f-]+)\/submit$/i);
  if (request.method === "POST" && submitMatch) {
    const data = await readBody(request, roundSubmitSchema);
    if (!data) return fail("Choose a valid rating or N/A for all six behaviors.", 400);
    const answers = data.answers;
    const keys = Object.keys(answers);
    if (keys.length !== LEARNING_BEHAVIORS.length || LEARNING_BEHAVIORS.some(({ key }) => !Object.hasOwn(answers, key) || !isLbrRating(answers[key])) || keys.some((key) => !LEARNING_BEHAVIORS.some((behavior) => behavior.key === key))) {
      return fail("Choose a valid rating or N/A for all six behaviors.", 400);
    }
    const roundId = submitMatch[1]!;
    const round = await db.prepare("SELECT id,status,payload_hash FROM lbr_peer_rounds WHERE id = ? AND activity_id = ? AND participant_id = ?")
      .bind(roundId, participant.activity_id, participant.id).first<{ id: string; status: string; payload_hash: string | null }>();
    if (!round) return fail("Peer rating form not found.", 404);
    const ordered = Object.fromEntries(LEARNING_BEHAVIORS.map(({ key }) => [key, answers[key]]));
    const payloadHash = await sha256(JSON.stringify(ordered));
    if (round.status === "SUBMITTED") return round.payload_hash === payloadHash ? json({ submitted: true, roundId, notePath: `/participate/${participant.activity_id}/lbr/note/${roundId}` }) : fail("This peer rating was already submitted with different answers.", 409, "ROUND_ALREADY_SUBMITTED");
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const statements: D1PreparedStatement[] = [];
    for (const behavior of LEARNING_BEHAVIORS) {
      const mapped = mapRating(answers[behavior.key] as number | "NA");
      statements.push(db.prepare(`INSERT INTO lbr_peer_answers (round_id,behavior_key,rating,is_na)
        SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM lbr_peer_rounds r JOIN lbr_progress p ON p.activity_id = r.activity_id AND p.participant_id = r.participant_id
          JOIN activities a ON a.id = r.activity_id WHERE r.id = ? AND r.status = 'DRAFT' AND a.state = 'open' AND p.self_locked_at IS NOT NULL)`)
        .bind(roundId, behavior.key, mapped.rating, mapped.is_na, roundId));
    }
    statements.push(db.prepare(`UPDATE lbr_peer_rounds SET status = 'SUBMITTED', payload_hash = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'DRAFT' AND (SELECT COUNT(*) FROM lbr_peer_answers WHERE round_id = ?) = 6
      AND EXISTS (SELECT 1 FROM lbr_progress p JOIN activities a ON a.id = p.activity_id WHERE p.activity_id = lbr_peer_rounds.activity_id
        AND p.participant_id = lbr_peer_rounds.participant_id AND p.self_locked_at IS NOT NULL AND a.state = 'open')`)
      .bind(payloadHash, roundId, roundId));
    statements.push(db.prepare(`INSERT INTO lbr_quick_notes (round_id,note_text) SELECT id,'' FROM lbr_peer_rounds WHERE id = ? AND status = 'SUBMITTED'
      ON CONFLICT(round_id) DO NOTHING`).bind(roundId));
    await db.batch(statements);
    const result = await db.prepare("SELECT status,payload_hash FROM lbr_peer_rounds WHERE id = ? AND activity_id = ? AND participant_id = ?")
      .bind(roundId, participant.activity_id, participant.id).first<{ status: string; payload_hash: string | null }>();
    if (result?.status === "SUBMITTED") return result.payload_hash === payloadHash
      ? json({ submitted: true, roundId, notePath: `/participate/${participant.activity_id}/lbr/note/${roundId}` })
      : fail("This peer rating was already submitted with different answers.", 409, "ROUND_ALREADY_SUBMITTED");
    return fail("This activity is closed or the peer rating could not be saved. Your choices remain on this device.", 409, "WRITE_REJECTED");
  }
  const noteMatch = url.pathname.match(/^\/api\/guest\/lbr\/me\/peer-rounds\/([0-9a-f-]+)\/note$/i);
  if (request.method === "PUT" && noteMatch) {
    const data = await readBody(request, noteSchema);
    if (!data) return fail("Quick Notes must be 2,000 characters or fewer.", 400);
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const result = await db.prepare(`UPDATE lbr_quick_notes SET note_text = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE round_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM lbr_peer_rounds r JOIN activities a ON a.id = r.activity_id
        WHERE r.id = lbr_quick_notes.round_id AND r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED' AND a.state = 'open')`)
      .bind(data.text, noteMatch[1], data.revision, participant.activity_id, participant.id).run();
    if (Number(result.meta.changes ?? 0) === 1) return json({ saved: true, revision: data.revision + 1 });
    const existing = await db.prepare(`SELECT n.note_text,n.revision,a.state FROM lbr_quick_notes n JOIN lbr_peer_rounds r ON r.id = n.round_id JOIN activities a ON a.id = r.activity_id
      WHERE n.round_id = ? AND r.activity_id = ? AND r.participant_id = ? AND r.status = 'SUBMITTED'`).bind(noteMatch[1], participant.activity_id, participant.id).first<{ note_text: string; revision: number; state: string }>();
    if (!existing) return fail("Quick Note not found.", 404);
    if (existing.state !== "open") return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    if (existing.note_text === data.text) return json({ saved: true, revision: existing.revision });
    if (existing.revision !== data.revision) return fail("This note changed in another tab. Reload before editing it again.", 409, "REVISION_CONFLICT");
    return json({ saved: true, revision: data.revision });
  }
  if (request.method === "PATCH" && ["/api/guest/lbr/me/reflection", "/api/guest/lbr/me/actions"].includes(url.pathname)) {
    const data = await readBody(request, textSchema);
    if (!data) return fail("The text is too long.", 400);
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const field = url.pathname.endsWith("/reflection") ? "reflection_text" : "actions_text";
    const columnDate = field === "reflection_text" ? "reflection_entered_at" : "actions_entered_at";
    const limit = field === "reflection_text" ? 4000 : 2000;
    if (data.text.length > limit) return fail(`Text must be ${limit} characters or fewer.`, 400);
    const result = await db.prepare(`UPDATE lbr_progress SET ${field} = ?, ${columnDate} = COALESCE(${columnDate},CURRENT_TIMESTAMP), revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND participant_id = ? AND revision = ? AND self_locked_at IS NOT NULL AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(data.text, participant.activity_id, participant.id, data.revision, participant.activity_id).run();
    if (Number(result.meta.changes ?? 0) === 1) return json({ saved: true, revision: data.revision + 1 });
    const current = await db.prepare(`SELECT ${field} AS text,revision FROM lbr_progress WHERE activity_id = ? AND participant_id = ?`)
      .bind(participant.activity_id, participant.id).first<{ text: string; revision: number }>();
    if (!current) return fail("Activity progress not found.", 404);
    if (current.revision !== data.revision) return fail("Your text changed in another tab. Reload before editing it again.", 409, "REVISION_CONFLICT");
    return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
  }
  if (request.method === "POST" && url.pathname === "/api/guest/lbr/me/complete") {
    if (!await participantIsOpen(db, participant.activity_id)) return fail("This activity is closed and read-only.", 409, "ACTIVITY_CLOSED");
    const result = await db.prepare(`UPDATE lbr_progress SET current_phase = 'COMPLETED', ever_completed_at = COALESCE(ever_completed_at,CURRENT_TIMESTAMP),
      actions_entered_at = COALESCE(actions_entered_at,CURRENT_TIMESTAMP), revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND participant_id = ? AND self_locked_at IS NOT NULL AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(participant.activity_id, participant.id, participant.activity_id).run();
    return Number(result.meta.changes ?? 0) ? json({ completed: true }) : fail("Complete the Self phase before finishing this activity.", 409, "SELF_NOT_LOCKED");
  }
  if (request.method === "GET" && url.pathname === "/api/guest/lbr/me/results") {
    const state = await ownState(db, participant);
    if (!state) return fail("Activity not found.", 404);
    const rounds = state.peerRounds.map((round) => Object.fromEntries(round.answers.map((answer) => [answer.behaviorKey, answer.rating])) as Record<BehaviorKey, Exclude<LbrRating, null>>);
    const peer = summarizePeerRounds(rounds);
    const self = Object.fromEntries(LEARNING_BEHAVIORS.map((behavior) => [behavior.key, state.selfAnswers.find((answer) => answer.behaviorKey === behavior.key)?.rating ?? null]));
    return json({ behaviors: LEARNING_BEHAVIORS.map(({ key, name }) => ({ key, name, self: self[key], peer: peer[key] })), peerSubmissionCount: state.peerSubmissionCount });
  }
  return fail("Participant API route not found.", 404);
}

export async function learningBehaviorsPresenterRoute(request: Request, env: LearningBehaviorsEnv, token: string | null): Promise<Response | null> {
  if (request.method !== "GET" || !token) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  const tokenHash = await sha256(token);
  const activity = await db.prepare("SELECT id,title,state FROM activities WHERE presenter_token_hash = ? AND tool_id = ?")
    .bind(tokenHash, LBR_TOOL_ID).first<{ id: string; title: string; state: string }>();
  if (!activity) return null;
  const stats = summarizeGroupSelf((await db.prepare(`SELECT p.participant_id,a.behavior_key,a.rating,a.is_na FROM lbr_progress p
    LEFT JOIN lbr_self_answers a ON a.activity_id = p.activity_id AND a.participant_id = p.participant_id
    WHERE p.activity_id = ? AND p.self_locked_at IS NOT NULL`).bind(activity.id).all<{ participant_id: string; behavior_key: string | null; rating: number | null; is_na: number | null }>()).results.reduce((owners, row) => {
      let owner = owners.find((item) => item.id === row.participant_id);
      if (!owner) { owner = { id: row.participant_id, answers: {} as Partial<Record<BehaviorKey, LbrRating>> }; owners.push(owner); }
      if (row.behavior_key) owner.answers[row.behavior_key as BehaviorKey] = row.is_na ? "NA" : row.rating;
      return owners;
    }, [] as Array<{ id: string; answers: Partial<Record<BehaviorKey, LbrRating>> }>).map((owner) => ({ locked: true, answers: owner.answers })));
  return json({ kind: LBR_TOOL_ID, title: activity.title, state: activity.state, lockedSelfCount: stats.lockedCount,
    behaviors: LEARNING_BEHAVIORS.map(({ key, name, shortName }) => ({ key, name, shortName, mean: stats.behaviors[key].mean, validN: stats.behaviors[key].validN })) });
}
