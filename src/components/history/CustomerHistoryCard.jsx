import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, MapPin, FileText, CheckCircle2, AlertTriangle, AlertCircle, XCircle, Trash2, Calendar as CalendarIcon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const levelConfig = {
  low: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200" },
  good: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  high: { icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
  critical: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" }
};

export default function CustomerHistoryCard({ customer, logs, onDeleteLog, onClick }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [deleteLogId, setDeleteLogId] = useState(null);

  const handleDeleteConfirm = () => {
    if (deleteLogId) {
      onDeleteLog(deleteLogId);
      setDeleteLogId(null);
    }
  };

  return (
    <>
      <Card className="overflow-hidden transition-all duration-200 border-2 bg-white border-slate-200 hover:border-cyan-300 shadow-sm">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-4 cursor-pointer flex items-center justify-between active:bg-slate-50"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
              {customer.full_name.charAt(0).toUpperCase()}
            </div>
            
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base text-slate-900">{customer.full_name}</h3>
              <div className="flex items-center gap-1.5 text-slate-500 mt-0.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <p className="text-xs truncate">{customer.address}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded-md font-medium">
                  {logs.length} log{logs.length !== 1 ? 's' : ''}
                </span>
                <span className="text-xs text-slate-600">
                  Last: {format(new Date(logs[0].service_date), "MMM dd")}
                </span>
              </div>
            </div>
          </div>

          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>

        {isExpanded && (
          <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-2">
            {logs.map((log) => {
              const readings = [
                { label: "pH", value: log.ph, type: "level" },
                { label: "Cl", value: log.chlorine, type: "level" },
                { label: "Alk", value: log.alkalinity, type: "level" },
                { label: "Stab", value: log.stabilizer, type: "level" },
                { label: "Salt", value: log.salt, type: "number", unit: "PPM" }
              ].filter(r => r.value);

              return (
                <Card key={log.id} className="p-3 bg-white border-2 border-slate-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-3.5 h-3.5 text-cyan-600" />
                      <span className="font-semibold text-sm text-slate-900">
                        {format(new Date(log.service_date), "MMM dd, yyyy")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteLogId(log.id);
                      }}
                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {readings.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {readings.map((reading) => {
                        if (reading.type === "number") {
                          return (
                            <div key={reading.label} className="bg-blue-50 border border-blue-200 rounded-lg p-1.5">
                              <div className="text-[9px] text-slate-600 font-medium mb-0.5">{reading.label}</div>
                              <div className="text-xs font-semibold text-blue-700">
                                {reading.value} {reading.unit}
                              </div>
                            </div>
                          );
                        }
                        
                        const config = levelConfig[reading.value] || levelConfig.good;
                        const Icon = config.icon;
                        return (
                          <div key={reading.label} className={`${config.bg} ${config.border} border rounded-lg p-1.5`}>
                            <div className="flex items-center gap-0.5 mb-0.5">
                              <Icon className={`w-2 h-2 ${config.color}`} />
                              <div className="text-[9px] text-slate-600 font-medium">{reading.label}</div>
                            </div>
                            <div className={`text-xs font-semibold ${config.color} capitalize`}>
                              {reading.value}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {log.notes && (
                    <div className="flex items-start gap-1.5 p-2 bg-amber-50 rounded-lg border border-amber-200">
                      <FileText className="w-3 h-3 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-700 leading-relaxed">{log.notes}</p>
                    </div>
                  )}

                  {log.gate_code && (
                    <div className="flex items-start gap-1.5 p-2 bg-purple-50 rounded-lg border border-purple-200 mt-2">
                      <Lock className="w-3 h-3 text-purple-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-700">Gate: <span className="font-semibold text-purple-700">{log.gate_code}</span></p>
                    </div>
                  )}
                </Card>
              );
            })}

            <div className="pt-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm h-9"
              >
                View Full Customer Details
              </Button>
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={!!deleteLogId} onOpenChange={() => setDeleteLogId(null)}>
        <AlertDialogContent className="max-w-[90%] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete Service Log?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This action cannot be undone. Are you sure you want to delete this log?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700 text-white text-sm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}