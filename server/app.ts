import express from "express";
import { resolve } from "node:path";
import { tutorSchema, type TutorProvider } from "../shared/tutor.js";
import { createProvider } from "./providers.js";
import {
  audioExtensions,
  audioMime,
  MAX_AUDIO_BYTES,
} from "../shared/audio.js";
import {
  createTranscriber,
  matchesAudioContainer,
  type Transcriber,
} from "./transcription.js";

export function createApp(
  provider: TutorProvider = createProvider(),
  live = !!process.env.OPENAI_API_KEY?.trim(),
  transcriber: Transcriber | null = createTranscriber(),
  options: { requestsPerMinute?: number; trustProxy?: "loopback" } = {},
) {
  const app = express();
  const requestsPerMinute = options.requestsPerMinute ?? 20;
  app.set("trust proxy", options.trustProxy ?? false);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  // Same-origin only, including protection from cross-site requests to a local API.
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`)
      return res
        .status(403)
        .json({ error: "Cross-origin requests are not allowed." });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "5mb" }));
  app.get("/api/status", (_req, res) =>
    res.json({
      provider: live ? "openai" : "demo",
      transcription: !!transcriber,
    }),
  );
  // Bounded per-process rate limiting; proxy deployments need authenticated quotas.
  const requests = new Map<string, { count: number; until: number }>();
  const limitRequests: express.RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of requests)
      if (entry.until < now) requests.delete(key);
    const ip = req.ip || "local";
    const entry = requests.get(ip) ?? { count: 0, until: now + 60_000 };
    if (entry.count >= requestsPerMinute)
      return res
        .status(429)
        .json({ error: "Too many requests. Please wait a minute." });
    entry.count++;
    requests.set(ip, entry);
    next();
  };
  app.post(
    "/api/transcribe",
    limitRequests,
    (req, res, next) => {
      if (!transcriber)
        return res.status(503).json({
          error:
            "Server transcription is unavailable. Use browser or keyboard dictation, or configure OPENAI_API_KEY on the server.",
        });
      if (!audioExtensions[audioMime(req.get("content-type") || "")])
        return res.status(415).json({
          error:
            "Unsupported audio format. Record WebM or MP4 audio, or use browser dictation.",
        });
      next();
    },
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        return res
          .status(400)
          .json({ error: "The recording is empty. Try recording again." });
      const mime = audioMime(req.get("content-type") || "");
      if (!matchesAudioContainer(req.body, mime))
        return res.status(415).json({
          error:
            "This is not a supported audio recording. Try a different recording method.",
        });
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.once("close", cancel);
      try {
        const text = await transcriber!.transcribe(
          req.body,
          mime,
          abort.signal,
        );
        if (!abort.signal.aborted)
          return res.json({ text, provider: "openai" });
      } catch (error) {
        if (!abort.signal.aborted)
          return res.status(502).json({
            error:
              error instanceof Error &&
              !["TimeoutError", "AbortError", "TypeError"].includes(error.name)
                ? error.message
                : "Transcription could not finish. Please try again or type your question.",
          });
      } finally {
        res.off("close", cancel);
      }
    },
  );
  app.post("/api/tutor", limitRequests, async (req, res) => {
    const parsed = tutorSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error:
          "Invalid question, history, or page context. Start a new conversation if it is too long.",
      });
    try {
      return res.json(await provider.answer(parsed.data));
    } catch (error) {
      return res.status(502).json({
        error:
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "The AI request timed out. Please try again.",
      });
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      error: { type?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      void next; // Express identifies error middleware by its four-argument signature.
      res.status(error.type === "entity.too.large" ? 413 : 400).json({
        error:
          error.type === "entity.too.large"
            ? "The upload exceeds the allowed size (audio: 8 MB)."
            : "Invalid request body.",
      });
    },
  );
  return app;
}
