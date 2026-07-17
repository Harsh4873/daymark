import {
  CircleAlert,
  CalendarDays,
  CalendarRange,
  CheckSquare2,
  Cloud,
  CloudOff,
  Grid3X3,
  HardDrive,
  LoaderCircle,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clampToToday } from './dates';
import { isHabitActiveOn, isHabitHandledOn, isHabitScheduledOn } from './metrics';
import type { Habit } from './model';
import { useTrackerStore } from './store';
import { useDaymarkSync, type SyncStatus } from './useDaymarkSync';
import { HabitDetail } from './views/HabitDetail';
import { MonthView } from './views/MonthView';
import { HabitEditor, ProfileView } from './views/ProfileView';
import { TodayView } from './views/TodayView';
import { WeekView } from './views/WeekView';
import { YearView } from './views/YearView';

type ViewId = 'daily' | 'weekly' | 'monthly' | 'year' | 'profile';

const NAVIGATION: Array<{ id: ViewId; label: string; shortLabel: string; icon: LucideIcon }> = [
  { id: 'daily', label: 'Daily', shortLabel: 'Day', icon: CheckSquare2 },
  { id: 'weekly', label: 'Weekly', shortLabel: 'Week', icon: CalendarDays },
  { id: 'monthly', label: 'Monthly', shortLabel: 'Month', icon: CalendarRange },
  { id: 'year', label: 'Year', shortLabel: 'Year', icon: Grid3X3 },
  { id: 'profile', label: 'Profile', shortLabel: 'Profile', icon: UserRound },
];

const SYNC_PRESENTATION: Record<SyncStatus, { label: string; icon: LucideIcon }> = {
  synced: { label: 'Synced', icon: Cloud },
  syncing: { label: 'Syncing', icon: LoaderCircle },
  offline: { label: 'Offline', icon: CloudOff },
  'action-needed': { label: 'Action needed', icon: CircleAlert },
};

function currentView(): ViewId {
  const hash = window.location.hash.replace('#', '') as ViewId;
  return NAVIGATION.some((item) => item.id === hash) ? hash : 'daily';
}

function DaymarkLogo() {
  return (
    <span className="daymark-logo" aria-hidden="true">
      <i />
      <i />
      <i />
      <i><CheckSquare2 /></i>
    </span>
  );
}

export default function App() {
  const store = useTrackerStore();
  const sync = useDaymarkSync(store);
  const [view, setView] = useState<ViewId>(currentView);
  const [dailyDate, setDailyDate] = useState(new Date());
  const [weekDate, setWeekDate] = useState(new Date());
  const [monthDate, setMonthDate] = useState(new Date());
  const [yearDate, setYearDate] = useState(new Date());
  const [detailHabitId, setDetailHabitId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{ habit: Habit; locked: boolean } | null>(null);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const firstViewRender = useRef(true);
  const themePreference = store.state?.profile.theme;
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference ?? 'dark';
  const ready = Boolean(store.state);

  useEffect(() => {
    const onHashChange = () => setView(currentView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', updateSystemTheme);
    return () => media.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#f2f3ed' : '#101311');
  }, [resolvedTheme]);

  useEffect(() => {
    if (!ready) return;
    if (firstViewRender.current) {
      firstViewRender.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#main-content h1')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, ready]);

  // Mirror today's remaining habit count onto the installed PWA icon.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    const current = store.state;
    if (!current) return;
    const today = new Date();
    const remaining = current.habits.filter(
      (habit) => isHabitScheduledOn(habit, today) && !isHabitHandledOn(habit, today, current),
    ).length;
    void (remaining > 0 ? nav.setAppBadge(remaining) : nav.clearAppBadge?.())?.catch(() => {});
  }, [store.state]);

  function navigate(nextView: ViewId) {
    if (window.location.hash === `#${nextView}`) setView(nextView);
    else window.location.hash = nextView;
  }

  function openDay(date: Date) {
    setDailyDate(clampToToday(date));
    navigate('daily');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  if (!store.state) {
    return (
      <div className="loading-screen" role="status">
        <DaymarkLogo />
        <span>Opening your local-first record…</span>
      </div>
    );
  }

  const state = store.state;
  const syncPresentation = SYNC_PRESENTATION[sync.status];
  const SyncIcon = syncPresentation.icon;
  const dailyHabits = state.habits.filter((habit) => isHabitActiveOn(habit, dailyDate));
  const detailHabit = detailHabitId ? state.habits.find((habit) => habit.id === detailHabitId) ?? null : null;
  function toggleTheme() {
    store.updateProfile({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
  }

  function openHabitDetail(habit: Habit) {
    setDetailHabitId(habit.id);
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to Daymark
      </a>

      <header className="app-header">
        <a className="brand-link" href="#daily" aria-label="Daymark daily view">
          <DaymarkLogo />
          <span><strong>Daymark</strong><small>harsh.bet / daymark</small></span>
        </a>

        <nav className="desktop-nav" aria-label="Daymark views">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a href={`#${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} key={id}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="header-tools">
          <button
            type="button"
            className={`sync-status sync-status-${sync.status}`}
            title={sync.message ?? `${syncPresentation.label}. Open sync settings.`}
            aria-label={`${syncPresentation.label}. Open sync settings.`}
            onClick={() => navigate('profile')}
          >
            <SyncIcon aria-hidden="true" />
            <span>{syncPresentation.label}</span>
          </button>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </div>
      </header>

      {store.storageWarning && (
        <div className="storage-warning" role="alert">
          <ShieldCheck aria-hidden="true" />
          <span>{store.storageWarning}</span>
          <button type="button" onClick={() => navigate('profile')}>Open data tools</button>
        </div>
      )}

      <main id="main-content" tabIndex={-1}>
        {view === 'daily' && (
          <TodayView
            state={state}
            habits={dailyHabits}
            date={dailyDate}
            setDate={(date) => setDailyDate(clampToToday(date))}
            onManageHabits={() => navigate('profile')}
            openHabitDetail={openHabitDetail}
            setEntryValue={store.setEntryValue}
            incrementEntry={store.incrementEntry}
            toggleCheck={store.toggleCheck}
            toggleSkip={store.toggleSkip}
            setEntryNote={store.setEntryNote}
          />
        )}
        {view === 'weekly' && <WeekView state={state} habits={state.habits} date={weekDate} setDate={setWeekDate} openDay={openDay} openHabitDetail={openHabitDetail} />}
        {view === 'monthly' && <MonthView state={state} habits={state.habits} date={monthDate} setDate={setMonthDate} openDay={openDay} />}
        {view === 'year' && <YearView state={state} habits={state.habits} date={yearDate} setDate={setYearDate} openDay={openDay} openHabitDetail={openHabitDetail} />}
        {view === 'profile' && (
          <ProfileView
            state={state}
            storageMode={store.storageMode}
            saveHabit={store.saveHabit}
            archiveHabit={store.archiveHabit}
            moveHabit={store.moveHabit}
            updateProfile={store.updateProfile}
            replaceState={store.replaceState}
            resetState={store.resetState}
            markBackedUp={store.markBackedUp}
            sync={sync}
            openHabitDetail={openHabitDetail}
          />
        )}
      </main>

      {detailHabit && (
        <HabitDetail
          habit={detailHabit}
          state={state}
          onClose={() => setDetailHabitId(null)}
          onEdit={() => {
            const locked = Object.values(state.entries).some((entries) => Boolean(entries[detailHabit.id]));
            setEditorState({ habit: detailHabit, locked });
            setDetailHabitId(null);
          }}
          openDay={(day) => {
            setDetailHabitId(null);
            openDay(day);
          }}
        />
      )}
      {editorState && (
        <HabitEditor
          initial={editorState.habit}
          measurementLocked={editorState.locked}
          onClose={() => setEditorState(null)}
          onSave={(habit) => {
            store.saveHabit(habit);
            setEditorState(null);
          }}
        />
      )}

      <footer className="app-footer">
        <span>{sync.user ? <Cloud aria-hidden="true" /> : <HardDrive aria-hidden="true" />} Local-first{sync.user ? ' + private sync' : ' storage'}</span>
        <button type="button" onClick={() => navigate('profile')}><Settings2 aria-hidden="true" /> Data + settings</button>
      </footer>

      <nav className="mobile-nav" aria-label="Daymark views">
        {NAVIGATION.map(({ id, shortLabel, icon: Icon }) => (
          <a href={`#${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} key={id}>
            <Icon aria-hidden="true" />
            <span>{shortLabel}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
