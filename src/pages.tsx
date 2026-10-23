import { lazy, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, Clock3, Copy, Flower, Heart, Lightbulb, Link2, LockKeyhole, Pause, Play, Plus, Radio, Search, Sparkles, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, BrandMark, Button, Card, ColorDot, DemoNotice, EmptyState, ErrorState, LoadingState, Mascot, MetricCard, PageIntro } from "./components";
import { DEMO_ITEMS, relativeTier, SCARF_COLORS, SCARF_DIMENSIONS, smallGroupWarning, type ScarfDimension } from "./domain/scarf";
import { SCARF_DOMAIN_CODES, SCARF_DOMAIN_NAMES, type ScarfDomainCode, type ScarfDomainScores } from "./domain/scarf-assessment";
import { SCARF_INSIGHTS } from "./domain/scarf-insights";
import { ScarfParticipantDone, ScarfParticipantRunner } from "./scarf-participant";
import { WordCloudParticipantRunner } from "./wordcloud-pages";
const LearningBehaviorsParticipantPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsParticipantPage })));

type Session = { id: string; name: string; description: string; starts_at?: string | null; location?: string; expected_participants?: number; status: string; activity_count?: number; participant_count?: number; updated_at?: string };
type Team = { id: string; name: string };
type SessionTeamSummary = Team & { activity_id: string; activity_title: string; participant_count: number };
type Activity = { id: string; session_id: string | null; title: string; tool_id?: string; state: string; result_policy: "trainer_reveal" | "immediate" | "confirmation"; require_name: number; allow_teams: number; join_pin: string | null; session_name?: string; participant_count?: number; submitted_count?: number; instrument_version?: string; scoring_version?: string; updated_at?: string };
type OwnerActivity = { activity: Activity; config?: { releaseMode: "immediate" | "trainer_released"; resultsReleasedAt: string | null; experimental: boolean }; teams: Team[]; participants: Participant[]; counts: { joined: number; submitted: number | null; inProgress?: number; savedDrafts?: number }; presentation: { revealed: number; comparison_basis: "within_person" | "team_relative"; selected_team_id: string | null; show_names: number; scarf_layer?: "reaction" | "priority" } };
type Participant = { id: string; display_name: string; role?: string; team_id: string | null; team_name?: string | null; consent_named_results: number; submission_status?: string | null; submitted_at?: string | null; answered_count?: number; current_question?: number; generation?: number };
type ScoreRow = { id: string; display_name: string; team_id: string | null; team_name?: string | null; consent_named_results: number; submission_status?: string; scores_json: string | null; instrument_version?: string; scoring_version?: string };
type ScarfScores = Record<ScarfDimension, number>;

const TEAM_PALETTE = ["#aee6ed", "#ff6bcb", "#dbb8ff", "#f2bb05", "#ff8b5f", "#a3e7c7"];

function getStoredIds(key: string) {
  try {
    const stored = window.localStorage.getItem(key);
    const value: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

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

function activityRoute(activity: Pick<Activity, "id" | "tool_id" | "state">) {
  if (activity.tool_id === "poll") return `/polls/${activity.id}`;
  if (activity.tool_id === "wordcloud") return `/wordclouds/${activity.id}`;
  if (activity.tool_id === "reflection-wall") return `/reflection-walls/${activity.id}`;
  if (activity.tool_id === "learning-behaviors-reflection") return `/learning-behaviors/${activity.id}`;
  return activity.state === "closed" || activity.state === "archived" ? `/results/${activity.id}` : `/activities/${activity.id}/live`;
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
    <PageIntro title="Home" description="Good morning, Trainer! ☀️" />
    {error && <ErrorState message={error} retry={() => { sessions.refresh(); activities.refresh(); }} />}
    <section className="home-hero">
      <div className="home-hero-headline"><h2>Make<br />moments<br /><em>pop.</em></h2></div>
      <div className="home-hero-copy"><p>Plan and run engaging training sessions with tools that spark people, not just presentations.</p><Button variant="secondary" to="/tools">Explore tools <ArrowRight size={16} /></Button></div>
      <div className="home-hero-art"><div className="hero-blob hero-blob-yellow"><Mascot kind="sun" /></div><div className="hero-blob hero-blob-orange"><Mascot kind="flower" /></div><div className="hero-blob hero-blob-blue" /><div className="hero-spark">✦</div></div>
      <span className="hero-caption">Popp! makes space for better conversations.</span>
    </section>
    <div className="metric-grid">
      <MetricCard icon={<Flower />} value="5" label="Available tools" tone="orange" />
      <MetricCard icon={<CalendarDays />} value={sessions.data?.sessions.length ?? "—"} label="Sessions" tone="aqua" />
      <MetricCard icon={<Radio />} value={live.length} label="Live activities" tone="purple" />
      <MetricCard icon={<Users />} value={activities.data?.activities.reduce((sum, item) => sum + Number(item.submitted_count ?? 0), 0) ?? 0} label="Responses" tone="yellow" />
    </div>
    <section className="section-block home-quick-launch"><div className="section-heading"><div><h2>Quick Launch</h2></div><Link className="text-link" to="/tools">View all tools <ArrowRight size={16} /></Link></div>
      <div className="quick-tool-grid">
        <Link to="/tools/scarf" className="quick-tool-card quick-scarf"><div><Badge tone="orange">EXPERIMENTAL v0.2</Badge><h3>SCARF</h3><p>A 30-question self-reflection activity for groups.</p><span className="card-link">Open assessment <ArrowRight size={17} /></span></div><Mascot kind="sun" /></Link>
        <Link to="/tools/reflection-wall" className="quick-tool-card quick-reflection"><div><h3>Reflection Wall</h3><p>Share and explore group reflections.</p><span className="card-link">Create a wall <ArrowRight size={17} /></span></div><Mascot kind="popp" /></Link>
        <Link to="/tools/learning-behaviors" className="quick-tool-card quick-learning"><div><h3>Learning Behaviors</h3><p>Reflect, invite peer feedback and choose a next step.</p><span className="card-link">Open activity <ArrowRight size={17} /></span></div><Mascot kind="bean" /></Link>
        <Link to="/tools/poll" className="quick-tool-card quick-poll"><div><h3>Poll</h3><p>Get real-time input and ideas.</p><span className="card-link">Create a Poll <ArrowRight size={17} /></span></div><Mascot kind="flower" /></Link>
        <Link to="/tools/wordcloud" className="quick-tool-card quick-wordcloud"><div><h3>Word Cloud</h3><p>See the words your group shares.</p><span className="card-link">Create a cloud <ArrowRight size={17} /></span></div><Mascot kind="popp" /></Link>
      </div>
    </section>
    <div className="home-columns home-bottom-columns"><section className="section-block"><div className="section-heading"><h2>Upcoming sessions</h2><Link className="text-link" to="/sessions">View all sessions <ArrowRight size={16} /></Link></div>
      {upcoming.length ? <div className="home-session-grid">{upcoming.map((session, index) => { const start = session.starts_at ? new Date(session.starts_at) : null; return <Link key={session.id} className="home-session-card" to={`/sessions/${session.id}`}><span className={`home-session-date-tile date-${index % 3}`}>{start ? <><strong>{start.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}</strong><b>{start.toLocaleDateString(undefined, { day: "2-digit" })}</b><small>{start.toLocaleDateString(undefined, { weekday: "short" })}</small></> : <><strong>DATE</strong><b>—</b><small>To be set</small></>}</span><span className="home-session-body"><strong>{session.name}</strong><span><Clock3 size={13} />{start ? start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Schedule not set"}</span><span><Users size={13} />{session.expected_participants || 0} participants</span><span><ActivityBadge state={session.status} /> <small>{session.activity_count ?? 0} activities</small></span></span></Link>; })}</div> : <EmptyState title="No sessions yet" description="Create a class or workshop when you need a home for activities." action={<Button variant="quiet" to="/sessions/new">Create session</Button>} />}</section>
      <section className="section-block"><div className="section-heading"><h2>Recent activity</h2><Link className="text-link" to="/archive">View all <ArrowRight size={16} /></Link></div>
      {recent.length ? <div className="mini-list">{recent.map((item, index) => <Link key={item.id} className="mini-row" to={activityRoute(item)}><span className={`mini-icon mini-icon-${index % 2 ? "pink" : "orange"}`}><BarChart3 size={19} /></span><span><strong>{item.title}</strong><small>{item.session_name ?? "Quick activity"} · {item.submitted_count ?? 0} submitted</small></span><ActivityBadge state={item.state} /></Link>)}</div> : <div className="empty-inline"><span>No activities saved yet.</span><Button variant="quiet" to="/activities/new">Create one</Button></div>}</section></div>
  </div>;
}

const TOOL_CARDS = [
  { title: "SCARF Assessment", category: "Assessment", description: "An experimental 30-question reflection on five social needs.", tone: "orange", icon: "sun", available: true },
  { title: "Word Cloud", category: "Collaboration", description: "Collect anonymous words and reveal shared themes as a live group cloud.", tone: "purple", icon: "flower", available: true },
  { title: "Reflection Wall", category: "Reflection", description: "Share Post-its, reactions and comments in a live, moderated reflection space.", tone: "yellow", icon: "popp", available: true },
  { title: "Team Poll", category: "Voting", description: "Ask one focused question and see your group’s answers live.", tone: "aqua", icon: "flower", available: true },
  { title: "Learning Behaviors Reflection", category: "Reflection", description: "Reflect on six learning behaviors, invite anonymous peer feedback, and choose a small next step.", tone: "aqua", icon: "bean", available: true },
];

export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState("All tools");
  const search = params.get("search") ?? "";
  const [favorites, setFavorites] = useState<string[]>(() => getStoredIds("trainerpopp:favourite-tools"));
  const { data: activityData } = useData<{ activities: Activity[] }>("/owner/activities");
  const categories = ["All tools", "Assessment", "Reflection", "Voting", "Collaboration", "Favorites"];
  const filtered = TOOL_CARDS.filter((tool) => {
    const matchesCategory = category === "All tools" || (category === "Favorites" ? favorites.includes(tool.title) : tool.category === category);
    return matchesCategory && `${tool.title} ${tool.description}`.toLowerCase().includes(search.toLowerCase());
  });
  const recentActivities = activityData?.activities.slice(0, 3) ?? [];
  useEffect(() => { try { window.localStorage.setItem("trainerpopp:favourite-tools", JSON.stringify(favorites)); } catch { /* Favorites remain available for this page view if storage is disabled. */ } }, [favorites]);
  function toggleFavorite(title: string) {
    setFavorites((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title]);
  }
  return <div className="page-stack"><PageIntro title="My Tools" description="Choose a tool to spark the right kind of conversation." />
    <div className="toolbar-row"><div className="filter-pills" role="group" aria-label="Filter tools">{categories.map((item) => <button key={item} className={`filter-pill ${category === item ? "selected" : ""}`} onClick={() => setCategory(item)}>{item === "Favorites" && <Heart size={14} fill={category === item ? "currentColor" : "#ff6bcb"} />} {item}</button>)}</div></div>
    {category === "All tools" && !search && <section className="tools-feature-grid"><div className="scarf-tool-banner"><div className="scarf-banner-copy"><Badge tone="orange">SCARF ASSESSMENT · v0.2</Badge><h2>SCARF</h2><strong>Explore what shapes people’s experience at work.</strong><p>30 experimental questions, personal reflection results, trainer analytics and a privacy-protected presenter view.</p><div className="scarf-banner-actions"><Button variant="yellow" to="/tools/scarf">Open tool <ArrowRight size={16} /></Button><Button variant="secondary" to="/activities/new">Create activity</Button></div></div><div className="scarf-banner-art"><Mascot kind="sun" /><span className="art-spark art-spark-one">✦</span><div className="scarf-banner-dimensions">{SCARF_DIMENSIONS.map((name, i) => <span key={name}><b style={{ background: SCARF_COLORS[i] }}>{name[0]}</b>{name}</span>)}</div></div></div>
      <aside className="tools-recent-panel"><div className="section-heading"><h2>Recently used</h2><Link className="text-link" to="/archive">View all <ArrowRight size={15} /></Link></div>{recentActivities.length ? <div className="tools-recent-list">{recentActivities.map((activity, index) => <Link key={activity.id} className="tools-recent-item" to={activityRoute(activity)}><span className={`tools-recent-art tools-recent-art-${index % 3}`}><Mascot kind={index % 2 ? "flower" : "sun"} /></span><span><strong>{activity.title}</strong><small>{activity.session_name || "Quick activity"}</small></span><ArrowRight size={16} /></Link>)}</div> : <div className="tools-recent-empty"><Mascot kind="flower" /><strong>Nothing used yet</strong><span>Open a tool to see it here.</span></div>}</aside>
    </section>}
    <div className="section-heading tool-library-heading"><h2>{search ? "Search results" : "All tools"}</h2><span className="subtle-text">{TOOL_CARDS.length} available</span></div>
    {filtered.length ? <div className="tool-grid">{filtered.map((tool) => <article className={`tool-card tool-card-${tool.tone}`} key={tool.title}><div className="tool-card-top"><Badge tone="orange">{tool.category === "Voting" ? "Ready to use" : tool.title === "Word Cloud" ? "Anonymous responses" : tool.title === "Reflection Wall" ? "Live collaboration" : tool.title === "Learning Behaviors Reflection" ? "Four phase activity" : "Experimental module"}</Badge><Mascot kind={tool.icon as "flower" | "sun" | "bean" | "spark" | "popp"} /></div><button className={`tool-favorite ${favorites.includes(tool.title) ? "tool-favorite-active" : ""}`} aria-label={favorites.includes(tool.title) ? `Remove ${tool.title} from favorites` : `Add ${tool.title} to favorites`} aria-pressed={favorites.includes(tool.title)} onClick={() => toggleFavorite(tool.title)}><Heart size={17} fill={favorites.includes(tool.title) ? "currentColor" : "none"} /></button><div><span className="eyebrow">{tool.category}</span><h3>{tool.title}</h3><p>{tool.description}</p></div><Link to={tool.title === "Team Poll" ? "/tools/poll" : tool.title === "Word Cloud" ? "/tools/wordcloud" : tool.title === "Reflection Wall" ? "/tools/reflection-wall" : tool.title === "Learning Behaviors Reflection" ? "/tools/learning-behaviors" : "/tools/scarf"} className="card-link">Open tool <ArrowRight size={17} /></Link></article>)}</div> : <EmptyState title="No tools match that search" description="Try another search or switch the category filter." action={<Button variant="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("search"); setParams(next); }}>Clear search</Button>} />}
  </div>;
}

export function ScarfDetailPage() {
  return <div className="page-stack tool-detail-page"><div className="tool-detail-heading"><div className="breadcrumb"><Link to="/tools">My Tools</Link><ChevronRight size={15} /><span>SCARF Assessment</span></div><h1>SCARF<span className="title-dot">.</span></h1><p>A 30-question self-reflection on five social needs.</p></div>
    <section className="tool-detail-hero"><div className="tool-detail-copy"><h2>SCARF</h2><p>Create a participant activity, review personal patterns, compare activity or session results, and share protected group summaries in Presenter Mode.</p><div className="detail-actions"><Button variant="secondary" to="/activities/new">Set up an assessment <ArrowRight size={16} /></Button><Button variant="yellow" to="/activities/new">Create activity <ArrowRight size={16} /></Button></div><small className="tool-detail-disclaimer">EXPERIMENTAL v0.2 · The supplied questions and scoring have not been psychometrically validated.</small></div><div className="tool-detail-art"><div className="detail-sun"><Mascot kind="sun" /></div><div className="detail-flower"><Mascot kind="flower" /></div><div className="detail-stars">✦</div><div className="dimension-stack">{SCARF_DIMENSIONS.map((name, index) => <span key={name} style={{ background: `${SCARF_COLORS[index]}44` }}><b style={{ background: SCARF_COLORS[index] }}>{name[0]}</b>{name}</span>)}</div></div></section>
    <div className="detail-info-grid">{[["What it helps with", "Supports reflection on five social needs that may shape people’s experience at work."], ["Best used for", "Team development, leadership programmes, change initiatives and psychologically safe cultures."], ["Formats", "Personal reflection, team discussion or a facilitated workshop."], ["Outputs", "Personal patterns, team heatmaps, discussion prompts and facilitator insights." ]].map(([title, text], i) => <Card key={title} className={`detail-info-card detail-info-${i}`}><span className="detail-info-icon">{i === 0 ? <Lightbulb /> : i === 1 ? <Users /> : i === 2 ? <Check /> : <BarChart3 />}</span><h3>{title}</h3><p>{text}</p></Card>)}</div>
    <div className="detail-lower-grid"><section className="section-block detail-activities"><div className="section-heading"><h2>One assessment, three response sections</h2><Badge tone="orange">30 questions · v0.2</Badge></div><div className="detail-activity-grid">{[["Reaction Intensity", "Q01–Q10 · rate the strength of each reaction.", "sun"], ["Trade-off preference", "Q11–Q20 · choose between paired social needs.", "flower"], ["Three-way ranking", "Q21–Q30 · rank three needs in each scenario.", "bean"]].map(([title, description, icon], i) => <article className={`detail-activity-card detail-activity-${i}`} key={title}><span className="detail-activity-mascot"><Mascot kind={icon as "sun" | "flower" | "bean"} /></span><span className="detail-activity-copy"><strong>{title}</strong><small>{description}</small></span></article>)}</div></section><aside className="detail-guidance"><section className="detail-how-card"><div className="section-heading"><h2>How it works</h2></div><div className="detail-steps">{[["Complete", "Participants answer all 30 assessment items."], ["Reflect", "Review personal patterns and discuss what they mean."], ["Discuss", "Share protected group summaries when ready."]].map(([title, description], i) => <div className="detail-step" key={title}><span>{i + 1}</span><Mascot kind={i === 0 ? "bean" : i === 1 ? "flower" : "sun"} /><strong>{title}</strong><small>{description}</small></div>)}</div></section><section className="detail-outputs"><h2>Assessment outputs</h2><div><span>Integrated Needs Profile</span><span>Reaction Intensity &amp; Driver Priority</span><span>Protected group heatmap</span><span>Facilitator discussion</span></div></section></aside></div>
  </div>;
}

const SESSION_TEMPLATES = [
  { id: "scarf-workshop", name: "SCARF Workshop", description: "Run a SCARF Assessment and discuss protected group patterns.", tone: "orange", icon: "sun" },
  { id: "team-check-in", name: "Team Check-in", description: "A short space for a team pulse and shared reflection.", tone: "aqua", icon: "bean" },
  { id: "reflection-session", name: "Reflection Session", description: "Help a group pause and reflect together.", tone: "pink", icon: "flower" },
];

function getPinnedSessionIds() {
  return getStoredIds("trainerpopp:pinned-sessions");
}

export function SessionsPage() {
  const [filter, setFilter] = useState("All");
  const [sessionParams] = useSearchParams();
  const query = sessionParams.get("search") ?? "";
  const [pinnedIds, setPinnedIds] = useState<string[]>(getPinnedSessionIds);
  const { data, loading, error, refresh } = useData<{ sessions: Session[] }>("/owner/sessions");
  const { data: activityData } = useData<{ activities: Activity[] }>("/owner/activities");
  const sessions = data?.sessions.filter((session) => (filter === "All" || (filter === "Favorites" ? pinnedIds.includes(session.id) : session.status.toLowerCase() === filter.toLowerCase())) && `${session.name} ${session.description}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const recentActivities = activityData?.activities.filter((activity) => activity.session_id).slice(0, 4) ?? [];
  const pinnedSessions = data?.sessions.filter((session) => pinnedIds.includes(session.id)) ?? [];
  useEffect(() => { try { window.localStorage.setItem("trainerpopp:pinned-sessions", JSON.stringify(pinnedIds)); } catch { /* Pinning remains available for this page view if storage is disabled. */ } }, [pinnedIds]);
  function togglePinned(sessionId: string) {
    setPinnedIds((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId]);
  }
  return <div className="page-stack"><PageIntro title="My Sessions" description="Organize workshops, classes, and learning experiences." />
    <div className="sessions-toolbar"><div className="filter-pills" role="group" aria-label="Filter sessions">{["All", "Upcoming", "Draft", "Completed", "Favorites"].map((item) => <button key={item} className={`filter-pill ${filter === item ? "selected" : ""}`} onClick={() => setFilter(item)}>{item === "Favorites" && <Heart size={14} fill={filter === item ? "currentColor" : "#ff6bcb"} />} {item}</button>)}</div></div>
    {loading && !data ? <LoadingState label="Loading sessions…" /> : error ? <ErrorState message={error} retry={refresh} /> : sessions.length === 0 ? <Card><EmptyState title={filter === "All" ? "Your first session starts here" : `No ${filter.toLowerCase()} sessions`} description="Create a class or workshop, then add an activity when you’re ready." action={<Button to="/sessions/new">Create session</Button>} /></Card> : <>
      <section className="sessions-feature-layout"><article className="session-feature"><div className="session-feature-copy"><h2>{sessions[0]!.name}<span>!</span></h2><strong>{sessions[0]!.description || "A workshop space for learning, practice, and conversation."}</strong><p>{sessions[0]!.starts_at ? new Date(sessions[0]!.starts_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Schedule this session whenever you're ready."}</p><div className="session-feature-actions"><Button variant="yellow" to={`/sessions/${sessions[0]!.id}`}>Open session <ArrowRight size={16} /></Button><Button variant="secondary" to={`/activities/new?sessionId=${sessions[0]!.id}`}>Start activity <ArrowRight size={16} /></Button></div></div><div className="session-feature-art"><Mascot kind="sun" /><div className="session-feature-facts"><span><Users size={20} /><b>{sessions[0]!.expected_participants ?? 0}</b> expected</span><span><CalendarDays size={20} /><b>{sessions[0]!.activity_count ?? 0}</b> activities</span><ActivityBadge state={sessions[0]!.status} /></div></div></article>
        <aside className="session-recent-panel"><div className="section-heading"><h2>Recent session activity</h2><Link className="text-link" to="/archive">View all <ArrowRight size={15} /></Link></div>{recentActivities.length ? <div className="session-recent-list">{recentActivities.map((activity, index) => <Link key={activity.id} className="session-recent-item" to={`/sessions/${activity.session_id}`}><span className={`session-recent-art session-recent-art-${index % 3}`}><Mascot kind={index % 2 ? "flower" : "sun"} /></span><span><strong>{activity.session_name || activity.title}</strong><small>{activity.title} · {activity.submitted_count ?? 0} responses</small></span><ChevronRight size={17} /></Link>)}</div> : <div className="session-recent-empty">Activities linked to a session will appear here.</div>}</aside>
      </section>
      <section className="sessions-library-layout"><div className="sessions-library"><div className="section-heading"><h2>All sessions</h2><span className="subtle-text">Sort by: Date (latest) <ChevronRight size={13} /></span></div><div className="sessions-grid">{sessions.map((session, index) => <article className="session-card" key={session.id}><div className={`session-art session-art-${index % 4}`}><Link className="session-card-open" to={`/sessions/${session.id}`} aria-label={`Open ${session.name}`}><span className="date-stamp">{session.starts_at ? new Date(session.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "DRAFT"}</span><Mascot kind={index % 2 ? "flower" : "sun"} /></Link><button className={`session-pin session-card-pin ${pinnedIds.includes(session.id) ? "session-pin-active" : ""}`} aria-label={pinnedIds.includes(session.id) ? `Unpin ${session.name}` : `Pin ${session.name}`} onClick={() => togglePinned(session.id)}>♥</button></div><div className="session-card-body"><div className="session-card-title"><Link to={`/sessions/${session.id}`}><h3>{session.name}</h3></Link><ChevronRight /></div><p>{session.description || "No description yet."}</p><div className="session-card-meta"><span><CalendarDays size={15} />{session.starts_at ? new Date(session.starts_at).toLocaleDateString() : "Not scheduled"}</span><span><Users size={15} />{session.expected_participants ?? 0} participants</span></div><div className="session-card-footer"><ActivityBadge state={session.status} /><span>{session.activity_count ?? 0} activities</span></div></div></article>)}</div></div>
        <aside className="sessions-side-panel"><div className="section-heading"><h2>Templates</h2><span className="subtle-text">3 starter plans</span></div><div className="session-template-list">{SESSION_TEMPLATES.map((template) => <Link key={template.id} to={`/sessions/new?template=${template.id}`} className={`session-template session-template-${template.tone}`}><span><strong>{template.name}</strong><small>{template.description}</small></span><Mascot kind={template.icon as "flower" | "sun" | "bean"} /><ArrowRight size={17} /></Link>)}</div><div className="section-heading pinned-heading"><h2>Pinned sessions</h2><span className="subtle-text">{pinnedSessions.length} saved</span></div>{pinnedSessions.length ? <div className="pinned-session-list">{pinnedSessions.map((session) => <div className="pinned-session-row" key={session.id}><Link to={`/sessions/${session.id}`}><CalendarDays size={18} /><span><strong>{session.name}</strong><small>{session.starts_at ? new Date(session.starts_at).toLocaleDateString() : "Schedule not set"}</small></span></Link><button aria-label={`Unpin ${session.name}`} onClick={() => togglePinned(session.id)}>×</button></div>)}</div> : <div className="pinned-empty">Pin a session using the heart on its card to keep it here.</div>}</aside>
      </section>
    </>}
  </div>;
}

export function CreateSessionPage() {
  const { sessionId } = useParams();
  const [sessionParams] = useSearchParams();
  const navigate = useNavigate();
  const template = SESSION_TEMPLATES.find((item) => item.id === sessionParams.get("template"));
  const [form, setForm] = useState({ name: template?.name ?? "", description: template?.description ?? "", startsAt: "", location: "", expectedParticipants: "" });
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
  return <div className="page-stack session-form-page"><div className="breadcrumb"><Link to="/sessions">My Sessions</Link><ChevronRight size={15} /><span>{title}</span></div><PageIntro title={title} description={sessionId ? "Update the workshop details and expected group size." : "Make a home for your workshop. Add activities whenever you’re ready."} />
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
  const { data, loading, error, refresh } = useData<{ session: Session; activities: Activity[]; teams?: SessionTeamSummary[] }>(`/owner/sessions/${sessionId}`);
  if (loading && !data) return <LoadingState label="Opening session…" />;
  if (error) return <ErrorState message={error} retry={refresh} />;
  if (!data) return <EmptyState title="Session not found" description="This session may have been removed." action={<Button to="/sessions">Back to sessions</Button>} />;
  const { session, activities, teams = [] } = data;
  const joined = activities.reduce((sum, activity) => sum + Number(activity.participant_count ?? 0), 0);
  const submitted = activities.reduce((sum, activity) => sum + Number(activity.submitted_count ?? 0), 0);
  const teamsEnabled = activities.filter((activity) => activity.allow_teams).length;
  const completion = joined ? Math.round(submitted / joined * 100) : 0;
  const firstLive = activities.find((activity) => activity.state === "open" && activity.join_pin);
  async function copyJoinLink() {
    if (!firstLive?.join_pin) return;
    await navigator.clipboard.writeText(`${window.location.origin}/join?pin=${firstLive.join_pin}`).catch(() => undefined);
  }
  return <div className="page-stack session-detail-page"><div className="breadcrumb"><Link to="/sessions">My Sessions</Link><ChevronRight size={15} /><span>{session.name}</span></div>
    <header className="session-detail-heading"><div><h1>{session.name}<span className="title-dot">.</span></h1><p>{session.description || "A workshop space for activities and conversation."}</p></div><div className="session-detail-actions"><Button to={`/polls/new?sessionId=${session.id}`} icon={<Plus size={17} />}>Create Poll</Button><Button variant="secondary" to={`/learning-behaviors/new?sessionId=${session.id}`} icon={<Plus size={17} />}>Create LBR</Button><Button variant="secondary" to={`/activities/new?sessionId=${session.id}`} icon={<Plus size={17} />}>Create activity</Button><Button variant="secondary" to={`/sessions/${session.id}/edit`}>Edit session</Button><Button variant="secondary" onClick={() => void copyJoinLink()} disabled={!firstLive}>{firstLive ? "Share join link" : "Open an activity to share"}</Button></div></header>
    <div className="session-detail-workspace"><main className="session-detail-main"><div className="session-stat-grid"><div className="session-stat session-stat-date"><CalendarDays /><strong>{session.starts_at ? new Date(session.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Schedule not set"}</strong><small>{session.starts_at ? new Date(session.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Add date and time"}</small></div><div className="session-stat session-stat-aqua"><Users /><strong>{session.expected_participants ?? 0}</strong><small>Expected participants</small></div><div className="session-stat session-stat-yellow"><span className="four-petal-mark">✿</span><strong>{teamsEnabled}</strong><small>Activities with teams</small></div><div className="session-stat session-stat-pink"><Sparkles /><strong>{activities.length}</strong><small>Activities</small></div></div>
      <section className="section-block session-activities-block"><div className="section-heading"><h2>Activities in this session</h2><span className="session-add-actions"><Link className="text-link" to={`/polls/new?sessionId=${session.id}`}>Add Poll <Plus size={15} /></Link><Link className="text-link" to={`/reflection-walls/new?sessionId=${session.id}`}>Add Reflection Wall <Plus size={15} /></Link><Link className="text-link" to={`/activities/new?sessionId=${session.id}`}>Add activity <Plus size={15} /></Link></span></div>
      {activities.length === 0 ? <Card><EmptyState title="This session is ready for its first activity" description="Add a Reflection Wall, Word Cloud, Poll or Learning Behaviors Reflection whenever your group is ready." action={<div className="session-add-actions"><Button variant="orange" to={`/wordclouds/new?sessionId=${session.id}`}>Create Word Cloud</Button><Button variant="secondary" to={`/polls/new?sessionId=${session.id}`}>Create Poll</Button><Button variant="secondary" to={`/reflection-walls/new?sessionId=${session.id}`}>Create Reflection Wall</Button><Button variant="secondary" to={`/learning-behaviors/new?sessionId=${session.id}`}>Create Learning Behaviors Reflection</Button></div>} /></Card> : <div className="activity-list">{activities.map((activity, index) => <Link to={activityRoute(activity)} className="activity-row" key={activity.id}><div className={`activity-icon activity-icon-${index % 3}`}><Mascot kind={index % 2 ? "flower" : "sun"} /></div><div className="activity-row-main"><strong>{activity.title}</strong><small>{activity.participant_count ?? 0} joined · {activity.submitted_count ?? 0} submitted</small></div><Badge tone={activity.tool_id === "poll" ? "aqua" : activity.tool_id === "wordcloud" ? "pink" : activity.tool_id === "reflection-wall" ? "yellow" : "purple"}>{activity.tool_id === "poll" ? "Poll" : activity.tool_id === "wordcloud" ? "Word Cloud" : activity.tool_id === "reflection-wall" ? "Reflection Wall" : activity.tool_id === "learning-behaviors-reflection" ? "Learning Behaviors" : "SCARF demo"}</Badge><ActivityBadge state={activity.state} /><Button variant="quiet">Open <ArrowRight size={17} /></Button></Link>)}</div>}</section>
      <section className="session-participation"><div className="section-heading"><h2>Participation overview</h2><span className="subtle-text">Activity totals · people may join more than one</span></div><div className="session-participation-cards">{activities.length ? activities.slice(0, 3).map((activity, index) => <Link to={`/activities/${activity.id}/live`} className={`participation-card participation-card-${index}`} key={activity.id}><span><strong>{activity.title}</strong><small>{activity.allow_teams ? "Team grouping enabled" : "No teams"} · {activity.state}</small></span><b>{activity.participant_count ?? 0}<small> joined</small></b></Link>) : <div className="participation-empty">Participants and team activity will appear here after you launch an activity.</div>}</div></section>
      <section className="session-teams-block"><div className="section-heading"><h2>Participants &amp; teams</h2>{activities[0] && <Link className="text-link" to={`/activities/${activities[0].id}/live`}>View activity participants <ArrowRight size={15} /></Link>}</div><div className="session-team-grid">{teams.length ? teams.slice(0, 3).map((team, index) => <article className={`session-team-card session-team-card-${index}`} key={team.id}><span className="session-team-art"><Mascot kind={index % 2 ? "flower" : "sun"} /></span><span className="session-team-copy"><strong>{team.name}</strong><small>{team.activity_title}</small><span className="session-team-avatars" aria-label={`${team.participant_count} participants assigned`}>
        {Array.from({ length: Math.min(team.participant_count, 4) }, (_, avatarIndex) => <i key={avatarIndex} />)}{team.participant_count > 4 && <b>+{team.participant_count - 4}</b>}
        {!team.participant_count && <em>No participants yet</em>}</span></span><strong className="session-team-count">{team.participant_count}<small> joined</small></strong></article>) : <div className="session-team-empty">Team cards will appear when an activity has teams and participants.</div>}{activities[0] && <Link className="session-all-participants" to={`/activities/${activities[0].id}/live`}><span><strong>All activity joins</strong><small>Open a participant list and manage team assignments.</small></span><b>{joined}<small> joined</small></b><ArrowRight size={18} /></Link>}</div></section></main>
      <aside className="session-detail-rail"><section className="session-insights"><div className="section-heading"><h2>Session insights</h2><span className="subtle-text">Live totals</span></div><div className="session-insight-grid"><div className="session-insight-card insight-aqua"><Users /><strong>{joined}</strong><small>Activity joins</small></div><div className="session-insight-card insight-yellow"><CalendarDays /><strong>{teamsEnabled}</strong><small>Activities with teams</small></div><div className="session-insight-card insight-pink"><Sparkles /><strong>{activities.length}</strong><small>Activities</small></div><div className="session-insight-card insight-purple"><BarChart3 /><strong>{completion}%</strong><small>Completion rate</small></div></div></section><section className="session-quick-links"><div className="section-heading"><h2>Quick links</h2></div><Link to={`/sessions/${session.id}/edit`}><span className="quick-link-icon">✎</span><span><strong>Session details</strong><small>Edit date, place and group size</small></span><ChevronRight size={17} /></Link><Link to={`/activities/new?sessionId=${session.id}`}><span className="quick-link-icon">＋</span><span><strong>Add an activity</strong><small>Build the next group moment</small></span><ChevronRight size={17} /></Link><Link to="/archive"><span className="quick-link-icon">▤</span><span><strong>Archived results</strong><small>Review completed activities</small></span><ChevronRight size={17} /></Link><Link to="/tools/scarf"><span className="quick-link-icon">✦</span><span><strong>Explore SCARF Assessment</strong><small>See the assessment overview</small></span><ChevronRight size={17} /></Link></section></aside></div>
  </div>;
}

export function ActivitySetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialSession = params.get("sessionId") ?? "";
  const { data: sessionData, error: sessionError } = useData<{ sessions: Session[] }>("/owner/sessions");
  const [form, setForm] = useState({ title: "SCARF Assessment", sessionId: initialSession, releaseMode: "" as "" | "immediate" | "trainer_released", allowTeams: true, teamCount: 4 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const teamNames = Array.from({ length: form.allowTeams ? form.teamCount : 0 }, (_, index) => `Team ${String.fromCharCode(65 + index)}`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const { activity } = await post<{ activity: { id: string } }>("/owner/activities", { title: form.title, sessionId: form.sessionId || null, toolId: "scarf-assessment", releaseMode: form.releaseMode || undefined, requireName: true, allowTeams: form.allowTeams, teamNames });
      navigate(`/activities/${activity.id}/live`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save activity."); }
    finally { setPending(false); }
  }
  return <div className="page-stack activity-setup-page"><div className="breadcrumb"><Link to="/tools">My Tools</Link><ChevronRight size={15} /><span>SCARF / Activity setup</span></div><PageIntro eyebrow="ACTIVITY SETUP" title="Set up SCARF" description="Make this activity yours — decide how people join, respond and see results." />
    {sessionError && <ErrorState message={sessionError} />}
    <form className="setup-grid" onSubmit={submit}><div className="setup-main">
      <Card className="form-card"><div className="form-section-heading"><span>ACTIVITY DETAILS</span><Badge tone="orange">Experimental v0.2</Badge></div><div className="tool-mini-header"><span className="mini-tool-art"><Mascot kind="sun" /></span><span><strong>SCARF Assessment</strong><small>{SCARF_DIMENSIONS.join(" · ")}</small></span></div>
        <label className="field-label" htmlFor="activity-title">Activity title</label><input className="text-input" id="activity-title" required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <label className="field-label" htmlFor="activity-session">Run this activity in</label><select className="text-input" id="activity-session" value={form.sessionId} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}><option value="">Quick Activity · Standalone</option>{sessionData?.sessions.map((session) => <option value={session.id} key={session.id}>{session.name}</option>)}</select>
        <div className="two-field-row"><div><span className="field-label">Question set</span><div className="select-static"><strong>30 questions · v0.2</strong><Badge tone="orange">Experimental</Badge></div></div><div><span className="field-label">Format</span><div className="select-static"><Clock3 size={17} /> 3 question formats</div></div></div>
      </Card>
      <Card className="form-card"><div className="form-section-heading"><span>PARTICIPATION</span><small>Short-lived guest access, no account required.</small></div>
        <div className="switch-row"><span><strong>Participant name</strong><small>Required so trainers can review named individual results. Names never appear in Presenter Mode.</small></span><Badge tone="blue">Required</Badge></div>
        <label className="switch-row"><span><strong>Enable team grouping</strong><small>Participants may choose a team. You can reassign them later.</small></span><input type="checkbox" checked={form.allowTeams} onChange={(event) => setForm({ ...form, allowTeams: event.target.checked })} /><i /></label>
        {form.allowTeams && <div className="team-config"><label className="field-label" htmlFor="team-count">Number of teams</label><select id="team-count" className="text-input team-count-select" value={form.teamCount} onChange={(event) => setForm({ ...form, teamCount: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}</select><div className="team-chip-list">{teamNames.map((name, index) => <span className="team-chip" key={name} style={{ background: `${TEAM_PALETTE[index]}66` }}><ColorDot color={TEAM_PALETTE[index]!} />{name}</span>)}</div></div>}
        <div className="access-method-row"><span className="method-pill"><Check size={14} /> QR code</span><span className="method-pill method-gold"><Check size={14} /> 6-digit PIN</span><span className="method-pill method-aqua"><Check size={14} /> Join link</span></div>
      </Card>
    </div><aside className="setup-aside"><section className="ready-card"><span>READY TO MAKE IT POP?</span><h2>One QR code.<br />A better conversation.</h2><Mascot kind="bean" /></section>
      <Card className="form-card"><h3>Personal results release</h3><span className="field-label">Choose how participants receive their individual results</span><div className="radio-list">{[{ value: "immediate", label: "Immediately after submitting", help: "Each participant sees only their own result." }, { value: "trainer_released", label: "When I release them", help: "Participants wait until you make results available." }].map((item) => <label key={item.value} className={`radio-card ${form.releaseMode === item.value ? "radio-selected" : ""}`}><input type="radio" name="release-mode" value={item.value} checked={form.releaseMode === item.value} onChange={() => setForm({ ...form, releaseMode: item.value as "immediate" | "trainer_released" })} /><span><strong>{item.label}</strong><small>{item.help}</small></span>{form.releaseMode === item.value && <Badge tone="blue">Selected</Badge>}</label>)}</div><div className="privacy-callout"><LockKeyhole size={17} /><span>Trainers can see named individual results. Presenter Mode displays aggregate summaries only and suppresses groups smaller than five.</span></div></Card>
      <Card className="info-card"><Sparkles size={18} /><p>The provided v0.2 questions and scoring are experimental and have not been psychometrically validated. No single combined score is calculated.</p></Card>
      {error && <div role="alert" className="inline-error">{error}</div>}{<div className="setup-submit"><Button variant="secondary" to={form.sessionId ? `/sessions/${form.sessionId}` : "/tools/scarf"}>Cancel</Button><Button type="submit" disabled={pending || !form.releaseMode} className="setup-submit-button">{pending ? "Saving…" : "Save and continue"}</Button></div>}
    </aside></form>
  </div>;
}

export function ActivityLivePage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useData<OwnerActivity>(`/owner/activities/${activityId}`, 5000);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const activity = data?.activity;
  const scarfConfig = data?.config;
  const isScarf = activity?.tool_id === "scarf-assessment";
  async function runAction(action: "open" | "pause" | "close") {
    setActionError("");
    try { await post(`/owner/activities/${activityId}/${action}`); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Action failed."); }
  }
  async function releaseResults() {
    setActionError("");
    try { await post(`/owner/scarf/activities/${activityId}/release`, {}); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not release results."); }
  }
  async function resetParticipant(person: Participant) {
    if (!window.confirm(`Reset ${person.display_name}’s assessment? Their current responses and result will be cleared.`)) return;
    setActionError("");
    try { await post(`/owner/scarf/activities/${activityId}/participants/${person.id}/reset`, { reason: "Trainer requested a participant reset." }); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not reset this participant."); }
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
  return <div className="page-stack live-page"><div className="breadcrumb"><Link to={activity.session_id ? `/sessions/${activity.session_id}` : "/tools/scarf"}>{activity.session_name || "My Tools"}</Link><ChevronRight size={15} /><span>Live Activity</span></div>
    <section className="live-title-bar"><div><span className="live-kicker"><span className="live-pulse" />{activity.state === "open" ? "LIVE NOW" : activity.state.toUpperCase()} {activity.session_name ? `· ${activity.session_name}` : "· QUICK ACTIVITY"}</span><h1>{activity.title}<span>!</span></h1><p>{isScarf ? `SCARF Assessment · ${data.teams.length} teams · ${scarfConfig?.releaseMode === "immediate" ? "Personal results on submit" : "Trainer releases personal results"}` : `SCARF demo · ${data.teams.length} teams · ${activity.result_policy === "trainer_reveal" ? "Trainer reveals results" : activity.result_policy === "immediate" ? "Personal results on submit" : "Thank-you only"}`}</p></div><div className="live-title-actions"><Button variant="yellow" onClick={() => void runAction(activity.state === "open" ? "pause" : "open")} icon={activity.state === "open" ? <Pause size={17} /> : <Play size={17} />}>{activity.state === "open" ? "Pause responses" : activity.state === "closed" ? "Reopen activity" : activity.state === "draft" ? "Open activity" : "Resume responses"}</Button><Button variant="secondary" to={`/activities/${activity.id}/presenter`}>Presenter controls</Button></div></section>
    {error && <div className="subtle-warning" role="status">Live refresh paused: {error}</div>}{actionError && <div className="inline-error" role="alert">{actionError}</div>}
    <div className="metric-grid live-metrics"><MetricCard icon={<Users />} value={joined} label="Participants joined" tone="aqua" /><MetricCard icon={<Check />} value={completed} label="Submitted" tone="yellow" /><MetricCard icon={<Clock3 />} value={Math.max(0, joined - completed)} label="In progress" tone="purple" /><MetricCard icon={<BarChart3 />} value={`${percent}%`} label="Completion rate" tone="pink" /></div>
    <div className="live-grid"><div className="live-left"><section className="join-card"><div className="join-card-heading"><span>POP IN!</span><span className="qr-decoration"><Mascot kind="spark" /></span></div>{activity.join_pin ? <><p>Scan this QR code or enter the code on your phone.</p><div className="qr-frame"><QRCodeSVG value={qrUrl} size={178} level="M" includeMargin /></div><span className="pin-label">OR ENTER THE PIN</span><strong className="pin-code">{activity.join_pin.slice(0, 3)} {activity.join_pin.slice(3)}</strong><span className="join-url">trainerpopp.app/join</span><Button variant="secondary" onClick={() => void copyJoinLink()} icon={<Copy size={16} />}>{copied ? "Copied" : "Copy join link"}</Button></> : <><p>Open the activity to generate a fresh join code and private participant link.</p><div className="qr-placeholder"><LockKeyhole size={36} /><span>Your room is not open yet</span></div><Button onClick={() => void runAction("open")}>Open activity</Button></>}</section><Card className="privacy-card"><LockKeyhole size={18} /><div><strong>{isScarf ? "Personal results stay private" : "Present when you’re ready"}</strong><p>{isScarf ? "Trainers can review named individual results. Participants see their own results according to your release setting. Presenter Mode receives aggregate summaries only." : "Participants cannot see team results until you reveal them. Projector names stay hidden unless both you and each participant allow them."}</p></div></Card></div>
      <div className="live-right"><Card className="progress-card"><div className="section-heading"><div><span className="eyebrow">RESPONSE PROGRESS</span><h2>{completed} of {joined} submitted</h2></div><Badge tone={percent === 100 && joined ? "green" : "purple"}>{percent}%</Badge></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="progress-caption"><span>Updated automatically every 5 seconds</span><span>{activity.state === "open" ? "Accepting responses" : activity.state === "paused" ? "Responses paused" : "Responses closed"}</span></div></Card>
        <Card className="participants-card"><div className="section-heading"><div><span className="eyebrow">WHO’S HERE?</span><h2>Participants <small>({joined})</small></h2></div><button className="refresh-button" onClick={refresh}>Refresh <Radio size={15} /></button></div>{joined === 0 ? <div className="empty-table"><Users size={25} /><strong>Waiting for the first person to join.</strong><span>Share the QR code or the six-digit PIN.</span></div> : <div className="table-scroll"><table className="participants-table"><thead><tr><th>Participant</th><th>Team</th><th>Status</th><th>{isScarf ? "Progress" : "Submitted"}</th>{isScarf && <th>Trainer actions</th>}</tr></thead><tbody>{data.participants.map((person) => <tr key={person.id}><td><span className="participant-initial" style={{ background: TEAM_PALETTE[Math.abs(person.display_name.charCodeAt(0)) % TEAM_PALETTE.length] }}>{person.display_name.slice(0, 1).toUpperCase()}</span><span className="participant-name"><strong>{person.display_name}</strong>{person.role && <small>{person.role}</small>}</span></td><td>{activity.allow_teams ? <select aria-label={`Team for ${person.display_name}`} value={person.team_id ?? ""} onChange={async (event) => { try { await post(`/owner/activities/${activityId}/participants/${person.id}/team`, { teamId: event.target.value || null }); refresh(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update team."); } }}><option value="">Unassigned</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select> : "—"}</td><td><Badge tone={person.submission_status === "submitted" ? "green" : "yellow"}>{person.submission_status === "submitted" ? "Completed" : "In progress"}</Badge></td><td>{isScarf ? `${person.answered_count ?? 0} / 30` : person.submitted_at ? new Date(person.submitted_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}</td>{isScarf && <td><button className="text-button" type="button" onClick={() => void resetParticipant(person)}>Reset</button></td>}</tr>)}</tbody></table></div>}
          <div className="participants-footer"><span>Private trainer view · individual responses stay hidden from other participants</span><Link to={`/results/${activity.id}`}>Review results <ArrowRight size={15} /></Link></div></Card>
        <div className="live-bottom-actions">{isScarf && scarfConfig?.releaseMode === "trainer_released" && <Button variant="primary" onClick={() => void releaseResults()} disabled={Boolean(scarfConfig.resultsReleasedAt)}>{scarfConfig.resultsReleasedAt ? "Personal results released" : "Release personal results"}</Button>}<Button variant="secondary" to={`/results/${activity.id}`}>{isScarf ? "Review SCARF analytics" : "Preview demo results"}</Button>{isScarf && <a className="button button-quiet" href={`/api/owner/scarf/activities/${activity.id}/export.csv`}>Export CSV</a>}<Button variant="danger" onClick={() => void runAction("close")} disabled={activity.state === "closed" || activity.state === "archived"}>Close activity</Button></div>
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
  return <div className="page-stack archive-page"><div className="breadcrumb archive-breadcrumb"><span>Archive / Results</span></div><PageIntro title="Look back. Learn more" description="Every Popp! moment, saved for the next great conversation." />
    <section className="archive-highlight"><div><span>YOUR ACTIVITY HISTORY</span><h2>Keep the learning going.</h2><p>Review saved activities and the conversations they supported.</p></div><div className="archive-art"><Mascot kind="flower" /></div><Link to="/tools/scarf" className="highlight-link">Explore SCARF Assessment <ArrowRight size={17} /></Link></section>
    {loading && !data ? <LoadingState label="Loading activity history…" /> : error ? <ErrorState message={error} retry={refresh} /> : <>
      <div className="metric-grid archive-metrics"><MetricCard icon={<Radio />} value={data?.activities.length ?? 0} label="Saved activities" tone="aqua" /><MetricCard icon={<CalendarDays />} value={new Set(data?.activities.map((activity) => activity.session_id).filter(Boolean)).size} label="Sessions used" tone="purple" /><MetricCard icon={<Check />} value={data?.activities.reduce((sum, activity) => sum + Number(activity.submitted_count ?? 0), 0) ?? 0} label="Activity submissions" tone="pink" /><MetricCard icon={<Flower />} value={TOOL_CARDS.length} label="Active tools" tone="yellow" /></div>
      <div className="section-heading archive-heading"><div><span className="eyebrow">YOUR HISTORY</span><h2>Activity runs</h2></div><label className="local-search"><input aria-label="Search archived activities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find activity…" /><Search size={16} /></label></div>
      <div className="filter-pills">{options.map((item) => <button key={item} className={`filter-pill ${filter === item ? "selected" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
      {rows.length ? <div className="archive-list">{rows.map((activity, index) => <div className="archive-row" key={activity.id}><div className={`archive-icon archive-icon-${index % 4}`}><BarChart3 /></div><div className="archive-row-main"><strong>{activity.title}</strong><small>{activity.session_name ?? "Quick Activity"} · {activity.tool_id === "poll" ? "Poll" : activity.tool_id === "wordcloud" ? "Word Cloud" : activity.tool_id === "reflection-wall" ? "Reflection Wall" : activity.tool_id === "learning-behaviors-reflection" ? "Learning Behaviors Reflection" : activity.tool_id === "scarf-assessment" ? "SCARF Assessment" : "SCARF demo"} · {activity.instrument_version ?? (activity.tool_id === "wordcloud" ? "wordcloud-v1.0" : activity.tool_id === "learning-behaviors-reflection" ? "lbr-v1.0" : "demo-items-v0")}</small></div><div className="archive-stat"><strong>{activity.participant_count ?? 0}</strong><small>participants</small></div><div className="archive-stat"><strong>{activity.submitted_count ?? 0}</strong><small>submitted</small></div><ActivityBadge state={activity.state} />{activity.tool_id === "poll" ? <Button variant="quiet" to={`/polls/${activity.id}`}>Open Poll</Button> : activity.tool_id === "wordcloud" ? <Button variant="quiet" to={`/wordclouds/${activity.id}`}>Open Word Cloud</Button> : activity.tool_id === "reflection-wall" ? <Button variant="quiet" to={`/reflection-walls/${activity.id}`}>Open wall</Button> : activity.tool_id === "learning-behaviors-reflection" ? <Button variant="quiet" to={`/learning-behaviors/${activity.id}/analytics`}>View results</Button> : activity.submitted_count ? <Button variant="quiet" to={`/results/${activity.id}`}>View results</Button> : <Button variant="quiet" to={`/activities/${activity.id}/live`}>Open activity</Button>}</div>)}</div> : <Card><EmptyState title="Nothing to show yet" description="Closed activities and saved results will appear here." action={<Button to="/activities/new">Create activity</Button>} /></Card>}
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

type ScarfMetric = Record<string, { name: string; n: number; mean: number | null; median: number | null; min: number | null; max: number | null; distribution: number[] }>;
type ScarfHeatRow = { id: string; displayName: string; teamName: string; needsIndex: ScarfDomainScores; needsRank: ScarfDomainScores; classDelta: ScarfDomainScores | null };
type ScarfAnalytics = {
  scope: string; scopeId: string; instrument: { key: string; version: string; scoringVersion: string; status: string };
  counts: { joined: number; inProgress: number; completed: number; completionRate: number; contributing: number };
  means: { reaction: ScarfMetric; priority: ScarfMetric; tradeoff: ScarfMetric; ranking: ScarfMetric; needs: ScarfMetric };
  teams: Array<{ name: string; count: number; needsCount: number; reaction: ScarfMetric; priority: ScarfMetric; needs: ScarfMetric; needsIndex: ScarfDomainScores | null; needsRank: ScarfDomainScores | null; classDelta: ScarfDomainScores | null }>;
  participants: Array<{ id: string; displayName: string; teamId: string | null; teamName: string | null; status: string; currentQuestion: number; answeredCount: number }>;
  submitted: Array<{ id: string; displayName: string; teamId: string | null; teamName: string | null; status: string; submittedAt: string | null; scoringVersion: string;
    reaction: ScarfDomainScores; priority: ScarfDomainScores; tradeoff: ScarfDomainScores | null; ranking: ScarfDomainScores | null;
    integratedNeedsIndex: ScarfDomainScores | null; integratedNeedsRank: ScarfDomainScores | null; classDelta: ScarfDomainScores | null }>;
  heatmap: { available: boolean; classCount: number; classMean: ScarfDomainScores | null; classRank: ScarfDomainScores | null; comparisonAvailable: boolean; participants: ScarfHeatRow[];
    teams: Array<{ name: string; count: number; needsIndex: ScarfDomainScores; needsRank: ScarfDomainScores; classDelta: ScarfDomainScores | null }> };
  availableVersions: Array<{ instrumentVersion: string; scoringVersion: string }>;
  excludedIncompatibleActivityCount: number; warning: string;
};
type ScarfSessionPresenterState = { revealed: number; selected_team_name: string | null; scarf_layer: "reaction" | "priority" };

const scarfDomains: ScarfDomainCode[] = [...SCARF_DOMAIN_CODES];
const needsRankColors = ["#3939ff", "#7868ef", "#aee6ed", "#f2bb05", "#ff8a55"];

function needsCellStyle(mode: "pattern" | "class", value: number): CSSProperties {
  if (mode === "pattern") {
    const index = Math.max(0, Math.min(4, Math.round(value) - 1));
    return { background: needsRankColors[index], color: index === 0 ? "#fff" : "#1f1f1f" };
  }
  const strength = Math.min(1, Math.abs(value) / 3);
  const neutral = [244, 244, 248];
  const extreme = value < 0 ? [255, 91, 34] : [57, 57, 255];
  const rgb = neutral.map((channel, index) => Math.round(channel + (extreme[index]! - channel) * strength));
  return { background: `rgb(${rgb.join(",")})`, color: strength > 0.68 ? "#fff" : "#1f1f1f" };
}

function needsCellLabel(mode: "pattern" | "class", value: number): string {
  return mode === "pattern" ? `#${Number.isInteger(value) ? value : value.toFixed(1)}` : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function ScarfNeedsCell({ mode, value }: { mode: "pattern" | "class"; value: number | null | undefined }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="heat-cell tier-mid"><strong>—</strong></span>;
  return <span className="heat-cell tier-mid" title={mode === "pattern" ? `Within-profile Needs Rank ${value}; ties are retained` : `Same-domain difference from class mean: ${value.toFixed(2)} index points`} style={needsCellStyle(mode, value)}>
    <strong>{needsCellLabel(mode, value)}</strong><small>{mode === "pattern" ? "rank" : "vs class"}</small>
  </span>;
}

function ScarfAnalyticsPage({ activity }: { activity: Activity }) {
  const [scope, setScope] = useState<"activity" | "session">("activity");
  const [teamName, setTeamName] = useState("");
  const [heatMode, setHeatMode] = useState<"pattern" | "class">("pattern");
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const analyticsPath = scope === "session" && activity.session_id
    ? `/owner/scarf/sessions/${activity.session_id}/analytics?${new URLSearchParams({ instrumentVersion: activity.instrument_version ?? "0.2.0", scoringVersion: activity.scoring_version ?? "1.1.0" })}`
    : `/owner/scarf/activities/${activity.id}/analytics`;
  const { data, loading, error, refresh } = useData<ScarfAnalytics>(analyticsPath, 0);
  const presenterStatePath = activity.session_id ? `/owner/scarf/sessions/${activity.session_id}/presenter-state` : `/owner/scarf/activities/${activity.id}/analytics`;
  const { data: storedPresenterState, refresh: refreshPresenterState } = useData<ScarfSessionPresenterState>(presenterStatePath, 0);
  const [presenterRevealOverride, setPresenterRevealOverride] = useState<boolean | undefined>();
  const [sessionPresenterPath, setSessionPresenterPath] = useState("");
  const [presenterError, setPresenterError] = useState("");
  const presenterRevealed = presenterRevealOverride ?? Boolean(storedPresenterState?.revealed);
  const allPeople = data?.submitted ?? [];
  const profiles = (data?.heatmap.participants ?? []).filter((person) => !teamName || person.teamName === teamName);
  const selectedPerson = allPeople.find((person) => person.id === selectedParticipantId);
  const selectedProfile = profiles.find((person) => person.id === selectedParticipantId);
  const legacyScoring = data?.instrument.scoringVersion !== "1.1.0";
  const domains = scarfDomains;
  async function updateSessionPresenter(revealed: boolean) {
    if (!activity.session_id) return;
    setPresenterError("");
    try { await post(`/owner/scarf/sessions/${activity.session_id}/presenter-state`, { revealed, teamName: null, layer: "priority" }); setPresenterRevealOverride(revealed); refreshPresenterState(); }
    catch (reason) { setPresenterError(reason instanceof Error ? reason.message : "Could not update the session presenter."); }
  }
  async function launchSessionPresenter() {
    if (!activity.session_id) return;
    const popup = window.open("about:blank", "_blank");
    setPresenterError("");
    try {
      await post(`/owner/scarf/sessions/${activity.session_id}/presenter-state`, { revealed: presenterRevealed, teamName: null, layer: "priority" });
      const { path } = await post<{ path: string }>(`/owner/scarf/sessions/${activity.session_id}/presenter-session`);
      setSessionPresenterPath(path);
      if (popup) { popup.opener = null; popup.location.href = path; } else setPresenterError("Your browser blocked the new tab. Use the presenter link below.");
      refreshPresenterState();
    } catch (reason) { popup?.close(); setPresenterError(reason instanceof Error ? reason.message : "Could not open the session presenter."); }
  }
  return <div className="page-stack result-page scarf-analytics-page">
    <div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ChevronRight size={15} /><span>SCARF Assessment</span></div>
    <div className="results-header"><div><span className="eyebrow">SCARF v0.2 · SCORING {data?.instrument.scoringVersion ?? activity.scoring_version ?? "1.1.0"} · EXPERIMENTAL</span><h1>{scope === "session" ? "Session results" : "SCARF results"}<span className="title-dot">.</span></h1><p>{activity.title} · Named individual data is visible only to the signed-in trainer.</p></div><div className="results-actions">{scope === "session" && activity.session_id ? <><Button variant={presenterRevealed ? "secondary" : "primary"} onClick={() => void updateSessionPresenter(!presenterRevealed)}>{presenterRevealed ? "Hide presenter results" : "Reveal presenter results"}</Button><Button variant="yellow" onClick={() => void launchSessionPresenter()}>Open session presenter</Button></> : <Button variant="secondary" to={`/activities/${activity.id}/presenter`}>Presenter controls</Button>}<a className="button button-secondary" href={scope === "session" && activity.session_id ? `/api/owner/scarf/sessions/${activity.session_id}/export.csv` : `/api/owner/scarf/activities/${activity.id}/export.csv`}>Export CSV</a></div></div>
    {presenterError && <div className="inline-error" role="alert">{presenterError}</div>}{sessionPresenterPath && <div className="presenter-share"><span>Private session presenter link · expires in 4 hours</span><code>{window.location.origin}{sessionPresenterPath}</code><a href={sessionPresenterPath} target="_blank" rel="noreferrer">Open this screen <ArrowRight size={15} /></a></div>}
    {activity.session_id && <div className="filter-pills scarf-scope-pills"><button className={`filter-pill ${scope === "activity" ? "selected" : ""}`} onClick={() => setScope("activity")}>This activity</button><button className={`filter-pill ${scope === "session" ? "selected" : ""}`} onClick={() => setScope("session")}>Whole session</button></div>}
    {error && <ErrorState message={error} retry={refresh} />}{loading && !data ? <LoadingState label="Calculating SCARF profiles…" /> : data && <>
      {data.excludedIncompatibleActivityCount > 0 && <div className="subtle-warning">{data.excludedIncompatibleActivityCount} activity runs use an incompatible instrument or scoring version and are excluded.</div>}
      <div className="metric-grid result-metrics"><MetricCard icon={<Users />} value={data.counts.joined} label="Joined" tone="aqua" /><MetricCard icon={<Check />} value={data.counts.completed} label="Completed" tone="yellow" /><MetricCard icon={<Clock3 />} value={data.counts.inProgress} label="In progress" tone="purple" /><MetricCard icon={<BarChart3 />} value={`${Math.round(data.counts.completionRate * 100)}%`} label="Completion rate" tone="pink" /></div>
      {legacyScoring ? <div className="subtle-warning">These results were created with scoring {data.instrument.scoringVersion}. Reaction Intensity and Driver Priority remain intact; Integrated Needs Profile is intentionally absent from historical records.</div> : <>
        <div className="result-tabs scarf-metric-tabs" role="tablist" aria-label="Heatmap comparison"><button role="tab" aria-selected={heatMode === "pattern"} className={heatMode === "pattern" ? "tab-active" : ""} onClick={() => setHeatMode("pattern")}>Personal Pattern</button><button role="tab" aria-selected={heatMode === "class"} className={heatMode === "class" ? "tab-active" : ""} disabled={!data.heatmap.comparisonAvailable} onClick={() => setHeatMode("class")}>Compared to Class{!data.heatmap.comparisonAvailable ? " (n < 5)" : ""}</button></div>
        <div className="results-grid"><Card className="heatmap-card"><div className="section-heading"><div><span className="eyebrow">{scope === "session" ? "LATEST COMPATIBLE SUBMISSION PER PARTICIPANT" : "PRIVATE TRAINER VIEW"}</span><h2>{heatMode === "pattern" ? "Individual SCARF Heatmap" : "Compared to Class"}</h2></div><select aria-label="Filter by team" className="team-filter" value={teamName} onChange={(event) => setTeamName(event.target.value)}><option value="">All teams</option>{[...new Set(allPeople.map((person) => person.teamName ?? "Unassigned"))].sort().map((name) => <option key={name}>{name}</option>)}</select></div>
          <p className="heatmap-context">{heatMode === "pattern" ? "Each participant’s five domains are ranked within their own Integrated Needs Profile. #1 means most relatively favored in that profile." : `Each cell shows the same-domain difference from the ${data.heatmap.classCount}-participant class mean. Positive means more relatively favored than the class mean; negative means less.`}</p>
          {!data.heatmap.comparisonAvailable && <div className="small-group-warning"><Lightbulb size={17} /><span>Class comparison is available after five compatible submissions. Individual pattern ranks are still shown.</span></div>}
          {profiles.length === 0 ? <div className="empty-table"><Users size={24} /><strong>No Integrated Needs Profiles in this view yet.</strong><span>Profiles appear after participants submit using scoring v1.1.0.</span></div> : <div className="table-scroll"><table className="heatmap-table scarf-trainer-table"><thead><tr><th>PARTICIPANT</th>{domains.map((code) => <th key={code}><span className="dimension-heading">{code}</span>{SCARF_DOMAIN_NAMES[code]}</th>)}</tr></thead><tbody>{profiles.map((person) => <tr key={person.id}><th scope="row"><button type="button" className="participant-name scarf-person-link" onClick={() => setSelectedParticipantId(person.id)} aria-pressed={selectedParticipantId === person.id}><strong>{person.displayName}</strong><small>{person.teamName}</small></button></th>{domains.map((code) => <td key={code}><ScarfNeedsCell mode={heatMode} value={heatMode === "pattern" ? person.needsRank[code] : person.classDelta?.[code]} /></td>)}</tr>)}</tbody></table></div>}
          <div className="heatmap-legend">{heatMode === "pattern" ? <><span><i style={{ background: needsRankColors[0] }} />#1 most favored</span><span><i style={{ background: needsRankColors[2] }} />#3 middle</span><span><i style={{ background: needsRankColors[4] }} />#5 least favored</span><small>Tied ranks are kept (for example, #1.5).</small></> : <><span><i style={{ background: "#ff5b22" }} />−3</span><span><i style={{ background: "#f4f4f8" }} />0 class mean</span><span><i style={{ background: "#3939ff" }} />+3</span><small>Fixed symmetric display range; values are clamped visually.</small></>}</div>
          <p className="summary-caption">{profiles.length} named profiles in the selected view · class reference uses {data.heatmap.classCount} compatible submissions across the selected scope</p>
        </Card><aside className="result-side"><Card className="dimension-summary"><div className="section-heading"><div><span className="eyebrow">CLASS REFERENCE</span><h2>Integrated Needs Profile</h2></div><Badge tone="aqua">n = {data.heatmap.classCount}</Badge></div>{data.heatmap.classMean ? domains.map((code, index) => <div className="dimension-mean" key={code}><span>{SCARF_DOMAIN_NAMES[code]}</span><div className="mean-track"><span style={{ width: `${data.heatmap.classMean![code] * 10}%`, background: needsRankColors[index] }} /></div><strong>{data.heatmap.classMean![code].toFixed(2)}</strong></div>) : <p className="summary-caption">Class values appear after compatible submissions arrive.</p>}<p className="heatmap-context">Same-domain means for this activity or session. Descriptive comparison only; not a population norm.</p></Card>
          <Card className="result-version"><h3>Instrument and scoring</h3><p>Instrument: <code>{data.instrument.version}</code></p><p>Scoring: <code>{data.instrument.scoringVersion}</code></p><p>{data.warning}</p></Card>
          <Card className="dimension-summary scarf-team-heatmap-card"><div className="section-heading"><div><span className="eyebrow">TEAM VIEW</span><h2>Team × domain heatmap</h2></div></div><p className="heatmap-context">Each team’s member-level NeedsIndex values are averaged first. The class reference weights each participant equally.</p>{data.heatmap.teams.length ? <div className="table-scroll"><table className="heatmap-table scarf-team-table"><thead><tr><th>TEAM</th><th>n</th>{domains.map((code) => <th key={code}>{code}</th>)}</tr></thead><tbody>{data.heatmap.teams.map((team) => <tr key={team.name}><th scope="row"><span>{team.name}</span></th><td>{team.count}</td>{domains.map((code) => <td key={code}><ScarfNeedsCell mode={heatMode} value={heatMode === "pattern" ? team.needsRank[code] : team.classDelta?.[code]} /></td>)}</tr>)}</tbody></table></div> : <p className="summary-caption">Team profiles appear when submitted Integrated Needs Profiles are available.</p>}
            <p className="summary-caption">Presenter Mode hides the full team breakdown if any non-empty group has fewer than five submitted people.</p></Card></aside></div>
        {selectedPerson && <Card className="scarf-person-detail"><div className="section-heading"><div><span className="eyebrow">TRAINER-ONLY INDIVIDUAL DETAIL</span><h2>{selectedPerson.displayName}</h2><p>{selectedPerson.teamName ?? "Unassigned"} · {selectedPerson.submittedAt ? new Date(selectedPerson.submittedAt).toLocaleString() : "Submitted"}</p></div><button type="button" className="button button-secondary" onClick={() => setSelectedParticipantId("")}>Close detail</button></div>
          {selectedProfile ? <><p className="heatmap-context">These ranks describe relative preferences within this participant’s own 30-answer profile for this activity.</p><div className="scarf-detail-needs">{domains.map((code) => <div key={code}><span>{SCARF_DOMAIN_NAMES[code]}</span><strong>#{Number.isInteger(selectedProfile.needsRank[code]) ? selectedProfile.needsRank[code] : selectedProfile.needsRank[code].toFixed(1)}</strong><small>Index {selectedProfile.needsIndex[code].toFixed(2)} / 10</small></div>)}</div><div className="scarf-detail-insight"><span className="eyebrow">POSSIBLE SITUATIONS TO EXPLORE</span><h3>{SCARF_INSIGHTS[SCARF_DOMAIN_CODES.reduce((best, code) => selectedProfile.needsIndex[code] > selectedProfile.needsIndex[best] ? code : best, SCARF_DOMAIN_CODES[0])].title}</h3><p>These responses suggest a relative preference in this activity. {SCARF_INSIGHTS[SCARF_DOMAIN_CODES.reduce((best, code) => selectedProfile.needsIndex[code] > selectedProfile.needsIndex[best] ? code : best, SCARF_DOMAIN_CODES[0])].definition}</p></div></> : <p className="heatmap-context">Integrated Needs Profile is not available for this historical scoring version.</p>}
          <details className="scarf-additional-scores"><summary>Additional trainer measures · Reaction Intensity and Driver Priority</summary><div className="table-scroll"><table className="heatmap-table"><thead><tr><th>DOMAIN</th><th>REACTION INTENSITY</th><th>DRIVER PRIORITY</th></tr></thead><tbody>{domains.map((code) => <tr key={code}><th>{SCARF_DOMAIN_NAMES[code]}</th><td>{selectedPerson.reaction?.[code]?.toFixed(2) ?? "—"}</td><td>{selectedPerson.priority?.[code]?.toFixed(4) ?? "—"}</td></tr>)}</tbody></table></div><p className="heatmap-context">These are separate exploratory measures; Driver Priority is relative/ipsative. Neither is a population norm or diagnosis.</p></details>
        </Card>}
      </>}
    </>}
  </div>;
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
  if (activity.data?.activity.tool_id === "scarf-assessment") return <ScarfAnalyticsPage activity={activity.data.activity} />;
  async function setReveal(revealed: boolean) {
    setActionError("");
    try { await post(`/owner/activities/${activityId}/reveal`, { revealed, comparisonBasis: basis, selectedTeamId: teamId || null }); activity.refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update reveal state."); }
  }
  if (loading && !resultData) return <LoadingState label="Preparing the demo results…" />;
  if (error) return <ErrorState message={error} retry={refresh} />;
  const warning = smallGroupWarning(visibleRows.length);
  return <div className="page-stack result-page"><div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ChevronRight size={15} /><span>SCARF Demo</span></div><div className="results-header"><div><span className="eyebrow">DEMO ANALYTICS · PLACEHOLDER SCORING · {activity.data?.activity.session_name ?? "QUICK ACTIVITY"}</span><h1>SCARF Team Results<span className="title-dot">.</span></h1><p>{activity.data?.activity.title ?? "SCARF demo activity"} · {activity.data?.activity.state ?? "unknown"} · {submitted.length} submissions</p></div><div className="results-actions"><Button variant="secondary" to={`/activities/${activityId}/presenter`}>Presenter controls</Button><Button variant="primary" onClick={() => void setReveal(!activity.data?.presentation?.revealed)}>{activity.data?.presentation?.revealed ? "Hide results" : "Reveal results"}</Button></div></div>
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
  const scarfLayer = item?.presentation.scarf_layer ?? "reaction";
  async function update(revealed: boolean) {
    setBusy(true); setError("");
    try { await post(`/owner/activities/${activityId}/reveal`, { revealed, comparisonBasis: basis, selectedTeamId: teamId || null, showNames, scarfLayer }); activity.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update presentation state."); }
    finally { setBusy(false); }
  }
  async function launch() {
    const popup = window.open("about:blank", "_blank");
    setBusy(true); setError("");
    try {
      await post(`/owner/activities/${activityId}/reveal`, { revealed: Boolean(item?.presentation.revealed), comparisonBasis: basis, selectedTeamId: teamId || null, showNames, scarfLayer });
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
  const isScarf = item.activity.tool_id === "scarf-assessment";
  const submitted = Number(item.counts?.submitted ?? 0);
  return <div className="page-stack"><div className="breadcrumb"><Link to={`/activities/${activityId}/live`}>Live Activity</Link><ChevronRight size={15} /><span>Presenter controls</span></div><PageIntro eyebrow="OWNER CONTROL ROOM" title="Presenter Mode" description="Choose the view, decide when to reveal, and keep the room projection-safe." />
    {!isScarf && <DemoNotice compact />}<div className="presenter-control-grid"><Card className="presenter-controls"><div className="section-heading"><div><span className="eyebrow">PRESENTATION CONTROLS</span><h2>{item.activity.title}</h2></div><Radio /></div>
      {!isScarf && <><label className="field-label" htmlFor="presenter-team">Aggregate group</label><select id="presenter-team" className="text-input" value={teamId} onChange={(event) => setTeamOverride(event.target.value)}><option value="">All participants</option>{item.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></>}
      {isScarf ? <div className="privacy-callout"><LockKeyhole size={17} /><span>Presenter shows the Integrated Needs team heatmap only. No names or individual scores are sent. If any team has fewer than five submissions, the team breakdown is hidden.</span></div> : <><span className="field-label">Compare scores</span><div className="segmented-control segmented-wide"><button className={basis === "within_person" ? "active" : ""} onClick={() => setBasisOverride("within_person")}>Within-person pattern</button><button className={basis === "team_relative" ? "active" : ""} onClick={() => setBasisOverride("team_relative")}>Relative to team</button></div><label className="switch-row switch-row-muted"><span><strong>Show names where opted in</strong><small>People who did not opt in stay anonymous.</small></span><input type="checkbox" checked={showNames} onChange={(event) => setShowNamesOverride(event.target.checked)} /><i /></label></>}
      <div className="presenter-action-row"><Button variant={item.presentation.revealed ? "secondary" : "primary"} onClick={() => void update(!item.presentation.revealed)} disabled={busy}>{busy ? "Saving…" : item.presentation.revealed ? "Hide results" : "Reveal results"}</Button><Button variant="yellow" onClick={() => void launch()} disabled={busy} icon={<ArrowRight size={17} />}>Open presenter screen</Button></div>
      {error && <div role="alert" className="inline-error">{error}</div>}{presenterPath && <div className="presenter-share"><span>Private presenter link</span><code>{window.location.origin}{presenterPath}</code><a href={presenterPath} target="_blank" rel="noreferrer">Open this screen <ArrowRight size={15} /></a></div>}
      <p className="presenter-small-note">Trainer controls stay on this screen. The separate presenter link is read-only and contains no owner access.</p>
    </Card><Card className="presenter-summary"><div className="presenter-summary-blue"><Badge tone="aqua">{item.presentation.revealed ? "PRESENTING" : "PRIVATE PREVIEW"}</Badge><h2>{item.presentation.revealed ? "Your patterns are ready." : "A quiet screen, until you’re ready."}</h2><p>{submitted} submitted · {item.teams.length} teams · {item.activity.state}</p><Mascot kind="bean" /></div><div className="presenter-summary-content"><h3>Audience view checklist</h3><ul><li><Check size={17} /> Five SCARF domains</li><li><Check size={17} /> Aggregate group only</li><li><Check size={17} /> No participant rows or names</li><li><Check size={17} /> Groups under five suppressed</li></ul><div className="presenter-warning"><LockKeyhole size={17} /><span>{isScarf ? "Experimental self-reflection scores; not validated or norm-referenced." : "DEMO scores only. They are not a diagnosis, competence rating or norm."}</span></div><Button variant="secondary" to={`/results/${activityId}`}>Open trainer analytics</Button></div></Card></div>
  </div>;
}

type PresenterData = { kind?: "scarf-aggregate"; revealed: boolean; title: string; state?: string; activity?: { title: string; state: string }; presentation?: { comparisonBasis?: string; teamName: string; showNames?: boolean; layer?: string };
  heatmap?: { suppressed: boolean; count: number | null; classMean: ScarfDomainScores | null; teams: Array<{ name: string; count: number; needsIndex: ScarfDomainScores; needsRank: ScarfDomainScores; classDelta: ScarfDomainScores }>;
    teamBreakdownSuppressed: boolean; message?: string };
  group?: { suppressed: boolean; count: number | null; scores: Record<string, number> | null; message?: string }; disclosure?: string; dimensions?: Array<{ code?: string; name: string; mean?: number | null }>;
  rows?: Array<{ label: string; scores: ScarfScores; tiers: Record<ScarfDimension, string> }>; participantCount?: number; warning?: string | null; demoOnly?: boolean; interpretation?: string };

function ScarfAggregatePresenter({ data, fullScreen }: { data: PresenterData; fullScreen: () => void }) {
  const [mode, setMode] = useState<"pattern" | "class">("pattern");
  const heatmap = data.heatmap;
  const codes = scarfDomains;
  return <main className="public-presenter scarf-public-presenter scarf-public-heatmap"><header className="public-presenter-top"><div><BrandMark /><small>{data.activity?.title} · {data.presentation?.teamName ?? "All teams"} · {heatmap?.count ?? 0} responses</small></div><div className="public-presenter-status"><Badge tone="aqua">GROUP HEATMAP</Badge><button className="fullscreen-button" onClick={fullScreen}>Fullscreen <ArrowRight size={15} /></button></div></header>
    <section className="scarf-public-main scarf-presenter-stage"><div className="scarf-presenter-heading"><div><span className="presenter-overline">SCARF · GROUP RESULTS</span><h1>Different teams.<br /><em>Different priorities.</em></h1><h2>Integrated Needs Profile</h2></div><Mascot kind="flower" /></div>
      {heatmap?.suppressed || !heatmap?.classMean ? <div className="scarf-public-suppressed"><LockKeyhole size={26} /><h2>This group view is protected.</h2><p>{heatmap?.message ?? "At least five compatible responses are needed before group results can be shown."}</p></div> : <>
        {heatmap.teams.length > 0 && <div className="scarf-presenter-controls"><div className="segmented-control" role="group" aria-label="Heatmap comparison"><button className={mode === "pattern" ? "active" : ""} onClick={() => setMode("pattern")}>Personal Pattern</button><button className={mode === "class" ? "active" : ""} onClick={() => setMode("class")}>Compared to Class</button></div><span>Class reference · n = {heatmap.count}</span></div>}
        {heatmap.teams.length ? <div className="scarf-presenter-table-wrap"><table className="scarf-presenter-table"><thead><tr><th>TEAM</th>{codes.map((code) => <th key={code}><span>{code}</span>{SCARF_DOMAIN_NAMES[code]}</th>)}</tr></thead><tbody>{heatmap.teams.map((team) => <tr key={team.name}><th><strong>{team.name}</strong><small>{team.count} participants</small></th>{codes.map((code) => <td key={code}><ScarfNeedsCell mode={mode} value={mode === "pattern" ? team.needsRank[code] : team.classDelta[code]} />{mode === "pattern" && <small className="scarf-presenter-index">{team.needsIndex[code].toFixed(1)} index</small>}</td>)}</tr>)}</tbody></table></div> : <div className="scarf-public-score-grid">{codes.map((code, index) => <article className="scarf-public-score" key={code}><span className="scarf-public-domain" style={{ background: needsRankColors[index] }}>{code}</span><span>{SCARF_DOMAIN_NAMES[code]}</span><strong>{heatmap.classMean![code].toFixed(2)}</strong><small>class mean index</small></article>)}</div>}
        {heatmap.teams.length > 0 ? <div className="scarf-presenter-caption">{mode === "pattern" ? "Rank #1 means most relatively favored within each team. Ties are retained." : "Signed difference from the same-domain, participant-weighted class mean. Fixed display range ±3."}</div> : <div className="scarf-presenter-caption">The aggregate Integrated Needs Profile is shown. Team comparisons are hidden because at least one group is too small to display safely.</div>}
      </>}
      <p className="scarf-public-disclosure">{data.disclosure}</p>
    </section></main>;
}

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
  if (data?.kind === "scarf-aggregate" && data.revealed) return <ScarfAggregatePresenter data={data} fullScreen={() => void fullScreen()} />;
  if (!data || !data.revealed) return <div className="public-presenter public-presenter-wait"><div className="public-presenter-top"><BrandMark /><Badge tone="aqua">PRESENTER READY</Badge></div><div className="presenter-wait-card"><span className="eyebrow">FACILITATOR CONTROLLED</span><h1>We’ll begin<br />when you’re ready<span className="title-dot">.</span></h1><p>The trainer is preparing the view. No participant responses are shown while the results are hidden.</p><div className="wait-orbit"><Mascot kind="flower" /></div><span className="polling-label"><span className="live-pulse" /> Checking for an update</span></div><span className="presenter-demo-stamp">TRAINERPOPP!KIT · PRIVATE PRESENTER</span></div>;
  const dataRows = data.rows ?? [];
  const dimensions = data.dimensions ?? [];
  return <main className="public-presenter"><header className="public-presenter-top"><div><BrandMark /><small>{data.activity?.title ?? data.title} · {data.presentation?.teamName ?? "All teams"}</small></div><div className="public-presenter-status"><Badge tone="aqua">PRESENTER LIVE</Badge><span>{data.participantCount ?? 0} submitted</span><button className="fullscreen-button" onClick={() => void fullScreen()}>Fullscreen <ArrowRight size={15} /></button></div></header>
    <div className="presenter-live-grid"><section className="presenter-main-view"><span className="presenter-overline">LET’S TALK ABOUT OUR DIFFERENCES</span><h1>Same team.<br /><em>Different needs.</em></h1><p className="presenter-subhead">{data.activity?.title} · {data.presentation?.comparisonBasis === "within_person" ? "Within-person pattern" : "Relative to team"} · {dataRows.length} profiles shown</p><div className="presenter-dimension-headings"><span>PARTICIPANTS</span>{SCARF_DIMENSIONS.map((dimension, index) => <span key={dimension}><i style={{ background: SCARF_COLORS[index] }} />{dimension}</span>)}</div>
      {dataRows.length ? <div className="presenter-heatmap">{dataRows.map((row, rowIndex) => <div className="presenter-row" key={`${row.label}-${rowIndex}`}><strong>{row.label}</strong>{SCARF_DIMENSIONS.map((dimension) => { const tier = row.tiers[dimension]; return <span className={`presenter-cell ${tierClass(tier)}`} key={dimension}><strong>{row.scores[dimension]?.toFixed(1) ?? "—"}</strong><small>{tier}</small></span>; })}</div>)}</div> : <div className="empty-table"><Users size={25} /><strong>No submitted profiles yet.</strong><span>Come back when participants have finished.</span></div>}
      <div className="heatmap-legend"><span><i className="tier-low" />Lower quartile</span><span><i className="tier-mid" />Middle range</span><span><i className="tier-high" />Upper quartile</span></div>
      <div className="presenter-demo-footer">DEMO DATA · {data.interpretation}</div>
    </section><aside className="presenter-insight-column"><section className="presenter-insight-card insight-blue"><span className="eyebrow">DISCUSSION STARTER ✦</span><h2>What stands out?</h2><p>What might each person need to feel supported by the team?</p><Mascot kind="flower" /></section><section className="presenter-insight-card insight-yellow"><span className="eyebrow">IMPORTANT TO REMEMBER</span><h2>High ≠ good.<br />Low ≠ bad.</h2><p>Colors show relative demo patterns — not performance, competence or value.</p><Mascot kind="sun" /></section><section className="presenter-dimension-summary"><span className="eyebrow">TEAM DEMO AVERAGES</span>{dimensions.map((dimension, index) => <div className="dimension-mean" key={dimension.name}><span>{dimension.name}</span><div className="mean-track"><span style={{ width: `${Number(dimension.mean ?? 0) / 5 * 100}%`, background: SCARF_COLORS[index] }} /></div><strong>{dimension.mean?.toFixed(1) ?? "—"}</strong></div>)}{data.warning && <p className="small-group-warning">{data.warning}</p>}</section></aside></div>
  </main>;
}

type JoinLookup = { activity: { id: string; title: string; toolId?: string; accessSlug?: string; phase?: string; readOnly?: boolean; sessionId?: string | null; sessionName?: string | null; requireName: boolean; releaseMode?: "immediate" | "trainer_released"; demoOnly?: boolean }; teams: Team[]; preselectedTeamId?: string | null };

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
      const lookup = await post<JoinLookup | { session: { name: string; accessSlug: string } }>("/join/lookup", { pin: joinPin });
      if ("session" in lookup) { navigate(`/session/${lookup.session.accessSlug}`); return; }
      if (lookup.activity.toolId === "poll" && lookup.activity.accessSlug) { navigate(`/poll/${lookup.activity.accessSlug}`); return; }
      if (lookup.activity.toolId === "reflection-wall" && lookup.activity.accessSlug) { navigate(`/reflection/${lookup.activity.accessSlug}`); return; }
      sessionStorage.setItem("popp-join-pin", joinPin);
      navigate(`/join/${joinPin}/info`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That activity could not be found."); }
    finally { setPending(false); }
  }
  return <main className="participant-page join-page"><div className="participant-brand"><BrandMark /><Link to="/" className="trainer-entry-link">Trainer sign in <ArrowRight size={15} /></Link></div><section className="join-hero"><span className="eyebrow">NO ACCOUNT NEEDED</span><h1>Join an<br />activity<span className="title-dot">.</span></h1><p>Enter the six-digit code from your trainer, or open the QR link they shared with you.</p><div className="join-mascot"><Mascot kind="popp" /><span className="join-spark">✦</span></div></section><form className="join-code-card" onSubmit={find}><div className="join-mode-tabs"><button type="button" className={entryMode === "code" ? "join-mode-active" : ""} onClick={() => { setEntryMode("code"); setError(""); }}><KeypadIcon />Enter code</button><button type="button" className={entryMode === "link" ? "join-mode-active" : ""} onClick={() => { setEntryMode("link"); setError(""); }}><Link2 size={19} />Open trainer link</button></div>{entryMode === "code" ? <><label className="field-label" htmlFor="join-pin">Activity code</label><div className="pin-entry"><div className="pin-digit-cells" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index}>{pin[index] ?? ""}</span>)}</div><input id="join-pin" className="pin-input" aria-label="Six-digit activity code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} placeholder="000 000" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></div></> : <><label className="field-label" htmlFor="trainer-link">Trainer link</label><input id="trainer-link" className="text-input participant-input" type="url" inputMode="url" placeholder="https://…/join?pin=123456" value={trainerLink} onChange={(event) => setTrainerLink(event.target.value)} required /><span className="join-help">Paste the link shared by your trainer. We’ll check its activity code.</span></>}{error && <div className="inline-error" role="alert">{error}</div>}<Button type="submit" disabled={pending || (entryMode === "code" ? pin.length !== 6 : !trainerLink.trim())} className="full-width">{pending ? "Checking code…" : entryMode === "code" ? "Join activity" : "Continue with link"}</Button>{entryMode === "code" && <span className="join-help">Ask your trainer if you need the code.</span>}</form><div className="participant-bottom-note"><LockKeyhole size={16} /><span className="join-footer-desktop">Temporary guest access · No sign-up or app download</span><span className="join-footer-mobile">No account needed.</span></div></main>;
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
    post<JoinLookup>("/join/lookup", { pin }).then(async (value) => {
      if (!alive) return;
      if (value.activity.toolId === "reflection-wall" && value.activity.accessSlug) { navigate(`/reflection/${value.activity.accessSlug}`); return; }
      let resolved = value;
      if (value.activity.sessionId) {
        const sessionToken = sessionStorage.getItem(`popp-session:${value.activity.sessionId}`);
        if (sessionToken) resolved = await post<JoinLookup>("/join/lookup", { pin, sessionToken });
      }
      if (alive) { setLookup(resolved); setTeamId(resolved.preselectedTeamId ?? ""); setError(""); }
    }).catch((reason) => { if (alive) setError(reason.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pin, navigate]);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!lookup) return; setPending(true); setError("");
    try {
      let sessionToken: string | undefined;
      if (lookup.activity.sessionId) {
        const key = `popp-session:${lookup.activity.sessionId}`;
        sessionToken = sessionStorage.getItem(key) ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
        sessionStorage.setItem(key, sessionToken);
      }
      const isWordCloud = lookup.activity.toolId === "wordcloud";
      const isLearningBehaviors = lookup.activity.toolId === "learning-behaviors-reflection";
      const result = await post<{ token: string; participant: { id: string; activityId: string } }>("/join/enter", { pin, displayName: isWordCloud ? "" : name, role: isWordCloud ? "" : role, teamId: teamId || null, consentNamedResults: isWordCloud || isLearningBehaviors ? false : consentNamed, sessionToken });
      sessionStorage.setItem(`popp-guest:${result.participant.activityId}`, result.token);
      navigate(`/participate/${result.participant.activityId}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join this activity."); }
    finally { setPending(false); }
  }
  if (loading) return <main className="participant-page"><BrandMark /><LoadingState label="Checking your activity code…" /></main>;
  if (!lookup) return <main className="participant-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error || "This activity is not available."} /><Button variant="secondary" to="/join">Try another code</Button></div></main>;
  const isWordCloud = lookup.activity.toolId === "wordcloud";
  const isLearningBehaviors = lookup.activity.toolId === "learning-behaviors-reflection";
  return <main className="participant-page participant-info-page"><div className="participant-brand"><BrandMark /></div><Link to={`/join?pin=${pin}`} className="back-circle" aria-label="Back to code"><ArrowLeftIcon /></Link><div className="participant-progress"><div className="step-dots"><i /><i className="active" /><i /><i /></div><span>STEP 2 OF 4</span></div><section className="participant-info-heading"><h1>{isWordCloud ? <>Join the<br />Word Cloud</> : <>Tell us a bit<br />about you</>}</h1><p>{isWordCloud ? "No name is needed. Your words will be anonymous." : "This helps make the activity more relevant for everyone."}</p><div className="info-mascot"><Mascot kind="bean" /></div></section><form className="participant-info-form" onSubmit={join}>{!isWordCloud && <><label className="field-label" htmlFor="guest-name">Your name {lookup.activity.requireName && <b>*</b>}</label><input id="guest-name" className="text-input participant-input" autoComplete="name" maxLength={60} placeholder={lookup.activity.requireName ? "Enter your name" : "Optional"} value={name} onChange={(event) => setName(event.target.value)} required={lookup.activity.requireName} />
    <label className="field-label" htmlFor="guest-role">Your role <small>(optional)</small></label><input id="guest-role" className="text-input participant-input" maxLength={60} placeholder="e.g. Team member, Manager, Designer..." value={role} onChange={(event) => setRole(event.target.value)} /></>}
    {lookup.teams.length > 0 && <><span className="field-label team-choice-label">Choose your team</span><div className="participant-team-grid">{lookup.teams.map((team, index) => <button type="button" key={team.id} className={`participant-team-card ${teamId === team.id ? "team-selected" : ""}`} style={{ "--team-bg": `${TEAM_PALETTE[index % TEAM_PALETTE.length]}66` } as CSSProperties} onClick={() => setTeamId(teamId === team.id ? "" : team.id)}><span className="team-radio">{teamId === team.id && <i />}</span><strong>{team.name}</strong><Mascot kind={index === 0 ? "bean" : index === 1 ? "sun" : "flower"} /></button>)}</div></>}
    {lookup.activity.toolId !== "scarf-assessment" && !isWordCloud && !isLearningBehaviors && <label className="consent-card"><input type="checkbox" checked={consentNamed} onChange={(event) => setConsentNamed(event.target.checked)} /><span className="consent-check"><Check size={16} /></span><span><strong>Allow my name on the presenter screen</strong><small>Your name stays hidden unless you opt in and your trainer enables it. Responses stay private.</small></span></label>}
    {isLearningBehaviors && <div className="privacy-callout"><LockKeyhole size={17} /><span>Your trainer can review your Self ratings, peer ratings, Quick Notes, reflection, and actions. Peer responses do not identify the respondent, and Presenter Mode shows only group Self averages.</span></div>}
    {lookup.activity.toolId === "scarf-assessment" && <div className="privacy-callout"><LockKeyhole size={17} /><span>Your trainer can see your named results. Presenter Mode shows protected group summaries only. This instrument is experimental and not validated.</span></div>}
    {isWordCloud && <div className="privacy-callout"><LockKeyhole size={17} /><span>Your name is not requested. Word Cloud responses are stored without a participant identity and only anonymous group totals are shown to your trainer.</span></div>}
    {error && <div className="inline-error" role="alert">{error}</div>}<Button type="submit" disabled={pending || (!isWordCloud && !name.trim() && lookup.activity.requireName)} className="full-width participant-continue">{pending ? "Joining…" : "Continue"}</Button></form><div className="participant-bottom-note"><LockKeyhole size={16} /> No account needed · Temporary activity access</div></main>;
}

function ArrowLeftIcon() { return <span aria-hidden="true">←</span>; }

type GuestActivityData = { activity: { id: string; title: string; state: string; toolId?: string; resultPolicy: "trainer_reveal" | "immediate" | "confirmation" }; participant: { displayName: string }; items: typeof DEMO_ITEMS; answers: Record<string, number>; disclosure: string };

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
  if (data.activity.toolId === "scarf-assessment") return <ScarfParticipantRunner activityId={activityId} token={token} />;
  if (data.activity.toolId === "wordcloud") return <WordCloudParticipantRunner activityId={activityId} token={token} />;
  if (data.activity.toolId === "learning-behaviors-reflection") return <LearningBehaviorsParticipantPage activityId={activityId} token={token} />;
  if (error && data.activity.state === "closed") return <main className="participant-page runner-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error} /><p>Your saved answers remain attached to your activity link.</p></div></main>;
  const item = DEMO_ITEMS[step]!;
  const total = DEMO_ITEMS.length;
  return <main className="participant-page runner-page"><header className="runner-top">
    <button className="runner-back-circle" type="button" onClick={() => { if (step > 0) setStep((value) => value - 1); else navigate(-1); }} aria-label={step > 0 ? "Previous question" : "Back to participant details"}><ArrowLeft size={21} /></button>
    <div className="runner-heading-mark"><div className="runner-scarf-letters" aria-label="SCARF"><b>S</b><b>C</b><b>A</b><b>R</b><b>F</b></div><span>Assessment<small>{data.participant.displayName}</small></span></div>
    <span className="runner-step">Question {step + 1} of {total}</span>
  </header><div className="runner-progress-row"><div className="runner-progress"><span style={{ width: `${(step + 1) / total * 100}%` }} /></div><span className="runner-percent">{Math.round((step + 1) / total * 100)}%</span></div>
    <div className="runner-content"><div className="runner-art" aria-hidden="true"><span className="runner-art-spark">✦</span><Mascot kind="sun" /></div><section className="runner-question-card">
      <div className="runner-question-meta"><Badge tone="yellow">{item.dimension}</Badge><span className="runner-demo-tag"><strong>DEMO ONLY</strong><span>Placeholder content · scoring not validated</span></span></div><h1>{item.prompt}</h1><p className="runner-explainer">Choose one response.</p><div className="likert-options" role="radiogroup" aria-label={`Response for ${item.dimension}`}>
      {[{ value: 1, label: "Strongly disagree" }, { value: 2, label: "Disagree" }, { value: 3, label: "Neither agree nor disagree" }, { value: 4, label: "Agree" }, { value: 5, label: "Strongly agree" }].map((choice) => <button type="button" key={choice.value} role="radio" aria-checked={answers[item.id] === choice.value} className={`likert-option likert-option-${choice.value} ${answers[item.id] === choice.value ? "likert-selected" : ""}`} onClick={() => { setAnswers({ ...answers, [item.id]: choice.value }); setError(""); setSaved(false); }}><span className="likert-choice-art"><FaceIcon level={choice.value} /><i /></span><span>{choice.label}</span></button>)}
      </div>{error && <div className="inline-error" role="alert">{error}</div>}{saved && <div className="saved-status" role="status"><Check size={16} /> Saved. You can return to this activity on this device.</div>}
      <div className="runner-actions"><Button variant="secondary" disabled={busy || step === 0} onClick={() => { setStep((value) => value - 1); setError(""); }}>Back</Button>{step < total - 1 ? <Button onClick={() => void move(step + 1)} disabled={busy || !answers[item.id]}>{busy ? "Saving…" : "Next"}</Button> : <Button onClick={() => void submit()} disabled={busy || !answers[item.id]}>{busy ? "Submitting…" : "Submit demo answers"}</Button>}</div><button className="save-later-button" onClick={() => void saveForLater()} disabled={busy}><LockKeyhole size={16} />Save &amp; continue later</button>
      <p className="runner-version">Demo items · scoring not validated</p>
    </section></div></main>;
}

function ActivityResultMini({ scores }: { scores: ScarfScores }) {
  return <div className="personal-result-bars">{SCARF_DIMENSIONS.map((dimension, index) => <div className="personal-score" key={dimension}><strong>{scores[dimension].toFixed(1)}</strong><span className="personal-bar" style={{ "--bar-value": `${scores[dimension] / 5 * 100}%`, "--dimension": SCARF_COLORS[index] } as CSSProperties} /><small>{dimension}</small></div>)}</div>;
}

function ActivityResultPlaceholder() {
  return <div className="personal-result-bars">{SCARF_DIMENSIONS.map((dimension, index) => <div className="personal-score" key={dimension}><strong>—</strong><span className="personal-bar personal-bar-hidden" style={{ "--bar-value": "58%", "--dimension": SCARF_COLORS[index] } as CSSProperties} /><small>{dimension}</small></div>)}</div>;
}

function FaceIcon({ level }: { level: number }) {
  const mouth = ["M31 68 Q50 47 69 68", "M33 65 Q50 55 67 65", "M34 63 H66", "M33 62 Q50 74 67 62", "M31 60 Q50 83 69 60"][level - 1];
  return <svg aria-hidden="true" viewBox="0 0 100 100" className={`likert-face likert-face-${level}`}><path d="M50 2 C65 1 70 8 81 9 C94 11 99 23 98 38 L98 66 C98 85 85 97 67 98 L34 98 C14 98 2 86 2 67 L2 34 C2 16 13 5 31 4 Z" fill="currentColor"/><ellipse cx="37" cy="43" rx="6" ry="8" fill="#1f1f1f"/><ellipse cx="63" cy="43" rx="6" ry="8" fill="#1f1f1f"/><path d={mouth} fill="none" stroke="#1f1f1f" strokeWidth="5" strokeLinecap="round" /></svg>;
}

export function ParticipantDonePage() {
  const { activityId = "" } = useParams();
  const token = sessionStorage.getItem(`popp-guest:${activityId}`);
  const [me, setMe] = useState<{ participant: { displayName: string }; activity: { title: string; resultPolicy: string; toolId?: string } } | null>(null);
  const [result, setResult] = useState<{ visible: boolean; reason?: string; scores?: ScarfScores; demoOnly?: boolean } | null>(null);
  const [error, setError] = useState(token ? "" : "Your participant link is no longer available. Ask your trainer for the activity code.");
  useEffect(() => {
    if (!token) return;
    let alive = true;
    async function load() {
      try {
        const [profile, personal] = await Promise.all([
          api<{ participant: { displayName: string }; activity: { title: string; resultPolicy: string; toolId?: string } }>("/guest/me", { headers: { Authorization: `Bearer ${token}` } }),
          api<{ visible: boolean; reason?: string; scores?: ScarfScores; demoOnly?: boolean }>("/guest/results", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (alive) { setMe(profile); setResult(personal); setError(""); }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not load your result."); }
    }
    void load(); const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activityId, token]);
  if (me?.activity.toolId === "scarf-assessment" && token) return <ScarfParticipantDone activityId={activityId} token={token} />;
  const policy = me?.activity.resultPolicy;
  return <main className="participant-page done-page"><div className="participant-brand"><BrandMark /></div><div className="done-hero"><div className="done-mascot"><Mascot kind="sun" /></div><span className="eyebrow">{me?.activity.title ?? "ACTIVITY COMPLETE"}</span><h1>All done<span className="title-dot">!</span></h1><p className="done-thanks">Your demo responses have been recorded.</p></div>{error && <div className="inline-error" role="alert">{error}</div>}
    <section className="done-result-status" id="results-status"><div className="done-status-mascot"><Mascot kind="flower" /></div><div className="done-status-copy">{policy === "confirmation" ? <><span className="eyebrow">RESULTS STATUS</span><h2>Thanks for taking part.</h2><p>Your trainer has chosen to show a confirmation only. Your answers remain private.</p></> : result?.visible && result.scores ? <><span className="eyebrow">RESULTS STATUS</span><h2>Your trainer has revealed your personal snapshot.</h2><p>Your responses stay private to you.</p></> : <><span className="eyebrow">RESULTS STATUS</span><h2>Your trainer will reveal the results when it’s time.</h2><p>In the meantime, feel free to return to the waiting room.</p><span className="polling-label"><span className="live-pulse" /> Waiting for the trainer’s reveal</span><a className="waiting-room-button" href="#results-status"><ArrowLeft size={18} />Back to waiting room</a></>}</div></section>
    {policy !== "confirmation" && <section className={`personal-snapshot-card ${result?.visible && result.scores ? "" : "personal-snapshot-locked"}`} id="personal-snapshot"><div className="personal-snapshot-heading"><div><h2>Your personal snapshot</h2><span>DEMO ONLY · {result?.visible ? "placeholder prompts · scoring not validated" : "visible when your trainer allows it"}</span></div><span className="personal-snapshot-eye">◉</span></div>{result?.visible && result.scores ? <ActivityResultMini scores={result.scores} /> : <ActivityResultPlaceholder />}<button className="button button-primary full-width" type="button" disabled={!result?.visible || !result.scores}>{result?.visible && result.scores ? <>View personal result <ArrowRight size={18} /></> : <>Waiting for reveal <LockKeyhole size={16} /></>}</button><p className="personal-result-caption">{result?.visible ? "These demo values come from placeholder questions and are not a validated assessment." : "Your personal values stay private until your trainer reveals them."}</p></section>}
    <div className="participant-bottom-note"><LockKeyhole size={16} /> No account · Temporary access for this activity</div></main>;
}
