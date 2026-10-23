import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BarChart3, Check, CircleHelp, Copy, Download, ExternalLink, Eye, EyeOff, LockKeyhole, Play, Plus, Radio, RotateCcw, Trash2, Users, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, BrandMark, Button, Card, EmptyState, ErrorState, LoadingState, Mascot, PageIntro, ToolPageHeader } from "./components";

type PollOption = { id: string; label: string; sortOrder: number; isOther: boolean };
type PollResultBar = { optionId: string; label: string; isOther: boolean; count: number; percentage: number };
type PollRecord = {
  activityId: string; sessionId: string | null; sessionName: string | null; sessionStatus?: string | null;
  title: string; question: string; questionType: "single" | "multiple"; maxSelections: number; allowOther: boolean;
  identityMode: "anonymous" | "named"; participantResultsMode: "presenter_only" | "presenter_and_participant";
  revealState: "hidden" | "revealed"; state: string; accessSlug: string; joinPin: string | null;
  version: number; reopenCount: number; reopenedAt: string | null; archivedSession?: boolean;
};
type PollDetail = { poll: PollRecord; options: PollOption[]; counts: { joined: number; submitted: number; respondents: number; eligible: number; completionRate: number | null }; results: PollResultBar[];
  participants: Array<{ displayName: string; status: string; teamName: string | null }>;
  otherResponses: string[]; namedResponses: Array<{ displayName: string; teamName: string | null; selections: string[]; otherText: string | null; submittedAt: string; updatedAt: string }> };
type PollListItem = { activity_id: string; session_id: string | null; title: string; state: string; join_pin: string | null; session_name: string | null; question: string; question_type: string; identity_mode: string; reveal_state: string; access_slug: string; participant_results_mode: string; respondent_count: number; completed_count: number };
type SessionItem = { id: string; name: string };

function usePollData<T>(path: string, interval = 0, bearer?: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api<T>(path, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {});
        if (active) { setData(result); setError(""); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not load Poll data."); }
      finally { if (active) setLoading(false); }
    };
    void load();
    if (interval) {
      const timer = window.setInterval(() => void load(), interval);
      return () => { active = false; window.clearInterval(timer); };
    }
    return () => { active = false; };
  }, [path, interval, bearer, refreshKey]);
  return { data, loading, error, refresh };
}

function StateBadge({ state }: { state: string }) {
  const tone = state === "open" ? "green" : state === "closed" || state === "archived" ? "gray" : "purple";
  const label = state === "open" ? "Live" : state === "closed" || state === "archived" ? "Closed" : "Draft";
  return <Badge tone={tone}>{label}</Badge>;
}

export function PollToolOverviewPage() {
  const { data, loading, error, refresh } = usePollData<{ polls: PollListItem[] }>("/owner/polls");
  const [demo, setDemo] = useState(false);
  const polls = data?.polls ?? [];
  return <div className="page-stack tool-overview-page poll-overview-page">
    <ToolPageHeader title="Poll" description="Run a quick, focused question with your group." />
    <section className="poll-overview-hero"><div className="poll-overview-copy"><span className="poll-hero-kicker">REAL-TIME GROUP INPUT</span><h2>Ask. Listen.<br />See ideas pop.</h2><p>One clear question is often all it takes to start a better conversation.</p><div><Button variant="yellow" to="/polls/new" icon={<Plus size={16} />}>Create activity</Button><Button variant="secondary" onClick={() => setDemo((value) => !value)}>{demo ? "Close quick demo" : "See a quick demo"}</Button></div></div><div className="poll-hero-art"><Mascot kind="popp" /><span>✦</span></div><div className="poll-hero-mini-chart"><b>What helps teams thrive?</b><i><span style={{ width: "76%" }} />Clarity</i><i><span style={{ width: "56%" }} />Trust</i><i><span style={{ width: "32%" }} />Time</i></div></section>
    {demo && <Card className="poll-demo-card"><div><Badge tone="yellow">SYNTHETIC DEMO</Badge><h2>What makes a great team day?</h2><p>Sample chart only. This preview is not saved and never appears in your results.</p></div>{["Clear goals", "Time to focus", "Good coffee"].map((label, index) => <div className="poll-bar-row" key={label}><span>{label}</span><div className="poll-bar-track"><i style={{ width: `${[82, 61, 36][index]}%` }} /></div><strong>{[82, 61, 36][index]}%</strong></div>)}</Card>}
    <div className="poll-benefit-grid">{[["Fast to make", "One question, quick setup.", "⚡"], ["Useful live", "See responses update as people vote.", "◉"], ["Easy to share", "QR, link and PIN for your room.", "↗"]].map(([title, copy, icon], index) => <Card key={title} className={`poll-benefit poll-benefit-${index}`}><span>{icon}</span><strong>{title}</strong><p>{copy}</p></Card>)}</div>
    <section className="poll-how"><div className="section-heading"><div><span className="eyebrow">HOW IT WORKS</span><h2>From question to conversation</h2></div><Link className="text-link" to="/polls/new">Build your Poll <ArrowRight size={15} /></Link></div><div className="poll-how-steps">{[["Ask", "Write one question and give people clear choices."], ["Collect", "Share the activity link or code with your group."], ["Discuss", "Reveal results when you are ready to talk."]].map(([title, copy], index) => <div key={title}><b>0{index + 1}</b><h3>{title}</h3><p>{copy}</p></div>)}</div></section>
    <section className="poll-list-section"><div className="section-heading"><div><span className="eyebrow">YOUR POLLS</span><h2>Poll activities</h2></div><Button variant="secondary" to="/archive">Archive / Results</Button></div>
      {loading ? <LoadingState label="Loading Poll activities…" /> : error ? <ErrorState message={error} retry={refresh} /> : polls.length === 0 ? <Card><EmptyState title="Your first Poll is ready to make" description="Create a draft, choose how answers work, and open it whenever your group is ready." action={<Button variant="orange" to="/polls/new">Create your first Poll</Button>} /></Card> : <div className="poll-activity-list">{polls.map((poll) => <Link to={`/polls/${poll.activity_id}`} className="poll-activity-row" key={poll.activity_id}><span className="poll-row-art"><Mascot kind="flower" /></span><span className="poll-row-main"><strong>{poll.title}</strong><small>{poll.session_name ?? "Quick Activity"} · {poll.question}</small></span><span className="poll-row-count"><b>{poll.respondent_count}</b><small>responses</small></span><StateBadge state={poll.state} /><ArrowRight size={17} /></Link>)}</div>}
    </section><section className="poll-how-it-works"><h2>A quick tool for a good conversation.</h2><div>{["Open your Poll", "Invite participants", "Reveal when ready"].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div></section>
  </div>;
}

type PollForm = { title: string; question: string; questionType: "single" | "multiple"; options: string[]; maxSelections: number; allowOther: boolean; identityMode: "anonymous" | "named"; participantResultsMode: "presenter_only" | "presenter_and_participant"; sessionId: string };
const defaultPollForm: PollForm = { title: "Team Poll", question: "What would help us work better together?", questionType: "single", options: ["Clearer priorities", "More time to focus", "Better collaboration", "Other"], maxSelections: 1, allowOther: false, identityMode: "anonymous", participantResultsMode: "presenter_only", sessionId: "" };

export function PollEditorPage() {
  const { activityId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(activityId);
  const [form, setForm] = useState<PollForm>(() => ({ ...defaultPollForm, sessionId: searchParams.get("sessionId") ?? "" }));
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loaded, setLoaded] = useState(!isEdit);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ sessions: SessionItem[] }>("/owner/sessions").then((value) => setSessions(value.sessions)).catch(() => setSessions([])); }, []);
  useEffect(() => {
    if (!isEdit) return;
    void api<PollDetail>(`/owner/polls/${activityId}`).then(({ poll, options }) => setForm({
      title: poll.title, question: poll.question, questionType: poll.questionType,
      options: options.filter((option) => !option.isOther).map((option) => option.label), maxSelections: poll.maxSelections,
      allowOther: poll.allowOther, identityMode: poll.identityMode, participantResultsMode: poll.participantResultsMode,
      sessionId: poll.sessionId ?? "",
    })).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load this Poll."))
      .finally(() => setLoaded(true));
  }, [activityId, isEdit]);
  const optionTotal = form.options.filter((option) => option.trim()).length + Number(form.allowOther);
  async function save(openAfter: boolean) {
    setPending(true); setError("");
    const payload = { ...form, sessionId: form.sessionId || null, options: form.options.map((option) => option.trim()).filter(Boolean), maxSelections: form.questionType === "single" ? 1 : Math.min(form.maxSelections, 10) };
    try {
      let id = activityId;
      if (isEdit) await api(`/owner/polls/${activityId}`, { method: "PATCH", body: JSON.stringify(payload) });
      else id = (await post<{ activityId: string }>("/owner/polls", payload)).activityId;
      if (openAfter) await post(`/owner/polls/${id}/open`, {});
      navigate(`/polls/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the Poll."); }
    finally { setPending(false); }
  }
  if (!loaded) return <LoadingState label="Opening the Poll editor…" />;
  return <div className="page-stack poll-editor-page"><div className="breadcrumb"><Link to="/tools/poll">Poll</Link><span>›</span><span>{isEdit ? "Edit draft" : "Create Poll"}</span></div><PageIntro eyebrow="POLL SETUP" title={isEdit ? "Shape your Poll" : "Create a Poll"} description="A good question makes space for useful answers." />
    {error && <div role="alert" className="inline-error">{error}</div>}
    <form className="poll-editor-grid" onSubmit={(event) => { event.preventDefault(); void save(false); }}><div className="poll-editor-main">
      <Card className="poll-form-card"><div className="poll-form-heading"><span className="poll-form-icon">01</span><div><h2>Poll details</h2><p>Give this activity a clear name and one question.</p></div></div>
        <label className="field-label" htmlFor="poll-title">Activity name <small>1–120 characters</small></label><input id="poll-title" className="text-input" required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <label className="field-label" htmlFor="poll-question">Your question <small>1–250 characters</small></label><textarea id="poll-question" className="text-input poll-question-input" required maxLength={250} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} />
        <label className="field-label" htmlFor="poll-session">Run this Poll in</label><select id="poll-session" className="text-input" value={form.sessionId} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}><option value="">Quick activity · Standalone</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select>
      </Card>
      <Card className="poll-form-card"><div className="poll-form-heading"><span className="poll-form-icon">02</span><div><h2>Answer options</h2><p>Add 2–10 options. Other counts as one option.</p></div><Badge tone="aqua">{optionTotal} / 10</Badge></div>
        <div className="poll-option-editor">{form.options.map((option, index) => <div className="poll-option-input-row" key={`option-${index}`}><span className="poll-option-number">{index + 1}</span><input className="text-input" aria-label={`Answer option ${index + 1}`} value={option} maxLength={120} placeholder={`Answer option ${index + 1}`} onChange={(event) => setForm({ ...form, options: form.options.map((value, at) => at === index ? event.target.value : value) })} /><button type="button" className="icon-quiet" aria-label={`Remove answer option ${index + 1}`} disabled={form.options.length <= 1} onClick={() => setForm({ ...form, options: form.options.filter((_, at) => at !== index) })}><X size={17} /></button></div>)}</div>
        <div className="poll-option-actions"><Button variant="secondary" disabled={form.options.length + Number(form.allowOther) >= 10} onClick={() => setForm({ ...form, options: [...form.options, ""] })} icon={<Plus size={16} />}>Add option</Button><label className="poll-check-row"><input type="checkbox" checked={form.allowOther} disabled={!form.allowOther && form.options.length >= 10} onChange={(event) => setForm({ ...form, allowOther: event.target.checked })} />Include an Other option</label></div>
      </Card>
      <Card className="poll-form-card"><div className="poll-form-heading"><span className="poll-form-icon">03</span><div><h2>Question type</h2><p>Choose how many options each person can select.</p></div></div>
        <div className="poll-type-grid"><button type="button" className={`poll-type-card ${form.questionType === "single" ? "selected" : ""}`} onClick={() => setForm({ ...form, questionType: "single", maxSelections: 1 })}><span className="poll-radio-icon">◉</span><strong>Single Choice</strong><small>Choose one answer</small></button><button type="button" className={`poll-type-card ${form.questionType === "multiple" ? "selected" : ""}`} onClick={() => setForm({ ...form, questionType: "multiple", maxSelections: Math.max(2, form.maxSelections) })}><span className="poll-radio-icon">☑</span><strong>Multiple Choice</strong><small>Choose more than one</small></button></div>
        {form.questionType === "multiple" && <label className="poll-selection-limit">Maximum selections <select className="text-input" value={Math.min(form.maxSelections, Math.max(optionTotal, 1))} onChange={(event) => setForm({ ...form, maxSelections: Number(event.target.value) })}>{Array.from({ length: Math.max(1, optionTotal) }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value} {value === 1 ? "answer" : "answers"}</option>)}</select></label>}
      </Card>
    </div><aside className="poll-editor-side"><Card className="poll-form-card"><div className="poll-form-heading"><span className="poll-form-icon">04</span><div><h2>Participant settings</h2><p>Choose the privacy boundary for this activity.</p></div></div>
      <div className="poll-settings-group"><strong>Participation mode</strong>{([["anonymous", "Anonymous", "Answers are not connected to participant names."], ["named", "Named", "You can review each response with its participant name."]] as const).map(([value, label, help]) => <label className={`poll-setting-choice ${form.identityMode === value ? "selected" : ""}`} key={value}><input type="radio" name="poll-identity" checked={form.identityMode === value} onChange={() => setForm({ ...form, identityMode: value })} /><span><b>{label}</b><small>{help}</small></span></label>)}</div>
      <div className="poll-settings-group"><strong>Participant results</strong>{([["presenter_only", "Presenter only", "Participants wait after voting."], ["presenter_and_participant", "Presenter + participants", "Participants see group results after you reveal them."]] as const).map(([value, label, help]) => <label className={`poll-setting-choice ${form.participantResultsMode === value ? "selected" : ""}`} key={value}><input type="radio" name="poll-results" checked={form.participantResultsMode === value} onChange={() => setForm({ ...form, participantResultsMode: value })} /><span><b>{label}</b><small>{help}</small></span></label>)}</div>
      <div className="poll-privacy-note"><LockKeyhole size={17} /><span>Presenter Mode always shows anonymous totals only. Other free text is never projected.</span></div>
      <div className="poll-editor-actions"><Button type="submit" disabled={pending} variant="secondary">{pending ? "Saving…" : "Save Draft"}</Button><Button type="button" variant="orange" disabled={pending} onClick={() => { const formElement = document.querySelector<HTMLFormElement>(".poll-editor-grid"); if (formElement?.reportValidity()) void save(true); }} icon={<Play size={15} />}>{pending ? "Opening…" : "Save & Open Poll"}</Button><Link className="text-link" to="/tools/poll"><ArrowLeft size={15} /> Cancel</Link></div>
    </Card><Card className="poll-preview-card"><span className="eyebrow">MOBILE PREVIEW</span><h3>{form.question || "Your Poll question"}</h3>{form.options.filter((option) => option.trim()).slice(0, 3).map((option, index) => <span className="poll-preview-option" key={`${option}-${index}`}><i />{option}</span>)}{form.allowOther && <span className="poll-preview-option"><i />Other</span>}</Card></aside></form>
  </div>;
}

export function PollControlPage() {
  const { activityId = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = usePollData<PollDetail>(`/owner/polls/${activityId}`, 3000);
  const [sessionAccess, setSessionAccess] = useState<{ path: string; join_pin: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [presentationPending, setPresentationPending] = useState(false);
  const [copied, setCopied] = useState("");
  const poll = data?.poll;
  useEffect(() => { if (poll?.sessionId) void api<{ path: string; join_pin: string }>(`/owner/poll-sessions/${poll.sessionId}/access`).then(setSessionAccess).catch(() => setSessionAccess(null)); }, [poll?.sessionId]);
  async function action(name: "open" | "close" | "reopen" | "reveal" | "duplicate", participantResultsMode?: PollRecord["participantResultsMode"]) {
    setActionError("");
    try {
      const result = await post<{ activityId?: string }>(`/owner/polls/${activityId}/${name}`, name === "reveal" ? { revealed: poll?.revealState !== "revealed", ...(participantResultsMode ? { participantResultsMode } : {}) } : {});
      if (name === "duplicate" && result.activityId) navigate(`/polls/${result.activityId}/edit`);
      else refresh();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "The Poll action could not be completed."); }
  }
  async function updateParticipantResultsMode(mode: PollRecord["participantResultsMode"]) {
    if (!poll) return;
    setPresentationPending(true); setActionError("");
    try {
      await post(`/owner/polls/${activityId}/reveal`, { revealed: poll.revealState === "revealed", participantResultsMode: mode });
      refresh();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update participant results visibility."); }
    finally { setPresentationPending(false); }
  }
  async function copy(text: string, kind: string) { try { await navigator.clipboard.writeText(text); setCopied(kind); window.setTimeout(() => setCopied(""), 1800); } catch { setActionError("Clipboard access is unavailable. Select and copy the link shown here."); } }
  async function launchPresenter() {
    try { const token = await post<{ path: string }>(`/owner/activities/${activityId}/presenter-token`, {}); window.open(token.path, "_blank", "noopener,noreferrer"); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not open Presenter Mode."); }
  }
  async function removePoll() {
    if (!window.confirm("Delete this Poll and permanently remove its responses, participant records and join links?")) return;
    try { await api(`/owner/polls/${activityId}`, { method: "DELETE" }); navigate("/tools/poll"); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not delete this Poll."); }
  }
  if (loading && !data) return <LoadingState label="Opening Poll controls…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data || !poll) return <Card><EmptyState title="Poll not found" description="This activity may have been deleted." action={<Button to="/tools/poll">Back to Polls</Button>} /></Card>;
  const directUrl = `${window.location.origin}/poll/${poll.accessSlug}`;
  const presenterUrl = `/polls/${activityId}/presenter`;
  return <div className="page-stack poll-control-page"><div className="breadcrumb"><Link to="/tools/poll">Poll</Link><span>›</span><span>{poll.title}</span></div>
    {poll.archivedSession && <div className="poll-archive-notice"><span>Archived Session</span><p>This Poll can be reopened without reopening other activities in the Session.</p></div>}
    <section className="poll-control-heading"><div><span className="poll-control-kicker"><span className={poll.state === "open" ? "poll-live-dot" : ""} />{poll.state === "open" ? "LIVE POLL" : poll.state.toUpperCase()} {poll.sessionName ? `· ${poll.sessionName}` : "· QUICK ACTIVITY"}</span><h1>{poll.title}<span className="title-dot">.</span></h1><p>{poll.question}</p><div className="poll-control-meta"><StateBadge state={poll.state} /><Badge tone={poll.identityMode === "anonymous" ? "aqua" : "pink"}>{poll.identityMode === "anonymous" ? "Anonymous" : "Named"}</Badge><span>{poll.questionType === "single" ? "Single Choice" : `Multiple Choice · up to ${poll.maxSelections}`}</span></div></div><div className="poll-control-actions">{poll.state === "draft" ? <Button variant="orange" onClick={() => void action("open")} icon={<Play size={15} />}>Open Poll</Button> : poll.state === "open" ? <Button variant="danger" onClick={() => void action("close")}>Close Poll</Button> : <Button variant="orange" onClick={() => void action("reopen")} icon={<RotateCcw size={15} />}>Reopen Poll</Button>}<Button variant="secondary" to={`/polls/${activityId}/results`}>View results</Button></div></section>
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}{error && <div className="subtle-warning">Live refresh paused: {error}</div>}
    <div className="poll-control-metrics"><div><span>◉</span><strong>{data.counts.respondents}</strong><small>Responded</small></div><div><span>↗</span><strong>{data.counts.joined}</strong><small>Joined</small></div><div><span>▤</span><strong>{data.counts.completionRate === null ? "—" : `${data.counts.completionRate}%`}</strong><small>Completion</small></div><div><span>◎</span><strong>{poll.revealState === "revealed" ? "On" : "Off"}</strong><small>Results revealed</small></div></div>
    <div className="poll-control-grid"><Card className="poll-share-card"><div className="section-heading"><div><span className="eyebrow">DIRECT POLL ACCESS</span><h2>Invite your group</h2></div><Badge tone="green">No participant account</Badge></div><p>Share this Poll’s own link, QR code or six-digit code.</p>{poll.state === "open" ? <div className="poll-share-content"><div className="poll-qr"><QRCodeSVG value={directUrl} size={148} level="M" includeMargin /></div><div><span className="poll-pin-label">POLL CODE</span><strong className="poll-pin-code">{poll.joinPin ? `${poll.joinPin.slice(0, 3)} ${poll.joinPin.slice(3)}` : "— — — — — —"}</strong><label>Direct link</label><div className="poll-url-row"><input readOnly value={directUrl} /><button aria-label="Copy direct link" onClick={() => void copy(directUrl, "direct")}>{copied === "direct" ? <Check size={16} /> : <Copy size={16} />}</button></div><Button variant="secondary" onClick={() => void copy(directUrl, "direct")} icon={<Copy size={15} />}>{copied === "direct" ? "Copied" : "Copy Poll link"}</Button></div></div> : <div className="poll-not-open"><LockKeyhole size={22} /><span>Open this Poll to create its participant code and link.</span></div>}</Card>
      <Card className="poll-live-stats-card"><div className="section-heading"><div><span className="eyebrow">LIVE RESPONSE MONITOR</span><h2>{data.counts.respondents} of {data.counts.joined} responded</h2></div><Button variant="quiet" onClick={refresh}>Refresh <Radio size={15} /></Button></div><div className="poll-progress-track"><i style={{ width: `${data.counts.joined ? data.counts.submitted / data.counts.joined * 100 : 0}%` }} /></div><div className="poll-live-stats-caption"><span>Updated every 3 seconds</span><b>{data.counts.submitted} submitted</b></div><div className="poll-live-results">{data.results.map((result) => <div className="poll-bar-row" key={result.optionId}><span>{result.label}</span><div className="poll-bar-track"><i style={{ width: `${Math.max(result.percentage, result.count ? 4 : 0)}%` }} /></div><strong>{result.count} · {result.percentage}%</strong></div>)}{!data.counts.respondents && <p className="poll-no-votes">Results will appear as participants submit their answers. Only you can see these live totals before Reveal.</p>}</div></Card></div>
    <div className="poll-control-grid poll-control-grid-secondary"><Card><div className="section-heading"><div><span className="eyebrow">PRESENTATION</span><h2>Decide when results appear</h2></div><span className="poll-reveal-state"><i className={poll.revealState === "revealed" ? "revealed" : ""} />{poll.revealState === "revealed" ? "Revealed" : "Hidden"}</span></div><p>Trainer results stay live. Participants and Presenter only receive aggregate results after you reveal them.</p><label className="field-label poll-participant-visibility" htmlFor="poll-participant-visibility">Participant results visibility<select id="poll-participant-visibility" className="text-input" value={poll.participantResultsMode} disabled={presentationPending} onChange={(event) => void updateParticipantResultsMode(event.target.value as PollRecord["participantResultsMode"])}><option value="presenter_only">Presenter only</option><option value="presenter_and_participant">Participants after Reveal</option></select></label><div className="poll-presentation-actions"><Button onClick={() => void action("reveal")} variant={poll.revealState === "revealed" ? "secondary" : "orange"} icon={poll.revealState === "revealed" ? <EyeOff size={16} /> : <Eye size={16} />}>{poll.revealState === "revealed" ? "Hide results" : "Reveal results"}</Button><Button variant="secondary" onClick={() => void launchPresenter()} icon={<ExternalLink size={16} />}>Open Presenter Mode</Button><Link className="text-link" to={presenterUrl}>Presenter controls <ArrowRight size={15} /></Link></div></Card>
      <Card className="poll-privacy-summary"><div className="section-heading"><div><span className="eyebrow">PRIVACY</span><h2>{poll.identityMode === "anonymous" ? "Answers stay separate from names" : "Named responses are on"}</h2></div><LockKeyhole size={21} /></div><p>{poll.identityMode === "anonymous" ? "Anonymous response data has no participant link. In a Session, this list only shows who completed; it never shows which answer was theirs." : "Only you can see named response details. Presenter Mode remains aggregate-only."}</p>{poll.sessionId && <div className="poll-completion-list"><strong>Session completion</strong>{data.participants.length ? data.participants.map((person, index) => <span key={`${person.displayName}-${index}`}><i className={person.status === "submitted" ? "done" : ""} />{person.displayName}<small>{person.status === "submitted" ? "Submitted" : "Joined"}</small></span>) : <small>Participants appear after they open this Poll.</small>}</div>}</Card></div>
    {poll.sessionId && <Card className="poll-session-share"><div><Badge tone="purple">SESSION ENTRY</Badge><h2>One link for every Live Poll</h2><p>Participants join the Session once, then choose a Poll without entering their name again.</p></div>{sessionAccess && <div className="poll-session-access"><QRCodeSVG value={`${window.location.origin}${sessionAccess.path}`} size={96} includeMargin /><span><b>{sessionAccess.join_pin.slice(0, 3)} {sessionAccess.join_pin.slice(3)}</b><small>Session code</small><code>{`${window.location.origin}${sessionAccess.path}`}</code><Button variant="secondary" onClick={() => void copy(`${window.location.origin}${sessionAccess.path}`, "session")}>{copied === "session" ? "Copied" : "Copy Session link"}</Button></span></div>}</Card>}
    <div className="poll-control-footer"><Button variant="secondary" onClick={() => void action("duplicate")} icon={<Copy size={15} />}>Duplicate as Draft</Button><Link className="button button-quiet" to={`/polls/${activityId}/results`}><BarChart3 size={15} /> Results / Analytics</Link>{poll.state === "draft" && <Link className="button button-secondary" to={`/polls/${activityId}/edit`}>Edit Draft</Link>}<button className="poll-delete-button" onClick={() => void removePoll()}><Trash2 size={16} /> Delete Poll and responses</button></div>
  </div>;
}

export function PollResultsPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = usePollData<PollDetail>(`/owner/polls/${activityId}/results`, 3000);
  const [exportKind, setExportKind] = useState("summary");
  if (loading && !data) return <LoadingState label="Loading Poll results…" />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data) return null;
  const poll = data.poll;
  const exportUrl = `/api/owner/polls/${activityId}/export?kind=${exportKind}`;
  return <div className="page-stack poll-results-page"><div className="breadcrumb"><Link to={`/polls/${activityId}`}>{poll.title}</Link><span>›</span><span>Results / Analytics</span></div><PageIntro eyebrow="POLL RESULTS" title="See what the group said" description="Live totals are private to your trainer workspace. Percentages use respondents as the denominator." action={<Button variant="secondary" to={`/polls/${activityId}`}>Back to controls</Button>} />
    <div className="poll-results-summary"><div><span>RESPONDENTS</span><strong>{data.counts.respondents}</strong></div><div><span>JOINED</span><strong>{data.counts.joined}</strong></div><div><span>COMPLETION</span><strong>{data.counts.completionRate === null ? "—" : `${data.counts.completionRate}%`}</strong></div><StateBadge state={poll.state} /></div>
    <div className="poll-results-layout"><Card className="poll-results-chart"><div className="section-heading"><div><span className="eyebrow">{poll.questionType === "multiple" ? "MULTIPLE CHOICE · % MAY EXCEED 100" : "SINGLE CHOICE"}</span><h2>{poll.question}</h2></div><button className="icon-quiet" onClick={refresh} aria-label="Refresh Poll results"><Radio size={17} /></button></div>{data.results.map((result, index) => <div className={`poll-analytics-row poll-analytics-row-${index % 5}`} key={result.optionId}><div className="poll-analytics-label"><b>{result.label}</b><span>{result.count} {result.count === 1 ? "vote" : "votes"} · {result.percentage}%</span></div><div className="poll-bar-track"><i style={{ width: `${Math.max(result.percentage, result.count ? 4 : 0)}%` }} /></div></div>)}{poll.questionType === "multiple" && <p className="poll-multi-note">Each participant is the denominator, so percentages can add up to more than 100% for a multiple selection question.</p>}</Card>
      <Card className="poll-export-card"><span className="eyebrow">EXPORT RESULTS</span><h2>Take the conversation further</h2><p>Exports are authenticated. Anonymous CSVs contain no participant-to-answer mapping.</p><label htmlFor="poll-export-kind">Export type</label><select id="poll-export-kind" className="text-input" value={exportKind} onChange={(event) => setExportKind(event.target.value)}><option value="summary">Aggregate summary</option><option value="other">Other text responses</option>{poll.identityMode === "named" && <option value="named">Named response detail</option>}</select><a className="button button-orange" href={exportUrl}><Download size={16} /> Download CSV</a><div className="poll-export-privacy"><LockKeyhole size={16} /><span>{poll.identityMode === "anonymous" ? "Named detail export is disabled for this Poll." : "Named detail is included only when you choose that export."}</span></div></Card></div>
    {data.otherResponses.length > 0 && <Card className="poll-other-results"><div className="section-heading"><div><span className="eyebrow">OTHER RESPONSES</span><h2>Participant-written answers</h2></div><Badge tone="yellow">{data.otherResponses.length}</Badge></div><p>Free text can contain voluntary identifiers, so it is never included on Presenter Mode or other participant screens.</p><div className="poll-other-list">{data.otherResponses.map((text, index) => <span key={`${index}-${text}`}>{text}</span>)}</div></Card>}
    {poll.identityMode === "named" && <Card className="poll-named-results"><div className="section-heading"><div><span className="eyebrow">NAMED RESPONSES</span><h2>Who chose what</h2></div><Badge tone="pink">Trainer only</Badge></div>{data.namedResponses.length ? <div className="poll-named-table-wrap"><table><thead><tr><th>Participant</th><th>Team</th><th>Selected answers</th><th>Other text</th></tr></thead><tbody>{data.namedResponses.map((row, index) => <tr key={`${row.displayName}-${index}`}><td>{row.displayName}</td><td>{row.teamName ?? "—"}</td><td>{row.selections.join(", ")}</td><td>{row.otherText ?? "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No named responses yet" description="Submitted answers will appear here for the trainer only." />}</Card>}
  </div>;
}

export function PollPresenterControlsPage() {
  const { activityId = "" } = useParams();
  const { data } = usePollData<PollDetail>(`/owner/polls/${activityId}`, 3000);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  async function createLink() { try { const result = await post<{ path: string }>(`/owner/activities/${activityId}/presenter-token`, {}); setLink(`${window.location.origin}${result.path}`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create Presenter link."); } }
  return <div className="page-stack poll-presenter-controls"><div className="breadcrumb"><Link to={`/polls/${activityId}`}>{data?.poll.title ?? "Poll"}</Link><span>›</span><span>Presenter controls</span></div><PageIntro eyebrow="PRESENTER MODE" title="Ready for the big screen?" description="Project a clean, aggregate-only view. Participant names and Other text never appear." action={<Button variant="secondary" to={`/polls/${activityId}`}>Back to Poll</Button>} />
    <Card className="poll-presenter-control-card"><div className="poll-presenter-preview"><span className="eyebrow">LIVE PREVIEW</span><h2>{data?.poll.question ?? "Your Poll question"}</h2><div className="poll-preview-hidden"><EyeOff size={20} /><span>{data?.poll.revealState === "revealed" ? "Results are revealed" : "Results are hidden until you reveal them"}</span></div></div><div className="poll-presenter-actions"><Button variant="orange" onClick={() => void createLink()} icon={<ExternalLink size={16} />}>Open Presenter screen</Button>{link && <div className="poll-presenter-share"><a href={link} target="_blank" rel="noreferrer">{link}</a><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(link)}>Copy link</Button></div>}{error && <div className="inline-error">{error}</div>}<Link className="text-link" to={`/polls/${activityId}/results`}>Open analytics <ArrowRight size={15} /></Link></div></Card>
    <div className="poll-presenter-notes"><span><Check size={16} /> No individual response data on Presenter Mode</span><span><Check size={16} /> Live totals update after Reveal</span><span><Check size={16} /> Fullscreen, projector-first layout</span></div>
  </div>;
}

type PollPublicData = { poll: { activityId: string; sessionId: string | null; sessionName: string | null; title: string; question: string; questionType: "single" | "multiple"; maxSelections: number; allowOther: boolean; identityMode: "anonymous" | "named"; participantResultsMode: "presenter_only" | "presenter_and_participant"; state: string; accessSlug: string; sessionAccessSlug: string | null }; options: PollOption[]; teams: Array<{ id: string; name: string }> };
type PollCurrent = { poll: PollPublicData["poll"] & { revealState: string }; options: PollOption[]; participant: { displayName: string }; response: { submitted: boolean; selectedOptionIds: string[]; otherText: string | null } };
type PollPersonalResults = { visible: boolean; reason?: string; respondentCount?: number; results?: PollResultBar[]; selectedOptionIds?: string[]; multiSelectNote?: string | null };
function sessionStorageKey(sessionId: string) { return `popp-session:${sessionId}`; }
function guestStorageKey(activityId: string) { return `popp-guest:${activityId}`; }

export function PollSessionJoinPage() {
  const { accessSlug = "" } = useParams();
  const [data, setData] = useState<{ session: { id: string; name: string; archived: boolean }; profile: { displayName: string; role: string; teamName: string | null } | null; teams: string[]; polls: Array<{ id: string; title: string; question: string; slug: string; submitted: boolean; respondentCount: number }> } | null>(null);
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [teamName, setTeamName] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const refresh = useCallback(async () => {
    const base = await api<typeof data extends null ? never : NonNullable<typeof data>>(`/join/poll-sessions/${accessSlug}`);
    const stored = window.sessionStorage.getItem(sessionStorageKey(base.session.id)) ?? "";
    if (stored) {
      try {
        const resumed = await post<typeof base>(`/join/poll-sessions/${accessSlug}/profile`, { sessionToken: stored });
        setData(resumed); setName(resumed.profile?.displayName ?? ""); setRole(resumed.profile?.role ?? ""); setTeamName(resumed.profile?.teamName ?? ""); setSessionToken(stored); return;
      } catch { /* Ask for identity again if the temporary browser token is no longer available. */ }
    }
    window.sessionStorage.removeItem(sessionStorageKey(base.session.id));
    setData(base); setSessionToken("");
  }, [accessSlug]);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { void refresh().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Session link is unavailable."); }).finally(() => { if (active) setLoading(false); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [refresh]);
  async function joinSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const result = await post<typeof data extends null ? never : NonNullable<typeof data> & { sessionToken: string }>(`/join/poll-sessions/${accessSlug}/identity`, { displayName: name, role, teamName: teamName || null });
      window.sessionStorage.setItem(sessionStorageKey(result.session.id), result.sessionToken); setSessionToken(result.sessionToken); setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join the Session."); }
    finally { setPending(false); }
  }
  if (loading) return <main className="poll-participant-page"><BrandMark /><LoadingState label="Opening Session…" /></main>;
  if (!data) return <main className="poll-participant-page"><BrandMark /><ErrorState message={error || "This Session link is unavailable."} /></main>;
  return <main className="poll-session-page"><header className="poll-mobile-brand"><BrandMark /><span>SESSION POLLS</span></header><div className="poll-mobile-shell"><span className="eyebrow">{data.session.archived ? "ARCHIVED SESSION · REOPENED POLLS" : "YOUR SESSION"}</span><h1>{data.session.name}<span className="title-dot">.</span></h1>{!sessionToken ? <><p>Join once with your name, then choose any live Poll in this Session.</p><form className="poll-entry-card" onSubmit={(event) => void joinSession(event)}><label className="field-label" htmlFor="session-name">Your name</label><input className="text-input participant-input" id="session-name" autoComplete="name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><label className="field-label" htmlFor="session-role">Your role <small>Optional</small></label><input className="text-input participant-input" id="session-role" maxLength={60} value={role} onChange={(event) => setRole(event.target.value)} />{data.teams.length > 0 && <><label className="field-label" htmlFor="session-team">Your team <small>Optional</small></label><select id="session-team" className="text-input participant-input" value={teamName} onChange={(event) => setTeamName(event.target.value)}><option value="">Choose later</option>{data.teams.map((team) => <option key={team}>{team}</option>)}</select></>}{error && <div role="alert" className="inline-error">{error}</div>}<Button type="submit" disabled={pending || !name.trim()} className="full-width">{pending ? "Joining…" : "Join Session"}</Button></form></> : <><p>Welcome, {data.profile?.displayName}. Your name and team carry over to each activity in this browser.</p><section className="poll-session-activity-list"><h2>Live Polls</h2>{data.polls.length ? data.polls.map((poll) => <Link to={`/poll/${poll.slug}`} className="poll-session-choice" key={poll.id}><span className="poll-session-choice-icon"><BarChart3 size={19} /></span><span><strong>{poll.title}</strong><small>{poll.question}</small>{poll.submitted && <Badge tone="green">Submitted</Badge>}</span><ArrowRight size={18} /></Link>) : <Card><EmptyState title="No Live Polls yet" description="Keep this page open. Live Polls appear here when your trainer opens them." /></Card>}</section><Button variant="secondary" onClick={() => void refresh()}>Refresh Poll list</Button></>}</div><div className="participant-bottom-note"><LockKeyhole size={16} /> Temporary Session access · No account required</div></main>;
}

export function PollParticipantPage() {
  const { accessSlug = "" } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<PollPublicData | null>(null);
  const [current, setCurrent] = useState<PollCurrent | null>(null);
  const [results, setResults] = useState<PollPersonalResults | null>(null);
  const [token, setToken] = useState("");
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [teamId, setTeamId] = useState(""); const [otherText, setOtherText] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [autoJoining, setAutoJoining] = useState(false); const [error, setError] = useState(""); const [autoNext, setAutoNext] = useState("");
  const [nextActivities, setNextActivities] = useState<Array<{ id: string; title: string; slug: string; submitted: boolean }>>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await api<PollPublicData>(`/join/polls/${accessSlug}`);
        const savedGuest = sessionStorage.getItem(guestStorageKey(value.poll.activityId)) ?? "";
        if (savedGuest) setToken(savedGuest);
        else if (value.poll.sessionId && value.poll.state === "open") {
          const savedSession = sessionStorage.getItem(sessionStorageKey(value.poll.sessionId)) ?? "";
          if (savedSession) {
            setAutoJoining(true);
            try {
              const joined = await post<{ token: string; activityId: string; sessionToken?: string }>(`/join/polls/${accessSlug}/enter`, { sessionToken: savedSession });
              sessionStorage.setItem(guestStorageKey(joined.activityId), joined.token);
              if (joined.sessionToken) sessionStorage.setItem(sessionStorageKey(value.poll.sessionId), joined.sessionToken);
              if (active) setToken(joined.token);
            } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not open this Poll with your Session identity."); }
            finally { if (active) setAutoJoining(false); }
          }
        }
        if (active) setMeta(value);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Poll link is unavailable."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [accessSlug]);
  const refreshGuest = useCallback(async () => {
    if (!meta || !token) return;
    try {
      const headers = { headers: { Authorization: `Bearer ${token}` } };
      const response = await api<PollCurrent>("/guest/poll/current", headers);
      setCurrent(response); setSelected((old) => response.response.submitted && !editing ? response.response.selectedOptionIds : old);
      setOtherText((old) => response.response.submitted && !editing ? response.response.otherText ?? "" : old);
      const personal = await api<PollPersonalResults>("/guest/poll/results", headers);
      setResults(personal);
      if (response.poll.sessionId) {
        const available = await api<{ activities: typeof nextActivities }>("/guest/poll/activities", headers);
        setNextActivities(available.activities);
        const next = available.activities.filter((item) => !item.submitted && item.id !== response.poll.activityId);
        if (!personal.visible && next.length === 1) setAutoNext(next[0]!.slug);
        else setAutoNext("");
      }
      setError("");
    } catch (reason) {
      if ((reason as { status?: number }).status === 401 || (reason as { status?: number }).status === 403) {
        sessionStorage.removeItem(guestStorageKey(meta.poll.activityId)); setToken(""); setCurrent(null);
      } else setError(reason instanceof Error ? reason.message : "Could not refresh this Poll.");
    }
  }, [meta, token, editing]);
  useEffect(() => { const initial = window.setTimeout(() => void refreshGuest(), 0); if (!token || !meta) return () => window.clearTimeout(initial); const timer = window.setInterval(() => void refreshGuest(), 2500); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [refreshGuest, token, meta]);
  useEffect(() => { if (!autoNext || results?.visible) return; const timer = window.setTimeout(() => navigate(`/poll/${autoNext}`), 5000); return () => window.clearTimeout(timer); }, [autoNext, results?.visible, navigate]);
  async function enter(event?: FormEvent<HTMLFormElement>, anonymous = false) {
    event?.preventDefault(); if (!meta) return; setPending(true); setError("");
    try {
      const sessionId = meta.poll.sessionId;
      const sessionToken = sessionId ? sessionStorage.getItem(sessionStorageKey(sessionId)) ?? undefined : undefined;
      const result = await post<{ token: string; activityId: string; sessionToken?: string }>(`/join/polls/${accessSlug}/enter`, {
        displayName: anonymous ? "" : name, role, teamId: teamId || null,
        teamName: teamId ? meta.teams.find((team) => team.id === teamId)?.name : undefined,
        sessionToken,
      });
      sessionStorage.setItem(guestStorageKey(result.activityId), result.token); if (result.sessionToken && sessionId) sessionStorage.setItem(sessionStorageKey(sessionId), result.sessionToken);
      setToken(result.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not join this Poll."); }
    finally { setPending(false); }
  }
  async function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current || !token) return; setPending(true); setError("");
    const selections = selected.map((optionId) => ({ optionId, ...(current.options.find((option) => option.id === optionId)?.isOther ? { otherText } : {}) }));
    try {
      await api("/guest/poll/response", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ selections, idempotencyKey: crypto.randomUUID() }) });
      setEditing(false); await refreshGuest();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your vote could not be saved."); }
    finally { setPending(false); }
  }
  function toggleOption(optionId: string) {
    if (!current) return;
    setSelected((items) => {
      if (items.includes(optionId)) return items.filter((item) => item !== optionId);
      if (current.poll.questionType === "single") return [optionId];
      if (items.length >= current.poll.maxSelections) return items;
      return [...items, optionId];
    });
  }
  if (loading || autoJoining) return <main className="poll-participant-page"><BrandMark /><LoadingState label={autoJoining ? "Joining with your Session identity…" : "Opening your Poll…"} /></main>;
  if (!meta) return <main className="poll-participant-page"><BrandMark /><div className="participant-error-card"><ErrorState message={error || "Poll link not found."} /><Button variant="secondary" to="/join">Try another code</Button></div></main>;
  const poll = current?.poll;
  const canVote = poll?.state === "open";
  const ready = Boolean(current?.response.submitted) && !editing;
  const optionHasOther = current?.options.find((option) => option.isOther)?.id;
  const otherSelected = optionHasOther ? selected.includes(optionHasOther) : false;
  const waiting = ready && !results?.visible;
  if (!token && meta.poll.state !== "open") return <main className="poll-mobile-result"><header className="poll-mobile-brand"><BrandMark /></header><section className="poll-mobile-card"><span className="poll-state-icon"><LockKeyhole /></span><h1>This Poll is closed.</h1><p>Ask your trainer to reopen it if you still need to vote.</p><Button variant="secondary" to={meta.poll.sessionAccessSlug ? `/session/${meta.poll.sessionAccessSlug}` : "/join"}>Back to Session</Button></section></main>;
  if (!token) return <main className="poll-participant-page"><header className="poll-mobile-brand"><BrandMark /><span>YOUR VOTE MATTERS</span></header><div className="poll-mobile-shell"><div className="poll-mobile-step"><span>LIVE POLL</span><i /></div><section className="poll-mobile-question"><Badge tone="purple">{meta.poll.questionType === "single" ? "SINGLE CHOICE" : `SELECT UP TO ${meta.poll.maxSelections}`}</Badge><h1>{meta.poll.question}</h1><p>{meta.poll.questionType === "single" ? "Choose one answer to continue." : `Choose up to ${meta.poll.maxSelections} answers.`}</p></section>
    {meta.poll.sessionId || meta.poll.identityMode === "named" ? <form className="poll-entry-card" onSubmit={(event) => void enter(event)}>{meta.poll.sessionId && <div className="poll-session-identity-note"><Users size={16} />Join the Session once. Your name and team carry over to its other activities.</div>}<label className="field-label" htmlFor="poll-participant-name">Your name</label><input className="text-input participant-input" id="poll-participant-name" autoComplete="name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><label className="field-label" htmlFor="poll-participant-role">Your role <small>Optional</small></label><input className="text-input participant-input" id="poll-participant-role" maxLength={60} value={role} onChange={(event) => setRole(event.target.value)} />{meta.teams.length > 0 && <><label className="field-label" htmlFor="poll-participant-team">Choose your team</label><select className="text-input participant-input" id="poll-participant-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">Choose later</option>{meta.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></>}{error && <div className="inline-error" role="alert">{error}</div>}<Button type="submit" className="full-width" disabled={pending || !name.trim()}>{pending ? "Joining…" : "Continue to Poll"}</Button></form> : <section className="poll-anonymous-entry"><LockKeyhole size={18} /><p>This standalone Poll is anonymous. No name is needed.</p>{error && <div role="alert" className="inline-error">{error}</div>}<Button disabled={pending} variant="orange" className="full-width" onClick={() => void enter(undefined, true)}>{pending ? "Joining…" : "Start anonymous Poll"}</Button></section>}</div><div className="participant-bottom-note"><LockKeyhole size={16} /> No account · Your response stays private</div></main>;
  if (!current) return <main className="poll-participant-page"><BrandMark /><LoadingState label="Restoring your saved vote…" />{error && <ErrorState message={error} retry={() => void refreshGuest()} />}</main>;
  return <main className="poll-participant-page"><header className="poll-mobile-brand"><BrandMark /><span>{ready ? "VOTE SAVED" : "YOUR VOTE MATTERS"}</span></header><div className="poll-mobile-shell">
    <div className="poll-mobile-step"><span>{ready ? "SUBMITTED" : "LIVE POLL"}</span><i /></div><section className="poll-mobile-question"><Badge tone="purple">{current.poll.questionType === "single" ? "SINGLE CHOICE" : `SELECT UP TO ${current.poll.maxSelections}`}</Badge><h1>{current.poll.question}</h1>{!ready && <p>{current.poll.questionType === "single" ? "Choose one answer." : `Select up to ${current.poll.maxSelections} answers.`}</p>}</section>
    {!ready || editing ? <form className="poll-vote-form" onSubmit={(event) => void submitVote(event)}><div className="poll-answer-list">{current.options.map((option, index) => <div key={option.id}><button type="button" className={`poll-answer-option poll-answer-option-${index % 5} ${selected.includes(option.id) ? "selected" : ""}`} aria-pressed={selected.includes(option.id)} onClick={() => toggleOption(option.id)}><span className="poll-answer-check">{selected.includes(option.id) && <Check size={16} />}</span><strong>{option.label}</strong>{current.poll.questionType === "multiple" && <small>{selected.length} / {current.poll.maxSelections}</small>}</button>{option.isOther && selected.includes(option.id) && <textarea className="text-input poll-other-input" maxLength={150} placeholder="Tell us a little more…" value={otherText} onChange={(event) => setOtherText(event.target.value)} aria-label="Other response" required />}</div>)}</div>{error && <div role="alert" className="inline-error">{error}</div>}<Button type="submit" variant="orange" className="full-width" disabled={pending || !selected.length || (otherSelected && !otherText.trim()) || !canVote}>{pending ? "Saving your vote…" : !canVote ? "Poll is closed" : "Submit Vote"}</Button>{ready && <Button variant="secondary" className="full-width" onClick={() => setEditing(false)}>Cancel edit</Button>}</form> : <section className="poll-submitted-card"><div className="poll-vote-success"><span><Check size={16} /></span><strong>Your vote is saved</strong></div><h2>Your answer{current.response.selectedOptionIds.length > 1 ? "s" : ""}</h2><div className="poll-own-answer">{current.options.filter((option) => current.response.selectedOptionIds.includes(option.id)).map((option) => <span key={option.id}><i />{option.label}{option.isOther && current.response.otherText ? `: ${current.response.otherText}` : ""}</span>)}</div>{waiting && <div className="poll-waiting"><span><EyeOff size={18} /></span><div><strong>Waiting for your trainer</strong><small>Results will show here if your trainer reveals them to participants.</small></div></div>}{results?.visible && <section className="poll-personal-results"><div className="poll-personal-results-heading"><span className="eyebrow">GROUP RESULTS</span><b>{results.respondentCount} responses</b></div>{(results.results ?? []).map((result, index) => <div className={`poll-personal-row poll-analytics-row-${index % 5}`} key={result.optionId}><div><strong>{result.label}</strong><span>{result.count} votes · {result.percentage}%</span></div><div className="poll-bar-track"><i style={{ width: `${Math.max(result.percentage, result.count ? 4 : 0)}%` }} /></div>{results.selectedOptionIds?.includes(result.optionId) && <small>Your choice</small>}</div>)}{results.multiSelectNote && <p>{results.multiSelectNote}</p>}</section>}{!canVote && <div className="poll-waiting"><span><LockKeyhole size={18} /></span><div><strong>Poll closed</strong><small>Your saved response is still here. Your trainer may reopen this Poll.</small></div></div>}{canVote && <Button variant="secondary" className="full-width" onClick={() => { setEditing(true); setSelected(current.response.selectedOptionIds); setOtherText(current.response.otherText ?? ""); }}>Edit Vote</Button>}</section>}
    {error && ready && <div className="subtle-warning" role="status">{error}</div>}{autoNext && <div className="poll-next-notice"><span>Next Poll opens in a few seconds</span><button onClick={() => setAutoNext("")}>Stay here</button></div>}{nextActivities.length > 1 && ready && <section className="poll-next-list"><h2>Choose another Poll</h2>{nextActivities.filter((item) => !item.submitted && item.id !== current.poll.activityId).map((item) => <Link to={`/poll/${item.slug}`} key={item.id}>{item.title}<ArrowRight size={16} /></Link>)}</section>}
    <footer className="poll-mobile-footer"><span>{meta.poll.sessionName ?? "Quick activity"}</span><Link to={meta.poll.sessionAccessSlug ? `/session/${meta.poll.sessionAccessSlug}` : "/join"}>Done <ArrowRight size={15} /></Link></footer>
  </div><div className="participant-bottom-note"><LockKeyhole size={16} /> Your vote is stored for this activity · No account needed</div></main>;
}

export function PollPublicPresenterPage() {
  const token = window.location.hash.replace(/^#/, "");
  const { data, error } = usePollData<{ kind: "poll"; revealed: boolean; title: string; question: string; state: string; respondentCount?: number; results?: PollResultBar[]; questionType?: string; multiSelectNote?: string | null }>("/presenter", 1800, token);
  async function fullscreen() { try { await document.documentElement.requestFullscreen(); } catch { /* Fullscreen may be unavailable in a protected browser. */ } }
  return <main className="poll-presenter-screen"><header className="poll-presenter-top"><BrandMark /><div><span className="poll-presenter-live-dot" />LIVE POLL</div><button onClick={() => void fullscreen()}>Fullscreen <ExternalLink size={15} /></button></header>{error ? <div className="poll-presenter-center"><CircleHelp size={40} /><h1>Presenter link unavailable</h1><p>Ask your trainer to open a new Presenter screen.</p></div> : !data ? <div className="poll-presenter-center"><span className="poll-presenter-orbit" /><p>Connecting to the live Poll…</p></div> : <><section className="poll-presenter-question"><span className="eyebrow">{data.title}</span><h1>{data.question}</h1><span className="poll-presenter-respondents">{data.respondentCount ?? 0} responses</span></section>{data.revealed ? <section className="poll-presenter-chart">{data.results?.map((result, index) => <div className={`poll-presenter-bar poll-presenter-bar-${index % 5}`} key={result.optionId}><div><strong>{result.label}</strong><b>{result.percentage}% <small>({result.count})</small></b></div><div className="poll-presenter-track"><i style={{ width: `${Math.max(result.percentage, result.count ? 2 : 0)}%` }} /></div></div>)}{data.multiSelectNote && <p>{data.multiSelectNote}</p>}</section> : <section className="poll-presenter-hidden"><EyeOff size={30} /><h2>Results are hidden</h2><p>Your trainer will reveal the group results when everyone is ready.</p><Mascot kind="flower" /></section>}<footer className="poll-presenter-foot"><span>TrainerPopp!Kit</span><span>Share your voice. See what we can do together.</span></footer></>}</main>;
}
