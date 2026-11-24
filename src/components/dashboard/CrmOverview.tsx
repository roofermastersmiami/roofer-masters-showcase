import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowRight,
  Receipt,
  HardHat,
  Users,
  Clock,
  Wallet,
  CalendarDays,
  SlidersHorizontal,
  GripVertical,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dashboardLedger, stageOf } from "@/lib/crm-foundation";
import { money } from "@/lib/crm-schema";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  invoicesQuery,
  paymentsQuery,
  jobsQuery,
  tasksQuery,
  estimatesQuery,
  allSharesQuery,
} from "./operations-data";
import { activityQuery } from "./foundation-data";
import { Choice } from "./CrmControls";
import { useCrm } from "./CrmContext";
import { formatWhen } from "./data";
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function CrmOverview() {
  const { leads, go, onOpen } = useCrm();
  const invoices = useQuery(invoicesQuery),
    payments = useQuery(paymentsQuery),
    jobs = useQuery(jobsQuery),
    tasks = useQuery(tasksQuery),
    estimates = useQuery(estimatesQuery),
    shares = useQuery(allSharesQuery),
    activity = useQuery(activityQuery);
  const [customize, setCustomize] = useState(false),
    [accent, setAccent] = useState("#2563eb"),
    [density, setDensity] = useState<"comfortable" | "compact">("comfortable"),
    [cardOrder, setCardOrder] = useState(["Payments received", "Outstanding balance", "Active projects", "New leads"]),
    [hiddenCards, setHiddenCards] = useState<string[]>([]),
    [draggedCard, setDraggedCard] = useState<string | null>(null),
    [preferencesLoaded, setPreferencesLoaded] = useState(false),
    [sectionOrder, setSectionOrder] = useState(["Revenue & sales", "Daily operations"]),
    [hiddenSections, setHiddenSections] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("crm-dashboard-layout") ?? "{}");
      if (typeof saved.accent === "string") setAccent(saved.accent);
      if (saved.density === "compact" || saved.density === "comfortable") setDensity(saved.density);
      if (Array.isArray(saved.cardOrder) && saved.cardOrder.every((item: unknown) => typeof item === "string")) setCardOrder(saved.cardOrder);
      if (Array.isArray(saved.hiddenCards) && saved.hiddenCards.every((item: unknown) => typeof item === "string")) setHiddenCards(saved.hiddenCards);
    } catch { /* Keep defaults if saved preferences are unavailable. */ }
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (preferencesLoaded) localStorage.setItem("crm-dashboard-layout", JSON.stringify({ accent, density, cardOrder, hiddenCards, sectionOrder, hiddenSections }));
  }, [accent, density, cardOrder, hiddenCards, sectionOrder, hiddenSections, preferencesLoaded]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("crm-dashboard-layout") ?? "{}");
      if (Array.isArray(saved.sectionOrder) && saved.sectionOrder.every((item: unknown) => typeof item === "string")) setSectionOrder(saved.sectionOrder);
      if (Array.isArray(saved.hiddenSections) && saved.hiddenSections.every((item: unknown) => typeof item === "string")) setHiddenSections(saved.hiddenSections);
    } catch { /* Keep defaults if saved preferences are unavailable. */ }
  }, []);
  const [period, setPeriod] = useState("month"),
    [fromDate, setFromDate] = useState(
      dateValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    ),
    [toDate, setToDate] = useState(dateValue(new Date()));
  const now = new Date();
  const year = now.getFullYear();
  let from = new Date(year, now.getMonth(), 1).getTime();
  let to = now.getTime();
  if (period === "today") from = new Date(year, now.getMonth(), now.getDate()).getTime();
  if (period === "week")
    from = new Date(year, now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  if (period === "year") from = new Date(year, 0, 1).getTime();
  if (period === "custom") {
    from = new Date(`${fromDate}T00:00:00`).getTime();
    to = new Date(`${toDate}T23:59:59.999`).getTime();
  }
  let env = "";
  try {
    env = getStripeEnvironment();
  } catch {
    env = "unavailable";
  }
  const unavailable = !!(
    invoices.error ||
    payments.error ||
    jobs.error ||
    tasks.error ||
    estimates.error ||
    shares.error
  );
  const loading = invoices.isPending || payments.isPending || jobs.isPending;
  const ledger = dashboardLedger(invoices.data ?? [], payments.data ?? [], env, from, to);
  const validRange = Number.isFinite(from) && Number.isFinite(to) && from <= to;
  const yearLedger = dashboardLedger(
    invoices.data ?? [],
    payments.data ?? [],
    env,
    new Date(year, 0, 1).getTime(),
    now.getTime(),
  );
  const monthLedger = dashboardLedger(
    invoices.data ?? [],
    payments.data ?? [],
    env,
    new Date(year, now.getMonth(), 1).getTime(),
    now.getTime(),
  );
  const chart = Array.from({ length: 12 }, (_, m) => {
    const start = new Date(year, m, 1).getTime(),
      end = new Date(year, m + 1, 1).getTime() - 1;
    return {
      month: new Date(year, m, 1).toLocaleDateString("en-US", { month: "short" }),
      revenue:
        dashboardLedger(invoices.data ?? [], payments.data ?? [], env, start, end).collected / 100,
    };
  });
  const selectedLeads = leads.filter(
    (l) => Date.parse(l.created_at) >= from && Date.parse(l.created_at) <= to,
  );
  const converted = selectedLeads.filter((l) =>
    [
      "approved",
      "contract_signed",
      "project_scheduled",
      "in_progress",
      "completed",
      "paid",
    ].includes(stageOf(l)),
  );
  const activeJobs = (jobs.data ?? []).filter((j) => j.status !== "completed");
  const upcoming = (jobs.data ?? [])
    .filter((j) => j.inspection_at && Date.parse(j.inspection_at) >= Date.now())
    .sort((a, b) => Date.parse(a.inspection_at ?? "") - Date.parse(b.inspection_at ?? ""));
  const due = (tasks.data ?? [])
    .filter((t) => !t.completed_at)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const signed = new Set((shares.data ?? []).filter((s) => s.signed_at).map((s) => s.proposal_id));
  const value = (n: number) =>
    loading ? "…" : unavailable || !validRange ? "Unavailable" : money(n);
  const metricCards = [
    { label: "Payments received", value: value(ledger.collected), icon: Wallet, section: "invoices", note: "Selected period" },
    { label: "Outstanding balance", value: value(ledger.outstanding), icon: Receipt, section: "invoices", note: "All issued invoices" },
    { label: "Active projects", value: jobs.isPending ? "…" : jobs.error ? "Unavailable" : String(activeJobs.length), icon: HardHat, section: "jobs", note: `${jobs.data?.filter((j) => j.status === "completed").length ?? 0} completed` },
    { label: "New leads", value: String(selectedLeads.length), icon: Users, section: "pipeline", note: `${selectedLeads.length ? Math.round((converted.length / selectedLeads.length) * 100) : 0}% lead conversion` },
  ].sort((a, b) => { const ai = cardOrder.indexOf(a.label); const bi = cardOrder.indexOf(b.label); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
  const moveCard = (from: string, to: string) => { const next = [...cardOrder]; const i = next.indexOf(from); const j = next.indexOf(to); if (i < 0 || j < 0) return; next.splice(i, 1); next.splice(j, 0, from); setCardOrder(next); };
  const shiftCard = (label: string, direction: -1 | 1) => { const next = [...cardOrder]; const index = next.indexOf(label); const target = index + direction; if (index < 0 || target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setCardOrder(next); };
  return (
    <div style={{ "--crm-dashboard-accent": accent } as React.CSSProperties}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Roofer Masters · Business overview
          </p>
          <h1 className="text-3xl font-bold text-foreground">Your business at a glance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={() => setCustomize(!customize)} aria-expanded={customize}><SlidersHorizontal className="mr-2 size-4" />Customize dashboard</Button>
          <div className="w-44">
          <Choice
            label="Reporting period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "This week" },
              { value: "month", label: "This month" },
              { value: "year", label: "This year" },
              { value: "custom", label: "Custom range" },
            ]}
          />
          </div>
        </div>
      </div>
      {customize && <section className="mb-6 rounded-xl border border-border bg-card p-5" aria-label="Dashboard customization">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Your workspace, your way</h2><p className="text-sm text-muted-foreground">Drag summary cards to reorder them. Preferences are saved on this device.</p></div>
          <Button size="sm" variant="ghost" onClick={() => { setAccent("#2563eb"); setDensity("comfortable"); setCardOrder(["Payments received", "Outstanding balance", "Active projects", "New leads"]); setHiddenCards([]); setSectionOrder(["Revenue & sales", "Daily operations"]); setHiddenSections([]); }}>Reset layout</Button></div>
        <div className="mt-4 flex flex-wrap items-center gap-5"><div><p className="mb-2 text-xs font-semibold text-muted-foreground">ACCENT COLOR</p><div className="flex gap-2">
          {["#2563eb", "#0f766e", "#7c3aed", "#c2410c", "#be123c", "#475569"].map((color) => <button key={color} type="button" aria-label={`Set accent color ${color}`} aria-pressed={accent === color} onClick={() => setAccent(color)} className="size-8 rounded-full border-2 border-background" style={{ backgroundColor: color, outline: accent === color ? `2px solid ${color}` : "none" }} />)}
        </div></div><div><p className="mb-2 text-xs font-semibold text-muted-foreground">SHOW / HIDE SUMMARY CARDS</p><div className="flex flex-wrap gap-2">{["Payments received", "Outstanding balance", "Active projects", "New leads"].map((label) => <Button key={label} size="sm" variant={hiddenCards.includes(label) ? "outline" : "secondary"} onClick={() => setHiddenCards((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])}>{hiddenCards.includes(label) ? <EyeOff className="mr-1 size-3" /> : <Eye className="mr-1 size-3" />}{label}</Button>)}</div></div><div><p className="mb-2 text-xs font-semibold text-muted-foreground">CARD SPACING</p><div className="flex gap-2"><Button size="sm" variant={density === "comfortable" ? "default" : "outline"} onClick={() => setDensity("comfortable")}>Comfortable</Button><Button size="sm" variant={density === "compact" ? "default" : "outline"} onClick={() => setDensity("compact")}>Compact</Button></div></div></div>
      </section>}
      {period === "custom" && (
        <div className="mb-5 flex flex-wrap gap-3">
          <label className="text-sm">
            From
            <Input
              aria-label="Report from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <Input
              aria-label="Report to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      )}
      {(!validRange || unavailable) && (
        <p
          role="alert"
          className="mb-5 border-l-2 border-destructive pl-3 text-sm text-destructive"
        >
          {!validRange
            ? "Choose a valid date range."
            : "Some records could not load. Totals are unavailable until records load."}
        </p>
      )}
      <div className={`grid ${density === "compact" ? "gap-2" : "gap-4"} sm:grid-cols-2 xl:grid-cols-4`}>
        {metricCards.filter((s) => !hiddenCards.includes(s.label)).map((s) => <article key={s.label} draggable onDragStart={() => setDraggedCard(s.label)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedCard && draggedCard !== s.label) moveCard(draggedCard, s.label); setDraggedCard(null); }} onDragEnd={() => setDraggedCard(null)} className={`cursor-grab rounded-lg border border-border bg-card ${density === "compact" ? "p-3" : "p-5"} ${draggedCard === s.label ? "opacity-50" : ""}`} style={{ borderTop: `3px solid ${accent}` }}>
          <div className="flex items-center justify-between"><span className="text-sm font-semibold text-muted-foreground">{s.label}</span><span className="flex items-center gap-2"><GripVertical className="size-4 text-muted-foreground" /><s.icon className="size-5" style={{ color: accent }} /></span></div>
          <di      {customize && <section className="mb-6 rounded-xl border border-border bg-card p-5" aria-label="Dashboard section customization">
        <h3 className="font-semibold">Dashboard sections</h3>
        <p className="mb-3 text-sm text-muted-foreground">Reorder or hide larger dashboard sections. Changes are saved on this device.</p>
        <div className="flex flex-wrap gap-2">{["Revenue & sales", "Daily operations"].map((label) => <div key={label} className="flex items-center gap-1 rounded-md border border-border p-1">
          <span className="px-2 text-sm">{label}</span>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${label} up`} onClick={() => setSectionOrder((current) => { const next=[...current], i=next.indexOf(label); if(i>0) [next[i-1],next[i]]=[next[i],next[i-1]]; return next; })}><ChevronUp className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${label} down`} onClick={() => setSectionOrder((current) => { const next=[...current], i=next.indexOf(label); if(i>=0 && i<next.length-1) [next[i+1],next[i]]=[next[i],next[i+1]]; return next; })}><ChevronDown className="size-3" /></Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`${hiddenSections.includes(label) ? "Show" : "Hide"} ${label}`} onClick={() => setHiddenSections((current) => current.includes(label) ? current.filter((item) => item!==label) : [...current,label])}>{hiddenSections.includes(label) ? <EyeOff className="size-3" /> : <Eye className="size-3" />}</Button>
        </div>)}</div>
      </section>}
      {sectionOrder.filter((label) => !hiddenSections.includes(label)).map((label) => label === "Revenue & sales" ? (
      <section className="mt-8 grid gap-8 border-b border-border pb-8 xl:grid-cols-[2fr_1fr]">
        <div className="min-w-0">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Revenue collected</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {year} · {env === "sandbox" ? "Test payments" : "Recorded payments"}
              </p>
            </div>
            <p className="text-xl font-bold">{value(yearLedger.collected)}</p>
          </div>
          <div className="h-64 w-full min-w-0">
            {!unavailable ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickFormatter={(n) => `$${n >= 1000 ? `${n / 1000}k` : n}`}
                  />
                  <Tooltip
                    formatter={(v) => money(Number(v) * 100)}
                    contentStyle={{
                      background: "var(--popover)",
                      borderColor: "var(--border)",
                      color: "var(--foreground)",
                      borderRadius: 8,
                    }}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Collected"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-20 text-center text-muted-foreground">
                Revenue records unavailable.
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {ledger.received.length
              ? "Confirmed and manually recorded receipts only."
              : "No payments recorded in the selected period."}
          </p>
        </div>
        <div className="border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <h2 className="mb-5 text-xl font-bold">Sales snapshot</h2>
          <dl className="grid gap-5">
            {[
              ["This month collected", value(monthLedger.collected)],
              ["Issued sales in period", value(ledger.sales)],
              ["Signed proposals", String(signed.size)],
              ["Saved estimates", String(estimates.data?.length ?? 0)],
              ["Unfinished follow-ups", String(due.length)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between gap-3 border-b border-border pb-3 text-sm"
              >
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <Button variant="outline" className="mt-5 w-full" onClick={() => go("sales")}>
            Sales report <ArrowRight />
          </Button>
        </div>
      </section>
      ) : (
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <section>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Clock className="size-4 text-primary" /> Tasks requiring attention
            </h2>
            <Button
              variant="ghost"
              size="icon"
              title="View follow-ups"
              aria-label="View follow-ups"
              onClick={() => go("followups")}
            >
              <ArrowRight className="size-4" />
            </Button>
          </div>
          {due.slice(0, 5).map((t) => (
            <div key={t.id} className="border-b border-border py-3">
              <p className="text-sm font-semibold">{t.title}</p>
              <p
                className={`mt-1 text-xs ${Date.parse(t.due_at) < Date.now() ? "text-destructive" : "text-muted-foreground"}`}
              >
                {formatWhen(t.due_at)}
              </p>
            </div>
          ))}
          {!due.length && <p className="text-sm text-muted-foreground">No pending tasks.</p>}
        </section>
        <section>
          <h2 className="mb-5 flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="size-4 text-primary" /> Upcoming inspections
          </h2>
          {upcoming.slice(0, 5).map((j) => (
            <Button
              key={j.id}
              variant="ghost"
              className="h-auto w-full items-start justify-start border-b border-border py-3 text-left"
              onClick={() => go("jobs")}
            >
              <div>
                <p className="text-sm font-semibold">{j.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWhen(j.inspection_at ?? "")}
                </p>
              </div>
            </Button>
          ))}
          {!upcoming.length && (
            <p className="text-sm text-muted-foreground">No inspections scheduled.</p>
          )}
        </section>
        <section>
          <h2 className="mb-5 text-lg font-bold">Recent customer activity</h2>
          {activity.data?.slice(0, 5).map((a) => {
            const lead = leads.find((l) => l.id === a.lead_id);
            return (
              <Button
                key={a.id}
                variant="ghost"
                className="h-auto w-full justify-start border-b border-border py-3 text-left"
                disabled={!lead}
                onClick={() => {
                  if (lead) onOpen(lead);
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatWhen(a.created_at)}</p>
                </div>
              </Button>
            );
          })}
          {!activity.data?.length && (
            <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
          )}
        </section>
      </div>
      ))}
a.lead_id);
            return (
              <Button
                key={a.id}
                variant="ghost"
                className="h-auto w-full justify-start border-b border-border py-3 text-left"
                disabled={!lead}
                onClick={() => {
                  if (lead) onOpen(lead);
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatWhen(a.created_at)}</p>
                </div>
              </Button>
            );
          })}
          {!activity.data?.length && (
            <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
          )}
        </section>
      </div>
    </div>
  );
}
