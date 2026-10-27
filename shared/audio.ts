export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 60;
export const audioExtensions: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
};
export function audioMime(value: string): string {
  return value.split(";")[0].trim().toLowerCase();
}
