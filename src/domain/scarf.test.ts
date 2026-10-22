import { describe, expect, it } from "vitest";
import { DEMO_ITEMS, relativeTier, SCARF_DIMENSIONS, scoreDemoResponses, smallGroupWarning, validateDemoAnswers } from "./scarf";

describe("SCARF demo instrument guardrails", () => {
  it("uses the five canonical dimension labels and marks every placeholder item", () => {
    expect(SCARF_DIMENSIONS).toEqual(["Status", "Certainty", "Autonomy", "Relatedness", "Fairness"]);
    expect(DEMO_ITEMS.map((item) => item.dimension)).toEqual(SCARF_DIMENSIONS);
    expect(SCARF_DIMENSIONS).not.toContain("Safety");
  });

  it("accepts only five-point demo responses and can require completeness", () => {
    expect(validateDemoAnswers({ 1: 1, 3: 5 })).toBe(true);
    expect(validateDemoAnswers({ 1: 1, 3: 5 }, true)).toBe(false);
    expect(validateDemoAnswers({ 1: 0 })).toBe(false);
    expect(validateDemoAnswers({ 6: 3 })).toBe(false);
  });

  it("maps demo answers to their labelled dimensions without claiming validated scoring", () => {
    expect(scoreDemoResponses({ 1: 4, 2: 2, 3: 5, 4: 3, 5: 1 })).toEqual({
      Status: 4, Certainty: 2, Autonomy: 5, Relatedness: 3, Fairness: 1,
    });
  });

  it("keeps tied quantile values together and warns about small groups", () => {
    expect(relativeTier(2, [1, 2, 2, 2, 4])).toBe("middle range");
    expect(relativeTier(1, [1, 2, 2, 2, 4])).toBe("lower quartile");
    expect(relativeTier(4, [1, 2, 2, 2, 4])).toBe("upper quartile");
    expect(smallGroupWarning(7)).toMatch(/illustrative and unstable/i);
    expect(smallGroupWarning(8)).toBeNull();
  });
});
