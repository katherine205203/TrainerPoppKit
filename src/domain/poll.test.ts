import { describe, expect, it } from "vitest";
import { calculatePollResults, safeCsvCell, validatePollDraft, validatePollForOpen, validatePollSelection, type PollConfigInput, type PollOption } from "./poll";

const base: PollConfigInput = {
  title: "Workshop pulse", question: "What helped most?", questionType: "multiple",
  options: ["Clarity", "Collaboration"], maxSelections: 2, allowOther: false,
  identityMode: "anonymous", participantResultsMode: "presenter_only",
};
const options: PollOption[] = [
  { id: "a", label: "Clarity", sortOrder: 0, isOther: false },
  { id: "b", label: "Collaboration", sortOrder: 1, isOther: false },
  { id: "other", label: "Other", sortOrder: 2, isOther: true },
];

describe("Poll domain rules", () => {
  it("allows an incomplete draft but blocks opening it", () => {
    expect(validatePollDraft({ ...base, options: ["Only one"] })).toEqual([]);
    expect(validatePollForOpen({ ...base, options: ["Only one"] })).toContain("Add at least two answer options before opening this Poll.");
  });
  it("enforces option uniqueness and a ten-option maximum including Other", () => {
    expect(validatePollDraft({ ...base, options: ["Yes", " yes "] })).toContain("Answer options must be unique.");
    expect(validatePollDraft({ ...base, options: Array.from({ length: 10 }, (_, i) => `Option ${i}`), allowOther: true })).toContain("A Poll can have at most 10 answer options including Other.");
  });
  it("rejects forged, excessive, and blank Other answers", () => {
    expect(validatePollSelection("single", 1, options, [{ optionId: "a" }, { optionId: "b" }])).toContain("Select exactly one answer.");
    expect(validatePollSelection("multiple", 1, options, [{ optionId: "a" }, { optionId: "b" }])).toContain("Select no more than 1 answers.");
    expect(validatePollSelection("multiple", 2, options, [{ optionId: "other", otherText: "  " }])).toContain("Add a short response for Other.");
    expect(validatePollSelection("single", 1, options, [{ optionId: "forged" }])).toContain("One or more selected answers are not part of this Poll.");
  });
  it("uses respondent count as the percentage denominator for multiple choice", () => {
    expect(calculatePollResults(options, [{ selections: ["a", "b"] }]).map(({ percentage }) => percentage)).toEqual([100, 100, 0]);
  });
  it("hardens CSV formula-leading cells and quotes CSV syntax", () => {
    expect(safeCsvCell("=1+1")).toBe('"\'=1+1"');
    expect(safeCsvCell("  @SUM(A1)")).toBe('"\'  @SUM(A1)"');
    expect(safeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
});
