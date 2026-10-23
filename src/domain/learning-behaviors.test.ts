import { describe, expect, it } from "vitest";
import { LEARNING_BEHAVIORS, meanParticipantPeerMeans, summarizeGroupSelf, summarizePeerRounds, validateLbrAnswers } from "./learning-behaviors";

const complete = (values: Array<number | "NA">) => Object.fromEntries(LEARNING_BEHAVIORS.map((behavior, index) => [behavior.key, values[index]!])) as Record<string, number | "NA">;

describe("Learning Behaviors Reflection scoring", () => {
  it("uses the six canonical behavior keys and validates explicit NA answers", () => {
    const answers = complete([4, 3, "NA", 2, 5, 1]);
    expect(LEARNING_BEHAVIORS.map((behavior) => behavior.key)).toEqual([
      "asking_questions", "sharing_information", "seeking_help", "experimenting", "talking_about_mistakes", "seeking_feedback",
    ]);
    expect(validateLbrAnswers(answers)).toBe(true);
    expect(validateLbrAnswers({ ...answers, extra: 2 })).toBe(false);
    expect(validateLbrAnswers({ ...answers, seeking_help: 0 })).toBe(false);
    expect(validateLbrAnswers({ ...answers, seeking_help: null })).toBe(false);
  });

  it("excludes N/A and reports per-behavior denominators", () => {
    const stats = summarizePeerRounds([complete([4, 3, "NA", 2, 5, 1]) as never, complete([2, "NA", "NA", 4, 1, 5]) as never]);
    expect(stats.asking_questions).toEqual({ mean: 3, validN: 2, naN: 0 });
    expect(stats.sharing_information).toEqual({ mean: 3, validN: 1, naN: 1 });
    expect(stats.seeking_help).toEqual({ mean: null, validN: 0, naN: 2 });
  });

  it("includes only locked self answers and leaves all-NA means empty", () => {
    const stats = summarizeGroupSelf([
      { locked: true, answers: complete([2, "NA", 5, 3, 1, 4]) },
      { locked: true, answers: complete([4, 3, "NA", 5, 5, 2]) },
      { locked: false, answers: complete([5, 5, 5, 5, 5, 5]) },
    ]);
    expect(stats.lockedCount).toBe(2);
    expect(stats.behaviors.asking_questions).toEqual({ mean: 3, validN: 2, naN: 0 });
    expect(stats.behaviors.seeking_help).toEqual({ mean: 5, validN: 1, naN: 1 });
  });

  it("weights trainer peer analytics by participant means, not raw round volume", () => {
    expect(meanParticipantPeerMeans([
      { mean: 2, validN: 10, naN: 0 },
      { mean: 4, validN: 1, naN: 0 },
      { mean: null, validN: 0, naN: 5 },
    ])).toEqual({ mean: 3, validN: 2, naN: 0 });
  });
});
