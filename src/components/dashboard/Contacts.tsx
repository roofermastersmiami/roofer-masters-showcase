import { useMemo } from "react";
import { Mail, Phone } from "lucide-react";
import { formatWhen, type Lead } from "./data";
import { StatusBadge } from "./StatusBadge";

type Contact = { key: string; name: string; phone: string | null; email: string | null; leads: Lead[] };

export function Contacts({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  const contacts = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const l of leads) {
      const key = l.phone?.replace(/\D/g, "").slice(-10) || l.email?.toLowerCase() || l.id;
      const c = map.get(key) ?? { key, name: l.name, phone: l.phone, email: l.email, leads: [] };
      c.leads.push(l);
      c.phone ??= l.phone;
      c.email ??= l.email;
      map.set(key, c);
    }
    return [...map.values()];
  }, [leads]);

  if (contacts.length === 0) return <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">No contacts yet.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {contacts.map((c) => {
        const latest = c.leads[0];
        if (!latest) return null;
        return (
          <button key={c.key} type="button" onClick={() => onOpen(latest)} className="rounded-2xl border border-border bg-card p-4 text-left shadow-card transition hover:border-primary">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-gradient-primary font-display font-bold text-primary-foreground">{c.name.charAt(0).toUpperCase()}</span>
                <div>
                  <p className="font-bold text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.leads.length} request{c.leads.length > 1 ? "s" : ""} · last {formatWhen(latest.created_at)}</p>
                </div>
              </div>
              <StatusBadge status={latest.status} />
            </div>
            <div className="mt-3 space-y-1 text-sm text-foreground">
              {c.phone && <p className="flex items-center gap-2"><Phone className="size-3.5 text-primary" />{c.phone}</p>}
              {c.email && <p className="flex items-center gap-2"><Mail className="size-3.5 text-primary" />{c.email}</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
