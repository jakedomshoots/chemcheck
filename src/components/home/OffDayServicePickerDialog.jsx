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
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-slate-100">
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-cyan-600" />
            Service Another Day
          </DialogTitle>
          <DialogDescription>
            Pick a non-{todayDay} client to service now. This is a one-off visit and does not change recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          {availableDays.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">
                {availableDays.map((day) => (
                  <Button
                    key={day}
                    type="button"
                    variant={selectedDay === day ? "default" : "outline"}
                    className={selectedDay === day
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
                      : "border-slate-200 text-slate-700"}
                    onClick={() => onSelectedDayChange(day)}
                  >
                    {day}
                  </Button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder={`Search ${selectedDay || "selected day"} clients...`}
                  className="pl-9 border-slate-200 focus:border-cyan-500"
                />
              </div>

              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {clients.length > 0 ? (
                  clients.map((client) => (
                    <Card key={client._id} className="p-3 border border-slate-200">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{client.full_name}</p>
                          <p className="text-xs text-slate-500 truncate">{client.address}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="shrink-0 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                          onClick={() => onStartClient(client)}
                        >
                          <UserRoundCheck className="w-3.5 h-3.5 mr-1.5" />
                          Start
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="p-6 border border-dashed border-slate-200 bg-slate-50">
                    <p className="text-sm font-medium text-slate-700 text-center">
                      No pending clients found for {selectedDay || "this day"}.
                    </p>
                    <p className="text-xs text-slate-500 text-center mt-1">
                      Clients already serviced today are hidden to avoid duplicates.
                    </p>
                  </Card>
                )}
              </div>
            </>
          ) : (
            <Card className="p-6 border border-dashed border-slate-200 bg-slate-50">
              <p className="text-sm font-medium text-slate-700 text-center">
                No alternate working days are configured.
              </p>
              <p className="text-xs text-slate-500 text-center mt-1">
                Add more days in Settings to use this flow.
              </p>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
