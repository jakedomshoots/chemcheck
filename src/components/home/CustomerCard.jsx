import { useState, memo } from "react";
import {
  Phone,
  Mail,
  ChevronDown,
  CheckCircle2,
  Clock,
  FileText,
  SkipForward,
  PhoneCall,
  MapPin,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatServiceDate } from "@/utils";

const chemicalReadingMeta = [
  { key: "ph", label: "pH" },
  { key: "chlorine", label: "Cl" },
  { key: "alkalinity", label: "Alk" },
  { key: "stabilizer", label: "CYA" },
  { key: "salt", label: "Salt", suffix: " PPM" },
];

const chemicalToneClassByStatus = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  low: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  critical: "border-red-200 bg-red-50 text-red-700",
};

function getChemicalReadings(log) {
  if (!log) return [];

  return chemicalReadingMeta
    .map(({ key, label, suffix = "" }) => {
      const value = log[key];
      if (value === null || value === undefined || value === "") return null;
      return {
        key,
        label,
        value: `${value}${suffix}`,
        toneClassName: chemicalToneClassByStatus[String(value).toLowerCase()] || "border-slate-200 bg-white/70 text-slate-700",
      };
    })
    .filter(Boolean);
}

const CustomerCard = memo(function CustomerCard({
  customer,
  isCompleted,
  isSkipped,
  lastWeekLog,
  onClick,
  onStart,
  onSkip,
  onUnskip,
  onCall,
  onMap,
  serviceConfidence,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardState = isCompleted ? "done" : isSkipped ? "skipped" : "pending";
  const statusBadgeClassName = cardState === "done"
    ? "bg-emerald-100/80 text-emerald-700"
    : cardState === "skipped"
      ? "bg-amber-100/80 text-amber-700"
      : "bg-cyan-100/80 text-cyan-700";
  const statusLabel = cardState === "done" ? "Done" : cardState === "skipped" ? "Skipped" : "Pending";
  const cardClassName = cardState === "done"
    ? "bg-gradient-to-r from-emerald-50/90 to-teal-50/90 border-emerald-200"
    : cardState === "skipped"
      ? "bg-gradient-to-r from-amber-50/80 to-orange-50/70 border-amber-200"
      : "bg-white/60 border-slate-200/60 hover:border-cyan-300 active:border-cyan-400 hover:bg-white/80";
  const rowClassName = cardState === "done"
    ? "bg-emerald-50/30"
    : cardState === "skipped"
      ? "bg-amber-50/30"
      : "bg-slate-50/30";
  const detailsClassName = cardState === "done"
    ? "bg-emerald-50/40"
    : cardState === "skipped"
      ? "bg-amber-50/20"
      : "bg-slate-50/40";
  const borderClassName = cardState === "done" ? "border-emerald-200" : "border-slate-200/60";
  const startLabel = isSkipped ? "Resume" : "Start";
  const skipLabel = isSkipped ? "Unskip" : "Skip";
  const chemicalReadings = getChemicalReadings(lastWeekLog);

  const handleHeaderClick = () => {
    if (isCompleted) {
      setIsExpanded(!isExpanded);
    } else {
      onStart?.();
    }
  };

  const handleChevronClick = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <Card className={`overflow-hidden transition-all duration-200 border-2 ${cardClassName}`}>
      <div
        onClick={handleHeaderClick}
        className="p-3 cursor-pointer flex items-center justify-between active:bg-slate-50/50"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-slate-900 truncate">{customer.full_name}</h3>
            <div className="mt-1" aria-label="Quick chemical view">
              {chemicalReadings.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {chemicalReadings.slice(0, 4).map((reading) => (
                    <span
                      key={reading.key}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${reading.toneClassName}`}
                    >
                      <span>{reading.label}</span>
                      <span className="font-bold capitalize tabular-nums">{reading.value}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] font-medium text-slate-500">
                  No recent chemical readings
                </p>
              )}
            </div>
            {customer.gate_code && (
              <div className="mt-1.5 inline-flex items-center gap-1 bg-amber-50/70 border border-amber-200 rounded-md px-1.5 py-0.5">
                <Lock className="w-3 h-3 text-amber-700" />
                <span className="text-[10px] font-semibold text-amber-800">Gate: {customer.gate_code}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${statusBadgeClassName}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={handleChevronClick}
            className="p-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors"
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
          >
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <div className={`px-3 pb-3 ${rowClassName}`}>
        {isCompleted ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-10 text-xs bg-white/60 hover:bg-white/80 text-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" />
            View Service Log
          </Button>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-1.5 rounded-xl bg-slate-100/70 p-1">
            <Button
              size="sm"
              className={`h-9 rounded-lg px-2 text-xs font-semibold text-white shadow-sm ${
                isSkipped
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onStart?.();
              }}
            >
              <Clock className="w-3.5 h-3.5" />
              {startLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`h-9 rounded-lg border px-2 text-xs font-semibold shadow-none ${
                isSkipped
                  ? 'border-amber-200 bg-amber-50/80 text-amber-700 hover:border-amber-300 hover:bg-amber-100'
                  : 'border-slate-200 bg-white/80 text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                if (isSkipped) {
                  onUnskip?.();
                } else {
                  onSkip?.();
                }
              }}
            >
              <SkipForward className="w-3.5 h-3.5" />
              {skipLabel}
            </Button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className={`border-t ${borderClassName}`}>
          <div className={`p-3 space-y-2 ${detailsClassName}`}>
            {isCompleted && serviceConfidence && (
              <div className="flex items-center gap-2 bg-cyan-50 border border-cyan-200 rounded-lg p-2">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-700" />
                <span className="text-[11px] text-cyan-800 font-medium">
                  Service Confidence: {serviceConfidence.label}
                </span>
              </div>
            )}

            {customer.phone && (
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="w-3.5 h-3.5 text-cyan-600 flex-shrink-0" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.address && (
              <div className="flex items-center gap-2 text-slate-700">
                <MapPin className="w-3.5 h-3.5 text-cyan-600 flex-shrink-0" />
                <span className="text-xs truncate">{customer.address}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-slate-700">
                <Mail className="w-3.5 h-3.5 text-cyan-600 flex-shrink-0" />
                <span className="text-xs truncate">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-2">
                <Lock className="w-3 h-3 text-amber-700" />
                <span className="text-xs font-semibold text-amber-800">Gate: {customer.gate_code}</span>
              </div>
            )}

            {lastWeekLog ? (
              <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-2.5 mt-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-[10px] font-bold text-slate-900">Last Week's Service</span>
                  <span className="text-[9px] text-slate-600">
                    ({formatServiceDate(lastWeekLog.service_date)})
                  </span>
                </div>

                {chemicalReadings.length > 0 && (
                  <div className="flex gap-1.5 mb-1.5 flex-wrap">
                    {chemicalReadings.map((reading) => (
                      <span
                        key={reading.key}
                        className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${reading.toneClassName}`}
                      >
                        {reading.label}: <span className="capitalize tabular-nums">{reading.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {lastWeekLog.notes && (
                  <p className="text-[10px] text-slate-700 leading-relaxed whitespace-pre-wrap bg-white/40 p-1.5 rounded">
                    {lastWeekLog.notes}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-slate-100/60 border border-slate-200 rounded-lg p-2.5 mt-2 text-center">
                <span className="text-[10px] text-slate-500">No service log from last week</span>
              </div>
            )}

            {(customer.phone || customer.address) && (
              <div className={`grid gap-2 pt-2 ${customer.phone && customer.address ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {customer.phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCall?.();
                    }}
                  >
                    <PhoneCall className="w-3.5 h-3.5 mr-1.5" />
                    Call
                  </Button>
                )}

                {customer.address && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMap?.();
                    }}
                  >
                    <MapPin className="w-3.5 h-3.5 mr-1.5" />
                    Map
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
});

export default CustomerCard;
