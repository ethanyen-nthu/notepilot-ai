import { describe, expect, it } from "vitest";
import {
  microphoneError,
  selectRecorderFormat,
  speechChunks,
  spokenText,
} from "./voice";
describe("voice compatibility and speech preparation", () => {
  it("detects Safari MP4 and Chromium WebM instead of assuming a codec", () => {
    expect(
      selectRecorderFormat({ isTypeSupported: (type) => type === "audio/mp4" }),
    ).toBe("audio/mp4");
    expect(
      selectRecorderFormat({
        isTypeSupported: (type) => type === "audio/webm;codecs=opus",
      }),
    ).toBe("audio/webm;codecs=opus");
    expect(
      selectRecorderFormat({ isTypeSupported: () => false }),
    ).toBeUndefined();
    expect(
      selectRecorderFormat({
        isTypeSupported: () => {
          throw new Error();
        },
      }),
    ).toBeUndefined();
  });
  it("provides actionable denied-permission, missing microphone and network messages", () => {
    expect(
      microphoneError(new DOMException("Denied", "NotAllowedError")),
    ).toContain("permission was denied");
    expect(microphoneError("audio-capture")).toContain("No microphone");
    expect(microphoneError("network")).toContain("speech service");
    expect(microphoneError("no-speech")).toContain("No speech");
  });
  it("prepares common math for speech while leaving visual notation to KaTeX", () => {
    const text = spokenText(
      "Use $\\frac{1}{2} \\times x^{2}$ and $\\sqrt{4}$.",
    );
    expect(text).toContain("(1) divided by (2) times x to the power of 2");
    expect(text).toContain("square root of 4");
    expect(text).not.toMatch(/[$\\{}]/);
  });
  it("splits long explanations into utterances without dropping content", () => {
    const text = "A short mathematical explanation. ".repeat(40).trim();
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 181)).toBe(true);
    expect(chunks.join(" ")).toBe(spokenText(text));
  });
});
