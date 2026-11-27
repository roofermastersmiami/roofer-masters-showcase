import { useState, useSyncExternalStore } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, LoaderCircle, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  browserNotificationsSupported,
  browserNotifyPreference,
  disableBrowserNotifications,
  enableBrowserNotifications,
  getMeasurementActivitySnapshot,
  markAllMeasurementsSeen,
  subscribeMeasurementActivity,
  type MeasurementActivityEntry,
} from "@/lib/measurement-activity";
import { useCrm } from "./CrmContext";

function ActivityRow({
  entry,
  onOpen,
}: {
  entry: MeasurementActivityEntry;
  onOpen: (id: string) => void;
}) {
  if (entry.status === "running") {
    return (
      <div className="rounded-md px-2 py-2" role="status">
        <p className="flex items-center gap-2 text-xs font-medium text-foreground">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="min-w-0 truncate">{entry.address}</span>
        </p>
        <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
          {entry.percent !== null
            ? `Measuring automatically · ${entry.percent}%`
            : (entry.detail ?? "Measuring automatically…")}
        </p>
        {entry.percent !== null && (
          <Progress
            value={entry.percent}
            className="ml-6 mt-1.5"
            aria-label={`Measurement progress for ${entry.address}`}
          />
        )}
        {entry.percent !== null && entry.detail && (
          <p className="mt-1 pl-6 text-[11px] text-muted-foreground">{entry.detail}</p>
        )}
      </div>
    );
  }
  const icon =
    entry.status === "ready" ? (
      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
    ) : entry.status === "failed" ? (
      <AlertCircle className="size-4 shrink-0 text-destructive" />
    ) : (
      <AlertTriangle className="size-4 shrink-0 text-amber-600" />
    );
  const headline =
    entry.status === "ready"
      ? "Roof report ready"
      : entry.status === "failed"
        ? "Measurement failed"
        : "Needs attention";
  return (
    <Button
      variant="ghost"
      className="h-auto w-full justify-start px-2 py-2 text-left"
      onClick={() => onOpen(entry.id)}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-medium text-foreground">
          {icon}
          <span className="min-w-0 truncate">{entry.address}</span>
        </p>
        <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
          {headline}
          {entry.message ? ` — ${entry.message}` : ""}
        </p>
      </div>
    </Button>
  );
}

/**
 * Header indicator for background roof measurements: a badge with
 * the number of measurements running right now, and a popover listing
 * each in-progress report (address + live progress) plus the ones
 * that finished — ready entries open the report. This is also the one
 * place browser notifications are offered: the toggle requests
 * permission on click, and completions then fire a browser
 * Notification when the CRM tab isn't the visible one.
 */
export function MeasurementActivityButton() {
  const { openRoofMeasurements } = useCrm();
  const entries = useSyncExternalStore(
    subscribeMeasurementActivity,
    getMeasurementActivitySnapshot,
    getMeasurementActivitySnapshot,
  );
  const [open, setOpen] = useState(false);
  const [notifyOn, setNotifyOn] = useState(
    () => browserNotifyPreference() && browserNotificationsSupported(),
  );
  const [notifyBlocked, setNotifyBlocked] = useState(false);
  const runningCount = entries.filter((entry) => entry.status === "running").length;
  const unseenCount = entries.filter((entry) => entry.status !== "running" && !entry.seen).length;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) markAllMeasurementsSeen();
  }

  function openReport(id: string) {
    setOpen(false);
    openRoofMeasurements(id);
  }

  async function toggleBrowserNotify(next: boolean) {
    if (!next) {
      disableBrowserNotifications();
      setNotifyOn(false);
      setNotifyBlocked(false);
      return;
    }
    const granted = await enableBrowserNotifications();
    setNotifyOn(granted);
    setNotifyBlocked(!granted);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Roof measurements"
          aria-label={
            runningCount > 0 ? `Roof measurements — ${runningCount} running` : "Roof measurements"
          }
        >
          <Ruler className="size-4" />
          {runningCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {runningCount}
            </span>
          )}
          {runningCount === 0 && unseenCount > 0 && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-emerald-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-semibold text-foreground">Roof measurements</p>
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No measurements running. Reports that finish in the background will appear here.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} onOpen={openReport} />
            ))}
          </div>
        )}
        <div className="mt-1 border-t border-border px-2 pb-1 pt-2.5">
          <label className="flex items-center justify-between gap-3 text-xs text-foreground">
            <span>Notify me when a measurement is ready</span>
            <Switch
              checked={notifyOn}
              onCheckedChange={(checked) => void toggleBrowserNotify(checked)}
              aria-label="Notify me when a measurement is ready"
              disabled={!browserNotificationsSupported()}
            />
          </label>
          {!browserNotificationsSupported() ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              This browser does not support notifications; finished reports still appear here and as
              an in-app message.
            </p>
          ) : notifyBlocked ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              The browser did not allow notifications. You can allow them in the browser's site
              settings; finished reports still appear here and as an in-app message.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Browser notifications arrive when this tab is in the background; in-app messages cover
              the rest.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
