import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatWhen, messagesQuery, type Lead } from "./data";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

export function ChatInbox({
  leads,
  selectedId,
  onSelect,
  onOpenLead,
}: {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenLead: (l: Lead) => void;
}) {
  const chats = useMemo(
    () =>
      leads
        .filter((l) => l.source === "chat")
        .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)),
    [leads],
  );
  const selected = chats.find((c) => c.id === selectedId) ?? null;

  if (chats.length === 0)
    return (
      <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No chat conversations yet. Messages from the website chat bubble will appear here.
      </p>
    );

  return (
    <div className="grid min-h-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-card md:grid-cols-[300px_1fr]">
      <ul
        className={cn(
          "divide-y divide-border border-r border-border",
          selected && "hidden md:block",
        )}
      >
        {chats.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "w-full px-4 py-3 text-left transition hover:bg-muted/60",
                c.id === selectedId && "bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-foreground">{c.name}</span>
                <span className="text-[0.7rem] text-muted-foreground">
                  {formatWhen(c.last_message_at)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.phone || c.email}</p>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <Conversation lead={selected} onBack={() => onSelect(null)} onOpenLead={onOpenLead} />
      ) : (
        <div className="hidden items-center justify-center p-10 text-sm text-muted-foreground md:flex">
          Select a conversation
        </div>
      )}
    </div>
  );
}

function Conversation({
  lead,
  onBack,
  onOpenLead,
}: {
  lead: Lead;
  onBack: () => void;
  onOpenLead: (l: Lead) => void;
}) {
  const qc = useQueryClient();
  const { data: messages = [] } = useQuery(messagesQuery(lead.id));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in to reply");
      if (!lead.company_id) throw new Error("Customer is not assigned to a company");
      const { data: membership, error: membershipError } = await supabase
        .from("crm_company_memberships")
        .select("company_id")
        .eq("company_id", lead.company_id)
        .eq("user_id", auth.user.id)
        .in("role", ["owner", "admin", "office", "sales"])
        .maybeSingle();
      if (membershipError || !membership) throw new Error("You cannot reply for this company");
      const { error } = await supabase
        .from("lead_messages")
        .insert({ lead_id: lead.id, company_id: lead.company_id, sender: "owner", body });
      if (error) throw error;
    } catch (error) {
      setSending(false);
      toast.error(error instanceof Error ? error.message : "Reply failed to send");
      return;
    }
    setSending(false);
    setDraft("");
    qc.invalidateQueries({ queryKey: ["lead-messages", lead.id] });
    if (lead.status === "new") {
      await supabase.from("leads").update({ status: "contacted" }).eq("id", lead.id).eq("company_id", lead.company_id);
      qc.invalidateQueries({ queryKey: ["leads"] });
    }
  }

  return (
    <div className="flex min-h-[520px] flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
        <div className="flex-1">
          <p className="font-bold text-foreground">{lead.name}</p>
          <p className="text-xs text-muted-foreground">
            {[lead.phone, lead.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusBadge status={lead.status} />
        <Button size="sm" variant="outline" onClick={() => onOpenLead(lead)}>
          Details
        </Button>
      </header>
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.sender === "owner" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                m.sender === "owner"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-card text-foreground shadow-card",
              )}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p
                className={cn(
                  "mt-1 text-[0.65rem]",
                  m.sender === "owner" ? "text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {formatWhen(m.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-border p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reply to customer… (they see it in the site chat)"
          className="h-11"
        />
        <Button type="submit" variant="call" className="h-11" disabled={sending}>
          <Send /> Send
        </Button>
      </form>
    </div>
  );
}
