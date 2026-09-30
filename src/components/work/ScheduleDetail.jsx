import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  billingText,
  cadenceText,
  money,
  parseAmount,
  scheduleChip,
  shortDate,
  STATUS_META,
} from "./workFormat";
import { useFocusOnMount, useWorkOffline, useWorkRunner } from "./workHooks";
import {
  ActionButton,
  BackButton,
  IconButton,
  OfflineNotice,
  Pill,
  SectionLabel,
  SquareGlyph,
  StatusChip,
  WorkScreen,
  WorkSheet,
} from "./workUi";

function historyChip(status) {
  const key = STATUS_META[status] ? status : "draft";
  return key;
}

function squareNote(schedule) {
  const card = schedule.autopay && schedule.card_label ? schedule.card_label : null;
  if (schedule.bill_mode === "visits") {
    return `${schedule.cadence === "weekly" ? "Each Monday" : "On the 1st"}, ChemCheck counts the visits you logged and any extra chemicals, then creates the invoice in your Square account${card ? ` and charges ${card}.` : "."}`;
  }
  return `ChemCheck creates each invoice in your Square account${card ? ` and charges ${card} on the due date.` : "; Square sends it with a pay link."}`;
}

function EditScheduleSheet({ open, onOpenChange, schedule, onSave, saving }) {
  const [rate, setRate] = useState(String(schedule.rate ?? ""));
  const [cadence, setCadence] = useState(schedule.cadence);
  const [billMode, setBillMode] = useState(schedule.bill_mode);
  const [autopay, setAutopay] = useState(Boolean(schedule.autopay));
  const [note, setNote] = useState(schedule.note || "");
  const [error, setError] = useState("");

  const save = () => {
    const value = parseAmount(rate);
    if (!value || value < 0) {
      setError("Enter a rate greater than $0.");
      return;
    }
    const fields = { cadence, bill_mode: billMode, rate: value, note: note.trim(), autopay };
    if (billMode === "visits") {
      fields.items = [];
    } else if (value !== schedule.rate || schedule.bill_mode !== "fixed" || !schedule.items?.length) {
      fields.items = [{ label: note.trim() || "Pool service", amount: value }];
    }
    onSave(fields);
  };

  return (
    <WorkSheet open={open} onOpenChange={onOpenChange} title="Edit recurring billing">
      <div className="flex flex-col gap-3 overflow-y-auto px-1 pb-1">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-ink-secondary">{billMode === "visits" ? "Rate per visit ($)" : "Amount each period ($)"}</span>
          <input
            inputMode="decimal"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value.replace(/[^\d.]/g, ""));
              setError("");
            }}
            className="tnum h-11 rounded-control border border-line bg-surface-1 px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
          />
        </label>
        <div role="group" aria-label="Repeat" className="flex flex-wrap gap-1.5">
          <Pill selected={cadence === "weekly"} onClick={() => setCadence("weekly")}>Weekly</Pill>
          <Pill selected={cadence === "monthly"} onClick={() => setCadence("monthly")}>Monthly</Pill>
        </div>
        <div role="group" aria-label="Bill" className="flex flex-wrap gap-1.5">
          <Pill selected={billMode === "fixed"} onClick={() => setBillMode("fixed")}>Fixed amount</Pill>
          <Pill selected={billMode === "visits"} onClick={() => setBillMode("visits")}>Per visit + chemicals</Pill>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-ink-secondary">For</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="h-11 rounded-control border border-line bg-surface-1 px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
          />
        </label>
        <button
          type="button"
          aria-pressed={autopay ? "true" : "false"}
          onClick={() => setAutopay((v) => !v)}
          className="flex min-h-11 items-center justify-between rounded-control px-1 text-left text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
        >
          Autopay
          <span
            aria-hidden="true"
            className={cn(
              "flex h-7 w-12 items-center rounded-full p-[3px]",
              autopay ? "justify-end bg-[#0E7490]" : "justify-start bg-stone-300 dark:bg-stone-600"
            )}
          >
            <span className="h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />
          </span>
        </button>
        {error && (
          <p role="alert" className="text-sm font-semibold text-critical">
            {error}
          </p>
        )}
        <ActionButton onClick={save} pending={saving} className="flex-none basis-auto">
          Save changes
        </ActionButton>
      </div>
    </WorkSheet>
  );
}

export default function ScheduleDetail({ scheduleId, onBack, onOpenTicket, onBilled, onRemoved }) {
  const schedule = useQuery(api.billingSchedules.get, { id: scheduleId });
  const offline = useWorkOffline();
  const { pending, run } = useWorkRunner();
  const [moreOpen, setMoreOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const headingRef = useRef(null);
  useFocusOnMount(headingRef, [schedule === undefined]);

  const setPaused = useMutation(api.billingSchedules.setPaused);
  const billNow = useAction(api.billingSchedules.billNow);
  const updateSchedule = useMutation(api.billingSchedules.update);
  const removeSchedule = useMutation(api.billingSchedules.remove);

  if (schedule === undefined || schedule === null) {
    return (
      <WorkScreen label="Recurring billing">
        <div className="px-3 pt-3">
          <BackButton onClick={onBack} />
        </div>
        {schedule === null ? (
          <div className="px-6 py-12 text-center">
            <h1 ref={headingRef} tabIndex={-1} className="text-lg font-bold focus:outline-none">
              Recurring billing not found
            </h1>
            <p className="mt-1 text-[15px] text-ink-secondary">It may have been removed.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-5 pt-4" aria-hidden="true">
            <span className="h-5 w-40 animate-pulse rounded bg-surface-2" />
            <span className="h-5 w-56 animate-pulse rounded bg-surface-2" />
          </div>
        )}
      </WorkScreen>
    );
  }

  const id = schedule._id;
  const chip = scheduleChip(schedule);
  const preview = schedule.preview || { period_label: "", items: [], total: 0, unpriced_chemicals: [] };
  const history = schedule.history || [];
  const busy = Boolean(pending);
  const disabled = offline || busy;

  const togglePause = async () => {
    const next = !schedule.paused;
    const res = await run("pause", () => setPaused({ id, paused: next }));
    if (res.ok) toast.success(next ? "Recurring billing paused" : "Recurring billing resumed");
  };

  const doBillNow = async () => {
    const res = await run("bill", () => billNow({ id }));
    if (!res.ok) return;
    const result = res.value || {};
    const paid = result.status === "paid";
    const no = result.square_invoice_number;
    onBilled({
      title: paid ? "Billed and paid" : "Invoice sent",
      amountText: money(preview.total),
      detail: paid
        ? `${no ? `Square invoice #${no} ` : "The invoice "}was charged to ${schedule.card_label || "the card on file"}.`
        : `${no ? `Square invoice #${no}` : "The invoice"} was sent to ${schedule.customer_name} with a pay link.`,
      ticketId: result.ticket_id,
    });
  };

  const saveEdit = async (fields) => {
    const res = await run("edit", () => updateSchedule({ id, ...fields }));
    if (res.ok) {
      setEditOpen(false);
      toast.success("Recurring billing updated");
    }
  };

  const doRemove = async () => {
    const res = await run("remove", () => removeSchedule({ id }));
    if (res.ok) {
      setConfirmRemove(false);
      toast.success("Recurring billing removed");
      onRemoved();
    }
  };

  return (
    <WorkScreen label="Recurring billing">
      <div className="flex items-center justify-between px-3 pt-3">
        <BackButton onClick={onBack} />
        <IconButton label="More actions" onClick={() => setMoreOpen(true)}>
          <MoreHorizontal className="h-6 w-6" aria-hidden="true" />
        </IconButton>
      </div>

      {offline && <OfflineNotice className="mx-4 mb-2" />}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col items-center gap-1.5 pb-[18px] pt-1 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-[17px] font-bold focus:outline-none">
            {schedule.customer_name}
          </h1>
          <p className="text-[15px] text-ink-secondary">
            {cadenceText(schedule.cadence)} · {billingText(schedule)}
          </p>
          <StatusChip label={chip.label} className={chip.className} size="md" />
        </div>

        {schedule.last_error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-control border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] p-3 text-sm leading-snug text-red-800 dark:text-red-200"
          >
            <AlertTriangle className="mt-px h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-bold">Last invoice failed.</strong> {schedule.last_error}
            </span>
          </div>
        )}

        <div className="mb-[18px] overflow-hidden rounded-[14px] border border-line">
          <div className="flex items-baseline justify-between gap-3 bg-surface-2 px-3.5 py-3">
            <span className="text-[15px] font-extrabold">{schedule.paused ? "Paused" : preview.period_label || "Next invoice"}</span>
            <span className="text-right text-[13px] text-ink-secondary">
              {schedule.paused
                ? "No invoices will be created"
                : schedule.next_run_at
                  ? `Creates ${shortDate(schedule.next_run_at)}`
                  : ""}
            </span>
          </div>
          <ul>
            {(preview.items || []).map((item, index) => (
              <li key={`${item.label}-${index}`} className="flex justify-between gap-3 border-t border-surface-2 px-3.5 py-3 text-[15px]">
                <span>{item.label}</span>
                <span className="tnum font-semibold">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-line px-3.5 py-3 text-base font-extrabold">
            <span>Estimated total</span>
            <span className="tnum">{money(preview.total)}</span>
          </div>
        </div>

        {preview.unpriced_chemicals?.length > 0 && (
          <div className="mb-[18px] flex items-start gap-2.5 rounded-control border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] p-3 text-sm leading-snug text-watch">
            <AlertTriangle className="mt-px h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            <span>
              No price set for {preview.unpriced_chemicals.join(", ")}, so they bill at $0.{" "}
              <Link to="/settings#integrations" className="font-semibold underline underline-offset-2">
                Set chemical prices
              </Link>
            </span>
          </div>
        )}

        <div className="mb-[18px] flex items-start gap-2.5 rounded-control bg-cyan-50 p-3 text-sm leading-snug text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100">
          <SquareGlyph className="mt-px h-[18px] w-[18px] shrink-0 text-[#0E7490] dark:text-cyan-300" />
          <span>{squareNote(schedule)}</span>
        </div>

        <section aria-labelledby="schedule-history">
          <SectionLabel id="schedule-history">Past invoices</SectionLabel>
          {history.length === 0 ? (
            <p className="py-2 text-[15px] text-ink-secondary">No invoices yet.</p>
          ) : (
            <ul>
              {history.map((h) => (
                <li key={h.ticket_id}>
                  <button
                    type="button"
                    onClick={() => onOpenTicket(h.ticket_id)}
                    className="flex w-full items-center gap-3 border-b border-surface-2 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0E7490]"
                  >
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{h.period_label}</span>
                      {h.square_invoice_number && (
                        <span className="text-[13px] text-ink-secondary">Invoice #{h.square_invoice_number}</span>
                      )}
                    </span>
                    <span className="tnum text-[15px] font-bold">{money(h.total)}</span>
                    <StatusChip statusKey={historyChip(h.status)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex gap-2.5 border-t border-surface-2 px-4 pb-6 pt-2.5">
        <ActionButton variant="secondary" onClick={togglePause} pending={pending === "pause"} disabled={disabled}>
          {schedule.paused ? "Resume" : "Pause"}
        </ActionButton>
        <ActionButton onClick={doBillNow} pending={pending === "bill"} disabled={disabled}>
          Bill now
        </ActionButton>
      </div>

      <WorkSheet open={moreOpen} onOpenChange={setMoreOpen} title="Recurring billing">
        <div className="flex flex-col gap-2">
          <ActionButton
            variant="secondary"
            className="flex-none basis-auto"
            disabled={disabled}
            onClick={() => {
              setMoreOpen(false);
              setEditOpen(true);
            }}
          >
            Edit
          </ActionButton>
          <ActionButton
            variant="secondary"
            className="flex-none basis-auto"
            disabled={disabled}
            onClick={() => {
              setMoreOpen(false);
              setConfirmRemove(true);
            }}
          >
            Remove
          </ActionButton>
        </div>
      </WorkSheet>

      {editOpen && (
        <EditScheduleSheet
          open={editOpen}
          onOpenChange={(open) => !busy && setEditOpen(open)}
          schedule={schedule}
          onSave={saveEdit}
          saving={pending === "edit"}
        />
      )}

      <WorkSheet
        open={confirmRemove}
        onOpenChange={(open) => !busy && setConfirmRemove(open)}
        title="Remove recurring billing?"
        description={`No more invoices will be created for ${schedule.customer_name}. Past invoices stay in Work.`}
      >
        <div className="flex gap-2.5 pt-2">
          <ActionButton variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>
            Keep
          </ActionButton>
          <ActionButton onClick={doRemove} pending={pending === "remove"} disabled={disabled} className="bg-red-700 hover:bg-red-800">
            Remove
          </ActionButton>
        </div>
      </WorkSheet>
    </WorkScreen>
  );
}
