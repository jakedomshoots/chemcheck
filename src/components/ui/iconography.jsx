import { forwardRef } from "react";
import {
  AlertTriangle,
  CalendarCheck2,
  ChartNoAxesCombined,
  CircleCheckBig,
  ClipboardCheck,
  Clock3,
  FileChartColumn,
  FlaskConical,
  LifeBuoy,
  MapPinned,
  MoreHorizontal,
  NotepadText,
  Play,
  Plus,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  UsersRound,
  Waves,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const poolIconMap = {
  home: Waves,
  clients: UsersRound,
  workOrders: ClipboardCheck,
  report: FileChartColumn,
  notes: NotepadText,
  chemicals: FlaskConical,
  route: MapPinned,
  poolSchool: LifeBuoy,
  settings: SlidersHorizontal,
  more: MoreHorizontal,
  close: X,
  add: Plus,
  start: Play,
  serviceDay: CalendarCheck2,
  ops: ShieldCheck,
  warning: AlertTriangle,
  done: CircleCheckBig,
  pending: Clock3,
  skipped: SkipForward,
  waterLevel: Waves,
  total: ChartNoAxesCombined,
  empty: Waves,
};

function getIconAccessibilityProps(props) {
  if (props["aria-hidden"] !== undefined || props["aria-label"] !== undefined) return props;
  return { ...props, "aria-hidden": true };
}

export const PoolIcon = forwardRef(function PoolIcon(
  { name, className, strokeWidth = 1.85, ...props },
  ref
) {
  const IconComponent = poolIconMap[name];
  if (!IconComponent) {
    throw new Error(`Unknown ChemCheck icon: ${String(name)}`);
  }

  return (
    <IconComponent
      ref={ref}
      className={cn("shrink-0", className)}
      strokeWidth={strokeWidth}
      {...getIconAccessibilityProps(props)}
    />
  );
});

const badgeSizes = {
  sm: "h-8 w-8 rounded-xl",
  md: "h-10 w-10 rounded-2xl",
  lg: "h-12 w-12 rounded-2xl",
};

const badgeTones = {
  cyan: "bg-cyan-100 text-cyan-800 shadow-inner shadow-cyan-900/10",
  slate: "bg-slate-200 text-slate-700 shadow-inner shadow-slate-900/10",
  amber: "bg-amber-100 text-amber-800 shadow-inner shadow-amber-900/10",
};

export const IconBadge = forwardRef(function IconBadge(
  {
    name,
    size = "md",
    tone = "cyan",
    className,
    iconClassName,
    "aria-hidden": ariaHidden,
    "aria-label": ariaLabel,
    ...props
  },
  ref
) {
  const accessibilityProps = ariaLabel
    ? { "aria-label": ariaLabel, ...(ariaHidden !== undefined ? { "aria-hidden": ariaHidden } : {}) }
    : { "aria-hidden": ariaHidden ?? true };

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        badgeSizes[size] || badgeSizes.md,
        badgeTones[tone] || badgeTones.cyan,
        className
      )}
      {...accessibilityProps}
      {...props}
    >
      <PoolIcon name={name} strokeWidth={2.15} className={cn("h-5 w-5", iconClassName)} />
    </span>
  );
});

export const poolIconNames = Object.freeze(Object.keys(poolIconMap));
