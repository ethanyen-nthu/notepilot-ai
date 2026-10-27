import type { Page } from "@playwright/test";

interface VoiceTestState {
  starts: number;
  aborted: number;
  getUserMediaCalls: number;
  tracksStopped: number;
  recorderStarts: number;
  recorderStops: number;
  mime: string;
  empty: boolean;
  result(text: string, late?: boolean): void;
  error(code: string): void;
  grant(): void;
  recorderError(): void;
  oversized(): void;
  speech: {
    plays: number;
    pauses: number;
    resumes: number;
    cancels: number;
    text: string[];
  };
}
declare global {
  interface Window {
    __voiceTest: VoiceTestState;
  }
}

// These fakes never open a real microphone or speaker. The real APIs remain the
// production implementation; tests control platform events and failure timing.
export async function voiceFakes(
  page: Page,
  options: {
    server?: boolean;
    denied?: boolean;
    latePermission?: boolean;
    format?: "mp4" | "webm";
    unsupported?: boolean;
    noSpeechPlayback?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    type Result = { results: { 0: { transcript: string }; length: number }[] };
    let activeRecognition: Pick<
      FakeRecognition,
      "onresult" | "onerror"
    > | null = null;
    let lateResult: ((event: Result) => void) | null = null;
    let activeRecorder: Pick<
      FakeRecorder,
      "ondataavailable" | "onerror"
    > | null = null;
    let grantPermission: (() => void) | null = null;
    const state: VoiceTestState = {
      starts: 0,
      aborted: 0,
      getUserMediaCalls: 0,
      tracksStopped: 0,
      recorderStarts: 0,
      recorderStops: 0,
      mime: "",
      empty: false,
      result(text, late = false) {
        (late ? lateResult : activeRecognition?.onresult)?.({
          results: [{ 0: { transcript: text }, length: 1 }],
        });
      },
      error(code) {
        activeRecognition?.onerror?.({ error: code });
      },
      grant() {
        grantPermission?.();
      },
      recorderError() {
        activeRecorder?.onerror?.();
      },
      oversized() {
        activeRecorder?.ondataavailable?.({
          data: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),
        });
      },
      speech: { plays: 0, pauses: 0, resumes: 0, cancels: 0, text: [] },
    };
    window.__voiceTest = state;
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: Result) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        state.starts++;
        activeRecognition = {
          onresult: (event) => this.onresult?.(event),
          onerror: (event) => this.onerror?.(event),
        };
        lateResult = this.onresult;
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        state.aborted++;
      }
    }
    class FakeRecorder {
      static isTypeSupported(mime: string) {
        return (
          mime ===
          (options.format === "mp4" ? "audio/mp4" : "audio/webm;codecs=opus")
        );
      }
      state = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, config: { mimeType: string }) {
        this.mimeType = config.mimeType;
        state.mime = config.mimeType;
      }
      start() {
        activeRecorder = {
          ondataavailable: (event) => this.ondataavailable?.(event),
          onerror: () => this.onerror?.(),
        };
        this.state = "recording";
        state.recorderStarts++;
      }
      stop() {
        this.state = "inactive";
        state.recorderStops++;
        const bytes =
          options.format === "mp4"
            ? [0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]
            : [26, 69, 223, 163, 0, 0, 0, 0, 0, 0, 0, 0];
        setTimeout(() => {
          this.ondataavailable?.({
            data: new Blob(state.empty ? [] : [new Uint8Array(bytes)], {
              type: this.mimeType,
            }),
          });
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: options.unsupported ? undefined : FakeRecognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: options.unsupported ? undefined : FakeRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          state.getUserMediaCalls++;
          if (options.denied)
            return Promise.reject(
              new DOMException("Denied by test", "NotAllowedError"),
            );
          const stream = {
            getTracks: () => [
              {
                stop: () => {
                  state.tracksStopped++;
                },
              },
            ],
          };
          if (options.latePermission)
            return new Promise((resolve) => {
              grantPermission = () => resolve(stream);
            });
          return Promise.resolve(stream);
        },
      },
    });
    class FakeUtterance {
      text: string;
      lang = "";
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: options.noSpeechPlayback ? undefined : FakeUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: options.noSpeechPlayback
        ? undefined
        : {
            speak(utterance: FakeUtterance) {
              state.speech.plays++;
              state.speech.text.push(utterance.text);
              setTimeout(() => utterance.onstart?.(), 0);
            },
            pause() {
              state.speech.pauses++;
            },
            resume() {
              state.speech.resumes++;
            },
            cancel() {
              state.speech.cancels++;
            },
          },
    });
  }, options);
  if (options.server)
    await page.route("**/api/status", (route) =>
      route.fulfill({ json: { provider: "demo", transcription: true } }),
    );
}
