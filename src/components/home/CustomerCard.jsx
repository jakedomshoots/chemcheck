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
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-slate-500 truncate">{customer.address}</p>
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-cyan-50 text-cyan-600 hover:bg-cyan-100 active:bg-cyan-200 shrink-0"
                  aria-label={`Call ${customer.phone}`}
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
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

      <div className={`px-3 pb-2 ${rowClassName}`}>
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
          <div className="grid grid-cols-2 gap-2">
            <Button
              className={`h-12 text-sm font-semibold text-white ${
                isSkipped
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onStart?.();
              }}
            >
              <Clock className="w-4 h-4 mr-2" />
              {startLabel}
            </Button>
            <Button
              variant="outline"
              className="h-12 text-sm font-semibold border-2 border-slate-200 hover:border-cyan-500 hover:text-cyan-700"
              onClick={(e) => {
                e.stopPropagation();
                onMap?.();
              }}
              disabled={!customer.address}
            >
              <MapPin className="w-4 h-4 mr-2" />
              Map
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

                {(lastWeekLog.ph || lastWeekLog.chlorine || lastWeekLog.stabilizer || lastWeekLog.salt) && (
                  <div className="flex gap-1.5 mb-1.5 flex-wrap">
                    {lastWeekLog.ph && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-white/60 text-slate-700 rounded font-medium">
                        pH: {lastWeekLog.ph}
                      </span>
                    )}
                    {lastWeekLog.chlorine && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-white/60 text-slate-700 rounded font-medium">
                        Cl: {lastWeekLog.chlorine}
                      </span>
                    )}
                    {lastWeekLog.stabilizer && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-white/60 text-slate-700 rounded font-medium">
                        CYA: {lastWeekLog.stabilizer}
                      </span>
                    )}
                    {lastWeekLog.salt && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-white/60 text-slate-700 rounded font-medium">
                        Salt: {lastWeekLog.salt} PPM
                      </span>
                    )}
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

            <div className="grid grid-cols-2 gap-2 pt-2">
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
              {!isCompleted && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSkipped) {
                      onUnskip?.();
                    } else {
                      onSkip?.();
                    }
                  }}
                >
                  <SkipForward className="w-3.5 h-3.5 mr-1.5" />
                  {skipLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
});

export default CustomerCard;
