import React from 'react';
import { PoolIcon } from '@/components/ui/iconography';
import { cn } from '@/lib/utils';

/**
 * StatBlock — the one stat display for the whole app.
 *
 * Replaces per-screen "big number, small label" constructions. The number
 * leads (weight + size + tabular figures), the label demotes to a 12px
 * minimum, the icon is optional and quiet. No decorative blobs — the data
 * is the decoration.
 */

const toneStyles = {
  neutral: { icon: 'text-ink-muted', value: 'text-ink' },
  brand: { icon: 'text-info', value: 'text-ink' },
  info: { icon: 'text-brand-ink', value: 'text-brand-ink' },
  ok: { icon: 'text-ok', value: 'text-ok' },
  watch: { icon: 'text-watch', value: 'text-watch' },
  action: { icon: 'text-action', value: 'text-action' },
  critical: { icon: 'text-critical', value: 'text-critical' },
};

export function StatBlock({ label, value, icon, tone = 'neutral', suffix, className, dataTestId }) {
  const styles = toneStyles[tone] || toneStyles.neutral;

  return (
    <div
      data-testid={dataTestId}
      role="group"
      aria-label={`${label}: ${value}${suffix ? ` ${suffix}` : ''}`}
      className={cn(
        'flex min-h-14 min-w-0 items-center justify-center gap-2 px-2.5 py-2 sm:px-3',
        className
      )}
    >
      {icon && (
        <PoolIcon name={icon} className={cn('h-4 w-4', styles.icon)} aria-hidden="true" />
      )}
      <div className="min-w-0">
        <div className={cn('font-data text-xl font-semibold leading-none tracking-[-0.02em]', styles.value)}>
          {value}
          {suffix && <span className="ml-1 text-xs font-medium text-ink-muted">{suffix}</span>}
        </div>
        <div className="mt-0.5 truncate text-[0.6875rem] font-semibold leading-4 text-ink-muted">
          {label}
        </div>
      </div>
    </div>
  );
}

export default StatBlock;
