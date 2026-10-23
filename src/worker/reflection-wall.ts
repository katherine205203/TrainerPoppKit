import { z } from "zod";
import { REFLECTION_REACTIONS, safeReflectionCsvCell, validateReflectionColumns, validateReflectionText } from "../domain/reflection-wall";

interface ReflectionEnv { DB?: D1Database; SESSION_SECRET?: string }
type WallRow = {
  activity_id: string; session_id: string | null; title: string; state: string; join_pin: string | null;
  session_name: string | null; session_status: string | null; description: string; identity_mode: "anonymous" | "named"; access_enabled: number;
  post_limit: number; phase: "DRAFT" | "OPEN" | "PAUSED" | "CLOSED" | "ARCHIVED"; access_slug: string;
  presentation_mode: "off" | "all" | "focus" | "spotlight" | "cluster" | "blank"; focus_column_id: string | null;
  spotlight_post_id: string | null; focus_cluster_id: string | null; clusters_visible: number; started_once: number; archived_at: string | null;
};
type Actor = { id: string; activity_id: string; display_name: string | null };
const reactions = new Set<string>(REFLECTION_REACTIONS.map(({ id: key }) => key));
const CreateWallInput = z.object({
  title: z.string().trim().min(1).max(100), description: z.string().trim().max(500).default(""),
  identityMode: z.enum(["anonymous", "named"]).default("anonymous"), postLimit: z.number().int().min(1).max(10).default(5),
  sessionId: z.string().uuid().nullable().default(null), columns: z.array(z.object({ title: z.string(), question: z.string().default("") })).min(1).max(4),
});
const ActorInput = z.object({ displayName: z.string().trim().max(60).optional().default("") });
const PostInput = z.object({ columnId: z.string().min(1), body: z.string().max(500), idempotencyKey: z.string().uuid().optional() });
const CommentInput = z.object({ postId: z.string().min(1), body: z.string().max(300), idempotencyKey: z.string().uuid().optional() });
const ReactionInput = z.object({ targetType: z.enum(["post", "comment"]), targetId: z.string().min(1), reaction: z.string(), selected: z.boolean() });
const EditInput = z.object({ title: z.string().trim().min(1).max(100), description: z.string().trim().max(500), identityMode: z.enum(["anonymous", "named"]), postLimit: z.number().int().min(1).max(10), columns: z.array(z.object({ id: z.string().optional(), title: z.string(), question: z.string().default("") })).min(1).max(4) });

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra); headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff"); headers.set("Referrer-Policy", "same-origin"); headers.set("X-Frame-Options", "DENY");
  return new Response(JSON.stringify(data), { status, headers });
}
function fail(message: string, status = 400) { return json({ error: message }, status); }
function newId() { return crypto.randomUUID(); }
function randomToken(bytes = 32) { return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join(""); }
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function bearer(request: Request) { const value = request.headers.get("Authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : ""; }
async function readBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T> | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 32_768) return null;
  try { const result = schema.safeParse(await request.json()); return result.success ? result.data : null; } catch { return null; }
}
function dbFor(env: ReflectionEnv) { return env.DB ?? null; }
async function wallById(db: D1Database, activityId: string): Promise<WallRow | null> {
  return db.prepare(`SELECT a.id AS activity_id,a.session_id,a.title,a.state,a.join_pin,s.name AS session_name,s.status AS session_status,
      w.description,w.identity_mode,w.access_enabled,w.post_limit,w.phase,w.access_slug,w.presentation_mode,w.focus_column_id,w.spotlight_post_id,
      w.focus_cluster_id,w.clusters_visible,w.started_once,w.archived_at
    FROM activities a JOIN reflection_wall_configs w ON w.activity_id=a.id LEFT JOIN sessions s ON s.id=a.session_id
    WHERE a.id=? AND a.tool_id='reflection-wall'`).bind(activityId).first<WallRow>();
}
async function wallBySlug(db: D1Database, slug: string): Promise<WallRow | null> {
  return db.prepare(`SELECT a.id AS activity_id,a.session_id,a.title,a.state,a.join_pin,s.name AS session_name,s.status AS session_status,
      w.description,w.identity_mode,w.access_enabled,w.post_limit,w.phase,w.access_slug,w.presentation_mode,w.focus_column_id,w.spotlight_post_id,
      w.focus_cluster_id,w.clusters_visible,w.started_once,w.archived_at
    FROM activities a JOIN reflection_wall_configs w ON w.activity_id=a.id LEFT JOIN sessions s ON s.id=a.session_id
    WHERE w.access_slug=? AND w.access_enabled=1 AND a.tool_id='reflection-wall'`).bind(slug).first<WallRow>();
}
async function columnsFor(db: D1Database, activityId: string) {
  return (await db.prepare("SELECT id,title,question,sort_order,color_key FROM reflection_wall_columns WHERE activity_id=? ORDER BY sort_order").bind(activityId)
    .all<{ id: string; title: string; question: string; sort_order: number; color_key: string }>()).results;
}
async function clustersFor(db: D1Database, activityId: string) {
  return (await db.prepare(`SELECT c.id,c.title,c.description,c.color_key,c.created_at,COUNT(p.id) AS post_count
    FROM reflection_wall_clusters c LEFT JOIN reflection_wall_posts p ON p.cluster_id=c.id AND p.hidden=0
    WHERE c.activity_id=? GROUP BY c.id ORDER BY c.created_at,c.id`).bind(activityId)
    .all<{ id: string; title: string; description: string; color_key: string; created_at: string; post_count: number }>()).results;
}
async function cursorFor(db: D1Database, activityId: string) {
  const row = await db.prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM reflection_wall_events WHERE activity_id=?").bind(activityId).first<{ cursor: number }>();
  return Number(row?.cursor ?? 0);
}
function groupReactions(rows: Array<{ target_type: string; target_id: string; reaction: string; actor_id: string }>, type: string, targetId: string, actorId?: string) {
  const counts: Record<string, number> = Object.fromEntries(REFLECTION_REACTIONS.map(({ id }) => [id, 0]));
  const mine: string[] = [];
  for (const row of rows) if (row.target_type === type && row.target_id === targetId) {
    counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
    if (actorId && row.actor_id === actorId) mine.push(row.reaction);
  }
  return { counts, mine };
}
function sumReactionCounts(counts: Record<string, number>) { return Object.values(counts).reduce((sum, count) => sum + count, 0); }
async function buildSnapshot(db: D1Database, wall: WallRow, options: { owner?: boolean; presenter?: boolean; actor?: Actor | null } = {}) {
  const owner = Boolean(options.owner);
  const presenter = Boolean(options.presenter);
  const actor = options.actor ?? null;
  const columns = await columnsFor(db, wall.activity_id);
  const postRows = await db.prepare(`SELECT p.id,p.column_id,p.actor_id,p.body,p.hidden,p.cluster_id,p.created_at,p.updated_at,
      a.display_name AS actor_name FROM reflection_wall_posts p JOIN reflection_wall_actors a ON a.id=p.actor_id
    WHERE p.activity_id=? ${owner ? "" : "AND p.hidden=0"} ORDER BY p.created_at,p.id`).bind(wall.activity_id)
    .all<{ id: string; column_id: string; actor_id: string; body: string; hidden: number; cluster_id: string | null; created_at: string; updated_at: string; actor_name: string | null }>();
  const postIds = postRows.results.map((post) => post.id);
  const postIdSet = new Set(postIds);
  const commentRows = postIds.length ? await db.prepare(`SELECT c.id,c.post_id,c.body,c.hidden,c.created_at,c.updated_at,c.actor_id,a.display_name AS actor_name
      FROM reflection_wall_comments c JOIN reflection_wall_actors a ON a.id=c.actor_id
      WHERE c.activity_id=? ${owner ? "" : "AND c.hidden=0"} ORDER BY c.created_at,c.id`).bind(wall.activity_id)
      .all<{ id: string; post_id: string; body: string; hidden: number; created_at: string; updated_at: string; actor_id: string; actor_name: string | null }>() : { results: [] as Array<{ id: string; post_id: string; body: string; hidden: number; created_at: string; updated_at: string; actor_id: string; actor_name: string | null }> };
  const commentsForVisiblePosts = commentRows.results.filter((comment) => postIdSet.has(comment.post_id));
  const reactionRows = postIds.length ? await db.prepare(`SELECT target_type,target_id,reaction,actor_id FROM reflection_wall_reactions WHERE activity_id=?`)
    .bind(wall.activity_id).all<{ target_type: string; target_id: string; reaction: string; actor_id: string }>() : { results: [] as Array<{ target_type: string; target_id: string; reaction: string; actor_id: string }> };
  const clusters = owner || (presenter && Boolean(wall.clusters_visible)) ? await clustersFor(db, wall.activity_id) : [];
  const columnsWithCounts = columns.map((column) => ({ id: column.id, title: column.title, question: column.question, sortOrder: Number(column.sort_order), colorKey: column.color_key,
    postCount: postRows.results.filter((post) => post.column_id === column.id && !post.hidden).length,
    hiddenCount: owner ? postRows.results.filter((post) => post.column_id === column.id && Boolean(post.hidden)).length : 0 }));
  const commentsByPost = new Map<string, unknown[]>();
  for (const comment of commentsForVisiblePosts) {
    const reactionsForComment = groupReactions(reactionRows.results, "comment", comment.id, actor?.id);
    const value = { id: comment.id, body: comment.body, hidden: Boolean(comment.hidden), createdAt: comment.created_at,
      updatedAt: comment.updated_at, ...(wall.identity_mode === "named" && !presenter ? { author: comment.actor_name ?? "Participant" } : {}),
      ownedByMe: actor?.id === comment.actor_id, reactions: reactionsForComment.counts, myReactions: reactionsForComment.mine };
    commentsByPost.set(comment.post_id, [...(commentsByPost.get(comment.post_id) ?? []), value]);
  }
  let posts = postRows.results.map((post) => {
    const reactionsForPost = groupReactions(reactionRows.results, "post", post.id, actor?.id);
    return { id: post.id, columnId: post.column_id, body: post.body, hidden: Boolean(post.hidden), clusterId: owner || (presenter && Boolean(wall.clusters_visible)) ? post.cluster_id : null,
      createdAt: post.created_at, updatedAt: post.updated_at, ...(wall.identity_mode === "named" && !presenter ? { author: post.actor_name ?? "Participant" } : {}),
      ownedByMe: actor?.id === post.actor_id,
      reactions: reactionsForPost.counts, myReactions: reactionsForPost.mine, comments: commentsByPost.get(post.id) ?? [] };
  });
  const aggregate = await db.prepare(owner
    ? `SELECT COUNT(*) AS post_count,COUNT(DISTINCT actor_id) AS contributor_count,SUM(hidden) AS hidden_count FROM reflection_wall_posts WHERE activity_id=?`
    : `SELECT COUNT(*) AS post_count,COUNT(DISTINCT actor_id) AS contributor_count,0 AS hidden_count FROM reflection_wall_posts WHERE activity_id=? AND hidden=0`).bind(wall.activity_id)
    .first<{ post_count: number; contributor_count: number; hidden_count: number | null }>();
  const commentCount = await db.prepare(owner
    ? "SELECT COUNT(*) AS count,SUM(hidden) AS hidden_count FROM reflection_wall_comments WHERE activity_id=?"
    : `SELECT COUNT(*) AS count FROM reflection_wall_comments c JOIN reflection_wall_posts p ON p.id=c.post_id
      WHERE c.activity_id=? AND c.hidden=0 AND p.hidden=0`).bind(wall.activity_id).first<{ count: number; hidden_count?: number | null }>();
  const visiblePostIds = new Set(postRows.results.filter((post) => !post.hidden).map((post) => post.id));
  const visibleCommentIds = new Set(commentsForVisiblePosts.filter((comment) => !comment.hidden).map((comment) => comment.id));
  const reactionBreakdown: Record<string, number> = Object.fromEntries(REFLECTION_REACTIONS.map(({ id }) => [id, 0]));
  for (const row of reactionRows.results) {
    const visible = owner || (row.target_type === "post" ? visiblePostIds.has(row.target_id) : visibleCommentIds.has(row.target_id));
    if (visible) reactionBreakdown[row.reaction] = (reactionBreakdown[row.reaction] ?? 0) + 1;
  }
  const participants = Number((await db.prepare("SELECT COUNT(*) AS count FROM reflection_wall_actors WHERE activity_id=?").bind(wall.activity_id)
    .first<{ count: number }>())?.count ?? 0);
  if (presenter) {
    if (wall.presentation_mode === "blank" || wall.presentation_mode === "off") posts = [];
    else if (wall.presentation_mode === "focus" && wall.focus_column_id) posts = posts.filter((post) => post.columnId === wall.focus_column_id);
    else if (wall.presentation_mode === "spotlight" && wall.spotlight_post_id) posts = posts.filter((post) => post.id === wall.spotlight_post_id);
    else if (wall.presentation_mode === "cluster" && wall.focus_cluster_id) posts = posts.filter((post) => {
      const raw = postRows.results.find((item) => item.id === post.id);
      return raw?.cluster_id === wall.focus_cluster_id;
    });
  }
  const responseColumns = presenter
    ? wall.presentation_mode === "focus" && wall.focus_column_id ? columnsWithCounts.filter((column) => column.id === wall.focus_column_id)
      : wall.presentation_mode === "spotlight" && wall.spotlight_post_id ? columnsWithCounts.filter((column) => postRows.results.find((post) => post.id === wall.spotlight_post_id)?.column_id === column.id)
        : wall.presentation_mode === "cluster" ? columnsWithCounts.filter((column) => posts.some((post) => post.columnId === column.id))
          : columnsWithCounts
    : columnsWithCounts;
  const presenterVisiblePosts = presenter ? posts.filter((post) => !post.hidden) : [];
  const presenterContributorIds = presenter ? new Set(postRows.results.filter((post) => presenterVisiblePosts.some((visible) => visible.id === post.id)).map((post) => post.actor_id)) : new Set<string>();
  const presenterReactionBreakdown: Record<string, number> = Object.fromEntries(REFLECTION_REACTIONS.map(({ id }) => [id, 0]));
  if (presenter) for (const post of presenterVisiblePosts) {
    for (const [reaction, count] of Object.entries(post.reactions)) presenterReactionBreakdown[reaction] = (presenterReactionBreakdown[reaction] ?? 0) + count;
    for (const comment of post.comments as Array<{ reactions: Record<string, number> }>) {
      for (const [reaction, count] of Object.entries(comment.reactions)) presenterReactionBreakdown[reaction] = (presenterReactionBreakdown[reaction] ?? 0) + count;
    }
  }
  const presenterReactionTotal = sumReactionCounts(presenterReactionBreakdown);
  const moderationEvents = owner ? (await db.prepare(`SELECT item_kind AS kind,item_id AS targetId,action,moderator_role AS moderator,reason,created_at AS createdAt
    FROM reflection_wall_moderation_events WHERE activity_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).bind(wall.activity_id)
    .all<{ kind: "post" | "comment"; targetId: string; action: "HIDE" | "RESTORE"; moderator: string; reason: string; createdAt: string }>()).results : undefined;
  const actorPostCount = actor ? (await db.prepare("SELECT COUNT(*) AS count FROM reflection_wall_posts WHERE activity_id=? AND actor_id=?").bind(wall.activity_id, actor.id).first<{ count: number }>())?.count ?? 0 : 0;
  const cursor = await cursorFor(db, wall.activity_id);
  return {
    wall: { id: wall.activity_id, title: wall.title, description: wall.description, identityMode: wall.identity_mode, postLimit: Number(wall.post_limit),
      phase: wall.phase, state: wall.state, sessionId: wall.session_id, sessionName: wall.session_name, archivedAt: wall.archived_at,
      accessEnabled: Boolean(wall.access_enabled), columnsLocked: Boolean(wall.started_once), focusColumnId: wall.focus_column_id, spotlightPostId: wall.spotlight_post_id, focusClusterId: wall.focus_cluster_id,
      presentationMode: presenter || owner ? wall.presentation_mode : undefined, clustersVisible: Boolean(wall.clusters_visible), cursor },
    columns: presenter && ["blank", "off"].includes(wall.presentation_mode) ? [] : responseColumns,
    posts,
    clusters: presenter && ["blank", "off"].includes(wall.presentation_mode) ? []
      : presenter && wall.presentation_mode === "cluster" ? clusters.filter((cluster) => cluster.id === wall.focus_cluster_id) : clusters,
    ...(moderationEvents ? { moderationEvents } : {}),
    analytics: presenter && ["blank", "off"].includes(wall.presentation_mode) ? { posts: 0, visiblePosts: 0, hiddenPosts: 0, participants: 0, contributors: 0, activePosters: 0, comments: 0, hiddenComments: 0, reactions: 0, reactionBreakdown: Object.fromEntries(REFLECTION_REACTIONS.map(({ id }) => [id, 0])), byColumn: [] }
      : presenter ? { posts: presenterVisiblePosts.length, visiblePosts: presenterVisiblePosts.length, hiddenPosts: 0, participants,
        contributors: presenterContributorIds.size, activePosters: presenterContributorIds.size,
        comments: presenterVisiblePosts.reduce((sum, post) => sum + post.comments.length, 0), hiddenComments: 0,
        reactions: presenterReactionTotal, reactionBreakdown: presenterReactionBreakdown,
        byColumn: responseColumns.map((column) => ({ id: column.id, title: column.title, posts: presenterVisiblePosts.filter((post) => post.columnId === column.id).length, hidden: 0 })) }
        : { posts: Number(aggregate?.post_count ?? 0), visiblePosts: postRows.results.filter((post) => !post.hidden).length,
          hiddenPosts: Number(aggregate?.hidden_count ?? 0), participants, contributors: Number(aggregate?.contributor_count ?? 0),
          activePosters: new Set(postRows.results.filter((post) => !post.hidden).map((post) => post.actor_id)).size,
          comments: Math.max(0, Number(commentCount?.count ?? 0) - Number(commentCount?.hidden_count ?? 0)), hiddenComments: Number(commentCount?.hidden_count ?? 0),
          reactions: Object.values(reactionBreakdown).reduce((sum, count) => sum + count, 0), reactionBreakdown,
          byColumn: columnsWithCounts.map((column) => ({ id: column.id, title: column.title, posts: column.postCount, hidden: column.hiddenCount })) },
    viewer: { hasActor: Boolean(actor), canWrite: Boolean(actor && wall.phase === "OPEN" && wall.session_status !== "completed"),
      quotaUsed: actorPostCount, quotaRemaining: Math.max(0, Number(wall.post_limit) - actorPostCount) },
  };
}
async function uniquePin(db: D1Database) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    const used = await db.prepare(`SELECT 1 FROM activities WHERE join_pin=? UNION SELECT 1 FROM poll_session_access WHERE join_pin=? LIMIT 1`).bind(pin, pin).first();
    if (!used) return pin;
  }
  return null;
}
async function createWall(db: D1Database, input: z.infer<typeof CreateWallInput>) {
  const validated = validateReflectionColumns(input.columns);
  if (!validated.ok) return { error: validated.message } as const;
  if (input.sessionId && !await db.prepare("SELECT id FROM sessions WHERE id=?").bind(input.sessionId).first()) return { error: "Session not found." } as const;
  const activityId = newId();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO activities(id,session_id,title,tool_id,state,result_policy,require_name,allow_teams,instrument_version,scoring_version)
      VALUES(?,?,?,'reflection-wall','draft','confirmation',0,0,'reflection-wall-v1.0','wall-events-v1')`)
      .bind(activityId, input.sessionId, input.title.trim()),
    db.prepare(`INSERT INTO reflection_wall_configs(activity_id,description,identity_mode,post_limit,phase,access_slug)
      VALUES(?,?,?,?, 'DRAFT',?)`).bind(activityId, input.description.trim(), input.identityMode, input.postLimit, randomToken(16)),
    db.prepare("INSERT INTO presentation_state(activity_id) VALUES(?)").bind(activityId),
  ];
  validated.columns.forEach((column, index) => statements.push(db.prepare(`INSERT INTO reflection_wall_columns(id,activity_id,title,question,sort_order,color_key) VALUES(?,?,?,?,?,?)`)
    .bind(newId(), activityId, column.title, column.question, index, ["gold", "pink", "aqua", "purple"][index]!)));
  await db.batch(statements);
  return { activityId } as const;
}

async function ownerRoute(request: Request, env: ReflectionEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/owner/reflection-walls")) return null;
  const db = dbFor(env); if (!db) return fail("D1 database is not configured.", 503);
  if (request.method === "GET" && url.pathname === "/api/owner/reflection-walls") {
    const rows = await db.prepare(`SELECT a.id,a.title,a.state,a.session_id,s.name AS session_name,a.join_pin,w.phase,w.identity_mode,w.post_limit,w.access_slug,
      (SELECT COUNT(*) FROM reflection_wall_posts p WHERE p.activity_id=a.id) AS post_count,
      (SELECT COUNT(*) FROM reflection_wall_posts p WHERE p.activity_id=a.id AND p.hidden=0) AS visible_count
      FROM activities a JOIN reflection_wall_configs w ON w.activity_id=a.id LEFT JOIN sessions s ON s.id=a.session_id ORDER BY a.updated_at DESC`).all();
    return json({ activities: rows.results });
  }
  if (request.method === "POST" && url.pathname === "/api/owner/reflection-walls") {
    const data = await readBody(request, CreateWallInput); if (!data) return fail("Check the title, column limits and activity settings.", 400);
    const result = await createWall(db, data); if ("error" in result && result.error) return fail(result.error, 400);
    return json({ activityId: result.activityId, phase: "DRAFT" }, 201);
  }
  const match = url.pathname.match(/^\/api\/owner\/reflection-walls\/([0-9a-f-]+)(?:\/(transition|moderate|clusters(?:\/([0-9a-f-]+))?|posts(?:\/([0-9a-f-]+)\/cluster)?|presentation|presenter-link|access|export))?$/i);
  if (!match) return fail("Reflection Wall route not found.", 404);
  const activityId = match[1]!; const action = match[2];
  const wall = await wallById(db, activityId); if (!wall) return fail("Reflection Wall not found.", 404);
  if (request.method === "GET" && !action) {
    const snapshot = await buildSnapshot(db, wall, { owner: true });
    return json({ ...snapshot, activity: { id: wall.activity_id,title: wall.title,state: wall.state,joinPin: wall.join_pin,sessionName: wall.session_name,sessionId: wall.session_id,sessionStatus: wall.session_status },
      sharePath: wall.access_enabled ? `/reflection/${wall.access_slug}` : null, columns: await columnsFor(db, activityId), clusters: await clustersFor(db, activityId) });
  }
  if (request.method === "PATCH" && !action) {
    const data = await readBody(request, EditInput); if (!data) return fail("Check the title and column limits.", 400);
    const validated = validateReflectionColumns(data.columns); if (!validated.ok) return fail(validated.message, 400);
    const existingColumns = await columnsFor(db, activityId);
    const postsExist = Boolean((await db.prepare("SELECT 1 FROM reflection_wall_posts WHERE activity_id=? LIMIT 1").bind(activityId).first()));
    const contentStarted = Boolean(wall.started_once || postsExist);
    if (contentStarted && data.identityMode !== wall.identity_mode) return fail("Identity mode is locked after the first Post-it is published.", 409);
    if (contentStarted && (data.columns.length !== existingColumns.length || data.columns.some((column, index) =>
      column.title.trim() !== existingColumns[index]?.title || column.question.trim() !== existingColumns[index]?.question))) {
      return fail("Reflection columns and questions are locked after the first Post-it is published.", 409);
    }
    for (const existing of existingColumns.slice(data.columns.length)) {
      const count = await db.prepare("SELECT COUNT(*) AS count FROM reflection_wall_posts WHERE column_id=?").bind(existing.id).first<{ count: number }>();
      if (Number(count?.count ?? 0) > 0) return fail("A column with Post-its cannot be removed.", 409);
    }
    const statements: D1PreparedStatement[] = [
      db.prepare("UPDATE activities SET title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(data.title.trim(), activityId),
      db.prepare("UPDATE reflection_wall_configs SET description=?,identity_mode=?,post_limit=?,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?")
        .bind(data.description.trim(), data.identityMode, data.postLimit, activityId),
    ];
    existingColumns.slice(data.columns.length).forEach((column) => statements.push(db.prepare("DELETE FROM reflection_wall_columns WHERE id=? AND activity_id=?").bind(column.id, activityId)));
    data.columns.forEach((column, index) => {
      const current = existingColumns[index];
      if (current) statements.push(db.prepare("UPDATE reflection_wall_columns SET title=?,question=?,sort_order=?,color_key=? WHERE id=? AND activity_id=?")
        .bind(column.title.trim(), column.question.trim(), index, ["gold", "pink", "aqua", "purple"][index]!, current.id, activityId));
      else statements.push(db.prepare("INSERT INTO reflection_wall_columns(id,activity_id,title,question,sort_order,color_key) VALUES(?,?,?,?,?,?)")
        .bind(newId(), activityId, column.title.trim(), column.question.trim(), index, ["gold", "pink", "aqua", "purple"][index]!));
    });
    await db.batch(statements);
    await db.prepare("UPDATE activities SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(activityId).run();
    return json({ saved: true });
  }
  if (request.method === "POST" && action === "transition") {
    const data = await readBody(request, z.object({ action: z.enum(["OPEN","PAUSE","CLOSE","REOPEN","ARCHIVE"]) })); if (!data) return fail("Choose a valid lifecycle action.", 400);
    let next: WallRow["phase"];
    if (data.action === "OPEN" && ["DRAFT","PAUSED"].includes(wall.phase)) next = "OPEN";
    else if (data.action === "PAUSE" && wall.phase === "OPEN") next = "PAUSED";
    else if (data.action === "CLOSE" && ["OPEN","PAUSED"].includes(wall.phase)) next = "CLOSED";
    else if (data.action === "REOPEN" && ["CLOSED","ARCHIVED"].includes(wall.phase)) {
      if (wall.session_status === "completed") return fail("Reopen the parent Session before reopening this Reflection Wall.", 409);
      next = "OPEN";
    } else if (data.action === "ARCHIVE" && wall.phase === "CLOSED") next = "ARCHIVED";
    else return fail("That lifecycle change is not available from the current state.", 409);
    let pin = wall.join_pin;
    if (next === "OPEN" && !pin) { pin = await uniquePin(db); if (!pin) return fail("Could not create a unique join code.", 503); }
    await db.batch([
      db.prepare(`UPDATE reflection_wall_configs SET phase=?,
        archived_at=CASE WHEN ?='ARCHIVED' THEN CURRENT_TIMESTAMP WHEN ?='OPEN' THEN NULL ELSE archived_at END,
        presentation_mode=CASE WHEN ? IN ('CLOSED','ARCHIVED') THEN 'off' ELSE presentation_mode END,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?`)
        .bind(next, next, next, next, activityId),
      db.prepare("UPDATE activities SET state=?,join_pin=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(next.toLowerCase(), pin, activityId),
      db.prepare("INSERT INTO reflection_wall_events(activity_id,event_type) VALUES(?,'lifecycle.changed')").bind(activityId),
    ]);
    const updated = await wallById(db, activityId);
    return json({ phase: next, state: next.toLowerCase(), joinPin: pin, ...(updated ? { wall: (await buildSnapshot(db, updated, { owner: true })).wall } : {}) });
  }
  if (request.method === "POST" && action === "moderate") {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    const data = await readBody(request, z.object({ kind: z.enum(["post","comment"]), id: z.string().min(1), action: z.enum(["HIDE","RESTORE"]), reason: z.string().trim().max(300).optional().default("") }));
    if (!data) return fail("Choose a Post-it or comment to moderate.", 400);
    const table = data.kind === "post" ? "reflection_wall_posts" : "reflection_wall_comments";
    const hidden = data.action === "HIDE" ? 1 : 0;
    const results = await db.batch([
      db.prepare(`UPDATE ${table} SET hidden=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND activity_id=? AND hidden!=?`)
        .bind(hidden, data.id, activityId, hidden),
      db.prepare(`INSERT INTO reflection_wall_moderation_events(id,activity_id,item_kind,item_id,action,moderator_role,reason)
        SELECT ?,?,?,?,?,?,? WHERE changes()=1`).bind(newId(), activityId, data.kind, data.id, data.action, "trainer", data.reason),
    ]);
    if (!Number(results[0]?.meta.changes ?? 0)) {
      const existing = await db.prepare(`SELECT hidden FROM ${table} WHERE id=? AND activity_id=?`).bind(data.id, activityId).first<{ hidden: number }>();
      if (existing && Number(existing.hidden) === hidden) return json({ saved: true, alreadySet: true });
      return fail("That item could not be found.", 404);
    }
    return json({ saved: true });
  }
  if (request.method === "POST" && action === "clusters") {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    const data = await readBody(request, z.object({ title: z.string().trim().min(1).max(80), description: z.string().trim().max(300).default(""), colorKey: z.enum(["gold","pink","aqua","purple"]).default("pink") }));
    if (!data) return fail("Cluster titles can be up to 80 characters.", 400);
    const clusterId = newId(); await db.prepare("INSERT INTO reflection_wall_clusters(id,activity_id,title,description,color_key) VALUES(?,?,?,?,?)")
      .bind(clusterId, activityId, data.title, data.description, data.colorKey).run();
    return json({ clusterId }, 201);
  }
  const clusterId = match[3];
  if (request.method === "PATCH" && action?.startsWith("clusters/") && clusterId) {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    const data = await readBody(request, z.object({ title: z.string().trim().min(1).max(80), description: z.string().trim().max(300), colorKey: z.enum(["gold","pink","aqua","purple"]) }));
    if (!data) return fail("Check the cluster title and description.", 400);
    await db.prepare("UPDATE reflection_wall_clusters SET title=?,description=?,color_key=? WHERE id=? AND activity_id=?")
      .bind(data.title, data.description, data.colorKey, clusterId, activityId).run(); return json({ saved: true });
  }
  if (request.method === "DELETE" && action?.startsWith("clusters/") && clusterId) {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    await db.prepare("DELETE FROM reflection_wall_clusters WHERE id=? AND activity_id=?").bind(clusterId, activityId).run(); return json({ deleted: true });
  }
  const postId = match[4];
  if (request.method === "POST" && action?.startsWith("posts/") && postId) {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    const data = await readBody(request, z.object({ clusterId: z.string().nullable() })); if (!data) return fail("Choose a valid cluster.", 400);
    if (data.clusterId && !await db.prepare("SELECT id FROM reflection_wall_clusters WHERE id=? AND activity_id=?").bind(data.clusterId, activityId).first()) return fail("Cluster not found.", 404);
    const result = await db.prepare("UPDATE reflection_wall_posts SET cluster_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND activity_id=?").bind(data.clusterId, postId, activityId).run();
    if (!Number(result.meta.changes ?? 0)) return fail("Post-it not found.", 404); return json({ saved: true });
  }
  if (request.method === "POST" && action === "presentation") {
    if (wall.phase === "ARCHIVED") return fail("Archived walls are read-only.", 409);
    const data = await readBody(request, z.object({ mode: z.enum(["off","all","focus","spotlight","cluster","blank"]), columnId: z.string().nullable().optional(), postId: z.string().nullable().optional(), clusterId: z.string().nullable().optional(), clustersVisible: z.boolean().optional() }));
    if (!data) return fail("Choose a valid Presenter view.", 400);
    if (data.mode === "focus" && (!data.columnId || !await db.prepare("SELECT id FROM reflection_wall_columns WHERE id=? AND activity_id=?").bind(data.columnId, activityId).first())) return fail("Choose a column for Focus view.", 400);
    if (data.mode === "spotlight" && (!data.postId || !await db.prepare("SELECT id FROM reflection_wall_posts WHERE id=? AND activity_id=? AND hidden=0").bind(data.postId, activityId).first())) return fail("Choose a visible Post-it for Spotlight.", 400);
    if (data.mode === "cluster" && (!data.clusterId || !await db.prepare("SELECT id FROM reflection_wall_clusters WHERE id=? AND activity_id=?").bind(data.clusterId, activityId).first())) return fail("Choose a cluster to present.", 400);
    await db.batch([
      db.prepare(`UPDATE reflection_wall_configs SET presentation_mode=?,focus_column_id=?,spotlight_post_id=?,focus_cluster_id=?,clusters_visible=COALESCE(?,clusters_visible),updated_at=CURRENT_TIMESTAMP WHERE activity_id=?`)
        .bind(data.mode, data.columnId ?? null, data.postId ?? null, data.clusterId ?? null, data.clustersVisible === undefined ? null : (data.clustersVisible ? 1 : 0), activityId),
      db.prepare("INSERT INTO reflection_wall_events(activity_id,event_type) VALUES(?,'presentation.changed')").bind(activityId),
    ]);
    return json({ saved: true, mode: data.mode });
  }
  if (request.method === "POST" && action === "presenter-link") {
    const token = randomToken(); const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare("UPDATE reflection_wall_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(activityId),
      db.prepare("INSERT INTO reflection_wall_presenter_sessions(token_hash,activity_id,expires_at) VALUES(?,?,?)").bind(await hash(token), activityId, expiresAt),
    ]);
    return json({ path: `/presenter#${token}`, expiresAt });
  }
  if (request.method === "DELETE" && action === "presenter-link") {
    await db.prepare("UPDATE reflection_wall_presenter_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE activity_id=? AND revoked_at IS NULL").bind(activityId).run();
    return json({ revoked: true });
  }
  if (request.method === "POST" && action === "access") {
    if (wall.phase === "ARCHIVED") return fail("Reopen this wall before rotating its participant access.", 409);
    const data = await readBody(request, z.object({ action: z.literal("ROTATE") })); if (!data) return fail("Choose a valid access action.", 400);
    const pin = await uniquePin(db); if (!pin) return fail("Could not create a unique join code.", 503);
    const slug = randomToken(16);
    await db.batch([
      db.prepare("UPDATE reflection_wall_configs SET access_slug=?,access_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(slug, activityId),
      db.prepare("UPDATE activities SET join_pin=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(pin, activityId),
    ]);
    return json({ rotated: true, joinPin: pin, sharePath: `/reflection/${slug}` });
  }
  if (request.method === "DELETE" && action === "access") {
    await db.batch([
      db.prepare("UPDATE reflection_wall_configs SET access_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(activityId),
      db.prepare("UPDATE activities SET join_pin=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(activityId),
    ]);
    return json({ revoked: true });
  }
  if (request.method === "GET" && action === "export") {
    const posts = await db.prepare(`SELECT p.id,p.column_id,c.title AS column_title,p.body,p.hidden,p.created_at,p.updated_at,p.cluster_id,cl.title AS cluster_title,a.display_name,
        (SELECT COUNT(*) FROM reflection_wall_comments cm WHERE cm.post_id=p.id AND cm.hidden=0) AS comment_count,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='heart' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_heart,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='clap' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_clap,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='haha' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_haha,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='sad' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_sad,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='empathy' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_empathy,
        (SELECT COUNT(*) FROM reflection_wall_reactions r WHERE r.activity_id=p.activity_id AND r.reaction='inspireful' AND ((r.target_type='post' AND r.target_id=p.id) OR (r.target_type='comment' AND r.target_id IN (SELECT cm.id FROM reflection_wall_comments cm WHERE cm.post_id=p.id)))) AS reaction_inspireful
      FROM reflection_wall_posts p JOIN reflection_wall_columns c ON c.id=p.column_id JOIN reflection_wall_actors a ON a.id=p.actor_id
      LEFT JOIN reflection_wall_clusters cl ON cl.id=p.cluster_id WHERE p.activity_id=? ORDER BY p.created_at,p.id`).bind(activityId)
      .all<{ id: string; column_id: string; column_title: string; body: string; hidden: number; created_at: string; updated_at: string; cluster_id: string | null; cluster_title: string | null; display_name: string | null; comment_count: number; reaction_heart: number; reaction_clap: number; reaction_haha: number; reaction_sad: number; reaction_empathy: number; reaction_inspireful: number }>();
    const header = ["Post ID","Column ID","Column","Post-it","Author","Status","Created","Edited","Cluster ID","Cluster","Visible comments","Thread Tim","Thread Vỗ tay","Thread Haha","Thread Buồn","Thread Đồng cảm","Thread Inspireful"].map(safeReflectionCsvCell).join(",");
    const lines = posts.results.map((post) => [post.id,post.column_id,post.column_title,post.body,wall.identity_mode === "named" ? post.display_name ?? "Participant" : "Anonymous",post.hidden ? "Hidden" : "Visible",post.created_at,post.updated_at,post.cluster_id ?? "",post.cluster_title ?? "",post.comment_count,post.reaction_heart,post.reaction_clap,post.reaction_haha,post.reaction_sad,post.reaction_empathy,post.reaction_inspireful].map(safeReflectionCsvCell).join(","));
    return new Response([header, ...lines].join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=reflection-wall-${activityId}.csv`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return fail("Reflection Wall route not found.", 404);
}

async function actorFor(request: Request, db: D1Database, wall: WallRow): Promise<Actor | null> {
  const token = bearer(request); if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  return db.prepare(`SELECT id,activity_id,display_name FROM reflection_wall_actors WHERE activity_id=? AND capability_hash=? AND revoked_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP`)
    .bind(wall.activity_id, await hash(token)).first<Actor>();
}
async function publicRateLimit(request: Request, db: D1Database, env: ReflectionEnv, scope: string, limit: number) {
  if (!env.SESSION_SECRET) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown-client";
  const keyHash = await hash(`${env.SESSION_SECRET}:${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000); const window = now - now % 600;
  await db.prepare(`INSERT INTO join_rate_limits(key_hash,window_started_at,attempts) VALUES(?,?,1)
    ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN join_rate_limits.window_started_at<excluded.window_started_at THEN 1 ELSE join_rate_limits.attempts+1 END,window_started_at=excluded.window_started_at`).bind(keyHash, window).run();
  const row = await db.prepare("SELECT attempts FROM join_rate_limits WHERE key_hash=?").bind(keyHash).first<{ attempts: number }>();
  return Number(row?.attempts ?? 0) <= limit;
}
async function publicRoute(request: Request, env: ReflectionEnv, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/guest\/reflection-walls\/([^/]+)(?:\/(actor|events|posts|comments|reactions|posts\/([0-9a-f-]+)|comments\/([0-9a-f-]+)))?$/i);
  if (!match) return null;
  const db = dbFor(env); if (!db) return fail("D1 database is not configured.", 503);
  const wall = await wallBySlug(db, decodeURIComponent(match[1]!));
  if (!wall || wall.phase === "DRAFT") return fail("This Reflection Wall is not available.", 404);
  const action = match[2]; const itemId = match[3] ?? match[4];
  if (request.method === "GET" && action === "events") {
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
    const latest = await cursorFor(db, wall.activity_id);
    return json({ cursor: latest, changed: latest > cursor, retryAfterMs: 1800 });
  }
  const actor = await actorFor(request, db, wall);
  if (request.method === "GET" && !action) return json(await buildSnapshot(db, wall, { actor }));
  if (!actor) {
    if (request.method === "POST" && action === "actor") {
      if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("This wall is read-only right now.", 409);
      if (!await publicRateLimit(request, db, env, "reflection-actor", 500)) return fail("Too many attempts. Wait a few minutes and try again.", 429);
      const data = await readBody(request, ActorInput); if (!data) return fail("Check your name and try again.", 400);
      if (wall.identity_mode === "named" && !data.displayName.trim()) return fail("Your name is required for this named wall.", 400);
      const token = randomToken(); const actorId = newId(); const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await db.prepare("INSERT INTO reflection_wall_actors(id,activity_id,capability_hash,display_name,expires_at) VALUES(?,?,?,?,?)")
        .bind(actorId, wall.activity_id, await hash(token), wall.identity_mode === "named" ? data.displayName.trim() : null, expiresAt).run();
      return json({ token, expiresAt }, 201);
    }
    if (request.method === "GET") return json(await buildSnapshot(db, wall));
    return fail("Participant capability is missing or expired. Rejoin this wall to continue.", 401);
  }
  if (request.method === "POST" && action === "posts") {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("This wall is read-only right now.", 409);
    const data = await readBody(request, PostInput); if (!data) return fail("Check the Post-it text and selected column.", 400);
    const clean = validateReflectionText(data.body, 500); if (!clean.ok) return fail(clean.message, 400);
    const column = await db.prepare("SELECT id FROM reflection_wall_columns WHERE id=? AND activity_id=?").bind(data.columnId, wall.activity_id).first();
    if (!column) return fail("Choose a column on this wall.", 400);
    const idempotencyKey = data.idempotencyKey ?? randomToken(16);
    const existing = await db.prepare("SELECT id FROM reflection_wall_posts WHERE activity_id=? AND actor_id=? AND idempotency_key=?").bind(wall.activity_id, actor.id, idempotencyKey).first<{ id: string }>();
    if (existing) return json({ postId: existing.id, alreadySaved: true });
    const postId = newId();
    const inserted = await db.prepare(`INSERT OR IGNORE INTO reflection_wall_posts(id,activity_id,column_id,actor_id,body,idempotency_key)
      SELECT ?,?,?,?,?,? FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
      WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed')
        AND (SELECT COUNT(*) FROM reflection_wall_posts p WHERE p.activity_id=w.activity_id AND p.actor_id=?) < ?`)
      .bind(postId, wall.activity_id, data.columnId, actor.id, clean.text, idempotencyKey, wall.activity_id, actor.id, Number(wall.post_limit)).run();
    if (!Number(inserted.meta.changes ?? 0)) {
      const retry = await db.prepare("SELECT id FROM reflection_wall_posts WHERE activity_id=? AND actor_id=? AND idempotency_key=?")
        .bind(wall.activity_id, actor.id, idempotencyKey).first<{ id: string }>();
      if (retry) return json({ postId: retry.id, alreadySaved: true });
      const current = await wallById(db, wall.activity_id);
      if (!current || current.phase !== "OPEN" || current.session_status === "completed") return fail("This wall has just become read-only. Refresh and try again.", 409);
      return fail("You have reached the Post-it limit for this wall.", 409);
    }
    await db.prepare("UPDATE reflection_wall_configs SET started_once=1,updated_at=CURRENT_TIMESTAMP WHERE activity_id=?").bind(wall.activity_id).run();
    return json({ postId, saved: true }, 201);
  }
  if (request.method === "PATCH" && action?.startsWith("posts/") && itemId) {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("Post-its can only be edited while the wall is open.", 409);
    const data = await readBody(request, z.object({ body: z.string().max(500) })); if (!data) return fail("Check the Post-it text.", 400);
    const clean = validateReflectionText(data.body, 500); if (!clean.ok) return fail(clean.message, 400);
    const result = await db.prepare(`UPDATE reflection_wall_posts SET body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND activity_id=? AND actor_id=? AND hidden=0
      AND EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
        WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
      .bind(clean.text, itemId, wall.activity_id, actor.id, wall.activity_id).run();
    if (!Number(result.meta.changes ?? 0)) return fail("This Post-it cannot be edited.", 403); return json({ saved: true });
  }
  if (request.method === "DELETE" && action?.startsWith("posts/") && itemId) {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("Post-its can only be deleted while the wall is open.", 409);
    const deletion = await db.batch([
      db.prepare(`DELETE FROM reflection_wall_reactions WHERE activity_id=? AND (
        (target_type='post' AND target_id=?) OR (target_type='comment' AND target_id IN (SELECT id FROM reflection_wall_comments WHERE post_id=?)))
        AND EXISTS(SELECT 1 FROM reflection_wall_posts p JOIN reflection_wall_configs w ON w.activity_id=p.activity_id JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
          WHERE p.id=? AND p.actor_id=? AND p.hidden=0 AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
        .bind(wall.activity_id, itemId, itemId, itemId, actor.id),
      db.prepare(`DELETE FROM reflection_wall_posts WHERE id=? AND activity_id=? AND actor_id=? AND hidden=0
        AND EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
          WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
        .bind(itemId, wall.activity_id, actor.id, wall.activity_id),
    ]);
    if (!Number(deletion[1]?.meta.changes ?? 0)) return fail("This Post-it cannot be deleted.", 403);
    return json({ deleted: true });
  }
  if (request.method === "POST" && action === "comments") {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("Comments can only be added while the wall is open.", 409);
    const data = await readBody(request, CommentInput); if (!data) return fail("Check the comment text and Post-it.", 400);
    const clean = validateReflectionText(data.body, 300); if (!clean.ok) return fail(clean.message, 400);
    const parent = await db.prepare("SELECT id FROM reflection_wall_posts WHERE id=? AND activity_id=? AND hidden=0").bind(data.postId, wall.activity_id).first();
    if (!parent) return fail("That Post-it is not available.", 404);
    const key = data.idempotencyKey ?? randomToken(16);
    const previous = await db.prepare("SELECT id FROM reflection_wall_comments WHERE activity_id=? AND actor_id=? AND idempotency_key=?").bind(wall.activity_id, actor.id, key).first<{ id: string }>();
    if (previous) return json({ commentId: previous.id, alreadySaved: true });
    const commentId = newId();
    const inserted = await db.prepare(`INSERT OR IGNORE INTO reflection_wall_comments(id,activity_id,post_id,actor_id,body,idempotency_key)
      SELECT ?,?,?,?,?,? FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
      WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed')
        AND EXISTS(SELECT 1 FROM reflection_wall_posts p WHERE p.id=? AND p.activity_id=? AND p.hidden=0)`)
      .bind(commentId, wall.activity_id, data.postId, actor.id, clean.text, key, wall.activity_id, data.postId, wall.activity_id).run();
    if (!Number(inserted.meta.changes ?? 0)) {
      const retry = await db.prepare("SELECT id FROM reflection_wall_comments WHERE activity_id=? AND actor_id=? AND idempotency_key=?")
        .bind(wall.activity_id, actor.id, key).first<{ id: string }>();
      if (retry) return json({ commentId: retry.id, alreadySaved: true });
      return fail("This wall has just become read-only.", 409);
    }
    return json({ commentId, saved: true }, 201);
  }
  if ((request.method === "PATCH" || request.method === "DELETE") && action?.startsWith("comments/") && itemId) {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("Comments can only be changed while the wall is open.", 409);
    if (request.method === "PATCH") {
      const data = await readBody(request, z.object({ body: z.string().max(300) })); if (!data) return fail("Check the comment text.", 400);
      const clean = validateReflectionText(data.body, 300); if (!clean.ok) return fail(clean.message, 400);
      const result = await db.prepare(`UPDATE reflection_wall_comments SET body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND activity_id=? AND actor_id=? AND hidden=0
        AND EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
          WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
        .bind(clean.text, itemId, wall.activity_id, actor.id, wall.activity_id).run();
      if (!Number(result.meta.changes ?? 0)) return fail("This comment cannot be edited.", 403); return json({ saved: true });
    }
    const result = await db.prepare(`DELETE FROM reflection_wall_comments WHERE id=? AND activity_id=? AND actor_id=? AND hidden=0
      AND EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
        WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
      .bind(itemId, wall.activity_id, actor.id, wall.activity_id).run();
    if (!Number(result.meta.changes ?? 0)) return fail("This comment cannot be deleted.", 403);
    await db.prepare("DELETE FROM reflection_wall_reactions WHERE activity_id=? AND target_type='comment' AND target_id=?").bind(wall.activity_id, itemId).run();
    return json({ deleted: true });
  }
  if (request.method === "POST" && action === "reactions") {
    if (wall.phase !== "OPEN" || wall.session_status === "completed") return fail("Reactions are available while the wall is open.", 409);
    const data = await readBody(request, ReactionInput); if (!data || !reactions.has(data.reaction)) return fail("Choose one of the six available reactions.", 400);
    let targetPost = data.targetId;
    if (data.targetType === "comment") {
      const comment = await db.prepare("SELECT post_id FROM reflection_wall_comments WHERE id=? AND activity_id=? AND hidden=0").bind(data.targetId, wall.activity_id).first<{ post_id: string }>();
      if (!comment) return fail("That comment is not available.", 404); targetPost = comment.post_id;
    }
    const post = await db.prepare("SELECT id FROM reflection_wall_posts WHERE id=? AND activity_id=? AND hidden=0").bind(targetPost, wall.activity_id).first();
    if (!post) return fail("That Post-it is not available.", 404);
    if (data.selected) {
      const targetClause = data.targetType === "post"
        ? "EXISTS(SELECT 1 FROM reflection_wall_posts p WHERE p.id=? AND p.activity_id=? AND p.hidden=0)"
        : "EXISTS(SELECT 1 FROM reflection_wall_comments c JOIN reflection_wall_posts p ON p.id=c.post_id WHERE c.id=? AND c.activity_id=? AND c.hidden=0 AND p.hidden=0)";
      const inserted = await db.prepare(`INSERT OR IGNORE INTO reflection_wall_reactions(id,activity_id,actor_id,target_type,target_id,reaction)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
          WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed')) AND ${targetClause}`)
        .bind(newId(), wall.activity_id, actor.id, data.targetType, data.targetId, data.reaction, wall.activity_id, data.targetId, wall.activity_id).run();
      if (!Number(inserted.meta.changes ?? 0)) {
        const alreadySelected = await db.prepare("SELECT 1 FROM reflection_wall_reactions WHERE activity_id=? AND actor_id=? AND target_type=? AND target_id=? AND reaction=?")
          .bind(wall.activity_id, actor.id, data.targetType, data.targetId, data.reaction).first();
        if (alreadySelected) return json({ saved: true, selected: true });
        return fail("This wall or reaction target is no longer writable.", 409);
      }
    } else {
      const deleted = await db.prepare(`DELETE FROM reflection_wall_reactions WHERE activity_id=? AND actor_id=? AND target_type=? AND target_id=? AND reaction=?
        AND EXISTS(SELECT 1 FROM reflection_wall_configs w JOIN activities a ON a.id=w.activity_id LEFT JOIN sessions s ON s.id=a.session_id
          WHERE w.activity_id=? AND w.phase='OPEN' AND a.state='open' AND (s.status IS NULL OR s.status!='completed'))`)
        .bind(wall.activity_id, actor.id, data.targetType, data.targetId, data.reaction, wall.activity_id).run();
      if (!Number(deleted.meta.changes ?? 0) && wall.phase === "OPEN" && wall.session_status !== "completed") return json({ saved: true, selected: false });
      if (!Number(deleted.meta.changes ?? 0)) return fail("This wall is no longer writable.", 409);
    }
    return json({ saved: true, selected: data.selected });
  }
  if (request.method === "GET") return json(await buildSnapshot(db, wall, { actor }));
  return fail("Reflection Wall action not found.", 404);
}

export async function reflectionOwnerRoute(request: Request, env: ReflectionEnv, url: URL) { return ownerRoute(request, env, url); }
export async function reflectionGuestRoute(request: Request, env: ReflectionEnv, url: URL) { return publicRoute(request, env, url); }
export async function reflectionLookup(db: D1Database, pin: string) {
  return db.prepare(`SELECT w.access_slug,w.phase,w.identity_mode,a.id,a.title,a.state,a.session_id,s.name AS session_name,s.status AS session_status
    FROM activities a JOIN reflection_wall_configs w ON w.activity_id=a.id LEFT JOIN sessions s ON s.id=a.session_id
    WHERE a.join_pin=? AND a.tool_id='reflection-wall' AND w.access_enabled=1`).bind(pin).first<{ access_slug: string; phase: string; identity_mode: string; id: string; title: string; state: string; session_id: string | null; session_name: string | null; session_status: string | null }>();
}
export async function reflectionPresenterRoute(request: Request, env: ReflectionEnv, token?: string): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const db = dbFor(env); if (!db) return null;
  const secret = token ?? bearer(request); if (!/^[a-f0-9]{64}$/i.test(secret)) return null;
  const session = await db.prepare(`SELECT w.activity_id FROM reflection_wall_presenter_sessions p JOIN reflection_wall_configs w ON w.activity_id=p.activity_id
    WHERE p.token_hash=? AND p.revoked_at IS NULL AND datetime(p.expires_at)>CURRENT_TIMESTAMP`).bind(await hash(secret)).first<{ activity_id: string }>();
  if (!session) return null;
  const wall = await wallById(db, session.activity_id); if (!wall) return null;
  const url = new URL(request.url);
  if (url.searchParams.has("cursor")) {
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0)); const latest = await cursorFor(db, wall.activity_id);
    return json({ kind: "reflection-wall", cursor: latest, changed: latest > cursor, retryAfterMs: 1800 });
  }
  return json({ kind: "reflection-wall", ...(await buildSnapshot(db, wall, { presenter: true })), activity: { title: wall.title, sessionName: wall.session_name } });
}
