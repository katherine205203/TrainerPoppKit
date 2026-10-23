import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, LogOut, Menu, Plus, Radio, Search, Settings, X,
} from "lucide-react";
import { api, post } from "./api";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./auth-context";
import { BrandMark, Button, ErrorState, LoadingState, Mascot } from "./components";
import {
  ActivitySetupPage, ActivityLivePage, ActivityResultPage, CreateSessionPage, HomePage,
  JoinPage, ParticipantInfoPage, ParticipantRunnerPage, ParticipantDonePage, PresenterConsolePage,
  PublicPresenterPage, ScarfDetailPage, SessionDetailPage, SessionsPage, ToolsPage, ArchivePage,
} from "./pages";
import { ScarfPersonalResultsPage } from "./scarf-participant";
import { PollControlPage, PollEditorPage, PollParticipantPage, PollPresenterControlsPage, PollPublicPresenterPage, PollResultsPage, PollSessionJoinPage, PollToolOverviewPage } from "./poll-pages";
import { WordCloudControlPage, WordCloudEditorPage, WordCloudOverviewPage, WordCloudPresenterControlsPage, WordCloudPublicPresenterPage, WordCloudResultsPage } from "./wordcloud-pages";
import { ReflectionWallControlPage, ReflectionWallEditorPage, ReflectionWallParticipantPage, ReflectionWallPublicPresenterPage, ReflectionWallToolOverviewPage } from "./reflection-wall-pages";

const LearningBehaviorsAnalyticsPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsAnalyticsPage })));
const LearningBehaviorsControlPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsControlPage })));
const LearningBehaviorsIndividualPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsIndividualPage })));
const LearningBehaviorsParticipantResultsPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsParticipantResultsPage })));
const LearningBehaviorsPeerPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsPeerPage })));
const LearningBehaviorsPublicPresenterPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsPublicPresenterPage })));
const LearningBehaviorsQuickNotePage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsQuickNotePage })));
const LearningBehaviorsSetupPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsSetupPage })));
const LearningBehaviorsToolOverviewPage = lazy(() => import("./learning-behaviors-pages").then((module) => ({ default: module.LearningBehaviorsToolOverviewPage })));

function LoginPage() {
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await post("/auth/login", { password });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page">
    <div className="login-art"><BrandMark /><div className="login-message"><span>MAKE MOMENTS</span><strong>pop.</strong><p>Your facilitation space is ready when you are.</p><Mascot kind="flower" className="login-mascot" /></div><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /></div>
    <form className="login-card" onSubmit={signIn}>
      <span className="eyebrow">TRAINER SPACE</span><h1>Welcome back<span className="title-dot">.</span></h1><p>Sign in to manage sessions and activities.</p>
      <label className="field-label" htmlFor="owner-password">Owner password</label>
      <input id="owner-password" className="text-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <Button type="submit" disabled={pending} className="full-width">{pending ? "Signing in…" : "Sign in"}</Button>
      <div className="login-lock"><span className="lock-dot" /> Single-owner workspace · Protected by server-side sign-in</div>
    </form>
  </main>;
}

function OwnerGate() {
  const { authenticated } = useAuth();
  const location = useLocation();
  if (!authenticated) return <LoginPage key={location.pathname} />;
  return <Outlet />;
}

const navItems = [
  { to: "/", label: "Home", shape: "home" },
  { to: "/tools", label: "My Tools", shape: "tools" },
  { to: "/sessions", label: "My Sessions", shape: "sessions" },
  { to: "/live", label: "Live Activity", shape: "live" },
  { to: "/archive", label: "Archive / Results", shape: "archive" },
];

function NavShape({ shape }: { shape: string }) {
  if (shape === "tools") return <svg aria-hidden="true" className="nav-shape" viewBox="0 0 28 28"><circle cx="9" cy="9" r="7" /><circle cx="19" cy="9" r="7" /><circle cx="9" cy="19" r="7" /><circle cx="19" cy="19" r="7" /></svg>;
  if (shape === "live") return <svg aria-hidden="true" className="nav-shape" viewBox="0 0 28 28"><circle cx="14" cy="8" r="7" /><circle cx="14" cy="20" r="7" /></svg>;
  return <span aria-hidden="true" className={`nav-shape nav-shape-${shape}`} />;
}

function OwnerLayout() {
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const isToolWorkspace = location.pathname.startsWith("/tools/")
    || /^\/(?:activities\/(?:new|[^/]+\/(?:live|presenter))|results\/[^/]+|polls(?:\/|$)|wordclouds(?:\/|$)|reflection-walls(?:\/|$)|learning-behaviors(?:\/|$))/.test(location.pathname);
  const isQuietWorkspace = isToolWorkspace || location.pathname === "/archive" || /^\/sessions(?:\/|$)/.test(location.pathname);

  function showHelp() {
    window.alert("TrainerPopp!Kit is a personal facilitation workspace. Participant results stay private until you reveal them.");
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const destination = location.pathname.startsWith("/sessions") ? "/sessions" : "/tools";
    navigate(`${destination}${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ""}`);
    setMobileOpen(false);
  }

  return <div className="owner-app">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <Link to="/" className="sidebar-brand" aria-label="TrainerPopp!Kit home"><BrandMark /></Link>
      <nav className="side-nav" aria-label="Trainer navigation">
        {navItems.map(({ to, label, shape }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `side-link ${isActive ? "side-link-active" : ""}`} onClick={() => setMobileOpen(false)}><NavShape shape={shape} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-character"><Mascot kind="flower" /></div>
      <div className="sidebar-bottom"><button type="button" className="side-link side-action notification-side-action" aria-label="Help and guidance" title="Help and guidance" onClick={showHelp}><Bell size={20} /><span>Help and guidance</span><i className="sidebar-notification-dot" /></button><button type="button" className="side-link side-action" onClick={() => navigate("/settings")}><Settings size={20} /><span>Settings</span></button><button type="button" className="trainer-chip" onClick={() => void signOut()}><span className="trainer-avatar"><Mascot kind="bean" /></span><span><strong>My Trainer Space</strong><small>Owner account</small></span><LogOut size={17} /></button></div>
    </aside>
    <div className="main-column">
      <header className={`topbar ${isQuietWorkspace ? "topbar-quiet" : ""}`}><button className="mobile-menu" aria-label={mobileOpen ? "Close menu" : "Open menu"} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button>
        {!isQuietWorkspace && <form className="top-search" onSubmit={search}><Search size={15} /><input aria-label="Search tools" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools, sessions, or anything…" /></form>}
        {!isQuietWorkspace && <div className="topbar-actions"><Button variant="orange" to="/activities/new" icon={<Plus size={14} />}>Create activity</Button></div>}
      </header>
      <main className="owner-content"><Outlet /></main>
    </div>
    {mobileOpen && <button aria-label="Close navigation" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
  </div>;
}

function PresenterRoute() {
  const [kind, setKind] = useState<"poll" | "wordcloud" | "reflection-wall" | "learning-behaviors-reflection" | "standard" | "loading">("loading");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    api<{ kind?: string }>("/presenter", { headers: { Authorization: `Bearer ${token}` } })
      .then((data) => setKind(data.kind === "poll" ? "poll" : data.kind === "wordcloud" ? "wordcloud" : data.kind === "reflection-wall" ? "reflection-wall" : data.kind === "learning-behaviors-reflection" ? "learning-behaviors-reflection" : "standard"))
      .catch(() => setKind("standard"));
  }, []);
  if (kind === "loading") return <div className="public-presenter"><LoadingState label="Connecting to the presenter screen…" /></div>;
  if (kind === "learning-behaviors-reflection") return <Suspense fallback={<main className="lbr-public-presenter"><LoadingState label="Connecting to Presenter Mode…" /></main>}><LearningBehaviorsPublicPresenterPage /></Suspense>;
  return kind === "poll" ? <PollPublicPresenterPage /> : kind === "wordcloud" ? <WordCloudPublicPresenterPage /> : kind === "reflection-wall" ? <ReflectionWallPublicPresenterPage /> : <PublicPresenterPage />;
}

function AppRoutes() {
  return <Routes>
    <Route path="/join" element={<JoinPage />} />
    <Route path="/join/:pin/info" element={<ParticipantInfoPage />} />
    <Route path="/session/:accessSlug" element={<PollSessionJoinPage />} />
    <Route path="/poll/:accessSlug" element={<PollParticipantPage />} />
    <Route path="/reflection/:accessSlug" element={<ReflectionWallParticipantPage />} />
    <Route path="/participate/:activityId/lbr/peer/:roundId" element={<Suspense fallback={<main className="lbr-participant-screen"><LoadingState label="Opening the peer form…" /></main>}><LearningBehaviorsPeerPage /></Suspense>} />
    <Route path="/participate/:activityId/lbr/note/:roundId" element={<Suspense fallback={<main className="lbr-participant-screen"><LoadingState label="Opening your Quick Note…" /></main>}><LearningBehaviorsQuickNotePage /></Suspense>} />
    <Route path="/participate/:activityId/lbr/results" element={<Suspense fallback={<main className="lbr-participant-screen"><LoadingState label="Opening your results…" /></main>}><LearningBehaviorsParticipantResultsPage /></Suspense>} />
    <Route path="/participate/:activityId" element={<Suspense fallback={<main className="participant-page runner-page"><LoadingState label="Opening your activity…" /></main>}><ParticipantRunnerPage /></Suspense>} />
    <Route path="/participate/:activityId/done" element={<ParticipantDonePage />} />
    <Route path="/participate/:activityId/results" element={<ScarfPersonalResultsPage />} />
    <Route path="/presenter" element={<Suspense fallback={<main className="public-presenter"><LoadingState label="Connecting to the presenter screen…" /></main>}><PresenterRoute /></Suspense>} />
    <Route element={<OwnerGate />}>
      <Route element={<OwnerLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/scarf" element={<ScarfDetailPage />} />
        <Route path="/tools/poll" element={<PollToolOverviewPage />} />
        <Route path="/tools/wordcloud" element={<WordCloudOverviewPage />} />
        <Route path="/tools/reflection-wall" element={<ReflectionWallToolOverviewPage />} />
        <Route path="/tools/learning-behaviors" element={<Suspense fallback={<LoadingState label="Opening Learning Behaviors Reflection…" />}><LearningBehaviorsToolOverviewPage /></Suspense>} />
        <Route path="/learning-behaviors/new" element={<Suspense fallback={<LoadingState label="Opening activity setup…" />}><LearningBehaviorsSetupPage /></Suspense>} />
        <Route path="/learning-behaviors/:activityId/edit" element={<Suspense fallback={<LoadingState label="Opening activity setup…" />}><LearningBehaviorsSetupPage /></Suspense>} />
        <Route path="/learning-behaviors/:activityId/analytics" element={<Suspense fallback={<LoadingState label="Opening analytics…" />}><LearningBehaviorsAnalyticsPage /></Suspense>} />
        <Route path="/learning-behaviors/:activityId/participants/:participantId" element={<Suspense fallback={<LoadingState label="Opening participant detail…" />}><LearningBehaviorsIndividualPage /></Suspense>} />
        <Route path="/learning-behaviors/:activityId" element={<Suspense fallback={<LoadingState label="Opening live controls…" />}><LearningBehaviorsControlPage /></Suspense>} />
        <Route path="/reflection-walls/new" element={<ReflectionWallEditorPage />} />
        <Route path="/reflection-walls/:activityId/edit" element={<ReflectionWallEditorPage />} />
        <Route path="/reflection-walls/:activityId" element={<ReflectionWallControlPage />} />
        <Route path="/wordclouds/new" element={<WordCloudEditorPage />} />
        <Route path="/wordclouds/:activityId/edit" element={<WordCloudEditorPage />} />
        <Route path="/wordclouds/:activityId/results" element={<WordCloudResultsPage />} />
        <Route path="/wordclouds/:activityId/presenter" element={<WordCloudPresenterControlsPage />} />
        <Route path="/wordclouds/:activityId" element={<WordCloudControlPage />} />
        <Route path="/polls/new" element={<PollEditorPage />} />
        <Route path="/polls/:activityId/edit" element={<PollEditorPage />} />
        <Route path="/polls/:activityId/results" element={<PollResultsPage />} />
        <Route path="/polls/:activityId/presenter" element={<PollPresenterControlsPage />} />
        <Route path="/polls/:activityId" element={<PollControlPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/new" element={<CreateSessionPage />} />
        <Route path="/sessions/:sessionId/edit" element={<CreateSessionPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/activities/new" element={<ActivitySetupPage />} />
        <Route path="/activities/:activityId/live" element={<ActivityLivePage />} />
        <Route path="/activities/:activityId/presenter" element={<PresenterConsolePage />} />
        <Route path="/results/:activityId" element={<ActivityResultPage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/live" element={<ActivityLiveIndex />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Routes>;
}

function ActivityLiveIndex() {
  const [items, setItems] = useState<Array<{ id: string; title: string; state: string; tool_id?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { api<{ activities: typeof items }>("/owner/activities").then((data) => setItems(data.activities.filter((activity) => ["open", "paused"].includes(activity.state)))).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingState label="Checking live activities…" />;
  if (error) return <ErrorState message={error} />;
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">LIVE ROOM</span><h1>Live Activity<span className="title-dot">.</span></h1><p>Monitor progress and control what participants can see.</p></div><Button to="/activities/new">New activity</Button></div>{items.length === 0 ? <div className="card"><div className="empty-state"><div className="empty-spark"><Radio /></div><h3>No live activities</h3><p>Launch an activity to welcome participants into the room.</p><Button to="/activities/new">Set up an activity</Button></div></div> : <div className="activity-list">{items.map((item) => <Link className="activity-row" key={item.id} to={item.tool_id === "wordcloud" ? `/wordclouds/${item.id}` : item.tool_id === "poll" ? `/polls/${item.id}` : item.tool_id === "reflection-wall" ? `/reflection-walls/${item.id}` : `/activities/${item.id}/live`}><div className="activity-icon"><Radio /></div><div className="activity-row-main"><strong>{item.title}</strong><small>{item.state === "open" ? "Accepting participants" : "Paused"}</small></div><Button variant="quiet">Open live room</Button></Link>)}</div>}</div>;
}

function SettingsPage() {
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Settings<span className="title-dot">.</span></h1><p>Personal trainer workspace and privacy defaults.</p></div></div><section className="card settings-card"><h2>Owner access</h2><p>Owner routes are protected by a signed, HTTP-only session cookie. Configure your password and signing secret as Worker secrets before deployment.</p><div className="setting-row"><span><strong>Participant access</strong><small>Temporary, activity-scoped guest tokens</small></span><span className="setting-status">Enabled for open activities</span></div><div className="setting-row"><span><strong>Presenter privacy</strong><small>SCARF and Word Cloud presenter screens contain aggregate data only</small></span><span className="setting-status">Word Cloud has no minimum group size</span></div><div className="setting-row"><span><strong>SCARF module</strong><small>Question bank v0.2 · Experimental and not validated</small></span><small className="setting-note">Unvalidated self-reflection tool</small></div><div className="setting-row"><span><strong>Word Cloud</strong><small>Anonymous response aggregation · contextual privacy risk in very small teams</small></span><span className="setting-status">Available</span></div></section></div>;
}

function NotFoundPage() {
  return <div className="card"><div className="empty-state"><Mascot kind="sun" className="not-found-mascot" /><h2>We can’t find that page.</h2><p>Head back to your trainer space and keep planning.</p><Button to="/">Go home</Button></div></div>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
