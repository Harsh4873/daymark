import { useCallback, useEffect, useState } from 'react';
import { clampToToday, fromDateKey, toDateKey } from './dates';
import { followCurrentDay, watchLocalDay } from './local-day';

export function useDailyDate() {
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));
  const [selectedKey, setSelectedKey] = useState(todayKey);

  useEffect(() => watchLocalDay(todayKey, (today, previousToday) => {
    setTodayKey(today);
    setSelectedKey((selected) => followCurrentDay(selected, previousToday, today));
  }), [todayKey]);

  const setDailyDate = useCallback((date: Date) => {
    setSelectedKey(toDateKey(clampToToday(date)));
  }, []);

  return { dailyDate: fromDateKey(selectedKey), setDailyDate, todayKey };
}
