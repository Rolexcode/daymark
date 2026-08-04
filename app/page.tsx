"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Subtask = {
  id: string;
  title: string;
  done: boolean;
};

type TimeBlock = {
  id: string;
  title: string;
  start: string;
  end: string;
  done: boolean;
  subtasks: Subtask[];
};

type DayPlan = {
  blocks: TimeBlock[];
  reflection: string;
  reviewed: boolean;
};

type DraftBlock = Omit<TimeBlock, "done">;

const emptyPlan = (): DayPlan => ({ blocks: [], reflection: "", reviewed: false });
const storageKey = (date: string) => `daymark:v1:plan:${date}`;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDayKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function moveDate(key: string, amount: number) {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + amount);
  return dayKey(date);
}

function displayTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function starterPlan(): DayPlan {
  const block = (
    title: string,
    start: string,
    end: string,
    subtasks: string[] = [],
  ): TimeBlock => ({
    id: id(),
    title,
    start,
    end,
    done: false,
    subtasks: subtasks.map((item) => ({ id: id(), title: item, done: false })),
  });

  return {
    reflection: "",
    reviewed: false,
    blocks: [
      block("Morning workout", "05:30", "06:00", ["Fill water bottle", "5-minute warm-up"]),
      block("Watch a tutorial video", "06:00", "07:00"),
      block("Take a nap", "07:00", "09:00"),
      block("Lecture / deep learning", "09:00", "11:00"),
      block("Job hunt", "11:00", "17:00", [
        "Message 10 clients",
        "Submit 3 applications",
        "Follow up with 5 leads",
      ]),
    ],
  };
}

function cleanSubtask(value: unknown): Subtask | null {
  if (!value || typeof value !== "object") return null;
  const incoming = value as Partial<Subtask>;
  const title = typeof incoming.title === "string" ? incoming.title.trim() : "";
  if (!title) return null;

  return {
    id: typeof incoming.id === "string" && incoming.id ? incoming.id : id(),
    title,
    done: Boolean(incoming.done),
  };
}

function cleanBlock(value: unknown): TimeBlock | null {
  if (!value || typeof value !== "object") return null;
  const incoming = value as Partial<TimeBlock>;
  const title = typeof incoming.title === "string" ? incoming.title.trim() : "";
  const start = typeof incoming.start === "string" ? incoming.start : "";
  const end = typeof incoming.end === "string" ? incoming.end : "";
  if (!title || !timePattern.test(start) || !timePattern.test(end) || end <= start) return null;

  const subtasks = Array.isArray(incoming.subtasks)
    ? incoming.subtasks.map(cleanSubtask).filter((task): task is Subtask => task !== null)
    : [];

  return {
    id: typeof incoming.id === "string" && incoming.id ? incoming.id : id(),
    title,
    start,
    end,
    done: Boolean(incoming.done),
    subtasks,
  };
}

function cleanPlan(value: unknown): DayPlan {
  if (!value || typeof value !== "object") return emptyPlan();
  const incoming = value as Partial<DayPlan>;
  return {
    blocks: Array.isArray(incoming.blocks)
      ? incoming.blocks.map(cleanBlock).filter((block): block is TimeBlock => block !== null)
      : [],
    reflection: typeof incoming.reflection === "string" ? incoming.reflection : "",
    reviewed: Boolean(incoming.reviewed),
  };
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState("");
  const [plan, setPlan] = useState<DayPlan>(emptyPlan);
  const [loadedDate, setLoadedDate] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftBlock>({
    id: "",
    title: "",
    start: "09:00",
    end: "09:30",
    subtasks: [],
  });
  const [formError, setFormError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [carryUnfinished, setCarryUnfinished] = useState(true);
  const [deleted, setDeleted] = useState<{ block: TimeBlock; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelectedDate(dayKey(new Date()));
  }, []);

  const persist = useCallback(async (date: string, nextPlan: DayPlan) => {
    setSaveState("saving");
    try {
      window.localStorage.setItem(storageKey(date), JSON.stringify(nextPlan));
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setIsLoading(true);
    setLoadedDate("");
    try {
      const saved = window.localStorage.getItem(storageKey(selectedDate));
      let nextPlan = saved ? cleanPlan(JSON.parse(saved)) : emptyPlan();
      if (saved === null && selectedDate === dayKey(new Date())) {
        nextPlan = starterPlan();
        void persist(selectedDate, nextPlan);
      }
      setPlan(nextPlan);
      setLoadedDate(selectedDate);
      setSaveState("saved");
    } catch {
      setPlan(emptyPlan());
      setLoadedDate(selectedDate);
      setSaveState("error");
    } finally {
      setIsLoading(false);
    }
  }, [persist, selectedDate]);

  useEffect(() => {
    if (!selectedDate || loadedDate !== selectedDate || isLoading) return;
    const timer = setTimeout(() => void persist(selectedDate, plan), 650);
    return () => clearTimeout(timer);
  }, [isLoading, loadedDate, persist, plan, selectedDate]);

  const sortedBlocks = useMemo(
    () => [...plan.blocks].sort((a, b) => a.start.localeCompare(b.start)),
    [plan.blocks],
  );
  const completedBlocks = plan.blocks.filter((block) => block.done).length;
  const progress = plan.blocks.length
    ? Math.round((completedBlocks / plan.blocks.length) * 100)
    : 0;
  const allSubtasks = plan.blocks.flatMap((block) => block.subtasks);
  const completedSubtasks = allSubtasks.filter((task) => task.done).length;

  const currentDay = selectedDate ? fromDayKey(selectedDate) : new Date();
  const today = dayKey(new Date());
  const tomorrow = moveDate(today, 1);
  const dateEyebrow =
    selectedDate === today ? "Today" : selectedDate === tomorrow ? "Tomorrow" : "Your plan";
  const dateLabel = currentDay.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function navigate(date: string) {
    if (loadedDate === selectedDate) void persist(selectedDate, plan);
    setSelectedDate(date);
  }

  function openNewBlock() {
    const lastEnd = sortedBlocks.at(-1)?.end ?? "09:00";
    const [hour, minute] = lastEnd.split(":").map(Number);
    const endMinutes = Math.min(hour * 60 + minute + 30, 23 * 60 + 59);
    setEditingId(null);
    setDraft({
      id: id(),
      title: "",
      start: lastEnd,
      end: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
      subtasks: [],
    });
    setFormError("");
    setEditorOpen(true);
  }

  function openEditBlock(block: TimeBlock) {
    setEditingId(block.id);
    setDraft({
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      subtasks: block.subtasks.map((task) => ({ ...task })),
    });
    setFormError("");
    setEditorOpen(true);
  }

  const overlap = plan.blocks.some(
    (block) =>
      block.id !== editingId &&
      draft.start < block.end &&
      draft.end > block.start,
  );

  function saveBlock(event: FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setFormError("Give this time block a name.");
      return;
    }
    if (!draft.start || !draft.end || draft.end <= draft.start) {
      setFormError("End time needs to be later than start time.");
      return;
    }
    const nextBlock: TimeBlock = {
      ...draft,
      title,
      done: editingId ? plan.blocks.find((block) => block.id === editingId)?.done ?? false : false,
      subtasks: draft.subtasks
        .map((task) => ({ ...task, title: task.title.trim() }))
        .filter((task) => task.title),
    };
    setPlan((current) => ({
      ...current,
      reviewed: false,
      blocks: editingId
        ? current.blocks.map((block) => (block.id === editingId ? nextBlock : block))
        : [...current.blocks, nextBlock],
    }));
    setEditorOpen(false);
  }

  function setBlockDone(blockId: string, done: boolean) {
    setPlan((current) => ({
      ...current,
      reviewed: false,
      blocks: current.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              done,
              subtasks: block.subtasks.map((task) => ({ ...task, done })),
            }
          : block,
      ),
    }));
  }

  function setSubtaskDone(blockId: string, subtaskId: string, done: boolean) {
    setPlan((current) => ({
      ...current,
      reviewed: false,
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId) return block;
        const subtasks = block.subtasks.map((task) =>
          task.id === subtaskId ? { ...task, done } : task,
        );
        return {
          ...block,
          subtasks,
          done: subtasks.length > 0 && subtasks.every((task) => task.done),
        };
      }),
    }));
  }

  function removeBlock(block: TimeBlock) {
    const index = plan.blocks.findIndex((item) => item.id === block.id);
    setPlan((current) => ({
      ...current,
      reviewed: false,
      blocks: current.blocks.filter((item) => item.id !== block.id),
    }));
    setDeleted({ block, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), 5000);
  }

  function undoDelete() {
    if (!deleted) return;
    setPlan((current) => {
      const blocks = [...current.blocks];
      blocks.splice(Math.min(deleted.index, blocks.length), 0, deleted.block);
      return { ...current, blocks };
    });
    setDeleted(null);
  }

  async function copyToday() {
    try {
      const saved = window.localStorage.getItem(storageKey(today));
      const storedPlan = saved ? cleanPlan(JSON.parse(saved)) : null;
      const source = storedPlan?.blocks.length ? storedPlan : starterPlan();
      setPlan({
        reflection: "",
        reviewed: false,
        blocks: source.blocks.map((block) => ({
          ...block,
          id: id(),
          done: false,
          subtasks: block.subtasks.map((task) => ({ ...task, id: id(), done: false })),
        })),
      });
    } catch {
      setSaveState("error");
    }
  }

  async function saveReviewAndPlanTomorrow() {
    const reviewedPlan = { ...plan, reviewed: true };
    setPlan(reviewedPlan);
    const reviewSaved = await persist(selectedDate, reviewedPlan);
    if (!reviewSaved) return;
    const nextDate = moveDate(selectedDate, 1);

    if (carryUnfinished) {
      try {
        const savedNextPlan = window.localStorage.getItem(storageKey(nextDate));
        if (savedNextPlan === null) {
          const unfinished = plan.blocks
            .filter((block) => !block.done)
            .map((block) => ({
              ...block,
              id: id(),
              done: false,
              subtasks: block.subtasks.map((task) => ({ ...task, id: id(), done: false })),
            }));
          if (unfinished.length) {
            const tomorrowSaved = await persist(nextDate, {
              blocks: unfinished,
              reflection: "",
              reviewed: false,
            });
            if (!tomorrowSaved) return;
          }
        }
      } catch {
        setSaveState("error");
      }
    }

    setReviewOpen(false);
    setSelectedDate(nextDate);
  }

  if (!selectedDate) {
    return <main className="app-loading">Preparing your day…</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate(today)} aria-label="Go to today">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>
            <strong>DAYMARK</strong>
            <small>Plan with intention</small>
          </span>
        </button>
        <div className={`save-status ${saveState}`} role="status" aria-live="polite">
          <span aria-hidden="true" />
          {saveState === "saving" ? "Saving" : saveState === "error" ? "Save issue" : "Saved"}
        </div>
        <button className="plan-tomorrow" onClick={() => navigate(moveDate(selectedDate, 1))}>
          Plan next day <span aria-hidden="true">→</span>
        </button>
      </header>

      <section className="hero-row">
        <div>
          <p className="eyebrow">{dateEyebrow}</p>
          <h1>{dateLabel}</h1>
          <p className="hero-copy">A clear day begins the night before.</p>
        </div>
        <nav className="date-nav" aria-label="Choose a day">
          <button onClick={() => navigate(moveDate(selectedDate, -1))} aria-label="Previous day">←</button>
          <button className="today-button" onClick={() => navigate(today)}>Today</button>
          <button onClick={() => navigate(moveDate(selectedDate, 1))} aria-label="Next day">→</button>
        </nav>
      </section>

      <div className="workspace">
        <section className="schedule" aria-labelledby="schedule-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Your rhythm</p>
              <h2 id="schedule-heading">Daily timeline</h2>
            </div>
            <button className="add-button" onClick={openNewBlock}>
              <span aria-hidden="true">+</span> Add block
            </button>
          </div>

          {isLoading ? (
            <div className="loading-list" aria-label="Loading plan">
              <div /><div /><div />
            </div>
          ) : sortedBlocks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orbit" aria-hidden="true"><span /></div>
              <p className="section-kicker">A fresh page</p>
              <h3>Shape this day before it shapes you.</h3>
              <p>Add a time block from scratch, copy today, or start with your example routine.</p>
              <div className="empty-actions">
                <button className="primary-button" onClick={openNewBlock}>Add first block</button>
                {selectedDate !== today && <button className="secondary-button" onClick={copyToday}>Copy today</button>}
                <button className="text-button" onClick={() => setPlan(starterPlan())}>Use example routine</button>
              </div>
            </div>
          ) : (
            <div className="timeline-list">
              {sortedBlocks.map((block, index) => (
                <article className={`time-block ${block.done ? "is-done" : ""}`} key={block.id}>
                  <div className="timeline-rail" aria-hidden="true">
                    <span className="timeline-dot" />
                    {index < sortedBlocks.length - 1 && <span className="timeline-line" />}
                  </div>
                  <button
                    className={`check-button ${block.done ? "checked" : ""}`}
                    onClick={() => setBlockDone(block.id, !block.done)}
                    aria-label={`${block.done ? "Mark incomplete" : "Mark complete"}: ${block.title}`}
                    aria-pressed={block.done}
                  >
                    <span aria-hidden="true">✓</span>
                  </button>
                  <div className="block-content">
                    <div className="block-topline">
                      <p className="time-range">
                        <span>{displayTime(block.start)}</span>
                        <i aria-hidden="true">—</i>
                        <span>{displayTime(block.end)}</span>
                      </p>
                      <div className="block-actions">
                        <button onClick={() => openEditBlock(block)} aria-label={`Edit ${block.title}`}>Edit</button>
                        <button onClick={() => removeBlock(block)} aria-label={`Delete ${block.title}`}>Delete</button>
                      </div>
                    </div>
                    <h3>{block.title}</h3>
                    {block.subtasks.length > 0 && (
                      <div className="subtask-list">
                        {block.subtasks.map((task) => (
                          <label className={task.done ? "subtask-done" : ""} key={task.id}>
                            <input
                              type="checkbox"
                              checked={task.done}
                              onChange={(event) => setSubtaskDone(block.id, task.id, event.target.checked)}
                            />
                            <span className="mini-check" aria-hidden="true">✓</span>
                            <span>{task.title}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <button className="timeline-add" onClick={openNewBlock}>+ Add another time block</button>
            </div>
          )}
        </section>

        <aside className="side-panel">
          <section className="progress-card">
            <p className="section-kicker">Today at a glance</p>
            <div className="progress-visual">
              <div
                className="progress-ring"
                style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}
                aria-label={`${progress}% complete`}
              >
                <div><strong>{progress}%</strong><span>complete</span></div>
              </div>
              <div className="progress-copy">
                <strong>{completedBlocks} of {plan.blocks.length}</strong>
                <span>blocks complete</span>
                <small>{completedSubtasks} of {allSubtasks.length} small steps done</small>
              </div>
            </div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          </section>

          <section className="review-card">
            <div className="review-symbol" aria-hidden="true">✓</div>
            <p className="section-kicker">Evening reset</p>
            <h2>{plan.reviewed ? "Day reviewed." : "Close the loop."}</h2>
            <p>
              {plan.reviewed
                ? "You checked in honestly. Tomorrow is ready for a fresh plan."
                : "Mark what happened, note what mattered, then set up your next day."}
            </p>
            <button className="review-button" onClick={() => setReviewOpen(true)} disabled={!plan.blocks.length}>
              {plan.reviewed ? "Review again" : "Review this day"} <span aria-hidden="true">→</span>
            </button>
          </section>

          <blockquote>
            “Small promises, kept daily, become a different life.”
          </blockquote>
        </aside>
      </div>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditorOpen(false)}>
          <section
            className="modal-card editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="section-kicker">Time block</p>
                <h2 id="editor-title">{editingId ? "Edit your plan" : "Add to your day"}</h2>
              </div>
              <button className="modal-close" onClick={() => setEditorOpen(false)} aria-label="Close">×</button>
            </div>
            <form onSubmit={saveBlock}>
              <label className="field-label">
                What are you doing?
                <input
                  autoFocus
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="e.g. Job hunt"
                />
              </label>
              <div className="time-fields">
                <label className="field-label">Starts<input type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
                <span aria-hidden="true">→</span>
                <label className="field-label">Ends<input type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
              </div>
              {overlap && draft.end > draft.start && (
                <p className="form-note">This overlaps another block. You can still save it.</p>
              )}
              <div className="subtask-editor">
                <div>
                  <span className="field-label">Small steps</span>
                  <small>Optional — make a big block easier to start.</small>
                </div>
                {draft.subtasks.map((task, index) => (
                  <div className="subtask-input" key={task.id}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <input
                      aria-label={`Small step ${index + 1}`}
                      value={task.title}
                      onChange={(event) => setDraft({
                        ...draft,
                        subtasks: draft.subtasks.map((item) => item.id === task.id ? { ...item, title: event.target.value } : item),
                      })}
                      placeholder="e.g. Message 10 clients"
                    />
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, subtasks: draft.subtasks.filter((item) => item.id !== task.id) })}
                      aria-label={`Remove small step ${index + 1}`}
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="add-subtask"
                  onClick={() => setDraft({
                    ...draft,
                    subtasks: [...draft.subtasks, { id: id(), title: "", done: false }],
                  })}
                >+ Add a small step</button>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button">Save block</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setReviewOpen(false)}>
          <section
            className="modal-card review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="section-kicker">Evening reset</p>
                <h2 id="review-title">How did the day go?</h2>
                <p>Honest beats perfect. Mark each promise with a yes or not yet.</p>
              </div>
              <button className="modal-close" onClick={() => setReviewOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="review-list">
              {sortedBlocks.map((block) => (
                <div className="review-row" key={block.id}>
                  <div><span>{displayTime(block.start)}</span><strong>{block.title}</strong></div>
                  <div className="yes-no">
                    <button className={block.done ? "active" : ""} onClick={() => setBlockDone(block.id, true)}>Yes</button>
                    <button className={!block.done ? "active not-yet" : ""} onClick={() => setBlockDone(block.id, false)}>Not yet</button>
                  </div>
                </div>
              ))}
            </div>
            <label className="field-label reflection-field">
              One line about today <span>(optional)</span>
              <textarea
                value={plan.reflection}
                onChange={(event) => setPlan({ ...plan, reflection: event.target.value, reviewed: false })}
                placeholder="What helped—or got in the way?"
                rows={3}
              />
            </label>
            <label className="carry-option">
              <input type="checkbox" checked={carryUnfinished} onChange={(event) => setCarryUnfinished(event.target.checked)} />
              <span className="mini-check" aria-hidden="true">✓</span>
              Carry unfinished blocks into tomorrow if it is empty
            </label>
            <button className="finish-button" onClick={saveReviewAndPlanTomorrow}>
              Save today & plan tomorrow <span aria-hidden="true">→</span>
            </button>
          </section>
        </div>
      )}

      {deleted && (
        <div className="undo-toast" role="status">
          <span>“{deleted.block.title}” deleted</span>
          <button onClick={undoDelete}>Undo</button>
        </div>
      )}
    </main>
  );
}
