import seed from "../../config/learning_behaviors.seed.json";

export const LBR_TOOL_ID = "learning-behaviors-reflection" as const;
export const LBR_TOOL_TITLE = "Learning Behaviors Reflection";

export const LEARNING_BEHAVIOR_KEYS = [
  "asking_questions", "sharing_information", "seeking_help", "experimenting", "talking_about_mistakes", "seeking_feedback",
] as const;

export type BehaviorKey = (typeof LEARNING_BEHAVIOR_KEYS)[number];
export type LbrBehaviorCopy = { key: BehaviorKey; number: number; name: string; shortName: string; description: string; example: string; reflectionPrompt: string };

export const LEARNING_BEHAVIORS: LbrBehaviorCopy[] = seed.behaviors.map((item) => ({
  key: item.key as BehaviorKey,
  number: item.number,
  name: item.name,
  shortName: item.short_name,
  description: item.description_vi,
  example: item.example_vi,
  reflectionPrompt: item.reflection_prompt_vi,
}));

export type LearningBehavior = LbrBehaviorCopy;
export type LbrRating = number | "NA" | null;
export type LbrAnswers = Partial<Record<BehaviorKey, LbrRating>>;

export const LBR_SCALE = [
  { value: 1, label: "Chưa bao giờ / Gần như không", labelEn: "Never / Almost never" },
  { value: 2, label: "Hiếm khi", labelEn: "Rarely" },
  { value: 3, label: "Thỉnh thoảng", labelEn: "Sometimes" },
  { value: 4, label: "Thường xuyên", labelEn: "Often" },
  { value: 5, label: "Gần như mỗi khi có cơ hội", labelEn: "Almost whenever there is an opportunity" },
] as const;

export const LBR_NA_LABEL = "Chưa đủ cơ hội quan sát/đánh giá";

export function isLbrRating(value: unknown, allowDraft = false): value is LbrRating {
  if (allowDraft && value === null) return true;
  return value === "NA" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5);
}

export function validateLbrAnswers(answers: unknown): answers is Record<BehaviorKey, Exclude<LbrRating, null>> {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
  const entries = Object.entries(answers);
  return entries.length === LEARNING_BEHAVIORS.length && LEARNING_BEHAVIORS.every(({ key }) =>
    Object.hasOwn(answers, key) && isLbrRating((answers as Record<string, unknown>)[key])
  ) && entries.every(([key]) => LEARNING_BEHAVIORS.some((behavior) => behavior.key === key));
}

export type NumericSummary = { mean: number | null; validN: number; naN: number };

export function summarizeRatings(values: readonly LbrRating[]): NumericSummary {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5);
  return {
    mean: numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null,
    validN: numeric.length,
    naN: values.filter((value) => value === "NA").length,
  };
}

export function summarizePeerRounds(rounds: readonly Record<BehaviorKey, Exclude<LbrRating, null>>[]) {
  return Object.fromEntries(LEARNING_BEHAVIORS.map(({ key }) => [
    key,
    summarizeRatings(rounds.map((round) => round[key])),
  ])) as Record<BehaviorKey, NumericSummary>;
}

export function summarizeGroupSelf(owners: readonly { locked: boolean; answers: LbrAnswers }[]) {
  const eligible = owners.filter((owner) => owner.locked);
  return {
    lockedCount: eligible.length,
    behaviors: Object.fromEntries(LEARNING_BEHAVIORS.map(({ key }) => [
      key,
      summarizeRatings(eligible.map((owner) => owner.answers[key] ?? null)),
    ])) as Record<BehaviorKey, NumericSummary>,
  };
}

export function meanParticipantPeerMeans(values: readonly NumericSummary[]): NumericSummary {
  const means = values.filter((value) => value.mean !== null).map((value) => value.mean!);
  return { mean: means.length ? means.reduce((sum, value) => sum + value, 0) / means.length : null, validN: means.length, naN: 0 };
}

export function formatLbrMean(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
