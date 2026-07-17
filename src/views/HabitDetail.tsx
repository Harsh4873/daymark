import { Edit3, Flame, Medal, X } from 'lucide-react';
import { useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  addDays,
  formatCompactDate,
  fromDateKey,
  getRollingHeatmapDays,
  groupDaysByMonth,
  isAfterDate,
  toDateKey,
} from '../dates';
import {
  STREAK_MILESTONES,
  formatNumber,
  formatValue,
  getDayContributionRatio,
  getHabitStats,
  getHabitStrength,
  getIntensityLevel,
  goalLabel,
  hasLoggedValue,
  isHabitScheduledOn,
  nextMilestone,
  scheduleLabel,
} from '../metrics';
import type { Habit, TrackerState } from '../model';
import { HabitBadge, habitStyle, useModalDialog } from '../ui';

type HeatStyle = CSSProperties & { '--heat-color': string };

interface HabitDetailProps {
  habit: Habit;
  state: TrackerState;
  onClose: () => void;
  onEdit: () => void;
  openDay: (date: Date) => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function HabitDetail({ habit, state, onClose, onEdit, openDay }: HabitDetailProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(dialogRef, onClose);

  const today = fromDateKey(toDateKey(new Date()));
  const stats = useMemo(() => getHabitStats(habit, state), [habit, state]);
  const strength = useMemo(() => getHabitStrength(habit, state), [habit, state]);
  const strengthMonthAgo = useMemo(
    () => getHabitStrength(habit, state, addDays(today, -30)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habit, state],
  );
  const strengthDelta = Math.round((strength - strengthMonthAgo) * 100);

  const days = useMemo(
    () => getRollingHeatmapDays(today, state.profile.weekStartsOn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.profile.weekStartsOn],
  );
  const monthRows = useMemo(() => groupDaysByMonth(days), [days]);

  const weekdayPattern = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    Object.entries(state.entries).forEach(([dateKey, entries]) => {
      const entry = entries[habit.id];
      if (!hasLoggedValue(entry) || entry!.value <= 0) return;
      counts[fromDateKey(dateKey).getDay()] += 1;
    });
    const max = Math.max(...counts, 1);
    const order = state.profile.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    return order.map((weekday) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      count: counts[weekday],
      ratio: counts[weekday] / max,
    }));
  }, [state.entries, habit.id, state.profile.weekStartsOn]);

  const recentNotes = useMemo(() => {
    return Object.entries(state.entries)
      .map(([dateKey, entries]) => ({ dateKey, entry: entries[habit.id] }))
      .filter((item) => item.entry?.note?.trim())
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey))
      .slice(0, 5);
  }, [state.entries, habit.id]);

  const upcoming = nextMilestone(stats.currentStreak);

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section
        ref={dialogRef}
        className="habit-dialog habit-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-detail-title"
        style={{ ...habitStyle(habit), '--heat-color': habit.color } as HeatStyle}
      >
        <header>
          <div className="habit-detail-identity">
            <HabitBadge habit={habit} />
            <div>
              <h2 id="habit-detail-title">{habit.name}</h2>
              <span>{habit.category} · {scheduleLabel(habit)} · {goalLabel(habit)}</span>
            </div>
          </div>
          <div className="habit-detail-header-actions">
            <button type="button" className="icon-button" onClick={onEdit} aria-label={`Edit ${habit.name}`}><Edit3 aria-hidden="true" /></button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close habit history"><X aria-hidden="true" /></button>
          </div>
        </header>

        <div className="habit-detail-body">
          <div className="detail-stat-grid">
            <div className="detail-stat detail-stat-accent">
              <span>Strength</span>
              <strong>{Math.round(strength * 100)}%</strong>
              <small className={strengthDelta >= 0 ? 'delta-up' : 'delta-down'}>{strengthDelta >= 0 ? '+' : ''}{strengthDelta} past 30d</small>
            </div>
            <div className="detail-stat">
              <span>Current streak</span>
              <strong><Flame aria-hidden="true" /> {stats.currentStreak}</strong>
              <small>{habit.period}{stats.currentStreak === 1 ? '' : 's'}</small>
            </div>
            <div className="detail-stat">
              <span>Best streak</span>
              <strong>{stats.bestStreak}</strong>
              <small>{stats.periods} periods tracked</small>
            </div>
            <div className="detail-stat">
              <span>Consistency</span>
              <strong>{Math.round(stats.consistency * 100)}%</strong>
              <small>all-time</small>
            </div>
            <div className="detail-stat">
              <span>Total</span>
              <strong>{habit.metric === 'check' ? formatNumber(stats.total) : formatValue(stats.total, habit)}</strong>
              <small>lifetime</small>
            </div>
          </div>

          <div className="milestone-row" aria-label="Streak milestones">
            {STREAK_MILESTONES.map((milestone) => (
              <span
                className={`milestone-chip${stats.bestStreak >= milestone ? ' is-reached' : ''}${stats.currentStreak >= milestone ? ' is-active' : ''}`}
                key={milestone}
              >
                <Medal aria-hidden="true" /> {milestone}
              </span>
            ))}
            {upcoming && <small>next at {upcoming} {habit.period}s</small>}
          </div>

          <div className="detail-heatmap">
            <h3>Past year</h3>
            <div className="heatmap-month-wall">
              {monthRows.map((row) => (
                <div className="heatmap-month-row" key={row.key}>
                  <span className="heatmap-month-label">{row.label}</span>
                  {row.days.map((day, index) => {
                    if (!day) return <i className="heat-void" key={index} aria-hidden="true" />;
                    const future = isAfterDate(day, today);
                    const scheduled = isHabitScheduledOn(habit, day);
                    const ratio = future || !scheduled ? 0 : getDayContributionRatio(habit, day, state) ?? 0;
                    const level = getIntensityLevel(ratio);
                    const label = `${formatCompactDate(day)}: ${Math.round(ratio * 100)} percent`;
                    return (
                      <button
                        type="button"
                        className={`heat-cell level-${level}${future ? ' is-future' : ''}`}
                        key={toDateKey(day)}
                        onClick={() => openDay(day)}
                        disabled={future}
                        aria-label={label}
                        title={label}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="detail-weekdays">
            <h3>By weekday</h3>
            <div className="weekday-bars" role="img" aria-label={`Days logged by weekday: ${weekdayPattern.map((item) => `${item.label} ${item.count}`).join(', ')}`}>
              {weekdayPattern.map((item) => (
                <div className="weekday-bar" key={item.weekday}>
                  <i style={{ height: `${Math.max(4, Math.round(item.ratio * 100))}%` }} />
                  <strong>{item.count}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {recentNotes.length > 0 && (
            <div className="detail-notes">
              <h3>Recent notes</h3>
              {recentNotes.map(({ dateKey, entry }) => (
                <button type="button" className="detail-note" key={dateKey} onClick={() => openDay(fromDateKey(dateKey))}>
                  <span>{formatCompactDate(fromDateKey(dateKey))}{hasLoggedValue(entry) ? ` · ${formatValue(entry!.value, habit)}` : ''}</span>
                  <p>{entry!.note}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
