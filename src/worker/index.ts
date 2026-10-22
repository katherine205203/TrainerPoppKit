import { z } from "zod";
import { DEMO_ITEMS, SCARF_DIMENSIONS, scoreDemoResponses, smallGroupWarning, relativeTier, validateDemoAnswers } from "../domain/scarf";
import {
  bearerToken,
  clearOwnerCookie,
  createOwnerCookie,
  getCookie,
  isSameOrigin,
  isValidOwnerCookie,
  ownerCookieHeader,
  passwordMatches,
  randomToken,
  sha256,
} from "./security";

interface Env {
  DB?: D1Database;
  OWNER_PASSWORD?: string;
  SESSION_SECRET?: string;
}

type ActivityRow = {
  id: string;
  session_id: string | null;
  title: string;
  state: string;
  result_policy: "trainer_reveal" | "immediate" | "confirmation";
  require_name: number;
  allow_teams: number;
  join_pin: string | null;
  instrument_version: string;
  scoring_version: string;
  session_name?: string | null;
};

type ParticipantRow = {
  id: string;
  activity_id: string;
  team_id: string | null;
  display_name: string;
  consent_named_results: number;
  token_hash: string;
};

const SessionInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(""),
  startsAt: z.string().datetime().nullable().optional(),
  location: z.string().trim().max(120).optional().default(""),
  expectedParticipants: z.number().int().min(0).max(1000).optional().default(0),
});

const ActivityInput = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(100),
  resultPolicy: z.enum(["trainer_reveal", "immediate", "confirmation"]).default("trainer_reveal"),
  requireName: z.boolean().default(true),
  allowTeams: z.boolean().default(true),
  teamNames: z.array(z.string().trim().min(1).max(50)).max(12).default([]),
});

const JoinLookupInput = z.object({ pin: z.string().regex(/^\d{6}$/) });
const JoinEnterInput = z.object({
  pin: z.string().regex(/^\d{6}$/),
  displayName: z.string().trim().max(60).optional().default(""),
  role: z.string().trim().max(60).optional().default(""),
  teamId: z.string().uuid().nullable().optional(),
  consentNamedResults: z.boolean().default(false),
});
const AnswersInput = z.object({ answers: z.record(z.string(), z.number().int().min(1).max(5)) });
const PresenterStateInput = z.object({
  revealed: z.boolean().optional(),
  comparisonBasis: z.enum(["within_person", "team_relative"]).optional(),
  selectedTeamId: z.string().uuid().nullable().optional(),
  showNames: z.boolean().optional(),
  promptIndex: z.number().int().min(0).max(10).optional(),
});

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  return new Response(JSON.stringify(data), { status, headers });
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function readBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 32_768) return null;
  try {
    const raw = await request.json();
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function database(env: Env): D1Database | null {
  return env.DB ?? null;
}

async function ownerAllowed(request: Request, env: Env): Promise<boolean> {
  if (!env.SESSION_SECRET) return false;
  return isValidOwnerCookie(getCookie(request, "pp_owner"), env.SESSION_SECRET);
}

function ownerSetupReady(env: Env): boolean {
  return Boolean(env.OWNER_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
}

function id(): string {
  return crypto.randomUUID();
}

async function rateLimitRequest(request: Request, env: Env, scope: "login" | "lookup" | "enter"): Promise<boolean> {
  const db = database(env);
  if (!db || !env.SESSION_SECRET) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown-client";
  const keyHash = await sha256(`${env.SESSION_SECRET}:${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % 600);
  await db.prepare(`
    INSERT INTO join_rate_limits (key_hash, window_started_at, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN join_rate_limits.window_started_at < excluded.window_started_at THEN 1 ELSE join_rate_limits.attempts + 1 END,
      window_started_at = excluded.window_started_at
  `).bind(keyHash, window).run();
  const row = await db.prepare("SELECT attempts FROM join_rate_limits WHERE key_hash = ?").bind(keyHash).first<{ attempts: number }>();
  const limit = scope === "lookup" || scope === "login" ? 10 : 30;
  return Number(row?.attempts ?? 0) <= limit;
}

async function ownerActivity(db: D1Database, activityId: string): Promise<ActivityRow | null> {
  return db.prepare(`
    SELECT a.id, a.session_id, a.title, a.state, a.result_policy, a.require_name, a.allow_teams,
      a.join_pin, a.instrument_version, a.scoring_version, s.name AS session_name
    FROM activities a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id = ?
  `).bind(activityId).first<ActivityRow>();
}

async function guestParticipant(request: Request, db: D1Database): Promise<ParticipantRow | null> {
  const token = bearerToken(request);
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256(token);
  const participant = await db.prepare(`
    SELECT id, activity_id, team_id, display_name, consent_named_results, token_hash
    FROM participants WHERE token_hash = ?
  `).bind(tokenHash).first<ParticipantRow>();
  if (participant) {
    await db.prepare("UPDATE participants SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").bind(participant.id).run();
  }
  return participant;
}

async function ownerRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!ownerSetupReady(env)) return fail("Owner authentication is not configured.", 503);
  if (!await ownerAllowed(request, env)) return fail("Owner sign-in required.", 401);
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);

  if (request.method === "GET" && url.pathname === "/api/owner/sessions") {
    const { results } = await db.prepare(`
      SELECT s.*, COUNT(DISTINCT a.id) AS activity_count,
        (SELECT COUNT(*) FROM participants p JOIN activities ax ON ax.id = p.activity_id WHERE ax.session_id = s.id) AS participant_count
      FROM sessions s LEFT JOIN activities a ON a.session_id = s.id
      GROUP BY s.id ORDER BY s.updated_at DESC
    `).all();
    return json({ sessions: results });
  }

  if (request.method === "POST" && url.pathname === "/api/owner/sessions") {
    const data = await readBody(request, SessionInput);
    if (!data) return fail("Check the session details and try again.", 400);
    const sessionId = id();
    await db.prepare(`
      INSERT INTO sessions (id, name, description, starts_at, location, expected_participants, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')
    `).bind(sessionId, data.name, data.description, data.startsAt ?? null, data.location, data.expectedParticipants).run();
    return json({ session: { id: sessionId, ...data, status: "draft" } }, 201);
  }

  const sessionMatch = url.pathname.match(/^\/api\/owner\/sessions\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && sessionMatch) {
    const data = await readBody(request, SessionInput);
    if (!data) return fail("Check the session details and try again.", 400);
    const sessionId = sessionMatch[1]!;
    if (!await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(sessionId).first()) return fail("Session not found.", 404);
    await db.prepare(`
      UPDATE sessions SET name = ?, description = ?, starts_at = ?, location = ?, expected_participants = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(data.name, data.description, data.startsAt ?? null, data.location, data.expectedParticipants, sessionId).run();
    const session = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
    return json({ session });
  }
  if (request.method === "GET" && sessionMatch) {
    const sessionId = sessionMatch[1]!;
    const session = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
    if (!session) return fail("Session not found.", 404);
    const { results: activities } = await db.prepare(`
      SELECT a.*, (SELECT COUNT(*) FROM participants p WHERE p.activity_id = a.id) AS participant_count,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.activity_id = a.id AND sub.status = 'submitted') AS submitted_count
      FROM activities a WHERE a.session_id = ? ORDER BY a.created_at
    `).bind(sessionId).all();
    return json({ session, activities });
  }

  if (request.method === "GET" && url.pathname === "/api/owner/activities") {
    const { results } = await db.prepare(`
      SELECT a.*, s.name AS session_name,
        (SELECT COUNT(*) FROM participants p WHERE p.activity_id = a.id) AS participant_count,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.activity_id = a.id AND sub.status = 'submitted') AS submitted_count
      FROM activities a LEFT JOIN sessions s ON s.id = a.session_id ORDER BY a.updated_at DESC
    `).all();
    return json({ activities: results });
  }

  if (request.method === "POST" && url.pathname === "/api/owner/activities") {
    const data = await readBody(request, ActivityInput);
    if (!data) return fail("Check the activity details and try again.", 400);
    if (data.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id = ?").bind(data.sessionId).first()) {
      return fail("Session not found.", 404);
    }
    if (!data.allowTeams && data.teamNames.length) return fail("Teams are disabled for this activity.", 400);
    const activityId = id();
    const statements: D1PreparedStatement[] = [db.prepare(`
      INSERT INTO activities (id, session_id, title, result_policy, require_name, allow_teams)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(activityId, data.sessionId ?? null, data.title, data.resultPolicy, data.requireName ? 1 : 0, data.allowTeams ? 1 : 0)];
    for (const teamName of data.teamNames) {
      statements.push(db.prepare("INSERT INTO teams (id, activity_id, name) VALUES (?, ?, ?)").bind(id(), activityId, teamName));
    }
    statements.push(db.prepare("INSERT INTO presentation_state (activity_id) VALUES (?)").bind(activityId));
    await db.batch(statements);
    return json({ activity: { id: activityId, ...data, state: "draft", demoOnly: true } }, 201);
  }

  const activityMatch = url.pathname.match(/^\/api\/owner\/activities\/([0-9a-f-]+)(?:\/(open|pause|close|reveal|presenter-token|participants\/([0-9a-f-]+)\/team))?$/i);
  if (activityMatch) {
    const activityId = activityMatch[1]!;
    const action = activityMatch[2];
    const activity = await ownerActivity(db, activityId);
    if (!activity) return fail("Activity not found.", 404);
    if (request.method === "GET" && !action) {
      const { results: teams } = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at").bind(activityId).all();
      const counts = await db.prepare(`
        SELECT COUNT(*) AS joined,
          SUM(CASE WHEN sub.status = 'submitted' THEN 1 ELSE 0 END) AS submitted
        FROM participants p LEFT JOIN submissions sub ON sub.participant_id = p.id WHERE p.activity_id = ?
      `).bind(activityId).first<{ joined: number; submitted: number | null }>();
      const presentation = await db.prepare("SELECT * FROM presentation_state WHERE activity_id = ?").bind(activityId).first();
      const { results: participants } = await db.prepare(`
        SELECT p.id, p.display_name, p.role, p.team_id, t.name AS team_name, p.consent_named_results,
          sub.status AS submission_status, sub.submitted_at
        FROM participants p LEFT JOIN teams t ON t.id = p.team_id
        LEFT JOIN submissions sub ON sub.participant_id = p.id AND sub.activity_id = p.activity_id
        WHERE p.activity_id = ? ORDER BY p.joined_at
      `).bind(activityId).all();
      return json({ activity, teams, counts, participants, presentation, demoOnly: true });
    }
    if (request.method === "POST" && action === "open") {
      let pin = "";
      for (let attempt = 0; attempt < 8; attempt += 1) {
        pin = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
        const exists = await db.prepare("SELECT id FROM activities WHERE join_pin = ? AND id != ?").bind(pin, activityId).first();
        if (!exists) break;
        pin = "";
      }
      if (!pin) return fail("Could not create a unique join code. Try again.", 503);
      await db.prepare("UPDATE activities SET state = 'open', join_pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pin, activityId).run();
      return json({ pin, joinPath: `/join?pin=${pin}`, state: "open" });
    }
    if (request.method === "POST" && ["pause", "close"].includes(action ?? "")) {
      const state = action === "pause" ? "paused" : "closed";
      await db.prepare("UPDATE activities SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(state, activityId).run();
      return json({ state });
    }
    if (request.method === "POST" && action === "reveal") {
      const data = await readBody(request, PresenterStateInput);
      if (!data) return fail("Invalid presenter settings.", 400);
      if (data.selectedTeamId) {
        const team = await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(data.selectedTeamId, activityId).first();
        if (!team) return fail("Team not found for this activity.", 404);
      }
      const current = await db.prepare("SELECT * FROM presentation_state WHERE activity_id = ?").bind(activityId).first<Record<string, unknown>>();
      await db.prepare(`
        UPDATE presentation_state SET revealed = ?, comparison_basis = ?, selected_team_id = ?, show_names = ?, prompt_index = ?, updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = ?
      `).bind(
        data.revealed === undefined ? Number(current?.revealed ?? 0) : data.revealed ? 1 : 0,
        data.comparisonBasis ?? String(current?.comparison_basis ?? "within_person"),
        data.selectedTeamId === undefined ? (current?.selected_team_id ?? null) : data.selectedTeamId,
        data.showNames === undefined ? Number(current?.show_names ?? 0) : data.showNames ? 1 : 0,
        data.promptIndex ?? Number(current?.prompt_index ?? 0),
        activityId,
      ).run();
      return json({ presentation: await db.prepare("SELECT * FROM presentation_state WHERE activity_id = ?").bind(activityId).first() });
    }
    if (request.method === "POST" && action === "presenter-token") {
      const token = randomToken();
      await db.prepare("UPDATE activities SET presenter_token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(await sha256(token), activityId).run();
      return json({ path: `/presenter#${token}` });
    }
    const teamMatch = action?.match(/^participants\/([0-9a-f-]+)\/team$/i);
    if (request.method === "POST" && teamMatch) {
      const data = await readBody(request, z.object({ teamId: z.string().uuid().nullable() }));
      if (!data) return fail("Invalid team assignment.", 400);
      const participantId = teamMatch[1]!;
      const participant = await db.prepare("SELECT id FROM participants WHERE id = ? AND activity_id = ?").bind(participantId, activityId).first();
      if (!participant) return fail("Participant not found.", 404);
      if (data.teamId && !await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(data.teamId, activityId).first()) {
        return fail("Team not found for this activity.", 404);
      }
      await db.prepare("UPDATE participants SET team_id = ? WHERE id = ?").bind(data.teamId, participantId).run();
      return json({ participantId, teamId: data.teamId });
    }
  }

  const resultsMatch = url.pathname.match(/^\/api\/owner\/activities\/([0-9a-f-]+)\/results$/i);
  if (request.method === "GET" && resultsMatch) {
    const activityId = resultsMatch[1]!;
    if (!await ownerActivity(db, activityId)) return fail("Activity not found.", 404);
    const { results } = await db.prepare(`
      SELECT p.id, p.display_name, p.team_id, p.consent_named_results, t.name AS team_name,
        sub.status AS submission_status, sub.scores_json, sub.instrument_version, sub.scoring_version
      FROM participants p LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN submissions sub ON sub.participant_id = p.id AND sub.activity_id = p.activity_id
      WHERE p.activity_id = ? ORDER BY p.joined_at
    `).bind(activityId).all();
    return json({ results, dimensions: SCARF_DIMENSIONS, demoOnly: true, warning: "Illustrative demo analytics only. No official SCARF instrument or scoring has been approved." });
  }

  return fail("Owner API route not found.", 404);
}

async function guestRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);

  if (request.method === "POST" && url.pathname === "/api/join/lookup") {
    if (!await rateLimitRequest(request, env, "lookup")) return fail("Too many attempts. Wait a few minutes and try again.", 429);
    const data = await readBody(request, JoinLookupInput);
    if (!data) return fail("Enter the six-digit activity code.", 400);
    const activity = await db.prepare(`
      SELECT a.id, a.title, a.state, a.allow_teams, a.require_name, s.name AS session_name
      FROM activities a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.join_pin = ?
    `).bind(data.pin).first<{ id: string; title: string; state: string; allow_teams: number; require_name: number; session_name: string | null }>();
    if (!activity || activity.state !== "open") return fail("That code is not available. Check it with your trainer.", 404);
    const { results: teams } = activity.allow_teams
      ? await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at").bind(activity.id).all()
      : { results: [] };
    return json({ activity: { id: activity.id, title: activity.title, sessionName: activity.session_name, requireName: Boolean(activity.require_name), demoOnly: true }, teams });
  }

  if (request.method === "POST" && url.pathname === "/api/join/enter") {
    if (!await rateLimitRequest(request, env, "enter")) return fail("Too many join attempts. Wait a few minutes and try again.", 429);
    const data = await readBody(request, JoinEnterInput);
    if (!data) return fail("Enter a display name to continue.", 400);
    const activity = await db.prepare("SELECT id, state, allow_teams, require_name FROM activities WHERE join_pin = ?").bind(data.pin).first<{ id: string; state: string; allow_teams: number; require_name: number }>();
    if (!activity || activity.state !== "open") return fail("This activity is not accepting participants.", 404);
    if (activity.allow_teams && data.teamId && !await db.prepare("SELECT id FROM teams WHERE id = ? AND activity_id = ?").bind(data.teamId, activity.id).first()) {
      return fail("Choose a team from this activity.", 400);
    }
    const displayName = data.displayName.trim() || `Guest ${crypto.getRandomValues(new Uint16Array(1))[0]!.toString().padStart(5, "0")}`;
    if (activity.require_name && !data.displayName.trim()) return fail("Enter your name to continue.", 400);
    const participantId = id();
    const token = randomToken();
    await db.prepare(`
      INSERT INTO participants (id, activity_id, team_id, display_name, role, consent_named_results, token_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(participantId, activity.id, activity.allow_teams ? (data.teamId ?? null) : null, displayName, data.role, data.consentNamedResults ? 1 : 0, await sha256(token)).run();
    return json({ token, participant: { id: participantId, activityId: activity.id, displayName, teamId: data.teamId ?? null }, demoOnly: true }, 201);
  }

  if (!url.pathname.startsWith("/api/guest/")) return fail("Public API route not found.", 404);
  const participant = await guestParticipant(request, db);
  if (!participant) return fail("Participant link is invalid or expired. Rejoin using the activity code.", 401);

  if (request.method === "GET" && url.pathname === "/api/guest/me") {
    const activity = await ownerActivity(db, participant.activity_id);
    const sub = await db.prepare("SELECT status, updated_at FROM submissions WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first();
    return json({ participant: { id: participant.id, displayName: participant.display_name, teamId: participant.team_id }, activity: { id: activity?.id, title: activity?.title, state: activity?.state, resultPolicy: activity?.result_policy }, submission: sub, demoOnly: true });
  }

  if (request.method === "GET" && url.pathname === "/api/guest/activity") {
    const activity = await ownerActivity(db, participant.activity_id);
    if (!activity) return fail("Activity is no longer available.", 404);
    const submission = await db.prepare("SELECT status, answers_json FROM submissions WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ status: string; answers_json: string }>();
    const answers = submission?.answers_json ? JSON.parse(submission.answers_json) as Record<string, number> : {};
    return json({
      activity: { id: activity.id, title: activity.title, state: activity.state, resultPolicy: activity.result_policy },
      participant: { displayName: participant.display_name },
      items: DEMO_ITEMS,
      answers,
      demoOnly: true,
      disclosure: "DEMO ONLY. These placeholder prompts and scores are not an approved or validated SCARF assessment.",
    });
  }

  if (request.method === "POST" && ["/api/guest/draft", "/api/guest/submit"].includes(url.pathname)) {
    const data = await readBody(request, AnswersInput);
    const isSubmit = url.pathname.endsWith("/submit");
    if (!data || !validateDemoAnswers(data.answers, isSubmit)) return fail(isSubmit ? "Answer each demo statement before submitting." : "One or more answers are invalid.", 400);
    const activity = await ownerActivity(db, participant.activity_id);
    if (!activity || !["open", "paused"].includes(activity.state)) return fail("This activity is no longer accepting changes.", 409);
    const answers = Object.fromEntries(Object.entries(data.answers).sort(([left], [right]) => Number(left) - Number(right)));
    const answersJson = JSON.stringify(answers);
    const payloadHash = await sha256(answersJson);
    const existing = await db.prepare("SELECT status, payload_hash FROM submissions WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ status: string; payload_hash: string | null }>();
    if (existing?.status === "submitted") {
      if (existing.payload_hash === payloadHash) return json({ submitted: true, alreadySubmitted: true, demoOnly: true });
      return fail("This response has already been submitted and cannot be changed.", 409);
    }
    const scores = isSubmit ? JSON.stringify(scoreDemoResponses(answers as Record<number, number>)) : null;
    await db.prepare(`
      INSERT INTO submissions (id, activity_id, participant_id, answers_json, scores_json, status, instrument_version, scoring_version, payload_hash, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'submitted' THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT(activity_id, participant_id) DO UPDATE SET
        answers_json = excluded.answers_json,
        scores_json = excluded.scores_json,
        status = excluded.status,
        payload_hash = excluded.payload_hash,
        submitted_at = excluded.submitted_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id(), participant.activity_id, participant.id, answersJson, scores, isSubmit ? "submitted" : "draft", activity.instrument_version, activity.scoring_version, isSubmit ? payloadHash : null, isSubmit ? "submitted" : "draft").run();
    return json({ saved: !isSubmit, submitted: isSubmit, demoOnly: true });
  }

  if (request.method === "GET" && url.pathname === "/api/guest/results") {
    const activity = await ownerActivity(db, participant.activity_id);
    const submission = await db.prepare("SELECT status, scores_json, instrument_version, scoring_version FROM submissions WHERE activity_id = ? AND participant_id = ?").bind(participant.activity_id, participant.id).first<{ status: string; scores_json: string | null; instrument_version: string; scoring_version: string }>();
    if (!activity || submission?.status !== "submitted") return json({ visible: false, reason: "not-submitted" });
    const presentation = await db.prepare("SELECT revealed FROM presentation_state WHERE activity_id = ?").bind(participant.activity_id).first<{ revealed: number }>();
    const visible = activity.result_policy === "immediate" || (activity.result_policy === "trainer_reveal" && Boolean(presentation?.revealed));
    if (!visible) return json({ visible: false, reason: activity.result_policy === "confirmation" ? "confirmation-only" : "waiting-for-trainer" });
    return json({ visible: true, scores: JSON.parse(submission.scores_json ?? "{}"), dimensions: SCARF_DIMENSIONS, instrumentVersion: submission.instrument_version, scoringVersion: submission.scoring_version, demoOnly: true });
  }

  return fail("Participant API route not found.", 404);
}

async function presenterRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return fail("Presenter endpoint is read-only.", 405);
  const db = database(env);
  if (!db) return fail("D1 database is not configured.", 503);
  const token = bearerToken(request);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return fail("Presenter link not found.", 404);
  const tokenHash = await sha256(token);
  const activity = await db.prepare(`
    SELECT a.id, a.title, a.state, a.result_policy, p.revealed, p.comparison_basis, p.selected_team_id, p.show_names, p.prompt_index
    FROM activities a JOIN presentation_state p ON p.activity_id = a.id WHERE a.presenter_token_hash = ?
  `).bind(tokenHash).first<{ id: string; title: string; state: string; result_policy: string; revealed: number; comparison_basis: string; selected_team_id: string | null; show_names: number; prompt_index: number }>();
  if (!activity) return fail("Presenter link not found.", 404);
  if (!activity.revealed) return json({ revealed: false, title: activity.title, state: activity.state });
  const teams = await db.prepare("SELECT id, name FROM teams WHERE activity_id = ? ORDER BY created_at").bind(activity.id).all<{ id: string; name: string }>();
  const participants = await db.prepare(`
    SELECT p.id, p.display_name, p.consent_named_results, p.team_id, t.name AS team_name, sub.scores_json
    FROM participants p LEFT JOIN teams t ON t.id = p.team_id
    JOIN submissions sub ON sub.participant_id = p.id AND sub.activity_id = p.activity_id AND sub.status = 'submitted'
    WHERE p.activity_id = ? ORDER BY p.joined_at
  `).bind(activity.id).all<{ id: string; display_name: string; consent_named_results: number; team_id: string | null; team_name: string | null; scores_json: string | null }>();
  const selected = activity.selected_team_id
    ? participants.results.filter((row) => row.team_id === activity.selected_team_id)
    : participants.results;
  const groupForRelative = activity.selected_team_id
    ? participants.results.filter((row) => row.team_id === activity.selected_team_id)
    : participants.results;
  const decoded = selected.map((row, index) => ({
    label: activity.show_names && row.consent_named_results ? row.display_name : `Guest ${String(index + 1).padStart(2, "0")}`,
    teamName: row.team_name,
    scores: JSON.parse(row.scores_json ?? "{}") as Record<string, number>,
  }));
  const rows = decoded.map((row) => ({
    ...row,
    tiers: Object.fromEntries(SCARF_DIMENSIONS.map((dimension) => {
      const comparisonValues = activity.comparison_basis === "within_person"
        ? SCARF_DIMENSIONS.map((item) => row.scores[item])
        : groupForRelative.map((item) => Number(JSON.parse(item.scores_json ?? "{}")[dimension]));
      return [dimension, relativeTier(row.scores[dimension] ?? 0, comparisonValues)];
    })),
  }));
  const teamName = teams.results.find((team) => team.id === activity.selected_team_id)?.name ?? "All teams";
  const dimensions = SCARF_DIMENSIONS.map((dimension) => {
    const values = groupForRelative.map((row) => Number(JSON.parse(row.scores_json ?? "{}")[dimension])).filter(Number.isFinite);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { name: dimension, mean: Number(mean.toFixed(1)) };
  });
  return json({
    revealed: true,
    activity: { title: activity.title, state: activity.state },
    presentation: { comparisonBasis: activity.comparison_basis, teamName, promptIndex: activity.prompt_index, showNames: Boolean(activity.show_names) },
    rows,
    dimensions,
    participantCount: rows.length,
    warning: smallGroupWarning(rows.length),
    demoOnly: true,
    interpretation: "DEMO DATA. Labels are illustrative and unstable for small groups; they are not a diagnosis, norm, competence rating, or performance score.",
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, databaseConfigured: Boolean(env.DB), ownerAuthConfigured: ownerSetupReady(env) });
    }
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return json({ authenticated: ownerSetupReady(env) && await ownerAllowed(request, env) });
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!isSameOrigin(request)) return fail("Sign-in request origin could not be verified.", 403);
      if (!ownerSetupReady(env)) return fail("Set OWNER_PASSWORD and a 32-character SESSION_SECRET before signing in.", 503);
      if (!await rateLimitRequest(request, env, "login")) return fail("Too many sign-in attempts. Wait a few minutes and try again.", 429);
      const data = await readBody(request, z.object({ password: z.string().min(1).max(512) }));
      if (!data) return fail("Enter your owner password.", 400);
      if (!await passwordMatches(env.OWNER_PASSWORD!, data.password)) return fail("That password did not match.", 401);
      const cookie = await createOwnerCookie(env.SESSION_SECRET!);
      return json({ authenticated: true }, 200, { "Set-Cookie": ownerCookieHeader(cookie, request.url) });
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      if (!isSameOrigin(request)) return fail("Sign-out request origin could not be verified.", 403);
      return json({ authenticated: false }, 200, { "Set-Cookie": clearOwnerCookie(request.url) });
    }
    if (url.pathname.startsWith("/api/owner/")) {
      if (request.method !== "GET" && !isSameOrigin(request)) return fail("Request origin could not be verified.", 403);
      return ownerRoute(request, env, url);
    }
    if (url.pathname === "/api/presenter") return presenterRoute(request, env);
    if (url.pathname.startsWith("/api/guest/") || url.pathname.startsWith("/api/join/")) {
      if (request.method !== "GET" && !isSameOrigin(request)) return fail("Request origin could not be verified.", 403);
      return guestRoute(request, env, url);
    }
    return fail("API route not found.", 404);
  } catch {
    return fail("The request could not be completed. Try again.", 500);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
