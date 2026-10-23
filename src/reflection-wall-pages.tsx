import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Copy, Download, Eye, EyeOff, LockKeyhole, MessageCircle, Pencil, Plus, Radio, Send, Sparkles, Trash2, Users, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ApiError, api, post } from "./api";
import { Badge, BrandMark, Button, Card, EmptyState, ErrorState, LoadingState, Mascot, PageIntro, ToolPageHeader } from "./components";
import { REFLECTION_REACTIONS } from "./domain/reflection-wall";

type Phase = "DRAFT" | "OPEN" | "PAUSED" | "CLOSED" | "ARCHIVED";
type WallColumn = { id: string; title: string; question: string; sortOrder: number; colorKey: string; postCount: number; hiddenCount: number };
type WallComment = { id: string; body: string; hidden: boolean; author?: string; ownedByMe: boolean; createdAt: string; reactions: Record<string, number>; myReactions: string[] };
type WallPost = { id: string; columnId: string; body: string; hidden: boolean; clusterId: string | null; author?: string; ownedByMe: boolean; createdAt: string; updatedAt: string; reactions: Record<string, number>; myReactions: string[]; comments: WallComment[] };
type WallCluster = { id: string; title: string; description: string; color_key?: string; colorKey?: string; post_count?: number; postCount?: number };
type WallData = {
  wall: { id: string; title: string; description: string; identityMode: "anonymous" | "named"; postLimit: number; phase: Phase; state: string; sessionName: string | null; sessionId: string | null; cursor: number; accessEnabled: boolean; columnsLocked?: boolean; focusColumnId?: string | null; spotlightPostId?: string | null; focusClusterId?: string | null; presentationMode?: string; clustersVisible?: boolean };
  activity?: { id: string; title: string; state: string; joinPin: string | null; sessionName: string | null; sessionId: string | null; sessionStatus?: string | null };
  columns: WallColumn[]; posts: WallPost[]; clusters: WallCluster[]; sharePath?: string | null;
  moderationEvents?: Array<{ kind: "post" | "comment"; targetId: string; action: "HIDE" | "RESTORE"; moderator: string; reason: string; createdAt: string }>;
  analytics: { posts: number; visiblePosts: number; hiddenPosts: number; participants: number; contributors: number; activePosters: number; comments: number; hiddenComments: number; reactions: number; reactionBreakdown: Record<string, number>; byColumn: Array<{ id: string; title: string; posts: number; hidden: number }> };
  viewer: { hasActor: boolean; canWrite: boolean; quotaUsed: number; quotaRemaining: number };
};
type SessionOption = { id: string; name: string; status: string };

function makeKey() { return crypto.randomUUID(); }
function wallStateLabel(phase: Phase) { return ({ DRAFT: "Draft", OPEN: "Open", PAUSED: "Paused", CLOSED: "Closed", ARCHIVED: "Archived" })[phase]; }
function useReflectionWall(activityId: string, interval = 0) {
  const [data, setData] = useState<WallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!activityId) return;
    let alive = true;
    const load = async () => {
      try { const next = await api<WallData>(`/owner/reflection-walls/${activityId}`); if (alive) { setData(next); setError(""); } }
      catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not load Reflection Wall."); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    if (interval) { const timer = window.setInterval(() => void load(), interval); return () => { alive = false; window.clearInterval(timer); }; }
    return () => { alive = false; };
  }, [activityId, interval, tick]);
  return { data, loading, error, refresh };
}

export function ReflectionWallToolOverviewPage() {
  const [items, setItems] = useState<Array<{ activity_id: string; title: string; phase: Phase; session_name: string | null; visible_count: number; post_count: number }>>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<{ activities: typeof items }>("/owner/reflection-walls").then((data) => setItems(data.activities)).catch((reason) => setError(reason.message)); }, []);
  return <div className="page-stack tool-overview-page rw-overview"><ToolPageHeader title="Reflection Wall" />
    <div className="rw-overview-hero"><div><Badge tone="pink">LIVE REFLECTION</Badge><h1>Make space<br />for every thought<span className="title-dot">.</span></h1><p>A shared, real-time board for Post-its, reactions and comments. Run it on its own or as part of a Session.</p><Button variant="orange" to="/reflection-walls/new" icon={<Plus size={17} />}>Create a Reflection Wall</Button></div><div className="rw-overview-art"><Mascot kind="popp" /><span>✦</span></div></div>
    {error && <ErrorState message={error} />}
    <div className="section-heading"><div><span className="eyebrow">YOUR ACTIVITIES</span><h2>Reflection Walls</h2></div><Button variant="secondary" to="/reflection-walls/new" icon={<Plus size={16} />}>New wall</Button></div>
    {items.length ? <div className="rw-list">{items.map((item) => <Link className="rw-list-row" key={item.activity_id} to={`/reflection-walls/${item.activity_id}`}><span className="rw-list-art"><Mascot kind="flower" /></span><span className="rw-list-copy"><strong>{item.title}</strong><small>{item.session_name ?? "Quick Activity"} · {item.visible_count} visible Post-its</small></span><Badge tone={item.phase === "OPEN" ? "green" : item.phase === "ARCHIVED" ? "gray" : "purple"}>{wallStateLabel(item.phase)}</Badge><ArrowRight size={17} /></Link>)}</div> : !error && <Card><EmptyState title="Start with an open question" description="Create your first Reflection Wall and invite participants with a six-digit code or share link." action={<Button variant="orange" to="/reflection-walls/new">Create your first wall</Button>} /></Card>}
  </div>;
}

type EditorColumn = { id?: string; title: string; question: string };
export function ReflectionWallEditorPage() {
  const { activityId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(activityId);
  const [title, setTitle] = useState("Reflection Wall");
  const [description, setDescription] = useState("");
  const [identityMode, setIdentityMode] = useState<"anonymous" | "named">("anonymous");
  const [postLimit, setPostLimit] = useState(5);
  const [sessionId, setSessionId] = useState(params.get("sessionId") ?? "");
  const [columns, setColumns] = useState<EditorColumn[]>([{ title: "Notice", question: "What stood out to you?" }, { title: "Wonder", question: "What are you still thinking about?" }, { title: "Apply", question: "What could you try next?" }, { title: "Commit", question: "What will you take forward?" }]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState("");
  const [hasPosts, setHasPosts] = useState(false);
  useEffect(() => { api<{ sessions: SessionOption[] }>("/owner/sessions").then((data) => setSessions(data.sessions)).catch(() => setSessions([])); }, []);
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api<WallData>(`/owner/reflection-walls/${activityId}`).then((data) => { if (!alive) return; setTitle(data.wall.title); setDescription(data.wall.description); setIdentityMode(data.wall.identityMode); setPostLimit(data.wall.postLimit); setSessionId(data.wall.sessionId ?? ""); setColumns(data.columns.map(({ id, title: columnTitle, question }) => ({ id, title: columnTitle, question }))); setHasPosts(Boolean(data.wall.columnsLocked)); })
      .catch((reason) => { if (alive) setError(reason.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activityId, editing]);
  function updateColumn(index: number, key: "title" | "question", value: string) { setColumns((items) => items.map((item, i) => i === index ? { ...item, [key]: value } : item)); }
  function removeColumn(index: number) { setColumns((items) => items.filter((_, i) => i !== index)); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const payload = { title, description, identityMode, postLimit, sessionId: sessionId || null, columns };
    try {
      if (editing) { await api(`/owner/reflection-walls/${activityId}`, { method: "PATCH", body: JSON.stringify(payload) }); navigate(`/reflection-walls/${activityId}`); }
      else { const created = await post<{ activityId: string }>("/owner/reflection-walls", payload); navigate(`/reflection-walls/${created.activityId}`); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this Reflection Wall."); }
    finally { setBusy(false); }
  }
  if (loading) return <LoadingState label="Loading Reflection Wall settings…" />;
  return <div className="page-stack rw-editor-page"><div className="breadcrumb"><Link to="/tools/reflection-wall">Reflection Wall</Link><ArrowRight size={14} /><span>{editing ? "Edit setup" : "Create a wall"}</span></div>
    <PageIntro eyebrow="SET UP YOUR ACTIVITY" title={editing ? "Shape the wall" : "Create a Reflection Wall"} description="Choose the reflection columns, participant display and Post-it limit." />
    {error && <div className="inline-error" role="alert">{error}</div>}
    <form className="rw-editor-layout" onSubmit={(event) => void save(event)}><div className="rw-editor-main">
      <Card className="rw-editor-card"><div className="rw-card-heading"><span className="rw-step">01</span><div><h2>Wall details</h2><p>Give the activity a clear name and context.</p></div></div>
        <label className="field-label" htmlFor="rw-title">Activity title</label><input className="text-input" id="rw-title" maxLength={100} required value={title} onChange={(event) => setTitle(event.target.value)} />
        <label className="field-label" htmlFor="rw-description">Description <small>(optional)</small></label><textarea className="text-input rw-textarea" id="rw-description" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A little context for the group" />
        <label className="field-label" htmlFor="rw-session">Run this activity in</label><select className="text-input" id="rw-session" value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Quick Activity · Standalone</option>{sessions.filter((session) => session.status !== "completed").map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select>
      </Card>
      <Card className="rw-editor-card"><div className="rw-card-heading"><span className="rw-step">02</span><div><h2>Reflection columns</h2><p>Each column has its own open prompt. Keep columns between one and four.</p></div><span className="rw-count-chip">{columns.length}/4</span></div>
        {hasPosts && <p className="rw-locked-note"><LockKeyhole size={14} /> Column order and questions are locked after the first Post-it is published.</p>}
        <div className="rw-column-editor-list">{columns.map((column, index) => <article className={`rw-column-editor rw-color-${["gold","pink","aqua","purple"][index]}`} key={column.id ?? `new-${index}`}><div className="rw-column-editor-top"><span className="rw-column-number">Column {index + 1}</span>{columns.length > 1 && <button type="button" aria-label={`Remove column ${index + 1}`} className="rw-icon-button" disabled={hasPosts} onClick={() => removeColumn(index)}><Trash2 size={16} /></button>}</div>
          <label className="field-label" htmlFor={`rw-column-title-${index}`}>Column title</label><input id={`rw-column-title-${index}`} className="text-input" maxLength={30} required disabled={hasPosts} value={column.title} onChange={(event) => updateColumn(index, "title", event.target.value)} />
          <label className="field-label" htmlFor={`rw-column-question-${index}`}>Opening question <small>(optional)</small></label><textarea id={`rw-column-question-${index}`} className="text-input rw-textarea" maxLength={200} disabled={hasPosts} value={column.question} onChange={(event) => updateColumn(index, "question", event.target.value)} />
        </article>)}</div>
        {columns.length < 4 && <button type="button" className="rw-add-column" disabled={hasPosts} onClick={() => setColumns((items) => [...items, { title: "New column", question: "" }])}><Plus size={17} /> Add a column</button>}
      </Card>
    </div><aside className="rw-editor-aside">
      <Card className="rw-editor-card"><div className="rw-card-heading"><span className="rw-step">03</span><div><h2>Participant sharing</h2><p>These settings are locked after the first Post-it.</p></div></div>
        <span className="field-label">Show participant names?</span><div className="rw-choice-stack" role="radiogroup" aria-label="Participant identity mode">
          <label className={`rw-choice ${identityMode === "anonymous" ? "rw-choice-selected" : ""}`}><input type="radio" name="identity" value="anonymous" checked={identityMode === "anonymous"} disabled={hasPosts} onChange={() => setIdentityMode("anonymous")} /><span><strong>Anonymous</strong><small>Names and team details are not stored with Post-its.</small></span><span className="rw-radio" /></label>
          <label className={`rw-choice ${identityMode === "named" ? "rw-choice-selected" : ""}`}><input type="radio" name="identity" value="named" checked={identityMode === "named"} disabled={hasPosts} onChange={() => setIdentityMode("named")} /><span><strong>Named</strong><small>Participants choose the name shown to other link holders and the trainer.</small></span><span className="rw-radio" /></label>
        </div>{hasPosts && <p className="rw-locked-note"><LockKeyhole size={14} /> Identity mode is locked after the first Post-it is published.</p>}
        <label className="field-label" htmlFor="rw-post-limit">Post-it limit per participant</label><select className="text-input" id="rw-post-limit" value={postLimit} onChange={(event) => setPostLimit(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number} Post-it{number === 1 ? "" : "s"}</option>)}</select><small className="rw-field-help">The default is five. This limit applies across the whole wall.</small>
      </Card>
      <div className="rw-editor-submit"><Mascot kind="sun" /><strong>Ready to listen?</strong><p>Post-its show immediately on the wall as people share.</p><Button type="submit" disabled={busy} className="full-width" variant="orange">{busy ? "Saving…" : editing ? "Save changes" : "Create wall"}</Button><Button variant="secondary" to={editing ? `/reflection-walls/${activityId}` : "/tools/reflection-wall"}>Cancel</Button></div>
    </aside></form>
  </div>;
}

export function ReflectionWallControlPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useReflectionWall(activityId, 2200);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [clusterTitle, setClusterTitle] = useState("");
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [postSearch, setPostSearch] = useState("");
  const [postVisibility, setPostVisibility] = useState<"all" | "visible" | "hidden">("all");
  const [postSort, setPostSort] = useState<"newest" | "oldest" | "reactions">("newest");
  const [presenterLink, setPresenterLink] = useState("");
  const [mode, setMode] = useState<"off" | "all" | "focus" | "spotlight" | "cluster" | "blank" | null>(null);
  const [focusColumn, setFocusColumn] = useState("");
  const [spotlightPost, setSpotlightPost] = useState("");
  const [focusCluster, setFocusCluster] = useState("");
  const [clustersVisible, setClustersVisible] = useState<boolean | null>(null);
  const [moderationReason, setModerationReason] = useState("");
  async function transition(action: "OPEN" | "PAUSE" | "CLOSE" | "REOPEN" | "ARCHIVE") {
    if (!data) return; setBusy(true); setProblem("");
    try { await post(`/owner/reflection-walls/${activityId}/transition`, { action }); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not update the wall status."); }
    finally { setBusy(false); }
  }
  async function moderate(kind: "post" | "comment", id: string, action: "HIDE" | "RESTORE") {
    setBusy(true); setProblem("");
    try { await post(`/owner/reflection-walls/${activityId}/moderate`, { kind, id, action, reason: moderationReason.trim() }); setModerationReason(""); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not update moderation."); }
    finally { setBusy(false); }
  }
  async function makeCluster(event: FormEvent) {
    event.preventDefault(); if (!clusterTitle.trim()) return; setBusy(true); setProblem("");
    try {
      const created = await post<{ clusterId: string }>(`/owner/reflection-walls/${activityId}/clusters`, { title: clusterTitle.trim(), description: "", colorKey: "pink" });
      await Promise.all(selectedPosts.map((postId) => post(`/owner/reflection-walls/${activityId}/posts/${postId}/cluster`, { clusterId: created.clusterId })));
      setClusterTitle(""); setSelectedPosts([]); refresh();
    }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not create this cluster."); }
    finally { setBusy(false); }
  }
  async function clusterPost(postId: string, clusterId: string) {
    setBusy(true); setProblem("");
    try { await post(`/owner/reflection-walls/${activityId}/posts/${postId}/cluster`, { clusterId: clusterId || null }); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not change this cluster."); }
    finally { setBusy(false); }
  }
  async function present() {
    if (!data) return;
    const selectedMode = mode ?? (data.wall.presentationMode as Exclude<typeof mode, null>) ?? "off";
    const selectedClusters = clustersVisible ?? data.wall.clustersVisible ?? true;
    setBusy(true); setProblem("");
    try { await post(`/owner/reflection-walls/${activityId}/presentation`, { mode: selectedMode, columnId: focusColumn || null, postId: spotlightPost || null, clusterId: focusCluster || null, clustersVisible: selectedClusters }); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not update Presenter mode."); }
    finally { setBusy(false); }
  }
  async function createPresenterLink() {
    setBusy(true); setProblem("");
    try { const result = await post<{ path: string }>(`/owner/reflection-walls/${activityId}/presenter-link`, {}); setPresenterLink(`${window.location.origin}${result.path}`); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not create Presenter link."); }
    finally { setBusy(false); }
  }
  async function revokePresenterLink() {
    setBusy(true); try { await api(`/owner/reflection-walls/${activityId}/presenter-link`, { method: "DELETE" }); setPresenterLink(""); setProblem(""); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not end Presenter access."); }
    finally { setBusy(false); }
  }
  async function rotateWallAccess() {
    setBusy(true); setProblem("");
    try { await post(`/owner/reflection-walls/${activityId}/access`, { action: "ROTATE" }); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not rotate wall access."); }
    finally { setBusy(false); }
  }
  async function revokeWallAccess() {
    if (!window.confirm("Revoke the participant link and six-digit code? Everyone using them will lose access until you rotate new access details.")) return;
    setBusy(true); setProblem("");
    try { await api(`/owner/reflection-walls/${activityId}/access`, { method: "DELETE" }); refresh(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not revoke wall access."); }
    finally { setBusy(false); }
  }
  if (loading) return <LoadingState label="Loading live Reflection Wall…" />;
  if (error || !data) return <ErrorState message={error || "This Reflection Wall is unavailable."} retry={refresh} />;
  const wall = data.wall; const pin = data.activity?.joinPin; const shareUrl = data.sharePath ? `${window.location.origin}${data.sharePath}` : "";
  const selectedMode = mode ?? (data.wall.presentationMode as Exclude<typeof mode, null>) ?? "off";
  const selectedClusters = clustersVisible ?? data.wall.clustersVisible ?? true;
  const managedPosts = data.posts.filter((item) => (postVisibility === "all" || (postVisibility === "hidden" ? item.hidden : !item.hidden))
    && (!postSearch.trim() || `${item.body} ${data.columns.find((column) => column.id === item.columnId)?.title ?? ""}`.toLocaleLowerCase().includes(postSearch.trim().toLocaleLowerCase())))
    .sort((left, right) => postSort === "oldest" ? left.createdAt.localeCompare(right.createdAt)
      : postSort === "reactions" ? Object.values(right.reactions).reduce((sum, value) => sum + value, 0) - Object.values(left.reactions).reduce((sum, value) => sum + value, 0)
        : right.createdAt.localeCompare(left.createdAt));
  const message = problem || "";
  return <div className="page-stack rw-control-page">
    <div className="breadcrumb"><Link to="/tools/reflection-wall">Reflection Wall</Link><ArrowRight size={14} /><span>Trainer controls</span></div>
    <div className="rw-control-heading"><div><span className="eyebrow">{data.activity?.sessionName ?? "QUICK ACTIVITY"}</span><h1>{wall.title}<span className="title-dot">.</span></h1><p>{wall.description || "A shared space for reflection and conversation."}</p></div><Badge tone={wall.phase === "OPEN" ? "green" : wall.phase === "ARCHIVED" ? "gray" : "purple"}><span className={wall.phase === "OPEN" ? "rw-live-dot" : ""} /> {wallStateLabel(wall.phase)}</Badge></div>
    {(message || error) && <div className="inline-error" role="alert">{message || error}</div>}
    <div className="rw-control-actions">
      {wall.phase === "DRAFT" && <Button variant="orange" disabled={busy} onClick={() => void transition("OPEN")}>Open wall <Radio size={17} /></Button>}
      {wall.phase === "OPEN" && <><Button variant="secondary" disabled={busy} onClick={() => void transition("PAUSE")}>Pause writing</Button><Button variant="danger" disabled={busy} onClick={() => void transition("CLOSE")}>Close activity</Button></>}
      {wall.phase === "PAUSED" && <><Button variant="orange" disabled={busy} onClick={() => void transition("OPEN")}>Resume wall</Button><Button variant="danger" disabled={busy} onClick={() => void transition("CLOSE")}>Close activity</Button></>}
      {wall.phase === "CLOSED" && <><Button variant="orange" disabled={busy} onClick={() => void transition("REOPEN")}>Reopen wall</Button><Button variant="secondary" disabled={busy} onClick={() => void transition("ARCHIVE")}>Move to archive</Button></>}
      {wall.phase === "ARCHIVED" && <Button variant="orange" disabled={busy} onClick={() => void transition("REOPEN")}>Reopen archived wall</Button>}
      {wall.phase !== "ARCHIVED" && <Button variant="secondary" to={`/reflection-walls/${activityId}/edit`}>Edit setup <Pencil size={15} /></Button>}
      <a className="button button-secondary" href={`/api/owner/reflection-walls/${activityId}/export`}><Download size={16} /> Export CSV</a>
    </div>
    <div className="rw-metric-grid"><div className="rw-metric rw-metric-aqua"><Users /><strong>{data.analytics.participants}</strong><span>Joined</span></div><div className="rw-metric rw-metric-yellow"><span className="rw-post-shape" /><strong>{data.analytics.visiblePosts}</strong><span>Visible Post-its</span></div><div className="rw-metric rw-metric-purple"><Pencil /><strong>{data.analytics.activePosters}</strong><span>Active posters</span></div><div className="rw-metric rw-metric-pink"><MessageCircle /><strong>{data.analytics.comments}</strong><span>Visible comments</span></div><div className="rw-metric rw-metric-aqua"><span>❤️</span><strong>{data.analytics.reactions}</strong><span>Visible reactions</span></div></div>
    <div className="rw-control-grid"><Card className="rw-share-card"><div className="rw-section-heading"><div><span className="eyebrow">INVITE PARTICIPANTS</span><h2>Join this wall</h2></div><LockKeyhole size={20} /></div>
        <div className="rw-share-content"><div className="rw-qr">{shareUrl ? <QRCodeSVG value={shareUrl} size={122} bgColor="#ffffff" fgColor="#222232" level="M" /> : <div className="rw-access-revoked"><LockKeyhole /><span>Access revoked</span></div>}</div><div className="rw-share-details"><span className="rw-state-caption">{!shareUrl ? "Participant access is revoked" : wall.phase === "OPEN" ? "Participants can post" : wall.phase === "DRAFT" ? "Open this wall to enable joining" : "Participants can view only"}</span>{pin && <><small>ACTIVITY CODE</small><strong className="rw-pin">{pin}</strong></>}<div className="rw-link-row"><input aria-label="Participant link" readOnly value={shareUrl || "Link unavailable"} /><button aria-label="Copy participant link" disabled={!shareUrl} onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={16} /></button></div></div></div>
        <div className="rw-access-actions"><Button variant="secondary" disabled={busy || wall.phase === "ARCHIVED"} onClick={() => void rotateWallAccess()}>{shareUrl ? "Rotate link & code" : "Create new link & code"}</Button>{shareUrl && <button type="button" className="rw-text-action rw-revoke-access" disabled={busy} onClick={() => void revokeWallAccess()}>Revoke participant access</button>}</div>
        <p className="rw-privacy-note"><LockKeyhole size={15} /> {wall.identityMode === "anonymous" ? "Anonymous Post-its have no Session participant or team mapping." : "Names are visible to trainers and valid link holders."}</p>
      </Card>
      <Card className="rw-presenter-controls"><div className="rw-section-heading"><div><span className="eyebrow">PRESENTER MODE</span><h2>Choose the audience view</h2></div><Eye size={20} /></div>
        <label className="field-label" htmlFor="rw-present-mode">Screen mode</label><select className="text-input" id="rw-present-mode" value={selectedMode} onChange={(event) => setMode(event.target.value as Exclude<typeof mode, null>)}><option value="off">Off · clear screen</option><option value="all">All columns</option><option value="focus">Focus a column</option><option value="spotlight">Spotlight a Post-it</option><option value="cluster">Show a cluster</option><option value="blank">Blank screen</option></select>
        {selectedMode === "focus" && <select className="text-input" aria-label="Focus column" value={focusColumn} onChange={(event) => setFocusColumn(event.target.value)}><option value="">Choose a column</option>{data.columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}</select>}
        {selectedMode === "spotlight" && <select className="text-input" aria-label="Spotlight Post-it" value={spotlightPost} onChange={(event) => setSpotlightPost(event.target.value)}><option value="">Choose a Post-it</option>{data.posts.filter((item) => !item.hidden).map((item) => <option key={item.id} value={item.id}>{item.body.slice(0, 70)}</option>)}</select>}
        {selectedMode === "cluster" && <select className="text-input" aria-label="Presenter cluster" value={focusCluster} onChange={(event) => setFocusCluster(event.target.value)}><option value="">Choose a cluster</option>{data.clusters.map((cluster) => <option key={cluster.id} value={cluster.id}>{cluster.title}</option>)}</select>}
        <label className="rw-toggle"><span><strong>Show cluster groups</strong><small>Clusters never move Post-its from their source columns.</small></span><input type="checkbox" checked={selectedClusters} onChange={(event) => setClustersVisible(event.target.checked)} /><i /></label>
        <Button variant="orange" disabled={busy || wall.phase === "ARCHIVED"} onClick={() => void present()}>Update audience screen</Button>
        <div className="rw-presenter-link"><div><strong>Presenter link</strong><small>Read-only, expires after four hours.</small></div>{presenterLink ? <><input readOnly aria-label="Presenter link" value={presenterLink} /><button aria-label="Copy Presenter link" onClick={() => void navigator.clipboard.writeText(presenterLink)}><Copy size={15} /></button><button className="rw-end-link" onClick={() => void revokePresenterLink()} disabled={busy}>End</button></> : <button onClick={() => void createPresenterLink()} disabled={busy || wall.phase === "ARCHIVED"}><Plus size={15} /> Create link</button>}</div>
        {presenterLink && <Button variant="secondary" to={presenterLink}>Open Presenter screen <ArrowRight size={15} /></Button>}
      </Card></div>
    <Card className="rw-analytics-card"><div className="rw-section-heading"><div><span className="eyebrow">LIVE ANALYTICS</span><h2>Reflections by column</h2></div><span className="rw-refresh-indicator"><i /> Updates every 2 seconds</span></div><div className="rw-analytics-columns">{data.analytics.byColumn.map((column, index) => <div className={`rw-analytics-column rw-color-${["gold","pink","aqua","purple"][index]}`} key={column.id}><span>{column.title}</span><strong>{column.posts}</strong><small>visible · {column.hidden} hidden</small><div><i style={{ width: `${data.analytics.visiblePosts ? Math.max(8, column.posts / data.analytics.visiblePosts * 100) : 0}%` }} /></div></div>)}</div><p>Totals are aggregated from wall activity. Anonymous contributors are never displayed as individual profiles.</p></Card>
    <div className="rw-management-grid"><Card className="rw-cluster-card"><div className="rw-section-heading"><div><span className="eyebrow">REVERSIBLE GROUPING</span><h2>Clusters</h2></div><Sparkles size={19} /></div><p>Cluster related Post-its as a virtual group. Each card stays in its original reflection column.</p>
        <form className="rw-cluster-create" onSubmit={(event) => void makeCluster(event)}><input className="text-input" aria-label="New cluster title" maxLength={80} placeholder="Name a cluster" value={clusterTitle} onChange={(event) => setClusterTitle(event.target.value)} /><Button type="submit" disabled={busy || !clusterTitle.trim() || wall.phase === "ARCHIVED"} icon={<Plus size={16} />}>Add</Button></form>
        {selectedPosts.length > 0 && <p className="rw-selection-note">{selectedPosts.length} original Post-it{selectedPosts.length === 1 ? "" : "s"} selected; creating a cluster will group them without moving columns.</p>}
        {data.clusters.length ? <div className="rw-cluster-list">{data.clusters.map((cluster) => <div className="rw-cluster-row" key={cluster.id}><span className="rw-cluster-dot" /><span><strong>{cluster.title}</strong><small>{cluster.post_count ?? cluster.postCount ?? 0} Post-its</small></span><button className="rw-icon-button" title="Delete cluster and return its Post-its to their source columns" disabled={busy || wall.phase === "ARCHIVED"} onClick={() => void api(`/owner/reflection-walls/${activityId}/clusters/${cluster.id}`, { method: "DELETE" }).then(refresh).catch((reason) => setProblem(reason.message))}><Trash2 size={16} /></button></div>)}</div> : <p className="rw-empty-inline">No clusters yet. Create one, then assign Post-its below.</p>}
      </Card><Card className="rw-moderation-summary"><div className="rw-section-heading"><div><span className="eyebrow">POST-IT MANAGEMENT</span><h2>Moderation queue</h2></div><EyeOff size={19} /></div><p>Hide or restore Post-its and comments. Hiding a Post-it also hides its comments and reactions for participants.</p><div className="rw-moderation-totals"><span><strong>{data.analytics.visiblePosts}</strong> visible</span><span><strong>{data.analytics.hiddenPosts}</strong> hidden</span><span><strong>{data.analytics.hiddenComments}</strong> hidden comments</span></div><label className="field-label" htmlFor="rw-moderation-reason">Audit note <small>(optional)</small></label><input id="rw-moderation-reason" className="text-input" maxLength={300} value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} placeholder="Reason for your next moderation action" /><div className="rw-reaction-breakdown">{REFLECTION_REACTIONS.map((reaction) => <span key={reaction.id}>{reaction.emoji} {reaction.label} <b>{data.analytics.reactionBreakdown[reaction.id] ?? 0}</b></span>)}</div></Card></div>
    <section className="rw-post-management"><div className="section-heading"><div><span className="eyebrow">ALL COLUMNS · TRAINER VIEW</span><h2>Manage Post-its</h2></div><span className="subtle-text">{managedPosts.length} shown · {data.posts.length} total · {wall.identityMode === "anonymous" ? "Anonymous mode" : "Named mode"}</span></div>
      <div className="rw-management-filters"><label><span className="sr-only">Search Post-its</span><input className="text-input" aria-label="Search Post-its" value={postSearch} onChange={(event) => setPostSearch(event.target.value)} placeholder="Search Post-its or columns" /></label><label><span className="sr-only">Filter Post-it visibility</span><select className="text-input" aria-label="Filter Post-it visibility" value={postVisibility} onChange={(event) => setPostVisibility(event.target.value as typeof postVisibility)}><option value="all">All posts</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><label><span className="sr-only">Sort Post-its</span><select className="text-input" aria-label="Sort Post-its" value={postSort} onChange={(event) => setPostSort(event.target.value as typeof postSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="reactions">Most reactions</option></select></label></div>
      {managedPosts.length ? <div className="rw-management-posts">{managedPosts.map((item) => { const column = data.columns.find((entry) => entry.id === item.columnId); return <article className={`rw-management-post ${item.hidden ? "rw-post-hidden" : ""}`} key={item.id}><div className={`rw-post-color rw-color-${column?.colorKey ?? "gold"}`} /><div className="rw-management-copy"><div className="rw-post-meta"><Badge tone="yellow">{column?.title ?? "Column"}</Badge>{wall.identityMode === "named" && item.author && <span>{item.author}</span>}<time>{new Date(item.createdAt).toLocaleString()}</time>{item.hidden && <Badge tone="gray">Hidden</Badge>}</div><label className="rw-cluster-select"><input type="checkbox" aria-label={`Select Post-it for cluster: ${item.body.slice(0, 60)}`} checked={selectedPosts.includes(item.id)} disabled={wall.phase === "ARCHIVED"} onChange={(event) => setSelectedPosts((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span>Select for cluster</span></label><p>{item.body}</p><div className="rw-management-reactions">{REFLECTION_REACTIONS.map((reaction) => Number(item.reactions[reaction.id] ?? 0) > 0 && <span key={reaction.id}>{reaction.emoji} {item.reactions[reaction.id]}</span>)}<span><MessageCircle size={14} /> {item.comments.filter((comment) => !comment.hidden).length}</span></div>
            <div className="rw-management-tools"><label className="sr-only" htmlFor={`rw-cluster-${item.id}`}>Cluster for Post-it</label><select id={`rw-cluster-${item.id}`} value={item.clusterId ?? ""} disabled={busy || wall.phase === "ARCHIVED"} onChange={(event) => void clusterPost(item.id, event.target.value)}><option value="">No cluster</option>{data.clusters.map((cluster) => <option value={cluster.id} key={cluster.id}>{cluster.title}</option>)}</select>{item.hidden ? <button className="rw-text-action" disabled={busy || wall.phase === "ARCHIVED"} onClick={() => void moderate("post", item.id, "RESTORE")}><Eye size={14} /> Restore</button> : <button className="rw-text-action" disabled={busy || wall.phase === "ARCHIVED"} onClick={() => void moderate("post", item.id, "HIDE")}><EyeOff size={14} /> Hide</button>}</div>
            {item.comments.length > 0 && <div className="rw-moderate-comments"><strong>Comments</strong>{item.comments.map((comment) => <div className={comment.hidden ? "rw-comment-hidden" : ""} key={comment.id}><span>{wall.identityMode === "named" ? `${comment.author ?? "Participant"}: ` : ""}{comment.body}</span>{comment.hidden ? <button onClick={() => void moderate("comment", comment.id, "RESTORE")} disabled={busy || wall.phase === "ARCHIVED"}>Restore</button> : <button onClick={() => void moderate("comment", comment.id, "HIDE")} disabled={busy || wall.phase === "ARCHIVED"}>Hide</button>}</div>)}</div>}
          </div></article>; })}</div> : <Card><EmptyState title="No Post-its yet" description="When participants share reflections, you can review and moderate them here." /></Card>}
    </section>
    {data.moderationEvents && data.moderationEvents.length > 0 && <Card className="rw-moderation-history"><div className="rw-section-heading"><div><span className="eyebrow">TRAINER AUDIT</span><h2>Recent moderation</h2></div><EyeOff size={18} /></div><ul>{data.moderationEvents.slice(0, 12).map((event, index) => <li key={`${event.targetId}-${event.createdAt}-${index}`}><span>{event.action === "HIDE" ? "Hidden" : "Restored"} {event.kind}{event.reason ? ` · ${event.reason}` : ""}</span><small>{event.moderator === "trainer" ? "Trainer" : event.moderator} · {new Date(event.createdAt).toLocaleString()}</small></li>)}</ul></Card>}
  </div>;
}

function actorStorageKey(slug: string) { return `trainerpopp:reflection-wall:actor:${slug}`; }
function ReactionStrip({ targetType, targetId, counts, mine, enabled, onToggle }: { targetType: "post" | "comment"; targetId: string; counts: Record<string, number>; mine: string[]; enabled: boolean; onToggle: (type: "post" | "comment", id: string, reaction: string, selected: boolean) => void }) {
  return <div className="rw-reactions" aria-label={`${targetType} reactions`}>{REFLECTION_REACTIONS.map((reaction) => {
    const selected = mine.includes(reaction.id); const count = Number(counts[reaction.id] ?? 0);
    return <button type="button" key={reaction.id} className={`rw-reaction ${selected ? "rw-reaction-selected" : ""}`} disabled={!enabled} aria-pressed={selected} aria-label={`${reaction.label}: ${count}${selected ? ", selected" : ""}`} onClick={() => onToggle(targetType, targetId, reaction.id, !selected)}><span>{reaction.emoji}</span>{count > 0 && <b>{count}</b>}</button>;
  })}</div>;
}

export function ReflectionWallParticipantPage() {
  const { accessSlug = "" } = useParams();
  return <ReflectionWallParticipantSession key={accessSlug} accessSlug={accessSlug} />;
}

function ReflectionWallParticipantSession({ accessSlug }: { accessSlug: string }) {
  const [data, setData] = useState<WallData | null>(null);
  const [token, setToken] = useState(() => { try { return localStorage.getItem(actorStorageKey(accessSlug)) ?? ""; } catch { return ""; } });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [selectedColumn, setSelectedColumn] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [editingPost, setEditingPost] = useState("");
  const [editingComment, setEditingComment] = useState("");
  const [editText, setEditText] = useState("");
  const [commentOpen, setCommentOpen] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const cursorRef = useRef(0);
  const loadedRef = useRef(false);
  const pendingPostRef = useRef<{ body: string; columnId: string; key: string } | null>(null);
  const pendingCommentRef = useRef(new Map<string, { body: string; key: string }>());
  useEffect(() => {
    let alive = true;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const load = async () => {
      try {
        const next = await api<WallData>(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}`, { headers });
        if (!alive) return;
        setData(next); setError(""); setSelectedColumn((current) => current || next.columns[0]?.id || ""); cursorRef.current = next.wall.cursor; loadedRef.current = true;
        if (token && !next.viewer.hasActor) { try { localStorage.removeItem(actorStorageKey(accessSlug)); } catch { /* The view remains read-only until joining again. */ } setToken(""); }
      } catch (reason) {
        if (alive) {
          if (reason instanceof ApiError && reason.status === 404) { setData(null); setToken(""); try { localStorage.removeItem(actorStorageKey(accessSlug)); } catch { /* The revoked link remains unusable without storage. */ } }
          setError(reason instanceof Error ? reason.message : "Could not open this Reflection Wall.");
        }
      }
      finally { if (alive) setLoading(false); }
    };
    const poll = async () => {
      if (!loadedRef.current) { await load(); return; }
      try {
        const changes = await api<{ cursor: number; changed: boolean }>(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/events?cursor=${cursorRef.current}`, { headers });
        if (!alive) return;
        if (changes.changed) await load(); else cursorRef.current = changes.cursor;
      } catch (reason) {
        if (alive) {
          if (reason instanceof ApiError && reason.status === 404) { setData(null); setToken(""); try { localStorage.removeItem(actorStorageKey(accessSlug)); } catch { /* A revoked link cannot be resumed from local storage. */ } }
          setError(reason instanceof Error ? reason.message : "Live updates are temporarily unavailable.");
        }
      }
    };
    void load(); const timer = window.setInterval(() => void poll(), 1900);
    return () => { alive = false; window.clearInterval(timer); };
  }, [accessSlug, token, tick]);
  const canWrite = Boolean(data?.viewer.canWrite);
  async function join(event?: FormEvent) {
    event?.preventDefault(); if (!data) return; setBusy(true); setError("");
    try {
      const result = await post<{ token: string }>(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/actor`, { displayName: name.trim() });
      try { localStorage.setItem(actorStorageKey(accessSlug), result.token); } catch { /* Keep the actor capability for this page session. */ }
      setToken(result.token); setName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join the wall."); }
    finally { setBusy(false); }
  }
  async function toggleReaction(targetType: "post" | "comment", targetId: string, reaction: string, selected: boolean) {
    if (!token) return; setError("");
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/reactions`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ targetType, targetId, reaction, selected }) }); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your reaction."); }
  }
  async function publishPost(event: FormEvent) {
    event.preventDefault(); if (!data || !selectedColumn || !token) return; setBusy(true); setError("");
    const pending = pendingPostRef.current;
    const attempt = pending && pending.body === composeText && pending.columnId === selectedColumn ? pending : { body: composeText, columnId: selectedColumn, key: makeKey() };
    pendingPostRef.current = attempt;
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/posts`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ columnId: selectedColumn, body: composeText, idempotencyKey: attempt.key }) }); pendingPostRef.current = null; setComposeText(""); setComposeOpen(false); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not publish this Post-it."); }
    finally { setBusy(false); }
  }
  async function savePost(event: FormEvent, postId: string) {
    event.preventDefault(); if (!token) return; setBusy(true); setError("");
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/posts/${postId}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: editText }) }); setEditingPost(""); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your Post-it."); }
    finally { setBusy(false); }
  }
  async function deletePost(postId: string) {
    if (!token || !window.confirm("Delete this Post-it and its comments?")) return; setBusy(true); setError("");
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/posts/${postId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete your Post-it."); }
    finally { setBusy(false); }
  }
  async function publishComment(event: FormEvent, postId: string) {
    event.preventDefault(); const body = commentDrafts[postId]?.trim() ?? ""; if (!body || !token) return; setBusy(true); setError("");
    const pending = pendingCommentRef.current.get(postId);
    const attempt = pending && pending.body === body ? pending : { body, key: makeKey() };
    pendingCommentRef.current.set(postId, attempt);
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/comments`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ postId, body, idempotencyKey: attempt.key }) }); pendingCommentRef.current.delete(postId); setCommentDrafts((drafts) => ({ ...drafts, [postId]: "" })); setCommentOpen(""); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add your comment."); }
    finally { setBusy(false); }
  }
  async function saveComment(event: FormEvent, commentId: string) {
    event.preventDefault(); if (!token) return; setBusy(true); setError("");
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/comments/${commentId}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: editText }) }); setEditingComment(""); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your comment."); }
    finally { setBusy(false); }
  }
  async function deleteComment(commentId: string) {
    if (!token || !window.confirm("Delete this comment?")) return; setBusy(true); setError("");
    try { await api(`/guest/reflection-walls/${encodeURIComponent(accessSlug)}/comments/${commentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete your comment."); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="rw-participant-screen"><BrandMark /><LoadingState label="Opening the Reflection Wall…" /></main>;
  if (error && !data) return <main className="rw-participant-screen"><BrandMark /><div className="rw-participant-error"><ErrorState message={error} /><Button variant="secondary" to="/join">Try another code</Button></div></main>;
  if (!data) return null;
  const activeColumn = data.columns.find((column) => column.id === selectedColumn) ?? data.columns[0];
  const displayPosts = data.posts.filter((item) => item.columnId === selectedColumn);
  const readOnly = !canWrite;
  return <main className="rw-participant-screen"><header className="rw-participant-header"><Link to="/join" className="rw-back-button" aria-label="Back to join"><ArrowLeft size={18} /></Link><BrandMark /><span className={`rw-participant-status rw-status-${data.wall.phase.toLowerCase()}`}><i />{wallStateLabel(data.wall.phase)}</span></header>
    <section className="rw-participant-title"><span className="eyebrow">{data.wall.sessionName ?? "REFLECTION WALL"}</span><h1>{data.wall.title}<span className="title-dot">.</span></h1>{data.wall.description && <p>{data.wall.description}</p>}
      {readOnly && <div className="rw-readonly-banner"><LockKeyhole size={18} /><span><strong>{data.wall.phase === "PAUSED" ? "Sharing is paused" : "This activity is closed"}</strong><small>You can read the reflections, but cannot post, comment or react.{data.wall.identityMode === "named" ? " Names and contributions may be seen by anyone with a valid activity link or code." : ""}</small></span></div>}
    </section>
    {error && <div className="rw-participant-alert" role="alert">{error}</div>}
    {!data.viewer.hasActor && data.wall.phase === "OPEN" && <section className="rw-join-card"><div className="rw-join-art"><Mascot kind="bean" /></div><div><span className="eyebrow">NO ACCOUNT NEEDED</span><h2>{data.wall.identityMode === "named" ? "Add your name to join" : "Join the reflection"}</h2><p>{data.wall.identityMode === "named" ? "Your name appears to other valid link holders and your trainer." : "Your identity and team are not connected to your Post-its."}</p>{data.wall.identityMode === "named" ? <form onSubmit={(event) => void join(event)}><label className="field-label" htmlFor="rw-participant-name">Your name</label><input id="rw-participant-name" className="text-input" autoComplete="name" maxLength={60} required value={name} onChange={(event) => setName(event.target.value)} /><Button type="submit" disabled={busy || !name.trim()} variant="orange">Join wall</Button></form> : <Button variant="orange" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : "Join anonymously"}</Button>}</div></section>}
    <section className="rw-column-tabs" role="group" aria-label="Reflection columns">{data.columns.map((column) => <button type="button" aria-pressed={activeColumn?.id === column.id} className={`rw-column-tab rw-color-${column.colorKey} ${activeColumn?.id === column.id ? "rw-tab-active" : ""}`} key={column.id} onClick={() => setSelectedColumn(column.id)}><span>{column.title}</span><b>{column.postCount}</b></button>)}</section>
    <section className="rw-active-question"><span className={`rw-column-mark rw-color-${activeColumn?.colorKey ?? "gold"}`}><Sparkles size={20} /></span><div><strong>{activeColumn?.title}</strong><p>{activeColumn?.question || "Share a reflection with the group."}</p></div></section>
    {canWrite && <div className="rw-compose-area">{composeOpen ? <form className="rw-compose-card" onSubmit={(event) => void publishPost(event)}><div className="rw-compose-heading"><strong>Write a Post-it · {activeColumn?.title}</strong><button type="button" className="rw-icon-button" aria-label="Close editor" onClick={() => { setComposeOpen(false); setComposeText(""); }}><X size={17} /></button></div><textarea autoFocus className="text-input rw-compose-textarea" aria-label="Post-it text" maxLength={500} placeholder="Share a thought, feeling or next step…" value={composeText} onChange={(event) => setComposeText(event.target.value)} required /><div className="rw-compose-foot"><span>{composeText.length}/500 · {data.viewer.quotaRemaining} Post-it{data.viewer.quotaRemaining === 1 ? "" : "s"} left</span><Button type="submit" disabled={busy || !composeText.trim()} variant="orange">{busy ? "Posting…" : "Share Post-it"} <Send size={15} /></Button></div></form> : <button className="rw-compose-open" onClick={() => setComposeOpen(true)} disabled={data.viewer.quotaRemaining === 0}><Pencil size={18} /><span>{data.viewer.quotaRemaining ? "Add your reflection" : "You’ve used your Post-its"}</span>{data.viewer.quotaRemaining > 0 && <b>{data.viewer.quotaRemaining} left</b>}</button>}</div>}
    <div className="rw-participant-columns">{data.columns.map((column) => <section className={`rw-post-column rw-color-${column.colorKey} ${column.id === selectedColumn ? "rw-post-column-active" : ""}`} key={column.id}><header><div><h2>{column.title}</h2><p>{column.question}</p></div><span>{column.postCount}</span></header><div className="rw-post-stack">{data.posts.filter((item) => item.columnId === column.id).map((item, index) => <article className={`rw-post-card rw-post-card-${index % 4}`} key={item.id}>
          <div className="rw-post-card-meta"><span className="rw-anonymous-icon"><Mascot kind="sun" /></span><span><strong>{data.wall.identityMode === "named" ? item.author ?? "Participant" : "Anonymous"}</strong><small>{item.updatedAt !== item.createdAt ? "Edited · " : ""}{new Date(item.createdAt).toLocaleString()}</small></span>{item.ownedByMe && canWrite && <div className="rw-own-actions"><button aria-label="Edit my Post-it" onClick={() => { setEditingPost(item.id); setEditText(item.body); }}><Pencil size={14} /></button><button aria-label="Delete my Post-it" disabled={busy} onClick={() => void deletePost(item.id)}><Trash2 size={14} /></button></div>}</div>
          {editingPost === item.id ? <form className="rw-inline-edit" onSubmit={(event) => void savePost(event, item.id)}><textarea className="text-input" maxLength={500} value={editText} onChange={(event) => setEditText(event.target.value)} required /><div><button type="button" onClick={() => setEditingPost("")}>Cancel</button><button type="submit" disabled={busy || !editText.trim()}>Save</button></div></form> : <p className="rw-post-body">{item.body}</p>}
          <ReactionStrip targetType="post" targetId={item.id} counts={item.reactions} mine={item.myReactions} enabled={canWrite} onToggle={(type, id, reaction, selected) => void toggleReaction(type, id, reaction, selected)} />
          <div className="rw-comment-heading"><span><MessageCircle size={15} /> {item.comments.filter((comment) => !comment.hidden).length} comments</span>{canWrite && <button onClick={() => setCommentOpen(commentOpen === item.id ? "" : item.id)}>{commentOpen === item.id ? "Cancel" : "Add comment"}</button>}</div>
          {item.comments.filter((comment) => !comment.hidden).map((comment) => <div className="rw-comment-card" key={comment.id}><div className="rw-comment-meta"><strong>{data.wall.identityMode === "named" ? comment.author ?? "Participant" : "Anonymous"}</strong><time>{new Date(comment.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>{comment.ownedByMe && canWrite && <span className="rw-own-actions"><button aria-label="Edit my comment" onClick={() => { setEditingComment(comment.id); setEditText(comment.body); }}><Pencil size={13} /></button><button aria-label="Delete my comment" onClick={() => void deleteComment(comment.id)}><Trash2 size={13} /></button></span>}</div>
              {editingComment === comment.id ? <form className="rw-inline-edit" onSubmit={(event) => void saveComment(event, comment.id)}><textarea className="text-input" maxLength={300} value={editText} onChange={(event) => setEditText(event.target.value)} required /><div><button type="button" onClick={() => setEditingComment("")}>Cancel</button><button type="submit" disabled={busy || !editText.trim()}>Save</button></div></form> : <p>{comment.body}</p>}
              <ReactionStrip targetType="comment" targetId={comment.id} counts={comment.reactions} mine={comment.myReactions} enabled={canWrite} onToggle={(type, id, reaction, selected) => void toggleReaction(type, id, reaction, selected)} />
            </div>)}
          {commentOpen === item.id && canWrite && <form className="rw-comment-form" onSubmit={(event) => void publishComment(event, item.id)}><label className="sr-only" htmlFor={`rw-comment-${item.id}`}>Write a comment</label><input id={`rw-comment-${item.id}`} className="text-input" maxLength={300} placeholder="Write a comment…" value={commentDrafts[item.id] ?? ""} onChange={(event) => setCommentDrafts((drafts) => ({ ...drafts, [item.id]: event.target.value }))} /><button type="submit" aria-label="Post comment" disabled={busy || !(commentDrafts[item.id] ?? "").trim()}><Send size={17} /></button></form>}
        </article>)}</div></section>)}</div>
    {displayPosts.length === 0 && <div className="rw-empty-state"><Mascot kind="flower" /><strong>No Post-its in {activeColumn?.title ?? "this column"} yet</strong><span>Your thoughts help the group build a richer picture.</span></div>}
    <footer className="rw-participant-footer"><LockKeyhole size={15} /><span>{data.wall.identityMode === "anonymous" ? "Anonymous sharing · no account required" : "Named sharing · names are visible to link holders"}</span><span>Refreshes live</span></footer>
  </main>;
}

export function ReflectionWallPublicPresenterPage() {
  const [data, setData] = useState<WallData | null>(null);
  const [error, setError] = useState("");
  const token = window.location.hash.slice(1);
  const cursorRef = useRef(0);
  const loadedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const headers = { Authorization: `Bearer ${token}` };
    const load = async () => { try { const next = await api<WallData>("/presenter", { headers }); if (alive) { setData(next); setError(""); cursorRef.current = next.wall.cursor; loadedRef.current = true; } }
      catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Presenter access is unavailable."); } };
    const poll = async () => {
      if (!loadedRef.current) { await load(); return; }
      try {
        const changes = await api<{ cursor: number; changed: boolean }>(`/presenter?cursor=${cursorRef.current}`, { headers });
        if (!alive) return;
        if (changes.changed) await load(); else cursorRef.current = changes.cursor;
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Presenter updates are temporarily unavailable."); }
    };
    void load(); const timer = window.setInterval(() => void poll(), 1700); return () => { alive = false; window.clearInterval(timer); };
  }, [token]);
  if (error && !data) return <main className="rw-presenter-screen"><div className="rw-presenter-top"><BrandMark /><Badge tone="gray">PRESENTER</Badge></div><div className="rw-presenter-center"><LockKeyhole /><h1>Presenter link unavailable</h1><p>{error}</p></div></main>;
  if (!data) return <main className="rw-presenter-screen"><div className="rw-presenter-top"><BrandMark /><Badge tone="aqua">CONNECTING</Badge></div><LoadingState label="Connecting to the Reflection Wall…" /></main>;
  const spotlight = data.posts[0];
  return <main className="rw-presenter-screen"><header className="rw-presenter-top"><div className="rw-presenter-brand"><BrandMark /><span><strong>{data.wall.title}</strong><small>{data.wall.sessionName ?? "Reflection Wall"}</small></span></div><div className="rw-presenter-status"><Badge tone={data.wall.phase === "OPEN" ? "green" : "gray"}>{data.wall.presentationMode === "blank" || data.wall.presentationMode === "off" ? "SCREEN CLEAR" : "PRESENTER LIVE"}</Badge><button className="rw-fullscreen" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen(); else void document.exitFullscreen(); }}>Fullscreen <ArrowRight size={16} /></button></div></header>
    {data.wall.presentationMode === "blank" || data.wall.presentationMode === "off" ? <section className="rw-presenter-blank"><Mascot kind="popp" /><span className="eyebrow">FACILITATOR CONTROLLED</span><h1>Make room for the next idea<span className="title-dot">.</span></h1><p>The trainer will bring the reflections onto the screen when it’s time.</p></section> : data.wall.presentationMode === "spotlight" && spotlight ? <section className="rw-presenter-spotlight"><span className="rw-presenter-overline">SPOTLIGHT POST-IT</span><div><span className="rw-spotlight-column">{data.columns.find((column) => column.id === spotlight.columnId)?.title}</span><p>{spotlight.body}</p><ReactionStrip targetType="post" targetId={spotlight.id} counts={spotlight.reactions} mine={[]} enabled={false} onToggle={() => undefined} /><span>{spotlight.comments.length} comments</span></div><Mascot kind="sun" /></section> : <>{data.wall.presentationMode === "cluster" && data.clusters[0] && <section className="rw-presenter-cluster-label"><span className="eyebrow">TRAINER-GENERATED CLUSTER</span><h2>{data.clusters[0].title}</h2>{data.clusters[0].description && <p>{data.clusters[0].description}</p>}</section>}<div className="rw-presenter-stats"><div><Users /><strong>{data.analytics.contributors}</strong><span>Contributors</span></div><div><span className="rw-post-shape" /><strong>{data.analytics.visiblePosts}</strong><span>Post-its</span></div><div><MessageCircle /><strong>{data.analytics.comments}</strong><span>Comments</span></div><div><span>❤️</span><strong>{data.analytics.reactions}</strong><span>Reactions</span></div></div>
      <div className={`rw-presenter-columns ${data.wall.presentationMode === "focus" || data.wall.presentationMode === "cluster" ? "rw-presenter-focus" : ""}`}>{data.columns.map((column) => { const posts = data.posts.filter((item) => item.columnId === column.id); if (!posts.length) return null; return <section className={`rw-presenter-column rw-color-${column.colorKey}`} key={column.id}><header><div><h2>{column.title}</h2><p>{column.question}</p></div><b>{posts.length}</b></header><div>{posts.map((item) => <article className="rw-presenter-post" key={item.id}><p>{item.body}</p><ReactionStrip targetType="post" targetId={item.id} counts={item.reactions} mine={[]} enabled={false} onToggle={() => undefined} /><span><MessageCircle size={14} /> {item.comments.length}</span></article>)}</div></section>; })}</div></>}
    <footer className="rw-presenter-footer"><span><i /> Live updates</span><span>TRAINERPOPP!KIT · REFLECTION WALL</span></footer>
  </main>;
}
