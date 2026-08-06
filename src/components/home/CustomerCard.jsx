import { useState, memo } from "react";
import {
  Phone,
  Mail,
  ChevronDown,
  FileText,
  PhoneCall,
  MapPin,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { readingToStatus, statusToTone } from "@/lib/chemStatus";
import { formatServiceDate } from "@/utils";

const chemicalReadingMeta = [
  { key: "ph", label: "pH" },
  { key: "chlorine", label: "Cl" },
  { key: "alkalinity", label: "Alk" },
  { key: "stabilizer", label: "CYA" },
  { key: "salt", label: "Salt", suffix: " PPM" },
];

function getChemicalReadings(log) {
  if (!log) return [];

  return chemicalReadingMeta
    .map(({ key, label, suffix = "" }) => {
      const value = log[key];
      if (value === null || value === undefined || value === "") return null;
      return {
        key,
        label,
        value: `${value}${suffix}`,
        textToneClassName: chemicalTextToneClassName(key, value),
      };
    })
    .filter(Boolean);
}

function chemicalTextToneClassName(key, value) {
  switch (statusToTone(readingToStatus(key, value))) {
    case "ok":
      return "text-[var(--status-ok-ink)]";
    case "watch":
      return "text-[var(--status-watch-ink)]";
    case "action":
      return "text-[var(--status-action-ink)]";
    case "critical":
      return "text-[var(--status-critical-ink)]";
    default:
      return "text-ink-secondary";
  }
}

const rowStateClassName = {
  done: "bg-[var(--status-ok-soft)]",
  skipped: "bg-[var(--status-watch-soft)]",
  pending: "bg-surface-1",
};

const statusToneClassName = {
  done: {
    dot: "bg-[var(--status-ok)]",
    label: "text-ok",
  },
  skipped: {
    dot: "bg-[var(--status-watch)]",
    label: "text-watch",
  },
  pending: {
    dot: "bg-[var(--status-info)]",
    label: "text-info",
  },
};

const CustomerCard = memo(function CustomerCard({
  customer,
  isCompleted,
  isSkipped,
  lastWeekLog,
  onClick,
  onStart,
  onSkip,
  onUnskip,
  onCall,
  onMap,
  serviceConfidence,
  stopNumber,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardState = isCompleted ? "done" : isSkipped ? "skipped" : "pending";
  const statusLabel = cardState === "done" ? "Done" : cardState === "skipped" ? "Skipped" : "Pending";
  const startLabel = isSkipped ? "Resume" : "Start";
  const skipLabel = isSkipped ? "Move back" : "Skip";
  const rowActionLabel = isCompleted ? "View" : startLabel;
  const chemicalReadings = getChemicalReadings(lastWeekLog);
  const displayStopNumber = String(stopNumber ?? 1).padStart(2, "0");
  const detailsId = `customer-details-${customer._id}`;

  const handleRowAction = () => {
    if (isCompleted) {
      onClick?.();
    } else {
      onStart?.();
    }
  };

  return (
    <article
      data-testid={`customer-card-${customer._id}`}
      data-service-state={cardState}
      className={`transition-colors duration-150 ${rowStateClassName[cardState]}`}
    >
      <div className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-control text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-2"
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${customer.full_name}`}
          >
            <span className="w-7 shrink-0 text-center" aria-label={`Stop ${stopNumber ?? 1}`}>
              <span className="block font-data text-sm font-bold leading-none text-brand-ink">
                {displayStopNumber}
              </span>
              <span className="mt-1 block text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-ink-muted">
                Stop
              </span>
            </span>

            <span className="flex min-w-0 flex-1 items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {customer.full_name}
              </h3>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 text-[0.6875rem] font-semibold ${statusToneClassName[cardState].label}`}
                aria-label={`Service status: ${statusLabel}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${statusToneClassName[cardState].dot}`}
                  aria-hidden="true"
                />
                {statusLabel}
              </span>
            </span>

            <ChevronDown
              className={`mr-1 h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          <Button
            variant="ghost"
            size="sm"
            className={`h-11 min-w-16 shrink-0 rounded-control px-3 text-xs font-semibold shadow-none ${
              isCompleted
                ? "text-ok hover:bg-[var(--status-ok-soft)]"
                : isSkipped
                  ? "text-ink hover:bg-surface-2"
                  : "text-brand-ink hover:bg-[var(--status-info-soft)]"
            }`}
            onClick={handleRowAction}
            aria-label={`${rowActionLabel} ${customer.full_name}`}
          >
            {rowActionLabel}
          </Button>
        </div>

        <div className="ml-10 flex h-5 items-center gap-2 overflow-hidden whitespace-nowrap" aria-label="Quick chemical view">
          {chemicalReadings.length > 0 ? (
            chemicalReadings.slice(0, 4).map((reading, index) => (
              <span
                key={reading.key}
                className={`inline-flex shrink-0 items-baseline gap-1 text-[0.6875rem] ${index > 0 ? "border-l border-line pl-2" : ""}`}
              >
                <span className="font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {reading.label}
                </span>
                <span className={`font-data font-bold capitalize ${reading.textToneClassName}`}>
                  {reading.value}
                </span>
              </span>
            ))
          ) : (
            <span className="text-[0.6875rem] font-medium text-ink-muted">
              No recent chemistry
            </span>
          )}
          {customer.gate_code && (
            <span className="inline-flex shrink-0 items-center gap-1 border-l border-line pl-2 text-[0.6875rem] font-semibold text-watch">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Gate {customer.gate_code}
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div id={detailsId} className="border-t border-line bg-surface-2 px-3 py-3">
          <div className="space-y-2">
            {isCompleted && serviceConfidence && (
              <div className="flex items-center gap-2 text-info">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="text-xs font-semibold">
                  Service confidence: {serviceConfidence.label}
                </span>
              </div>
            )}

            {customer.phone && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Phone className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.address && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="truncate text-xs">{customer.address}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Mail className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="truncate text-xs">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 text-watch">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span className="text-xs font-semibold">Gate: {customer.gate_code}</span>
              </div>
            )}
          </div>

          {lastWeekLog ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-info" aria-hidden="true" />
                <span className="text-xs font-bold text-ink">Last week's service</span>
                <span className="text-xs text-ink-muted">
                  {formatServiceDate(lastWeekLog.service_date)}
                </span>
              </div>

              {chemicalReadings.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Last week's chemistry">
                  {chemicalReadings.map((reading, index) => (
                    <span
                      key={reading.key}
                      className={`inline-flex items-baseline gap-1 text-xs ${index > 0 ? "border-l border-line pl-2" : ""}`}
                    >
                      <span className="font-semibold text-ink-muted">{reading.label}</span>
                      <span className={`font-data font-bold capitalize ${reading.textToneClassName}`}>
                        {reading.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {lastWeekLog.notes && (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-secondary">
                  {lastWeekLog.notes}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
              No service log from last week
            </p>
          )}

          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-2">
            {!isCompleted && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-11 px-3 text-xs font-semibold ${isSkipped ? "text-watch" : "text-ink-secondary hover:text-watch"}`}
                onClick={() => {
                  if (isSkipped) {
                    onUnskip?.();
                  } else {
                    onSkip?.();
                  }
                }}
              >
                {skipLabel}
              </Button>
            )}

            {customer.phone && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 text-xs"
                onClick={() => onCall?.()}
              >
                <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
                Call
              </Button>
            )}

            {customer.address && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 text-xs"
                onClick={() => onMap?.()}
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Map
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
});

export default CustomerCard;
