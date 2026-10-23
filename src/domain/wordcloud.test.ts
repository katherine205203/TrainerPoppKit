import { describe, expect, it } from "vitest";
import {
  aggregateWordCloud, countGraphemes, mergeWordCloudGroups, normalizeWord,
  restoreWordCloudMerge, validateWordSubmission, wordCloudCsv,
} from "./wordcloud";

describe("Word Cloud text rules", () => {
  it("normalizes Unicode canonically, whitespace and case while preserving accents and punctuation", () => {
    expect(normalizeWord("  TIN\t  TƯỞNG  ").key).toBe("tin tưởng");
    expect(normalizeWord("a\u0301").normalized).toBe("á");
    expect(normalizeWord("Hop tac").key).not.toBe(normalizeWord("Hợp tác").key);
    expect(normalizeWord("Tin tưởng!").key).not.toBe(normalizeWord("Tin tưởng").key);
  });

  it("counts visible graphemes rather than UTF-16 code units", () => {
    expect(countGraphemes("ắ".repeat(40))).toBe(40);
    expect(countGraphemes("👨‍👩‍👧‍👦".repeat(40))).toBe(40);
    expect(validateWordSubmission(["ắ".repeat(40)], 3).ok).toBe(true);
    expect(validateWordSubmission(["ắ".repeat(41)], 3)).toMatchObject({ ok: false, code: "WORD_TOO_LONG" });
  });

  it("requires 1..N nonblank, normalized-unique responses", () => {
    expect(validateWordSubmission([], 3)).toMatchObject({ ok: false, code: "EMPTY_RESPONSES" });
    expect(validateWordSubmission(["  "], 3)).toMatchObject({ ok: false, code: "EMPTY_RESPONSES" });
    expect(validateWordSubmission(["Tin tưởng", " tin   TƯỞNG"], 3)).toMatchObject({ ok: false, code: "DUPLICATE_WORD" });
    expect(validateWordSubmission(["One", "Two", "Three", "Four"], 3)).toMatchObject({ ok: false, code: "TOO_MANY_WORDS" });
    expect(validateWordSubmission(["Hop tac", "Hợp tác", "Hợp tác!"], 3).ok).toBe(true);
  });
});

describe("Word Cloud aggregation and moderation", () => {
  const submissions = [
    { id: "a1", teamId: "A", termIds: ["trust", "confidence", "collaboration"] },
    { id: "a2", teamId: "A", termIds: ["trust", "respect"] },
    { id: "b1", teamId: "B", termIds: ["confidence", "collaboration"] },
    { id: "b2", teamId: "B", termIds: ["collaboration"] },
    { id: "b3", teamId: "B", termIds: ["creative"] },
    { id: "c1", teamId: "C", termIds: ["trust", "creative"] },
  ];
  const terms = [
    { id: "trust", label: "Tin tưởng", normalizedKey: "tin tưởng" },
    { id: "confidence", label: "Tin cậy", normalizedKey: "tin cậy" },
    { id: "collaboration", label: "Hợp tác", normalizedKey: "hợp tác" },
    { id: "respect", label: "Tôn trọng", normalizedKey: "tôn trọng" },
    { id: "creative", label: "Sáng tạo", normalizedKey: "sáng tạo" },
  ];
  const groups = [
    { id: "g-trust", label: "Tin tưởng", hidden: false },
    { id: "g-confidence", label: "Tin cậy", hidden: false },
    { id: "g-collab", label: "Hợp tác", hidden: true },
    { id: "g-respect", label: "Tôn trọng", hidden: false },
    { id: "g-creative", label: "Sáng tạo", hidden: false },
  ];

  it("counts each participant once after merging and applies team scope", () => {
    const membership = { trust: "g-trust", confidence: "g-trust", collaboration: "g-collab", respect: "g-respect", creative: "g-creative" };
    const all = aggregateWordCloud({ submissions, terms, groups, membership });
    expect(all.denominator).toBe(6);
    expect(all.visibleTerms.find((row) => row.groupId === "g-trust")?.frequency).toBe(4);
    expect(all.hiddenTerms.find((row) => row.groupId === "g-collab")?.frequency).toBe(3);
    expect(all.visibleTerms.some((row) => row.groupId === "g-collab")).toBe(false);
    expect(aggregateWordCloud({ submissions, terms, groups, membership, teamId: "B" }).denominator).toBe(3);
    expect(aggregateWordCloud({ submissions, terms, groups, membership, teamId: "B" }).visibleTerms.find((row) => row.groupId === "g-trust")?.frequency).toBe(1);
  });

  it("merges across scopes and unmerges without summing repeated participant membership", () => {
    const initial = {
      groups: groups.map((group) => ({ ...group, hidden: group.id === "g-collab" })),
      membership: { trust: "g-trust", confidence: "g-confidence", collaboration: "g-collab", respect: "g-respect", creative: "g-creative" },
    };
    const merged = mergeWordCloudGroups(initial, ["g-confidence"], "g-trust", "Confidence & trust");
    expect("error" in merged).toBe(false);
    if ("error" in merged) return;
    const aggregate = aggregateWordCloud({ submissions, terms, groups: merged.state.groups, membership: merged.state.membership });
    expect(aggregate.visibleTerms.find((row) => row.groupId === "g-trust")?.frequency).toBe(4);
    const undone = restoreWordCloudMerge(merged.state, merged.before, "g-trust");
    expect(undone.membership).toEqual(initial.membership);
    expect(undone.groups.find((group) => group.id === "g-trust")?.label).toBe("Tin tưởng");
    expect(mergeWordCloudGroups(initial, ["g-collab"], "g-trust", "Combined")).toMatchObject({ error: expect.stringMatching(/restore hidden/i) });
  });

  it("keeps merged hidden state when unmerging and restores merge chains in reverse order", () => {
    const initial = {
      groups: groups.map((group) => ({ ...group, hidden: false })),
      membership: { trust: "g-trust", confidence: "g-confidence", collaboration: "g-collab", respect: "g-respect", creative: "g-creative" },
    };
    const first = mergeWordCloudGroups(initial, ["g-confidence"], "g-trust", "Trust and confidence");
    expect("error" in first).toBe(false);
    if ("error" in first) return;
    const second = mergeWordCloudGroups(first.state, ["g-collab"], "g-trust", "Shared themes");
    expect("error" in second).toBe(false);
    if ("error" in second) return;
    const hidden = { ...second.state, groups: second.state.groups.map((group) => group.id === "g-trust" ? { ...group, hidden: true } : group) };
    const undoSecond = restoreWordCloudMerge(hidden, second.before, "g-trust");
    expect(undoSecond.groups.find((group) => group.id === "g-trust")?.hidden).toBe(true);
    expect(undoSecond.groups.find((group) => group.id === "g-collab")?.hidden).toBe(true);
    const undoFirst = restoreWordCloudMerge(undoSecond, first.before, "g-trust");
    expect(undoFirst.membership).toEqual(initial.membership);
    expect(undoFirst.groups.find((group) => group.id === "g-confidence")?.hidden).toBe(true);
    expect(undoFirst.groups.find((group) => group.id === "g-trust")?.hidden).toBe(true);
  });

  it("uses stable top 50 but keeps the full table and exports formula-safe aggregate CSV", () => {
    const manyTerms = Array.from({ length: 75 }, (_, i) => ({ id: `t${i}`, label: `Term ${i}`, normalizedKey: `term ${i}` }));
    const manyGroups = manyTerms.map((term) => ({ id: `g-${term.id}`, label: term.label, hidden: false }));
    const oneSubmission = [{ id: "anon-1", teamId: null, termIds: manyTerms.map((term) => term.id) }];
    const model = aggregateWordCloud({ submissions: oneSubmission, terms: manyTerms, groups: manyGroups, membership: Object.fromEntries(manyTerms.map((term) => [term.id, `g-${term.id}`])) });
    expect(model.cloudTop50).toHaveLength(50);
    expect(model.visibleTerms).toHaveLength(75);
    const csv = wordCloudCsv(["label", "frequency"], [["=SUM(A1)", 1]]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("\uFEFF");
    expect(csv).not.toContain("anon-1");
  });
});
