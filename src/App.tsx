import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Archive, BookOpen, CalendarDays, CircleHelp, Home, LogOut, Menu, Radio, Search, Settings, X,
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
  { to: "/", label: "Home", icon: Home },
  { to: "/tools", label: "My Tools", icon: BookOpen },
  { to: "/sessions", label: "My Sessions", icon: CalendarDays },
  { to: "/live", label: "Live Activity", icon: Radio },
  { to: "/archive", label: "Archive / Results", icon: Archive },
];

function OwnerLayout() {
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(`/tools${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ""}`);
    setMobileOpen(false);
  }

  return <div className="owner-app">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <Link to="/" className="sidebar-brand" aria-label="TrainerPopp!Kit home"><BrandMark /></Link>
      <nav className="side-nav" aria-label="Trainer navigation">
        {navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `side-link ${isActive ? "side-link-active" : ""}`} onClick={() => setMobileOpen(false)}><Icon size={21} strokeWidth={2.3} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-character"><Mascot kind="flower" /></div>
      <div className="sidebar-bottom"><button type="button" className="side-link side-action" onClick={() => navigate("/settings")}><Settings size={20} /><span>Settings</span></button><button type="button" className="trainer-chip" onClick={() => void signOut()}><span className="trainer-avatar"><Mascot kind="bean" /></span><span><strong>My Trainer Space</strong><small>Owner account</small></span><LogOut size={17} /></button></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><button className="mobile-menu" aria-label={mobileOpen ? "Close menu" : "Open menu"} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button>
        <form className="top-search" onSubmit={search}><Search size={17} /><input aria-label="Search tools" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools, sessions, activities…" /><button aria-label="Search" type="submit"><Search size={16} /></button></form>
        <div className="topbar-actions"><Button variant="orange" to="/activities/new">Create activity</Button><button className="help-button" title="Help and guidance" onClick={() => window.alert("TrainerPopp!Kit is a personal facilitation workspace. Participant results stay private until you reveal them.")}><CircleHelp size={19} /></button></div>
      </header>
      <main className="owner-content"><Outlet /></main>
    </div>
    {mobileOpen && <button aria-label="Close navigation" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
  </div>;
}

function AppRoutes() {
  return <Routes>
    <Route path="/join" element={<JoinPage />} />
    <Route path="/join/:pin/info" element={<ParticipantInfoPage />} />
    <Route path="/participate/:activityId" element={<ParticipantRunnerPage />} />
    <Route path="/participate/:activityId/done" element={<ParticipantDonePage />} />
    <Route path="/presenter" element={<PublicPresenterPage />} />
    <Route element={<OwnerGate />}>
      <Route element={<OwnerLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/scarf" element={<ScarfDetailPage />} />
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
  const [items, setItems] = useState<Array<{ id: string; title: string; state: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { api<{ activities: typeof items }>("/owner/activities").then((data) => setItems(data.activities.filter((activity) => ["open", "paused"].includes(activity.state)))).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingState label="Checking live activities…" />;
  if (error) return <ErrorState message={error} />;
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">LIVE ROOM</span><h1>Live Activity<span className="title-dot">.</span></h1><p>Monitor progress and control what participants can see.</p></div><Button to="/activities/new">New activity</Button></div>{items.length === 0 ? <div className="card"><div className="empty-state"><div className="empty-spark"><Radio /></div><h3>No live activities</h3><p>Launch an activity to welcome participants into the room.</p><Button to="/activities/new">Set up an activity</Button></div></div> : <div className="activity-list">{items.map((item) => <a className="activity-row" key={item.id} href={`/activities/${item.id}/live`}><div className="activity-icon"><Radio /></div><div className="activity-row-main"><strong>{item.title}</strong><small>{item.state === "open" ? "Accepting participants" : "Paused"}</small></div><Button variant="quiet">Open live room</Button></a>)}</div>}</div>;
}

function SettingsPage() {
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Settings<span className="title-dot">.</span></h1><p>Personal trainer workspace and privacy defaults.</p></div></div><section className="card settings-card"><h2>Owner access</h2><p>Owner routes are protected by a signed, HTTP-only session cookie. Configure your password and signing secret as Worker secrets before deployment.</p><div className="setting-row"><span><strong>Participant access</strong><small>Temporary, activity-scoped guest tokens</small></span><span className="setting-status">Enabled for open activities</span></div><div className="setting-row"><span><strong>Projector names</strong><small>Hidden unless you turn them on and each person has opted in</small></span><span className="setting-status">Anonymous by default</span></div><div className="setting-row"><span><strong>SCARF module</strong><small>Placeholder content; no official questionnaire or scoring</small></span><span className="setting-status status-demo">DEMO ONLY</span></div></section></div>;
}

function NotFoundPage() {
  return <div className="card"><div className="empty-state"><Mascot kind="sun" className="not-found-mascot" /><h2>We can’t find that page.</h2><p>Head back to your trainer space and keep planning.</p><Button to="/">Go home</Button></div></div>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
