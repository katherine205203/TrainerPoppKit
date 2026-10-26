import { z } from "zod";
import { normalizeSelection, isRunLive } from "../domain/gdm";
import { pollOwnerRoute } from "./poll";
import { scarfOwnerRoute } from "./scarf";
import { wordCloudOwnerRoute } from "./wordcloud";
import { reflectionOwnerRoute } from "./reflection-wall";
import { learningBehaviorsOwnerRoute } from "./learning-behaviors";
import { quizOwnerRoute } from "./quiz";
import { randomToken } from "./security";

type Env = { DB?: D1Database; OWNER_PASSWORD?: string; SESSION_SECRET?: string };
type Activity = { id: string; title: string; tool_id: string; state: string; session_id: string | null; session_name: string | null; current_run_id: string | null; join_pin: string | null; access_slug: string; deleted_at: string | null };
type Run = { id: string; activity_id: string; sequence: number; origin_session_id: string | null; origin_session_name: string | null; state: string; config_json: string; data_json: string | null; export_csv: string | null; is_current: number; created_at: string; started_at: string | null; ended_at: string | null; deleted_at: string | null; permanent_deleted_at: string | null };
type Manifest = { sessionIds: string[]; activityIds: string[]; runIds: string[]; sessionModes?: Record<string, "ONLY" | "ALL"> };

const OperationInput = z.object({ operationId: z.string().uuid() });
const SessionResetInput = z.object({ operationId: z.string().uuid(), branch: z.enum(["KEEP_ACTIVITIES", "KEEP_EMPTY"]), scope: z.enum(["CURRENT", "ALL"]).default("CURRENT") });
const SessionDeleteInput = z.object({ operationId: z.string().uuid(), mode: z.enum(["ONLY", "ALL"]) });
const ActivityResetInput = z.object({ operationId: z.string().uuid(), scope: z.enum(["CURRENT", "ALL"]) });
const BulkInput = z.object({ operationId: z.string().uuid(), selection: z.object({ sessionIds: z.array(z.string()).max(100), activityIds: z.array(z.string()).max(300), runIds: z.array(z.string()).max(500), sessionMode: z.enum(["ONLY", "ALL"]).optional() }) });
const BulkExportInput = z.object({ selection: z.object({ sessionIds: z.array(z.string()).max(100), activityIds: z.array(z.string()).max(300), runIds: z.array(z.string()).max(500) }), format: z.enum(["csv", "excel"]) });

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Referrer-Policy", "same-origin");
  return new Response(JSON.stringify(data), { status, headers: result });
}
function fail(message: string, status = 400): Response { return json({ error: message }, status); }
async function read<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  try { const raw = await request.json(); const parsed = schema.safeParse(raw); return parsed.success ? parsed.data : null; } catch { return null; }
}
function uuid(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }
function after30Days(at = Date.now()): string { return new Date(at + 30 * 24 * 60 * 60 * 1000).toISOString(); }
function sqlEscape(value: string): string { return Array.from(value, (character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join(""); }

async function activity(db: D1Database, activityId: string, includeDeleted = false): Promise<Activity | null> {
  return db.prepare(`SELECT a.id,a.title,a.tool_id,a.state,a.session_id,a.current_run_id,a.join_pin,a.access_slug,a.deleted_at,s.name AS session_name
    FROM activities a LEFT JOIN sessions s ON s.id=a.session_id WHERE a.id=? ${includeDeleted ? "" : "AND a.deleted_at IS NULL"}`)
    .bind(activityId).first<Activity>();
}
async function archivedQuizSessionGuard(db: D1Database, row: Activity): Promise<Response | null> {
  if (row.tool_id !== "quiz" || !row.session_id) return null;
  const session = await db.prepare("SELECT status FROM sessions WHERE id=? AND deleted_at IS NULL").bind(row.session_id).first<{status:string}>();
  return session?.status === "completed" ? fail("Reopen the archived Session before creating another Quiz Run.",409) : null;
}
async function currentRun(db: D1Database, activityId: string): Promise<Run | null> {
  return db.prepare("SELECT * FROM gdm_runs WHERE activity_id=? AND is_current=1 AND permanent_deleted_at IS NULL ORDER BY sequence DESC LIMIT 1")
    .bind(activityId).first<Run>();
}
async function runsForActivity(db: D1Database, activityId: string, includeDeleted = true): Promise<Run[]> {
  return (await db.prepare(`SELECT * FROM gdm_runs WHERE activity_id=? AND permanent_deleted_at IS NULL ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY sequence DESC`)
    .bind(activityId).all<Run>()).results;
}

async function makePin(db: D1Database): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    const exists = await db.prepare(`SELECT 1 AS found FROM activities WHERE join_pin=? UNION ALL SELECT 1 FROM sessions WHERE join_pin=? UNION ALL SELECT 1 FROM poll_session_access WHERE join_pin=? LIMIT 1`)
      .bind(pin, pin, pin).first<{ found: number }>();
    if (!exists) return pin;
  }
  throw new Error("A unique six-digit code could not be created.");
}

async function ensureSessionAccess(db: D1Database, sessionId: string): Promise<{ accessSlug: string; joinPin: string }> {
  const session = await db.prepare("SELECT access_slug,join_pin,join_generation FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId)
    .first<{ access_slug: string | null; join_pin: string | null; join_generation: number }>();
  if (!session) throw new Error("Session not found.");
  const slug = session.access_slug || randomToken().replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
  const pin = session.join_pin || await makePin(db);
  if (slug !== session.access_slug || pin !== session.join_pin) {
    await db.prepare("UPDATE sessions SET access_slug=?,join_pin=? WHERE id=?").bind(slug, pin, sessionId).run();
  }
  await db.prepare("INSERT INTO poll_session_access(session_id,access_slug,join_pin) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET access_slug=excluded.access_slug,join_pin=excluded.join_pin")
    .bind(sessionId,slug,pin).run();
  return { accessSlug: slug, joinPin: pin };
}

async function configSnapshot(db: D1Database, row: Activity): Promise<Record<string, unknown>> {
  const configTables: Record<string, string> = {
    poll: "poll_configs", scarf: "scarf_activity_configs", wordcloud: "wordcloud_configs",
    "reflection-wall": "reflection_wall_configs", "learning-behaviors-reflection": "lbr_activity_configs",
    "scarf-demo": "presentation_state",
  };
  const snapshots: Record<string, unknown> = { activity: { id: row.id, title: row.title, toolId: row.tool_id }, teams: (await db.prepare("SELECT id,name FROM teams WHERE activity_id=? ORDER BY created_at").bind(row.id).all()).results };
  const table = configTables[row.tool_id];
  if (table) snapshots[table] = await db.prepare(`SELECT * FROM ${table} WHERE activity_id=?`).bind(row.id).first();
  if (row.tool_id === "quiz") {
    snapshots.quizActivity = await db.prepare("SELECT * FROM quiz_activities WHERE activity_id=?").bind(row.id).first();
    snapshots.definition = await db.prepare("SELECT id,title,description,published_version,published_json FROM quiz_definitions WHERE id=(SELECT definition_id FROM quiz_activities WHERE activity_id=?)").bind(row.id).first();
  }
  return snapshots;
}

async function ensureCurrentRun(db: D1Database, activityId: string): Promise<Run | null> {
  const row = await activity(db, activityId);
  if (!row) return null;
  let run = await currentRun(db, activityId);
  if (run) {
    if (run.config_json === "{}") {
      const config = JSON.stringify(await configSnapshot(db, row));
      await db.prepare("UPDATE gdm_runs SET config_json=? WHERE id=? AND config_json='{}'").bind(config, run.id).run();
      run = { ...run, config_json: config };
    }
    await db.prepare("UPDATE activities SET current_run_id=? WHERE id=? AND current_run_id IS NOT ?").bind(run.id, activityId, run.id).run();
    return run;
  }
  // Quiz Activities receive their first Run only after explicit Run setup.
  if (row.tool_id === "quiz") return null;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM gdm_runs WHERE activity_id=?").bind(activityId).first<{ n: number }>();
  if (Number(count?.n ?? 0) > 0) return null;
  const sequence = 1, id = row.tool_id === "quiz" ? await db.prepare("SELECT id FROM quiz_runs WHERE activity_id=? ORDER BY sequence DESC LIMIT 1").bind(activityId).first<{ id: string }>().then((value) => value?.id) : null;
  const runId = id ?? uuid();
  const originName = row.session_name;
  const state = row.state === "paused" ? "PAUSED" : row.state === "open" ? "LIVE" : row.state === "archived" ? "ARCHIVED" : row.state === "closed" ? "CLOSED" : "READY";
  const config = JSON.stringify(await configSnapshot(db, row));
  await db.prepare(`INSERT OR IGNORE INTO gdm_runs(id,activity_id,sequence,origin_session_id,origin_session_name,state,config_json,is_current,created_at)
    VALUES(?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`).bind(runId, activityId, sequence, row.session_id, originName, state, config).run();
  run = await currentRun(db, activityId);
  if (run) await db.prepare("UPDATE activities SET current_run_id=? WHERE id=?").bind(run.id, activityId).run();
  return run;
}

async function ensureAllCurrentRuns(db: D1Database): Promise<void> {
  const rows = (await db.prepare("SELECT id FROM activities WHERE deleted_at IS NULL").all<{ id: string }>()).results;
  for (const row of rows) await ensureCurrentRun(db, row.id);
}

export async function syncRunState(db: D1Database, activityId: string): Promise<void> {
  const row = await activity(db, activityId);
  if (!row) return;
  await ensureCurrentRun(db, activityId);
  let state = row.state === "paused" ? "PAUSED" : row.state === "open" ? "LIVE" : row.state === "archived" ? "ARCHIVED" : row.state === "closed" ? "CLOSED" : "READY";
  if (row.tool_id === "quiz") {
    const quiz = await db.prepare("SELECT q.state FROM quiz_runs q JOIN gdm_runs g ON g.id=q.id WHERE g.activity_id=? AND g.is_current=1 AND q.deleted_at IS NULL")
      .bind(activityId).first<{state:string}>();
    state = !quiz ? "READY" : quiz.state === "PAUSED" ? "PAUSED" : quiz.state === "COMPLETED" ? "CLOSED" : "LIVE";
  } else if (row.tool_id === "reflection-wall") {
    const phase = await db.prepare("SELECT phase FROM reflection_wall_configs WHERE activity_id=?").bind(activityId).first<{ phase: string }>();
    if (phase?.phase === "PAUSED") state = "PAUSED"; else if (phase?.phase === "OPEN") state = "LIVE"; else if (phase?.phase === "ARCHIVED") state = "ARCHIVED"; else if (phase?.phase === "CLOSED") state = "CLOSED";
  } else if (row.tool_id === "wordcloud") {
    const phase = await db.prepare("SELECT phase FROM wordcloud_configs WHERE activity_id=?").bind(activityId).first<{ phase: string }>();
    if (phase?.phase === "OPEN") state = "LIVE"; else if (phase?.phase === "ARCHIVED") state = "ARCHIVED"; else if (phase?.phase === "CLOSED") state = "CLOSED"; else if (phase?.phase === "READY") state = "READY";
  }
  const run = await currentRun(db, activityId);
  if (run) await db.prepare("UPDATE gdm_runs SET state=?,started_at=CASE WHEN ?='LIVE' THEN COALESCE(started_at,CURRENT_TIMESTAMP) ELSE started_at END,ended_at=CASE WHEN ? IN ('CLOSED','ARCHIVED') THEN COALESCE(ended_at,CURRENT_TIMESTAMP) ELSE ended_at END WHERE id=?")
    .bind(state, state, state, run.id).run();
  if (row.tool_id === "quiz") {
    const activityState = state === "LIVE" ? "open" : state === "PAUSED" ? "paused" : state === "CLOSED" ? row.state === "archived" ? "archived" : "closed" : "draft";
    await db.prepare("UPDATE activities SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").bind(activityState, activityId).run();
  }
}

export async function registerQuizRun(env: Env, activityId: string, response: Response): Promise<void> {
  if (!response.ok || !env.DB) return;
  const payload = await response.clone().json().catch(() => null) as { run?: { id?: string; sequence?: number } } | null;
  const runId = payload?.run?.id;
  if (!runId) return;
  const db = env.DB, row = await activity(db, activityId);
  const quizRun = await db.prepare("SELECT * FROM quiz_runs WHERE id=? AND activity_id=? AND deleted_at IS NULL").bind(runId, activityId).first<Record<string, unknown>>();
  if (!row || !quizRun) return;
  const previous = await currentRun(db, activityId);
  const statements:D1PreparedStatement[]=[];
  if (previous && previous.id !== runId) {
    const snapshot=await snapshotRunStatement(env,row,previous);if(snapshot)statements.push(snapshot);
    statements.push(db.prepare("UPDATE gdm_runs SET is_current=0,state='HISTORY',ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP) WHERE id=?").bind(previous.id));
  }
  const originId = String(quizRun.origin_session_id ?? "") || null;
  const originName = String(quizRun.origin_session_name ?? "") || null;
  const origin = !originId && row.session_id ? await db.prepare("SELECT id,name FROM sessions WHERE id=?").bind(row.session_id).first<{id:string;name:string}>() : null;
  const sequence = Number(quizRun.sequence ?? payload?.run?.sequence ?? 1);
  const config = JSON.stringify({config: JSON.parse(String(quizRun.config_json ?? "{}")), quizSnapshot: String(quizRun.snapshot_json ?? "{}")});
  const pin=await makePin(db);
  statements.push(
    db.prepare("UPDATE gdm_runs SET is_current=0,state='HISTORY' WHERE activity_id=? AND is_current=1 AND id!=?").bind(activityId,runId),
    db.prepare(`INSERT INTO gdm_runs(id,activity_id,sequence,origin_session_id,origin_session_name,state,config_json,is_current,created_at,started_at)
    VALUES(?,?,?,?,?,'LIVE',?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET is_current=1,state='LIVE',deleted_at=NULL,permanent_deleted_at=NULL`)
      .bind(runId, activityId, sequence, originId ?? origin?.id ?? null, originName ?? origin?.name ?? row.session_name, config),
    db.prepare("UPDATE activities SET current_run_id=?,state='open',join_pin=?,presenter_token_hash=NULL WHERE id=?").bind(runId,pin,activityId),
  );
  await db.batch(statements);
}

async function isActivityLive(db: D1Database, activityId: string): Promise<boolean> {
  const row = await activity(db, activityId, true);
  if (!row) return false;
  if (row.tool_id === "quiz") return Boolean(await db.prepare("SELECT 1 FROM quiz_runs WHERE activity_id=? AND state!='COMPLETED' AND deleted_at IS NULL LIMIT 1").bind(activityId).first());
  if (isRunLive(row.state)) return true;
  if (row.tool_id === "reflection-wall" && await db.prepare("SELECT 1 FROM reflection_wall_configs WHERE activity_id=? AND phase IN ('OPEN','PAUSED')").bind(activityId).first()) return true;
  if (row.tool_id === "wordcloud" && await db.prepare("SELECT 1 FROM wordcloud_configs WHERE activity_id=? AND phase='OPEN'").bind(activityId).first()) return true;
  return false;
}
async function assertNotLive(db: D1Database, activityIds: string[]): Promise<void> {
  for (const activityId of activityIds) if (await isActivityLive(db, activityId)) throw new Error(`End the Live or Paused Run for Activity ${activityId} before this operation.`);
}

async function csvForRun(env: Env, row: Activity, runId: string): Promise<string> {
  const db = env.DB!;
  if (row.tool_id === "poll") {
    const config = await db.prepare("SELECT identity_mode,allow_other FROM poll_configs WHERE activity_id=?").bind(row.id).first<{ identity_mode: string; allow_other: number }>();
    const datasets = ["summary", ...(config?.identity_mode === "named" ? ["named"] : []), ...(config?.allow_other ? ["other"] : [])];
    const exports: string[] = [];
    for (const kind of datasets) {
      const request = new Request(`https://gdm.internal/api/owner/polls/${row.id}/export?kind=${kind}`);
      const response = await pollOwnerRoute(request, env, new URL(request.url));
      if (response?.ok) exports.push(`# ${kind.toUpperCase()}\r\n${await response.text()}`);
    }
    if (exports.length) return exports.join("\r\n\r\n");
  }
  let path = "";
  if (row.tool_id === "quiz") path = `/api/owner/quiz/runs/${runId}/results.csv`;
  else if (row.tool_id === "poll") path = `/api/owner/polls/${row.id}/export`;
  else if (row.tool_id === "wordcloud") path = `/api/owner/wordclouds/${row.id}/export`;
  else if (row.tool_id === "reflection-wall") path = `/api/owner/reflection-walls/${row.id}/export`;
  else if (row.tool_id === "learning-behaviors-reflection") path = `/api/owner/learning-behaviors/${row.id}/export`;
  else if (row.tool_id === "scarf-assessment") path = `/api/owner/scarf/activities/${row.id}/export.csv`;
  if (path) {
    const request = new Request(`https://gdm.internal${path}`);
    const url = new URL(request.url);
    const response = row.tool_id === "quiz" ? await quizOwnerRoute(request, db, url)
      : row.tool_id === "poll" ? await pollOwnerRoute(request, env, url)
      : row.tool_id === "wordcloud" ? await wordCloudOwnerRoute(request, env, url)
      : row.tool_id === "reflection-wall" ? await reflectionOwnerRoute(request, env, url)
      : row.tool_id === "learning-behaviors-reflection" ? await learningBehaviorsOwnerRoute(request, env, url)
      : await scarfOwnerRoute(request, env, url);
    if (response?.ok) return response.text();
  }
  const participants = (await db.prepare("SELECT display_name FROM participants WHERE activity_id=? ORDER BY joined_at").bind(row.id).all<{ display_name: string }>()).results;
  const submitted = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE activity_id=? AND status='submitted'").bind(row.id).first<{ n: number }>();
  const header = ["run_id", "activity", "tool", "session_origin", "joined", "submitted"];
  const values = [runId, row.title, row.tool_id, row.session_name ?? "Standalone", String(participants.length), String(submitted?.n ?? 0)];
  return [header.join(","), values.map(csvCell).join(",")].join("\r\n");
}
function csvCell(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

async function snapshotRunStatement(env: Env, row: Activity, run: Run): Promise<D1PreparedStatement | null> {
  const db = env.DB!;
  if (run.export_csv || run.data_json) return null;
  const csv = await csvForRun(env, row, run.id);
  const counts = await db.prepare(`SELECT (SELECT COUNT(*) FROM participants WHERE activity_id=?) AS participants,
    (SELECT COUNT(*) FROM submissions WHERE activity_id=? AND status='submitted') AS submitted`)
    .bind(row.id, row.id).first<{ participants: number; submitted: number }>();
  const data = JSON.stringify({ runId: run.id, activityId: row.id, toolId: row.tool_id, config: JSON.parse(run.config_json || "{}"),
    participantCount: Number(counts?.participants ?? 0), submittedCount: Number(counts?.submitted ?? 0), capturedAt: nowIso() });
  return db.prepare("UPDATE gdm_runs SET data_json=?,export_csv=?,state='CLOSED',ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP) WHERE id=? AND permanent_deleted_at IS NULL")
    .bind(data, csv, run.id);
}

function clearActivityRunStatements(db: D1Database, row: Activity): D1PreparedStatement[] {
  const id = row.id;
  const statements: D1PreparedStatement[] = [];
  if (row.tool_id === "poll") {
    statements.push(
      db.prepare("DELETE FROM poll_responses WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM poll_participations WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM poll_idempotency_requests WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM poll_control_audit WHERE activity_id=?").bind(id),
      db.prepare("UPDATE poll_configs SET reveal_state='hidden',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    );
  } else if (row.tool_id === "scarf-assessment") {
    statements.push(
      db.prepare("DELETE FROM scarf_participations WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM scarf_audit_events WHERE activity_id=?").bind(id),
      db.prepare("UPDATE scarf_activity_configs SET results_released_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    );
  } else if (row.tool_id === "wordcloud") {
    statements.push(
      db.prepare("DELETE FROM wordcloud_access_receipts WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM wordcloud_anonymous_submissions WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM wordcloud_terms WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM wordcloud_display_groups WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM wordcloud_moderation_operations WHERE activity_id=?").bind(id),
      db.prepare("UPDATE wordcloud_configs SET phase='READY',visibility='HIDDEN',presenter_revealed=0,presenter_hidden_override=0,presenter_team_filter=NULL,revision=revision+1,presentation_revision=presentation_revision+1,active_team_filter=NULL,archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    );
  } else if (row.tool_id === "reflection-wall") {
    statements.push(
      db.prepare("DELETE FROM reflection_wall_reactions WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM reflection_wall_comments WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM reflection_wall_posts WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM reflection_wall_actors WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM reflection_wall_clusters WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM reflection_wall_events WHERE activity_id=?").bind(id),
      db.prepare("UPDATE reflection_wall_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(id),
      db.prepare("UPDATE reflection_wall_configs SET phase='DRAFT',presentation_mode='off',focus_column_id=NULL,spotlight_post_id=NULL,focus_cluster_id=NULL,started_once=0,archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    );
  } else if (row.tool_id === "learning-behaviors-reflection") {
    statements.push(
      db.prepare("UPDATE lbr_peer_rounds SET status='DRAFT' WHERE activity_id=?").bind(id),
      db.prepare("DELETE FROM lbr_progress WHERE activity_id=?").bind(id),
      db.prepare("UPDATE lbr_activity_configs SET content_frozen_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    );
  }
  statements.push(
    db.prepare("DELETE FROM participants WHERE activity_id=?").bind(id),
    db.prepare("DELETE FROM submissions WHERE activity_id=?").bind(id),
    db.prepare("UPDATE presentation_state SET revealed=0,selected_team_id=NULL,prompt_index=0,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(id),
    db.prepare("UPDATE scarf_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(id),
  );
  return statements;
}

async function newRunPlan(db: D1Database, row: Activity, oldRun: Run | null, sequence: number, state: "READY" | "LIVE" = "LIVE"): Promise<{runId:string;pin:string;statements:D1PreparedStatement[]}> {
  const pin=await makePin(db),runId=uuid(),statements:D1PreparedStatement[]=[];
  if(row.tool_id!=="quiz") {
    const config=await configSnapshot(db,row);
    const originName=row.session_id?await db.prepare("SELECT name FROM sessions WHERE id=?").bind(row.session_id).first<{name:string}>().then((value)=>value?.name??row.session_name):null;
    statements.push(
      db.prepare("UPDATE gdm_runs SET is_current=0,state='HISTORY',ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP) WHERE activity_id=? AND is_current=1").bind(row.id),
      db.prepare(`INSERT INTO gdm_runs(id,activity_id,sequence,origin_session_id,origin_session_name,state,config_json,is_current,created_at)
        VALUES(?,?,?,?,?,'READY',?,1,CURRENT_TIMESTAMP)`).bind(runId,row.id,sequence,row.session_id,originName,JSON.stringify(config)),
      db.prepare("UPDATE activities SET current_run_id=?,state='draft',join_pin=?,presenter_token_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(runId,pin,row.id),
    );
    return {runId,pin,statements};
  }
  const previous = oldRun ? await db.prepare("SELECT * FROM quiz_runs WHERE id=?").bind(oldRun.id).first<Record<string, unknown>>() : null;
  const saved = oldRun?.config_json ? JSON.parse(oldRun.config_json) as {config?:Record<string,unknown>;snapshot?:string;quizSnapshot?:string} : null;
  const config = previous?.config_json ? JSON.parse(String(previous.config_json)) as Record<string, unknown> : saved?.config ?? { name: `Run ${sequence}`, runType: "LIVE", competitionMode: "INDIVIDUAL", hostingMode: "MANUAL", scoringMode: "ACCURACY", teams: [] };
  const oldSnapshot = previous?.snapshot_json ? String(previous.snapshot_json) : saved?.snapshot ?? saved?.quizSnapshot ?? await db.prepare("SELECT d.published_json FROM quiz_activities qa JOIN quiz_definitions d ON d.id=qa.definition_id WHERE qa.activity_id=?").bind(row.id).first<{ published_json: string }>().then((value) => value?.published_json ?? "{}");
  const runName = typeof config.name === "string" ? config.name : `Run ${sequence}`;
  const origin = row.session_id ? await db.prepare("SELECT name FROM sessions WHERE id=?").bind(row.session_id).first<{ name: string }>() : null;
  statements.push(
    db.prepare(`INSERT INTO quiz_runs(id,activity_id,sequence,name,run_type,competition_mode,hosting_mode,scoring_mode,config_json,snapshot_json,state,phase,revision,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'LOBBY_OPEN','LOBBY',1,CURRENT_TIMESTAMP)`)
      .bind(runId,row.id,sequence,runName,String(config.runType??"LIVE"),config.runType === "LIVE" ? config.competitionMode ?? "INDIVIDUAL" : null,
        config.runType === "LIVE" ? config.hostingMode ?? "MANUAL" : null,config.runType === "LIVE" ? config.scoringMode ?? "ACCURACY" : null,JSON.stringify(config),oldSnapshot),
    db.prepare("UPDATE gdm_runs SET is_current=0,state='HISTORY' WHERE activity_id=? AND is_current=1").bind(row.id),
    db.prepare(`INSERT INTO gdm_runs(id,activity_id,sequence,origin_session_id,origin_session_name,state,config_json,is_current,created_at,started_at)
      VALUES(?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(runId,row.id,sequence,row.session_id,origin?.name ?? row.session_name,state,JSON.stringify({ config, snapshot: oldSnapshot })),
    db.prepare("UPDATE activities SET current_run_id=?,state='open',join_pin=?,presenter_token_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(runId,pin,row.id),
  );
  const quizTeams = Array.isArray(config.teams) ? config.teams : [];
  if (config.runType === "LIVE" && config.competitionMode === "TEAM") {
    quizTeams.forEach((name,index) => statements.push(db.prepare("INSERT INTO quiz_run_teams(id,run_id,name,sort_order) VALUES(?,?,?,?)").bind(uuid(),runId,String(name),index)));
  }
  return {runId,pin,statements};
}

async function startNewRun(env: Env, row: Activity): Promise<{ runId: string; pin: string; sequence: number }> {
  const db = env.DB!;
  await assertNotLive(db,[row.id]);
  const oldRun=await ensureCurrentRun(db,row.id);
  const sequence = Number((await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM gdm_runs WHERE activity_id=?").bind(row.id).first<{ n: number }>())?.n ?? 1);
  const plan=await newRunPlan(db,row,oldRun,sequence);
  const statements:D1PreparedStatement[]=[];
  if(oldRun) {
    const snapshot=await snapshotRunStatement(env,row,oldRun);if(snapshot)statements.push(snapshot);
    if(row.tool_id!=="quiz")statements.push(...clearActivityRunStatements(db,row));
  }
  statements.push(...plan.statements,auditStatement(db,"START_NEW_RUN","activity",row.id,{previousRunId:oldRun?.id??null,newRunId:plan.runId}));
  await db.batch(statements);
  return {runId:plan.runId,pin:plan.pin,sequence};
}

function auditStatement(db: D1Database, action: string, type: string, objectId: string, details: Record<string, unknown> = {}): D1PreparedStatement {
  return db.prepare("INSERT INTO gdm_audit_events(id,actor,action,object_type,object_id,details_json) VALUES(?,'owner',?,?,?,?)")
    .bind(uuid(),action,type,objectId,JSON.stringify(details));
}
async function writeAudit(db: D1Database, action: string, type: string, objectId: string, details: Record<string, unknown> = {}): Promise<void> {
  await auditStatement(db,action,type,objectId,details).run();
}

async function idempotent(db: D1Database, opId: string, operation: string, targetId: string, action: () => Promise<Response>): Promise<Response> {
  const claim = await db.prepare("INSERT INTO gdm_operations(operation_id,operation_type,target_id,status) VALUES(?,?,?,'PROCESSING') ON CONFLICT(operation_id) DO NOTHING")
    .bind(opId,operation,targetId).run();
  if (Number(claim.meta.changes ?? 0) === 0) {
    const saved = await db.prepare("SELECT status,response_json FROM gdm_operations WHERE operation_id=?").bind(opId).first<{status:string;response_json:string|null}>();
    if (saved?.status === "DONE" && saved.response_json) return json(JSON.parse(saved.response_json));
    return fail("This operation is already being handled. Refresh the page before retrying.", 409);
  }
  try {
    const response = await action();
    if (!response.ok) { await db.prepare("UPDATE gdm_operations SET status='FAILED',response_json=? WHERE operation_id=?").bind(JSON.stringify(await response.clone().json().catch(()=>({error:"Operation failed."}))),opId).run(); return response; }
    const body = await response.clone().json().catch(()=>({}));
    await db.prepare("UPDATE gdm_operations SET status='DONE',response_json=? WHERE operation_id=?").bind(JSON.stringify(body),opId).run();
    return response;
  } catch (error) {
    await db.prepare("UPDATE gdm_operations SET status='FAILED',response_json=? WHERE operation_id=?").bind(JSON.stringify({error:error instanceof Error?error.message:"Operation failed."}),opId).run();
    return fail(error instanceof Error ? error.message : "The operation could not be completed.", 409);
  }
}

function makeTrashPackagePlan(db: D1Database, type: "SESSION" | "ACTIVITY" | "RUN" | "BULK", action: string, label: string, manifest: Manifest): {id:string;statement:D1PreparedStatement} {
  const id = uuid(), deletedAt = nowIso();
  const statement=db.prepare("INSERT INTO gdm_trash_packages(id,item_type,action,label,manifest_json,deleted_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id,type,action,label,JSON.stringify(manifest),deletedAt,after30Days());
  return {id,statement};
}

async function removeRunsFromTrashPackageStatements(db: D1Database, runIds: string[]): Promise<D1PreparedStatement[]> {
  if (!runIds.length) return [];
  const placeholders = runIds.map(() => "?").join(",");
  const packages = (await db.prepare(`SELECT DISTINCT p.id,p.manifest_json FROM gdm_trash_packages p JOIN gdm_runs r ON r.trash_package_id=p.id WHERE r.id IN (${placeholders})`)
    .bind(...runIds).all<{ id: string; manifest_json: string }>()).results;
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const pkg of packages) {
    const manifest = JSON.parse(pkg.manifest_json) as Manifest;
    manifest.runIds = manifest.runIds.filter((runId) => !runIds.includes(runId));
    const empty = !manifest.runIds.length && !manifest.activityIds.length && !manifest.sessionIds.length;
    statements.push(db.prepare("UPDATE gdm_trash_packages SET manifest_json=?,purged_at=CASE WHEN ? THEN ? ELSE purged_at END WHERE id=?")
      .bind(JSON.stringify(manifest), empty ? 1 : 0, now, pkg.id));
  }
  return statements;
}

async function endActivityIntoTrashStatements(env: Env, row: Activity, packageId: string, trashRunIds: string[], trashActivity: boolean): Promise<D1PreparedStatement[]> {
  const db = env.DB!;
  await ensureCurrentRun(db,row.id);
  const runs = await runsForActivity(db,row.id,true);
  const run = runs.find((candidate)=>candidate.is_current===1);
  const statements:D1PreparedStatement[]=[];
  if (run) { const snapshot=await snapshotRunStatement(env,row,run);if(snapshot)statements.push(snapshot); }
  const ids = trashRunIds.length ? (await db.prepare(`SELECT id FROM gdm_runs WHERE activity_id=? AND id IN (${trashRunIds.map(()=>"?").join(",")})`).bind(row.id,...trashRunIds).all<{id:string}>()).results.map((item)=>item.id) : [];
  if (trashActivity) statements.push(...clearActivityRunStatements(db,row));
  const now = nowIso();
  const oldPackages = ids.length ? await db.prepare(`SELECT DISTINCT trash_package_id FROM gdm_runs WHERE activity_id=? AND trash_package_id IS NOT NULL AND id IN (${ids.map(()=>"?").join(",")})`)
    .bind(row.id,...ids).all<{trash_package_id:string}>() : {results:[] as Array<{trash_package_id:string}>};
  for (const runId of ids) {
    statements.push(
      db.prepare("UPDATE gdm_runs SET deleted_at=?,trash_package_id=?,is_current=0,state='HISTORY' WHERE id=? AND permanent_deleted_at IS NULL").bind(now,packageId,runId),
      db.prepare("UPDATE quiz_runs SET deleted_at=? WHERE id=? AND permanent_deleted_at IS NULL").bind(now,runId),
    );
  }
  if (trashActivity) {
    statements.push(db.prepare("UPDATE activities SET deleted_at=?,state='archived',join_pin=NULL,current_run_id=NULL,presenter_token_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(now,row.id),...moduleUnavailableStatements(db,row.id,row.tool_id,true));
  }
  for (const pkg of oldPackages.results) statements.push(db.prepare("UPDATE gdm_trash_packages SET restored_at=? WHERE id=? AND restored_at IS NULL AND purged_at IS NULL").bind(now,pkg.trash_package_id));
  return statements;
}

function moduleUnavailableStatements(db: D1Database, activityId: string, toolId: string, deleted: boolean): D1PreparedStatement[] {
  const phase = deleted ? "ARCHIVED" : "CLOSED";
  const statements:D1PreparedStatement[]=[];
  if (toolId === "wordcloud") statements.push(db.prepare("UPDATE wordcloud_configs SET phase=?,visibility='HIDDEN',presenter_revealed=0,presenter_hidden_override=0,presenter_team_filter=NULL,presentation_revision=presentation_revision+1,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(phase,activityId));
  if (toolId === "reflection-wall") statements.push(
    db.prepare("UPDATE reflection_wall_configs SET phase=?,presentation_mode='off',updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(phase,activityId),
    db.prepare("UPDATE reflection_wall_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(activityId),
  );
  if (toolId === "poll") statements.push(db.prepare("UPDATE poll_configs SET reveal_state='hidden',updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(activityId));
  if (toolId === "scarf-assessment") statements.push(db.prepare("UPDATE scarf_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(activityId));
  return statements;
}

async function resetActivity(env: Env, row: Activity, scope: "CURRENT" | "ALL"): Promise<{ runId: string; pin: string }> {
  const db = env.DB!;
  await assertNotLive(db,[row.id]);
  const current = await ensureCurrentRun(db,row.id);
  const all = await runsForActivity(db,row.id,true);
  const targets = scope === "ALL" ? all.filter((run)=>!run.permanent_deleted_at) : all.filter((run)=>run.id===current?.id);
  const currentTarget = current && targets.some((run)=>run.id===current.id) ? current : null;
  const sequence=Number((await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM gdm_runs WHERE activity_id=?").bind(row.id).first<{n:number}>())?.n??1);
  const created=await newRunPlan(db,row,currentTarget,sequence),now=nowIso();
  const statements=await removeRunsFromTrashPackageStatements(db,targets.map((run)=>run.id));
  for(const target of targets) {
    statements.push(db.prepare("UPDATE gdm_runs SET data_json=NULL,export_csv=NULL,deleted_at=NULL,permanent_deleted_at=?,trash_package_id=NULL,is_current=0,state='HISTORY' WHERE id=?")
      .bind(now,target.id));
    if(row.tool_id==="quiz")statements.push(db.prepare("DELETE FROM quiz_runs WHERE id=?").bind(target.id));
  }
  if(currentTarget)statements.push(...clearActivityRunStatements(db,row));
  statements.push(...created.statements,auditStatement(db,"RESET_ACTIVITY_RUNS","activity",row.id,{scope,removedRunCount:targets.length,newRunId:created.runId}));
  await db.batch(statements);
  return {runId:created.runId,pin:created.pin};
}

async function deleteRun(env: Env, run: Run): Promise<{ packageId: string }> {
  const db = env.DB!, row = await activity(db,run.activity_id);
  if (!row) throw new Error("Activity not found.");
  await assertNotLive(db,[row.id]);
  if (run.permanent_deleted_at) throw new Error("This Run has already been permanently removed.");
  if (run.deleted_at) throw new Error("This Run is already in Trash.");
  const trash=makeTrashPackagePlan(db,"RUN","DELETE_RUN",`${row.title} · Run ${run.sequence}`,{sessionIds:[],activityIds:[],runIds:[run.id]});
  const now = nowIso();
  const statements=[trash.statement];
  if(run.is_current) { const snapshot=await snapshotRunStatement(env,row,run);if(snapshot)statements.push(snapshot); }
  if (run.is_current) {
    if (row.tool_id !== "quiz") statements.push(...clearActivityRunStatements(db,row));
    statements.push(db.prepare("UPDATE activities SET current_run_id=NULL,state='closed',join_pin=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id));
  }
  statements.push(
    db.prepare("UPDATE gdm_runs SET deleted_at=?,trash_package_id=?,is_current=0,state='HISTORY' WHERE id=?").bind(now,trash.id,run.id),
    db.prepare("UPDATE quiz_runs SET deleted_at=? WHERE id=?").bind(now,run.id),
    auditStatement(db,"DELETE_RUN","run",run.id,{activityId:row.id,sequence:run.sequence,trashPackageId:trash.id}),
  );
  await db.batch(statements);
  return { packageId:trash.id };
}

async function deleteSelection(env: Env, selection: Manifest): Promise<{ packageId: string; affected: Manifest }> {
  const db = env.DB!;
  const sessionRows: Array<{id:string;name:string}> = [];
  for (const id of selection.sessionIds) {
    const session=await db.prepare("SELECT id,name FROM sessions WHERE id=? AND deleted_at IS NULL").bind(id).first<{id:string;name:string}>();
    if(!session)throw new Error("A selected Session is no longer available."); sessionRows.push(session);
  }
  const activityIds=new Set(selection.activityIds);
  const runIds=new Set(selection.runIds);
  for(const session of sessionRows) if(selection.sessionModes?.[session.id]==="ALL") {
    const children=(await db.prepare("SELECT id FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(session.id).all<{id:string}>()).results;
    children.forEach((item)=>activityIds.add(item.id));
  }
  for(const activityId of activityIds) {
    const row=await activity(db,activityId);if(!row)throw new Error("A selected Activity is no longer available.");
    await ensureCurrentRun(db,activityId);
    const runs=await runsForActivity(db,activityId,true); runs.filter((run)=>!run.permanent_deleted_at).forEach((run)=>runIds.add(run.id));
  }
  const affected: Manifest={sessionIds:sessionRows.map((s)=>s.id),activityIds:[...activityIds],runIds:[...runIds],sessionModes:selection.sessionModes};
  const guardActivities=new Set(affected.activityIds);
  for(const session of sessionRows)for(const child of (await db.prepare("SELECT id FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(session.id).all<{id:string}>()).results)guardActivities.add(child.id);
  for(const runId of affected.runIds){const found=await db.prepare("SELECT activity_id FROM gdm_runs WHERE id=? AND permanent_deleted_at IS NULL").bind(runId).first<{activity_id:string}>();if(found)guardActivities.add(found.activity_id);}
  await assertNotLive(db,[...guardActivities]);
  const trash=makeTrashPackagePlan(db,"BULK","BULK_DELETE",`${affected.sessionIds.length} Sessions · ${affected.activityIds.length} Activities`,affected);
  const now=nowIso(),statements:D1PreparedStatement[]=[trash.statement];
  const trashedRuns=new Set<string>();
  for(const activityId of affected.activityIds) {
    const row=await activity(db,activityId); if(!row)throw new Error("A selected Activity is no longer available.");
    const rowRuns=(await db.prepare("SELECT id FROM gdm_runs WHERE activity_id=? AND id IN (SELECT value FROM json_each(?)) AND permanent_deleted_at IS NULL")
      .bind(activityId,JSON.stringify([...runIds])).all<{id:string}>()).results.map((item)=>item.id);
    statements.push(...await endActivityIntoTrashStatements(env,row,trash.id,rowRuns,true));
    rowRuns.forEach((id)=>trashedRuns.add(id));
  }
  for(const runId of affected.runIds.filter((id)=>!trashedRuns.has(id))) {
    const run=await db.prepare("SELECT * FROM gdm_runs WHERE id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL").bind(runId).first<Run>();
    if(!run)continue;
    const row=await activity(db,run.activity_id);if(!row)continue;
    if(run.is_current){const snapshot=await snapshotRunStatement(env,row,run);if(snapshot)statements.push(snapshot);if(row.tool_id!=="quiz")statements.push(...clearActivityRunStatements(db,row));statements.push(db.prepare("UPDATE activities SET current_run_id=NULL,state='closed',join_pin=NULL WHERE id=?").bind(row.id));}
    statements.push(
      db.prepare("UPDATE gdm_runs SET deleted_at=?,trash_package_id=?,is_current=0,state='HISTORY' WHERE id=?").bind(now,trash.id,runId),
      db.prepare("UPDATE quiz_runs SET deleted_at=? WHERE id=?").bind(now,runId),
    );
    trashedRuns.add(runId);
  }
  for(const session of sessionRows) {
    const mode=selection.sessionModes?.[session.id]??"ONLY";
    if(mode==="ONLY") {
      statements.push(db.prepare("UPDATE activities SET session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND deleted_at IS NULL").bind(session.id));
    }
    statements.push(
      db.prepare("UPDATE sessions SET deleted_at=?,status='completed',join_pin=NULL WHERE id=?").bind(now,session.id),
      db.prepare("DELETE FROM session_participant_identities WHERE session_id=?").bind(session.id),
    );
  }
  statements.push(auditStatement(db,"BULK_DELETE","workspace",trash.id,{sessions:affected.sessionIds.length,activities:affected.activityIds.length,runs:affected.runIds.length}));
  await db.batch(statements);
  return {packageId:trash.id,affected};
}
async function sessionAccessRotationPlan(db: D1Database, sessionId: string): Promise<{accessSlug:string;joinPin:string;statements:D1PreparedStatement[]}> {
  const current=await db.prepare("SELECT access_slug,join_pin FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{access_slug:string|null;join_pin:string|null}>();
  if(!current)throw new Error("Session not found.");
  const accessSlug=current.access_slug||randomToken().replace(/[^a-zA-Z0-9]/g,"").slice(0,32),joinPin=await makePin(db);
  const statements=[
    db.prepare("UPDATE sessions SET access_slug=?,join_pin=?,join_generation=join_generation+1 WHERE id=?").bind(accessSlug,joinPin,sessionId),
    db.prepare("INSERT INTO poll_session_access(session_id,access_slug,join_pin) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET access_slug=excluded.access_slug,join_pin=excluded.join_pin").bind(sessionId,accessSlug,joinPin),
    db.prepare("DELETE FROM session_participant_identities WHERE session_id=?").bind(sessionId),
  ];
  return {accessSlug,joinPin,statements};
}
async function deleteActivity(env: Env, row: Activity): Promise<{packageId:string}> {
  const db=env.DB!; await assertNotLive(db,[row.id]);
  await ensureCurrentRun(db,row.id);
  const runs=await runsForActivity(db,row.id,true); const ids=runs.filter((run)=>!run.permanent_deleted_at).map((run)=>run.id);
  const trash=makeTrashPackagePlan(db,"ACTIVITY","DELETE_ACTIVITY",row.title,{sessionIds:[],activityIds:[row.id],runIds:ids});
  const statements=[trash.statement,...await endActivityIntoTrashStatements(env,row,trash.id,ids,true),auditStatement(db,"DELETE_ACTIVITY","activity",row.id,{trashPackageId:trash.id,runCount:ids.length})];
  await db.batch(statements);
  return {packageId:trash.id};
}

async function deleteSession(env: Env, sessionId: string, mode: "ONLY" | "ALL"): Promise<{packageId:string;activityCount:number;runCount:number}> {
  const db=env.DB!;
  const session=await db.prepare("SELECT id,name FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{id:string;name:string}>();
  if(!session)throw new Error("Session not found.");
  const activities=(await db.prepare("SELECT id,title,tool_id,state,session_id,join_pin,current_run_id,deleted_at,(SELECT name FROM sessions WHERE id=activities.session_id) AS session_name FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(sessionId).all<Activity>()).results;
  await assertNotLive(db,activities.map((item)=>item.id));
  for(const row of activities)await ensureCurrentRun(db,row.id);
  const runIds=mode==="ALL"?(await db.prepare("SELECT id FROM gdm_runs WHERE activity_id IN (SELECT id FROM activities WHERE session_id=?) AND permanent_deleted_at IS NULL").bind(sessionId).all<{id:string}>()).results.map((item)=>item.id):[];
  const manifest:Manifest={sessionIds:[sessionId],activityIds:mode==="ALL"?activities.map((item)=>item.id):[],runIds,sessionModes:{[sessionId]:mode}};
  const trash=makeTrashPackagePlan(db,"SESSION",mode==="ALL"?"DELETE_SESSION_ALL":"DELETE_SESSION_ONLY",session.name,manifest);
  const now=nowIso(),statements:D1PreparedStatement[]=[trash.statement];
  if(mode==="ALL") for(const row of activities) {
    const rowRuns=(await db.prepare("SELECT id FROM gdm_runs WHERE activity_id=? AND id IN (SELECT value FROM json_each(?)) AND permanent_deleted_at IS NULL").bind(row.id,JSON.stringify(runIds)).all<{id:string}>()).results.map((item)=>item.id);
    statements.push(...await endActivityIntoTrashStatements(env,row,trash.id,rowRuns,true));
  }
  else statements.push(db.prepare("UPDATE activities SET session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND deleted_at IS NULL").bind(sessionId));
  statements.push(
    db.prepare("UPDATE sessions SET deleted_at=?,status='completed',join_pin=NULL WHERE id=?").bind(now,sessionId),
    db.prepare("DELETE FROM session_participant_identities WHERE session_id=?").bind(sessionId),
    auditStatement(db,mode==="ALL"?"DELETE_SESSION_ALL":"DELETE_SESSION_ONLY","session",sessionId,{activityCount:manifest.activityIds.length,runCount:runIds.length,trashPackageId:trash.id}),
  );
  await db.batch(statements);
  return {packageId:trash.id,activityCount:manifest.activityIds.length,runCount:runIds.length};
}

async function resetSession(env: Env, sessionId: string, branch: "KEEP_ACTIVITIES" | "KEEP_EMPTY", scope: "CURRENT" | "ALL"): Promise<Record<string, unknown>> {
  const db=env.DB!, session=await db.prepare("SELECT id,name FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{id:string;name:string}>();
  if(!session)throw new Error("Session not found.");
  const activities=(await db.prepare("SELECT id,title,tool_id,state,session_id,current_run_id,join_pin,deleted_at,(SELECT name FROM sessions WHERE id=activities.session_id) AS session_name FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(sessionId).all<Activity>()).results;
  await assertNotLive(db,activities.map((row)=>row.id));
  const accessPlan=await sessionAccessRotationPlan(db,sessionId),access={accessSlug:accessPlan.accessSlug,joinPin:accessPlan.joinPin};
  if(branch==="KEEP_EMPTY") {
    await db.batch([...accessPlan.statements,
      db.prepare("UPDATE activities SET session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND deleted_at IS NULL").bind(sessionId),
      db.prepare("UPDATE sessions SET status='upcoming',archived_at=NULL,archive_manifest_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId),
      auditStatement(db,"RESET_SESSION_KEEP_EMPTY","session",sessionId,{detachedActivities:activities.length}),
    ]);
    return {branch,detachedActivities:activities.length,access};
  }
  for(const item of activities)await ensureCurrentRun(db,item.id);
  const allRuns=(await db.prepare("SELECT * FROM gdm_runs WHERE origin_session_id=? AND permanent_deleted_at IS NULL ORDER BY activity_id,sequence").bind(sessionId).all<Run>()).results;
  const resetRuns=allRuns.filter((run)=>scope==="ALL" || run.is_current===1);
  const statements=await removeRunsFromTrashPackageStatements(db,resetRuns.map((run)=>run.id));
  const replacedActivities=new Set<string>(),replaced=new Set<string>(),now=nowIso();
  for(const run of resetRuns) {
    const row=activities.find((item)=>item.id===run.activity_id) ?? await activity(db,run.activity_id,true);
    if(!row)continue;
    const replacesCurrent=run.is_current===1 && row.current_run_id===run.id;
    statements.push(db.prepare("UPDATE gdm_runs SET data_json=NULL,export_csv=NULL,deleted_at=NULL,trash_package_id=NULL,permanent_deleted_at=?,is_current=0,state='HISTORY' WHERE id=?")
      .bind(now,run.id));
    if(row.tool_id==="quiz")statements.push(db.prepare("DELETE FROM quiz_runs WHERE id=?").bind(run.id));
    if(replacesCurrent&&!replaced.has(row.id)) {
      if(row.tool_id!=="quiz")statements.push(...clearActivityRunStatements(db,row));
      const sequence=Number((await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM gdm_runs WHERE activity_id=?").bind(row.id).first<{n:number}>())?.n??1);
      const plan=await newRunPlan(db,row,run,sequence);
      statements.push(...plan.statements);
      replacedActivities.add(row.id);replaced.add(row.id);
    }
  }
  statements.push(...accessPlan.statements,
    db.prepare("UPDATE sessions SET status='upcoming',archived_at=NULL,archive_manifest_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId),
    auditStatement(db,"RESET_SESSION_KEEP_ACTIVITIES","session",sessionId,{scope,permanentlyRemovedRuns:resetRuns.length,newRuns:replacedActivities.size}));
  await db.batch(statements);
  return {branch,scope,permanentlyRemovedRuns:resetRuns.length,newRuns:replacedActivities.size,access};
}

async function archiveSession(db: D1Database, sessionId: string): Promise<Response> {
  const session=await db.prepare("SELECT id,status FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{id:string;status:string}>();
  if(!session)return fail("Session not found.",404);
  if(session.status==="completed")return fail("Session is already archived.",409);
  const activities=(await db.prepare("SELECT id,title,tool_id,state,session_id,current_run_id,join_pin,deleted_at,(SELECT name FROM sessions WHERE id=activities.session_id) AS session_name FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(sessionId).all<Activity>()).results;
  try{await assertNotLive(db,activities.map((row)=>row.id));}catch(error){return fail(error instanceof Error?error.message:"End all active Runs before archiving this Session.",409);}
  const references:Array<{activityId:string;title:string;toolId:string;runIds:string[]}> = [];
  const statements:D1PreparedStatement[]=[];
  for(const row of activities) {
    await ensureCurrentRun(db,row.id);
    const runRows=(await db.prepare("SELECT * FROM gdm_runs WHERE activity_id=? AND origin_session_id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL ORDER BY sequence").bind(row.id,sessionId).all<Run>()).results;
    const current=runRows.find((run)=>run.is_current===1);
    if(current){const snapshot=await snapshotRunStatement({DB:db},row,current);if(snapshot)statements.push(snapshot);}
    references.push({activityId:row.id,title:row.title,toolId:row.tool_id,runIds:runRows.map((run)=>run.id)});
  }
  statements.push(db.prepare("UPDATE sessions SET status='completed',archived_at=CURRENT_TIMESTAMP,archive_manifest_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(JSON.stringify({sessionId,activities:references,archivedAt:nowIso()}),sessionId));
  await db.batch(statements);
  return json({status:"completed",activityCount:references.length,runCount:references.reduce((sum,item)=>sum+item.runIds.length,0)});
}

async function restorePackage(db: D1Database, packageId: string): Promise<Record<string, unknown>> {
  const pkg=await db.prepare("SELECT * FROM gdm_trash_packages WHERE id=? AND restored_at IS NULL AND purged_at IS NULL AND expires_at>?").bind(packageId,nowIso())
    .first<{id:string;manifest_json:string;label:string;item_type:string}>();
  if(!pkg)throw new Error("This Trash item has expired or is no longer available.");
  const manifest=JSON.parse(pkg.manifest_json) as Manifest, now=nowIso();
  let restoredRuns=0,restoredActivities=0;
  const statements:D1PreparedStatement[]=[];
  for(const runId of manifest.runIds) {
    const run=await db.prepare("SELECT id,activity_id,permanent_deleted_at FROM gdm_runs WHERE id=? AND trash_package_id=?").bind(runId,packageId).first<{id:string;activity_id:string;permanent_deleted_at:string|null}>();
    if(!run||run.permanent_deleted_at)continue;
    statements.push(
      db.prepare("UPDATE gdm_runs SET deleted_at=NULL,trash_package_id=NULL,is_current=0,state='HISTORY' WHERE id=?").bind(runId),
      db.prepare("UPDATE quiz_runs SET deleted_at=NULL WHERE id=? AND permanent_deleted_at IS NULL").bind(runId),
    );
    restoredRuns++;
  }
  for(const activityId of manifest.activityIds) {
    const row=await activity(db,activityId,true); if(!row)continue;
    statements.push(
      db.prepare("UPDATE activities SET deleted_at=NULL,state='closed',join_pin=NULL,current_run_id=NULL,presenter_token_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(activityId),
      db.prepare("UPDATE gdm_runs SET deleted_at=NULL,trash_package_id=NULL,is_current=0,state='HISTORY' WHERE activity_id=? AND trash_package_id=? AND permanent_deleted_at IS NULL").bind(activityId,packageId),
      db.prepare("UPDATE quiz_runs SET deleted_at=NULL WHERE activity_id=? AND permanent_deleted_at IS NULL").bind(activityId),
      ...moduleUnavailableStatements(db,activityId,row.tool_id,false),
    );
    restoredActivities++;
  }
  for(const sessionId of manifest.sessionIds) {
    const session=await db.prepare("SELECT access_slug FROM sessions WHERE id=?").bind(sessionId).first<{access_slug:string|null}>();
    if(!session)continue;
    const accessSlug=session.access_slug||randomToken().replace(/[^a-zA-Z0-9]/g,"").slice(0,32),joinPin=await makePin(db);
    statements.push(
      db.prepare("UPDATE sessions SET deleted_at=NULL,status='draft',access_slug=?,join_pin=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(accessSlug,joinPin,sessionId),
      db.prepare("INSERT INTO poll_session_access(session_id,access_slug,join_pin) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET access_slug=excluded.access_slug,join_pin=excluded.join_pin").bind(sessionId,accessSlug,joinPin),
    );
  }
  statements.push(
    db.prepare("UPDATE gdm_trash_packages SET restored_at=? WHERE id=?").bind(now,packageId),
    auditStatement(db,"RESTORE_TRASH_PACKAGE",pkg.item_type.toLowerCase(),packageId,{restoredActivities,restoredRuns,sessionCount:manifest.sessionIds.length}),
  );
  await db.batch(statements);
  return {restored:true,restoredActivities,restoredRuns,restoredSessions:manifest.sessionIds.length,label:pkg.label};
}

async function listArchive(db: D1Database): Promise<Record<string, unknown>> {
  await ensureAllCurrentRuns(db);
  const sessions=(await db.prepare(`SELECT s.id,s.name,s.description,s.status,s.starts_at,s.updated_at,s.archived_at,s.archive_manifest_json,s.access_slug,s.join_pin,
    (SELECT COUNT(*) FROM activities a WHERE a.session_id=s.id AND a.deleted_at IS NULL) AS activity_count
    FROM sessions s WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC`).all<Record<string,unknown>>()).results;
  const activities=(await db.prepare(`SELECT a.id,a.title,a.tool_id,a.state,a.session_id,a.current_run_id,a.join_pin,a.updated_at,s.name AS session_name
    FROM activities a LEFT JOIN sessions s ON s.id=a.session_id WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC`).all<Record<string,unknown>>()).results;
  const runs=(await db.prepare(`SELECT r.*,a.title AS activity_title,a.tool_id,a.session_id AS current_session_id,a.deleted_at AS activity_deleted_at
    FROM gdm_runs r JOIN activities a ON a.id=r.activity_id WHERE r.permanent_deleted_at IS NULL AND r.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY r.created_at DESC`).all<Record<string,unknown>>()).results;
  return {sessions,activities,runs};
}

function parseCsv(csv: string): string[][] {
  const out:string[][]=[]; let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<csv.length;i++) { const ch=csv[i]!; if(quoted) { if(ch==='"'&&csv[i+1]==='"'){cell+='"';i++;} else if(ch==='"')quoted=false; else cell+=ch; }
    else if(ch==='"')quoted=true; else if(ch===","){row.push(cell);cell="";} else if(ch==="\n"){row.push(cell.replace(/\r$/,""));out.push(row);row=[];cell="";} else cell+=ch; }
  if(cell||row.length){row.push(cell.replace(/\r$/,""));out.push(row);} return out;
}
function toExcelHtml(csv: string, title: string): string {
  const rows=parseCsv(csv), body=rows.map((row,index)=>`<tr>${row.map((cell)=>`<${index===0?"th":"td"}>${sqlEscape(cell).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</${index===0?"th":"td"}>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${sqlEscape(title)}</title></head><body><table>${body}</table></body></html>`;
}

async function exportRun(env: Env, run: Run, format: "csv" | "excel"): Promise<Response> {
  const db=env.DB!,row=await activity(db,run.activity_id,true);
  if(!row||row.deleted_at) return fail("This Activity is in Trash.",404);
  if(run.permanent_deleted_at) return fail("This Run was permanently removed.",410);
  if(run.deleted_at) return fail("This Run is in Trash and cannot be exported from Archive.",410);
  let csv=run.export_csv;
  if(!csv && run.is_current) csv=await csvForRun(env,row,run.id);
  if(!csv) return fail("No export is available for this historical Run.",404);
  const basename=`${row.tool_id}-run-${run.sequence}`;
  if(format==="excel") return new Response(toExcelHtml(csv,basename),{headers:{"Content-Type":"application/vnd.ms-excel; charset=utf-8","Content-Disposition":`attachment; filename="${basename}.xls"`,"Cache-Control":"no-store"}});
  return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${basename}.csv"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

async function exportMultiple(env: Env, runIds: string[], format: "csv"|"excel", label: string): Promise<Response> {
  const db=env.DB!,lines:string[]=[];
  for(const id of runIds) {
    const run=await db.prepare("SELECT * FROM gdm_runs WHERE id=? AND permanent_deleted_at IS NULL").bind(id).first<Run>();
    if(!run){lines.push([csvCell(id),csvCell("DATA UNAVAILABLE: source Run was reset or deleted")].join(","));continue;}
    if(run.deleted_at||run.permanent_deleted_at){lines.push([csvCell(id),csvCell("DATA UNAVAILABLE: source Run is deleted or in Trash")].join(","));continue;}
    const row=await activity(db,run.activity_id,true);
    if(!row||row.deleted_at){lines.push([csvCell(id),csvCell("DATA UNAVAILABLE: Activity is in Trash")].join(","));continue;}
    const csv=run.export_csv||(run.is_current?await csvForRun(env,row,run.id):"");
    if(!csv){lines.push([csvCell(id),csvCell("No saved export for this Run")].join(","));continue;}
    lines.push([csvCell("RUN"),csvCell(run.id),csvCell(run.sequence),csvCell(row.title),csvCell(run.origin_session_name??"Standalone")].join(","));
    lines.push(csv);
  }
  const csv=lines.join("\r\n");
  if(format==="excel")return new Response(toExcelHtml(csv,label),{headers:{"Content-Type":"application/vnd.ms-excel; charset=utf-8","Content-Disposition":`attachment; filename="${label}.xls"`,"Cache-Control":"no-store"}});
  return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${label}.csv"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}

export async function gdmOwnerRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const db=env.DB;
  if(!db)return fail("D1 database is not configured.",503);
  const path=url.pathname;

  const moduleActivityPath=path.match(/^\/api\/owner\/(?:polls|wordclouds|reflection-walls|learning-behaviors|scarf\/activities)\/([0-9a-f-]+)/i);
  if(moduleActivityPath) {
    const existing=await activity(db,moduleActivityPath[1]!,true);
    if(existing?.deleted_at)return fail("Activity not found.",404);
  }

  const legacySessionStatus=path.match(/^\/api\/owner\/sessions\/([0-9a-f-]+)\/(archive|reopen)$/i);
  if(legacySessionStatus&&request.method==="POST") {
    const sessionId=legacySessionStatus[1]!,action=legacySessionStatus[2]!;
    if(action==="archive")return archiveSession(db,sessionId);
    const session=await db.prepare("SELECT status FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{status:string}>();
    if(!session)return fail("Session not found.",404);
    if(session.status!=="completed")return fail("Session is not archived.",409);
    await db.prepare("UPDATE sessions SET status='upcoming',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId).run();
    await writeAudit(db,"REOPEN_SESSION","session",sessionId);
    return json({status:"upcoming"});
  }

  // Keep legacy module Delete controls on the global Trash contract.
  const legacyDelete=path.match(/^\/api\/owner\/(?:polls|wordclouds|reflection-walls|learning-behaviors)\/([0-9a-f-]+)$/i);
  if(request.method==="DELETE"&&legacyDelete) {
    const input=await read(request,OperationInput) ?? {operationId:uuid()};
    return idempotent(db,input.operationId,"DELETE_ACTIVITY",legacyDelete[1]!,async()=>{const row=await activity(db,legacyDelete[1]!);if(!row)return fail("Activity not found.",404);const result=await deleteActivity(env,row);return json({deleted:true,...result});});
  }

  if(path==="/api/owner/gdm/archive"&&request.method==="GET")return json(await listArchive(db));
  if(path==="/api/owner/gdm/trash"&&request.method==="GET") {
    await gdmPurgeExpired(db);
    const items=(await db.prepare("SELECT id,item_type,action,label,manifest_json,deleted_at,expires_at FROM gdm_trash_packages WHERE restored_at IS NULL AND purged_at IS NULL AND expires_at>? ORDER BY deleted_at DESC").bind(nowIso()).all<Record<string,unknown>>()).results;
    const available=[];
    for(const item of items) {
      const manifest=JSON.parse(String(item.manifest_json)) as Manifest;
      const runs=manifest.runIds.length?(await db.prepare(`SELECT COUNT(*) AS n FROM gdm_runs WHERE id IN (${manifest.runIds.map(()=>"?").join(",")}) AND permanent_deleted_at IS NULL`).bind(...manifest.runIds).first<{n:number}>())?.n??0:0;
      const activities=manifest.activityIds.length?(await db.prepare(`SELECT COUNT(*) AS n FROM activities WHERE id IN (${manifest.activityIds.map(()=>"?").join(",")}) AND deleted_at IS NOT NULL`).bind(...manifest.activityIds).first<{n:number}>())?.n??0:0;
      const sessions=manifest.sessionIds.length?(await db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id IN (${manifest.sessionIds.map(()=>"?").join(",")}) AND deleted_at IS NOT NULL`).bind(...manifest.sessionIds).first<{n:number}>())?.n??0:0;
      if(runs+activities+sessions>0)available.push({...item,manifest});
    }
    return json({items:available});
  }
  if(path==="/api/owner/gdm/preview"&&request.method==="POST") {
    const data=await read(request,BulkInput.shape.selection); if(!data)return fail("Choose the Sessions, Activities, or Runs to preview.");
    const sessions=data.sessionIds;
    const activitySession:Record<string,string|null>={},runActivity:Record<string,string>={};
    for(const row of (await db.prepare("SELECT id,session_id FROM activities WHERE deleted_at IS NULL").all<{id:string;session_id:string|null}>()).results)activitySession[row.id]=row.session_id;
    for(const row of (await db.prepare("SELECT id,activity_id FROM gdm_runs WHERE permanent_deleted_at IS NULL").all<{id:string;activity_id:string}>()).results)runActivity[row.id]=row.activity_id;
    const selected=normalizeSelection({...data,sessionMode:data.sessionMode},activitySession,runActivity);
    const childActivityIds=new Set(selected.activityIds);
    for(const sessionId of selected.sessionIds)if(data.sessionMode==="ALL")for(const item of (await db.prepare("SELECT id FROM activities WHERE session_id=? AND deleted_at IS NULL").bind(sessionId).all<{id:string}>()).results)childActivityIds.add(item.id);
    const runs=(await db.prepare("SELECT id,activity_id,state,sequence FROM gdm_runs WHERE permanent_deleted_at IS NULL AND deleted_at IS NULL").all<{id:string;activity_id:string;state:string;sequence:number}>()).results;
    const affectedRuns=runs.filter((run)=>selected.runIds.includes(run.id)||childActivityIds.has(run.activity_id));
    const activeActivities:string[]=[];for(const id of new Set([...childActivityIds,...affectedRuns.map((run)=>run.activity_id)]))if(await isActivityLive(db,id))activeActivities.push(id);
    const outside=(await db.prepare(`SELECT DISTINCT s.id,s.name FROM gdm_runs r JOIN sessions s ON s.id=r.origin_session_id WHERE r.activity_id IN (${[...childActivityIds].map(()=>"?").join(",")||"NULL"}) AND s.id NOT IN (${sessions.map(()=>"?").join(",")||"NULL"}) AND r.permanent_deleted_at IS NULL`).bind(...childActivityIds,...sessions).all<{id:string;name:string}>()).results;
    return json({selection:selected,activityCount:childActivityIds.size,runCount:affectedRuns.length,sessionCount:selected.sessionIds.length,activeActivities,crossSessionImpact:outside,ready:activeActivities.length===0,
      message:activeActivities.length?"End every Live or Paused Run listed before deleting this selection.":"The selected objects will move to Trash for 30 days."});
  }

  const sessionPath=path.match(/^\/api\/owner\/gdm\/sessions\/([0-9a-f-]+)(?:\/(access|reset|delete|archive|reopen|export))?$/i);
  if(sessionPath) {
    const sessionId=sessionPath[1]!,action=sessionPath[2]??"detail";
    if(request.method==="GET"&&action==="access") {
      try{const access=await ensureSessionAccess(db,sessionId);return json({...access,path:`/session/${access.accessSlug}`,url:`${new URL(request.url).origin}/session/${access.accessSlug}`});}
      catch{return fail("Session not found.",404);}
    }
    if(request.method==="GET"&&action==="detail") {
      const session=await db.prepare("SELECT id,name,description,status,starts_at,location,expected_participants,archived_at,archive_manifest_json,access_slug,join_pin FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<Record<string,unknown>>();
      if(!session)return fail("Session not found.",404);
      const access=await ensureSessionAccess(db,sessionId);
      const activities=(await db.prepare("SELECT id,title,tool_id,state,session_id,current_run_id,join_pin,updated_at FROM activities WHERE session_id=? AND deleted_at IS NULL ORDER BY created_at").bind(sessionId).all<Record<string,unknown>>()).results;
      const runs=(await db.prepare("SELECT r.* FROM gdm_runs r WHERE r.origin_session_id=? AND r.permanent_deleted_at IS NULL AND r.deleted_at IS NULL ORDER BY r.created_at DESC").bind(sessionId).all<Run>()).results;
      const manifest=session.archive_manifest_json?JSON.parse(String(session.archive_manifest_json)) as {activities:Array<{activityId:string;runIds:string[]}>}:null;
      const reportSources=(manifest?.activities??[]).flatMap((item)=>item.runIds.map((runId)=>({runId,activityId:item.activityId,available:runs.some((run)=>run.id===runId&&Boolean(run.export_csv||run.data_json))})));
      return json({session,activities,runs,access,reportSources});
    }
    if(request.method==="POST"&&action==="archive")return archiveSession(db,sessionId);
    if(request.method==="POST"&&action==="reopen") {
      const session=await db.prepare("SELECT status FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{status:string}>();
      if(!session)return fail("Session not found.",404);if(session.status!=="completed")return fail("Session is not archived.",409);
      await db.prepare("UPDATE sessions SET status='upcoming',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sessionId).run();return json({status:"upcoming"});
    }
    if(request.method==="POST"&&action==="reset") {
      const input=await read(request,SessionResetInput);if(!input)return fail("Choose how to reset the Session.");
      return idempotent(db,input.operationId,"RESET_SESSION",sessionId,async()=>json(await resetSession(env,sessionId,input.branch,input.scope)));
    }
    if(request.method==="POST"&&action==="delete") {
      const input=await read(request,SessionDeleteInput);if(!input)return fail("Choose whether to keep or delete its Activities.");
      return idempotent(db,input.operationId,"DELETE_SESSION",sessionId,async()=>json({deleted:true,...await deleteSession(env,sessionId,input.mode)}));
    }
    if(request.method==="GET"&&action==="export") {
      const session=await db.prepare("SELECT status,archive_manifest_json FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{status:string;archive_manifest_json:string|null}>();
      if(!session)return fail("Session not found.",404);
      const runIds=session.status==="completed"&&session.archive_manifest_json
        ? (JSON.parse(session.archive_manifest_json) as {activities:Array<{runIds:string[]}>}).activities.flatMap((item)=>item.runIds)
        : (await db.prepare("SELECT id FROM gdm_runs WHERE origin_session_id=? AND permanent_deleted_at IS NULL AND deleted_at IS NULL ORDER BY activity_id,sequence").bind(sessionId).all<{id:string}>()).results.map((run)=>run.id);
      return exportMultiple(env,runIds,(url.searchParams.get("format")==="excel"?"excel":"csv"),`session-${sessionId.slice(0,8)}`);
    }
  }

  const activityPath=path.match(/^\/api\/owner\/gdm\/activities\/([0-9a-f-]+)(?:\/(start-run|reset|delete|export))?$/i);
  if(activityPath) {
    const activityId=activityPath[1]!,action=activityPath[2]??"detail";
    if(request.method==="GET"&&action==="detail") {
      const row=await activity(db,activityId);if(!row)return fail("Activity not found.",404);await ensureCurrentRun(db,activityId);
      const current=await currentRun(db,activityId),runs=await runsForActivity(db,activityId,false);
      return json({activity:row,currentRun:current,runs,canEdit:!await isActivityLive(db,activityId),canDelete:!await isActivityLive(db,activityId),startRunPath:row.tool_id==="quiz"?`/quiz/activities/${activityId}/new-run`:null});
    }
    if(request.method==="POST"&&action==="start-run") {
      const input=await read(request,OperationInput);if(!input)return fail("Refresh this Activity before starting a new Run.");
      return idempotent(db,input.operationId,"START_NEW_RUN",activityId,async()=>{
        const row=await activity(db,activityId);if(!row)return fail("Activity not found.",404);
        const sessionGuard=await archivedQuizSessionGuard(db,row);if(sessionGuard)return sessionGuard;
        const created=await startNewRun(env,row);
        return json({runId:created.runId,sequence:created.sequence,pin:created.pin,state:"READY"},201);
      });
    }
    if(request.method==="POST"&&action==="reset") {
      const input=await read(request,ActivityResetInput);if(!input)return fail("Choose the Run data to reset.");
      return idempotent(db,input.operationId,"RESET_ACTIVITY",activityId,async()=>{
        const row=await activity(db,activityId);if(!row)return fail("Activity not found.",404);const sessionGuard=await archivedQuizSessionGuard(db,row);if(sessionGuard)return sessionGuard;return json({reset:true,...await resetActivity(env,row,input.scope)});
      });
    }
    if(request.method==="POST"&&action==="delete") {
      const input=await read(request,OperationInput);if(!input)return fail("Refresh this Activity before deleting it.");
      return idempotent(db,input.operationId,"DELETE_ACTIVITY",activityId,async()=>{const row=await activity(db,activityId);if(!row)return fail("Activity not found.",404);return json({deleted:true,...await deleteActivity(env,row)});});
    }
    if(request.method==="GET"&&action==="export") {
      const row=await activity(db,activityId);if(!row)return fail("Activity not found.",404);
      const runs=await runsForActivity(db,activityId,false);return exportMultiple(env,runs.map((run)=>run.id),(url.searchParams.get("format")==="excel"?"excel":"csv"),`activity-${activityId.slice(0,8)}`);
    }
  }

  const runPath=path.match(/^\/api\/owner\/gdm\/runs\/([0-9a-f-]+)(?:\/(delete|restore|export))?$/i);
  if(runPath) {
    const runId=runPath[1]!,action=runPath[2]??"detail";
    if(request.method==="GET"&&action==="detail") {
      const run=await db.prepare("SELECT r.*,a.title AS activity_title,a.tool_id,a.session_id AS current_session_id FROM gdm_runs r JOIN activities a ON a.id=r.activity_id WHERE r.id=? AND r.permanent_deleted_at IS NULL AND a.deleted_at IS NULL").bind(runId).first<Record<string,unknown>>();
      return run?json({run}):fail("Run not found.",404);
    }
    if(request.method==="POST"&&action==="delete") {
      const input=await read(request,OperationInput);if(!input)return fail("Refresh the Run history before deleting this Run.");
      return idempotent(db,input.operationId,"DELETE_RUN",runId,async()=>{const run=await db.prepare("SELECT * FROM gdm_runs WHERE id=? AND permanent_deleted_at IS NULL").bind(runId).first<Run>();if(!run)return fail("Run not found.",404);return json({deleted:true,...await deleteRun(env,run)});});
    }
    if(request.method==="GET"&&action==="export") {
      const run=await db.prepare("SELECT * FROM gdm_runs WHERE id=?").bind(runId).first<Run>();if(!run)return fail("Run not found.",404);
      return exportRun(env,run,url.searchParams.get("format")==="excel"?"excel":"csv");
    }
  }

  const restorePath=path.match(/^\/api\/owner\/gdm\/trash\/([0-9a-f-]+)\/restore$/i);
  if(request.method==="POST"&&restorePath) {
    const input=await read(request,OperationInput);if(!input)return fail("Refresh Trash before restoring this item.");
    return idempotent(db,input.operationId,"RESTORE_TRASH",restorePath[1]!,async()=>json(await restorePackage(db,restorePath[1]!)));
  }

  if(path==="/api/owner/gdm/bulk-export"&&request.method==="POST") {
    const input=await read(request,BulkExportInput);if(!input)return fail("Choose Sessions, Activities, or Runs to export.");
    const runIds=new Set(input.selection.runIds);
    for(const sessionId of new Set(input.selection.sessionIds)) {
      const session=await db.prepare("SELECT status,archive_manifest_json FROM sessions WHERE id=? AND deleted_at IS NULL").bind(sessionId).first<{status:string;archive_manifest_json:string|null}>();
      if(!session)return fail("A selected Session is no longer available.",404);
      if(session.status==="completed"&&session.archive_manifest_json) {
        const sources=JSON.parse(session.archive_manifest_json) as {activities:Array<{runIds:string[]}>};
        sources.activities.flatMap((item)=>item.runIds).forEach((id)=>runIds.add(id));
      } else {
        const sources=(await db.prepare("SELECT id FROM gdm_runs WHERE origin_session_id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL ORDER BY activity_id,sequence").bind(sessionId).all<{id:string}>()).results;
        sources.forEach((item)=>runIds.add(item.id));
      }
    }
    for(const activityId of new Set(input.selection.activityIds)) {
      const row=await activity(db,activityId);if(!row)return fail("A selected Activity is no longer available.",404);
      const sources=(await db.prepare("SELECT id FROM gdm_runs WHERE activity_id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL ORDER BY sequence").bind(activityId).all<{id:string}>()).results;
      sources.forEach((item)=>runIds.add(item.id));
    }
    for(const runId of input.selection.runIds) {
      const run=await db.prepare("SELECT id FROM gdm_runs WHERE id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL").bind(runId).first<{id:string}>();
      if(!run)return fail("A selected Run is no longer available.",404);
    }
    if(!runIds.size)return fail("The selected scope contains no exportable Runs.");
    return exportMultiple(env,[...runIds],input.format,`archive-selection-${new Date().toISOString().slice(0,10)}`);
  }

  if(path==="/api/owner/gdm/bulk-delete"&&request.method==="POST") {
    const input=await read(request,BulkInput);if(!input)return fail("Choose the items to delete.");
    const activitySession:Record<string,string|null>={},runActivity:Record<string,string>={};
    for(const row of (await db.prepare("SELECT id,session_id FROM activities WHERE deleted_at IS NULL").all<{id:string;session_id:string|null}>()).results)activitySession[row.id]=row.session_id;
    for(const row of (await db.prepare("SELECT id,activity_id FROM gdm_runs WHERE permanent_deleted_at IS NULL").all<{id:string;activity_id:string}>()).results)runActivity[row.id]=row.activity_id;
    const normalized=normalizeSelection(input.selection,activitySession,runActivity);
    const sessionModes=Object.fromEntries(normalized.sessionIds.map((id)=>[id,input.selection.sessionMode??"ONLY"])) as Record<string,"ONLY"|"ALL">;
    const manifest:Manifest={sessionIds:normalized.sessionIds,activityIds:normalized.activityIds,runIds:normalized.runIds,sessionModes};
    return idempotent(db,input.operationId,"BULK_DELETE","workspace",async()=>json({deleted:true,...await deleteSelection(env,manifest)}));
  }
  return null;
}

export async function gdmPurgeExpired(db: D1Database, now = nowIso()): Promise<number> {
  const packages=(await db.prepare("SELECT * FROM gdm_trash_packages WHERE restored_at IS NULL AND purged_at IS NULL AND expires_at<=?").bind(now).all<{id:string;manifest_json:string}>()).results;
  let purged=0;
  for(const pkg of packages) {
    const manifest=JSON.parse(pkg.manifest_json) as Manifest;
    const statements:D1PreparedStatement[]=[];
    for(const runId of manifest.runIds) {
      statements.push(
        db.prepare("DELETE FROM quiz_runs WHERE id=?").bind(runId),
        db.prepare("UPDATE gdm_runs SET data_json=NULL,export_csv=NULL,permanent_deleted_at=?,deleted_at=? WHERE id=? AND permanent_deleted_at IS NULL").bind(now,now,runId),
      );
    }
    for(const activityId of manifest.activityIds) statements.push(db.prepare("DELETE FROM activities WHERE id=? AND deleted_at IS NOT NULL").bind(activityId));
    for(const sessionId of manifest.sessionIds) statements.push(db.prepare("DELETE FROM sessions WHERE id=? AND deleted_at IS NOT NULL").bind(sessionId));
    statements.push(db.prepare("UPDATE gdm_trash_packages SET purged_at=? WHERE id=?").bind(now,pkg.id));
    await db.batch(statements);
    purged++;
  }
  return purged;
}
