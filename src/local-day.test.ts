import { afterEach, describe, expect, it, vi } from 'vitest';
import { followCurrentDay, watchLocalDay } from './local-day';

afterEach(() => vi.useRealTimers());

describe('current day tracking', () => {
  function watch(selectedDay = '2026-10-04') {
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    let selected = selectedDay;
    const changes: string[] = [];
    const stop = watchLocalDay('2026-10-04', (today, previous) => {
      selected = followCurrentDay(selected, previous, today);
      changes.push(today);
    }, windowEvents, documentEvents);
    return { windowEvents, documentEvents, changes, stop, selected: () => selected };
  }

  it('advances today at local midnight, while preserving a historical selection', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 23, 59, 59));
    const current = watch();
    const historical = watch('2026-10-02');
    vi.advanceTimersByTime(1_000);
    expect(current.selected()).toBe('2026-10-05');
    expect(historical.selected()).toBe('2026-10-02');
    expect(current.changes).toEqual(['2026-10-05']);
    current.stop();
    historical.stop();
  });

  it.each(['focus', 'pageshow', 'visibilitychange'])('catches up after suspended timers on %s', (event) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 20));
    const current = watch();
    vi.setSystemTime(new Date(2026, 9, 7, 9));
    const events = event === 'visibilitychange' ? current.documentEvents : current.windowEvents;
    events.dispatchEvent(new Event(event));
    expect(current.selected()).toBe('2026-10-07');
    events.dispatchEvent(new Event(event));
    expect(current.changes).toEqual(['2026-10-07']);
    current.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 9, 8));
    events.dispatchEvent(new Event(event));
    expect(current.changes).toEqual(['2026-10-07']);
  });

  it('reconciles backward clock changes without shifting historical dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 0, 30));
    const current = watch();
    const historical = watch('2026-10-01');
    vi.setSystemTime(new Date(2026, 9, 3, 23));
    vi.advanceTimersByTime(60_000);
    expect(current.selected()).toBe('2026-10-03');
    expect(historical.selected()).toBe('2026-10-01');
    current.stop();
    historical.stop();
  });
});
