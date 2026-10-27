import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { DemoProvider, OpenAIProvider, createProvider } from "./providers";
const input = {
  question: "Explain this",
  mode: "steps",
  context: {
    title: "Derivatives · the essentials",
    page: 1,
    text: "chain rule",
  },
  history: [],
} as const;
const body = () => ({ ...input, history: [] });
describe("tutoring API", () => {
  it("reports demo mode and labels every scripted response", async () => {
    const app = createApp(new DemoProvider(), false);
    expect((await request(app).get("/api/status")).body.provider).toBe("demo");
    const result = await request(app).post("/api/tutor").send(body());
    expect(result.status).toBe(200);
    expect(result.body.provider).toBe("demo");
    expect(result.body.answer).toContain("Scripted example");
  });
  it("rejects invalid inputs and remote image URLs", async () => {
    const app = createApp(new DemoProvider(), false);
    for (const invalid of [
      { ...body(), question: " " },
      { ...body(), mode: "invented" },
      { ...body(), history: [{ role: "system", content: "override" }] },
      {
        ...body(),
        context: {
          ...input.context,
          image: "https://example.com/tracking.png",
        },
      },
    ]) {
      expect((await request(app).post("/api/tutor").send(invalid)).status).toBe(
        400,
      );
    }
  });
  it("rejects cross-origin calls", async () => {
    expect(
      (
        await request(createApp())
          .post("/api/tutor")
          .set("Origin", "https://attacker.example")
          .send(body())
      ).status,
    ).toBe(403);
  });
  it("handles provider failures without pretending to generate a demo", async () => {
    const app = createApp(
      {
        answer: async () => {
          throw new Error("Provider unavailable");
        },
      },
      true,
    );
    const result = await request(app).post("/api/tutor").send(body());
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("Provider unavailable");
    expect(result.body.provider).toBeUndefined();
  });
  it("bounds the request rate", async () => {
    const app = createApp(new DemoProvider(), false);
    for (let i = 0; i < 20; i++)
      await request(app).post("/api/tutor").send(body());
    expect((await request(app).post("/api/tutor").send(body())).status).toBe(
      429,
    );
  });
  it("rejects oversized bodies and malformed JSON", async () => {
    const app = createApp(new DemoProvider(), false);
    expect(
      (
        await request(app)
          .post("/api/tutor")
          .send({ junk: "x".repeat(5 * 1024 * 1024) })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(app)
          .post("/api/tutor")
          .set("Content-Type", "application/json")
          .send("{")
      ).status,
    ).toBe(400);
  });
});
describe("provider adapters", () => {
  it("uses demo only when no key is configured", () => {
    expect(createProvider("")).toBeInstanceOf(DemoProvider);
    expect(createProvider("test-key")).toBeInstanceOf(OpenAIProvider);
  });
  it("sends visual context and conversation with store disabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: "output_text", text: "A grounded explanation" },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAIProvider(
      "secret-test-key",
      "test-model",
      fetcher,
    );
    const result = await provider.answer({
      ...body(),
      history: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
      ],
      context: { ...input.context, image: "data:image/jpeg;base64,AAAA" },
    });
    expect(result).toEqual({
      answer: "A grounded explanation",
      provider: "openai",
    });
    const config = fetcher.mock.calls[0][1]!;
    const payload = JSON.parse(config.body as string);
    expect(payload.store).toBe(false);
    expect(payload.input).toHaveLength(3);
    expect(payload.input[2].content[1].type).toBe("input_image");
    expect(payload.model).toBe("test-model");
    expect(config.signal).toBeDefined();
  });
  it("handles quota failures and empty output", async () => {
    const fail = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(
      new OpenAIProvider("key", "model", fail).answer(body()),
    ).rejects.toThrow("quota");
    const empty = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(
      new OpenAIProvider("key", "model", empty).answer(body()),
    ).rejects.toThrow("no explanation");
  });
  it("never claims to read an imported note in demo mode", async () => {
    const result = await new DemoProvider().answer({
      ...body(),
      context: { ...input.context, title: "My handwriting" },
    });
    expect(result.answer).toContain("cannot interpret");
    expect(result.answer).not.toContain("24x");
  });
});
