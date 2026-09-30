import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, Loader2, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META } from "./workFormat";

/**
 * Primary action color. The prototype's #0E7490 (5.4:1 with white text) is used
 * instead of --brand because brand cyan does not reach 4.5:1 behind white text.
 */
export const PRIMARY_BG = "bg-[#0E7490] hover:bg-[#155E75] text-white";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1";

export function StatusChip({ statusKey, label, className, size = "sm" }) {
  const meta = STATUS_META[statusKey] || STATUS_META.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-[10px] font-bold",
        size === "md" ? "px-2.5 py-1 text-[13px]" : "px-2 py-[3px] text-xs",
        className || meta.className
      )}
    >
      {label || meta.label}
    </span>
  );
}

/** Rounded choice pill (filters, repeat, bill mode). Always a toggle button. */
export function Pill({ selected, children, className, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={selected ? "true" : "false"}
      className={cn(
        "inline-flex h-11 shrink-0 items-center justify-center rounded-full border px-3 text-sm font-semibold transition-colors",
        focusRing,
        selected
          ? "border-ink bg-ink text-surface-1"
          : "border-line bg-surface-1 text-ink hover:bg-surface-2",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export const ActionButton = forwardRef(function ActionButton(
  { variant = "primary", pending = false, children, className, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || pending}
      aria-busy={pending ? "true" : undefined}
      className={cn(
        "inline-flex h-[54px] min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-full px-4 text-base font-bold transition-colors",
        focusRing,
        "disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && PRIMARY_BG,
        variant === "secondary" && "border-[1.5px] border-ink bg-surface-1 text-ink hover:bg-surface-2",
        variant === "light" && "bg-white text-[#0E7490] hover:bg-white/90",
        className
      )}
      {...props}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </button>
  );
});

export const IconButton = forwardRef(function IconButton({ label, children, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-2",
        focusRing,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function BackButton({ onClick, label = "Back" }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <ChevronLeft className="h-6 w-6" aria-hidden="true" />
    </IconButton>
  );
}

export function CloseButton({ onClick, label = "Close" }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <X className="h-6 w-6" aria-hidden="true" />
    </IconButton>
  );
}

export function OfflineNotice({ className }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2.5 text-sm font-semibold text-watch",
        className
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>You're offline — tickets need a connection</span>
    </div>
  );
}

/** Full-screen surface used for the new-ticket, sent and detail screens. */
export function WorkScreen({ children, className, label, tone = "plain" }) {
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        "fixed inset-0 z-[60] flex flex-col safe-area-top safe-area-bottom",
        tone === "brand" ? "bg-[#0E7490] text-white" : "bg-surface-1 text-ink",
        className
      )}
    >
      <div className="mx-auto flex h-full w-full max-w-lg flex-col">{children}</div>
    </div>
  );
}

export function SquareGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

export function RecurringGlyph({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5" />
    </svg>
  );
}

export function ItemsCard({ items, totalLabel = "Total", total, onRemove, footer }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-line">
      <ul>
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className="flex items-center gap-2 border-b border-surface-2 py-2.5 pl-3.5 pr-2 text-[15px] last:border-b-0"
          >
            <span className="min-w-0 flex-1 break-words">{item.label}</span>
            <span className="tnum font-semibold">{item.amountText}</span>
            {onRemove ? (
              <IconButton label={`Remove ${item.label}`} onClick={() => onRemove(index)} className="h-11 w-11 text-ink-muted">
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            ) : (
              <span className="w-1.5" aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t border-line bg-surface-2 px-3.5 py-2.5 text-[15px] font-extrabold">
        <span>{totalLabel}</span>
        <span className="tnum">{total}</span>
      </div>
      {footer}
    </div>
  );
}

export function SectionLabel({ children, id }) {
  return (
    <h2 id={id} className="pb-1.5 text-[13px] font-extrabold uppercase tracking-[0.04em] text-ink-secondary">
      {children}
    </h2>
  );
}

/**
 * Bottom sheet (Radix Dialog) that stacks above the full-screen work screens.
 * Radix handles focus trapping, Escape and returning focus to the trigger.
 */
export function WorkSheet({ open, onOpenChange, title, description, children, className }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[rgba(17,20,24,0.45)]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-sheet bg-surface-1 px-4 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2 text-ink shadow-raised focus:outline-none",
            className
          )}
        >
          <div className="mx-auto mb-3 mt-1 h-[5px] w-10 shrink-0 rounded-full bg-line" aria-hidden="true" />
          <div className="flex items-start justify-between gap-2 px-1 pb-2">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-extrabold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={description ? "mt-0.5 text-sm text-ink-secondary" : "sr-only"}>
                {description || title}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" className="-mr-2 -mt-1">
                <X className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Cash / check / other chooser used by "Paid in person" and "Mark paid". */
export function PaidMethodSheet({ open, onOpenChange, onChoose, pendingMethod, methods, title = "How were you paid?" }) {
  return (
    <WorkSheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="grid grid-cols-3 gap-2 pt-1">
        {methods.map((m) => (
          <ActionButton
            key={m.id}
            variant="secondary"
            pending={pendingMethod === m.id}
            disabled={Boolean(pendingMethod)}
            onClick={() => onChoose(m.id)}
            className="basis-auto"
          >
            {m.label}
          </ActionButton>
        ))}
      </div>
    </WorkSheet>
  );
}
