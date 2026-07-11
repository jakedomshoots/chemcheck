import React, { memo } from "react";
import { PoolIcon } from "@/components/ui/iconography";

const QuickStats = memo(function QuickStats({ total, completed, pending, skipped = 0 }) {
  const stats = [
    {
      label: "Done",
      value: completed,
      icon: "done",
      bgColor: "bg-white/85",
      iconColor: "text-cyan-700",
      valueColor: "text-slate-950",
    },
    {
      label: "Pending",
      value: pending,
      icon: "pending",
      bgColor: "bg-cyan-50/80",
      iconColor: "text-cyan-700",
      valueColor: "text-cyan-900",
    },
    ...(skipped > 0
      ? [{
          label: "Skipped",
          value: skipped,
          icon: "skipped",
          bgColor: "bg-amber-50/85",
          iconColor: "text-amber-700",
          valueColor: "text-amber-900",
        }]
      : []),
    {
      label: "Total",
      value: total,
      icon: "total",
      bgColor: "bg-white/85",
      iconColor: "text-slate-500",
      valueColor: "text-slate-950",
    }
  ];

  return (
    <div className={`mb-4 grid gap-2 ${skipped > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`relative overflow-hidden rounded-[1.25rem] border border-white/80 ${stat.bgColor} p-3 shadow-[0_16px_46px_-36px_rgba(8,47,73,0.75)] backdrop-blur`}
        >
          <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-cyan-200/35 blur-2xl" />

          <div className="relative">
            <PoolIcon name={stat.icon} className={`mb-2 h-4 w-4 ${stat.iconColor}`} />
            <div className={`text-2xl font-semibold tracking-[-0.04em] tabular-nums ${stat.valueColor}`}>
              {stat.value}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-slate-500">
              {stat.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

export default QuickStats;
