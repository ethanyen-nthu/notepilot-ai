import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  ScanText,
} from "lucide-react";
import type { NoteDocument, PageContext } from "../types";
import type { PDFDocumentProxy } from "pdfjs-dist";

export function DocumentViewer({
  document,
  page,
  setPage,
  onContext,
  onError,
}: {
  document: NoteDocument;
  page: number;
  setPage: (n: number) => void;
  onContext: (c: PageContext | null) => void;
  onError: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    let active = true;
    let destroy: (() => void) | undefined;
    onContext(null);
    setLoading(true);
    setPdf(null);
    setPages(1);
    setZoom(1);
    setText("");
    if (document.kind === "pdf") {
      void (async () => {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const bytes = await document.blob.arrayBuffer();
        if (!active) return;
        const task = pdfjs.getDocument({
          data: bytes,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        });
        destroy = () => {
          void task.destroy();
        };
        const doc = await task.promise;
        if (active) {
          setPdf(doc);
          setPages(doc.numPages);
        }
      })().catch(() => {
        if (active) {
          setLoading(false);
          onError(
            "Unable to open this PDF. It may be damaged or password protected.",
          );
        }
      });
    }
    return () => {
      active = false;
      destroy?.();
    };
  }, [document, onContext, onError]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | undefined;
    const target = canvas.current;
    if (!target || (document.kind === "pdf" && !pdf)) return;
    setLoading(true);
    onContext(null);
    void (async () => {
      const scratch = window.document.createElement("canvas");
      const ctx = scratch.getContext("2d")!;
      let extracted = "";
      if (pdf) {
        const pdfPage = await pdf.getPage(page);
        const natural = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, 1600 / natural.width, 2200 / natural.height),
        });
        scratch.width = viewport.width;
        scratch.height = viewport.height;
        const task = pdfPage.render({
          canvasContext: ctx,
          canvas: scratch,
          viewport,
        });
        renderTask = task;
        await task.promise;
        const content = await pdfPage.getTextContent();
        extracted = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
      } else {
        const url = URL.createObjectURL(document.blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const scale = Math.min(1, 1600 / img.width, 2200 / img.height);
          scratch.width = img.width * scale;
          scratch.height = img.height * scale;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, scratch.width, scratch.height);
          ctx.drawImage(img, 0, 0, scratch.width, scratch.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (cancelled) return;
      target.width = scratch.width;
      target.height = scratch.height;
      target.getContext("2d")!.drawImage(scratch, 0, 0);
      setText(extracted);
      onContext({
        text: extracted.slice(0, 16000),
        image: scratch.toDataURL("image/jpeg", 0.8),
      });
      setLoading(false);
    })().catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") {
        setLoading(false);
        onError("This page could not be rendered. Try another document.");
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pdf, page, onContext, onError]);

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <span className="toolbar-label">DOCUMENT VIEW</span>
        <div className="toolbar-group">
          <button
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {page} <span className="muted">/ {pages}</span>
          </span>
          <button
            aria-label="Next page"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
          <i />
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            <ZoomOut size={17} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          >
            <ZoomIn size={17} />
          </button>
          <button
            title="Show selectable PDF text"
            aria-label="Show selectable PDF text"
            disabled={!text}
            aria-pressed={showText}
            onClick={() => setShowText((v) => !v)}
          >
            <ScanText size={17} />
          </button>
        </div>
      </div>
      <div className="page-scroll" aria-busy={loading}>
        {loading && (
          <div className="page-loading" role="status">
            Preparing your page…
          </div>
        )}
        <canvas
          ref={canvas}
          aria-label={`${document.title}, page ${page}`}
          style={{
            width: `${zoom * 100}%`,
            visibility: loading ? "hidden" : "visible",
          }}
        />
        {showText && text && (
          <div className="extracted-text">
            <h3>Selectable page text</h3>
            <p>{text}</p>
          </div>
        )}
      </div>
      <div className="viewer-foot">
        <span>
          <span className="status-dot" /> Page {page} is your study context
        </span>
        <span>Stored on this device</span>
      </div>
    </div>
  );
}
