import { useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { AlertTriangle, Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  FEED_FILTERS,
  billingText,
  cadenceText,
  money,
  scheduleChip,
  shortDate,
  ticketAmountClass,
  ticketStatusKey,
} from "./workFormat";
import { useFocusOnMount, useWorkOffline } from "./workHooks";
import { OfflineNotice, PRIMARY_BG, Pill, RecurringGlyph, StatusChip } from "./workUi";

const SETTINGS_INTEGRATIONS = "/settings#integrations";

function SummaryCard({ summary }) {
  const loading = summary === undefined;
  const openCount = summary?.open_requests ?? 0;
  const recurringActive = summary?.recurring_active ?? 0;
  const recurringLine = recurringActive
    ? `${recurringActive} on recurring billing · ${money(summary.recurring_next_total)}${
        summary.recurring_next_run_at ? ` bills ${shortDate(summary.recurring_next_run_at)}` : ""
      }`
    : "No recurring billing yet";

  return (
    <section
      aria-label="Money summary"
      aria-busy={loading ? "true" : undefined}
      className="mx-4 mt-2 flex flex-col gap-1 rounded-[20px] bg-ink p-5 text-surface-1 sm:mx-5"
    >
      <p className="text-[13px] font-semibold tracking-[0.02em] text-surface-1/75">Waiting to be paid</p>
      <p className="tnum text-[40px] font-extrabold leading-tight tracking-[-0.03em]">
        {loading ? <span className="inline-block h-10 w-40 animate-pulse rounded-lg bg-surface-1/15" /> : money(summary.outstanding)}
      </p>
      <div className="flex justify-between gap-3 text-sm text-surface-1/85">
        <span>{loading ? " " : `${openCount} open request${openCount === 1 ? "" : "s"}`}</span>
        <span className="tnum">{loading ? "" : `Paid this week ${money(summary.paid_this_week)}`}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-surface-1/15 pt-2.5 text-[13px] text-surface-1/75">
        <RecurringGlyph className="h-4 w-4 shrink-0 text-cyan-300 dark:text-cyan-700" />
        <span>{loading ? " " : recurringLine}</span>
      </div>
    </section>
  );
}

function SquareBanner({ square }) {
  if (!square || (square.connected && !square.needs_reconnect)) return null;
  const text = square.needs_reconnect
    ? "Reconnect Square to enable invoices"
    : "Connect Square in Settings to send invoices";
  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2 text-sm font-semibold text-watch sm:mx-5"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      <Link
        to={SETTINGS_INTEGRATIONS}
        className="inline-flex min-h-11 items-center rounded-lg px-2 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
      >
        {square.needs_reconnect ? "Reconnect" : "Connect"}
      </Link>
    </div>
  );
}

function TicketRow({ ticket, onOpen }) {
  const statusKey = ticketStatusKey(ticket);
  const note = ticket.note || ticket.items?.[0]?.label || "";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(ticket._id)}
        className="flex w-full items-center gap-3 border-b border-line px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0E7490]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-bold text-ink">{ticket.customer_name}</span>
          {note && <span className="truncate text-sm text-ink-secondary">{note}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("tnum text-base font-bold", ticketAmountClass(ticket))}>{money(ticket.total)}</span>
          <StatusChip statusKey={statusKey} />
        </span>
      </button>
    </li>
  );
}

function ScheduleRow({ schedule, onOpen }) {
  const chip = scheduleChip(schedule);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(schedule._id)}
        className="flex w-full items-center gap-3 border-b border-line px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0E7490]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-bold text-ink">{schedule.customer_name}</span>
          <span className="truncate text-sm text-ink-secondary">
            {cadenceText(schedule.cadence)} · {billingText(schedule)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="tnum text-base font-bold text-ink">{money(schedule.preview?.total ?? schedule.rate)}</span>
          <StatusChip label={chip.label} className={chip.className} />
        </span>
      </button>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3 border-b border-line px-2 py-3">
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-4 w-36 animate-pulse rounded bg-surface-2" />
            <span className="h-3.5 w-48 animate-pulse rounded bg-surface-2" />
          </span>
          <span className="h-4 w-16 animate-pulse rounded bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

const EMPTY_COPY = {
  all: "Nothing here yet. Tap New to charge a customer or send a quote.",
  open: "No open requests.",
  quote: "No quotes waiting on customers.",
  paid: "Nothing paid yet.",
  recurring: "No recurring billing yet. Tap New, then choose Weekly or Monthly.",
};

export default function WorkFeed({ filter, onFilterChange, onNew, onOpenTicket, onOpenSchedule }) {
  const headingRef = useRef(null);
  useFocusOnMount(headingRef);
  const offline = useWorkOffline();
  const showSchedules = filter === "recurring";

  const summary = useQuery(api.tickets.summary, {});
  const tickets = useQuery(api.tickets.list, showSchedules ? "skip" : { filter });
  const schedules = useQuery(api.billingSchedules.list, showSchedules ? {} : "skip");

  const rows = showSchedules ? schedules : tickets;
  const loading = rows === undefined;

  return (
    <div className="relative mx-auto max-w-3xl pb-40 font-sans">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <h1
          id="work-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-[30px] font-extrabold tracking-[-0.02em] text-ink focus:outline-none"
        >
          Work
        </h1>
      </div>

      <SummaryCard summary={summary} />
      <SquareBanner square={summary?.square} />
      {offline && <OfflineNotice className="mx-4 mt-3 sm:mx-5" />}

      <div
        role="group"
        aria-label="Filter work"
        className="flex gap-2 overflow-x-auto px-4 pb-2 pt-4 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        {FEED_FILTERS.map((f) => (
          <Pill key={f.id} selected={filter === f.id} onClick={() => onFilterChange(f.id)}>
            {f.label}
          </Pill>
        ))}
      </div>

      <div className="px-3 pt-1" aria-live="polite" aria-busy={loading ? "true" : undefined}>
        {loading ? (
          <RowsSkeleton />
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-[15px] text-ink-secondary">{EMPTY_COPY[filter] || EMPTY_COPY.all}</p>
        ) : showSchedules ? (
          <ul aria-label="Recurring billing">
            {rows.map((s) => (
              <ScheduleRow key={s._id} schedule={s} onOpen={onOpenSchedule} />
            ))}
          </ul>
        ) : (
          <ul aria-label="Tickets">
            {rows.map((t) => (
              <TicketRow key={t._id} ticket={t} onOpen={onOpenTicket} />
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onNew}
        className={cn(
          "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-5 z-40 flex h-14 items-center gap-2 rounded-full pl-[18px] pr-[22px] text-[17px] font-bold shadow-[0_8px_24px_rgba(14,116,144,0.35)] lg:bottom-8",
          PRIMARY_BG,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] focus-visible:ring-offset-2"
        )}
      >
        <Plus className="h-[22px] w-[22px]" strokeWidth={2.5} aria-hidden="true" />
        New
      </button>
    </div>
  );
}
