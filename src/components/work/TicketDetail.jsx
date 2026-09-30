import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  PAID_METHODS,
  money,
  shortWhen,
  ticketStatusKey,
  timelineDotClass,
} from "./workFormat";
import { useFocusOnMount, useWorkOffline, useWorkRunner } from "./workHooks";
import {
  ActionButton,
  BackButton,
  IconButton,
  ItemsCard,
  OfflineNotice,
  PaidMethodSheet,
  SectionLabel,
  SquareGlyph,
  StatusChip,
  WorkScreen,
  WorkSheet,
} from "./workUi";

function DetailSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 px-5 pt-4" aria-hidden="true">
      <span className="h-5 w-40 animate-pulse rounded bg-surface-2" />
      <span className="h-12 w-48 animate-pulse rounded bg-surface-2" />
      <span className="h-5 w-20 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

export default function TicketDetail({ ticketId, onBack, onDeleted }) {
  const ticket = useQuery(api.tickets.get, { id: ticketId });
  const offline = useWorkOffline();
  const { pending, run } = useWorkRunner();
  const [paidOpen, setPaidOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const headingRef = useRef(null);
  useFocusOnMount(headingRef, [ticket === undefined]);

  const remind = useAction(api.tickets.remind);
  const markPaid = useAction(api.tickets.markPaid);
  const approveQuote = useAction(api.tickets.approveQuote);
  const declineQuote = useMutation(api.tickets.declineQuote);
  const deleteDraft = useMutation(api.tickets.deleteDraft);
  const sendTicket = useAction(api.tickets.send);
  const cancelTicket = useAction(api.tickets.cancel);

  if (ticket === undefined) {
    return (
      <WorkScreen label="Ticket">
        <div className="px-3 pt-3">
          <BackButton onClick={onBack} />
        </div>
        <DetailSkeleton />
      </WorkScreen>
    );
  }

  if (ticket === null) {
    return (
      <WorkScreen label="Ticket">
        <div className="px-3 pt-3">
          <BackButton onClick={onBack} />
        </div>
        <div className="px-6 py-12 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-lg font-bold focus:outline-none">
            Ticket not found
          </h1>
          <p className="mt-1 text-[15px] text-ink-secondary">It may have been deleted.</p>
        </div>
      </WorkScreen>
    );
  }

  const id = ticket._id;
  const statusKey = ticketStatusKey(ticket);
  const busy = Boolean(pending);
  const disabled = offline || busy;

  const doRemind = async () => {
    const res = await run("remind", () => remind({ id }));
    if (res.ok) toast.success("Reminder sent");
  };
  const doMarkPaid = async (method) => {
    const res = await run(`paid:${method}`, () => markPaid({ id, method }));
    if (res.ok) {
      setPaidOpen(false);
      if (res.value?.warning) toast.warning(res.value.warning);
      else toast.success("Marked paid");
    }
  };
  const doDecline = async () => {
    const res = await run("decline", () => declineQuote({ id }));
    if (res.ok) toast.success("Quote marked declined");
  };
  const doApprove = async () => {
    const res = await run("approve", () => approveQuote({ id }));
    if (res.ok) {
      const no = res.value?.square_invoice_number;
      toast.success(no ? `Approved · Square invoice #${no} sent` : "Approved · payment requested");
    }
  };
  const doDelete = async () => {
    const res = await run("delete", () => deleteDraft({ id }));
    if (res.ok) {
      toast.success("Draft deleted");
      onDeleted();
    }
  };
  const doSend = async () => {
    const res = await run("send", () =>
      sendTicket({ id, customer_id: ticket.customer_id, kind: ticket.kind, note: ticket.note, items: ticket.items })
    );
    if (res.ok) toast.success(ticket.kind === "quote" ? "Quote sent" : "Request sent");
  };
  const doCancel = async () => {
    const res = await run("cancel", () => cancelTicket({ id }));
    if (res.ok) {
      setMoreOpen(false);
      toast.success("Request canceled");
    }
  };

  let actions = null;
  if (ticket.status === "requested") {
    actions = (
      <>
        <ActionButton variant="secondary" onClick={doRemind} pending={pending === "remind"} disabled={disabled}>
          Remind
        </ActionButton>
        <ActionButton onClick={() => setPaidOpen(true)} disabled={disabled}>
          Mark paid
        </ActionButton>
      </>
    );
  } else if (ticket.status === "quote") {
    actions = (
      <>
        <ActionButton variant="secondary" onClick={doDecline} pending={pending === "decline"} disabled={disabled}>
          Declined
        </ActionButton>
        <ActionButton onClick={doApprove} pending={pending === "approve"} disabled={disabled}>
          Approved · Request
        </ActionButton>
      </>
    );
  } else if (ticket.status === "draft") {
    actions = (
      <>
        <ActionButton variant="secondary" onClick={doDelete} pending={pending === "delete"} disabled={disabled}>
          Delete
        </ActionButton>
        <ActionButton onClick={doSend} pending={pending === "send"} disabled={disabled}>
          {ticket.kind === "quote" ? "Send quote" : "Send request"}
        </ActionButton>
      </>
    );
  } else if (ticket.status === "paid" && ticket.square_invoice_url) {
    actions = (
      <a
        href={ticket.square_invoice_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-[54px] flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-ink bg-surface-1 text-base font-bold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
      >
        View in Square
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    );
  }

  const items = ticket.items || [];
  const photos = ticket.photo_urls || [];
  const timeline = ticket.timeline || [];

  return (
    <WorkScreen label="Ticket">
      <div className="flex items-center justify-between px-3 pt-3">
        <BackButton onClick={onBack} />
        {ticket.status === "requested" && (
          <IconButton label="More actions" onClick={() => setMoreOpen(true)}>
            <MoreHorizontal className="h-6 w-6" aria-hidden="true" />
          </IconButton>
        )}
      </div>

      {offline && <OfflineNotice className="mx-4 mb-2" />}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col items-center gap-1.5 pb-[18px] pt-1 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-[17px] font-bold focus:outline-none">
            {ticket.customer_name}
          </h1>
          <p className={cn("tnum text-5xl font-extrabold tracking-[-0.04em]", ticket.status === "canceled" && "line-through")}>
            {money(ticket.total)}
          </p>
          <StatusChip statusKey={statusKey} size="md" />
          {ticket.note && <p className="text-[15px] text-ink-secondary">{ticket.note}</p>}
          {ticket.square_invoice_number && (
            <p className="mt-1 flex items-center gap-1.5 rounded-[10px] border border-line px-2.5 py-[5px] text-[13px] font-semibold text-ink-secondary">
              <SquareGlyph className="h-3.5 w-3.5 text-ink" />
              <span>
                Square invoice #{ticket.square_invoice_number}
                {ticket.schedule_id ? " · recurring" : ""}
              </span>
            </p>
          )}
        </div>

        {items.length > 1 && (
          <div className="mb-4">
            <ItemsCard
              items={items.map((i) => ({ label: i.label, amountText: money(i.amount) }))}
              total={money(ticket.total)}
            />
          </div>
        )}

        {photos.length > 0 && (
          <ul className="mb-[18px] flex flex-wrap gap-2" aria-label="Photos">
            {photos.map((url, index) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-[76px] w-[76px] overflow-hidden rounded-control bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
                >
                  <img src={url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {timeline.length > 0 && (
          <section aria-labelledby="ticket-activity">
            <SectionLabel id="ticket-activity">Activity</SectionLabel>
            <ol>
              {timeline.map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex gap-3 py-2">
                  <span className={cn("mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full", timelineDotClass(event))} aria-hidden="true" />
                  <span className="flex-1 text-[15px]">{event.text}</span>
                  <time className="text-[13px] text-ink-secondary" dateTime={Number.isFinite(event.at) ? new Date(event.at).toISOString() : undefined}>
                    {shortWhen(event.at)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {actions && <div className="flex gap-2.5 border-t border-surface-2 px-4 pb-6 pt-2.5">{actions}</div>}

      <PaidMethodSheet
        open={paidOpen}
        onOpenChange={(open) => !busy && setPaidOpen(open)}
        methods={PAID_METHODS}
        pendingMethod={pending?.startsWith("paid:") ? pending.slice(5) : null}
        onChoose={doMarkPaid}
        title={`Mark ${money(ticket.total)} paid`}
      />

      <WorkSheet open={moreOpen} onOpenChange={(open) => !busy && setMoreOpen(open)} title="More actions">
        <p className="px-1 pb-3 text-sm text-ink-secondary">
          Canceling voids the Square invoice so {ticket.customer_name} can no longer pay it.
        </p>
        <ActionButton variant="secondary" onClick={doCancel} pending={pending === "cancel"} disabled={disabled} className="flex-none basis-auto">
          Cancel request
        </ActionButton>
      </WorkSheet>
    </WorkScreen>
  );
}
