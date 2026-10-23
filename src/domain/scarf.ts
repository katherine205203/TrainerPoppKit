export const SCARF_DIMENSIONS = [
  "Status",
  "Certainty",
  "Autonomy",
  "Relatedness",
  "Fairness",
] as const;

export const SCARF_COLORS = ["#ff5b22", "#aee6ed", "#3939ff", "#ff6bcb", "#c98cff"] as const;

export type ScarfDimension = (typeof SCARF_DIMENSIONS)[number];
export type DemoAnswers = Record<number, number>;
export type DemoScores = Record<ScarfDimension, number>;

/** Placeholder wording for interface and flow validation only. Not a licensed or validated instrument. */
export const DEMO_ITEMS = [
  { id: 1, dimension: "Status", prompt: "Recognition helps me stay engaged." },
  { id: 2, dimension: "Certainty", prompt: "Knowing what to expect helps me contribute." },
  { id: 3, dimension: "Autonomy", prompt: "I have choices in how I approach my work." },
  { id: 4, dimension: "Relatedness", prompt: "Feeling included helps me do my best." },
  { id: 5, dimension: "Fairness", prompt: "Fair decisions help me trust a group." },
] as const;

export function validateDemoAnswers(input: unknown, requireComplete = false): input is DemoAnswers {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const entries = Object.entries(input);
  if (entries.length > DEMO_ITEMS.length) return false;
  for (const [key, value] of entries) {
    if (!/^[1-5]$/.test(key) || !Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) return false;
  }
  return !requireComplete || DEMO_ITEMS.every((item) => Number.isInteger((input as DemoAnswers)[item.id]));
}

export function scoreDemoResponses(answers: DemoAnswers): DemoScores {
  return Object.fromEntries(
    DEMO_ITEMS.map((item) => [item.dimension, answers[item.id]]),
  ) as DemoScores;
}

export type RelativeTier = "lower quartile" | "middle range" | "upper quartile";

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/** Uses inclusive sample quantiles and preserves ties; never forces exact 25% buckets. */
export function relativeTier(value: number, peerValues: number[]): RelativeTier {
  const sorted = [...peerValues].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return "middle range";
  const lower = quantile(sorted, 0.25);
  const upper = quantile(sorted, 0.75);
  if (value < lower) return "lower quartile";
  if (value > upper) return "upper quartile";
  return "middle range";
}

export function smallGroupWarning(participantCount: number): string | null {
  return participantCount < 8
    ? "Small group: quartile labels are illustrative and unstable at this sample size."
    : null;
}
