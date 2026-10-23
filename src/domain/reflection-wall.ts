export const REFLECTION_REACTIONS = [
  { id: "heart", label: "Tim", emoji: "❤️" },
  { id: "clap", label: "Vỗ tay", emoji: "👏" },
  { id: "haha", label: "Haha", emoji: "😄" },
  { id: "sad", label: "Buồn", emoji: "😢" },
  { id: "empathy", label: "Đồng cảm", emoji: "🫶" },
  { id: "inspireful", label: "Inspireful", emoji: "💡" },
] as const;

export const REFLECTION_COLORS = ["gold", "pink", "aqua", "purple"] as const;
export type ReflectionReaction = (typeof REFLECTION_REACTIONS)[number]["id"];
export type ReflectionPhase = "DRAFT" | "OPEN" | "PAUSED" | "CLOSED" | "ARCHIVED";
export type ReflectionPresentationMode = "off" | "all" | "focus" | "spotlight" | "cluster" | "blank";

export type ReflectionColumnInput = { title: string; question: string };
export type ReflectionCreateInput = {
  title: string;
  description: string;
  identityMode: "anonymous" | "named";
  postLimit: number;
  sessionId: string | null;
  columns: ReflectionColumnInput[];
};

export function validateReflectionColumns(value: unknown): { ok: true; columns: ReflectionColumnInput[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return { ok: false, message: "Create between one and four reflection columns." };
  const columns: ReflectionColumnInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false, message: "Each column needs a title and question." };
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!title || title.length > 30 || question.length > 200) return { ok: false, message: "Column titles are required (30 characters max); questions can be up to 200 characters." };
    columns.push({ title, question });
  }
  return { ok: true, columns };
}

export function validateReflectionText(value: unknown, max: number): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "Enter text to continue." };
  const text = value.trim();
  if (!text) return { ok: false, message: "Enter text to continue." };
  if (Array.from(text).length > max) return { ok: false, message: `Keep this to ${max} characters or fewer.` };
  if (Array.from(text).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127;
  })) return { ok: false, message: "Remove unsupported control characters." };
  return { ok: true, text };
}

export function safeReflectionCsvCell(value: unknown): string {
  let text = String(value ?? "").replace(/[\r\n]+/gu, " ");
  if (/^[=+@-]/u.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}
