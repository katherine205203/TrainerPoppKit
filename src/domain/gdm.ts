export type GdmRunState = "READY" | "LIVE" | "PAUSED" | "CLOSED" | "ARCHIVED" | "HISTORY";

export type GdmSelection = {
  sessionIds: string[];
  activityIds: string[];
  runIds: string[];
  sessionMode?: "ONLY" | "ALL";
};

export function isRunLive(state: string): boolean {
  return state === "LIVE" || state === "PAUSED" || state === "open" || state === "paused" || state === "RUNNING" || state === "LOBBY_OPEN";
}

export function normalizeSelection(selection: GdmSelection, activitySession: Record<string, string | null>, runActivity: Record<string, string>): GdmSelection {
  const sessions = [...new Set(selection.sessionIds)];
  const coveredSessions = new Set(sessions.filter(() => selection.sessionMode === "ALL"));
  const activities = [...new Set(selection.activityIds)].filter((id) => !coveredSessions.has(activitySession[id] ?? ""));
  const deletedActivities = new Set([...activities, ...Object.entries(activitySession).filter(([, sessionId]) => sessionId && coveredSessions.has(sessionId)).map(([activityId]) => activityId)]);
  return { sessionIds: sessions, activityIds: activities, runIds: [...new Set(selection.runIds)].filter((id) => !deletedActivities.has(runActivity[id] ?? "")), sessionMode: selection.sessionMode };
}

export function sessionRunIdsForReset<T extends { id: string; originSessionId: string | null; isCurrent: boolean }>(
  runs: T[], sessionId: string, scope: "CURRENT" | "ALL",
): T[] {
  return runs.filter((run) => run.originSessionId === sessionId && (scope === "ALL" || run.isCurrent));
}

export function shouldReplaceCurrentRun(run: { originSessionId: string | null; isCurrent: boolean }, sessionId: string): boolean {
  return run.isCurrent && run.originSessionId === sessionId;
}
