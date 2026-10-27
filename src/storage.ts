import { get, set } from "idb-keyval";
import type { Library } from "./types";
const KEY = "notepilot.library.v1";
export async function loadLibrary(): Promise<Library | undefined> {
  return get<Library>(KEY);
}
export async function saveLibrary(library: Library): Promise<void> {
  await set(KEY, library);
}
export function validateFile(
  file: Pick<File, "size" | "type">,
): string | undefined {
  if (
    !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
      file.type,
    )
  )
    return "Choose a PDF, PNG, JPEG, or WebP file. Export proprietary notes as a PDF first.";
  if (file.size > 25 * 1024 * 1024)
    return "Each document must be 25 MB or smaller.";
  if (!file.size) return "This file is empty.";
}
export async function sampleLibrary(): Promise<Library> {
  const response = await fetch("/samples/derivatives.png");
  if (!response.ok)
    throw new Error(
      "The sample note could not be loaded. Reload to try again.",
    );
  return {
    courses: [
      { id: "calculus", name: "Calculus I", color: "#638b77" },
      { id: "physics", name: "Physics", color: "#b38c5b" },
    ],
    documents: [
      {
        id: "sample",
        courseId: "calculus",
        title: "Derivatives · the essentials",
        kind: "image",
        blob: await response.blob(),
        added: new Date().toISOString(),
      },
    ],
    saved: [],
  };
}
