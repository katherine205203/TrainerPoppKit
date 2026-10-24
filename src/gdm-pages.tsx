import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Copy, Download, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, post } from "./api";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageIntro } from "./components";

type GdmSession = { id: string; name: string; description: string; status: string; activity_count: number; archived_at?: string | null };
type GdmActivity = { id: string; title: string; tool_id: string; state: string; session_id: string | null; session_name?: string | null; current_run_id: string | null; access_slug: string };
type GdmRun = { id: string; activity_id: string; sequence: number; state: string; created_at: string; started_at: string | null; ended_at: string | null; is_current: number; origin_session_id: string | null; origin_session_name: string | null };
type ArchiveData = { sessions: GdmSession[]; activities: GdmActivity[]; runs: GdmRun[] };
type TrashItem = { id: string; item_type: string; label: string; deleted_at: string; expires_at: string; manifest: { sessionIds: string[]; activityIds: string[]; runIds: string[] } };
type Selection = { sessionIds: string[]; activityIds: string[]; runIds: string[]; sessionMode?: "ONLY" | "ALL" };
type Preview = { activityCount: number; runCount: number; sessionCount: number; activeActivities: string[]; crossSessionImpact: Array<{ id: string; name: string }>; ready: boolean; message: string };

function useGdmData<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((value) => value + 1);
  useEffect(() => { let current = true; void api<T>(path).then((value) => { if (current) { setData(value); setError(""); } }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : "Could not load data."); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [path, refreshKey]);
  return { data, loading, error, refresh };
}
const operationId = () => crypto.randomUUID();
function toolName(id: string) { return ({ poll: "Poll", wordcloud: "Word Cloud", "reflection-wall": "Reflection Wall", "learning-behaviors-reflection": "Learning Behaviors Reflection", "scarf-assessment": "SCARF Assessment", "scarf-demo": "SCARF", quiz: "Quiz" } as Record<string, string>)[id] ?? id; }
function toolPath(activity: GdmActivity) { if (activity.tool_id === "quiz") return "/quiz/activities/" + activity.id; if (activity.tool_id === "poll") return "/polls/" + activity.id; if (activity.tool_id === "wordcloud") return "/wordclouds/" + activity.id; if (activity.tool_id === "reflection-wall") return "/reflection-walls/" + activity.id; if (activity.tool_id === "learning-behaviors-reflection") return "/learning-behaviors/" + activity.id; return "/activities/" + activity.id + "/live"; }
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : "—"; }
function ActionDialog({ title, children, cancel, confirm, confirmText = "Confirm", busy = false, disabled = false }: { title: string; children: ReactNode; cancel: () => void; confirm: () => void; confirmText?: string; busy?: boolean; disabled?: boolean }) {
  return <div className="gdm-dialog-scrim"><section className="card gdm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="gdm-dialog-title"><h2 id="gdm-dialog-title">{title}</h2><div className="gdm-dialog-copy">{children}</div><div className="gdm-dialog-actions"><Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button><Button variant="danger" onClick={confirm} disabled={busy || disabled}>{busy ? "Working…" : confirmText}</Button></div></section></div>;
}
function ExportLink({ href, children }: { href: string; children: ReactNode }) { return <a className="button button-quiet gdm-download" href={href}><Download size={15} />{children}</a>; }

export function GdmArchivePage() {
  const { data, loading, error, refresh } = useGdmData<ArchiveData>("/owner/gdm/archive");
  const { data: trash, refresh: refreshTrash } = useGdmData<{ items: TrashItem[] }>("/owner/gdm/trash");
  const [tab, setTab] = useState<"archive" | "trash">("archive"), [selected, setSelected] = useState<Selection>({ sessionIds: [], activityIds: [], runIds: [] });
  const [mode, setMode] = useState<"ONLY" | "ALL">("ONLY"), [preview, setPreview] = useState<Preview | null>(null), [dialog, setDialog] = useState<"bulk" | "restore" | null>(null);
  const [restoreId, setRestoreId] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState("");
  const sessions = data?.sessions ?? [], activities = data?.activities ?? [], runs = data?.runs ?? [];
  const selectedCount = selected.sessionIds.length + selected.activityIds.length + selected.runIds.length;
  function toggle(kind: "sessionIds" | "activityIds" | "runIds", id: string) { setSelected((value) => ({ ...value, [kind]: value[kind].includes(id) ? value[kind].filter((item) => item !== id) : [...value[kind], id] })); setPreview(null); }
  async function previewDelete() {
    setActionError(""); setNotice("");
    try { setPreview(await post<Preview>("/owner/gdm/preview", { ...selected, sessionMode: mode })); setDialog("bulk"); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not preview this selection."); }
  }
  async function deleteSelection() {
    setBusy(true); setActionError("");
    try { await post("/owner/gdm/bulk-delete", { operationId: operationId(), selection: { ...selected, sessionMode: mode } }); setDialog(null); setSelected({ sessionIds: [], activityIds: [], runIds: [] }); setPreview(null); setNotice("Selected items moved to Trash for 30 days."); refresh(); refreshTrash(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not delete this selection."); }
    finally { setBusy(false); }
  }
  async function exportSelection(format: "csv" | "excel") {
    setBusy(true); setActionError("");
    try {
      const response = await fetch("/api/owner/gdm/bulk-export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: { sessionIds: selected.sessionIds, activityIds: selected.activityIds, runIds: selected.runIds }, format }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Could not export this selection.");
      }
      const blob = await response.blob(), disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? `archive-selection.${format === "excel" ? "xls" : "csv"}`;
      const objectUrl = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = objectUrl; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setNotice(`Exported ${selectedCount} selected item${selectedCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not export this selection."); }
    finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setActionError("");
    try { await post("/owner/gdm/trash/" + restoreId + "/restore", { operationId: operationId() }); setDialog(null); setNotice("Restored. Runs are in trainer-only history and were not made live."); refresh(); refreshTrash(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not restore this item."); }
    finally { setBusy(false); }
  }
  if (loading && !data) return <LoadingState label="Loading Sessions, Activities and Runs…" />;
  return <div className="page-stack gdm-page">
    <PageIntro eyebrow="ARCHIVE &amp; DATA" title="Archive / Results" description="Review Session, Activity and Run history, export results, and manage Trash." />
    {error && <ErrorState message={error} retry={refresh} />}{actionError && <div className="inline-error" role="alert">{actionError}</div>}{notice && <div className="gdm-success" role="status">{notice}</div>}
    <div className="gdm-tabs" role="tablist"><button role="tab" aria-selected={tab === "archive"} className={tab === "archive" ? "gdm-tab is-active" : "gdm-tab"} onClick={() => setTab("archive")}>Archive &amp; Results</button><button role="tab" aria-selected={tab === "trash"} className={tab === "trash" ? "gdm-tab is-active" : "gdm-tab"} onClick={() => setTab("trash")}>Trash ({trash?.items.length ?? 0})</button></div>
    {tab === "archive" ? <>
      <div className="gdm-toolbar"><span>{selectedCount ? selectedCount + " selected" : "Select Sessions, Activities or individual Runs to export or delete."}</span><div className="gdm-toolbar-actions">{selected.sessionIds.length > 0 && <label className="gdm-mode-select">Session delete scope<select value={mode} onChange={(event) => setMode(event.target.value as "ONLY" | "ALL")}><option value="ONLY">Session only · detach Activities</option><option value="ALL">Session and all Activities</option></select></label>}<Button variant="secondary" onClick={() => void exportSelection("csv")} disabled={!selectedCount || busy}>Export CSV</Button><Button variant="secondary" onClick={() => void exportSelection("excel")} disabled={!selectedCount || busy}>Export Excel</Button><Button variant="danger" onClick={() => void previewDelete()} disabled={!selectedCount || busy}>Preview delete</Button></div></div>
      <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">SESSIONS</span><h2>Session history</h2></div><span className="subtle-text">Archived reports remain tied to their saved source Runs.</span></div>
        {sessions.length ? <div className="gdm-rows">{sessions.map((item) => <article className="gdm-row" key={item.id}><label className="gdm-select"><input type="checkbox" checked={selected.sessionIds.includes(item.id)} onChange={() => toggle("sessionIds", item.id)} aria-label={"Select Session " + item.name} /></label><div className="gdm-row-main"><Link to={"/gdm/sessions/" + item.id}><strong>{item.name}</strong><small>{item.activity_count} Activities · {item.status === "completed" ? "Archived " + date(item.archived_at) : item.status}</small></Link></div><Badge tone={item.status === "completed" ? "blue" : "purple"}>{item.status === "completed" ? "Archived" : item.status}</Badge><ExportLink href={"/api/owner/gdm/sessions/" + item.id + "/export?format=csv"}>CSV</ExportLink><ExportLink href={"/api/owner/gdm/sessions/" + item.id + "/export?format=excel"}>Excel</ExportLink><Button variant="quiet" to={"/gdm/sessions/" + item.id}>Manage <ArrowRight size={15} /></Button></article>)}</div> : <EmptyState title="No Sessions saved yet" description="Create a Session to collect related Activities and Runs." action={<Button to="/sessions/new">Create Session</Button>} />}
      </Card>
      <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">ACTIVITIES</span><h2>Activities and Runs</h2></div><span className="subtle-text">Historical Runs are trainer-only. Participants can access only the Current Run.</span></div>
        {activities.length ? <div className="gdm-activity-groups">{activities.map((item) => { const itemRuns = runs.filter((run) => run.activity_id === item.id); return <section className="gdm-activity-group" key={item.id}><div className="gdm-row gdm-activity-row"><label className="gdm-select"><input type="checkbox" checked={selected.activityIds.includes(item.id)} onChange={() => toggle("activityIds", item.id)} aria-label={"Select Activity " + item.title} /></label><div className="gdm-row-main"><strong>{item.title}</strong><small>{toolName(item.tool_id)} · {item.session_name ?? "Standalone"}</small></div><Badge tone={item.state === "open" ? "green" : item.state === "paused" ? "yellow" : "purple"}>{item.state}</Badge><Button variant="quiet" to={"/gdm/activities/" + item.id}>Manage Runs <ArrowRight size={15} /></Button><Button variant="secondary" to={toolPath(item)}>Open Activity</Button><ExportLink href={"/api/owner/gdm/activities/" + item.id + "/export?format=csv"}>CSV</ExportLink><ExportLink href={"/api/owner/gdm/activities/" + item.id + "/export?format=excel"}>Excel</ExportLink></div>
          {itemRuns.length ? <div className="gdm-run-rows">{itemRuns.map((run) => <div className="gdm-row gdm-run-row" key={run.id}><label className="gdm-select"><input type="checkbox" checked={selected.runIds.includes(run.id)} onChange={() => toggle("runIds", run.id)} aria-label={"Select Run " + run.sequence + " of " + item.title} /></label><div className="gdm-row-main"><strong>Run {run.sequence}{run.is_current ? " · Current" : " · History"}</strong><small>{date(run.created_at)} · Origin: {run.origin_session_name ?? "Standalone"}</small></div><Badge tone={run.is_current ? "aqua" : "gray"}>{run.state}</Badge><ExportLink href={"/api/owner/gdm/runs/" + run.id + "/export?format=csv"}>CSV</ExportLink><ExportLink href={"/api/owner/gdm/runs/" + run.id + "/export?format=excel"}>Excel</ExportLink><Button variant="quiet" to={"/gdm/activities/" + item.id}>Details</Button></div>)}</div> : <p className="gdm-no-runs">No Run has been started for this Activity yet.</p>}</section>; })}</div> : <EmptyState title="No Activities saved yet" description="Create an Activity from My Tools to see it in Archive / Results." action={<Button to="/tools">Open My Tools</Button>} />}
      </Card>
    </> : <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">30-DAY RECOVERY</span><h2>Trash</h2></div><span className="subtle-text">Deleted data is permanently purged after expiry.</span></div>{(trash?.items ?? []).length ? <div className="gdm-rows">{trash!.items.map((item) => <article className="gdm-row" key={item.id}><span className="gdm-trash-icon"><Trash2 size={18} /></span><div className="gdm-row-main"><strong>{item.label}</strong><small>{item.item_type} · Deleted {date(item.deleted_at)} · Purges {date(item.expires_at)}</small><small>{item.manifest.sessionIds.length} Sessions · {item.manifest.activityIds.length} Activities · {item.manifest.runIds.length} Runs</small></div><Button variant="secondary" onClick={() => { setRestoreId(item.id); setDialog("restore"); }}>Restore</Button></article>)}</div> : <EmptyState title="Trash is empty" description="Deleted Sessions, Activities and Runs appear here for 30 days." />}</Card>}
    {dialog === "bulk" && preview && <ActionDialog title="Confirm bulk delete" cancel={() => setDialog(null)} confirm={() => void deleteSelection()} confirmText="Move to Trash" busy={busy} disabled={!preview.ready}><p>{preview.message}</p><p><strong>{preview.sessionCount}</strong> Sessions · <strong>{preview.activityCount}</strong> Activities · <strong>{preview.runCount}</strong> Runs.</p>{preview.activeActivities.length > 0 && <p className="inline-error">End Live or Paused Runs first: {preview.activeActivities.join(", ")}</p>}{preview.crossSessionImpact.length > 0 && <div className="gdm-warning"><strong>Activity cascade also includes Runs from:</strong><ul>{preview.crossSessionImpact.map((item) => <li key={item.id}>{item.name}</li>)}</ul></div>}{selected.sessionIds.length > 0 && <p>{mode === "ONLY" ? "The Session will be deleted and its Activities detached as Standalone." : "The Session and all Activities will move to Trash together."}</p>}</ActionDialog>}
    {dialog === "restore" && <ActionDialog title="Restore from Trash" cancel={() => setDialog(null)} confirm={() => void restore()} confirmText="Restore item" busy={busy}><p>Restore before its 30-day expiry. Runs return to trainer-only history; they are not made Current or Live.</p></ActionDialog>}
  </div>;
}

export function GdmActivityPage() {
  const { activityId = "" } = useParams(), navigate = useNavigate();
  const { data, loading, error, refresh } = useGdmData<{ activity: GdmActivity; currentRun: GdmRun | null; runs: GdmRun[]; canDelete: boolean; startRunPath: string | null }>("/owner/gdm/activities/" + activityId);
  const [dialog, setDialog] = useState<"reset-current" | "reset-all" | "delete" | "delete-run" | null>(null), [targetRun, setTargetRun] = useState(""), [busy, setBusy] = useState(false), [errorText, setErrorText] = useState(""), [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  async function act(kind: "reset-current" | "reset-all" | "delete" | "delete-run") {
    setBusy(true); setErrorText("");
    try {
      if (kind === "delete") { await post("/owner/gdm/activities/" + activityId + "/delete", { operationId: operationId() }); navigate("/archive"); return; }
      if (kind === "delete-run") { await post("/owner/gdm/runs/" + targetRun + "/delete", { operationId: operationId() }); setNotice("Run moved to Trash. It is no longer available to participants."); }
      else { const result = await post<{ runId: string; pin: string }>("/owner/gdm/activities/" + activityId + "/reset", { operationId: operationId(), scope: kind === "reset-all" ? "ALL" : "CURRENT" }); setNotice("Reset complete. New Run " + result.runId + " is ready; new participant PIN: " + result.pin + ". Selected old Run data was permanently removed."); }
      setDialog(null); refresh();
    } catch (reason) { setErrorText(reason instanceof Error ? reason.message : "Could not complete the Activity action."); }
    finally { setBusy(false); }
  }
  async function startRun() {
    if (!data) return;
    if (data.activity.tool_id === "quiz") { navigate(data.startRunPath ?? ("/quiz/activities/" + activityId + "/new-run")); return; }
    setBusy(true); setErrorText("");
    try { const result = await post<{ sequence: number; pin: string }>("/owner/gdm/activities/" + activityId + "/start-run", { operationId: operationId() }); setNotice("Run " + result.sequence + " is ready. New participant PIN: " + result.pin + "."); refresh(); }
    catch (reason) { setErrorText(reason instanceof Error ? reason.message : "Could not start a new Run."); }
    finally { setBusy(false); }
  }
  if (loading && !data) return <LoadingState label="Opening Activity data controls…" />;
  if (error || !data) return <ErrorState message={error || "Activity not found."} retry={refresh} />;
  const activity = data.activity, live = ["LIVE", "PAUSED"].includes(data.currentRun?.state ?? "") || ["open", "paused"].includes(activity.state);
  const stableActivityUrl = `${window.location.origin}/activity/${activity.access_slug}`;
  async function copyStableActivityUrl() {
    try { await navigator.clipboard.writeText(stableActivityUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setErrorText("Could not copy the Activity link. Select the link shown beside its QR code."); }
  }
  return <div className="page-stack gdm-page"><div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ArrowRight size={14} /><span>{toolName(activity.tool_id)}</span></div><PageIntro eyebrow={toolName(activity.tool_id) + " · ACTIVITY DATA"} title={activity.title} description={(activity.session_name ?? "Standalone Activity") + " · Activity links stay fixed; participant data is isolated per Run."} action={<Button variant="secondary" to={toolPath(activity)}>Open Activity</Button>} />
    {errorText && <div className="inline-error" role="alert">{errorText}</div>}{notice && <div className="gdm-success" role="status">{notice}</div>}
    <Card className="gdm-stable-access"><div><span className="eyebrow">STABLE ACTIVITY LINK</span><h2>One QR across Runs</h2><p>This link stays the same when the PIN rotates. It always opens the Current Run for this Activity.</p><div className="gdm-stable-link"><a href={stableActivityUrl}>{stableActivityUrl}</a><Button variant="secondary" onClick={() => void copyStableActivityUrl()} icon={<Copy size={15} />}>{copied ? "Copied" : "Copy link"}</Button></div></div><QRCodeSVG value={stableActivityUrl} size={120} includeMargin /></Card>
    <Card className="gdm-current-card"><div className="section-heading"><div><span className="eyebrow">CURRENT RUN</span><h2>{data.currentRun ? "Run " + data.currentRun.sequence : "No Current Run"}</h2></div><Badge tone={live ? "green" : "aqua"}>{data.currentRun?.state ?? "Not started"}</Badge></div><p>{data.currentRun ? "Run ID " + data.currentRun.id + " · Started " + date(data.currentRun.started_at) + " · Origin: " + (data.currentRun.origin_session_name ?? "Standalone") : "Participants cannot join until a Run is started."}</p><div className="gdm-actions"><Button onClick={() => void startRun()} disabled={busy || live}>{activity.tool_id === "quiz" ? "Set up a new Run" : "Start New Run"}</Button><Button variant="secondary" onClick={() => setDialog("reset-current")} disabled={!data.currentRun || live}>Reset Current Run</Button><Button variant="danger" onClick={() => setDialog("reset-all")} disabled={live}>Reset All Runs</Button><Button variant="danger" onClick={() => setDialog("delete")} disabled={live}>Delete Activity</Button><ExportLink href={"/api/owner/gdm/activities/" + activityId + "/export?format=csv"}>Activity CSV</ExportLink><ExportLink href={"/api/owner/gdm/activities/" + activityId + "/export?format=excel"}>Activity Excel</ExportLink></div>{live && <p className="gdm-muted">End the Live or Paused Run before Reset or Delete.</p>}</Card>
    <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">TRAINER-ONLY</span><h2>Run history</h2></div><span className="subtle-text">History cannot be joined or reopened by participants.</span></div>{data.runs.length ? <div className="gdm-rows">{data.runs.map((run) => <article className="gdm-row" key={run.id}><div className="gdm-row-main"><strong>Run {run.sequence}{run.is_current ? " · Current" : " · History"}</strong><small>{run.id} · Origin: {run.origin_session_name ?? "Standalone"} · {date(run.created_at)}</small></div><Badge tone={run.is_current ? "aqua" : "gray"}>{run.state}</Badge><Button variant="quiet" to={"/gdm/runs/" + run.id}>View results <ArrowRight size={15} /></Button><ExportLink href={"/api/owner/gdm/runs/" + run.id + "/export?format=csv"}>CSV</ExportLink><ExportLink href={"/api/owner/gdm/runs/" + run.id + "/export?format=excel"}>Excel</ExportLink><Button variant="danger" onClick={() => { setTargetRun(run.id); setDialog("delete-run"); }} disabled={live}>Delete Run</Button></article>)}</div> : <EmptyState title="No Run history" description="A Run appears when the Activity is first started." />}</Card>
    {dialog === "reset-current" && <ActionDialog title="Reset Current Run permanently?" cancel={() => setDialog(null)} confirm={() => void act("reset-current")} busy={busy} confirmText="Reset Run"><p>The current Run’s participants and results are permanently deleted and cannot be restored from Trash. Activity configuration stays. A clean Current Run receives a new ID and PIN.</p></ActionDialog>}
    {dialog === "reset-all" && <ActionDialog title="Reset All Runs permanently?" cancel={() => setDialog(null)} confirm={() => void act("reset-all")} busy={busy} confirmText="Reset All Runs"><p>Every Run for this Activity is permanently deleted, including Runs in Trash. Configuration stays. A clean Run receives a new ID and PIN. This cannot be undone.</p></ActionDialog>}
    {dialog === "delete" && <ActionDialog title="Move Activity and all Runs to Trash?" cancel={() => setDialog(null)} confirm={() => void act("delete")} busy={busy} confirmText="Delete Activity"><p>The Activity and every Run move together to Trash for 30 days. Restore brings the Activity and its Runs back; the old PIN is not reused.</p></ActionDialog>}
    {dialog === "delete-run" && <ActionDialog title="Move this Run to Trash?" cancel={() => setDialog(null)} confirm={() => void act("delete-run")} busy={busy} confirmText="Delete Run"><p>This Run stays recoverable for 30 days. If it is Current, the Activity will have no Current Run until you start one.</p></ActionDialog>}
  </div>;
}

function parseCsvPreview(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = csv.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((line) => !(line.length === 1 && line[0]?.startsWith("# ")));
}

export function GdmRunPage() {
  const { runId = "" } = useParams();
  const { data, loading, error, refresh } = useGdmData<{ run: GdmRun & { activity_title: string; tool_id: string; export_csv: string | null; data_json: string | null } }>("/owner/gdm/runs/" + runId);
  if (loading && !data) return <LoadingState label="Loading saved Run results…" />;
  if (error || !data) return <ErrorState message={error || "Run not found."} retry={refresh} />;
  const run = data.run, rows = run.export_csv ? parseCsvPreview(run.export_csv) : [];
  const snapshot = run.data_json ? (() => {
    try { return JSON.parse(run.data_json!) as { participantCount?: number; submittedCount?: number }; }
    catch { return null; }
  })() : null;
  return <div className="page-stack gdm-page">
    <div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ArrowRight size={14} /><Link to={"/gdm/activities/" + run.activity_id}>{run.activity_title}</Link><ArrowRight size={14} /><span>Run {run.sequence}</span></div>
    <PageIntro eyebrow="TRAINER-ONLY RUN HISTORY" title={`Run ${run.sequence} results`} description={`${toolName(run.tool_id)} · ${run.activity_title} · Origin: ${run.origin_session_name ?? "Standalone"}. ${run.is_current ? "Current Run" : "Historical Run; participant access is closed."}`} action={<Button variant="secondary" to={toolPath({ id: run.activity_id, title: run.activity_title, tool_id: run.tool_id } as GdmActivity)}>Open Activity</Button>} />
    <Card className="gdm-current-card"><div className="section-heading"><div><span className="eyebrow">SAVED RUN</span><h2>{run.state}</h2></div><Badge tone={run.is_current ? "aqua" : "gray"}>{run.is_current ? "Current" : "History"}</Badge></div><p>Run ID {run.id} · Created {date(run.created_at)} · Started {date(run.started_at)} · Ended {date(run.ended_at)} · Origin Session {run.origin_session_name ?? "—"}</p>{snapshot && <p>{snapshot.participantCount ?? 0} joined · {snapshot.submittedCount ?? 0} submitted</p>}<div className="gdm-actions"><ExportLink href={`/api/owner/gdm/runs/${run.id}/export?format=csv`}>Run CSV</ExportLink><ExportLink href={`/api/owner/gdm/runs/${run.id}/export?format=excel`}>Run Excel</ExportLink></div></Card>
    <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">RESULT SNAPSHOT</span><h2>{rows.length ? "Run data" : "No saved result snapshot"}</h2></div></div>{rows.length ? <div className="gdm-table-wrap"><table className="gdm-results-table"><thead><tr>{rows[0]!.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{rows.slice(1, 51).map((line, rowIndex) => <tr key={rowIndex}>{rows[0]!.map((_, columnIndex) => <td key={columnIndex}>{line[columnIndex] ?? ""}</td>)}</tr>)}</tbody></table>{rows.length > 51 && <p className="gdm-muted">Showing the first 50 rows. Download CSV or Excel for the complete Run export.</p>}</div> : <EmptyState title="This Current Run has no saved snapshot yet" description="Current analytics remain available in the Activity. A snapshot is created when the Run closes or is replaced." action={<Button variant="secondary" to={toolPath({ id: run.activity_id, title: run.activity_title, tool_id: run.tool_id } as GdmActivity)}>Open Activity</Button>} />}</Card>
  </div>;
}

export function GdmSessionPage() {
  const { sessionId = "" } = useParams();
  const { data, loading, error, refresh } = useGdmData<{ session: GdmSession; activities: GdmActivity[]; runs: GdmRun[]; access: { accessSlug: string; joinPin: string; url: string }; reportSources: Array<{ available: boolean }> }>("/owner/gdm/sessions/" + sessionId);
  const [dialog, setDialog] = useState<"archive" | "reopen" | "reset-keep" | "reset-empty" | "delete-only" | "delete-all" | null>(null), [scope, setScope] = useState<"CURRENT" | "ALL">("CURRENT"), [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [errorText, setErrorText] = useState(""), [notice, setNotice] = useState("");
  async function apply(action: NonNullable<typeof dialog>) {
    setBusy(true); setErrorText("");
    try {
      if (action === "archive" || action === "reopen") await post("/owner/gdm/sessions/" + sessionId + "/" + action, {});
      else if (action === "reset-keep") await post("/owner/gdm/sessions/" + sessionId + "/reset", { operationId: operationId(), branch: "KEEP_ACTIVITIES", scope });
      else if (action === "reset-empty") await post("/owner/gdm/sessions/" + sessionId + "/reset", { operationId: operationId(), branch: "KEEP_EMPTY", scope: "ALL" });
      else {
        if (action === "delete-all" && !preview?.ready) { setErrorText("End all Live or Paused Runs before deleting the Session."); setBusy(false); return; }
        const result = await post<{ packageId: string }>("/owner/gdm/sessions/" + sessionId + "/delete", { operationId: operationId(), mode: action === "delete-all" ? "ALL" : "ONLY" });
        setNotice("Session moved to Trash. Package " + result.packageId + " can be restored for 30 days."); setDialog(null); refresh(); setBusy(false); return;
      }
      setNotice(action.startsWith("reset") ? "Session reset complete. The stable link remains; its PIN changed and old Session memberships were removed." : action === "archive" ? "Session archived. Its report will not include future Runs." : "Session reopened."); setDialog(null); refresh();
    } catch (reason) { setErrorText(reason instanceof Error ? reason.message : "Could not update this Session."); }
    finally { setBusy(false); }
  }
  async function previewDeleteAll() {
    setErrorText("");
    try { setPreview(await post<Preview>("/owner/gdm/preview", { sessionIds: [sessionId], activityIds: [], runIds: [], sessionMode: "ALL" })); setDialog("delete-all"); }
    catch (reason) { setErrorText(reason instanceof Error ? reason.message : "Could not preview Session deletion."); }
  }
  if (loading && !data) return <LoadingState label="Opening Session data controls…" />;
  if (error || !data) return <ErrorState message={error || "Session not found."} retry={refresh} />;
  const session = data.session, activities = data.activities, runs = data.runs, access = data.access;
  return <div className="page-stack gdm-page"><div className="breadcrumb"><Link to="/archive">Archive / Results</Link><ArrowRight size={14} /><span>Session</span></div><PageIntro eyebrow="SESSION DATA" title={session.name} description={activities.length + " Activities · " + runs.length + " Runs · " + (session.status === "completed" ? "Archived report has a fixed source list." : "Manage access and lifecycle.")} action={<Button variant="secondary" to={"/sessions/" + session.id}>Open Session</Button>} />
    {errorText && <div className="inline-error" role="alert">{errorText}</div>}{notice && <div className="gdm-success" role="status">{notice}</div>}
    <Card className="gdm-current-card"><div className="section-heading"><div><span className="eyebrow">SESSION ACCESS</span><h2>{session.status === "completed" ? "Archived Session" : "Active Session"}</h2></div><Badge tone={session.status === "completed" ? "blue" : "aqua"}>{session.status}</Badge></div><p>Stable Session link: <a href={access.url}>{access.url}</a> · PIN {access.joinPin}. Archived Session join is disabled; direct Activity links remain usable for new Runs.</p><div className="gdm-actions"><Button variant={session.status === "completed" ? "primary" : "secondary"} onClick={() => setDialog(session.status === "completed" ? "reopen" : "archive")}>{session.status === "completed" ? "Reopen Session" : "Archive Session"}</Button><Button variant="secondary" onClick={() => setDialog("reset-keep")}>Reset · keep Activities</Button><Button variant="secondary" onClick={() => setDialog("reset-empty")}>Reset · keep empty</Button><Button variant="danger" onClick={() => setDialog("delete-only")}>Delete Session only</Button><Button variant="danger" onClick={() => void previewDeleteAll()}>Delete Session &amp; Activities</Button><ExportLink href={"/api/owner/gdm/sessions/" + sessionId + "/export?format=csv"}>Session CSV</ExportLink><ExportLink href={"/api/owner/gdm/sessions/" + sessionId + "/export?format=excel"}>Session Excel</ExportLink></div></Card>
    <Card className="gdm-list-card"><div className="section-heading"><div><span className="eyebrow">SESSION MANIFEST</span><h2>Activities and source Runs</h2></div></div>{activities.length ? <div className="gdm-rows">{activities.map((item) => <article className="gdm-row" key={item.id}><div className="gdm-row-main"><Link to={"/gdm/activities/" + item.id}><strong>{item.title}</strong><small>{toolName(item.tool_id)} · {item.state}</small></Link></div><Badge tone="purple">{runs.filter((run) => run.activity_id === item.id).length} Runs</Badge><Button variant="quiet" to={"/gdm/activities/" + item.id}>Manage <ArrowRight size={15} /></Button></article>)}</div> : <EmptyState title="This Session is empty" description="History remains independent of Activities that were detached or deleted." />}{session.status === "completed" && data.reportSources.some((item) => !item.available) && <div className="gdm-warning"><strong>Some archived report sources are unavailable.</strong><p>A source Run was permanently reset or deleted. Its result data is not exposed in this report.</p></div>}</Card>
    {dialog === "archive" && <ActionDialog title="Archive this Session?" cancel={() => setDialog(null)} confirm={() => void apply("archive")} busy={busy} confirmText="Archive Session"><p>The Session link stops accepting Session joins. Activity links remain usable, and the report keeps a fixed list of source Runs.</p></ActionDialog>}
    {dialog === "reopen" && <ActionDialog title="Reopen this Session?" cancel={() => setDialog(null)} confirm={() => void apply("reopen")} busy={busy} confirmText="Reopen Session"><p>The Session link and PIN become usable again. Existing archived report sources stay fixed.</p></ActionDialog>}
    {dialog === "reset-keep" && <ActionDialog title="Reset Session and keep Activities" cancel={() => setDialog(null)} confirm={() => void apply("reset-keep")} busy={busy} confirmText="Reset Session"><p>Reset only Runs with this Session’s immutable origin. Runs from other Sessions remain untouched. The Session link stays fixed; the PIN changes and prior Session memberships are removed.</p><label className="gdm-mode-select">Run scope<select value={scope} onChange={(event) => setScope(event.target.value as "CURRENT" | "ALL")}><option value="CURRENT">Current Runs only</option><option value="ALL">All Runs, including History and Trash</option></select></label></ActionDialog>}
    {dialog === "reset-empty" && <ActionDialog title="Keep this Session empty?" cancel={() => setDialog(null)} confirm={() => void apply("reset-empty")} busy={busy} confirmText="Keep Session empty"><p>Every Activity becomes Standalone and keeps its Runs and origin history. The Session link remains; the PIN changes and old Session memberships are removed.</p></ActionDialog>}
    {dialog === "delete-only" && <ActionDialog title="Delete Session only?" cancel={() => setDialog(null)} confirm={() => void apply("delete-only")} busy={busy} confirmText="Delete Session"><p>The Session moves to Trash for 30 days. Activities become Standalone and keep their Runs. Restore brings back an empty Session.</p></ActionDialog>}
    {dialog === "delete-all" && <ActionDialog title="Delete Session and all Activities?" cancel={() => setDialog(null)} confirm={() => void apply("delete-all")} busy={busy} disabled={!preview?.ready} confirmText="Delete Session &amp; Activities"><p>{preview?.message} The package can be restored together for 30 days.</p><p>{preview?.activityCount ?? activities.length} Activities · {preview?.runCount ?? runs.length} Runs.</p>{preview?.activeActivities.length ? <p className="inline-error">End Live or Paused Runs first: {preview.activeActivities.join(", ")}</p> : null}{preview?.crossSessionImpact.length ? <div className="gdm-warning"><strong>These cascades include Runs from other Sessions:</strong><ul>{preview.crossSessionImpact.map((item) => <li key={item.id}>{item.name}</li>)}</ul></div> : null}</ActionDialog>}
  </div>;
}
