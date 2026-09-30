import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Camera, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import CustomerPicker, { customerCloudId } from "./CustomerPicker";
import Keypad from "./Keypad";
import {
  PAID_METHODS,
  deliveredViaText,
  money,
  parseAmount,
  pressKey,
  readableError,
  roundCents,
  sumItems,
} from "./workFormat";
import { useFocusOnMount, useWorkOffline, useWorkRunner } from "./workHooks";
import { MAX_TICKET_PHOTOS, prepareTicketPhoto, uploadTicketPhoto } from "./workPhotos";
import {
  ActionButton,
  CloseButton,
  ItemsCard,
  OfflineNotice,
  PaidMethodSheet,
  Pill,
  RecurringGlyph,
  WorkScreen,
} from "./workUi";

const KINDS = [
  { id: "charge", label: "Charge" },
  { id: "quote", label: "Quote" },
];
const REPEATS = [
  { id: "once", label: "Once" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];
const BILL_MODES = [
  { id: "fixed", label: "Fixed amount" },
  { id: "visits", label: "Per visit + chemicals" },
];

function emptyDraft() {
  return {
    kind: "charge",
    amount: "",
    note: "",
    customer: null,
    items: [],
    repeat: "once",
    billMode: "fixed",
    autopay: true,
  };
}

/** Line items that will be billed: added lines plus the amount still on the keypad. */
export function buildTicketPayload(draft) {
  const typed = parseAmount(draft.amount);
  const noteText = draft.note.trim();
  const items = draft.items.map((i) => ({ label: i.label, amount: roundCents(i.amount) }));
  if (typed) items.push({ label: noteText || "Service", amount: typed });
  let note = noteText || (items[0] ? items[0].label : "Service");
  if (items.length > 1) note = items.slice(0, 2).map((i) => i.label).join(" + ");
  const total = draft.items.length ? roundCents(sumItems(draft.items) + typed) : typed;
  return { items, note, total, typed };
}

export function submitLabel(draft, total) {
  const repeating = draft.kind === "charge" && draft.repeat !== "once";
  if (repeating) return `Start ${draft.repeat === "weekly" ? "weekly" : "monthly"} billing`;
  const verb = draft.kind === "quote" ? "Send quote" : "Request";
  return total ? `${verb} ${money(total)}` : verb;
}

function Row({ label, children, as: Tag = "div", ...props }) {
  return (
    <Tag
      className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-line px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0E7490]"
      {...props}
    >
      <span className="w-[52px] shrink-0 text-sm font-bold text-ink-secondary">{label}</span>
      {children}
    </Tag>
  );
}

export default function NewTicket({ onClose, onDone }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [cards, setCards] = useState({});
  const fileRef = useRef(null);
  const amountRef = useRef(null);
  useFocusOnMount(amountRef);

  const offline = useWorkOffline();
  const { pending, run } = useWorkRunner();

  const sendTicket = useAction(api.tickets.send);
  const recordPaidInPerson = useAction(api.tickets.recordPaidInPerson);
  const createSchedule = useMutation(api.billingSchedules.create);
  const generateUploadUrl = useMutation(api.tickets.generatePhotoUploadUrl);
  const lookupCard = useAction(api.billingSchedules.customerCard);

  const update = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError("");
  };

  const { total, typed } = useMemo(() => buildTicketPayload(draft), [draft]);
  const repeating = draft.kind === "charge" && draft.repeat !== "once";
  const perVisit = repeating && draft.billMode === "visits";
  const customerId = customerCloudId(draft.customer);
  const cardKnown = customerId ? Object.prototype.hasOwnProperty.call(cards, customerId) : false;
  const cardLabel = customerId ? cards[customerId] || null : null;

  // Look up the customer's card on file once they choose recurring billing.
  useEffect(() => {
    if (!repeating || !customerId || cardKnown || offline) return undefined;
    let cancelled = false;
    lookupCard({ customer_id: customerId })
      .then((res) => {
        if (!cancelled) setCards((c) => ({ ...c, [customerId]: res?.card_label || null }));
      })
      .catch(() => {
        if (!cancelled) setCards((c) => ({ ...c, [customerId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [repeating, customerId, cardKnown, offline, lookupCard]);

  const press = (key) => update({ amount: pressKey(draft.amount, key) });

  // Hardware keyboard support for the keypad (desktop / iPad keyboards).
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e) => {
      if (pickerOpen || paidOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (/^\d$/.test(e.key) || e.key === ".") {
        e.preventDefault();
        pressRef.current(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pressRef.current("back");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, paidOpen]);

  const addItem = () => {
    const note = draft.note.trim();
    if (!typed || !note) {
      setError("Type an amount and what it is for, then add it as a line.");
      return;
    }
    update({ items: [...draft.items, { label: note, amount: typed }], amount: "", note: "" });
  };

  const removeItem = (index) => update({ items: draft.items.filter((_, i) => i !== index) });

  const onPhotoPicked = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const room = MAX_TICKET_PHOTOS - photos.length;
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPhotos((p) => [...p, { key, previewUrl: "", storageId: null, uploading: true }]);
      try {
        const { blob, previewUrl } = await prepareTicketPhoto(file);
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, previewUrl } : x)));
        const uploadUrl = await generateUploadUrl({});
        const storageId = await uploadTicketPhoto(blob, uploadUrl);
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, storageId, uploading: false } : x)));
      } catch (err) {
        setPhotos((p) => p.filter((x) => x.key !== key));
        setError(readableError(err, "Photo upload failed. Try again."));
      }
    }
  };

  const validate = () => {
    if (!draft.customer || !customerId) {
      setError("Choose who this is for.");
      setPickerOpen(true);
      return false;
    }
    if (!total) {
      setError("Enter an amount.");
      return false;
    }
    if (photos.some((p) => p.uploading)) {
      setError("Wait for photos to finish uploading.");
      return false;
    }
    return true;
  };

  const photoIds = photos.filter((p) => p.storageId).map((p) => p.storageId);
  const withPhotos = (args) => (photoIds.length ? { ...args, photo_storage_ids: photoIds } : args);
  const name = draft.customer?.full_name || "Your customer";

  const submit = async () => {
    if (offline || !validate()) return;
    const payload = buildTicketPayload(draft);

    if (repeating) {
      const rate = perVisit ? typed || payload.total : payload.total;
      const cadenceWord = draft.repeat === "weekly" ? "weekly" : "monthly";
      const note =
        draft.note.trim() || payload.items[0]?.label || (cadenceWord === "weekly" ? "Weekly pool service" : "Monthly pool service");
      const args = {
        customer_id: customerId,
        cadence: draft.repeat,
        bill_mode: draft.billMode,
        rate,
        items: perVisit ? [] : payload.items,
        note: perVisit ? note : payload.note,
        autopay: draft.autopay,
      };
      const res = await run("submit", () => createSchedule(args));
      if (!res.ok) return;
      const suffix = perVisit ? "/visit" : draft.repeat === "weekly" ? "/wk" : "/mo";
      onDone({
        title: "Recurring billing on",
        amountText: `${money(rate)}${suffix}`,
        detail:
          `First invoice ${draft.repeat === "weekly" ? "Monday" : "on the 1st"}. ChemCheck creates it in your Square account` +
          (draft.autopay && cardLabel ? ` and charges ${cardLabel}.` : ` and Square sends it to ${name}.`),
        scheduleId: res.value,
      });
      return;
    }

    const args = withPhotos({ customer_id: customerId, kind: draft.kind, note: payload.note, items: payload.items });
    const res = await run("submit", () => sendTicket(args));
    if (!res.ok) return;
    const result = res.value || {};
    const invoiceText = result.square_invoice_number ? `Square invoice #${result.square_invoice_number} is in your Square account. ` : "";
    onDone(
      draft.kind === "quote"
        ? {
            title: "Quote sent",
            amountText: money(payload.total),
            detail: `${deliveredViaText(result.delivered_via, name)} to approve the estimate.`,
            ticketId: result.id,
          }
        : {
            title: "Request sent",
            amountText: money(payload.total),
            detail: `${invoiceText}${deliveredViaText(result.delivered_via, name)}${result.delivered_via === "link" ? "." : " with a pay link."}`,
            ticketId: result.id,
          }
    );
  };

  const openPaidInPerson = () => {
    if (offline || !validate()) return;
    setPaidOpen(true);
  };

  const recordPaid = async (method) => {
    const payload = buildTicketPayload(draft);
    const args = withPhotos({ customer_id: customerId, note: payload.note, items: payload.items, method });
    const res = await run(`paid:${method}`, () => recordPaidInPerson(args));
    if (!res.ok) return;
    setPaidOpen(false);
    onDone({
      title: "Marked paid",
      amountText: money(payload.total),
      detail: `${name} paid in person (${method}). Recorded as paid in your Square account.`,
      ticketId: res.value?.id,
    });
  };

  const typedText = draft.amount ? `$${draft.amount}` : "";
  const amountText = draft.items.length ? money(total) : typedText || "$0";
  const cadenceWord = draft.repeat === "weekly" ? "week" : "month";
  const hint = draft.items.length
    ? draft.amount
      ? `Includes ${typedText} not yet added as a line`
      : `${draft.items.length} line item${draft.items.length === 1 ? "" : "s"}`
    : draft.kind === "quote"
      ? "Estimate for approval"
      : !repeating
        ? ""
        : perVisit
          ? "per visit"
          : `every ${cadenceWord}`;

  const repeatSummary = perVisit
    ? `Each ${cadenceWord}, ChemCheck bills ${total ? money(total) : "your rate"} per visit you log, plus extra chemicals, as a Square invoice.`
    : `ChemCheck creates a ${total ? `${money(total)} ` : ""}Square invoice every ${cadenceWord}${draft.repeat === "weekly" ? " on Monday" : " on the 1st"}.`;

  const autopayHint = !customerId
    ? draft.autopay
      ? "Charges the customer's card on file when there is one"
      : "Square sends each invoice with a pay link"
    : !cardKnown
      ? "Checking for a card on file…"
      : cardLabel
        ? draft.autopay
          ? `Charge ${cardLabel} on the due date`
          : "Square sends each invoice with a pay link"
        : draft.autopay
          ? "Card saved in Square on the first payment"
          : "Square sends each invoice with a pay link";

  const busy = Boolean(pending);
  const sendDisabled = offline || busy;

  return (
    <WorkScreen label="New ticket">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <CloseButton onClick={onClose} />
        <div role="group" aria-label="Ticket type" className="flex rounded-[20px] bg-surface-2 p-[3px]">
          {KINDS.map((k) => {
            const on = draft.kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={on ? "true" : "false"}
                onClick={() => update({ kind: k.id })}
                className={cn(
                  "h-11 rounded-full px-[18px] text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]",
                  on ? "bg-surface-1 text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-secondary"
                )}
              >
                {k.label}
              </button>
            );
          })}
        </div>
        <div className="w-11" aria-hidden="true" />
      </div>

      {offline && <OfflineNotice className="mx-4 mb-1" />}

      {error && (
        <div
          role="alert"
          className="mx-4 mb-1 rounded-control bg-ink px-3.5 py-3 text-sm font-semibold text-surface-1"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="pb-1.5 pt-3.5 text-center">
          <h1 className="sr-only">New {draft.kind === "quote" ? "quote" : "charge"}</h1>
          <p
            ref={amountRef}
            tabIndex={-1}
            aria-live="polite"
            className={cn(
              "tnum text-[60px] font-extrabold leading-tight tracking-[-0.04em] focus:outline-none",
              total ? "text-ink" : "text-ink-muted"
            )}
          >
            <span className="sr-only">Amount </span>
            <span data-testid="ticket-amount">{amountText}</span>
          </p>
          <p className="min-h-[18px] text-sm text-ink-secondary">{hint}</p>
        </div>

        <Row
          as="button"
          type="button"
          label="To"
          onClick={() => setPickerOpen(true)}
          aria-label={`To: ${draft.customer ? name : "Choose customer"}`}
        >
          <span className={cn("flex-1 text-left text-base font-semibold", draft.customer ? "text-ink" : "text-[#0E7490] dark:text-cyan-300")}>
            {draft.customer ? name : "Choose customer"}
          </span>
          <ChevronRight className="h-[18px] w-[18px] text-ink-muted" aria-hidden="true" />
        </Row>

        <Row as="label" label="For">
          <input
            value={draft.note}
            onChange={(e) => update({ note: e.target.value })}
            placeholder="Filter clean, pump seal, green-to-clean…"
            maxLength={200}
            className="h-11 min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
          />
        </Row>

        {draft.kind === "charge" && (
          <Row label="Repeat">
            <div role="group" aria-label="Repeat" className="flex flex-wrap gap-1.5 py-1">
              {REPEATS.map((r) => (
                <Pill key={r.id} selected={draft.repeat === r.id} onClick={() => update({ repeat: r.id })}>
                  {r.label}
                </Pill>
              ))}
            </div>
          </Row>
        )}

        {repeating && (
          <>
            <Row label="Bill">
              <div role="group" aria-label="Bill" className="flex flex-wrap gap-1.5 py-1">
                {BILL_MODES.map((b) => (
                  <Pill key={b.id} selected={draft.billMode === b.id} onClick={() => update({ billMode: b.id })}>
                    {b.label}
                  </Pill>
                ))}
              </div>
            </Row>
            <button
              type="button"
              aria-pressed={draft.autopay ? "true" : "false"}
              onClick={() => update({ autopay: !draft.autopay })}
              className="flex min-h-14 w-full items-center gap-3 border-b border-line px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0E7490]"
            >
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-base font-semibold text-ink">Autopay</span>
                <span className="text-[13px] text-ink-secondary">{autopayHint}</span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-7 w-12 items-center rounded-full p-[3px]",
                  draft.autopay ? "justify-end bg-[#0E7490]" : "justify-start bg-stone-300 dark:bg-stone-600"
                )}
              >
                <span className="h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />
              </span>
            </button>
            <div className="mt-3 flex items-start gap-2.5 rounded-control bg-cyan-50 p-3 text-sm leading-snug text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100">
              <RecurringGlyph className="mt-px h-[18px] w-[18px] shrink-0 text-[#0E7490] dark:text-cyan-300" />
              <span>{repeatSummary}</span>
            </div>
          </>
        )}

        {draft.items.length > 0 && (
          <div className="mt-3">
            <ItemsCard
              items={draft.items.map((i) => ({ label: i.label, amountText: money(i.amount) }))}
              total={money(total)}
              onRemove={removeItem}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pb-1 pt-3">
          <button
            type="button"
            onClick={addItem}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            Add as line item
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photos.length >= MAX_TICKET_PHOTOS || offline}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] disabled:opacity-50"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPhotoPicked}
            data-testid="ticket-photo-input"
          />
          {photos.map((p, index) => (
            <button
              key={p.key}
              type="button"
              aria-label={p.uploading ? `Photo ${index + 1} uploading` : `Remove photo ${index + 1}`}
              disabled={p.uploading}
              onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
              className="relative h-11 w-11 overflow-hidden rounded-lg bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
            >
              {p.previewUrl && <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />}
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                {p.uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Keypad onPress={press} />

      <div className="flex gap-2.5 px-4 pb-6 pt-2.5">
        {draft.kind === "charge" && draft.repeat === "once" && (
          <ActionButton variant="secondary" onClick={openPaidInPerson} disabled={sendDisabled}>
            Paid in person
          </ActionButton>
        )}
        <ActionButton onClick={submit} pending={pending === "submit"} disabled={sendDisabled}>
          {submitLabel(draft, total)}
        </ActionButton>
      </div>

      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(customer) => {
          update({ customer });
          setPickerOpen(false);
        }}
      />
      <PaidMethodSheet
        open={paidOpen}
        onOpenChange={(open) => !busy && setPaidOpen(open)}
        methods={PAID_METHODS}
        pendingMethod={pending?.startsWith("paid:") ? pending.slice(5) : null}
        onChoose={recordPaid}
        title={`Paid in person · ${money(total)}`}
      />
    </WorkScreen>
  );
}
