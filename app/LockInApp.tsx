import { FormEvent, useEffect, useMemo, useState } from "react";
import { downloadLockInCalendar } from "./lockin/calendar";
import {
  addCalendarDays,
  canCheckInOn,
  clampToLockIn,
  getDateInTimeZone,
  getLockInDates,
  getLockInDayNumber,
  LOCK_IN_END_DATE,
  LOCK_IN_START_DATE,
  LOCK_IN_TOTAL_DAYS,
} from "./lockin/dates";
import {
  calculateDayStats,
  calculateLockInStats,
  getChallengeGrid,
} from "./lockin/stats";
import {
  loadLockInState,
  saveLockInState,
  subscribeToLockInStorage,
} from "./lockin/storage";
import type {
  BabyTask,
  HabitCompletion,
  IsoDate,
  LockInHabit,
  LockInState,
} from "./lockin/types";

type LockInAppProps = {
  onOpenPlanner: () => void;
};

type HabitDraft = {
  id: string;
  title: string;
  babyTasks: string;
};

type SaveStatus = "saved" | "saving" | "error";

const EMPTY_DRAFT_COUNT = 10;

function makeId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function formatDate(date: IsoDate, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
}

function draftsFromState(state: LockInState): HabitDraft[] {
  const populated = state.habits.map((habit) => ({
    id: habit.id,
    title: habit.title,
    babyTasks: habit.babyTasks.map((task) => task.title).join(", "),
  }));
  return Array.from({ length: Math.max(EMPTY_DRAFT_COUNT, populated.length) }, (_, index) =>
    populated[index] ?? { id: makeId("habit"), title: "", babyTasks: "" },
  ).slice(0, EMPTY_DRAFT_COUNT);
}

function parseBabyTasks(draft: HabitDraft, previous?: LockInHabit): BabyTask[] {
  const existingByTitle = new Map(
    previous?.babyTasks.map((task) => [task.title.toLocaleLowerCase(), task]) ?? [],
  );
  return Array.from(
    new Set(
      draft.babyTasks
        .split(/[\n,]/)
        .map((task) => task.trim())
        .filter(Boolean),
    ),
  ).map((title) => ({
    id: existingByTitle.get(title.toLocaleLowerCase())?.id ?? makeId("step"),
    title,
  }));
}

function dayEntry(state: LockInState, date: IsoDate) {
  return state.days[date] ?? { completions: {} };
}

function dayStatusLabel(state: LockInState, date: IsoDate, today: IsoDate) {
  if (date > today) return "Future";
  const stats = calculateDayStats(state, date);
  if (stats.isPerfect) return "Perfect";
  if (stats.completedHabits > 0) return `${stats.completedHabits} of ${stats.totalHabits}`;
  return date === today ? "Not started" : "Missed";
}

export default function LockInApp({ onOpenPlanner }: LockInAppProps) {
  const initialLoad = useMemo(() => loadLockInState(), []);
  const [state, setState] = useState(initialLoad.state);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    initialLoad.error ? "error" : "saved",
  );
  const [storageMessage, setStorageMessage] = useState(
    initialLoad.error?.message ?? initialLoad.warnings[0] ?? "",
  );
  const [editingSetup, setEditingSetup] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [displayName, setDisplayName] = useState(initialLoad.state.challenge.displayName);
  const [challengeTitle, setChallengeTitle] = useState(initialLoad.state.challenge.title);
  const [checkInTime, setCheckInTime] = useState(initialLoad.state.challenge.checkInTime);
  const [habitDrafts, setHabitDrafts] = useState(() => draftsFromState(initialLoad.state));
  const today = getDateInTimeZone(new Date(), state.challenge.timeZone);
  const [selectedDate, setSelectedDate] = useState<IsoDate>(() => clampToLockIn(today));
  const [calendarMessage, setCalendarMessage] = useState("");

  const setupOpen = state.habits.length === 0 || editingSetup;
  const hasStarted = today >= LOCK_IN_START_DATE;
  const selectedEntry = dayEntry(state, selectedDate);
  const selectedStats = calculateDayStats(state, selectedDate);
  const overallStats = calculateLockInStats(state, today);
  const challengeGrid = useMemo(() => getChallengeGrid(state), [state]);
  const canEditSelectedDate = canCheckInOn(selectedDate, today);
  const dayNumber = getLockInDayNumber(selectedDate) ?? 1;

  const months = useMemo(() => {
    const labels = ["September", "October", "November", "December"];
    return labels.map((label, index) => ({
      label,
      dates: getLockInDates().filter((date) => Number(date.slice(5, 7)) === index + 9),
    }));
  }, []);

  useEffect(
    () =>
      subscribeToLockInStorage((result) => {
        setState(result.state);
        setSaveStatus(result.error ? "error" : "saved");
        setStorageMessage(result.error?.message ?? result.warnings[0] ?? "");
      }),
    [],
  );

  function commit(nextState: LockInState) {
    setSaveStatus("saving");
    const result = saveLockInState(nextState);
    setState(result.state);
    setSaveStatus(result.ok ? "saved" : "error");
    setStorageMessage(result.ok ? result.warnings[0] ?? "" : result.error.message);
    return result.ok;
  }

  function openSetup() {
    setDisplayName(state.challenge.displayName);
    setChallengeTitle(state.challenge.title);
    setCheckInTime(state.challenge.checkInTime);
    setHabitDrafts(draftsFromState(state));
    setSetupError("");
    setEditingSetup(true);
  }

  function saveSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeDrafts = habitDrafts.filter((draft) => draft.title.trim());
    if (activeDrafts.length === 0) {
      setSetupError("Add at least one daily habit before you lock in.");
      document.getElementById("lockin-habit-1")?.focus();
      return;
    }

    if (hasStarted && state.habits.length > 0 && activeDrafts.length !== state.habits.length) {
      setSetupError("After September 1, keep the same habits so your history stays accurate.");
      return;
    }

    const previousById = new Map(state.habits.map((habit) => [habit.id, habit]));
    const habits: LockInHabit[] = activeDrafts.map((draft) => ({
      id: draft.id,
      title: draft.title.trim(),
      babyTasks: parseBabyTasks(draft, previousById.get(draft.id)),
    }));
    const next: LockInState = {
      ...state,
      challenge: {
        ...state.challenge,
        title: challengeTitle.trim() || "My 122-day lock-in",
        displayName: displayName.trim(),
        checkInTime,
      },
      habits,
    };

    if (commit(next)) {
      setSetupError("");
      setEditingSetup(false);
    }
  }

  function updateCompletion(
    habitId: string,
    updater: (current: HabitCompletion) => HabitCompletion,
  ) {
    if (!canEditSelectedDate) return;
    const currentDay = dayEntry(state, selectedDate);
    const currentCompletion = currentDay.completions[habitId] ?? {
      done: false,
      completedBabyTaskIds: [],
    };
    const completion = updater(currentCompletion);
    const completions = { ...currentDay.completions };
    if (!completion.done && completion.completedBabyTaskIds.length === 0) {
      delete completions[habitId];
    } else {
      completions[habitId] = completion;
    }
    commit({
      ...state,
      days: {
        ...state.days,
        [selectedDate]: { ...currentDay, completions },
      },
    });
  }

  function toggleHabit(habit: LockInHabit) {
    updateCompletion(habit.id, (current) => {
      const done = !current.done;
      return {
        done,
        completedBabyTaskIds: done
          ? habit.babyTasks.map((task) => task.id)
          : current.completedBabyTaskIds,
      };
    });
  }

  function toggleBabyTask(habit: LockInHabit, taskId: string) {
    updateCompletion(habit.id, (current) => {
      const isComplete = current.completedBabyTaskIds.includes(taskId);
      const completedBabyTaskIds = isComplete
        ? current.completedBabyTaskIds.filter((id) => id !== taskId)
        : [...current.completedBabyTaskIds, taskId];
      return {
        completedBabyTaskIds,
        done:
          habit.babyTasks.length > 0 &&
          habit.babyTasks.every((task) => completedBabyTaskIds.includes(task.id)),
      };
    });
  }

  function updateNote(note: string) {
    if (!canEditSelectedDate) return;
    const currentDay = dayEntry(state, selectedDate);
    commit({
      ...state,
      days: {
        ...state.days,
        [selectedDate]: { ...currentDay, note },
      },
    });
  }

  function finishCheckIn() {
    if (!canEditSelectedDate) return;
    const currentDay = dayEntry(state, selectedDate);
    commit({
      ...state,
      days: {
        ...state.days,
        [selectedDate]: { ...currentDay, finalizedAt: new Date().toISOString() },
      },
    });
  }

  function downloadCalendar() {
    try {
      downloadLockInCalendar({
        time: state.challenge.checkInTime,
        timeZone: state.challenge.timeZone,
      });
      setCalendarMessage(
        "Reminder downloaded. Open the file and add the daily event to Google Calendar.",
      );
    } catch {
      setCalendarMessage("The reminder could not be created. Try again in this browser.");
    }
  }

  function exportBackup() {
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "daymark-lock-in-backup.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  }

  if (setupOpen) {
    return (
      <main className="lockin-shell">
        <header className="lockin-topbar">
          <button className="brand" type="button" onClick={() => setEditingSetup(false)}>
            <span className="brand-mark" aria-hidden="true">D</span>
            <span><strong>DAYMARK</strong><small>Your personal lock-in</small></span>
          </button>
          {state.habits.length > 0 && (
            <button className="lockin-secondary-action" type="button" onClick={() => setEditingSetup(false)}>
              Back to today
            </button>
          )}
        </header>

        <section className="lockin-setup" aria-labelledby="lockin-setup-title">
          <div className="lockin-setup-intro">
            <p className="section-kicker">September 1 — December 31</p>
            <h1 id="lockin-setup-title">Make 122 days count.</h1>
            <p>
              Set the promises you want to keep daily. You can check in honestly, see your
              streaks, and return to any past day.
            </p>
            <div className="lockin-date-summary" aria-label="Challenge dates">
              <span><strong>122</strong> days</span>
              <span><strong>10</strong> habits max</span>
              <span><strong>1</strong> honest check-in</span>
            </div>
          </div>

          <form className="lockin-setup-card" onSubmit={saveSetup} noValidate>
            <div className="lockin-setup-grid">
              <label className="lockin-field" htmlFor="lockin-name">
                What should Daymark call you? <span>Optional</span>
                <input
                  id="lockin-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="lockin-field" htmlFor="lockin-title">
                Challenge name
                <input
                  id="lockin-title"
                  value={challengeTitle}
                  onChange={(event) => setChallengeTitle(event.target.value)}
                  placeholder="My 122-day lock-in"
                />
              </label>
              <label className="lockin-field" htmlFor="lockin-time">
                Evening check-in
                <input
                  id="lockin-time"
                  type="time"
                  value={checkInTime}
                  onChange={(event) => setCheckInTime(event.target.value)}
                />
                <small>Africa/Lagos time. You can add this to your calendar after setup.</small>
              </label>
            </div>

            <fieldset className="lockin-habit-fields">
              <legend>Your daily habits</legend>
              <p>Leave unused rows empty. Add baby steps with commas.</p>
              {habitDrafts.map((draft, index) => (
                <div className="lockin-habit-draft" key={draft.id}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <label htmlFor={`lockin-habit-${index + 1}`}>
                    <span>Habit {index + 1}</span>
                    <input
                      id={`lockin-habit-${index + 1}`}
                      value={draft.title}
                      onChange={(event) =>
                        setHabitDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id ? { ...item, title: event.target.value } : item,
                          ),
                        )
                      }
                      placeholder={index === 0 ? "e.g. Work out for 30 minutes" : "Daily habit"}
                      aria-invalid={setupError && index === 0 ? "true" : undefined}
                      aria-describedby={setupError && index === 0 ? "lockin-setup-error" : undefined}
                    />
                  </label>
                  <label htmlFor={`lockin-steps-${index + 1}`}>
                    <span>Baby steps <i>optional</i></span>
                    <input
                      id={`lockin-steps-${index + 1}`}
                      value={draft.babyTasks}
                      onChange={(event) =>
                        setHabitDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id
                              ? { ...item, babyTasks: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="e.g. Fill bottle, 5-minute warm-up"
                    />
                  </label>
                </div>
              ))}
            </fieldset>

            {setupError && <p className="lockin-form-error" id="lockin-setup-error" role="alert">{setupError}</p>}
            {storageMessage && saveStatus === "error" && (
              <p className="lockin-storage-error" role="alert">{storageMessage}</p>
            )}
            <div className="lockin-setup-actions">
              {state.habits.length > 0 && (
                <button className="lockin-secondary-action" type="button" onClick={() => setEditingSetup(false)}>
                  Cancel
                </button>
              )}
              <button className="lockin-primary-action" type="submit">
                {state.habits.length > 0 ? "Save lock-in" : "Lock in my 122 days"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  const greeting = state.challenge.displayName
    ? `Keep the promise, ${state.challenge.displayName}.`
    : "Keep the promise you made to yourself.";
  const isBeforeStart = today < LOCK_IN_START_DATE;
  const isAfterEnd = today > LOCK_IN_END_DATE;
  const selectedHabitCompletions = selectedEntry.completions;

  return (
    <main className="lockin-shell">
      <header className="lockin-topbar">
        <button className="brand" type="button" onClick={() => setSelectedDate(clampToLockIn(today))}>
          <span className="brand-mark" aria-hidden="true">D</span>
          <span><strong>DAYMARK</strong><small>{state.challenge.title}</small></span>
        </button>
        <nav className="lockin-mode-nav" aria-label="Daymark views">
          <button className="active" type="button" aria-current="page">Lock-in</button>
          <button type="button" onClick={onOpenPlanner}>Daily plan</button>
        </nav>
        <div className={`save-status ${saveStatus}`} role="status" aria-live="polite">
          <span aria-hidden="true" />
          {saveStatus === "saving" ? "Saving" : saveStatus === "error" ? "Save issue" : "Saved"}
        </div>
      </header>

      {storageMessage && saveStatus === "error" && (
        <div className="lockin-error-banner" role="alert">
          <div><strong>Your latest change may not be saved.</strong><span>{storageMessage}</span></div>
          <button type="button" onClick={exportBackup}>Download backup</button>
        </div>
      )}

      <section className="lockin-hero">
        <div>
          <p className="eyebrow">Day {dayNumber} of {LOCK_IN_TOTAL_DAYS}</p>
          <h1>{formatDate(selectedDate, { weekday: "long", month: "long", day: "numeric" })}</h1>
          <p>{greeting}</p>
        </div>
        <div className="lockin-date-nav" aria-label="Choose a lock-in day">
          <button
            type="button"
            onClick={() => setSelectedDate(addCalendarDays(selectedDate, -1))}
            disabled={selectedDate === LOCK_IN_START_DATE}
            aria-label="Previous lock-in day"
          >←</button>
          <button type="button" onClick={() => setSelectedDate(clampToLockIn(today))}>Today</button>
          <button
            type="button"
            onClick={() => setSelectedDate(addCalendarDays(selectedDate, 1))}
            disabled={selectedDate === LOCK_IN_END_DATE}
            aria-label="Next lock-in day"
          >→</button>
        </div>
      </section>

      {isBeforeStart && (
        <section className="lockin-start-banner">
          <span aria-hidden="true">01</span>
          <div><strong>Your lock-in starts September 1.</strong><p>Your habits are ready. Add the calendar reminder, then return tomorrow for Day 1.</p></div>
        </section>
      )}

      {isAfterEnd && (
        <section className="lockin-start-banner complete">
          <span aria-hidden="true">✓</span>
          <div><strong>You reached December 31.</strong><p>Your full 122-day record is ready below. Keep it honest and be proud of what you built.</p></div>
        </section>
      )}

      <div className="lockin-workspace">
        <section className="lockin-checkin" aria-labelledby="lockin-checkin-title">
          <div className="lockin-section-heading">
            <div>
              <p className="section-kicker">Daily promises</p>
              <h2 id="lockin-checkin-title">{selectedStats.completedHabits} of {selectedStats.totalHabits} complete</h2>
            </div>
            <div
              className="lockin-day-score"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={selectedStats.completionRate}
              aria-label={`${selectedStats.completionRate}% of habits complete`}
            >
              <strong>{selectedStats.completionRate}%</strong><span>today</span>
            </div>
          </div>

          {!canEditSelectedDate && (
            <div className="lockin-future-note">This day has not arrived yet. You can plan ahead, but checkmarks unlock on the day.</div>
          )}

          <div className="lockin-habit-list">
            {state.habits.map((habit, index) => {
              const completion = selectedHabitCompletions[habit.id] ?? {
                done: false,
                completedBabyTaskIds: [],
              };
              return (
                <article className={`lockin-habit ${completion.done ? "is-complete" : ""}`} key={habit.id}>
                  <button
                    className="lockin-habit-check"
                    type="button"
                    onClick={() => toggleHabit(habit)}
                    disabled={!canEditSelectedDate}
                    aria-pressed={completion.done}
                    aria-label={`${completion.done ? "Mark incomplete" : "Mark complete"}: ${habit.title}`}
                  ><span aria-hidden="true">✓</span></button>
                  <div className="lockin-habit-content">
                    <div className="lockin-habit-title"><span>{String(index + 1).padStart(2, "0")}</span><h3>{habit.title}</h3></div>
                    {habit.babyTasks.length > 0 && (
                      <div className="lockin-baby-tasks">
                        {habit.babyTasks.map((task) => {
                          const checked = completion.completedBabyTaskIds.includes(task.id);
                          return (
                            <label className={checked ? "complete" : ""} key={task.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!canEditSelectedDate}
                                onChange={() => toggleBabyTask(habit, task.id)}
                              />
                              <span className="mini-check" aria-hidden="true">✓</span>
                              <span>{task.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="lockin-reflection">
            <label htmlFor="lockin-note">One honest line about this day <span>Optional</span></label>
            <textarea
              id="lockin-note"
              rows={3}
              value={selectedEntry.note ?? ""}
              disabled={!canEditSelectedDate}
              onChange={(event) => updateNote(event.target.value)}
              placeholder="What helped—or got in the way?"
            />
            <button
              className="lockin-finish-button"
              type="button"
              onClick={finishCheckIn}
              disabled={!canEditSelectedDate}
            >
              <span>{selectedStats.isFinalized ? "Update check-in" : "Finish check-in"}</span>
              <span aria-hidden="true">→</span>
            </button>
            {selectedStats.isFinalized && <p className="lockin-success-note" role="status">Day reviewed. You can still correct anything honestly.</p>}
          </div>
        </section>

        <aside className="lockin-sidebar">
          <section className="lockin-stats-card">
            <p className="section-kicker">Through today</p>
            <div className="lockin-stat-grid">
              <div><strong>{overallStats.completionRate}%</strong><span>adherence</span></div>
              <div><strong>{overallStats.perfectDays}</strong><span>perfect days</span></div>
              <div><strong>{overallStats.currentStreak}</strong><span>day streak</span></div>
              <div><strong>{overallStats.remainingDays}</strong><span>days remaining</span></div>
            </div>
            <div className="lockin-overall-track" aria-hidden="true"><span style={{ width: `${overallStats.completionRate}%` }} /></div>
            <p>
              {overallStats.possibleHabitChecks > 0
                ? `${overallStats.completedHabitChecks} of ${overallStats.possibleHabitChecks} eligible habit checks completed.`
                : "Eligible checks begin September 1."}
            </p>
          </section>

          <section className="lockin-reminder-card">
            <div className="lockin-reminder-icon" aria-hidden="true">◷</div>
            <p className="section-kicker">Nightly reset</p>
            <h2>{formatTime(state.challenge.checkInTime)} reminder</h2>
            <p>Download one recurring event for every evening through December 31.</p>
            <button type="button" onClick={downloadCalendar}>Add calendar reminder <span aria-hidden="true">↓</span></button>
            {calendarMessage && <small role="status">{calendarMessage}</small>}
          </section>

          <section className="lockin-settings-card">
            <button type="button" onClick={openSetup}>Edit lock-in</button>
            <button type="button" onClick={exportBackup}>Download backup</button>
            <button type="button" onClick={onOpenPlanner}>Open daily planner</button>
          </section>
        </aside>
      </div>

      <section className="lockin-history" aria-labelledby="lockin-history-title">
        <div className="lockin-section-heading">
          <div><p className="section-kicker">The full season</p><h2 id="lockin-history-title">Your 122-day record</h2></div>
          <div className="lockin-history-legend" aria-label="History legend"><span className="perfect" /> Perfect <span className="partial" /> Partial <span className="missed" /> Missed</div>
        </div>
        <div className="lockin-months">
          {months.map((month) => (
            <div className="lockin-month" key={month.label}>
              <strong>{month.label}</strong>
              <div className="lockin-month-grid">
                {month.dates.map((date) => {
                  const stats = challengeGrid[getLockInDayNumber(date)! - 1];
                  const status = date > today ? "future" : stats.isPerfect ? "perfect" : stats.completedHabits > 0 ? "partial" : "missed";
                  return (
                    <button
                      className={`${status} ${date === selectedDate ? "selected" : ""} ${date === today ? "today" : ""}`}
                      type="button"
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      aria-label={`${formatDate(date, { month: "long", day: "numeric" })}: ${dayStatusLabel(state, date, today)}`}
                      aria-pressed={date === selectedDate}
                    >{Number(date.slice(-2))}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
