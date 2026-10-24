import { describe, expect, it } from "vitest";
import { isRunLive, normalizeSelection, sessionRunIdsForReset, shouldReplaceCurrentRun } from "./gdm";

describe("Global Data Management rules", () => {
  it("blocks every live or paused Run state while allowing closed history", () => {
    for (const state of ["LIVE", "PAUSED", "open", "paused", "RUNNING", "LOBBY_OPEN"]) expect(isRunLive(state)).toBe(true);
    for (const state of ["READY", "CLOSED", "ARCHIVED", "HISTORY", "COMPLETED", "draft"]) expect(isRunLive(state)).toBe(false);
  });

  it("de-duplicates parent Session/Activity selections before bulk cascades", () => {
    const result = normalizeSelection(
      { sessionIds: ["s1", "s1"], activityIds: ["a1", "a2", "a3"], runIds: ["r1", "r2", "r3"], sessionMode: "ALL" },
      { a1: "s1", a2: "s1", a3: null }, { r1: "a1", r2: "a2", r3: "a3" },
    );
    expect(result).toEqual({ sessionIds: ["s1"], activityIds: ["a3"], runIds: [], sessionMode: "ALL" });
  });

  it("scopes Session reset to immutable origin and only current Runs when requested", () => {
    const runs = [
      { id: "r1", originSessionId: "s1", isCurrent: false },
      { id: "r2", originSessionId: "s1", isCurrent: true },
      { id: "r3", originSessionId: "s2", isCurrent: true },
      { id: "r4", originSessionId: null, isCurrent: true },
    ];
    expect(sessionRunIdsForReset(runs, "s1", "CURRENT").map((run) => run.id)).toEqual(["r2"]);
    expect(sessionRunIdsForReset(runs, "s1", "ALL").map((run) => run.id)).toEqual(["r1", "r2"]);
    expect(shouldReplaceCurrentRun(runs[2]!, "s1")).toBe(false);
    expect(shouldReplaceCurrentRun(runs[1]!, "s1")).toBe(true);
  });
});
