import { CalendarDays, Search, UserRoundCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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
      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/90 p-0 shadow-[0_24px_80px_-44px_rgba(8,47,73,0.85)] backdrop-blur">
        <DialogHeader className="border-b border-slate-200/70 bg-gradient-to-br from-white via-cyan-50/60 to-white px-5 pb-4 pt-5 pr-12 text-left">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 shadow-inner">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-2xl font-semibold leading-tight tracking-[-0.04em] text-slate-950">
            Service Another Day
          </DialogTitle>
          <DialogDescription className="text-sm font-medium leading-6 text-slate-600">
            Pick a non-{todayDay} client to service now. This one-off visit will not change the recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {availableDays.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {availableDays.map((day) => (
                  <Button
                    key={day}
                    type="button"
                    variant="outline"
                    className={selectedDay === day
                      ? "h-10 rounded-full border-cyan-600 bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_14px_32px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700"
                      : "h-10 rounded-full border border-slate-200 bg-white/85 px-4 text-sm font-semibold text-slate-700 shadow-sm hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-800"}
                    onClick={() => onSelectedDayChange(day)}
                  >
                    {day}
                  </Button>
                ))}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder={`Search ${selectedDay || "selected day"} clients...`}
                  className="h-11 rounded-[1.15rem] border border-white/80 bg-slate-50/80 pl-10 text-sm font-medium text-slate-700 shadow-inner focus:border-cyan-400 focus:bg-white"
                />
              </div>

              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {clients.length > 0 ? (
                  clients.map((client) => (
                    <Card key={client._id} className="rounded-[1.25rem] border border-white/80 bg-white/85 p-3 shadow-[0_18px_60px_-54px_rgba(8,47,73,0.75)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{client.full_name}</p>
                          <p className="text-xs text-slate-500 truncate">{client.address}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 rounded-full bg-cyan-600 text-white shadow-[0_14px_32px_-24px_rgba(8,145,178,0.95)] hover:bg-cyan-700"
                          onClick={() => onStartClient(client)}
                        >
                          <UserRoundCheck className="w-3.5 h-3.5 mr-1.5" />
                          Start
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="rounded-[1.25rem] border border-dashed border-cyan-200/80 bg-cyan-50/50 p-6">
                    <p className="text-center text-sm font-semibold text-slate-800">
                      No pending clients found for {selectedDay || "this day"}.
                    </p>
                    <p className="mt-1 text-center text-xs font-medium text-slate-500">
                      Clients already serviced today are hidden to avoid duplicates.
                    </p>
                  </Card>
                )}
              </div>
            </>
          ) : (
            <Card className="rounded-[1.25rem] border border-dashed border-cyan-200/80 bg-cyan-50/50 p-6">
              <p className="text-center text-sm font-semibold text-slate-800">
                No alternate working days are configured.
              </p>
              <p className="mt-1 text-center text-xs font-medium text-slate-500">
                Add more days in Settings to use this flow.
              </p>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
