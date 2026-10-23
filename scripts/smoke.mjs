import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const base = process.env.TRAINERPOPP_SMOKE_URL ?? "http://127.0.0.1:8787";
const origin = new URL(base).origin;
const secretText = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const secrets = Object.fromEntries(secretText.split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf("=");
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
if (!secrets.OWNER_PASSWORD || !secrets.SESSION_SECRET) throw new Error("Local owner secrets are incomplete. Run npm run local:setup.");

let checks = 0;
const smokeRun = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function assert(condition, message) {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
  checks += 1;
}
async function call(path, { method = "GET", body, cookie, token, ip = `smoke-default-${smokeRun}` } = {}) {
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
  }
  if (cookie) headers.set("Cookie", cookie);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("CF-Connecting-IP", ip);
  const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let data = {};
  try { data = JSON.parse(text); } catch { /* CSV responses stay available as text for export checks. */ }
  return { response, data, text, bytes };
}

const health = await call("/health");
assert(health.response.ok && health.data.databaseConfigured && health.data.ownerAuthConfigured, "local Worker and D1 are configured");
const denied = await call("/owner/sessions");
assert(denied.response.status === 401, "owner API denies anonymous access");
const wrongLogin = await call("/auth/login", { method: "POST", body: { password: "incorrect-password" }, ip: `smoke-wrong-auth-${smokeRun}` });
assert(wrongLogin.response.status === 401, "owner login rejects a wrong password");
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const response = await call("/auth/login", { method: "POST", body: { password: "incorrect-password" }, ip: `smoke-auth-limit-${smokeRun}` });
  assert(response.response.status === 401, "owner login allows up to ten attempts in its window");
}
const blockedLogin = await call("/auth/login", { method: "POST", body: { password: "incorrect-password" }, ip: `smoke-auth-limit-${smokeRun}` });
assert(blockedLogin.response.status === 429, "owner login is rate limited after repeated guesses");
const login = await call("/auth/login", { method: "POST", body: { password: secrets.OWNER_PASSWORD }, ip: `smoke-owner-auth-${smokeRun}` });
assert(login.response.ok && login.response.headers.get("set-cookie")?.includes("HttpOnly"), `owner login sets an HTTP-only session cookie (status ${login.response.status}, error ${login.data.error ?? "none"})`);
const cookie = login.response.headers.get("set-cookie").split(";")[0];
const authCheck = await call("/auth/me", { cookie });
assert(authCheck.data.authenticated === true, "signed owner session is accepted");

const sessionResult = await call("/owner/sessions", { method: "POST", cookie, body: { name: `Smoke session ${Date.now()}`, description: "Local API smoke check", location: "Local test", expectedParticipants: 6 } });
assert(sessionResult.response.status === 201, "trainer creates a session");
const sessionId = sessionResult.data.session.id;
const sessionUpdate = await call(`/owner/sessions/${sessionId}`, { method: "PATCH", cookie, body: { name: "Updated smoke session", description: "Edited by local API smoke check", location: "Local test", expectedParticipants: 8, startsAt: null } });
assert(sessionUpdate.response.ok && sessionUpdate.data.session.name === "Updated smoke session" && sessionUpdate.data.session.expected_participants === 8, "trainer edits session details");
const activityResult = await call("/owner/activities", { method: "POST", cookie, body: { sessionId, title: "Smoke SCARF demo", resultPolicy: "trainer_reveal", allowTeams: true, requireName: true, teamNames: ["Team A", "Team B"] } });
assert(activityResult.response.status === 201, "trainer creates a session activity and teams");
const activityId = activityResult.data.activity.id;
const opened = await call(`/owner/activities/${activityId}/open`, { method: "POST", cookie, body: {} });
assert(opened.response.ok && /^\d{6}$/.test(opened.data.pin), "trainer opens the activity and receives a scoped PIN");
const pin = opened.data.pin;

const wrongPin = String((Number(pin) + 1) % 1_000_000).padStart(6, "0");
let blocked = false;
for (let attempt = 1; attempt <= 11; attempt += 1) {
  const response = await call("/join/lookup", { method: "POST", body: { pin: wrongPin }, ip: `smoke-guess-${smokeRun}` });
  if (attempt <= 10) assert(response.response.status === 404, "wrong PIN does not reveal activity details");
  else blocked = response.response.status === 429;
}
assert(blocked, "PIN lookup is rate limited after repeated guesses");

const lookup = await call("/join/lookup", { method: "POST", body: { pin }, ip: `smoke-guest-one-${smokeRun}` });
assert(lookup.response.ok && lookup.data.activity.demoOnly && lookup.data.teams.length === 2, "valid PIN returns only join-safe activity details");
const firstJoin = await call("/join/enter", { method: "POST", body: { pin, displayName: "Private Person", role: "Designer", teamId: lookup.data.teams[0].id, consentNamedResults: false }, ip: `smoke-guest-one-${smokeRun}` });
assert(firstJoin.response.status === 201 && firstJoin.data.token, "guest receives a temporary scoped token");
const secondJoin = await call("/join/enter", { method: "POST", body: { pin, displayName: "Opted In Person", teamId: lookup.data.teams[0].id, consentNamedResults: true }, ip: `smoke-guest-two-${smokeRun}` });
assert(secondJoin.response.status === 201, "guest may explicitly opt into name display");
const guestToken = firstJoin.data.token;
const guestActivity = await call("/guest/activity", { token: guestToken });
assert(guestActivity.response.ok && guestActivity.data.demoOnly && guestActivity.data.items.length === 5, "guest can access only the demo activity they joined");
const draft = await call("/guest/draft", { method: "POST", token: guestToken, body: { answers: { 1: 4, 2: 3 } } });
assert(draft.response.ok && draft.data.saved, "partial responses save as a recoverable draft");
const incomplete = await call("/guest/submit", { method: "POST", token: guestToken, body: { answers: { 1: 4 } } });
assert(incomplete.response.status === 400, "incomplete assessment cannot be submitted");
const answers = { 1: 4, 2: 3, 3: 5, 4: 2, 5: 4 };
const submitted = await call("/guest/submit", { method: "POST", token: guestToken, body: { answers } });
assert(submitted.response.ok && submitted.data.submitted, "complete demo response submits");
const retry = await call("/guest/submit", { method: "POST", token: guestToken, body: { answers } });
assert(retry.response.ok && retry.data.alreadySubmitted, "retry of the same submission is idempotent");
const changed = await call("/guest/submit", { method: "POST", token: guestToken, body: { answers: { ...answers, 1: 1 } } });
assert(changed.response.status === 409, "a different payload cannot overwrite a final submission");
const secondSubmit = await call("/guest/submit", { method: "POST", token: secondJoin.data.token, body: { answers: { 1: 3, 2: 4, 3: 2, 4: 5, 5: 3 } } });
assert(secondSubmit.response.ok, "second participant submits a complete demo response");
const privateResult = await call("/guest/results", { token: guestToken });
assert(privateResult.response.ok && privateResult.data.visible === false, "guest result remains hidden before trainer reveal");

const presenterTokenResult = await call(`/owner/activities/${activityId}/presenter-token`, { method: "POST", cookie, body: {} });
assert(presenterTokenResult.response.ok && presenterTokenResult.data.path.startsWith("/presenter#"), "presenter capability stays in a URL fragment");
const presenterToken = presenterTokenResult.data.path.split("#")[1];
const waitingPresenter = await call("/presenter", { token: presenterToken });
assert(waitingPresenter.response.ok && waitingPresenter.data.revealed === false, "presenter output is blank until trainer reveal");

const ownerRead = await call(`/owner/activities/${activityId}`, { cookie });
assert(ownerRead.response.ok && ownerRead.data.participants.length === 2, "trainer sees this activity’s participants");
const publicOwnerRead = await call("/owner/sessions");
assert(publicOwnerRead.response.status === 401, "participant credentials cannot access owner session data");
const teamId = lookup.data.teams[0].id;
const revealed = await call(`/owner/activities/${activityId}/reveal`, { method: "POST", cookie, body: { revealed: true, comparisonBasis: "team_relative", selectedTeamId: teamId, showNames: false } });
assert(revealed.response.ok, "trainer controls reveal and comparison state");
const personal = await call("/guest/results", { token: guestToken });
assert(personal.response.ok && personal.data.visible === true && personal.data.demoOnly, "participant receives only their own result after reveal");
const publicAnonymous = await call("/presenter", { token: presenterToken });
assert(publicAnonymous.response.ok && publicAnonymous.data.rows.length === 2, "presenter receives revealed demo profiles");
assert(publicAnonymous.data.rows.every((row) => !["Private Person", "Opted In Person"].includes(row.label)), "presenter remains anonymous by default");

const namedReveal = await call(`/owner/activities/${activityId}/reveal`, { method: "POST", cookie, body: { revealed: true, comparisonBasis: "team_relative", selectedTeamId: teamId, showNames: true } });
assert(namedReveal.response.ok, "trainer can enable names only as an additional presentation choice");
const publicConsent = await call("/presenter", { token: presenterToken });
const labels = publicConsent.data.rows.map((row) => row.label);
assert(labels.includes("Opted In Person") && !labels.includes("Private Person"), "each participant’s name is independently gated by consent");
assert(publicConsent.data.warning, "small groups carry an explicit caution");

const closed = await call(`/owner/activities/${activityId}/close`, { method: "POST", cookie, body: {} });
assert(closed.response.ok && closed.data.state === "closed", "trainer can close responses");
const ownerSession = await call(`/owner/sessions/${sessionId}`, { cookie });
assert(ownerSession.response.ok && ownerSession.data.activities.length === 1 && ownerSession.data.teams.length === 2 && ownerSession.data.teams.reduce((sum, team) => sum + Number(team.participant_count), 0) === 2, "session detail lists its activities and privacy-safe team totals");

const missingScarfPolicy = await call("/owner/activities", { method: "POST", cookie, body: { sessionId, title: "SCARF missing release choice", toolId: "scarf-assessment", allowTeams: false, teamNames: [] } });
assert(missingScarfPolicy.response.status === 400, "SCARF creation requires the trainer to choose a personal-result release mode");
const scarfCreated = await call("/owner/activities", { method: "POST", cookie, body: { sessionId, title: "SCARF assessment smoke", toolId: "scarf-assessment", releaseMode: "trainer_released", requireName: false, allowTeams: true, teamNames: ["Small group", "Other group"] } });
assert(scarfCreated.response.status === 201 && scarfCreated.data.activity.demoOnly === false && scarfCreated.data.activity.scoringVersion === "1.1.0" && scarfCreated.data.activity.instrumentVersion === "0.2.0", "trainer creates a real experimental SCARF assessment pinned to scoring v1.1.0");
const scarfActivityId = scarfCreated.data.activity.id;
const scarfOpened = await call(`/owner/activities/${scarfActivityId}/open`, { method: "POST", cookie, body: {} });
assert(scarfOpened.response.ok, "trainer opens the SCARF activity and gets a join code");
const scarfPin = scarfOpened.data.pin;
const scarfLookup = await call("/join/lookup", { method: "POST", body: { pin: scarfPin }, ip: `scarf-lookup-${smokeRun}` });
assert(scarfLookup.response.ok && scarfLookup.data.activity.toolId === "scarf-assessment" && scarfLookup.data.activity.releaseMode === "trainer_released" && scarfLookup.data.activity.requireName, "join lookup safely identifies SCARF and enforces named participant results");
const scarfJoiners = [];
const scarfSessionTokens = [];
for (let index = 0; index < 5; index += 1) {
  const sessionToken = crypto.randomUUID().replaceAll("-", "").repeat(2);
  scarfSessionTokens.push(sessionToken);
  const joinedPerson = await call("/join/enter", { method: "POST", body: {
    pin: scarfPin, displayName: `SCARF Guest ${index + 1}`, teamId: scarfLookup.data.teams[index === 4 ? 1 : 0].id,
    consentNamedResults: false, sessionToken,
  }, ip: `scarf-guest-${index}-${smokeRun}` });
  assert([200, 201].includes(joinedPerson.response.status) && joinedPerson.data.token, `SCARF participant ${index + 1} receives a scoped guest token`);
  scarfJoiners.push(joinedPerson.data);
}
const scarfToken = scarfJoiners[0].token;
const initialScarf = await call("/guest/scarf/current", { token: scarfToken });
assert(initialScarf.response.ok && initialScarf.data.items.length === 30, "participant receives all 30 approved v0.2 question texts");
assert(initialScarf.data.items.every((item) => !Object.hasOwn(item, "domain") && !Object.hasOwn(item, "domain_options")), "participant payload hides scoring keys and domain assignments");
const invalidScarfAnswer = await call("/guest/scarf/answers/Q21", { method: "PUT", token: scarfToken, body: { generation: 1, revision: 1, answer: { A: 1, B: 1, C: 3 }, currentQuestion: 1 } });
assert(invalidScarfAnswer.response.status === 400, "invalid ranking ties are rejected by server validation");
for (let personIndex = 0; personIndex < scarfJoiners.length; personIndex += 1) {
  const guest = scarfJoiners[personIndex];
  const bank = (await call("/guest/scarf/current", { token: guest.token })).data.items;
  for (let index = 0; index < bank.length; index += 1) {
    const question = bank[index];
    const answer = question.type === "micro_reaction" ? (personIndex + index) % 10 + 1
      : question.type === "tradeoff" ? ["strong_A", "lean_A", "equal", "lean_B", "strong_B"][(personIndex + index) % 5]
        : { A: 1, B: 2, C: 3 };
    const savedAnswer = await call(`/guest/scarf/answers/${question.id}`, { method: "PUT", token: guest.token, body: { generation: 1, revision: 1, answer, currentQuestion: index + 1 } });
    assert(savedAnswer.response.ok, `SCARF question ${index + 1} autosaves for participant ${personIndex + 1} (HTTP ${savedAnswer.response.status}${savedAnswer.data.error ? `: ${savedAnswer.data.error}` : ""})`);
  }
}
const idempotencyKey = crypto.randomUUID();
for (let index = 0; index < scarfJoiners.length; index += 1) {
  const key = index === 0 ? idempotencyKey : crypto.randomUUID();
  const complete = await call("/guest/scarf/submit", { method: "POST", token: scarfJoiners[index].token, body: { generation: 1, idempotencyKey: key } });
  assert(complete.response.ok && complete.data.submitted, `participant ${index + 1} completes the 30-question SCARF assessment`);
}
const scarfRetry = await call("/guest/scarf/submit", { method: "POST", token: scarfToken, body: { generation: 1, idempotencyKey } });
assert(scarfRetry.response.ok && scarfRetry.data.alreadySubmitted, "SCARF submission retries are idempotent");
const hiddenScarfResult = await call("/guest/scarf/results", { token: scarfToken });
assert(hiddenScarfResult.response.status === 403 && hiddenScarfResult.data.code === "RESULTS_NOT_RELEASED", "participant cannot read results before trainer release");
const scarfOwner = await call(`/owner/activities/${scarfActivityId}`, { cookie });
assert(scarfOwner.response.ok && scarfOwner.data.counts.submitted === 5 && scarfOwner.data.participants.length === 5, "trainer sees named participant progress and completion status");
const scarfAnalytics = await call(`/owner/scarf/activities/${scarfActivityId}/analytics`, { cookie });
assert(scarfAnalytics.response.ok && scarfAnalytics.data.submitted.length === 5 && scarfAnalytics.data.means.reaction.S.mean !== null && scarfAnalytics.data.means.priority.S.mean !== null && scarfAnalytics.data.heatmap.classCount === 5 && scarfAnalytics.data.heatmap.participants.every((person) => person.needsIndex && person.needsRank), "trainer receives separate reaction/priority analytics and v1.1 integrated-needs heatmaps");
assert(scarfAnalytics.data.instrument.scoringVersion === "1.1.0" && scarfAnalytics.data.means.tradeoff.S.mean !== null && scarfAnalytics.data.means.ranking.S.mean !== null, "trainer analytics preserve trade-off and ranking sub-scores");
assert(scarfAnalytics.data.submitted[0].displayName.startsWith("SCARF Guest") && !Object.hasOwn(scarfAnalytics.data.submitted[0], "answers"), "trainer analytics are named but do not expose raw answer records");
const scarfPresenterTokenResult = await call(`/owner/activities/${scarfActivityId}/presenter-token`, { method: "POST", cookie, body: {} });
const scarfPresenterToken = scarfPresenterTokenResult.data.path.split("#")[1];
const hiddenScarfPresenter = await call("/presenter", { token: scarfPresenterToken });
assert(hiddenScarfPresenter.response.ok && hiddenScarfPresenter.data.kind === "scarf-aggregate" && hiddenScarfPresenter.data.revealed === false, "SCARF presenter remains blank before trainer release and reveal");
const releaseScarf = await call(`/owner/scarf/activities/${scarfActivityId}/release`, { method: "POST", cookie, body: {} });
assert(releaseScarf.response.ok && releaseScarf.data.released, "trainer releases personal results for the activity");
const privateScarfResult = await call("/guest/scarf/results", { token: scarfToken });
assert(privateScarfResult.response.ok && privateScarfResult.data.visible && privateScarfResult.data.reaction && privateScarfResult.data.priority && privateScarfResult.data.integratedNeedsIndex && privateScarfResult.data.integratedNeedsRank, "participant receives their integrated profile plus the two preserved measures after release");
const revealedScarf = await call(`/owner/activities/${scarfActivityId}/reveal`, { method: "POST", cookie, body: { revealed: true, scarfLayer: "priority", selectedTeamId: null } });
assert(revealedScarf.response.ok, "trainer configures the aggregate presenter layer");
const groupScarfPresenter = await call("/presenter", { token: scarfPresenterToken });
assert(groupScarfPresenter.response.ok && groupScarfPresenter.data.heatmap.count === 5 && groupScarfPresenter.data.heatmap.classMean && groupScarfPresenter.data.heatmap.teamBreakdownSuppressed, "presenter receives the safe aggregate profile while suppressing the four-person team breakdown");
assert(!Object.hasOwn(groupScarfPresenter.data, "rows") && !JSON.stringify(groupScarfPresenter.data).includes("SCARF Guest") && !JSON.stringify(groupScarfPresenter.data).includes(scarfJoiners[0].participant.id), "presenter payload contains no participant rows, identifiers, or names");
const selectedSmallGroup = await call(`/owner/activities/${scarfActivityId}/reveal`, { method: "POST", cookie, body: { revealed: true, scarfLayer: "priority", selectedTeamId: scarfLookup.data.teams[0].id } });
assert(selectedSmallGroup.response.ok, "trainer selects a team for aggregate presenter view");
const suppressedScarfPresenter = await call("/presenter", { token: scarfPresenterToken });
assert(suppressedScarfPresenter.response.ok && suppressedScarfPresenter.data.heatmap.count === 5 && suppressedScarfPresenter.data.heatmap.teams.length === 0 && suppressedScarfPresenter.data.heatmap.teamBreakdownSuppressed, "presenter retains the eligible whole-cohort aggregate and suppresses all teams when a team is under five");
const scarfSessionAnalytics = await call(`/owner/scarf/sessions/${sessionId}/analytics`, { cookie });
assert(scarfSessionAnalytics.response.ok && scarfSessionAnalytics.data.scope === "session" && scarfSessionAnalytics.data.counts.joined >= 5, "trainer can review session-scoped SCARF analytics");
const laterScarfActivity = await call("/owner/activities", { method: "POST", cookie, body: { sessionId, title: "SCARF latest response smoke", toolId: "scarf-assessment", releaseMode: "immediate", requireName: true, allowTeams: false, teamNames: [] } });
const laterActivityId = laterScarfActivity.data.activity.id;
const laterOpened = await call(`/owner/activities/${laterActivityId}/open`, { method: "POST", cookie, body: {} });
const returningJoin = await call("/join/enter", { method: "POST", body: { pin: laterOpened.data.pin, displayName: "SCARF Guest 1", sessionToken: scarfSessionTokens[0] }, ip: `scarf-returning-${smokeRun}` });
assert(returningJoin.response.status === 201 && returningJoin.data.participant.id !== scarfJoiners[0].participant.id, "a returning session participant gets a separate activity-scoped participant record");
const laterBank = (await call("/guest/scarf/current", { token: returningJoin.data.token })).data.items;
for (let index = 0; index < laterBank.length; index += 1) {
  const question = laterBank[index];
  const answer = question.type === "micro_reaction" ? 10
    : question.type === "tradeoff" ? "strong_B"
      : { A: 3, B: 2, C: 1 };
  const savedAnswer = await call(`/guest/scarf/answers/${question.id}`, { method: "PUT", token: returningJoin.data.token, body: { generation: 1, revision: 1, answer, currentQuestion: index + 1 } });
  assert(savedAnswer.response.ok, `returning participant’s newer activity saves question ${index + 1}`);
}
const laterSubmission = await call("/guest/scarf/submit", { method: "POST", token: returningJoin.data.token, body: { generation: 1, idempotencyKey: crypto.randomUUID() } });
assert(laterSubmission.response.ok, "returning participant completes a later activity in the same session");
const dedupedSession = await call(`/owner/scarf/sessions/${sessionId}/analytics`, { cookie });
assert(dedupedSession.response.ok && dedupedSession.data.counts.joined === 5 && dedupedSession.data.counts.completed === 5, `session analytics count the latest compatible submission once per participant identity (joined ${dedupedSession.data.counts.joined}, completed ${dedupedSession.data.counts.completed})`);
const sessionCsv = await call(`/owner/scarf/sessions/${sessionId}/export.csv`, { cookie });
assert(sessionCsv.response.ok && sessionCsv.response.headers.get("content-type")?.includes("text/csv") && sessionCsv.text.startsWith('"participant","team"'), "trainer can export session-scoped named scores as CSV");
const sessionPresenterState = await call(`/owner/scarf/sessions/${sessionId}/presenter-state`, { method: "POST", cookie, body: { revealed: true, teamName: null, layer: "reaction" } });
assert(sessionPresenterState.response.ok, "trainer can reveal the session-level aggregate presenter");
const sessionPresenterToken = await call(`/owner/scarf/sessions/${sessionId}/presenter-session`, { method: "POST", cookie });
const sessionPresenter = await call("/presenter", { token: sessionPresenterToken.data.path.split("#")[1] });
assert(sessionPresenter.response.ok && sessionPresenter.data.heatmap.count === 5 && sessionPresenter.data.heatmap.classMean, "session presenter displays a version-compatible latest-response aggregate");
assert(!Object.hasOwn(sessionPresenter.data, "rows") && !JSON.stringify(sessionPresenter.data).includes("SCARF Guest") && !JSON.stringify(sessionPresenter.data).includes(scarfJoiners[0].participant.id), "session presenter payload contains no names, identifiers, or response records");
const smallSessionGroup = await call(`/owner/scarf/sessions/${sessionId}/presenter-state`, { method: "POST", cookie, body: { revealed: true, teamName: "Small group", layer: "priority" } });
assert(smallSessionGroup.response.ok, "trainer can choose a session group for presentation");
const hiddenSessionTeam = await call("/presenter", { token: sessionPresenterToken.data.path.split("#")[1] });
assert(hiddenSessionTeam.response.ok && hiddenSessionTeam.data.heatmap.count === 5 && hiddenSessionTeam.data.heatmap.teams.length === 0 && hiddenSessionTeam.data.heatmap.teamBreakdownSuppressed, "session presenter suppresses small teams while retaining the eligible whole-cohort aggregate");
const resetScarf = await call(`/owner/scarf/activities/${scarfActivityId}/participants/${scarfJoiners[0].participant.id}/reset`, { method: "POST", cookie, body: { reason: "Smoke test reset" } });
assert(resetScarf.response.ok && resetScarf.data.generation === 2, "trainer reset clears the current generation and records a fresh attempt");
const staleGeneration = await call("/guest/scarf/answers/Q01", { method: "PUT", token: scarfToken, body: { generation: 1, revision: 2, answer: 5, currentQuestion: 1 } });
assert(staleGeneration.response.status === 409 && staleGeneration.data.code === "GENERATION_MISMATCH", "old participant links cannot write into a reset generation");

// Poll v1.2: exercise the real Worker/D1 routes, Session identity reuse,
// anonymous response separation, live vote updates and a 200-person cohort.
const pollConfigs = [
  { title: `Poll smoke ${smokeRun} A`, question: "What should we focus on?", questionType: "multiple", options: ["Clear priorities", "More focus time", "=Formula-safe label"], maxSelections: 2, allowOther: true, identityMode: "anonymous", participantResultsMode: "presenter_and_participant", sessionId },
  { title: `Poll smoke ${smokeRun} B`, question: "What should we improve?", questionType: "single", options: ["Communication", "Planning"], maxSelections: 1, allowOther: false, identityMode: "anonymous", participantResultsMode: "presenter_only", sessionId },
  { title: `Poll smoke ${smokeRun} C`, question: "What would help most?", questionType: "single", options: ["More clarity", "More time"], maxSelections: 1, allowOther: false, identityMode: "anonymous", participantResultsMode: "presenter_only", sessionId },
];
const pollRecords = [];
for (const config of pollConfigs) {
  const created = await call("/owner/polls", { method: "POST", cookie, body: config });
  assert(created.response.status === 201 && created.data.activityId, "trainer creates a Poll attached to the existing Session");
  if (pollRecords.length === 0) {
    const editedDraft = await call(`/owner/polls/${created.data.activityId}`, { method: "PATCH", cookie, body: { ...config, title: `${config.title} edited` } });
    assert(editedDraft.response.ok && editedDraft.data.updated, "trainer can edit Poll configuration while it is Draft");
  }
  const openedPoll = await call(`/owner/polls/${created.data.activityId}/open`, { method: "POST", cookie, body: {} });
  assert(openedPoll.response.ok && /^\d{6}$/.test(openedPoll.data.pin), "trainer opens a Poll and receives its six-digit PIN");
  const detail = await call(`/owner/polls/${created.data.activityId}`, { cookie });
  const publicPoll = await call(`/join/polls/${detail.data.poll.accessSlug}`);
  assert(publicPoll.response.ok && publicPoll.data.poll.sessionAccessSlug, "participant Poll link resolves with its shared Session entry link");
  const pollPinLookup = await call("/join/lookup", { method: "POST", body: { pin: openedPoll.data.pin }, ip: `poll-direct-pin-${pollRecords.length}-${smokeRun}` });
  assert(pollPinLookup.response.ok && pollPinLookup.data.activity.accessSlug === detail.data.poll.accessSlug, "direct Poll PIN resolves to its own participant link");
  pollRecords.push({ id: created.data.activityId, slug: detail.data.poll.accessSlug, pin: openedPoll.data.pin, detail: detail.data, public: publicPoll.data });
}
const sessionAccess = await call(`/owner/poll-sessions/${sessionId}/access`, { cookie });
assert(sessionAccess.response.ok && sessionAccess.data.path.startsWith("/session/"), "trainer can share one reusable Session entry link");
const sessionLookup = await call("/join/lookup", { method: "POST", body: { pin: sessionAccess.data.join_pin }, ip: `poll-session-pin-${smokeRun}` });
assert(sessionLookup.response.ok && sessionLookup.data.session.accessSlug === sessionAccess.data.path.split("/").at(-1), "six-digit Session PIN resolves to the Session Poll landing");
const sessionLanding = await call(`/join/poll-sessions/${sessionLookup.data.session.accessSlug}`);
assert(sessionLanding.response.ok && sessionLanding.data.polls.length === 3, "Session landing lists each currently Live Poll");

const pollParticipants = [];
const loadParticipantCount = 200;
for (let index = 0; index < loadParticipantCount; index += 1) {
  const identity = await call(`/join/poll-sessions/${sessionAccess.data.path.split("/").at(-1)}/identity`, {
    method: "POST", body: { displayName: `Poll Load ${String(index + 1).padStart(3, "0")}`, role: "Synthetic load test" }, ip: `poll-identity-${index}-${smokeRun}`,
  });
  assert(identity.response.status === 201 && identity.data.sessionToken, `Session participant ${index + 1} receives a temporary identity (HTTP ${identity.response.status}: ${identity.data.error ?? "no response detail"})`);
  const pollIndex = index % pollRecords.length;
  const pollRecord = pollRecords[pollIndex];
  const entered = await call(`/join/polls/${pollRecord.slug}/enter`, { method: "POST", body: { sessionToken: identity.data.sessionToken }, ip: `poll-entry-${index}-${smokeRun}` });
  assert([200, 201].includes(entered.response.status) && entered.data.token, `Session identity reuses its name for Poll ${pollIndex + 1}`);
  pollParticipants.push({ token: entered.data.token, pollIndex, identity: identity.data });
}
const pollVotes = await Promise.all(pollParticipants.map((participant, index) => {
  const pollRecord = pollRecords[participant.pollIndex];
  const options = pollRecord.public.options;
  const option = options[index % 2];
  const selections = [{ optionId: option.id }];
  return call("/guest/poll/response", { method: "POST", token: participant.token,
    body: { selections, idempotencyKey: crypto.randomUUID() }, ip: `poll-vote-${index}-${smokeRun}` });
}));
assert(pollVotes.every((result) => result.response.ok && result.data.submitted), "200 nearly simultaneous votes save across three Live Polls in one Session");
for (let index = 0; index < pollRecords.length; index += 1) {
  const pollRecord = pollRecords[index];
  const ownerResults = await call(`/owner/polls/${pollRecord.id}`, { cookie });
  const expected = pollParticipants.filter((participant) => participant.pollIndex === index).length;
  assert(ownerResults.response.ok && ownerResults.data.counts.respondents === expected, `Poll ${index + 1} counts the correct respondents after concurrent voting`);
  assert(ownerResults.data.namedResponses.length === 0 && ownerResults.data.participants.every((person) => person.status === "submitted"), `anonymous Poll ${index + 1} keeps names separate from answers while showing completion`);
}

const pollZero = pollRecords[0];
const pollZeroParticipants = pollParticipants.filter((participant) => participant.pollIndex === 0);
const pollZeroCurrent = await call("/guest/poll/current", { token: pollZeroParticipants[0].token });
const otherOption = pollZeroCurrent.data.options.find((option) => option.isOther);
const choiceA = pollZeroCurrent.data.options[0];
const choiceB = pollZeroCurrent.data.options[1];
assert(pollZeroCurrent.response.ok && otherOption, "participant receives the multiple-choice Poll and optional Other answer");
const emptyOther = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: { selections: [{ optionId: otherOption.id }], idempotencyKey: crypto.randomUUID() } });
assert(emptyOther.response.status === 400, "Other selection requires a non-empty response");
const editedKey = crypto.randomUUID();
const editBody = { selections: [{ optionId: choiceA.id }, { optionId: otherOption.id, otherText: "Useful detail from the participant" }], idempotencyKey: editedKey };
const editedVote = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: editBody, ip: `poll-edit-${smokeRun}` });
assert(editedVote.response.ok && editedVote.data.submitted, "participant can revise a Live vote and add Other text");
const retryVote = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: editBody, ip: `poll-retry-${smokeRun}` });
assert(retryVote.response.ok && retryVote.data.alreadySubmitted, "same Poll vote retry is idempotent");
const conflictingRetry = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: { ...editBody, selections: [{ optionId: choiceB.id }] } });
assert(conflictingRetry.response.status === 409 && conflictingRetry.data.code === "IDEMPOTENCY_CONFLICT", "an idempotency key cannot be reused for a different answer");
const oversizeOther = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: { selections: [{ optionId: otherOption.id, otherText: "x".repeat(151) }], idempotencyKey: crypto.randomUUID() } });
assert(oversizeOther.response.status === 400, "Other text longer than 150 characters is rejected");
const hiddenPollResult = await call("/guest/poll/results", { token: pollZeroParticipants[0].token });
assert(hiddenPollResult.response.ok && hiddenPollResult.data.visible === false, "participant cannot see Poll results before Reveal");
const revealPoll = await call(`/owner/polls/${pollZero.id}/reveal`, { method: "POST", cookie, body: { revealed: true } });
assert(revealPoll.response.ok, "trainer reveals results for the cohort");
const shownPollResult = await call("/guest/poll/results", { token: pollZeroParticipants[0].token });
assert(shownPollResult.response.ok && shownPollResult.data.visible && shownPollResult.data.respondentCount === pollZeroParticipants.length, "participants receive aggregate results after Reveal when enabled");
const presenterAccess = await call(`/owner/activities/${pollZero.id}/presenter-token`, { method: "POST", cookie, body: {} });
const pollPresenter = await call("/presenter", { token: presenterAccess.data.path.split("#")[1] });
assert(pollPresenter.response.ok && pollPresenter.data.kind === "poll" && pollPresenter.data.revealed, "Presenter Mode shows the revealed Poll aggregate");
assert(!Object.hasOwn(pollPresenter.data, "rows") && !JSON.stringify(pollPresenter.data).includes("Poll Load"), "Presenter payload contains no participant names or response rows");
const hideParticipantResults = await call(`/owner/polls/${pollZero.id}/reveal`, { method: "POST", cookie, body: { revealed: true, participantResultsMode: "presenter_only" } });
const hiddenAgain = await call("/guest/poll/results", { token: pollZeroParticipants[0].token });
assert(hideParticipantResults.response.ok && hiddenAgain.data.visible === false, "trainer can hide participant results independently of Presenter reveal state");
const anonymousNamedExport = await call(`/owner/polls/${pollZero.id}/export?kind=named`, { cookie });
assert(anonymousNamedExport.response.status === 403, "anonymous Poll cannot export named responses");
const summaryExport = await call(`/owner/polls/${pollZero.id}/export?kind=summary`, { cookie });
assert(summaryExport.response.ok && summaryExport.bytes[0] === 0xef && summaryExport.bytes[1] === 0xbb && summaryExport.bytes[2] === 0xbf && summaryExport.text.includes("'=Formula-safe label"), "summary CSV has a UTF-8 BOM and neutralizes spreadsheet formulas");
const stablePin = pollZero.pin;
const closedPoll = await call(`/owner/polls/${pollZero.id}/close`, { method: "POST", cookie, body: {} });
const closedVote = await call("/guest/poll/response", { method: "POST", token: pollZeroParticipants[0].token, body: { selections: [{ optionId: choiceB.id }], idempotencyKey: crypto.randomUUID() } });
assert(closedPoll.response.ok && closedVote.response.status === 409, "closed Poll rejects changes to a saved vote");
const reopenedPoll = await call(`/owner/polls/${pollZero.id}/reopen`, { method: "POST", cookie, body: {} });
const afterReopen = await call(`/owner/polls/${pollZero.id}`, { cookie });
assert(reopenedPoll.response.ok && afterReopen.data.poll.joinPin === stablePin && afterReopen.data.poll.accessSlug === pollZero.slug && afterReopen.data.counts.respondents === pollZeroParticipants.length, "reopening preserves the Poll code, URL and all responses");
const duplicatedPoll = await call(`/owner/polls/${pollZero.id}/duplicate`, { method: "POST", cookie, body: {} });
const duplicateDetail = await call(`/owner/polls/${duplicatedPoll.data.activityId}`, { cookie });
assert(duplicatedPoll.response.status === 201 && duplicateDetail.data.poll.state === "draft" && duplicateDetail.data.counts.respondents === 0 && duplicateDetail.data.poll.joinPin === null, "duplicate creates a clean Draft without votes or a join PIN");
const invalidPresenterMode = await call(`/owner/polls/${pollRecords[1].id}/reveal`, { method: "POST", cookie, body: { revealed: true, participantResultsMode: "everybody" } });
assert(invalidPresenterMode.response.status === 400, "invalid participant visibility settings are rejected");
const namedPollCreated = await call("/owner/polls", { method: "POST", cookie, body: { title: `Named Poll smoke ${smokeRun}`, question: "Which option should we pick?", questionType: "single", options: ["Option one", "Option two"], maxSelections: 1, allowOther: false, identityMode: "named", participantResultsMode: "presenter_only", sessionId: null } });
const namedPollId = namedPollCreated.data.activityId;
await call(`/owner/polls/${namedPollId}/open`, { method: "POST", cookie, body: {} });
const namedPollMeta = await call(`/owner/polls/${namedPollId}`, { cookie });
const namedPollEntry = await call(`/join/polls/${namedPollMeta.data.poll.accessSlug}/enter`, { method: "POST", body: { displayName: "Named Poll QA guest", role: "Facilitator" }, ip: `named-poll-entry-${smokeRun}` });
const namedPollVote = await call("/guest/poll/response", { method: "POST", token: namedPollEntry.data.token, body: { selections: [{ optionId: namedPollMeta.data.options[0].id }], idempotencyKey: crypto.randomUUID() }, ip: `named-poll-vote-${smokeRun}` });
const namedPollOwner = await call(`/owner/polls/${namedPollId}`, { cookie });
assert(namedPollCreated.response.status === 201 && namedPollVote.response.ok && namedPollOwner.data.namedResponses.length === 1 && namedPollOwner.data.namedResponses[0].displayName === "Named Poll QA guest", "Named Poll saves a participant-linked response for the owner");
const namedPollCsv = await call(`/owner/polls/${namedPollId}/export?kind=named`, { cookie });
assert(namedPollCsv.response.ok && namedPollCsv.text.includes("Named Poll QA guest"), "Named Poll permits its trainer-only named-response export");
await call(`/owner/polls/${namedPollId}/reveal`, { method: "POST", cookie, body: { revealed: true } });
const namedPresenterToken = await call(`/owner/activities/${namedPollId}/presenter-token`, { method: "POST", cookie, body: {} });
const namedPresenterPayload = await call("/presenter", { token: namedPresenterToken.data.path.split("#")[1] });
assert(namedPresenterPayload.response.ok && namedPresenterPayload.data.revealed && !JSON.stringify(namedPresenterPayload.data).includes("Named Poll QA guest"), "Named Poll Presenter still exposes aggregate results only");
await call(`/owner/polls/${namedPollId}`, { method: "DELETE", cookie });
for (const pollRecord of pollRecords) await call(`/owner/polls/${pollRecord.id}`, { method: "DELETE", cookie });
await call(`/owner/polls/${duplicatedPoll.data.activityId}`, { method: "DELETE", cookie });
const loadIdentityCleanup = await execFileAsync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "trainerpopp-kit", "--local", "--command",
  `DELETE FROM session_participant_identities WHERE session_id = '${sessionId}' AND display_name GLOB 'Poll Load [0-9][0-9][0-9]' AND created_at >= datetime('now', '-15 minutes'); SELECT changes() AS deleted;`]);
assert(loadIdentityCleanup.stdout.includes('"deleted": 200'), "local Poll load-test identity fixtures are removed after verification");

// Word Cloud v1.0: native activity lifecycle, session/team context, anonymous
// storage boundaries, participant flow, moderation, exports and Presenter.
const cloudCreated = await call("/owner/wordclouds", { method: "POST", cookie, body: {
  sessionId, title: `Word Cloud smoke ${smokeRun}`, prompt: "What helps this team thrive?", maxWords: 3, teamNames: [], saveAsDraft: true,
} });
assert(cloudCreated.response.status === 201 && cloudCreated.data.phase === "DRAFT", "trainer creates a Session-linked Word Cloud draft");
const cloudId = cloudCreated.data.activityId;
const cloudDraft = await call(`/owner/wordclouds/${cloudId}`, { cookie });
assert(cloudDraft.response.ok && cloudDraft.data.wordCloud.phase === "DRAFT" && cloudDraft.data.wordCloud.visibility === "HIDDEN", "new Word Cloud starts hidden with an independent lifecycle");
const cloudEdited = await call(`/owner/wordclouds/${cloudId}`, { method: "PATCH", cookie, body: {
  title: `Word Cloud smoke ${smokeRun}`, prompt: "What helps this team thrive?", maxWords: 3, sessionId, teamNames: [], expectedRevision: cloudDraft.data.wordCloud.revision,
} });
assert(cloudEdited.response.ok, "trainer can edit the configuration before the first open");
const staleCloudEdit = await call(`/owner/wordclouds/${cloudId}`, { method: "PATCH", cookie, body: {
  title: `Stale Word Cloud ${smokeRun}`, prompt: "Stale", maxWords: 2, sessionId, teamNames: [], expectedRevision: cloudDraft.data.wordCloud.revision,
} });
const editedCloud = await call(`/owner/wordclouds/${cloudId}`, { cookie });
assert(staleCloudEdit.response.status === 409 && editedCloud.data.wordCloud.title === cloudDraft.data.wordCloud.title, "stale Word Cloud edits return a conflict without partially changing the activity");
const cloudPublished = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "PUBLISH", expectedRevision: editedCloud.data.wordCloud.revision } });
assert(cloudPublished.response.ok && cloudPublished.data.wordCloud.phase === "READY" && /^\d{6}$/.test(cloudPublished.data.wordCloud.joinPin), "publishing a draft creates its six-digit join code");
let cloud = cloudPublished.data;
const cloudPin = cloud.wordCloud.joinPin;
const cloudLookup = await call("/join/lookup", { method: "POST", body: { pin: cloudPin, sessionToken: scarfSessionTokens[0] }, ip: `wordcloud-lookup-${smokeRun}` });
assert(cloudLookup.response.ok && cloudLookup.data.activity.toolId === "wordcloud" && cloudLookup.data.preselectedTeamId, "Session join restores a participant’s existing team choice without requesting their name");
assert(cloudLookup.data.teams.some((team) => team.id === cloudLookup.data.preselectedTeamId), "preselected Session team maps to this activity’s team snapshot");
const cloudJoinA = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "", teamId: cloudLookup.data.preselectedTeamId, sessionToken: scarfSessionTokens[0] }, ip: `wordcloud-join-a-${smokeRun}` });
assert(cloudJoinA.response.status === 201 && cloudJoinA.data.token, "Word Cloud participants can join with no name");
const cloudJoinB = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "", teamId: cloudLookup.data.teams.find((team) => team.id !== cloudLookup.data.preselectedTeamId)?.id ?? null }, ip: `wordcloud-join-b-${smokeRun}` });
assert(cloudJoinB.response.status === 201 && cloudJoinB.data.token, "second participant can join anonymously and select a team");
let cloudState = await call("/guest/wordcloud/state", { token: cloudJoinA.data.token });
assert(cloudState.response.ok && cloudState.data.state === "WAITING" && !JSON.stringify(cloudState.data).toLowerCase().includes("cloudtop"), "participants see Waiting without access to aggregate words");
const blockedCloudSubmit = await call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinA.data.token, body: { words: ["not open"], idempotencyKey: crypto.randomUUID() } });
assert(blockedCloudSubmit.response.status === 409, "Word Cloud rejects submissions until the trainer opens it");
const cloudOpened = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "OPEN", expectedRevision: cloud.wordCloud.revision } });
assert(cloudOpened.response.ok && cloudOpened.data.wordCloud.phase === "OPEN", "trainer opens the Word Cloud intake");
const duplicateCloudWords = await call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinA.data.token, body: { words: ["  Tin  tưởng ", "TIN TƯỞNG"], idempotencyKey: crypto.randomUUID() } });
assert(duplicateCloudWords.response.status === 422 && duplicateCloudWords.data.code === "DUPLICATE_WORD", "server rejects duplicate phrases after Unicode and whitespace normalization");
const cloudWordsA = ["  Tin  tưởng ", "Hợp tác", "=SUM(A1)"];
const concurrentCloudKey = crypto.randomUUID();
const concurrentCloudSubmits = await Promise.all(Array.from({ length: 2 }, () => call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinA.data.token, body: { words: cloudWordsA, idempotencyKey: concurrentCloudKey }, ip: `wordcloud-submit-a-${smokeRun}` })));
assert(concurrentCloudSubmits.every((result) => result.response.ok) && concurrentCloudSubmits.some((result) => result.data.status === "SUBMITTED") && concurrentCloudSubmits.some((result) => result.data.status === "ALREADY_SUBMITTED"), "two concurrent retries from one access submit at most once");
const cloudJoinC = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "", teamId: null }, ip: `wordcloud-join-c-${smokeRun}` });
assert(cloudJoinC.response.status === 201, "third anonymous participant can join the open Word Cloud");
const cloudSubmitB = await call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinB.data.token, body: { words: ["TIN TƯỞNG", "tin cậy"], idempotencyKey: crypto.randomUUID() }, ip: `wordcloud-submit-b-${smokeRun}` });
const cloudSubmitC = await call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinC.data.token, body: { words: ["Celebration"], idempotencyKey: crypto.randomUUID() }, ip: `wordcloud-submit-c-${smokeRun}` });
assert(cloudSubmitB.response.ok && cloudSubmitB.data.status === "SUBMITTED" && cloudSubmitC.response.ok, "participant submissions are accepted atomically");
const cloudJoinD = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "", teamId: null }, ip: `wordcloud-join-d-${smokeRun}` });
assert(cloudJoinD.response.status === 201, "an additional participant can wait while intake is still open");
const cloudOwner = await call(`/owner/wordclouds/${cloudId}`, { cookie });
assert(cloudOwner.response.ok && cloudOwner.data.counts.submitted === 3 && !Object.hasOwn(cloudOwner.data, "participants") && !JSON.stringify(cloudOwner.data).includes("Guest "), "trainer analytics return aggregate totals without participant names or rows");
const cloudGenericOwner = await call(`/owner/activities/${cloudId}`, { cookie });
assert(cloudGenericOwner.response.ok && !Object.hasOwn(cloudGenericOwner.data, "participants") && !JSON.stringify(cloudGenericOwner.data).includes("Guest "), "generic trainer activity API cannot expose Word Cloud participant mappings");
const trustTerm = cloudOwner.data.aggregate.visibleTerms.find((term) => term.label === "Tin tưởng");
const confidenceTerm = cloudOwner.data.aggregate.visibleTerms.find((term) => term.label === "tin cậy");
assert(trustTerm?.frequency === 2 && confidenceTerm?.frequency === 1, "raw term frequencies count distinct submitters");
const cloudTeamFilter = await call(`/owner/wordclouds/${cloudId}/team-filter`, { method: "POST", cookie, body: { teamId: cloudLookup.data.preselectedTeamId, expectedRevision: cloudOwner.data.wordCloud.revision } });
assert(cloudTeamFilter.response.ok && cloudTeamFilter.data.aggregate.denominator === 1, "team filter uses the submission-time team snapshot");
cloud = await call(`/owner/wordclouds/${cloudId}`, { cookie }).then((result) => result.data);
const cloudAllTeams = await call(`/owner/wordclouds/${cloudId}/team-filter`, { method: "POST", cookie, body: { teamId: null, expectedRevision: cloud.wordCloud.revision } });
assert(cloudAllTeams.response.ok && cloudAllTeams.data.aggregate.denominator === 3, "trainer can return from team scope to the full cohort");
cloud = cloudAllTeams.data;
const cloudModerateMerge = await call(`/owner/wordclouds/${cloudId}/moderate`, { method: "POST", cookie, body: {
  action: "MERGE", sourceGroupIds: [confidenceTerm.groupId], destinationGroupId: trustTerm.groupId, destinationLabel: "Trust cluster", expectedRevision: cloud.wordCloud.revision,
} });
assert(cloudModerateMerge.response.ok && cloudModerateMerge.data.aggregate.visibleTerms.find((term) => term.groupId === trustTerm.groupId)?.frequency === 2, "merge counts the union of distinct submitters instead of summing term totals");
cloud = cloudModerateMerge.data;
const cloudHide = await call(`/owner/wordclouds/${cloudId}/moderate`, { method: "POST", cookie, body: { action: "HIDE", groupId: trustTerm.groupId, expectedRevision: cloud.wordCloud.revision } });
assert(cloudHide.response.ok && cloudHide.data.aggregate.hiddenTerms.some((term) => term.groupId === trustTerm.groupId) && !cloudHide.data.aggregate.visibleTerms.some((term) => term.groupId === trustTerm.groupId), "hidden merged words leave the visible cloud but remain in trainer moderation");
cloud = cloudHide.data;
const cloudUnmerge = await call(`/owner/wordclouds/${cloudId}/moderate`, { method: "POST", cookie, body: { action: "UNMERGE", operationId: cloud.mergeHistory[0].operationId, expectedRevision: cloud.wordCloud.revision } });
assert(cloudUnmerge.response.ok && cloudUnmerge.data.aggregate.hiddenTerms.length === 2, "unmerging restores source words and keeps a hidden merged group hidden");
cloud = cloudUnmerge.data;
const cloudPresenterToken = await call(`/owner/activities/${cloudId}/presenter-token`, { method: "POST", cookie, body: {} });
const hiddenCloudPresenter = await call("/presenter", { token: cloudPresenterToken.data.path.split("#")[1] });
assert(hiddenCloudPresenter.response.ok && hiddenCloudPresenter.data.kind === "wordcloud" && !Object.hasOwn(hiddenCloudPresenter.data, "cloudTop50"), "hidden Word Cloud Presenter receives no aggregate cloud payload");
const cloudReveal = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "LIVE_REVEAL", expectedRevision: cloud.wordCloud.revision } });
assert(cloudReveal.response.ok, "trainer can reveal Presenter independently of the open/closed lifecycle");
cloud = cloudReveal.data;
const visibleCloudPresenter = await call("/presenter", { token: cloudPresenterToken.data.path.split("#")[1] });
assert(visibleCloudPresenter.response.ok && visibleCloudPresenter.data.cloudTop50 && !JSON.stringify(visibleCloudPresenter.data).includes("Guest "), "revealed Presenter receives aggregate-only words and no participant identities");
const cloudCsv = await call(`/owner/wordclouds/${cloudId}/export?format=csv`, { cookie });
assert(cloudCsv.response.ok && cloudCsv.bytes[0] === 0xef && cloudCsv.text.includes("'=SUM(A1)") && !cloudCsv.text.includes("Guest "), "CSV export is aggregate-only, UTF-8 BOM encoded and formula-safe");
const cloudClosed = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "CLOSE", expectedRevision: cloud.wordCloud.revision } });
assert(cloudClosed.response.ok && cloudClosed.data.wordCloud.phase === "CLOSED", "closing intake preserves the submitted aggregate");
cloudState = await call("/guest/wordcloud/state", { token: cloudJoinD.data.token });
assert(cloudState.response.ok && cloudState.data.state === "CLOSED", "unsubmitted participants see the Closed state");
const cloudReopened = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "REOPEN", expectedRevision: cloudClosed.data.wordCloud.revision } });
assert(cloudReopened.response.ok && cloudReopened.data.wordCloud.phase === "OPEN", "trainer may reopen before archive");
const cloudDSubmit = await call("/guest/wordcloud/submit", { method: "POST", token: cloudJoinD.data.token, body: { words: ["Celebration"], idempotencyKey: crypto.randomUUID() }, ip: `wordcloud-submit-d-${smokeRun}` });
assert(cloudDSubmit.response.ok && cloudDSubmit.data.status === "SUBMITTED", "a participant who was still waiting can submit after reopen");
const cloudRaceJoin = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "" }, ip: `wordcloud-close-race-join-${smokeRun}` });
assert(cloudRaceJoin.response.status === 201, "participant can join before the close race");
cloud = await call(`/owner/wordclouds/${cloudId}`, { cookie }).then((result) => result.data);
const [cloudRaceSubmit, cloudRaceClose] = await Promise.all([
  call("/guest/wordcloud/submit", { method: "POST", token: cloudRaceJoin.data.token, body: { words: ["Race safe"], idempotencyKey: crypto.randomUUID() }, ip: `wordcloud-close-race-submit-${smokeRun}` }),
  call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "CLOSE", expectedRevision: cloud.wordCloud.revision } }),
]);
assert(cloudRaceSubmit.response.ok || cloudRaceSubmit.response.status === 409, "concurrent submit and Close resolve to a complete accept or closed rejection");
assert(cloudRaceClose.response.ok || cloudRaceClose.response.status === 409, "concurrent Close either commits or returns a revision conflict");
cloud = await call(`/owner/wordclouds/${cloudId}`, { cookie }).then((result) => result.data);
if (cloud.wordCloud.phase === "OPEN") {
  const retryClose = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "CLOSE", expectedRevision: cloud.wordCloud.revision } });
  assert(retryClose.response.ok && retryClose.data.wordCloud.phase === "CLOSED", "trainer can close after resolving a concurrent submission revision");
  cloud = retryClose.data;
}
assert(cloud.wordCloud.phase === "CLOSED", "close race leaves the activity closed");
const cloudRaceState = await call("/guest/wordcloud/state", { token: cloudRaceJoin.data.token });
assert(cloudRaceSubmit.response.ok ? cloudRaceState.data.state === "ALREADY_SUBMITTED" : cloudRaceState.data.state === "CLOSED", "close race leaves either one complete submission or no submission");
const cloudRaceReopen = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "REOPEN", expectedRevision: cloud.wordCloud.revision } });
assert(cloudRaceReopen.response.ok && cloudRaceReopen.data.wordCloud.phase === "OPEN", "trainer can reopen after verifying the submission/Close boundary");
const wordCloudLoadCount = 200;
const cloudLoadParticipants = [];
for (let index = 0; index < wordCloudLoadCount; index += 1) {
  const joined = await call("/join/enter", { method: "POST", body: { pin: cloudPin, displayName: "" }, ip: `wordcloud-load-join-${index}-${smokeRun}` });
  assert(joined.response.status === 201 && joined.data.token, `Word Cloud load participant ${index + 1} joins anonymously`);
  cloudLoadParticipants.push(joined.data.token);
}
const wordCloudLoadVotes = await Promise.all(cloudLoadParticipants.map((token, index) => call("/guest/wordcloud/submit", {
  method: "POST", token, body: { words: [index % 2 ? "Word Cloud load B" : "Word Cloud load A"], idempotencyKey: crypto.randomUUID() }, ip: `wordcloud-load-submit-${index}-${smokeRun}`,
})));
assert(wordCloudLoadVotes.every((result) => result.response.ok && result.data.status === "SUBMITTED"), "200 near-simultaneous anonymous Word Cloud submissions commit exactly once each");
const wordCloudLoadResults = await call(`/owner/wordclouds/${cloudId}`, { cookie });
const wordCloudLoadA = wordCloudLoadResults.data.aggregate.visibleTerms.find((term) => term.label === "Word Cloud load A");
const wordCloudLoadB = wordCloudLoadResults.data.aggregate.visibleTerms.find((term) => term.label === "Word Cloud load B");
assert(wordCloudLoadResults.response.ok && wordCloudLoadResults.data.counts.submitted === 204 + (cloudRaceSubmit.response.ok ? 1 : 0)
  && wordCloudLoadA?.frequency === 100 && wordCloudLoadB?.frequency === 100, "200-person Word Cloud load keeps cohort count and unique-term frequencies correct");
const cloudDeleteOpen = await call(`/owner/wordclouds/${cloudId}`, { method: "DELETE", cookie });
assert(cloudDeleteOpen.response.status === 409, "open Word Cloud cannot be deleted");
const cloudLatest = await call(`/owner/wordclouds/${cloudId}`, { cookie });
const cloudClosedAgain = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "CLOSE", expectedRevision: cloudLatest.data.wordCloud.revision } });
const cloudArchived = await call(`/owner/wordclouds/${cloudId}/transition`, { method: "POST", cookie, body: { action: "FINALIZE_ARCHIVE", expectedRevision: cloudClosedAgain.data.wordCloud.revision } });
assert(cloudArchived.response.ok && cloudArchived.data.wordCloud.phase === "ARCHIVED", "only a Closed Word Cloud can be finalized to the read-only archive");
const archivedModeration = await call(`/owner/wordclouds/${cloudId}/moderate`, { method: "POST", cookie, body: { action: "RESTORE", groupId: "missing", expectedRevision: cloudArchived.data.wordCloud.revision } });
assert(archivedModeration.response.status === 400, "archived Word Cloud moderation remains read-only");
const cloudDuplicate = await call(`/owner/wordclouds/${cloudId}/duplicate`, { method: "POST", cookie, body: {} });
const cleanDuplicate = await call(`/owner/wordclouds/${cloudDuplicate.data.activityId}`, { cookie });
assert(cloudDuplicate.response.status === 201 && cleanDuplicate.data.wordCloud.phase === "DRAFT" && cleanDuplicate.data.counts.submitted === 0 && cleanDuplicate.data.wordCloud.joinPin === null, "duplicate creates a clean Draft with no responses or participant code");
await call(`/owner/wordclouds/${cloudId}`, { method: "DELETE", cookie });
await call(`/owner/wordclouds/${cloudDuplicate.data.activityId}`, { method: "DELETE", cookie });

// Reflection Wall v1.0: private actor capabilities, live Post-its, flat
// comments, idempotent reactions, reversible clustering and Presenter views.
const reflectionCreated = await call("/owner/reflection-walls", { method: "POST", cookie, body: {
  title: `Reflection smoke ${smokeRun}`, description: "Local API coverage", identityMode: "anonymous", postLimit: 2, sessionId,
  columns: [{ title: "Notice", question: "What stood out?" }, { title: "Apply", question: "What will you try?" }],
} });
assert(reflectionCreated.response.status === 201, "trainer creates an anonymous Reflection Wall with two columns");
const reflectionId = reflectionCreated.data.activityId;
const reflectionEdit = await call(`/owner/reflection-walls/${reflectionId}`, { method: "PATCH", cookie, body: {
  title: `Reflection smoke ${smokeRun}`, description: "Edited before opening", identityMode: "anonymous", postLimit: 2,
  columns: [{ title: "Notice", question: "What stood out?" }, { title: "Apply", question: "What will you try?" }],
} });
assert(reflectionEdit.response.ok && reflectionEdit.data.saved, "trainer can edit a Draft before opening it");
const reflectionOpen = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "OPEN" } });
assert(reflectionOpen.response.ok && reflectionOpen.data.phase === "OPEN" && /^\d{6}$/.test(reflectionOpen.data.joinPin), "trainer opens Reflection Wall and receives a six-digit code");
const editOpenBeforeContent = await call(`/owner/reflection-walls/${reflectionId}`, { method: "PATCH", cookie, body: {
  title: `Reflection smoke ${smokeRun}`, description: "Edited before opening", identityMode: "anonymous", postLimit: 2,
  columns: [{ title: "Notice", question: "What stood out before anyone posts?" }, { title: "Apply", question: "What will you try?" }],
} });
const restorePromptBeforeContent = await call(`/owner/reflection-walls/${reflectionId}`, { method: "PATCH", cookie, body: {
  title: `Reflection smoke ${smokeRun}`, description: "Edited before opening", identityMode: "anonymous", postLimit: 2,
  columns: [{ title: "Notice", question: "What stood out?" }, { title: "Apply", question: "What will you try?" }],
} });
assert(editOpenBeforeContent.response.ok && restorePromptBeforeContent.response.ok, "trainer can adjust column questions after opening but before the first Post-it");
const reflection = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
let reflectionSlug = reflection.data.sharePath.split("/").at(-1);
assert(reflection.response.ok && reflection.data.columns.length === 2 && reflection.data.viewer.canWrite === false, "trainer receives column setup and owner controls");
const reflectionLookup = await call("/join/lookup", { method: "POST", body: { pin: reflection.data.activity.joinPin }, ip: `reflection-lookup-${smokeRun}` });
assert(reflectionLookup.response.ok && reflectionLookup.data.activity.toolId === "reflection-wall" && reflectionLookup.data.activity.accessSlug === reflectionSlug, "six-digit join code resolves only to safe Reflection Wall entry details");
const reflectionLegacyJoin = await call("/join/enter", { method: "POST", body: { pin: reflection.data.activity.joinPin, displayName: "Not persisted" }, ip: `reflection-legacy-join-${smokeRun}` });
assert(reflectionLegacyJoin.response.status === 400, "Reflection Wall joins through its scoped anonymous capability, not shared participant identity");
let reflectionUrl = `/guest/reflection-walls/${reflectionSlug}`;
const reflectionEventsInitial = await call(`${reflectionUrl}/events?cursor=0`);
assert(reflectionEventsInitial.response.ok && reflectionEventsInitial.data.cursor > 0, "event cursor is available to anonymous wall viewers");
const actorOne = await call(`${reflectionUrl}/actor`, { method: "POST", body: { displayName: "Private anonymous actor" }, ip: `reflection-actor-one-${smokeRun}` });
const actorTwo = await call(`${reflectionUrl}/actor`, { method: "POST", body: {}, ip: `reflection-actor-two-${smokeRun}` });
assert(actorOne.response.status === 201 && actorOne.data.token && actorTwo.response.status === 201, "participants receive wall-scoped temporary capabilities");
const reflectionGuest = await call(reflectionUrl, { token: actorOne.data.token });
assert(reflectionGuest.response.ok && reflectionGuest.data.viewer.canWrite && !JSON.stringify(reflectionGuest.data).includes("Private anonymous actor")
  && !JSON.stringify(reflectionGuest.data).includes("actorId"), "anonymous participant snapshot contains no identity or actor identifier");
const postKey = crypto.randomUUID();
const simultaneousPostRetries = await Promise.all(Array.from({ length: 2 }, () => call(`${reflectionUrl}/posts`, { method: "POST", token: actorOne.data.token, body: { columnId: reflection.data.columns[0].id, body: "A bright moment", idempotencyKey: postKey }, ip: `reflection-post-${smokeRun}` })));
const postOne = simultaneousPostRetries.find((result) => result.response.status === 201) ?? simultaneousPostRetries[0];
const postRetry = simultaneousPostRetries.find((result) => result.response.status === 200) ?? simultaneousPostRetries[1];
assert(postOne.response.status === 201 && postRetry.response.ok && postRetry.data.alreadySaved && postRetry.data.postId === postOne.data.postId, "Post-it retry is idempotent and does not consume another quota slot");
const changedColumnAfterPublish = await call(`/owner/reflection-walls/${reflectionId}`, { method: "PATCH", cookie, body: {
  title: `Reflection smoke ${smokeRun}`, description: "Edited before opening", identityMode: "anonymous", postLimit: 2,
  columns: [{ title: "Changed prompt", question: "A different question" }, { title: "Apply", question: "What will you try?" }],
} });
assert(changedColumnAfterPublish.response.status === 409, "column titles and questions lock after the first Post-it is published");
const postTwo = await call(`${reflectionUrl}/posts`, { method: "POST", token: actorOne.data.token, body: { columnId: reflection.data.columns[1].id, body: "=1+1" }, ip: `reflection-post-${smokeRun}` });
const postOverQuota = await call(`${reflectionUrl}/posts`, { method: "POST", token: actorOne.data.token, body: { columnId: reflection.data.columns[0].id, body: "One more" }, ip: `reflection-post-${smokeRun}` });
assert(postTwo.response.status === 201 && postOverQuota.response.status === 409, "the 1–10 Post-it quota applies across every column");
const actorRace = await call(`${reflectionUrl}/actor`, { method: "POST", body: {}, ip: `reflection-actor-race-${smokeRun}` });
const concurrentQuotaAttempts = await Promise.all(Array.from({ length: 3 }, (_, index) => call(`${reflectionUrl}/posts`, { method: "POST", token: actorRace.data.token,
  body: { columnId: reflection.data.columns[index % 2].id, body: `Concurrent quota ${index + 1}`, idempotencyKey: crypto.randomUUID() }, ip: `reflection-quota-race-${index}-${smokeRun}` })));
const concurrentQuotaSaved = concurrentQuotaAttempts.filter((result) => result.response.status === 201);
const concurrentQuotaRejected = concurrentQuotaAttempts.filter((result) => result.response.status === 409);
const quotaRaceCleanup = await Promise.all(concurrentQuotaSaved.map((result) => call(`${reflectionUrl}/posts/${result.data.postId}`, { method: "DELETE", token: actorRace.data.token, ip: `reflection-quota-cleanup-${smokeRun}` })));
assert(concurrentQuotaSaved.length === 2 && concurrentQuotaRejected.length === 1 && quotaRaceCleanup.every((result) => result.response.ok), "atomic concurrent posting enforces the wall-wide quota without exceeding its limit");
const ownerActivitySnapshot = await call(`/owner/activities/${reflectionId}`, { cookie });
const ownerActivityList = await call("/owner/activities", { cookie });
const ownerSessionDetail = await call(`/owner/sessions/${sessionId}`, { cookie });
assert(ownerActivitySnapshot.response.ok && ownerActivitySnapshot.data.wall.id === reflectionId
  && ownerActivityList.data.activities.some((activity) => activity.id === reflectionId && activity.participant_count === 3 && activity.submitted_count === 2), "shared Activity navigation and trainer overview count Reflection Wall actors and Post-its");
assert(ownerSessionDetail.response.ok && ownerSessionDetail.data.activities.some((activity) => activity.id === reflectionId && activity.tool_id === "reflection-wall" && activity.submitted_count === 2), "Session details include the linked Reflection Wall and its Post-it total");
const eventsAfterPost = await call(`${reflectionUrl}/events?cursor=${reflectionEventsInitial.data.cursor}`);
assert(eventsAfterPost.response.ok && eventsAfterPost.data.changed && eventsAfterPost.data.cursor > reflectionEventsInitial.data.cursor, "new Post-it advances the content-free realtime cursor");
const commentKey = crypto.randomUUID();
const simultaneousCommentRetries = await Promise.all(Array.from({ length: 2 }, () => call(`${reflectionUrl}/comments`, { method: "POST", token: actorTwo.data.token, body: { postId: postOne.data.postId, body: "I noticed that too.", idempotencyKey: commentKey }, ip: `reflection-comment-${smokeRun}` })));
const commentOne = simultaneousCommentRetries.find((result) => result.response.status === 201) ?? simultaneousCommentRetries[0];
const commentRetry = simultaneousCommentRetries.find((result) => result.response.status === 200) ?? simultaneousCommentRetries[1];
assert(commentOne.response.status === 201 && commentRetry.response.ok && commentRetry.data.alreadySaved && commentRetry.data.commentId === commentOne.data.commentId, "comment retry is idempotent and adds only one flat comment");
const commentEdit = await call(`${reflectionUrl}/comments/${commentOne.data.commentId}`, { method: "PATCH", token: actorTwo.data.token, body: { body: "I noticed the same thing." }, ip: `reflection-comment-edit-${smokeRun}` });
const wrongCommentEdit = await call(`${reflectionUrl}/comments/${commentOne.data.commentId}`, { method: "PATCH", token: actorOne.data.token, body: { body: "Changed by another actor" }, ip: `reflection-comment-edit-wrong-${smokeRun}` });
assert(commentEdit.response.ok && wrongCommentEdit.response.status === 403, "authors may edit their own comments while other participants cannot");
const reactionNames = ["heart", "clap", "haha", "sad", "empathy", "inspireful"];
const reactionWrites = await Promise.all(reactionNames.flatMap((reaction) => [
  call(`${reflectionUrl}/reactions`, { method: "POST", token: actorOne.data.token, body: { targetType: "post", targetId: postOne.data.postId, reaction, selected: true }, ip: `reflection-reaction-${smokeRun}` }),
  call(`${reflectionUrl}/reactions`, { method: "POST", token: actorTwo.data.token, body: { targetType: "comment", targetId: commentOne.data.commentId, reaction, selected: true }, ip: `reflection-reaction-${smokeRun}` }),
]));
assert(reactionWrites.every((response) => response.response.ok), "all six reaction kinds work on both Post-its and comments");
await call(`${reflectionUrl}/reactions`, { method: "POST", token: actorOne.data.token, body: { targetType: "post", targetId: postOne.data.postId, reaction: "heart", selected: true }, ip: `reflection-reaction-${smokeRun}` });
const reactionSnapshot = await call(reflectionUrl, { token: actorOne.data.token });
const reactedPost = reactionSnapshot.data.posts.find((post) => post.id === postOne.data.postId);
const reactedComment = reactedPost?.comments.find((comment) => comment.id === commentOne.data.commentId);
assert(reactedPost?.reactions.heart === 1 && reactedPost?.myReactions.length === 6 && reactedComment?.reactions.inspireful === 1
  && reactedComment?.myReactions.length === 0 && !Object.hasOwn(reactedComment ?? {}, "parentId"), "reactions are multi-select, idempotent and comments stay flat");
const editedPost = await call(`${reflectionUrl}/posts/${postOne.data.postId}`, { method: "PATCH", token: actorOne.data.token, body: { body: "A bright moment, revised" }, ip: `reflection-post-edit-${smokeRun}` });
const wrongPostEdit = await call(`${reflectionUrl}/posts/${postOne.data.postId}`, { method: "PATCH", token: actorTwo.data.token, body: { body: "Changed by another actor" }, ip: `reflection-post-edit-wrong-${smokeRun}` });
assert(editedPost.response.ok && wrongPostEdit.response.status === 403, "authors may edit their own Post-its while other participants cannot");
const madeCluster = await call(`/owner/reflection-walls/${reflectionId}/clusters`, { method: "POST", cookie, body: { title: "Bright moments", description: "Shared wins", colorKey: "pink" } });
const assignedCluster = await call(`/owner/reflection-walls/${reflectionId}/posts/${postOne.data.postId}/cluster`, { method: "POST", cookie, body: { clusterId: madeCluster.data.clusterId } });
const unassignedCluster = await call(`/owner/reflection-walls/${reflectionId}/posts/${postOne.data.postId}/cluster`, { method: "POST", cookie, body: { clusterId: null } });
const reassignedCluster = await call(`/owner/reflection-walls/${reflectionId}/posts/${postOne.data.postId}/cluster`, { method: "POST", cookie, body: { clusterId: madeCluster.data.clusterId } });
assert(madeCluster.response.status === 201 && assignedCluster.response.ok && unassignedCluster.response.ok && reassignedCluster.response.ok, "trainer creates, removes and reapplies a virtual cluster without changing the source column");
const presenterLink = await call(`/owner/reflection-walls/${reflectionId}/presenter-link`, { method: "POST", cookie, body: {} });
const reflectionPresenterToken = presenterLink.data.path.split("#")[1];
const presenterOff = await call("/presenter", { token: reflectionPresenterToken });
assert(presenterLink.response.ok && presenterOff.response.ok && presenterOff.data.kind === "reflection-wall" && presenterOff.data.posts.length === 0
  && presenterOff.data.columns.length === 0 && presenterOff.data.analytics.posts === 0, "Presenter starts fully blank and leaks no wall data while mode is off");
const presentationAll = await call(`/owner/reflection-walls/${reflectionId}/presentation`, { method: "POST", cookie, body: { mode: "all", clustersVisible: true } });
const presenterAll = await call("/presenter", { token: reflectionPresenterToken });
assert(presentationAll.response.ok && presenterAll.response.ok && presenterAll.data.posts.length === 2
  && !JSON.stringify(presenterAll.data).includes("Private anonymous actor") && !JSON.stringify(presenterAll.data).includes(actorOne.data.token), "Presenter all view shows visible content without actor identity or capability");
const publicClusterSnapshot = await call(reflectionUrl, { token: actorOne.data.token });
assert(publicClusterSnapshot.response.ok && publicClusterSnapshot.data.clusters.length === 0
  && publicClusterSnapshot.data.posts.every((post) => post.clusterId === null), "participant snapshots do not expose trainer cluster labels or assignments");
const presentationFocus = await call(`/owner/reflection-walls/${reflectionId}/presentation`, { method: "POST", cookie, body: { mode: "focus", columnId: reflection.data.columns[0].id } });
const presenterFocus = await call("/presenter", { token: reflectionPresenterToken });
assert(presentationFocus.response.ok && presenterFocus.data.posts.length === 1 && presenterFocus.data.posts[0].columnId === reflection.data.columns[0].id, "Presenter Focus mode filters to the selected column");
const presentationSpotlight = await call(`/owner/reflection-walls/${reflectionId}/presentation`, { method: "POST", cookie, body: { mode: "spotlight", postId: postTwo.data.postId } });
const presenterSpotlight = await call("/presenter", { token: reflectionPresenterToken });
assert(presentationSpotlight.response.ok && presenterSpotlight.data.posts.length === 1 && presenterSpotlight.data.posts[0].id === postTwo.data.postId, "Presenter Spotlight mode isolates the chosen Post-it");
const presentationCluster = await call(`/owner/reflection-walls/${reflectionId}/presentation`, { method: "POST", cookie, body: { mode: "cluster", clusterId: madeCluster.data.clusterId, clustersVisible: true } });
const presenterCluster = await call("/presenter", { token: reflectionPresenterToken });
assert(presentationCluster.response.ok && presenterCluster.data.posts.length === 1 && presenterCluster.data.posts[0].id === postOne.data.postId, "Presenter Cluster mode filters to the selected virtual cluster");
const presentationBlank = await call(`/owner/reflection-walls/${reflectionId}/presentation`, { method: "POST", cookie, body: { mode: "blank" } });
const presenterBlank = await call("/presenter", { token: reflectionPresenterToken });
assert(presentationBlank.response.ok && presenterBlank.data.posts.length === 0 && presenterBlank.data.columns.length === 0
  && presenterBlank.data.analytics.contributors === 0 && presenterBlank.data.analytics.reactions === 0
  && Object.values(presenterBlank.data.analytics.reactionBreakdown).every((count) => count === 0), "Presenter Blank mode suppresses all content and analytics");
const hiddenPost = await call(`/owner/reflection-walls/${reflectionId}/moderate`, { method: "POST", cookie, body: { kind: "post", id: postOne.data.postId, action: "HIDE", reason: "Safety review" } });
const hiddenParticipantSnapshot = await call(reflectionUrl, { token: actorOne.data.token });
const hiddenOwnerSnapshot = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
assert(hiddenPost.response.ok && !hiddenParticipantSnapshot.data.posts.some((post) => post.id === postOne.data.postId)
  && hiddenOwnerSnapshot.data.posts.find((post) => post.id === postOne.data.postId)?.hidden, "trainer Hide removes a Post-it from participants but retains it for moderation");
const restorePost = await call(`/owner/reflection-walls/${reflectionId}/moderate`, { method: "POST", cookie, body: { kind: "post", id: postOne.data.postId, action: "RESTORE", reason: "Reviewed and restored" } });
const hideComment = await call(`/owner/reflection-walls/${reflectionId}/moderate`, { method: "POST", cookie, body: { kind: "comment", id: commentOne.data.commentId, action: "HIDE" } });
const moderatedSnapshot = await call(reflectionUrl, { token: actorOne.data.token });
const moderatedOwnerSnapshot = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
assert(restorePost.response.ok && hideComment.response.ok && moderatedSnapshot.data.posts.find((post) => post.id === postOne.data.postId)?.comments.length === 0, "trainer can restore Post-its and hide comments independently");
assert(moderatedOwnerSnapshot.data.moderationEvents.some((event) => event.targetId === postOne.data.postId && event.action === "HIDE")
  && moderatedOwnerSnapshot.data.moderationEvents.some((event) => event.targetId === postOne.data.postId && event.action === "RESTORE" && event.reason === "Reviewed and restored")
  && moderatedOwnerSnapshot.data.moderationEvents.some((event) => event.targetId === postOne.data.postId && event.reason === "Safety review"), "trainer-only audit records moderator action, time and trainer-entered reason");
const reflectionCsv = await call(`/owner/reflection-walls/${reflectionId}/export`, { cookie });
assert(reflectionCsv.response.ok && reflectionCsv.text.includes("'=1+1") && reflectionCsv.text.includes("Anonymous"), "CSV export is anonymous and neutralizes formula-leading Post-it text");
const pausedWall = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "PAUSE" } });
const pausedWrite = await call(`${reflectionUrl}/posts`, { method: "POST", token: actorTwo.data.token, body: { columnId: reflection.data.columns[0].id, body: "Should be rejected" }, ip: `reflection-paused-${smokeRun}` });
assert(pausedWall.response.ok && pausedWrite.response.status === 409, "paused Reflection Wall rejects participant writes");
const resumedWall = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "OPEN" } });
const closedWall = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "CLOSE" } });
const closedLookup = await call("/join/lookup", { method: "POST", body: { pin: reflection.data.activity.joinPin }, ip: `reflection-closed-lookup-${smokeRun}` });
const closedWrite = await call(`${reflectionUrl}/comments`, { method: "POST", token: actorTwo.data.token, body: { postId: postTwo.data.postId, body: "Should be rejected" }, ip: `reflection-closed-${smokeRun}` });
assert(resumedWall.response.ok && closedWall.response.ok && closedLookup.data.activity.readOnly && closedWrite.response.status === 409, "closed wall preserves its join code for read-only access");
const archivedWall = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "ARCHIVE" } });
const archiveEdit = await call(`/owner/reflection-walls/${reflectionId}/moderate`, { method: "POST", cookie, body: { kind: "post", id: postOne.data.postId, action: "HIDE" } });
const reopenedWall = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "REOPEN" } });
const reopenedSnapshot = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
assert(archivedWall.response.ok && archiveEdit.response.status === 409 && reopenedWall.response.ok && reopenedWall.data.phase === "OPEN"
  && reopenedSnapshot.data.activity.joinPin === reflection.data.activity.joinPin && reopenedSnapshot.data.posts.length === 2, "Archive is read-only and reopening preserves content and access code");
const finalClose = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "CLOSE" } });
const closedNewVisitor = await call(reflectionUrl);
assert(finalClose.response.ok && closedNewVisitor.response.ok && closedNewVisitor.data.wall.phase === "CLOSED" && !closedNewVisitor.data.viewer.canWrite, "a new visitor with a valid link can read a closed wall without having participated");
const oldSharePath = reopenedSnapshot.data.sharePath;
const revokeWallAccess = await call(`/owner/reflection-walls/${reflectionId}/access`, { method: "DELETE", cookie });
const revokedPublicLink = await call(reflectionUrl, { token: actorOne.data.token });
const revokedOldPin = await call("/join/lookup", { method: "POST", body: { pin: reflection.data.activity.joinPin }, ip: `reflection-revoked-pin-${smokeRun}` });
assert(revokeWallAccess.response.ok && revokedPublicLink.response.status === 404 && revokedOldPin.response.status === 404, "revoking access invalidates both the old link and PIN, including an existing actor browser");
const rotateWallAccess = await call(`/owner/reflection-walls/${reflectionId}/access`, { method: "POST", cookie, body: { action: "ROTATE" } });
const rotatedOwnerSnapshot = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
const oldLinkAfterRotate = await call(`/guest/reflection-walls/${oldSharePath.split("/").at(-1)}`);
const newPinLookup = await call("/join/lookup", { method: "POST", body: { pin: rotateWallAccess.data.joinPin }, ip: `reflection-new-pin-${smokeRun}` });
assert(rotateWallAccess.response.ok && rotatedOwnerSnapshot.data.wall.accessEnabled && rotatedOwnerSnapshot.data.sharePath !== oldSharePath
  && rotatedOwnerSnapshot.data.activity.joinPin !== reflection.data.activity.joinPin && oldLinkAfterRotate.response.status === 404
  && newPinLookup.response.ok && newPinLookup.data.activity.readOnly, "rotating access creates a fresh closed-wall link and PIN while old credentials stay invalid");
reflectionSlug = rotatedOwnerSnapshot.data.sharePath.split("/").at(-1);
reflectionUrl = `/guest/reflection-walls/${reflectionSlug}`;
const resumeAfterAccessRotation = await call(`/owner/reflection-walls/${reflectionId}/transition`, { method: "POST", cookie, body: { action: "REOPEN" } });
assert(resumeAfterAccessRotation.response.ok && resumeAfterAccessRotation.data.phase === "OPEN", "rotated access remains valid when the closed wall is reopened");

const reflectionLoadCount = 200;
const reflectionLoadActors = await Promise.all(Array.from({ length: reflectionLoadCount }, (_, index) => call(`${reflectionUrl}/actor`, {
  method: "POST", body: {}, ip: `reflection-load-actor-${index}-${smokeRun}`,
})));
assert(reflectionLoadActors.every((result) => result.response.status === 201 && result.data.token), "200 concurrent visitors receive independent wall-scoped capabilities");
const reflectionLoadPosts = await Promise.all(reflectionLoadActors.map((actor, index) => call(`${reflectionUrl}/posts`, {
  method: "POST", token: actor.data.token, body: { columnId: reflection.data.columns[index % 2].id, body: `Reflection load response ${index + 1}`, idempotencyKey: crypto.randomUUID() }, ip: `reflection-load-post-${index}-${smokeRun}`,
})));
const reflectionLoadSnapshot = await call(`/owner/reflection-walls/${reflectionId}`, { cookie });
assert(reflectionLoadPosts.every((result) => result.response.status === 201)
  && reflectionLoadSnapshot.data.analytics.visiblePosts === reflectionLoadCount + 2
  && reflectionLoadSnapshot.data.analytics.activePosters === reflectionLoadCount + 1,
  "200 near-simultaneous Reflection Wall posts persist with correct aggregate and contributor analytics");

const namedReflectionCreated = await call("/owner/reflection-walls", { method: "POST", cookie, body: {
  title: `Named reflection smoke ${smokeRun}`, description: "Named mode coverage", identityMode: "named", postLimit: 1, sessionId: null,
  columns: [{ title: "Share", question: "What would you like to share?" }],
} });
const namedReflectionId = namedReflectionCreated.data.activityId;
await call(`/owner/reflection-walls/${namedReflectionId}/transition`, { method: "POST", cookie, body: { action: "OPEN" } });
const namedReflection = await call(`/owner/reflection-walls/${namedReflectionId}`, { cookie });
const namedReflectionSlug = namedReflection.data.sharePath.split("/").at(-1);
const namedMissing = await call(`/guest/reflection-walls/${namedReflectionSlug}/actor`, { method: "POST", body: {}, ip: `reflection-named-missing-${smokeRun}` });
const namedActor = await call(`/guest/reflection-walls/${namedReflectionSlug}/actor`, { method: "POST", body: { displayName: "Named Reflection Guest" }, ip: `reflection-named-actor-${smokeRun}` });
const namedReflectionPost = await call(`/guest/reflection-walls/${namedReflectionSlug}/posts`, { method: "POST", token: namedActor.data.token, body: { columnId: namedReflection.data.columns[0].id, body: "A named contribution" }, ip: `reflection-named-post-${smokeRun}` });
const namedModeEdit = await call(`/owner/reflection-walls/${namedReflectionId}`, { method: "PATCH", cookie, body: { title: `Named reflection smoke ${smokeRun}`, description: "", identityMode: "anonymous", postLimit: 1, columns: [{ id: namedReflection.data.columns[0].id, title: "Share", question: "" }] } });
assert(namedReflectionCreated.response.status === 201 && namedMissing.response.status === 400 && namedActor.response.status === 201
  && namedReflectionPost.response.status === 201 && namedModeEdit.response.status === 409, "named walls require a display name and lock identity mode after publishing");
const namedOwnerSnapshot = await call(`/owner/reflection-walls/${namedReflectionId}`, { cookie });
assert(namedOwnerSnapshot.data.posts[0].author === "Named Reflection Guest", "trainer sees the participant-selected name only on named walls");
const namedPresenterLink = await call(`/owner/reflection-walls/${namedReflectionId}/presenter-link`, { method: "POST", cookie, body: {} });
const reflectionNamedPresenterToken = namedPresenterLink.data.path.split("#")[1];
await call(`/owner/reflection-walls/${namedReflectionId}/presentation`, { method: "POST", cookie, body: { mode: "all" } });
const namedPresenter = await call("/presenter", { token: reflectionNamedPresenterToken });
assert(namedPresenter.response.ok && !JSON.stringify(namedPresenter.data).includes("Named Reflection Guest"), "Presenter never receives named participant identity");
const revokedPresenterLink = await call(`/owner/reflection-walls/${namedReflectionId}/presenter-link`, { method: "DELETE", cookie });
const revokedPresenter = await call("/presenter", { token: reflectionNamedPresenterToken });
assert(revokedPresenterLink.response.ok && revokedPresenter.response.status === 404, "trainer can revoke an active Presenter capability");
for (const activityIdToDelete of [reflectionId, namedReflectionId]) assert(/^[0-9a-f-]{36}$/i.test(activityIdToDelete), "smoke cleanup uses only server-issued activity IDs");
const reflectionCleanup = await execFileAsync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "trainerpopp-kit", "--local", "--command",
  `DELETE FROM reflection_wall_reactions WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_comments WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_posts WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_presenter_sessions WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_events WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_clusters WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_actors WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_columns WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM reflection_wall_configs WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM presentation_state WHERE activity_id IN ('${reflectionId}','${namedReflectionId}');
   DELETE FROM activities WHERE id IN ('${reflectionId}','${namedReflectionId}');
   SELECT changes() AS deleted;`]);
assert(reflectionCleanup.stdout.includes('"deleted": 2'), "exactly the two local Reflection Wall smoke fixtures are removed");

assert(/^[0-9a-f-]{36}$/i.test(sessionId), "smoke cleanup uses only its server-issued Session ID");
const sessionFixtureCleanup = await execFileAsync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "trainerpopp-kit", "--local", "--command",
  `DELETE FROM activities WHERE session_id = '${sessionId}';
   DELETE FROM sessions WHERE id = '${sessionId}';
   SELECT changes() AS deleted;`]);
assert(sessionFixtureCleanup.stdout.includes('"deleted": 1'), "the exact local smoke Session and its linked Activity fixtures are removed");

console.log(`PASS: ${checks} local Worker/D1 smoke assertions. No credential values were printed.`);
