import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { DemoProvider } from "./providers";
import { matchesAudioContainer, OpenAITranscriber } from "./transcription";
import { MAX_AUDIO_BYTES } from "../shared/audio";

const wav = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WAVEfmt "),
  Buffer.alloc(40),
]);
describe("secure recorded-audio transcription", () => {
  it("reports missing credentials and does not simulate a transcript", async () => {
    const app = createApp(new DemoProvider(), false, null);
    expect((await request(app).get("/api/status")).body.transcription).toBe(
      false,
    );
    const response = await request(app)
      .post("/api/transcribe")
      .set("Content-Type", "audio/wav")
      .send(wav);
    expect(response.status).toBe(503);
    expect(response.body.text).toBeUndefined();
  });
  it("accepts supported audio and returns an editable real-service transcript", async () => {
    const transcribe = vi.fn().mockResolvedValue("Explain the chain rule");
    const app = createApp(new DemoProvider(), false, { transcribe });
    const result = await request(app)
      .post("/api/transcribe")
      .set("Content-Type", "audio/wav")
      .send(wav);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      text: "Explain the chain rule",
      provider: "openai",
    });
    expect(transcribe.mock.calls[0][0]).toEqual(wav);
    expect(transcribe.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });
  it("rejects wrong MIME types, disguised files, empty data and cross-origin uploads before the provider", async () => {
    const transcribe = vi.fn();
    const app = createApp(new DemoProvider(), false, { transcribe });
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Content-Type", "text/html")
          .send("notes")
      ).status,
    ).toBe(415);
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Content-Type", "audio/webm")
          .send(wav)
      ).status,
    ).toBe(415);
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Content-Type", "audio/wav")
          .send(Buffer.alloc(0))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Origin", "https://other.example")
          .set("Content-Type", "audio/wav")
          .send(wav)
      ).status,
    ).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });
  it("limits audio size and shares the tutoring request quota", async () => {
    const app = createApp(new DemoProvider(), false, {
      transcribe: vi.fn().mockResolvedValue("Question"),
    });
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Content-Type", "audio/wav")
          .send(Buffer.alloc(MAX_AUDIO_BYTES + 1))
      ).status,
    ).toBe(413);
    for (let i = 1; i < 20; i++)
      await request(app)
        .post("/api/transcribe")
        .set("Content-Type", "audio/wav")
        .send(wav);
    expect(
      (
        await request(app)
          .post("/api/transcribe")
          .set("Content-Type", "audio/wav")
          .send(wav)
      ).status,
    ).toBe(429);
  });
  it("handles an upstream failure without inventing text", async () => {
    const app = createApp(new DemoProvider(), false, {
      transcribe: async () => {
        throw new Error("Transcription quota exceeded");
      },
    });
    const result = await request(app)
      .post("/api/transcribe")
      .set("Content-Type", "audio/wav")
      .send(wav);
    expect(result.status).toBe(502);
    expect(result.body.error).toContain("quota");
    expect(result.body.text).toBeUndefined();
  });
  it("constructs multipart audio using only a server-side credential and configurable model", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: "A spoken question" })),
      );
    const result = await new OpenAITranscriber(
      "fake-secret",
      "test-transcriber",
      fetcher,
    ).transcribe(wav, "audio/wav", new AbortController().signal);
    expect(result).toBe("A spoken question");
    const config = fetcher.mock.calls[0][1]!;
    expect(config.headers).toEqual({ Authorization: "Bearer fake-secret" });
    const form = config.body as FormData;
    expect(form.get("model")).toBe("test-transcriber");
    expect((form.get("file") as File).type).toBe("audio/wav");
    expect(await (form.get("file") as File).arrayBuffer()).toEqual(
      wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    );
  });
  it("recognizes Safari MP4 and Chromium WebM container headers", () => {
    expect(
      matchesAudioContainer(
        Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypM4A ")]),
        "audio/mp4;codecs=mp4a.40.2",
      ),
    ).toBe(true);
    expect(
      matchesAudioContainer(
        Buffer.concat([
          Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
          Buffer.alloc(12),
        ]),
        "audio/webm;codecs=opus",
      ),
    ).toBe(true);
  });
  it("handles empty speech and provider quota errors", async () => {
    const empty = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ text: "  " })));
    await expect(
      new OpenAITranscriber("key", "model", empty).transcribe(
        wav,
        "audio/wav",
        new AbortController().signal,
      ),
    ).rejects.toThrow("No speech");
    const busy = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(
      new OpenAITranscriber("key", "model", busy).transcribe(
        wav,
        "audio/wav",
        new AbortController().signal,
      ),
    ).rejects.toThrow("quota");
  });
});
