import { describe, expect, it } from "vitest";
import { safeReflectionCsvCell, validateReflectionColumns, validateReflectionText } from "./reflection-wall";

describe("Reflection Wall validation", () => {
  it("accepts one to four bounded columns and trims participant-facing text", () => {
    expect(validateReflectionColumns([{ title: "  Notice  ", question: "  What stood out?  " }])).toEqual({
      ok: true,
      columns: [{ title: "Notice", question: "What stood out?" }],
    });
    const fourColumnResult = validateReflectionColumns(Array.from({ length: 4 }, (_, index) => ({ title: `Column ${index + 1}`, question: "" })));
    expect(fourColumnResult.ok).toBe(true);
    if (fourColumnResult.ok) expect(fourColumnResult.columns).toHaveLength(4);
  });

  it("rejects empty, overlong, and unsupported column sets", () => {
    expect(validateReflectionColumns([]).ok).toBe(false);
    expect(validateReflectionColumns(Array.from({ length: 5 }, (_, index) => ({ title: `Column ${index + 1}`, question: "" }))).ok).toBe(false);
    expect(validateReflectionColumns([{ title: "x".repeat(31), question: "" }]).ok).toBe(false);
    expect(validateReflectionColumns([{ title: "Valid", question: "x".repeat(201) }]).ok).toBe(false);
  });

  it("counts Unicode code points and rejects blank, overlong, and control-character content", () => {
    expect(validateReflectionText("  A useful thought  ", 500)).toEqual({ ok: true, text: "A useful thought" });
    expect(validateReflectionText("🧠", 1)).toEqual({ ok: true, text: "🧠" });
    expect(validateReflectionText("  ", 500).ok).toBe(false);
    expect(validateReflectionText("a".repeat(301), 300).ok).toBe(false);
    expect(validateReflectionText("unsafe\u0000text", 500).ok).toBe(false);
  });

  it("quotes CSV values and neutralizes spreadsheet formula prefixes", () => {
    expect(safeReflectionCsvCell("a,b\"c")).toBe('"a,b""c"');
    expect(safeReflectionCsvCell("=SUM(1,1)")).toBe('"\'=SUM(1,1)"');
    expect(safeReflectionCsvCell("  +1+1")).toBe('"\'  +1+1"');
    expect(safeReflectionCsvCell("line one\nline two")).toBe('"line one line two"');
  });
});
