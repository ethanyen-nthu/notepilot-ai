import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { speechChunks } from "../voice";

export function SpeechControls({
  text,
  blocked,
}: {
  text: string;
  blocked: boolean;
}) {
  const synthesis =
    typeof window.speechSynthesis === "object" &&
    typeof SpeechSynthesisUtterance !== "undefined"
      ? window.speechSynthesis
      : null;
  const chunks = useMemo(() => speechChunks(text), [text]);
  const [status, setStatus] = useState<
    "idle" | "starting" | "playing" | "paused"
  >("idle");
  const [message, setMessage] = useState("");
  const token = useRef(0);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const startup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attemptedAutoPlay = useRef(false);
  const cancelPlayback = useCallback(() => {
    token.current++;
    clearTimeout(startup.current);
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current.onstart = null;
    }
    utterance.current = null;
    synthesis?.cancel();
  }, [synthesis]);
  const play = useCallback(() => {
    if (!synthesis || blocked || !chunks.length) return;
    attemptedAutoPlay.current = true;
    cancelPlayback();
    const id = token.current;
    setMessage("");
    setStatus("starting");
    function speakChunk(index: number) {
      if (id !== token.current || !synthesis) return;
      const next = new SpeechSynthesisUtterance(chunks[index]);
      utterance.current = next;
      next.lang = navigator.language || "en-US";
      next.rate = 0.95;
      startup.current = setTimeout(() => {
        if (id !== token.current) return;
        cancelPlayback();
        setStatus("idle");
        setMessage(
          "Speech did not start. Tap Play, check device audio, or continue reading the text.",
        );
      }, 10000);
      next.onstart = () => {
        if (id === token.current) {
          clearTimeout(startup.current);
          setStatus("playing");
        }
      };
      next.onend = () => {
        if (id !== token.current) return;
        clearTimeout(startup.current);
        if (index + 1 < chunks.length) speakChunk(index + 1);
        else {
          utterance.current = null;
          setStatus("idle");
        }
      };
      next.onerror = () => {
        if (id !== token.current) return;
        cancelPlayback();
        setStatus("idle");
        setMessage(
          "Speech playback is unavailable or was blocked. Tap Play to retry, or read the text.",
        );
      };
      try {
        synthesis.speak(next);
      } catch {
        cancelPlayback();
        setStatus("idle");
        setMessage(
          "Your browser could not play this answer. The text remains available.",
        );
      }
    }
    speakChunk(0);
  }, [synthesis, blocked, chunks, cancelPlayback]);
  useEffect(() => {
    if (blocked) {
      cancelPlayback();
      setStatus("idle");
    } else if (!attemptedAutoPlay.current) play();
  }, [blocked, play, cancelPlayback]);
  useEffect(() => () => cancelPlayback(), [cancelPlayback]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        cancelPlayback();
        setStatus("idle");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [cancelPlayback]);
  if (!synthesis)
    return (
      <p className="speech-message" role="status">
        Speech playback is unavailable in this browser. You can still read and
        copy the answer.
      </p>
    );
  const canPause =
    typeof synthesis.pause === "function" &&
    typeof synthesis.resume === "function";
  return (
    <div className="speech-controls" aria-label="Spoken answer controls">
      <div>
        <Volume2 size={16} />
        <span role="status">
          {blocked
            ? "Voice input active · playback stopped"
            : status === "starting"
              ? "Starting speech…"
              : status === "playing"
                ? "Reading answer"
                : status === "paused"
                  ? "Speech paused"
                  : "Spoken answer"}
        </span>
        {status === "idle" && (
          <button
            aria-label="Play spoken answer"
            disabled={blocked}
            onClick={play}
          >
            <Play size={16} />
            Play
          </button>
        )}
        {status === "playing" && canPause && (
          <button
            aria-label="Pause spoken answer"
            onClick={() => {
              synthesis.pause();
              setStatus("paused");
            }}
          >
            <Pause size={16} />
            Pause
          </button>
        )}
        {status === "paused" && canPause && (
          <button
            aria-label="Resume spoken answer"
            onClick={() => {
              synthesis.resume();
              setStatus("playing");
            }}
          >
            <Play size={16} />
            Resume
          </button>
        )}
        {status !== "idle" && (
          <button
            aria-label="Stop spoken answer"
            onClick={() => {
              cancelPlayback();
              setStatus("idle");
              setMessage("");
            }}
          >
            <Square size={16} />
            Stop
          </button>
        )}
      </div>
      <p>
        {message ||
          (canPause
            ? "Spoken math is approximate; check the equations on screen."
            : "Pause/resume is unavailable here. Use Stop to end playback.")}
      </p>
    </div>
  );
}
