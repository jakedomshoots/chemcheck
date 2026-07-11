import React, { useState, useEffect } from "react";
import { useCustomersFilter, useServiceLogs, useCurrentUser } from "@/api/convexHooks";
import { Button } from "@/components/ui/button";
import { Download, Calendar, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { PoolIcon, IconBadge } from "@/components/ui/iconography";
import { format, startOfWeek, endOfWeek, parseISO, isWithinInterval, addWeeks } from "date-fns";

const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function downloadHtmlReport(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

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

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const getLevelKey = (value) => {
      const normalized = String(value ?? '').toLowerCase();
      return ['low', 'good', 'high', 'critical'].includes(normalized) ? normalized : null;
    };

    const getLevelClass = (value) => {
      const key = getLevelKey(value);
      return key ? `level-${key}` : '';
    };

    const getLevelDisplay = (value) => {
      const key = getLevelKey(value);
      if (key) return key.toUpperCase();

      const raw = String(value ?? '').trim();
      return raw ? escapeHtml(raw.toUpperCase()) : '-';
    };

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
            .button-container {
              position: fixed;
              top: 20px;
              right: 20px;
              display: flex;
              gap: 10px;
              z-index: 1000;
            }
            .close-button, .back-button {
              background: #0891b2;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 14px;
              font-weight: bold;
              cursor: pointer;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .close-button:hover, .back-button:hover {
              background: #0e7490;
            }
            .back-button {
              background: #64748b;
            }
            .back-button:hover {
              background: #475569;
            }
            @media print {
              body { padding: 10px; }
              .day-section { page-break-inside: avoid; }
              .button-container { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="button-container">
            <button class="back-button" onclick="window.close();">← Close & Go Back</button>
            <button class="close-button" onclick="window.print();">🖨️ Print Report</button>
          </div>
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
                        <th style="width: 20%;">Customer</th>
                        <th style="width: 10%;">pH</th>
                        <th style="width: 10%;">Chlorine</th>
                        <th style="width: 10%;">Alkalinity</th>
                        <th style="width: 10%;">Cyanuric Acid</th>
                        <th style="width: 10%;">Salt</th>
                        <th style="width: 30%;">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${dayData.map(({ customer, log }) => `
                        <tr>
                          <td>
                            <div class="customer-name">${escapeHtml(customer.full_name || 'Unknown Customer')}</div>
                            <div class="address">${escapeHtml(customer.address || '')}</div>
                          </td>
                          <td class="${getLevelClass(log.ph)}">${getLevelDisplay(log.ph)}</td>
                          <td class="${getLevelClass(log.chlorine)}">${getLevelDisplay(log.chlorine)}</td>
                          <td class="${getLevelClass(log.alkalinity)}">${getLevelDisplay(log.alkalinity)}</td>
                          <td class="${getLevelClass(log.stabilizer)}">${getLevelDisplay(log.stabilizer)}</td>
                          <td style="text-align: center;">${log.salt ? `${escapeHtml(log.salt)} PPM` : '-'}</td>
                          <td class="notes-cell">${escapeHtml(log.notes || '-')}</td>
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
    downloadHtmlReport(
      `weekly-service-report-${format(currentWeekStart, "yyyy-MM-dd")}.html`,
      reportHTML
    );
    setGenerating(false);
  };

  if (loading) {
    return (
      <main
        aria-label="Weekly Report"
        className="relative mx-auto max-w-7xl px-3 pb-28 pt-4 font-sans sm:px-4 lg:px-6"
      >
        <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Reporting
          </p>
          <h2 className="text-3xl font-semibold leading-tight tracking-[-0.045em] text-slate-950">
            Weekly Report
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Loading week data</p>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" aria-hidden="true" />
          <span className="sr-only">Loading report</span>
        </div>
      </main>
    );
  }

  const totalServiced = daysOfWeek.reduce((sum, day) => sum + getDayLogs(day).length, 0);
  const isCurrentWeek = weekOffset === 0;

  return (
    <main
      aria-label="Weekly Report"
      className="relative mx-auto max-w-7xl px-3 pb-28 pt-4 font-sans sm:px-4 lg:px-6"
    >
      <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Reporting
            </p>
            <h2 className="flex items-center gap-2 text-3xl font-semibold leading-tight tracking-[-0.045em] text-slate-950">
              <PoolIcon name="report" className="h-7 w-7 text-cyan-700" />
              Weekly Report
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {format(currentWeekStart, "MMM dd")} - {format(currentWeekEnd, "MMM dd, yyyy")}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              onClick={() => setWeekOffset(weekOffset - 1)}
              variant="outline"
              size="sm"
              className="rounded-full"
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="ml-1">Previous</span>
            </Button>

            {!isCurrentWeek && (
              <Button
                onClick={() => setWeekOffset(0)}
                variant="secondary"
                size="sm"
                className="rounded-full"
              >
                Current Week
              </Button>
            )}

            <Button
              onClick={() => setWeekOffset(weekOffset + 1)}
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={isCurrentWeek}
              aria-label="Next week"
            >
              <span className="mr-1">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <Button
            onClick={generateExpandedPDF}
            disabled={generating || logs.length === 0}
            className="h-12 w-full rounded-[1.15rem] bg-slate-950 text-sm font-semibold text-white shadow-[0_18px_46px_-30px_rgba(15,23,42,0.95)] hover:bg-cyan-700 disabled:bg-slate-300 disabled:text-white disabled:shadow-none"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {generating ? "Generating..." : "Download Report"}
          </Button>
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_-44px_rgba(8,47,73,0.75)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
          Week summary
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-4xl font-semibold tracking-[-0.045em] tabular-nums text-slate-950">
              {totalServiced}
            </div>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Total Services This Week
            </p>
          </div>
          <p className="text-xs font-medium text-slate-500">
            {daysOfWeek.filter(day => getDayLogs(day).length > 0).length} of {daysOfWeek.length} active days
          </p>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="overflow-hidden rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
          <IconBadge name="report" size="md" tone="slate" className="mx-auto mb-3" iconClassName="h-6 w-6" />
          <h3 className="text-base font-semibold text-slate-900">No Services This Week</h3>
          <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-slate-500">
            Complete services to generate a report
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {daysOfWeek.map(day => {
            const dayData = getDayLogs(day);
            if (dayData.length === 0) return null;

            const isExpanded = expandedDays.includes(day);

            return (
              <div
                key={day}
                className="overflow-hidden rounded-[1.25rem] border border-white/80 bg-white/85 shadow-[0_16px_46px_-36px_rgba(8,47,73,0.75)] backdrop-blur"
              >
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-expanded={isExpanded}
                  aria-controls={`day-panel-${day}`}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-cyan-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide">
                        {day.substring(0, 3)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-950">{day}</h3>
                      <p className="text-xs font-medium text-slate-500">
                        {dayData.length} service{dayData.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {isExpanded && (
                  <div id={`day-panel-${day}`} className="border-t border-slate-200/70 bg-slate-50/60">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-white/80">
                          <tr>
                            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">pH</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cl</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Alk</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">CYA</th>
                            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayData.map(({ customer, log }) => (
                            <tr key={customer._id} className="border-t border-slate-200/70 bg-white/90 align-top">
                              <td className="px-3 py-2">
                                <div className="text-sm font-semibold text-slate-900">{customer.full_name}</div>
                                <div className="truncate text-xs text-slate-500">{customer.address}</div>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`inline-block min-w-[2.25rem] rounded-md px-2 py-0.5 text-[11px] font-semibold ${log.ph === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.ph === 'low' ? 'bg-amber-100 text-amber-700' :
                                    log.ph === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.ph === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.ph || '-'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`inline-block min-w-[2.25rem] rounded-md px-2 py-0.5 text-[11px] font-semibold ${log.chlorine === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.chlorine === 'low' ? 'bg-amber-100 text-amber-700' :
                                    log.chlorine === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.chlorine === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.chlorine || '-'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`inline-block min-w-[2.25rem] rounded-md px-2 py-0.5 text-[11px] font-semibold ${log.alkalinity === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.alkalinity === 'low' ? 'bg-amber-100 text-amber-700' :
                                    log.alkalinity === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.alkalinity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.alkalinity || '-'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className={`inline-block min-w-[2.25rem] rounded-md px-2 py-0.5 text-[11px] font-semibold ${log.stabilizer === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                  log.stabilizer === 'low' ? 'bg-amber-100 text-amber-700' :
                                    log.stabilizer === 'high' ? 'bg-orange-100 text-orange-700' :
                                      log.stabilizer === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                  {log.stabilizer || '-'}
                                </span>
                              </td>
                              <td className="max-w-[160px] truncate px-3 py-2 text-xs text-slate-600">{log.notes || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
