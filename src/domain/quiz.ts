export type QuizQuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE";
export type QuizRunType = "LIVE" | "SELF_PACED";
export type QuizCompetition = "INDIVIDUAL" | "TEAM";
export type QuizHosting = "MANUAL" | "AUTOMATIC";
export type QuizScoring = "ACCURACY" | "ACCURACY_SPEED";
export type QuizQuestion = {
  id: string;
  type: QuizQuestionType;
  stem: string;
  options: { id: string; label: string }[];
  correctOptionIds: string[];
  explanation: string;
  hopeMultiplier: 1 | 2 | 3;
};
export type QuizContent = {
  title: string;
  description: string;
  sharedLiveTimerMs: number;
  sharedBasePoints: number;
  questions: QuizQuestion[];
};

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
    if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(question.type)) errors.push(`${prefix}: unsupported question type.`);
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

export function correctChoice(question: Pick<QuizQuestion, "type" | "correctOptionIds">, selected: readonly string[]): boolean {
  if (new Set(selected).size !== selected.length || selected.length !== question.correctOptionIds.length) return false;
  return selected.every((id) => question.correctOptionIds.includes(id));
}

export function questionPoints(input: { basePoints: number; hopeMultiplier: 1 | 2 | 3; scoringMode: QuizScoring; durationMs: number | null; elapsedMs: number | null; isCorrect: boolean }): number {
  if (!input.isCorrect) return 0;
  const speed = input.scoringMode === "ACCURACY_SPEED" && input.durationMs && input.elapsedMs !== null
    ? 1 + (input.durationMs - Math.max(0, Math.min(input.durationMs, input.elapsedMs))) / input.durationMs
    : 1;
  return Math.floor(input.basePoints * input.hopeMultiplier * speed + 0.5);
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
