import { readFile } from "node:fs/promises";

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
  const data = await response.json().catch(() => ({}));
  return { response, data };
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
assert(ownerSession.response.ok && ownerSession.data.activities.length === 1, "session detail lists its own activities");

console.log(`PASS: ${checks} local Worker/D1 smoke assertions. No credential values were printed.`);
