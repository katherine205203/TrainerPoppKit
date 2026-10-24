import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const base = process.env.GDM_SMOKE_URL ?? "http://127.0.0.1:8787";
const origin = new URL(base).origin;
const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
assert.ok(vars.OWNER_PASSWORD, "Local OWNER_PASSWORD is needed in .dev.vars");

let cookie = "";
let checks = 0, requestCounter = 0;
const ids = { session: "", activity: "", otherActivityIds: new Set(), runIds: new Set(), packageIds: new Set() };
async function call(path, method = "GET", payload, token) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": `198.51.100.${(requestCounter++ % 250) + 1}`, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* CSV remains text. */ }
  return { status: response.status, body, headers: response.headers };
}
function check(condition, message) { assert.ok(condition, message); checks += 1; }
function ok(result, message) { check(result.status >= 200 && result.status < 300, `${message}: ${result.status} ${typeof result.body === "string" ? result.body.slice(0, 240) : JSON.stringify(result.body)}`); return result.body; }
function operation() { return { operationId: randomUUID() }; }

try {
  const login = await call("/auth/login", "POST", { password: vars.OWNER_PASSWORD });
  ok(login, "owner sign-in");
  cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  check(Boolean(cookie), "owner cookie issued");

  const session = ok(await call("/owner/sessions", "POST", { name: `GDM smoke ${Date.now()}`, description: "Local lifecycle verification", location: "", expectedParticipants: 6 }), "create Session").session;
  ids.session = session.id;
  const initialAccess = ok(await call(`/owner/gdm/sessions/${session.id}/access`), "initial Session access");
  const poll = ok(await call("/owner/polls", "POST", {
    title: `GDM Poll ${Date.now()}`, question: "Which option should we choose?", questionType: "single",
    options: ["Option one", "Option two"], maxSelections: 1, allowOther: false,
    identityMode: "anonymous", participantResultsMode: "presenter_only", sessionId: session.id,
  }), "create anonymous Poll");
  ids.activity = poll.activityId;

  let detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "initialize shared Run ledger");
  const pollDetail = ok(await call(`/owner/polls/${ids.activity}`), "read Poll module access");
  const pollSlug = pollDetail.poll.accessSlug;
  const firstRun = detail.currentRun;
  check(Boolean(firstRun?.id && firstRun.is_current === 1 && firstRun.origin_session_id === session.id), "first Run records immutable Session origin");
  check(firstRun.config_json.includes("poll_configs"), "first Run captures its module configuration snapshot");
  ids.runIds.add(firstRun.id);
  const stableSlug = detail.activity.access_slug;
  const stableUrl = await call(`/join/activities/${stableSlug}`);
  check(stableUrl.status === 200 && stableUrl.body.path === `/poll/${pollSlug}`, "stable Activity URL maps to the module join route");

  const opened = ok(await call(`/owner/polls/${ids.activity}/open`, "POST", {}), "open Poll");
  const liveReset = await call(`/owner/gdm/activities/${ids.activity}/reset`, "POST", { ...operation(), scope: "CURRENT" });
  check(liveReset.status === 409, "Reset is blocked while the Activity is Live");
  const guest = ok(await call(`/join/polls/${pollSlug}/enter`, "POST", { displayName: "GDM Private Guest" }), "participant joins Poll");
  const publicPoll = ok(await call(`/join/polls/${pollSlug}`), "read Poll join options");
  const optionId = publicPoll.options[0].id;
  ok(await call("/guest/poll/response", "POST", { selections: [{ optionId }], idempotencyKey: randomUUID() }, guest.token), "submit anonymous Poll response");
  ok(await call(`/owner/polls/${ids.activity}/close`, "POST", {}), "close Poll");

  const run2 = ok(await call(`/owner/gdm/activities/${ids.activity}/start-run`, "POST", operation()), "Start New Run");
  ids.runIds.add(run2.runId);
  check(run2.runId !== firstRun.id && run2.sequence === 2, "Start New Run creates a new sequence and identity scope");
  detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "read new current Run");
  check(detail.activity.access_slug === stableSlug && detail.currentRun.id === run2.runId, "stable Activity URL survives Run replacement");
  check(detail.activity.join_pin !== opened.pin, "Start New Run rotates the Activity PIN");
  check((await call("/join/lookup", "POST", { pin: opened.pin })).status === 404, "previous Activity PIN no longer resolves");
  const oldRunExport = await call(`/owner/gdm/runs/${firstRun.id}/export?format=csv`);
  check(oldRunExport.status === 200 && oldRunExport.body.includes("GDM Poll") && !oldRunExport.body.includes("GDM Private Guest"), "historical anonymous export preserves results without participant identity");
  const oldRunDetail = ok(await call(`/owner/gdm/runs/${firstRun.id}`), "trainer opens historical Run results");
  check(oldRunDetail.run.export_csv.includes("SUMMARY") && oldRunDetail.run.is_current === 0, "trainer-only Run detail contains the saved results snapshot");

  const namedPoll = ok(await call("/owner/polls", "POST", {
    title: `GDM named Poll ${Date.now()}`, question: "Which named choice?", questionType: "single",
    options: ["Named option", "Other option"], maxSelections: 1, allowOther: false,
    identityMode: "named", participantResultsMode: "presenter_only", sessionId: null,
  }), "create named Poll");
  ids.otherActivityIds.add(namedPoll.activityId);
  const namedInitial = ok(await call(`/owner/gdm/activities/${namedPoll.activityId}`), "initialize named Poll Run");
  const namedRun = namedInitial.currentRun;
  ids.runIds.add(namedRun.id);
  const namedModule = ok(await call(`/owner/polls/${namedPoll.activityId}`), "read named Poll access");
  ok(await call(`/owner/polls/${namedPoll.activityId}/open`, "POST", {}), "open named Poll");
  const namedPublic = ok(await call(`/join/polls/${namedModule.poll.accessSlug}`), "read named Poll choices");
  const namedGuest = ok(await call(`/join/polls/${namedModule.poll.accessSlug}/enter`, "POST", { displayName: "Named GDM Guest" }), "join named Poll");
  ok(await call("/guest/poll/response", "POST", { selections: [{ optionId: namedPublic.options[0].id }], idempotencyKey: randomUUID() }, namedGuest.token), "submit named Poll response");
  ok(await call(`/owner/polls/${namedPoll.activityId}/close`, "POST", {}), "close named Poll");
  ok(await call(`/owner/gdm/activities/${namedPoll.activityId}/start-run`, "POST", operation()), "snapshot named Poll Run");
  const namedRunExport = await call(`/owner/gdm/runs/${namedRun.id}/export?format=csv`);
  check(namedRunExport.status === 200 && namedRunExport.body.includes("Named GDM Guest"), "named Poll export includes named individual responses by module policy");
  const namedBulkExport = await call("/owner/gdm/bulk-export", "POST", { selection: { sessionIds: [], activityIds: [namedPoll.activityId], runIds: [namedRun.id] }, format: "csv" });
  const namedRunMarker = `"RUN","${namedRun.id}"`;
  const namedRunOccurrences = typeof namedBulkExport.body === "string" ? namedBulkExport.body.split(namedRunMarker).length - 1 : 0;
  check(namedBulkExport.status === 200 && namedBulkExport.body.includes("Named GDM Guest") && namedRunOccurrences === 1, "Archive bulk export includes named Poll detail and removes Activity/Run duplicate selection");

  const deleteCurrent = ok(await call(`/owner/gdm/runs/${run2.runId}/delete`, "POST", operation()), "delete Current Run");
  ids.packageIds.add(deleteCurrent.packageId);
  const deletedRun = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Activity after deleting Current Run");
  check(deletedRun.currentRun === null && deletedRun.activity.current_run_id === null, "deleting Current Run leaves the Activity without a Current Run");
  const trashAfterRunDelete = ok(await call("/owner/gdm/trash"), "read Trash");
  check(trashAfterRunDelete.items.some((item) => item.id === deleteCurrent.packageId), "deleted Run appears in 30-day Trash");
  const restoredRun = ok(await call(`/owner/gdm/trash/${deleteCurrent.packageId}/restore`, "POST", operation()), "restore Run");
  check(restoredRun.restoredRuns === 1, "Run restores as trainer-only history");
  detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Activity after Run restore");
  check(detail.currentRun === null && detail.runs.some((run) => run.id === run2.runId && run.is_current === 0), "restored Run does not become Current or Live");

  const run3 = ok(await call(`/owner/gdm/activities/${ids.activity}/start-run`, "POST", operation()), "start Run after Current Run deletion");
  ids.runIds.add(run3.runId);
  const deleteHistory = ok(await call(`/owner/gdm/runs/${firstRun.id}/delete`, "POST", operation()), "delete historical Run");
  ids.packageIds.add(deleteHistory.packageId);
  detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Runs before Reset All");
  check(detail.runs.some((run) => run.id === run3.runId && run.is_current === 1), "Reset All targets the active Current Run");
  const resetAll = ok(await call(`/owner/gdm/activities/${ids.activity}/reset`, "POST", { ...operation(), scope: "ALL" }), "Reset All Runs");
  ids.runIds.add(resetAll.runId);
  check(resetAll.runId !== run3.runId, "Reset All creates a clean Run with a new identity");
  check((await call(`/owner/gdm/runs/${run2.runId}/export?format=csv`)).status === 410 && (await call(`/owner/gdm/runs/${run3.runId}/export?format=csv`)).status === 410, "Reset All permanently removes prior history and the Current Run");
  check((await call(`/owner/gdm/runs/${firstRun.id}/export?format=csv`)).status === 410, "Reset All permanently removes a Run that had been in Trash");
  const trashAfterReset = ok(await call("/owner/gdm/trash"), "Trash after Reset All");
  check(!trashAfterReset.items.some((item) => item.id === deleteHistory.packageId), "Reset All removes the empty Trash package restore option");
  check((await call(`/owner/gdm/trash/${deleteHistory.packageId}/restore`, "POST", operation())).status === 409, "permanently reset Run cannot be restored");

  const sessionReset = ok(await call(`/owner/gdm/sessions/${session.id}/reset`, "POST", { ...operation(), branch: "KEEP_EMPTY", scope: "ALL" }), "reset Session and keep it empty");
  const resetAccess = sessionReset.access;
  check(resetAccess.accessSlug === initialAccess.accessSlug && resetAccess.joinPin !== initialAccess.joinPin, "Session Reset keeps its URL and rotates its PIN");
  detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Activity after Session reset");
  check(detail.activity.session_id === null && detail.currentRun.origin_session_id === session.id, "keep-empty reset detaches Activity but retains immutable Run origin");
  const emptySession = ok(await call(`/owner/gdm/sessions/${session.id}`), "Session history after detaching Activity");
  check(emptySession.activities.length === 0 && emptySession.runs.some((run) => run.id === detail.currentRun.id), "Session history still lists immutable-origin Runs after Activity detaches");

  const deleteSession = ok(await call(`/owner/gdm/sessions/${session.id}/delete`, "POST", { ...operation(), mode: "ONLY" }), "delete empty Session only");
  ids.packageIds.add(deleteSession.packageId);
  check((await call(`/owner/gdm/sessions/${session.id}`)).status === 404, "deleted Session is not readable from Archive");
  const restoreSession = ok(await call(`/owner/gdm/trash/${deleteSession.packageId}/restore`, "POST", operation()), "restore Session");
  check(restoreSession.restoredSessions === 1, "Session restores without silently reattaching Activities");
  const restoredSession = ok(await call(`/owner/gdm/sessions/${session.id}`), "read restored Session");
  check(restoredSession.activities.length === 0, "Delete Session Only restores an empty Session");

  const activityAccessBeforeDelete = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Activity access before delete").activity;
  const deleteActivity = ok(await call(`/owner/gdm/activities/${ids.activity}/delete`, "POST", operation()), "delete Activity with its Runs");
  ids.packageIds.add(deleteActivity.packageId);
  check((await call(`/join/activities/${stableSlug}`)).status === 404, "stable Activity URL is unavailable while its Activity is in Trash");
  const restoredActivity = ok(await call(`/owner/gdm/trash/${deleteActivity.packageId}/restore`, "POST", operation()), "restore Activity package");
  check(restoredActivity.restoredActivities === 1, "Activity and surviving Run history restore together");
  detail = ok(await call(`/owner/gdm/activities/${ids.activity}`), "Activity after restore");
  check(detail.activity.access_slug === stableSlug && detail.activity.join_pin === null && detail.currentRun === null, "Activity restore keeps its URL but does not reuse its PIN or revive a Current Run");
  const runAfterRestore = ok(await call(`/owner/gdm/activities/${ids.activity}/start-run`, "POST", operation()), "start new Run after Activity restore");
  ids.runIds.add(runAfterRestore.runId);
  const accessAfterRestore = await call(`/join/activities/${stableSlug}`);
  check(accessAfterRestore.status === 200 && accessAfterRestore.body.path === `/poll/${pollSlug}`, `same stable Activity URL works after a new Run is started (received ${accessAfterRestore.status})`);
  const activityAfterRestore = ok(await call(`/owner/gdm/activities/${ids.activity}`), "new Activity PIN after restore").activity;
  check(activityAfterRestore.join_pin !== activityAccessBeforeDelete.join_pin, "restored Activity receives a fresh PIN on activation");

  const expiringDelete = ok(await call(`/owner/gdm/runs/${runAfterRestore.runId}/delete`, "POST", operation()), "delete Run for expiry purge");
  ids.packageIds.add(expiringDelete.packageId);
  const expirySql = `UPDATE gdm_trash_packages SET expires_at='2000-01-01T00:00:00.000Z' WHERE id='${expiringDelete.packageId}';`;
  execFileSync("npx", ["wrangler", "d1", "execute", "trainerpopp-kit", "--local", "--command", expirySql], { cwd: new URL("..", import.meta.url), env: { ...process.env, WRANGLER_WRITE_LOGS: "false" }, stdio: "ignore" });
  const trashAfterPurge = ok(await call("/owner/gdm/trash"), "scheduled expiry purge path");
  check(!trashAfterPurge.items.some((item) => item.id === expiringDelete.packageId), "expired Trash package is purged from the owner recovery list");
  check((await call(`/owner/gdm/runs/${runAfterRestore.runId}/export?format=csv`)).status === 410, "purged Run data cannot be exported or restored");

  console.log(`GDM smoke passed: ${checks} Worker/D1 assertions across Run isolation, Live guards, stable links, Reset/Delete/Trash/Restore, Session reset/delete and anonymous export.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "GDM smoke failed.");
  process.exitCode = 1;
} finally {
  if (cookie) cookie = "";
  if (ids.activity && ids.session && ["127.0.0.1", "localhost"].includes(new URL(base).hostname)) {
    const activityIds = [ids.activity, ...ids.otherActivityIds];
    const validIds = [...activityIds, ids.session, ...ids.packageIds];
    if (validIds.every((value) => /^[0-9a-f-]{36}$/i.test(value))) {
      const packageIds = [...ids.packageIds].map((id) => `'${id}'`).join(",") || "''";
      const activitySql = activityIds.map((id) => `'${id}'`).join(",");
      const cleanup = `DELETE FROM activities WHERE id IN (${activitySql}); DELETE FROM sessions WHERE id='${ids.session}'; DELETE FROM gdm_trash_packages WHERE id IN (${packageIds}); DELETE FROM gdm_operations WHERE target_id IN (${activitySql},'${ids.session}');`;
      try {
        execFileSync("npx", ["wrangler", "d1", "execute", "trainerpopp-kit", "--local", "--command", cleanup], {
          cwd: new URL("..", import.meta.url), env: { ...process.env, WRANGLER_WRITE_LOGS: "false" }, stdio: "ignore",
        });
      } catch { /* Do not hide test results if local fixture cleanup is unavailable. */ }
    }
  }
}
