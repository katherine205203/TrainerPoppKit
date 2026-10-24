import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CircleCheck, Hourglass } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { Badge, BrandMark, Button, ErrorState, LoadingState, Mascot } from "./components";
import { SCARF_INSIGHTS } from "./domain/scarf-insights";

type Question = {
  id: string;
  section: number;
  type: "micro_reaction" | "tradeoff" | "ranking";
  text?: string;
  title?: string;
  prompt?: string;
  min?: number;
  max?: number;
  anchors?: Record<string, string>;
  options?: Record<string, string>;
};

type ScarfCurrent = {
  activity: { id: string; title: string; state: string; releaseMode: "immediate" | "trainer_released"; resultsReleased: boolean };
  participant: { displayName: string };
  instrument: { version: string; scoringVersion: string; status: string };
  progress: { generation: number; currentQuestion: number; viewState: string; status: string; answeredCount: number };
  items: Question[];
  answers: Record<string, unknown>;
  revisions: Record<string, number>;
  disclosure: string;
};

type ResultData = {
  visible: boolean;
  reaction: Record<string, number>;
  priority: Record<string, number>;
  integratedNeedsIndex: Record<string, number> | null;
  integratedNeedsRank: Record<string, number> | null;
  dimensions: Array<{ code: string; name: string }>;
  instrumentVersion: string;
  scoringVersion: string;
  submittedAt: string;
  disclosure: string;
};

const sectionLabels: Record<number, { name: string; eyebrow: string; tone: "aqua" | "pink" | "yellow" }> = {
  1: { name: "Micro-reactions", eyebrow: "PART 1 · MICRO-REACTIONS", tone: "aqua" },
  2: { name: "Trade-offs", eyebrow: "PART 2 · TRADE-OFFS", tone: "pink" },
  3: { name: "Priorities", eyebrow: "PART 3 · PRIORITIES", tone: "yellow" },
};

const rankColors: Record<string, string> = { S: "#3939ff", C: "#aee6ed", A: "#f2bb05", R: "#ff6bcb", F: "#c98cff" };
const rankLetters: Record<string, string> = { S: "S", C: "C", A: "A", R: "R", F: "F" };

function guestOptions(token: string): RequestInit { return { headers: { Authorization: `Bearer ${token}` } }; }
function guestJson(token: string, method: string, value: unknown): RequestInit {
  return { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
function questionNumber(index: number) { return String(index + 1).padStart(2, "0"); }
function rankLabel(rank: number, values: Record<string, number>) {
  return Object.values(values).filter((value) => Math.abs(value - rank) < 1e-9).length > 1 ? `Tied #${Math.round(rank)}` : `#${Math.round(rank)}`;
}

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

  useEffect(() => {
    let alive = true;
    api<ScarfCurrent>("/guest/scarf/current", guestOptions(token)).then((current) => {
      if (!alive) return;
      if (current.progress.status === "submitted") { navigate(`/participate/${activityId}/done`, { replace: true }); return; }
      setData(current); setAnswers(current.answers); revisions.current = { ...current.revisions };
      setQuestionIndex(Math.max(0, Math.min(29, current.progress.currentQuestion - 1)));
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
    setAnswers((current) => ({ ...current, [question.id]: answer })); setSaved(false); setError(""); setSaving(true); saveFailure.current = null;
    const request = saveChain.current.then(async () => {
      await api(`/guest/scarf/answers/${question.id}`, guestJson(token, "PUT", { generation: data.progress.generation, revision, answer, currentQuestion: questionIndex + 1 }));
      setData((current) => current ? { ...current, revisions: { ...current.revisions, [question.id]: revision } } : current); setSaved(true);
    });
    saveChain.current = request.catch((reason: unknown) => { const failure = reason instanceof Error ? reason : new Error("Your response could not be saved."); saveFailure.current = failure; setError(failure.message); });
    void saveChain.current.finally(() => setSaving(false));
  }
  async function start() { setError(""); try { await saveProgress(questionIndex + 1, "question"); setView("question"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the activity."); } }
  async function next() {
    if (!data) return;
    const question = data.items[questionIndex];
    if (!question || !Object.hasOwn(answers, question.id)) { setError("Choose a response to continue."); return; }
    setSaving(true); setError("");
    try {
      await saveChain.current; if (saveFailure.current) throw saveFailure.current;
      if (questionIndex === 29) { await saveProgress(30, "completed"); await api("/guest/scarf/submit", guestJson(token, "POST", { generation: data.progress.generation, idempotencyKey: crypto.randomUUID() })); navigate(`/participate/${activityId}/done`); }
      else if (questionIndex === 9 || questionIndex === 19) { await saveProgress(questionIndex + 1, "transition"); setView("transition"); }
      else { await saveProgress(questionIndex + 2, "question"); setQuestionIndex((index) => index + 1); setView("question"); }
      setSaved(false); setRankingDraft([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your progress. Try again."); } finally { setSaving(false); }
  }
  async function back() {
    if (view === "transition") { setView("question"); setQuestionIndex((index) => Math.max(0, index)); return; }
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

  if (error && !data) return <main className="participant-page scarf-v14 scarf-runner"><BrandMark /><div className="participant-error-card"><ErrorState message={error} /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (!data) return <main className="participant-page scarf-v14 scarf-runner"><BrandMark /><LoadingState label="Opening your SCARF activity…" /></main>;
  if (data.activity.state !== "open") return <main className="participant-page scarf-v14 scarf-runner"><div className="participant-brand"><BrandMark /></div><section className="scarf-v14-paused"><Badge tone="yellow">ACTIVITY PAUSED</Badge><h1>Your answers are saved.</h1><p>This activity is not accepting responses right now. Ask your trainer to reopen it, then return using this device.</p></section></main>;
  const question = data.items[questionIndex];
  if (view === "welcome") return <main className="participant-page scarf-v14 scarf-v14-welcome"><div className="participant-brand"><BrandMark /></div><section className="scarf-v14-welcome-card"><span className="scarf-v14-eyebrow">SCARF ASSESSMENT · 30 QUESTIONS</span><div className="scarf-v14-welcome-art"><Mascot kind="popp" /></div><h1>Discover what matters to you<span className="title-dot">.</span></h1><p>Take a moment to explore how different situations land for you. There are no right or wrong answers.</p><div className="scarf-v14-section-summary"><div><b>01</b><span>Notice your reactions<small>10 quick situations · rate 1–10</small></span></div><div><b>02</b><span>Make trade-offs<small>10 choices · A or B?</small></span></div><div><b>03</b><span>Set your priorities<small>10 scenarios · rank 3 options</small></span></div></div>{error && <div className="inline-error" role="alert">{error}</div>}<p className="scarf-v14-no-right">Your answers help create a personal profile for reflection.</p><Button className="full-width" onClick={() => void start()}>Let’s begin</Button></section></main>;
  if (view === "transition") {
    const completedPart = questionIndex < 10 ? 1 : 2; const nextPart = completedPart + 1; const nextName = nextPart === 2 ? "Trade-offs" : "Priorities";
    return <main className="participant-page scarf-v14 scarf-v14-transition"><div className="participant-brand"><BrandMark /></div><section className="scarf-v14-transition-card"><div className="scarf-v14-transition-art"><Mascot kind="flower" /></div><span className="scarf-v14-eyebrow">PART {completedPart} OF 3 COMPLETE</span><h1>Nice work<span className="title-dot">!</span></h1><p>You’ve finished the first {completedPart === 1 ? "ten" : "twenty"} questions. Take a quick breather, then continue with the next way of exploring what matters to you.</p><div className="scarf-v14-next-card"><span>UP NEXT · PART {nextPart}</span><ArrowRight size={20} /><strong>{nextName}</strong><p>{nextPart === 2 ? "Choose between two things that can both matter." : "Put three options in order in a few everyday situations."}</p><div><span>{completedPart === 1 ? "10" : "20"} of 30 questions</span><b>{completedPart === 1 ? "33%" : "67%"}</b></div><i><em style={{ width: `${completedPart * 33.333}%` }} /></i></div>{error && <div className="inline-error" role="alert">{error}</div>}<Button className="full-width" onClick={async () => { try { await saveProgress(questionIndex + 2, "question"); setQuestionIndex((index) => index + 1); setView("question"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not continue."); } }}>Continue to Part {nextPart}</Button></section></main>;
  }
  if (!question) return null;
  const currentAnswer = answers[question.id];
  const savedRanking = currentAnswer && typeof currentAnswer === "object" ? ["A", "B", "C"].sort((left, right) => Number((currentAnswer as Record<string, number>)[left]) - Number((currentAnswer as Record<string, number>)[right])) : [];
  const shownRanking = rankingDraft.length ? rankingDraft : savedRanking;
  const section = sectionLabels[question.section] ?? sectionLabels[1];
  const chooseRanking = (key: string) => { const nextRanking = shownRanking.includes(key) ? shownRanking.filter((item) => item !== key) : shownRanking.length < 3 ? [...shownRanking, key] : shownRanking; setRankingDraft(nextRanking); if (nextRanking.length === 3) saveAnswer(question, Object.fromEntries(nextRanking.map((item, index) => [item, index + 1]))); };
  const moveRanking = (rank: number, direction: -1 | 1) => { const nextRanking = [...shownRanking]; const target = rank - 1 + direction; if (target < 0 || target >= nextRanking.length) return; [nextRanking[rank - 1], nextRanking[target]] = [nextRanking[target]!, nextRanking[rank - 1]!]; setRankingDraft(nextRanking); saveAnswer(question, Object.fromEntries(nextRanking.map((item, index) => [item, index + 1]))); };
  return <main className="participant-page scarf-v14 scarf-v14-question"><header className="scarf-v14-question-top"><button type="button" className="back-circle" aria-label="Previous question" onClick={() => void back()}><ArrowLeft size={19} /></button><BrandMark /><span>SCARF Assessment</span><button type="button" className="scarf-v14-save-top" onClick={() => void later()}>Save for later</button></header><div className="scarf-v14-progress"><div><span>{section.eyebrow}</span><span>{questionNumber(questionIndex)} / 30</span></div><i><em style={{ width: `${((questionIndex + 1) / 30) * 100}%`, background: question.section === 1 ? "var(--brand-electric)" : question.section === 2 ? "var(--brand-pink)" : "var(--brand-gold)" }} /></i></div><section className={`scarf-v14-question-card scarf-v14-question-${question.type}`}><div className="scarf-v14-question-heading"><Badge tone={section.tone} /></div>{question.type === "micro_reaction" ? <><h1>{question.text}</h1><div className="scarf-v14-rule" /><div className="scarf-v14-scale-labels"><span><b>1 · LOW END</b>{question.anchors?.["1"]}</span><span><b>10 · HIGH END</b>{question.anchors?.["10"]}</span></div><div className="scarf-v14-number-scale" role="radiogroup" aria-label="Choose a number from 1 to 10">{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <button type="button" role="radio" aria-checked={currentAnswer === value} className={currentAnswer === value ? "selected" : ""} key={value} onClick={() => saveAnswer(question, value)}>{value}</button>)}</div></> : question.type === "tradeoff" ? <><span className="scarf-v14-scenario-title">{question.title}</span><h1>{question.prompt}</h1><div className="scarf-v14-tradeoff-options">{["A", "B"].map((key) => <article className={`scarf-v14-tradeoff-card scarf-v14-tradeoff-${key.toLowerCase()}`} key={key}><b>{key}</b><p>{question.options?.[key]}</p></article>)}</div><div className="scarf-v14-preference" role="radiogroup" aria-label="Choose which option matters more"><div className="scarf-v14-preference-line" />{[{ value: "strong_A", label: "Strong A" }, { value: "lean_A", label: "Lean A" }, { value: "equal", label: "Equal" }, { value: "lean_B", label: "Lean B" }, { value: "strong_B", label: "Strong B" }].map((choice) => <button type="button" role="radio" aria-checked={currentAnswer === choice.value} className={currentAnswer === choice.value ? "selected" : ""} key={choice.value} onClick={() => saveAnswer(question, choice.value)}><i /><span>{choice.label}</span></button>)}</div></> : <><span className="scarf-v14-scenario-title">{question.title}</span><h1>{question.prompt}</h1><p className="scarf-v14-instruction">Put the choices in order: <b>1st = matters most.</b></p><div className="scarf-v14-ranking-list">{["A", "B", "C"].map((key) => { const order = shownRanking.indexOf(key); const rank = order < 0 ? 0 : order + 1; return <div className={`scarf-v14-ranking-option ${rank ? "ranked" : ""}`} key={key}><button type="button" className="scarf-v14-ranking-select" onClick={() => chooseRanking(key)}><b>{rank || ""}</b><span>{question.options?.[key]}</span></button>{rank > 0 && shownRanking.length === 3 && <div className="scarf-v14-rank-move"><button type="button" aria-label={`Move option ${key} earlier`} disabled={rank === 1} onClick={() => moveRanking(rank, -1)}><ChevronUp size={17} /></button><button type="button" aria-label={`Move option ${key} later`} disabled={rank === 3} onClick={() => moveRanking(rank, 1)}><ChevronDown size={17} /></button></div>}</div>; })}</div><div className="scarf-v14-ranking-help"><span>i</span>Tap a number or use arrows to reorder.</div></>}{saving && <span className="scarf-v14-save-status">Saving…</span>}{saved && !saving && <span className="scarf-v14-save-status"><Check size={15} /> Saved</span>}{error && <div className="inline-error" role="alert">{error}</div>}<div className="scarf-v14-question-actions"><Button variant="secondary" onClick={() => void back()} disabled={saving}>Back</Button><Button onClick={() => void next()} disabled={saving || !Object.hasOwn(answers, question.id) || (question.type === "ranking" && shownRanking.length < 3)}>{questionIndex === 29 ? "Finish" : "Continue"}</Button></div></section></main>;
}

export function ScarfParticipantDone({ activityId, token }: { activityId: string; token: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<ScarfCurrent | null>(null); const [error, setError] = useState("");
  useEffect(() => { let alive = true; const load = () => api<ScarfCurrent>("/guest/scarf/current", guestOptions(token)).then((value) => { if (alive) { setData(value); setError(""); } }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not check your result status."); }); void load(); const timer = window.setInterval(() => void load(), 5000); return () => { alive = false; window.clearInterval(timer); }; }, [token]);
  if (!data) return <main className="participant-page scarf-v14 scarf-v14-done"><BrandMark />{error ? <ErrorState message={error} /> : <LoadingState label="Checking your saved result…" />}</main>;
  const available = data.activity.releaseMode === "immediate" || data.activity.resultsReleased;
  return <main className="participant-page scarf-v14 scarf-v14-done"><div className="participant-brand"><BrandMark /></div><div className="scarf-v14-done-hero"><div className="scarf-v14-done-mascot"><Mascot kind="sun" /></div><span className="scarf-v14-eyebrow">SCARF ASSESSMENT · COMPLETE</span><h1>All done<span className="title-dot">!</span></h1><p>Your responses are saved. Thank you for taking a moment to reflect.</p></div><section className={`scarf-v14-result-status ${available ? "released" : "waiting"}`}><div>{available ? <CircleCheck size={25} /> : <Hourglass size={25} />}</div><span className="scarf-v14-status-eyebrow">YOUR PERSONAL RESULT</span><h2>{available ? "Your profile is ready!" : "Your trainer will share it."}</h2><p>{available ? "Your personal SCARF profile is ready to explore." : "Your answers are saved. Results will appear here when released."}</p>{!available && <b>Waiting for release</b>}</section><div className="scarf-v14-complete-count"><strong>30 of 30</strong><span>questions completed</span></div>{error && <div className="inline-error" role="status">{error}</div>}{available ? <Button className="full-width" to={`/participate/${activityId}/results`}>View my results</Button> : <Button className="full-width" variant="secondary" onClick={() => navigate("/join")}>Back to activity</Button>}</main>;
}

export function ScarfPersonalResultsPage() {
  const { activityId = "" } = useParams(); const token = sessionStorage.getItem(`popp-guest:${activityId}`) ?? "";
  const [result, setResult] = useState<ResultData | null>(null); const [loading, setLoading] = useState(() => Boolean(token)); const [error, setError] = useState(""); const [domain, setDomain] = useState(""); const [view, setView] = useState<"overview" | "detail">("overview");
  useEffect(() => { let alive = true; if (!token) return () => { alive = false; }; api<ResultData>("/guest/scarf/results", guestOptions(token)).then((data) => { if (alive) setResult(data); }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Your result is not available yet."); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [activityId, token]);
  if (!token) return <main className="participant-page scarf-v14 scarf-results-page"><div className="participant-brand"><BrandMark /></div><div className="participant-error-card"><ErrorState message="Your private activity link is missing. Rejoin with your activity code." /><Button variant="secondary" to="/join">Join again</Button></div></main>;
  if (loading) return <main className="participant-page scarf-v14 scarf-results-page"><BrandMark /><LoadingState label="Preparing your personal results…" /></main>;
  if (error || !result) return <main className="participant-page scarf-v14 scarf-results-page"><div className="participant-brand"><BrandMark /></div><div className="participant-error-card"><ErrorState message={error || "Your result is not available."} /><Button variant="secondary" to={`/participate/${activityId}/done`}>Back to completion</Button></div></main>;
  const values = result.integratedNeedsIndex ?? result.priority; const ranks = result.integratedNeedsRank; const ranked = [...result.dimensions].sort((a, b) => ranks ? ranks[a.code]! - ranks[b.code]! : (values[b.code] ?? 0) - (values[a.code] ?? 0));
  const topRank = ranks ? Math.min(...Object.values(ranks)) : Math.max(...Object.values(values)); const topDomains = ranked.filter((item) => ranks ? Math.abs(ranks[item.code]! - topRank) < 1e-9 : Math.abs((values[item.code] ?? 0) - topRank) < 1e-9); const selected = result.dimensions.find((item) => item.code === domain) ?? topDomains[0] ?? result.dimensions[0]!; const selectedInsight = SCARF_INSIGHTS[selected.code as keyof typeof SCARF_INSIGHTS]; const selectedValue = values[selected.code] ?? 0; const selectedRank = ranks?.[selected.code] ?? ranked.findIndex((item) => item.code === selected.code) + 1; const displayRank = (code: string) => ranks ? rankLabel(ranks[code]!, ranks) : `#${ranked.findIndex((item) => item.code === code) + 1}`;
  return <main className="participant-page scarf-v14 scarf-v14-results"><header className="scarf-v14-results-header"><Link className="back-circle" to={`/participate/${activityId}/done`} aria-label="Back"><ArrowLeft size={19} /></Link><BrandMark /><span>{view === "overview" ? "Your SCARF Results" : "Explore a domain"}</span></header>{view === "overview" ? <><section className="scarf-v14-results-intro"><span className="scarf-v14-eyebrow">YOUR PERSONAL PROFILE</span><h1>What stands out for you<span className="title-dot">?</span></h1><p>Your profile highlights the needs that are most prominent across your answers in this activity.</p></section><section className="scarf-v14-top-need"><div className="scarf-v14-top-need-copy"><span className="scarf-v14-status-eyebrow">YOUR TOP NEED</span><h2>{topDomains.length > 1 ? "A shared top need" : selected.name}</h2><p>{topDomains.length > 1 ? `${topDomains.map((item) => item.name).join(" and ")} share the highest place in your profile.` : selectedInsight.definition}</p></div><div className="scarf-v14-top-need-art"><Mascot kind="sun" /></div></section><section className="scarf-v14-needs-card"><h2>Your five SCARF needs</h2><div>{ranked.map((item) => <button type="button" className="scarf-v14-need-row" key={item.code} onClick={() => { setDomain(item.code); setView("detail"); }}><b style={{ background: rankColors[item.code] }}>{rankLetters[item.code]}</b><span>{item.name}<small>{displayRank(item.code)}</small></span><i><em style={{ width: `${Math.max(5, Math.min(100, (values[item.code] ?? 0) * 10))}%`, background: rankColors[item.code] }} /></i><strong>{(values[item.code] ?? 0).toFixed(1)}<small>/10</small></strong></button>)}</div></section><Button className="full-width" onClick={() => { setDomain(topDomains[0]?.code ?? selected.code); setView("detail"); }}>Explore my top need</Button></> : <><section className="scarf-v14-domain-hero"><div><span className="scarf-v14-status-eyebrow">{displayRank(selected.code)} IN YOUR PROFILE</span><h1>{selected.name}</h1><p>{selectedInsight.definition}</p><strong>{selectedValue.toFixed(1)}<small> / 10</small></strong><span className="scarf-v14-domain-rank">{selectedRank === 1 ? "Top need" : "Relative place in your profile"}</span></div><Mascot kind="sun" /></section><section className="scarf-v14-reflection-card scarf-v14-reflection-aqua"><span className="scarf-v14-status-eyebrow">SITUATIONS WORTH NOTICING</span><ul>{selectedInsight.energizers.slice(0, 3).map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></section><section className="scarf-v14-reflection-card scarf-v14-reflection-pink"><span className="scarf-v14-status-eyebrow">A MOMENT TO REFLECT</span><div>{selectedInsight.prompts.slice(0, 2).map((prompt) => <p key={prompt}>{prompt}</p>)}</div></section><Button variant="secondary" className="full-width" onClick={() => setView("overview")}><ArrowLeft size={17} />Back to my profile</Button></>}</main>;
}
