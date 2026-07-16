import { CalendarDays, Search, UserRoundCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function OffDayServicePickerDialog({
  open,
  onOpenChange,
  todayDay,
  availableDays,
  selectedDay,
  onSelectedDayChange,
  searchQuery,
  onSearchQueryChange,
  clients,
  onStartClient,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-sheet border border-line bg-surface-1 p-0 shadow-card ">
        <DialogHeader className="border-b border-line bg-gradient-to-br from-surface-1 via-brand-softer to-surface-1 px-5 pb-4 pt-5 pr-12 text-left">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-softer text-brand-ink shadow-inner">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-2xl font-semibold leading-tight tracking-[-0.04em] text-ink">
            Service Another Day
          </DialogTitle>
          <DialogDescription className="text-sm font-medium leading-6 text-ink-secondary">
            Pick a non-{todayDay} client to service now. This one-off visit will not change the recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {availableDays.length > 0 ? (
            <>
              <Select value={selectedDay || undefined} onValueChange={onSelectedDayChange}>
                <SelectTrigger
                  aria-label="Service day"
                  className="h-11 rounded-2xl border border-line bg-surface-1 px-3 text-sm font-semibold text-ink shadow-sm focus:border-line focus:ring-2 focus:ring-slate-300/30"
                >
                  <SelectValue placeholder="Choose a service day" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-line bg-white p-1 shadow-xl">
                  {availableDays.map((day) => (
                    <SelectItem
                      key={day}
                      value={day}
                      textValue={day}
                      className="rounded-xl py-2.5 text-sm text-ink-secondary hover:bg-surface-2 focus:bg-transparent data-[highlighted]:bg-transparent data-[highlighted]:outline data-[highlighted]:outline-1 data-[highlighted]:outline-slate-300 data-[state=checked]:bg-transparent focus:text-ink"
                    >
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <Input
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder={`Search ${selectedDay || "selected day"} clients...`}
                  className="h-11 rounded-card border border-line bg-surface-2 pl-10 text-sm font-medium text-ink-secondary shadow-inner focus:border-[var(--status-info-line)] focus:bg-white"
                />
              </div>

              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {clients.length > 0 ? (
                  clients.map((client) => (
                    <Card key={client._id} className="rounded-raised border border-line bg-surface-1 p-3 shadow-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{client.full_name}</p>
                          <p className="text-xs text-ink-muted truncate">{client.address}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 rounded-full bg-brand text-white shadow-cta hover:bg-brand-strong"
                          onClick={() => onStartClient(client)}
                        >
                          <UserRoundCheck className="w-3.5 h-3.5 mr-1.5" />
                          Start
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="rounded-raised border border-dashed border-[var(--status-info-line)] bg-brand-softer p-6">
                    <p className="text-center text-sm font-semibold text-ink">
                      No pending clients found for {selectedDay || "this day"}.
                    </p>
                    <p className="mt-1 text-center text-xs font-medium text-ink-muted">
                      Clients already serviced today are hidden to avoid duplicates.
                    </p>
                  </Card>
                )}
              </div>
            </>
          ) : (
            <Card className="rounded-raised border border-dashed border-[var(--status-info-line)] bg-brand-softer p-6">
              <p className="text-center text-sm font-semibold text-ink">
                No alternate working days are configured.
              </p>
              <p className="mt-1 text-center text-xs font-medium text-ink-muted">
                Add more days in Settings to use this flow.
              </p>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
