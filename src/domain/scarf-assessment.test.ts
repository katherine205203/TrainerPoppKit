import { describe, expect, it } from "vitest";
import { publicScarfQuestions, SCARF_QUESTION_COUNT, scoreScarfAnswers, validateScarfAnswers } from "./scarf-assessment";

function completeAnswers() {
  return Object.fromEntries([
    ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 1).padStart(2, "0")}`, index % 10 + 1]),
    ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 11).padStart(2, "0")}`, "equal"]),
    ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 21).padStart(2, "0")}`, { A: 1, B: 2, C: 3 }]),
  ]);
}

describe("SCARF Assessment scoring", () => {
  it("loads exactly 30 participant-safe items without hidden dimension assignments", () => {
    const items = publicScarfQuestions();
    expect(SCARF_QUESTION_COUNT).toBe(30);
    expect(items).toHaveLength(30);
    expect(items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`));
    expect(items.every((item) => !("domain" in item) && !("domain_options" in item))).toBe(true);
    expect(items.slice(0, 10).every((item) => "anchors" in item)).toBe(true);
  });

  it("validates all response formats and rejects missing, fractional, invalid, and tied answers", () => {
    const answers = completeAnswers();
    expect(validateScarfAnswers(answers, true)).toBe(true);
    expect(validateScarfAnswers({ ...answers, Q01: 10.5 })).toBe(false);
    expect(validateScarfAnswers({ ...answers, Q11: "lean_C" })).toBe(false);
    expect(validateScarfAnswers({ ...answers, Q21: { A: 1, B: 1, C: 3 } })).toBe(false);
    expect(validateScarfAnswers(Object.fromEntries(Object.entries(answers).slice(1)), true)).toBe(false);
    expect(validateScarfAnswers({ ...answers, unexpected: 3 })).toBe(false);
  });

  it("maps the reaction endpoints to 1.0 and 10.0 for every dimension", () => {
    const low = completeAnswers();
    const high = completeAnswers();
    for (let question = 1; question <= 10; question += 1) {
      low[`Q${String(question).padStart(2, "0")}`] = 1;
      high[`Q${String(question).padStart(2, "0")}`] = 10;
    }
    expect(Object.values(scoreScarfAnswers(low).reaction)).toEqual([1, 1, 1, 1, 1]);
    expect(Object.values(scoreScarfAnswers(high).reaction)).toEqual([10, 10, 10, 10, 10]);
  });

  it("produces 5.5 across priority domains for equal trade-offs and balanced fixed rankings", () => {
    const answers = completeAnswers();
    const scores = scoreScarfAnswers(answers);
    expect(Object.values(scores.priority)).toEqual([5.5, 5.5, 5.5, 5.5, 5.5]);
    expect(Object.values(scores.priority).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 10);
    expect(Object.values(scores.integratedNeedsIndex).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 10);
  });

  it("keeps the priority index fixed-sum for varied valid responses", () => {
    const answers = completeAnswers();
    for (let question = 11; question <= 20; question += 1) {
      answers[`Q${question}`] = ["strong_A", "lean_A", "equal", "lean_B", "strong_B"][question % 5]!;
    }
    for (let question = 21; question <= 30; question += 1) {
      const shift = question % 3;
      answers[`Q${question}`] = { A: ((1 + shift - 1) % 3) + 1, B: ((2 + shift - 1) % 3) + 1, C: ((3 + shift - 1) % 3) + 1 };
    }
    expect(Object.values(scoreScarfAnswers(answers).priority).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 10);
    expect(Object.values(scoreScarfAnswers(answers).integratedNeedsIndex).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 10);
  });
});
