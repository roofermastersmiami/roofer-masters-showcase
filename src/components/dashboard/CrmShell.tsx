import { useRoles } from "./RolesContext";
import { isCrmThemeId } from "@/lib/crm-theme";
import { CRM_ACCENT_COLORS, getCrmAccent, isCrmAccentId } from "@/lib/crm-accent";
import { canOpen } from "@/lib/team-roles";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  MapPin,
  Calculator,
  CalendarDays,
  FileText,
  ClipboardCheck,
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
  Palette,
  ImagePlus,
  LoaderCircle,
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
import { supabase } from "@/integrations/supabase/client";
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
      { id: "permitting", label: "Permitting", icon: ClipboardCheck },
      { id: "estimates", label: "Quick estimator", icon: Calculator },
      { id: "detailed-estimator", label: "Detailed estimator", icon: Calculator },
      { id: "prices", label: "Material & labor prices", icon: Settings },
      { id: "proposals", label: "Estimates & proposals", icon: FileText },
      { id: "pdf-tools", label: "PDF studio", icon: FileText },
      { id: "jobs", label: "Projects & production", icon: HardHat },
      { id: "followups", label: "Tasks & follow-ups", icon: Clock },
      { id: "appointments", label: "Appointment calendar", icon: CalendarDays },
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
    [sidebarVisible, setSidebarVisible] = useState(true),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false),
    [theme, setTheme] = useState("default"),
    [accent, setAccent] = useState("magenta"),
    [themeChoice, setThemeChoice] = useState("theme:default"),
    [sidebarAppearance, setSidebarAppearance] = useState("navy"),
    [sidebarPreferencesLoaded, setSidebarPreferencesLoaded] = useState(false),
    [brandingCompanyId, setBrandingCompanyId] = useState<string | null>(null),
    [brandingLoaded, setBrandingLoaded] = useState(false),
    [logoPath, setLogoPath] = useState<string | null>(null),
    [logoUrl, setLogoUrl] = useState(""),
    [logoUploading, setLogoUploading] = useState(false),
    [logoSize, setLogoSize] = useState(112),
    [brandingError, setBrandingError] = useState(""),
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
  const logoInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    const loadBranding = async () => {
      try {
        setDark(localStorage.getItem("crm-theme") === "dark");
        const savedLogoSize = Number(localStorage.getItem("crm-logo-size"));
        if (Number.isFinite(savedLogoSize) && savedLogoSize >= 48 && savedLogoSize <= 220)
          setLogoSize(savedLogoSize);
        const fallbackTheme = localStorage.getItem("crm-theme-preset");
        const fallbackAccent = localStorage.getItem("crm-accent-color");
        if (fallbackAccent && isCrmAccentId(fallbackAccent)) {
          setAccent(fallbackAccent);
          if (fallbackAccent !== "magenta") setThemeChoice(`color:${fallbackAccent}`);
        }
        const savedSidebarVisibility = localStorage.getItem("crm-sidebar-visible");
        if (savedSidebarVisibility !== null) setSidebarVisible(savedSidebarVisibility !== "false");
        const fallbackSidebar = localStorage.getItem("crm-sidebar-appearance");
        if (fallbackTheme && isCrmThemeId(fallbackTheme)) {
          setTheme(fallbackTheme);
          if (!fallbackAccent || fallbackAccent === "magenta")
            setThemeChoice(`theme:${fallbackTheme}`);
        }
        if (
          fallbackSidebar &&
          ["navy", "light", "accent", "charcoal", "gradient", "steel"].includes(fallbackSidebar)
        )
          setSidebarAppearance(fallbackSidebar);
      } catch {
        // Browser storage may be disabled; use the in-memory defaults.
      }
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (user) {
          const { data: membership, error: membershipError } = await supabase
            .from("crm_company_memberships")
            .select("company_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (membershipError) throw membershipError;
          if (!membership?.company_id)
            throw new Error("Your account is not assigned to a company workspace.");
          const companyId = membership.company_id as string;
          setBrandingCompanyId(companyId);
          const { data, error: loadError } = await supabase
            .from("crm_company_branding")
            .select("logo_path, theme_palette, theme_accent, sidebar_appearance")
            .eq("company_id", companyId)
            .maybeSingle();
          if (loadError) throw loadError;
          if (data) {
            if (isCrmThemeId(data.theme_palette)) {
              setTheme(data.theme_palette);
              if (isCrmAccentId(data.theme_accent)) setAccent(data.theme_accent);
              setThemeChoice(
                data.theme_palette === "default" &&
                  isCrmAccentId(data.theme_accent) &&
                  data.theme_accent !== "magenta"
                  ? `color:${data.theme_accent}`
                  : `theme:${data.theme_palette}`,
              );
            }
            if (
              ["navy", "light", "accent", "charcoal", "gradient", "steel"].includes(
                data.sidebar_appearance,
              )
            )
              setSidebarAppearance(data.sidebar_appearance);
            setLogoPath(data.logo_path);
            if (data.logo_path) {
              const { data: signedLogo, error: signedUrlError } = await supabase.storage
                .from("crm-company-branding")
                .createSignedUrl(data.logo_path, 60 * 60);
              if (signedUrlError) throw signedUrlError;
              if (!cancelled) setLogoUrl(signedLogo.signedUrl);
            } else {
              setLogoUrl("");
            }
          }
        }
      } catch {
        if (!cancelled)
          setBrandingError(
            "Company branding could not be loaded. Your current appearance remains available.",
          );
      } finally {
        if (!cancelled) {
          setSidebarPreferencesLoaded(true);
          setBrandingLoaded(true);
        }
      }
    };
    void loadBranding();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!sidebarPreferencesLoaded) return;
    try {
      localStorage.setItem("crm-sidebar-visible", String(sidebarVisible));
    } catch {
      // Keep the selected visibility for this session when storage is unavailable.
    }
  }, [sidebarVisible, sidebarPreferencesLoaded]);

  useEffect(() => {
    if (!sidebarPreferencesLoaded) return;
    try {
      localStorage.setItem("crm-sidebar-appearance", sidebarAppearance);
    } catch {
      // Keep the selected appearance for this session when storage is unavailable.
    }
  }, [sidebarAppearance, sidebarPreferencesLoaded]);

  useEffect(() => {
    if (!logoPath) return;
    let cancelled = false;
    const refreshSignedLogoUrl = async () => {
      const { data, error: signedUrlError } = await supabase.storage
        .from("crm-company-branding")
        .createSignedUrl(logoPath, 60 * 60);
      if (!cancelled && !signedUrlError && data?.signedUrl) setLogoUrl(data.signedUrl);
    };
    const interval = window.setInterval(
      () => {
        void refreshSignedLogoUrl();
      },
      45 * 60 * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [logoPath]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(
      "crm-theme-ocean",
      "crm-theme-slate",
      "crm-theme-emerald",
      "crm-theme-sunset",
      "crm-theme-violet",
      "crm-theme-executive-berry",
      "crm-theme-modern-enterprise",
      "crm-theme-canyon-corporate",
      "crm-theme-midnight-teal",
      "crm-theme-ocean-slate",
      "crm-theme-royal-indigo",
      "crm-theme-emerald-ledger",
      "crm-theme-copperstone",
      "crm-theme-arctic-blue",
      "crm-theme-graphite-gold",
      "crm-theme-crimson-executive",
      "crm-theme-sage-stone",
      "crm-theme-cobalt-professional",
      "crm-theme-plum-luxe",
      "crm-theme-monochrome-pro",
    );
    if (theme !== "default") root.classList.add(`crm-theme-${theme}`);
    try {
      localStorage.setItem("crm-theme-preset", theme);
    } catch {
      // The active theme remains applied to the current session.
    }
  }, [theme]);
  useEffect(() => {
    const selected = getCrmAccent(accent);
    const root = document.documentElement;
    if (theme === "default" && selected) {
      root.style.setProperty("--primary", selected.value);
      root.style.setProperty("--primary-glow", selected.value);
      root.style.setProperty("--ring", selected.value);
      root.style.setProperty("--accent", "color-mix(in srgb, " + selected.value + " 13%, white)");
      root.style.setProperty("--accent-foreground", selected.value);
    }
    try {
      localStorage.setItem("crm-accent-color", accent);
    } catch {
      // The accent remains active for this session when storage is unavailable.
    }
    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-glow");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
    };
  }, [accent, theme]);
  useEffect(() => {
    if (!brandingLoaded || !brandingCompanyId) return;
    void supabase
      .from("crm_company_branding")
      .upsert(
        {
          company_id: brandingCompanyId,
          logo_path: logoPath,
          theme_palette: theme,
          theme_accent: accent,
          sidebar_appearance: sidebarAppearance,
        },
        { onConflict: "company_id" },
      )
      .then(({ error: saveError }) => {
        if (saveError)
          setBrandingError("Your branding preference could not be saved to your account.");
        else setBrandingError("");
      });
  }, [brandingLoaded, brandingCompanyId, logoPath, theme, accent, sidebarAppearance]);
  async function uploadCompanyLogo(file: File) {
    setBrandingError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setBrandingError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setBrandingError("Company logos must be 2 MB or smaller.");
      return;
    }
    setLogoUploading(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw authError ?? new Error("Sign in to upload a company logo.");
      const extension =
        file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const companyId = brandingCompanyId;
      if (!companyId) throw new Error("Company workspace is still loading. Refresh and try again.");
      const path = `${companyId}/company-logo.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("crm-company-branding")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (uploadError) throw uploadError;
      setLogoPath(path);
      const { data: signedLogo, error: signedUrlError } = await supabase.storage
        .from("crm-company-branding")
        .createSignedUrl(path, 60 * 60);
      if (signedUrlError) throw signedUrlError;
      setLogoUrl(signedLogo.signedUrl);
      setBrandingLoaded(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The company logo could not be uploaded.";
      setBrandingError(
        /bucket not found|bucket does not exist/i.test(message)
          ? "Company logo storage is not configured yet. The CRM administrator must create the private 'crm-company-branding' bucket before logos can be uploaded. No public bucket is used."
          : message,
      );
    } finally {
      setLogoUploading(false);
    }
  }
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
  const sidebarIsLight = sidebarAppearance === "light" || sidebarAppearance === "steel";
  const sidebarSurface =
    sidebarAppearance === "light"
      ? "border-border bg-card text-foreground"
      : sidebarAppearance === "accent"
        ? "border-transparent bg-primary text-primary-foreground"
        : sidebarAppearance === "charcoal"
          ? "border-transparent bg-slate-900 text-slate-100"
          : sidebarAppearance === "gradient"
            ? "border-transparent bg-gradient-to-b from-slate-900 via-blue-950 to-slate-950 text-white"
            : sidebarAppearance === "steel"
              ? "border-border bg-slate-100 text-slate-800"
              : "border-transparent bg-navy text-navy-foreground";
  const sidebarMutedText = sidebarIsLight ? "text-foreground/80" : "text-white/80";
  const sidebarHover = sidebarIsLight
    ? "hover:bg-muted hover:text-foreground"
    : "hover:bg-white/10 hover:text-white";
  const sidebarActive = sidebarIsLight
    ? "bg-accent text-accent-foreground"
    : "bg-white/15 text-white";
  function navigation(compact: boolean) {
    return (
      <div className="flex h-full flex-col">
        <div
          className={cn(
            "flex shrink-0 items-start border-b px-3 py-3",
            sidebarIsLight ? "border-border" : "border-white/15",
          )}
        >
          <div className="group/logo relative inline-flex max-w-full">
            <Button
              type="button"
              variant="ghost"
              className={cn(
                "h-auto max-w-full justify-start rounded-none bg-transparent p-0 hover:bg-transparent",
                sidebarHover,
              )}
              title={logoUrl ? "Change company logo" : "Add your company logo"}
              aria-label={logoUrl ? "Change company logo" : "Add company logo"}
              disabled={logoUploading}
              onClick={() => logoInputRef.current?.click()}
            >
              {logoUploading ? (
                <LoaderCircle className="size-6 animate-spin" />
              ) : logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Company logo"
                  style={{
                    width: compact ? Math.min(logoSize, 48) : logoSize,
                    height: compact ? Math.min(logoSize, 48) : logoSize,
                  }}
                  className="max-w-full shrink-0 object-contain"
                />
              ) : (
                <ImagePlus className="size-7" />
              )}
            </Button>
            {!compact && (
              <div
                className="pointer-events-none absolute inset-x-1 bottom-1 z-10 flex translate-y-1 items-center rounded-full bg-black/55 px-2 py-1 opacity-0 shadow-sm backdrop-blur-sm transition-all duration-200 group-hover/logo:pointer-events-auto group-hover/logo:translate-y-0 group-hover/logo:opacity-100 group-focus-within/logo:pointer-events-auto group-focus-within/logo:translate-y-0 group-focus-within/logo:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="range"
                  min={48}
                  max={220}
                  step={4}
                  value={logoSize}
                  aria-label="Adjust company logo size"
                  title={`Logo size: ${logoSize}px`}
                  className="h-3 w-full cursor-ew-resize accent-white"
                  onChange={(event) => {
                    const nextSize = Number(event.currentTarget.value);
                    setLogoSize(nextSize);
                    try {
                      localStorage.setItem("crm-logo-size", String(nextSize));
                    } catch {
                      // Keep the selected size for this session if browser storage is unavailable.
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <nav aria-label="CRM navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          {visibleGroups.map((g) => (
            <div key={g.label} className="mb-6">
              {!compact && (
                <p
                  className={cn(
                    "mb-2 px-3 text-[10px] font-bold uppercase",
                    sidebarIsLight ? "text-muted-foreground" : "text-white/55",
                  )}
                >
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
                      "h-10 justify-start rounded-md",
                      `${sidebarMutedText} ${sidebarHover}`,
                      compact && "justify-center px-0",
                      section === item.id && sidebarActive,
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
        <div
          className={cn(
            "border-t p-3",
            sidebarAppearance === "light" ? "border-border" : "border-primary-foreground/15",
          )}
        >
          <Button
            variant="ghost"
            className={cn("w-full justify-start", sidebarMutedText, sidebarHover)}
            asChild
            title="View website"
          >
            <Link to="/">
              <ExternalLink className="size-4" />
              {!compact && "View website"}
            </Link>
          </Button>
          {!compact && (
            <p
              className={cn(
                "px-3 pt-3 text-[10px]",
                sidebarIsLight ? "text-muted-foreground" : "text-white/50",
              )}
            >
              Company workspace
            </p>
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
        {sidebarVisible && (
          <aside
            className={cn(
              "sticky top-0 hidden h-dvh shrink-0 border-r transition-colors lg:block",
              sidebarSurface,
              collapsed ? "w-20" : "w-60",
            )}
          >
            {navigation(collapsed)}
          </aside>
        )}
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
            {sidebarVisible && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden lg:flex"
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              className="hidden lg:flex"
              onClick={() => setSidebarVisible((visible) => !visible)}
            >
              {sidebarVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
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
                          void go("measurements");
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
            <label
              className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 sm:gap-1.5 sm:px-2"
              title="Choose one of 35 CRM themes"
            >
              <Palette className="size-4 text-muted-foreground" />
              <span className="sr-only">CRM appearance</span>
              <select
                aria-label="CRM appearance"
                value={themeChoice}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.startsWith("color:")) {
                    const accentId = value.slice("color:".length);
                    if (isCrmAccentId(accentId)) {
                      setTheme("default");
                      setAccent(accentId);
                      setThemeChoice(value);
                    }
                    return;
                  }
                  const themeId = value.slice("theme:".length);
                  if (isCrmThemeId(themeId)) {
                    setTheme(themeId);
                    setThemeChoice(value);
                  }
                }}
                className="h-8 max-w-28 bg-transparent text-[11px] outline-none sm:max-w-40 sm:text-xs"
              >
                <option value="theme:default">Default — Roofer Masters</option>
                <option value="theme:executive-berry">Executive Berry</option>
                <option value="theme:modern-enterprise">Modern Enterprise</option>
                <option value="theme:canyon-corporate">Canyon Corporate</option>
                <option value="theme:midnight-teal">Midnight Teal</option>
                <option value="theme:ocean-slate">Ocean Slate</option>
                <option value="theme:royal-indigo">Royal Indigo</option>
                <option value="theme:emerald-ledger">Emerald Ledger</option>
                <option value="theme:copperstone">Copperstone</option>
                <option value="theme:arctic-blue">Arctic Blue</option>
                <option value="theme:graphite-gold">Graphite Gold</option>
                <option value="theme:crimson-executive">Crimson Executive</option>
                <option value="theme:sage-stone">Sage & Stone</option>
                <option value="theme:cobalt-professional">Cobalt Professional</option>
                <option value="theme:plum-luxe">Plum Luxe</option>
                <option value="theme:monochrome-pro">Monochrome Pro</option>
                {CRM_ACCENT_COLORS.map((color) => (
                  <option key={color.id} value={`color:${color.id}`}>
                    {color.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="hidden items-center gap-1.5 rounded-md border border-border bg-background px-2 xl:flex"
              title="Choose sidebar appearance"
            >
              <span className="text-[11px] text-muted-foreground">Sidebar</span>
              <select
                aria-label="Sidebar appearance"
                value={sidebarAppearance}
                onChange={(event) => setSidebarAppearance(event.target.value)}
                className="h-8 max-w-20 bg-transparent text-xs outline-none"
              >
                <option value="navy">Navy</option>
                <option value="light">Light</option>
                <option value="accent">Accent</option>
                <option value="charcoal">Charcoal</option>
                <option value="gradient">Midnight gradient</option>
                <option value="steel">Steel</option>
              </select>
            </label>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Upload company logo"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadCompanyLogo(file);
                event.currentTarget.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              title={dark ? "Light mode" : "Dark mode"}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => {
                setDark(!dark);
                try {
                  localStorage.setItem("crm-theme", !dark ? "dark" : "light");
                } catch {
                  // Dark mode still changes for the current session.
                }
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
          {brandingError && (
            <p
              role="status"
              className="border-b border-border bg-muted px-4 py-2 text-right text-xs text-destructive"
            >
              {brandingError}
            </p>
          )}
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
        <SheetContent side="left" className={cn("w-72 border-0 p-0", sidebarSurface)}>
          <SheetHeader className="sr-only">
            <SheetTitle>Company navigation</SheetTitle>
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
