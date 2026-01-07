import React, { useState, useEffect } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, Download, Calendar, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { format, startOfWeek, endOfWeek, parseISO, isWithinInterval, addWeeks } from "date-fns";

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function WeeklyReport() {
  const user = useCurrentUser();

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedDays, setExpandedDays] = useState([]);

  const baseDate = addWeeks(new Date(), weekOffset);
  const currentWeekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });

  const allCustomers = useCustomersFilter({ created_by: user.email });
  const allLogs = useServiceLogs("-service_date");

  // Derive state directly from hooks (no useEffect needed)
  const customers = allCustomers || [];

  const logs = (allLogs || []).filter(log => {
    try {
      const logDate = parseISO(log.service_date);
      return isWithinInterval(logDate, { start: currentWeekStart, end: currentWeekEnd });
    } catch (e) {
      console.error("Invalid date:", log.service_date);
      return false;
    }
  });

  // Loading state is derived from hooks
  useEffect(() => {
    if (allCustomers !== undefined && allLogs !== undefined) {
      setLoading(false);
    }
  }, [allCustomers, allLogs]);

  const toggleDay = (day) => {
    setExpandedDays(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const getDayLogs = (day) => {
    return customers
      .filter(c => c.service_day === day)
      .map(customer => {
        const log = logs.find(l => l.customer_id === customer._id);
        return { customer, log };
      })
      .filter(item => item.log);
  };

  const generateExpandedPDF = () => {
    setGenerating(true);

    const logsByDay = {};
    daysOfWeek.forEach(day => {
      logsByDay[day] = getDayLogs(day);
    });

    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      setGenerating(false);
      alert("Please allow popups to download the report");
      return;
    }

    const reportHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Weekly Service Report - ${format(currentWeekStart, "MMM dd")} to ${format(currentWeekEnd, "MMM dd, yyyy")}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Arial', sans-serif; 
              padding: 20px; 
              font-size: 11px; 
              color: #000; 
            }
            .header { 
              text-align: center; 
              margin-bottom: 20px; 
              padding-bottom: 15px; 
              border-bottom: 3px solid #0891b2; 
            }
            .header h1 { 
              font-size: 24px; 
              color: #0891b2; 
              margin-bottom: 5px; 
            }
            .header p { 
              font-size: 12px; 
              color: #666; 
            }
            .day-section { 
              margin-bottom: 30px; 
              page-break-inside: avoid; 
            }
            .day-header { 
              background: #0891b2; 
              color: white; 
              padding: 10px 15px; 
              font-size: 16px; 
              font-weight: bold; 
              margin-bottom: 15px; 
              border-radius: 8px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-bottom: 15px; 
              background: white; 
            }
            th { 
              background: #f1f5f9; 
              border: 2px solid #cbd5e1; 
              padding: 10px 8px; 
              text-align: left; 
              font-weight: bold; 
              font-size: 11px; 
              color: #1e293b; 
            }
            td { 
              border: 2px solid #e2e8f0; 
              padding: 8px; 
              font-size: 11px; 
              vertical-align: top;
            }
            .customer-name { 
              font-weight: bold; 
              color: #1e293b; 
              margin-bottom: 3px;
            }
            .address { 
              color: #64748b; 
              font-size: 9px; 
            }
            .level-low { 
              background: #fef3c7;
              color: #92400e;
              font-weight: bold;
              text-align: center;
              padding: 5px;
              border-radius: 4px;
            }
            .level-good { 
              background: #d1fae5;
              color: #065f46;
              font-weight: bold;
              text-align: center;
              padding: 5px;
              border-radius: 4px;
            }
            .level-high { 
              background: #fed7aa;
              color: #9a3412;
              font-weight: bold;
              text-align: center;
              padding: 5px;
              border-radius: 4px;
            }
            .level-critical { 
              background: #fecaca;
              color: #991b1b;
              font-weight: bold;
              text-align: center;
              padding: 5px;
              border-radius: 4px;
            }
            .notes-cell {
              max-width: 250px;
              font-size: 10px;
              color: #475569;
              line-height: 1.4;
            }
            .no-service {
              text-align: center;
              color: #94a3b8;
              font-style: italic;
            }
            .close-button {
              position: fixed;
              top: 20px;
              right: 20px;
              background: #0891b2;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 14px;
              font-weight: bold;
              cursor: pointer;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              z-index: 1000;
            }
            .close-button:hover {
              background: #0e7490;
            }
            @media print {
              body { padding: 10px; }
              .day-section { page-break-inside: avoid; }
              .close-button { display: none; }
            }
          </style>
        </head>
        <body>
          <button class="close-button" onclick="window.print(); setTimeout(() => window.close(), 500);">🖨️ Print Report</button>
          <div class="header">
            <h1>🌊 Weekly Service Report</h1>
            <p><strong>Week of:</strong> ${format(currentWeekStart, "MMMM dd")} - ${format(currentWeekEnd, "MMMM dd, yyyy")}</p>
            <p><strong>Generated:</strong> ${format(new Date(), "PPpp")}</p>
          </div>

          ${daysOfWeek.map(day => {
      const dayData = logsByDay[day];

      return `
              <div class="day-section">
                <div class="day-header">${day} - ${dayData.length} Service${dayData.length !== 1 ? 's' : ''}</div>
                ${dayData.length === 0 ? `
                  <p class="no-service">No services recorded for this day</p>
                ` : `
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 22%;">Customer</th>
                        <th style="width: 10%;">pH</th>
                        <th style="width: 10%;">Chlorine</th>
                        <th style="width: 10%;">Cyanuric Acid</th>
                        <th style="width: 10%;">Salt</th>
                        <th style="width: 38%;">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${dayData.map(({ customer, log }) => `
                        <tr>
                          <td>
                            <div class="customer-name">${customer.full_name}</div>
                            <div class="address">${customer.address}</div>
                          </td>
                          <td class="${log.ph ? `level-${log.ph}` : ''}">${log.ph ? log.ph.toUpperCase() : '-'}</td>
                          <td class="${log.chlorine ? `level-${log.chlorine}` : ''}">${log.chlorine ? log.chlorine.toUpperCase() : '-'}</td>
                          <td class="${log.stabilizer ? `level-${log.stabilizer}` : ''}">${log.stabilizer ? log.stabilizer.toUpperCase() : '-'}</td>
                          <td style="text-align: center;">${log.salt ? log.salt + ' PPM' : '-'}</td>
                          <td class="notes-cell">${log.notes || '-'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `}
              </div>
            `;
    }).join('')}
        </body>
      </html>
    `;

    printWindow.document.write(reportHTML);
    printWindow.document.close();

    setTimeout(() => {
      setGenerating(false);
    }, 500);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-600 text-sm">Loading report...</p>
      </div>
    );
  }

  const totalServiced = daysOfWeek.reduce((sum, day) => sum + getDayLogs(day).length, 0);
  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="max-w-7xl mx-auto px-3 py-4">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Weekly Report</h2>
            <p className="text-xs text-slate-600">
              {format(currentWeekStart, "MMM dd")} - {format(currentWeekEnd, "MMM dd, yyyy")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setWeekOffset(weekOffset - 1)}
            variant="outline"
            size="sm"
            className="border-2 rounded-xl"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>

          {!isCurrentWeek && (
            <Button
              onClick={() => setWeekOffset(0)}
              variant="outline"
              size="sm"
              className="border-2 rounded-xl border-cyan-500 text-cyan-600"
            >
              Current Week
            </Button>
          )}

          <Button
            onClick={() => setWeekOffset(weekOffset + 1)}
            variant="outline"
            size="sm"
            className="border-2 rounded-xl"
            disabled={isCurrentWeek}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>

        <Button
          onClick={generateExpandedPDF}
          disabled={generating || logs.length === 0}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg text-sm h-10"
        >
          <Download className="w-4 h-4 mr-2" />
          {generating ? "Generating..." : "Download Report"}
        </Button>
      </div>

      <Card className="p-4 mb-4 border-2 shadow-lg bg-gradient-to-br from-cyan-50 to-blue-50">
        <div className="text-center">
          <div className="text-3xl font-bold text-cyan-600 mb-1">{totalServiced}</div>
          <div className="text-sm text-slate-600">Total Services This Week</div>
        </div>
      </Card>

      {logs.length === 0 ? (
        <Card className="p-8 text-center bg-slate-50 border-2 border-dashed border-slate-200">
          <div className="w-12 h-12 mx-auto mb-3 bg-slate-100 rounded-full flex items-center justify-center">
            <Calendar className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">No Services This Week</h3>
          <p className="text-xs text-slate-600">Complete services to generate a report</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {daysOfWeek.map(day => {
            const dayData = getDayLogs(day);
            if (dayData.length === 0) return null;

            const isExpanded = expandedDays.includes(day);

            return (
              <Card key={day} className="overflow-hidden border-2 shadow-sm">
                <div
                  onClick={() => toggleDay(day)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {day.substring(0, 3)}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{day}</h3>
                      <p className="text-xs text-slate-600">{dayData.length} service{dayData.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="text-left p-2 text-[10px] font-semibold text-slate-700">Customer</th>
                            <th className="text-center p-2 text-[10px] font-semibold text-slate-700">pH</th>
                            <th className="text-center p-2 text-[10px] font-semibold text-slate-700">Cl</th>
                            <th className="text-center p-2 text-[10px] font-semibold text-slate-700">CYA</th>
                            <th className="text-left p-2 text-[10px] font-semibold text-slate-700">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayData.map(({ customer, log }, idx) => (
                            <tr key={customer._id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                              <td className="p-2">
                                <div className="font-semibold text-xs text-slate-900">{customer.full_name}</div>
                                <div className="text-[10px] text-slate-500 truncate">{customer.address}</div>
                              </td>
                              <td className="p-2 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.ph === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.ph === 'low' ? 'bg-yellow-100 text-yellow-700' :
                                    log.ph === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.ph === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.ph || '-'}
                                </span>
                              </td>
                              <td className="p-2 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.chlorine === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.chlorine === 'low' ? 'bg-yellow-100 text-yellow-700' :
                                    log.chlorine === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.chlorine === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.chlorine || '-'}
                                </span>
                              </td>
                              <td className="p-2 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.stabilizer === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.stabilizer === 'low' ? 'bg-yellow-100 text-yellow-700' :
                                    log.stabilizer === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.stabilizer === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.stabilizer || '-'}
                                </span>
                              </td>
                              <td className="p-2 text-[10px] text-slate-600 max-w-[150px] truncate">{log.notes || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}