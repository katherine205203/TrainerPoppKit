import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Copy, Download, FlaskConical, Hand, Heart, LockKeyhole, MessageCircle, Play, Plus, Radio, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, BrandMark, Button, Card, EmptyState, ErrorState, LoadingState, Mascot, MetricCard, PageIntro, ToolPageHeader } from "./components";
import { formatLbrMean, LEARNING_BEHAVIORS, LBR_NA_LABEL, LBR_SCALE, type BehaviorKey, type LbrRating } from "./domain/learning-behaviors";

type BehaviorCopy = { key: BehaviorKey; number: number; name: string; shortName: string; description: string; example: string; reflectionPrompt: string };
type SessionOption = { id: string; name: string };
type LbrActivityData = { activity: { id: string; sessionId: string | null; sessionName: string | null; title: string; state: string; joinPin: string | null; accessSlug: string; allowTeams: boolean; contentFrozen: boolean; contentFrozenAt: string | null }; intro: string; behaviors: BehaviorCopy[]; teams: Array<{ id: string; name: string }> };
type LbrOwnerActivity = LbrActivityData & { counts: Record<string, number>; participants: Array<{ id: string; display_name: string; team_id: string | null; team_name: string | null; current_phase: string | null; started_at: string | null; self_locked_at: string | null; ever_completed_at: string | null; action_recorded: number; peer_submissions: number; last_seen_at: string }> };
type LbrSummary = { mean: number | null; validN: number; naN: number };
type LbrOwnerAnalytics = {
  activity: LbrActivityData["activity"]; behaviors: BehaviorCopy[];
  teams: Array<{ teamId: string; teamName: string; participantCount: number; lockedCount: number; behaviors: Record<BehaviorKey, LbrSummary> }>;
  filterTeamId: string | null; counts: { joined: number; selfLocked: number; completed: number; peerSubmissions: number };
  summary: Record<BehaviorKey, { key: BehaviorKey; name: string; self: LbrSummary; peer: LbrSummary; distribution: Record<number, number> }>;
  participants: Array<{ participantId: string; displayName: string; teamId: string | null; teamName: string | null; phase: string; selfLocked: boolean; completedAt: string | null; actionRecorded: boolean; peerSubmissionCount: number; self: Record<BehaviorKey, LbrRating>; peer: Record<BehaviorKey, LbrSummary> }>;
};

function useLbrData<T>(path: string, interval = 0, token?: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await api<T>(path, token ? { headers: { Authorization: "Bearer " + token } } : {});
        if (active) { setData(value); setError(""); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not load activity data."); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = interval ? window.setInterval(() => void load(), interval) : null;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [path, interval, token, tick]);
  return { data, loading, error, refresh };
}

function readLbrDraft(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function shortPhase(value: string | null | undefined, started: boolean) {
  if (!started) return "Not started";
  switch (value) {
    case "SELF_DRAFT": return "Self-assessment";
    case "FEEDBACK_COLLECTION": return "Asking for feedback";
    case "MY_REFLECTION": return "My Reflection";
    case "MY_ACTIONS": return "My Actions";
    case "COMPLETED": return "Completed";
    default: return "In progress";
  }
}

export function LearningBehaviorsToolOverviewPage() {
  const { data, loading, error } = useLbrData<{ activities: Array<{ activity_id: string; title: string; state: string; session_name: string | null; participant_count: number; self_locked_count: number; peer_submission_count: number }> }>("/owner/learning-behaviors");
  return <div className="page-stack tool-overview-page lbr-overview">
    <ToolPageHeader title="Learning Behaviors Reflection" description="A guided four-phase activity for noticing, asking, reflecting, and choosing what to try next." />
    <section className="lbr-tool-hero"><div><Badge tone="yellow">SIX FIXED BEHAVIORS</Badge><h2>Learn by asking<br />each other.</h2><p>Participants reflect on their own habits, invite face-to-face feedback on their phone, save quick notes, and choose a next step.</p><Button variant="yellow" to="/learning-behaviors/new">Set up an activity</Button></div><div className="lbr-hero-art"><Mascot kind="sun" /><span>✦</span><i /><b /></div></section>
    <div className="lbr-phase-strip">{[["01", "Self-assessment", "Six 1–5 or N/A choices"], ["02", "Ask for feedback", "Pass the phone in person"], ["03", "My Reflection", "Review what you heard"], ["04", "My Actions", "One optional note"]].map(([number, title, copy]) => <Card key={number} className="lbr-phase-tile"><span>{number}</span><strong>{title}</strong><small>{copy}</small></Card>)}</div>
    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">YOUR ACTIVITIES</span><h2>Learning Behaviors Reflection</h2></div></div>
      {loading ? <LoadingState label="Loading your activities…" /> : error ? <ErrorState message={error} /> : !data?.activities.length ? <Card><EmptyState title="Ready to start a reflection?" description="Create an activity on its own or connect it to an existing class or workshop." action={<Button variant="orange" to="/learning-behaviors/new">Create your first activity</Button>} /></Card> :
        <div className="lbr-activity-list">{data.activities.map((activity) => <Link className="lbr-activity-row" to={"/learning-behaviors/" + activity.activity_id} key={activity.activity_id}><span className="lbr-row-art"><Mascot kind="flower" /></span><span className="lbr-row-copy"><strong>{activity.title}</strong><small>{activity.session_name ?? "Quick Activity"} · {activity.participant_count} joined · {activity.self_locked_count} Self locked · {activity.peer_submission_count} feedback rounds</small></span><Badge tone={activity.state === "open" ? "green" : activity.state === "closed" ? "gray" : "purple"}>{activity.state === "open" ? "Live" : activity.state}</Badge><ArrowRight size={18} /></Link>)}</div>}
    </section>
    <div className="privacy-footnote"><LockKeyhole size={16} /><span>Trainer can review all individual entries. Peer responses are anonymous, unverified submissions and are not a performance assessment.</span></div>
  </div>;
}

type SetupForm = { title: string; sessionId: string; intro: string; behaviors: BehaviorCopy[]; teamText: string };
export function LearningBehaviorsSetupPage() {
  const { activityId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(activityId);
  const [form, setForm] = useState<SetupForm>({ title: "Learning Behaviors Reflection", sessionId: params.get("sessionId") ?? "", intro: "Hãy dành vài phút nhìn lại tần suất bạn thực hành sáu hành vi học tập trong quá trình làm việc cùng nhau nói chung. Không có câu trả lời đúng hay sai; hãy chọn phương án phản ánh trải nghiệm của bạn.", behaviors: LEARNING_BEHAVIORS.map((behavior) => ({ ...behavior })), teamText: "" });
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loading, setLoading] = useState(editing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [frozen, setFrozen] = useState(false);
  useEffect(() => { void api<{ sessions: SessionOption[] }>("/owner/sessions").then((value) => setSessions(value.sessions)).catch(() => setSessions([])); }, []);
  useEffect(() => {
    if (!editing) return;
    let active = true;
    void api<LbrActivityData>("/owner/learning-behaviors/" + activityId).then((value) => {
      if (!active) return;
      setForm({ title: value.activity.title, sessionId: value.activity.sessionId ?? "", intro: value.intro, behaviors: value.behaviors, teamText: value.teams.map((team) => team.name).join(", ") });
      setFrozen(value.activity.contentFrozen || ["closed", "archived"].includes(value.activity.state));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not open activity setup."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activityId, editing]);
  async function save(openAfter: boolean) {
    setPending(true); setError("");
    const teamNames = form.teamText.split(",").map((value) => value.trim()).filter(Boolean);
    try {
      let id = activityId;
      const payload = { title: form.title.trim(), sessionId: form.sessionId || null, intro: form.intro, behaviors: form.behaviors.map((behavior) => {
        const base = LEARNING_BEHAVIORS.find((item) => item.key === behavior.key)!;
        return { ...behavior, description: behavior.description.trim() || base.description, example: behavior.example.trim() || base.example, reflectionPrompt: behavior.reflectionPrompt.trim() || base.reflectionPrompt };
      }) };
      if (editing) await api("/owner/learning-behaviors/" + activityId, { method: "PATCH", body: JSON.stringify(payload) });
      else id = (await post<{ activityId: string }>("/owner/learning-behaviors", { ...payload, allowTeams: Boolean(teamNames.length), teamNames })).activityId;
      if (openAfter) await post("/owner/activities/" + id + "/open", {});
      navigate("/learning-behaviors/" + id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this activity."); }
    finally { setPending(false); }
  }
  if (loading) return <LoadingState label="Opening activity setup…" />;
  const canEdit = !frozen;
  return <div className="page-stack lbr-setup-page"><div className="breadcrumb"><Link to="/tools/learning-behaviors">Learning Behaviors Reflection</Link><span>›</span><span>{editing ? "Activity setup" : "Create activity"}</span></div>
    <PageIntro eyebrow="ACTIVITY SETUP" title={editing ? "Shape the reflection" : "Create an activity"} description="Keep all six behaviors and four phases in the activity. The wording can be edited before participants begin." />
    {error && <div className="inline-error" role="alert">{error}</div>}
    {frozen && <div className="lbr-info-callout"><LockKeyhole size={17} /><span>Behavior wording is locked because a participant has started. Everyone continues with the same saved content.</span></div>}
    <div className="lbr-setup-grid"><div className="page-stack">
      <Card className="lbr-setup-card"><div className="lbr-section-heading"><span>01</span><div><h2>Activity details</h2><p>Set a clear title and introduce the exercise.</p></div></div>
        <label className="field-label" htmlFor="lbr-title">Activity name</label><input id="lbr-title" className="text-input" maxLength={100} value={form.title} disabled={!canEdit} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <label className="field-label" htmlFor="lbr-session">Run this activity in</label><select id="lbr-session" className="text-input" value={form.sessionId} disabled={editing || !canEdit} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}><option value="">Quick Activity · Standalone</option>{sessions.map((session) => <option value={session.id} key={session.id}>{session.name}</option>)}</select>
        {!editing && <><label className="field-label" htmlFor="lbr-teams">Teams <small>optional, comma-separated</small></label><input id="lbr-teams" className="text-input" placeholder="Team A, Team B" value={form.teamText} onChange={(event) => setForm({ ...form, teamText: event.target.value })} /><small className="lbr-field-hint">Teams use the activity’s existing participant team assignment.</small></>}
        <label className="field-label" htmlFor="lbr-intro">Participant introduction</label><textarea id="lbr-intro" className="text-input lbr-textarea" maxLength={1000} disabled={!canEdit} value={form.intro} onChange={(event) => setForm({ ...form, intro: event.target.value })} />
      </Card>
      <Card className="lbr-setup-card"><div className="lbr-section-heading"><span>02</span><div><h2>Behavior content</h2><p>Names and order are fixed. Edit the description, example, and reflection prompt.</p></div></div>
        <div className="lbr-behavior-editor">{form.behaviors.map((behavior, index) => <details className={"lbr-behavior-edit lbr-color-" + index} key={behavior.key}><summary><span>{index + 1}</span><strong>{behavior.name}</strong><small>Fixed name</small></summary><div className="lbr-behavior-edit-fields"><label>Description<textarea className="text-input" maxLength={400} disabled={!canEdit} value={behavior.description} onChange={(event) => setForm({ ...form, behaviors: form.behaviors.map((item) => item.key === behavior.key ? { ...item, description: event.target.value } : item) })} /></label><label>Example<textarea className="text-input" maxLength={400} disabled={!canEdit} value={behavior.example} onChange={(event) => setForm({ ...form, behaviors: form.behaviors.map((item) => item.key === behavior.key ? { ...item, example: event.target.value } : item) })} /></label><label>Reflection prompt<textarea className="text-input" maxLength={300} disabled={!canEdit} value={behavior.reflectionPrompt} onChange={(event) => setForm({ ...form, behaviors: form.behaviors.map((item) => item.key === behavior.key ? { ...item, reflectionPrompt: event.target.value } : item) })} /></label></div></details>)}</div>
      </Card>
    </div><aside className="page-stack">
      <Card className="lbr-mobile-preview"><span className="eyebrow">PARTICIPANT PREVIEW</span><div className="lbr-preview-top"><BrandMark /><span>SELF-ASSESSMENT</span></div><Badge tone="pink">1 OF 6</Badge><h2>{form.behaviors[0]?.name}</h2><p>{form.behaviors[0]?.description}</p><div className="lbr-preview-scale">{LBR_SCALE.map((choice) => <span key={choice.value}>{choice.value}</span>)}<span>NA</span></div><small>All four phases stay in this activity. My Actions is optional to fill in.</small></Card>
      <Card className="lbr-setup-side"><div className="lbr-section-heading"><span>03</span><div><h2>Phases &amp; privacy</h2><p>The exercise follows the same four steps for every participant.</p></div></div><ol className="lbr-phases-ordered">{["Self-assessment", "Ask for feedback", "My Reflection", "My Actions"].map((phase, index) => <li key={phase}><i>{index + 1}</i><span>{phase}</span><Check size={16} /></li>)}</ol><div className="lbr-info-callout"><CircleHelp size={17} /><span>Participants see a notice that Trainer can access all entries. Peer Submit opens Quick Notes immediately.</span></div>
        <div className="lbr-editor-actions"><Button variant="secondary" disabled={pending || !canEdit} onClick={() => void save(false)}>{pending ? "Saving…" : "Save Draft"}</Button><Button variant="orange" disabled={pending || !canEdit || !form.title.trim()} onClick={() => void save(true)} icon={<Play size={15} />}>{pending ? "Opening…" : "Save & Open Activity"}</Button><Link className="text-link" to="/tools/learning-behaviors"><ArrowLeft size={15} /> Cancel</Link></div>
      </Card>
    </aside></div>
  </div>;
}

export function LearningBehaviorsControlPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useLbrData<LbrOwnerActivity>("/owner/learning-behaviors/" + activityId + "/live", 4000);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [presenterError, setPresenterError] = useState("");
  const [participantSearch, setParticipantSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const activity = data?.activity;
  async function changeState(action: "open" | "close") {
    setPending(true); setActionError("");
    try { await post("/owner/activities/" + activityId + "/" + action, {}); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update activity status."); }
    finally { setPending(false); }
  }
  async function copyJoin() {
    if (!activity?.accessSlug) return;
    try { await navigator.clipboard.writeText(window.location.origin + "/activity/" + activity.accessSlug); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setActionError("Could not copy the join link. You can copy the activity code instead."); }
  }
  async function openPresenter() {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    try {
      const result = await post<{ path: string }>("/owner/activities/" + activityId + "/presenter-token", {});
      if (popup) popup.location.href = result.path;
      else window.location.href = result.path;
    } catch (reason) { popup?.close(); setPresenterError(reason instanceof Error ? reason.message : "Could not open Presenter Mode."); }
  }
  if (loading && !data) return <LoadingState label="Opening live activity…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data || !activity) return <EmptyState title="Activity not found" description="This activity may have been removed." action={<Button to="/tools/learning-behaviors">Back to the tool</Button>} />;
  const open = activity.state === "open";
  const visibleParticipants = data.participants.filter((participant) =>
    (!teamFilter || participant.team_id === teamFilter) &&
    participant.display_name.toLowerCase().includes(participantSearch.trim().toLowerCase()));
  return <div className="page-stack lbr-control-page"><div className="breadcrumb"><Link to="/tools/learning-behaviors">Learning Behaviors Reflection</Link><span>›</span><span>Live control</span></div>
    <section className="lbr-live-heading"><div><Badge tone={open ? "green" : activity.state === "closed" ? "gray" : "purple"}>{open ? "OPEN" : activity.state.toUpperCase()}</Badge><h1>{activity.title}<span className="title-dot">.</span></h1><p>{activity.sessionName ?? "Quick Activity"} · Monitor the exercise without changing participant responses.</p></div><div className="lbr-live-actions"><Button variant="secondary" onClick={() => void openPresenter()}>Open Presenter</Button><Button variant="orange" disabled={pending} onClick={() => void changeState(open ? "close" : "open")} icon={open ? undefined : <Play size={16} />}>{pending ? "Updating…" : open ? "Close activity" : activity.state === "draft" ? "Open activity" : "Reopen activity"}</Button></div></section>
    {(actionError || presenterError) && <div className="inline-error" role="alert">{actionError || presenterError}</div>}
    <nav className="lbr-view-tabs"><Link className="selected" to={"/learning-behaviors/" + activityId}>Live control</Link><Link to={"/learning-behaviors/" + activityId + "/analytics"}>Results &amp; Analytics</Link><Link to={"/learning-behaviors/" + activityId + "/edit"}>Activity setup</Link></nav>
    <div className="lbr-live-grid">{[
      ["Joined", data.counts.joined ?? 0], ["Self locked", data.counts.self_locked ?? 0],
      ["Feedback rounds", data.counts.peer_submissions ?? 0], ["Completed", data.counts.completed ?? 0],
    ].map(([label, value], index) => <MetricCard key={label} icon={index === 0 ? <Users size={19} /> : index === 1 ? <LockKeyhole size={18} /> : index === 2 ? <Radio size={19} /> : <Check size={19} />} value={value} label={String(label)} tone={["aqua", "pink", "yellow", "purple"][index]} />)}</div>
    <div className="lbr-room-grid"><Card className="lbr-join-card"><div className="section-heading"><div><span className="eyebrow">PARTICIPANT ACCESS</span><h2>Share this activity</h2></div><Badge tone={open ? "green" : "gray"}>{open ? "Accepting participants" : "Read only"}</Badge></div>
      {activity.joinPin && open ? <div className="lbr-join-layout"><div><span className="lbr-code-label">Activity code</span><strong className="lbr-pin">{activity.joinPin}</strong><p>Scan the stable Activity QR or enter this code at <b>/join</b>.</p><Button variant="secondary" onClick={() => void copyJoin()} icon={copied ? <Check size={16} /> : <Copy size={16} />}>{copied ? "Link copied" : "Copy Activity link"}</Button></div><div className="lbr-qr"><QRCodeSVG value={window.location.origin + "/activity/" + activity.accessSlug} size={148} includeMargin /></div></div> : <EmptyState title={open ? "No join code yet" : "Activity access is closed"} description={open ? "Open this activity to create its participant code." : "Reopen the activity to accept new entries."} />}</Card>
      <Card className="lbr-phase-progress"><div className="section-heading"><div><span className="eyebrow">LIVE PROGRESS</span><h2>By phase</h2></div><span className="lbr-refresh-label"><i /> Refreshes every 4 seconds</span></div><div className="lbr-phase-metrics">{[["Self-assessment", data.counts.started ?? 0], ["Self locked", data.counts.self_locked ?? 0], ["Feedback complete", data.counts.feedback_phase_left ?? 0], ["Reflection entered", data.counts.reflection_entered ?? 0], ["Completion milestone", data.counts.completed ?? 0]].map(([name, value], index) => <div className={"lbr-phase-progress-row lbr-color-" + index} key={name}><span>{index + 1}</span><div><strong>{name}</strong><small>participants</small></div><b>{value}</b></div>)}</div></Card></div>
    <Card className="lbr-participants-card"><div className="section-heading"><div><span className="eyebrow">PARTICIPANT PROGRESS</span><h2>{visibleParticipants.length} of {data.participants.length} participants</h2></div><Link className="text-link" to={"/learning-behaviors/" + activityId + "/analytics"}>Open analytics <ArrowRight size={15} /></Link></div>
      <div className="lbr-progress-filters"><label><span>Search participants</span><input className="text-input" value={participantSearch} onChange={(event) => setParticipantSearch(event.target.value)} placeholder="Find by name…" /></label><label><span>Team</span><select className="text-input" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="">All teams</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label></div>
      {!data.participants.length ? <EmptyState title="No participants have joined yet" description="Share the code or QR when you are ready to begin." /> : visibleParticipants.length === 0 ? <EmptyState title="No participants match these filters" description="Clear the search or select another team." action={<Button variant="quiet" onClick={() => { setParticipantSearch(""); setTeamFilter(""); }}>Clear filters</Button>} /> : <div className="table-scroll"><table className="lbr-table"><thead><tr><th>Participant</th><th>Team</th><th>Current phase</th><th>Self</th><th>Feedback rounds</th><th>Reflection</th><th>Actions</th><th>Last seen</th><th /></tr></thead><tbody>{visibleParticipants.map((participant) => <tr key={participant.id}><td><strong>{participant.display_name}</strong></td><td>{participant.team_name ?? "—"}</td><td>{shortPhase(participant.current_phase, Boolean(participant.started_at))}</td><td>{participant.self_locked_at ? <Badge tone="green">Locked</Badge> : <Badge tone="gray">In progress</Badge>}</td><td>{participant.peer_submissions}</td><td>{["MY_REFLECTION", "MY_ACTIONS", "COMPLETED"].includes(participant.current_phase ?? "") ? "Entered" : "—"}</td><td>{participant.action_recorded ? "Recorded" : participant.ever_completed_at ? "Optional · blank" : "—"}</td><td>{participant.last_seen_at ? new Date(participant.last_seen_at).toLocaleString() : "—"}</td><td><Link className="text-link" to={"/learning-behaviors/" + activityId + "/participants/" + participant.id}>View detail <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}

function DataBar({ values }: { values: Record<number, number> }) {
  const max = Math.max(1, ...Object.values(values));
  return <div className="lbr-distribution">{[1, 2, 3, 4, 5].map((value) => <div className="lbr-distribution-col" key={value}><span>{values[value] ?? 0}</span><i style={{ height: Math.max(4, (values[value] ?? 0) / max * 70) + "px" }} /><small>{value}</small></div>)}<span className="lbr-chart-axis">Self rating</span></div>;
}

export function LearningBehaviorsAnalyticsPage() {
  const { activityId = "" } = useParams();
  const [teamId, setTeamId] = useState("");
  const path = "/owner/learning-behaviors/" + activityId + "/analytics" + (teamId ? "?teamId=" + encodeURIComponent(teamId) : "");
  const { data, loading, error, refresh } = useLbrData<LbrOwnerAnalytics>(path, 6000);
  const [selectedBehavior, setSelectedBehavior] = useState<BehaviorKey>(LEARNING_BEHAVIORS[0]!.key);
  if (loading && !data) return <LoadingState label="Calculating activity results…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data) return <EmptyState title="Results are not available" description="Reload this activity to try again." />;
  return <div className="page-stack lbr-analytics-page"><div className="breadcrumb"><Link to={"/learning-behaviors/" + activityId}>{data.activity.title}</Link><span>›</span><span>Results &amp; Analytics</span></div>
    <PageIntro eyebrow="RESULTS & ANALYTICS" title="See the learning patterns" description="Self averages exclude N/A and incomplete Self forms. Trainer peer means give each participant equal weight." action={<a className="button button-secondary" href={"/api/owner/learning-behaviors/" + activityId + "/export"}><Download size={16} /> Export CSV</a>} />
    <nav className="lbr-view-tabs"><Link to={"/learning-behaviors/" + activityId}>Live control</Link><Link className="selected" to={"/learning-behaviors/" + activityId + "/analytics"}>Results &amp; Analytics</Link><Link to={"/learning-behaviors/" + activityId + "/edit"}>Activity setup</Link></nav>
    <div className="lbr-analytics-filter"><label htmlFor="lbr-team-filter">Team filter</label><select id="lbr-team-filter" className="text-input" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">All teams</option>{data.teams.map((team) => <option value={team.teamId} key={team.teamId}>{team.teamName}</option>)}</select><span>{data.counts.selfLocked} locked Self forms · {data.counts.peerSubmissions} feedback rounds</span></div>
    <div className="lbr-result-summary-grid">{data.behaviors.map((behavior, index) => { const summary = data.summary[behavior.key]!; return <Card className={"lbr-result-card lbr-color-" + index} key={behavior.key}><div className="lbr-result-card-head"><i>{index + 1}</i><h2>{behavior.shortName}</h2></div><div className="lbr-compare-values"><div><small>Self average</small><strong>{formatLbrMean(summary.self.mean)}</strong><span>n={summary.self.validN} · {summary.self.naN} N/A</span></div><div><small>Others average</small><strong>{formatLbrMean(summary.peer.mean)}</strong><span>n={summary.peer.validN} participants</span></div></div><DataBar values={summary.distribution} /></Card>; })}</div>
    {data.teams.length > 0 && !teamId && <Card className="lbr-team-summary"><div className="section-heading"><div><span className="eyebrow">TEAM BREAKDOWN</span><h2>Self averages by team</h2></div><span>Trainer view · participant counts are shown</span></div><div className="table-scroll"><table className="lbr-table"><thead><tr><th>Team</th><th>Participants</th>{data.behaviors.map((behavior) => <th key={behavior.key}>{behavior.shortName}</th>)}</tr></thead><tbody>{data.teams.map((team) => <tr key={team.teamId}><td><strong>{team.teamName}</strong></td><td>{team.lockedCount}/{team.participantCount} locked</td>{data.behaviors.map((behavior) => <td key={behavior.key}>{formatLbrMean(team.behaviors[behavior.key]?.mean ?? null)} <small>n={team.behaviors[behavior.key]?.validN ?? 0}</small></td>)}</tr>)}</tbody></table></div></Card>}
    <Card className="lbr-individual-results"><div className="section-heading"><div><span className="eyebrow">INDIVIDUAL RESULTS</span><h2>Self and peer feedback</h2></div><label className="lbr-behavior-select">Behavior <select className="text-input" value={selectedBehavior} onChange={(event) => setSelectedBehavior(event.target.value as BehaviorKey)}>{data.behaviors.map((behavior) => <option key={behavior.key} value={behavior.key}>{behavior.name}</option>)}</select></label></div>
      {!data.participants.length ? <EmptyState title="No participants to show" description="Individual results will appear after people join." /> : <div className="lbr-individual-list">{data.participants.map((participant) => { const self = participant.self[selectedBehavior]; const peer = participant.peer[selectedBehavior]; return <Link className="lbr-individual-row" to={"/learning-behaviors/" + activityId + "/participants/" + participant.participantId} key={participant.participantId}><span><strong>{participant.displayName}</strong><small>{participant.teamName ?? "No team"} · {shortPhase(participant.phase, participant.selfLocked)}</small></span><span className="lbr-person-score"><small>Self</small><b>{self === "NA" || self === null ? "NA" : self}</b></span><span className="lbr-person-score"><small>Others</small><b>{formatLbrMean(peer.mean)} <i>n={peer.validN}</i></b></span><span className="lbr-feedback-count">{participant.peerSubmissionCount} feedback rounds</span><ArrowRight size={16} /></Link>; })}</div>}
    </Card>
    <div className="lbr-method-note"><LockKeyhole size={16} /><span>Feedback rounds count submissions, not verified people. N/A is excluded from numeric averages; empty denominators remain unavailable. This activity does not generate an overall score.</span></div>
  </div>;
}

type Detail = { participant: Record<string, unknown>; behaviors: Array<{ key: BehaviorKey; name: string; self: number | "NA" | null; evidence: string; peer: LbrSummary }>; peerRounds: Array<{ roundNumber: number; submittedAt: string | null; note: string; answers: Array<{ behaviorKey: BehaviorKey; rating: number | "NA" | null }> }>; peerSubmissionCount: number };
export function LearningBehaviorsIndividualPage() {
  const { activityId = "", participantId = "" } = useParams();
  const { data, loading, error, refresh } = useLbrData<Detail>("/owner/learning-behaviors/" + activityId + "/participants/" + participantId);
  if (loading && !data) return <LoadingState label="Loading participant detail…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data) return <EmptyState title="Participant not found" description="This participant may have been removed from the activity." />;
  const participant = data.participant;
  return <div className="page-stack lbr-individual-page"><div className="breadcrumb"><Link to={"/learning-behaviors/" + activityId}>Live activity</Link><span>›</span><Link to={"/learning-behaviors/" + activityId + "/analytics"}>Results</Link><span>›</span><span>Participant detail</span></div>
    <PageIntro eyebrow="PARTICIPANT RESULT DETAIL" title={String(participant.display_name ?? "Participant")} description={String(participant.team_name ?? "No team") + " · " + shortPhase(String(participant.current_phase ?? ""), Boolean(participant.started_at))} action={<Button variant="secondary" to={"/learning-behaviors/" + activityId + "/analytics"}><ArrowLeft size={15} /> Back to results</Button>} />
    <div className="lbr-detail-stats"><MetricCard icon={<LockKeyhole size={18} />} value={participant.self_locked_at ? "Locked" : "Draft"} label="Self ratings" tone="pink" /><MetricCard icon={<Radio size={18} />} value={data.peerSubmissionCount} label="Feedback rounds" tone="yellow" /><MetricCard icon={<Check size={18} />} value={participant.ever_completed_at ? "Reached" : "In progress"} label="Completion milestone" tone="aqua" /><MetricCard icon={<Users size={18} />} value={String(participant.actions_text ?? "").trim() ? "Recorded" : "Optional · blank"} label="My Actions" tone="purple" /></div>
    <Card className="lbr-detail-card"><div className="section-heading"><div><span className="eyebrow">SELF VS. OTHERS</span><h2>Six behavior ratings</h2></div><span>Read only · N/A is excluded from averages</span></div><div className="table-scroll"><table className="lbr-table"><thead><tr><th>Behavior</th><th>Self</th><th>Others average</th><th>Valid peer ratings</th></tr></thead><tbody>{data.behaviors.map((behavior, index) => <tr key={behavior.key}><td><span className={"lbr-table-number lbr-color-" + index}>{index + 1}</span><strong>{behavior.name}</strong></td><td>{behavior.self ?? "—"}</td><td>{formatLbrMean(behavior.peer.mean)}</td><td>{behavior.peer.validN} numeric · {behavior.peer.naN} N/A</td></tr>)}</tbody></table></div></Card>
    <Card className="lbr-detail-card"><div className="section-heading"><div><span className="eyebrow">ANONYMOUS ROUNDS</span><h2>Quick Notes from conversations</h2></div></div>{data.peerRounds.length ? <div className="lbr-round-list">{data.peerRounds.map((round) => <article className="lbr-round-card" key={round.roundNumber}><div><Badge tone="aqua">Feedback {String(round.roundNumber).padStart(2, "0")}</Badge><small>{round.submittedAt ? new Date(round.submittedAt).toLocaleString() : "Submitted"}</small></div><p>{round.note.trim() || "No Quick Note was recorded."}</p><div className="lbr-round-scores">{data.behaviors.map((behavior) => { const answer = round.answers.find((item) => item.behaviorKey === behavior.key)?.rating; return <span key={behavior.key}><small>{behavior.name}</small><strong>{answer ?? "—"}</strong></span>; })}</div></article>)}</div> : <EmptyState title="No peer feedback rounds yet" description="This participant can continue with reflection even if no feedback was collected." />}</Card>
    <div className="lbr-detail-narratives"><Card><span className="eyebrow">MY REFLECTION</span><h2>Participant reflection</h2><p>{String(participant.reflection_text ?? "").trim() || "No reflection text recorded."}</p></Card><Card><span className="eyebrow">MY ACTIONS</span><h2>Optional action note</h2><p>{String(participant.actions_text ?? "").trim() || "No action text recorded."}</p></Card></div>
    <div className="lbr-method-note"><LockKeyhole size={16} /><span>Trainer results are read-only. Peer respondents are not identified, and Quick Notes are recollections written by the participant.</span></div>
  </div>;
}

type LbrOwnState = {
  activity: { id: string; title: string; state: string; sessionName: string | null };
  participant: { displayName: string };
  behaviors: BehaviorCopy[];
  intro: string;
  progress: { current_phase: string; started_at: string | null; last_step_index: number; self_locked_at: string | null; ever_completed_at: string | null; reflection_text: string; actions_text: string; revision: number };
  selfAnswers: Array<{ behaviorKey: BehaviorKey; rating: LbrRating; evidence?: string; revision: number }>;
  peerRounds: Array<{ roundId: string; roundNumber: number; submittedAt: string | null; note: string; noteRevision: number; answers: Array<{ behaviorKey: BehaviorKey; rating: number | "NA" | null }> }>;
  peerSubmissionCount: number;
  peerStats: Record<BehaviorKey, LbrSummary>;
  scale: typeof LBR_SCALE;
  naLabel: string;
};

function lbrGuestHeaders(token: string) {
  return { Authorization: "Bearer " + token };
}

function lbrGuestPost<T>(path: string, token: string, body?: unknown, method = "POST") {
  return api<T>(path, { method, headers: lbrGuestHeaders(token), body: body === undefined ? undefined : JSON.stringify(body) });
}

function participantStartScreen(data: LbrOwnState) {
  if (!data.progress.started_at) return "intro";
  if (!data.progress.self_locked_at) return "self";
  if (data.progress.current_phase === "MY_REFLECTION") return "reflection";
  if (data.progress.current_phase === "MY_ACTIONS") return "actions";
  if (data.progress.current_phase === "COMPLETED") return "complete";
  return "feedback";
}

function LbrParticipantHeader({ title, step }: { title: string; step?: string }) {
  return <header className="lbr-participant-header"><BrandMark product={false} /><div><strong>{title}</strong><small>Learning Behaviors Reflection · v1.0</small></div>{step && <span>{step}</span>}</header>;
}

function LbrParticipantNotice() {
  return <div className="lbr-participant-notice"><LockKeyhole size={17} /><span>Your trainer can review your Self and peer answers, Quick Notes, reflection, and actions. The peer form does not collect respondent names. On a shared phone, Peer Submit opens Quick Notes immediately, so continue only if you are comfortable returning the device at that point.</span></div>;
}

function LbrNotesCollection({ activityId, rounds }: { activityId: string; rounds: LbrOwnState["peerRounds"] }) {
  return <section className="lbr-notes-collection" id="lbr-my-notes"><div className="section-heading"><div><span className="eyebrow">MY NOTES</span><h2>Quick Notes</h2></div><span>{rounds.length} saved</span></div>
    {rounds.length ? <div className="lbr-saved-notes">{rounds.map((round) => <Link key={round.roundId} to={"/participate/" + activityId + "/lbr/note/" + round.roundId}><span>Feedback {String(round.roundNumber).padStart(2, "0")}</span><small>{round.note.trim() || "No note recorded yet · add one"}</small><ArrowRight size={15} /></Link>)}</div> : <div className="lbr-no-notes">No feedback notes yet. You can continue to My Reflection without peer feedback.</div>}
  </section>;
}

function LbrSelfPeerReference({ data, answers }: { data: LbrOwnState; answers: Partial<Record<BehaviorKey, LbrRating>> }) {
  return <section className="lbr-self-peer-reference"><div className="section-heading"><div><span className="eyebrow">SELF VS. OTHERS</span><h2>What you noticed</h2></div><Link className="text-link" to={"/participate/" + data.activity.id + "/lbr/results"}>View full results <ArrowRight size={14} /></Link></div>
    <div className="lbr-reference-list">{data.behaviors.map((behavior, index) => {
      const saved = data.selfAnswers.find((answer) => answer.behaviorKey === behavior.key)?.rating;
      const self = Object.hasOwn(answers, behavior.key) ? answers[behavior.key] : saved;
      const peer = data.peerStats[behavior.key];
      return <div className={"lbr-reference-row lbr-color-" + index} key={behavior.key}><span>{behavior.shortName}</span><small>Self</small><b>{self ?? "—"}</b><small>Others</small><b>{formatLbrMean(peer?.mean ?? null)}</b><em>{peer?.validN ?? 0} peer ratings</em></div>;
    })}</div>
  </section>;
}

export function LearningBehaviorsParticipantPage({ activityId, token }: { activityId: string; token: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useLbrData<LbrOwnState>("/guest/lbr/me", 0, token);
  const [screen, setScreen] = useState("auto");
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState<Partial<Record<BehaviorKey, LbrRating>>>({});
  const [evidence, setEvidence] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmLock, setConfirmLock] = useState(false);
  const [reflection, setReflection] = useState<string | null>(() => { try { return sessionStorage.getItem("popp-lbr-reflection:" + activityId); } catch { return null; } });
  const [actions, setActions] = useState<string | null>(() => { try { return sessionStorage.getItem("popp-lbr-actions:" + activityId); } catch { return null; } });
  const narrativeVersion = useRef({ reflection: 0, actions: 0 });
  const [revision, setRevision] = useState<number | null>(null);
  const [narrativeDirty, setNarrativeDirty] = useState(() => ({
    reflection: Boolean(readLbrDraft("popp-lbr-reflection:" + activityId)),
    actions: Boolean(readLbrDraft("popp-lbr-actions:" + activityId)),
  }));
  const [narrativeSaveState, setNarrativeSaveState] = useState<"saved" | "unsaved" | "saving" | "error">(() =>
    readLbrDraft("popp-lbr-reflection:" + activityId) !== null || readLbrDraft("popp-lbr-actions:" + activityId) !== null ? "unsaved" : "saved");
  const closed = !data || data.activity.state !== "open";
  const view = data ? screen === "auto" ? participantStartScreen(data) : screen : screen;
  const currentStep = Math.max(0, Math.min(5, step < 0 ? (data?.progress.last_step_index ?? 1) - 1 : step));
  const savedAnswers = Object.fromEntries((data?.selfAnswers ?? []).map((answer) => [answer.behaviorKey, answer.rating])) as Partial<Record<BehaviorKey, LbrRating>>;
  const answerFor = (key: BehaviorKey) => Object.hasOwn(answers, key) ? answers[key] : savedAnswers[key];
  const currentBehavior = data?.behaviors[currentStep] ?? LEARNING_BEHAVIORS[currentStep]!;
  const currentAnswer = answerFor(currentBehavior.key);
  const savedEvidence = data?.selfAnswers.find((answer) => answer.behaviorKey === currentBehavior.key)?.evidence ?? "";
  const evidenceValue = evidence ?? savedEvidence;
  const reflectionValue = reflection ?? data?.progress.reflection_text ?? "";
  const actionsValue = actions ?? data?.progress.actions_text ?? "";
  const progressRevision = revision ?? data?.progress.revision ?? 1;
  const activeNarrativeKind = view === "reflection" ? "reflection" : view === "actions" ? "actions" : null;
  const activeNarrative = activeNarrativeKind === "reflection" ? reflection : activeNarrativeKind === "actions" ? actions : null;
  useEffect(() => {
    if (!data || !activeNarrativeKind || activeNarrative === null || !narrativeDirty[activeNarrativeKind] || closed) return;
    const kind = activeNarrativeKind;
    const text = activeNarrative;
    const savedVersion = narrativeVersion.current[kind];
    const timer = window.setTimeout(() => {
      setNarrativeSaveState("saving");
      void lbrGuestPost<{ revision: number }>("/guest/lbr/me/" + kind, token, { text, revision: progressRevision }, "PATCH")
        .then((result) => {
          setRevision(result.revision);
          if (narrativeVersion.current[kind] === savedVersion) {
            setNarrativeDirty((current) => ({ ...current, [kind]: false }));
            setNarrativeSaveState("saved");
            sessionStorage.removeItem("popp-lbr-" + kind + ":" + activityId);
            setActionError("");
          }
        })
        .catch((reason) => {
          setNarrativeSaveState("error");
          setActionError(reason instanceof Error ? reason.message : "Your note is still saved on this device. Retry when connected.");
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data, activeNarrativeKind, activeNarrative, narrativeDirty, closed, token, progressRevision, activityId]);

  function changeNarrative(kind: "reflection" | "actions", value: string) {
    narrativeVersion.current[kind] += 1;
    if (kind === "reflection") setReflection(value);
    else setActions(value);
    setNarrativeDirty((current) => ({ ...current, [kind]: true }));
    setNarrativeSaveState("unsaved");
    setActionError("");
    try { sessionStorage.setItem("popp-lbr-" + kind + ":" + activityId, value); } catch { /* Server autosave remains the source of truth when available. */ }
  }

  async function begin() {
    setPending(true); setActionError("");
    try { await lbrGuestPost("/guest/lbr/me/start", token); setScreen("self"); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not start this reflection."); }
    finally { setPending(false); }
  }
  async function saveSelf(key: BehaviorKey, value?: LbrRating, nextEvidence?: string, stepIndex = currentStep + 1) {
    setPending(true); setActionError("");
    try {
      await lbrGuestPost("/guest/lbr/me/self/" + key, token, {
        ...(value === undefined ? {} : { rating: value }),
        ...(nextEvidence === undefined ? {} : { evidence: nextEvidence }),
        stepIndex,
      }, "PATCH");
      if (value !== undefined) setAnswers((current) => ({ ...current, [key]: value }));
      if (nextEvidence !== undefined) setEvidence(nextEvidence);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not save this answer."); }
    finally { setPending(false); }
  }
  async function lockSelf() {
    if (data?.behaviors.some((behavior) => {
      const answer = Object.hasOwn(answers, behavior.key) ? answers[behavior.key] : data.selfAnswers.find((saved) => saved.behaviorKey === behavior.key)?.rating;
      return answer === undefined || answer === null;
    })) {
      setActionError("Choose a rating or N/A for all six behaviors before continuing."); return;
    }
    setPending(true); setActionError("");
    try { await lbrGuestPost("/guest/lbr/me/lock-self", token); setScreen("feedback"); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not lock your ratings."); }
    finally { setPending(false); }
  }
  async function enterPhase(phase: "FEEDBACK_COLLECTION" | "MY_REFLECTION" | "MY_ACTIONS") {
    if (data?.activity.state !== "open") {
      setScreen(phase === "MY_REFLECTION" ? "reflection" : phase === "MY_ACTIONS" ? "actions" : "feedback");
      return;
    }
    setPending(true); setActionError("");
    try {
      await lbrGuestPost("/guest/lbr/me/phase", token, { phase });
      setRevision((value) => (value ?? data?.progress.revision ?? 1) + 1);
      setScreen(phase === "MY_REFLECTION" ? "reflection" : phase === "MY_ACTIONS" ? "actions" : "feedback");
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not open this step."); }
    finally { setPending(false); }
  }
  async function saveNarrative(kind: "reflection" | "actions") {
    setPending(true); setActionError("");
    try {
      const savedVersion = narrativeVersion.current[kind];
      const response = await lbrGuestPost<{ revision: number }>("/guest/lbr/me/" + kind, token, { text: kind === "reflection" ? reflectionValue : actionsValue, revision: progressRevision }, "PATCH");
      setRevision(response.revision);
      if (narrativeVersion.current[kind] === savedVersion) {
        setNarrativeDirty((current) => ({ ...current, [kind]: false }));
        setNarrativeSaveState("saved");
        sessionStorage.removeItem("popp-lbr-" + kind + ":" + activityId);
      }
      if (kind === "reflection") await enterPhase("MY_ACTIONS");
      else {
        const completed = await lbrGuestPost("/guest/lbr/me/complete", token);
        if (completed) { setRevision((value) => (value ?? response.revision) + 1); setScreen("complete"); }
      }
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not save your note."); }
    finally { setPending(false); }
  }
  async function startPeerRound() {
    setPending(true); setActionError("");
    try {
      const storageKey = "popp-lbr-peer-current:" + activityId;
      let clientKey = sessionStorage.getItem(storageKey);
      if (!clientKey) { clientKey = crypto.randomUUID(); sessionStorage.setItem(storageKey, clientKey); }
      const result = await lbrGuestPost<{ roundId: string }>("/guest/lbr/me/peer-rounds", token, { clientKey });
      navigate("/participate/" + activityId + "/lbr/peer/" + result.roundId);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not start a feedback round."); }
    finally { setPending(false); }
  }
  if (loading && !data) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Learning Behaviors Reflection" /><LoadingState label="Opening your reflection…" /></main>;
  if (!data) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Learning Behaviors Reflection" /><div className="lbr-participant-card"><ErrorState message={error || "Could not load this activity."} retry={refresh} /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  const savedRounds = data.peerRounds;
  const resultsLink = "/participate/" + activityId + "/lbr/results";
  async function startPeerFromButton() { await startPeerRound(); }
  return <main className="lbr-participant-screen">
    <LbrParticipantHeader title={data.activity.title} step={view === "self" ? "Self · " + (currentStep + 1) + " of 6" : undefined} />
    <div className="lbr-participant-shell">
      {view !== "intro" && <nav className="lbr-participant-tabs" aria-label="Reflection phases">{[
        ["self", "Self"], ["feedback", "Ask for feedback"], ["reflection", "My Reflection"], ["actions", "My Actions"],
      ].map(([key, label]) => <button type="button" key={key} className={view === key ? "active" : ""} disabled={pending || (!data.progress.self_locked_at && key !== "self") || (key === "self" && Boolean(data.progress.self_locked_at))} onClick={() => key === "self" ? setScreen("self") : key === "feedback" ? void enterPhase("FEEDBACK_COLLECTION") : key === "reflection" ? void enterPhase("MY_REFLECTION") : void enterPhase("MY_ACTIONS")}>{label}</button>)}</nav>}
      {closed && <div className="lbr-participant-closed"><LockKeyhole size={16} /> This activity is closed. Your saved entries are read-only.</div>}
      {actionError && <div className="inline-error" role="alert">{actionError}</div>}
      {view === "intro" && <section className="lbr-participant-card lbr-intro-card"><span className="eyebrow">A MOMENT TO NOTICE</span><h1>Learning happens<br />in the little things.</h1><p>{data.intro}</p><div className="lbr-intro-phases">{["Notice your own habits", "Ask someone in person", "Reflect on what you heard", "Choose one next step"].map((label, index) => <div key={label}><i>{index + 1}</i><strong>{label}</strong></div>)}</div><LbrParticipantNotice /><Button variant="orange" disabled={pending || closed} onClick={() => void begin()}>{pending ? "Starting…" : "Start reflection"} <ArrowRight size={17} /></Button></section>}
      {view === "self" && <section className="lbr-participant-card lbr-self-card"><div className="lbr-self-progress"><span>BEHAVIOR {currentStep + 1} OF 6</span><b>{Math.round((currentStep + 1) / 6 * 100)}%</b><i><span style={{ width: ((currentStep + 1) / 6 * 100) + "%" }} /></i></div><div className={"lbr-self-behavior lbr-color-" + currentStep}><div className="lbr-self-number">{String(currentStep + 1).padStart(2, "0")}</div><span className="eyebrow">LEARNING BEHAVIOR</span><h1>{currentBehavior.name}</h1><p>{currentBehavior.description}</p><div className="lbr-example"><strong>For example</strong><p>{currentBehavior.example}</p></div><div className="lbr-reflection-prompt"><strong>Think about this</strong><p>{currentBehavior.reflectionPrompt}</p></div><p className="lbr-self-question">How often do you practice this behavior while working with others?</p><div className="lbr-scale-options" role="radiogroup" aria-label={"Rating for " + currentBehavior.name}>{data.scale.map((choice) => <button type="button" key={choice.value} role="radio" aria-checked={currentAnswer === choice.value} disabled={pending || closed || Boolean(data.progress.self_locked_at)} className={currentAnswer === choice.value ? "selected" : ""} onClick={() => void saveSelf(currentBehavior.key, choice.value)}><b>{choice.value}</b><span>{choice.label}</span></button>)}<button type="button" role="radio" aria-checked={currentAnswer === "NA"} disabled={pending || closed || Boolean(data.progress.self_locked_at)} className={"lbr-na-option " + (currentAnswer === "NA" ? "selected" : "")} onClick={() => void saveSelf(currentBehavior.key, "NA")}><b>NA</b><span>{data.naLabel || LBR_NA_LABEL}</span></button></div><label className="lbr-evidence-label">A specific moment you remember <small>optional</small><textarea className="text-input" maxLength={1000} value={evidenceValue} disabled={pending || closed} placeholder="What happened? You can leave this blank." onBlur={(event) => { if (event.currentTarget.value !== (data.selfAnswers.find((answer) => answer.behaviorKey === currentBehavior.key)?.evidence ?? "")) void saveSelf(currentBehavior.key, undefined, event.currentTarget.value); }} onChange={(event) => setEvidence(event.target.value)} /></label></div>{confirmLock && currentStep === 5 && !data.progress.self_locked_at && <div className="lbr-lock-confirm" role="alertdialog" aria-labelledby="lbr-lock-title"><LockKeyhole size={18} /><div><strong id="lbr-lock-title">Lock all six Self ratings?</strong><p>You won’t be able to change these ratings after entering feedback. Your optional evidence notes can still be edited while the activity is open.</p></div><div><Button variant="secondary" disabled={pending} onClick={() => setConfirmLock(false)}>Keep reviewing</Button><Button variant="orange" disabled={pending || closed} onClick={() => void lockSelf()}>{pending ? "Locking…" : "Lock ratings & continue"}</Button></div></div>}<div className="lbr-participant-actions"><Button variant="secondary" disabled={pending || currentStep === 0} onClick={() => { setStep(Math.max(0, currentStep - 1)); setEvidence(null); setConfirmLock(false); }}>Back</Button>{currentStep < 5 ? <Button variant="orange" disabled={pending || currentAnswer === undefined || currentAnswer === null || closed} onClick={() => { const next = currentStep + 1; setStep(next); setEvidence(null); void saveSelf(currentBehavior.key, undefined, evidenceValue, next + 1); }}>Next <ArrowRight size={16} /></Button> : data.progress.self_locked_at ? <span className="lbr-locked-label"><LockKeyhole size={15} /> Ratings locked</span> : confirmLock ? <span className="lbr-locked-label">Confirm above to continue</span> : <Button variant="orange" disabled={pending || currentAnswer === undefined || currentAnswer === null || closed} onClick={() => setConfirmLock(true)}>Review &amp; continue <ArrowRight size={15} /></Button>}</div>{data.progress.self_locked_at && <div className="lbr-info-callout"><LockKeyhole size={16} />Self ratings are locked. Your activity progress can continue while it is open.</div>}</section>}
      {view === "feedback" && <section className="lbr-participant-card"><span className="eyebrow">PHASE 02 · ASK FOR FEEDBACK</span><h1>Invite a perspective.</h1><p>Ask someone who has worked with you to answer six questions on this phone. Hand it over in person; the form shows neither your Self ratings nor name.</p><LbrParticipantNotice /><p className="lbr-soft-suggestion">We suggest asking at least three colleagues. You can ask more, or continue with none.</p><div className="lbr-peer-summary"><strong>{data.peerSubmissionCount} feedback {data.peerSubmissionCount === 1 ? "round" : "rounds"}</strong><span>Counted as submitted rounds, not verified people.</span></div><div className="lbr-peer-score-grid">{data.behaviors.map((behavior, index) => <div className={"lbr-peer-score lbr-color-" + index} key={behavior.key}><span>{behavior.shortName}</span><strong>{formatLbrMean(data.peerStats[behavior.key]?.mean ?? null)}</strong><small>{data.peerStats[behavior.key]?.validN ?? 0} ratings · {data.peerStats[behavior.key]?.naN ?? 0} N/A</small></div>)}</div><LbrNotesCollection activityId={activityId} rounds={savedRounds} /><div className="lbr-participant-actions"><Button variant="secondary" disabled={pending || closed} onClick={() => void startPeerFromButton()}><Plus size={16} /> {pending ? "Opening form…" : "Add Another Person"}</Button><Button variant="orange" disabled={pending} onClick={() => void enterPhase("MY_REFLECTION")}>Continue to My Reflection <ArrowRight size={16} /></Button><Link to={resultsLink} className="text-link">View My Results</Link><a className="text-link" href="#lbr-my-notes">My Notes</a></div></section>}
      {view === "reflection" && <div className="lbr-reflection-layout"><section className="lbr-participant-card"><LbrSelfPeerReference data={data} answers={answers} /><LbrNotesCollection activityId={activityId} rounds={savedRounds} /></section><LbrNarrativeCard title="What stood out?" eyebrow="PHASE 03 · MY REFLECTION" description="What did you hear? What felt surprising or similar? You can leave this blank and return while the activity remains open." value={reflectionValue} onChange={(value) => changeNarrative("reflection", value)} limit={4000} disabled={closed || pending} pending={pending} saveState={narrativeSaveState} error={actionError} onSave={() => void saveNarrative("reflection")} saveLabel="Save reflection & continue" onBack={() => void enterPhase("FEEDBACK_COLLECTION")} backLabel="Back to feedback" />
      </div>}
      {view === "actions" && <LbrNarrativeCard title="One thing to try." eyebrow="PHASE 04 · MY ACTIONS" description="What would you like to do differently after this activity? This note is optional. Completing the activity is a separate milestone." value={actionsValue} onChange={(value) => changeNarrative("actions", value)} limit={2000} disabled={closed || pending} pending={pending} saveState={narrativeSaveState} error={actionError} onSave={() => void saveNarrative("actions")} saveLabel="Complete actions" onBack={() => void enterPhase("MY_REFLECTION")} backLabel="Back to My Reflection" optional />}
      {view === "complete" && <section className="lbr-participant-card lbr-complete-card"><span className="lbr-complete-mark"><Check /></span><span className="eyebrow">REFLECTION COMPLETE</span><h1>You made space<br />to learn.</h1><p>Your completion is recorded. You can still return to feedback, your reflection, or your actions while the activity is open.</p><div className="lbr-completion-recap"><span><b>{data.selfAnswers.filter((answer) => answer.rating !== null).length}/6</b> Self choices locked</span><span><b>{data.peerSubmissionCount}</b> feedback submissions</span><span><b>{actionsValue.trim() ? "Recorded" : "Not recorded · optional"}</b> optional action</span></div><div className="lbr-complete-actions"><Button variant="secondary" disabled={pending} onClick={() => void enterPhase("FEEDBACK_COLLECTION")}>Review feedback</Button><Button variant="secondary" disabled={pending} onClick={() => void enterPhase("MY_REFLECTION")}>My Reflection</Button><Button variant="secondary" disabled={pending} onClick={() => void enterPhase("MY_ACTIONS")}>My Actions</Button><Link className="text-link" to={resultsLink}>My results</Link><a className="text-link" href="#lbr-my-notes">My Notes</a></div><LbrNotesCollection activityId={activityId} rounds={savedRounds} /></section>}
      {view !== "intro" && <p className="lbr-participant-footer">No account needed · Your activity link is temporary · TrainerPopp!Kit</p>}
    </div>
  </main>;
}

function LbrNarrativeCard({ title, eyebrow, description, value, onChange, limit, disabled, pending, saveState, error, onSave, saveLabel, onBack, backLabel, optional = false }: { title: string; eyebrow: string; description: string; value: string; onChange: (value: string) => void; limit: number; disabled: boolean; pending: boolean; saveState: "saved" | "unsaved" | "saving" | "error"; error: string; onSave: () => void; saveLabel: string; onBack?: () => void; backLabel?: string; optional?: boolean }) {
  const waitingToSave = saveState === "unsaved" || saveState === "saving";
  return <section className="lbr-participant-card lbr-narrative-card"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p><label className="lbr-narrative-label">{optional ? "My optional action" : "My reflection"}<textarea className="text-input" value={value} maxLength={limit} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={optional ? "Write one possible next step, or leave this blank." : "Write anything you want to remember from this moment."} /></label><div className="lbr-character-count">{value.length}/{limit} characters{optional && " · optional"}<span role="status">{saveState === "saving" ? "Autosaving…" : saveState === "unsaved" ? "Changes not saved yet" : saveState === "error" ? "Save failed · retry below" : "Saved"}</span></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="lbr-participant-actions">{onBack && <Button variant="secondary" disabled={disabled || pending} onClick={onBack}>{backLabel}</Button>}<Button variant="orange" disabled={disabled || pending || waitingToSave} onClick={onSave}>{pending ? "Saving…" : saveLabel} <ArrowRight size={16} /></Button></div></section>;
}

type LbrPeerForm = { roundId: string; status: string; behaviors: BehaviorCopy[]; scale: typeof LBR_SCALE; naLabel: string };
export function LearningBehaviorsPeerPage() {
  const { activityId = "", roundId = "" } = useParams();
  const navigate = useNavigate();
  const token = sessionStorage.getItem("popp-guest:" + activityId) ?? "";
  const { data, loading, error } = useLbrData<LbrPeerForm>("/guest/lbr/peer-rounds/" + roundId + "/form", 0, token);
  const [answers, setAnswers] = useState<Partial<Record<BehaviorKey, number | "NA">>>(() => {
    try { return JSON.parse(sessionStorage.getItem("popp-lbr-peer:" + roundId) ?? "{}") as Partial<Record<BehaviorKey, number | "NA">>; }
    catch { return {}; }
  });
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const key = data?.behaviors[step]?.key;
  function choose(value: number | "NA") {
    if (!key) return;
    const next = { ...answers, [key]: value };
    setAnswers(next); setActionError("");
    try { sessionStorage.setItem("popp-lbr-peer:" + roundId, JSON.stringify(next)); } catch { /* The form remains usable for this page view. */ }
  }
  async function submit() {
    if (!data || !token) return;
    if (data.behaviors.some((behavior) => answers[behavior.key] === undefined)) { setActionError("Choose a rating or N/A for all six behaviors."); return; }
    setPending(true); setActionError("");
    try {
      const result = await lbrGuestPost<{ notePath: string }>("/guest/lbr/peer-rounds/" + roundId + "/submit", token, { answers });
      sessionStorage.removeItem("popp-lbr-peer:" + roundId);
      sessionStorage.removeItem("popp-lbr-peer-current:" + activityId);
      navigate(result.notePath, { replace: true });
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not submit these ratings. Your choices remain on this device."); }
    finally { setPending(false); }
  }
  if (!token) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Peer reflection" /><div className="lbr-participant-card"><ErrorState message="Your temporary participant link is missing. Join again with the activity code." /><Button to="/join">Join again</Button></div></main>;
  if (loading) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Peer reflection" /><LoadingState label="Opening the peer form…" /></main>;
  if (error || !data) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Peer reflection" /><div className="lbr-participant-card"><ErrorState message={error || "This feedback form is not available."} /><Button variant="secondary" to={"/participate/" + activityId}>Back to activity</Button></div></main>;
  if (data.status === "SUBMITTED") return <Navigate to={"/participate/" + activityId + "/lbr/note/" + roundId} replace />;
  const behavior = data.behaviors[step]!;
  const selected = answers[behavior.key];
  return <main className="lbr-participant-screen lbr-peer-form-screen"><LbrParticipantHeader title="A peer perspective" step={"Behavior " + (step + 1) + " of 6"} /><div className="lbr-participant-shell"><div className="lbr-peer-isolation"><LockKeyhole size={16} />This form does not show the participant’s name or Self ratings. Please answer from your experience.</div><section className="lbr-participant-card lbr-peer-form-card"><div className="lbr-self-progress"><span>PEER FEEDBACK · {step + 1} OF 6</span><b>{Math.round((step + 1) / 6 * 100)}%</b><i><span style={{ width: ((step + 1) / 6 * 100) + "%" }} /></i></div><div className={"lbr-self-behavior lbr-color-" + step}><span className="eyebrow">LEARNING BEHAVIOR</span><h1>{behavior.name}</h1><p>{behavior.description}</p><p className="lbr-self-question">In your experience, how often does this person practice this behavior while working with others?</p><div className="lbr-scale-options" role="radiogroup" aria-label={"Peer rating for " + behavior.name}>{data.scale.map((choice) => <button type="button" role="radio" aria-checked={selected === choice.value} key={choice.value} disabled={pending} className={selected === choice.value ? "selected" : ""} onClick={() => choose(choice.value)}><b>{choice.value}</b><span>{choice.label}</span></button>)}<button type="button" role="radio" aria-checked={selected === "NA"} className={"lbr-na-option " + (selected === "NA" ? "selected" : "")} disabled={pending} onClick={() => choose("NA")}><b>NA</b><span>{data.naLabel}</span></button></div></div>{actionError && <div className="inline-error" role="alert">{actionError}</div>}<div className="lbr-participant-actions"><Button variant="secondary" disabled={pending || step === 0} onClick={() => setStep((value) => value - 1)}>Back</Button>{step < 5 ? <Button variant="orange" disabled={pending || selected === undefined} onClick={() => setStep((value) => value + 1)}>Next <ArrowRight size={16} /></Button> : <Button variant="orange" disabled={pending || selected === undefined} onClick={() => void submit()}>{pending ? "Submitting…" : "Submit & add a Quick Note"} <ArrowRight size={16} /></Button>}</div><p className="lbr-peer-footer">Please complete this reflection in person. Do not include identifying information in the ratings.</p></section></div></main>;
}

export function LearningBehaviorsQuickNotePage() {
  const { activityId = "", roundId = "" } = useParams();
  const navigate = useNavigate();
  const token = sessionStorage.getItem("popp-guest:" + activityId) ?? "";
  const { data, loading, error } = useLbrData<LbrOwnState>("/guest/lbr/me", 0, token);
  const noteDraftKey = "popp-lbr-note:" + roundId;
  const [text, setText] = useState<string | null>(() => { try { return sessionStorage.getItem(noteDraftKey); } catch { return null; } });
  const [revision, setRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(() => { try { return Boolean(sessionStorage.getItem(noteDraftKey)); } catch { return false; } });
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState("");
  const round = data?.peerRounds.find((item) => item.roundId === roundId);
  const noteText = text ?? round?.note ?? "";
  const noteRevision = revision ?? round?.noteRevision ?? 1;
  useEffect(() => {
    if (text === null || !dirty || !token || !round || data?.activity.state !== "open") return;
    const nextText = text;
    const timer = window.setTimeout(() => {
      setPending(true); setSaved(false);
      void lbrGuestPost<{ revision: number }>("/guest/lbr/me/peer-rounds/" + roundId + "/note", token, { text: nextText, revision: noteRevision }, "PUT")
        .then((result) => {
          setRevision(result.revision); setDirty(false); setSaved(true); setActionError("");
          sessionStorage.removeItem(noteDraftKey);
        })
        .catch((reason) => { setActionError(reason instanceof Error ? reason.message : "Your Quick Note is still on this device. Retry when connected."); })
        .finally(() => setPending(false));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [text, dirty, token, round, data?.activity.state, roundId, noteRevision, noteDraftKey]);
  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!token) return;
    setPending(true); setActionError(""); setSaved(false);
    try {
      const result = await lbrGuestPost<{ revision: number }>("/guest/lbr/me/peer-rounds/" + roundId + "/note", token, { text: noteText, revision: noteRevision }, "PUT");
      setRevision(result.revision); setDirty(false); setSaved(true); sessionStorage.removeItem(noteDraftKey);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not save your Quick Note."); }
    finally { setPending(false); }
  }
  if (!token) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Quick Note" /><div className="lbr-participant-card"><ErrorState message="Your temporary participant link is missing. Join again with the activity code." /><Button to="/join">Join again</Button></div></main>;
  if (loading) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Quick Note" /><LoadingState label="Loading your Quick Note…" /></main>;
  if (error || !data || !round) return <main className="lbr-participant-screen"><LbrParticipantHeader title="Quick Note" /><div className="lbr-participant-card"><ErrorState message={error || "This Quick Note is not available."} /><Button variant="secondary" to={"/participate/" + activityId}>Back to activity</Button></div></main>;
  const noteActivityOpen = data.activity.state === "open";
  async function continueToReflection() {
    if (noteActivityOpen) {
      setPending(true); setActionError("");
      try { await lbrGuestPost("/guest/lbr/me/phase", token, { phase: "MY_REFLECTION" }); }
      catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not open My Reflection."); setPending(false); return; }
      finally { setPending(false); }
    }
    navigate("/participate/" + activityId);
  }
  return <main className="lbr-participant-screen"><LbrParticipantHeader title={data.activity.title} step="Quick Note" /><div className="lbr-participant-shell"><section className="lbr-participant-card lbr-narrative-card"><span className="eyebrow">AFTER FEEDBACK {String(round.roundNumber).padStart(2, "0")}</span><h1>Save what you’ll remember.</h1><p>Jot down the moment or phrase that you want to reflect on later. Keep this note about the conversation, not about who gave which rating.</p><form onSubmit={(event) => void save(event)}><label className="lbr-narrative-label">Quick Note<textarea className="text-input" value={noteText} maxLength={2000} disabled={data.activity.state !== "open" || pending} onChange={(event) => { setText(event.target.value); setDirty(true); setSaved(false); try { sessionStorage.setItem(noteDraftKey, event.target.value); } catch { /* The text remains available in this page view. */ } }} placeholder="A moment, example, or question to come back to…" /></label><div className="lbr-character-count">{noteText.length}/2000 characters <span role="status">{pending ? "Saving…" : dirty ? "Changes not saved yet" : saved ? "Saved" : "Autosaved"}</span></div>{actionError && <div className="inline-error" role="alert">{actionError}</div>}{saved && <div className="saved-status" role="status"><Check size={16} />Saved to this activity.</div>}<div className="lbr-participant-actions"><Button variant="secondary" type="submit" disabled={pending || data.activity.state !== "open"}>{pending ? "Saving…" : "Save Quick Note"} <Check size={16} /></Button><Button variant="secondary" type="button" disabled={pending} onClick={() => navigate("/participate/" + activityId)}>Ask Another Person</Button><Button variant="orange" type="button" disabled={pending} onClick={() => void continueToReflection()}>Continue to My Reflection <ArrowRight size={16} /></Button></div></form><small className="lbr-note-private">Your trainer can read this note with the activity results. It does not identify the peer respondent.</small></section></div></main>;
}

export function LearningBehaviorsParticipantResultsPage() {
  const { activityId = "" } = useParams();
  const token = sessionStorage.getItem("popp-guest:" + activityId) ?? "";
  const { data, loading, error, refresh } = useLbrData<{ behaviors: Array<{ key: BehaviorKey; name: string; self: number | "NA" | null; peer: LbrSummary }>; peerSubmissionCount: number }>("/guest/lbr/me/results", 0, token);
  if (!token) return <main className="lbr-participant-screen"><LbrParticipantHeader title="My results" /><div className="lbr-participant-card"><ErrorState message="Your temporary participant link is missing. Join again with the activity code." /><Button to="/join">Join again</Button></div></main>;
  if (loading) return <main className="lbr-participant-screen"><LbrParticipantHeader title="My results" /><LoadingState label="Loading your results…" /></main>;
  if (error || !data) return <main className="lbr-participant-screen"><LbrParticipantHeader title="My results" /><div className="lbr-participant-card"><ErrorState message={error || "Results are not available."} retry={refresh} /><Button variant="secondary" to={"/participate/" + activityId}>Back to activity</Button></div></main>;
  return <main className="lbr-participant-screen"><LbrParticipantHeader title="My results" step={data.peerSubmissionCount + " feedback rounds"} /><div className="lbr-participant-shell"><section className="lbr-participant-card lbr-my-results"><div><span className="eyebrow">PRIVATE TO YOU</span><h1>Your reflection snapshot.</h1><p>Self means show your own rating. Others means the average of your submitted peer feedback rounds. N/A is excluded; no overall score is calculated.</p></div><div className="table-scroll"><table className="lbr-table"><thead><tr><th>Behavior</th><th>Your Self rating</th><th>Others average</th><th>Peer ratings</th></tr></thead><tbody>{data.behaviors.map((behavior, index) => <tr key={behavior.key}><td><span className={"lbr-table-number lbr-color-" + index}>{index + 1}</span><strong>{behavior.name}</strong></td><td>{behavior.self ?? "—"}</td><td>{formatLbrMean(behavior.peer.mean)}</td><td>{behavior.peer.validN} numeric · {behavior.peer.naN} N/A</td></tr>)}</tbody></table></div><div className="lbr-method-note"><LockKeyhole size={16} /><span>These results are only for the participant link used to open this page. Your trainer can see all individual entries.</span></div><Button variant="secondary" to={"/participate/" + activityId}>Back to reflection</Button></section></div></main>;
}

export function LearningBehaviorsPublicPresenterPage() {
  const [data, setData] = useState<{ kind: string; title: string; lockedSelfCount: number; behaviors: Array<{ key: BehaviorKey; name: string; shortName: string; mean: number | null; validN: number }> } | null>(null);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    let active = true;
    const load = async () => {
      try {
        const value = await api<typeof data>("/presenter", { headers: { Authorization: "Bearer " + token } });
        if (active && value?.kind === "learning-behaviors-reflection") { setData(value); setError(""); }
        else if (active) setError("This presenter link is not available.");
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not connect to Presenter Mode."); }
    };
    void load();
    const timer = window.setInterval(() => setTick((value) => value + 1), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tick]);
  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); setFullscreen(true); }
      else { await document.exitFullscreen(); setFullscreen(false); }
    } catch { setError("Fullscreen is not available in this browser."); }
  }
  if (error && !data) return <main className="lbr-public-presenter"><BrandMark /><ErrorState message={error} /></main>;
  if (!data) return <main className="lbr-public-presenter"><LoadingState label="Connecting to Presenter Mode…" /></main>;
  return <main className="lbr-public-presenter"><header className="lbr-presenter-head"><div className="lbr-presenter-brand"><BrandMark product={false} /><span><small>TRAINERPOPP!KIT</small><strong>Learning Behaviors Reflection</strong></span></div><div className="lbr-presenter-status"><span><i /> LIVE GROUP VIEW</span><button type="button" onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button></div></header><section className="lbr-presenter-content"><div className="lbr-presenter-title"><div><h1>{data.title}</h1><p>Seeing our learning behaviors as a group</p></div><Mascot kind="sun" /></div><div className="lbr-presenter-panel"><div className="lbr-presenter-overview"><div className="lbr-presenter-count"><Users size={23} /><strong>{data.lockedSelfCount}</strong><span>locked Self<br />reflections</span></div><div className="lbr-presenter-legend"><span>Frequency</span>{[{ label: "1", description: "Never / almost never" }, { label: "2", description: "Rarely" }, { label: "3", description: "Sometimes" }, { label: "4", description: "Often" }, { label: "5", description: "Almost whenever there is an opportunity" }].map((item) => <span title={item.description} key={item.label}><b>{item.label}</b></span>)}</div></div><div className="lbr-presenter-grid">{data.behaviors.map((behavior, index) => { const Icon = [CircleHelp, Users, Hand, FlaskConical, MessageCircle, Heart][index] ?? CircleHelp; return <article className={"lbr-presenter-card lbr-color-" + index} key={behavior.key}><div className="lbr-presenter-card-head"><Icon aria-hidden="true" /><h2 title={behavior.name}>{behavior.shortName}</h2></div><div className="lbr-presenter-score"><strong>{formatLbrMean(behavior.mean)}</strong>{behavior.mean !== null && <span>/ 5</span>}</div><small>{behavior.validN} valid Self ratings</small></article>; })}</div><p className="lbr-presenter-foot">Average locked Self ratings · N/A excluded · no overall score</p></div></section></main>;
}
