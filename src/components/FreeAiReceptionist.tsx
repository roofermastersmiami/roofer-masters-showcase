import { useEffect, useRef, useState } from "react";
import { CalendarDays, MessageCircle, Mic, MicOff, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Slot = { start: string; end: string };
type ApiReply = { reply: string; slots?: Slot[]; booking?: unknown };
type SpeechRecognitionResultLike = { 0: { transcript: string }; isFinal: boolean };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

const API_URL = (import.meta.env.VITE_RECEPTIONIST_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const localTime = (iso: string) => new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York",
}).format(new Date(iso));
const isSpanish = (value: string) => /[¿¡ñáéíóúü]|\b(hola|buenos|buenas|techo|filtraci[oó]n|reparaci[oó]n|cita|inspecci[oó]n|gracias|quiero|necesito)\b/i.test(value);

export function FreeAiReceptionist({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi! Thanks for contacting Roofer Masters. How can I help with your roof today? ¡También hablamos español!" },
  ]);
  const [draft, setDraft] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setVoiceSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, slots]);

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isSpanish(text) ? "es-US" : "en-US";
    window.speechSynthesis.speak(utterance);
  };

  async function sendMessage(text: string, channel: "chat" | "browser_voice" = "chat") {
    const content = text.trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    setSlots([]);
    setSending(true);
    try {
      if (!API_URL) throw new Error("Receptionist service is not configured yet.");
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history: messages.slice(-12), channel }),
      });
      if (!response.ok) throw new Error("The receptionist is temporarily unavailable.");
      const data = await response.json() as ApiReply;
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
      setSlots(data.slots ?? []);
      speak(data.reply);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant", content: error instanceof Error ? error.message : "Please call Roofer Masters at (305) 942-3093.",
      }]);
    } finally { setSending(false); }
  }

  function startVoice() {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language.toLowerCase().startsWith("es") ? "es-US" : "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) {
        recognition.lang = isSpanish(transcript) ? "es-US" : "en-US";
        void sendMessage(transcript, "browser_voice");
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try { recognition.start(); setListening(true); } catch { setListening(false); }
  }

  function chooseSlot(slot: Slot) {
    const selected = localTime(slot.start);
    void sendMessage(`I confirm the ${selected} appointment. Please book this time for me.`);
  }

  return (
    <div className={cn("fixed bottom-5 right-5 z-50", className)}>
      {open && <section aria-label="Roofer Masters AI receptionist" className="mb-3 flex h-[min(650px,78vh)] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <header className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
          <div><p className="font-semibold">Roofer Masters Receptionist</p><p className="text-xs opacity-80">English · Español · Online chat</p></div>
          <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary/80" aria-label="Close chat" onClick={() => setOpen(false)}><X /></Button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.map((message, index) => <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{message.content}</div>
          </div>)}
          {slots.length > 0 && <div className="rounded-xl border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4" /> Available appointment times (Eastern)</p>
            <div className="grid grid-cols-2 gap-2">{slots.map((slot) => <Button key={slot.start} variant="outline" size="sm" disabled={sending} onClick={() => chooseSlot(slot)}>{localTime(slot.start)}</Button>)}</div>
          </div>}
          {sending && <p className="text-xs text-muted-foreground">Receptionist is typing…</p>}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); void sendMessage(draft); }}>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type your message…" aria-label="Message" disabled={sending} />
          <Button type="submit" size="icon" aria-label="Send message" disabled={sending || !draft.trim()}><Send className="size-4" /></Button>
          {voiceSupported && <Button type="button" size="icon" variant={listening ? "destructive" : "outline"} aria-label={listening ? "Stop voice input" : "Talk to receptionist"} onClick={() => listening ? recognitionRef.current?.stop() : startVoice()}>{listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>}
        </form>
        <p className="px-3 pb-2 text-center text-[10px] text-muted-foreground">Browser voice uses your device microphone and speaker. Not a phone call.</p>
      </section>}
      <Button onClick={() => setOpen((value) => !value)} className="h-14 rounded-full px-5 shadow-xl">
        {open ? <X className="mr-2 size-5" /> : <MessageCircle className="mr-2 size-5" />}
        {open ? "Close" : "Talk to Receptionist"}
      </Button>
    </div>
  );
}

export default FreeAiReceptionist;
