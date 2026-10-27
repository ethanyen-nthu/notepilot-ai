import { expect, test } from "@playwright/test";
import { voiceFakes } from "./voice-fixture";

test("browser voice drafts are editable and follow-ups retain the original problem", async ({
  page,
}) => {
  await voiceFakes(page);
  let questions = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/tutor")) questions++;
  });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(await page.evaluate(() => window.__voiceTest.starts)).toBe(0);
  await page.getByRole("button", { name: "Start voice question" }).click();
  await expect(page.getByText(/Microphone active/)).toBeVisible();
  await page.evaluate(() =>
    window.__voiceTest.result("Explain the chain rule"),
  );
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await expect(page.getByLabel("Review transcript")).toHaveValue(
    "Explain the chain rule",
  );
  await page
    .getByLabel("Review transcript")
    .fill("Explain the inside derivative");
  expect(questions).toBe(0);
  await expect(page.getByLabel("Ask about your notes")).toHaveValue("");
  await page.getByRole("button", { name: "Use transcript" }).click();
  await expect(page.getByLabel("Ask about your notes")).toHaveValue(
    "Explain the inside derivative",
  );
  expect(questions).toBe(0);
  const first = page.waitForRequest("**/api/tutor");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const firstPayload = (await first).postDataJSON();
  const overlay = page.getByRole("region", { name: "Temporary explanation" });
  await expect(overlay).toBeVisible();
  await page.getByRole("button", { name: "Dismiss explanation" }).click();
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.evaluate(() =>
    window.__voiceTest.result("Why is the inside derivative six x?"),
  );
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await page.getByRole("button", { name: "Use transcript" }).click();
  const voiceFollowUp = page.waitForRequest("**/api/tutor");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const followPayload = (await voiceFollowUp).postDataJSON();
  expect(followPayload.history).toHaveLength(2);
  expect(followPayload.history[0].content).toBe(
    "Explain the inside derivative",
  );
  expect(followPayload.context).toEqual(firstPayload.context);
  await expect(overlay).toBeVisible();
  await page.getByLabel("Ask about your notes").fill("A draft to keep");
  for (const [action, label] of [
    ["simpler", "Explain more simply"],
    ["another", "Show another method"],
    ["further", "Explain further"],
  ]) {
    const request = page.waitForRequest("**/api/tutor");
    await overlay.getByRole("button", { name: label, exact: true }).click();
    const payload = (await request).postDataJSON();
    expect(payload.followUp).toBe(action);
    expect(payload.history[0].content).toBe("Explain the inside derivative");
    expect(payload.context).toEqual(firstPayload.context);
    expect(payload.mode).toBe("steps");
    await expect(page.getByLabel("Ask about your notes")).toHaveValue(
      "A draft to keep",
    );
    await expect(overlay.locator("h3")).toHaveText(payload.question);
  }
  await expect(overlay.locator(".katex")).not.toHaveCount(0);
  await page.screenshot({
    path: "test-results/voice-follow-ups.png",
    fullPage: true,
  });
});

test("cancel ignores late recognition results and permission errors offer typed fallback", async ({
  page,
}) => {
  await voiceFakes(page);
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.getByRole("button", { name: "Cancel voice input" }).click();
  await page.evaluate(() =>
    window.__voiceTest.result("Late text must be ignored", true),
  );
  await expect(page.getByLabel("Review transcript")).toHaveCount(0);
  await expect(page.getByLabel("Ask about your notes")).toHaveValue("");
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.evaluate(() => window.__voiceTest.error("not-allowed"));
  await expect(page.getByRole("alert")).toContainText("permission was denied");
  await page
    .getByLabel("Ask about your notes")
    .fill("Typed question still works");
  await expect(
    page.getByRole("button", { name: "Ask NotePilot" }),
  ).toBeEnabled();
});

for (const format of ["webm", "mp4"] as const) {
  test(`${format} recording stays local until explicit transcription and transcript confirmation`, async ({
    page,
  }) => {
    await voiceFakes(page, { server: true, format });
    let uploads = 0;
    await page.route("**/api/transcribe", (route) => {
      uploads++;
      expect(route.request().headers()["content-type"]).toContain(
        `audio/${format}`,
      );
      return route.fulfill({
        json: { text: "What is the next step?", provider: "openai" },
      });
    });
    await page.goto("/");
    await expect(page.locator(".page-scroll")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByLabel("Voice input method")).toHaveValue("server");
    expect(
      await page.evaluate(() => window.__voiceTest.getUserMediaCalls),
    ).toBe(0);
    await page.getByRole("button", { name: "Start voice question" }).click();
    await expect(
      page.getByRole("button", { name: "Stop voice input" }),
    ).toBeVisible();
    expect(uploads).toBe(0);
    await page.getByRole("button", { name: "Stop voice input" }).click();
    await expect(page.getByLabel("Preview recorded question")).toBeVisible();
    expect(uploads).toBe(0);
    expect(
      await page.evaluate(() => window.__voiceTest.tracksStopped),
    ).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cancel voice input" }).click();
    expect(uploads).toBe(0);
    await page.getByRole("button", { name: "Start voice question" }).click();
    await page.getByRole("button", { name: "Stop voice input" }).click();
    await page.getByRole("button", { name: "Transcribe recording" }).click();
    await expect(page.getByLabel("Review transcript")).toHaveValue(
      "What is the next step?",
    );
    expect(uploads).toBe(1);
    await expect(page.getByLabel("Ask about your notes")).toHaveValue("");
    await page.getByRole("button", { name: "Use transcript" }).click();
    await expect(page.getByLabel("Ask about your notes")).toHaveValue(
      "What is the next step?",
    );
    await page.getByRole("button", { name: "Ask NotePilot" }).click();
    await expect(
      page.getByRole("region", { name: "Temporary explanation" }),
    ).toBeVisible();
  });
}

test("denied microphone access and late permission grants stop safely", async ({
  page,
}) => {
  await voiceFakes(page, { server: true, denied: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await expect(page.getByRole("alert")).toContainText("permission was denied");
  expect(await page.evaluate(() => window.__voiceTest.recorderStarts)).toBe(0);
});

test("cancel during a pending microphone permission closes any late stream", async ({
  page,
}) => {
  await voiceFakes(page, { server: true, latePermission: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await expect(
    page.getByText("Allow microphone…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel voice input" }).click();
  await page.evaluate(() => window.__voiceTest.grant());
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.tracksStopped))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__voiceTest.recorderStarts)).toBe(0);
});

test("recording errors, empty recordings, and size limits discard audio without uploading", async ({
  page,
}) => {
  await voiceFakes(page, { server: true });
  let uploads = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/transcribe")) uploads++;
  });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.evaluate(() => window.__voiceTest.recorderError());
  await expect(page.getByRole("alert")).toContainText("Voice input could not");
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.evaluate(() => window.__voiceTest.oversized());
  await expect(page.getByRole("alert")).toContainText("8 MB");
  await page.evaluate(() => {
    window.__voiceTest.empty = true;
  });
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await expect(page.getByRole("alert")).toContainText("empty");
  expect(uploads).toBe(0);
});

test("transcription failures require an explicit retry and do not submit a question", async ({
  page,
}) => {
  await voiceFakes(page, { server: true });
  let uploads = 0;
  await page.route("**/api/transcribe", (route) => {
    uploads++;
    return uploads === 1
      ? route.fulfill({
          status: 502,
          json: { error: "Transcription quota exceeded. Try later." },
        })
      : route.fulfill({ json: { text: "Retry worked" } });
  });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await page.getByRole("button", { name: "Transcribe recording" }).click();
  await expect(page.getByRole("alert")).toContainText("quota");
  expect(uploads).toBe(1);
  await expect(page.getByLabel("Ask about your notes")).toHaveValue("");
  await page.getByRole("button", { name: "Transcribe recording" }).click();
  await expect(page.getByLabel("Review transcript")).toHaveValue(
    "Retry worked",
  );
  expect(uploads).toBe(2);
});

test("the recording duration cap stops the microphone and leaves audio local", async ({
  page,
}) => {
  await voiceFakes(page, { server: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.clock.install();
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.clock.runFor(61_000);
  await expect(page.getByLabel("Preview recorded question")).toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.recorderStops)).toBe(1);
});

test("navigating away releases the microphone and does not preserve audio", async ({
  page,
}) => {
  await voiceFakes(page, { server: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Start voice question" }).click();
  await expect(
    page.getByRole("button", { name: "Stop voice input" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Saved explanations/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.tracksStopped))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Back to studying" }).click();
  await expect(page.getByLabel("Preview recorded question")).toHaveCount(0);
  expect(await page.evaluate(() => window.__voiceTest.recorderStarts)).toBe(1);
});

test("microphone permission timeout rejects a late stream safely", async ({
  page,
}) => {
  await voiceFakes(page, { server: true, latePermission: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.clock.install();
  await page.getByRole("button", { name: "Start voice question" }).click();
  await page.clock.runFor(15_100);
  await expect(page.getByRole("alert")).toContainText("timed out");
  await page.evaluate(() => window.__voiceTest.grant());
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.tracksStopped))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__voiceTest.recorderStarts)).toBe(0);
});

test("spoken mode supports play pause resume stop and stops when microphone starts", async ({
  page,
}) => {
  await voiceFakes(page);
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("Ask about your notes").fill("Explain this example");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const overlay = page.getByRole("region", { name: "Temporary explanation" });
  await expect(overlay).toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.speech.plays)).toBe(0);
  await page.getByLabel("Response mode").selectOption("spoken");
  await page.getByRole("button", { name: "Pause spoken answer" }).click();
  await expect(page.getByText("Speech paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume spoken answer" }).click();
  await expect(page.getByText("Reading answer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop spoken answer" }).click();
  await page.getByRole("button", { name: "Play spoken answer" }).click();
  await page
    .getByRole("button", { name: "Move explanation with arrow keys or drag" })
    .focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "Start voice question" }).click();
  await expect(
    page.getByRole("button", { name: "Play spoken answer" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel voice input" }).click();
  await expect(
    page.getByRole("button", { name: "Play spoken answer" }),
  ).toBeEnabled();
  const speech = await page.evaluate(() => window.__voiceTest.speech);
  expect(speech.pauses).toBe(1);
  expect(speech.resumes).toBe(1);
  await page.getByLabel("Response mode").selectOption("text");
  await expect(page.getByLabel("Spoken answer controls")).toHaveCount(0);
});

test("unsupported speech APIs leave useful text and keyboard dictation fallbacks", async ({
  page,
}) => {
  await voiceFakes(page, { unsupported: true, noSpeechPlayback: true });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Start voice question" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/microphone on your device keyboard/),
  ).toBeVisible();
  await page.getByLabel("Response mode").selectOption("spoken");
  await page.getByLabel("Ask about your notes").fill("A typed question");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  await expect(
    page.getByText(/Speech playback is unavailable in this browser/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep answer", exact: true }),
  ).toBeEnabled();
});

test("tablet pointer capture moves the explanation with native touch input", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "tablet",
    "Touch coverage uses the tablet project.",
  );
  await voiceFakes(page);
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("Ask about your notes").fill("Give me a hint");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const overlay = page.getByRole("region", { name: "Temporary explanation" });
  await expect(overlay).toBeVisible();
  const before = (await overlay.boundingBox())!,
    grip = (await page.locator(".overlay-drag").boundingBox())!;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: grip.x + 30, y: grip.y + 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: grip.x + 10, y: grip.y - 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect((await overlay.boundingBox())!.y).toBeLessThan(before.y);
  await session.detach();
  await page.getByRole("button", { name: "Collapse explanation" }).click();
  await page.getByRole("button", { name: "Expand explanation" }).click();
  await page.getByRole("button", { name: "Keep answer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kept in notebook" }),
  ).toBeDisabled();
});
