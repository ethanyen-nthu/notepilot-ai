import express from "express";
import { resolve } from "node:path";
import { tutorSchema, type TutorProvider } from "../shared/tutor.js";
import { createProvider } from "./providers.js";

export function createApp(
  provider: TutorProvider = createProvider(),
  live = !!process.env.OPENAI_API_KEY?.trim(),
) {
  const app = express();
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
    res.json({ provider: live ? "openai" : "demo" }),
  );
  // Bounded per-process rate limiting; proxy deployments need authenticated quotas.
  const requests = new Map<string, { count: number; until: number }>();
  app.post("/api/tutor", async (req, res) => {
    const now = Date.now();
    for (const [key, entry] of requests)
      if (entry.until < now) requests.delete(key);
    const ip = req.ip || "local";
    const entry = requests.get(ip) ?? { count: 0, until: now + 60_000 };
    if (entry.count >= 20)
      return res
        .status(429)
        .json({ error: "Too many questions. Please wait a minute." });
    entry.count++;
    requests.set(ip, entry);
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
            ? "Page image is too large."
            : "Invalid request body.",
      });
    },
  );
  return app;
}
