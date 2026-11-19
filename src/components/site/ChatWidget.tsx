import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getChatMessages, sendChatMessage, startChat } from "@/lib/leads.functions";
import { chatStartSchema } from "@/lib/lead-schema";
import { BUSINESS } from "@/lib/site";
import { LogoMark } from "./Logo";
import { cn } from "@/lib/utils";

type Session = { leadId: string; token: string; name: string };
type Msg = { id: string; sender: string; body: string; created_at: string };
const KEY = "rm-chat-session";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const start = useServerFn(startChat);
  const send = useServerFn(sendChatMessage);
  const fetchMsgs = useServerFn(getChatMessages);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMsgs({ data: { leadId: session.leadId, token: session.token } });
        if (!cancelled) setMessages(rows);
      } catch {
        if (!cancelled) {
          localStorage.removeItem(KEY);
          setSession(null);
        }
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [open, session, fetchMsgs]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    const parsed = chatStartSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await start({ data: parsed.data });
      const s = { leadId: res.leadId, token: res.token, name: parsed.data.name };
      localStorage.setItem(KEY, JSON.stringify(s));
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !draft.trim()) return;
    const body = draft.trim();
    setDraft("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, sender: "customer", body, created_at: new Date().toISOString() }]);
    try {
      await send({ data: { leadId: session.leadId, token: session.token, body } });
    } catch {
      setError("Message failed to send. Please try again.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat" : "Chat with us"}
        className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow transition hover:scale-105 md:bottom-6 md:right-6"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chat with Roofer Masters"
          className="animate-fade-up fixed inset-x-3 bottom-40 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elegant md:inset-x-auto md:bottom-24 md:right-6 md:w-[380px]"
        >
          <div className="flex items-center gap-3 bg-gradient-navy px-4 py-3 text-navy-foreground">
            <div className="rounded-lg bg-card p-1.5">
              <LogoMark className="h-6" />
            </div>
            <div className="flex-1">
              <p className="font-display font-extrabold">Roofer Masters</p>
              <p className="text-xs text-navy-foreground/70">We reply during business hours · Hablamos español</p>
            </div>
          </div>

          {!session ? (
            <form onSubmit={onStart} className="grid gap-3 overflow-y-auto p-4">
              <p className="text-sm text-muted-foreground">
                Hi! 👋 Send us a message and we'll get back to you here, by phone or by email.
              </p>
              <Input placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11" />
              <Input type="tel" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11" />
              <Input type="email" placeholder="Email (optional if phone given)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11" />
              <Textarea placeholder="How can we help?" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
              <Button type="submit" variant="hero" size="lg" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Start chat
              </Button>
              <a href={BUSINESS.whatsappHref} target="_blank" rel="noopener noreferrer" className="text-center text-xs font-semibold text-primary">
                Or message us on WhatsApp
              </a>
            </form>
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-muted/50 p-4">
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground">Loading conversation…</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.sender === "customer" ? "justify-end" : "justify-start")}>
                    <p
                      className={cn(
                        "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                        m.sender === "customer"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-card text-foreground shadow-card",
                      )}
                    >
                      {m.body}
                    </p>
                  </div>
                ))}
                {messages.length > 0 && messages.every((m) => m.sender === "customer") && (
                  <p className="pt-2 text-center text-xs text-muted-foreground">
                    Thanks {session.name.split(" ")[0]}! Our team has your message and will reply soon.
                  </p>
                )}
              </div>
              {error && <p className="px-4 pt-2 text-xs text-destructive">{error}</p>}
              <form onSubmit={onSend} className="flex gap-2 border-t border-border p-3">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message…" className="h-11" aria-label="Message" />
                <Button type="submit" variant="call" size="icon" className="size-11" aria-label="Send">
                  <Send />
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
