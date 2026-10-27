import { useEffect, useState } from "react";
import { Mic, Square, X, Check, LoaderCircle } from "lucide-react";
import { useVoiceInput, voiceIsActive } from "../hooks/useVoiceInput";

export function VoiceInput({
  serverAvailable,
  disabled,
  onTranscript,
  onActiveChange,
}: {
  serverAvailable: boolean;
  disabled: boolean;
  onTranscript: (text: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const voice = useVoiceInput(serverAvailable);
  const [method, setMethod] = useState<"browser" | "server">(() =>
    serverAvailable && voice.capabilities.format ? "server" : "browser",
  );
  const [audioUrl, setAudioUrl] = useState("");
  const active = voiceIsActive(voice.phase);
  const supported =
    method === "browser"
      ? !!voice.capabilities.recognition
      : !!voice.capabilities.format && serverAvailable;
  useEffect(() => {
    onActiveChange(active);
    return () => onActiveChange(false);
  }, [active, onActiveChange]);
  useEffect(() => {
    if (!voice.recording) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(voice.recording);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voice.recording]);
  return (
    <div className="voice-input" aria-label="Voice question input">
      <div className="voice-toolbar">
        <label className="sr-only" htmlFor="voice-method">
          Voice input method
        </label>
        <select
          id="voice-method"
          value={method}
          disabled={active}
          onChange={(e) => {
            voice.clear();
            setMethod(e.target.value as "browser" | "server");
          }}
        >
          <option value="browser" disabled={!voice.capabilities.recognition}>
            Browser dictation
          </option>
          <option
            value="server"
            disabled={!serverAvailable || !voice.capabilities.format}
          >
            Record + transcribe
          </option>
        </select>
        {["recording", "listening"].includes(voice.phase) ? (
          <button
            type="button"
            className="recording-button"
            onClick={voice.stop}
            aria-label="Stop voice input"
          >
            <Square size={15} />
            Stop · {voice.seconds}s
          </button>
        ) : active ? (
          <span className="voice-working">
            <LoaderCircle size={15} className="spin" />
            {voice.phase === "requesting"
              ? "Allow microphone…"
              : voice.phase === "stopping"
                ? "Finishing…"
                : "Transcribing…"}
          </span>
        ) : (
          <button
            type="button"
            className="mic-button"
            aria-label="Start voice question"
            disabled={disabled || !supported}
            onClick={() => {
              window.speechSynthesis?.cancel();
              void voice.start(method);
            }}
          >
            <Mic size={17} />
            {voice.phase === "idle" || voice.phase === "error"
              ? "Speak"
              : "Record again"}
          </button>
        )}
        {(active || voice.recording || voice.phase === "review") && (
          <button
            type="button"
            aria-label="Cancel voice input"
            onClick={voice.cancel}
          >
            <X size={17} />
          </button>
        )}
      </div>
      <p className="voice-hint">
        {!supported
          ? "Voice input is unavailable here. Use the microphone on your device keyboard, or type. Recording needs HTTPS or localhost and server credentials."
          : method === "browser"
            ? "Starts only when you tap Speak. Your browser’s speech provider may process audio. Review the text before sending."
            : "Tap Speak, then Stop. Audio stays local until you tap Transcribe recording (60 seconds / 8 MB maximum)."}
      </p>
      {["recording", "listening"].includes(voice.phase) && (
        <p role="status" className="recording-status">
          <span />
          Microphone active · {voice.seconds}s
          {voice.phase === "listening" && voice.transcript
            ? ` · ${voice.transcript}`
            : ""}
        </p>
      )}
      {audioUrl && (
        <div className="recording-preview">
          <audio
            controls
            src={audioUrl}
            aria-label="Preview recorded question"
          />
          <button
            type="button"
            className="primary small"
            disabled={active || disabled}
            onClick={() => {
              void voice.transcribe();
            }}
          >
            Transcribe recording
          </button>
        </div>
      )}
      {voice.phase === "review" && (
        <div className="transcript-review">
          <label htmlFor="voice-transcript">Review transcript</label>
          <textarea
            id="voice-transcript"
            maxLength={4000}
            value={voice.transcript}
            onChange={(e) => voice.setTranscript(e.target.value)}
          />
          <button
            type="button"
            className="primary small"
            disabled={disabled || !voice.transcript.trim()}
            onClick={() => {
              onTranscript(voice.transcript.trim());
              voice.clear();
            }}
          >
            <Check size={15} />
            Use transcript
          </button>
        </div>
      )}
      {voice.message && (
        <p
          className={voice.phase === "error" ? "voice-error" : "voice-message"}
          role={voice.phase === "error" ? "alert" : "status"}
        >
          {voice.message}
        </p>
      )}
    </div>
  );
}
