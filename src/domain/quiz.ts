export type QuizQuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "REORDER" | "MATCH_PAIRS";
export type QuizRunType = "LIVE" | "SELF_PACED";
export type QuizCompetition = "INDIVIDUAL" | "TEAM";
export type QuizHosting = "MANUAL" | "AUTOMATIC";
export type QuizScoring = "ACCURACY" | "ACCURACY_SPEED";
export type HopeMultiplier = 1 | 2 | 3;
export type QuizOption = { id: string; label: string };
type QuizQuestionBase = { id: string; stem: string; explanation: string; hopeMultiplier: HopeMultiplier };
export type ChoiceQuizQuestion = QuizQuestionBase & {
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE";
  options: QuizOption[];
  correctOptionIds: string[];
};
export type ReorderQuizQuestion = QuizQuestionBase & {
  type: "REORDER";
  items: QuizOption[];
  correctOrderItemIds: string[];
};
export type MatchPair = { id: string; leftId: string; leftText: string; rightId: string; rightText: string };
export type MatchPairsQuizQuestion = QuizQuestionBase & { type: "MATCH_PAIRS"; pairs: MatchPair[] };
export type QuizQuestion = ChoiceQuizQuestion | ReorderQuizQuestion | MatchPairsQuizQuestion;
export type QuizContent = {
  title: string;
  description: string;
  sharedLiveTimerMs: number;
  sharedBasePoints: number;
  questions: QuizQuestion[];
};
export type GradingStatus = "UNANSWERED" | "INCORRECT" | "PARTIALLY_CORRECT" | "CORRECT";
export type AnswerGrade = { correctParts: number; totalParts: number; correctnessRatio: number; fullyCorrect: boolean; gradingStatus: GradingStatus };

/** Stable Match Pairs answer token. IDs are UUID-like and cannot contain this separator. */
export function matchAnswerToken(leftId: string, rightId: string): string { return `${leftId}::${rightId}`; }
export function parseMatchAnswerToken(token: string): [string, string] | null {
  const split = token.indexOf("::");
  return split > 0 && split < token.length - 2 ? [token.slice(0, split), token.slice(split + 2)] : null;
}
export function correctAnswerIds(question: QuizQuestion): string[] {
  if (question.type === "REORDER") return question.correctOrderItemIds;
  if (question.type === "MATCH_PAIRS") return question.pairs.map((pair) => matchAnswerToken(pair.leftId, pair.rightId));
  return question.correctOptionIds;
}

export function validateQuiz(content: QuizContent): string[] {
  const errors: string[] = [];
  if (!content.title?.trim() || content.title.length > 100) errors.push("Give the quiz a title of at most 100 characters.");
  if (content.description?.length > 500) errors.push("Keep the description below 500 characters.");
  if (!Number.isInteger(content.sharedLiveTimerMs) || content.sharedLiveTimerMs < 5000 || content.sharedLiveTimerMs > 300000) errors.push("Choose one Live timer between 5 and 300 seconds.");
  if (!Number.isInteger(content.sharedBasePoints) || content.sharedBasePoints < 1 || content.sharedBasePoints > 100000) errors.push("Choose a positive shared base score.");
  if (!Array.isArray(content.questions) || content.questions.length < 1 || content.questions.length > 100) errors.push("Add 1 to 100 questions.");
  const seenQuestions = new Set<string>();
  for (const [index, question] of (content.questions ?? []).entries()) {
    const prefix = `Question ${index + 1}`;
    if (!question.id || seenQuestions.has(question.id)) errors.push(`${prefix}: question ID must be unique.`);
    seenQuestions.add(question.id);
    if (!question.stem?.trim() || question.stem.length > 1000) errors.push(`${prefix}: add a question of at most 1000 characters.`);
    if (!([1, 2, 3] as number[]).includes(question.hopeMultiplier)) errors.push(`${prefix}: Hope must be x1, x2, or x3.`);
    if (question.explanation?.length > 2000) errors.push(`${prefix}: explanation is too long.`);
    if (question.type === "REORDER") {
      const ids = new Set<string>();
      if (question.items.length < 3 || question.items.length > 6) errors.push(`${prefix}: Reorder needs 3–6 items.`);
      for (const item of question.items) {
        if (!item.id || ids.has(item.id) || !item.label?.trim() || item.label.length > 300) errors.push(`${prefix}: Reorder items need unique IDs and nonempty text.`);
        ids.add(item.id);
      }
      if (question.correctOrderItemIds.length !== question.items.length || new Set(question.correctOrderItemIds).size !== question.items.length || question.correctOrderItemIds.some((id) => !ids.has(id))) errors.push(`${prefix}: arrange every Reorder item once in the correct sequence.`);
      continue;
    }
    if (question.type === "MATCH_PAIRS") {
      const pairs = question.pairs ?? [], pairIds = new Set<string>(), leftIds = new Set<string>(), rightIds = new Set<string>();
      const leftText = new Set<string>(), rightText = new Set<string>();
      if (pairs.length < 2 || pairs.length > 5) errors.push(`${prefix}: Match Pairs needs 2–5 pairs.`);
      for (const pair of pairs) {
        if (!pair.id || pairIds.has(pair.id) || !pair.leftId || leftIds.has(pair.leftId) || !pair.rightId || rightIds.has(pair.rightId)) errors.push(`${prefix}: each pair needs distinct stable IDs.`);
        if (!pair.leftText?.trim() || pair.leftText.length > 300 || !pair.rightText?.trim() || pair.rightText.length > 300) errors.push(`${prefix}: enter text for both sides of every pair.`);
        if (leftText.has(pair.leftText.trim().toLocaleLowerCase()) || rightText.has(pair.rightText.trim().toLocaleLowerCase())) errors.push(`${prefix}: pair text must be unique on each side.`);
        pairIds.add(pair.id); leftIds.add(pair.leftId); rightIds.add(pair.rightId);
        leftText.add(pair.leftText.trim().toLocaleLowerCase()); rightText.add(pair.rightText.trim().toLocaleLowerCase());
      }
      continue;
    }
    if (!(question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE" || question.type === "TRUE_FALSE")) {
      errors.push(`${prefix}: choose one of the five supported question types.`);
      continue;
    }
    if (!Array.isArray(question.options) || (question.type === "TRUE_FALSE" ? question.options.length !== 2 : question.options.length < 2 || question.options.length > 6)) errors.push(`${prefix}: add 2–6 text options.`);
    const optionIds = new Set<string>();
    for (const option of question.options ?? []) {
      if (!option.id || optionIds.has(option.id) || !option.label?.trim() || option.label.length > 300) errors.push(`${prefix}: options need unique IDs and nonempty labels.`);
      optionIds.add(option.id);
    }
    if (question.type === "TRUE_FALSE" && (question.options?.[0]?.id !== "true" || question.options?.[0]?.label !== "True" || question.options?.[1]?.id !== "false" || question.options?.[1]?.label !== "False")) errors.push(`${prefix}: True/False must use the fixed choices.`);
    const key = question.correctOptionIds ?? [];
    if (new Set(key).size !== key.length || key.some((id) => !optionIds.has(id))) errors.push(`${prefix}: correct choices must refer to distinct options.`);
    if (question.type === "MULTIPLE_CHOICE" ? key.length < 2 : key.length !== 1) errors.push(`${prefix}: choose ${question.type === "MULTIPLE_CHOICE" ? "at least two" : "exactly one"} correct choice${question.type === "MULTIPLE_CHOICE" ? "s" : ""}.`);
  }
  return errors;
}

export function gradeAnswer(question: QuizQuestion, selected: readonly string[], key = correctAnswerIds(question), interacted = true): AnswerGrade {
  if (!selected.length || !interacted) return { correctParts: 0, totalParts: question.type === "REORDER" ? question.items.length : question.type === "MATCH_PAIRS" ? question.pairs.length : 1, correctnessRatio: 0, fullyCorrect: false, gradingStatus: "UNANSWERED" };
  let correctParts: number, totalParts = 1;
  if (question.type === "REORDER") {
    totalParts = question.items.length;
    correctParts = Math.min(totalParts, Math.max(0, selected.reduce((count, id, index) => count + Number(id === key[index]), 0)));
  } else if (question.type === "MATCH_PAIRS") {
    totalParts = question.pairs.length;
    const accepted = new Set(key);
    correctParts = Math.min(totalParts, new Set(selected.filter((token) => accepted.has(token))).size);
  } else {
    correctParts = new Set(selected).size === key.length && selected.length === key.length && selected.every((id) => key.includes(id)) ? 1 : 0;
  }
  const correctnessRatio = totalParts ? correctParts / totalParts : 0;
  const fullyCorrect = correctnessRatio === 1;
  return { correctParts, totalParts, correctnessRatio, fullyCorrect, gradingStatus: fullyCorrect ? "CORRECT" : correctParts > 0 ? "PARTIALLY_CORRECT" : "INCORRECT" };
}

export function correctChoice(question: QuizQuestion, selected: readonly string[]): boolean {
  return gradeAnswer(question, selected).fullyCorrect;
}

type PointsInput = { basePoints: number; hopeMultiplier: HopeMultiplier; scoringMode: QuizScoring; durationMs: number | null; elapsedMs: number | null } & ({ isCorrect: boolean; accuracyRatio?: number } | { accuracyRatio: number; isCorrect?: boolean });
export function questionPoints(input: PointsInput): number {
  const accuracy = input.accuracyRatio === undefined ? Number(Boolean(input.isCorrect)) : Math.max(0, Math.min(1, input.accuracyRatio));
  if (accuracy === 0) return 0;
  const speed = input.scoringMode === "ACCURACY_SPEED" && input.durationMs && input.elapsedMs !== null
    ? 1 + (input.durationMs - Math.max(0, Math.min(input.durationMs, input.elapsedMs))) / input.durationMs
    : 1;
  return Math.floor(input.basePoints * accuracy * input.hopeMultiplier * speed + 0.5);
}

export type IndividualStanding = { id: string; nickname: string; teamId?: string | null; points: number; correct: number; dq?: boolean; rank?: number };
export type TeamStanding = { id: string; name: string; members: number; sumPoints: number; sumCorrect: number; averagePoints: number | null; averageCorrect: number | null; rank?: number };

export function rankIndividuals(entries: IndividualStanding[]): IndividualStanding[] {
  const sorted = entries.filter((entry) => !entry.dq).map((entry) => ({ ...entry })).sort((a, b) => b.points - a.points || b.correct - a.correct || a.nickname.localeCompare(b.nickname));
  sorted.forEach((entry, index) => { entry.rank = index && entry.points === sorted[index - 1]!.points && entry.correct === sorted[index - 1]!.correct ? sorted[index - 1]!.rank : index + 1; });
  return sorted;
}

export function rankTeams(teams: { id: string; name: string }[], people: IndividualStanding[]): TeamStanding[] {
  const ranked: TeamStanding[] = teams.map((team) => {
    const members = people.filter((person) => person.teamId === team.id && !person.dq);
    const sumPoints = members.reduce((sum, person) => sum + person.points, 0);
    const sumCorrect = members.reduce((sum, person) => sum + person.correct, 0);
    return { ...team, members: members.length, sumPoints, sumCorrect, averagePoints: members.length ? sumPoints / members.length : null, averageCorrect: members.length ? sumCorrect / members.length : null };
  }).filter((team) => team.members > 0);
  ranked.sort((a, b) => b.sumPoints * a.members - a.sumPoints * b.members || b.sumCorrect * a.members - a.sumCorrect * b.members || a.name.localeCompare(b.name));
  ranked.forEach((entry, index) => { const prev = ranked[index - 1]; entry.rank = prev && entry.sumPoints * prev.members === prev.sumPoints * entry.members && entry.sumCorrect * prev.members === prev.sumCorrect * entry.members ? prev.rank : index + 1; });
  return ranked;
}

export function duplicateQuestion(question: QuizQuestion): QuizQuestion {
  const id = () => crypto.randomUUID();
  if (question.type === "REORDER") {
    const mapping = new Map(question.items.map((item) => [item.id, id()]));
    return { ...question, id: id(), items: question.items.map((item) => ({ ...item, id: mapping.get(item.id)! })), correctOrderItemIds: question.correctOrderItemIds.map((itemId) => mapping.get(itemId)!) };
  }
  if (question.type === "MATCH_PAIRS") return { ...question, id: id(), pairs: question.pairs.map((pair) => ({ ...pair, id: id(), leftId: id(), rightId: id() })) };
  const mapping = new Map(question.options.map((option) => [option.id, question.type === "TRUE_FALSE" ? option.id : id()]));
  return { ...question, id: id(), options: question.options.map((option) => ({ ...option, id: mapping.get(option.id)! })), correctOptionIds: question.correctOptionIds.map((optionId) => mapping.get(optionId)!) };
}
