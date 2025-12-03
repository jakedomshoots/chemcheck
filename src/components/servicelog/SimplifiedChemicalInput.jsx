import React from "react";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, AlertCircle, XCircle } from "lucide-react";

const levels = [
  { value: "low", label: "Low", color: "from-yellow-400 to-orange-500", icon: AlertTriangle, bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-700" },
  { value: "good", label: "Good", color: "from-emerald-400 to-green-500", icon: CheckCircle2, bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700" },
  { value: "high", label: "High", color: "from-orange-400 to-red-500", icon: AlertCircle, bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700" },
  { value: "critical", label: "Critical", color: "from-red-500 to-red-700", icon: XCircle, bg: "bg-red-50", border: "border-red-300", text: "text-red-700" }
];

export default function SimplifiedChemicalInput({ label, value, onChange, icon }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && <div className="text-cyan-600">{icon}</div>}
        <Label className="text-sm font-semibold text-slate-700">{label}</Label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {levels.map((level) => {
          const Icon = level.icon;
          const isSelected = value === level.value;
          return (
            <Card
              key={level.value}
              onClick={() => onChange(level.value)}
              className={`relative overflow-hidden cursor-pointer transition-all duration-300 border-2 p-4 ${
                isSelected
                  ? `${level.bg} ${level.border} shadow-lg scale-105`
                  : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md"
              }`}
            >
              {isSelected && (
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${level.color}`}></div>
              )}
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${isSelected ? level.bg : "bg-slate-50"}`}>
                  <Icon className={`w-5 h-5 ${isSelected ? level.text : "text-slate-400"}`} />
                </div>
                <span className={`font-semibold ${isSelected ? level.text : "text-slate-600"}`}>
                  {level.label}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}