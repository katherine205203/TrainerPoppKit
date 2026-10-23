export type PollQuestionType = "single" | "multiple";
export type PollIdentityMode = "anonymous" | "named";
export type PollResultsMode = "presenter_only" | "presenter_and_participant";

export type PollConfigInput = {
  title: string;
  question: string;
  questionType: PollQuestionType;
  options: string[];
  maxSelections: number;
  allowOther: boolean;
  identityMode: PollIdentityMode;
  participantResultsMode: PollResultsMode;
};

export type PollOption = { id: string; label: string; sortOrder: number; isOther: boolean };
export type PollSelection = { optionId: string; otherText?: string };

export function normalizedOptionLabel(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

export function validatePollDraft(input: PollConfigInput): string[] {
  const errors: string[] = [];
  const title = input.title.trim();
  const question = input.question.trim();
  if (!title || title.length > 120) errors.push("Poll name must be between 1 and 120 characters.");
  if (!question || question.length > 250) errors.push("Question must be between 1 and 250 characters.");
  if (input.options.length + Number(input.allowOther) > 10) errors.push("A Poll can have at most 10 answer options including Other.");
  if (input.options.some((option) => !option.trim() || option.trim().length > 120)) errors.push("Every answer option must contain 1–120 characters.");
  const normalized = input.options.map(normalizedOptionLabel);
  if (new Set(normalized).size !== normalized.length) errors.push("Answer options must be unique.");
  if (input.questionType === "single" && input.maxSelections !== 1) errors.push("Single choice must allow exactly one answer.");
  if (input.questionType === "multiple" && (input.maxSelections < 1 || input.maxSelections > 10)) errors.push("Choose a valid maximum number of answers.");
  return errors;
}

export function validatePollForOpen(input: PollConfigInput): string[] {
  const errors = validatePollDraft(input);
  const totalOptions = input.options.length + Number(input.allowOther);
  if (totalOptions < 2) errors.push("Add at least two answer options before opening this Poll.");
  if (input.questionType === "multiple" && input.maxSelections > totalOptions) errors.push("Maximum selections cannot exceed the number of answer options.");
  return errors;
}

export function validatePollSelection(
  type: PollQuestionType,
  maxSelections: number,
  options: PollOption[],
  selections: PollSelection[],
): string[] {
  const errors: string[] = [];
  if (!selections.length) errors.push("Select at least one answer.");
  if (type === "single" && selections.length !== 1) errors.push("Select exactly one answer.");
  if (selections.length > maxSelections) errors.push(`Select no more than ${maxSelections} answers.`);
  const ids = selections.map((selection) => selection.optionId);
  if (new Set(ids).size !== ids.length) errors.push("An answer can only be selected once.");
  const byId = new Map(options.map((option) => [option.id, option]));
  for (const selection of selections) {
    const option = byId.get(selection.optionId);
    if (!option) errors.push("One or more selected answers are not part of this Poll.");
    else if (option.isOther && !selection.otherText?.trim()) errors.push("Add a short response for Other.");
    else if (option.isOther && (selection.otherText?.trim().length ?? 0) > 150) errors.push("Other responses must be 150 characters or fewer.");
    else if (!option.isOther && selection.otherText) errors.push("Other text is only allowed with the Other option.");
  }
  return [...new Set(errors)];
}

export function calculatePollResults(options: PollOption[], responses: Array<{ selections: string[] }>) {
  const respondentCount = responses.length;
  return options.map((option) => {
    const count = responses.filter((response) => response.selections.includes(option.id)).length;
    return {
      optionId: option.id,
      label: option.label,
      isOther: option.isOther,
      count,
      percentage: respondentCount ? Math.round(count / respondentCount * 100) : 0,
    };
  });
}

export function safeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const csv = [headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
  return `\uFEFF${csv}\r\n`;
}
