import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioExtensions,
  audioMime,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
} from "../../shared/audio";
import {
  microphoneError,
  voiceCapabilities,
  type RecognitionLike,
} from "../voice";

export type VoicePhase =
  | "idle"
  | "requesting"
  | "recording"
  | "listening"
  | "stopping"
  | "preview"
  | "transcribing"
  | "review"
  | "error";
export const voiceIsActive = (phase: VoicePhase) =>
  ["requesting", "recording", "listening", "stopping", "transcribing"].includes(
    phase,
  );
interface Resources {
  recorder?: MediaRecorder;
  recognition?: RecognitionLike;
  stream?: MediaStream;
  timer?: ReturnType<typeof setInterval>;
  endTimer?: ReturnType<typeof setTimeout>;
  abort?: AbortController;
  chunks: Blob[];
  bytes: number;
  text: string;
  uploaded: boolean;
}
function release(resources: Resources) {
  clearInterval(resources.timer);
  clearTimeout(resources.endTimer);
  resources.abort?.abort();
  if (resources.recorder) {
    resources.recorder.ondataavailable = null;
    resources.recorder.onstop = null;
    resources.recorder.onerror = null;
    if (resources.recorder.state !== "inactive") {
      try {
        resources.recorder.stop();
      } catch {
        /* Already stopped by the platform. */
      }
    }
  }
  if (resources.recognition) {
    resources.recognition.onend = null;
    resources.recognition.onerror = null;
    resources.recognition.onresult = null;
    try {
      resources.recognition.abort();
    } catch {
      /* Nothing is listening. */
    }
  }
  resources.stream?.getTracks().forEach((track) => track.stop());
}

export function useVoiceInput(serverAvailable: boolean) {
  const [capabilities] = useState(voiceCapabilities);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0);
  const resources = useRef<Resources>({
    chunks: [],
    bytes: 0,
    text: "",
    uploaded: false,
  });
  const clear = useCallback(() => {
    generation.current++;
    release(resources.current);
    resources.current = { chunks: [], bytes: 0, text: "", uploaded: false };
    setPhase("idle");
    setRecording(null);
    setTranscript("");
    setSeconds(0);
    setMessage("");
  }, []);
  const cancel = useCallback(() => {
    const uploaded = resources.current.uploaded;
    clear();
    setMessage(
      uploaded
        ? "Transcription canceled. Audio may already have reached the server."
        : "Voice input canceled. No recording was uploaded to NotePilot.",
    );
  }, [clear]);
  useEffect(
    () => () => {
      generation.current++;
      release(resources.current);
    },
    [],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [cancel]);

  const stop = useCallback(() => {
    const current = resources.current;
    clearInterval(current.timer);
    setPhase("stopping");
    try {
      if (current.recorder?.state === "recording") {
        current.recorder.stop();
        current.stream?.getTracks().forEach((track) => track.stop());
      } else if (current.recognition) {
        current.recognition.stop();
        const id = generation.current;
        current.endTimer = setTimeout(() => {
          if (id !== generation.current) return;
          release(current);
          generation.current++;
          setPhase("error");
          setMessage(
            "Dictation did not finish. Try again or type your question.",
          );
        }, 5000);
      } else setPhase("idle");
    } catch {
      cancel();
      setMessage(
        "The microphone stopped unexpectedly. Please try again or type your question.",
      );
    }
  }, [cancel]);

  async function start(method: "browser" | "server") {
    clear();
    const id = generation.current;
    const current = resources.current;
    const fail = (error: unknown) => {
      if (id !== generation.current) return;
      generation.current++;
      release(current);
      setPhase("error");
      setMessage(microphoneError(error));
    };
    if (method === "server" && (!serverAvailable || !capabilities.format)) {
      setPhase("error");
      setMessage(
        "Server recording needs a configured transcription service, a supported recorder, and HTTPS (or localhost). Use browser or keyboard dictation instead.",
      );
      return;
    }
    setPhase("requesting");
    try {
      if (method === "browser") {
        if (!capabilities.recognition) throw new Error("Dictation unavailable");
        const recognition = new capabilities.recognition();
        current.recognition = recognition;
        recognition.lang = navigator.language || "en-US";
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          if (id !== generation.current) return;
          current.text = Array.from(
            event.results,
            (result) => result[0]?.transcript || "",
          )
            .join(" ")
            .slice(0, 4000);
          setTranscript(current.text);
        };
        recognition.onerror = (event) => fail(event.error);
        recognition.onend = () => {
          if (id !== generation.current) return;
          release(current);
          if (current.text.trim()) {
            setTranscript(current.text.trim());
            setPhase("review");
            setMessage(
              "Review the transcript before adding it to your question.",
            );
          } else {
            setPhase("error");
            setMessage(microphoneError("no-speech"));
          }
        };
        recognition.start();
        setPhase("listening");
      } else {
        const pending = navigator.mediaDevices.getUserMedia({ audio: true });
        // getUserMedia cannot be aborted. Close any stream granted after cancel/unmount.
        void pending.then(
          (stream) => {
            if (id !== generation.current)
              stream.getTracks().forEach((track) => track.stop());
          },
          () => {},
        );
        let permissionTimer: ReturnType<typeof setTimeout> | undefined;
        let stream: MediaStream;
        try {
          stream = await Promise.race([
            pending,
            new Promise<never>((_resolve, reject) => {
              permissionTimer = setTimeout(
                () =>
                  reject(
                    new DOMException(
                      "Microphone permission timed out",
                      "TimeoutError",
                    ),
                  ),
                15000,
              );
            }),
          ]);
        } finally {
          clearTimeout(permissionTimer);
        }
        if (id !== generation.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        current.stream = stream;
        const recorder = new MediaRecorder(stream, {
          mimeType: capabilities.format,
        });
        current.recorder = recorder;
        if (
          !audioExtensions[audioMime(recorder.mimeType || capabilities.format!)]
        )
          throw new Error("Unsupported recording format");
        recorder.ondataavailable = (event) => {
          if (id !== generation.current || !event.data.size) return;
          current.bytes += event.data.size;
          if (current.bytes > MAX_AUDIO_BYTES) {
            fail(new Error("Too large"));
            setMessage(
              "Recording exceeded 8 MB and was discarded. Try a shorter question.",
            );
            return;
          }
          current.chunks.push(event.data);
        };
        recorder.onerror = () => fail(new Error("Recorder error"));
        recorder.onstop = () => {
          if (id !== generation.current) return;
          const blob = new Blob(current.chunks, {
            type: recorder.mimeType || capabilities.format,
          });
          release(current);
          current.chunks = [];
          if (!blob.size) {
            setPhase("error");
            setMessage(
              "The recording was empty. Try again or use keyboard dictation.",
            );
            return;
          }
          setRecording(blob);
          setPhase("preview");
          setMessage(
            "Recording stays on this device until you choose Transcribe recording.",
          );
        };
        recorder.start(1000);
        setPhase("recording");
      }
      const started = Date.now();
      current.timer = setInterval(() => {
        if (id !== generation.current) return;
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS) {
          stop();
          setMessage(
            "The 60-second limit was reached. Review your recording or transcript.",
          );
        }
      }, 500);
    } catch (error) {
      fail(error);
    }
  }

  async function transcribe() {
    if (!recording || resources.current.abort || voiceIsActive(phase)) return;
    const id = generation.current;
    const abort = new AbortController();
    resources.current.abort = abort;
    resources.current.uploaded = true;
    setPhase("transcribing");
    setMessage("Transcribing your recording…");
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": recording.type },
        body: recording,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "Transcription failed. Please try again.",
        );
      if (
        typeof data.text !== "string" ||
        !data.text.trim() ||
        data.text.length > 4000
      )
        throw new Error(
          "No usable transcript was returned. Try a shorter recording.",
        );
      if (id !== generation.current) return;
      setTranscript(data.text.trim());
      setRecording(null);
      setPhase("review");
      setMessage(
        "Review and edit the transcript, then add it to your question.",
      );
    } catch (error) {
      if (id === generation.current && !abort.signal.aborted) {
        setPhase("error");
        setMessage(
          error instanceof Error &&
            !["TypeError", "TimeoutError"].includes(error.name)
            ? error.message
            : "Transcription could not finish. Check your connection, retry, or type your question.",
        );
      }
    } finally {
      if (id === generation.current) resources.current.abort = undefined;
    }
  }
  return {
    phase,
    message,
    transcript,
    setTranscript,
    recording,
    seconds,
    capabilities,
    start,
    stop,
    cancel,
    clear,
    transcribe,
  };
}
