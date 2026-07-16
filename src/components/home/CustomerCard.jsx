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
import { PoolIcon } from "@/components/ui/iconography";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, serviceStateTone } from "@/components/ui/status-badge";
import { chemToneClasses } from "@/lib/chemStatus";
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
        // Tone comes from the shared chemistry model: status words map
        // directly, numeric readings map through the configured ranges.
        toneClassName: chemToneClasses(key, value),
      };
    })
    .filter(Boolean);
}

const cardStateClassName = {
  done: "border-[var(--status-ok-line)] bg-[var(--status-ok-soft)]",
  skipped: "border-[var(--status-watch-line)] bg-[var(--status-watch-soft)]",
  pending: "border-line bg-surface-1 hover:border-[var(--status-info-line)] active:border-[var(--status-info-line)]",
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
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardState = isCompleted ? "done" : isSkipped ? "skipped" : "pending";
  const statusLabel = cardState === "done" ? "Done" : cardState === "skipped" ? "Skipped" : "Pending";
  const startLabel = isSkipped ? "Resume" : "Start";
  const skipLabel = isSkipped ? "Move back" : "Skip";
  const chemicalReadings = getChemicalReadings(lastWeekLog);

  const handleHeaderClick = () => {
    if (isCompleted) {
      setIsExpanded(!isExpanded);
    } else {
      onStart?.();
    }
  };

  const handleChevronClick = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <Card className={`overflow-hidden transition-colors duration-150 border-2 ${cardStateClassName[cardState]}`}>
      <div
        onClick={handleHeaderClick}
        className="p-3 cursor-pointer flex items-center justify-between active:bg-surface-2"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-ink truncate">{customer.full_name}</h3>
            <div className="mt-1" aria-label="Quick chemical view">
              {chemicalReadings.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {chemicalReadings.slice(0, 4).map((reading) => (
                    <span
                      key={reading.key}
                      className={`inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-xs font-semibold ${reading.toneClassName}`}
                    >
                      <span>{reading.label}</span>
                      <span className="font-data capitalize">{reading.value}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-medium text-ink-muted">
                  No recent chemical readings
                </p>
              )}
            </div>
            {customer.gate_code && (
              <div className="mt-1.5 inline-flex items-center gap-1 surface-watch border rounded-chip px-1.5 py-0.5">
                <Lock className="w-3 h-3" aria-hidden="true" />
                <span className="text-xs font-semibold">Gate: {customer.gate_code}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusBadge tone={serviceStateTone(cardState)} label={statusLabel} size="sm" />
          <button
            type="button"
            onClick={handleChevronClick}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-2 active:bg-surface-2 transition-colors"
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
          >
            <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-3">
        {isCompleted ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-11 text-xs bg-surface-1 hover:bg-surface-2 text-ink-secondary border border-[var(--status-ok-line)]"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <PoolIcon name="done" className="mr-2 h-4 w-4 text-ok" />
            View Service Log
          </Button>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-1.5 rounded-control bg-surface-2 p-1">
            <Button
              size="sm"
              className={`h-11 rounded-control px-2 text-xs font-semibold shadow-sm ${
                isSkipped
                  ? "bg-ink text-surface-0 hover:bg-ink-secondary"
                  : "bg-brand text-white shadow-cta hover:bg-brand-strong"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onStart?.();
              }}
            >
              {startLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`h-11 rounded-control border px-2 text-xs font-semibold shadow-none ${
                isSkipped
                  ? "surface-watch bg-surface-1 hover:bg-[var(--status-watch-soft)]"
                  : "border-line bg-surface-1 text-ink-secondary hover:border-[var(--status-watch-line)] hover:bg-[var(--status-watch-soft)] hover:text-watch"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                if (isSkipped) {
                  onUnskip?.();
                } else {
                  onSkip?.();
                }
              }}
            >
              {skipLabel}
            </Button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-line">
          <div className="p-3 space-y-2 bg-surface-2">
            {isCompleted && serviceConfidence && (
              <div className="flex items-center gap-2 surface-info border rounded-control p-2">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="text-xs font-medium">
                  Service Confidence: {serviceConfidence.label}
                </span>
              </div>
            )}

            {customer.phone && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Phone className="w-3.5 h-3.5 text-info flex-shrink-0" aria-hidden="true" />
                <span className="text-xs">{customer.phone}</span>
              </div>
            )}

            {customer.address && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <MapPin className="w-3.5 h-3.5 text-info flex-shrink-0" aria-hidden="true" />
                <span className="text-xs truncate">{customer.address}</span>
              </div>
            )}

            {customer.email && (
              <div className="flex items-center gap-2 text-ink-secondary">
                <Mail className="w-3.5 h-3.5 text-info flex-shrink-0" aria-hidden="true" />
                <span className="text-xs truncate">{customer.email}</span>
              </div>
            )}

            {customer.gate_code && (
              <div className="flex items-center gap-2 surface-watch border rounded-control p-2">
                <Lock className="w-3 h-3" aria-hidden="true" />
                <span className="text-xs font-semibold">Gate: {customer.gate_code}</span>
              </div>
            )}

            {lastWeekLog ? (
              <div className="bg-[var(--status-info-soft)] border border-[var(--status-info-line)] rounded-control p-2.5 mt-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-info" aria-hidden="true" />
                  <span className="text-xs font-bold text-ink">Last Week's Service</span>
                  <span className="text-xs text-ink-secondary">
                    ({formatServiceDate(lastWeekLog.service_date)})
                  </span>
                </div>

                {chemicalReadings.length > 0 && (
                  <div className="flex gap-1.5 mb-1.5 flex-wrap">
                    {chemicalReadings.map((reading) => (
                      <span
                        key={reading.key}
                        className={`text-xs px-1.5 py-0.5 rounded-chip border font-medium ${reading.toneClassName}`}
                      >
                        {reading.label}: <span className="font-data capitalize">{reading.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {lastWeekLog.notes && (
                  <p className="text-xs text-ink-secondary leading-relaxed whitespace-pre-wrap bg-surface-1 p-1.5 rounded-chip">
                    {lastWeekLog.notes}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-surface-2 border border-line rounded-control p-2.5 mt-2 text-center">
                <span className="text-xs text-ink-muted">No service log from last week</span>
              </div>
            )}

            {(customer.phone || customer.address) && (
              <div className={`grid gap-2 pt-2 ${customer.phone && customer.address ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {customer.phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCall?.();
                    }}
                  >
                    <PhoneCall className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                    Call
                  </Button>
                )}

                {customer.address && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMap?.();
                    }}
                  >
                    <MapPin className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                    Map
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
});

export default CustomerCard;
