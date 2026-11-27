import { toast } from "sonner";

/**
 * Session store for roof-measurement activity across the whole CRM.
 * The background measurement engine (use-auto-finish) records live
 * progress and terminal outcomes here; the shell's activity popover
 * reads it, and completions raise exactly one toast (plus an optional
 * browser notification) per finished report version — no matter which
 * CRM page is open, and never twice for the same completion.
 */

export type MeasurementActivityStatus = "running" | "ready" | "failed" | "attention";

export type MeasurementActivityEntry = {
  id: string;
  address: string;
  status: MeasurementActivityStatus;
  /** Live measurement percent while running (null before it starts). */
  percent: number | null;
  /** Latest service stage detail while running ("Waiting for a worker", …). */
  detail: string | null;
  /** Human message for failed / attention entries. */
  message: string | null;
  /** Epoch ms when the report finished (ready/failed/attention). */
  finishedAt: number | null;
  seen: boolean;
};

export type MeasurementNotice = {
  kind: "ready" | "failed" | "attention";
  id: string;
  address: string;
  message?: string;
};

export type MeasurementNotifier = (notice: MeasurementNotice) => void;

const LAST_SEEN_KEY = "crm-measurements-last-seen";
const BROWSER_NOTIFY_KEY = "crm-measurements-browser-notify";
const MAX_ENTRIES = 25;

const entries = new Map<string, MeasurementActivityEntry>();
const listeners = new Set<() => void>();
let snapshot: MeasurementActivityEntry[] = [];
let sequence = 0;
const entryOrder = new Map<string, number>();

// Exactly one notification per completion / terminal attempt, even
// if the same outcome is recorded again on a refetch or re-mount.
const notifiedReady = new Set<string>();
const notifiedTerminal = new Set<string>();

function emit() {
  const running: MeasurementActivityEntry[] = [];
  const fresh: MeasurementActivityEntry[] = [];
  const seen: MeasurementActivityEntry[] = [];
  for (const entry of entries.values()) {
    if (entry.status === "running") running.push(entry);
    else if (!entry.seen) fresh.push(entry);
    else seen.push(entry);
  }
  const byFinishedDesc = (a: MeasurementActivityEntry, b: MeasurementActivityEntry) =>
    (b.finishedAt ?? 0) - (a.finishedAt ?? 0) ||
    (entryOrder.get(b.id) ?? 0) - (entryOrder.get(a.id) ?? 0);
  running.sort(
    (a, b) => (entryOrder.get(b.id) ?? 0) - (entryOrder.get(a.id) ?? 0),
  );
  fresh.sort(byFinishedDesc);
  seen.sort(byFinishedDesc);
  snapshot = [...running, ...fresh, ...seen];
  for (const listener of listeners) listener();
}

function trimEntries() {
  if (entries.size <= MAX_ENTRIES) return;
  // Drop the oldest seen terminal entries first; never drop a
  // running or still-unseen entry to make room.
  const droppable = [...entries.values()]
    .filter((entry) => entry.status !== "running" && entry.seen)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  for (const entry of droppable) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(entry.id);
    entryOrder.delete(entry.id);
  }
}

function upsert(entry: MeasurementActivityEntry) {
  if (!entryOrder.has(entry.id)) entryOrder.set(entry.id, sequence++);
  entries.set(entry.id, entry);
  trimEntries();
  emit();
}

export function subscribeMeasurementActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMeasurementActivitySnapshot(): MeasurementActivityEntry[] {
  return snapshot;
}

/** Live progress from the background engine: the report is measuring
 * (or saving / building its PDF) right now. */
export function recordMeasurementProgress(
  id: string,
  address: string,
  progress: { percent: number | null; detail: string | null },
) {
  const existing = entries.get(id);
  upsert({
    id,
    address,
    status: "running",
    percent: progress.percent,
    detail: progress.detail,
    message: null,
    finishedAt: null,
    seen: existing?.seen ?? true,
  });
}

/** The report's PDF is attached: it is ready to open. Fires the
 * notifier exactly once per completion key (report id + the version
 * that finished), however many times the outcome is re-recorded. */
export function recordMeasurementReady(id: string, address: string, completionKey: string) {
  upsert({
    id,
    address,
    status: "ready",
    percent: 100,
    detail: null,
    message: null,
    finishedAt: Date.now(),
    seen: false,
  });
  if (!notifiedReady.has(completionKey)) {
    notifiedReady.add(completionKey);
    notify({ kind: "ready", id, address });
  }
}

/** A terminal non-success outcome (error, unmeasurable, or a building
 * pick is needed). Surfaced in the activity list — never silent — and
 * notified once per attempt key. */
export function recordMeasurementTerminal(
  id: string,
  address: string,
  attemptKey: string,
  kind: "failed" | "attention",
  message: string,
) {
  upsert({
    id,
    address,
    status: kind,
    percent: null,
    detail: null,
    message,
    finishedAt: Date.now(),
    seen: false,
  });
  if (!notifiedTerminal.has(attemptKey)) {
    notifiedTerminal.add(attemptKey);
    notify({ kind, id, address, message });
  }
}

/** A run was interrupted before finishing (e.g. the workspace took
 * over the report): drop its live entry so nothing looks stuck. A
 * later resume re-creates it through recordMeasurementProgress. */
export function forgetMeasurementActivity(id: string) {
  const existing = entries.get(id);
  if (existing?.status === "running") {
    entries.delete(id);
    entryOrder.delete(id);
    emit();
  }
}

export type FinishedReportSeed = {
  id: string;
  address: string;
  file_path: string | null;
  updated_at: string;
};

/** "Ready while you were away": on CRM load, reports whose PDF was
 * attached after the user's last seen-marker appear as ready entries.
 * Seeding never fires a toast or browser notification — the entries
 * (and the header badge) are the signal. */
export function seedFinishedMeasurements(reports: FinishedReportSeed[]) {
  const lastSeen = readLastSeen();
  let added = false;
  for (const report of reports) {
    if (!report.file_path) continue;
    if (entries.has(report.id)) continue;
    const finishedAt = Date.parse(report.updated_at);
    if (!Number.isFinite(finishedAt) || finishedAt <= lastSeen) continue;
    if (!entryOrder.has(report.id)) entryOrder.set(report.id, sequence++);
    entries.set(report.id, {
      id: report.id,
      address: report.address,
      status: "ready",
      percent: 100,
      detail: null,
      message: null,
      finishedAt,
      seen: false,
    });
    added = true;
  }
  if (added) {
    trimEntries();
    emit();
  }
}

export function markMeasurementSeen(id: string) {
  const existing = entries.get(id);
  if (existing && !existing.seen) {
    entries.set(id, { ...existing, seen: true });
    emit();
  }
}

export function markAllMeasurementsSeen() {
  let changed = false;
  for (const [id, entry] of entries) {
    if (!entry.seen) {
      entries.set(id, { ...entry, seen: true });
      changed = true;
    }
  }
  writeLastSeen(Date.now());
  if (changed) emit();
}

function readLastSeen(): number {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastSeen(at: number) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, new Date(at).toISOString());
  } catch {
    // Storage may be unavailable; the in-session list still works.
  }
}

// ---------------------------------------------------------------------------
// Notification delivery: in-app toast always; browser Notification
// only when the user opted in from the activity popover, permission
// was granted there, and the CRM tab is not the visible one (the
// toast already covers the visible case).
// ---------------------------------------------------------------------------

let readyAction: ((id: string) => void) | null = null;

/** Register what "Open" on a ready toast does (the shell wires it to
 * opening the report's measurement workspace). */
export function setMeasurementReadyAction(action: ((id: string) => void) | null) {
  readyAction = action;
}

function fireBrowserNotification(title: string, body: string) {
  try {
    if (!browserNotifyPreference()) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    new Notification(title, { body });
  } catch {
    // Notifications are best-effort; the in-app list is the record.
  }
}

function defaultNotify(notice: MeasurementNotice) {
  if (notice.kind === "ready") {
    toast.success(`Roof report ready — ${notice.address}`, {
      ...(readyAction
        ? {
            action: {
              label: "Open",
              onClick: () => readyAction?.(notice.id),
            },
          }
        : {}),
    });
    fireBrowserNotification("Roof report ready", notice.address);
  } else if (notice.kind === "failed") {
    toast.error(`Measurement failed — ${notice.address}`, {
      description: notice.message,
    });
    fireBrowserNotification("Roof measurement failed", notice.address);
  } else {
    toast.warning(`Measurement needs attention — ${notice.address}`, {
      description: notice.message,
    });
    fireBrowserNotification("Roof measurement needs attention", notice.address);
  }
}

let notifier: MeasurementNotifier = defaultNotify;

/** Replace the notification sink (tests inject a spy). Pass null to
 * restore the default toast + browser-notification behaviour. */
export function setMeasurementNotifier(next: MeasurementNotifier | null) {
  notifier = next ?? defaultNotify;
}

function notify(notice: MeasurementNotice) {
  notifier(notice);
}

export function browserNotifyPreference(): boolean {
  try {
    return localStorage.getItem(BROWSER_NOTIFY_KEY) === "on";
  } catch {
    return false;
  }
}

/** Turn browser notifications on from a user gesture: persist the
 * preference and request permission. Returns true only when
 * notifications will actually fire (preference on + granted). */
export async function enableBrowserNotifications(): Promise<boolean> {
  try {
    localStorage.setItem(BROWSER_NOTIFY_KEY, "on");
  } catch {
    // Preference stays session-only when storage is unavailable.
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function disableBrowserNotifications() {
  try {
    localStorage.setItem(BROWSER_NOTIFY_KEY, "off");
  } catch {
    // Nothing to persist; the toggle state is re-read on mount.
  }
}

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Test-only: wipe the whole store back to a fresh session. */
export function resetMeasurementActivityForTests() {
  entries.clear();
  entryOrder.clear();
  notifiedReady.clear();
  notifiedTerminal.clear();
  sequence = 0;
  snapshot = [];
  readyAction = null;
  notifier = defaultNotify;
}
