import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderPlus,
  ImageIcon,
  Layers,
  Library as LibraryIcon,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Library, NoteDocument, PageContext, SavedAnswer } from "./types";
import type { TutorReply, TutorRequest } from "../shared/tutor";
import {
  loadLibrary,
  sampleLibrary,
  saveLibrary,
  validateFile,
} from "./storage";
import { DocumentViewer } from "./components/DocumentViewer";
import { AnswerOverlay, copyText } from "./components/AnswerOverlay";
import { MathText } from "./components/MathText";
import { newId } from "./id";
import { followUpQuestions, type FollowUp } from "../shared/tutor";
import { VoiceInput } from "./components/VoiceInput";

const modeOptions = [
  { id: "hint", name: "A little hint", caption: "Find your starting point" },
  { id: "steps", name: "Step by step", caption: "Understand the reasoning" },
  { id: "answer", name: "Direct answer", caption: "Get to the result" },
] as const;
const empty: Library = { courses: [], documents: [], saved: [] };
type History = TutorRequest["history"];

export default function App() {
  const [library, setLibrary] = useState<Library>(empty);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [course, setCourse] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"study" | "saved">("study");
  const [page, setPage] = useState(1);
  const [context, setContext] = useState<PageContext | null>(null);
  const [selection, setSelection] = useState("");
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<TutorRequest["mode"]>("steps");
  const [history, setHistory] = useState<History>([]);
  const [reply, setReply] = useState<
    (TutorReply & { question: string; id: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const [transcriptionAvailable, setTranscriptionAvailable] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<"demo" | "openai" | "offline">(
    "offline",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"course" | "rename" | "help" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [mobileLibrary, setMobileLibrary] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const current = library.documents.find((d) => d.id === selectedId);
  const reportError = useCallback((message: string) => setError(message), []);
  const receiveContext = useCallback(
    (value: PageContext | null) => setContext(value),
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadLibrary();
      const data = stored ?? (await sampleLibrary());
      if (!stored) await saveLibrary(data);
      if (active) {
        setLibrary(data);
        setSelectedId(data.documents[0]?.id ?? null);
        setReady(true);
      }
    })().catch(() => {
      if (active) {
        setReady(true);
        setError(
          "Local storage could not be opened. Enable browser storage and reload. Changes will only appear after they are saved successfully.",
        );
      }
    });
    void fetch("/api/status")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (active) {
          setProvider(data.provider === "openai" ? "openai" : "demo");
          setTranscriptionAvailable(data.transcription === true);
        }
      })
      .catch(() => {
        if (active) setProvider("offline");
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function persist(next: Library): Promise<boolean> {
    if (mutation.current) return false;
    mutation.current = true;
    setSaving(true);
    try {
      await saveLibrary(next);
      setLibrary(next);
      return true;
    } catch {
      setError(
        "Your changes could not be saved. Device storage may be full or unavailable. Free space and try again.",
      );
      return false;
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  function resetConversation() {
    setVoiceEpoch((epoch) => epoch + 1);
    setVoiceActive(false);
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setHistory([]);
    setReply(null);
    setQuestion("");
    setSelection("");
  }
  function openDocument(doc: NoteDocument) {
    resetConversation();
    setSelectedId(doc.id);
    setPage(1);
    setContext(null);
    setView("study");
    setMobileLibrary(false);
  }
  function changePage(n: number) {
    resetConversation();
    setPage(n);
    setContext(null);
  }
  async function importFiles(files: FileList | null) {
    if (!files || saving) return;
    const docs: NoteDocument[] = [];
    const courseId = course !== "all" ? course : library.courses[0]?.id;
    if (!courseId) {
      setError("Create a course before importing notes.");
      return;
    }
    for (const file of Array.from(files)) {
      const issue = validateFile(file);
      if (issue) {
        setError(`${file.name}: ${issue}`);
        continue;
      }
      docs.push({
        id: newId(),
        title: file.name.replace(/\.[^.]+$/, ""),
        courseId,
        kind: file.type === "application/pdf" ? "pdf" : "image",
        blob: file,
        added: new Date().toISOString(),
      });
    }
    if (
      docs.length &&
      (await persist({
        ...library,
        documents: [...library.documents, ...docs],
      }))
    ) {
      openDocument(docs[0]);
      setNotice(
        `${docs.length} document${docs.length > 1 ? "s" : ""} imported`,
      );
    }
    if (upload.current) upload.current.value = "";
  }
  async function submitQuestion(event?: React.FormEvent, followUp?: FollowUp) {
    event?.preventDefault();
    const asked = followUp ? followUpQuestions[followUp] : question.trim();
    if (
      !current ||
      !context ||
      !asked ||
      busy ||
      voiceActive ||
      (followUp && !history.length)
    )
      return;
    if (history.length >= 12) {
      setError(
        "This conversation has reached six exchanges. Start a new question to continue.",
      );
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          question: asked,
          mode,
          followUp,
          context: {
            title: current.title.slice(0, 250),
            page,
            text: selection || context.text,
            image: context.image,
          },
          history,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "The question could not be sent.");
      if (
        !["demo", "openai"].includes(data.provider) ||
        typeof data.answer !== "string"
      )
        throw new Error("The server returned an invalid explanation.");
      if (abort.signal.aborted) return;
      setReply({ ...data, question: asked, id: newId() });
      setHistory([
        ...history,
        { role: "user", content: asked },
        { role: "assistant", content: data.answer },
      ]);
      if (!followUp)
        setQuestion((draft) => (draft.trim() === asked ? "" : draft));
      setProvider(data.provider);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof TypeError
            ? "Cannot reach the tutoring server. Check your connection and make sure the backend is running."
            : e instanceof Error
              ? e.message
              : "Something went wrong. Try again.",
        );
    } finally {
      if (controller.current === abort) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function keepAnswer() {
    if (!reply || !current) return;
    const saved: SavedAnswer = {
      ...reply,
      documentId: current.id,
      title: current.title,
      page,
      created: new Date().toISOString(),
    };
    if (await persist({ ...library, saved: [...library.saved, saved] }))
      setNotice("Explanation saved to your notebook");
  }
  async function deleteDocument() {
    if (
      !current ||
      !window.confirm(
        `Delete “${current.title}” and its saved answers from this device?`,
      )
    )
      return;
    const next = {
      ...library,
      documents: library.documents.filter((d) => d.id !== current.id),
      saved: library.saved.filter((a) => a.documentId !== current.id),
    };
    if (await persist(next)) {
      resetConversation();
      setSelectedId(next.documents[0]?.id ?? null);
      setPage(1);
      setContext(null);
    }
  }
  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const next =
      dialog === "course"
        ? {
            ...library,
            courses: [
              ...library.courses,
              { id: newId(), name: name.trim(), color: "#8b80a6" },
            ],
          }
        : {
            ...library,
            documents: library.documents.map((d) =>
              d.id === current?.id ? { ...d, title: name.trim() } : d,
            ),
          };
    if (await persist(next)) {
      setDialog(null);
      setName("");
    }
  }
  async function deleteCourse() {
    const target = library.courses.find((c) => c.id === course);
    if (
      !target ||
      !window.confirm(
        `Delete “${target.name}” and all its documents and saved answers?`,
      )
    )
      return;
    const ids = new Set(
      library.documents.filter((d) => d.courseId === course).map((d) => d.id),
    );
    const next = {
      courses: library.courses.filter((c) => c.id !== course),
      documents: library.documents.filter((d) => !ids.has(d.id)),
      saved: library.saved.filter((a) => !ids.has(a.documentId)),
    };
    if (await persist(next)) {
      setCourse("all");
      if (selectedId && ids.has(selectedId)) {
        resetConversation();
        setSelectedId(next.documents[0]?.id ?? null);
        setPage(1);
        setContext(null);
      }
    }
  }
  const visibleDocs = library.documents.filter(
    (d) =>
      (course === "all" || d.courseId === course) &&
      d.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileLibrary ? "mobile-open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setView("study");
          }}
        >
          <span className="brand-mark">
            <Layers size={23} />
          </span>
          NotePilot<span className="ai-label">AI</span>
        </a>
        <div className="workspace-label">
          YOUR STUDY SPACE <span>01</span>
        </div>
        <nav className="main-nav">
          <button
            className={view === "study" ? "active" : ""}
            onClick={() => {
              setView("study");
              setCourse("all");
            }}
          >
            <LibraryIcon size={18} /> My library{" "}
            <span>{library.documents.length}</span>
          </button>
          <button
            className={view === "saved" ? "active" : ""}
            onClick={() => {
              setView("saved");
              setMobileLibrary(false);
            }}
          >
            <BookOpen size={18} /> Saved explanations{" "}
            <span>{library.saved.length}</span>
          </button>
        </nav>
        <div className="section-label">
          COURSES{" "}
          <button
            aria-label="Add course"
            onClick={() => {
              setName("");
              setDialog("course");
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="course-list">
          {library.courses.map((c) => (
            <button
              className={course === c.id ? "selected" : ""}
              key={c.id}
              onClick={() => {
                setCourse(c.id);
                setView("study");
              }}
            >
              <span className="course-dot" style={{ background: c.color }} />
              {c.name}
              <span>
                {library.documents.filter((d) => d.courseId === c.id).length}
              </span>
            </button>
          ))}
        </div>
        <button
          className="new-course"
          onClick={() => {
            setName("");
            setDialog("course");
          }}
        >
          <FolderPlus size={16} /> New course
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <Check size={17} />
            </span>
            <strong>Yours, on this device.</strong>
            <p>
              Your library stays here. Questions send a page; Transcribe
              recording sends audio.
            </p>
          </div>
          <button className="help-link" onClick={() => setDialog("help")}>
            <CircleHelp size={17} /> Getting started <ChevronRight size={15} />
          </button>
          <div className="profile">
            <span>Y</span>
            <div>
              Your workspace<small>No account needed</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle library navigation"
            onClick={() => setMobileLibrary((v) => !v)}
          >
            <LibraryIcon size={20} />
          </button>
          <div className="breadcrumb">
            My library <ChevronRight size={13} />
            <span>
              {view === "saved"
                ? "Saved explanations"
                : library.courses.find((c) => c.id === current?.courseId)
                    ?.name || "Study space"}
            </span>
          </div>
          <span className={`connection ${provider}`}>
            <span className="status-dot" />
            {provider === "demo"
              ? "Demo mode"
              : provider === "openai"
                ? "OpenAI connected"
                : "Tutoring server offline"}
          </span>
        </header>
        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LESS FRICTION. MORE UNDERSTANDING.</div>
              <h1>
                {view === "saved"
                  ? "Keep the lightbulb moments."
                  : "Make sense of your notes."}
              </h1>
              <p>
                {view === "saved"
                  ? "The explanations you chose to keep, all in one place."
                  : "Your notes, a little clarity, and room to think."}
              </p>
            </div>
            <button
              className="primary import-button"
              disabled={!ready || saving}
              onClick={() => upload.current?.click()}
            >
              <Plus size={18} /> Import notes
            </button>
            <input
              ref={upload}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void importFiles(e.target.files);
              }}
            />
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!ready ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              Opening your study space…
            </div>
          ) : view === "saved" ? (
            <div className="saved-grid">
              {library.saved.length === 0 && (
                <div className="empty-state">
                  <BookOpen size={32} />
                  <h2>A place for what clicks.</h2>
                  <p>
                    Ask a question, then choose “Keep answer” to save an
                    explanation here.
                  </p>
                  <button className="primary" onClick={() => setView("study")}>
                    Back to studying
                  </button>
                </div>
              )}
              {library.saved.map((answer) => (
                <article className="saved-card" key={answer.id}>
                  <div className="saved-meta">
                    <span className={`provider-tag ${answer.provider}`}>
                      {answer.provider === "demo"
                        ? "DEMO · SCRIPTED"
                        : "OPENAI"}
                    </span>
                    <button
                      aria-label="Delete saved explanation"
                      disabled={saving}
                      onClick={() => {
                        void persist({
                          ...library,
                          saved: library.saved.filter(
                            (a) => a.id !== answer.id,
                          ),
                        });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <h2>{answer.question}</h2>
                  <p className="muted">
                    {answer.title} · Page {answer.page}
                  </p>
                  <MathText text={answer.answer} />
                  <button
                    className="text-button"
                    onClick={() => {
                      void copyText(answer.answer)
                        .then(() => setNotice("Answer copied"))
                        .catch((e) => setError(e.message));
                    }}
                  >
                    <ArrowDownToLine size={15} />
                    Copy explanation
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <>
              <section className="document-strip" aria-label="Document library">
                <div className="strip-heading">
                  <div>
                    <h2>
                      Your notes <span>{visibleDocs.length}</span>
                    </h2>
                    <p>
                      {course === "all"
                        ? "A good thought starts here."
                        : library.courses.find((c) => c.id === course)?.name}
                    </p>
                  </div>
                  <div className="strip-actions">
                    {course !== "all" && (
                      <button
                        title="Delete selected course"
                        aria-label="Delete selected course"
                        disabled={saving}
                        onClick={() => {
                          void deleteCourse();
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search documents"
                        placeholder="Find a note…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
                <div className="document-cards">
                  {visibleDocs.map((doc) => (
                    <button
                      key={doc.id}
                      className={`document-card ${current?.id === doc.id ? "selected" : ""}`}
                      onClick={() => openDocument(doc)}
                    >
                      <span className={`file-icon ${doc.kind}`}>
                        {doc.kind === "pdf" ? (
                          <FileText size={22} />
                        ) : (
                          <ImageIcon size={22} />
                        )}
                      </span>
                      <span className="document-info">
                        <strong>{doc.title}</strong>
                        <small>
                          {
                            library.courses.find((c) => c.id === doc.courseId)
                              ?.name
                          }{" "}
                          <span>·</span> {doc.kind === "pdf" ? "PDF" : "Image"}
                        </small>
                      </span>
                      {current?.id === doc.id && (
                        <span className="document-check">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    className="add-document"
                    disabled={saving}
                    onClick={() => upload.current?.click()}
                  >
                    <Plus size={20} />
                    <span>
                      Add your notes<small>PDF, PNG, JPEG, WebP</small>
                    </span>
                  </button>
                </div>
                {!visibleDocs.length && (
                  <p className="no-results">
                    {search
                      ? "No notes match your search."
                      : "No notes in this course yet. Import a document to begin."}
                  </p>
                )}
              </section>
              {current ? (
                <div className="study-layout">
                  <section className="study-document">
                    <div className="document-heading">
                      <div>
                        <span className="eyebrow">ON YOUR DESK</span>
                        <h2>{current.title}</h2>
                      </div>
                      <div className="document-actions">
                        <select
                          aria-label="Move document to course"
                          value={current.courseId}
                          disabled={saving}
                          onChange={(e) => {
                            void persist({
                              ...library,
                              documents: library.documents.map((d) =>
                                d.id === current.id
                                  ? { ...d, courseId: e.target.value }
                                  : d,
                              ),
                            });
                          }}
                        >
                          {library.courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          aria-label="Rename document"
                          title="Rename document"
                          onClick={() => {
                            setName(current.title);
                            setDialog("rename");
                          }}
                        >
                          <MoreHorizontal size={19} />
                        </button>
                        <button
                          aria-label="Delete document"
                          title="Delete document"
                          disabled={saving}
                          onClick={() => {
                            void deleteDocument();
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <DocumentViewer
                      key={current.id}
                      document={current}
                      page={page}
                      setPage={changePage}
                      onContext={receiveContext}
                      onError={reportError}
                    />
                  </section>
                  <aside className="tutor-panel">
                    <div className="tutor-heading">
                      <span className="sparkle-box">
                        <Sparkles size={21} />
                      </span>
                      <div>
                        <h2>A little help, on hand.</h2>
                        <p>Your personal study companion</p>
                      </div>
                    </div>
                    <div className="tutor-content">
                      <span className="section-label">
                        HOW WOULD YOU LIKE TO LEARN?
                      </span>
                      <div className="mode-list">
                        {modeOptions.map((option) => (
                          <button
                            key={option.id}
                            className={mode === option.id ? "selected" : ""}
                            aria-pressed={mode === option.id}
                            onClick={() => setMode(option.id)}
                          >
                            <span className="radio-dot" />
                            <span>
                              <strong>{option.name}</strong>
                              <small>{option.caption}</small>
                            </span>
                            {mode === option.id && <Check size={15} />}
                          </button>
                        ))}
                      </div>
                      <div className="context-card">
                        <span>
                          <FileText size={14} /> STUDY CONTEXT
                        </span>
                        <strong>
                          {selection
                            ? "Your selected excerpt"
                            : `Current page · ${page}`}
                        </strong>
                        <p>
                          {selection
                            ? selection
                            : "The page on your desk will accompany your question."}
                        </p>
                        <details>
                          <summary>Add a focused excerpt</summary>
                          <textarea
                            aria-label="Selected study context"
                            maxLength={16000}
                            value={selection}
                            onChange={(e) => {
                              if (history.length) resetConversation();
                              setSelection(e.target.value);
                            }}
                            placeholder="Paste a passage or describe the area to focus on…"
                          />
                        </details>
                      </div>
                      {history.length > 0 ? (
                        <div className="conversation">
                          <div className="conversation-heading">
                            <span className="section-label">
                              THIS CONVERSATION
                            </span>
                            <button
                              className="text-button"
                              onClick={resetConversation}
                            >
                              <Plus size={13} />
                              New
                            </button>
                          </div>
                          {history.map((message, i) => (
                            <details key={i} className={message.role}>
                              <summary>
                                {message.role === "user"
                                  ? message.content
                                  : "View explanation"}
                              </summary>
                              {message.role === "assistant" && (
                                <MathText text={message.content} />
                              )}
                            </details>
                          ))}
                        </div>
                      ) : (
                        <div className="starter">
                          <MessageSquare size={21} />
                          <h3>Let’s untangle it.</h3>
                          <p>
                            A tricky formula? A missing step?
                            <br />
                            Start with what’s on your mind.
                          </p>
                          <button
                            onClick={() =>
                              setQuestion(
                                "Can you walk me through the example on this page?",
                              )
                            }
                          >
                            Walk me through this example <ArrowUp size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="response-preference">
                      <label htmlFor="response-mode">Response mode</label>
                      <select
                        id="response-mode"
                        value={spoken ? "spoken" : "text"}
                        onChange={(e) => setSpoken(e.target.value === "spoken")}
                      >
                        <option value="text">Text only</option>
                        <option value="spoken">Text + spoken answer</option>
                      </select>
                    </div>
                    <form
                      className="question-form"
                      onSubmit={(e) => {
                        void submitQuestion(e);
                      }}
                    >
                      <label className="sr-only" htmlFor="question">
                        Ask about your notes
                      </label>
                      <VoiceInput
                        key={`${current.id}:${page}:${voiceEpoch}:${transcriptionAvailable}`}
                        serverAvailable={transcriptionAvailable}
                        disabled={busy || !context}
                        onActiveChange={setVoiceActive}
                        onTranscript={(text) =>
                          setQuestion((draft) =>
                            [draft.trim(), text]
                              .filter(Boolean)
                              .join(" ")
                              .slice(0, 4000),
                          )
                        }
                      />
                      <textarea
                        id="question"
                        maxLength={4000}
                        placeholder={
                          history.length
                            ? "Ask a follow-up…"
                            : "Ask about your notes…"
                        }
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void submitQuestion();
                          }
                        }}
                      />
                      <div className="composer-bottom">
                        <span>
                          {busy
                            ? "Thinking with your notes…"
                            : "Text questions · Ctrl/⌘ + Enter"}
                        </span>
                        {busy ? (
                          <button
                            type="button"
                            className="stop-button"
                            onClick={() => {
                              controller.current?.abort();
                              setBusy(false);
                            }}
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            className="send-button"
                            aria-label="Ask NotePilot"
                            disabled={
                              !question.trim() ||
                              !context ||
                              voiceActive ||
                              provider === "offline"
                            }
                          >
                            <ArrowUp size={20} />
                          </button>
                        )}
                      </div>
                    </form>
                    <div className="tutor-disclaimer">
                      {provider === "demo"
                        ? "Demo mode · Scripted examples, not real AI."
                        : provider === "offline"
                          ? "Start the backend to ask questions."
                          : "AI can make mistakes. Check important answers."}
                    </div>
                  </aside>
                </div>
              ) : (
                <div className="empty-state">
                  <FileText size={32} />
                  <h2>Your next idea starts with a page.</h2>
                  <p>
                    Create a course and import a PDF or image to begin studying.
                  </p>
                </div>
              )}
              <div className="bottom-note">
                <span>
                  <span className="status-dot" /> A calmer way to study
                </span>
                <span>Made for your notes. Built around you.</span>
              </div>
            </>
          )}
        </div>
      </main>
      {reply && view === "study" && (
        <AnswerOverlay
          key={reply.id}
          reply={reply}
          question={reply.question}
          kept={library.saved.some((a) => a.id === reply.id)}
          onKeep={() => {
            if (!saving) void keepAnswer();
          }}
          onDismiss={() => setReply(null)}
          onError={reportError}
          spoken={spoken}
          voiceActive={voiceActive}
          followUpDisabled={
            busy || voiceActive || !context || history.length >= 12
          }
          onFollowUp={(action) => {
            void submitQuestion(undefined, action);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDialog(null);
              if (e.key === "Tab") {
                const items =
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button,input,a",
                  );
                const first = items[0],
                  last = items[items.length - 1];
                if (e.shiftKey && window.document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (
                  !e.shiftKey &&
                  window.document.activeElement === last
                ) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setDialog(null)}
            >
              <X size={20} />
            </button>
            {dialog === "help" ? (
              <>
                <span className="sparkle-box">
                  <Sparkles />
                </span>
                <h2 id="dialog-title">Welcome to your study space.</h2>
                <ol>
                  <li>
                    Export notes from your note-taking app as a PDF or image.
                  </li>
                  <li>Create a course, then import your notes.</li>
                  <li>
                    Choose a page and ask a question. A page image is sent only
                    when you submit.
                  </li>
                  <li>
                    Move, collapse, or dismiss the explanation. Keep it to save
                    it on this device.
                  </li>
                </ol>
                <p>
                  Demo responses are scripted. Real tutoring needs a server-side
                  OpenAI key. Tap Speak to draft a question, review the
                  transcript, then submit it. Text + spoken answer enables
                  browser speech. PNG/PDF answer export is planned for a later
                  milestone.
                </p>
                <p>
                  Library storage belongs to this browser. Clearing site data
                  deletes it. Your original files are unchanged.
                </p>
                <button
                  className="primary"
                  autoFocus
                  onClick={() => setDialog(null)}
                >
                  Let’s study <ArrowLeft size={16} />
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  void submitName(e);
                }}
              >
                <h2 id="dialog-title">
                  {dialog === "course"
                    ? "A new place to learn."
                    : "Rename your note"}
                </h2>
                <p>
                  {dialog === "course"
                    ? "Give your course a name that feels familiar."
                    : "Make it easy to find next time."}
                </p>
                <label htmlFor="item-name">
                  {dialog === "course" ? "Course name" : "Document title"}
                </label>
                <input
                  autoFocus
                  id="item-name"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Linear Algebra"
                />
                <button className="primary" disabled={!name.trim() || saving}>
                  {saving
                    ? "Saving…"
                    : dialog === "course"
                      ? "Create course"
                      : "Save name"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
