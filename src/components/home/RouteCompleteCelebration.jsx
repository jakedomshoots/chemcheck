import React, { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { CausticsCanvas } from '@/components/ui/caustics';
import { Button } from '@/components/ui/button';
import { PoolIcon } from '@/components/ui/iconography';
import { hapticRouteComplete } from '@/lib/haptics';

const CONFETTI_COLORS = ['#06b6d4', '#0891b2', '#22d3ee', '#0e7490'];

function usePrefersReducedMotion() {
  const ref = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  return ref.current;
}

/**
 * RouteCompleteCelebration — the payoff moment of the whole product.
 *
 * When the last pending stop of the day is logged, the route list deserves
 * more than a silent re-render: water light (the caustics shader), a burst
 * in the brand palette, a native haptic, and the day's numbers. Fires once
 * per day per device (callers persist the dismissal).
 */
export function RouteCompleteCelebration({ completed, total, duration, onClose }) {
  const reducedMotion = usePrefersReducedMotion();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    void hapticRouteComplete();

    if (!reducedMotion) {
      const fire = (particleRatio, opts) =>
        confetti({
          origin: { y: 0.7 },
          colors: CONFETTI_COLORS,
          disableForReducedMotion: true,
          ...opts,
          particleCount: Math.floor(160 * particleRatio),
        });
      fire(0.3, { spread: 32, startVelocity: 55 });
      fire(0.25, { spread: 60 });
      fire(0.25, { spread: 100, decay: 0.91, scalar: 0.9 });
      fire(0.2, { spread: 130, startVelocity: 28, decay: 0.92, scalar: 1.1 });
    }
  }, [reducedMotion]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Route complete"
    >
      <button
        type="button"
        aria-label="Dismiss celebration"
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-sheet bg-surface-1 shadow-raised sm:mx-4 sm:rounded-sheet">
        {/* the light at the bottom of the pool */}
        <div className="absolute inset-0">
          <CausticsCanvas className="h-full w-full" />
        </div>

        <div className="relative px-6 pb-6 pt-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-info">
            Route complete
          </p>
          <h2 className="text-3xl font-semibold tracking-[-0.045em] text-ink">
            Every pool is done.
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm font-medium leading-6 text-ink-secondary">
            {completed} of {total} stops logged{duration ? ` · about ${duration} on site` : ''}.
            The record is already waiting for the office.
          </p>

          <div className="mt-6 flex items-center justify-center gap-2 text-info">
            <PoolIcon name="done" className="h-5 w-5" />
            <span className="font-data text-lg font-semibold">{completed}/{total}</span>
          </div>

          <Button
            onClick={onClose}
            className="mt-6 h-12 w-full rounded-card bg-brand text-sm font-semibold text-white shadow-cta transition-colors hover:bg-brand-strong"
          >
            Back to the route
          </Button>
        </div>
        <div className="relative pb-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}

export default RouteCompleteCelebration;
