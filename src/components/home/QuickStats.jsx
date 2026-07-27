import React, { memo } from "react";
import { StatBlock } from "@/components/ui/stat-block";

/**
 * QuickStats — the day's numbers at a glance.
 *
 * Tones follow the semantic ramp: done = ok, skipped = watch,
 * pending = info (the actionable number), total = neutral.
 * No decorative blur blobs — the data is the decoration.
 */
const QuickStats = memo(function QuickStats({ total, completed, pending, skipped = 0 }) {
  const stats = [
    { label: "Done", value: completed, icon: "done", tone: "ok" },
    { label: "Pending", value: pending, icon: "pending", tone: "info" },
    ...(skipped > 0 ? [{ label: "Skipped", value: skipped, icon: "skipped", tone: "watch" }] : []),
    { label: "Total", value: total, icon: "total", tone: "neutral" },
  ];

  return (
    <div
      data-testid="quick-stats"
      role="region"
      aria-label="Quick Statistics"
      className={`mb-4 grid overflow-hidden rounded-card border border-line bg-surface-1 ${skipped > 0 ? "grid-cols-4" : "grid-cols-3"}`}
    >
      {stats.map((stat, index) => (
        <StatBlock
          key={stat.label}
          dataTestId={`quick-stat-${stat.label.toLowerCase()}`}
          label={stat.label}
          value={stat.value}
          icon={stat.icon}
          tone={stat.tone}
          className={index > 0 ? "border-l border-line" : undefined}
        />
      ))}
    </div>
  );
});

export default QuickStats;
