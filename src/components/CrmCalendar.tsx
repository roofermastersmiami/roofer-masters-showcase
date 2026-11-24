import { useMemo, useState } from "react";
import { addDays, addWeeks, endOfWeek, format, isSameDay, startOfWeek, subWeeks } from "date-fns";
import { ArrowLeft, ArrowRight, CalendarDays, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Appointment = {
  id: string;
  lead_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  property_address: string;
  service_type: string;
  start_time: string;
  end_time: string;
  status: "Scheduled" | "Completed" | "Cancelled";
  notes: string;
  source: string;
};
const serviceColors: Record<string, string> = {
  "Roof Inspection": "border-sky-500 bg-sky-500/10",
  "Leak Repair": "border-rose-500 bg-rose-500/10",
  "Full Replacement Estimate": "border-violet-500 bg-violet-500/10",
  "Roof Repair": "border-orange-500 bg-orange-500/10",
  "Gutter Estimate": "border-emerald-500 bg-emerald-500/10",
  Other: "border-muted-foreground bg-muted",
};
const hours = Array.from({ length: 10 }, (_, index) => index + 8);

export function CrmCalendar({
  onOpenRoofReport,
}: {
  onOpenRoofReport?: (reportId: string) => void;
}) {
  const [anchor, setAnchor] = useState(new Date());
  const [mode, setMode] = useState<"week" | "day">("week");
  const [busyId, setBusyId] = useState<string | null>(null);
  const qc = useQueryClient();
  const from = mode === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  const to = mode === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  const db = supabase as any;
  const {
    data: appointments = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["crm-appointments", format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await db
        .from("appointments")
        .select("*")
        .gte("start_time", new Date(new Date(from).setHours(0, 0, 0, 0)).toISOString())
        .lte("start_time", new Date(new Date(to).setHours(23, 59, 59, 999)).toISOString())
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });
  const days = useMemo(
    () =>
      mode === "day"
        ? [anchor]
        : Array.from({ length: 6 }, (_, i) => addDays(startOfWeek(anchor, { weekStartsOn: 1 }), i)),
    [anchor, mode],
  );
  const changeStatus = async (id: string, status: Appointment["status"]) => {
    setBusyId(id);
    const { error } = await db.from("appointments").update({ status }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Could not update appointment");
      return;
    }
    toast.success(`Appointment marked ${status.toLowerCase()}`);
    await qc.invalidateQueries({ queryKey: ["crm-appointments"] });
  };
  const openReport = async (appointment: Appointment) => {
    if (!onOpenRoofReport) return;
    const customerResult = await supabase
      .from("crm_customers")
      .select("id")
      .eq("source_lead_id", appointment.lead_id)
      .maybeSingle();
    if (customerResult.error || !customerResult.data) {
      toast.error("No customer record is linked to this appointment");
      return;
    }
    const { data, error } = await supabase
      .from("roof_report_orders")
      .select("id")
      .eq("customer_id", customerResult.data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      toast.error("No roof measurement report is linked to this customer yet");
      return;
    }
    onOpenRoofReport(data.id);
  };
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <CalendarDays className="size-5 text-primary" /> Appointment Calendar
          </h2>
          <p className="text-sm text-muted-foreground">
            AI-booked and manually scheduled customer visits · Eastern Time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous period"
            onClick={() => setAnchor(mode === "week" ? subWeeks(anchor, 1) : addDays(anchor, -1))}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next period"
            onClick={() => setAnchor(mode === "week" ? addWeeks(anchor, 1) : addDays(anchor, 1))}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Select value={mode} onValueChange={(value) => setMode(value as "week" | "day")}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="day">Day</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm font-medium">
        {format(from, "MMM d")} – {format(to, "MMM d, yyyy")}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(serviceColors).map(([service, color]) => (
          <span key={service} className={cn("rounded border-l-4 px-2 py-1", color)}>
            {service}
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Appointments could not be loaded.
        </p>
      )}
      {isLoading ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Loading calendar…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <div
            className={cn(
              "grid min-w-[720px]",
              mode === "day"
                ? "grid-cols-[72px_1fr]"
                : "grid-cols-[64px_repeat(6,minmax(130px,1fr))",
            )}
          >
            <div className="border-b bg-muted/40 p-2 text-xs text-muted-foreground">Time</div>
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className={cn(
                  "border-b border-l bg-muted/40 p-2 text-center",
                  isSameDay(day, new Date()) && "bg-primary/10",
                )}
              >
                <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
                <p className="font-semibold">{format(day, "MMM d")}</p>
              </div>
            ))}
            {hours.map((hour) => (
              <div key={hour} className="contents">
                <div className="h-24 border-b p-2 text-xs text-muted-foreground">
                  {format(new Date(2026, 0, 1, hour), "h a")}
                </div>
                {days.map((day) => {
                  const matches = appointments.filter((appointment) => {
                    const start = new Date(appointment.start_time);
                    return isSameDay(start, day) && start.getHours() === hour;
                  });
                  return (
                    <div key={day.toISOString() + hour} className="min-h-24 border-b border-l p-1">
                      {matches.map((appointment) => (
                        <article
                          key={appointment.id}
                          className={cn(
                            "mb-1 rounded-md border-l-4 p-2 text-xs",
                            serviceColors[appointment.service_type] ?? serviceColors.Other,
                            appointment.status === "Cancelled" && "opacity-50 line-through",
                          )}
                        >
                          <p className="font-semibold">
                            {format(new Date(appointment.start_time), "h:mm a")} ·{" "}
                            {appointment.customer_name}
                          </p>
                          <p className="mt-1 line-clamp-2">{appointment.service_type}</p>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">
                            {appointment.property_address}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {appointment.source === "manual" ? "Manual" : "AI receptionist"} ·{" "}
                            {appointment.status}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Select
                              value={appointment.status}
                              onValueChange={(value) =>
                                void changeStatus(appointment.id, value as Appointment["status"])
                              }
                              disabled={busyId === appointment.id}
                            >
                              <SelectTrigger className="h-7 w-28 bg-background text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Scheduled">Scheduled</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                                <SelectItem value="Cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                            {onOpenRoofReport && (
                              <Button
                                size="icon"
                                variant="outline"
                                className="size-7"
                                title="Open roof report"
                                onClick={() => void openReport(appointment)}
                              >
                                <ExternalLink className="size-3" />
                              </Button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {!isLoading && appointments.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No appointments scheduled for this period.
        </p>
      )}
    </section>
  );
}
export default CrmCalendar;
