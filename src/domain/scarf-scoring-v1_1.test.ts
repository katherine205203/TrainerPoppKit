import { describe, expect, it } from "vitest";
import questionBank from "../../reference_packs/SCARF_Product_Pack_v1.2/TrainerPoppKit_SCARF_Product_Pack_v1.2/docs/TrainerPoppKit_SCARF_QuestionBank_v0.2.en.json";
import vectors from "../../reference_packs/SCARF_Product_Pack_v1.2/TrainerPoppKit_SCARF_Product_Pack_v1.2/docs/TrainerPoppKit_SCARF_Scoring_v1.1_TestVectors_20_Participants.json";
import {
  descendingMidranks,
  meanScarfProfiles,
  scoreScarfAnswers,
  SCARF_DOMAIN_CODES,
  type ScarfAnswers,
  type ScarfDomainScores,
} from "./scarf-assessment";

type VectorPerson = (typeof vectors.participants)[number];

function appAnswers(responses: VectorPerson["responses"]): ScarfAnswers {
  return Object.fromEntries(Object.entries(responses).map(([questionId, answer]) => {
    if (Array.isArray(answer)) return [questionId, Object.fromEntries(answer.map((choice, index) => [choice, index + 1]))];
    return [questionId, answer];
  })) as ScarfAnswers;
}

function expectScoresClose(actual: ScarfDomainScores, expected: Record<string, number>) {
  for (const code of SCARF_DOMAIN_CODES) expect(actual[code]).toBeCloseTo(expected[code]!, 9);
}

describe("SCARF scoring v1.1.0", () => {
  it("uses the immutable bank's balanced mappings and v1.1 scoring version", () => {
    expect(questionBank.instrument_version).toBe("0.2.0");
    expect(questionBank.items).toHaveLength(30);
    const counts = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, { reaction: 0, tradeoff: 0, ranking: 0, pairA: 0, pairB: 0, rankA: 0, rankB: 0, rankC: 0 }])) as Record<string, Record<string, number>>;
    for (const item of questionBank.items) {
      if (item.type === "micro_reaction" && "domain" in item && item.domain) counts[item.domain]!.reaction += 1;
      else for (const [option, domain] of Object.entries(item.domain_options!)) {
        counts[domain]![item.type === "tradeoff" ? "tradeoff" : "ranking"] += 1;
        counts[domain]![item.type === "tradeoff" ? option === "A" ? "pairA" : "pairB" : `rank${option}`] += 1;
      }
    }
    for (const code of SCARF_DOMAIN_CODES) expect(counts[code]).toEqual({ reaction: 2, tradeoff: 4, ranking: 6, pairA: 2, pairB: 2, rankA: 2, rankB: 2, rankC: 2 });
  });

  it("matches all 20 supplied participant score vectors", () => {
    expect(vectors.dataset_label).toContain("SYNTHETIC TEST DATA ONLY");
    expect(vectors.scoring_version).toBe("1.1.0");
    expect(vectors.participants).toHaveLength(20);
    for (const person of vectors.participants) {
      const result = scoreScarfAnswers(appAnswers(person.responses));
      expectScoresClose(result.reaction, person.results.reaction_intensity);
      expectScoresClose(result.priority, person.results.driver_priority);
      expectScoresClose(result.integratedNeedsIndex, person.results.integrated_needs_index);
      expectScoresClose(result.integratedNeedsRank, person.results.integrated_needs_rank);
      expect(Object.values(result.priority).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 9);
      expect(Object.values(result.integratedNeedsIndex).reduce((sum, value) => sum + value, 0)).toBeCloseTo(27.5, 9);
    }
  });

  it("reproduces same-domain class means, class deltas and participant-weighted team means", () => {
    const people = vectors.participants.map((person) => ({ person, score: scoreScarfAnswers(appAnswers(person.responses)) }));
    const classMean = meanScarfProfiles(people.map(({ score }) => score.integratedNeedsIndex))!;
    expectScoresClose(classMean, vectors.class_aggregate.mean_index);
    const classRanks = descendingMidranks(classMean);
    expectScoresClose(classRanks, vectors.class_aggregate.rank);
    for (const { person, score } of people) {
      expectScoresClose(Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, score.integratedNeedsIndex[code] - classMean[code]])) as ScarfDomainScores,
        (vectors.class_deltas as Record<string, ScarfDomainScores>)[person.participant]);
    }
    for (const [team, expected] of Object.entries(vectors.team_aggregates)) {
      const profiles = people.filter(({ person }) => person.team === team).map(({ score }) => score.integratedNeedsIndex);
      expect(profiles).toHaveLength(expected.n);
      expectScoresClose(meanScarfProfiles(profiles)!, expected.mean_index);
    }
  });

  it("preserves midranks for ties and handles a fully flat profile without inventing a top domain", () => {
    expect(descendingMidranks({ S: 9, C: 9, A: 5, R: 2, F: 1 })).toEqual({ S: 1.5, C: 1.5, A: 3, R: 4, F: 5 });
    const flat = Object.fromEntries([
      ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 1).padStart(2, "0")}`, 5]),
      ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 11).padStart(2, "0")}`, "equal"]),
      ...Array.from({ length: 10 }, (_, index) => [`Q${String(index + 21).padStart(2, "0")}`, { A: 1, B: 2, C: 3 }]),
    ]) as ScarfAnswers;
    const score = scoreScarfAnswers(flat);
    expect(Object.values(score.integratedNeedsIndex)).toEqual([5.5, 5.5, 5.5, 5.5, 5.5]);
    expect(Object.values(score.integratedNeedsRank)).toEqual([3, 3, 3, 3, 3]);
  });

  it("removes order-preserving reaction scale differences from the integrated profile but preserves reported intensity", () => {
    const base = appAnswers(vectors.participants[0]!.responses);
    const extreme: Record<string, number> = { S: 1, C: 2, A: 4, R: 9, F: 10 };
    const moderate: Record<string, number> = { S: 5, C: 6, A: 7, R: 8, F: 9 };
    const apply = (values: Record<string, number>) => {
      const answers = { ...base };
      for (const question of questionBank.items) if (question.type === "micro_reaction" && "domain" in question && question.domain) answers[question.id] = values[question.domain];
      return scoreScarfAnswers(answers);
    };
    const highRange = apply(extreme);
    const midRange = apply(moderate);
    expect(highRange.reaction).not.toEqual(midRange.reaction);
    expect(highRange.integratedNeedsIndex).toEqual(midRange.integratedNeedsIndex);
  });

  it("rejects booleans, invalid answer enums, partial or repeated rankings", () => {
    const answers = appAnswers(vectors.participants[0]!.responses);
    expect(() => scoreScarfAnswers({ ...answers, Q01: true } as unknown as ScarfAnswers)).toThrow();
    expect(() => scoreScarfAnswers({ ...answers, Q11: "lean_C" } as unknown as ScarfAnswers)).toThrow();
    expect(() => scoreScarfAnswers({ ...answers, Q21: { A: 1, B: 1, C: 3 } } as ScarfAnswers)).toThrow();
    const partial = { ...answers };
    delete partial.Q30;
    expect(() => scoreScarfAnswers(partial)).toThrow();
  });
});
