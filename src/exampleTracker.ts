import { createInitialState, type Habit, type TrackerState } from './model';

/**
 * A tracker with the four habits Daymark used to ship pre-filled, used only by
 * the tests.
 *
 * Merge, ordering, and legacy-migration behaviour is only observable on a state
 * that actually has habits in it, and devices set up before the tracker started
 * empty still carry exactly these four — so this doubles as the fixture for the
 * legacy path. Nothing in the app imports this module: `createInitialState`
 * ships an empty tracker.
 */
export function createPopulatedState(
  options: Parameters<typeof createInitialState>[0] = {},
): TrackerState {
  const base = createInitialState(options);
  const now = options.now ?? new Date().toISOString();
  const today = options.startDate ?? now.slice(0, 10);
  const entityUpdatedAt = base.profile.updatedAt;

  const habits: Habit[] = [
    {
      id: 'starter-steps',
      name: '10K steps',
      category: 'Movement',
      icon: 'footprints',
      color: '#b8f35b',
      metric: 'quantity',
      target: 10000,
      unit: 'steps',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'anytime',
      increment: 1000,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 0,
    },
    {
      id: 'starter-read',
      name: 'Read',
      category: 'Mind',
      icon: 'book',
      color: '#8d7cff',
      metric: 'duration',
      target: 20,
      unit: 'min',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'evening',
      increment: 5,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 1,
    },
    {
      id: 'starter-train',
      name: 'Train',
      category: 'Movement',
      icon: 'dumbbell',
      color: '#ff8e64',
      metric: 'check',
      target: 4,
      unit: 'sessions',
      period: 'week',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'anytime',
      increment: 1,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 2,
    },
    {
      id: 'starter-focus',
      name: 'Deep work',
      category: 'Craft',
      icon: 'brain',
      color: '#58c9d6',
      metric: 'duration',
      target: 90,
      unit: 'min',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'selectedDays', days: [1, 2, 3, 4, 5] },
      timeSlot: 'morning',
      increment: 15,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 3,
    },
  ];

  return { ...base, habits };
}
