import React, { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * SegmentedControl — the app's one segmented control.
 *
 * Extracted from the Quick/Numeric toggle and the Start/Skip pair, which
 * were the same control drawn twice. iOS-style track with a measured
 * sliding thumb on the spring ease; falls back to a static active state
 * when measurement isn't possible (first paint, jsdom).
 *
 * options: [{ value, label, icon? (ReactNode), disabled? }]
 */
export const SegmentedControl = forwardRef(function SegmentedControl(
  { options, value, onChange, size = 'md', className, ariaLabel, fullWidth = true },
  ref
) {
  const trackRef = useRef(null);
  const [thumb, setThumb] = useState(null);

  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      const buttons = track.querySelectorAll('[data-segment]');
      const active = buttons[activeIndex];
      if (!active) return;
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex, options.length]);

  const padding = 4;

  return (
    <div
      ref={(node) => {
        trackRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative grid auto-cols-fr grid-flow-col rounded-full bg-surface-2 p-1',
        fullWidth && 'w-full',
        className
      )}
    >
      {/* sliding thumb */}
      {thumb && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 top-1 rounded-full bg-surface-1 shadow-sm transition-[left,width] duration-200 ease-spring motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((option, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={option.value}
            type="button"
            data-segment
            role="tab"
            aria-selected={active}
            disabled={option.disabled}
            onClick={() => onChange?.(option.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors duration-150',
              size === 'sm' ? 'min-h-9 px-3 text-xs' : 'min-h-11 px-4 text-sm',
              active ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary',
              option.disabled && 'opacity-50 pointer-events-none'
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
});

export default SegmentedControl;
