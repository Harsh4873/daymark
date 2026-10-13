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
import { addDays, formatFullDate, getWeekDays, isAfterDate, isSameDate, isToday, toDateKey } from '../dates';
import {
  formatValue,
  getDaySnapshot,
  getEntry,
  getHabitDayAttention,
  getHabitPeriodProgress,
  getHabitStats,
  getIntensityLevel,
  isHabitScheduledOn,
  reachedMilestone,
  type HabitDayAttention,
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
  settled,
  openHabitDetail,
  onHold,
  onRelease,
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
  settled: boolean;
  openHabitDetail: (habit: Habit) => void;
  onHold: (habitId: string) => void;
  onRelease: (habitId: string) => void;
} & EntryActions) {
  const [expanded, setExpanded] = useState(false);
  const [popped, setPopped] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const dateKey = toDateKey(date);
  const entry = getEntry(state, habit.id, date);
  const progress = getHabitPeriodProgress(habit, date, state);
  const dayChecked = Boolean(entry && !entry.skipped && entry.value > 0);
  const displayValue = habit.period === 'day' ? entry?.value ?? 0 : progress.value;
  const milestone = reachedMilestone(streak);
  const overCap = habit.direction === 'atMost' && progress.hasEntry && progress.value > progress.target;
  const prevSettled = useRef(settled);

  useEffect(() => {
    const wasSettled = prevSettled.current;
    prevSettled.current = settled;
    if (settled && !wasSettled) {
      setPopped(true);
      const timeout = window.setTimeout(() => setPopped(false), 600);
      return () => window.clearTimeout(timeout);
    }
  }, [settled]);

  useEffect(() => {
    function onDocumentPointerUp(event: PointerEvent) {
      const row = rowRef.current;
      const target = event.target;
      if (!row || !(target instanceof Node) || row.contains(target)) return;
      // After the click, so a tap on another row is not lost to a layout shift.
      window.setTimeout(() => releaseRef.current(habit.id), 0);
    }
    document.addEventListener('pointerup', onDocumentPointerUp);
    return () => document.removeEventListener('pointerup', onDocumentPointerUp);
  }, [habit.id]);

  const statusLine = entry?.skipped
    ? 'Skipped — excluded from consistency'
    : !progress.eligible && habit.period !== 'day'
      ? `Ramp-up ${habit.period} — activity counts, consistency does not`
      : habit.direction === 'atMost'
        ? progress.hasEntry
          ? progress.value <= progress.target
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
    if (!settled) buzz();
    incrementEntry(habit.id, dateKey, habit.increment);
  }

  return (
    <article
      ref={rowRef}
      className={`habit-row${settled ? ' is-complete' : ''}${entry?.skipped ? ' is-skipped' : ''}${popped ? ' just-completed' : ''}`}
      style={habitStyle(habit)}
      onFocus={() => onHold(habit.id)}
      onPointerDown={() => onHold(habit.id)}
      onBlur={(event) => {
        const row = event.currentTarget;
        window.setTimeout(() => {
          if (!row.isConnected || !row.contains(document.activeElement)) onRelease(habit.id);
        }, 0);
      }}
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
            <ProgressBar
              value={progress.ratio}
              color={habit.color}
              over={overCap}
              label={overCap ? `${habit.name}: over the ${habit.period} limit` : `${habit.name}: ${Math.round(progress.ratio * 100)} percent of goal`}
            />
            <small>
              {entry?.skipped
                ? 'skipped'
                : habit.metric === 'check' && habit.period === 'day'
                  ? dayChecked ? 'done' : 'not yet'
                  : `${formatValue(displayValue, habit)} / ${formatValue(progress.target, habit)}`}
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
  const [pins, setPins] = useState<Map<string, 'open' | 'done' | 'optional'>>(new Map());
  const eligible = habits.filter((habit) => isHabitScheduledOn(habit, date));
  const snapshot = getDaySnapshot(state, date, habits);
  const dateIsToday = isToday(date);
  const dateKey = toDateKey(date);
  const activeStats = useMemo(
    () => habits.map((habit) => ({ habit, stats: getHabitStats(habit, state, date) })),
    [habits, state, date],
  );
  const streakByHabit = new Map(activeStats.map(({ habit, stats }) => [habit.id, stats.currentStreak]));
  const stripDays = getWeekDays(date, state.profile.weekStartsOn);
  const swipe = useSwipeNavigation(
    () => setDate(addDays(date, -1)),
    dateIsToday ? undefined : () => setDate(addDays(date, 1)),
  );

  useEffect(() => {
    setPins(new Map());
  }, [dateKey]);

  function attentionFor(habit: Habit): HabitDayAttention {
    return getHabitDayAttention(habit, date, state);
  }

  function classify(habit: Habit): 'open' | 'done' | 'optional' {
    const attention = attentionFor(habit);
    if (attention === 'open' || attention === 'optional') return attention;
    if (habit.period !== 'day' && habit.direction !== 'atMost') {
      const progress = getHabitPeriodProgress(habit, date, state);
      if (!progress.complete && !getEntry(state, habit.id, date)?.skipped) return 'optional';
    }
    return 'done';
  }

  function holdHabit(habitId: string) {
    const habit = eligible.find((item) => item.id === habitId);
    if (!habit) return;
    const section = classify(habit);
    setPins((current) => {
      if (current.has(habitId)) return current;
      const next = new Map(current);
      next.set(habitId, section);
      return next;
    });
  }

  function releaseHabit(habitId: string) {
    setPins((current) => {
      if (!current.has(habitId)) return current;
      const next = new Map(current);
      next.delete(habitId);
      return next;
    });
  }

  function sectionFor(habit: Habit) {
    return pins.get(habit.id) ?? classify(habit);
  }

  const remaining = eligible.filter((habit) => sectionFor(habit) === 'open');
  const optional = eligible.filter((habit) => sectionFor(habit) === 'optional');
  const done = eligible.filter((habit) => sectionFor(habit) === 'done');
  const unsettled = eligible.filter((habit) => attentionFor(habit) === 'open');
  const satisfied = eligible.filter((habit) => {
    if (attentionFor(habit) !== 'satisfied' || getEntry(state, habit.id, date)?.skipped) return false;
    if (habit.period !== 'day' && habit.direction !== 'atMost' && !getHabitPeriodProgress(habit, date, state).complete) return false;
    return true;
  });
  const dailyDue = eligible.filter((habit) => habit.period === 'day');
  const dayComplete = dailyDue.length > 0
    && unsettled.length === 0
    && dailyDue.every((habit) => attentionFor(habit) === 'satisfied');
  const ringScore = snapshot.scheduled > 0
    ? snapshot.score
    : unsettled.length === 0 && satisfied.length > 0
      ? 1
      : 0;
  const focusSlot = currentSlot();

  function renderRow(habit: Habit) {
    return (
      <HabitRow
        key={`${habit.id}-${dateKey}`}
        habit={habit}
        date={date}
        state={state}
        streak={streakByHabit.get(habit.id) ?? 0}
        settled={attentionFor(habit) === 'satisfied'}
        openHabitDetail={openHabitDetail}
        onHold={holdHabit}
        onRelease={releaseHabit}
        {...actions}
      />
    );
  }

  return (
    <div className="view-shell today-view" {...swipe}>
      <ViewHeader
        title={dateIsToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'long' })}
        sub={`${formatFullDate(date)} · ${unsettled.length} left · ${satisfied.length} done${snapshot.skipped ? ` · ${snapshot.skipped} skipped` : ''}`}
      >
        <ProgressRing value={ringScore} size="small">
          <strong>{Math.round(ringScore * 100)}%</strong>
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

      <section className="week-strip" aria-label={`Week of ${stripDays[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}>
        {stripDays.map((day) => {
          const daySnapshot = getDaySnapshot(state, day);
          const future = isAfterDate(day, new Date());
          const level = future || daySnapshot.scheduled === 0 ? 0 : getIntensityLevel(daySnapshot.score);
          const selected = isSameDate(day, date);
          return (
            <button
              type="button"
              className={selected ? 'week-strip-day is-selected' : 'week-strip-day'}
              key={toDateKey(day)}
              onClick={() => setDate(day)}
              disabled={future}
              aria-current={selected ? 'date' : undefined}
              aria-label={future
                ? `${formatFullDate(day)}, upcoming`
                : `${formatFullDate(day)}: ${daySnapshot.scheduled > 0 ? `${Math.round(daySnapshot.score * 100)} percent day score` : 'rest day'}`}
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
              <span>{satisfied.length} goals · {Math.round(ringScore * 100)}%</span>
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

          {optional.length > 0 && (
            <section className="checkin-section is-optional" aria-label="Flexible goals">
              <div className="slot-label">
                <h2>When you can</h2>
                <small>{optional.length}</small>
              </div>
              <p className="optional-note">Weekly and monthly goals stay off today's remaining count.</p>
              <div className="habit-row-list">
                {optional.map(renderRow)}
              </div>
            </section>
          )}

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
