import React, { useState } from "react";
import { ChevronDown, MapPin, Phone, Mail, Lock, Droplets, Trash2, Edit, ArrowUp, ArrowDown } from "lucide-react";
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
  isMoving
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCardClick = () => {
    if (!reorderMode) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className={`bg-white rounded-xl overflow-hidden transition-all duration-200 shadow-sm ${isMoving
      ? 'border border-blue-400 bg-[var(--status-info-soft)]'
      : 'border border-line hover:shadow-md'
      }`}>
      <div
        onClick={handleCardClick}
        className="px-4 py-3 cursor-pointer flex items-center justify-between"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {reorderMode && (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(customer);
                }}
                disabled={isFirst || isMoving}
                className="p-1 rounded hover:bg-surface-2 disabled:opacity-20 transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5 text-ink-muted" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(customer);
                }}
                disabled={isLast || isMoving}
                className="p-1 rounded hover:bg-surface-2 disabled:opacity-20 transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5 text-ink-muted" />
              </button>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-ink">{customer.full_name}</h3>
            <p className="text-xs text-ink-muted truncate">{customer.address}</p>
          </div>
        </div>

        {!reorderMode && (
          <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}

        {isMoving && (
          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
        )}
      </div>

      {isExpanded && !reorderMode && (
        <div className="border-t border-line">
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-ink-muted">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs">{customer.address}</span>
            </div>

            {customer.phone && (
              <div className="flex items-center gap-2 text-ink-muted">
                <Phone className="w-3.5 h-3.5" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-ink-muted">
                <Mail className="w-3.5 h-3.5" />
                <span className="text-xs">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 text-ink-muted">
                <Lock className="w-3 h-3 text-ink-muted" />
                <span className="text-xs font-medium text-ink-muted">Gate: {customer.gate_code}</span>
              </div>
            )}

            <div className="flex gap-1.5 flex-wrap pt-1">
              {customer.pool_type && (
                <span className="text-xs px-2 py-0.5 bg-surface-2 text-ink-secondary rounded-md font-medium">
                  {customer.pool_type}
                </span>
              )}
              {customer.pool_gallons && (
                <span className="text-xs px-2 py-0.5 bg-surface-2 text-ink-secondary rounded-md">
                  {customer.pool_gallons?.toLocaleString()} gal
                </span>
              )}
              {customer.surface_type && (
                <span className="text-xs px-2 py-0.5 bg-surface-2 text-ink-secondary rounded-md">
                  {customer.surface_type}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(customer);
                }}
                className="flex-1 bg-brand hover:bg-brand-strong text-white text-xs h-8 rounded-lg font-medium"
              >
                View
              </Button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(customer);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-line text-ink-muted hover:text-ink-secondary hover:border-line transition-colors"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(customer);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-line text-critical hover:text-critical hover:border-[var(--status-critical-line)] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}