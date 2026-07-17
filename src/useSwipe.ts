import { useRef } from 'react';
import type { TouchEvent } from 'react';

const MIN_DISTANCE = 56;

/**
 * Horizontal swipe handlers for moving between periods on touch screens.
 * Swiping left advances to the next period; swiping right goes back.
 * Mostly-vertical gestures are ignored so normal scrolling stays untouched.
 */
export function useSwipeNavigation(onPrevious: () => void, onNext?: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    origin.current = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
      : null;
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = origin.current;
    origin.current = null;
    if (!start) return;
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * 1.8) return;
    if (deltaX > 0) onPrevious();
    else onNext?.();
  }

  return { onTouchStart, onTouchEnd };
}
