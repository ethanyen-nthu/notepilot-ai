import { expect, test } from "@playwright/test";
import path from "node:path";

test("imports notes, asks a question, manages overlay, and persists kept answers", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: `docs/${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "A little hint" }).click();
  await page.getByLabel("Ask about your notes").fill("How do I start?");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const overlay = page.getByRole("region", { name: "Temporary explanation" });
  await expect(overlay).toBeVisible();
  await expect(
    overlay.getByText("DEMO · SCRIPTED EXAMPLE", { exact: true }),
  ).toBeVisible();
  const before = await overlay.boundingBox();
  await page
    .getByRole("button", { name: "Move explanation with arrow keys or drag" })
    .focus();
  await page.keyboard.press("ArrowUp");
  expect((await overlay.boundingBox())!.y).toBeLessThan(before!.y);
  if (testInfo.project.name === "desktop") {
    const grip = await page.locator(".overlay-drag").boundingBox();
    const originalX = (await overlay.boundingBox())!.x;
    await page.mouse.move(grip!.x + 30, grip!.y + 10);
    await page.mouse.down();
    await page.mouse.move(grip!.x + 60, grip!.y - 10, { steps: 5 });
    await page.mouse.up();
    expect((await overlay.boundingBox())!.x).toBeGreaterThan(originalX);
  }
  await page.getByRole("button", { name: "Collapse explanation" }).click();
  await expect(overlay.locator(".answer-body")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand explanation" }).click();
  await page.getByRole("button", { name: "Enlarge" }).click();
  await expect(overlay).toHaveClass(/expanded/);
  await page.getByRole("button", { name: "Compact" }).click();
  await page.getByRole("button", { name: "Keep answer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kept in notebook" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss explanation" }).click();
  await expect(overlay).toHaveCount(0);
  await page.getByLabel("Ask about your notes").fill("What comes next?");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  await expect(overlay).toBeVisible();
  await expect(page.locator(".conversation details")).toHaveCount(4);
  await page.getByRole("button", { name: "Dismiss explanation" }).click();
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await page.getByLabel("Course name").fill("Linear Algebra");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.getByRole("button", { name: "Linear Algebra" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve("public/samples/calculus-practice.pdf"));
  await expect(page.locator(".document-heading h2")).toHaveText(
    "calculus-practice",
  );
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByText("Current page · 2", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show selectable PDF text" }).click();
  await expect(page.locator(".extracted-text")).toContainText(
    "Worked solution",
  );
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".viewer-toolbar")).toContainText("125%");
  await page.reload();
  await expect(page.locator(".document-cards")).toContainText(
    "calculus-practice",
  );
  await page.getByRole("button", { name: /Saved explanations/ }).click();
  await expect(page.locator(".saved-card")).toContainText("How do I start?");
  await page.getByRole("button", { name: "Delete saved explanation" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to studying" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve("public/samples/derivatives.png"));
  await expect(page.locator(".document-heading h2")).toHaveText("derivatives");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page
      .locator(".page-scroll canvas")
      .evaluate((c: HTMLCanvasElement) => c.width),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Rename document" }).click();
  await page.getByLabel("Document title").fill("Renamed image");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".document-heading h2")).toHaveText(
    "Renamed image",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(page.locator(".document-cards")).not.toContainText(
    "Renamed image",
  );
  expect(errors).toEqual([]);
});

test("shows actionable API errors without creating an answer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.route("**/api/tutor", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "The AI provider is busy. Try again later.",
      }),
    }),
  );
  await page.getByLabel("Ask about your notes").fill("Help");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  await expect(page.getByRole("alert")).toContainText("Try again later");
  await expect(
    page.getByRole("region", { name: "Temporary explanation" }),
  ).toHaveCount(0);
});

test("sends the selected excerpt and rendered page, and rejects unsupported notes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByText("Add a focused excerpt", { exact: true }).click();
  await page
    .getByLabel("Selected study context")
    .fill("Focus on the chain rule.");
  await page
    .getByLabel("Ask about your notes")
    .fill("Explain the inside derivative");
  const pending = page.waitForRequest("**/api/tutor");
  await page.getByRole("button", { name: "Ask NotePilot" }).click();
  const payload = (await pending).postDataJSON();
  expect(payload.context.text).toBe("Focus on the chain rule.");
  expect(payload.context.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(payload.history).toEqual([]);
  await expect(
    page.getByRole("region", { name: "Temporary explanation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss explanation" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.html",
    mimeType: "text/html",
    buffer: Buffer.from("<b>not a note</b>"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a PDF");
});

test("phone layout fits and navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle library navigation" }).click();
  await page.getByRole("button", { name: /Saved explanations/ }).click();
  await expect(
    page.getByRole("heading", { name: "Keep the lightbulb moments." }),
  ).toBeVisible();
});

test("installed production shell and local notes reopen offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".document-heading h2")).toHaveText(
    "Derivatives · the essentials",
  );
  await expect(page.locator(".page-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByText("Tutoring server offline", { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
});
