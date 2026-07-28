import { useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PoolIcon } from '@/components/ui/iconography';
import { useBottomNavigation } from '@/hooks/useBottomNavigation';
import {
  BOTTOM_NAV_MAX_ITEMS,
  BOTTOM_NAV_MIN_ITEMS,
  MOBILE_NAV_ITEMS,
  getMobileNavItems,
} from '@/lib/bottomNavigation';

export function BottomNavigationSettings() {
  const { itemIds, updateItemIds, restoreDefaults } = useBottomNavigation();
  const [announcement, setAnnouncement] = useState('');
  const selectedItems = getMobileNavItems(itemIds);
  const availableItems = MOBILE_NAV_ITEMS.filter((item) => !itemIds.includes(item.id));
  const atMinimum = itemIds.length <= BOTTOM_NAV_MIN_ITEMS;
  const atMaximum = itemIds.length >= BOTTOM_NAV_MAX_ITEMS;

  const applyNavigationChange = (nextIds, message) => {
    updateItemIds(nextIds);
    setAnnouncement(message);
  };

  const moveItem = (index, direction) => {
    const destination = index + direction;
    if (destination < 0 || destination >= itemIds.length) return;

    const nextIds = [...itemIds];
    [nextIds[index], nextIds[destination]] = [nextIds[destination], nextIds[index]];
    const item = selectedItems[index];
    applyNavigationChange(nextIds, `${item.name} moved to position ${destination + 1}.`);
  };

  const removeItem = (item) => {
    if (atMinimum) return;
    applyNavigationChange(itemIds.filter((id) => id !== item.id), `${item.name} moved to More.`);
  };

  const addItem = (item) => {
    if (atMaximum) return;
    applyNavigationChange([...itemIds, item.id], `${item.name} pinned to the bottom menu.`);
  };

  const reset = () => {
    restoreDefaults();
    setAnnouncement('Bottom menu restored to the ChemCheck default.');
  };

  return (
    <section id="bottom-menu" aria-labelledby="bottom-menu-title" className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-ink">Mobile tool belt</p>
          <h2 id="bottom-menu-title" className="text-xl font-semibold tracking-[-0.025em] text-ink">Bottom menu</h2>
          <p className="mt-1 text-sm leading-5 text-ink-secondary">
            Pin two to four destinations in the order you use them. Everything else stays in More.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reset}
          className="h-11 shrink-0 rounded-control px-3"
        >
          <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Reset
        </Button>
      </div>

      <div className="rounded-raised border border-line bg-surface-2 p-2.5">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-ink-secondary">Live preview</span>
          <span className="font-data text-xs font-medium tabular-nums text-ink-muted">{itemIds.length} of {BOTTOM_NAV_MAX_ITEMS} pinned</span>
        </div>
        <div
          className="flex h-16 items-stretch overflow-hidden rounded-card border border-line bg-surface-1"
          role="group"
          aria-label="Bottom menu preview"
        >
          {selectedItems.map((item, index) => (
            <div
              key={item.id}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 ${index > 0 ? 'border-l border-line' : ''}`}
            >
              <PoolIcon name={item.icon} className="h-5 w-5 text-brand-ink" />
              <span className="max-w-full truncate px-1 text-[11px] font-semibold text-ink-secondary">{item.shortLabel}</span>
            </div>
          ))}
          <div className={`${selectedItems.length > 0 ? 'border-l border-line' : ''} flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5`}>
            <PoolIcon name="more" className="h-5 w-5 text-ink-muted" />
            <span className="text-[11px] font-semibold text-ink-secondary">More</span>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Pinned order</h3>
            <p className="text-xs text-ink-muted">Top to bottom becomes left to right.</p>
          </div>
          <span className="whitespace-nowrap text-xs font-medium text-ink-muted">Changes save automatically</span>
        </div>

        <ol className="divide-y divide-line overflow-hidden rounded-raised border border-line bg-surface-1">
          {selectedItems.map((item, index) => (
            <li key={item.id} className="flex min-h-14 items-center gap-2 px-2 py-1.5 sm:px-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-brand-soft text-brand-ink">
                <PoolIcon name={item.icon} className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{item.name}</span>
                <span className="block text-xs text-ink-muted">Position {index + 1}</span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                  className="flex h-11 w-11 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${item.name} earlier`}
                >
                  <ChevronUp className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === selectedItems.length - 1}
                  className="flex h-11 w-11 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${item.name} later`}
                >
                  <ChevronDown className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={atMinimum}
                  className="flex h-11 w-11 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${item.name} to More`}
                >
                  <Minus className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-ink">Available in More</h3>
          <p className="text-xs text-ink-muted">
            {atMaximum ? 'Move one pinned item to More before adding another.' : 'Tap a destination to pin it at the end.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {availableItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => addItem(item)}
              disabled={atMaximum}
              className="flex min-h-12 items-center gap-2 rounded-control border border-line bg-surface-1 px-3 py-2 text-left text-sm font-semibold text-ink transition-colors hover:border-[var(--status-info-line)] hover:bg-brand-softer disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={`Pin ${item.name}`}
            >
              <PoolIcon name={item.icon} className="h-4 w-4 shrink-0 text-brand-ink" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <Plus className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}
