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
      className={cn(
        'rounded-raised border border-line bg-surface-1 p-3 shadow-card sm:p-4',
        className
      )}
    >
      {icon && (
        <PoolIcon name={icon} className={cn('mb-2 h-4 w-4', styles.icon)} aria-hidden="true" />
      )}
      <div className={cn('font-data text-2xl font-semibold tracking-[-0.02em]', styles.value)}>
        {value}
        {suffix && <span className="ml-1 text-sm font-medium text-ink-muted">{suffix}</span>}
      </div>
      <div className="mt-1 text-xs font-semibold text-ink-muted">{label}</div>
    </div>
  );
}

export default StatBlock;
