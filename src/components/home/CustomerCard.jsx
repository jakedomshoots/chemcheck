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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatServiceDate } from "@/utils";

const CustomerCard = memo(function CustomerCard({
  customer,
  isCompleted,
  lastWeekLog,
  onClick,
  onStart,
  onSkip,
  onCall,
  onMap,
  serviceConfidence,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className={`overflow-hidden transition-all duration-200 border-2 ${isCompleted
      ? 'bg-gradient-to-r from-emerald-50/90 to-teal-50/90 border-emerald-200'
      : 'bg-white/60 border-slate-200/60 hover:border-cyan-300 active:border-cyan-400 hover:bg-white/80'
      }`}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-3 cursor-pointer flex items-center justify-between active:bg-slate-50/50"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-slate-900 truncate">{customer.full_name}</h3>
            <p className="text-xs text-slate-500 truncate">{customer.address}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${isCompleted
            ? 'bg-emerald-100/80 text-emerald-700'
            : 'bg-cyan-100/80 text-cyan-700'
            }`}>
            {isCompleted ? 'Done' : 'Pending'}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className={`px-3 pb-2 ${isCompleted ? 'bg-emerald-50/30' : 'bg-slate-50/30'}`}>
        <div className="grid grid-cols-4 gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              (onStart || onClick)?.();
            }}
          >
            <Clock className="w-3 h-3 mr-1" />
            {isCompleted ? "View" : "Start"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              onSkip?.();
            }}
            disabled={isCompleted}
          >
            <SkipForward className="w-3 h-3 mr-1" />
            Skip
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              onCall?.();
            }}
            disabled={!customer.phone}
          >
            <PhoneCall className="w-3 h-3 mr-1" />
            Call
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              onMap?.();
            }}
            disabled={!customer.address}
          >
            <MapPin className="w-3 h-3 mr-1" />
            Map
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className={`border-t ${isCompleted ? 'border-emerald-200' : 'border-slate-200/60'}`}>
          <div className={`p-3 space-y-2 ${isCompleted ? 'bg-emerald-50/40' : 'bg-slate-50/40'}`}>
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
                <span className="text-xs font-semibold text-amber-800">🔐 Gate: {customer.gate_code}</span>
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

            <div className="pt-2 space-y-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                className={`w-full text-sm h-9 ${isCompleted
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'
                  } text-white`}
              >
                {isCompleted ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    View Service Log
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4 mr-2" />
                    Start Service
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
});

export default CustomerCard;
