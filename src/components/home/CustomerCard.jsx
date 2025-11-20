
import React, { useState, memo } from "react";
import { MapPin, Phone, Mail, Droplets, ChevronDown, CheckCircle2, Clock, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";

// Helper to format date without timezone issues
const formatServiceDate = (dateString) => {
  // Assuming dateString is in 'YYYY-MM-DD' format
  const [year, month, day] = dateString.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month, 10) - 1]} ${parseInt(day, 10)}`;
};

const CustomerCard = memo(function CustomerCard({ customer, isCompleted, lastWeekLog, onClick }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className={`overflow-hidden transition-all duration-200 border-2 ${
      isCompleted 
        ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200' 
        : 'bg-white border-slate-200 hover:border-cyan-300 active:border-cyan-400'
    }`}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-3 cursor-pointer flex items-center justify-between active:bg-slate-50"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${
            isCompleted ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-cyan-500 to-blue-600'
          }`}>
            {customer.full_name.charAt(0).toUpperCase()}
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-slate-900 truncate">{customer.full_name}</h3>
            <p className="text-xs text-slate-500 truncate">{customer.address}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
            isCompleted 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'bg-cyan-100 text-cyan-700'
          }`}>
            {isCompleted ? 'Done' : 'Pending'}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {isExpanded && (
        <div className={`border-t ${isCompleted ? 'border-emerald-200' : 'border-slate-200'}`}>
          <div className={`p-3 space-y-2 ${isCompleted ? 'bg-emerald-50/50' : 'bg-slate-50'}`}>
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
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <span className="text-xs font-semibold text-amber-800">🔐 Gate: {customer.gate_code}</span>
              </div>
            )}

            {lastWeekLog ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mt-2">
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
              <div className="bg-slate-100 border border-slate-200 rounded-lg p-2.5 mt-2 text-center">
                <span className="text-[10px] text-slate-500">No service log from last week</span>
              </div>
            )}

            <div className="pt-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                className={`w-full text-sm h-9 ${
                  isCompleted
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
