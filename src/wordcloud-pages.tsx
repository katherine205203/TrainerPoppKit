import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Copy, Download, Eye, EyeOff, LockKeyhole, RefreshCw, RotateCcw, Sparkles, Trash2, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, BrandMark, Button, Card, EmptyState, ErrorState, LoadingState, Mascot, PageIntro, ToolPageHeader } from "./components";
import { countGraphemes, validateWordSubmission } from "./domain/wordcloud";

type Phase = "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";
type PresentationMode = "LIVE_WORD_CLOUD" | "CLOSE_AND_REVEAL";
type Team = { id: string; name: string };
type CloudTerm = { groupId: string; label: string; frequency: number; percentage: number | null; visible: boolean; mergedSourceLabels: string[] };
type ParticipantProgress = { id: string; displayName: string; teamName: string | null; joinedAt: string; status: "Joined" | "Submitted" };
type CloudData = {
  wordCloud: { activityId: string; sessionId: string | null; sessionName: string | null; title: string; prompt: string; maxWords: number; phase: Phase; visibility: "HIDDEN" | "LIVE_REVEAL"; startedOnce: boolean; revision: number; joinPin: string | null; joinPath: string | null; archivedAt: string | null; activeTeamFilter: string | null; presentationMode: PresentationMode; presenterRevealed: boolean; presenterHiddenOverride: boolean; presenterTeamFilter: string | null; presentationRevision: number; teamOfOneDisclosure: string };
  teams: Team[]; counts: { joined: number; submitted: number }; aggregate: { denominator: number; visibleTerms: CloudTerm[]; hiddenTerms: CloudTerm[]; cloudTop50: CloudTerm[] };
  mergeHistory: Array<{ operationId: string; label: string; createdAt: string }>;
  progress: { participants: ParticipantProgress[] };
};
type CloudListItem = { activity_id: string; session_id: string | null; title: string; state: string; join_pin: string | null; session_name: string | null; prompt: string; phase: Phase; visibility: string; max_words: number; revision: number; joined_count: number; submitted_count: number };
type SessionItem = { id: string; name: string; status: string };

function useCloud(activityId: string, interval = 0) {
  const [data, setData] = useState<CloudData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!activityId) return;
    let alive = true;
    const load = async () => {
      try {
        const [next, progress] = await Promise.all([
          api<Omit<CloudData, "progress">>(`/owner/wordclouds/${activityId}`),
          api<{ participants: ParticipantProgress[] }>(`/owner/wordclouds/${activityId}/progress`),
        ]);
        if (alive) { setData({ ...next, progress }); setError(""); }
      }
      catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not load Word Cloud."); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    const timer = interval ? window.setInterval(() => void load(), interval) : undefined;
    return () => { alive = false; if (timer) window.clearInterval(timer); };
  }, [activityId, interval, tick]);
  return { data, loading, error, refresh };
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const tone = phase === "OPEN" ? "green" : phase === "CLOSED" || phase === "ARCHIVED" ? "gray" : phase === "READY" ? "orange" : "yellow";
  return <Badge tone={tone}>{phase.replace("_", " ")}</Badge>;
}

function WordCloudCard({ item }: { item: CloudListItem }) {
  const path = item.phase === "DRAFT" || item.phase === "READY" ? `/wordclouds/${item.activity_id}/edit` : `/wordclouds/${item.activity_id}`;
  return <Link className="wc-list-card" to={path}>
    <span className="wc-list-art"><Mascot kind="flower" /></span><span className="wc-list-copy"><span className="wc-list-meta"><PhaseBadge phase={item.phase} />{item.session_name && <small>{item.session_name}</small>}</span><strong>{item.title}</strong><span>{item.prompt}</span><small>{item.submitted_count} responses · {item.max_words} words each</small></span><ArrowRight size={19} />
  </Link>;
}

export function WordCloudOverviewPage() {
  const [items, setItems] = useState<CloudListItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; api<{ wordClouds: CloudListItem[] }>("/owner/wordclouds").then((data) => { if (alive) setItems(data.wordClouds); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load activities."); }); return () => { alive = false; }; }, []);
  return <div className="page-stack tool-overview-page wc-overview"><ToolPageHeader title="Word Cloud" description="Gather anonymous words and make shared themes visible." />
    <section className="wc-overview-hero"><div><span className="eyebrow">A SPACE FOR EVERY VOICE</span><h2>Let the group’s words<br />take shape<span>!</span></h2><p>Participants submit a few words privately. You choose when to reveal a live, anonymous cloud.</p><Button variant="yellow" to="/wordclouds/new">Create a Word Cloud <ArrowRight size={16} /></Button></div><div className="wc-cloud-art" aria-hidden="true"><span>ideas</span><span>trust</span><span>curiosity</span><span>teamwork</span><span>growth</span><Mascot kind="popp" /></div></section>
    <div className="section-heading"><div><span className="eyebrow">YOUR ACTIVITIES</span><h2>Word Cloud sessions</h2></div></div>
    {error ? <ErrorState message={error} /> : items === null ? <LoadingState label="Loading Word Clouds…" /> : items.length ? <div className="wc-list">{items.map((item) => <WordCloudCard item={item} key={item.activity_id} />)}</div> : <Card><EmptyState title="Start with one good question" description="Create a standalone activity or attach a Word Cloud to an existing Session." action={<Button to="/wordclouds/new" variant="orange">Create your first activity</Button>} /></Card>}
    <div className="wc-privacy-note"><LockKeyhole size={17} /><span>Responses are anonymous. Trainer views show words and totals, never who submitted each word.</span></div>
  </div>;
}

export function WordCloudEditorPage() {
  const { activityId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(activityId && activityId !== "new");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [maxWords, setMaxWords] = useState(3);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("LIVE_WORD_CLOUD");
  const [revision, setRevision] = useState(0);
  const [sessionId, setSessionId] = useState(params.get("sessionId") ?? "");
  const [standaloneTeams, setStandaloneTeams] = useState("");
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; api<{ sessions: SessionItem[] }>("/owner/sessions").then((data) => { if (alive) setSessions(data.sessions); }).catch(() => undefined); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api<CloudData>(`/owner/wordclouds/${activityId}`).then((data) => { if (!alive) return; setTitle(data.wordCloud.title); setPrompt(data.wordCloud.prompt); setMaxWords(data.wordCloud.maxWords); setPresentationMode(data.wordCloud.presentationMode); setRevision(data.wordCloud.revision); setSessionId(data.wordCloud.sessionId ?? ""); setStandaloneTeams(data.teams.map((team) => team.name).join("\n")); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load this activity."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activityId, editing]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const payload = { title, prompt, maxWords, presentationMode, sessionId: sessionId || null, teamNames: standaloneTeams.split(/\r?\n/u).map((name) => name.trim()).filter(Boolean), ...(editing ? { expectedRevision: revision } : { saveAsDraft }) };
    try {
      if (editing) { await api(`/owner/wordclouds/${activityId}`, { method: "PATCH", body: JSON.stringify(payload) }); navigate(`/wordclouds/${activityId}`); }
      else { const result = await post<{ activityId: string; phase: Phase }>("/owner/wordclouds", payload); navigate(result.phase === "DRAFT" ? `/wordclouds/${result.activityId}/edit` : `/wordclouds/${result.activityId}`); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this activity."); }
    finally { setBusy(false); }
  }
  if (loading) return <LoadingState label="Opening activity settings…" />;
  return <div className="page-stack wc-editor-page"><div className="breadcrumb"><Link to="/tools/wordcloud">Word Cloud</Link><ArrowRight size={14} /><span>{editing ? "Edit activity" : "New activity"}</span></div><PageIntro eyebrow="ACTIVITY SETUP" title={editing ? "Make it yours" : "Create a Word Cloud"} description="Set one clear prompt and let participants answer in their own words." />
    <form className="wc-editor-grid" onSubmit={(event) => void save(event)}><Card className="wc-form-card"><label className="field-label" htmlFor="wc-title">Activity name</label><input id="wc-title" className="text-input" maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Team check-in" />
      <label className="field-label" htmlFor="wc-prompt">Question for participants</label><textarea id="wc-prompt" className="text-input wc-prompt-input" maxLength={200} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What helps you do your best work?" /><small className="wc-field-help">Keep it open-ended. Each word or phrase can be up to 40 characters.</small>
      <label className="field-label" htmlFor="wc-max-words">Words per participant</label><select id="wc-max-words" className="text-input" value={maxWords} onChange={(event) => setMaxWords(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((amount) => <option key={amount} value={amount}>{amount} {amount === 1 ? "word or phrase" : "words or phrases"}</option>)}</select>
      <label className="field-label" htmlFor="wc-session">Add to a Session <small>(optional)</small></label><select id="wc-session" className="text-input" value={sessionId} disabled={editing} onChange={(event) => setSessionId(event.target.value)}><option value="">Standalone activity</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select>{editing && <small className="wc-field-help">The Session cannot be changed after creation.</small>}
      <div className="wc-v11-mode-section"><div className="wc-v11-section-label"><span className="field-label">Presenter flow</span><small>Choose how the audience screen behaves during the activity.</small></div><div className="wc-v11-mode-grid"><button type="button" className={`wc-v11-mode-card ${presentationMode === "LIVE_WORD_CLOUD" ? "is-selected" : ""}`} onClick={() => setPresentationMode("LIVE_WORD_CLOUD")}><span className="wc-v11-mode-icon wc-v11-mode-icon-live"><Sparkles size={20} /></span><span><strong>Live Word Cloud</strong><small>Words appear as people submit.</small></span><span className="wc-v11-radio" aria-hidden="true" /></button><button type="button" className={`wc-v11-mode-card ${presentationMode === "CLOSE_AND_REVEAL" ? "is-selected" : ""}`} onClick={() => setPresentationMode("CLOSE_AND_REVEAL")}><span className="wc-v11-mode-icon wc-v11-mode-icon-reveal"><Eye size={20} /></span><span><strong>Close &amp; Reveal</strong><small>Keep the cloud private until you close.</small></span><span className="wc-v11-radio" aria-hidden="true" /></button></div></div>
      <div className="wc-v11-limit-card"><span className="wc-v11-limit-number">40</span><span><strong>Character limit</strong><small>Each word or phrase can be up to 40 characters.</small></span></div>
      {!sessionId && <><label className="field-label" htmlFor="wc-teams">Team names <small>(optional, one per line)</small></label><textarea id="wc-teams" className="text-input wc-teams-input" value={standaloneTeams} onChange={(event) => setStandaloneTeams(event.target.value)} placeholder={'Team A\nTeam B'} /></>}
      {!editing && <label className="wc-draft-choice"><input type="checkbox" checked={saveAsDraft} onChange={(event) => setSaveAsDraft(event.target.checked)} /><span><strong>Save as draft</strong><small>Prepare this activity before creating its participant code.</small></span></label>}
      {error && <div className="inline-error" role="alert">{error}</div>}<div className="wc-form-actions"><Button variant="secondary" to="/tools/wordcloud">Cancel</Button><Button type="submit" disabled={busy} variant="orange">{busy ? "Saving…" : editing ? "Save changes" : saveAsDraft ? "Save draft" : "Create activity"}</Button></div>
    </Card><aside className="wc-editor-aside"><div className="wc-preview-card"><span>QUESTION PREVIEW</span><h3>{prompt || "Your group’s question appears here."}</h3><small>Each person can add up to {maxWords} words.</small></div></aside></form>
  </div>;
}

function cloudTextSize(frequency: number, max: number) { return 18 + Math.round((frequency / Math.max(max, 1)) * 38); }
function WordCloudVisual({ terms, className = "" }: { terms: CloudTerm[]; className?: string }) {
  const palette = ["#3939ff", "#ff5b22", "#ee45bb", "#1a1a27", "#d29d00", "#168d9e"];
  const max = Math.max(1, ...terms.map((term) => term.frequency));
  return <div className={`wc-word-visual ${className}`} aria-label="Anonymous word cloud">{terms.length ? terms.map((term, index) => <span key={term.groupId} style={{ fontSize: cloudTextSize(term.frequency, max), color: palette[index % palette.length] }}>{term.label}</span>) : <div className="wc-cloud-empty"><Mascot kind="flower" /><strong>Words appear here</strong><span>Open the activity and invite your group to respond.</span></div>}</div>;
}

export function WordCloudControlPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useCloud(activityId, 5000);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [presenterLink, setPresenterLink] = useState("");
  const cloud = data?.wordCloud;
  async function transition(action: string) {
    if (!data) return;
    if (action === "CLOSE" && !window.confirm("Close submissions now? Participants will not be able to submit until you reopen the activity.")) return;
    if (action === "FINALIZE_ARCHIVE" && !window.confirm("Finalize and archive this activity? Results become read-only.")) return;
    setBusy(true); setActionError("");
    try { await post(`/owner/wordclouds/${activityId}/transition`, { action, expectedRevision: cloud!.revision }); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not update activity state."); refresh(); }
    finally { setBusy(false); }
  }
  async function moderate(payload: Record<string, unknown>) {
    if (!data) return;
    setBusy(true); setActionError("");
    try { await post(`/owner/wordclouds/${activityId}/moderate`, { ...payload, expectedRevision: cloud!.revision }); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not moderate these words."); refresh(); }
    finally { setBusy(false); }
  }
  async function teamFilter(value: string, presenter = false) {
    if (!data) return;
    setBusy(true); setActionError("");
    try { await post(`/owner/wordclouds/${activityId}/${presenter ? "presenter-team-filter" : "team-filter"}`, { teamId: value || null, expectedRevision: cloud!.revision }); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not change the team filter."); refresh(); }
    finally { setBusy(false); }
  }
  async function copyJoin() {
    if (!cloud?.joinPath) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${cloud.joinPath}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setActionError("Could not copy the link. Select it below to copy manually."); }
  }
  async function openPresenter() {
    setBusy(true); setActionError("");
    const presenterWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const result = await post<{ path: string }>(`/owner/activities/${activityId}/presenter-token`, {});
      const url = `${window.location.origin}${result.path}`;
      setPresenterLink(url);
      if (presenterWindow) presenterWindow.location.href = url;
      else setActionError("Your browser blocked the Presenter tab. Use the link below to open it.");
    } catch (reason) { presenterWindow?.close(); setActionError(reason instanceof Error ? reason.message : "Could not open Presenter Mode."); }
    finally { setBusy(false); }
  }
  async function duplicate() { try { const result = await post<{ activityId: string }>(`/owner/wordclouds/${activityId}/duplicate`, {}); window.location.assign(`/wordclouds/${result.activityId}/edit`); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not duplicate this activity."); } }
  async function deleteActivity() { if (!window.confirm("Delete this Word Cloud and its anonymous responses? This cannot be undone.")) return; try { await api(`/owner/wordclouds/${activityId}`, { method: "DELETE" }); window.location.assign("/tools/wordcloud"); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not delete this activity."); } }
  async function exportPng() {
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 900;
    const context = canvas.getContext("2d"); if (!context) { setActionError("PNG export is not supported in this browser."); return; }
    context.fillStyle = "#fffaf4"; context.fillRect(0, 0, canvas.width, canvas.height); context.textAlign = "center"; context.textBaseline = "middle";
    const palette = ["#3939ff", "#ff5b22", "#ee45bb", "#1a1a27", "#d29d00", "#168d9e"];
    const terms = shownTerms.slice(0, 50); const max = Math.max(1, ...terms.map((term) => term.frequency));
    const placed = terms.map((term, index) => ({ term, x: canvas.width / 2 + Math.sin(index * 2.35) * (index % 2 ? 390 : 230), y: canvas.height / 2 + Math.cos(index * 1.7) * (index % 2 ? 285 : 160), size: 34 + Math.round((term.frequency / max) * 58), color: palette[index % palette.length] })).sort((a, b) => a.size - b.size);
    for (const word of placed) { context.font = `700 ${word.size}px Arial, sans-serif`; context.fillStyle = word.color; context.fillText(word.term.label, word.x, word.y, 620); }
    canvas.toBlob((blob) => { if (!blob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "word-cloud.png"; link.click(); URL.revokeObjectURL(link.href); }, "image/png");
  }
  if (loading) return <LoadingState label="Loading Word Cloud controls…" />;
  if (error || !data || !cloud) return <ErrorState message={error || "This Word Cloud could not be found."} retry={refresh} />;
  const joinUrl = cloud.joinPath ? `${window.location.origin}${cloud.joinPath}` : "";
  const shownTerms = data.aggregate.visibleTerms;
  const moderationTerms = data.aggregate.hiddenTerms;
  const isLiveMode = cloud.presentationMode === "LIVE_WORD_CLOUD";
  const presenterVisible = isLiveMode ? !cloud.presenterHiddenOverride : cloud.presenterRevealed;
  const presenterAction = isLiveMode ? (presenterVisible ? "HIDE_RESULTS" : "SHOW_LIVE") : (presenterVisible ? "HIDE_PRESENTER" : "REVEAL_RESULTS");
  const canChangePresenter = cloud.phase !== "ARCHIVED" && (isLiveMode || cloud.phase === "CLOSED");
  const submitted = data.progress.participants.filter((participant) => participant.status === "Submitted").length;
  const joined = data.progress.participants.length;
  return <div className="page-stack wc-control-page wc-v11-control-page">
    <div className="breadcrumb"><Link to="/tools/wordcloud">Word Cloud</Link><ArrowRight size={14} /><span>{cloud.title}</span></div>
    <div className="wc-v11-control-header"><div><span className="eyebrow">CONTROL ROOM</span><h1>{cloud.title}<span className="title-dot">.</span></h1><p>{cloud.prompt}</p></div><div className="wc-v11-header-actions"><PhaseBadge phase={cloud.phase} /><Button variant="orange" disabled={busy || cloud.phase === "DRAFT"} onClick={() => void openPresenter()}><Eye size={16} /> Open Presenter</Button></div></div>
    <div className="wc-v11-flow-tabs"><span className="is-active">Control room</span><Link to={`/wordclouds/${activityId}/results`}>Private results</Link><Link to={`/wordclouds/${activityId}/presenter`}>Presenter settings</Link></div>
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}
    <div className="wc-control-actions wc-v11-actions">{cloud.phase === "DRAFT" && <Button variant="orange" disabled={busy} onClick={() => void transition("PUBLISH")}>Publish activity</Button>}{cloud.phase === "READY" && <Button variant="orange" disabled={busy} onClick={() => void transition("OPEN")}>Open for responses</Button>}{cloud.phase === "OPEN" && <Button variant="danger" disabled={busy} onClick={() => void transition("CLOSE")}>Close submissions</Button>}{cloud.phase === "CLOSED" && <><Button variant="secondary" disabled={busy} onClick={() => void transition("REOPEN")}>Reopen activity</Button><Button variant="orange" disabled={busy} onClick={() => void transition("FINALIZE_ARCHIVE")}>Archive activity</Button></>}{canChangePresenter && <Button variant={presenterVisible ? "secondary" : "orange"} disabled={busy || (!presenterVisible && !isLiveMode && cloud.phase !== "CLOSED")} onClick={() => void transition(presenterAction)} icon={presenterVisible ? <EyeOff size={16} /> : <Eye size={16} />}>{presenterVisible ? "Hide Presenter" : isLiveMode ? "Show live cloud" : "Reveal results"}</Button>}<Button variant="secondary" to={`/wordclouds/${activityId}/results`}>Results &amp; moderation <ArrowRight size={16} /></Button></div>
    <div className="wc-v11-mode-strip"><span className="wc-v11-mode-dot" />{isLiveMode ? <><strong>Live Word Cloud</strong><span>Presenter updates as accepted responses arrive.</span></> : <><strong>Close &amp; Reveal</strong><span>Presenter stays in the lobby until you close and reveal.</span></>}</div>
    {cloud.phase === "CLOSED" && cloud.presentationMode === "CLOSE_AND_REVEAL" && !cloud.presenterRevealed && <div className="wc-v11-closed-banner"><LockKeyhole size={18} /><span><strong>Activity closed.</strong> Review the private preview, then reveal the final cloud when ready.</span><Button variant="orange" disabled={busy} onClick={() => void transition("REVEAL_RESULTS")}>Reveal results</Button></div>}
    <div className="wc-v11-control-grid">
      <Card className="wc-v11-invite-card"><div className="wc-v11-card-heading"><span className="eyebrow">JOIN THIS ACTIVITY</span><span className="wc-v11-live-dot">● LIVE</span></div><h2>Invite your group</h2><p>Scan the QR code, open the link, or enter the PIN.</p><div className="wc-v11-invite-body"><div className="wc-qr">{joinUrl ? <QRCodeSVG value={joinUrl} size={150} includeMargin /> : <span>QR code available<br />after publish</span>}</div><div className="wc-v11-join-details"><span className="wc-v11-label">PIN</span><strong className="wc-pin">{cloud.joinPin ? `${cloud.joinPin.slice(0, 3)} ${cloud.joinPin.slice(3)}` : "—"}</strong><span className="wc-v11-label">LINK</span><div className="wc-link-row"><input readOnly aria-label="Participant join link" value={joinUrl} /><button aria-label="Copy activity link" onClick={() => void copyJoin()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><button className="wc-v11-copy-link" onClick={() => void copyJoin()}>{copied ? "Copied" : "Copy link"}</button></div></div></Card>
      <Card className="wc-v11-progress-card"><div className="wc-v11-card-heading"><span className="eyebrow">PARTICIPATION</span><span className="wc-v11-progress-percent">{joined ? Math.round((submitted / joined) * 100) : 0}%</span></div><h2>{submitted} of {joined} submitted</h2><div className="wc-v11-progress-track"><span style={{ width: `${joined ? Math.round((submitted / joined) * 100) : 0}%` }} /></div><div className="wc-v11-stat-row"><span><strong>{joined}</strong> joined</span><span><strong>{submitted}</strong> submitted</span></div><div className="wc-v11-participants">{data.progress.participants.length ? data.progress.participants.map((participant) => <div className="wc-v11-participant" key={participant.id}><span className="wc-v11-avatar">{participant.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{participant.displayName}</strong>{participant.teamName && <small>{participant.teamName}</small>}</span><Badge tone={participant.status === "Submitted" ? "green" : "gray"}>{participant.status}</Badge></div>) : <div className="wc-v11-empty-participants"><Users size={20} /><span>Waiting for participants to join…</span></div>}</div></Card>
      <Card className="wc-v11-preview-card"><div className="wc-v11-card-heading"><div><span className="eyebrow">PRIVATE PREVIEW</span><h2>Your view</h2></div><Badge tone="gray"><LockKeyhole size={13} /> Trainer only</Badge></div><div className="wc-v11-preview-toolbar"><label>Team<select aria-label="Filter private results by team" className="text-input" value={cloud.activeTeamFilter ?? ""} onChange={(event) => void teamFilter(event.target.value)} disabled={cloud.phase === "ARCHIVED"}><option value="">All teams</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><span>{data.aggregate.denominator} submissions</span></div><p className="wc-question">{cloud.prompt}</p><WordCloudVisual terms={shownTerms.slice(0, 50)} /><div className="wc-submission-foot">Anonymous aggregate preview · {cloud.teamOfOneDisclosure}</div></Card>
    </div>
    <Card className="wc-v11-presenter-card"><div><div className="wc-v11-card-heading"><span className="eyebrow">PRESENTER SCREEN</span><Badge tone={presenterVisible ? "green" : "gray"}>{presenterVisible ? "Visible" : "Hidden"}</Badge></div><h2>{isLiveMode ? "Live cloud" : "Reveal results"}</h2><p>{isLiveMode ? "The Presenter screen updates automatically after the first accepted submission." : "The Presenter screen remains in the join lobby until the activity is closed and you reveal it."}</p></div><div className="wc-v11-presenter-controls"><label>Presenter team<select aria-label="Filter Presenter by team" className="text-input" value={cloud.presenterTeamFilter ?? ""} onChange={(event) => void teamFilter(event.target.value, true)} disabled={busy || cloud.phase === "ARCHIVED"}><option value="">All teams</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><Button variant="secondary" disabled={busy || !canChangePresenter} onClick={() => void transition(presenterAction)} icon={presenterVisible ? <EyeOff size={16} /> : <Eye size={16} />}>{presenterVisible ? "Hide" : isLiveMode ? "Show live" : "Reveal"}</Button></div></Card>
    {presenterLink && <div className="wc-v11-presenter-link"><span>Presenter link ready</span><a href={presenterLink} target="_blank" rel="noreferrer">Open in a new tab <ArrowRight size={14} /></a></div>}
    <Card className="wc-quick-moderation"><div className="section-heading"><div><span className="eyebrow">QUICK MODERATION</span><h2>Hide a word from the cloud</h2></div></div><div className="wc-quick-hide-list">{shownTerms.slice(0, 8).map((term) => <span key={term.groupId}>{term.label}<button aria-label={`Hide ${term.label}`} disabled={busy || cloud.phase === "ARCHIVED"} onClick={() => void moderate({ action: "HIDE", groupId: term.groupId })}><EyeOff size={14} /></button></span>)}{shownTerms.length === 0 && <small>Submitted words appear here after the first response.</small>}</div><div className="wc-v11-moderation-links"><Link className="text-link" to={`/wordclouds/${activityId}/results`}>Open full moderation and results <ArrowRight size={15} /></Link><Button variant="secondary" onClick={() => void exportPng()}><Download size={16} /> PNG</Button></div></Card>
    {moderationTerms.length > 0 && <Card><div className="section-heading"><h2>Hidden from the cloud</h2><Badge tone="gray">{moderationTerms.length}</Badge></div><div className="wc-quick-hide-list">{moderationTerms.map((term) => <span key={term.groupId}>{term.label}<button aria-label={`Restore ${term.label}`} disabled={busy || cloud.phase === "ARCHIVED"} onClick={() => void moderate({ action: "RESTORE", groupId: term.groupId })}><Eye size={14} /></button></span>)}</div></Card>}
    <details className="wc-advanced-actions"><summary>Other activity actions</summary><div><Button variant="secondary" onClick={() => void duplicate()}>Duplicate as draft</Button>{cloud.phase !== "OPEN" && <Button variant="danger" onClick={() => void deleteActivity()} icon={<Trash2 size={15} />}>Delete activity</Button>}</div></details>
  </div>;
}

export function WordCloudResultsPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useCloud(activityId, 5000);
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading) return <LoadingState label="Loading anonymous results…" />;
  if (error || !data) return <ErrorState message={error || "Results are unavailable."} retry={refresh} />;
  const { wordCloud: cloud } = data;
  const rows = [...data.aggregate.visibleTerms, ...data.aggregate.hiddenTerms];
  async function act(payload: Record<string, unknown>) { setBusy(true); setErrorMessage(""); try { await post(`/owner/wordclouds/${activityId}/moderate`, { ...payload, expectedRevision: cloud.revision }); refresh(); setSelected([]); setLabel(""); } catch (reason) { setErrorMessage(reason instanceof Error ? reason.message : "Could not update moderation."); refresh(); } finally { setBusy(false); } }
  return <div className="page-stack wc-results-page"><div className="breadcrumb"><Link to={`/wordclouds/${activityId}`}>Live control</Link><ArrowRight size={14} /><span>Results & moderation</span></div><PageIntro eyebrow="PRIVATE TRAINER VIEW" title="Listen for patterns" description={`${cloud.title} · ${data.aggregate.denominator} anonymous submissions`} action={<Button variant="secondary" to={`/wordclouds/${activityId}`}>Back to live control</Button>} />
    <Card className="wc-result-overview"><div className="section-heading"><div><span className="eyebrow">VISIBLE WORDS</span><h2>Top words from your group</h2></div><a className="button button-orange" href={`/api/owner/wordclouds/${activityId}/export?format=csv${cloud.activeTeamFilter ? `&teamId=${encodeURIComponent(cloud.activeTeamFilter)}` : ""}`}><Download size={16} /> Download anonymous CSV</a></div><WordCloudVisual terms={data.aggregate.cloudTop50} /><p className="wc-submission-foot">Frequency counts unique participants in each merged group. Team-only filters use the team snapshot captured at submission.</p></Card>
    {errorMessage && <div className="inline-error" role="alert">{errorMessage}</div>}
    <Card className="wc-table-card"><div className="section-heading"><div><span className="eyebrow">ALL RESPONSES</span><h2>Word frequency</h2></div><span className="wc-denominator">{data.aggregate.denominator} submissions</span></div><div className="wc-team-warning"><LockKeyhole size={16} /><span>{data.wordCloud.teamOfOneDisclosure}</span></div>{selected.length > 1 && <div className="wc-merge-bar"><label className="wc-merge-label">Merged label<input className="text-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. collaboration" /></label><Button variant="orange" disabled={busy || !label.trim()} onClick={() => void act({ action: "MERGE", sourceGroupIds: selected, destinationGroupId: selected[0], destinationLabel: label })}>Merge selected ({selected.length})</Button></div>}
      <div className="wc-table-scroll"><table className="wc-results-table"><thead><tr><th><span className="wc-screen-reader">Select</span></th><th>Word or phrase</th><th>Unique submitters</th><th>Share</th><th>Visibility</th><th>Action</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.groupId}><td><input type="checkbox" aria-label={`Select ${row.label} for merge`} checked={selected.includes(row.groupId)} disabled={busy || cloud.phase === "ARCHIVED"} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.groupId] : current.filter((id) => id !== row.groupId))} /></td><td><strong>{row.label}</strong>{row.mergedSourceLabels.length > 0 && <small className="wc-merged-labels">Includes {row.mergedSourceLabels.join(", ")}</small>}</td><td>{row.frequency}</td><td>{row.percentage === null ? "—" : `${row.percentage}%`}</td><td><Badge tone={row.visible ? "green" : "gray"}>{row.visible ? "Visible" : "Hidden"}</Badge></td><td>{row.visible ? <button className="text-button" disabled={busy || cloud.phase === "ARCHIVED"} onClick={() => void act({ action: "HIDE", groupId: row.groupId })}><EyeOff size={14} /> Hide</button> : <button className="text-button" disabled={busy || cloud.phase === "ARCHIVED"} onClick={() => void act({ action: "RESTORE", groupId: row.groupId })}><Eye size={14} /> Restore</button>}</td></tr>) : <tr><td colSpan={6}>Words appear here after participants submit.</td></tr>}</tbody></table></div>
    </Card>
    <Card className="wc-merge-history-card"><div className="section-heading"><div><span className="eyebrow">REVERSIBLE MODERATION</span><h2>Merge history</h2></div></div>{data.mergeHistory.length ? data.mergeHistory.map((operation) => <div className="wc-merge-history" key={operation.operationId}><span><strong>{operation.label}</strong><small>{new Date(operation.createdAt).toLocaleString()}</small></span><button disabled={busy || cloud.phase === "ARCHIVED"} onClick={() => void act({ action: "UNMERGE", operationId: operation.operationId })}><RotateCcw size={15} /> Undo merge</button></div>) : <p>No words have been merged. You can merge close variations without changing their combined submitter count.</p>}
    </Card>
  </div>;
}

export function WordCloudPresenterControlsPage() {
  const { activityId = "" } = useParams();
  const { data, loading, error, refresh } = useCloud(activityId, 3000);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  if (loading) return <LoadingState label="Loading Presenter controls…" />;
  if (error || !data) return <ErrorState message={error || "Presenter controls are unavailable."} retry={refresh} />;
  const cloud = data.wordCloud;
  const isLiveMode = cloud.presentationMode === "LIVE_WORD_CLOUD";
  const presenterVisible = isLiveMode ? !cloud.presenterHiddenOverride : cloud.presenterRevealed;
  const presenterAction = isLiveMode ? (presenterVisible ? "HIDE_RESULTS" : "SHOW_LIVE") : (presenterVisible ? "HIDE_PRESENTER" : "REVEAL_RESULTS");
  const canChangePresenter = cloud.phase !== "ARCHIVED" && (isLiveMode || cloud.phase === "CLOSED");
  async function reveal(action: string) { setBusy(true); setProblem(""); try { await post(`/owner/wordclouds/${activityId}/transition`, { action, expectedRevision: cloud.revision }); refresh(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not update Presenter visibility."); refresh(); } finally { setBusy(false); } }
  async function createLink() { try { const result = await post<{ path: string }>(`/owner/activities/${activityId}/presenter-token`, {}); setLink(`${window.location.origin}${result.path}`); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not create Presenter link."); } }
  async function setTeam(teamId: string) { setBusy(true); try { await post(`/owner/wordclouds/${activityId}/presenter-team-filter`, { teamId: teamId || null, expectedRevision: cloud.revision }); refresh(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Could not change the Presenter team filter."); } finally { setBusy(false); } }
  return <div className="page-stack wc-presenter-controls wc-v11-presenter-settings"><div className="breadcrumb"><Link to={`/wordclouds/${activityId}`}>Control room</Link><ArrowRight size={14} /><span>Presenter settings</span></div><PageIntro eyebrow="PRESENTER SETTINGS" title="Open the audience screen" description="A read-only screen for the room. It never shows names, submitted status, or word ownership." />{problem && <div className="inline-error" role="alert">{problem}</div>}
    <div className="wc-v11-setting-layout"><Card><div className="wc-v11-card-heading"><span className="eyebrow">PRESENTATION FLOW</span><Badge tone={isLiveMode ? "green" : "orange"}>{isLiveMode ? "Live" : "Close & reveal"}</Badge></div><h2>{isLiveMode ? "Live Word Cloud" : "Close & Reveal"}</h2><p>{isLiveMode ? "The audience cloud appears after the first accepted response and keeps updating automatically." : "The audience stays in a join lobby. Close submissions, review privately, then reveal the final cloud."}</p><div className="wc-presenter-state"><i className={presenterVisible ? "wc-visible" : ""} />{presenterVisible ? "PRESENTER VISIBLE" : cloud.phase === "CLOSED" && !isLiveMode ? "READY TO REVEAL" : "PRESENTER HIDDEN"}</div><Button variant={presenterVisible ? "secondary" : "orange"} disabled={busy || !canChangePresenter} onClick={() => void reveal(presenterAction)} icon={presenterVisible ? <EyeOff size={16} /> : <Eye size={16} />}>{presenterVisible ? "Hide the screen" : isLiveMode ? "Show live cloud" : "Reveal final cloud"}</Button><label className="field-label" htmlFor="wc-presenter-team">Presenter team</label><select id="wc-presenter-team" className="text-input" disabled={busy || cloud.phase === "ARCHIVED"} value={cloud.presenterTeamFilter ?? ""} onChange={(event) => void setTeam(event.target.value)}><option value="">All teams</option>{data.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><small>This filter is independent from the Trainer private preview.</small></Card><div className="wc-v11-settings-preview"><span className="eyebrow">PRIVATE PREVIEW</span><h2>{cloud.title}</h2><p>{cloud.prompt}</p><WordCloudVisual terms={presenterVisible ? data.aggregate.cloudTop50 : []} /><span className="wc-submission-foot">{presenterVisible ? "Aggregate words only" : "The audience screen is currently hidden."}</span></div></div>
    <Card className="wc-presenter-share wc-v11-presenter-share"><div><span className="eyebrow">PRESENTER LINK</span><h2>Open Presenter in a separate tab</h2><p>Create a capability link and open it on the room display. Polling keeps the screen synchronized with the Control Room.</p>{link ? <div className="wc-link-row"><input readOnly aria-label="Presenter link" value={link} /><button aria-label="Copy Presenter link" onClick={() => void navigator.clipboard.writeText(link)}><Copy size={16} /></button></div> : <Button variant="orange" onClick={() => void createLink()}>Create Presenter link <ArrowRight size={16} /></Button>}{link && <a className="button button-secondary" href={link} target="_blank" rel="noreferrer">Open screen <ArrowRight size={16} /></a>}</div><div className="wc-presenter-mascot"><Mascot kind="sun" /></div></Card>
  </div>;
}

type ParticipantState = { state: "WAITING" | "OPEN" | "CLOSED" | "ARCHIVED" | "ALREADY_SUBMITTED"; title: string; prompt: string; maxWords: number; teamName: string | null };
function draftKey(activityId: string) { return `trainerpopp:wordcloud:draft:${activityId}`; }

export function WordCloudParticipantRunner({ activityId, token }: { activityId: string; token: string }) {
  const [state, setState] = useState<ParticipantState | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    let initialized = false;
    const load = async () => {
      try {
        const next = await api<ParticipantState>("/guest/wordcloud/state", { headers: { Authorization: `Bearer ${token}` } });
        if (!alive) return;
        setState(next);
        if (next.state === "ALREADY_SUBMITTED") { setSubmitted(true); try { localStorage.removeItem(draftKey(activityId)); } catch { /* Submitted responses never need a local draft. */ } }
        if (!initialized) {
          initialized = true;
          try { const draft = next.state === "ALREADY_SUBMITTED" ? null : JSON.parse(localStorage.getItem(draftKey(activityId)) ?? "null") as unknown; if (Array.isArray(draft)) setWords(Array.from({ length: next.maxWords }, (_, index) => typeof draft[index] === "string" ? draft[index] : "")); else setWords(Array.from({ length: next.maxWords }, () => "")); }
          catch { setWords(Array.from({ length: next.maxWords }, () => "")); }
        }
        setError("");
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not open this activity."); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activityId, token]);
  useEffect(() => { if (!state || submitted) return; try { localStorage.setItem(draftKey(activityId), JSON.stringify(words)); } catch { /* Draft is preserved in memory if device storage is unavailable. */ } }, [activityId, state, submitted, words]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!state) return;
    const validation = validateWordSubmission(words.filter((word) => word.trim()), state.maxWords);
    if (!validation.ok) { setError(validation.message); return; }
    setBusy(true); setError(""); setSaved(false);
    const keyName = `trainerpopp:wordcloud:retry:${activityId}`;
    let idempotencyKey = sessionStorage.getItem(keyName);
    if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); sessionStorage.setItem(keyName, idempotencyKey); }
    try { await api("/guest/wordcloud/submit", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ words: validation.words.map((word) => word.original), idempotencyKey }) }); setSubmitted(true); try { localStorage.removeItem(draftKey(activityId)); } catch { /* Safe to leave no server draft. */ } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit yet. Your draft is saved on this device."); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="participant-page wc-participant-page"><BrandMark /><LoadingState label="Opening your activity…" /></main>;
  if (!state) return <main className="participant-page wc-participant-page"><BrandMark /><ErrorState message={error || "This activity could not be opened."} /></main>;
  const complete = submitted || state.state === "ALREADY_SUBMITTED";
  return <main className="participant-page wc-participant-page"><div className="participant-brand"><BrandMark /></div><div className="wc-participant-orbit" aria-hidden="true"><Mascot kind="flower" /></div><div className="wc-participant-content"><span className="eyebrow">{complete ? "THANK YOU" : state.state === "WAITING" ? "GET READY" : "YOUR WORDS, YOUR WAY"}</span><h1>{complete ? "You’ve added your voice!" : state.state === "WAITING" ? "Your activity starts soon." : state.state === "CLOSED" || state.state === "ARCHIVED" ? "This activity has ended." : state.title}<span className="title-dot">.</span></h1>
    {complete ? <section className="wc-participant-message"><span className="wc-success-mark"><Check size={26} /></span><h2>Your response is in.</h2><p>Thank you for sharing. Your words are anonymous; this screen will not show the group cloud or reveal anyone else’s response.</p><span className="wc-thanks-art"><Mascot kind="popp" /></span></section> : state.state === "WAITING" ? <section className="wc-participant-message"><p>Your trainer will open the activity shortly. You can return to this page when it’s time to add your words.</p><span className="wc-waiting-chip"><RefreshCw size={15} />Waiting for trainer</span></section> : state.state === "CLOSED" || state.state === "ARCHIVED" ? <section className="wc-participant-message"><p>Submissions are closed. Please check with your trainer if you need help.</p></section> : <><p className="wc-participant-prompt">{state.prompt}</p>{state.teamName && <span className="wc-team-chip">{state.teamName}</span>}<form className="wc-participant-form" onSubmit={(event) => void submit(event)}><div className="wc-word-fields">{words.map((word, index) => <label key={index}><span>{index + 1}</span><input className="text-input" aria-label={`Word ${index + 1}`} maxLength={200} value={word} placeholder={index === 0 ? "Your first word…" : "Add another word…"} onChange={(event) => { const next = [...words]; next[index] = event.target.value; setWords(next); setSaved(false); }} /><small>{countGraphemes(word)} / 40</small></label>)}</div><div className="wc-word-count">{words.filter((word) => word.trim()).length} / {state.maxWords} words</div><div className="wc-participant-privacy"><LockKeyhole size={16} /><span>Your response is anonymous. Trainers see the combined group words, not who submitted them.</span></div>{error && <div className="inline-error" role="alert">{error}</div>}{saved && <div className="saved-status" role="status"><Check size={15} /> Saved on this device.</div>}<Button type="submit" variant="orange" disabled={busy}>{busy ? "Sending…" : "Share my words"}</Button><button className="save-later-button" type="button" onClick={() => { setSaved(true); try { localStorage.setItem(draftKey(activityId), JSON.stringify(words)); } catch { /* Kept in current view. */ } }}>Save for later</button></form></>}
    </div><div className="wc-participant-footer">No account needed · Temporary guest access · Your words stay anonymous</div></main>;
}

type PublicPresenterData = { kind: "wordcloud"; title: string; prompt: string; phase: Phase; mode: PresentationMode; view: "JOIN_LOBBY" | "LIVE_CLOUD" | "ACTIVITY_CLOSED" | "FINAL_CLOUD"; revision: number; sessionName: string | null; joinPin: string | null; joinPath: string | null; teamName?: string; joinedCount?: number; participants?: string[]; cloudTop50?: Array<{ label: string; frequency: number; percentage: number | null }> };
export function WordCloudPublicPresenterPage() {
  const [data, setData] = useState<PublicPresenterData | null>(null);
  const [error, setError] = useState("");
  const [isFullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const token = window.location.hash.slice(1); let alive = true; let lastRevision = -1;
    const load = async () => { try { const next = await api<PublicPresenterData>("/presenter", { headers: { Authorization: `Bearer ${token}` } }); if (alive && next.revision >= lastRevision) { lastRevision = next.revision; setData(next); setError(""); } } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Presenter link is unavailable."); } };
    void load(); const timer = window.setInterval(() => void load(), 1500); return () => { alive = false; window.clearInterval(timer); };
  }, []);
  async function toggleFullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setFullscreen(Boolean(document.fullscreenElement)); } catch { setError("Fullscreen is not available in this browser."); } }
  if (!data) return <main className="wc-public-presenter"><BrandMark /><div>{error ? <ErrorState message={error} /> : <LoadingState label="Connecting to Presenter Mode…" />}</div></main>;
  const terms = (data.cloudTop50 ?? []).map((term, index): CloudTerm => ({ ...term, groupId: `${index}-${term.label}`, visible: true, mergedSourceLabels: [] }));
  const lobby = data.view === "JOIN_LOBBY";
  const final = data.view === "FINAL_CLOUD";
  const closed = data.view === "ACTIVITY_CLOSED";
  return <main className={`wc-public-presenter wc-public-v11 ${isFullscreen ? "wc-fullscreen" : ""}`}><header><BrandMark /><div className="wc-public-status"><span className="eyebrow">PRESENTER MODE</span><strong>{lobby ? `${data.joinedCount ?? 0} joined` : final ? "FINAL CLOUD" : closed ? "ACTIVITY CLOSED" : "LIVE CLOUD"}</strong></div><button className="wc-fullscreen-button" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen">⛶</button></header>
    {lobby && <section className="wc-public-lobby"><div className="wc-public-lobby-main"><span className="wc-public-kicker">LIVE JOIN LOBBY</span><h1>{data.title}<span className="title-dot">.</span></h1><p>{data.prompt}</p><span className="wc-public-lobby-note">Join with the QR code, link, or PIN. Add your display name so your trainer can track participation.</span><div className="wc-public-join-panel"><div className="wc-public-qr">{data.joinPath ? <QRCodeSVG value={`${window.location.origin}${data.joinPath}`} size={190} includeMargin /> : null}</div><div><span className="wc-public-label">PIN</span><strong className="wc-public-pin">{data.joinPin ? `${data.joinPin.slice(0, 3)} ${data.joinPin.slice(3)}` : "—"}</strong><span className="wc-public-label">LINK</span><strong className="wc-public-link">{data.joinPath ? `${window.location.host}${data.joinPath}` : ""}</strong></div></div></div><div className="wc-public-lobby-side"><span className="wc-public-kicker">IN THE ROOM</span><strong className="wc-public-joined-count">{data.joinedCount ?? 0}</strong><span className="wc-public-joined-label">people joined</span><div className="wc-public-name-chips">{(data.participants ?? []).map((participant, index) => <span key={`${participant}-${index}`}>{participant}</span>)}{!(data.participants ?? []).length && <span className="wc-public-empty-chip">Waiting for the first join…</span>}</div><small>Completion status stays with the trainer.</small></div></section>}
    {closed && <section className="wc-public-state"><span className="wc-public-lock"><LockKeyhole size={42} /></span><span className="wc-public-kicker">ACTIVITY CLOSED</span><h1>{data.title}<span className="title-dot">.</span></h1><p>Thanks for sharing. Your trainer is preparing the group cloud.</p><strong>Waiting for results to be revealed.</strong></section>}
    {(data.view === "LIVE_CLOUD" || final) && <section className="wc-public-cloud"><div className="wc-public-cloud-heading"><div><span className="wc-public-kicker">{final ? "FINAL WORD CLOUD" : "LIVE WORD CLOUD"}</span><h1>{data.title}<span className="title-dot">.</span></h1><p>{data.prompt}</p></div><span className="wc-public-team-pill">{data.teamName ?? "All teams"}</span></div><WordCloudVisual terms={terms} className="wc-public-word-visual" /><div className="wc-public-cloud-footer"><span>{final ? "Overall group cloud" : "Updating live as responses arrive"}</span><span>{data.teamName ?? "All teams"}</span></div></section>}
    <span className="wc-public-brandline">TrainerPopp!Kit · Make moments pop.</span></main>;
}
