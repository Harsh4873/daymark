import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Flame,
  Medal,
  Minus,
  Plus,
  SkipForward,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatFullDate, isSameDate, isToday, toDateKey } from '../dates';
import {
  formatValue,
  getDaySnapshot,
  getEntry,
  getHabitPeriodProgress,
  getHabitStats,
  getIntensityLevel,
  isHabitHandledOn,
  isHabitScheduledOn,
  reachedMilestone,
} from '../metrics';
import type { Habit, TimeSlot, TrackerState } from '../model';
import type { TrackerStore } from '../store';
import { useSwipeNavigation } from '../useSwipe';
import {
  DateSwitcher,
  EmptyState,
  HabitBadge,
  ProgressBar,
  ProgressRing,
  ViewHeader,
  habitStyle,
} from '../ui';

type EntryActions = Pick<
  TrackerStore,
  'setEntryValue' | 'incrementEntry' | 'toggleCheck' | 'toggleSkip' | 'setEntryNote'
>;

interface TodayViewProps extends EntryActions {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  onManageHabits: () => void;
  openHabitDetail: (habit: Habit) => void;
}

const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: 'Morning',
  anytime: 'Anytime',
  evening: 'Evening',
};

function currentSlot(): TimeSlot {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour >= 17) return 'evening';
  return 'anytime';
}

function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    // Vibration is a nice-to-have; some browsers throw on restricted contexts.
  }
}

function HabitRow({
  habit,
  date,
  state,
  streak,
  openHabitDetail,
  setEntryValue,
  incrementEntry,
  toggleCheck,
  toggleSkip,
  setEntryNote,
}: {
  habit: Habit;
  date: Date;
  state: TrackerState;
  streak: number;
  openHabitDetail: (habit: Habit) => void;
} & EntryActions) {
  const [expanded, setExpanded] = useState(false);
  const [popped, setPopped] = useState(false);
  const dateKey = toDateKey(date);
  const entry = getEntry(state, habit.id, date);
  const progress = getHabitPeriodProgress(habit, date, state);
  const dayChecked = Boolean(entry && !entry.skipped && entry.value > 0);
  const displayValue = habit.period === 'day' ? entry?.value ?? 0 : progress.value;
  const milestone = reachedMilestone(streak);
  const prevComplete = useRef(progress.complete);

  useEffect(() => {
    const wasComplete = prevComplete.current;
    prevComplete.current = progress.complete;
    if (progress.complete && !wasComplete) {
      setPopped(true);
      const timeout = window.setTimeout(() => setPopped(false), 600);
      return () => window.clearTimeout(timeout);
    }
  }, [progress.complete]);

  const statusLine = entry?.skipped
    ? 'Skipped — excluded from consistency'
    : !progress.eligible && habit.period !== 'day'
      ? `Ramp-up ${habit.period} — activity counts, consistency does not`
      : habit.direction === 'atMost'
        ? progress.hasEntry
          ? progress.value <= habit.target
            ? `Within the ${habit.period} limit`
            : `Over the ${habit.period} limit`
          : 'Log the actual amount'
        : progress.complete
          ? `Goal met for this ${habit.period === 'day' ? 'day' : habit.period}`
          : `${Math.round(progress.ratio * 100)}% of the ${habit.period} goal`;

  function quickCheck() {
    if (!dayChecked) buzz();
    toggleCheck(habit.id, dateKey);
  }

  function quickAdd() {
    if (!progress.complete) buzz();
    incrementEntry(habit.id, dateKey, habit.increment);
  }

  return (
    <article
      className={`habit-row${progress.complete ? ' is-complete' : ''}${entry?.skipped ? ' is-skipped' : ''}${popped ? ' just-completed' : ''}`}
      style={habitStyle(habit)}
    >
      <button
        type="button"
        className="habit-row-main"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-label={`${habit.name}: ${statusLine}. ${expanded ? 'Collapse' : 'Expand'} details.`}
      >
        <HabitBadge habit={habit} />
        <span className="habit-row-copy">
          <span className="habit-row-title">
            <strong>{habit.name}</strong>
            {streak > 0 && (
              <em className={milestone ? 'streak-chip has-milestone' : 'streak-chip'}>
                {milestone ? <Medal aria-hidden="true" /> : <Flame aria-hidden="true" />}
                {streak}
              </em>
            )}
          </span>
          <span className="habit-row-progress">
            <ProgressBar value={progress.ratio} color={habit.color} label={`${habit.name}: ${Math.round(progress.ratio * 100)} percent of goal`} />
            <small>
              {entry?.skipped
                ? 'skipped'
                : habit.metric === 'check' && habit.period === 'day'
                  ? dayChecked ? 'done' : 'not yet'
                  : `${formatValue(displayValue, habit)} / ${formatValue(habit.target, habit)}`}
            </small>
          </span>
        </span>
        <ChevronDown className={expanded ? 'habit-row-caret is-open' : 'habit-row-caret'} aria-hidden="true" />
      </button>

      {habit.metric === 'check' ? (
        <button
          type="button"
          className={dayChecked ? 'row-action row-check is-done' : 'row-action row-check'}
          onClick={quickCheck}
          disabled={Boolean(entry?.skipped)}
          aria-label={dayChecked ? `Undo ${habit.name}` : `Mark ${habit.name} done`}
        >
          <Check aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="row-action row-add"
          onClick={quickAdd}
          disabled={Boolean(entry?.skipped)}
          aria-label={`Add ${habit.increment} ${habit.unit} to ${habit.name}`}
        >
          <Plus aria-hidden="true" />
          <small>{habit.increment}</small>
        </button>
      )}

      {expanded && (
        <div className="habit-row-detail">
          <span className="habit-row-status">{statusLine}</span>
          {habit.metric !== 'check' && (
            <div className="value-stepper" aria-label={`Log ${habit.name}`}>
              <button type="button" onClick={() => incrementEntry(habit.id, dateKey, -habit.increment)} aria-label={`Subtract ${habit.increment} ${habit.unit}`}>
                <Minus aria-hidden="true" />
              </button>
              <label>
                <span className="sr-only">{habit.name} value in {habit.unit}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={entry?.skipped ? 0 : entry?.value ?? 0}
                  onChange={(event) => setEntryValue(habit.id, dateKey, Number(event.target.value))}
                />
                <small>{habit.unit}</small>
              </label>
              <button type="button" onClick={() => incrementEntry(habit.id, dateKey, habit.increment)} aria-label={`Add ${habit.increment} ${habit.unit}`}>
                <Plus aria-hidden="true" />
              </button>
            </div>
          )}
          <label className="entry-note">
            <span>Note</span>
            <textarea
              value={entry?.note ?? ''}
              onChange={(event) => setEntryNote(habit.id, dateKey, event.target.value)}
              placeholder="A cue, win, obstacle, or detail worth remembering…"
              rows={2}
            />
          </label>
          <div className="habit-row-detail-actions">
            <button type="button" className="quiet-action" onClick={() => toggleSkip(habit.id, dateKey)}>
              <SkipForward aria-hidden="true" />
              <span>{entry?.skipped ? 'Unskip' : 'Skip today'}</span>
            </button>
            <button type="button" className="quiet-action" onClick={() => openHabitDetail(habit)}>
              <ChevronRight aria-hidden="true" />
              <span>Full history</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function TodayView({
  state,
  habits,
  date,
  setDate,
  onManageHabits,
  openHabitDetail,
  ...actions
}: TodayViewProps) {
  const [doneOpen, setDoneOpen] = useState(false);
  const eligible = habits.filter((habit) => isHabitScheduledOn(habit, date));
  const snapshot = getDaySnapshot(state, date, habits);
  const dateIsToday = isToday(date);
  const activeStats = useMemo(
    () => habits.map((habit) => ({ habit, stats: getHabitStats(habit, state, date) })),
    [habits, state, date],
  );
  const streakByHabit = new Map(activeStats.map(({ habit, stats }) => [habit.id, stats.currentStreak]));
  const stripDays = Array.from({ length: 7 }, (_, index) => addDays(new Date(), index - 6));
  const swipe = useSwipeNavigation(
    () => setDate(addDays(date, -1)),
    dateIsToday ? undefined : () => setDate(addDays(date, 1)),
  );

  const remaining = eligible.filter((habit) => !isHabitHandledOn(habit, date, state));
  const done = eligible.filter((habit) => isHabitHandledOn(habit, date, state));
  const dayComplete = eligible.length > 0 && remaining.length === 0;
  const focusSlot = currentSlot();

  function renderRow(habit: Habit) {
    return (
      <HabitRow
        key={`${habit.id}-${toDateKey(date)}`}
        habit={habit}
        date={date}
        state={state}
        streak={streakByHabit.get(habit.id) ?? 0}
        openHabitDetail={openHabitDetail}
        {...actions}
      />
    );
  }

  return (
    <div className="view-shell today-view" {...swipe}>
      <ViewHeader
        title={dateIsToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'long' })}
        sub={`${formatFullDate(date)} · ${remaining.length} left · ${snapshot.completed} done${snapshot.skipped ? ` · ${snapshot.skipped} skipped` : ''}`}
      >
        <ProgressRing value={snapshot.score} size="small">
          <strong>{Math.round(snapshot.score * 100)}%</strong>
        </ProgressRing>
        <DateSwitcher
          compact
          eyebrow="Selected day"
          label={dateIsToday ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          onPrevious={() => setDate(addDays(date, -1))}
          onNext={() => setDate(addDays(date, 1))}
          nextDisabled={dateIsToday}
          onToday={dateIsToday ? undefined : () => setDate(new Date())}
        />
      </ViewHeader>

      <section className="week-strip" aria-label="The last seven days">
        {stripDays.map((day) => {
          const daySnapshot = getDaySnapshot(state, day);
          const level = getIntensityLevel(daySnapshot.scheduled > 0 ? daySnapshot.score : 0);
          const selected = isSameDate(day, date);
          return (
            <button
              type="button"
              className={selected ? 'week-strip-day is-selected' : 'week-strip-day'}
              key={toDateKey(day)}
              onClick={() => setDate(day)}
              aria-current={selected ? 'date' : undefined}
              aria-label={`${formatFullDate(day)}: ${daySnapshot.scheduled > 0 ? `${Math.round(daySnapshot.score * 100)} percent day score` : 'rest day'}`}
            >
              <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
              <i className={`level-${level}`} aria-hidden="true" />
            </button>
          );
        })}
      </section>

      {eligible.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 aria-hidden="true" />}
          title="Nothing scheduled"
          copy="A rest day, or room for a new habit."
          action={<button type="button" className="button button-primary" onClick={onManageHabits}>Manage habits</button>}
        />
      ) : (
        <>
          {dayComplete && (
            <div className="day-complete" role="status">
              <CheckCircle2 aria-hidden="true" />
              <strong>Day complete</strong>
              <span>{snapshot.completed} goals · {Math.round(snapshot.score * 100)}%</span>
            </div>
          )}

          {(['morning', 'anytime', 'evening'] as TimeSlot[]).map((slot) => {
            const slotHabits = remaining.filter((habit) => habit.timeSlot === slot);
            if (!slotHabits.length) return null;
            return (
              <section className="checkin-section" key={slot}>
                <div className={slot === focusSlot && dateIsToday ? 'slot-label is-now' : 'slot-label'}>
                  <h2>{SLOT_LABELS[slot]}</h2>
                  {slot === focusSlot && dateIsToday && <span>now</span>}
                  <small>{slotHabits.length}</small>
                </div>
                <div className="habit-row-list">
                  {slotHabits.map(renderRow)}
                </div>
              </section>
            );
          })}

          {done.length > 0 && (
            <section className="done-section">
              <button
                type="button"
                className="done-toggle"
                onClick={() => setDoneOpen((open) => !open)}
                aria-expanded={doneOpen}
              >
                <ChevronRight className={doneOpen ? 'is-open' : ''} aria-hidden="true" />
                <span>Done</span>
                <small>{done.length}</small>
              </button>
              {doneOpen && (
                <div className="habit-row-list done-list">
                  {done.map(renderRow)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
