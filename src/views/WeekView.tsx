import { addDays, formatDateRange, getWeekDays, isAfterDate, isSameDate, startOfWeek, toDateKey } from '../dates';
import {
  formatValue,
  getDayContributionRatio,
  getDaySnapshot,
  getEntry,
  getHabitPeriodProgress,
  getIntensityLevel,
  isHabitActiveOn,
  isHabitScheduledOn,
} from '../metrics';
import type { Habit, TrackerState } from '../model';
import { DateSwitcher, HabitBadge, ProgressBar, ViewHeader, habitStyle } from '../ui';
import { useSwipeNavigation } from '../useSwipe';

interface WeekViewProps {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  openDay: (date: Date) => void;
  openHabitDetail: (habit: Habit) => void;
}

function weekResult(habit: Habit, days: Date[], state: TrackerState) {
  const today = new Date();
  if (habit.period === 'day') {
    const due = days.filter((day) => isHabitScheduledOn(habit, day) && !isAfterDate(day, today));
    const progress = due.map((day) => getHabitPeriodProgress(habit, day, state)).filter((item) => !item.skipped);
    const completed = progress.filter((item) => item.complete).length;
    const ratio = progress.length ? progress.reduce((sum, item) => sum + item.ratio, 0) / progress.length : 0;
    return { ratio, label: `${completed}/${progress.length} days`, completed, due: progress.length };
  }

  const periodMap = new Map<string, ReturnType<typeof getHabitPeriodProgress>>();
  days.forEach((day) => {
    if (isAfterDate(day, today) || !isHabitScheduledOn(habit, day)) return;
    const progress = getHabitPeriodProgress(habit, day, state);
    periodMap.set(toDateKey(progress.start), progress);
  });
  const periods = [...periodMap.values()].filter((progress) => progress.eligible);
  if (periods.length > 1) {
    const ratio = periods.reduce((sum, progress) => sum + progress.ratio, 0) / periods.length;
    const completed = periods.filter((progress) => progress.complete).length;
    return {
      ratio,
      label: `${completed}/${periods.length} ${habit.period}s met`,
      completed,
      due: periods.length,
    };
  }
  if (!periods.length) {
    const progress = getHabitPeriodProgress(habit, days.find((day) => isHabitScheduledOn(habit, day)) ?? days[0], state);
    return { ratio: progress.ratio, label: 'Ramp-up period', completed: 0, due: 0 };
  }
  const progress = periods[0];
  return {
    ratio: progress.ratio,
    label: `${formatValue(progress.value, habit)} of ${formatValue(progress.target, habit)}`,
    completed: progress.complete ? 1 : 0,
    due: 1,
  };
}

function averageWeekScore(state: TrackerState, habits: Habit[], days: Date[]) {
  const today = new Date();
  const elapsed = days
    .filter((day) => !isAfterDate(day, today))
    .map((day) => getDaySnapshot(state, day, habits))
    .filter((snapshot) => snapshot.scheduled > 0);
  if (!elapsed.length) return 0;
  return elapsed.reduce((sum, snapshot) => sum + snapshot.score, 0) / elapsed.length;
}

export function WeekView({ state, habits, date, setDate, openDay, openHabitDetail }: WeekViewProps) {
  const weekDays = getWeekDays(date, state.profile.weekStartsOn);
  const visibleHabits = habits.filter((habit) => weekDays.some((day) => isHabitActiveOn(habit, day)));
  const previousDays = weekDays.map((day) => addDays(day, -7));
  const score = averageWeekScore(state, visibleHabits, weekDays);
  const previousScore = averageWeekScore(state, visibleHabits, previousDays);
  const change = score - previousScore;
  const daySnapshots = weekDays.map((day) => ({ day, snapshot: getDaySnapshot(state, day, visibleHabits) }));
  const elapsedSnapshots = daySnapshots.filter(({ day }) => !isAfterDate(day, new Date()));
  const activeDays = elapsedSnapshots.filter(({ snapshot }) => snapshot.logged > 0).length;
  const periodStart = startOfWeek(new Date(), state.profile.weekStartsOn);
  const currentWeek = isSameDate(weekDays[0], periodStart);
  const habitResults = visibleHabits.map((habit) => ({ habit, result: weekResult(habit, weekDays, state) }));
  const goalsMet = habitResults.reduce((sum, item) => sum + item.result.completed, 0);
  const goalsDue = habitResults.reduce((sum, item) => sum + item.result.due, 0);
  const scoredDays = elapsedSnapshots.filter(({ snapshot }) => snapshot.scheduled > 0);
  const bestDay = [...scoredDays].sort((left, right) => right.snapshot.score - left.snapshot.score)[0];
  const weakestDay = [...scoredDays].sort((left, right) => left.snapshot.score - right.snapshot.score)[0];
  const rankedHabits = habitResults.filter((item) => item.result.due > 0).sort((left, right) => right.result.ratio - left.result.ratio);
  const topHabit = rankedHabits[0];
  const focusHabit = rankedHabits.length > 1 ? rankedHabits[rankedHabits.length - 1] : undefined;
  const swipe = useSwipeNavigation(
    () => setDate(addDays(date, -7)),
    currentWeek ? undefined : () => setDate(addDays(date, 7)),
  );

  function dayLabel(item?: { day: Date; snapshot: { score: number } }) {
    if (!item) return '—';
    return `${item.day.toLocaleDateString('en-US', { weekday: 'short' })} · ${Math.round(item.snapshot.score * 100)}%`;
  }

  return (
    <div className="view-shell review-view week-view" {...swipe}>
      <ViewHeader
        title="Week"
        sub={`${goalsMet}/${goalsDue} goals met · ${activeDays}/7 active days`}
      >
        <DateSwitcher
          compact
          eyebrow="Seven-day window"
          label={formatDateRange(weekDays[0], weekDays[6])}
          onPrevious={() => setDate(addDays(date, -7))}
          onNext={() => setDate(addDays(date, 7))}
          nextDisabled={currentWeek}
          onToday={currentWeek ? undefined : () => setDate(new Date())}
        />
      </ViewHeader>

      <section className="panel week-recap" aria-label="Week recap">
        <div className="recap-item recap-accent">
          <span>Week score</span>
          <strong>{Math.round(score * 100)}%</strong>
          <small className={change >= 0 ? 'delta-up' : 'delta-down'}>
            {change >= 0 ? '+' : ''}{Math.round(change * 100)} vs last week
          </small>
        </div>
        <div className="recap-item">
          <span>Best day</span>
          <strong>{dayLabel(bestDay)}</strong>
        </div>
        <div className="recap-item">
          <span>Weakest day</span>
          <strong>{dayLabel(scoredDays.length > 1 ? weakestDay : undefined)}</strong>
        </div>
        <div className="recap-item">
          <span>Top habit</span>
          <strong>{topHabit ? topHabit.habit.name : '—'}</strong>
          {topHabit && <small>{Math.round(topHabit.result.ratio * 100)}%</small>}
        </div>
        <div className="recap-item">
          <span>Needs focus</span>
          <strong>{focusHabit && focusHabit.result.ratio < 1 ? focusHabit.habit.name : '—'}</strong>
          {focusHabit && focusHabit.result.ratio < 1 && <small>{Math.round(focusHabit.result.ratio * 100)}%</small>}
        </div>
      </section>

      <section className="panel week-matrix-panel">
        <div className="panel-heading compact">
          <div>
            <span>Grid</span>
            <h2>Habit × day</h2>
          </div>
        </div>

        <div className="week-matrix-scroll">
          <div className="week-matrix" style={{ '--day-count': weekDays.length } as React.CSSProperties}>
            <div className="week-matrix-corner">Habit</div>
            {weekDays.map((day, index) => {
              const { snapshot } = daySnapshots[index];
              const elapsed = !isAfterDate(day, new Date());
              return (
                <div className={isTodayInMatrix(day) ? 'matrix-day is-today' : 'matrix-day'} key={day.toISOString()}>
                  <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <strong>{day.getDate()}</strong>
                  <small className="matrix-day-score">{elapsed && snapshot.scheduled > 0 ? `${Math.round(snapshot.score * 100)}%` : ''}</small>
                </div>
              );
            })}
            <div className="matrix-progress-heading">Week</div>

            {visibleHabits.map((habit) => {
              const result = weekResult(habit, weekDays, state);
              return (
                <div className="matrix-row-contents" key={habit.id} style={habitStyle(habit)}>
                  <button
                    type="button"
                    className="matrix-habit"
                    onClick={() => openHabitDetail(habit)}
                    aria-label={`Open ${habit.name} history`}
                  >
                    <HabitBadge habit={habit} />
                    <span><strong>{habit.name}</strong><small>{habit.category}</small></span>
                  </button>
                  {weekDays.map((day) => {
                    const ratio = getDayContributionRatio(habit, day, state);
                    const entry = getEntry(state, habit.id, day);
                    const future = isAfterDate(day, new Date());
                    const off = ratio === null && !entry?.skipped;
                    const level = getIntensityLevel(ratio ?? 0);
                    const label = off
                      ? `${habit.name} is off schedule on ${day.toLocaleDateString()}`
                      : entry?.skipped
                        ? `${habit.name} was skipped on ${day.toLocaleDateString()}`
                        : `${habit.name}, ${Math.round((ratio ?? 0) * 100)} percent on ${day.toLocaleDateString()}`;
                    return (
                      <button
                        type="button"
                        className={`matrix-cell level-${level}${off ? ' is-off' : ''}${entry?.skipped ? ' is-skipped' : ''}`}
                        key={day.toISOString()}
                        onClick={() => openDay(day)}
                        disabled={future}
                        aria-label={label}
                        title={label}
                      >
                        <span aria-hidden="true">{entry?.skipped ? '–' : ratio && ratio >= 1 ? '✓' : ''}</span>
                      </button>
                    );
                  })}
                  <div className="matrix-progress">
                    <span><strong>{result.label}</strong><small>{Math.round(result.ratio * 100)}%</small></span>
                    <ProgressBar value={result.ratio} color={habit.color} label={`${habit.name} weekly progress`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

    </div>
  );
}

function isTodayInMatrix(date: Date) {
  return isSameDate(date, new Date());
}
