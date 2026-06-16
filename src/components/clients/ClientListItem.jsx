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
      ? 'border border-blue-400 bg-blue-50/50'
      : 'border border-slate-200/60 hover:shadow-md'
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
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(customer);
                }}
                disabled={isLast || isMoving}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-20 transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">{customer.full_name}</h3>
            <p className="text-xs text-slate-400 truncate">{customer.address}</p>
          </div>
        </div>

        {!reorderMode && (
          <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}

        {isMoving && (
          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
        )}
      </div>

      {isExpanded && !reorderMode && (
        <div className="border-t border-slate-100">
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-slate-500">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs">{customer.address}</span>
            </div>

            {customer.phone && (
              <div className="flex items-center gap-2 text-slate-500">
                <Phone className="w-3.5 h-3.5" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-slate-500">
                <Mail className="w-3.5 h-3.5" />
                <span className="text-xs">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 text-slate-500">
                <Lock className="w-3 h-3 text-slate-500" />
                <span className="text-xs font-medium text-slate-500">Gate: {customer.gate_code}</span>
              </div>
            )}

            <div className="flex gap-1.5 flex-wrap pt-1">
              {customer.pool_type && (
                <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-medium">
                  {customer.pool_type}
                </span>
              )}
              {customer.pool_gallons && (
                <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
                  {customer.pool_gallons?.toLocaleString()} gal
                </span>
              )}
              {customer.surface_type && (
                <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
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
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-xs h-8 rounded-lg font-medium"
              >
                View
              </Button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(customer);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(customer);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 text-red-400 hover:text-red-500 hover:border-red-300 transition-colors"
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