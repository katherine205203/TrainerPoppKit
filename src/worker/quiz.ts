import { z } from "zod";
import { correctAnswerIds, duplicateQuestion, gradeAnswer, matchAnswerToken, parseMatchAnswerToken, questionPoints, rankIndividuals, rankTeams, validateQuiz, type QuizContent, type QuizQuestion, type IndividualStanding } from "../domain/quiz";
import { bearerToken, randomToken, sha256 } from "./security";

type Env = { DB?: D1Database; SESSION_SECRET?: string };
type Run = {
  id: string; activity_id: string; sequence: number; name: string; definition_version: number; final_results_visibility: "HIDDEN" | "RELEASED"; run_type: "LIVE" | "SELF_PACED";
  competition_mode: "INDIVIDUAL" | "TEAM" | null; hosting_mode: "MANUAL" | "AUTOMATIC" | null;
  scoring_mode: "ACCURACY" | "ACCURACY_SPEED" | null; config_json: string; snapshot_json: string;
  state: "LOBBY_OPEN" | "RUNNING" | "PAUSED" | "COMPLETED"; phase: string; current_index: number;
  phase_started_at: number | null; phase_deadline_at: number | null; phase_remaining_ms: number | null;
  paused_from_phase: string | null; active_elapsed_ms: number; revision: number; completion_reason: string | null;
  presenter_token_hash: string | null; started_at: number | null; completed_at: number | null;
};
type Person = { id: string; run_id: string; nickname: string; normalized_nickname: string; team_id: string | null; joined_at: number; disqualified_at: number | null; disqualification_reason: string | null };
type Team = { id: string; run_id: string; name: string; sort_order: number };
type Answer = { participant_id: string; question_index: number; selected_json: string; accepted_at: number; effective_elapsed_ms: number; interacted: number };
type Draft = { participant_id: string; question_index: number; selected_json: string; version: number; interacted: number };
type Correction = { question_index: number; correct_json: string | null; voided: number };
const choiceSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"]),
  stem: z.string().max(1000), options: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().max(300) })),
  correctOptionIds: z.array(z.string()), explanation: z.string().max(2000).default(""), hopeMultiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const reorderSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("REORDER"), stem: z.string().max(1000),
  items: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().max(300) })), correctOrderItemIds: z.array(z.string()),
  explanation: z.string().max(2000).default(""), hopeMultiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const matchSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("MATCH_PAIRS"), stem: z.string().max(1000),
  pairs: z.array(z.object({ id: z.string().min(1).max(100), leftId: z.string().min(1).max(100), leftText: z.string().max(300), rightId: z.string().min(1).max(100), rightText: z.string().max(300) })),
  explanation: z.string().max(2000).default(""), hopeMultiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const contentSchema = z.object({
  title: z.string().max(100), description: z.string().max(500).default(""),
  sharedLiveTimerMs: z.number().int(), sharedBasePoints: z.number().int(),
  questions: z.array(z.discriminatedUnion("type", [choiceSchema, reorderSchema, matchSchema])).max(100),
});
const runSchema = z.object({
  name: z.string().trim().min(1).max(100), runType: z.enum(["LIVE", "SELF_PACED"]),
  competitionMode: z.enum(["INDIVIDUAL", "TEAM"]).optional(),
  hostingMode: z.enum(["MANUAL", "AUTOMATIC"]).optional(),
  scoringMode: z.enum(["ACCURACY", "ACCURACY_SPEED"]).optional(),
  teams: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  attemptTimerMs: z.number().int().min(60000).max(86400000).nullable().optional(),
  scoreReleasePolicy: z.enum(["AFTER_SUBMIT", "AFTER_RUN"]).optional(),
  reviewPolicy: z.enum(["SCORE_ONLY", "AFTER_RUN_DETAIL"]).optional(),
  shuffleQuestions: z.boolean().default(false),
  definitionVersion: z.number().int().positive().optional(),
});
const selections = z.array(z.string().min(1).max(256)).max(10);
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function fail(error: string, status = 400): Response { return json({ error }, status); }
async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 131072) return null;
  try { const value = schema.safeParse(await request.json()); return value.success ? value.data : null; } catch { return null; }
}
const uuid = () => crypto.randomUUID();
const content = (run: Run) => JSON.parse(run.snapshot_json) as QuizContent;
const config = (run: Run) => JSON.parse(run.config_json) as z.infer<typeof runSchema>;
async function getRun(db: D1Database, runId: string): Promise<Run | null> {
  return db.prepare("SELECT q.* FROM quiz_runs q JOIN activities a ON a.id=q.activity_id WHERE q.id = ? AND q.deleted_at IS NULL AND q.permanent_deleted_at IS NULL AND a.deleted_at IS NULL")
    .bind(runId).first<Run>();
}
async function audit(db: D1Database, runId: string, actor: string, action: string, targetId: string | null, reason: string | null, before: unknown, after: unknown) {
  await db.prepare("INSERT INTO quiz_audit(id,run_id,actor,action,target_id,before_json,after_json,reason,at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(uuid(), runId, actor, action, targetId, JSON.stringify(before ?? null), JSON.stringify(after ?? null), reason, Date.now()).run();
}
async function teams(db: D1Database, runId: string): Promise<Team[]> {
  return (await db.prepare("SELECT * FROM quiz_run_teams WHERE run_id = ? ORDER BY sort_order").bind(runId).all<Team>()).results;
}
async function people(db: D1Database, runId: string): Promise<Person[]> {
  return (await db.prepare("SELECT id,run_id,nickname,normalized_nickname,team_id,joined_at,disqualified_at,disqualification_reason FROM quiz_run_participants WHERE run_id = ? ORDER BY joined_at,id").bind(runId).all<Person>()).results;
}
async function answers(db: D1Database, runId: string): Promise<Answer[]> {
  return (await db.prepare("SELECT participant_id,question_index,selected_json,accepted_at,effective_elapsed_ms,interacted FROM quiz_live_answers WHERE run_id = ?").bind(runId).all<Answer>()).results;
}
async function corrections(db: D1Database, runId: string): Promise<Correction[]> {
  return (await db.prepare("SELECT * FROM quiz_question_corrections WHERE run_id = ?").bind(runId).all<Correction>()).results;
}
async function scoreResults(db: D1Database, run: Run) {
  const quiz = content(run), participants = await people(db, run.id), teamRows = await teams(db, run.id), changed = await corrections(db, run.id);
  const locked = new Set((await db.prepare("SELECT question_index FROM quiz_locked_questions WHERE run_id = ?").bind(run.id).all<{question_index:number}>()).results.map((row) => row.question_index));
  const live = run.run_type === "LIVE" ? await answers(db, run.id) : [];
  const drafts = run.run_type === "SELF_PACED" ? (await db.prepare("SELECT d.participant_id,d.question_index,d.selected_json,d.version,d.interacted FROM quiz_drafts d JOIN quiz_attempts a ON a.run_id=d.run_id AND a.participant_id=d.participant_id WHERE d.run_id=? AND a.state IN ('SUBMITTED','AUTO_SUBMITTED')").bind(run.id).all<Draft>()).results : [];
  const attempts = run.run_type === "SELF_PACED" ? (await db.prepare("SELECT participant_id,state,submitted_at FROM quiz_attempts WHERE run_id=?").bind(run.id).all<{participant_id:string;state:string;submitted_at:number|null}>()).results : [];
  const eligibility = run.run_type === "LIVE" ? (await db.prepare("SELECT e.question_index,e.participant_id FROM quiz_question_eligibility e JOIN quiz_run_participants p ON p.id=e.participant_id WHERE e.run_id=? AND p.disqualified_at IS NULL").bind(run.id).all<{question_index:number;participant_id:string}>()).results : [];
  const entries: IndividualStanding[] = participants.map((p) => {
    let points = 0, correct = 0;
    for (let index = 0; index < quiz.questions.length; index++) {
      if (run.run_type === "LIVE" && !locked.has(index)) continue;
      if (run.run_type === "SELF_PACED" && !attempts.some((a) => a.participant_id === p.id && ["SUBMITTED","AUTO_SUBMITTED"].includes(a.state))) continue;
      const q = quiz.questions[index]!, c = changed.find((item) => item.question_index === index);
      if (c?.voided) continue;
      const selected = run.run_type === "LIVE" ? live.find((a) => a.participant_id === p.id && a.question_index === index) : drafts.find((a) => a.participant_id === p.id && a.question_index === index);
      if (!selected) continue;
      const key = c?.correct_json ? JSON.parse(c.correct_json) as string[] : correctAnswerIds(q);
      const grade = gradeAnswer(q, JSON.parse(selected.selected_json) as string[], key, selected.interacted !== 0);
      if (grade.fullyCorrect) correct++;
      points += questionPoints({ basePoints: quiz.sharedBasePoints, hopeMultiplier: q.hopeMultiplier,
        scoringMode: run.run_type === "LIVE" ? run.scoring_mode ?? "ACCURACY" : "ACCURACY",
        durationMs: run.run_type === "LIVE" ? quiz.sharedLiveTimerMs : null,
        elapsedMs: run.run_type === "LIVE" ? (selected as Answer).effective_elapsed_ms : null,
        accuracyRatio: grade.correctnessRatio });
    }
    return { id: p.id, nickname: p.nickname, teamId: p.team_id, points: p.disqualified_at ? 0 : points, correct: p.disqualified_at ? 0 : correct, dq: Boolean(p.disqualified_at) };
  });
  const individual = rankIndividuals(entries);
  const team = rankTeams(teamRows.map((t) => ({ id: t.id, name: t.name })), entries);
  const questionStats = quiz.questions.map((q, index) => {
    const c = changed.find((item) => item.question_index === index);
    const answerRows = (run.run_type === "LIVE" ? live.filter((a) => a.question_index === index && locked.has(index)) : drafts.filter((a) => a.question_index === index))
      .filter((answer) => !participants.find((person) => person.id === answer.participant_id)?.disqualified_at);
    const validAttemptIds = new Set(attempts.filter((attempt) => ["SUBMITTED","AUTO_SUBMITTED"].includes(attempt.state)).map((attempt) => attempt.participant_id));
    const eligibleCount = run.run_type === "LIVE"
      ? eligibility.filter((item) => item.question_index === index).length
      : participants.filter((person) => !person.disqualified_at && validAttemptIds.has(person.id)).length;
    const key = c?.correct_json ? JSON.parse(c.correct_json) as string[] : correctAnswerIds(q);
    const breakdown = answerRows.map((answer) => ({ answer, grade: gradeAnswer(q, JSON.parse(answer.selected_json) as string[], key, answer.interacted !== 0) }));
    const correct = c?.voided ? 0 : breakdown.filter((row) => row.grade.fullyCorrect).length;
    const partiallyCorrect = c?.voided ? 0 : breakdown.filter((row) => row.grade.gradingStatus === "PARTIALLY_CORRECT").length;
    const incorrect = c?.voided ? 0 : breakdown.filter((row) => row.grade.gradingStatus === "INCORRECT").length;
    const unanswered = c?.voided ? 0 : Math.max(0, eligibleCount - correct - partiallyCorrect - incorrect);
    const parts = q.type === "REORDER" ? q.items.map((item, position) => ({ id: item.id, label: item.label, position: position + 1,
      correct: c?.voided ? 0 : breakdown.filter(({answer}) => answer.interacted !== 0 && (JSON.parse(answer.selected_json) as string[])[position] === key[position]).length }))
      : q.type === "MATCH_PAIRS" ? q.pairs.map((pair) => ({ id: pair.id, label: `${pair.leftText} → ${pair.rightText}`,
        correct: c?.voided ? 0 : breakdown.filter(({answer}) => (JSON.parse(answer.selected_json) as string[]).includes(matchAnswerToken(pair.leftId, key.map(parseMatchAnswerToken).find((entry) => entry?.[0] === pair.leftId)?.[1] ?? pair.rightId))).length }))
      : [];
    return { questionId: q.id, index, stem: q.stem, type: q.type, voided: Boolean(c?.voided), eligible: eligibleCount,
      responses: answerRows.length, correct, partiallyCorrect, incorrect, unanswered,
      correctPercent: eligibleCount ? correct / eligibleCount : 0,
      parts: parts.map((part) => ({ ...part, eligible: eligibleCount, percent: eligibleCount ? part.correct / eligibleCount : 0 })) };
  });
  return { individual, team, questionStats, participants: entries, revision: run.revision, attemptStatuses: attempts };
}
async function saveRevision(db: D1Database, run: Run, changeType: string, reason: string, before: unknown = null) {
  const results = await scoreResults(db, run);
  const previous = await db.prepare("SELECT MAX(revision) AS revision FROM quiz_result_revisions WHERE run_id=?").bind(run.id).first<{revision:number|null}>();
  const next = Number(previous?.revision ?? 0) + 1;
  await db.prepare("INSERT INTO quiz_result_revisions(run_id,revision,change_type,reason,actor,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(run.id, next, changeType, reason, changeType === "INITIAL" ? "SYSTEM" : "OWNER", JSON.stringify(results), Date.now()).run();
  await audit(db, run.id, changeType === "INITIAL" ? "SYSTEM" : "OWNER", "RESULT_REVISION", null, reason, before, results);
  return { ...results, resultRevision: next };
}

async function uniquePin(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
    if (!await db.prepare("SELECT id FROM activities WHERE join_pin=?").bind(pin).first()) return pin;
  }
  throw new Error("Could not allocate a join PIN");
}
async function ownerState(db: D1Database, run: Run) {
  const liveAnswers = await answers(db, run.id);
  return { run: { ...run, snapshot: content(run), config: config(run), snapshot_json: undefined, config_json: undefined },
    teams: await teams(db, run.id), participants: await people(db, run.id),
    eligible: run.current_index >= 0 ? (await db.prepare("SELECT participant_id FROM quiz_question_eligibility WHERE run_id=? AND question_index=?").bind(run.id, run.current_index).all<{participant_id:string}>()).results.map((e) => e.participant_id) : [],
    answerCount: liveAnswers.filter((answer) => answer.question_index === run.current_index).length,
    submittedIds: liveAnswers.filter((answer) => answer.question_index === run.current_index).map((answer) => answer.participant_id),
    answers: liveAnswers.map((answer) => ({ ...answer, selectedOptionIds: JSON.parse(answer.selected_json) as string[], selected_json: undefined })),
    drafts: (await db.prepare("SELECT participant_id,question_index,selected_json,version,interacted FROM quiz_drafts WHERE run_id=?").bind(run.id).all<Draft>()).results.map((draft) => ({ ...draft, selectedOptionIds: JSON.parse(draft.selected_json) as string[], selected_json: undefined })),
    corrections: await corrections(db, run.id),
    results: await scoreResults(db, run) };
}

export async function quizOwnerRoute(request: Request, db: D1Database, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/owner/quiz/")) return null;
  if (path === "/api/owner/quiz/definitions" && request.method === "GET") {
    const rows = (await db.prepare("SELECT id,title,description,status,published_version,draft_base_version,updated_at,draft_json FROM quiz_definitions ORDER BY updated_at DESC").all<{id:string;title:string;description:string;status:string;published_version:number;draft_base_version:number|null;updated_at:string;draft_json:string}>()).results;
    return json({ definitions: rows.map(({ draft_json, ...row }) => ({ ...row, questionCount: (JSON.parse(draft_json) as QuizContent).questions.length })) });
  }
  if (path === "/api/owner/quiz/definitions" && request.method === "POST") {
    const input = await body(request, contentSchema);
    if (!input) return fail("Check the Quiz fields.", 400);
    const id = uuid();
    await db.prepare("INSERT INTO quiz_definitions(id,title,description,draft_json) VALUES(?,?,?,?)").bind(id, input.title.trim(), input.description, JSON.stringify(input)).run();
    return json({ definition: { id, status: "DRAFT", content: input } }, 201);
  }
  const versionsMatch = path.match(/^\/api\/owner\/quiz\/definitions\/([0-9a-f-]+)\/versions$/i);
  if (versionsMatch && request.method === "GET") {
    const definitionId = versionsMatch[1]!;
    if (!await db.prepare("SELECT id FROM quiz_definitions WHERE id=?").bind(definitionId).first()) return fail("Quiz Definition not found.", 404);
    const versions = (await db.prepare("SELECT version,content_json,created_at FROM quiz_definition_versions WHERE definition_id=? ORDER BY version DESC").bind(definitionId).all<{version:number;content_json:string;created_at:string}>()).results;
    return json({ versions: versions.map(({content_json,...version}) => ({...version,content:JSON.parse(content_json) as QuizContent})) });
  }
  const definitionMatch = path.match(/^\/api\/owner\/quiz\/definitions\/([0-9a-f-]+)(?:\/(publish|duplicate|retire|revise))?$/i);
  if (definitionMatch) {
    const definitionId = definitionMatch[1]!, action = definitionMatch[2];
    const row = await db.prepare("SELECT * FROM quiz_definitions WHERE id=?").bind(definitionId).first<{id:string;title:string;status:string;published_version:number;draft_base_version:number|null;draft_json:string;published_json:string|null}>();
    if (!row) return fail("Quiz Definition not found.", 404);
    if (request.method === "GET" && !action) return json({ definition: { ...row, content: JSON.parse(row.draft_json), draft_json: undefined, published_json: undefined } });
    if (request.method === "POST" && action === "revise") {
      if (row.status !== "PUBLISHED" || !row.published_json || row.published_version < 1) return fail("Publish this Quiz before creating a Draft Revision.", 409);
      if (row.draft_base_version === row.published_version) return json({ revision: true, baseVersion: row.published_version, content: JSON.parse(row.draft_json) as QuizContent });
      await db.prepare("UPDATE quiz_definitions SET draft_json=published_json,draft_base_version=published_version,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PUBLISHED' AND draft_base_version IS NULL")
        .bind(definitionId).run();
      const revised = await db.prepare("SELECT draft_json,draft_base_version FROM quiz_definitions WHERE id=?").bind(definitionId).first<{draft_json:string;draft_base_version:number|null}>();
      if (revised?.draft_base_version !== row.published_version) return fail("The published Quiz changed. Refresh and start a new Draft Revision.", 409);
      return json({ revision: true, baseVersion: row.published_version, content: JSON.parse(revised.draft_json) as QuizContent });
    }
    if (request.method === "PUT" && !action) {
      if (row.status === "RETIRED") return fail("Retired Quiz Definitions cannot be edited.", 409);
      if (row.status === "PUBLISHED" && row.draft_base_version !== row.published_version) return fail("Create a Draft Revision before editing a Published Quiz.", 409);
      const input = await body(request, contentSchema);
      if (!input) return fail("Check the Quiz fields.", 400);
      const result = await db.prepare("UPDATE quiz_definitions SET title=?,description=?,draft_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (status='DRAFT' OR draft_base_version=published_version)")
        .bind(input.title.trim(), input.description, JSON.stringify(input), definitionId).run();
      if (!result.meta.changes) return fail("The Draft Revision changed. Refresh before saving again.", 409);
      return json({ saved: true });
    }
    if (request.method === "POST" && action === "publish") {
      if (row.status === "RETIRED") return fail("Retired Quiz Definitions cannot be published.", 409);
      if (row.status === "PUBLISHED" && row.draft_base_version !== row.published_version) return fail("Create a Draft Revision before publishing changes.", 409);
      const draft = JSON.parse(row.draft_json) as QuizContent, errors = validateQuiz(draft);
      if (errors.length) return json({ error: "Resolve Quiz validation issues before publishing.", errors }, 400);
      const writes = await db.batch([
        db.prepare("INSERT INTO quiz_definition_versions(definition_id,version,content_json) SELECT id,published_version+1,draft_json FROM quiz_definitions WHERE id=? AND (status='DRAFT' OR draft_base_version=published_version)").bind(definitionId),
        db.prepare("UPDATE quiz_definitions SET status='PUBLISHED',published_version=published_version+1,published_json=draft_json,draft_base_version=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (status='DRAFT' OR draft_base_version=published_version)").bind(definitionId),
      ]);
      if (!writes[1]?.meta.changes) return fail("This Quiz changed before Publish completed. Refresh and try again.", 409);
      return json({ published: true, version: row.published_version + 1 });
    }
    if (request.method === "POST" && action === "retire") {
      if (row.status === "RETIRED") return fail("Quiz Definition is already retired.", 409);
      await db.prepare("UPDATE quiz_definitions SET status='RETIRED',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(definitionId).run();
      return json({ retired: true });
    }
    if (request.method === "POST" && action === "duplicate") {
      const id = uuid(), draft = JSON.parse(row.draft_json) as QuizContent;
      draft.title = draft.title.slice(0, 93).trimEnd() + " (copy)";
      draft.questions = draft.questions.map((question) => duplicateQuestion(question));
      await db.prepare("INSERT INTO quiz_definitions(id,title,description,draft_json) VALUES(?,?,?,?)").bind(id, draft.title, draft.description, JSON.stringify(draft)).run();
      return json({ definition: { id, status: "DRAFT", content: draft } }, 201);
    }
  }
  if (path === "/api/owner/quiz/activities" && request.method === "GET") {
    const rows = (await db.prepare("SELECT a.id,a.title,a.state,a.join_pin,a.session_id,qa.definition_id,(SELECT COUNT(*) FROM quiz_runs r WHERE r.activity_id=a.id AND r.deleted_at IS NULL AND r.permanent_deleted_at IS NULL) AS run_count FROM quiz_activities qa JOIN activities a ON a.id=qa.activity_id WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC").all()).results;
    return json({ activities: rows });
  }
  if (path === "/api/owner/quiz/activities" && request.method === "POST") {
    const input = await body(request, z.object({ definitionId: z.string().uuid(), sessionId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1).max(100).optional() }));
    if (!input) return fail("Check the Activity details.", 400);
    const definition = await db.prepare("SELECT title,status,published_version FROM quiz_definitions WHERE id=?").bind(input.definitionId).first<{title:string;status:string;published_version:number}>();
    if (!definition || definition.status !== "PUBLISHED") return fail("Publish the Quiz before creating an Activity.", 409);
    if (input.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id=? AND deleted_at IS NULL").bind(input.sessionId).first()) return fail("Session not found.", 404);
    const activityId = uuid(), pin = await uniquePin(db);
    await db.batch([
      db.prepare("INSERT INTO activities(id,session_id,title,tool_id,state,result_policy,require_name,allow_teams,join_pin,instrument_version,scoring_version) VALUES(?,?,?,'quiz','draft','confirmation',1,0,?,'quiz-v1.2','quiz-points-v1.2')").bind(activityId, input.sessionId ?? null, input.title ?? definition.title, pin),
      db.prepare("INSERT INTO quiz_activities(activity_id,definition_id,definition_version) VALUES(?,?,?)").bind(activityId, input.definitionId, definition.published_version),
    ]);
    return json({ activity: { id: activityId, title: input.title ?? definition.title, joinPin: pin, definitionVersion: definition.published_version } }, 201);
  }
  const activityActionMatch = path.match(/^\/api\/owner\/quiz\/activities\/([0-9a-f-]+)\/(archive|reopen)$/i);
  if (activityActionMatch && request.method === "POST") {
    const activityId = activityActionMatch[1]!, action = activityActionMatch[2]!;
    const activity = await db.prepare("SELECT a.state,a.session_id FROM quiz_activities qa JOIN activities a ON a.id=qa.activity_id WHERE a.id=? AND a.deleted_at IS NULL").bind(activityId).first<{state:string;session_id:string|null}>();
    if (!activity) return fail("Quiz Activity not found.", 404);
    if (await db.prepare("SELECT id FROM quiz_runs WHERE activity_id=? AND state!='COMPLETED'").bind(activityId).first()) return fail("Complete the active Run first.", 409);
    if (action === "archive" && activity.state !== "closed" && activity.state !== "draft") return fail("Close the Activity before archiving it.", 409);
    if (action === "reopen" && activity.state !== "archived") return fail("This Activity is not archived.", 409);
    await db.prepare("UPDATE activities SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(action === "archive" ? "archived" : "closed", activityId).run();
    return json({ state: action === "archive" ? "archived" : "closed" });
  }
  const activityMatch = path.match(/^\/api\/owner\/quiz\/activities\/([0-9a-f-]+)(?:\/runs)?$/i);
  if (activityMatch) {
    const activityId = activityMatch[1]!, isRuns = path.endsWith("/runs");
    const activity = await db.prepare("SELECT a.*,qa.definition_id,qa.definition_version,s.status AS session_status FROM quiz_activities qa JOIN activities a ON a.id=qa.activity_id LEFT JOIN sessions s ON s.id=a.session_id WHERE a.id=? AND a.deleted_at IS NULL").bind(activityId).first<{id:string;title:string;state:string;session_id:string|null;join_pin:string;definition_id:string;definition_version:number;session_status:string|null}>();
    if (!activity) return fail("Quiz Activity not found.", 404);
    if (request.method === "GET") {
      const runs = (await db.prepare("SELECT id,sequence,name,definition_version,final_results_visibility,run_type,competition_mode,hosting_mode,scoring_mode,state,phase,completion_reason,created_at,completed_at FROM quiz_runs WHERE activity_id=? AND deleted_at IS NULL AND permanent_deleted_at IS NULL ORDER BY sequence DESC").bind(activityId).all()).results;
      return json({ activity, runs });
    }
    if (request.method === "POST" && isRuns) {
      const input = await body(request, runSchema);
      if (!input) return fail("Check the Run settings.", 400);
      if (input.runType === "LIVE" && (!input.competitionMode || !input.hostingMode || !input.scoringMode || (input.competitionMode === "TEAM" && (input.teams.length < 2 || new Set(input.teams.map((t) => t.toLowerCase())).size !== input.teams.length)))) return fail("Choose Live competition, hosting, scoring, and at least two distinct Teams when Team mode is selected.", 400);
      if (input.runType === "SELF_PACED" && (!input.scoreReleasePolicy || !input.reviewPolicy)) return fail("Choose both Self-paced result policies.", 400);
      if (activity.state === "archived") return fail("Reopen the Quiz Activity before starting a new Run.", 409);
      if (activity.session_id && activity.session_status === "completed") return fail("Reopen the archived Session before creating another Quiz Run.", 409);
      if (await db.prepare("SELECT id FROM quiz_runs WHERE activity_id=? AND state!='COMPLETED'").bind(activityId).first()) return fail("Complete the current Run before creating another.", 409);
      const requestedVersion = input.definitionVersion ?? activity.definition_version;
      const definition = await db.prepare("SELECT status FROM quiz_definitions WHERE id=?").bind(activity.definition_id).first<{status:string}>();
      const version = await db.prepare("SELECT content_json FROM quiz_definition_versions WHERE definition_id=? AND version=?").bind(activity.definition_id,requestedVersion).first<{content_json:string}>();
      if (!definition || definition.status !== "PUBLISHED" || !version) return fail("Choose an available published Quiz version before creating a Run.", 409);
      const sequence = Number((await db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM quiz_runs WHERE activity_id=?").bind(activityId).first<{n:number}>())?.n ?? 1);
      const runId = uuid(), snapshot = version.content_json;
      const runConfig = { ...input, shuffleQuestions: input.runType === "SELF_PACED" && input.shuffleQuestions };
      try {
        const writes = [
          db.prepare("INSERT INTO quiz_runs(id,activity_id,sequence,name,definition_version,run_type,competition_mode,hosting_mode,scoring_mode,config_json,snapshot_json,origin_session_id,origin_session_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,(SELECT session_id FROM activities WHERE id=?),(SELECT s.name FROM activities a LEFT JOIN sessions s ON s.id=a.session_id WHERE a.id=?))")
            .bind(runId, activityId, sequence, input.name, requestedVersion, input.runType, input.runType === "LIVE" ? input.competitionMode : null, input.runType === "LIVE" ? input.hostingMode : null, input.runType === "LIVE" ? input.scoringMode : null, JSON.stringify(runConfig), snapshot, activityId, activityId),
          ...((input.runType === "LIVE" && input.competitionMode === "TEAM") ? input.teams.map((name, index) =>
            db.prepare("INSERT INTO quiz_run_teams(id,run_id,name,sort_order) VALUES(?,?,?,?)").bind(uuid(), runId, name, index)) : []),
          db.prepare("UPDATE quiz_activities SET definition_version=? WHERE activity_id=?").bind(requestedVersion,activityId),
          db.prepare("UPDATE activities SET state='open',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(activityId),
        ];
        await db.batch(writes);
      } catch { return fail("Another Run was created. Refresh the Activity history.", 409); }
      await audit(db, runId, "OWNER", "RUN_CREATED", null, null, null, { sequence, input:runConfig, definitionVersion:requestedVersion });
      return json({ run: { id: runId, sequence, state: "LOBBY_OPEN", definitionVersion:requestedVersion } }, 201);
    }
  }
  const runMatch = path.match(/^\/api\/owner\/quiz\/runs\/([0-9a-f-]+)(?:\/(state|commands|teams|results|results\.csv|audit|presenter-token))?$/i);
  if (runMatch) {
    const run = await getRun(db, runMatch[1]!);
    if (!run) return fail("Quiz Run not found.", 404);
    await tick(db, run.id);
    const fresh = (await getRun(db, run.id))!;
    const action = runMatch[2] ?? "state";
    if (request.method === "GET" && action === "state") return json(await ownerState(db, fresh));
    if (request.method === "GET" && action === "results") return json({ run: fresh, results: await scoreResults(db, fresh) });
    if (request.method === "GET" && action === "audit") return json({ audit: (await db.prepare("SELECT id,actor,action,target_id,before_json,after_json,reason,at FROM quiz_audit WHERE run_id=? ORDER BY at,id").bind(run.id).all()).results });
    if (request.method === "GET" && action === "results.csv") return exportCsv(db, fresh);
    if (request.method === "PUT" && action === "teams") {
      const input = await body(request, z.object({ names: z.array(z.string().trim().min(1).max(50)).min(2).max(20) }));
      if (!input || new Set(input.names.map((name) => name.toLowerCase())).size !== input.names.length) return fail("Use 2–20 distinct Team names.", 400);
      if (fresh.run_type !== "LIVE" || fresh.competition_mode !== "TEAM" || fresh.state !== "LOBBY_OPEN") return fail("Team editing is only available in a Team Run lobby.", 409);
      if (await db.prepare("SELECT id FROM quiz_run_participants WHERE run_id=? LIMIT 1").bind(run.id).first()) return fail("Teams are locked after the first participant joins.", 409);
      try {
        await db.batch([
          db.prepare("DELETE FROM quiz_run_teams WHERE run_id=?").bind(run.id),
          ...input.names.map((name,index) => db.prepare("INSERT INTO quiz_run_teams(id,run_id,name,sort_order) VALUES(?,?,?,?)").bind(uuid(),run.id,name,index)),
          db.prepare("UPDATE quiz_runs SET revision=revision+1 WHERE id=?").bind(run.id),
        ]);
      } catch { return fail("A participant joined while Teams were being edited. Refresh the lobby.", 409); }
      await audit(db,run.id,"OWNER","TEAMS_UPDATED",null,null,null,{names:input.names});
      return json({ teams: await teams(db,run.id) });
    }
    if (request.method === "POST" && action === "presenter-token") {
      const token = randomToken();
      await db.prepare("UPDATE quiz_runs SET presenter_token_hash=? WHERE id=?").bind(await sha256(token), run.id).run();
      return json({ url: new URL("/quiz/presenter/" + run.id + "#" + token, url.origin).toString() });
    }
    if (request.method === "POST" && action === "commands") return trainerCommand(request, db, fresh);
  }
  return fail("Quiz route not found.", 404);
}

async function allSubmitted(db: D1Database, run: Run): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS eligible,COUNT(a.id) AS submitted FROM quiz_question_eligibility e JOIN quiz_run_participants p ON p.id=e.participant_id LEFT JOIN quiz_live_answers a ON a.run_id=e.run_id AND a.question_index=e.question_index AND a.participant_id=e.participant_id WHERE e.run_id=? AND e.question_index=? AND p.disqualified_at IS NULL")
    .bind(run.id, run.current_index).first<{eligible:number;submitted:number}>();
  return Number(row?.eligible ?? 0) > 0 && Number(row?.eligible) === Number(row?.submitted);
}
async function startQuestion(db: D1Database, run: Run, startedAt: number): Promise<boolean> {
  const nextRevision = run.revision + 1, deadline = startedAt + content(run).sharedLiveTimerMs;
  const writes = await db.batch([
    db.prepare("UPDATE quiz_runs SET phase='ANSWERING',phase_started_at=?,phase_deadline_at=?,phase_remaining_ms=NULL,active_elapsed_ms=0,revision=revision+1 WHERE id=? AND revision=? AND state='RUNNING' AND phase IN ('COUNTDOWN','READY')").bind(startedAt, deadline, run.id, run.revision),
    db.prepare("INSERT OR IGNORE INTO quiz_question_eligibility(run_id,question_index,participant_id) SELECT r.id,r.current_index,p.id FROM quiz_runs r JOIN quiz_run_participants p ON p.run_id=r.id WHERE r.id=? AND r.revision=? AND r.phase='ANSWERING' AND p.joined_at<=? AND p.disqualified_at IS NULL").bind(run.id, nextRevision, startedAt),
  ]);
  if (!writes[0]?.meta.changes) return false;
  await audit(db, run.id, "SYSTEM", "QUESTION_STARTED", content(run).questions[run.current_index]?.id ?? null, null, null, { questionIndex: run.current_index, deadline });
  return true;
}
async function lockQuestion(db: D1Database, run: Run, lockedAt: number): Promise<boolean> {
  const last = run.current_index === content(run).questions.length - 1;
  const automatic = run.hosting_mode === "AUTOMATIC";
  const nextPhase = automatic ? last ? "COMPLETE" : "TRANSITION" : "LOCKED";
  const nextState = automatic && last ? "COMPLETED" : "RUNNING";
  const deadline = automatic && !last ? lockedAt + 2000 : null;
  const writes = await db.batch([
    db.prepare("UPDATE quiz_runs SET phase=?,state=?,phase_started_at=?,phase_deadline_at=?,phase_remaining_ms=NULL,revision=revision+1,completion_reason=CASE WHEN ?='COMPLETED' THEN 'NORMAL' ELSE completion_reason END,completed_at=CASE WHEN ?='COMPLETED' THEN ? ELSE completed_at END WHERE id=? AND revision=? AND state='RUNNING' AND phase='ANSWERING'")
      .bind(nextPhase, nextState, lockedAt, deadline, nextState, nextState, lockedAt, run.id, run.revision),
    db.prepare("INSERT OR IGNORE INTO quiz_locked_questions(run_id,question_index,locked_at) SELECT id,current_index,? FROM quiz_runs WHERE id=? AND revision=? AND phase=?").bind(lockedAt, run.id, run.revision + 1, nextPhase),
  ]);
  if (!writes[0]?.meta.changes) return false;
  await audit(db, run.id, "SYSTEM", "QUESTION_LOCKED", content(run).questions[run.current_index]?.id ?? null, null, null, { questionIndex: run.current_index });
  if (nextState === "COMPLETED") {
    await db.prepare("UPDATE activities SET state='closed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(run.activity_id).run();
    await saveRevision(db, (await getRun(db, run.id))!, "INITIAL", "Run completed");
  }
  return true;
}
async function completeRun(db: D1Database, run: Run, reason: string): Promise<boolean> {
  if (run.state === "COMPLETED") return false;
  if (run.run_type === "SELF_PACED") {
    await db.batch([
      db.prepare("UPDATE quiz_attempts SET state='AUTO_SUBMITTED',submitted_at=?,submit_reason='TRAINER_END' WHERE run_id=? AND state='IN_PROGRESS'").bind(Date.now(), run.id),
      db.prepare("UPDATE quiz_attempts SET state='NOT_COMPLETED' WHERE run_id=? AND state='NOT_STARTED'").bind(run.id),
    ]);
  }
  const result = await db.prepare("UPDATE quiz_runs SET state='COMPLETED',phase='COMPLETE',phase_deadline_at=NULL,completion_reason=?,completed_at=?,revision=revision+1 WHERE id=? AND revision=? AND state!='COMPLETED'")
    .bind(reason, Date.now(), run.id, run.revision).run();
  if (!result.meta.changes) return false;
  await db.prepare("UPDATE activities SET state='closed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(run.activity_id).run();
  await saveRevision(db, (await getRun(db, run.id))!, "INITIAL", reason);
  await audit(db, run.id, "OWNER", "RUN_COMPLETED", null, reason, { phase: run.phase }, { state: "COMPLETED" });
  return true;
}
async function tick(db: D1Database, runId: string): Promise<void> {
  for (let step = 0; step < 305; step++) {
    const run = await getRun(db, runId);
    if (!run || run.state !== "RUNNING") return;
    const now = Date.now();
    if (run.run_type === "SELF_PACED") {
      await db.prepare("UPDATE quiz_attempts SET state='AUTO_SUBMITTED',submitted_at=deadline_at,submit_reason='TIMEOUT' WHERE run_id=? AND state='IN_PROGRESS' AND deadline_at IS NOT NULL AND deadline_at<=?").bind(run.id, now).run();
      return;
    }
    if (run.phase_deadline_at === null || now < run.phase_deadline_at) return;
    if (run.phase === "ANSWERING") { await lockQuestion(db, run, run.phase_deadline_at); continue; }
    if (run.phase === "TRANSITION") {
      const result = await db.prepare("UPDATE quiz_runs SET phase='COUNTDOWN',current_index=current_index+1,phase_started_at=?,phase_deadline_at=?,revision=revision+1 WHERE id=? AND revision=? AND state='RUNNING' AND phase='TRANSITION'")
        .bind(run.phase_deadline_at, run.phase_deadline_at + 3000, run.id, run.revision).run();
      if (!result.meta.changes) continue;
      continue;
    }
    if (run.phase === "COUNTDOWN") { await startQuestion(db, run, run.phase_deadline_at); continue; }
    return;
  }
}
async function trainerCommand(request: Request, db: D1Database, run: Run): Promise<Response> {
  const input = await body(request, z.object({
    kind: z.enum(["START_RUN","OPEN_QUESTION","PAUSE","RESUME","LOCK_EARLY","REVEAL_ANSWER","SHOW_LEADERBOARD","NEXT_QUESTION","END_EARLY","END_SELF_PACED","REVEAL_FINAL_RESULTS","REGRADE","VOID","DISQUALIFY"]),
    expectedRevision: z.number().int().optional(), questionIndex: z.number().int().optional(), participantId: z.string().uuid().optional(),
    correctAnswerIds: selections.optional(), correctOptionIds: selections.optional(), reason: z.string().trim().max(500).optional(),
  }));
  if (!input) return fail("Check the command.", 400);
  if (input.kind === "REVEAL_FINAL_RESULTS" && run.state === "COMPLETED" && run.final_results_visibility === "RELEASED") return json(await ownerState(db,run));
  if (input.expectedRevision !== undefined && input.expectedRevision !== run.revision) return fail("Run state changed. Refresh and try again.", 409);
  const now = Date.now(), last = run.current_index === content(run).questions.length - 1;
  let changed = false;
  if (input.kind === "START_RUN" && run.state === "LOBBY_OPEN") {
    if (run.run_type === "LIVE" && !await db.prepare("SELECT id FROM quiz_run_participants WHERE run_id=? AND disqualified_at IS NULL LIMIT 1").bind(run.id).first()) return fail("At least one participant must join before a Live Run can start.",409);
    const phase = run.run_type === "LIVE" ? "COUNTDOWN" : "SELF_PACED";
    const deadline = run.run_type === "LIVE" ? now + 3000 : null;
    const result = await db.prepare("UPDATE quiz_runs SET state='RUNNING',phase=?,current_index=CASE WHEN run_type='LIVE' THEN 0 ELSE -1 END,phase_started_at=?,phase_deadline_at=?,started_at=?,revision=revision+1 WHERE id=? AND revision=? AND state='LOBBY_OPEN'")
      .bind(phase, now, deadline, now, run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "OPEN_QUESTION" && run.run_type === "LIVE" && run.hosting_mode === "MANUAL" && run.state === "RUNNING" && run.phase === "READY") {
    const result = await db.prepare("UPDATE quiz_runs SET phase='COUNTDOWN',phase_started_at=?,phase_deadline_at=?,revision=revision+1 WHERE id=? AND revision=? AND phase='READY'").bind(now, now + 3000, run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "PAUSE" && run.run_type === "LIVE" && run.state === "RUNNING" && ["COUNTDOWN","ANSWERING","TRANSITION"].includes(run.phase)) {
    const elapsed = run.phase === "ANSWERING" ? run.active_elapsed_ms + Math.max(0, now - (run.phase_started_at ?? now)) : run.active_elapsed_ms;
    const result = await db.prepare("UPDATE quiz_runs SET state='PAUSED',paused_from_phase=phase,phase_remaining_ms=?,phase_deadline_at=NULL,active_elapsed_ms=?,revision=revision+1 WHERE id=? AND revision=? AND state='RUNNING'")
      .bind(Math.max(0, (run.phase_deadline_at ?? now) - now), elapsed, run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "RESUME" && run.state === "PAUSED") {
    const result = await db.prepare("UPDATE quiz_runs SET state='RUNNING',phase=paused_from_phase,phase_started_at=?,phase_deadline_at=?,phase_remaining_ms=NULL,paused_from_phase=NULL,revision=revision+1 WHERE id=? AND revision=? AND state='PAUSED'")
      .bind(now, now + (run.phase_remaining_ms ?? 0), run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "LOCK_EARLY" && run.hosting_mode === "MANUAL" && run.phase === "ANSWERING" && run.state === "RUNNING") {
    if (!await allSubmitted(db, run)) return fail("All eligible participants must submit before early lock.", 409);
    changed = await lockQuestion(db, run, now);
  } else if (input.kind === "REVEAL_ANSWER" && run.hosting_mode === "MANUAL" && run.phase === "LOCKED" && run.state === "RUNNING") {
    const result = await db.prepare("UPDATE quiz_runs SET phase='REVEALED',revision=revision+1 WHERE id=? AND revision=? AND phase='LOCKED'").bind(run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "SHOW_LEADERBOARD" && run.hosting_mode === "MANUAL" && run.phase === "REVEALED") {
    const result = await db.prepare("UPDATE quiz_runs SET phase='LEADERBOARD',revision=revision+1 WHERE id=? AND revision=? AND phase='REVEALED'").bind(run.id, run.revision).run();
    changed = Boolean(result.meta.changes);
  } else if (input.kind === "NEXT_QUESTION" && run.hosting_mode === "MANUAL" && ["REVEALED","LEADERBOARD"].includes(run.phase)) {
    if (last) changed = await completeRun(db, run, "NORMAL");
    else {
      const result = await db.prepare("UPDATE quiz_runs SET phase='READY',current_index=current_index+1,phase_started_at=NULL,phase_deadline_at=NULL,revision=revision+1 WHERE id=? AND revision=? AND phase IN ('REVEALED','LEADERBOARD')")
        .bind(run.id, run.revision).run();
      changed = Boolean(result.meta.changes);
    }
  } else if (input.kind === "END_EARLY" && run.run_type === "LIVE" && run.state !== "COMPLETED") {
    changed = await completeRun(db, run, "ENDED_EARLY");
  } else if (input.kind === "END_SELF_PACED" && run.run_type === "SELF_PACED" && run.state !== "COMPLETED") {
    changed = await completeRun(db, run, "ENDED_BY_TRAINER");
  } else if (input.kind === "REVEAL_FINAL_RESULTS" && run.run_type === "LIVE" && run.state === "COMPLETED" && run.final_results_visibility === "HIDDEN") {
    const result = await db.prepare("UPDATE quiz_runs SET final_results_visibility='RELEASED',revision=revision+1 WHERE id=? AND state='COMPLETED' AND final_results_visibility='HIDDEN' AND revision=?").bind(run.id,run.revision).run();
    changed = Boolean(result.meta.changes);
    if (changed) await audit(db,run.id,"OWNER","REVEAL_FINAL_RESULTS",null,null,{visibility:"HIDDEN"},{visibility:"RELEASED"});
  } else if (input.kind === "DISQUALIFY" && input.participantId && input.reason && run.state !== "LOBBY_OPEN") {
    const person = await db.prepare("SELECT id,nickname,disqualified_at FROM quiz_run_participants WHERE id=? AND run_id=?").bind(input.participantId, run.id).first<{id:string;nickname:string;disqualified_at:number|null}>();
    if (!person || person.disqualified_at) return fail("Participant not found or already disqualified.", 404);
    const before = await scoreResults(db, run);
    const result = await db.prepare("UPDATE quiz_run_participants SET disqualified_at=?,disqualification_reason=? WHERE id=? AND run_id=? AND disqualified_at IS NULL").bind(now, input.reason, person.id, run.id).run();
    changed = Boolean(result.meta.changes);
    if (changed) {
      await audit(db, run.id, "OWNER", "DISQUALIFY", person.id, input.reason, before, { nickname: person.nickname, disqualified: true });
      if (run.state === "COMPLETED") await saveRevision(db, run, "DISQUALIFY", input.reason, before);
      else if (run.hosting_mode === "AUTOMATIC" && run.phase === "ANSWERING" && await allSubmitted(db, run)) await lockQuestion(db, run, now);
    }
  } else if (["REGRADE","VOID"].includes(input.kind) && run.state === "COMPLETED" && input.reason && input.questionIndex !== undefined) {
    const q = content(run).questions[input.questionIndex];
    if (!q) return fail("Question not found in this Run.", 404);
    const newKey = input.correctAnswerIds ?? input.correctOptionIds;
    if (input.kind === "REGRADE" && (!newKey || !correctKeyValid(q, newKey))) return fail("Choose a valid replacement answer key.", 400);
    const before = await scoreResults(db, run);
    await db.prepare("INSERT INTO quiz_question_corrections(run_id,question_index,correct_json,voided) VALUES(?,?,?,?) ON CONFLICT(run_id,question_index) DO UPDATE SET correct_json=excluded.correct_json,voided=excluded.voided")
      .bind(run.id, input.questionIndex, input.kind === "REGRADE" ? JSON.stringify(newKey) : null, input.kind === "VOID" ? 1 : 0).run();
    await audit(db, run.id, "OWNER", input.kind, q.id, input.reason, before, { correctAnswerIds: newKey ?? null, voided: input.kind === "VOID" });
    await saveRevision(db, run, input.kind, input.reason, before);
    changed = true;
  }
  if (!changed) return fail("This action is unavailable in the current Run state.", 409);
  if (!["REGRADE","VOID","DISQUALIFY","END_EARLY","END_SELF_PACED","NEXT_QUESTION","REVEAL_FINAL_RESULTS"].includes(input.kind)) await audit(db, run.id, "OWNER", input.kind, null, input.reason ?? null, { phase: run.phase }, { phase: (await getRun(db, run.id))?.phase });
  await tick(db, run.id);
  return json(await ownerState(db, (await getRun(db, run.id))!));
}
function correctKeyValid(question: QuizQuestion, ids: readonly string[]): boolean {
  if (new Set(ids).size !== ids.length) return false;
  if (question.type === "REORDER") return ids.length === question.items.length && ids.every((id) => question.items.some((item) => item.id === id));
  if (question.type === "MATCH_PAIRS") {
    const parsed = ids.map(parseMatchAnswerToken);
    const leftIds = parsed.map((entry) => entry?.[0] ?? ""), rightIds = parsed.map((entry) => entry?.[1] ?? "");
    const validLeft = new Set(question.pairs.map((pair) => pair.leftId)), validRight = new Set(question.pairs.map((pair) => pair.rightId));
    return ids.length === question.pairs.length && parsed.every(Boolean) && new Set(leftIds).size === ids.length && new Set(rightIds).size === ids.length
      && leftIds.every((id) => validLeft.has(id)) && rightIds.every((id) => validRight.has(id));
  }
  return ids.every((id) => question.options.some((option) => option.id === id)) && (question.type === "MULTIPLE_CHOICE" ? ids.length >= 2 : ids.length === 1);
}

function shuffleIds(ids: string[]): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0]! % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}
type Presentation = { item_order_json: string | null; right_order_json: string | null };
async function participantPresentation(db: D1Database, runId: string, personId: string, questionIndex: number, question: QuizQuestion): Promise<Presentation> {
  if (question.type !== "REORDER" && question.type !== "MATCH_PAIRS") return { item_order_json: null, right_order_json: null };
  let row = await db.prepare("SELECT item_order_json,right_order_json FROM quiz_attempt_presentations WHERE run_id=? AND participant_id=? AND question_index=?")
    .bind(runId, personId, questionIndex).first<Presentation>();
  if (!row) {
    const items = question.type === "REORDER" ? question.items.map((item) => item.id) : shuffleIds(question.pairs.map((pair) => pair.leftId));
    const rights = question.type === "MATCH_PAIRS" ? shuffleIds(question.pairs.map((pair) => pair.rightId)) : [];
    await db.prepare("INSERT OR IGNORE INTO quiz_attempt_presentations(run_id,participant_id,question_index,item_order_json,right_order_json) VALUES(?,?,?,?,?)")
      .bind(runId, personId, questionIndex, JSON.stringify(shuffleIds(items)), JSON.stringify(rights)).run();
    row = await db.prepare("SELECT item_order_json,right_order_json FROM quiz_attempt_presentations WHERE run_id=? AND participant_id=? AND question_index=?")
      .bind(runId, personId, questionIndex).first<Presentation>();
  }
  return row ?? { item_order_json: null, right_order_json: null };
}
async function presenterPresentation(db: D1Database, runId: string, questionIndex: number, question: QuizQuestion): Promise<Presentation> {
  if (question.type !== "REORDER" && question.type !== "MATCH_PAIRS") return { item_order_json: null, right_order_json: null };
  let row = await db.prepare("SELECT item_order_json,right_order_json FROM quiz_run_presentations WHERE run_id=? AND question_index=?")
    .bind(runId, questionIndex).first<Presentation>();
  if (!row) {
    const items = question.type === "REORDER" ? question.items.map((item) => item.id) : question.pairs.map((pair) => pair.leftId);
    const rights = question.type === "MATCH_PAIRS" ? question.pairs.map((pair) => pair.rightId) : [];
    await db.prepare("INSERT OR IGNORE INTO quiz_run_presentations(run_id,question_index,item_order_json,right_order_json) VALUES(?,?,?,?)")
      .bind(runId, questionIndex, JSON.stringify(shuffleIds(items)), JSON.stringify(shuffleIds(rights))).run();
    row = await db.prepare("SELECT item_order_json,right_order_json FROM quiz_run_presentations WHERE run_id=? AND question_index=?")
      .bind(runId, questionIndex).first<Presentation>();
  }
  return row ?? { item_order_json: null, right_order_json: null };
}
function publicQuestion(q: QuizQuestion, reveal = false, presentation: Presentation = { item_order_json: null, right_order_json: null }, key = correctAnswerIds(q), voided = false) {
  const base = { id: q.id, type: q.type, stem: q.stem, hopeMultiplier: q.hopeMultiplier };
  if (q.type === "REORDER") {
    const ids = presentation.item_order_json ? JSON.parse(presentation.item_order_json) as string[] : q.items.map((item) => item.id);
    return { ...base, items: ids.map((id) => q.items.find((item) => item.id === id)).filter(Boolean),
      ...(reveal ? { correctAnswerIds: voided ? [] : key, explanation: voided ? "" : q.explanation, voided } : {}) };
  }
  if (q.type === "MATCH_PAIRS") {
    const leftOrder = presentation.item_order_json ? JSON.parse(presentation.item_order_json) as string[] : q.pairs.map((pair) => pair.leftId);
    const rightOrder = presentation.right_order_json ? JSON.parse(presentation.right_order_json) as string[] : q.pairs.map((pair) => pair.rightId);
    return { ...base,
      leftItems: leftOrder.map((id) => { const pair = q.pairs.find((item) => item.leftId === id); return pair ? { id: pair.leftId, text: pair.leftText } : null; }).filter(Boolean),
      rightItems: rightOrder.map((id) => { const pair = q.pairs.find((item) => item.rightId === id); return pair ? { id: pair.rightId, text: pair.rightText } : null; }).filter(Boolean),
      ...(reveal ? { correctAnswerIds: voided ? [] : key, explanation: voided ? "" : q.explanation, voided } : {}) };
  }
  return { ...base, options: q.options,
    ...(reveal ? { correctOptionIds: voided ? [] : key, explanation: voided ? "" : q.explanation, voided } : {}) };
}
async function projectedQuestion(db: D1Database, run: Run, q: QuizQuestion | null, reveal: boolean) {
  if (!q) return null;
  const presentation = await presenterPresentation(db, run.id, run.current_index, q);
  if (!reveal) return publicQuestion(q, false, presentation);
  const correction = await db.prepare("SELECT correct_json,voided FROM quiz_question_corrections WHERE run_id=? AND question_index=?")
    .bind(run.id, run.current_index).first<Correction>();
  const key = correction?.correct_json ? JSON.parse(correction.correct_json) as string[] : correctAnswerIds(q);
  return publicQuestion(q, true, presentation, key, Boolean(correction?.voided));
}
async function guest(db: D1Database, request: Request, runId: string): Promise<Person | null> {
  const token = bearerToken(request);
  if (!token || token.length > 256) return null;
  return db.prepare("SELECT id,run_id,nickname,normalized_nickname,team_id,joined_at,disqualified_at,disqualification_reason FROM quiz_run_participants WHERE run_id=? AND token_hash=?")
    .bind(runId, await sha256(token)).first<Person>();
}
async function guestState(db: D1Database, run: Run, person: Person) {
  const quiz = content(run), cfg = config(run), allPeople = await people(db, run.id);
  const attempt = run.run_type === "SELF_PACED" ? await db.prepare("SELECT * FROM quiz_attempts WHERE run_id=? AND participant_id=?").bind(run.id, person.id).first<{state:string;started_at:number|null;deadline_at:number|null;submitted_at:number|null;submit_reason:string|null;question_order_json:string|null;current_position:number}>() : null;
  const drafts = run.run_type === "SELF_PACED" ? (await db.prepare("SELECT question_index,selected_json,version,interacted FROM quiz_drafts WHERE run_id=? AND participant_id=?").bind(run.id, person.id).all<{question_index:number;selected_json:string;version:number;interacted:number}>()).results.map((d) => ({ index: d.question_index, selectedOptionIds: JSON.parse(d.selected_json) as string[], version: d.version, interacted: Boolean(d.interacted) })) : [];
  const current = run.current_index >= 0 ? quiz.questions[run.current_index] : null;
  const eligibility = current ? await db.prepare("SELECT participant_id FROM quiz_question_eligibility WHERE run_id=? AND question_index=? AND participant_id=?").bind(run.id, run.current_index, person.id).first() : null;
  const answer = current ? await db.prepare("SELECT selected_json,effective_elapsed_ms,interacted FROM quiz_live_answers WHERE run_id=? AND question_index=? AND participant_id=?").bind(run.id, run.current_index, person.id).first<{selected_json:string;effective_elapsed_ms:number;interacted:number}>() : null;
  const livePresentation = current ? await participantPresentation(db,run.id,person.id,run.current_index,current) : {item_order_json:null,right_order_json:null};
  const manualReveal = run.run_type === "LIVE" && run.hosting_mode === "MANUAL" && ["REVEALED","LEADERBOARD"].includes(run.phase);
  const finalReleased = run.final_results_visibility === "RELEASED";
  const ownResults = run.run_type === "LIVE" ? (finalReleased || run.phase === "LEADERBOARD") ? await scoreResults(db, run) : null
    : (run.state === "COMPLETED" || (cfg.scoreReleasePolicy === "AFTER_SUBMIT" && ["SUBMITTED","AUTO_SUBMITTED"].includes(attempt?.state ?? ""))) ? await scoreResults(db, run) : null;
  const myResult = run.run_type === "LIVE" && (run.competition_mode !== "INDIVIDUAL" || (!finalReleased && run.phase !== "LEADERBOARD")) ? null : ownResults?.participants.find((entry) => entry.id === person.id) ?? null;
  const teamResult = run.competition_mode === "TEAM" && (finalReleased || run.phase === "LEADERBOARD") ? ownResults?.team.find((entry) => entry.id === person.team_id) ?? null : null;
  const fullReview = run.run_type === "SELF_PACED" && run.state === "COMPLETED" && cfg.reviewPolicy === "AFTER_RUN_DETAIL" && ["SUBMITTED","AUTO_SUBMITTED"].includes(attempt?.state ?? "");
  const effectiveKeys = fullReview ? await corrections(db, run.id) : [];
  const questionOrder = attempt?.question_order_json ? JSON.parse(attempt.question_order_json) as number[] : quiz.questions.map((_,index)=>index);
  const selfQuestions = run.run_type === "SELF_PACED" && attempt?.state === "IN_PROGRESS"
    ? await Promise.all(questionOrder.map(async(index)=>{const q=quiz.questions[index]!;return {...publicQuestion(q,false,await participantPresentation(db,run.id,person.id,index,q)),questionIndex:index};})) : null;
  const currentCorrection = manualReveal && current ? await db.prepare("SELECT correct_json,voided FROM quiz_question_corrections WHERE run_id=? AND question_index=?").bind(run.id,run.current_index).first<Correction>() : null;
  const currentKey = currentCorrection?.correct_json ? JSON.parse(currentCorrection.correct_json) as string[] : current ? correctAnswerIds(current) : [];
  const currentGrade = current && answer ? gradeAnswer(current,JSON.parse(answer.selected_json) as string[],currentKey,answer.interacted!==0) : null;
  const currentPoints = current && answer && currentGrade ? questionPoints({ basePoints:quiz.sharedBasePoints,hopeMultiplier:current.hopeMultiplier,
    scoringMode:run.scoring_mode??"ACCURACY",durationMs:quiz.sharedLiveTimerMs,elapsedMs:answer.effective_elapsed_ms,accuracyRatio:currentGrade.correctnessRatio }) : 0;
  return {
    run: { id: run.id, activityId: run.activity_id, name: run.name, sequence: run.sequence, definitionVersion:run.definition_version, finalResultsVisibility:run.final_results_visibility, runType: run.run_type,
      competitionMode: run.competition_mode, hostingMode: run.hosting_mode, state: run.state, phase: run.phase,
      currentIndex: run.current_index, revision: run.revision, serverNow: Date.now(),
      deadlineAt: run.state === "PAUSED" ? null : run.phase_deadline_at, remainingMs: run.state === "PAUSED" ? run.phase_remaining_ms : null,
      completionReason: run.completion_reason, questionCount: quiz.questions.length, attemptTimerMs: cfg.attemptTimerMs ?? null, shuffleQuestions: Boolean(cfg.shuffleQuestions) },
    participant: { id: person.id, nickname: person.nickname, teamId: person.team_id, disqualified: Boolean(person.disqualified_at) },
    teams: await teams(db, run.id), participantCount: allPeople.filter((p) => !p.disqualified_at).length,
    question: current ? publicQuestion(current,manualReveal,livePresentation,currentKey,Boolean(currentCorrection?.voided)) : null,
    questions: selfQuestions,
    questionOrder,
    eligible: Boolean(eligibility), selectedOptionIds: answer ? JSON.parse(answer.selected_json) as string[] : null,
    attempt, drafts, myResult, teamResult,
    currentResult: manualReveal && current && eligibility ? {
      correct: Boolean(currentGrade?.fullyCorrect), status:currentGrade?.gradingStatus??"UNANSWERED",correctParts:currentGrade?.correctParts??0,totalParts:currentGrade?.totalParts??1,points:currentPoints,
    } : null,
    leaderboard: run.final_results_visibility === "RELEASED" || (run.hosting_mode === "MANUAL" && run.phase === "LEADERBOARD")
      ? run.competition_mode === "TEAM" ? ownResults?.team ?? [] : ownResults?.individual ?? [] : [],
    review: fullReview ? quiz.questions.map((q, index) => {
      const c = effectiveKeys.find((item) => item.question_index === index);
      return { ...publicQuestion(q,true,{item_order_json:null,right_order_json:null},c?.correct_json?JSON.parse(c.correct_json) as string[]:correctAnswerIds(q),Boolean(c?.voided)),questionIndex:index };
    }) : null,
  };
}
async function presenterState(db: D1Database, run: Run) {
  const quiz = content(run), current = run.current_index >= 0 ? quiz.questions[run.current_index] : null;
  const upcoming = run.phase === "TRANSITION" ? quiz.questions[run.current_index + 1] : run.phase === "COUNTDOWN" ? current : null;
  const reveal = run.hosting_mode === "MANUAL" && ["REVEALED","LEADERBOARD"].includes(run.phase);
  const results = (run.state === "COMPLETED" && run.final_results_visibility === "RELEASED") || run.phase === "LEADERBOARD" ? await scoreResults(db, run) : null;
  const roster = await people(db, run.id);
  const distribution: Record<string,number> | null = reveal && current && (current.type === "SINGLE_CHOICE" || current.type === "MULTIPLE_CHOICE" || current.type === "TRUE_FALSE") ? Object.fromEntries(current.options.map((option) => [option.id,0])) : null;
  if (distribution && current) {
    const responseRows = (await db.prepare("SELECT a.selected_json FROM quiz_live_answers a JOIN quiz_run_participants p ON p.id=a.participant_id WHERE a.run_id=? AND a.question_index=? AND p.disqualified_at IS NULL").bind(run.id,run.current_index).all<{selected_json:string}>()).results;
    for (const response of responseRows) for (const optionId of JSON.parse(response.selected_json) as string[]) if (optionId in distribution) distribution[optionId]!++;
  }
  const activity = await db.prepare("SELECT join_pin FROM activities WHERE id=?").bind(run.activity_id).first<{join_pin:string}>();
  return { run: { id: run.id, activityId: run.activity_id, joinPin: activity?.join_pin ?? "", name: run.name, runType: run.run_type, competitionMode: run.competition_mode,
      state: run.state, phase: run.phase, currentIndex: run.current_index, questionCount: quiz.questions.length,
      finalResultsVisibility:run.final_results_visibility,
      deadlineAt: run.state === "PAUSED" ? null : run.phase_deadline_at, remainingMs: run.state === "PAUSED" ? run.phase_remaining_ms : null,
      serverNow: Date.now(), revision: run.revision },
    participantCount: roster.filter((person) => !person.disqualified_at).length,
    roster: run.phase === "LOBBY" ? roster.filter((p) => !p.disqualified_at).map((p) => ({ nickname: p.nickname, teamId: p.team_id })) : [],
    teams: await teams(db, run.id), question: await projectedQuestion(db, run, current ?? null, reveal),
    upcoming: upcoming ? { hopeMultiplier: upcoming.hopeMultiplier, index: run.phase === "TRANSITION" ? run.current_index + 1 : run.current_index } : null,
    distribution,
    questionStats:reveal&&current?(await scoreResults(db,run)).questionStats[run.current_index]??null:null,
    leaderboard: results ? run.competition_mode === "TEAM" ? results.team : results.individual : [] };
}
async function joinRateAllowed(db: D1Database, request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const hash = await sha256(secret + ":quiz-join:" + ip), window = Math.floor(Date.now() / 600000) * 600;
  await db.prepare("INSERT INTO join_rate_limits(key_hash,window_started_at,attempts) VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN window_started_at<excluded.window_started_at THEN 1 ELSE attempts+1 END,window_started_at=excluded.window_started_at").bind(hash, window).run();
  const value = await db.prepare("SELECT attempts FROM join_rate_limits WHERE key_hash=?").bind(hash).first<{attempts:number}>();
  return Number(value?.attempts ?? 0) <= 30;
}

export async function quizPublicRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/quiz/")) return null;
  const db = env.DB;
  if (!db) return fail("Quiz storage is unavailable.", 503);
  if (path === "/api/quiz/lookup" && request.method === "GET") {
    const pin = url.searchParams.get("pin"), activityId = url.searchParams.get("activityId");
    if (!pin && !activityId) return fail("Enter a Quiz PIN or open its link.", 400);
    const activity = await db.prepare("SELECT a.id,a.title,a.join_pin,a.state FROM quiz_activities qa JOIN activities a ON a.id=qa.activity_id WHERE a.deleted_at IS NULL AND (a.id=? OR a.join_pin=?)").bind(activityId ?? "", pin ?? "").first<{id:string;title:string;join_pin:string;state:string}>();
    if (!activity) return fail("Quiz not found.", 404);
    let run = await db.prepare("SELECT q.* FROM quiz_runs q JOIN activities a ON a.current_run_id=q.id WHERE q.activity_id=? AND q.state!='COMPLETED' AND q.deleted_at IS NULL AND q.permanent_deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY q.sequence DESC LIMIT 1").bind(activity.id).first<Run>();
    if (run) { await tick(db, run.id); run = await getRun(db, run.id); }
    const qCount = run ? content(run).questions.length : 0;
    const joinable = Boolean(run && (run.state === "LOBBY_OPEN" || (run.state === "RUNNING" && (run.run_type === "SELF_PACED" || run.current_index < qCount - 1 || run.phase === "READY" || run.phase === "COUNTDOWN"))));
    return json({ activity: { id: activity.id, title: activity.title, joinPin: activity.join_pin }, run: run && joinable ? { id: run.id, name: run.name, runType: run.run_type, competitionMode: run.competition_mode, state: run.state, phase: run.phase, sequence: run.sequence, questionCount: qCount } : null, teams: run && joinable ? await teams(db, run.id) : [] });
  }
  const presenterMatch = path.match(/^\/api\/quiz\/runs\/([0-9a-f-]+)\/presenter$/i);
  if (presenterMatch && request.method === "GET") {
    const run = await getRun(db, presenterMatch[1]!);
    if (!run?.presenter_token_hash || await sha256(bearerToken(request) ?? "") !== run.presenter_token_hash) return fail("Presenter access required.", 401);
    await tick(db, run.id);
    return json(await presenterState(db, (await getRun(db, run.id))!));
  }
  if (path === "/api/quiz/join" && request.method === "POST") {
    if (!await joinRateAllowed(db, request, env.SESSION_SECRET)) return fail("Too many join attempts. Try again later.", 429);
    const input = await body(request, z.object({ runId: z.string().uuid(), nickname: z.string().trim().min(1).max(60), teamId: z.string().uuid().nullable().optional() }));
    if (!input) return fail("Enter a nickname and choose a Team when needed.", 400);
    await tick(db, input.runId);
    const run = await getRun(db, input.runId);
    if (!run) return fail("Run not found.", 404);
    const qCount = content(run).questions.length;
    if (run.state !== "LOBBY_OPEN" && (run.state !== "RUNNING" || (run.run_type === "LIVE" && run.current_index >= qCount - 1 && run.phase !== "READY" && run.phase !== "COUNTDOWN"))) return fail("Join has closed for this Run.", 409);
    if (run.competition_mode === "TEAM" && (!input.teamId || !await db.prepare("SELECT id FROM quiz_run_teams WHERE run_id=? AND id=?").bind(run.id, input.teamId).first())) return fail("Choose a Team from this Run.", 400);
    if (run.competition_mode !== "TEAM" && input.teamId) return fail("This Run has no Teams.", 400);
    const token = randomToken(), personId = uuid(), nickname = input.nickname.replace(/\s+/g, " ").trim(), normalized = nickname.toLocaleLowerCase();
    try {
      const writes = await db.batch([
        db.prepare("INSERT INTO quiz_run_participants(id,run_id,nickname,normalized_nickname,team_id,token_hash,joined_at) SELECT ?,r.id,?,?,?,?,? FROM quiz_runs r WHERE r.id=? AND (r.state='LOBBY_OPEN' OR (r.state='RUNNING' AND (r.run_type='SELF_PACED' OR r.current_index < json_array_length(json_extract(r.snapshot_json,'$.questions'))-1 OR r.phase IN ('READY','COUNTDOWN'))))")
          .bind(personId, nickname, normalized, input.teamId ?? null, await sha256(token), Date.now(), run.id),
        db.prepare("UPDATE quiz_runs SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM quiz_run_participants WHERE id=?)").bind(run.id, personId),
        ...(run.run_type === "SELF_PACED" ? [db.prepare("INSERT INTO quiz_attempts(run_id,participant_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM quiz_run_participants WHERE id=?)").bind(run.id, personId, personId)] : []),
      ]);
      if (!writes[0]?.meta.changes) return fail("Join has closed for this Run.", 409);
    } catch { return fail("That nickname is taken in this Run.", 409); }
    await audit(db, run.id, "PARTICIPANT", "JOIN", personId, null, null, { nickname, teamId: input.teamId ?? null });
    return json({ token, runId: run.id, participantId: personId }, 201);
  }
  const runMatch = path.match(/^\/api\/quiz\/runs\/([0-9a-f-]+)\/(state|team|answer|attempt\/start|attempt\/draft|attempt\/navigate|attempt\/submit)$/i);
  if (!runMatch) return fail("Quiz route not found.", 404);
  const runId = runMatch[1]!, action = runMatch[2]!;
  await tick(db, runId);
  const run = await getRun(db, runId), person = await guest(db, request, runId);
  if (!run || !person) return fail("This Run requires your participant token.", 401);
  if (request.method === "GET" && action === "state") return json(await guestState(db, run, person));
  if (person.disqualified_at) return fail("Participation in this Run has ended.", 403);
  if (request.method === "POST" && action === "team") {
    const input = await body(request, z.object({ teamId: z.string().uuid() }));
    if (!input || run.competition_mode !== "TEAM" || run.state !== "LOBBY_OPEN") return fail("Team selection is locked.", 409);
    if (!await db.prepare("SELECT id FROM quiz_run_teams WHERE run_id=? AND id=?").bind(run.id, input.teamId).first()) return fail("Team not found.", 404);
    await db.prepare("UPDATE quiz_run_participants SET team_id=? WHERE id=? AND run_id=?").bind(input.teamId, person.id, run.id).run();
    await db.prepare("UPDATE quiz_runs SET revision=revision+1 WHERE id=?").bind(run.id).run();
    return json(await guestState(db, (await getRun(db, run.id))!, { ...person, team_id: input.teamId }));
  }
  if (request.method === "POST" && action === "answer") return liveAnswer(request, db, run, person);
  if (request.method === "POST" && action === "attempt/start") return startAttempt(db, run, person);
  if (request.method === "PUT" && action === "attempt/draft") return saveDraft(request, db, run, person);
  if (request.method === "PUT" && action === "attempt/navigate") return saveAttemptPosition(request,db,run,person);
  if (request.method === "POST" && action === "attempt/submit") return submitAttempt(db, run, person);
  return fail("Quiz action unavailable.", 405);
}

async function liveAnswer(request: Request, db: D1Database, run: Run, person: Person): Promise<Response> {
  const input = await body(request, z.object({ questionId: z.string().min(1).max(100), selectedOptionIds: selections, interacted:z.boolean().default(true), requestId: z.string().uuid() }));
  if (!input || run.run_type !== "LIVE") return fail("Check the answer.", 400);
  const priorRequest = await db.prepare("SELECT selected_json FROM quiz_live_answers WHERE run_id=? AND participant_id=? AND request_id=?").bind(run.id, person.id, input.requestId).first<{selected_json:string}>();
  if (priorRequest) return priorRequest.selected_json === JSON.stringify(input.selectedOptionIds)
    ? json({ accepted: true, selectedOptionIds: input.selectedOptionIds, retry: true }) : fail("This request ID was already used.", 409);
  const q = content(run).questions[run.current_index];
  if (!q || q.id !== input.questionId || !selectionValid(q, input.selectedOptionIds)) return fail("Choose valid options for the current question.", 400);
  const existing = await db.prepare("SELECT selected_json,request_id FROM quiz_live_answers WHERE run_id=? AND question_index=? AND participant_id=?").bind(run.id, run.current_index, person.id).first<{selected_json:string;request_id:string}>();
  if (existing) return existing.request_id === input.requestId && existing.selected_json === JSON.stringify(input.selectedOptionIds) ? json({ accepted: true, selectedOptionIds: input.selectedOptionIds, retry: true }) : fail("Your answer is already final.", 409);
  const now = Date.now(), duration = content(run).sharedLiveTimerMs;
  try {
    const result = await db.prepare("INSERT INTO quiz_live_answers(id,run_id,question_index,participant_id,selected_json,accepted_at,effective_elapsed_ms,request_id,interacted) SELECT ?,r.id,r.current_index,p.id,?,?,MIN(?,MAX(0,r.active_elapsed_ms+?-COALESCE(r.phase_started_at,?))),?,? FROM quiz_runs r JOIN quiz_question_eligibility e ON e.run_id=r.id AND e.question_index=r.current_index JOIN quiz_run_participants p ON p.id=e.participant_id AND p.run_id=r.id WHERE r.id=? AND p.id=? AND r.state='RUNNING' AND r.phase='ANSWERING' AND r.phase_deadline_at>? AND p.disqualified_at IS NULL")
      .bind(uuid(), JSON.stringify(input.selectedOptionIds), now, duration-1, now, now, input.requestId, Number(input.interacted), run.id, person.id, now).run();
    if (!result.meta.changes) return fail(run.state === "PAUSED" ? "Run is paused." : "Question is locked, expired, or you were not eligible for it.", 409);
  } catch {
    const retry = await db.prepare("SELECT request_id,selected_json FROM quiz_live_answers WHERE run_id=? AND question_index=? AND participant_id=?").bind(run.id, run.current_index, person.id).first<{request_id:string;selected_json:string}>();
    return retry?.request_id === input.requestId && retry.selected_json === JSON.stringify(input.selectedOptionIds) ? json({ accepted: true, selectedOptionIds: input.selectedOptionIds, retry: true }) : fail("Your answer is already final.", 409);
  }
  await db.prepare("UPDATE quiz_runs SET revision=revision+1 WHERE id=?").bind(run.id).run();
  const fresh = (await getRun(db, run.id))!;
  if (fresh.hosting_mode === "AUTOMATIC" && fresh.state === "RUNNING" && fresh.phase === "ANSWERING" && await allSubmitted(db, fresh)) await lockQuestion(db, fresh, Date.now());
  return json({ accepted: true, selectedOptionIds: input.selectedOptionIds });
}
function selectionValid(q: QuizQuestion, ids: readonly string[]): boolean {
  if (!ids.length || new Set(ids).size !== ids.length) return false;
  if (q.type === "REORDER") return ids.length === q.items.length && ids.every((id)=>q.items.some((item)=>item.id===id));
  if (q.type === "MATCH_PAIRS") {
    if (ids.length > q.pairs.length) return false;
    const pairs=ids.map(parseMatchAnswerToken),leftIds=pairs.map((pair)=>pair?.[0]??""),rightIds=pairs.map((pair)=>pair?.[1]??"");
    const validLeft=new Set(q.pairs.map((pair)=>pair.leftId)),validRight=new Set(q.pairs.map((pair)=>pair.rightId));
    return pairs.every(Boolean)&&new Set(leftIds).size===ids.length&&new Set(rightIds).size===ids.length&&leftIds.every((id)=>validLeft.has(id))&&rightIds.every((id)=>validRight.has(id));
  }
  return (q.type === "MULTIPLE_CHOICE" || ids.length === 1) && ids.every((id) => q.options.some((option) => option.id === id));
}
async function startAttempt(db: D1Database, run: Run, person: Person): Promise<Response> {
  if (run.run_type !== "SELF_PACED" || run.state !== "RUNNING") return fail("The Self-paced Run is not open.", 409);
  const timer = config(run).attemptTimerMs ?? null, now = Date.now();
  const questionOrder = config(run).shuffleQuestions ? shuffleIds(content(run).questions.map((_,index)=>String(index))).map(Number) : content(run).questions.map((_,index)=>index);
  const result = await db.prepare("UPDATE quiz_attempts SET state='IN_PROGRESS',started_at=?,deadline_at=?,question_order_json=?,current_position=0 WHERE run_id=? AND participant_id=? AND state='NOT_STARTED' AND EXISTS(SELECT 1 FROM quiz_runs WHERE id=? AND state='RUNNING')")
    .bind(now, timer ? now + timer : null, JSON.stringify(questionOrder), run.id, person.id, run.id).run();
  if (!result.meta.changes) return fail("This attempt has already started or ended.", 409);
  await audit(db, run.id, "PARTICIPANT", "ATTEMPT_STARTED", person.id, null, null, { startedAt: now });
  return json(await guestState(db, run, person));
}
async function saveDraft(request: Request, db: D1Database, run: Run, person: Person): Promise<Response> {
  const input = await body(request, z.object({ questionId: z.string().min(1).max(100), selectedOptionIds: selections, interacted:z.boolean().default(true), version: z.number().int().min(1) }));
  if (!input || run.run_type !== "SELF_PACED") return fail("Check the draft.", 400);
  const index = content(run).questions.findIndex((q) => q.id === input.questionId), q = content(run).questions[index];
  if (!q || (input.selectedOptionIds.length && !selectionValid(q, input.selectedOptionIds))) return fail("Question or choices are invalid.", 400);
  const now = Date.now();
  const result = await db.prepare("INSERT INTO quiz_drafts(run_id,participant_id,question_index,selected_json,version,saved_at,interacted) SELECT ?,?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM quiz_attempts a JOIN quiz_runs r ON r.id=a.run_id WHERE a.run_id=? AND a.participant_id=? AND a.state='IN_PROGRESS' AND r.state='RUNNING' AND (a.deadline_at IS NULL OR a.deadline_at>?)) ON CONFLICT(run_id,participant_id,question_index) DO UPDATE SET selected_json=excluded.selected_json,version=excluded.version,saved_at=excluded.saved_at,interacted=excluded.interacted WHERE excluded.version>quiz_drafts.version")
    .bind(run.id, person.id, index, JSON.stringify(input.selectedOptionIds), input.version, now, Number(input.interacted), run.id, person.id, now).run();
  if (!result.meta.changes) {
    const saved = await db.prepare("SELECT selected_json,version FROM quiz_drafts WHERE run_id=? AND participant_id=? AND question_index=?").bind(run.id, person.id, index).first<{selected_json:string;version:number}>();
    if (saved?.version === input.version && saved.selected_json === JSON.stringify(input.selectedOptionIds)) return json({ saved: true, version: input.version, retry: true });
    return fail("This draft is stale or the attempt has ended. Refresh to recover the latest answer.", 409);
  }
  return json({ saved: true, version: input.version });
}
async function saveAttemptPosition(request:Request,db:D1Database,run:Run,person:Person):Promise<Response> {
  const input=await body(request,z.object({position:z.number().int().min(0).max(99)}));
  if(!input||run.run_type!=="SELF_PACED")return fail("Check the Quiz position.",400);
  if(input.position>=content(run).questions.length)return fail("Question position is outside this Quiz.",400);
  const result=await db.prepare("UPDATE quiz_attempts SET current_position=? WHERE run_id=? AND participant_id=? AND state='IN_PROGRESS' AND EXISTS(SELECT 1 FROM quiz_runs WHERE id=? AND state='RUNNING') AND (deadline_at IS NULL OR deadline_at>?)")
    .bind(input.position,run.id,person.id,run.id,Date.now()).run();
  if(!result.meta.changes)return fail("This attempt has ended. Refresh to see its current state.",409);
  return json({saved:true,position:input.position});
}
async function submitAttempt(db: D1Database, run: Run, person: Person): Promise<Response> {
  if (run.run_type !== "SELF_PACED") return fail("This is not a Self-paced Run.", 400);
  const now = Date.now();
  const result = await db.prepare("UPDATE quiz_attempts SET state='SUBMITTED',submitted_at=?,submit_reason='USER' WHERE run_id=? AND participant_id=? AND state='IN_PROGRESS' AND (deadline_at IS NULL OR deadline_at>?) AND EXISTS(SELECT 1 FROM quiz_runs WHERE id=? AND state='RUNNING')")
    .bind(now, run.id, person.id, now, run.id).run();
  if (!result.meta.changes) return fail("This attempt has ended or the timer expired.", 409);
  await audit(db, run.id, "PARTICIPANT", "ATTEMPT_SUBMITTED", person.id, null, null, { submittedAt: now });
  return json(await guestState(db, run, person));
}
function csvCell(value: unknown): string {
  let string = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(string) || /^[\t\r\n]/.test(string)) string = "'" + string;
  return '"' + string.replace(/"/g, '""') + '"';
}
async function exportCsv(db: D1Database, run: Run): Promise<Response> {
  if (run.state !== "COMPLETED") return fail("Complete the Run before exporting.", 409);
  const result = await scoreResults(db, run), peopleRows = await people(db, run.id), teamRows = await teams(db, run.id);
  const revision = (await db.prepare("SELECT MAX(revision) AS n FROM quiz_result_revisions WHERE run_id=?").bind(run.id).first<{n:number|null}>())?.n ?? 0;
  const header = ["row_type","run_id","run_sequence","result_revision","participant_id","nickname","team","status","disqualified","question_id","question_order","selected_answer_ids","grading_status","correct_parts","total_parts","is_fully_correct","awarded_points","total_points","fully_correct_count","team_valid_members","team_average_points","rank"];
  const rows: unknown[][] = [header];
  for (const person of peopleRows) {
    const standing = result.participants.find((p) => p.id === person.id)!;
    const team = teamRows.find((t) => t.id === person.team_id);
    const attempt = result.attemptStatuses.find((a) => a.participant_id === person.id);
    rows.push(["PARTICIPANT",run.id,run.sequence,revision,person.id,person.nickname,team?.name ?? "",attempt?.state ?? run.state,Boolean(person.disqualified_at),"","","","","","","", "",standing.points,standing.correct,"","",result.individual.find((p) => p.id === person.id)?.rank ?? ""]);
  }
  for (const team of result.team) rows.push(["TEAM",run.id,run.sequence,revision,"","",team.name,"","", "","","","","","","", "",team.sumPoints,team.sumCorrect,team.members,team.averagePoints,team.rank ?? ""]);
  const live = await answers(db, run.id), drafts = (await db.prepare("SELECT participant_id,question_index,selected_json,version,interacted FROM quiz_drafts WHERE run_id=?").bind(run.id).all<Draft>()).results;
  const answerRows = run.run_type === "LIVE" ? live : drafts;
  const changed = await corrections(db, run.id), quiz = content(run);
  for (const answer of answerRows) {
    const q = quiz.questions[answer.question_index]!, person = peopleRows.find((p) => p.id === answer.participant_id);
    if (!person) continue;
    const c = changed.find((item) => item.question_index === answer.question_index);
    const key = c?.correct_json ? JSON.parse(c.correct_json) as string[] : correctAnswerIds(q);
    const grade = gradeAnswer(q,JSON.parse(answer.selected_json) as string[],key,answer.interacted!==0);
    const awarded = !c?.voided&&!person.disqualified_at ? questionPoints({basePoints:quiz.sharedBasePoints,hopeMultiplier:q.hopeMultiplier,scoringMode:run.run_type==="LIVE"?run.scoring_mode??"ACCURACY":"ACCURACY",durationMs:run.run_type==="LIVE"?quiz.sharedLiveTimerMs:null,elapsedMs:run.run_type==="LIVE"?(answer as Answer).effective_elapsed_ms:null,accuracyRatio:c?.voided?0:grade.correctnessRatio}) : 0;
    rows.push(["ANSWER",run.id,run.sequence,revision,person.id,person.nickname,teamRows.find((t) => t.id === person.team_id)?.name ?? "","",Boolean(person.disqualified_at),q.id,answer.question_index+1,answer.selected_json,c?.voided?"VOIDED":grade.gradingStatus,grade.correctParts,grade.totalParts,grade.fullyCorrect,awarded,"","","",""]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="quiz-run-' + run.sequence + '.csv"',"Cache-Control":"no-store" } });
}
