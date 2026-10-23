export const WORDCLOUD_MAX_WORDS = 10;
export const WORDCLOUD_MAX_GRAPHEMES = 40;

export type WordCloudWord = { original: string; normalized: string; key: string; graphemes: number };
export type WordCloudErrorCode = "EMPTY_RESPONSES" | "TOO_MANY_WORDS" | "WORD_TOO_LONG" | "DUPLICATE_WORD";
export type WordCloudValidation = { ok: true; words: WordCloudWord[] } | { ok: false; code: WordCloudErrorCode; index?: number; message: string };

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function countGraphemes(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export function normalizeWord(value: string): WordCloudWord {
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return {
    original: value,
    normalized,
    key: normalized.toLowerCase(),
    graphemes: countGraphemes(normalized),
  };
}

export function validateWordSubmission(value: unknown, maxWords: number): WordCloudValidation {
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > WORDCLOUD_MAX_WORDS) {
    return { ok: false, code: "TOO_MANY_WORDS", message: "This activity has an invalid word limit." };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, code: "EMPTY_RESPONSES", message: "Add at least one word or short phrase." };
  }
  if (value.length > maxWords) {
    return { ok: false, code: "TOO_MANY_WORDS", message: `Add no more than ${maxWords} words or phrases.` };
  }
  if (!value.every((word) => typeof word === "string")) {
    return { ok: false, code: "EMPTY_RESPONSES", message: "Every response must be text." };
  }
  const words = (value as string[]).map(normalizeWord);
  const emptyIndex = words.findIndex((word) => !word.normalized);
  if (emptyIndex >= 0) return { ok: false, code: "EMPTY_RESPONSES", index: emptyIndex, message: "Fill in each response or remove the empty one." };
  const longIndex = words.findIndex((word) => word.graphemes > WORDCLOUD_MAX_GRAPHEMES);
  if (longIndex >= 0) return { ok: false, code: "WORD_TOO_LONG", index: longIndex, message: "Each word or phrase can be up to 40 characters." };
  const seen = new Set<string>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (seen.has(word.key)) return { ok: false, code: "DUPLICATE_WORD", index, message: "You have entered this word more than once." };
    seen.add(word.key);
  }
  return { ok: true, words };
}

export type WordCloudTerm = { id: string; label: string; normalizedKey: string };
export type WordCloudGroup = { id: string; label: string; hidden: boolean };
export type WordCloudSubmission = { id: string; teamId: string | null; termIds: string[] };
export type WordCloudAggregateTerm = {
  groupId: string;
  label: string;
  frequency: number;
  percentage: number | null;
  visible: boolean;
  mergedSourceLabels: string[];
};

export function aggregateWordCloud(input: {
  submissions: WordCloudSubmission[];
  terms: WordCloudTerm[];
  groups: WordCloudGroup[];
  membership: Record<string, string>;
  teamId?: string | null;
}) {
  const submissions = input.submissions.filter((submission) => !input.teamId || submission.teamId === input.teamId);
  const denominator = submissions.length;
  const termsById = new Map(input.terms.map((term) => [term.id, term]));
  const termsByGroup = new Map<string, Set<string>>();
  for (const [termId, groupId] of Object.entries(input.membership)) {
    const label = termsById.get(termId)?.label;
    if (label) (termsByGroup.get(groupId) ?? (termsByGroup.set(groupId, new Set()), termsByGroup.get(groupId)!)).add(label);
  }
  const submittersByGroup = new Map<string, Set<string>>();
  for (const submission of submissions) {
    for (const termId of new Set(submission.termIds)) {
      const groupId = input.membership[termId];
      if (groupId) (submittersByGroup.get(groupId) ?? (submittersByGroup.set(groupId, new Set()), submittersByGroup.get(groupId)!)).add(submission.id);
    }
  }
  const ordered = [...input.groups].map((group): WordCloudAggregateTerm => {
    const labels = [...(termsByGroup.get(group.id) ?? [])].sort((a, b) => a.localeCompare(b, "vi"));
    const frequency = submittersByGroup.get(group.id)?.size ?? 0;
    return {
      groupId: group.id,
      label: group.label,
      frequency,
      percentage: denominator ? Math.round(frequency / denominator * 1000) / 10 : null,
      visible: !group.hidden,
      mergedSourceLabels: labels.filter((label) => normalizeWord(label).key !== normalizeWord(group.label).key),
    };
  }).sort((a, b) => b.frequency - a.frequency || a.label.localeCompare(b.label, "vi") || a.groupId.localeCompare(b.groupId));
  const visibleTerms = ordered.filter((term) => term.visible);
  const hiddenTerms = ordered.filter((term) => !term.visible);
  return {
    denominator,
    visibleTerms,
    hiddenTerms,
    cloudTop50: visibleTerms.filter((term) => term.frequency > 0).slice(0, 50),
  };
}

export type WordCloudMergeSnapshot = {
  groups: WordCloudGroup[];
  membership: Record<string, string>;
};

export function mergeWordCloudGroups(
  state: WordCloudMergeSnapshot,
  sourceGroupIds: string[],
  destinationGroupId: string,
  destinationLabel: string,
): { state: WordCloudMergeSnapshot; before: WordCloudMergeSnapshot } | { error: string } {
  const sources = new Set(sourceGroupIds.filter((id) => id !== destinationGroupId));
  const affected = new Set([...sources, destinationGroupId]);
  if (sources.size === 0 || !destinationLabel.trim()) return { error: "Choose at least one source word and a destination label." };
  const selected = state.groups.filter((group) => affected.has(group.id));
  if (selected.length !== affected.size) return { error: "One or more words are no longer available. Refresh and try again." };
  if (new Set(selected.map((group) => group.hidden)).size > 1) return { error: "Restore hidden words before merging them with visible words." };
  const before: WordCloudMergeSnapshot = {
    groups: selected.map((group) => ({ ...group })),
    membership: Object.fromEntries(Object.entries(state.membership).filter(([, groupId]) => affected.has(groupId))),
  };
  const membership = { ...state.membership };
  for (const [termId, groupId] of Object.entries(membership)) if (affected.has(groupId)) membership[termId] = destinationGroupId;
  const groups = state.groups.map((group) => group.id === destinationGroupId ? { ...group, label: destinationLabel.trim() } : group);
  return { state: { groups, membership }, before };
}

export function restoreWordCloudMerge(state: WordCloudMergeSnapshot, before: WordCloudMergeSnapshot, destinationGroupId: string): WordCloudMergeSnapshot {
  const restoredMembership = { ...state.membership };
  const affectedGroups = new Set(before.groups.map((group) => group.id));
  for (const [termId, groupId] of Object.entries(restoredMembership)) if (affectedGroups.has(groupId)) delete restoredMembership[termId];
  Object.assign(restoredMembership, before.membership);
  const destinationIsHidden = Boolean(state.groups.find((group) => group.id === destinationGroupId)?.hidden);
  const restoredGroups = new Map(before.groups.map((group) => [group.id, { ...group, hidden: destinationIsHidden }]));
  return {
    groups: state.groups.map((group) => restoredGroups.get(group.id) ?? group),
    membership: restoredMembership,
  };
}

export function safeWordCloudCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^\s*[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function wordCloudCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeWordCloudCsvCell).join(",")).join("\r\n")}\r\n`;
}
