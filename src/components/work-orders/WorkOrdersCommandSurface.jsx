import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/iconography";

export function WorkOrdersSectionNav({ activeSection, counts, onChange }) {
  const sections = [
    { id: "dispatch", label: "Dispatch" },
    { id: "quotes", label: "Quotes" },
    { id: "invoices", label: "Invoices" },
    { id: "comms", label: "Comms" },
  ];

  return (
    <nav aria-label="Work Orders sections" className="native-scroll overflow-x-auto">
      <div className="inline-flex min-w-full rounded-xl border border-line bg-surface-2 p-1 sm:min-w-0">
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          const count = counts?.[section.id] ?? 0;

          return (
            <button
              key={section.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(section.id)}
              className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors sm:flex-none sm:px-3.5 sm:text-sm ${
                isActive
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-secondary hover:bg-white/70 hover:text-ink"
              }`}
            >
              <span>{section.label}</span>
              <span
                className={`min-w-5 rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                  isActive ? "bg-brand-soft text-brand-ink" : "bg-white text-ink-muted"
                }`}
                aria-label={`${count} ${section.label.toLowerCase()}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function WorkOrdersMetricStrip({ items, className = "" }) {
  return (
    <dl
      className={`grid grid-cols-4 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-card ${className}`}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`min-w-0 px-2 py-2.5 sm:px-4 sm:py-3 ${index > 0 ? "border-l border-line" : ""}`}
        >
          <dt className="min-h-6 text-[9px] font-semibold uppercase leading-3 tracking-[0.08em] text-ink-muted sm:min-h-0 sm:text-xs sm:tracking-[0.12em]">
            {item.label}
          </dt>
          <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight sm:text-xl ${item.valueClassName || "text-ink"}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkOrdersHealthGrid({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-line bg-white p-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted sm:text-xs">
            {item.label}
          </dt>
          <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${item.valueClassName || "text-ink"}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkOrdersEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon = "workOrders",
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-2/70 px-5 py-7 text-center">
      <IconBadge name={icon} size="lg" className="mx-auto mb-3" iconClassName="h-6 w-6" />
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-ink-secondary">{description}</p>
      {actionLabel && onAction && (
        <Button type="button" className="mt-4 h-11 px-5 sm:h-9" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
