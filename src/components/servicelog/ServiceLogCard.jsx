import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, FileText, CheckCircle2, AlertTriangle, AlertCircle, XCircle, ChevronDown, Trash2, Lock } from "lucide-react";
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

// Helper to format date without timezone issues
const formatServiceDate = (dateString) => {
  // Split the date string to avoid timezone conversion
  const [year, month, day] = dateString.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
};

export default function ServiceLogCard({ log, onDelete }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const readings = [
    { label: "pH", value: log.ph, type: "level" },
    { label: "Cl", value: log.chlorine, type: "level" },
    { label: "Alk", value: log.alkalinity, type: "level" },
    { label: "Stab", value: log.stabilizer, type: "level" },
    { label: "Salt", value: log.salt, type: "number", unit: "PPM" }
  ].filter(r => r.value);

  const getWorstStatus = () => {
    const levelStatuses = readings.filter(r => r.type === "level").map(r => r.value);
    if (levelStatuses.includes('critical')) return 'critical';
    if (levelStatuses.includes('high')) return 'high';
    if (levelStatuses.includes('low')) return 'low';
    return 'good';
  };

  const worstStatus = getWorstStatus();
  const summaryConfig = levelConfig[worstStatus];
  const SummaryIcon = summaryConfig.icon;

  const handleDelete = () => {
    setShowDeleteDialog(false);
    onDelete();
  };

  return (
    <>
      <Card className="overflow-hidden transition-all duration-200 border-2 hover:border-cyan-300 active:border-cyan-400 shadow-sm bg-white">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-3 cursor-pointer flex items-center justify-between active:bg-slate-50"
        >
          <div className="flex items-center gap-2 flex-1">
            <div className={`p-1.5 ${summaryConfig.bg} rounded-lg`}>
              <Calendar className="w-3.5 h-3.5 text-cyan-600" />
            </div>
            <div>
              <span className="font-semibold text-sm text-slate-900">
                {formatServiceDate(log.service_date)}
              </span>
              <div className="flex items-center gap-1 mt-0.5">
                <SummaryIcon className={`w-2.5 h-2.5 ${summaryConfig.color}`} />
                <span className={`text-[10px] font-medium ${summaryConfig.color}`}>
                  {readings.filter(r => r.type === "level").length} reading{readings.filter(r => r.type === "level").length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
              className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-200">
            <div className="p-3 space-y-2 bg-slate-50">
              <div className="grid grid-cols-3 gap-1.5">
                {readings.map((reading) => {
                  if (reading.type === "number") {
                    return (
                      <div key={reading.label} className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                        <div className="text-[10px] text-slate-600 font-medium mb-0.5">{reading.label}</div>
                        <div className="text-xs font-semibold text-blue-700">
                          {reading.value} {reading.unit}
                        </div>
                      </div>
                    );
                  }
                  
                  const config = levelConfig[reading.value] || levelConfig.good;
                  const Icon = config.icon;
                  return (
                    <div key={reading.label} className={`${config.bg} ${config.border} border rounded-lg p-2`}>
                      <div className="flex items-center gap-0.5 mb-0.5">
                        <Icon className={`w-2.5 h-2.5 ${config.color}`} />
                        <div className="text-[10px] text-slate-600 font-medium">{reading.label}</div>
                      </div>
                      <div className={`text-xs font-semibold ${config.color} capitalize`}>
                        {reading.value}
                      </div>
                    </div>
                  );
                })}
              </div>

              {log.notes && (
                <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                  <FileText className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed">{log.notes}</p>
                </div>
              )}

              {log.gate_code && (
                <div className="flex items-start gap-1.5 p-2.5 bg-purple-50 rounded-lg border border-purple-200">
                  <Lock className="w-3.5 h-3.5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed">Gate Code: <span className="font-semibold text-purple-700">{log.gate_code}</span></p>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="max-w-[90%] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Delete Service Log?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Delete log from {formatServiceDate(log.service_date)}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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