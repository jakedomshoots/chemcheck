import React from 'react';
import { cn } from '@/lib/utils';

/**
 * StatusBadge — replaces every hand-rolled status <span> in the app.
 *
 * tone maps onto the semantic ramp (index.css):
 *   ok · watch · action · critical · info · neutral
 *
 * Colors come from color-mix token tints, so dark mode and any hue
 * adjustment propagate automatically. Minimum 12px type, always.
 */

const toneClasses = {
  ok: 'surface-ok',
  watch: 'surface-watch',
  action: 'surface-action',
  critical: 'surface-critical',
  info: 'surface-info',
  neutral: 'bg-surface-2 border-line text-ink-secondary',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-xs gap-1.5',
};

export function StatusBadge({ tone = 'neutral', label, icon, size = 'md', className, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold whitespace-nowrap',
        toneClasses[tone] || toneClasses.neutral,
        sizeClasses[size] || sizeClasses.md,
        className
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {icon}
      {label && <span>{label}</span>}
    </span>
  );
}

/** Convenience: card/service states -> tone */
export function serviceStateTone(state) {
  switch (state) {
    case 'done':
      return 'ok';
    case 'skipped':
      return 'watch';
    case 'pending':
      return 'info';
    default:
      return 'neutral';
  }
}

export default StatusBadge;
