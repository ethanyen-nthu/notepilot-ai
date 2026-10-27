import { audioExtensions, audioMime } from "../shared/audio.js";

export interface Transcriber {
  transcribe(
    audio: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<string>;
}

// Cheap container checks reject empty/mislabeled uploads before contacting the provider.
export function matchesAudioContainer(
  bytes: Uint8Array,
  type: string,
): boolean {
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (bytes.length < 12) return false;
  switch (audioMime(type)) {
    case "audio/webm":
      return [0x1a, 0x45, 0xdf, 0xa3].every((byte, i) => bytes[i] === byte);
    case "audio/mp4":
    case "audio/x-m4a":
      return ascii(4, 8) === "ftyp";
    case "audio/wav":
    case "audio/x-wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "audio/mpeg":
      return (
        ascii(0, 3) === "ID3" ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      );
    default:
      return false;
  }
}

export class OpenAITranscriber implements Transcriber {
  constructor(
    private key: string,
    private model = "gpt-transcribe",
    private request: typeof fetch = fetch,
  ) {}
  async transcribe(
    audio: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append("model", this.model);
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: audioMime(mime) }),
      `question.${audioExtensions[audioMime(mime)]}`,
    );
    const response = await this.request(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}` },
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Transcription quota is exhausted or the provider is busy. Try again later, or type your question."
          : "Transcription failed. Check the server API key and transcription model, or use browser dictation.",
      );
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string" || !data.text.trim())
      throw new Error(
        "No speech was recognized. Try recording again, or type your question.",
      );
    if (data.text.trim().length > 4000)
      throw new Error(
        "That transcript is too long. Record a shorter question (4,000 characters maximum).",
      );
    return data.text.trim();
  }
}

export function createTranscriber(): Transcriber | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key
    ? new OpenAITranscriber(
        key,
        process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-transcribe",
      )
    : null;
}
