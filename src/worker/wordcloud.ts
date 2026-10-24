import { z } from "zod";
import {
  aggregateWordCloud, mergeWordCloudGroups, restoreWordCloudMerge, validateWordSubmission,
  wordCloudCsv, type WordCloudGroup, type WordCloudTerm,
} from "../domain/wordcloud";

interface WordCloudEnv { DB?: D1Database; SESSION_SECRET?: string }
export type WordCloudParticipant = { id: string; activity_id: string; team_id: string | null; token_hash: string };
type Phase = "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";

type CloudConfig = {
  activity_id: string; session_id: string | null; title: string; state: string; join_pin: string | null; activity_access_slug: string;
  prompt: string; max_words: number; phase: "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";
  visibility: "HIDDEN" | "LIVE_REVEAL"; started_once: number; revision: number;
  active_team_filter: string | null; presentation_mode: "LIVE_WORD_CLOUD" | "CLOSE_AND_REVEAL";
  presenter_revealed: number; presenter_hidden_override: number; presenter_team_filter: string | null;
  presentation_revision: number; access_slug: string; archived_at: string | null; session_name: string | null;
};

const WordCloudInput = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(200),
  maxWords: z.number().int().min(1).max(10).default(3),
  presentationMode: z.enum(["LIVE_WORD_CLOUD", "CLOSE_AND_REVEAL"]).default("LIVE_WORD_CLOUD"),
  sessionId: z.string().uuid().nullable().optional(),
  teamNames: z.array(z.string().trim().min(1).max(50)).max(12).default([]),
  saveAsDraft: z.boolean().default(false),
});
const WordCloudEditInput = WordCloudInput.omit({ saveAsDraft: true }).extend({ sessionId: z.string().uuid().nullable(), expectedRevision: z.number().int().min(0) });
const TransitionInput = z.object({ action: z.enum(["PUBLISH", "OPEN", "CLOSE", "REOPEN", "FINALIZE_ARCHIVE", "HIDE_PRESENTER", "LIVE_REVEAL", "HIDE_RESULTS", "SHOW_LIVE", "REVEAL_RESULTS"]), expectedRevision: z.number().int().min(0) });
const FilterInput = z.object({ teamId: z.string().uuid().nullable(), expectedRevision: z.number().int().min(0) });
const ModerateInput = z.object({
  action: z.enum(["HIDE", "RESTORE", "MERGE", "UNMERGE"]),
  groupId: z.string().min(1).optional(), sourceGroupIds: z.array(z.string().min(1)).max(100).optional(),
  destinationGroupId: z.string().min(1).optional(), destinationLabel: z.string().trim().min(1).max(80).optional(),
  operationId: z.string().min(1).optional(), expectedRevision: z.number().int().min(0),
});
const WordCloudSubmitInput = z.object({ words: z.array(z.string().max(200)).max(10), idempotencyKey: z.string().uuid() });

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "same-origin");
  responseHeaders.set("X-Frame-Options", "DENY");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}
function fail(message: string, status = 400, code?: string): Response {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}
function dbFor(env: WordCloudEnv): D1Database | null { return env.DB ?? null; }
function newId(): string { return crypto.randomUUID(); }
function randomToken(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function receiptHash(secret: string, activityId: string, participantId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const value = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${activityId}:${participantId}`));
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 32_768) return null;
  try { const result = schema.safeParse(await request.json()); return result.success ? result.data : null; }
  catch { return null; }
}
async function configById(db: D1Database, activityId: string): Promise<CloudConfig | null> {
  return db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin,a.access_slug AS activity_access_slug,
      s.name AS session_name, w.prompt, w.max_words, w.phase, w.visibility, w.started_once,
      w.revision, w.active_team_filter, w.presentation_mode, w.presenter_revealed,
      w.presenter_hidden_override, w.presenter_team_filter, w.presentation_revision,
      w.access_slug, w.archived_at
    FROM activities a JOIN wordcloud_configs w ON w.activity_id = a.id
    LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id = ? AND a.tool_id = 'wordcloud' AND a.deleted_at IS NULL`)
    .bind(activityId).first<CloudConfig>();
}
async function teamsFor(db: D1Database, activityId: string) {
  const result = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at, id").bind(activityId)
    .all<{ id: string; name: string }>();
  return result.results;
}
async function aggregateForActivity(db: D1Database, activityId: string, teamId: string | null) {
  const [submissionRows, responseTerms, termRows, groupRows, membershipRows] = await Promise.all([
    db.prepare("SELECT submission_id, team_id_snapshot FROM wordcloud_anonymous_submissions WHERE activity_id = ? ORDER BY submitted_at, submission_id")
      .bind(activityId).all<{ submission_id: string; team_id_snapshot: string | null }>(),
    db.prepare(`SELECT rt.submission_id, rt.term_id FROM wordcloud_response_terms rt
      JOIN wordcloud_anonymous_submissions s ON s.submission_id = rt.submission_id WHERE s.activity_id = ?`)
      .bind(activityId).all<{ submission_id: string; term_id: string }>(),
    db.prepare("SELECT term_id, canonical_label, normalized_key FROM wordcloud_terms WHERE activity_id = ?")
      .bind(activityId).all<{ term_id: string; canonical_label: string; normalized_key: string }>(),
    db.prepare("SELECT group_id, label, hidden FROM wordcloud_display_groups WHERE activity_id = ?")
      .bind(activityId).all<{ group_id: string; label: string; hidden: number }>(),
    db.prepare(`SELECT gm.term_id, gm.group_id FROM wordcloud_group_memberships gm
      JOIN wordcloud_terms t ON t.term_id = gm.term_id WHERE t.activity_id = ?`).bind(activityId)
      .all<{ term_id: string; group_id: string }>(),
  ]);
  const termsBySubmission = new Map<string, string[]>();
  for (const row of responseTerms.results) termsBySubmission.set(row.submission_id, [...(termsBySubmission.get(row.submission_id) ?? []), row.term_id]);
  const result = aggregateWordCloud({
    submissions: submissionRows.results.map((row) => ({ id: row.submission_id, teamId: row.team_id_snapshot, termIds: termsBySubmission.get(row.submission_id) ?? [] })),
    terms: termRows.results.map((row): WordCloudTerm => ({ id: row.term_id, label: row.canonical_label, normalizedKey: row.normalized_key })),
    groups: groupRows.results.map((row): WordCloudGroup => ({ id: row.group_id, label: row.label, hidden: Boolean(row.hidden) })),
    membership: Object.fromEntries(membershipRows.results.map((row) => [row.term_id, row.group_id])),
    teamId,
  });
  return { ...result, submissionCount: result.denominator };
}

async function trainerPayload(db: D1Database, config: CloudConfig, requestedTeamId?: string | null) {
  const teams = await teamsFor(db, config.activity_id);
  const teamId = requestedTeamId === undefined ? config.active_team_filter : requestedTeamId;
  if (teamId && !teams.some((team) => team.id === teamId)) throw new Error("INVALID_TEAM");
  const [aggregate, joined] = await Promise.all([
    aggregateForActivity(db, config.activity_id, teamId),
    db.prepare("SELECT COUNT(*) AS count FROM participants WHERE activity_id = ?").bind(config.activity_id).first<{ count: number }>(),
  ]);
  const mergeOps = await db.prepare(`SELECT operation_id, after_state_json, created_at FROM wordcloud_moderation_operations
    WHERE activity_id = ? AND op_type = 'MERGE' AND reversed_by IS NULL ORDER BY created_at DESC`)
    .bind(config.activity_id).all<{ operation_id: string; after_state_json: string; created_at: string }>();
  const mergeHistory = mergeOps.results.map((operation) => {
    try {
      const state = JSON.parse(operation.after_state_json) as { groups?: WordCloudGroup[]; destinationGroupId?: string };
      const destination = state.groups?.find((group) => group.id === state.destinationGroupId);
      return { operationId: operation.operation_id, label: destination?.label ?? "Merged words", createdAt: operation.created_at };
    } catch { return { operationId: operation.operation_id, label: "Merged words", createdAt: operation.created_at }; }
  });
  const joinPath = config.join_pin ? `/activity/${config.activity_access_slug}` : null;
  return {
    wordCloud: {
      activityId: config.activity_id, sessionId: config.session_id, sessionName: config.session_name,
      title: config.title, prompt: config.prompt, maxWords: Number(config.max_words), phase: config.phase,
      visibility: config.visibility, startedOnce: Boolean(config.started_once), revision: Number(config.revision),
      presentationMode: config.presentation_mode, presenterRevealed: Boolean(config.presenter_revealed),
      presenterHiddenOverride: Boolean(config.presenter_hidden_override), presenterTeamFilter: config.presenter_team_filter,
      presentationRevision: Number(config.presentation_revision),
      joinPin: config.join_pin, joinPath, archivedAt: config.archived_at,
      activeTeamFilter: teamId ?? null, teamOfOneDisclosure: "Team results can be identifiable by context in very small groups.",
    },
    teams,
    counts: { joined: Number(joined?.count ?? 0), submitted: aggregate.submissionCount },
    aggregate,
    mergeHistory,
  };
}

async function participantProgress(db: D1Database, config: CloudConfig, sessionSecret: string | undefined) {
  const participants = await db.prepare(`
    SELECT p.id, p.display_name, p.joined_at, t.name AS team_name
    FROM participants p
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.activity_id = ? ORDER BY p.joined_at, p.id
  `).bind(config.activity_id).all<{ id: string; display_name: string; joined_at: string; team_name: string | null }>();
  const rows = await Promise.all(participants.results.map(async (participant) => {
    const submitted = sessionSecret ? await db.prepare(`
      SELECT submitted FROM wordcloud_access_receipts WHERE activity_id = ? AND access_proof_hash = ?
    `).bind(config.activity_id, await receiptHash(sessionSecret, config.activity_id, participant.id)).first<{ submitted: number }>() : null;
    return { id: participant.id, displayName: participant.display_name, teamName: participant.team_name,
      joinedAt: participant.joined_at, status: submitted?.submitted ? "Submitted" : "Joined" };
  }));
  return { participants: rows };
}

async function uniquePin(db: D1Database): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    const used = await db.prepare(`SELECT 1 FROM activities WHERE join_pin = ?
      UNION SELECT 1 FROM poll_session_access WHERE join_pin = ? LIMIT 1`).bind(candidate, candidate).first();
    if (!used) return candidate;
  }
  return null;
}

async function createWordCloud(db: D1Database, data: z.infer<typeof WordCloudInput>) {
  const sessionId = data.sessionId ?? null;
  let teamNames = [...new Set(data.teamNames.map((name) => name.trim()).filter(Boolean))];
  if (sessionId) {
    if (!await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first()) return null;
    const existingTeams = await db.prepare(`SELECT DISTINCT t.name FROM teams t JOIN activities a ON a.id = t.activity_id
      WHERE a.session_id = ? ORDER BY t.name`).bind(sessionId).all<{ name: string }>();
    teamNames = existingTeams.results.map((row) => row.name);
  }
  const activityId = newId();
  const phase = data.saveAsDraft ? "DRAFT" : "READY";
  const pin = phase === "READY" ? await uniquePin(db) : null;
  if (phase === "READY" && !pin) return { error: "Could not create a unique activity code. Try again." } as const;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO activities (id, session_id, title, tool_id, state, result_policy, require_name, allow_teams,
        join_pin, instrument_version, scoring_version)
      VALUES (?, ?, ?, 'wordcloud', 'draft', 'confirmation', 1, ?, ?, 'wordcloud-v1.1', 'distinct-frequency-v1')`)
      .bind(activityId, sessionId, data.title.trim(), teamNames.length ? 1 : 0, pin),
    db.prepare(`INSERT INTO wordcloud_configs (activity_id, prompt, max_words, phase, access_slug, presentation_mode)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(activityId, data.prompt.trim(), data.maxWords, phase, randomToken(16), data.presentationMode),
    db.prepare("INSERT INTO presentation_state (activity_id) VALUES (?)").bind(activityId),
  ];
  for (const teamName of teamNames) statements.push(db.prepare("INSERT INTO teams (id, activity_id, name) VALUES (?, ?, ?)").bind(newId(), activityId, teamName));
  await db.batch(statements);
  return { activityId, phase } as const;
}

async function transitionWordCloud(db: D1Database, config: CloudConfig, action: z.infer<typeof TransitionInput>) {
  if (Number(config.revision) !== action.expectedRevision) return { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
  if (action.action === "PUBLISH") {
    if (config.phase !== "DRAFT") return { error: "Only a Draft Word Cloud can be published.", code: "INVALID_STATE" } as const;
    const pin = await uniquePin(db);
    if (!pin) return { error: "Could not create a unique activity code. Try again.", code: "PIN_UNAVAILABLE" } as const;
    const results = await db.batch([
      db.prepare(`UPDATE wordcloud_configs SET phase = 'READY', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND phase = 'DRAFT' AND revision = ?`).bind(config.activity_id, action.expectedRevision),
      db.prepare(`UPDATE activities SET join_pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1`)
        .bind(pin, config.activity_id),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1 ? { ok: true } as const : { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
  }
  if (action.action === "OPEN" || action.action === "REOPEN") {
    if (action.action === "OPEN" && config.phase !== "READY") return { error: "Publish this Word Cloud before opening it.", code: "INVALID_STATE" } as const;
    if (action.action === "REOPEN" && config.phase !== "CLOSED") return { error: "Only a Closed Word Cloud can be reopened.", code: "INVALID_STATE" } as const;
    const from = config.phase;
    const results = await db.batch([
      db.prepare(`UPDATE wordcloud_configs SET phase = 'OPEN', started_once = 1, presenter_revealed = 0,
        presenter_hidden_override = CASE WHEN ? = 'REOPEN' THEN 0 ELSE presenter_hidden_override END,
        visibility = CASE WHEN ? = 'REOPEN' THEN 'HIDDEN' ELSE visibility END,
        presentation_revision = presentation_revision + 1, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND phase = ? AND revision = ?`).bind(action.action, action.action, config.activity_id, from, action.expectedRevision),
      db.prepare(`UPDATE activities SET state = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1`)
        .bind(config.activity_id),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1 ? { ok: true } as const : { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
  }
  if (action.action === "CLOSE") {
    if (config.phase !== "OPEN") return { error: "Only an Open Word Cloud can be closed.", code: "INVALID_STATE" } as const;
    const results = await db.batch([
      db.prepare(`UPDATE wordcloud_configs SET phase = 'CLOSED', revision = revision + 1,
        presentation_revision = presentation_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND phase = 'OPEN' AND revision = ?`).bind(config.activity_id, action.expectedRevision),
      db.prepare(`UPDATE activities SET state = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1`)
        .bind(config.activity_id),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1 ? { ok: true } as const : { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
  }
  if (action.action === "FINALIZE_ARCHIVE") {
    if (config.phase !== "CLOSED") return { error: "Close this Word Cloud before finalizing it.", code: "INVALID_STATE" } as const;
    const results = await db.batch([
      db.prepare(`UPDATE wordcloud_configs SET phase = 'ARCHIVED', archived_at = CURRENT_TIMESTAMP,
        revision = revision + 1, presentation_revision = presentation_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND phase = 'CLOSED' AND revision = ?`)
        .bind(config.activity_id, action.expectedRevision),
      db.prepare(`UPDATE activities SET state = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1`)
        .bind(config.activity_id),
    ]);
    return Number(results[0]?.meta.changes ?? 0) === 1 ? { ok: true } as const : { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
  }
  if (config.phase === "ARCHIVED") return { error: "Archived results are read-only.", code: "ARCHIVED_READ_ONLY" } as const;
  const show = ["LIVE_REVEAL", "SHOW_LIVE", "REVEAL_RESULTS"].includes(action.action);
  if (config.presentation_mode === "CLOSE_AND_REVEAL" && show && config.phase !== "CLOSED") {
    return { error: "Close the activity before revealing Word Cloud results.", code: "REVEAL_REQUIRES_CLOSE" } as const;
  }
  const changed = config.presentation_mode === "LIVE_WORD_CLOUD"
    ? await db.prepare(`UPDATE wordcloud_configs SET presenter_hidden_override = ?,
        visibility = CASE WHEN ? = 1 THEN 'LIVE_REVEAL' ELSE 'HIDDEN' END,
        revision = revision + 1, presentation_revision = presentation_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND revision = ? AND phase != 'ARCHIVED'`)
      .bind(show ? 0 : 1, show ? 1 : 0, config.activity_id, action.expectedRevision).run()
    : await db.prepare(`UPDATE wordcloud_configs SET presenter_revealed = ?,
        visibility = CASE WHEN ? = 1 THEN 'LIVE_REVEAL' ELSE 'HIDDEN' END,
        revision = revision + 1, presentation_revision = presentation_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND revision = ? AND phase != 'ARCHIVED'`)
      .bind(show ? 1 : 0, show ? 1 : 0, config.activity_id, action.expectedRevision).run();
  return Number(changed.meta.changes ?? 0) === 1 ? { ok: true } as const : { error: "This activity changed in another tab. Refresh and try again.", code: "CONFLICT_VERSION" } as const;
}

async function moderateWordCloud(db: D1Database, config: CloudConfig, action: z.infer<typeof ModerateInput>) {
  if (config.phase !== "OPEN" && config.phase !== "CLOSED") return { error: "Moderation is available while the activity is Open or Closed.", code: "INVALID_STATE" } as const;
  if (Number(config.revision) !== action.expectedRevision) return { error: "Results changed in another tab. Refresh before moderating.", code: "CONFLICT_VERSION" } as const;
  const [groupRows, membershipRows] = await Promise.all([
    db.prepare("SELECT group_id, label, hidden FROM wordcloud_display_groups WHERE activity_id = ?").bind(config.activity_id)
      .all<{ group_id: string; label: string; hidden: number }>(),
    db.prepare(`SELECT gm.term_id, gm.group_id FROM wordcloud_group_memberships gm JOIN wordcloud_terms t ON t.term_id = gm.term_id
      WHERE t.activity_id = ?`).bind(config.activity_id).all<{ term_id: string; group_id: string }>(),
  ]);
  const groups: WordCloudGroup[] = groupRows.results.map((row) => ({ id: row.group_id, label: row.label, hidden: Boolean(row.hidden) }));
  const membership = Object.fromEntries(membershipRows.results.map((row) => [row.term_id, row.group_id]));
  const current = { groups, membership };
  const changedRevision = Number(config.revision) + 1;
  const updateRevision = db.prepare(`UPDATE wordcloud_configs SET revision = revision + 1, presentation_revision = presentation_revision + 1,
      updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND revision = ? AND phase IN ('OPEN','CLOSED')`).bind(config.activity_id, config.revision);
  const persistOperation = (opId: string, type: string, before: unknown, after: unknown) => db.prepare(`INSERT INTO wordcloud_moderation_operations
    (operation_id, activity_id, op_type, before_state_json, after_state_json, resulting_revision)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(opId, config.activity_id, type, JSON.stringify(before), JSON.stringify(after), changedRevision);
  let opId = newId();
  let before: unknown;
  let after: unknown;
  const statements: D1PreparedStatement[] = [updateRevision];
  const afterStatements: D1PreparedStatement[] = [];

  if (action.action === "HIDE" || action.action === "RESTORE") {
    const groupId = action.groupId;
    const group = groups.find((row) => row.id === groupId);
    if (!group) return { error: "That word is no longer available. Refresh and try again.", code: "NOT_FOUND" } as const;
    const nextGroups = groups.map((row) => row.id === groupId ? { ...row, hidden: action.action === "HIDE" } : row);
    before = { groups: [group], membership: Object.fromEntries(Object.entries(membership).filter(([, id]) => id === groupId)) };
    after = { groups: nextGroups.filter((row) => row.id === groupId), membership: (before as { membership: Record<string, string> }).membership };
    statements.push(db.prepare("UPDATE wordcloud_display_groups SET hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND activity_id = ?")
      .bind(action.action === "HIDE" ? 1 : 0, groupId, config.activity_id));
  } else if (action.action === "MERGE") {
    if (!action.destinationGroupId || !action.destinationLabel) return { error: "Choose a target word and label.", code: "INVALID_MERGE" } as const;
    const merged = mergeWordCloudGroups(current, action.sourceGroupIds ?? [], action.destinationGroupId, action.destinationLabel);
    if ("error" in merged) return { error: merged.error, code: "INVALID_MERGE" } as const;
    before = merged.before;
    const affectedIds = new Set(merged.before.groups.map((group) => group.id));
    after = { groups: merged.state.groups.filter((group) => affectedIds.has(group.id)), membership: Object.fromEntries(Object.entries(merged.state.membership).filter(([, groupId]) => affectedIds.has(groupId))), destinationGroupId: action.destinationGroupId };
    for (const [termId, groupId] of Object.entries(merged.state.membership)) {
      if (affectedIds.has(current.membership[termId] ?? "") && current.membership[termId] !== groupId) {
        statements.push(db.prepare("UPDATE wordcloud_group_memberships SET group_id = ? WHERE term_id = ?")
          .bind(action.destinationGroupId, termId));
      }
    }
    statements.push(db.prepare("UPDATE wordcloud_display_groups SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND activity_id = ?")
      .bind(action.destinationLabel, action.destinationGroupId, config.activity_id));
  } else {
    if (!action.operationId) return { error: "Choose a previous merge to undo.", code: "INVALID_UNMERGE" } as const;
    const operation = await db.prepare(`SELECT operation_id, after_state_json, resulting_revision, reversed_by FROM wordcloud_moderation_operations
      WHERE activity_id = ? AND operation_id = ? AND op_type = 'MERGE'`).bind(config.activity_id, action.operationId)
      .first<{ operation_id: string; after_state_json: string; resulting_revision: number; reversed_by: string | null }>();
    if (!operation || operation.reversed_by) return { error: "That merge is no longer available to undo.", code: "INVALID_UNMERGE" } as const;
    const newerMerge = await db.prepare(`SELECT 1 AS present FROM wordcloud_moderation_operations
      WHERE activity_id = ? AND op_type = 'MERGE' AND reversed_by IS NULL AND resulting_revision > ? LIMIT 1`)
      .bind(config.activity_id, operation.resulting_revision).first<{ present: number }>();
    if (newerMerge) return { error: "Undo newer merges first so earlier groups can be restored safely.", code: "INVALID_UNMERGE_ORDER" } as const;
    let original: { groups: WordCloudGroup[]; membership: Record<string, string> };
    try { original = JSON.parse((await db.prepare("SELECT before_state_json FROM wordcloud_moderation_operations WHERE operation_id = ?").bind(action.operationId).first<{ before_state_json: string }>())?.before_state_json ?? ""); }
    catch { return { error: "This merge history could not be restored safely.", code: "INVALID_UNMERGE" } as const; }
    let mergeAfter: { destinationGroupId?: string };
    try { mergeAfter = JSON.parse(operation.after_state_json) as { destinationGroupId?: string }; }
    catch { return { error: "This merge history could not be restored safely.", code: "INVALID_UNMERGE" } as const; }
    const destinationGroupId = mergeAfter.destinationGroupId;
    if (!destinationGroupId || !original.groups.some((group) => group.id === destinationGroupId)) return { error: "This merge history is incomplete and cannot be restored safely.", code: "INVALID_UNMERGE" } as const;
    const afterSnapshot = restoreWordCloudMerge(current, original, destinationGroupId);
    const groupIds = new Set(original.groups.map((group) => group.id));
    before = { groups: groups.filter((group) => groupIds.has(group.id)), membership: Object.fromEntries(Object.entries(membership).filter(([, id]) => groupIds.has(id))) };
    after = { groups: afterSnapshot.groups.filter((group) => groupIds.has(group.id)), membership: Object.fromEntries(Object.entries(afterSnapshot.membership).filter(([, id]) => groupIds.has(id))) };
    for (const row of membershipRows.results) if (groupIds.has(row.group_id)) statements.push(db.prepare("DELETE FROM wordcloud_group_memberships WHERE term_id = ?").bind(row.term_id));
    for (const [termId, groupId] of Object.entries(afterSnapshot.membership)) if (groupIds.has(groupId)) statements.push(db.prepare("INSERT OR REPLACE INTO wordcloud_group_memberships (term_id, group_id) VALUES (?, ?)").bind(termId, groupId));
    for (const group of afterSnapshot.groups.filter((row) => groupIds.has(row.id))) statements.push(db.prepare("UPDATE wordcloud_display_groups SET label = ?, hidden = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ? AND activity_id = ?")
      .bind(group.label, group.hidden ? 1 : 0, group.id, config.activity_id));
    opId = newId();
    afterStatements.push(db.prepare("UPDATE wordcloud_moderation_operations SET reversed_by = ? WHERE operation_id = ? AND reversed_by IS NULL")
      .bind(opId, action.operationId));
  }
  statements.push(persistOperation(opId, action.action, before, after), ...afterStatements);
  const results = await db.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) return { error: "Results changed in another tab. Refresh before moderating.", code: "CONFLICT_VERSION" } as const;
  return { ok: true, operationId: opId } as const;
}

export async function wordCloudOwnerRoute(request: Request, env: WordCloudEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/owner/wordclouds")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  if (request.method === "GET" && url.pathname === "/api/owner/wordclouds") {
    const rows = await db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin,
        s.name AS session_name, w.prompt, w.phase, w.visibility, w.max_words, w.revision,
        (SELECT COUNT(*) FROM participants p WHERE p.activity_id = a.id) AS joined_count,
        (SELECT COUNT(*) FROM wordcloud_anonymous_submissions sub WHERE sub.activity_id = a.id) AS submitted_count
      FROM activities a JOIN wordcloud_configs w ON w.activity_id = a.id LEFT JOIN sessions s ON s.id = a.session_id WHERE a.deleted_at IS NULL
      ORDER BY a.updated_at DESC`).all();
    return json({ wordClouds: rows.results });
  }
  if (request.method === "POST" && url.pathname === "/api/owner/wordclouds") {
    const data = await body(request, WordCloudInput);
    if (!data) return fail("Add an activity title, one question and a word limit from 1 to 10.");
    if (data.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(data.sessionId).first()) return fail("Session not found.", 404);
    const created = await createWordCloud(db, data);
    if (!created) return fail("Session not found.", 404);
    if ("error" in created && created.error) return fail(created.error, 503);
    return json({ activityId: created.activityId, phase: created.phase }, 201);
  }
  const match = url.pathname.match(/^\/api\/owner\/wordclouds\/([0-9a-f-]+)(?:\/(transition|moderate|team-filter|presenter-team-filter|progress|duplicate|export))?$/i);
  if (!match) return fail("Word Cloud activity not found.", 404);
  const activityId = match[1]!;
  const action = match[2];
  const config = await configById(db, activityId);
  if (!config) return fail("Word Cloud activity not found.", 404);
  if (request.method === "GET" && !action) {
    try { return json(await trainerPayload(db, config)); }
    catch (reason) { return fail(reason instanceof Error ? reason.message : "Could not load Word Cloud results.", 400, "INVALID_TEAM"); }
  }
  if (request.method === "GET" && action === "progress") {
    return json(await participantProgress(db, config, env.SESSION_SECRET));
  }
  if (request.method === "PATCH" && !action) {
    if (config.started_once || !["DRAFT", "READY"].includes(config.phase)) return fail("This Word Cloud is locked after it has opened.", 409, "CONFIG_LOCKED");
    const data = await body(request, WordCloudEditInput);
    if (!data || (data.sessionId ?? null) !== config.session_id) return fail("Check the activity details. Its Session cannot be changed here.");
    const teamNames = [...new Set(data.teamNames.map((name) => name.trim()).filter(Boolean))];
    if (config.session_id) {
      const rows = await db.prepare(`SELECT DISTINCT t.name FROM teams t JOIN activities a ON a.id = t.activity_id
        WHERE a.session_id = ? ORDER BY t.name`).bind(config.session_id).all<{ name: string }>();
      teamNames.splice(0, teamNames.length, ...rows.results.map((row) => row.name));
    }
    const editNonce = randomToken(16);
    const statements: D1PreparedStatement[] = [
      db.prepare(`UPDATE wordcloud_configs SET prompt = ?, max_words = ?, presentation_mode = ?, edit_nonce = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND phase IN ('DRAFT','READY') AND started_once = 0 AND revision = ?`).bind(data.prompt.trim(), data.maxWords, data.presentationMode, editNonce, activityId, data.expectedRevision),
      db.prepare(`UPDATE activities SET title = ?, allow_teams = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tool_id = 'wordcloud'
        AND EXISTS (SELECT 1 FROM wordcloud_configs WHERE activity_id = ? AND revision = ? AND edit_nonce = ? AND started_once = 0)`)
        .bind(data.title.trim(), teamNames.length ? 1 : 0, activityId, activityId, data.expectedRevision + 1, editNonce),
      db.prepare(`DELETE FROM teams WHERE activity_id = ? AND EXISTS (SELECT 1 FROM wordcloud_configs WHERE activity_id = ? AND revision = ? AND edit_nonce = ? AND started_once = 0)`)
        .bind(activityId, activityId, data.expectedRevision + 1, editNonce),
    ];
    for (const name of teamNames) statements.push(db.prepare(`INSERT INTO teams (id, activity_id, name)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM wordcloud_configs WHERE activity_id = ? AND revision = ? AND edit_nonce = ? AND started_once = 0)`)
      .bind(newId(), activityId, name, activityId, data.expectedRevision + 1, editNonce));
    const result = await db.batch(statements);
    if (Number(result[0]?.meta.changes ?? 0) !== 1) return fail("This activity changed in another tab. Refresh before saving edits.", 409, "CONFLICT_VERSION");
    return json({ updated: true });
  }
  if (request.method === "POST" && action === "transition") {
    const data = await body(request, TransitionInput);
    if (!data) return fail("Refresh this activity and try again.", 400, "INVALID_TRANSITION");
    const result = await transitionWordCloud(db, config, data);
    if ("error" in result && result.error) return fail(result.error, result.code === "CONFLICT_VERSION" ? 409 : 400, result.code);
    const updated = await configById(db, activityId);
    return json(updated ? (await trainerPayload(db, updated)) : { ok: true });
  }
  if (request.method === "POST" && action === "moderate") {
    const data = await body(request, ModerateInput);
    if (!data) return fail("Choose a valid moderation action.", 400, "INVALID_MODERATION");
    let result: Awaited<ReturnType<typeof moderateWordCloud>>;
    try { result = await moderateWordCloud(db, config, data); }
    catch (reason) {
      if (reason instanceof Error && reason.message.includes("CONFLICT_VERSION")) return fail("Results changed in another tab. Refresh before moderating.", 409, "CONFLICT_VERSION");
      throw reason;
    }
    if ("error" in result && result.error) return fail(result.error, result.code === "CONFLICT_VERSION" ? 409 : 400, result.code);
    const updated = await configById(db, activityId);
    return json(updated ? await trainerPayload(db, updated) : { ok: true });
  }
  if (request.method === "POST" && action === "team-filter") {
    const data = await body(request, FilterInput);
    if (!data) return fail("Choose a valid Team filter.");
    if (data.expectedRevision !== Number(config.revision)) return fail("This activity changed in another tab. Refresh and try again.", 409, "CONFLICT_VERSION");
    if (data.teamId && !await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(data.teamId, activityId).first()) return fail("Team not found for this activity.", 404, "INVALID_TEAM");
    const result = await db.prepare(`UPDATE wordcloud_configs SET active_team_filter = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND revision = ? AND phase != 'ARCHIVED'`).bind(data.teamId, activityId, config.revision).run();
    if (Number(result.meta.changes ?? 0) !== 1) return fail("This activity changed in another tab. Refresh and try again.", 409, "CONFLICT_VERSION");
    const updated = await configById(db, activityId);
    return json(updated ? await trainerPayload(db, updated) : { ok: true });
  }
  if (request.method === "POST" && action === "presenter-team-filter") {
    const data = await body(request, FilterInput);
    if (!data) return fail("Choose a valid Presenter Team filter.");
    if (data.expectedRevision !== Number(config.revision)) return fail("This activity changed in another tab. Refresh and try again.", 409, "CONFLICT_VERSION");
    if (data.teamId && !await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(data.teamId, activityId).first()) return fail("Team not found for this activity.", 404, "INVALID_TEAM");
    const result = await db.prepare(`UPDATE wordcloud_configs SET presenter_team_filter = ?,
        revision = revision + 1, presentation_revision = presentation_revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND revision = ? AND phase != 'ARCHIVED'`).bind(data.teamId, activityId, config.revision).run();
    if (Number(result.meta.changes ?? 0) !== 1) return fail("This activity changed in another tab. Refresh and try again.", 409, "CONFLICT_VERSION");
    const updated = await configById(db, activityId);
    return json(updated ? await trainerPayload(db, updated) : { ok: true });
  }
  if (request.method === "POST" && action === "duplicate") {
    const teamNames = (await teamsFor(db, activityId)).map((team) => team.name);
    const duplicate = await createWordCloud(db, { title: `${config.title} copy`, prompt: config.prompt, maxWords: Number(config.max_words), presentationMode: config.presentation_mode, sessionId: config.session_id, teamNames, saveAsDraft: true });
    if (!duplicate || "error" in duplicate) return fail("Could not duplicate this Word Cloud.", 400);
    return json({ activityId: duplicate.activityId }, 201);
  }
  if (request.method === "DELETE" && !action) {
    if (config.phase === "OPEN") return fail("Close this Word Cloud before deleting it.", 409, "OPEN_ACTIVITY_CANNOT_DELETE");
    const result = await db.prepare(`DELETE FROM activities WHERE id = ? AND tool_id = 'wordcloud'
      AND EXISTS (SELECT 1 FROM wordcloud_configs WHERE activity_id = ? AND phase != 'OPEN')`).bind(activityId, activityId).run();
    if (Number(result.meta.changes ?? 0) !== 1) return fail("This activity is Open. Close it before deleting.", 409, "OPEN_ACTIVITY_CANNOT_DELETE");
    return json({ deleted: true });
  }
  if (request.method === "GET" && action === "export") {
    const format = url.searchParams.get("format");
    if (format !== "csv") return fail("Only the aggregate CSV download is handled by the server.", 400, "UNSUPPORTED_EXPORT");
    const teamId = url.searchParams.get("teamId") || null;
    const payload = await trainerPayload(db, config, teamId);
    const allTerms = [...payload.aggregate.visibleTerms, ...payload.aggregate.hiddenTerms];
    const teamName = teamId ? payload.teams.find((team) => team.id === teamId)?.name ?? "" : "All teams";
    const csv = wordCloudCsv(
      ["activity_title", "scope", "team", "display_label", "member_labels", "unique_submitters", "submitted_denominator", "percentage", "visibility", "merged", "archived_at", "exported_at"],
      allTerms.map((term) => [config.title, config.session_id ? "SESSION" : "STANDALONE", teamName, term.label,
        [term.label, ...term.mergedSourceLabels].join(" | "), term.frequency, payload.aggregate.denominator,
        term.percentage ?? "", term.visible ? "visible" : "hidden", term.mergedSourceLabels.length ? "yes" : "no",
        config.archived_at ?? "", new Date().toISOString()]),
    );
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="wordcloud-${activityId.slice(0, 8)}-${date}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return fail("Word Cloud route not found.", 404);
}

export async function wordCloudParticipantRoute(request: Request, env: WordCloudEnv, url: URL, participant: WordCloudParticipant): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/guest/wordcloud/")) return null;
  const db = dbFor(env);
  if (!db || !env.SESSION_SECRET) return fail("Word Cloud participation is unavailable.", 503);
  const config = await configById(db, participant.activity_id);
  if (!config) return fail("This Word Cloud is no longer available.", 404, "ACTIVITY_NOT_FOUND");
  const proof = await receiptHash(env.SESSION_SECRET, config.activity_id, participant.id);
  if (request.method === "GET" && url.pathname === "/api/guest/wordcloud/state") {
    await db.prepare(`INSERT OR IGNORE INTO wordcloud_access_receipts (activity_id, access_proof_hash) VALUES (?, ?)`)
      .bind(config.activity_id, proof).run();
    const receipt = await db.prepare("SELECT submitted FROM wordcloud_access_receipts WHERE activity_id = ? AND access_proof_hash = ?")
      .bind(config.activity_id, proof).first<{ submitted: number }>();
    const alreadySubmitted = Boolean(receipt?.submitted);
    const state = alreadySubmitted ? "ALREADY_SUBMITTED" : config.phase === "READY" || config.phase === "DRAFT" ? "WAITING"
      : config.phase === "OPEN" ? "OPEN" : config.phase === "CLOSED" ? "CLOSED" : "ARCHIVED";
    const team = participant.team_id ? await db.prepare("SELECT name FROM teams WHERE id = ? AND activity_id = ?").bind(participant.team_id, config.activity_id).first<{ name: string }>() : null;
    return json({ state, alreadySubmitted, title: config.title, prompt: config.prompt, maxWords: Number(config.max_words), teamName: team?.name ?? null });
  }
  if (request.method === "POST" && url.pathname === "/api/guest/wordcloud/submit") {
    if (Number(request.headers.get("Content-Length") ?? 0) > 8_192) return fail("Your response is too large.", 413, "PAYLOAD_TOO_LARGE");
    if (config.phase === "ARCHIVED") return fail("This activity is archived and cannot accept responses.", 409, "ACTIVITY_ARCHIVED");
    if (config.phase !== "OPEN" || config.state !== "open") return fail(config.phase === "CLOSED" ? "This activity is closed." : "This activity is not open yet.", 409, config.phase === "CLOSED" ? "ACTIVITY_CLOSED" : "ACTIVITY_NOT_OPEN");
    const data = await body(request, WordCloudSubmitInput);
    if (!data) return fail("Check your words and try again.", 400, "INVALID_SUBMISSION");
    const validation = validateWordSubmission(data.words, Number(config.max_words));
    if (!validation.ok) return fail(validation.message, 422, validation.code);
    await db.prepare("INSERT OR IGNORE INTO wordcloud_access_receipts (activity_id, access_proof_hash) VALUES (?, ?)")
      .bind(config.activity_id, proof).run();
    const already = await db.prepare("SELECT submitted FROM wordcloud_access_receipts WHERE activity_id = ? AND access_proof_hash = ?")
      .bind(config.activity_id, proof).first<{ submitted: number }>();
    if (already?.submitted) return json({ status: "ALREADY_SUBMITTED" });
    if (participant.team_id && !await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(participant.team_id, config.activity_id).first()) {
      return fail("Your team assignment is no longer valid. Ask your trainer for help.", 409, "INVALID_TEAM");
    }
    const submissionId = newId();
    const statements: D1PreparedStatement[] = [
      db.prepare(`UPDATE wordcloud_access_receipts SET submitted = 1, submitted_at = CURRENT_TIMESTAMP
        WHERE activity_id = ? AND access_proof_hash = ? AND submitted = 0
          AND EXISTS (SELECT 1 FROM wordcloud_configs w JOIN activities a ON a.id = w.activity_id
            WHERE w.activity_id = ? AND w.phase = 'OPEN' AND a.state = 'open')`)
        .bind(config.activity_id, proof, config.activity_id),
      db.prepare(`INSERT INTO wordcloud_anonymous_submissions (submission_id, activity_id, team_id_snapshot, submitted_at)
        SELECT ?, ?, ?, CURRENT_TIMESTAMP WHERE changes() = 1
          AND EXISTS (SELECT 1 FROM wordcloud_configs w JOIN activities a ON a.id = w.activity_id
            WHERE w.activity_id = ? AND w.phase = 'OPEN' AND a.state = 'open')`)
        .bind(submissionId, config.activity_id, participant.team_id, config.activity_id),
    ];
    for (const word of validation.words) {
      const termId = await sha256(`wordcloud-term:${config.activity_id}:${word.key}`);
      const groupId = `group-${termId}`;
      statements.push(db.prepare(`INSERT OR IGNORE INTO wordcloud_terms (term_id, activity_id, normalized_key, canonical_label)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)`)
        .bind(termId, config.activity_id, word.key, word.normalized, submissionId));
      statements.push(db.prepare(`INSERT OR IGNORE INTO wordcloud_display_groups (group_id, activity_id, label)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM wordcloud_terms WHERE term_id = ? AND activity_id = ?)
          AND EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)`)
        .bind(groupId, config.activity_id, word.normalized, termId, config.activity_id, submissionId));
      statements.push(db.prepare(`INSERT OR IGNORE INTO wordcloud_group_memberships (term_id, group_id)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM wordcloud_display_groups WHERE group_id = ? AND activity_id = ?)
          AND EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)`)
        .bind(termId, groupId, groupId, config.activity_id, submissionId));
      statements.push(db.prepare(`INSERT OR IGNORE INTO wordcloud_response_terms (submission_id, term_id, original_text)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)
          AND EXISTS (SELECT 1 FROM wordcloud_terms WHERE term_id = ? AND activity_id = ?)`)
        .bind(submissionId, termId, word.normalized, submissionId, termId, config.activity_id));
    }
    statements.push(db.prepare(`UPDATE wordcloud_configs SET revision = revision + 1,
      presentation_revision = presentation_revision + 1,
      visibility = CASE WHEN presentation_mode = 'LIVE_WORD_CLOUD' AND presenter_hidden_override = 0 THEN 'LIVE_REVEAL' ELSE visibility END,
      updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)`)
      .bind(config.activity_id, submissionId));
    statements.push(db.prepare(`UPDATE activities SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
      AND EXISTS (SELECT 1 FROM wordcloud_anonymous_submissions WHERE submission_id = ?)`)
      .bind(config.activity_id, submissionId));
    const results = await db.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
      const latest = await configById(db, config.activity_id);
      const receipt = await db.prepare("SELECT submitted FROM wordcloud_access_receipts WHERE activity_id = ? AND access_proof_hash = ?")
        .bind(config.activity_id, proof).first<{ submitted: number }>();
      if (receipt?.submitted) return json({ status: "ALREADY_SUBMITTED" });
      return fail(latest?.phase === "ARCHIVED" ? "This activity is archived." : latest?.phase === "CLOSED" ? "This activity is closed." : "This activity is not open yet.", 409,
        latest?.phase === "ARCHIVED" ? "ACTIVITY_ARCHIVED" : latest?.phase === "CLOSED" ? "ACTIVITY_CLOSED" : "ACTIVITY_NOT_OPEN");
    }
    return json({ status: "SUBMITTED" });
  }
  return fail("Word Cloud participant route not found.", 404);
}

export async function wordCloudPresenterRoute(request: Request, env: WordCloudEnv, token: string): Promise<Response | null> {
  const db = dbFor(env);
  if (!db || request.method !== "GET") return null;
  const tokenHash = await sha256(token);
  const activity = await db.prepare(`SELECT a.id AS activity_id, a.title, a.join_pin, a.access_slug AS activity_access_slug,
      s.name AS session_name, w.prompt, w.phase, w.visibility, w.revision, w.presentation_mode,
      w.presenter_revealed, w.presenter_hidden_override, w.presenter_team_filter, w.presentation_revision
    FROM activities a JOIN wordcloud_configs w ON w.activity_id = a.id
    LEFT JOIN sessions s ON s.id = a.session_id
    WHERE a.presenter_token_hash = ? AND a.tool_id = 'wordcloud' AND a.deleted_at IS NULL`).bind(tokenHash)
    .first<{ activity_id: string; title: string; join_pin: string | null; activity_access_slug: string | null; session_name: string | null;
      prompt: string; phase: Phase; visibility: string; revision: number; presentation_mode: "LIVE_WORD_CLOUD" | "CLOSE_AND_REVEAL";
      presenter_revealed: number; presenter_hidden_override: number; presenter_team_filter: string | null; presentation_revision: number }>();
  if (!activity) return null;
  const mode = activity.presentation_mode;
  const aggregate = await aggregateForActivity(db, activity.activity_id, activity.presenter_team_filter);
  const hasCloud = aggregate.cloudTop50.length > 0;
  const hidden = Boolean(activity.presenter_hidden_override);
  const revealed = Boolean(activity.presenter_revealed);
  const view: "JOIN_LOBBY" | "LIVE_CLOUD" | "ACTIVITY_CLOSED" | "FINAL_CLOUD" = mode === "LIVE_WORD_CLOUD"
    ? ["READY", "DRAFT"].includes(activity.phase) ? "JOIN_LOBBY"
      : activity.phase === "OPEN" ? hasCloud && !hidden ? "LIVE_CLOUD" : "JOIN_LOBBY"
        : hasCloud && !hidden ? "FINAL_CLOUD" : "ACTIVITY_CLOSED"
    : ["READY", "OPEN", "DRAFT"].includes(activity.phase) ? "JOIN_LOBBY"
      : revealed && hasCloud ? "FINAL_CLOUD" : "ACTIVITY_CLOSED";
  const base = { kind: "wordcloud", title: activity.title, prompt: activity.prompt, phase: activity.phase,
    mode, view, revision: Number(activity.presentation_revision ?? activity.revision),
    sessionName: activity.session_name, joinPin: activity.join_pin,
    joinPath: activity.activity_access_slug ? `/activity/${activity.activity_access_slug}` : null,
    teamName: activity.presenter_team_filter
      ? (await db.prepare("SELECT name FROM teams WHERE id = ? AND activity_id = ?").bind(activity.presenter_team_filter, activity.activity_id).first<{ name: string }>())?.name ?? "All teams"
      : "All teams" };
  if (view === "JOIN_LOBBY") {
    const joined = await db.prepare("SELECT display_name FROM participants WHERE activity_id = ? ORDER BY joined_at, id")
      .bind(activity.activity_id).all<{ display_name: string }>();
    return json({ ...base, joinedCount: joined.results.length, participants: joined.results.map((row) => row.display_name) });
  }
  if (view === "LIVE_CLOUD" || view === "FINAL_CLOUD") {
    return json({ ...base, cloudTop50: aggregate.cloudTop50.map(({ label, frequency, percentage }) => ({ label, frequency, percentage })) });
  }
  return json({ ...base });
}
