import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
createApp().listen(port, host, () =>
  console.log(
    `NotePilot API: http://${host}:${port} (${process.env.OPENAI_API_KEY?.trim() ? "OpenAI" : "DEMO — scripted responses"})`,
  ),
);
