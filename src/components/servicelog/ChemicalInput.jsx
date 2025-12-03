import React from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Minus } from "lucide-react";

export default function ChemicalInput({ 
  label, 
  value, 
  onChange, 
  min = 0, 
  max = 100, 
  step = 0.1,
  unit = "",
  icon
}) {
  const handleIncrement = () => {
    const newValue = Math.min(max, (value || 0) + step);
    onChange(Math.round(newValue * 10) / 10);
  };

  const handleDecrement = () => {
    const newValue = Math.max(min, (value || 0) - step);
    onChange(Math.round(newValue * 10) / 10);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <div className="text-cyan-600">{icon}</div>}
          <Label className="text-sm font-semibold text-slate-700">{label}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-slate-900">
            {value || 0}
          </span>
          {unit && <span className="text-sm text-slate-500">{unit}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleDecrement}
          className="h-10 w-10 rounded-xl border-2 hover:border-cyan-500 hover:bg-cyan-50 transition-all"
        >
          <Minus className="w-4 h-4" />
        </Button>

        <div className="flex-1">
          <Slider
            value={[value || 0]}
            onValueChange={(vals) => onChange(vals[0])}
            min={min}
            max={max}
            step={step}
            className="[&_[role=slider]]:bg-gradient-to-r [&_[role=slider]]:from-cyan-500 [&_[role=slider]]:to-blue-500 [&_[role=slider]]:border-0 [&_[role=slider]]:shadow-lg"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleIncrement}
          className="h-10 w-10 rounded-xl border-2 hover:border-cyan-500 hover:bg-cyan-50 transition-all"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="text-center font-medium border-2 focus:border-cyan-500 rounded-xl"
      />
    </div>
  );
}