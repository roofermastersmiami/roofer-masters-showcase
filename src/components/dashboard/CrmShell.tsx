import { useRoles } from "./RolesContext";
import { canOpen } from "@/lib/team-roles";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  MapPin,
  Calculator,
  FileText,
  HardHat,
  Receipt,
  Clock,
  TrendingUp,
  MessageSquare,
  Settings,
  Inbox,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Bell,
  Sun,
  Moon,
  ExternalLink,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LogoMark } from "@/components/site/Logo";
import { CrmContext } from "./CrmContext";
import { LeadSheet } from "./LeadSheet";
import { leadsQuery, formatWhen } from "./data";
import { tasksQuery } from "./operations-data";
import { customersQuery, propertiesQuery } from "./foundation-data";
import { cn } from "@/lib/utils";
import { useWebMCP } from "use-webmcp-tool";
import { runWebMCPTool } from "@/lib/webmcp-telemetry";
import { requireVisibleSection } from "@/lib/webmcp-navigation";
const readWorkspaceSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};
const openSectionSchema = {
  type: "object" as const,
  properties: {
    section: {
      type: "string" as const,
      description:
        "Section ID returned by read_crm_navigation. An empty string opens the dashboard.",
    },
  },
  required: ["section"],
  additionalProperties: false,
};
const readAnnotations = { readOnlyHint: true };
const groups = [
  {
    label: "Workspace",
    items: [
      { id: "", label: "Dashboard", icon: LayoutDashboard },
      { id: "pipeline", label: "Leads", icon: KanbanSquare },
      { id: "customers", label: "Customers", icon: Users },
      { id: "properties", label: "Properties", icon: MapPin },
    ],
  },
  {
    label: "Sales & production",
    items: [
      { id: "roof-reports", label: "Roof reports", icon: FileText },
      { id: "measurements", label: "Roof measurements", icon: MapPin },
      { id: "estimates", label: "Quick estimator", icon: Calculator },
      { id: "detailed-estimator", label: "Detailed estimator", icon: Calculator },
      { id: "prices", label: "Material & labor prices", icon: Settings },
      { id: "proposals", label: "Estimates & proposals", icon: FileText },
      { id: "jobs", label: "Projects & production", icon: HardHat },
      { id: "followups", label: "Tasks & follow-ups", icon: Clock },
    ],
  },
  {
    label: "Finance",
    items: [
      { id: "invoices", label: "Invoices & payments", icon: Receipt },
      { id: "sales", label: "Sales reporting", icon: TrendingUp },
      { id: "expenses", label: "Expenses & receipts", icon: Receipt },
      { id: "financials", label: "Financial analytics", icon: TrendingUp },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "my-jobs", label: "My assigned jobs", icon: HardHat },
      { id: "team", label: "Team & access", icon: Users },
      { id: "chat", label: "Customer messages", icon: MessageSquare },
      { id: "submissions", label: "Website submissions", icon: Inbox },
      { id: "instant", label: "Instant estimate rates", icon: Calculator },
      { id: "content", label: "Website settings", icon: Settings },
    ],
  },
];
export function CrmShell({
  children,
  email,
  onSignOut,
}: {
  children: ReactNode;
  email: string;
  onSignOut: () => void;
}) {
  const roles = useRoles();
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => canOpen(roles, i.id)) }))
    .filter((g) => g.items.length);
  const { data: leads = [], isPending, error } = useQuery(leadsQuery);
  const tasks = useQuery(tasksQuery);
  const customers = useQuery(customersQuery);
  const properties = useQuery(propertiesQuery);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = pathname.split("/")[2] ?? "";
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false),
    [query, setQuery] = useState(""),
    [notifications, setNotifications] = useState(false),
    [openId, setOpenId] = useState<string | null>(null),
    [proposalLeadId, setProposalLeadId] = useState<string | null>(null),
    [roofReportRequest, setRoofReportRequest] = useState<{
      propertyId: string;
      customerId: string;
      address: string;
    } | null>(null),
    [selectedRoofReportId, setSelectedRoofReportId] = useState<string | null>(null);
  useEffect(() => {
    setDark(localStorage.getItem("crm-theme") === "dark");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("crm-dark", dark);
    document.documentElement.classList.toggle("dark", dark);
    return () => {
      document.documentElement.classList.remove("crm-dark", "dark");
    };
  }, [dark]);
  async function go(value: string) {
    const id = requireVisibleSection(
      value,
      visibleGroups.flatMap((g) => g.items.map((i) => i.id)),
    );
    setMobile(false);
    setNotifications(false);
    setQuery("");
    if (id) await navigate({ to: "/dashboard/$section", params: { section: id } });
    else await navigate({ to: "/dashboard" });
  }
  useWebMCP({
    name: "read_crm_navigation",
    description:
      "Read the current CRM section and the available sidebar sections for this signed-in user.",
    inputSchema: readWorkspaceSchema,
    annotations: readAnnotations,
    execute: () =>
      runWebMCPTool(
        "read_crm_navigation",
        () =>
          `Current section: ${section || "dashboard"}. Available sections: ${visibleGroups.flatMap((g) => g.items.map((i) => `${i.id || "(empty string)"}: ${i.label}`)).join("; ")}`,
      ),
  });
  useWebMCP({
    name: "open_crm_section",
    description:
      "Open a CRM section available in the current sidebar. Use read_crm_navigation to obtain an allowed section ID.",
    inputSchema: openSectionSchema,
    execute: ({ section: target }: { section: string }) =>
      runWebMCPTool("open_crm_section", async () => {
        await go(target);
        return "CRM section opened.";
      }),
  });
  const openLead = leads.find((l) => l.id === openId) ?? null;
  const due = (tasks.data ?? []).filter(
    (t) => !t.completed_at && Date.parse(t.due_at) <= Date.now() + 86400000,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const leadResults = normalizedQuery
    ? leads
        .filter((l) =>
          `${l.name} ${l.phone ?? ""} ${l.email ?? ""} ${l.address ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
        .slice(0, 5)
        .map((lead) => ({
          key: `lead-${lead.id}`,
          kind: "lead" as const,
          title: lead.name,
          detail: lead.email || lead.phone || lead.address || "Customer record",
          lead,
        }))
    : [];
  const propertyResults = normalizedQuery
    ? (properties.data ?? [])
        .filter((property) => {
          const customer = customers.data?.find((item) => item.id === property.customer_id);
          return `${property.label} ${property.address} ${customer?.name ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery);
        })
        .slice(0, 8)
        .map((property) => ({
          key: `property-${property.id}`,
          kind: "property" as const,
          title: property.address,
          detail: `${customers.data?.find((item) => item.id === property.customer_id)?.name ?? "Customer"} · Open roof tracing`,
          property,
        }))
    : [];
  const results = [...propertyResults, ...leadResults].slice(0, 10);
  const current = groups.flatMap((g) => g.items).find((i) => i.id === section);
  function navigation(compact: boolean) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-24 shrink-0 items-center gap-3 border-b border-navy-foreground/15 px-5">
          <LogoMark
            className={compact ? "h-7 max-w-10 object-cover object-left" : "h-8 max-w-32"}
          />
          {!compact && (
            <span className="font-display text-lg font-bold leading-tight">
              ROOFER
              <br />
              MASTERS
            </span>
          )}
        </div>
        <nav aria-label="CRM navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          {visibleGroups.map((g) => (
            <div key={g.label} className="mb-6">
              {!compact && (
                <p className="mb-2 px-3 text-[10px] font-bold uppercase text-navy-foreground/55">
                  {g.label}
                </p>
              )}
              <div className="grid gap-1">
                {g.items.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    asChild
                    title={item.label}
                    className={cn(
                      "h-10 justify-start rounded-md text-navy-foreground/80 hover:bg-navy-foreground/10 hover:text-navy-foreground",
                      compact && "justify-center px-0",
                      section === item.id && "bg-navy-foreground/15 text-navy-foreground",
                    )}
                  >
                    <Link
                      {...(item.id
                        ? { to: "/dashboard/$section" as const, params: { section: item.id } }
                        : { to: "/dashboard" as const })}
                      onClick={() => setMobile(false)}
                      aria-label={item.label}
                      aria-current={section === item.id ? "page" : undefined}
                    >
                      <item.icon className="size-[18px] shrink-0" />
                      {!compact && <span className="truncate text-[13px]">{item.label}</span>}
                    </Link>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-navy-foreground/15 p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-navy-foreground/80 hover:bg-navy-foreground/10 hover:text-navy-foreground"
            asChild
            title="View website"
          >
            <Link to="/">
              <ExternalLink className="size-4" />
              {!compact && "View website"}
            </Link>
          </Button>
          {!compact && (
            <p className="px-3 pt-3 text-[10px] text-navy-foreground/50">Miami-Dade & Broward</p>
          )}
        </div>
      </div>
    );
  }
  return (
    <CrmContext.Provider
      value={{
        leads,
        roofReportRequest,
        clearRoofReportRequest: () => setRoofReportRequest(null),
        selectedRoofReportId,
        openRoofMeasurements: (reportId) => {
          setSelectedRoofReportId(reportId);
          void go("measurements");
        },
        onOpen: (l) => setOpenId(l.id),
        openProposals: (id) => {
          setProposalLeadId(id ?? null);
          setOpenId(null);
          go("proposals");
        },
        proposalLeadId,
        clearProposalLead: () => setProposalLeadId(null),
        go,
      }}
    >
      <div className="flex min-h-dvh bg-background text-foreground">
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 bg-navy text-navy-foreground lg:block",
            collapsed ? "w-20" : "w-60",
          )}
        >
          {navigation(collapsed)}
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-7">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open CRM menu"
              className="lg:hidden"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:flex"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex">
              <span>Workspace</span>
              <ChevronRight className="size-3" />
              <span className="text-foreground">{current?.label ?? "Dashboard"}</span>
            </div>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-9 border-0 bg-muted pl-9 text-xs"
                aria-label="Search CRM customers"
                placeholder="Search customers…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <div className="absolute inset-x-0 top-11 z-40 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-card">
                  {results.map((result) => (
                    <Button
                      key={result.key}
                      variant="ghost"
                      className="h-auto w-full justify-start py-3 text-left"
                      onClick={() => {
                        if (result.kind === "property") {
                          setRoofReportRequest({
                            propertyId: result.property.id,
                            customerId: result.property.customer_id,
                            address: result.property.address,
                          });
                          setOpenId(null);
                          setSelectedRoofReportId(null);
                          void go("roof-reports");
                        } else {
                          setOpenId(result.lead.id);
                        }
                        setQuery("");
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{result.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{result.detail}</p>
                      </div>
                    </Button>
                  ))}
                  {!results.length && (
                    <p className="p-3 text-xs text-muted-foreground">No matching customers.</p>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              title={dark ? "Light mode" : "Dark mode"}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => {
                setDark(!dark);
                localStorage.setItem("crm-theme", !dark ? "dark" : "light");
              }}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              title="Notifications"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell className="size-4" />
              {due.length > 0 && (
                <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              title={`Sign out ${email}`}
              aria-label="Sign out"
              onClick={onSignOut}
            >
              <LogOut className="size-4" />
            </Button>
          </header>
          <main className="mx-auto max-w-[1600px] p-4 sm:p-7 lg:p-9">
            {error ? (
              <p role="alert" className="text-destructive">
                Customer records could not load. Refresh to try again.
              </p>
            ) : isPending ? (
              <p className="py-20 text-center text-muted-foreground">Loading your workspace…</p>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="w-72 border-0 bg-navy p-0 text-navy-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Roofer Masters navigation</SheetTitle>
            <SheetDescription>Business workspace</SheetDescription>
          </SheetHeader>
          {navigation(false)}
        </SheetContent>
      </Sheet>
      <Dialog open={notifications} onOpenChange={setNotifications}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notification center</DialogTitle>
            <DialogDescription>Upcoming and overdue follow-ups</DialogDescription>
          </DialogHeader>
          {tasks.error ? (
            <p className="text-destructive">Notifications could not load.</p>
          ) : due.length ? (
            due.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                className="h-auto justify-start text-left"
                onClick={() => go("followups")}
              >
                <Clock className="size-4" />
                <div>
                  <p>{t.title}</p>
                  <p className="text-xs text-muted-foreground">{formatWhen(t.due_at)}</p>
                </div>
              </Button>
            ))
          ) : (
            <p className="py-5 text-sm text-muted-foreground">
              No follow-ups due in the next 24 hours.
            </p>
          )}
        </DialogContent>
      </Dialog>
      <LeadSheet
        lead={openLead}
        onClose={() => setOpenId(null)}
        onOpenChat={() => {
          setOpenId(null);
          go("chat");
        }}
        onOpenProposals={(id) => {
          setProposalLeadId(id);
          setOpenId(null);
          go("proposals");
        }}
      />
    </CrmContext.Provider>
  );
}
