import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { api } from "./api";
import { Badge, BrandMark, Button, ErrorState, LoadingState, Mascot } from "./components";
import { SCARF_INSIGHTS } from "./domain/scarf-insights";

type Question = {
  id: string; section: number; type: "micro_reaction" | "tradeoff" | "ranking"; text?: string; title?: string; prompt?: string;
  min?: number; max?: number; anchors?: Record<string, string>; options?: Record<string, string>;
};
type ScarfCurrent = {
  activity: { id: string; title: string; state: string; releaseMode: "immediate" | "trainer_released"; resultsReleased: boolean };
  participant: { displayName: string };
  instrument: { version: string; scoringVersion: string; status: string };
  progress: { generation: number; currentQuestion: number; viewState: string; status: string; answeredCount: number };
  items: Question[]; answers: Record<string, unknown>; revisions: Record<string, number>; disclosure: string;
};
type ResultData = { visible: boolean; reaction: Record<string, number>; priority: Record<string, number>;
  integratedNeedsIndex: Record<string, number> | null; integratedNeedsRank: Record<string, number> | null;
  dimensions: Array<{ code: string; name: string }>; instrumentVersion: string; scoringVersion: string; submittedAt: string; disclosure: string };

function guestOptions(token: string): RequestInit { return { headers: { Authorization: `Bearer ${token}` } }; }
function guestJson(token: string, method: string, value: unknown): RequestInit {
  return { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
function sectionName(section: number) { return section === 1 ? "Notice your reactions" : section === 2 ? "Choose what matters" : "Rank what motivates you"; }

export function ScarfParticipantRunner({ activityId, token }: { activityId: string; token: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<ScarfCurrent | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [view, setView] = useState<"welcome" | "question" | "transition">("welcome");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [rankingDraft, setRankingDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveFailure = useRef<Error | null>(null);
  const revisions = useRef<Record<string, number>>({});
  const answered = Object.keys(answers).length;

  useEffect(() => {
    let alive = true;
    api<ScarfCurrent>("/guest/scarf/current", guestOptions(token)).then((current) => {
      if (!alive) return;
      if (current.progress.status === "submitted") { navigate(`/participate/${activityId}/done`, { replace: true }); return; }
      setData(current); setAnswers(current.answers); revisions.current = { ...current.revisions }; setQuestionIndex(Math.max(0, Math.min(29, current.progress.currentQuestion - 1)));
      setView(current.progress.viewState === "transition" ? "transition" : current.progress.viewState === "welcome" && current.progress.answeredCount === 0 ? "welcome" : "question");
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not open your assessment."); });
    return () => { alive = false; };
  }, [activityId, navigate, token]);

  async function saveProgress(nextQuestion: number, nextView: "welcome" | "question" | "transition" | "completed") {
    if (!data) return;
    await api("/guest/scarf/progress", guestJson(token, "PUT", { generation: data.progress.generation, currentQuestion: nextQuestion, viewState: nextView }));
  }
  function saveAnswer(question: Question, answer: unknown) {
    if (!data) return;
    const revision = Number(revisions.current[question.id] ?? 0) + 1;
    revisions.current[question.id] = revision;
    setAnswers((current) => ({ ...current, [question.id]: answer }));
    setSaved(false); setError(""); setSaving(true); saveFailure.current = null;
    const request = saveChain.current.then(async () => {
      await api(`/guest/scarf/answers/${question.id}`, guestJson(token, "PUT", {
        generation: data.progress.generation, revision, answer, currentQuestion: questionIndex + 1,
      }));
      setData((current) => current ? { ...current, revisions: { ...current.revisions, [question.id]: revision } } : current);
      setSaved(true);
    });
    saveChain.current = request.catch((reason: unknown) => { const failure = reason instanceof Error ? reason : new Error("Your response could not be saved."); saveFailure.current = failure; setError(failure.message); });
    void saveChain.current.finally(() => setSaving(false));
  }
  async function start() {
    setError("");
    try { await saveProgress(questionIndex + 1, "question"); setView("question"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the activity."); }
  }
  async function next() {
    if (!data) return;
    const question = data.items[questionIndex];
    if (!question || !Object.hasOwn(answers, question.id)) { setError("Choose a response to continue."); return; }
    setSaving(true); setError("");
    try {
      await saveChain.current;
      if (saveFailure.current) throw saveFailure.current;
      if (questionIndex === 29) {
        await saveProgress(30, "completed");
        await api("/guest/scarf/submit", guestJson(token, "POST", { generation: data.progress.generation, idempotencyKey: crypto.randomUUID() }));
        navigate(`/participate/${activityId}/done`);
      } else if (questionIndex === 9 || questionIndex === 19) {
        await saveProgress(questionIndex + 1, "transition"); setView("transition");
      } else {
        await saveProgress(questionIndex + 2, "question"); setQuestionIndex((index) => index + 1); setView("question");
      }
      setSaved(false);
      setRankingDraft([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your progress. Try again."); }
    finally { setSaving(false); }
  }
  async function back() {
    if (view === "transition") { setView("question"); setQuestionIndex((index) => Math.min(29, Math.max(0, index))); return; }
    if (questionIndex <= 0) { setView("welcome"); return; }
    const previous = questionIndex - 1;
    try { await saveProgress(previous + 1, "question"); setQuestionIndex(previous); setView("question"); setSaved(false); setError(""); setRankingDraft([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not return to the previous question."); }
  }
  async function later() {
    setError("");
    try { await saveChain.current; if (saveFailure.current) throw saveFailure.current; await saveProgress(questionIndex + 1, view); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your progress."); }
  }

  if (error && !data) return <main className="participant-page scarf-runner"><BrandMark /><div className="participant-error-card"><ErrorState message={error} /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (!data) return <main className="participant-page scarf-runner"><BrandMark /><LoadingState label="Opening your SCARF activity…" /></main>;
  if (data.activity.state !== "open") return <main className="participant-page scarf-runner"><div className="participant-brand"><BrandMark /></div><section className="scarf-welcome-card"><Badge tone="yellow">ACTIVITY PAUSED</Badge><h1>Your answers are saved.</h1><p>This activity is not accepting responses right now. Ask your trainer to reopen it, then return using this device.</p><p className="scarf-disclosure">{data.disclosure}</p></section></main>;
  const question = data.items[questionIndex];
  if (view === "welcome") return <main className="participant-page scarf-runner"><div className="participant-brand"><BrandMark /></div><section className="scarf-welcome-card"><div className="scarf-welcome-art"><Mascot kind="popp" /></div><span className="eyebrow">A PERSONAL REFLECTION · 30 QUESTIONS</span><h1>Get to know what matters to you.</h1><p>Answer 30 short questions about everyday situations and what you value. There are no right answers.</p><div className="scarf-welcome-facts"><span><b>30</b> questions</span><span><b>3</b> short sections</span><span><b>Private</b> personal result</span></div><div className="scarf-disclosure"><LockKeyhole size={17} /><p>{data.disclosure} Your trainer can review your named results. The presenter screen shows aggregate group summaries only.</p></div>{error && <div className="inline-error" role="alert">{error}</div>}<Button className="full-width" onClick={() => void start()}>{data.progress.answeredCount ? "Continue where I left off" : "Start assessment"} <ArrowRight size={18} /></Button></section></main>;
  if (view === "transition") return <main className="participant-page scarf-runner"><div className="participant-brand"><BrandMark /></div><section className="scarf-transition-card"><div className="scarf-transition-art"><Mascot kind="flower" /></div><span className="eyebrow">SECTION {questionIndex < 10 ? "1 OF 3" : "2 OF 3"} COMPLETE</span><h1>{questionIndex < 10 ? "A quick pause." : "One last section."}</h1><p>{questionIndex < 10 ? "You’ve finished the first set. Next, you’ll choose between two things that can both matter." : "Now you’ll rank what would make a difference in a few everyday situations."}</p><div className="scarf-progress-track"><span style={{ width: `${answered / 30 * 100}%` }} /></div><Button className="full-width" onClick={async () => { try { await saveProgress(questionIndex + 2, "question"); setQuestionIndex((index) => index + 1); setView("question"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not continue."); } }}>Continue <ArrowRight size={18} /></Button></section></main>;
  if (!question) return null;
  const currentAnswer = answers[question.id];
  const savedRanking = currentAnswer && typeof currentAnswer === "object"
    ? ["A", "B", "C"].sort((left, right) => Number((currentAnswer as Record<string, number>)[left]) - Number((currentAnswer as Record<string, number>)[right]))
    : [];
  const shownRanking = rankingDraft.length ? rankingDraft : savedRanking;
  const sectionProgress = questionIndex < 10 ? questionIndex + 1 : questionIndex < 20 ? questionIndex - 9 : questionIndex - 19;
  const sectionLength = 10;
  return <main className="participant-page scarf-runner"><header className="scarf-question-top"><button type="button" className="back-circle" aria-label="Previous question" onClick={() => void back()}><ArrowLeft size={19} /></button><BrandMark /><span>SCARF Assessment<small>{data.participant.displayName}</small></span><button type="button" className="scarf-save-top" onClick={() => void later()}>Save for later</button></header>
    <div className="scarf-question-progress"><div><span>SECTION {question.section} OF 3</span><span>{sectionProgress} / {sectionLength}</span></div><div className="scarf-progress-track"><span style={{ width: `${questionIndex / 30 * 100}%` }} /></div></div>
    <section className="scarf-question-card"><div className="scarf-question-meta"><Badge tone={question.section === 1 ? "aqua" : question.section === 2 ? "purple" : "orange"}>{sectionName(question.section)}</Badge><span>QUESTION {String(questionIndex + 1).padStart(2, "0")} / 30</span></div>
      {question.type === "micro_reaction" ? <><h1>{question.text}</h1><p className="scarf-question-prompt">How much would this affect you?</p><div className="scarf-scale-labels"><span>{question.anchors?.["1"]}</span><span>{question.anchors?.["10"]}</span></div><div className="scarf-number-scale" role="radiogroup" aria-label="Choose a number from 1 to 10">{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <button type="button" role="radio" aria-checked={currentAnswer === value} className={currentAnswer === value ? "selected" : ""} key={value} onClick={() => saveAnswer(question, value)}>{value}</button>)}</div><div className="scarf-scale-endpoints"><span>Not at all</span><span>A great deal</span></div></> : question.type === "tradeoff" ? <><span className="scarf-scenario-title">{question.title}</span><h1>{question.prompt}</h1><div className="scarf-tradeoff-options">{["A", "B"].map((key) => <div className={`scarf-tradeoff-card ${currentAnswer === (key === "A" ? "strong_A" : "strong_B") ? "chosen" : ""}`} key={key}><span>{key}</span><p>{question.options?.[key]}</p></div>)}</div><div className="scarf-choice-scale" role="radiogroup" aria-label="Choose which matters more">{[{ value: "strong_A", label: "Much more A" }, { value: "lean_A", label: "A little more A" }, { value: "equal", label: "About the same" }, { value: "lean_B", label: "A little more B" }, { value: "strong_B", label: "Much more B" }].map((choice) => <button type="button" role="radio" aria-checked={currentAnswer === choice.value} className={currentAnswer === choice.value ? "selected" : ""} key={choice.value} onClick={() => saveAnswer(question, choice.value)}><span>{choice.label}</span></button>)}</div></> : <><span className="scarf-scenario-title">{question.title}</span><h1>{question.prompt}</h1><p className="scarf-question-prompt">Tap the options in the order that matters most to you.</p><div className="scarf-ranking-list">{["A", "B", "C"].map((key) => { const order = shownRanking.indexOf(key); const rank = order < 0 ? 0 : order + 1; return <div className={`scarf-ranking-option ${rank ? "ranked" : ""}`} key={key}><button type="button" className="scarf-ranking-select" onClick={() => { const next = shownRanking.includes(key) ? shownRanking.filter((item) => item !== key) : shownRanking.length < 3 ? [...shownRanking, key] : shownRanking; setRankingDraft(next); if (next.length === 3) { const result = Object.fromEntries(next.map((item, index) => [item, index + 1])); saveAnswer(question, result); } }}><b>{rank || "—"}</b><span>{question.options?.[key]}</span></button>{rank > 0 && shownRanking.length === 3 && <div className="scarf-rank-move"><button type="button" aria-label={`Move option ${key} earlier`} disabled={rank === 1} onClick={() => { const next = [...shownRanking]; [next[rank - 2], next[rank - 1]] = [next[rank - 1]!, next[rank - 2]!]; setRankingDraft(next); saveAnswer(question, Object.fromEntries(next.map((item, index) => [item, index + 1]))); }}>↑</button><button type="button" aria-label={`Move option ${key} later`} disabled={rank === 3} onClick={() => { const next = [...shownRanking]; [next[rank - 1], next[rank]] = [next[rank]!, next[rank - 1]!]; setRankingDraft(next); saveAnswer(question, Object.fromEntries(next.map((item, index) => [item, index + 1]))); }}>↓</button></div>}</div>; })}</div><span className="scarf-ranking-help">{shownRanking.length < 3 ? `Choose ${3 - shownRanking.length} more` : "Your ranking is saved. Use the arrows to change it."}</span></>}
      {saving && <span className="scarf-save-status">Saving…</span>}{saved && !saving && <span className="scarf-save-status"><Check size={15} /> Saved</span>}{error && <div className="inline-error" role="alert">{error}</div>}
      <div className="scarf-question-actions"><Button variant="secondary" onClick={() => void back()} disabled={saving}>Back</Button><Button onClick={() => void next()} disabled={saving || !Object.hasOwn(answers, question.id) || (question.type === "ranking" && rankingDraft.length > 0 && rankingDraft.length < 3)}>{questionIndex === 29 ? "Finish" : "Continue"} <ArrowRight size={17} /></Button></div>
      <button className="save-later-button" type="button" onClick={() => void later()} disabled={saving}><LockKeyhole size={16} />Save and come back later</button><p className="scarf-experimental-note">{data.instrument.version} · Experimental self-reflection tool</p>
    </section></main>;
}

export function ScarfParticipantDone({ activityId, token }: { activityId: string; token: string }) {
  const [data, setData] = useState<ScarfCurrent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => api<ScarfCurrent>("/guest/scarf/current", guestOptions(token)).then((value) => { if (alive) { setData(value); setError(""); } }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not check your result status."); });
    void load(); const timer = window.setInterval(() => void load(), 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [token]);
  if (!data) return <main className="participant-page done-page"><BrandMark />{error ? <ErrorState message={error} /> : <LoadingState label="Checking your saved result…" />}</main>;
  const available = data.activity.releaseMode === "immediate" || data.activity.resultsReleased;
  return <main className="participant-page done-page"><div className="participant-brand"><BrandMark /></div><div className="done-hero"><div className="done-mascot"><Mascot kind="sun" /></div><span className="eyebrow">{data.activity.title}</span><h1>All done<span className="title-dot">!</span></h1><p className="done-thanks">Your responses are saved. Thank you for taking a moment to reflect.</p></div><section className="done-result-status"><div className="done-status-mascot"><Mascot kind="flower" /></div><div className="done-status-copy"><span className="eyebrow">YOUR PERSONAL RESULT</span><h2>{available ? "Your result is ready." : "Your trainer will share your result."}</h2><p>{available ? "Only you and your trainer can see your individual results." : "Your answers are safely saved. You’ll see your personal result here when your trainer releases it."}</p>{!available && <span className="polling-label"><span className="live-pulse" /> Checking for an update</span>}</div></section>{available && <section className="personal-snapshot-card"><div className="personal-snapshot-heading"><div><h2>Personal results</h2><span>Two exploratory views · not a validated assessment</span></div></div><Button className="full-width" to={`/participate/${activityId}/results`}>View my results <ArrowRight size={18} /></Button></section>}<p className="scarf-disclosure">{data.disclosure}</p>{error && <div className="inline-error" role="status">{error}</div>}</main>;
}

export function ScarfPersonalResultsPage() {
  const { activityId = "" } = useParams();
  const token = sessionStorage.getItem(`popp-guest:${activityId}`) ?? "";
  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState<"reaction" | "priority">("reaction");
  const [domain, setDomain] = useState("S");
  const [view, setView] = useState<"overview" | "detail">("overview");
  useEffect(() => {
    let alive = true;
    if (!token) return () => { alive = false; };
    api<ResultData>("/guest/scarf/results", guestOptions(token)).then((data) => { if (alive) setResult(data); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Your result is not available yet."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activityId, token]);
  if (!token) return <main className="participant-page scarf-results-page"><div className="participant-brand"><BrandMark /></div><div className="participant-error-card"><ErrorState message="Your private activity link is missing. Rejoin with your activity code." /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (loading) return <main className="participant-page scarf-results-page"><BrandMark /><LoadingState label="Preparing your personal results…" /></main>;
  if (error || !result) return <main className="participant-page scarf-results-page"><div className="participant-brand"><BrandMark /></div><div className="participant-error-card"><ErrorState message={error || "Your result is not available."} /><Button variant="secondary" to={`/participate/${activityId}/done`}>Back to completion</Button></div></main>;
  const hasNeeds = Boolean(result.integratedNeedsIndex && result.integratedNeedsRank);
  const values = hasNeeds ? result.integratedNeedsIndex! : result[metric];
  const ranked = [...result.dimensions].sort((a, b) => hasNeeds
    ? result.integratedNeedsRank![a.code]! - result.integratedNeedsRank![b.code]!
    : (values[b.code] ?? 0) - (values[a.code] ?? 0));
  const insight = SCARF_INSIGHTS[domain as keyof typeof SCARF_INSIGHTS];
  const domainName = result.dimensions.find((item) => item.code === domain)?.name ?? domain;
  const topDomains = hasNeeds ? result.dimensions.filter((item) => result.integratedNeedsRank![item.code] === 1) : [];
  const rankPalette = ["#3939ff", "#7868ef", "#aee6ed", "#f2bb05", "#ff8a55"];
  return <main className="participant-page scarf-results-page"><header className="scarf-results-header"><Link className="back-circle" to={`/participate/${activityId}/done`} aria-label="Back"><ArrowLeft size={19} /></Link><BrandMark /><span>YOUR PERSONAL RESULTS</span></header>
    <section className="scarf-results-intro"><span className="eyebrow">A SNAPSHOT FOR REFLECTION</span><h1>{hasNeeds ? "Your SCARF Profile" : "What matters to you?"}</h1><p>{hasNeeds ? "Your five domains are compared within your own responses across 30 situations. This is a relative reflection index, not a measure of how much of a need you have." : "These earlier results preserve the two original exploratory measures. They are conversation starters, not labels."}</p></section>
    {hasNeeds ? <><div className="scarf-result-tabs scarf-view-tabs" role="tablist" aria-label="Personal results view"><button role="tab" aria-selected={view === "overview"} className={view === "overview" ? "selected" : ""} onClick={() => setView("overview")}>Overview</button><button role="tab" aria-selected={view === "detail"} className={view === "detail" ? "selected" : ""} onClick={() => setView("detail")}>Explore a domain</button></div>
      {view === "overview" ? <><section className="scarf-result-card"><div className="scarf-result-card-head"><span className="eyebrow">INTEGRATED NEEDS PROFILE · SCORING {result.scoringVersion}</span><Badge tone="purple">{result.instrumentVersion}</Badge></div><div className="scarf-result-bars">{ranked.map((item) => { const rank = result.integratedNeedsRank![item.code]!; const index = result.integratedNeedsIndex![item.code]!; const colorIndex = Math.max(0, Math.min(4, Math.round(rank) - 1)); return <button type="button" className={`scarf-result-domain ${domain === item.code ? "active" : ""}`} key={item.code} onClick={() => { setDomain(item.code); setView("detail"); }}><span className="scarf-result-rank" style={{ background: rankPalette[colorIndex], color: colorIndex === 0 ? "#fff" : "#181824" }}>#{Number.isInteger(rank) ? rank : rank.toFixed(1)}</span><span className="scarf-result-domain-name">{item.name}</span><span className="scarf-result-track"><i style={{ width: `${index * 10}%` } as CSSProperties} /></span><strong>{index.toFixed(1)}<small> / 10</small></strong></button>; })}</div><p className="scarf-score-note">Index values show relative preference within your five domains. Tied ranks stay tied; no total score or population comparison is calculated.</p></section><section className="scarf-needs-highlight"><span className="eyebrow">A PATTERN TO REFLECT ON</span><h2>{topDomains.length > 1 ? "Several domains share the highest rank" : `${topDomains[0]?.name ?? "Your profile"} is highest in this profile`}</h2><p>{topDomains.length > 1 ? `${topDomains.map((item) => item.name).join(", ")} share rank #1 among your five domains in this activity.` : `This domain ranked #1 among your five domains in this activity. Consider when these situations matter to you.`}</p><Button onClick={() => { setDomain(topDomains[0]?.code ?? domain); setView("detail"); }}>Explore a domain <ArrowRight size={16} /></Button></section></> : <section className="scarf-insight-card scarf-personal-detail"><div className="scarf-result-card-head"><span className="eyebrow">POSSIBLE SITUATIONS · RELATIVE RANK #{Number.isInteger(result.integratedNeedsRank![domain]!) ? result.integratedNeedsRank![domain] : result.integratedNeedsRank![domain]!.toFixed(1)}</span><Badge tone="purple">{domainName}</Badge></div><h2>{insight.title}</h2><p>{insight.definition} In this activity, this domain has an index of {result.integratedNeedsIndex![domain]!.toFixed(2)} out of 10. That value indicates relative preference within your profile, not an absolute need level.</p><div className="scarf-insight-columns"><div><h3>Possible situations that may energise you</h3><ul>{insight.energizers.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Things to consider</h3><ul>{insight.challenges.map((item) => <li key={item}>{item}</li>)}</ul></div></div><h3>Reflection prompts</h3><div className="scarf-reflection-prompts">{insight.prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}</div><h3>Explore another domain</h3><div className="scarf-domain-picker">{result.dimensions.map((item) => <button type="button" className={domain === item.code ? "selected" : ""} key={item.code} onClick={() => setDomain(item.code)}>{item.name}<small>#{Number.isInteger(result.integratedNeedsRank![item.code]!) ? result.integratedNeedsRank![item.code] : result.integratedNeedsRank![item.code]!.toFixed(1)}</small></button>)}</div></section>}
      </> : <><div className="scarf-result-tabs" role="tablist" aria-label="Historic result measures"><button role="tab" aria-selected={metric === "reaction"} className={metric === "reaction" ? "selected" : ""} onClick={() => setMetric("reaction")}><strong>Reaction Intensity</strong><small>How strongly situations landed for you</small></button><button role="tab" aria-selected={metric === "priority"} className={metric === "priority" ? "selected" : ""} onClick={() => setMetric("priority")}><strong>Driver Priority</strong><small>Relative preference from choices</small></button></div><section className="scarf-result-card"><div className="scarf-result-card-head"><span className="eyebrow">{metric === "reaction" ? "REACTION INTENSITY · 1–10" : "DRIVER PRIORITY · 1–10"}</span><Badge tone="purple">{result.scoringVersion}</Badge></div><div className="scarf-result-bars">{ranked.map((item, index) => <button type="button" className={`scarf-result-domain ${domain === item.code ? "active" : ""}`} key={item.code} onClick={() => setDomain(item.code)}><span className="scarf-result-rank">{index + 1}</span><span className="scarf-result-domain-name">{item.name}</span><span className="scarf-result-track"><i style={{ width: `${(values[item.code] ?? 0) * 10}%` } as CSSProperties} /></span><strong>{(values[item.code] ?? 0).toFixed(1)}</strong></button>)}</div><p className="scarf-score-note">These two measures are separate and are not combined into one score. The Integrated Needs Profile was not stored for historical scoring {result.scoringVersion} records.</p></section><section className="scarf-insight-card"><span className="eyebrow">A THOUGHT TO EXPLORE</span><h2>{domainName}: {insight.title}</h2><p>{insight.definition}</p><div className="scarf-insight-metrics"><span><small>Reaction Intensity</small><strong>{result.reaction[domain]?.toFixed(1) ?? "—"} / 10</strong></span><span><small>Driver Priority</small><strong>{result.priority[domain]?.toFixed(1) ?? "—"} / 10</strong></span></div><div className="scarf-insight-columns"><div><h3>Things that may energise you</h3><ul>{insight.energizers.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Things that may feel challenging</h3><ul>{insight.challenges.map((item) => <li key={item}>{item}</li>)}</ul></div></div><h3>Reflect on it</h3><div className="scarf-reflection-prompts">{insight.prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}</div></section></>}
    {hasNeeds && <details className="scarf-additional-scores scarf-participant-additional"><summary>Additional measures · Reaction Intensity and Driver Priority</summary><div className="table-scroll"><table className="heatmap-table"><thead><tr><th>DOMAIN</th><th>REACTION INTENSITY</th><th>DRIVER PRIORITY</th></tr></thead><tbody>{result.dimensions.map((item) => <tr key={item.code}><th>{item.name}</th><td>{result.reaction[item.code]?.toFixed(2) ?? "—"}</td><td>{result.priority[item.code]?.toFixed(2) ?? "—"}</td></tr>)}</tbody></table></div><p className="heatmap-context">These measures are preserved separately from the Integrated Needs Profile. They are exploratory, activity-specific, and not population norms.</p></details>}
    <p className="scarf-disclosure">{result.disclosure}</p><Button variant="secondary" to={`/participate/${activityId}/done`}>Back to completion</Button></main>;
}
