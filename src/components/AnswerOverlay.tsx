import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  GripHorizontal,
  Maximize2,
  Minus,
  Pin,
  X,
  Sparkles,
} from "lucide-react";
import { MathText } from "./MathText";
import type { TutorReply } from "../../shared/tutor";

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Some browsers deny clipboard permission; try the selection fallback. */
    }
  }
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.top = "0";
  area.style.fontSize = "16px";
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  const success = document.execCommand("copy");
  area.remove();
  if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  if (!success)
    throw new Error(
      "Copy is unavailable. Select and copy the answer text manually.",
    );
}
export function AnswerOverlay({
  reply,
  question,
  kept,
  onKeep,
  onDismiss,
  onError,
}: {
  reply: TutorReply;
  question: string;
  kept: boolean;
  onKeep: () => void;
  onDismiss: () => void;
  onError: (s: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    setPosition({ x: 0, y: 0 });
  }, [reply]);
  useEffect(() => {
    const reset = () => setPosition({ x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  function moveTo(x: number, y: number) {
    if (!panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    const baseX = rect.left - position.x,
      baseY = rect.top - position.y;
    setPosition({
      x: Math.max(
        8 - baseX,
        Math.min(window.innerWidth - rect.width - baseX - 8, x),
      ),
      y: Math.max(
        8 - baseY,
        Math.min(window.innerHeight - rect.height - baseY - 8, y),
      ),
    });
  }
  return (
    <section
      ref={panel}
      className={`answer-overlay ${expanded ? "expanded" : ""}`}
      aria-label="Temporary explanation"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <header>
        <div
          className="overlay-drag"
          role="button"
          tabIndex={0}
          aria-label="Move explanation with arrow keys or drag"
          title="Drag, or focus and use arrow keys"
          onKeyDown={(e) => {
            const deltas: Record<string, [number, number]> = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            };
            const delta = deltas[e.key];
            if (delta) {
              e.preventDefault();
              moveTo(position.x + delta[0], position.y + delta[1]);
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              startX: position.x,
              startY: position.y,
            };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const d = drag.current;
            moveTo(d.startX + e.clientX - d.x, d.startY + e.clientY - d.y);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <GripHorizontal size={17} />
          <Sparkles size={16} />
          <strong>Your explanation</strong>
        </div>
        <div className="toolbar-group">
          <button
            aria-label={
              collapsed ? "Expand explanation" : "Collapse explanation"
            }
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <Maximize2 size={16} /> : <Minus size={16} />}
          </button>
          <button aria-label="Dismiss explanation" onClick={onDismiss}>
            <X size={17} />
          </button>
        </div>
      </header>
      {!collapsed && (
        <>
          <div className="answer-body">
            <span className={`provider-tag ${reply.provider}`}>
              {reply.provider === "demo"
                ? "DEMO · SCRIPTED EXAMPLE"
                : "OPENAI · AI GENERATED"}
            </span>
            <h3>{question}</h3>
            <MathText text={reply.answer} />
          </div>
          <footer>
            <button
              className="text-button"
              onClick={() => {
                void copyText(reply.answer)
                  .then(() => setCopied(true))
                  .catch((e) => onError(e.message));
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="text-button"
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <Maximize2 size={15} />
              {expanded ? "Compact" : "Enlarge"}
            </button>
            <button className="primary small" disabled={kept} onClick={onKeep}>
              {kept ? <Check size={15} /> : <Pin size={15} />}{" "}
              {kept ? "Kept in notebook" : "Keep answer"}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
