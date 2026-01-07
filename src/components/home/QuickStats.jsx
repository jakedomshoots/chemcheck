import React, { memo } from "react";
import { CheckCircle2, Clock, TrendingUp } from "lucide-react";

const QuickStats = memo(function QuickStats({ total, completed, pending }) {
  const stats = [
    {
      label: "Done",
      value: completed,
      icon: CheckCircle2,
      color: "from-emerald-500 to-teal-500",
      bgColor: "bg-emerald-50",
      textColor: "text-emerald-700"
    },
    {
      label: "Pending",
      value: pending,
      icon: Clock,
      color: "from-cyan-500 to-blue-500",
      bgColor: "bg-cyan-50",
      textColor: "text-cyan-700"
    },
    {
      label: "Total",
      value: total,
      icon: TrendingUp,
      color: "from-blue-500 to-indigo-500",
      bgColor: "bg-blue-50",
      textColor: "text-blue-700"
    }
  ];

  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`relative overflow-hidden rounded-xl ${stat.bgColor} p-3 shadow-sm`}
        >
          <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br ${stat.color} rounded-full blur-2xl opacity-20 transform translate-x-6 -translate-y-6`}></div>
          
          <div className="relative">
            <stat.icon className={`w-4 h-4 ${stat.textColor} mb-1`} />
            <div className={`text-xl font-bold ${stat.textColor} mb-0`}>
              {stat.value}
            </div>
            <div className="text-[10px] text-slate-600 font-medium">
              {stat.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

export default QuickStats;