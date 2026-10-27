import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const requestsPerMinute = Number(process.env.API_REQUESTS_PER_MINUTE || 20);
if (
  !Number.isInteger(requestsPerMinute) ||
  requestsPerMinute < 1 ||
  requestsPerMinute > 1000
)
  throw new Error(
    "API_REQUESTS_PER_MINUTE must be an integer between 1 and 1000.",
  );
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== "loopback")
  throw new Error("TRUST_PROXY must be blank or loopback.");
createApp(undefined, undefined, undefined, {
  requestsPerMinute,
  trustProxy: process.env.TRUST_PROXY === "loopback" ? "loopback" : undefined,
}).listen(port, host, () =>
  console.log(
    `NotePilot API: http://${host}:${port} (${process.env.OPENAI_API_KEY?.trim() ? "OpenAI" : "DEMO — scripted responses"})`,
  ),
);
