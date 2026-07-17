import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { Habit } from './model';
import { HabitGlyph } from './icons';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal behavior: inerts the app shell, locks body scroll, traps Tab,
 * closes on Escape, and restores focus to the opener on unmount.
 */
export function useModalDialog(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector<HTMLElement>('.app-shell');
    const previousAriaHidden = background ? background.getAttribute('aria-hidden') : null;
    const previousOverflow = document.body.style.overflow;
    if (background) {
      background.inert = true;
      background.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRefRef.current?.current
        ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? dialogRef.current;
      target?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (background) {
        background.inert = false;
        if (previousAriaHidden === null) background.removeAttribute('aria-hidden');
        else background.setAttribute('aria-hidden', previousAriaHidden);
      }
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type HabitStyle = CSSProperties & { '--habit-color': string };
type ProgressStyle = CSSProperties & { '--progress': string };

export function habitStyle(habit: Habit): HabitStyle {
  return { '--habit-color': habit.color };
}

export function ProgressRing({ value, size = 'large', children }: { value: number; size?: 'small' | 'large'; children: ReactNode }) {
  const progress = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`progress-ring progress-ring-${size}`}
      style={{ '--progress': `${progress * 360}deg` } as ProgressStyle}
      role="img"
      aria-label={`${Math.round(progress * 100)} percent complete`}
    >
      <div>{children}</div>
    </div>
  );
}

export function HabitBadge({ habit }: { habit: Habit }) {
  return (
    <span className="habit-badge" style={habitStyle(habit)}>
      <HabitGlyph icon={habit.icon} />
    </span>
  );
}

export function ViewHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="view-header">
      <div className="view-header-copy">
        <h1 tabIndex={-1}>{title}</h1>
        {sub && <span className="view-header-sub">{sub}</span>}
      </div>
      {children && <div className="view-header-tools">{children}</div>}
    </header>
  );
}

export function DateSwitcher({
  eyebrow,
  label,
  onPrevious,
  onNext,
  nextDisabled,
  onToday,
  compact = false,
}: {
  eyebrow: string;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  onToday?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'date-switcher date-switcher-compact' : 'date-switcher'}>
      <div>
        {!compact && <span>{eyebrow}</span>}
        <strong>{label}</strong>
      </div>
      <div className="date-switcher-actions">
        {onToday && (
          <button type="button" className="icon-button today-button" onClick={onToday} aria-label="Return to current period">
            <RotateCcw aria-hidden="true" />
            <span>Now</span>
          </button>
        )}
        <button type="button" className="icon-button" onClick={onPrevious} aria-label="Previous period">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onNext} disabled={nextDisabled} aria-label="Next period">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function MetricCard({ label, value, detail, accent = false }: { label: string; value: string | number; detail: string; accent?: boolean }) {
  return (
    <article className={accent ? 'metric-card metric-card-accent' : 'metric-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function ProgressBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  const safe = Math.max(0, Math.min(1, value));
  return (
    <div
      className="linear-progress"
      role="progressbar"
      aria-label={label ?? 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe * 100)}
    >
      <span style={{ width: `${safe * 100}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

