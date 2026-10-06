import { toDateKey } from './dates';

export function followCurrentDay(selectedKey: string, previousToday: string, today: string) {
  return selectedKey === previousToday ? today : selectedKey;
}

export function watchLocalDay(
  initialDay: string,
  onChange: (today: string, previousToday: string) => void,
  windowEvents: EventTarget = window,
  documentEvents: EventTarget = document,
) {
  let day = initialDay;
  let timeout: ReturnType<typeof setTimeout>;

  function check() {
    clearTimeout(timeout);
    const now = new Date();
    const nextDay = toDateKey(now);
    if (nextDay !== day) {
      const previous = day;
      day = nextDay;
      onChange(day, previous);
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // Recheck the wall clock after sleep or a clock/timezone adjustment.
    timeout = setTimeout(check, Math.min(60_000, midnight.getTime() - now.getTime()));
  }

  windowEvents.addEventListener('focus', check);
  windowEvents.addEventListener('pageshow', check);
  documentEvents.addEventListener('visibilitychange', check);
  check();
  return () => {
    clearTimeout(timeout);
    windowEvents.removeEventListener('focus', check);
    windowEvents.removeEventListener('pageshow', check);
    documentEvents.removeEventListener('visibilitychange', check);
  };
}
