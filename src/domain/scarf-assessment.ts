import questionBank from "../../reference_packs/SCARF_Product_Pack_v1.2/TrainerPoppKit_SCARF_Product_Pack_v1.2/docs/TrainerPoppKit_SCARF_QuestionBank_v0.2.en.json";

export const SCARF_INSTRUMENT_KEY = questionBank.key;
export const SCARF_INSTRUMENT_VERSION = questionBank.instrument_version;
// The question bank is still instrument v0.2.0; the current, separately
// versioned scoring contract is v1.1.0. Historical activities remain pinned
// to their original config version and are never silently relabelled.
export const SCARF_BANK_SCORING_VERSION = questionBank.scoring_version;
export const SCARF_SCORING_VERSION = "1.1.0";
export const SCARF_INSTRUMENT_STATUS = questionBank.status;

export const SCARF_DOMAIN_CODES = ["S", "C", "A", "R", "F"] as const;
export const SCARF_DOMAIN_NAMES = {
  S: "Status",
  C: "Certainty",
  A: "Autonomy",
  R: "Relatedness",
  F: "Fairness",
} as const;
export type ScarfDomainCode = (typeof SCARF_DOMAIN_CODES)[number];
export type ScarfDomainScores = Record<ScarfDomainCode, number>;
export type ScarfScoreSet = {
  reaction: ScarfDomainScores;
  tradeoff: ScarfDomainScores;
  ranking: ScarfDomainScores;
  priority: ScarfDomainScores;
  relativeSections: { reaction: ScarfDomainScores; tradeoff: ScarfDomainScores; ranking: ScarfDomainScores };
  integratedNeedsIndex: ScarfDomainScores;
  integratedNeedsRank: ScarfDomainScores;
};
export type ScarfAnswer = number | "strong_A" | "lean_A" | "equal" | "lean_B" | "strong_B" | Record<"A" | "B" | "C", number>;
export type ScarfAnswers = Record<string, ScarfAnswer>;

type BankQuestion = (typeof questionBank.items)[number];
type BankSection = (typeof questionBank.sections)[number];
type PairPreference = keyof typeof questionBank.scores.priority.pairwise_points;

const validPreferences = new Set<string>(["strong_A", "lean_A", "equal", "lean_B", "strong_B"]);
const byQuestionId = new Map<string, BankQuestion>(questionBank.items.map((item) => [item.id, item]));

/** Participant-safe question text. Scoring keys and dimension assignments never leave Worker code. */
export function publicScarfQuestions() {
  return questionBank.items.map((question) => {
    const visible = { ...question } as Record<string, unknown>;
    delete visible.domain;
    delete visible.domain_options;
    return visible;
  });
}

export function questionSection(questionId: string): BankSection | undefined {
  const question = byQuestionId.get(questionId);
  return question ? questionBank.sections.find((section) => section.id === question.section) : undefined;
}

export function isValidScarfAnswer(questionId: string, answer: unknown): answer is ScarfAnswer {
  const question = byQuestionId.get(questionId);
  if (!question) return false;
  if (question.type === "micro_reaction") return Number.isInteger(answer) && Number(answer) >= 1 && Number(answer) <= 10;
  if (question.type === "tradeoff") return typeof answer === "string" && validPreferences.has(answer);
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
  const ranking = answer as Record<string, unknown>;
  if (Object.keys(ranking).length !== 3 || !["A", "B", "C"].every((option) => Object.hasOwn(ranking, option))) return false;
  const values = [ranking.A, ranking.B, ranking.C];
  return values.every((value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3)
    && [...values].sort().join(",") === "1,2,3";
}

export function validateScarfAnswers(answers: unknown, complete = false): answers is ScarfAnswers {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
  const values = answers as Record<string, unknown>;
  if (Object.keys(values).some((questionId) => !byQuestionId.has(questionId))) return false;
  if (Object.entries(values).some(([questionId, answer]) => !isValidScarfAnswer(questionId, answer))) return false;
  return !complete || (Object.keys(values).length === questionBank.items.length && questionBank.items.every((question) => Object.hasOwn(values, question.id)));
}

const MIDRANK_TOLERANCE = 1e-9;

/** Higher values rank first; tied values receive the average of their occupied ranks. */
export function descendingMidranks(values: ScarfDomainScores): ScarfDomainScores {
  return Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => {
    const value = values[code];
    const others = SCARF_DOMAIN_CODES.filter((other) => other !== code).map((other) => values[other]);
    const higher = others.filter((other) => other > value + MIDRANK_TOLERANCE).length;
    const ties = 1 + others.filter((other) => Math.abs(other - value) <= MIDRANK_TOLERANCE).length;
    return [code, 1 + higher + (ties - 1) / 2];
  })) as ScarfDomainScores;
}

export function withinSectionNeedsIndex(values: ScarfDomainScores): ScarfDomainScores {
  const ranks = descendingMidranks(values);
  return Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, (5 - ranks[code]) / 4])) as ScarfDomainScores;
}

export function meanScarfProfiles(profiles: ScarfDomainScores[]): ScarfDomainScores | null {
  if (!profiles.length) return null;
  return Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [
    code,
    profiles.reduce((total, profile) => total + profile[code], 0) / profiles.length,
  ])) as ScarfDomainScores;
}

export function scoreScarfAnswers(answers: ScarfAnswers): ScarfScoreSet {
  if (!validateScarfAnswers(answers, true)) throw new Error("All 30 valid SCARF responses are required.");

  const reactionValues: Record<ScarfDomainCode, number[]> = { S: [], C: [], A: [], R: [], F: [] };
  const pairTotals: ScarfDomainScores = { S: 0, C: 0, A: 0, R: 0, F: 0 };
  const rankTotals: ScarfDomainScores = { S: 0, C: 0, A: 0, R: 0, F: 0 };

  for (const question of questionBank.items) {
    const answer = answers[question.id]!;
    if (question.type === "micro_reaction") {
      reactionValues[question.domain as ScarfDomainCode].push(answer as number);
    } else if (question.type === "tradeoff") {
      const allocation = questionBank.scores.priority.pairwise_points[answer as PairPreference];
      const options = question.domain_options!;
      pairTotals[options.A as ScarfDomainCode] += allocation[0];
      pairTotals[options.B as ScarfDomainCode] += allocation[1];
    } else {
      const ranking = answer as Record<"A" | "B" | "C", number>;
      const points = questionBank.scores.priority.rank_points;
      for (const option of ["A", "B", "C"] as const) {
        rankTotals[question.domain_options![option] as ScarfDomainCode] += points[ranking[option] - 1]!;
      }
    }
  }

  const reaction = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => {
    const values = reactionValues[code];
    if (values.length !== 2) throw new Error(`Unexpected reaction item count for ${code}.`);
    return [code, values.reduce((sum, value) => sum + value, 0) / values.length];
  })) as ScarfDomainScores;
  const tradeoff = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, pairTotals[code] / questionBank.scores.priority.B_d_divisor])) as ScarfDomainScores;
  const ranking = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [code, rankTotals[code] / questionBank.scores.priority.T_d_divisor])) as ScarfDomainScores;
  const priority = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => {
    return [code, 1 + 9 * (0.5 * tradeoff[code] + 0.5 * ranking[code])];
  })) as ScarfDomainScores;
  const relativeSections = {
    reaction: withinSectionNeedsIndex(reaction),
    tradeoff: withinSectionNeedsIndex(tradeoff),
    ranking: withinSectionNeedsIndex(ranking),
  };
  const integratedNeedsIndex = Object.fromEntries(SCARF_DOMAIN_CODES.map((code) => [
    code,
    1 + 9 * (relativeSections.reaction[code] + relativeSections.tradeoff[code] + relativeSections.ranking[code]) / 3,
  ])) as ScarfDomainScores;
  const integratedNeedsRank = descendingMidranks(integratedNeedsIndex);
  return { reaction, tradeoff, ranking, priority, relativeSections, integratedNeedsIndex, integratedNeedsRank };
}

export const SCARF_QUESTION_COUNT = questionBank.items.length;
