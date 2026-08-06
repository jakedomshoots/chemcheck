import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Edit,
  Lock,
  Mail,
  MapPin,
  Phone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClientListItem({
  customer,
  onDelete,
  onEdit,
  onClick,
  reorderMode,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  isMoving,
  stopNumber,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayStopNumber = String(stopNumber ?? 1).padStart(2, "0");
  const detailsId = `client-details-${customer._id}`;
  const poolDetails = [
    customer.pool_type,
    customer.pool_gallons ? `${customer.pool_gallons.toLocaleString()} gal` : null,
    customer.surface_type,
  ].filter(Boolean);

  return (
    <article
      data-testid={`client-list-item-${customer._id}`}
      className={`transition-colors duration-150 ${
        isMoving ? "bg-[var(--status-info-soft)]" : "bg-surface-1"
      }`}
    >
      <div className="flex min-h-[4.5rem] items-center gap-1 px-3 py-2">
        <span className="w-7 shrink-0 text-center" aria-label={`Stop ${stopNumber ?? 1}`}>
          <span className="block font-data text-sm font-bold leading-none text-brand-ink">
            {displayStopNumber}
          </span>
          <span className="mt-1 block text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-ink-muted">
            Stop
          </span>
        </span>

        {reorderMode ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{customer.full_name}</p>
              <p className="truncate text-xs text-ink-muted">{customer.address}</p>
            </div>

            <div className="flex shrink-0 items-center" aria-label={`Reorder ${customer.full_name}`}>
              <button
                type="button"
                onClick={() => onMoveUp(customer)}
                disabled={isFirst || isMoving}
                className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-2 disabled:opacity-20"
                aria-label={`Move ${customer.full_name} up`}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(customer)}
                disabled={isLast || isMoving}
                className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-2 disabled:opacity-20"
                aria-label={`Move ${customer.full_name} down`}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control pl-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-2"
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${customer.full_name}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{customer.full_name}</span>
              <span className="block truncate text-xs text-ink-muted">{customer.address}</span>
            </span>
            <ChevronDown
              className={`mr-1 h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${
                isExpanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>
        )}

        {isMoving && (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-info border-t-transparent" aria-label="Updating order" />
        )}
      </div>

      {isExpanded && !reorderMode && (
        <div id={detailsId} className="border-t border-line bg-surface-2 px-3 py-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-ink-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
              <span className="text-xs">{customer.address}</span>
            </div>

            {customer.phone && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Phone className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Mail className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="truncate text-xs">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 text-watch">
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">Gate: {customer.gate_code}</span>
              </div>
            )}
          </div>

          {poolDetails.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-muted">
                Pool profile
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {poolDetails.map((detail, index) => (
                  <span
                    key={`${detail}-${index}`}
                    className={`text-xs font-semibold text-ink-secondary ${
                      index > 0 ? "border-l border-line pl-2" : ""
                    }`}
                  >
                    {detail}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-1 border-t border-line pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClick(customer)}
              className="h-11 px-3 text-xs font-semibold text-brand-ink hover:bg-[var(--status-info-soft)]"
            >
              View client
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(customer)}
              className="h-11 w-11 text-ink-muted hover:bg-surface-1 hover:text-ink"
              aria-label={`Edit ${customer.full_name}`}
            >
              <Edit className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(customer)}
              className="h-11 w-11 text-critical hover:bg-[var(--status-critical-soft)] hover:text-critical"
              aria-label={`Delete ${customer.full_name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
