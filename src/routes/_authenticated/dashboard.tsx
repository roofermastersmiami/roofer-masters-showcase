import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink, Inbox, KanbanSquare, LogOut, MessageSquare, PenSquare, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Logo } from "@/components/site/Logo";
import { isOwnerQuery, leadsQuery, type Lead } from "@/components/dashboard/data";
import { Pipeline } from "@/components/dashboard/Pipeline";
import { LeadsTable } from "@/components/dashboard/LeadsTable";
import { Contacts } from "@/components/dashboard/Contacts";
import { ChatInbox } from "@/components/dashboard/ChatInbox";
import { ContentEditor } from "@/components/dashboard/ContentEditor";
import { LeadSheet } from "@/components/dashboard/LeadSheet";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/lead-schema";
import { BUSINESS } from "@/lib/site";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Owner Dashboard | Roofer Masters" },
      { name: "description", content: "Manage leads, contacts, chats and website content." },
      { property: "og:title", content: "Owner Dashboard | Roofer Masters" },
      { property: "og:description", content: "Manage leads, contacts, chats and website content." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const owner = useQuery(isOwnerQuery(user.id));

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-gradient-steel">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-11" />
            <span className="hidden rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground sm:inline">Owner dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground md:inline">{user.email}</span>
            <Button asChild variant="ghost" size="sm"><Link to="/"><ExternalLink /> <span className="hidden sm:inline">View site</span></Link></Button>
            <Button variant="outline" size="sm" onClick={signOut}><LogOut /> <span className="hidden sm:inline">Sign out</span></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {owner.isLoading ? (
          <p className="py-20 text-center text-muted-foreground">Loading…</p>
        ) : !owner.data ? (
          <div className="mx-auto max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-card">
            <h1 className="text-2xl font-black text-foreground">No owner access</h1>
            <p className="mt-2 text-muted-foreground">
              This account isn't set up as the business owner. Sign in with {BUSINESS.email} (after
              confirming the email) to manage leads.
            </p>
            <Button variant="outline" className="mt-6" onClick={signOut}>Sign in with another account</Button>
          </div>
        ) : (
          <OwnerArea />
        )}
      </main>
    </div>
  );
}

function OwnerArea() {
  const { data: leads = [], isLoading, error } = useQuery(leadsQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState("pipeline");
  const [chatId, setChatId] = useState<string | null>(null);
  const openLead = leads.find((l) => l.id === openId) ?? null;
  const open = (l: Lead) => setOpenId(l.id);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5;
    return {
      thisWeek: leads.filter((l) => new Date(l.created_at).getTime() > weekAgo).length,
      byStatus: Object.fromEntries(LEAD_STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length])),
    };
  }, [leads]);

  return (
    <>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black text-foreground sm:text-4xl">Leads</h1>
          <p className="text-muted-foreground">Every call-back, quote, contact form and chat lands here automatically.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="New this week" value={stats.thisWeek} highlight />
        {LEAD_STATUSES.map((s) => <Stat key={s} label={LEAD_STATUS_LABELS[s]} value={stats.byStatus[s] ?? 0} />)}
      </div>

      {error && <p className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Couldn't load leads. Refresh to try again.</p>}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="no-scrollbar h-auto w-full justify-start overflow-x-auto rounded-xl bg-card p-1 shadow-card sm:w-auto">
          <TabsTrigger value="pipeline" className="h-10 gap-2 rounded-lg px-4"><KanbanSquare className="size-4" /> Pipeline</TabsTrigger>
          <TabsTrigger value="inbox" className="h-10 gap-2 rounded-lg px-4"><Inbox className="size-4" /> Submissions</TabsTrigger>
          <TabsTrigger value="chat" className="h-10 gap-2 rounded-lg px-4"><MessageSquare className="size-4" /> Chat</TabsTrigger>
          <TabsTrigger value="contacts" className="h-10 gap-2 rounded-lg px-4"><Users className="size-4" /> Contacts</TabsTrigger>
          <TabsTrigger value="content" className="h-10 gap-2 rounded-lg px-4"><PenSquare className="size-4" /> Site content</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          {isLoading ? <p className="py-10 text-center text-muted-foreground">Loading leads…</p> : (
            <>
              <TabsContent value="pipeline"><Pipeline leads={leads} onOpen={open} /></TabsContent>
              <TabsContent value="inbox"><LeadsTable leads={leads} onOpen={open} /></TabsContent>
              <TabsContent value="chat"><ChatInbox leads={leads} selectedId={chatId} onSelect={setChatId} onOpenLead={open} /></TabsContent>
              <TabsContent value="contacts"><Contacts leads={leads} onOpen={open} /></TabsContent>
            </>
          )}
          <TabsContent value="content"><ContentEditor /></TabsContent>
        </div>
      </Tabs>

      <LeadSheet
        lead={openLead}
        onClose={() => setOpenId(null)}
        onOpenChat={(id) => { setOpenId(null); setChatId(id); setTab("chat"); }}
      />
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={highlight ? "rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant" : "rounded-2xl border border-border bg-card p-4 shadow-card"}>
      <p className={highlight ? "text-xs font-bold uppercase tracking-wider opacity-80" : "text-xs font-bold uppercase tracking-wider text-muted-foreground"}>{label}</p>
      <p className="mt-1 font-display text-3xl font-black">{value}</p>
    </div>
  );
}
