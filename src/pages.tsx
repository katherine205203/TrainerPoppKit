import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, Clock3, Copy, Flower, Lightbulb, Link2, LockKeyhole, Pause, Play, Plus, Radio, Search, Sparkles, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, BrandMark, Button, Card, ColorDot, DemoNotice, EmptyState, ErrorState, LoadingState, Mascot, MetricCard, PageIntro } from "./components";
import { DEMO_ITEMS, relativeTier, SCARF_COLORS, SCARF_DIMENSIONS, smallGroupWarning, type ScarfDimension } from "./domain/scarf";

type Session = { id: string; name: string; description: string; starts_at?: string | null; location?: string; expected_participants?: number; status: string; activity_count?: number; participant_count?: number };
type Team = { id: string; name: string };
type Activity = { id: string; session_id: string | null; title: string; state: string; result_policy: "trainer_reveal" | "immediate" | "confirmation"; require_name: number; allow_teams: number; join_pin: string | null; session_name?: string; participant_count?: number; submitted_count?: number; instrument_version?: string; scoring_version?: string };
type OwnerActivity = { activity: Activity; teams: Team[]; participants: Participant[]; counts: { joined: number; submitted: number | null }; presentation: { revealed: number; comparison_basis: "within_person" | "team_relative"; selected_team_id: string | null; show_names: number } };
type Participant = { id: string; display_name: string; role?: string; team_id: string | null; team_name?: string | null; consent_named_results: number; submission_status?: string | null; submitted_at?: string | null };
type ScoreRow = { id: string; display_name: string; team_id: string | null; team_name?: string | null; consent_named_results: number; submission_status?: string; scores_json: string | null; instrument_version?: string; scoring_version?: string };
type ScarfScores = Record<ScarfDimension, number>;

const TEAM_PALETTE = ["#aee6ed", "#ff6bcb", "#dbb8ff", "#f2bb05", "#ff8b5f", "#a3e7c7"];

function useRefresh() {
  const [tick, setTick] = useState(0);
  return { tick, refresh: () => setTick((value) => value + 1) };
}

function useData<T>(path: string, interval = 0, bearer?: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { tick, refresh } = useRefresh();
  const hasLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!hasLoaded.current) setLoading(true);
      try {
        const next = await api<T>(path, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {});
        if (alive) { setData(next); setError(""); hasLoaded.current = true; }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : "Could not load data.");
      } finally { if (alive) setLoading(false); }
    }
    void load();
    if (interval) {
      const timer = window.setInterval(() => { void load(); }, interval);
      return () => { alive = false; window.clearInterval(timer); };
    }
    return () => { alive = false; };
  // `tick` intentionally triggers a manual refresh for the same endpoint.
  }, [path, tick, interval, bearer]);
  return { data, loading, error, refresh };
}

function ActivityBadge({ state }: { state: string }) {
  const tone = state === "open" ? "green" : state === "closed" || state === "archived" || state === "completed" ? "blue" : "purple";
  const label = state === "open" ? "Live" : state === "paused" ? "Paused" : state === "draft" ? "Draft" : state === "closed" ? "Closed" : state;
  return <Badge tone={tone}>{label}</Badge>;
}

export function HomePage() {
  const sessions = useData<{ sessions: Session[] }>("/owner/sessions");
  const activities = useData<{ activities: Activity[] }>("/owner/activities");
  if ((sessions.loading || activities.loading) && !sessions.data && !activities.data) return <LoadingState />;
  const live = activities.data?.activities.filter((activity) => ["open", "paused"].includes(activity.state)) ?? [];
  const recent = activities.data?.activities.slice(0, 3) ?? [];
  const upcoming = sessions.data?.sessions.slice(0, 3) ?? [];
  const error = sessions.error || activities.error;
  return <div className="page-stack">
    <PageIntro title="Home" description="A good session starts with a good plan. Let’s make a moment pop." action={<Button variant="orange" to="/activities/new" icon={<Plus size={18} />}>Create activity</Button>} />
    {error && <ErrorState message={error} retry={() => { sessions.refresh(); activities.refresh(); }} />}
    <section className="home-hero">
      <div className="home-hero-copy"><span className="hero-kicker">GOOD CONVERSATIONS. BRIGHTER PEOPLE.</span><h2>Make<br />moments <em>pop.</em></h2><p>Plan and run engaging training sessions with tools that spark people, not just presentations.</p><Button variant="secondary" to="/tools">Explore tools</Button></div>
      <div className="home-hero-art"><div className="hero-blob hero-blob-yellow"><Mascot kind="sun" /></div><div className="hero-blob hero-blob-orange"><Mascot kind="flower" /></div><div className="hero-blob hero-blob-blue" /><div className="hero-spark">✦</div></div>
      <span className="hero-caption">Popp! makes space for better conversations.</span>
    </section>
    <div className="metric-grid">
      <MetricCard icon={<Flower />} value="1" label="Available tool" tone="orange" />
      <MetricCard icon={<CalendarDays />} value={sessions.data?.sessions.length ?? "—"} label="My sessions" tone="aqua" />
      <MetricCard icon={<Radio />} value={live.length} label="Live activities" tone="purple" />
      <MetricCard icon={<Users />} value={activities.data?.activities.reduce((sum, item) => sum + Number(item.submitted_count ?? 0), 0) ?? 0} label="Demo submissions" tone="yellow" />
    </div>
    <div className="home-columns">
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">QUICK LAUNCH</span><h2>Pick a tool</h2></div><Link className="text-link" to="/tools">View tools <ArrowRight size={16} /></Link></div>
        <div className="quick-tool-grid"><Link to="/tools/scarf" className="quick-tool-card quick-scarf"><div><Badge tone="orange">DEMO MODULE</Badge><h3>SCARF exploration</h3><p>Start a guided demo activity with clearly labelled placeholder content.</p><span className="card-link">Set up activity <ArrowRight size={17} /></span></div><Mascot kind="sun" /></Link><Link to="/sessions/new" className="quick-tool-card quick-session"><div><span className="quick-card-icon"><CalendarDays /></span><h3>Create a session</h3><p>Organize a workshop and add activities when you’re ready.</p><span className="card-link">Create session <ArrowRight size={17} /></span></div><Mascot kind="flower" /></Link></div>
      </section>
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">LIVE ROOM</span><h2>In the room</h2></div><Link className="text-link" to="/live">Open live room <ArrowRight size={16} /></Link></div>
        {live.length ? <div className="mini-list">{live.slice(0, 3).map((item) => <Link key={item.id} className="mini-row" to={`/activities/${item.id}/live`}><span className="mini-icon mini-icon-blue"><Radio size={19} /></span><span><strong>{item.title}</strong><small>{item.participant_count ?? 0} joined · {item.submitted_count ?? 0} submitted</small></span><ActivityBadge state={item.state} /></Link>)}</div> : <div className="empty-inline"><div className="empty-inline-icon"><Radio /></div><strong>The room is quiet.</strong><span>Launch an activity when you’re ready for participants.</span><Button variant="quiet" to="/activities/new">Set up activity</Button></div>}
      </section>
    </div>
    <div className="home-columns home-bottom-columns"><section className="section-block"><div className="section-heading"><div><span className="eyebrow">COMING UP</span><h2>My sessions</h2></div><Link className="text-link" to="/sessions">All sessions <ArrowRight size={16} /></Link></div>
      {upcoming.length ? <div className="mini-list">{upcoming.map((session, index) => <Link key={session.id} className="mini-row" to={`/sessions/${session.id}`}><span className={`date-tile date-${index % 3}`}><CalendarDays size={17} /><small>{session.starts_at ? new Date(session.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "DRAFT"}</small></span><span><strong>{session.name}</strong><small>{session.expected_participants || 0} expected · {session.activity_count ?? 0} activities</small></span><ChevronRight size={18} /></Link>)}</div> : <EmptyState title="No sessions yet" description="Create a class or workshop when you need a home for activities." action={<Button variant="quiet" to="/sessions/new">Create session</Button>} />}</section>
      <section className="section-block"><div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Saved work</h2></div><Link className="text-link" to="/archive">View archive <ArrowRight size={16} /></Link></div>
      {recent.length ? <div className="mini-list">{recent.map((item, index) => <Link key={item.id} className="mini-row" to={item.state === "draft" || item.state === "open" || item.state === "paused" ? `/activities/${item.id}/live` : `/results/${item.id}`}><span className={`mini-icon mini-icon-${index % 2 ? "pink" : "orange"}`}><BarChart3 size={19} /></span><span><strong>{item.title}</strong><small>{item.session_name ?? "Quick activity"} · {item.submitted_count ?? 0} submitted</small></span><ActivityBadge state={item.state} /></Link>)}</div> : <div className="empty-inline"><span>No activities saved yet.</span><Button variant="quiet" to="/activities/new">Create one</Button></div>}</section></div>
  </div>;
}

const TOOL_CARDS = [
  { title: "SCARF Explorer", category: "Assessment", description: "A clearly labelled demo flow to explore five social needs.", tone: "orange", icon: "sun", available: true },
  { title: "Reflection Circle", category: "Reflection", description: "A future module concept for guided reflection.", tone: "blue", icon: "flower", available: false },
  { title: "Pulse Check-in", category: "Pulse", description: "A future module concept for a quick team check-in.", tone: "pink", icon: "bean", available: false },
  { title: "Team Poll", category: "Voting", description: "A future module concept for collecting ideas.", tone: "aqua", icon: "spark", available: false },
];

export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState("All tools");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const categories = ["All tools", "Assessment", "Reflection", "Pulse", "Voting"];
  const filtered = TOOL_CARDS.filter((tool) => (category === "All tools" || tool.category === category) && `${tool.title} ${tool.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack"><PageIntro title="My Tools" description="Choose a tool to spark the right kind of conversation." action={<Badge tone="blue">1 available · 3 concepts</Badge>} />
    <div className="toolbar-row"><div className="filter-pills" role="group" aria-label="Filter tools">{categories.map((item) => <button key={item} className={`filter-pill ${category === item ? "selected" : ""}`} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="local-search"><input aria-label="Search tools" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a tool…" /><Search size={16} /></label></div>
    {category === "All tools" && !search && <section className="scarf-tool-banner"><div className="scarf-banner-copy"><Badge tone="orange">FIRST MODULE · DEMO ONLY</Badge><h2>Explore five social needs.</h2><p>Use the SCARF demo flow to validate your facilitation workflow. The prompts and scoring are placeholders, not an approved instrument.</p><div className="scarf-legend">{SCARF_DIMENSIONS.map((name, i) => <span key={name}><ColorDot color={SCARF_COLORS[i]!} />{name}</span>)}</div><Button variant="yellow" to="/tools/scarf">Explore SCARF</Button></div><div className="scarf-banner-art"><Mascot kind="sun" /><span className="art-spark art-spark-one">✦</span><span className="art-spark art-spark-two">✦</span></div></section>}
    <div className="section-heading"><h2>{search ? "Search results" : "Tool library"}</h2><span className="subtle-text">{filtered.filter((item) => item.available).length} available now</span></div>
    {filtered.length ? <div className="tool-grid">{filtered.map((tool) => <article className={`tool-card tool-card-${tool.tone} ${tool.available ? "" : "tool-unavailable"}`} key={tool.title}><div className="tool-card-top"><Badge tone={tool.available ? "green" : "gray"}>{tool.available ? "Available" : "Coming later"}</Badge><Mascot kind={tool.icon as "flower" | "sun" | "bean" | "spark"} /></div><div><span className="eyebrow">{tool.category}</span><h3>{tool.title}</h3><p>{tool.description}</p></div>{tool.available ? <Link to="/tools/scarf" className="card-link">Open tool <ArrowRight size={17} /></Link> : <span className="muted-inline">Concept card · not launched</span>}</article>)}</div> : <EmptyState title="No tools match that search" description="Try another search or switch the category filter." action={<Button variant="quiet" onClick={() => { setSearch(""); params.delete("search"); setParams(params); }}>Clear search</Button>} />}
    <div className="privacy-footnote"><LockKeyhole size={16} /><span>SCARF prompts and scoring are demo-only. No official questionnaire or scoring rules have been approved.</span></div>
  </div>;
}

export function ScarfDetailPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function quickDemo() {
    setPending(true); setError("");
    try {
      const { activity } = await post<{ activity: { id: string } }>("/owner/activities", { title: "SCARF Demo Activity", resultPolicy: "trainer_reveal", allowTeams: false, requireName: true, teamNames: [] });
      await post(`/owner/activities/${activity.id}/open`);
      navigate(`/activities/${activity.id}/live`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the demo activity."); }
    finally { setPending(false); }
  }
  return <div className="page-stack"><div className="breadcrumb"><Link to="/tools">My Tools</Link><ChevronRight size={15} /><span>SCARF Explorer</span></div><section className="tool-detail-hero"><div className="tool-detail-copy"><Badge tone="orange">DEMO MODULE</Badge><h1>SCARF<span className="title-dot">.</span></h1><p>Build a thoughtful conversation around Status, Certainty, Autonomy, Relatedness and Fairness.</p><p className="detail-small">A facilitator-led demo workflow for the Popp! experience. It does not contain an approved or validated SCARF questionnaire.</p><div className="detail-actions"><Button to="/activities/new">Create activity</Button><Button variant="yellow" onClick={() => void quickDemo()} disabled={pending}>{pending ? "Starting demo…" : "Open quick demo"}</Button></div>{error && <div className="inline-error" role="alert">{error}</div>}</div><div className="tool-detail-art"><div className="detail-sun"><Mascot kind="sun" /></div><div className="detail-flower"><Mascot kind="flower" /></div><div className="detail-stars">✦</div><div className="dimension-stack">{SCARF_DIMENSIONS.map((name, index) => <span key={name} style={{ background: `${SCARF_COLORS[index]}44` }}><b style={{ background: SCARF_COLORS[index] }}>{name[0]}</b>{name}</span>)}</div></div></section>
    <DemoNotice />
    <div className="detail-info-grid">{[["What this demo helps with", "Preview the participant flow, trainer controls and privacy-first presentation choices."], ["Designed for", "Facilitated conversations in workshops, classes and team learning sessions."], ["Demo format", "Five placeholder agreement prompts, one for each dimension. No normed interpretation."], ["Available outputs", "A personal demo profile, illustrative team view and a reveal-controlled presenter." ]].map(([title, text], i) => <Card key={title} className={`detail-info-card detail-info-${i}`}><span className="detail-info-icon">{i === 0 ? <Lightbulb /> : i === 1 ? <Users /> : i === 2 ? <Check /> : <BarChart3 />}</span><h3>{title}</h3><p>{text}</p></Card>)}</div>
    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">FIVE DIMENSIONS</span><h2>One conversation, five lenses</h2></div></div><div className="dimension-cards">{SCARF_DIMENSIONS.map((dimension, index) => <div key={dimension} className="dimension-card" style={{ "--dimension": SCARF_COLORS[index] } as CSSProperties}><span>{dimension[0]}</span><strong>{dimension}</strong><small>Demo-only content</small></div>)}</div></section>
  </div>;
}

export function SessionsPage() {
  const [filter, setFilter] = useState("All");
  const { data, loading, error, refresh } = useData<{ sessions: Session[] }>("/owner/sessions");
  const sessions = data?.sessions.filter((session) => filter === "All" || session.status.toLowerCase() === filter.toLowerCase()) ?? [];
  return <div className="page-stack"><PageIntro title="My Sessions" description="Organize workshops, classes, and learning experiences." action={<Button variant="orange" to="/sessions/new" icon={<Plus size={18} />}>Create session</Button>} />
    <div className="filter-pills">{["All", "Draft", "Upcoming", "Completed"].map((item) => <button key={item} className={`filter-pill ${filter === item ? "selected" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {loading && !data ? <LoadingState label="Loading sessions…" /> : error ? <ErrorState message={error} retry={refresh} /> : sessions.length === 0 ? <Card><EmptyState title={filter === "All" ? "Your first session starts here" : `No ${filter.toLowerCase()} sessions`} description="Create a class or workshop, then add an activity when you’re ready." action={<Button to="/sessions/new">Create session</Button>} /></Card> : <div className="sessions-grid">{sessions.map((session, index) => <Link to={`/sessions/${session.id}`} className="session-card" key={session.id}><div className={`session-art session-art-${index % 4}`}><span className="date-stamp">{session.starts_at ? new Date(session.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "DRAFT"}</span><Mascot kind={index % 2 ? "flower" : "sun"} /></div><div className="session-card-body"><div className="session-card-title"><h3>{session.name}</h3><ChevronRight /></div><p>{session.description || "No description yet."}</p><div className="session-card-meta"><span><CalendarDays size={15} />{session.starts_at ? new Date(session.starts_at).toLocaleDateString() : "Not scheduled"}</span><span><Users size={15} />{session.expected_participants ?? 0} expected</span></div><div className="session-card-footer"><ActivityBadge state={session.status} /><span>{session.activity_count ?? 0} activities</span></div></div></Link>)}</div>}
  </div>;
}

export function CreateSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", description: "", startsAt: "", location: "", expectedParticipants: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [loadError, setLoadError] = useState("");
  const [loadTick, setLoadTick] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    api<{ session: Session }>(`/owner/sessions/${sessionId}`).then(({ session }) => {
      if (!alive) return;
      const startsAt = session.starts_at ? new Date(session.starts_at) : null;
      const localStartsAt = startsAt ? new Date(startsAt.getTime() - startsAt.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
      setForm({ name: session.name, description: session.description, startsAt: localStartsAt, location: session.location ?? "", expectedParticipants: String(session.expected_participants ?? 0) });
    }).catch((reason) => { if (alive) setLoadError(reason instanceof Error ? reason.message : "Could not load this session."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId, loadTick]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const body = { ...form, startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null, expectedParticipants: Number(form.expectedParticipants) || 0 };
      const data = sessionId
        ? await api<{ session: Session }>(`/owner/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(body) })
        : await post<{ session: Session }>("/owner/sessions", body);
      navigate(`/sessions/${data.session.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : sessionId ? "Could not save session changes." : "Could not create session."); }
    finally { setPending(false); }
  }
  if (loading) return <LoadingState label="Loading session details…" />;
  if (loadError) return <ErrorState message={loadError} retry={() => { setLoadError(""); setLoading(true); setLoadTick((value) => value + 1); }} />;
  const title = sessionId ? "Edit session" : "Create a session";
  return <div className="page-stack"><div className="breadcrumb"><Link to="/sessions">My Sessions</Link><ChevronRight size={15} /><span>{title}</span></div><PageIntro title={title} description={sessionId ? "Update the workshop details and expected group size." : "Make a home for your workshop. Add activities whenever you’re ready."} />
    <form className="form-layout" onSubmit={submit}><Card className="form-card"><div className="form-section-heading"><span>01 / THE ESSENTIALS</span><small>Tell us about your class.</small></div><label className="field-label" htmlFor="session-name">Session name <b>*</b></label><input id="session-name" className="text-input" required maxLength={100} placeholder="e.g. Team Culture Workshop" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="field-label" htmlFor="session-description">Description <small>(optional)</small></label><textarea id="session-description" className="text-input text-area" maxLength={500} placeholder="What will participants explore together?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="field-grid"><div><label className="field-label" htmlFor="session-date">Date and time</label><input id="session-date" className="text-input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div><div><label className="field-label" htmlFor="session-location">Location <small>(optional)</small></label><input id="session-location" className="text-input" placeholder="Room or online" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div></div>
      <label className="field-label" htmlFor="session-expected">Expected participants</label><input id="session-expected" className="text-input input-short" type="number" min="0" max="1000" value={form.expectedParticipants} onChange={(e) => setForm({ ...form, expectedParticipants: e.target.value })} placeholder="24" />
      <div className="soft-note"><SparkleMark /> One session, many activities.<span>Participants can join without creating accounts.</span></div>
      {error && <div role="alert" className="inline-error">{error}</div>}
      <div className="form-actions"><Button variant="secondary" to={sessionId ? `/sessions/${sessionId}` : "/sessions"}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? (sessionId ? "Saving…" : "Creating…") : (sessionId ? "Save changes" : "Create session")}</Button></div>
    </Card><div className="form-aside"><Card className="session-preview"><div className="preview-art"><span>YOUR SESSION CARD</span><strong>{form.name || "A new session"}<b>!</b></strong><Mascot kind="sun" /></div><h3>Session details</h3><p>{form.location || "Location can be added later."}</p><span><Users size={15} /> {form.expectedParticipants || "0"} expected</span></Card><Card className="tip-card"><h3><Sparkles size={18} /> Keep it simple</h3><p>Start with one activity. You can add more tools and teams from your session page.</p></Card></div></form>
  </div>;
}

function SparkleMark() { return <span className="sparkle-mark">✦</span>; }

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const { data, loading, error, refresh } = useData<{ session: Session; activities: Activity[] }>(`/owner/sessions/${sessionId}`);
  if (loading && !data) return <LoadingState label="Opening session…" />;
  if (error) return <ErrorState message={error} retry={refresh} />;
  if (!data) return <EmptyState title="Session not found" description="This session may have been removed." action={<Button to="/sessions">Back to sessions</Button>} />;
  const { session, activities } = data;
  return <div className="page-stack"><div className="breadcrumb"><Link to="/sessions">My Sessions</Link><ChevronRight size={15} /><span>{session.name}</span></div><section className="session-detail-hero"><div><Badge tone="purple">SESSION</Badge><h1>{session.name}<span className="title-dot">.</span></h1><p>{session.description || "A workshop space for activities and conversation."}</p><div className="session-detail-meta"><span><CalendarDays size={17} />{session.starts_at ? new Date(session.starts_at).toLocaleString() : "Schedule not set"}</span><span><Users size={17} />{session.expected_participants ?? 0} expected</span><span><MapPinTiny />{session.location || "Location not set"}</span></div></div><div className="session-detail-aside"><MetricCard icon={<Users />} value={session.expected_participants ?? 0} label="Expected people" tone="aqua" /><MetricCard icon={<BarChart3 />} value={activities.length} label="Activities" tone="pink" /><Button variant="secondary" to={`/sessions/${session.id}/edit`}>Edit session</Button><Button to={`/activities/new?sessionId=${session.id}`}>Create activity</Button></div></section>
    <div className="section-heading"><div><span className="eyebrow">IN THIS SESSION</span><h2>Activities</h2></div><Button variant="secondary" to={`/activities/new?sessionId=${session.id}`} icon={<Plus size={17} />}>Add activity</Button></div>
    {activities.length === 0 ? <Card><EmptyState title="This session is ready for its first activity" description="Create a SCARF demo activity and participants will join it with a temporary code." action={<Button to={`/activities/new?sessionId=${session.id}`}>Add first activity</Button>} /></Card> : <div className="activity-list">{activities.map((activity, index) => <Link to={`/activities/${activity.id}/live`} className="activity-row" key={activity.id}><div className={`activity-icon activity-icon-${index % 3}`}><Mascot kind={index % 2 ? "flower" : "sun"} /></div><div className="activity-row-main"><strong>{activity.title}</strong><small>{activity.participant_count ?? 0} joined · {activity.submitted_count ?? 0} submitted</small></div><Badge tone="purple">SCARF demo</Badge><ActivityBadge state={activity.state} /><Button variant="quiet">Open <ArrowRight size={17} /></Button></Link>)}</div>}
  </div>;
}

function MapPinTiny() { return <span aria-hidden="true">⌖</span>; }

export function ActivitySetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialSession = params.get("sessionId") ?? "";
  const { data: sessionData, error: sessionError } = useData<{ sessions: Session[] }>("/owner/sessions");
  const [form, setForm] = useState({ title: "SCARF Demo Activity", sessionId: initialSession, resultPolicy: "trainer_reveal", requireName: true, allowTeams: true, teamCount: 4 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const teamNames = Array.from({ length: form.allowTeams ? form.teamCount : 0 }, (_, index) => `Team ${String.fromCharCode(65 + index)}`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const { activity } = await post<{ activity: { id: string } }>("/owner/activities", { title: form.title, sessionId: form.sessionId || null, resultPolicy: form.resultPolicy, requireName: form.requireName, allowTeams: form.allowTeams, teamNames });
      navigate(`/activities/${activity.id}/live`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save activity."); }
    finally { setPending(false); }
  }
  return <div className="page-stack"><div className="breadcrumb"><Link to="/tools">My Tools</Link><ChevronRight size={15} /><span>SCARF / Activity setup</span></div><PageIntro eyebrow="STEP 1 OF 2 · SET UP" title="Set up SCARF" description="Make this activity yours — decide how people join, respond and see results." action={<Badge tone="purple">Draft activity</Badge>} />
    <DemoNotice compact />
    {sessionError && <ErrorState message={sessionError} />}
    <div className="stepper" aria-label="Activity setup steps"><span className="step-active"><b>1</b>Basics</span><span><b>2</b>Participants</span><span><b>3</b>Results and review</span></div>
    <form className="setup-grid" onSubmit={submit}><div className="setup-main">
      <Card className="form-card"><div className="form-section-heading"><span>ACTIVITY DETAILS</span><Badge tone="orange">Specialized demo tool</Badge></div><div className="tool-mini-header"><span className="mini-tool-art"><Mascot kind="sun" /></span><span><strong>SCARF Explorer</strong><small>{SCARF_DIMENSIONS.join(" · ")}</small></span></div>
        <label className="field-label" htmlFor="activity-title">Activity title</label><input className="text-input" id="activity-title" required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <label className="field-label" htmlFor="activity-session">Run this activity in</label><select className="text-input" id="activity-session" value={form.sessionId} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}><option value="">Quick Activity · Standalone</option>{sessionData?.sessions.map((session) => <option value={session.id} key={session.id}>{session.name}</option>)}</select>
        <div className="two-field-row"><div><span className="field-label">Question set</span><div className="select-static"><strong>DEMO placeholders · v0</strong><Badge tone="orange">Not official</Badge></div></div><div><span className="field-label">Demo length</span><div className="select-static"><Clock3 size={17} /> About 3 minutes</div></div></div>
      </Card>
      <Card className="form-card"><div className="form-section-heading"><span>PARTICIPATION</span><small>Short-lived guest access, no account required.</small></div>
        <label className="switch-row"><span><strong>Ask for a display name</strong><small>Participants will see their own name after joining.</small></span><input type="checkbox" checked={form.requireName} onChange={(event) => setForm({ ...form, requireName: event.target.checked })} /><i /></label>
        <label className="switch-row"><span><strong>Enable team grouping</strong><small>Participants may choose a team. You can reassign them later.</small></span><input type="checkbox" checked={form.allowTeams} onChange={(event) => setForm({ ...form, allowTeams: event.target.checked })} /><i /></label>
        {form.allowTeams && <div className="team-config"><label className="field-label" htmlFor="team-count">Number of teams</label><select id="team-count" className="text-input team-count-select" value={form.teamCount} onChange={(event) => setForm({ ...form, teamCount: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}</select><div className="team-chip-list">{teamNames.map((name, index) => <span className="team-chip" key={name} style={{ background: `${TEAM_PALETTE[index]}66` }}><ColorDot color={TEAM_PALETTE[index]!} />{name}</span>)}</div></div>}
        <div className="access-method-row"><span className="method-pill"><Check size={14} /> QR code</span><span className="method-pill method-gold"><Check size={14} /> 6-digit PIN</span><span className="method-pill method-aqua"><Check size={14} /> Join link</span></div>
      </Card>
    </div><aside className="setup-aside"><section className="ready-card"><span>READY TO MAKE IT POP?</span><h2>One QR code.<br />A better conversation.</h2><Mascot kind="bean" /></section>
      <Card className="form-card"><h3>Results and presentation</h3><span className="field-label">When can participants see their personal result?</span><div className="radio-list">{[{ value: "trainer_reveal", label: "Trainer decides when to reveal", help: "Participants wait until you publish." }, { value: "immediate", label: "Immediately after submitting", help: "Only their own demo snapshot is returned." }, { value: "confirmation", label: "Thank-you screen only", help: "No personal result is shown to guests." }].map((item) => <label key={item.value} className={`radio-card ${form.resultPolicy === item.value ? "radio-selected" : ""}`}><input type="radio" name="result-policy" value={item.value} checked={form.resultPolicy === item.value} onChange={() => setForm({ ...form, resultPolicy: item.value })} /><span><strong>{item.label}</strong><small>{item.help}</small></span>{form.resultPolicy === item.value && <Badge tone="blue">Selected</Badge>}</label>)}</div><div className="privacy-callout"><LockKeyhole size={17} /><span>Presenter names are hidden by default. Each participant must also opt in before their name can appear.</span></div></Card>
      <Card className="info-card"><Sparkles size={18} /><p>Within-person pattern and team-relative comparison are different demo views. The presenter will show the basis and a small-group caution.</p></Card>
      {error && <div role="alert" className="inline-error">{error}</div>}{<div className="setup-submit"><Button variant="secondary" to={form.sessionId ? `/sessions/${form.sessionId}` : "/tools/scarf"}>Cancel</Button><Button type="submit" disabled={pending} className="setup-submit-button">{pending ? "Saving…" : "Save and continue"}</Button></div>}
    </aside></form>
  </div>;
}

export function ActivityLivePage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useData<OwnerActivity>(`/owner/activities/${activityId}`, 5000);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const activity = data?.activity;
  async function runAction(action: "open" | "pause" | "close") {
    setActionError("");
    try { await post(`/owner/activities/${activityId}/${action}`); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Action failed."); }
  }
  async function copyJoinLink() {
    if (!activity?.join_pin) return;
    const value = `${window.location.origin}/join?pin=${activity.join_pin}`;
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { setActionError("Clipboard access is unavailable. Copy the join code shown here instead."); }
  }
  if (loading && !data) return <LoadingState label="Opening the live room…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data || !activity) return <EmptyState title="Activity not found" description="The activity may have been removed." action={<Button to="/tools">Back to tools</Button>} />;
  const joined = Number(data.counts?.joined ?? 0);
  const completed = Number(data.counts?.submitted ?? 0);
  const percent = joined ? Math.round(completed / joined * 100) : 0;
  const qrUrl = activity.join_pin ? `${window.location.origin}/join?pin=${activity.join_pin}` : "";
  return <div className="page-stack"><div className="breadcrumb"><Link to={activity.session_id ? `/sessions/${activity.session_id}` : "/tools/scarf"}>{activity.session_name || "My Tools"}</Link><ChevronRight size={15} /><span>Live Activity</span></div>
    <section className="live-title-bar"><div><span className="live-kicker"><span className="live-pulse" />{activity.state === "open" ? "LIVE NOW" : activity.state.toUpperCase()} {activity.session_name ? `· ${activity.session_name}` : "· QUICK ACTIVITY"}</span><h1>{activity.title}<span>!</span></h1><p>SCARF demo · {data.teams.length} teams · {activity.result_policy === "trainer_reveal" ? "Trainer reveals results" : activity.result_policy === "immediate" ? "Personal results on submit" : "Thank-you only"}</p></div><div className="live-title-actions"><Button variant="yellow" onClick={() => void runAction(activity.state === "open" ? "pause" : "open")} icon={activity.state === "open" ? <Pause size={17} /> : <Play size={17} />}>{activity.state === "open" ? "Pause responses" : activity.state === "closed" ? "Reopen activity" : "Resume responses"}</Button><Button variant="secondary" to={`/activities/${activity.id}/presenter`}>Presenter controls</Button></div></section>
    {error && <div className="subtle-warning" role="status">Live refresh paused: {error}</div>}{actionError && <div className="inline-error" role="alert">{actionError}</div>}
    <div className="metric-grid live-metrics"><MetricCard icon={<Users />} value={joined} label="Participants joined" tone="aqua" /><MetricCard icon={<Check />} value={completed} label="Submitted" tone="yellow" /><MetricCard icon={<Clock3 />} value={Math.max(0, joined - completed)} label="In progress" tone="purple" /><MetricCard icon={<BarChart3 />} value={`${percent}%`} label="Completion rate" tone="pink" /></div>
    <div className="live-grid"><div className="live-left"><section className="join-card"><div className="join-card-heading"><span>POP IN!</span><span className="qr-decoration"><Mascot kind="spark" /></span></div>{activity.join_pin ? <><p>Scan this QR code or enter the code on your phone.</p><div className="qr-frame"><QRCodeSVG value={qrUrl} size={178} level="M" includeMargin /></div><span className="pin-label">OR ENTER THE PIN</span><strong className="pin-code">{activity.join_pin.slice(0, 3)} {activity.join_pin.slice(3)}</strong><span className="join-url">trainerpopp.app/join</span><Button variant="secondary" onClick={() => void copyJoinLink()} icon={<Copy size={16} />}>{copied ? "Copied" : "Copy join link"}</Button></> : <><p>Open the activity to generate a fresh join code and private participant link.</p><div className="qr-placeholder"><LockKeyhole size={36} /><span>Your room is not open yet</span></div><Button onClick={() => void runAction("open")}>Open activity</Button></>}</section><Card className="privacy-card"><LockKeyhole size={18} /><div><strong>Present when you’re ready</strong><p>Participants cannot see team results until you reveal them. Projector names stay hidden unless both you and each participant allow them.</p></div></Card></div>
      <div className="live-right"><Card className="progress-card"><div className="section-heading"><div><span className="eyebrow">RESPONSE PROGRESS</span><h2>{completed} of {joined} submitted</h2></div><Badge tone={percent === 100 && joined ? "green" : "purple"}>{percent}%</Badge></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="progress-caption"><span>Updated automatically every 5 seconds</span><span>{activity.state === "open" ? "Accepting responses" : activity.state === "paused" ? "Responses paused" : "Responses closed"}</span></div></Card>
        <Card className="participants-card"><div className="section-heading"><div><span className="eyebrow">WHO’S HERE?</span><h2>Participants <small>({joined})</small></h2></div><button className="refresh-button" onClick={refresh}>Refresh <Radio size={15} /></button></div>{joined === 0 ? <div className="empty-table"><Users size={25} /><strong>Waiting for the first person to join.</strong><span>Share the QR code or the six-digit PIN.</span></div> : <div className="table-scroll"><table className="participants-table"><thead><tr><th>Participant</th><th>Team</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{data.participants.map((person) => <tr key={person.id}><td><span className="participant-initial" style={{ background: TEAM_PALETTE[Math.abs(person.display_name.charCodeAt(0)) % TEAM_PALETTE.length] }}>{person.display_name.slice(0, 1).toUpperCase()}</span><span className="participant-name"><strong>{person.display_name}</strong>{person.role && <small>{person.role}</small>}</span></td><td>{activity.allow_teams ? <select aria-label={`Team for ${person.display_name}`} value={person.team_id ?? ""} onChange={async (event) => { try { await post(`/owner/activities/${activityId}/participants/${person.id}/team`, { teamId: event.target.value || null }); refresh(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update team."); } }}><option value="">Unassigned</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select> : "—"}</td><td><Badge tone={person.submission_status === "submitted" ? "green" : "yellow"}>{person.submission_status === "submitted" ? "Completed" : "In progress"}</Badge></td><td>{person.submitted_at ? new Date(person.submitted_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}</td></tr>)}</tbody></table></div>}
          <div className="participants-footer"><span>Private trainer view · responses are never sent to other guests</span><Link to={`/results/${activity.id}`}>Review results <ArrowRight size={15} /></Link></div></Card>
        <div className="live-bottom-actions"><Button variant="secondary" to={`/results/${activity.id}`}>Preview demo results</Button><Button variant="danger" onClick={() => void runAction("close")} disabled={activity.state === "closed" || activity.state === "archived"}>Close activity</Button></div>
      </div></div>
  </div>;
}

export function ArchivePage() {
  const [filter, setFilter] = useState("All activities");
  const [search, setSearch] = useState("");
  const { data, loading, error, refresh } = useData<{ activities: Activity[] }>("/owner/activities");
  const options = ["All activities", "Live", "Draft", "Closed"];
  const rows = (data?.activities ?? []).filter((activity) => {
    const categoryMatch = filter === "All activities" || (filter === "Live" ? ["open", "paused"].includes(activity.state) : filter === "Closed" ? ["closed", "archived"].includes(activity.state) : activity.state === "draft");
    return categoryMatch && activity.title.toLowerCase().includes(search.toLowerCase());
  });
  return <div className="page-stack"><PageIntro title="Look back. Learn more." description="Every Popp! moment, saved for the next great conversation." action={<Badge tone="blue">Private archive</Badge>} />
    <section className="archive-highlight"><div><span>YOUR ACTIVITY HISTORY</span><h2>Keep the learning going.</h2><p>Review demo activity runs and the conversations they supported.</p></div><div className="archive-art"><Mascot kind="flower" /></div><Link to="/tools/scarf" className="highlight-link">Explore SCARF demo <ArrowRight size={17} /></Link></section>
    {loading && !data ? <LoadingState label="Loading activity history…" /> : error ? <ErrorState message={error} retry={refresh} /> : <>
      <div className="metric-grid archive-metrics"><MetricCard icon={<Radio />} value={data?.activities.length ?? 0} label="Saved activities" tone="aqua" /><MetricCard icon={<CalendarDays />} value={new Set(data?.activities.map((activity) => activity.session_id).filter(Boolean)).size} label="Sessions used" tone="purple" /><MetricCard icon={<Check />} value={data?.activities.reduce((sum, activity) => sum + Number(activity.submitted_count ?? 0), 0) ?? 0} label="Demo submissions" tone="pink" /><MetricCard icon={<Flower />} value="1" label="Active tool" tone="yellow" /></div>
      <div className="section-heading archive-heading"><div><span className="eyebrow">YOUR HISTORY</span><h2>Activity runs</h2></div><label className="local-search"><input aria-label="Search archived activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find activity…" /><Search size={16} /></label></div>
      <div className="filter-pills">{options.map((item) => <button key={item} className={`filter-pill ${filter === item ? "selected" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
      {rows.length ? <div className="archive-list">{rows.map((activity, index) => <div className="archive-row" key={activity.id}><div className={`archive-icon archive-icon-${index % 4}`}><BarChart3 /></div><div className="archive-row-main"><strong>{activity.title}</strong><small>{activity.session_name ?? "Quick Activity"} · SCARF demo · {activity.instrument_version ?? "demo-items-v0"}</small></div><div className="archive-stat"><strong>{activity.participant_count ?? 0}</strong><small>participants</small></div><div className="archive-stat"><strong>{activity.submitted_count ?? 0}</strong><small>submitted</small></div><ActivityBadge state={activity.state} />{activity.submitted_count ? <Button variant="quiet" to={`/results/${activity.id}`}>View results</Button> : <Button variant="quiet" to={`/activities/${activity.id}/live`}>Open activity</Button>}</div>)}</div> : <Card><EmptyState title="Nothing to show yet" description="Closed activities and saved demo runs will appear here." action={<Button to="/activities/new">Create activity</Button>} /></Card>}
    </>}
  </div>;
}

function decodedScores(row: ScoreRow): ScarfScores | null {
  if (!row.scores_json) return null;
  try { return JSON.parse(row.scores_json) as ScarfScores; } catch { return null; }
}

function tierClass(tier: string): string {
  return tier === "lower quartile" ? "tier-low" : tier === "upper quartile" ? "tier-high" : "tier-mid";
}

export function ActivityResultPage() {
  const { activityId = "" } = useParams();
  const { data: resultData, loading, error, refresh } = useData<{ results: ScoreRow[]; warning: string; demoOnly: boolean }>(`/owner/activities/${activityId}/results`);
  const activity = useData<OwnerActivity>(`/owner/activities/${activityId}`);
  const [basis, setBasis] = useState<"within_person" | "team_relative">("team_relative");
  const [teamId, setTeamId] = useState("");
  const [filter, setFilter] = useState("Overview & heatmap");
  const [actionError, setActionError] = useState("");
  const teams = activity.data?.teams ?? [];
  const submitted = (resultData?.results ?? []).filter((row) => row.submission_status === "submitted" && decodedScores(row));
  const visibleRows = submitted.filter((row) => !teamId || row.team_id === teamId);
  const activeTeam = teams.find((team) => team.id === teamId)?.name ?? "All teams";
  async function setReveal(revealed: boolean) {
    setActionError("");
    try { await post(`/owner/activities/${activityId}/reveal`, { revealed, comparisonBasis: basis, selectedTeamId: teamId || null }); activity.refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update reveal state."); }
  }
  if (loading && !resultData) return <LoadingState label="Preparing the demo results…" />;
  if (error) return <ErrorState message={error} retry={refresh} />;
  const warning = smallGroupWarning(visibleRows.length);
  return <div className="page-stack"><div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ChevronRight size={15} /><span>SCARF Demo</span></div><div className="results-header"><div><span className="eyebrow">DEMO ANALYTICS · {activity.data?.activity.session_name ?? "QUICK ACTIVITY"}</span><h1>SCARF Team Results<span className="title-dot">.</span></h1><p>{activity.data?.activity.title ?? "SCARF demo activity"} · {activity.data?.activity.state ?? "unknown"} · {submitted.length} submissions</p></div><div className="results-actions"><Button variant="secondary" to={`/activities/${activityId}/presenter`}>Presenter controls</Button><Button variant="primary" onClick={() => void setReveal(!activity.data?.presentation?.revealed)}>{activity.data?.presentation?.revealed ? "Hide results" : "Reveal results"}</Button></div></div>
    <DemoNotice compact />
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}
    <div className="result-tabs" role="tablist" aria-label="Result views">{["Overview & heatmap", "Individual profiles", "Response notes"].map((item) => <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? "tab-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="metric-grid result-metrics"><MetricCard icon={<Users />} value={activity.data?.counts.joined ?? 0} label="Participants" tone="aqua" /><MetricCard icon={<Check />} value={submitted.length} label="Completed · demo" tone="yellow" /><MetricCard icon={<Flower />} value={teams.length} label="Teams" tone="purple" /><MetricCard icon={<BarChart3 />} value="05" label="SCARF dimensions" tone="pink" /></div>
    {filter === "Response notes" ? <Card className="result-note-card"><LockKeyhole /><h2>Private data and demo notes</h2><p>Individual response rows are visible only in the signed-in trainer workspace. Public presenter output is separate, anonymous by default, and only available after you reveal it.</p><p>All values come from placeholder demo prompts and the explicitly labelled <code>demo-likert-v0</code> mapping.</p></Card> : <div className="results-grid"><Card className="heatmap-card"><div className="section-heading"><div><span className="eyebrow">THE BIG PICTURE</span><h2>Team SCARF Heatmap</h2></div><div className="result-control-group"><div className="segmented-control"><button className={basis === "within_person" ? "active" : ""} onClick={() => setBasis("within_person")}>Within-person</button><button className={basis === "team_relative" ? "active" : ""} onClick={() => setBasis("team_relative")}>Relative to team</button></div><select aria-label="Filter by team" className="team-filter" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div></div>
      <p className="heatmap-context">{basis === "within_person" ? "Each person’s five demo values are compared within their own profile." : `Each dimension is compared within ${activeTeam}.`} Color labels describe relative position only. Values are demonstration data.</p>
      {warning && <div className="small-group-warning"><Lightbulb size={17} /><span>{warning} Ties are kept together; the tiers do not force a set number of people into each bucket.</span></div>}
      {visibleRows.length === 0 ? <div className="empty-table"><BarChart3 size={24} /><strong>No completed demo submissions yet.</strong><span>Start an activity and review results after a participant submits.</span></div> : <div className="table-scroll"><table className="heatmap-table"><thead><tr><th>PARTICIPANT</th>{SCARF_DIMENSIONS.map((dimension, i) => <th key={dimension}><span className="dimension-heading" style={{ background: `${SCARF_COLORS[i]}22` }}>{dimension[0]}</span>{dimension}</th>)}</tr></thead><tbody>{visibleRows.map((row) => { const scores = decodedScores(row)!; return <tr key={row.id}><th scope="row"><span className="participant-initial" style={{ background: TEAM_PALETTE[Math.abs(row.display_name.charCodeAt(0)) % TEAM_PALETTE.length] }}>{row.display_name[0]?.toUpperCase()}</span><span className="participant-name"><strong>{row.display_name}</strong><small>{row.team_name ?? "Unassigned"}</small></span></th>{SCARF_DIMENSIONS.map((dimension) => { const peers = basis === "within_person" ? SCARF_DIMENSIONS.map((item) => scores[item]) : visibleRows.map((peer) => decodedScores(peer)?.[dimension] ?? 0); const tier = relativeTier(scores[dimension], peers); return <td key={dimension}><span className={`heat-cell ${tierClass(tier)}`} title={`${tier} · demo value ${scores[dimension]}`}><strong>{scores[dimension].toFixed(1)}</strong><small>{tier.replace("quartile", "25%")}</small></span></td>; })}</tr>; })}</tbody></table></div>}
      <div className="heatmap-legend"><span><i className="tier-low" />Lower quartile</span><span><i className="tier-mid" />Middle range</span><span><i className="tier-high" />Upper quartile</span><small>Sample values · descriptive only</small></div>
    </Card><aside className="result-side"><Card className="dimension-summary"><div className="section-heading"><div><span className="eyebrow">GROUP SUMMARY</span><h2>Demo dimension means</h2></div><Badge tone="aqua">Mean / 5</Badge></div>{SCARF_DIMENSIONS.map((dimension, index) => { const scores = visibleRows.map((row) => decodedScores(row)?.[dimension] ?? 0); const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0; return <div className="dimension-mean" key={dimension}><span>{dimension}</span><div className="mean-track"><span style={{ width: `${mean / 5 * 100}%`, background: SCARF_COLORS[index] }} /></div><strong>{scores.length ? mean.toFixed(1) : "—"}</strong></div>; })}<p className="summary-caption">{visibleRows.length} completed demo profiles · not a validated measure</p></Card><Card className="facilitator-prompt"><span className="eyebrow">FACILITATOR PROMPT</span><h3>What do we notice?</h3><p>Explore differences with curiosity. A higher demo preference is not a better person; it offers another perspective for conversation.</p><Mascot kind="sun" /></Card><Card className="result-version"><h3>Content and scoring versions</h3><p>Instrument: <code>{activity.data?.activity.instrument_version ?? "demo-items-v0"}</code></p><p>Scoring: <code>{activity.data?.activity.scoring_version ?? "demo-likert-v0"}</code></p></Card></aside></div>}
  </div>;
}

export function PresenterConsolePage() {
  const { activityId = "" } = useParams();
  const activity = useData<OwnerActivity>(`/owner/activities/${activityId}`, 5000);
  const [basisOverride, setBasisOverride] = useState<"within_person" | "team_relative" | undefined>();
  const [teamOverride, setTeamOverride] = useState<string | undefined>();
  const [showNamesOverride, setShowNamesOverride] = useState<boolean | undefined>();
  const [presenterPath, setPresenterPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const item = activity.data;
  const basis = basisOverride ?? item?.presentation.comparison_basis ?? "within_person";
  const teamId = teamOverride === undefined ? (item?.presentation.selected_team_id ?? "") : teamOverride;
  const showNames = showNamesOverride ?? Boolean(item?.presentation.show_names);
  async function update(revealed: boolean) {
    setBusy(true); setError("");
    try { await post(`/owner/activities/${activityId}/reveal`, { revealed, comparisonBasis: basis, selectedTeamId: teamId || null, showNames }); activity.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update presentation state."); }
    finally { setBusy(false); }
  }
  async function launch() {
    const popup = window.open("about:blank", "_blank");
    setBusy(true); setError("");
    try {
      await post(`/owner/activities/${activityId}/reveal`, { revealed: Boolean(item?.presentation.revealed), comparisonBasis: basis, selectedTeamId: teamId || null, showNames });
      const { path } = await post<{ path: string }>(`/owner/activities/${activityId}/presenter-token`);
      setPresenterPath(path);
      if (popup) { popup.opener = null; popup.location.href = path; }
      else setError("Your browser blocked the new tab. Use the presenter link below.");
      activity.refresh();
    } catch (reason) { popup?.close(); setError(reason instanceof Error ? reason.message : "Could not open presenter."); }
    finally { setBusy(false); }
  }
  if (activity.loading && !item) return <LoadingState label="Opening presenter controls…" />;
  if (activity.error && !item) return <ErrorState message={activity.error} retry={activity.refresh} />;
  if (!item) return <EmptyState title="Activity not found" description="The activity may have been removed." action={<Button to="/live">Back to live activity</Button>} />;
  const submitted = Number(item.counts?.submitted ?? 0);
  return <div className="page-stack"><div className="breadcrumb"><Link to={`/activities/${activityId}/live`}>Live Activity</Link><ChevronRight size={15} /><span>Presenter controls</span></div><PageIntro eyebrow="OWNER CONTROL ROOM" title="Presenter Mode" description="Choose the view, decide when to reveal, and keep the room projection-safe." action={<Badge tone={item.presentation.revealed ? "green" : "purple"}>{item.presentation.revealed ? "Results revealed" : "Results hidden"}</Badge>} />
    <DemoNotice compact /><div className="presenter-control-grid"><Card className="presenter-controls"><div className="section-heading"><div><span className="eyebrow">PRESENTATION CONTROLS</span><h2>{item.activity.title}</h2></div><Radio /></div>
      <label className="field-label" htmlFor="presenter-team">Comparison group</label><select id="presenter-team" className="text-input" value={teamId} onChange={(event) => setTeamOverride(event.target.value)}><option value="">All teams</option>{item.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
      <span className="field-label">Compare scores</span><div className="segmented-control segmented-wide"><button className={basis === "within_person" ? "active" : ""} onClick={() => setBasisOverride("within_person")}>Within-person pattern</button><button className={basis === "team_relative" ? "active" : ""} onClick={() => setBasisOverride("team_relative")}>Relative to team</button></div>
      <label className="switch-row switch-row-muted"><span><strong>Show names where opted in</strong><small>People who did not opt in stay anonymous.</small></span><input type="checkbox" checked={showNames} onChange={(event) => setShowNamesOverride(event.target.checked)} /><i /></label>
      <div className="presenter-action-row"><Button variant={item.presentation.revealed ? "secondary" : "primary"} onClick={() => void update(!item.presentation.revealed)} disabled={busy}>{busy ? "Saving…" : item.presentation.revealed ? "Hide results" : "Reveal results"}</Button><Button variant="yellow" onClick={() => void launch()} disabled={busy} icon={<ArrowRight size={17} />}>Open presenter screen</Button></div>
      {error && <div role="alert" className="inline-error">{error}</div>}{presenterPath && <div className="presenter-share"><span>Private presenter link</span><code>{window.location.origin}{presenterPath}</code><a href={presenterPath} target="_blank" rel="noreferrer">Open this screen <ArrowRight size={15} /></a></div>}
      <p className="presenter-small-note">Trainer controls stay on this screen. The separate presenter link is read-only and contains no owner access.</p>
    </Card><Card className="presenter-summary"><div className="presenter-summary-blue"><Badge tone="aqua">{item.presentation.revealed ? "PRESENTING" : "PRIVATE PREVIEW"}</Badge><h2>{item.presentation.revealed ? "Your patterns are ready." : "A quiet screen, until you’re ready."}</h2><p>{submitted} submitted · {item.teams.length} teams · {item.activity.state}</p><Mascot kind="bean" /></div><div className="presenter-summary-content"><h3>Audience view checklist</h3><ul><li><Check size={17} /> Five correct SCARF dimensions</li><li><Check size={17} /> Comparison basis and team shown</li><li><Check size={17} /> Names anonymous by default</li><li><Check size={17} /> Small-group warning included</li></ul><div className="presenter-warning"><LockKeyhole size={17} /><span>DEMO scores only. They are not a diagnosis, competence rating or norm.</span></div><Button variant="secondary" to={`/results/${activityId}`}>Open trainer analytics</Button></div></Card></div>
  </div>;
}

type PresenterData = { revealed: boolean; title: string; state?: string; activity?: { title: string; state: string }; presentation?: { comparisonBasis: string; teamName: string; showNames: boolean }; rows?: Array<{ label: string; scores: ScarfScores; tiers: Record<ScarfDimension, string> }>; dimensions?: Array<{ name: ScarfDimension; mean: number }>; participantCount?: number; warning?: string | null; demoOnly?: boolean; interpretation?: string };

export function PublicPresenterPage() {
  const location = useLocation();
  const token = location.hash.slice(1);
  const { data, loading, error, refresh } = useData<PresenterData>("/presenter", 5000, token);
  async function fullScreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => undefined);
  }
  if (loading && !data) return <div className="public-presenter"><LoadingState label="Connecting to the presenter screen…" /></div>;
  if (error && !data) return <div className="public-presenter"><ErrorState message={error} retry={refresh} /></div>;
  if (!data || !data.revealed) return <div className="public-presenter public-presenter-wait"><div className="public-presenter-top"><BrandMark /><Badge tone="aqua">PRESENTER READY</Badge></div><div className="presenter-wait-card"><span className="eyebrow">FACILITATOR CONTROLLED</span><h1>We’ll begin<br />when you’re ready<span className="title-dot">.</span></h1><p>The trainer is preparing the view. No participant responses are shown while the results are hidden.</p><div className="wait-orbit"><Mascot kind="flower" /></div><span className="polling-label"><span className="live-pulse" /> Checking for an update</span></div><span className="presenter-demo-stamp">TRAINERPOPP!KIT · PRIVATE PRESENTER</span></div>;
  const dataRows = data.rows ?? [];
  const dimensions = data.dimensions ?? [];
  return <main className="public-presenter"><header className="public-presenter-top"><div><BrandMark /><small>{data.activity?.title ?? data.title} · {data.presentation?.teamName ?? "All teams"}</small></div><div className="public-presenter-status"><Badge tone="aqua">PRESENTER LIVE</Badge><span>{data.participantCount ?? 0} submitted</span><button className="fullscreen-button" onClick={() => void fullScreen()}>Fullscreen <ArrowRight size={15} /></button></div></header>
    <div className="presenter-live-grid"><section className="presenter-main-view"><span className="presenter-overline">LET’S TALK ABOUT OUR DIFFERENCES</span><h1>Same team.<br /><em>Different needs.</em></h1><p className="presenter-subhead">{data.activity?.title} · {data.presentation?.comparisonBasis === "within_person" ? "Within-person pattern" : "Relative to team"} · {dataRows.length} profiles shown</p><div className="presenter-dimension-headings"><span>PARTICIPANTS</span>{SCARF_DIMENSIONS.map((dimension, index) => <span key={dimension}><i style={{ background: SCARF_COLORS[index] }} />{dimension}</span>)}</div>
      {dataRows.length ? <div className="presenter-heatmap">{dataRows.map((row, rowIndex) => <div className="presenter-row" key={`${row.label}-${rowIndex}`}><strong>{row.label}</strong>{SCARF_DIMENSIONS.map((dimension) => { const tier = row.tiers[dimension]; return <span className={`presenter-cell ${tierClass(tier)}`} key={dimension}><strong>{row.scores[dimension]?.toFixed(1) ?? "—"}</strong><small>{tier}</small></span>; })}</div>)}</div> : <div className="empty-table"><Users size={25} /><strong>No submitted profiles yet.</strong><span>Come back when participants have finished.</span></div>}
      <div className="heatmap-legend"><span><i className="tier-low" />Lower quartile</span><span><i className="tier-mid" />Middle range</span><span><i className="tier-high" />Upper quartile</span></div>
      <div className="presenter-demo-footer">DEMO DATA · {data.interpretation}</div>
    </section><aside className="presenter-insight-column"><section className="presenter-insight-card insight-blue"><span className="eyebrow">DISCUSSION STARTER ✦</span><h2>What stands out?</h2><p>What might each person need to feel supported by the team?</p><Mascot kind="flower" /></section><section className="presenter-insight-card insight-yellow"><span className="eyebrow">IMPORTANT TO REMEMBER</span><h2>High ≠ good.<br />Low ≠ bad.</h2><p>Colors show relative demo patterns — not performance, competence or value.</p><Mascot kind="sun" /></section><section className="presenter-dimension-summary"><span className="eyebrow">TEAM DEMO AVERAGES</span>{dimensions.map((dimension, index) => <div className="dimension-mean" key={dimension.name}><span>{dimension.name}</span><div className="mean-track"><span style={{ width: `${dimension.mean / 5 * 100}%`, background: SCARF_COLORS[index] }} /></div><strong>{dimension.mean.toFixed(1)}</strong></div>)}{data.warning && <p className="small-group-warning">{data.warning}</p>}</section></aside></div>
  </main>;
}

type JoinLookup = { activity: { id: string; title: string; sessionName?: string | null; requireName: boolean; demoOnly: boolean }; teams: Team[] };

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [entryMode, setEntryMode] = useState<"code" | "link">("code");
  const [pin, setPin] = useState((params.get("pin") ?? "").replace(/\D/g, "").slice(0, 6));
  const [trainerLink, setTrainerLink] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    let joinPin = pin;
    if (entryMode === "link") {
      try {
        const link = new URL(trainerLink.trim(), window.location.origin);
        const pathPin = link.pathname.match(/\/join\/(\d{6})(?:\/info)?\/?$/)?.[1];
        joinPin = link.searchParams.get("pin") ?? pathPin ?? "";
      } catch { joinPin = ""; }
      if (!/^\d{6}$/.test(joinPin)) {
        setError("Paste a trainer link that includes a six-digit activity code.");
        setPending(false);
        return;
      }
    }
    try {
      await post<JoinLookup>("/join/lookup", { pin: joinPin });
      sessionStorage.setItem("popp-join-pin", joinPin);
      navigate(`/join/${joinPin}/info`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That activity could not be found."); }
    finally { setPending(false); }
  }
  return <main className="participant-page join-page"><div className="participant-brand"><BrandMark /></div><section className="join-hero"><span className="eyebrow">NO ACCOUNT NEEDED</span><h1>Join an<br />activity<span className="title-dot">.</span></h1><p>Enter the six-digit code from your trainer, or open the QR link they shared with you.</p><div className="join-mascot"><Mascot kind="flower" /><span className="join-spark">✦</span></div></section><form className="join-code-card" onSubmit={find}><div className="join-mode-tabs"><button type="button" className={entryMode === "code" ? "join-mode-active" : ""} onClick={() => { setEntryMode("code"); setError(""); }}><KeypadIcon />Enter code</button><button type="button" className={entryMode === "link" ? "join-mode-active" : ""} onClick={() => { setEntryMode("link"); setError(""); }}><Link2 size={19} />Open trainer link</button></div>{entryMode === "code" ? <><label className="field-label" htmlFor="join-pin">Activity code</label><input id="join-pin" className="pin-input" aria-label="Six-digit activity code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} placeholder="000 000" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></> : <><label className="field-label" htmlFor="trainer-link">Trainer link</label><input id="trainer-link" className="text-input participant-input" type="url" inputMode="url" placeholder="https://…/join?pin=123456" value={trainerLink} onChange={(event) => setTrainerLink(event.target.value)} required /><span className="join-help">Paste the link shared by your trainer. We’ll check its activity code.</span></>}{error && <div className="inline-error" role="alert">{error}</div>}<Button type="submit" disabled={pending || (entryMode === "code" ? pin.length !== 6 : !trainerLink.trim())} className="full-width">{pending ? "Checking code…" : entryMode === "code" ? "Join activity" : "Continue with link"}</Button>{entryMode === "code" && <span className="join-help">Ask your trainer if you need the code.</span>}</form><div className="participant-bottom-note"><LockKeyhole size={16} /> Temporary guest access · No sign-up or app download</div></main>;
}

function KeypadIcon() { return <span className="keypad-icon" aria-hidden="true">▦</span>; }

export function ParticipantInfoPage() {
  const { pin = "" } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<JoinLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [teamId, setTeamId] = useState("");
  const [consentNamed, setConsentNamed] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    post<JoinLookup>("/join/lookup", { pin }).then((value) => { if (alive) { setLookup(value); setError(""); } }).catch((reason) => { if (alive) setError(reason.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pin]);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const result = await post<{ token: string; participant: { id: string; activityId: string } }>("/join/enter", { pin, displayName: name, role, teamId: teamId || null, consentNamedResults: consentNamed });
      sessionStorage.setItem(`popp-guest:${result.participant.activityId}`, result.token);
      navigate(`/participate/${result.participant.activityId}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join this activity."); }
    finally { setPending(false); }
  }
  if (loading) return <main className="participant-page"><BrandMark /><LoadingState label="Checking your activity code…" /></main>;
  if (!lookup) return <main className="participant-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error || "This activity is not available."} /><Button variant="secondary" to="/join">Try another code</Button></div></main>;
  return <main className="participant-page participant-info-page"><div className="participant-brand"><BrandMark /></div><Link to={`/join?pin=${pin}`} className="back-circle" aria-label="Back to code"><ArrowLeftIcon /></Link><div className="participant-progress"><div className="step-dots"><i /><i className="active" /><i /><i /></div><span>STEP 2 OF 4</span></div><section className="participant-info-heading"><span className="eyebrow">{lookup.activity.sessionName ?? "SCARF DEMO"}</span><h1>Tell us a bit<br />about you<span className="title-dot">.</span></h1><p>This helps your trainer support the group. No account is created.</p><div className="info-mascot"><Mascot kind="bean" /></div></section><form className="participant-info-form" onSubmit={join}><label className="field-label" htmlFor="guest-name">Your name {lookup.activity.requireName && <b>*</b>}</label><input id="guest-name" className="text-input participant-input" autoComplete="name" maxLength={60} placeholder={lookup.activity.requireName ? "Enter your name" : "Optional"} value={name} onChange={(event) => setName(event.target.value)} required={lookup.activity.requireName} />
    <label className="field-label" htmlFor="guest-role">Your role <small>(optional)</small></label><input id="guest-role" className="text-input participant-input" maxLength={60} placeholder="e.g. Team member, Manager, Designer" value={role} onChange={(event) => setRole(event.target.value)} />
    {lookup.teams.length > 0 && <><span className="field-label">Choose your team <small>(optional)</small></span><div className="participant-team-grid">{lookup.teams.map((team, index) => <button type="button" key={team.id} className={`participant-team-card ${teamId === team.id ? "team-selected" : ""}`} style={{ "--team-bg": `${TEAM_PALETTE[index % TEAM_PALETTE.length]}66` } as CSSProperties} onClick={() => setTeamId(teamId === team.id ? "" : team.id)}><span className="team-radio">{teamId === team.id && <i />}</span><strong>{team.name}</strong><Mascot kind={index % 2 ? "flower" : "bean"} /></button>)}</div></>}
    <label className="consent-card"><input type="checkbox" checked={consentNamed} onChange={(event) => setConsentNamed(event.target.checked)} /><span className="consent-check"><Check size={16} /></span><span><strong>Allow my name on the presenter screen</strong><small>Optional. Names remain hidden unless you opt in and your trainer chooses to show them.</small></span></label>
    <div className="private-note"><LockKeyhole size={17} /><span>Your activity responses stay private to you and the trainer. Other guests cannot see them.</span></div>
    {error && <div className="inline-error" role="alert">{error}</div>}<Button type="submit" disabled={pending || (!name.trim() && lookup.activity.requireName)} className="full-width participant-continue">{pending ? "Joining…" : "Continue"}</Button></form><div className="participant-bottom-note"><LockKeyhole size={16} /> No account needed · Temporary activity access</div></main>;
}

function ArrowLeftIcon() { return <span aria-hidden="true">←</span>; }

type GuestActivityData = { activity: { id: string; title: string; state: string; resultPolicy: "trainer_reveal" | "immediate" | "confirmation" }; participant: { displayName: string }; items: typeof DEMO_ITEMS; answers: Record<string, number>; disclosure: string };

export function ParticipantRunnerPage() {
  const { activityId = "" } = useParams();
  const navigate = useNavigate();
  const token = sessionStorage.getItem(`popp-guest:${activityId}`);
  const [data, setData] = useState<GuestActivityData | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api<GuestActivityData>("/guest/activity", { headers: { Authorization: `Bearer ${token}` } }).then((value) => {
      if (!alive) return;
      setData(value); setAnswers(Object.fromEntries(Object.entries(value.answers).map(([key, val]) => [Number(key), val])));
      if (value.activity.state === "closed") setError("This activity is closed. Ask your trainer if you need help.");
    }).catch((reason) => { if (alive) setError(reason.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activityId, token]);
  async function saveDraftRequest(nextAnswers = answers) {
    if (!token) throw new Error("Your temporary participant link has expired.");
    const result = await fetch("/api/guest/draft", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ answers: nextAnswers }) });
    const body = await result.json() as { error?: string };
    if (!result.ok) throw new Error(body.error ?? "Could not save your answers.");
  }
  async function move(nextStep: number) {
    if (!answers[step + 1]) { setError("Choose one response to continue."); return; }
    setBusy(true); setError(""); setSaved(false);
    try { await saveDraftRequest(); setStep(nextStep); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your answer."); }
    finally { setBusy(false); }
  }
  async function saveForLater() {
    setBusy(true); setError(""); setSaved(false);
    try { await saveDraftRequest(); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your answers."); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!token || !data) return;
    if (DEMO_ITEMS.some((item) => !answers[item.id])) { setError("Answer all five demo prompts before submitting."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/guest/submit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ answers }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not submit your answers.");
      navigate(`/participate/${activityId}/done`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit. Your draft remains saved on this device."); }
    finally { setBusy(false); }
  }
  if (!token) return <main className="participant-page runner-page"><BrandMark /><div className="participant-error-card"><ErrorState message="Your temporary participant link is missing. Join again with the activity code." /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (loading) return <main className="participant-page runner-page"><BrandMark /><LoadingState label="Opening your activity…" /></main>;
  if (!data) return <main className="participant-page runner-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error} /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (error && data.activity.state === "closed") return <main className="participant-page runner-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error} /><p>Your saved answers remain attached to your activity link.</p></div></main>;
  const item = DEMO_ITEMS[step]!;
  const total = DEMO_ITEMS.length;
  return <main className="participant-page runner-page"><header className="runner-top"><BrandMark /><span>SCARF DEMO · {data.participant.displayName}</span><span className="runner-step">{step + 1} of {total}</span></header><div className="runner-progress"><span style={{ width: `${(step + 1) / total * 100}%` }} /></div><div className="runner-content"><DemoNotice compact /><div className="runner-question-meta"><Badge tone="yellow">{item.dimension}</Badge><span>DEMO PROMPT {step + 1} / {total}</span></div><h1>{item.prompt}</h1><p className="runner-explainer">Choose the response that feels closest to you. This placeholder item is for interface demonstration only.</p><div className="likert-options" role="radiogroup" aria-label={`Response for ${item.dimension}`}>
    {[{ value: 1, label: "Strongly disagree" }, { value: 2, label: "Disagree" }, { value: 3, label: "Neither agree nor disagree" }, { value: 4, label: "Agree" }, { value: 5, label: "Strongly agree" }].map((choice) => <button type="button" key={choice.value} role="radio" aria-checked={answers[item.id] === choice.value} className={`likert-option ${answers[item.id] === choice.value ? "likert-selected" : ""}`} onClick={() => { setAnswers({ ...answers, [item.id]: choice.value }); setError(""); setSaved(false); }}><FaceIcon level={choice.value} /><span>{choice.label}</span></button>)}
    </div>{error && <div className="inline-error" role="alert">{error}</div>}{saved && <div className="saved-status" role="status"><Check size={16} /> Saved. You can return to this activity on this device.</div>}
    <div className="runner-actions"><Button variant="secondary" disabled={busy || step === 0} onClick={() => { setStep((value) => value - 1); setError(""); }}>Back</Button>{step < total - 1 ? <Button onClick={() => void move(step + 1)} disabled={busy || !answers[item.id]}>{busy ? "Saving…" : "Next"}</Button> : <Button onClick={() => void submit()} disabled={busy || !answers[item.id]}>{busy ? "Submitting…" : "Submit demo answers"}</Button>}</div><button className="save-later-button" onClick={() => void saveForLater()} disabled={busy}><LockKeyhole size={16} />Save and continue later</button>
    <p className="runner-version">Instrument: demo-items-v0 · Score mapping: demo-likert-v0</p></div></main>;
}

function ActivityResultMini({ scores }: { scores: ScarfScores }) {
  return <div className="personal-result-bars">{SCARF_DIMENSIONS.map((dimension, index) => <div className="personal-score" key={dimension}><strong>{scores[dimension].toFixed(1)}</strong><span className="personal-bar" style={{ "--bar-value": `${scores[dimension] / 5 * 100}%`, "--dimension": SCARF_COLORS[index] } as CSSProperties} /><small>{dimension}</small></div>)}</div>;
}

function FaceIcon({ level }: { level: number }) {
  const mouth = ["M31 68 Q50 47 69 68", "M33 65 Q50 55 67 65", "M34 63 H66", "M33 62 Q50 74 67 62", "M31 60 Q50 83 69 60"][level - 1];
  return <svg aria-hidden="true" viewBox="0 0 100 100" className={`likert-face likert-face-${level}`}><circle cx="50" cy="50" r="48" fill="currentColor"/><circle cx="37" cy="43" r="5" fill="#1f1f1f"/><circle cx="63" cy="43" r="5" fill="#1f1f1f"/><path d={mouth} fill="none" stroke="#1f1f1f" strokeWidth="5" strokeLinecap="round" /></svg>;
}

export function ParticipantDonePage() {
  const { activityId = "" } = useParams();
  const token = sessionStorage.getItem(`popp-guest:${activityId}`);
  const [me, setMe] = useState<{ participant: { displayName: string }; activity: { title: string; resultPolicy: string } } | null>(null);
  const [result, setResult] = useState<{ visible: boolean; reason?: string; scores?: ScarfScores; demoOnly?: boolean } | null>(null);
  const [error, setError] = useState(token ? "" : "Your participant link is no longer available. Ask your trainer for the activity code.");
  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function load() {
      try {
        const [profile, personal] = await Promise.all([
          api<{ participant: { displayName: string }; activity: { title: string; resultPolicy: string } }>("/guest/me", { headers: { Authorization: `Bearer ${token}` } }),
          api<{ visible: boolean; reason?: string; scores?: ScarfScores; demoOnly?: boolean }>("/guest/results", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (alive) { setMe(profile); setResult(personal); setError(""); }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not load your result."); }
    }
    void load(); const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activityId, token]);
  const policy = me?.activity.resultPolicy;
  return <main className="participant-page done-page"><div className="participant-brand"><BrandMark /></div><div className="done-mascot"><Mascot kind="sun" /></div><span className="eyebrow">{me?.activity.title ?? "ACTIVITY COMPLETE"}</span><h1>All done<span className="title-dot">!</span></h1><p className="done-thanks">Your demo responses have been recorded.</p>{error && <div className="inline-error" role="alert">{error}</div>}
    <section className="done-result-status">{policy === "confirmation" ? <><span className="eyebrow">RESULTS STATUS</span><h2>Thanks for taking part.</h2><p>Your trainer has chosen to show a confirmation only. Your answers remain private.</p></> : result?.visible && result.scores ? <><span className="eyebrow">YOUR PERSONAL DEMO SNAPSHOT</span><h2>Here’s your demo pattern.</h2><p>This is based on placeholder content and demo-only scoring. It does not measure ability or value.</p><ActivityResultMini scores={result.scores} /></> : <><span className="eyebrow">RESULTS STATUS</span><h2>Your trainer will reveal the results when it’s time.</h2><p>In the meantime, you can leave this screen and return to the waiting room.</p><div className="waiting-orbit"><Mascot kind="flower" /></div><span className="polling-label"><span className="live-pulse" /> Waiting for the trainer’s reveal</span></>}</section>
    {policy !== "confirmation" && result?.visible && <div className="personal-snapshot-note"><LockKeyhole size={17} /><span>Only your personal result is shown here. Other people’s responses are not visible.</span></div>}
    <DemoNotice compact /><div className="participant-bottom-note"><LockKeyhole size={16} /> No account · Temporary access for this activity</div></main>;
}
