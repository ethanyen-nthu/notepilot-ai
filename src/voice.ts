export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => RecognitionLike;
export const recorderFormats = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;
export function selectRecorderFormat(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported">,
): string | undefined {
  return recorderFormats.find((format) => {
    try {
      return recorder.isTypeSupported(format);
    } catch {
      return false;
    }
  });
}
export function voiceCapabilities() {
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return {
    recognition: browser.SpeechRecognition || browser.webkitSpeechRecognition,
    format:
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined"
        ? selectRecorderFormat(MediaRecorder)
        : undefined,
  };
}
export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  if (
    [
      "NotAllowedError",
      "SecurityError",
      "not-allowed",
      "service-not-allowed",
    ].includes(name)
  )
    return "Microphone permission was denied. Allow microphone access in your browser settings, or type your question.";
  if (["NotFoundError", "audio-capture"].includes(name))
    return "No microphone is available. Connect a microphone or use keyboard dictation.";
  if (name === "no-speech")
    return "No speech was detected. Try again or type your question.";
  if (name === "network")
    return "Browser dictation could not reach its speech service. Try server recording or type your question.";
  if (name === "TimeoutError")
    return "Microphone access timed out. Dismiss the permission prompt and try again, or type your question.";
  return "Voice input could not start or finish. Check your microphone, use a supported HTTPS browser, or type your question.";
}

export function spokenText(text: string): string {
  return text
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1) divided by ($2)")
    .replace(/\\sqrt\{([^{}]*)\}/g, "square root of $1")
    .replace(/\\(?:cdot|times)\b/g, " times ")
    .replace(/\\(?:leq|le)\b/g, " less than or equal to ")
    .replace(/\\(?:geq|ge)\b/g, " greater than or equal to ")
    .replace(/\\(?:right|left|displaystyle)\b/g, "")
    .replace(
      /\^\{([^{}]*)\}|\^([\w-]+)/g,
      (_all, group, simple) => ` to the power of ${group || simple} `,
    )
    .replace(/\\([a-zA-Z]+)/g, " $1 ")
    .replace(/[$#*{}_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Short utterances avoid long-utterance stalls in some browser speech engines.
export function speechChunks(text: string): string[] {
  const words = spokenText(text).split(" ");
  const chunks: string[] = [];
  let chunk = "";
  for (const word of words) {
    if (chunk.length + word.length > 180 && chunk) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += (chunk ? " " : "") + word;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
