import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, MapPin, Phone, Mail, Droplets, Trash2, Edit, ArrowUp, ArrowDown } from "lucide-react";
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
    <Card className={`overflow-hidden transition-all duration-200 shadow-sm border-2 ${
      isMoving ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-cyan-300 bg-white'
    }`}>
      <div
        onClick={handleCardClick}
        className="p-4 cursor-pointer flex items-center justify-between"
      >
        <div className="flex items-center gap-3 flex-1">
          {reorderMode && (
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(customer);
                }}
                disabled={isFirst || isMoving}
                className="h-7 w-7 hover:bg-blue-100 disabled:opacity-30"
              >
                <ArrowUp className="w-4 h-4 text-blue-600" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(customer);
                }}
                disabled={isLast || isMoving}
                className="h-7 w-7 hover:bg-blue-100 disabled:opacity-30"
              >
                <ArrowDown className="w-4 h-4 text-blue-600" />
              </Button>
            </div>
          )}
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
            {customer.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base text-slate-900">{customer.full_name}</h3>
            <p className="text-xs text-slate-500 truncate">{customer.address}</p>
          </div>
        </div>

        {!reorderMode && (
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}
        
        {isMoving && (
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        )}
      </div>

      {isExpanded && !reorderMode && (
        <div className="border-t border-slate-200">
          <div className="p-4 space-y-3 bg-slate-50">
            <div className="flex items-start gap-2 text-slate-700">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-cyan-600" />
              <span className="text-sm">{customer.address}</span>
            </div>

            {customer.phone && (
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="w-4 h-4 text-cyan-600" />
                <span className="text-sm">{customer.phone}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-slate-700">
                <Mail className="w-4 h-4 text-cyan-600" />
                <span className="text-sm">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <span className="text-xs font-semibold text-amber-800">🔐 Gate: {customer.gate_code}</span>
              </div>
            )}

            <div className="flex gap-2 flex-wrap pt-2">
              {customer.pool_type && (
                <span className="text-xs px-3 py-1.5 bg-cyan-100 text-cyan-700 rounded-lg font-medium">
                  <Droplets className="w-3 h-3 inline mr-1" />
                  {customer.pool_type}
                </span>
              )}
              {customer.pool_gallons && (
                <span className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg">
                  {customer.pool_gallons?.toLocaleString()} gal
                </span>
              )}
              {customer.surface_type && (
                <span className="text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg">
                  {customer.surface_type}
                </span>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(customer);
                }}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm"
              >
                View
              </Button>
              <Button
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(customer);
                }}
                className="border-2 hover:border-blue-500 hover:bg-blue-50 text-sm px-3"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(customer);
                }}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 border-2 text-sm px-3"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}