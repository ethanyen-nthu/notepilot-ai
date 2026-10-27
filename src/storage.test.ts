import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { loadLibrary, saveLibrary, validateFile } from "./storage";
describe("local document library", () => {
  it("round-trips courses, file bytes, and kept explanations", async () => {
    const blob = new Blob(["actual note bytes"], { type: "application/pdf" });
    const library = {
      courses: [{ id: "c", name: "Math", color: "green" }],
      documents: [
        {
          id: "d",
          courseId: "c",
          title: "Note",
          kind: "pdf" as const,
          blob,
          added: "2026-01-01",
        },
      ],
      saved: [
        {
          id: "a",
          documentId: "d",
          title: "Note",
          page: 1,
          question: "Why?",
          answer: "Because.",
          provider: "demo" as const,
          created: "2026-01-01",
        },
      ],
    };
    await saveLibrary(library);
    const result = await loadLibrary();
    expect(result?.courses).toEqual(library.courses);
    expect(result?.saved).toEqual(library.saved);
    expect(await result?.documents[0].blob.text()).toBe("actual note bytes");
  });
  it("rejects unsupported, empty, and oversized imports", () => {
    expect(validateFile({ size: 10, type: "image/png" })).toBeUndefined();
    expect(validateFile({ size: 10, type: "text/html" })).toContain("PDF");
    expect(validateFile({ size: 0, type: "application/pdf" })).toContain(
      "empty",
    );
    expect(
      validateFile({ size: 26 * 1024 * 1024, type: "application/pdf" }),
    ).toContain("25 MB");
  });
});
