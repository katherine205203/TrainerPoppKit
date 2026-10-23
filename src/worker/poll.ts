import { z } from "zod";
import {
  calculatePollResults,
  validatePollDraft,
  validatePollForOpen,
  validatePollSelection,
  type PollConfigInput,
  type PollOption,
  type PollSelection,
} from "../domain/poll";

interface PollEnv { DB?: D1Database; SESSION_SECRET?: string }
type PollParticipant = { id: string; activity_id: string; team_id: string | null; display_name: string; token_hash: string };

const OptionInput = z.string().trim().max(120);
const PollInput = z.object({
  title: z.string().trim().max(120), question: z.string().trim().max(250),
  questionType: z.enum(["single", "multiple"]), options: z.array(OptionInput).max(10),
  maxSelections: z.number().int().min(1).max(10), allowOther: z.boolean(),
  identityMode: z.enum(["anonymous", "named"]),
  participantResultsMode: z.enum(["presenter_only", "presenter_and_participant"]),
  sessionId: z.string().uuid().nullable().optional(),
});
const PollVoteInput = z.object({
  selections: z.array(z.object({ optionId: z.string().uuid(), otherText: z.string().max(150).optional() })).max(10),
  idempotencyKey: z.string().uuid(),
});

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(JSON.stringify(data), { status, headers });
}
function fail(message: string, status = 400, code?: string): Response {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}
function newId(): string { return crypto.randomUUID(); }
function randomToken(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function pollVoterKey(secret: string, activityId: string, participantId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${activityId}:${participantId}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function rateLimit(request: Request, env: PollEnv, scope: "poll-entry" | "poll-identity" | "poll-vote"): Promise<boolean> {
  const db = dbFor(env);
  if (!db || !env.SESSION_SECRET) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown-client";
  const keyHash = await sha256(`${env.SESSION_SECRET}:${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % 600);
  await db.prepare(`INSERT INTO join_rate_limits (key_hash, window_started_at, attempts) VALUES (?, ?, 1)
    ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN join_rate_limits.window_started_at < excluded.window_started_at THEN 1 ELSE join_rate_limits.attempts + 1 END,
    window_started_at = excluded.window_started_at`).bind(keyHash, window).run();
  const row = await db.prepare("SELECT attempts FROM join_rate_limits WHERE key_hash = ?").bind(keyHash).first<{ attempts: number }>();
  // Workshop attendees commonly share one venue IP, so limits leave room for a 200-person cohort.
  const limit = scope === "poll-entry" ? 500 : scope === "poll-identity" ? 500 : 1_000;
  return Number(row?.attempts ?? 0) <= limit;
}
async function readBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 32_768) return null;
  try { const parsed = schema.safeParse(await request.json()); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
function dbFor(env: PollEnv): D1Database | null { return env.DB ?? null; }
function publicPath(path: string): string { return `/poll/${path}`; }

type PollRow = {
  activity_id: string; session_id: string | null; title: string; question: string; question_type: "single" | "multiple";
  max_selections: number; allow_other: number; identity_mode: "anonymous" | "named";
  participant_results_mode: "presenter_only" | "presenter_and_participant"; reveal_state: "hidden" | "revealed";
  access_slug: string; version: number; reopen_count: number; reopened_at: string | null; state: string;
  join_pin: string | null; session_name: string | null; session_status?: string | null; require_name?: number;
};

async function getPoll(db: D1Database, activityId: string): Promise<PollRow | null> {
  return db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin, a.require_name,
      s.name AS session_name, s.status AS session_status, p.question, p.question_type, p.max_selections,
      p.allow_other, p.identity_mode, p.participant_results_mode, p.reveal_state, p.access_slug,
      p.version, p.reopen_count, p.reopened_at
    FROM activities a JOIN poll_configs p ON p.activity_id = a.id LEFT JOIN sessions s ON s.id = a.session_id
    WHERE a.id = ? AND a.tool_id = 'poll'`).bind(activityId).first<PollRow>();
}
async function getPollBySlug(db: D1Database, slug: string): Promise<PollRow | null> {
  return db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin, a.require_name,
      s.name AS session_name, s.status AS session_status, p.question, p.question_type, p.max_selections,
      p.allow_other, p.identity_mode, p.participant_results_mode, p.reveal_state, p.access_slug,
      p.version, p.reopen_count, p.reopened_at
    FROM poll_configs p JOIN activities a ON a.id = p.activity_id LEFT JOIN sessions s ON s.id = a.session_id
    WHERE p.access_slug = ?`).bind(slug).first<PollRow>();
}
async function pollOptions(db: D1Database, activityId: string): Promise<PollOption[]> {
  const rows = await db.prepare("SELECT id, label, sort_order, is_other FROM poll_options WHERE activity_id = ? ORDER BY sort_order")
    .bind(activityId).all<{ id: string; label: string; sort_order: number; is_other: number }>();
  return rows.results.map((row) => ({ id: row.id, label: row.label, sortOrder: Number(row.sort_order), isOther: Boolean(row.is_other) }));
}
function toInput(poll: PollRow, options: PollOption[]): PollConfigInput {
  return { title: poll.title, question: poll.question, questionType: poll.question_type,
    options: options.filter((option) => !option.isOther).map((option) => option.label), maxSelections: Number(poll.max_selections),
    allowOther: Boolean(poll.allow_other), identityMode: poll.identity_mode, participantResultsMode: poll.participant_results_mode };
}
async function getAggregate(db: D1Database, activityId: string) {
  const options = await pollOptions(db, activityId);
  const responseRows = await db.prepare("SELECT id FROM poll_responses WHERE activity_id = ? ORDER BY submitted_at, id")
    .bind(activityId).all<{ id: string }>();
  const selections = await db.prepare(`SELECT po.response_id, po.option_id FROM poll_response_options po
    JOIN poll_responses pr ON pr.id = po.response_id WHERE pr.activity_id = ?`).bind(activityId).all<{ response_id: string; option_id: string }>();
  const selectedByResponse = new Map<string, string[]>();
  for (const row of selections.results) selectedByResponse.set(row.response_id, [...(selectedByResponse.get(row.response_id) ?? []), row.option_id]);
  const results = calculatePollResults(options, responseRows.results.map((row) => ({ selections: selectedByResponse.get(row.id) ?? [] })));
  return { respondentCount: responseRows.results.length, results, options };
}
async function sessionPollNames(db: D1Database, sessionId: string) {
  const result = await db.prepare(`SELECT DISTINCT t.name FROM activities a JOIN teams t ON t.activity_id = a.id
    WHERE a.session_id = ? ORDER BY t.name`).bind(sessionId).all<{ name: string }>();
  return result.results.map((row) => row.name);
}
async function createSessionAccess(db: D1Database, sessionId: string) {
  const existing = await db.prepare("SELECT access_slug, join_pin FROM poll_session_access WHERE session_id = ?")
    .bind(sessionId).first<{ access_slug: string; join_pin: string }>();
  if (existing) return existing;
  let joinPin = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    const used = await db.prepare("SELECT 1 FROM activities WHERE join_pin = ? UNION SELECT 1 FROM poll_session_access WHERE join_pin = ? LIMIT 1")
      .bind(candidate, candidate).first();
    if (!used) { joinPin = candidate; break; }
  }
  if (!joinPin) throw new Error("Could not create a unique Session PIN.");
  const access = { access_slug: randomToken(16), join_pin: joinPin };
  await db.prepare("INSERT INTO poll_session_access (session_id, access_slug, join_pin) VALUES (?, ?, ?)")
    .bind(sessionId, access.access_slug, access.join_pin).run();
  return access;
}
async function audit(db: D1Database, activityId: string, action: string, previous: string | null, next: string | null, version: number) {
  await db.prepare(`INSERT INTO poll_control_audit (id, activity_id, action, previous_state, next_state, version)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(newId(), activityId, action, previous, next, version).run();
}

async function trainerPollPayload(db: D1Database, poll: PollRow) {
  const options = await pollOptions(db, poll.activity_id);
  const aggregate = await getAggregate(db, poll.activity_id);
  const counts = await db.prepare(`SELECT COUNT(*) AS joined,
      SUM(CASE WHEN pp.has_submitted = 1 THEN 1 ELSE 0 END) AS submitted
    FROM participants p LEFT JOIN poll_participations pp ON pp.participant_id = p.id AND pp.activity_id = p.activity_id
    WHERE p.activity_id = ?`).bind(poll.activity_id).first<{ joined: number; submitted: number | null }>();
  let participants: Array<{ displayName: string; status: string; teamName: string | null }> = [];
  if (poll.session_id) {
    const rows = await db.prepare(`SELECT p.display_name, pp.has_submitted, t.name AS team_name
      FROM participants p LEFT JOIN poll_participations pp ON pp.participant_id = p.id AND pp.activity_id = p.activity_id
      LEFT JOIN teams t ON t.id = p.team_id WHERE p.activity_id = ? ORDER BY p.joined_at`)
      .bind(poll.activity_id).all<{ display_name: string; has_submitted: number | null; team_name: string | null }>();
    participants = rows.results.map((row) => ({ displayName: row.display_name, status: row.has_submitted ? "submitted" : "joined", teamName: row.team_name }));
  } else if (poll.identity_mode === "named") {
    const rows = await db.prepare(`SELECT p.display_name, pp.has_submitted, t.name AS team_name
      FROM participants p LEFT JOIN poll_participations pp ON pp.participant_id = p.id AND pp.activity_id = p.activity_id
      LEFT JOIN teams t ON t.id = p.team_id WHERE p.activity_id = ? ORDER BY p.joined_at`)
      .bind(poll.activity_id).all<{ display_name: string; has_submitted: number | null; team_name: string | null }>();
    participants = rows.results.map((row) => ({ displayName: row.display_name, status: row.has_submitted ? "submitted" : "joined", teamName: row.team_name }));
  }
  let otherResponses: string[] = [];
  const other = options.find((option) => option.isOther);
  if (other) {
    const rows = await db.prepare(`SELECT pr.other_text FROM poll_responses pr JOIN poll_response_options pro ON pro.response_id = pr.id
      WHERE pr.activity_id = ? AND pro.option_id = ? AND pr.other_text IS NOT NULL ORDER BY pr.submitted_at`)
      .bind(poll.activity_id, other.id).all<{ other_text: string }>();
    otherResponses = rows.results.map((row) => row.other_text);
  }
  let namedResponses: Array<{ displayName: string; teamName: string | null; selections: string[]; otherText: string | null; submittedAt: string; updatedAt: string }> = [];
  if (poll.identity_mode === "named") {
    const rows = await db.prepare(`SELECT pr.id, p.display_name, t.name AS team_name, pr.other_text, pr.submitted_at, pr.updated_at
      FROM poll_responses pr JOIN participants p ON p.id = pr.named_participant_id
      LEFT JOIN teams t ON t.id = p.team_id WHERE pr.activity_id = ? ORDER BY pr.submitted_at`)
      .bind(poll.activity_id).all<{ id: string; display_name: string; team_name: string | null; other_text: string | null; submitted_at: string; updated_at: string }>();
    const selected = await db.prepare(`SELECT pro.response_id, po.label FROM poll_response_options pro JOIN poll_options po ON po.id = pro.option_id
      WHERE po.activity_id = ? ORDER BY po.sort_order`).bind(poll.activity_id).all<{ response_id: string; label: string }>();
    const labels = new Map<string, string[]>();
    for (const row of selected.results) labels.set(row.response_id, [...(labels.get(row.response_id) ?? []), row.label]);
    namedResponses = rows.results.map((row) => ({ displayName: row.display_name, teamName: row.team_name,
      selections: labels.get(row.id) ?? [], otherText: row.other_text, submittedAt: row.submitted_at, updatedAt: row.updated_at }));
  }
  const eligible = poll.session_id ? Number((await db.prepare("SELECT expected_participants FROM sessions WHERE id = ?").bind(poll.session_id).first<{ expected_participants: number }>())?.expected_participants ?? 0) : 0;
  return {
    poll: { activityId: poll.activity_id, sessionId: poll.session_id, sessionName: poll.session_name, sessionStatus: poll.session_status,
      title: poll.title, question: poll.question, questionType: poll.question_type, maxSelections: Number(poll.max_selections),
      allowOther: Boolean(poll.allow_other), identityMode: poll.identity_mode, participantResultsMode: poll.participant_results_mode,
      revealState: poll.reveal_state, state: poll.state, accessSlug: poll.access_slug, joinPin: poll.join_pin,
      version: Number(poll.version), reopenCount: Number(poll.reopen_count), reopenedAt: poll.reopened_at,
      archivedSession: poll.session_status === "completed" },
    options, counts: { joined: Number(counts?.joined ?? 0), submitted: Number(counts?.submitted ?? 0), respondents: aggregate.respondentCount,
      eligible, completionRate: eligible > 0 ? Math.round(Number(counts?.submitted ?? 0) / eligible * 100) : null },
    results: aggregate.results, participants, otherResponses, namedResponses,
  };
}

async function createPoll(db: D1Database, data: z.infer<typeof PollInput>, slug = randomToken(16)) {
  if (data.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(data.sessionId).first()) return null;
  const input = data as PollConfigInput;
  const validation = validatePollDraft(input);
  if (validation.length) return { errors: validation } as const;
  const activityId = newId();
  const sessionId = data.sessionId ?? null;
  const names = sessionId ? await sessionPollNames(db, sessionId) : [];
  const accessSlug = slug;
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO activities
    (id, session_id, title, tool_id, state, result_policy, require_name, allow_teams, instrument_version, scoring_version)
    VALUES (?, ?, ?, 'poll', 'draft', 'trainer_reveal', ?, ?, 'poll-v1', 'poll-v1')`)
    .bind(activityId, sessionId, data.title.trim(), sessionId || data.identityMode === "named" ? 1 : 0, names.length ? 1 : 0),
  db.prepare(`INSERT INTO poll_configs (activity_id, question, question_type, max_selections, allow_other,
    identity_mode, participant_results_mode, access_slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(activityId, data.question.trim(), data.questionType, data.maxSelections, data.allowOther ? 1 : 0,
      data.identityMode, data.participantResultsMode, accessSlug),
  db.prepare("INSERT INTO presentation_state (activity_id) VALUES (?)").bind(activityId)];
  let order = 0;
  for (const label of data.options) {
    statements.push(db.prepare("INSERT INTO poll_options (id, activity_id, label, sort_order, is_other) VALUES (?, ?, ?, ?, 0)")
      .bind(newId(), activityId, label.trim(), order++));
  }
  if (data.allowOther) statements.push(db.prepare("INSERT INTO poll_options (id, activity_id, label, sort_order, is_other) VALUES (?, ?, 'Other', ?, 1)")
    .bind(newId(), activityId, order));
  for (const name of names) statements.push(db.prepare("INSERT INTO teams (id, activity_id, name) VALUES (?, ?, ?)").bind(newId(), activityId, name));
  await db.batch(statements);
  if (sessionId) await createSessionAccess(db, sessionId);
  return { activityId } as const;
}

async function pollOwnerRoute(request: Request, env: PollEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/owner/polls") && !url.pathname.startsWith("/api/owner/poll-sessions/")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  if (request.method === "GET" && url.pathname === "/api/owner/polls") {
    const rows = await db.prepare(`SELECT a.id AS activity_id, a.session_id, a.title, a.state, a.join_pin, s.name AS session_name,
      p.question, p.question_type, p.identity_mode, p.reveal_state, p.access_slug, p.participant_results_mode,
      (SELECT COUNT(*) FROM poll_responses pr WHERE pr.activity_id = a.id) AS respondent_count,
      (SELECT COUNT(*) FROM poll_participations pp WHERE pp.activity_id = a.id AND pp.has_submitted = 1) AS completed_count
      FROM activities a JOIN poll_configs p ON p.activity_id = a.id LEFT JOIN sessions s ON s.id = a.session_id
      ORDER BY a.updated_at DESC`).all();
    return json({ polls: rows.results });
  }
  if (request.method === "POST" && url.pathname === "/api/owner/polls") {
    const data = await readBody(request, PollInput);
    if (!data || !data.title.trim() || !data.question.trim()) return fail("Enter a Poll name and question.", 400);
    const created = await createPoll(db, data);
    if (!created) return fail("Session not found.", 404);
    if ("errors" in created) {
      const errors = created.errors ?? ["Check the Poll settings."];
      return json({ error: errors[0], errors }, 400);
    }
    return json({ activityId: created.activityId }, 201);
  }
  const sessionAccessMatch = url.pathname.match(/^\/api\/owner\/poll-sessions\/([0-9a-f-]+)\/access$/i);
  if (request.method === "GET" && sessionAccessMatch) {
    const sessionId = sessionAccessMatch[1]!;
    if (!await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first()) return fail("Session not found.", 404);
    const access = await createSessionAccess(db, sessionId);
    return json({ ...access, path: `/session/${access.access_slug}` });
  }
  const match = url.pathname.match(/^\/api\/owner\/polls\/([0-9a-f-]+)(?:\/(open|close|reopen|reveal|duplicate|results|export))?$/i);
  if (!match) return fail("Poll route not found.", 404);
  const activityId = match[1]!;
  const action = match[2];
  const poll = await getPoll(db, activityId);
  if (!poll) return fail("Poll not found.", 404);
  if (request.method === "GET" && !action) return json(await trainerPollPayload(db, poll));
  if (request.method === "PATCH" && !action) {
    if (poll.state !== "draft") return fail("Only a Draft Poll can be edited. Duplicate it to change a launched Poll.", 409, "POLL_NOT_DRAFT");
    const data = await readBody(request, PollInput);
    if (!data || (data.sessionId ?? null) !== poll.session_id) return fail("Check the Poll details. Its Session cannot be changed after creation.", 400);
    const errors = validatePollDraft(data as PollConfigInput);
    if (errors.length) return json({ error: errors[0], errors }, 400);
    const statements: D1PreparedStatement[] = [db.prepare(`UPDATE activities SET title = ?, require_name = ?, allow_teams = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'draft'`)
      .bind(data.title.trim(), poll.session_id || data.identityMode === "named" ? 1 : 0, poll.session_id ? 1 : 0, activityId),
    db.prepare(`UPDATE poll_configs SET question = ?, question_type = ?, max_selections = ?, allow_other = ?, identity_mode = ?, participant_results_mode = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE activity_id = ? AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'draft')`)
      .bind(data.question.trim(), data.questionType, data.maxSelections, data.allowOther ? 1 : 0, data.identityMode, data.participantResultsMode, activityId, activityId),
    db.prepare("DELETE FROM poll_options WHERE activity_id = ?").bind(activityId)];
    let order = 0;
    for (const label of data.options) statements.push(db.prepare("INSERT INTO poll_options (id, activity_id, label, sort_order, is_other) VALUES (?, ?, ?, ?, 0)").bind(newId(), activityId, label.trim(), order++));
    if (data.allowOther) statements.push(db.prepare("INSERT INTO poll_options (id, activity_id, label, sort_order, is_other) VALUES (?, ?, 'Other', ?, 1)").bind(newId(), activityId, order));
    await db.batch(statements);
    return json({ updated: true });
  }
  if (request.method === "POST" && action === "open") {
    if (poll.state !== "draft") return fail("Only a Draft Poll can be opened. Use Reopen for a Closed Poll.", 409, "INVALID_STATE");
    const options = await pollOptions(db, activityId);
    const errors = validatePollForOpen(toInput(poll, options));
    if (errors.length) return json({ error: errors[0], errors }, 400);
    let pin = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
      const used = await db.prepare("SELECT 1 FROM activities WHERE join_pin = ? AND id != ? UNION SELECT 1 FROM poll_session_access WHERE join_pin = ? LIMIT 1")
        .bind(candidate, activityId, candidate).first();
      if (!used) { pin = candidate; break; }
    }
    if (!pin) return fail("Could not create a unique Poll code. Try again.", 503);
    await db.prepare("UPDATE activities SET state = 'open', join_pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'draft'")
      .bind(pin, activityId).run();
    await audit(db, activityId, "opened", "draft", "open", Number(poll.version));
    return json({ state: "open", pin, path: publicPath(poll.access_slug) });
  }
  if (request.method === "POST" && ["close", "reopen"].includes(action ?? "")) {
    const target = action === "close" ? "closed" : "open";
    const allowed = action === "close" ? poll.state === "open" : poll.state === "closed" || poll.state === "archived";
    if (!allowed) return fail(action === "close" ? "This Poll is not Live." : "Only a Closed Poll can be reopened.", 409, "INVALID_STATE");
    const now = new Date().toISOString();
    const result = action === "close"
      ? await db.prepare("UPDATE activities SET state = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'open'").bind(activityId).run()
      : await db.prepare(`UPDATE activities SET state = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state IN ('closed', 'archived')`).bind(activityId).run();
    if (Number(result.meta.changes ?? 0) !== 1) return fail("Poll state changed. Refresh and try again.", 409, "STALE_STATE");
    if (action === "reopen") await db.prepare("UPDATE poll_configs SET reopened_at = ?, reopen_count = reopen_count + 1, updated_at = CURRENT_TIMESTAMP WHERE activity_id = ?").bind(now, activityId).run();
    const nextPoll = await getPoll(db, activityId);
    await audit(db, activityId, action === "close" ? "closed" : "reopened", poll.state, target, Number(nextPoll?.version ?? poll.version));
    return json({ state: target, archivedSession: poll.session_status === "completed" });
  }
  if (request.method === "POST" && action === "reveal") {
    const data = await readBody(request, z.object({ revealed: z.boolean(), participantResultsMode: z.enum(["presenter_only", "presenter_and_participant"]).optional() }));
    if (!data) return fail("Choose whether to reveal Poll results.");
    const revealState = data.revealed ? "revealed" : "hidden";
    const mode = data.participantResultsMode ?? poll.participant_results_mode;
    await db.prepare(`UPDATE poll_configs SET reveal_state = ?, participant_results_mode = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE activity_id = ?`)
      .bind(revealState, mode, activityId).run();
    await audit(db, activityId, "presentation-settings", `${poll.reveal_state}:${poll.participant_results_mode}`, `${revealState}:${mode}`, Number(poll.version) + 1);
    return json({ revealState, participantResultsMode: mode });
  }
  if (request.method === "POST" && action === "duplicate") {
    const options = await pollOptions(db, activityId);
    const duplicateInput: z.infer<typeof PollInput> = {
      title: `${poll.title} copy`, question: poll.question, questionType: poll.question_type,
      options: options.filter((option) => !option.isOther).map((option) => option.label), maxSelections: Number(poll.max_selections),
      allowOther: Boolean(poll.allow_other), identityMode: poll.identity_mode,
      participantResultsMode: poll.participant_results_mode, sessionId: poll.session_id,
    };
    const created = await createPoll(db, duplicateInput);
    if (!created || "errors" in created) return fail("Could not duplicate this Poll.", 400);
    return json({ activityId: created.activityId, path: `/polls/${created.activityId}/edit` }, 201);
  }
  if (request.method === "DELETE" && !action) {
    await db.prepare("DELETE FROM activities WHERE id = ? AND tool_id = 'poll'").bind(activityId).run();
    return json({ deleted: true });
  }
  if (request.method === "GET" && action === "results") return json(await trainerPollPayload(db, poll));
  if (request.method === "GET" && action === "export") {
    const kind = url.searchParams.get("kind") ?? "summary";
    const payload = await trainerPollPayload(db, poll);
    const pollData = payload.poll;
    let headers: string[];
    let rows: unknown[][];
    if (kind === "named") {
      if (poll.identity_mode !== "named") return fail("Named response export is not available for an Anonymous Poll.", 403, "FORBIDDEN");
      headers = ["poll_id", "participant_name", "team", "selected_option_labels", "other_text", "submitted_at", "updated_at"];
      rows = payload.namedResponses.map((item) => [activityId, item.displayName, item.teamName ?? "", item.selections.join(" | "), item.otherText ?? "", item.submittedAt, item.updatedAt]);
    } else if (kind === "other") {
      headers = ["privacy_warning", "poll_id", "response_text"];
      rows = payload.otherResponses.map((item) => ["Free text may contain information a participant chose to identify themselves with.", activityId, item]);
    } else if (kind === "summary") {
      headers = ["poll_id", "poll_title", "question", "mode", "poll_state", "option_id", "option_label", "vote_count", "respondent_count", "percentage", "exported_at"];
      rows = payload.results.map((item) => [activityId, pollData.title, pollData.question, pollData.identityMode, pollData.state,
        item.optionId, item.label, item.count, payload.counts.respondents, item.percentage, new Date().toISOString()]);
    } else return fail("Choose a supported export type.", 400);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}\r\n`;
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="poll-${activityId.slice(0, 8)}-${kind}-${date}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return fail("Poll route not found.", 404);
}
function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function publicPollPayload(db: D1Database, poll: PollRow) {
  const options = await pollOptions(db, poll.activity_id);
  const sessionAccess = poll.session_id ? await db.prepare("SELECT access_slug FROM poll_session_access WHERE session_id = ?")
    .bind(poll.session_id).first<{ access_slug: string }>() : null;
  return { poll: { activityId: poll.activity_id, sessionId: poll.session_id, sessionName: poll.session_name,
    title: poll.title, question: poll.question, questionType: poll.question_type, maxSelections: Number(poll.max_selections),
    allowOther: Boolean(poll.allow_other), identityMode: poll.identity_mode, participantResultsMode: poll.participant_results_mode,
    state: poll.state, accessSlug: poll.access_slug, sessionAccessSlug: sessionAccess?.access_slug ?? null }, options: options.map(({ id, label, isOther }) => ({ id, label, isOther })),
    teams: poll.session_id ? await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at")
      .bind(poll.activity_id).all<{ id: string; name: string }>().then((result) => result.results) : [] };
}
async function identityProfile(db: D1Database, sessionId: string, token: string) {
  if (!/^[a-f\d]{64}$/i.test(token)) return null;
  const hash = await sha256(token);
  const identity = await db.prepare(`SELECT id, display_name, role, team_name FROM session_participant_identities
    WHERE session_id = ? AND token_hash = ?`).bind(sessionId, hash).first<{ id: string; display_name: string | null; role: string; team_name: string | null }>();
  if (!identity) return null;
  if (identity.display_name) return { ...identity, display_name: identity.display_name };
  const previous = await db.prepare(`SELECT p.display_name, p.role, t.name AS team_name FROM participants p
    LEFT JOIN activities a ON a.id = p.activity_id LEFT JOIN teams t ON t.id = p.team_id
    WHERE a.session_id = ? AND p.session_identity_id = ? ORDER BY p.joined_at DESC LIMIT 1`)
    .bind(sessionId, identity.id).first<{ display_name: string; role: string; team_name: string | null }>();
  return previous ? { ...identity, ...previous } : null;
}
async function pollSessionPayload(db: D1Database, accessSlug: string, sessionToken?: string) {
  const session = await db.prepare(`SELECT s.id, s.name, s.status, a.access_slug, a.join_pin FROM poll_session_access a
    JOIN sessions s ON s.id = a.session_id WHERE a.access_slug = ?`).bind(accessSlug)
    .first<{ id: string; name: string; status: string; access_slug: string; join_pin: string }>();
  if (!session) return null;
  const rows = await db.prepare(`SELECT a.id AS activity_id, a.title, a.state, pc.question, pc.access_slug,
      pc.identity_mode, pc.participant_results_mode,
      (SELECT COUNT(*) FROM poll_responses pr WHERE pr.activity_id = a.id) AS respondent_count
    FROM activities a JOIN poll_configs pc ON pc.activity_id = a.id
    WHERE a.session_id = ? AND a.state = 'open' ORDER BY a.created_at`)
    .bind(session.id).all<{ activity_id: string; title: string; state: string; question: string; access_slug: string; identity_mode: string; participant_results_mode: string; respondent_count: number }>();
  let profile = null as Awaited<ReturnType<typeof identityProfile>>;
  let identityId: string | null = null;
  if (sessionToken) {
    profile = await identityProfile(db, session.id, sessionToken);
    if (profile) identityId = profile.id;
  }
  const polls = [];
  for (const row of rows.results) {
    let submitted = false;
    if (identityId) {
      const participation = await db.prepare(`SELECT 1 FROM participants p JOIN poll_participations pp
        ON pp.participant_id = p.id AND pp.activity_id = p.activity_id
        WHERE p.activity_id = ? AND p.session_identity_id = ? AND pp.has_submitted = 1 LIMIT 1`)
        .bind(row.activity_id, identityId).first();
      submitted = Boolean(participation);
    }
    polls.push({ id: row.activity_id, title: row.title, question: row.question, state: row.state, slug: row.access_slug,
      respondentCount: Number(row.respondent_count), submitted, identityMode: row.identity_mode });
  }
  return { session: { id: session.id, name: session.name, status: session.status, archived: session.status === "completed" },
    profile: profile ? { displayName: profile.display_name, role: profile.role, teamName: profile.team_name } : null,
    teams: await sessionPollNames(db, session.id), polls };
}

async function pollJoinRoute(request: Request, env: PollEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/join/polls/") && !url.pathname.startsWith("/api/join/poll-sessions/")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  const pollMatch = url.pathname.match(/^\/api\/join\/polls\/([a-f\d]+)(?:\/(enter))?$/i);
  if (pollMatch) {
    const poll = await getPollBySlug(db, pollMatch[1]!);
    if (!poll) return fail("Poll link not found.", 404);
    if (request.method === "GET" && !pollMatch[2]) return json(await publicPollPayload(db, poll));
    if (request.method === "POST" && pollMatch[2] === "enter") {
      if (!await rateLimit(request, env, "poll-entry")) return fail("Too many Poll join attempts. Wait a few minutes and try again.", 429);
      const schema = z.object({ displayName: z.string().trim().max(60).optional().default(""), role: z.string().trim().max(60).optional().default(""),
        teamId: z.string().uuid().nullable().optional(), teamName: z.string().trim().max(50).optional(), sessionToken: z.string().regex(/^[a-f\d]{64}$/i).optional() });
      const data = await readBody(request, schema);
      if (!data) return fail("Check the participant details and try again.");
      if (poll.state !== "open") return fail("This Poll is not accepting votes right now.", 409, "POLL_CLOSED");
      let sessionIdentityId: string | null = null;
      let name = data.displayName.trim();
      let role = data.role.trim();
      let teamName = data.teamName?.trim() || "";
      if (poll.session_id) {
        if (data.sessionToken) {
          const profile = await identityProfile(db, poll.session_id, data.sessionToken);
          if (profile) {
            sessionIdentityId = profile.id;
            name ||= profile.display_name;
            role ||= profile.role;
            teamName ||= profile.team_name ?? "";
          }
        }
        if (!sessionIdentityId) {
          if (!name) return fail("Enter your name to join this Session.", 400, "IDENTITY_REQUIRED");
          const sessionToken = data.sessionToken ?? randomToken(32);
          const tokenHash = await sha256(sessionToken);
          sessionIdentityId = newId();
          await db.prepare(`INSERT INTO session_participant_identities (id, session_id, token_hash, display_name, role, team_name)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO NOTHING`)
            .bind(sessionIdentityId, poll.session_id, tokenHash, name, role, teamName || null).run();
          const existing = await db.prepare("SELECT id FROM session_participant_identities WHERE session_id = ? AND token_hash = ?")
            .bind(poll.session_id, tokenHash).first<{ id: string }>();
          sessionIdentityId = existing?.id ?? sessionIdentityId;
          (data as typeof data & { returnedSessionToken?: string }).returnedSessionToken = sessionToken;
        }
      } else if (poll.identity_mode === "named" && !name) return fail("Enter your name to join this Poll.", 400, "IDENTITY_REQUIRED");
      if (!name) name = "Anonymous participant";
      const teams = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ?").bind(poll.activity_id).all<{ id: string; name: string }>();
      if (data.teamId && !teams.results.some((team) => team.id === data.teamId)) return fail("Choose a team for this activity.");
      const teamId = data.teamId ?? teams.results.find((team) => team.name === teamName)?.id ?? null;
      if (sessionIdentityId && data.teamName === undefined && teamName) {
        const matching = teams.results.find((team) => team.id === teamId);
        if (matching) teamName = matching.name;
      }
      const existing = sessionIdentityId ? await db.prepare("SELECT id FROM participants WHERE activity_id = ? AND session_identity_id = ?")
        .bind(poll.activity_id, sessionIdentityId).first<{ id: string }>() : null;
      const participantId = existing?.id ?? newId();
      const token = randomToken(32);
      const tokenHash = await sha256(token);
      const statements: D1PreparedStatement[] = [existing
        ? db.prepare("UPDATE participants SET team_id = ?, display_name = ?, role = ?, token_hash = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(teamId, name, role, tokenHash, participantId)
        : db.prepare(`INSERT INTO participants (id, activity_id, team_id, display_name, role, token_hash, session_identity_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(participantId, poll.activity_id, teamId, name, role, tokenHash, sessionIdentityId),
      db.prepare(`INSERT INTO poll_participations (activity_id, participant_id, has_submitted) VALUES (?, ?, 0)
        ON CONFLICT(activity_id, participant_id) DO NOTHING`).bind(poll.activity_id, participantId)];
      await db.batch(statements);
      if (sessionIdentityId) await db.prepare(`UPDATE session_participant_identities SET display_name = ?, role = ?, team_name = ? WHERE id = ?`)
        .bind(name, role, teamName || (teams.results.find((team) => team.id === teamId)?.name ?? null), sessionIdentityId).run();
      return json({ token, activityId: poll.activity_id, participant: { id: participantId },
        ...(poll.session_id ? { sessionToken: (data as typeof data & { returnedSessionToken?: string }).returnedSessionToken ?? data.sessionToken } : {}) }, existing ? 200 : 201);
    }
    return fail("Poll join route not found.", 404);
  }
  const sessionMatch = url.pathname.match(/^\/api\/join\/poll-sessions\/([a-f\d]+)(?:\/(profile|identity))?$/i);
  if (!sessionMatch) return fail("Session join route not found.", 404);
  const accessSlug = sessionMatch[1]!;
  const action = sessionMatch[2];
  if (request.method === "GET" && !action) {
    const result = await pollSessionPayload(db, accessSlug);
    return result ? json(result) : fail("Session link not found.", 404);
  }
  if (request.method === "POST" && action === "profile") {
    const data = await readBody(request, z.object({ sessionToken: z.string().regex(/^[a-f\d]{64}$/i) }));
    if (!data) return fail("Session participant identity is invalid.", 400);
    const access = await db.prepare("SELECT session_id FROM poll_session_access WHERE access_slug = ?").bind(accessSlug).first<{ session_id: string }>();
    if (!access) return fail("Session link not found.", 404);
    const result = await pollSessionPayload(db, accessSlug, data.sessionToken);
    if (!result?.profile) return fail("Saved Session identity was not found. Join with your name once more.", 404, "IDENTITY_NOT_FOUND");
    return json(result);
  }
  if (request.method === "POST" && action === "identity") {
    if (!await rateLimit(request, env, "poll-identity")) return fail("Too many Session join attempts. Wait a few minutes and try again.", 429);
    const data = await readBody(request, z.object({ displayName: z.string().trim().min(1).max(60), role: z.string().trim().max(60).optional().default(""), teamName: z.string().trim().max(50).optional().nullable() }));
    if (!data) return fail("Enter your name to join this Session.", 400);
    const session = await db.prepare("SELECT session_id FROM poll_session_access WHERE access_slug = ?").bind(accessSlug).first<{ session_id: string }>();
    if (!session) return fail("Session link not found.", 404);
    const active = await db.prepare("SELECT 1 FROM activities WHERE session_id = ? AND tool_id = 'poll' AND state = 'open' LIMIT 1").bind(session.session_id).first();
    if (!active) return fail("This Session has no Live Polls right now.", 409);
    if (data.teamName) {
      const valid = (await sessionPollNames(db, session.session_id)).includes(data.teamName);
      if (!valid) return fail("Choose a team from this Session.", 400);
    }
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    await db.prepare(`INSERT INTO session_participant_identities (id, session_id, token_hash, display_name, role, team_name)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(newId(), session.session_id, tokenHash, data.displayName, data.role, data.teamName ?? null).run();
    const result = await pollSessionPayload(db, accessSlug, token);
    return json({ sessionToken: token, ...result }, 201);
  }
  return fail("Session join route not found.", 404);
}

async function pollParticipantRoute(request: Request, env: PollEnv, url: URL, participant: PollParticipant): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/guest/poll/")) return null;
  const db = dbFor(env);
  if (!db) return fail("D1 database is not configured.", 503);
  const poll = await getPoll(db, participant.activity_id);
  if (!poll) return fail("Poll not found for this participant link.", 404);
  const participation = await db.prepare(`SELECT has_submitted FROM poll_participations WHERE activity_id = ? AND participant_id = ?`)
    .bind(poll.activity_id, participant.id).first<{ has_submitted: number }>();
  if (!participation) return fail("Poll participant access is not active.", 403);
  if (!env.SESSION_SECRET) return fail("Poll signing secret is not configured.", 503);
  const voterKey = await pollVoterKey(env.SESSION_SECRET, poll.activity_id, participant.id);
  if (request.method === "GET" && url.pathname === "/api/guest/poll/current") {
    const options = await pollOptions(db, poll.activity_id);
    const response = await db.prepare("SELECT id, other_text FROM poll_responses WHERE activity_id = ? AND voter_key = ?")
      .bind(poll.activity_id, voterKey).first<{ id: string; other_text: string | null }>();
    const selected = response ? await db.prepare("SELECT option_id FROM poll_response_options WHERE response_id = ?").bind(response.id).all<{ option_id: string }>() : { results: [] };
    return json({ poll: { activityId: poll.activity_id, sessionId: poll.session_id, title: poll.title, question: poll.question,
      questionType: poll.question_type, maxSelections: Number(poll.max_selections), allowOther: Boolean(poll.allow_other),
      participantResultsMode: poll.participant_results_mode, revealState: poll.reveal_state, state: poll.state, accessSlug: poll.access_slug },
      options, participant: { displayName: participant.display_name },
      response: response ? { submitted: true, selectedOptionIds: selected.results.map((row) => row.option_id), otherText: response.other_text } : { submitted: false, selectedOptionIds: [], otherText: null } });
  }
  if (request.method === "POST" && url.pathname === "/api/guest/poll/response") {
    if (!await rateLimit(request, env, "poll-vote")) return fail("Too many vote updates. Wait a few minutes before trying again.", 429);
    const data = await readBody(request, PollVoteInput);
    if (!data) return fail("Check your selected answers and try again.", 400, "INVALID_OPTIONS");
    if (poll.state !== "open") return fail("This Poll has closed. Your changes were not saved.", 409, "POLL_CLOSED");
    const options = await pollOptions(db, poll.activity_id);
    const selections: PollSelection[] = data.selections.map((selection) => ({ optionId: selection.optionId, ...(selection.otherText !== undefined ? { otherText: selection.otherText } : {}) }));
    const validation = validatePollSelection(poll.question_type, Number(poll.max_selections), options, selections);
    if (!poll.allow_other && selections.some((selection) => options.find((option) => option.id === selection.optionId)?.isOther)) validation.push("Other is not enabled for this Poll.");
    if (validation.length) return json({ error: validation[0], errors: validation }, 400, { "X-Poll-Error": "INVALID_OPTIONS" });
    const payloadHash = await sha256(JSON.stringify({ selections: [...selections].sort((a, b) => a.optionId.localeCompare(b.optionId)).map((item) => [item.optionId, item.otherText?.trim() ?? ""]) }));
    const prior = await db.prepare("SELECT payload_hash FROM poll_idempotency_requests WHERE activity_id = ? AND voter_key = ? AND idempotency_key = ?")
      .bind(poll.activity_id, voterKey, data.idempotencyKey).first<{ payload_hash: string }>();
    if (prior) {
      if (prior.payload_hash !== payloadHash) return fail("This retry key was already used for a different vote.", 409, "IDEMPOTENCY_CONFLICT");
      return json({ submitted: true, alreadySubmitted: true });
    }
    const responseId = newId();
    const namedId = poll.identity_mode === "named" ? participant.id : null;
    const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO poll_idempotency_requests (activity_id, voter_key, idempotency_key, payload_hash)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open') ON CONFLICT DO NOTHING`)
      .bind(poll.activity_id, voterKey, data.idempotencyKey, payloadHash, poll.activity_id),
    db.prepare(`INSERT INTO poll_responses (id, activity_id, voter_key, other_text, named_participant_id, payload_hash, revision)
      SELECT ?, ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')
        AND EXISTS (SELECT 1 FROM poll_idempotency_requests WHERE activity_id = ? AND voter_key = ? AND idempotency_key = ? AND payload_hash = ?)
      ON CONFLICT(activity_id, voter_key) DO UPDATE SET other_text = excluded.other_text,
        named_participant_id = excluded.named_participant_id, payload_hash = excluded.payload_hash,
        revision = poll_responses.revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(responseId, poll.activity_id, voterKey, selections.find((item) => options.find((option) => option.id === item.optionId)?.isOther)?.otherText?.trim() ?? null,
        namedId, payloadHash, poll.activity_id, poll.activity_id, voterKey, data.idempotencyKey, payloadHash, poll.activity_id),
    db.prepare(`DELETE FROM poll_response_options WHERE response_id = (SELECT id FROM poll_responses WHERE activity_id = ? AND voter_key = ?)
      AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')
      AND EXISTS (SELECT 1 FROM poll_responses WHERE activity_id = ? AND voter_key = ? AND payload_hash = ?)`)
      .bind(poll.activity_id, voterKey, poll.activity_id, poll.activity_id, voterKey, payloadHash)];
    for (const selection of selections) statements.push(db.prepare(`INSERT INTO poll_response_options (response_id, option_id)
      SELECT pr.id, po.id FROM poll_responses pr JOIN poll_options po ON po.id = ?
      WHERE pr.activity_id = ? AND pr.voter_key = ? AND pr.payload_hash = ? AND po.activity_id = pr.activity_id
        AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open') ON CONFLICT DO NOTHING`)
      .bind(selection.optionId, poll.activity_id, voterKey, payloadHash, poll.activity_id));
    statements.push(db.prepare(`UPDATE poll_participations SET has_submitted = 1, submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = ? AND participant_id = ? AND EXISTS (SELECT 1 FROM poll_responses WHERE activity_id = ? AND voter_key = ? AND payload_hash = ?)
        AND EXISTS (SELECT 1 FROM activities WHERE id = ? AND state = 'open')`)
      .bind(poll.activity_id, participant.id, poll.activity_id, voterKey, payloadHash, poll.activity_id));
    await db.batch(statements);
    const currentState = await db.prepare("SELECT state FROM activities WHERE id = ?").bind(poll.activity_id).first<{ state: string }>();
    const committed = await db.prepare("SELECT payload_hash FROM poll_responses WHERE activity_id = ? AND voter_key = ?")
      .bind(poll.activity_id, voterKey).first<{ payload_hash: string }>();
    if (currentState?.state !== "open") return fail("This Poll has closed. Your changes were not saved.", 409, "POLL_CLOSED");
    if (committed?.payload_hash !== payloadHash) return fail("Vote update conflicted. Refresh and try again.", 409, "STALE_RESPONSE");
    return json({ submitted: true, alreadySubmitted: false });
  }
  if (request.method === "GET" && url.pathname === "/api/guest/poll/results") {
    if (!participation.has_submitted) return json({ visible: false, reason: "not-submitted" });
    if (poll.reveal_state !== "revealed" || poll.participant_results_mode !== "presenter_and_participant") return json({ visible: false, reason: "waiting-for-trainer" });
    const aggregate = await getAggregate(db, poll.activity_id);
    const response = await db.prepare("SELECT id FROM poll_responses WHERE activity_id = ? AND voter_key = ?").bind(poll.activity_id, voterKey).first<{ id: string }>();
    const selected = response ? await db.prepare("SELECT option_id FROM poll_response_options WHERE response_id = ?").bind(response.id).all<{ option_id: string }>() : { results: [] };
    return json({ visible: true, respondentCount: aggregate.respondentCount, results: aggregate.results, selectedOptionIds: selected.results.map((row) => row.option_id), multiSelectNote: poll.question_type === "multiple" ? "Percentages use respondents as the denominator and may total more than 100%." : null });
  }
  if (request.method === "GET" && url.pathname === "/api/guest/poll/activities") {
    if (!poll.session_id) return json({ activities: [] });
    const rows = await db.prepare(`SELECT a.id, a.title, a.state, p.access_slug,
      EXISTS (SELECT 1 FROM participants other JOIN poll_participations pp ON pp.participant_id = other.id AND pp.activity_id = other.activity_id
        WHERE other.activity_id = a.id AND other.session_identity_id = ? AND pp.has_submitted = 1) AS submitted
      FROM activities a JOIN poll_configs p ON p.activity_id = a.id WHERE a.session_id = ? AND a.state = 'open' ORDER BY a.created_at`)
      .bind((await db.prepare("SELECT session_identity_id FROM participants WHERE id = ?").bind(participant.id).first<{ session_identity_id: string | null }>())?.session_identity_id ?? "", poll.session_id)
      .all<{ id: string; title: string; state: string; access_slug: string; submitted: number }>();
    return json({ activities: rows.results.map((row) => ({ id: row.id, title: row.title, state: row.state, slug: row.access_slug, submitted: Boolean(row.submitted) })) });
  }
  return fail("Poll participant route not found.", 404);
}

async function pollPresenterRoute(request: Request, env: PollEnv, token: string | null): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const db = dbFor(env);
  if (!db || !token || !/^[a-f\d]{48,64}$/i.test(token)) return null;
  const hash = await sha256(token);
  const poll = await db.prepare(`SELECT a.id AS activity_id, a.title, a.state, p.question, p.reveal_state, p.participant_results_mode
    FROM activities a JOIN poll_configs p ON p.activity_id = a.id WHERE a.presenter_token_hash = ?`).bind(hash)
    .first<{ activity_id: string; title: string; state: string; question: string; reveal_state: string; participant_results_mode: string }>();
  if (!poll) return null;
  if (poll.reveal_state !== "revealed") return json({ kind: "poll", revealed: false, title: poll.title, question: poll.question, state: poll.state });
  const aggregate = await getAggregate(db, poll.activity_id);
  return json({ kind: "poll", revealed: true, title: poll.title, question: poll.question, state: poll.state,
    respondentCount: aggregate.respondentCount, results: aggregate.results, questionType: (await getPoll(db, poll.activity_id))?.question_type,
    multiSelectNote: (await getPoll(db, poll.activity_id))?.question_type === "multiple" ? "Percentages may total more than 100%." : null });
}

export { pollJoinRoute, pollOwnerRoute, pollParticipantRoute, pollPresenterRoute };
